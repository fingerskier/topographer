#!/usr/bin/env node
'use strict';

const path = require('path');
const { run } = require('../src/index.js');

function parseArgs(argv) {
  const opts = { root: process.cwd(), out: 'map.html' };
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

const HELP = `treasuremap — a collapsible dependency graph of a codebase.

Usage:
  npx treasuremap [options] [root]

Options:
  -o, --out <file>    Output HTML file (default: map.html)
  -r, --root <dir>    Repo root to scan (default: current directory)
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
  const outPath = path.isAbsolute(opts.out) ? opts.out : path.join(root, opts.out);

  try {
    const { outPath: written, stats } = run({ root, outPath });
    process.stdout.write(
      `treasuremap: wrote ${path.relative(process.cwd(), written) || written}\n` +
        `  ${stats.nodes} files, ${stats.edges} dependencies` +
        (stats.git ? ` (git repo)` : ` (not a git repo — everything treated as this commit)`) +
        `\n`
    );
  } catch (err) {
    process.stderr.write(`treasuremap: ${err && err.message ? err.message : err}\n`);
    process.exitCode = 1;
  }
}

main();
