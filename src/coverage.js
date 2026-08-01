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

function loadLcov(text, root) {
  const out = new Map();
  let fc = null;
  let sawRecord = false;
  for (const raw of text.split(/\r?\n/)) {
    const lineStr = raw.trim();
    if (lineStr.startsWith('SF:')) {
      fc = emptyFileCov();
      out.set(toPosixRel(lineStr.slice(3), root), fc);
      sawRecord = true;
    } else if (fc && lineStr.startsWith('DA:')) {
      const [ln, hits] = lineStr.slice(3).split(',').map(Number);
      fc.lines.set(ln, Math.max(fc.lines.get(ln) || 0, hits));
    } else if (fc && lineStr.startsWith('BRDA:')) {
      const parts = lineStr.slice(5).split(',');
      const ln = Number(parts[0]);
      const taken = parts[3] === '-' ? 0 : Number(parts[3]);
      const cur = fc.branchesByLine.get(ln) || { taken: 0, total: 0 };
      cur.total++;
      if (taken > 0) cur.taken++;
      fc.branchesByLine.set(ln, cur);
    } else if (lineStr === 'end_of_record') {
      fc = null;
    }
  }
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
