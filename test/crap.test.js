'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { crapScore, thresholdCoverage, isTestFile, buildDataset, buildAnnotations } = require('../src/crap.js');

test('crap math', () => {
  assert.strictEqual(crapScore(5, 0), 30);        // 25*1 + 5
  assert.strictEqual(crapScore(5, 1), 5);         // fully covered => cc
  assert.ok(Math.abs(crapScore(10, 0.5) - 22.5) < 1e-9); // 100*0.125 + 10
});

test('thresholdCoverage', () => {
  assert.strictEqual(thresholdCoverage(31), null);            // refactor_only
  assert.strictEqual(thresholdCoverage(2), 0);                // 4+2=6 ≤ 30 uncovered
  assert.ok(Math.abs(thresholdCoverage(30) - 1) < 1e-9);      // needs 100%
  const t = thresholdCoverage(10);                            // 100(1-c)^3+10 ≤ 30 => c ≥ 1-cbrt(0.2)
  assert.ok(Math.abs(t - (1 - Math.cbrt(0.2))) < 1e-9);
});

test('isTestFile', () => {
  assert.ok(isTestFile('src/a.test.js'));
  assert.ok(isTestFile('src/a.spec.tsx'));
  assert.ok(isTestFile('test/graph.test.js'));
  assert.ok(isTestFile('src/__tests__/a.js'));
  assert.ok(!isTestFile('src/attest.js'));
});

test('buildDataset: matching, flags, sort, nulls', () => {
  const functionsByFile = new Map([
    ['src/a.js', [
      { id: 'src/a.js#hot@1', name: 'hot', startLine: 1, endLine: 5, cc: 8 },
      { id: 'src/a.js#big@10', name: 'big', startLine: 10, endLine: 40, cc: 31 },
      { id: 'src/a.js#nocov@50', name: 'nocov', startLine: 50, endLine: 60, cc: 2 },
    ]],
    ['test/a.test.js', [{ id: 'test/a.test.js#t@1', name: 't', startLine: 1, endLine: 3, cc: 1 }]],
    ['src/broken.js', null], // regex fallback file
  ]);
  const fc = { lines: new Map([[2, 0], [3, 0], [12, 1]]), branchesByLine: new Map() };
  const coverage = new Map([['src/a.js', fc]]);
  const records = buildDataset({ functionsByFile, coverage });

  const by = Object.fromEntries(records.map((r) => [r.name, r]));
  // hot: statements 2,3 in span, 0 hit => cov 0 => crap 8²+8 = 72
  assert.strictEqual(by.hot.crap, 72);
  assert.deepStrictEqual(by.hot.coverage, { kind: 'statement', value: 0 });
  assert.ok(by.hot.flags.includes('above_threshold'));
  // big: cc 31 => refactor_only, threshold_coverage null
  assert.ok(by.big.flags.includes('refactor_only'));
  assert.strictEqual(by.big.threshold_coverage, null);
  // nocov: span 50-60 has no statements => null crap, no_coverage_data — NOT 0%
  assert.strictEqual(by.nocov.crap, null);
  assert.strictEqual(by.nocov.coverage, null);
  assert.ok(by.nocov.flags.includes('no_coverage_data'));
  // test file flagged
  assert.ok(by.t.flags.includes('test_file'));
  // sort: crap desc, nulls last
  const craps = records.map((r) => r.crap);
  const nonNull = craps.filter((c) => c !== null);
  assert.deepStrictEqual(nonNull, [...nonNull].sort((a, b) => b - a));
  assert.ok(craps.indexOf(null) === -1 || craps.indexOf(null) >= nonNull.length);
});

test('buildDataset with no coverage at all: everything null + flagged', () => {
  const functionsByFile = new Map([['src/a.js', [{ id: 'src/a.js#f@1', name: 'f', startLine: 1, endLine: 2, cc: 3 }]]]);
  const records = buildDataset({ functionsByFile, coverage: null });
  assert.strictEqual(records[0].crap, null);
  assert.ok(records[0].flags.includes('no_coverage_data'));
});

test('buildAnnotations: max + count, never mean; test files excluded', () => {
  const records = [
    { id: 'a#x@1', file: 'src/a.js', name: 'x', cc: 8, crap: 72, coverage: { kind: 'statement', value: 0 }, threshold_coverage: 0.9, flags: ['above_threshold'], lines: [1, 5] },
    { id: 'a#y@9', file: 'src/a.js', name: 'y', cc: 2, crap: 6, coverage: { kind: 'min', value: 0 }, threshold_coverage: 0, flags: [], lines: [9, 12] },
    { id: 't#t@1', file: 'test/a.test.js', name: 't', cc: 1, crap: 2, coverage: { kind: 'statement', value: 0 }, threshold_coverage: 0, flags: ['test_file'], lines: [1, 3] },
  ];
  const ann = buildAnnotations(records);
  assert.deepStrictEqual(ann['src/a.js'], { maxCrap: 72, aboveThresholdCount: 1, coverageKind: 'mixed' });
  assert.ok(!('test/a.test.js' in ann));
});
