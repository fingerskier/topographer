'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { backendFor } = require('../src/backends/index.js');

test('backendFor routes known extensions', () => {
  assert.ok(backendFor('a.js'));
  assert.ok(backendFor('a.tsx'));
  assert.strictEqual(backendFor('a.py'), null);
});

test('acorn backend extracts static and dynamic imports', () => {
  const src = `
    import x from './x.js';
    export { y } from './y.js';
    import './side.js';
    const z = require('./z.js');
    async function go() { await import('./dyn.js'); }
  `;
  const out = backendFor('a.js').parse('a.js', src, { root: '.' });
  assert.strictEqual(out.parser, 'acorn');
  const bySpec = Object.fromEntries(out.imports.map((i) => [i.specifier, i.dynamic]));
  assert.deepStrictEqual(bySpec, {
    './x.js': false, './y.js': false, './side.js': false, './z.js': false, './dyn.js': true,
  });
});

test('static import beats dynamic for same specifier', () => {
  const src = `import a from './a.js'; import('./a.js');`;
  const out = backendFor('a.js').parse('a.js', src, { root: '.' });
  assert.deepStrictEqual(out.imports, [{ specifier: './a.js', dynamic: false }]);
});

test('unparseable file falls back to regex with null functions', () => {
  const out = backendFor('a.js').parse('a.js', 'import x from ./broken', { root: '.' });
  assert.strictEqual(out.parser, 'regex');
  assert.strictEqual(out.functions, null);
});

test('JSX parses via acorn-jsx', () => {
  const src = `import R from './r.jsx'; export const C = () => <div a={1}/>;`;
  const out = backendFor('a.jsx').parse('a.jsx', src, { root: '.' });
  assert.strictEqual(out.parser, 'acorn');
  assert.strictEqual(out.imports[0].specifier, './r.jsx');
});

test('function discovery: names, spans, cc', () => {
  const src = [
    'function plain(a) {',            // line 1
    '  if (a) return 1;',             // +1
    '  return a ? 2 : 3;',            // +1  => cc 3
    '}',
    'const arrow = (x) => x && x.y;', // +1  => cc 2, name "arrow"
    'class K {',
    '  m(v) {',                        // line 7
    '    switch (v) { case 1: case 2: return; default: return; }', // +2 => cc 3
    '  }',
    '}',
  ].join('\n');
  const out = backendFor('a.js').parse('a.js', src, { root: '.' });
  const by = Object.fromEntries(out.functions.map((f) => [f.name, f]));
  assert.strictEqual(by.plain.cc, 3);
  assert.strictEqual(by.plain.startLine, 1);
  assert.strictEqual(by.plain.endLine, 4);
  assert.strictEqual(by.plain.id, 'a.js#plain@1');
  assert.strictEqual(by.arrow.cc, 2);
  assert.strictEqual(by.m.cc, 3);
});

test('nested functions counted separately, not into parent', () => {
  const src = [
    'function outer() {',
    '  if (1) {}',                      // outer +1 => cc 2
    '  function inner() { while (1) {} }', // inner +1 => cc 2
    '}',
  ].join('\n');
  const out = backendFor('a.js').parse('a.js', src, { root: '.' });
  const by = Object.fromEntries(out.functions.map((f) => [f.name, f]));
  assert.strictEqual(by.outer.cc, 2);
  assert.strictEqual(by.inner.cc, 2);
});

test('loops, catch, nullish all count; anonymous gets placeholder name', () => {
  const src = `module.exports = function () {
    for (const x of []) {}
    try {} catch (e) {}
    return a ?? b;
  };`;
  const out = backendFor('a.js').parse('a.js', src, { root: '.' });
  assert.strictEqual(out.functions.length, 1);
  assert.strictEqual(out.functions[0].cc, 4); // base + for-of + catch + ??
  assert.ok(out.functions[0].name.length > 0);
});

const path = require('node:path');

test('typescript backend parses .ts: imports + functions + cc', () => {
  const src = [
    "import { a } from './a.ts';",
    'export function f(x: number): number {',
    '  if (x > 0) return x;',
    '  return x < 0 ? -x : 0;',
    '}',
  ].join('\n');
  // This repo's own root has typescript (devDependency), so loadTs resolves here.
  const out = require('../src/backends/index.js').backendFor('a.ts')
    .parse('a.ts', src, { root: path.join(__dirname, '..') });
  assert.strictEqual(out.parser, 'typescript');
  assert.strictEqual(out.imports[0].specifier, './a.ts');
  assert.strictEqual(out.functions.length, 1);
  assert.strictEqual(out.functions[0].name, 'f');
  assert.strictEqual(out.functions[0].cc, 3); // base + if + ternary
});

test('missing typescript => regex fallback, null functions', () => {
  const out = require('../src/backends/index.js').backendFor('a.ts')
    .parse('a.ts', "import { a } from './a';", { root: 'C:/definitely/no/ts/here' });
  assert.strictEqual(out.parser, 'regex');
  assert.strictEqual(out.functions, null);
  assert.strictEqual(out.imports[0].specifier, './a');
});

test('acorn backend: same-line anonymous functions get disambiguated ids', () => {
  const src = 'xs.map(x => x ? 1 : 0).filter(x => x && x.y);';
  const out = backendFor('a.js').parse('a.js', src, { root: '.' });
  assert.strictEqual(out.functions.length, 2);
  const ids = out.functions.map((f) => f.id).sort();
  assert.deepStrictEqual(ids, ['a.js#<anonymous>@1', 'a.js#<anonymous>@1~2']);
});

test('typescript backend: same-line anonymous functions get disambiguated ids', () => {
  const src = 'xs.map(x => x ? 1 : 0).filter(x => x && x.y);';
  const out = require('../src/backends/index.js').backendFor('a.ts')
    .parse('a.ts', src, { root: path.join(__dirname, '..') });
  assert.strictEqual(out.functions.length, 2);
  const ids = out.functions.map((f) => f.id).sort();
  assert.deepStrictEqual(ids, ['a.ts#<anonymous>@1', 'a.ts#<anonymous>@1~2']);
});
