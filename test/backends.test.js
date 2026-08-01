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
