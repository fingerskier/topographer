'use strict';
const acorn = require('acorn');
const jsx = require('acorn-jsx');
const { parseImports } = require('../parse.js');

const JsxParser = acorn.Parser.extend(jsx());

const tsCache = new Map(); // root -> ts module | null
function loadTs(root) {
  if (tsCache.has(root)) return tsCache.get(root);
  let ts = null;
  try {
    const tsPath = require.resolve('typescript', { paths: [root] });
    ts = require(tsPath);
  } catch (_e) {}
  tsCache.set(root, ts);
  return ts;
}

/** Generic AST walk; visit(node, parents) for every node with a string `type`. */
function walk(node, visit, parents) {
  if (!node || typeof node.type !== 'string') return;
  visit(node, parents);
  parents.push(node);
  for (const key of Object.keys(node)) {
    if (key === 'loc') continue;
    const v = node[key];
    if (Array.isArray(v)) {
      for (const c of v) if (c && typeof c.type === 'string') walk(c, visit, parents);
    } else if (v && typeof v.type === 'string') {
      walk(v, visit, parents);
    }
  }
  parents.pop();
}

function parseAcorn(source) {
  const opts = { ecmaVersion: 'latest', locations: true, allowHashBang: true };
  try {
    return JsxParser.parse(source, { ...opts, sourceType: 'module' });
  } catch (_e) {
    return JsxParser.parse(source, { ...opts, sourceType: 'script' }); // may throw — caller catches
  }
}

function importsFromAst(ast) {
  const found = new Map(); // specifier -> dynamic (static wins)
  const add = (spec, dynamic) => {
    if (typeof spec !== 'string' || !spec) return;
    if (found.has(spec)) { if (!dynamic) found.set(spec, false); }
    else found.set(spec, dynamic);
  };
  walk(ast, (n) => {
    if (n.type === 'ImportDeclaration') add(n.source.value, false);
    else if ((n.type === 'ExportNamedDeclaration' || n.type === 'ExportAllDeclaration') && n.source) add(n.source.value, false);
    else if (n.type === 'ImportExpression' && n.source && n.source.type === 'Literal') add(n.source.value, true);
    else if (n.type === 'CallExpression' && n.callee.type === 'Identifier' && n.callee.name === 'require' &&
             n.arguments.length && n.arguments[0].type === 'Literal') add(n.arguments[0].value, false);
  }, []);
  return Array.from(found, ([specifier, dynamic]) => ({ specifier, dynamic }));
}

const TS_FN_KINDS = (ts) => new Set([
  ts.SyntaxKind.FunctionDeclaration, ts.SyntaxKind.FunctionExpression,
  ts.SyntaxKind.ArrowFunction, ts.SyntaxKind.MethodDeclaration,
  ts.SyntaxKind.Constructor, ts.SyntaxKind.GetAccessor, ts.SyntaxKind.SetAccessor,
]);

function tsIsDecision(ts, n) {
  const K = ts.SyntaxKind;
  switch (n.kind) {
    case K.IfStatement: case K.ConditionalExpression: case K.ForStatement:
    case K.ForInStatement: case K.ForOfStatement: case K.WhileStatement:
    case K.DoStatement: case K.CaseClause: case K.CatchClause:
      return true;
    case K.BinaryExpression: {
      const op = n.operatorToken.kind;
      return op === K.AmpersandAmpersandToken || op === K.BarBarToken || op === K.QuestionQuestionToken;
    }
    default: return false;
  }
}

function tsFnName(ts, n) {
  if (n.name && n.name.text) return n.name.text;
  if (n.kind === ts.SyntaxKind.Constructor) return 'constructor';
  const p = n.parent;
  if (p && ts.isVariableDeclaration(p) && ts.isIdentifier(p.name)) return p.name.text;
  if (p && ts.isPropertyAssignment(p) && p.name && p.name.text) return p.name.text;
  return '<anonymous>';
}

function parseTs(ts, relPath, source) {
  const kind = /\.tsx$/i.test(relPath) ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sf = ts.createSourceFile(relPath, source, ts.ScriptTarget.Latest, /*parents*/ true, kind);
  const line = (pos) => sf.getLineAndCharacterOfPosition(pos).line + 1;
  const fnKinds = TS_FN_KINDS(ts);
  const imports = new Map();
  const addImp = (spec, dynamic) => {
    if (typeof spec !== 'string' || !spec) return;
    if (imports.has(spec)) { if (!dynamic) imports.set(spec, false); }
    else imports.set(spec, dynamic);
  };
  const records = new Map(); // fn node -> record
  const fnStack = [];
  const visit = (n) => {
    const isFn = fnKinds.has(n.kind);
    if (isFn) {
      const rec = { id: null, name: tsFnName(ts, n), startLine: line(n.getStart(sf)), endLine: line(n.end), cc: 1 };
      records.set(n, rec);
      fnStack.push(rec);
    } else if (tsIsDecision(ts, n) && fnStack.length) {
      fnStack[fnStack.length - 1].cc++;
    }
    if ((ts.isImportDeclaration(n) || ts.isExportDeclaration(n)) && n.moduleSpecifier &&
        ts.isStringLiteral(n.moduleSpecifier)) addImp(n.moduleSpecifier.text, false);
    if (ts.isCallExpression(n)) {
      const arg = n.arguments[0];
      if (n.expression.kind === ts.SyntaxKind.ImportKeyword && arg && ts.isStringLiteral(arg)) addImp(arg.text, true);
      if (ts.isIdentifier(n.expression) && n.expression.text === 'require' && arg && ts.isStringLiteral(arg)) addImp(arg.text, false);
    }
    ts.forEachChild(n, visit);
    if (isFn) fnStack.pop();
  };
  visit(sf);
  const functions = Array.from(records.values());
  for (const f of functions) f.id = `${relPath}#${f.name}@${f.startLine}`;
  functions.sort((a, b) => a.startLine - b.startLine || a.id.localeCompare(b.id));
  return {
    imports: Array.from(imports, ([specifier, dynamic]) => ({ specifier, dynamic })),
    functions,
    parser: 'typescript',
  };
}

function parse(relPath, source, ctx) {
  const isTs = /\.tsx?$/i.test(relPath);
  if (!isTs) {
    let ast;
    try { ast = parseAcorn(source); }
    catch (_e) { return { imports: parseImports(source), functions: null, parser: 'regex' }; }
    return { imports: importsFromAst(ast), functions: functionsFromAst(ast, relPath), parser: 'acorn' };
  }
  const ts = (ctx && ctx.loadTs ? ctx.loadTs : loadTs)(ctx.root);
  if (!ts) return { imports: parseImports(source), functions: null, parser: 'regex' };
  try { return parseTs(ts, relPath, source); }
  catch (_e) { return { imports: parseImports(source), functions: null, parser: 'regex' }; }
}

const FN_TYPES = new Set(['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression']);

const DECISION_TYPES = new Set([
  'IfStatement', 'ConditionalExpression', 'ForStatement', 'ForInStatement',
  'ForOfStatement', 'WhileStatement', 'DoWhileStatement', 'CatchClause',
]);

function isDecision(n) {
  if (DECISION_TYPES.has(n.type)) return true;
  if (n.type === 'SwitchCase') return n.test != null; // `default:` doesn't count
  if (n.type === 'LogicalExpression') return n.operator === '&&' || n.operator === '||' || n.operator === '??';
  return false;
}

/** Infer a display name for a function node from its enclosing context. */
function fnName(node, parents) {
  if (node.id && node.id.name) return node.id.name;
  const p = parents[parents.length - 1];
  if (!p) return '<anonymous>';
  if (p.type === 'VariableDeclarator' && p.id.type === 'Identifier') return p.id.name;
  if (p.type === 'AssignmentExpression' && p.left.type === 'Identifier') return p.left.name;
  if (p.type === 'AssignmentExpression' && p.left.type === 'MemberExpression' &&
      p.left.property.type === 'Identifier') return p.left.property.name;
  if ((p.type === 'Property' || p.type === 'MethodDefinition' || p.type === 'PropertyDefinition') && p.key) {
    if (p.key.type === 'Identifier') return p.key.name;
    if (p.key.type === 'Literal') return String(p.key.value);
  }
  return '<anonymous>';
}

function functionsFromAst(ast, relPath) {
  const records = new Map(); // fn node -> record
  walk(ast, (n, parents) => {
    if (FN_TYPES.has(n.type)) {
      records.set(n, {
        id: null,
        name: fnName(n, parents),
        startLine: n.loc.start.line,
        endLine: n.loc.end.line,
        cc: 1,
      });
    } else if (isDecision(n)) {
      // Attribute to the nearest enclosing function; top-level decisions are ignored.
      for (let i = parents.length - 1; i >= 0; i--) {
        if (FN_TYPES.has(parents[i].type)) { records.get(parents[i]).cc++; break; }
      }
    }
  }, []);
  const out = Array.from(records.values());
  for (const f of out) f.id = `${relPath}#${f.name}@${f.startLine}`;
  out.sort((a, b) => a.startLine - b.startLine || a.id.localeCompare(b.id));
  return out;
}

module.exports = { parse, walk, parseAcorn, loadTs };
