'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const { parseImports, stripComments } = require('../src/parse.js');
const { resolveImport, isLocalSpecifier } = require('../src/resolve.js');
const { buildGraph } = require('../src/index.js');
const { renderHtml } = require('../src/render.js');

function tmpdir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'treasure-map-test-'));
}

function write(root, rel, content) {
  const full = path.join(root, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
}

test('parseImports covers static, dynamic, require, and re-export', () => {
  const src = `
    import a from './a.js';
    import { b } from "./b";
    import './side-effect';
    export { c } from './c';
    const d = require('./d');
    const e = await import('./e');
    import x from 'react';           // 3rd-party, still captured here
  `;
  const imports = parseImports(src);
  const byspec = Object.fromEntries(imports.map((i) => [i.specifier, i.dynamic]));

  assert.strictEqual(byspec['./a.js'], false);
  assert.strictEqual(byspec['./b'], false);
  assert.strictEqual(byspec['./side-effect'], false);
  assert.strictEqual(byspec['./c'], false);
  assert.strictEqual(byspec['./d'], false);
  assert.strictEqual(byspec['./e'], true, 'import() is dynamic');
  assert.strictEqual(byspec['react'], false);
});

test('parseImports ignores commented-out imports', () => {
  const src = `
    // import ghost from './ghost';
    /* import spectre from './spectre'; */
    import real from './real';
    const s = "import fake from './fake'"; // inside a string -> still matched, acceptable
  `;
  const specs = parseImports(src).map((i) => i.specifier);
  assert.ok(specs.includes('./real'));
  assert.ok(!specs.includes('./ghost'));
  assert.ok(!specs.includes('./spectre'));
});

test('static import wins over dynamic for the same specifier', () => {
  const src = `import a from './a'; const lazy = () => import('./a');`;
  const imports = parseImports(src);
  const a = imports.find((i) => i.specifier === './a');
  assert.strictEqual(a.dynamic, false);
});

test('stripComments preserves string contents', () => {
  const out = stripComments(`const u = "http://x"; // trailing`);
  assert.ok(out.includes('http://x'));
  assert.ok(!out.includes('trailing'));
});

test('isLocalSpecifier distinguishes local from 3rd-party', () => {
  assert.ok(isLocalSpecifier('./x'));
  assert.ok(isLocalSpecifier('../x'));
  assert.ok(isLocalSpecifier('/abs'));
  assert.ok(!isLocalSpecifier('react'));
  assert.ok(!isLocalSpecifier('@scope/pkg'));
});

test('resolveImport handles extensions and index files', () => {
  const files = new Set(['src/a.js', 'src/util/index.js', 'src/b.ts']);
  assert.strictEqual(resolveImport('src/a.js', './util', files), 'src/util/index.js');
  assert.strictEqual(resolveImport('src/a.js', './b', files), 'src/b.ts');
  assert.strictEqual(resolveImport('src/util/index.js', '../a', files), 'src/a.js');
  assert.strictEqual(resolveImport('src/a.js', './missing', files), null);
  assert.strictEqual(resolveImport('src/a.js', 'react', files), null); // handled by caller normally
});

test('buildGraph builds nodes and edges, excluding 3rd-party', () => {
  const root = tmpdir();
  write(root, 'index.js', `import a from './a'; import b from './lib/b'; import 'react';`);
  write(root, 'a.js', `const lazy = () => import('./lib/b');`);
  write(root, 'lib/b.js', `module.exports = 1;`);
  write(root, 'node_modules/react/index.js', `module.exports = {};`); // must be ignored

  const graph = buildGraph(root);
  const ids = graph.nodes.map((n) => n.id).sort();
  assert.deepStrictEqual(ids, ['a.js', 'index.js', 'lib/b.js']);

  // index -> a (static), index -> lib/b (static), a -> lib/b (dynamic)
  const edges = graph.links.map((l) => ({
    from: graph.nodes[l.source].id,
    to: graph.nodes[l.target].id,
    dynamic: l.dynamic,
  }));
  assert.strictEqual(edges.length, 3);
  const ab = edges.find((e) => e.from === 'a.js' && e.to === 'lib/b.js');
  assert.strictEqual(ab.dynamic, true);
  const ib = edges.find((e) => e.from === 'index.js' && e.to === 'lib/b.js');
  assert.strictEqual(ib.dynamic, false);

  fs.rmSync(root, { recursive: true, force: true });
});

test('non-git repo marks everything as added', () => {
  const root = tmpdir();
  write(root, 'a.js', `import b from './b';`);
  write(root, 'b.js', `export default 1;`);

  const graph = buildGraph(root);
  assert.strictEqual(graph.git, false);
  assert.ok(graph.nodes.every((n) => n.status === 'added'));

  fs.rmSync(root, { recursive: true, force: true });
});

test('git status colors nodes: modified, added, deleted', () => {
  const root = tmpdir();
  const git = (args) => execFileSync('git', args, { cwd: root, stdio: 'ignore' });
  git(['init', '-q']);
  git(['config', 'user.email', 't@t']);
  git(['config', 'user.name', 't']);

  write(root, 'kept.js', `import x from './changed';`);
  write(root, 'changed.js', `export default 1;`);
  write(root, 'gone.js', `export default 2;`);
  git(['add', '-A']);
  git(['commit', '-qm', 'init']);

  // Now: modify changed.js, add fresh.js, delete gone.js.
  write(root, 'changed.js', `export default 42; // modified`);
  write(root, 'fresh.js', `export default 3;`);
  fs.rmSync(path.join(root, 'gone.js'));

  const graph = buildGraph(root);
  const status = Object.fromEntries(graph.nodes.map((n) => [n.id, n.status]));

  assert.strictEqual(graph.git, true);
  assert.strictEqual(status['changed.js'], 'modified');
  assert.strictEqual(status['fresh.js'], 'added');
  assert.strictEqual(status['gone.js'], 'deleted');
  assert.strictEqual(status['kept.js'], 'unchanged');

  fs.rmSync(root, { recursive: true, force: true });
});

test('renderHtml produces a self-contained document with the data inlined', () => {
  const graph = {
    nodes: [{ id: 'a.js', label: 'a.js', dir: '', status: 'added' }],
    links: [],
    git: false,
    root: 'demo',
  };
  const html = renderHtml(graph);
  assert.ok(html.startsWith('<!doctype html>'));
  assert.ok(html.includes('const GRAPH ='));
  assert.ok(html.includes('a.js'));
  // No external resource references.
  assert.ok(!/src=["']http/.test(html));
  assert.ok(!/href=["']http/.test(html));
});
