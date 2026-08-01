'use strict';
const { coverageForSpan } = require('./coverage.js');

const DEFAULT_THRESHOLD = 30;
const REFACTOR_ONLY_CC = 31;

function crapScore(cc, cov) {
  return cc * cc * Math.pow(1 - cov, 3) + cc;
}

function thresholdCoverage(cc, threshold = DEFAULT_THRESHOLD) {
  if (cc >= REFACTOR_ONLY_CC) return null; // even 100% coverage leaves crap = cc > threshold
  if (crapScore(cc, 0) <= threshold) return 0;
  return Math.min(1, 1 - Math.cbrt((threshold - cc) / (cc * cc)));
}

function isTestFile(relPath) {
  if (/\.(test|spec)\.[cm]?[jt]sx?$/i.test(relPath)) return true;
  if (/(^|\/)__tests__\//.test(relPath)) return true;
  if (/^tests?\//.test(relPath)) return true;
  return false;
}

function buildDataset({ functionsByFile, coverage, threshold = DEFAULT_THRESHOLD }) {
  const records = [];
  for (const [file, functions] of functionsByFile) {
    if (!functions) continue; // regex-fallback file: no function data at all
    const fileCov = coverage ? coverage.get(file) : null;
    const testFile = isTestFile(file);
    for (const fn of functions) {
      const span = fileCov ? coverageForSpan(fileCov, fn.startLine, fn.endLine) : null;
      const flags = [];
      let crap = null;
      if (span) {
        crap = crapScore(fn.cc, span.value);
        if (crap > threshold) flags.push('above_threshold');
      } else {
        flags.push('no_coverage_data');
      }
      if (fn.cc >= REFACTOR_ONLY_CC) flags.push('refactor_only');
      if (testFile) flags.push('test_file');
      records.push({
        id: fn.id,
        file,
        lines: [fn.startLine, fn.endLine],
        name: fn.name,
        cc: fn.cc,
        coverage: span,
        crap,
        threshold_coverage: thresholdCoverage(fn.cc, threshold),
        flags,
      });
    }
  }
  records.sort((a, b) => {
    if (a.crap === null && b.crap === null) return a.id.localeCompare(b.id);
    if (a.crap === null) return 1;
    if (b.crap === null) return -1;
    return b.crap - a.crap || a.id.localeCompare(b.id);
  });
  return records;
}

function buildAnnotations(records) {
  const out = {};
  for (const r of records) {
    if (r.flags.includes('test_file')) continue; // excluded from roll-ups by default
    const a = out[r.file] || (out[r.file] = { maxCrap: null, aboveThresholdCount: 0, coverageKind: null });
    if (r.crap !== null) {
      // max, never mean — the non-linearity is the signal
      a.maxCrap = a.maxCrap === null ? r.crap : Math.max(a.maxCrap, r.crap);
      if (r.flags.includes('above_threshold')) a.aboveThresholdCount++;
      const kind = r.coverage.kind;
      a.coverageKind = a.coverageKind === null || a.coverageKind === kind ? kind : 'mixed';
    }
  }
  return out;
}

module.exports = { crapScore, thresholdCoverage, isTestFile, buildDataset, buildAnnotations, DEFAULT_THRESHOLD };
