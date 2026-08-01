'use strict';
const fs = require('fs');
const path = require('path');

function toPosixRel(p, root) {
  const abs = path.isAbsolute(p) ? p : path.join(root, p);
  const rel = path.relative(root, abs);
  return rel.split(path.sep).join('/');
}

function emptyFileCov() {
  return { lines: new Map(), branchesByLine: new Map() };
}

function loadIstanbul(json, root) {
  const out = new Map();
  for (const key of Object.keys(json)) {
    const entry = json[key];
    if (!entry || typeof entry !== 'object' || !entry.statementMap || !entry.s) return null;
    const fc = emptyFileCov();
    for (const id of Object.keys(entry.statementMap)) {
      const line = entry.statementMap[id].start.line;
      const hits = entry.s[id] || 0;
      fc.lines.set(line, Math.max(fc.lines.get(line) || 0, hits));
    }
    if (entry.branchMap && entry.b) {
      for (const id of Object.keys(entry.branchMap)) {
        const locs = entry.branchMap[id].locations || [];
        const counts = entry.b[id] || [];
        for (let i = 0; i < locs.length; i++) {
          const line = (locs[i].start || {}).line;
          if (!line) continue;
          const cur = fc.branchesByLine.get(line) || { taken: 0, total: 0 };
          cur.total++;
          if ((counts[i] || 0) > 0) cur.taken++;
          fc.branchesByLine.set(line, cur);
        }
      }
    }
    out.set(toPosixRel(entry.path || key, root), fc);
  }
  return out;
}

/**
 * Merge one lcov SF-block's coverage into an accumulator FileCov: line hits
 * take the max per line (matches the intra-block DA semantics), and branch
 * counts take the max of `total`/`taken` per line rather than adding —
 * repeated blocks for the same file (e.g. concatenated multi-suite lcov
 * output) describe the *same* branches, so summing would overcount.
 */
function mergeFileCov(target, block) {
  for (const [ln, hits] of block.lines) {
    target.lines.set(ln, Math.max(target.lines.get(ln) || 0, hits));
  }
  for (const [ln, br] of block.branchesByLine) {
    const cur = target.branchesByLine.get(ln) || { taken: 0, total: 0 };
    cur.total = Math.max(cur.total, br.total);
    cur.taken = Math.max(cur.taken, br.taken);
    target.branchesByLine.set(ln, cur);
  }
}

function loadLcov(text, root) {
  const out = new Map();
  let block = null; // fresh per-SF-block accumulator; merged into `out` at end_of_record
  let key = null;
  let sawRecord = false;
  const flush = () => {
    if (block && key) {
      const existing = out.get(key) || emptyFileCov();
      mergeFileCov(existing, block);
      out.set(key, existing);
    }
    block = null;
    key = null;
  };
  for (const raw of text.split(/\r?\n/)) {
    const lineStr = raw.trim();
    if (lineStr.startsWith('SF:')) {
      flush(); // tolerate a missing end_of_record before the next SF:
      block = emptyFileCov();
      key = toPosixRel(lineStr.slice(3), root);
      sawRecord = true;
    } else if (block && lineStr.startsWith('DA:')) {
      const [ln, hits] = lineStr.slice(3).split(',').map(Number);
      block.lines.set(ln, Math.max(block.lines.get(ln) || 0, hits));
    } else if (block && lineStr.startsWith('BRDA:')) {
      const parts = lineStr.slice(5).split(',');
      const ln = Number(parts[0]);
      const taken = parts[3] === '-' ? 0 : Number(parts[3]);
      const cur = block.branchesByLine.get(ln) || { taken: 0, total: 0 };
      cur.total++;
      if (taken > 0) cur.taken++;
      block.branchesByLine.set(ln, cur);
    } else if (lineStr === 'end_of_record') {
      flush();
    }
  }
  flush(); // tolerate a missing trailing end_of_record
  return sawRecord ? out : null;
}

function loadCoverage(covPath, root) {
  const text = fs.readFileSync(covPath, 'utf8');
  let result = null;
  if (text.trimStart().startsWith('{')) {
    try { result = loadIstanbul(JSON.parse(text), root); } catch (_e) { result = null; }
  } else if (/^(TN:|SF:)/m.test(text)) {
    result = loadLcov(text, root);
  }
  if (!result) {
    throw new Error(
      `unrecognized coverage format: ${covPath} (expected Istanbul coverage-final.json or LCOV lcov.info)`
    );
  }
  return result;
}

function coverageForSpan(fileCov, startLine, endLine) {
  let stmtTotal = 0, stmtHit = 0, brTotal = 0, brTaken = 0;
  for (const [line, hits] of fileCov.lines) {
    if (line < startLine || line > endLine) continue;
    stmtTotal++;
    if (hits > 0) stmtHit++;
  }
  for (const [line, br] of fileCov.branchesByLine) {
    if (line < startLine || line > endLine) continue;
    brTotal += br.total;
    brTaken += br.taken;
  }
  if (stmtTotal === 0) return null; // no data for this span — caller must not treat as 0%
  const stmt = stmtHit / stmtTotal;
  if (brTotal === 0) return { kind: 'statement', value: stmt };
  return { kind: 'min', value: Math.min(stmt, brTaken / brTotal) };
}

module.exports = { loadCoverage, coverageForSpan, toPosixRel };
