#!/usr/bin/env node
'use strict';

const path = require('path');
const { run } = require('../src/index.js');

function parseArgs(argv) {
  const opts = { root: process.cwd(), out: null, crap: true };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case '-h':
      case '--help':
        opts.help = true;
        break;
      case '-v':
      case '--version':
        opts.version = true;
        break;
      case '-o':
      case '--out':
        opts.out = argv[++i];
        break;
      case '-r':
      case '--root':
        opts.root = argv[++i];
        break;
      case '--crap': // accepted for back-compat; CRAP is on by default
        opts.crap = true;
        break;
      case '--no-crap':
        opts.crap = false;
        break;
      case '--coverage':
        opts.coverage = argv[++i];
        break;
      default:
        // A bare argument is treated as the root directory.
        if (!arg.startsWith('-')) {
          opts.root = arg;
        } else {
          opts.unknown = arg;
        }
    }
  }
  return opts;
}

const HELP = `topographer — a collapsible dependency graph of a codebase.

Usage:
  npx topographer [options] [root]

Options:
  -o, --out <file>    Output HTML file (default: .topographer/map.html under
                      root; topo.json and crap.jsonl land beside it)
  -r, --root <dir>    Repo root to scan (default: current directory)
  --no-crap           Skip CRAP annotation (CC² × (1−cov)³ + CC; on by default)
  --coverage <file>   Coverage report (Istanbul coverage-final.json or LCOV);
                      default: auto-detect under coverage/
  -v, --version       Print version and exit
  -h, --help          Show this help

Node colors:  blue = unchanged  green = added  orange = modified  red = deleted
Edge style:   solid = static import  dashed = dynamic import
`;

function main() {
  const opts = parseArgs(process.argv.slice(2));

  if (opts.help) {
    process.stdout.write(HELP);
    return;
  }
  if (opts.version) {
    const pkg = require('../package.json');
    process.stdout.write(pkg.version + '\n');
    return;
  }
  if (opts.unknown) {
    process.stderr.write(`Unknown option: ${opts.unknown}\n\n` + HELP);
    process.exitCode = 1;
    return;
  }

  const root = path.resolve(opts.root);
  const outPath = opts.out
    ? (path.isAbsolute(opts.out) ? opts.out : path.join(root, opts.out))
    : null; // run() defaults to <root>/.topographer/map.html

  try {
    const { written, stats } = run({
      root,
      outPath,
      crap: !!opts.crap,
      coveragePath: opts.coverage ? path.resolve(opts.coverage) : null,
    });
    if (stats.crap && stats.crap.warning) {
      process.stderr.write(`topographer: warning: ${stats.crap.warning}\n`);
    }
    const rel = (p) => path.relative(process.cwd(), p) || p;
    process.stdout.write(
      `topographer: wrote\n` +
        written.map((p) => `  ${rel(p)}\n`).join('') +
        `  ${stats.nodes} files, ${stats.edges} dependencies` +
        (stats.git ? ` (git repo)` : ` (not a git repo — everything treated as this commit)`) +
        `\n` +
        (stats.crap ? `  CRAP: ${stats.crap.scored}/${stats.crap.functions} functions scored, ` +
          `${stats.crap.aboveThreshold} above threshold` +
          (stats.crap.coverageFile ? `` : ` (no coverage data found)`) + `\n` : ``)
    );
  } catch (err) {
    process.stderr.write(`topographer: ${err && err.message ? err.message : err}\n`);
    process.exitCode = 1;
  }
}

main();
