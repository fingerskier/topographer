'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { run, buildGraph } = require('../src/index.js');

function tmpRepo(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'topo-'));
  for (const [rel, content] of Object.entries(files)) {
    const p = path.join(dir, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, content);
  }
  return dir;
}

test('buildGraph uses AST imports and records functions + manifest', () => {
  const dir = tmpRepo({
    'a.js': "const b = require('./b.js');\nfunction f(x) { return x ? 1 : 2; }\n",
    'b.js': 'module.exports = 1;\n',
    'broken.js': 'import x from ./nope\n',
  });
  const g = buildGraph(dir);
  assert.strictEqual(g.links.length, 1); // a -> b
  assert.strictEqual(g.functionsByFile.get('a.js').length, 1);
  assert.strictEqual(g.functionsByFile.get('a.js')[0].cc, 2);
  assert.strictEqual(g.functionsByFile.get('broken.js'), null);
  assert.deepStrictEqual(g.manifest.regexFallback, ['broken.js']);
  assert.strictEqual(g.manifest.astParsed, 2);
});

test('run writes topo.json next to map.html', () => {
  const dir = tmpRepo({ 'a.js': "require('./b.js');\n", 'b.js': '' });
  const out = path.join(dir, 'map.html');
  run({ root: dir, outPath: out });
  const topo = JSON.parse(fs.readFileSync(path.join(dir, 'topo.json'), 'utf8'));
  assert.strictEqual(topo.nodes.length, 2);
  assert.strictEqual(topo.links.length, 1);
  assert.ok(topo.manifest);
  assert.ok(!('functionsByFile' in topo)); // internal Map, not serialized
});
