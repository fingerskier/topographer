'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const BIN = path.join(__dirname, '..', 'bin', 'topographer.js');

function tmpRepo(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'topo-cli-'));
  for (const [rel, content] of Object.entries(files)) {
    const p = path.join(dir, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, content);
  }
  return dir;
}

function runCli(args, cwd) {
  return spawnSync(process.execPath, [BIN, ...args], { cwd, encoding: 'utf8' });
}

test('CLI scores CRAP by default', () => {
  const dir = tmpRepo({ 'a.js': 'function f(x) { return x ? 1 : 2; }\nmodule.exports = f;\n' });
  const res = runCli([dir], dir);
  assert.strictEqual(res.status, 0, res.stderr);
  assert.match(res.stdout, /CRAP:/);
  assert.ok(fs.existsSync(path.join(dir, '.crap', 'dataset.jsonl')));
});

test('CLI --no-crap skips CRAP', () => {
  const dir = tmpRepo({ 'a.js': 'function f(x) { return x ? 1 : 2; }\nmodule.exports = f;\n' });
  const res = runCli(['--no-crap', dir], dir);
  assert.strictEqual(res.status, 0, res.stderr);
  assert.ok(!/CRAP:/.test(res.stdout));
  assert.ok(!fs.existsSync(path.join(dir, '.crap')));
});

test('CLI warns on zero coverage-path matches', () => {
  const dir = tmpRepo({
    'src/a.ts': 'export function f(x: number) { return x ? 1 : 2; }\n',
    'coverage/lcov.info': ['SF:src/a.js', 'DA:1,1', 'end_of_record', ''].join('\n'),
  });
  const res = runCli([dir], dir);
  assert.strictEqual(res.status, 0, res.stderr);
  assert.match(res.stderr, /matched 0/i);
});
