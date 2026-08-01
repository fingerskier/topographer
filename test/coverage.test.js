'use strict';
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
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
