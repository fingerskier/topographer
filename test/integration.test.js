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

test('--crap end-to-end: dataset.jsonl + annotations, deterministic', () => {
  const dir = tmpRepo({
    'src/a.js': [
      'function hot(x) {',
      '  if (x) return 1;',
      '  if (!x) return 2;',
      '  return x && 3;',
      '}',
      'module.exports = hot;',
    ].join('\n'),
    'coverage/lcov.info': ['SF:src/a.js', 'DA:2,0', 'DA:3,0', 'DA:4,0', 'end_of_record', ''].join('\n'),
  });
  const out = path.join(dir, 'map.html');
  const r1 = run({ root: dir, outPath: out, crap: true, coveragePath: null });
  const jsonl = fs.readFileSync(path.join(dir, '.crap', 'dataset.jsonl'), 'utf8');
  const records = jsonl.trim().split('\n').map(JSON.parse);
  assert.strictEqual(records.length, 1);
  assert.strictEqual(records[0].cc, 4);          // base + if + if + &&
  assert.strictEqual(records[0].crap, 20);       // 16*1 + 4
  assert.strictEqual(records[0].coverage.value, 0);
  const topo = JSON.parse(fs.readFileSync(path.join(dir, 'topo.json'), 'utf8'));
  assert.strictEqual(topo.annotations['src/a.js'].maxCrap, 20);
  // determinism: run again, byte-identical outputs
  const jsonl2 = (run({ root: dir, outPath: out, crap: true, coveragePath: null }),
                  fs.readFileSync(path.join(dir, '.crap', 'dataset.jsonl'), 'utf8'));
  assert.strictEqual(jsonl, jsonl2);
  assert.ok(r1.stats.crap.coverageFile.endsWith('lcov.info'));
});

test('--crap with no coverage anywhere: nulls, not zeros', () => {
  const dir = tmpRepo({ 'a.js': 'function f(x) { return x ? 1 : 2; }\n' });
  run({ root: dir, outPath: path.join(dir, 'map.html'), crap: true, coveragePath: null });
  const records = fs.readFileSync(path.join(dir, '.crap', 'dataset.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
  assert.strictEqual(records[0].crap, null);
  assert.ok(records[0].flags.includes('no_coverage_data'));
});

test('explicit bad --coverage path throws with hint', () => {
  const dir = tmpRepo({ 'a.js': '', 'junk.txt': 'not coverage' });
  assert.throws(
    () => run({ root: dir, outPath: path.join(dir, 'map.html'), crap: true, coveragePath: path.join(dir, 'junk.txt') }),
    /unrecognized coverage format/
  );
});

test('map.html embeds annotations and risk toggle only when --crap', () => {
  const dir = tmpRepo({
    'src/a.js': 'function f(x) { return x ? 1 : 2; }\nmodule.exports = f;\n',
    'coverage/lcov.info': ['SF:src/a.js', 'DA:1,1', 'end_of_record', ''].join('\n'),
  });
  const out = path.join(dir, 'map.html');
  run({ root: dir, outPath: out, crap: true, coveragePath: null });
  const html = fs.readFileSync(out, 'utf8');
  assert.ok(html.includes('var ANNOTATIONS'));
  assert.ok(html.includes('riskToggle'));
  assert.ok(html.includes('class="halo"') || html.includes("'halo'") || html.includes('"halo"'));

  run({ root: dir, outPath: out }); // without crap
  const plain = fs.readFileSync(out, 'utf8');
  assert.ok(!plain.includes('riskToggle'));
});
