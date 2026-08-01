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

function functionsFromAst(_ast, _relPath) { return []; } // Task 2 implements

module.exports = { parse, walk, parseAcorn };
