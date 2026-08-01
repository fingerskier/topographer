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
