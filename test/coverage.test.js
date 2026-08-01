'use strict';
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { loadCoverage, coverageForSpan } = require('../src/coverage.js');

const FIX = path.join(__dirname, 'fixtures');

for (const file of ['coverage-final.json', 'lcov.info']) {
  test(`${file}: loads and computes span coverage`, () => {
    const cov = loadCoverage(path.join(FIX, file), '/repo');
    const fc = cov.get('src/a.js');
    assert.ok(fc, 'file entry found under normalized posix path');
    // span lines 1-5: statements at 2 (hit) and 3 (miss) => 50%; branch at 2: 1/2 => 50%; min = 0.5
    assert.deepStrictEqual(coverageForSpan(fc, 1, 5), { kind: 'min', value: 0.5 });
    // span lines 6-9: statement at 8 (hit), no branches => statement-only
    assert.deepStrictEqual(coverageForSpan(fc, 6, 9), { kind: 'statement', value: 1 });
    // span with no statements at all => null (no data), NOT 0
    assert.strictEqual(coverageForSpan(fc, 20, 30), null);
  });
}

test('malformed file throws with format hint', () => {
  assert.throws(
    () => loadCoverage(path.join(FIX, '..', 'graph.test.js'), '/repo'),
    /unrecognized coverage format/
  );
});

test('lcov: repeated SF: blocks for the same file merge instead of clobbering', () => {
  const lcov = [
    'SF:src/a.js',
    'DA:2,0',
    'DA:8,1', // present only in the first block — must survive the merge
    'BRDA:2,0,0,5',
    'BRDA:2,0,1,0', // block-1 branch: total 2, taken 1
    'end_of_record',
    'SF:src/a.js',
    'DA:2,3',
    'DA:5,1',
    'BRDA:2,0,0,3',
    'BRDA:2,0,1,4',
    'BRDA:2,0,2,1', // block-2 branch: total 3, taken 3
    'end_of_record',
    '',
  ].join('\n');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'topo-lcov-'));
  const file = path.join(dir, 'lcov.info');
  fs.writeFileSync(file, lcov);
  const cov = loadCoverage(file, '/repo');
  const fc = cov.get('src/a.js');
  assert.ok(fc, 'file entry found');
  // line-hit merge: max per line, both blocks' data preserved.
  assert.strictEqual(fc.lines.get(2), 3);
  assert.strictEqual(fc.lines.get(5), 1);
  assert.strictEqual(fc.lines.get(8), 1); // would be lost if the second SF: clobbered the first block
  // branch merge: max(total) / max(taken) per line, not additive across blocks.
  assert.deepStrictEqual(fc.branchesByLine.get(2), { taken: 3, total: 3 });
});
