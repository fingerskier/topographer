'use strict';
const acorn = require('acorn');
const jsx = require('acorn-jsx');
const { parseImports } = require('../parse.js');

const JsxParser = acorn.Parser.extend(jsx());

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

function parse(relPath, source, ctx) {
  const isTs = /\.tsx?$/i.test(relPath);
  if (!isTs) {
    let ast;
    try { ast = parseAcorn(source); }
    catch (_e) { return { imports: parseImports(source), functions: null, parser: 'regex' }; }
    return { imports: importsFromAst(ast), functions: functionsFromAst(ast, relPath), parser: 'acorn' };
  }
  return { imports: parseImports(source), functions: null, parser: 'regex' }; // Task 3 replaces this
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

module.exports = { parse, walk, parseAcorn };
