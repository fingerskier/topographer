'use strict';

const fs = require('fs');
const path = require('path');

// Source extensions we know how to parse for imports.
const SOURCE_EXTENSIONS = ['.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx'];

// Directories we never descend into.
const IGNORED_DIRS = new Set([
  'node_modules',
  '.git',
  '.hg',
  '.svn',
  'dist',
  'build',
  'out',
  'coverage',
  '.next',
  '.nuxt',
  '.cache',
  '.turbo',
  'vendor',
  'bower_components',
]);

/**
 * Recursively collect source files under `root`, skipping ignored directories
 * and anything a symlink loop might introduce.
 *
 * @param {string} root Absolute path to the repo root.
 * @returns {string[]} Repo-relative POSIX paths of source files.
 */
function scanFiles(root) {
  const files = [];
  const seen = new Set();

  function walk(dir) {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (_err) {
      return; // Unreadable directory — skip it.
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (IGNORED_DIRS.has(entry.name)) continue;
        // Guard against symlink cycles by tracking real paths.
        let real;
        try {
          real = fs.realpathSync(full);
        } catch (_err) {
          continue;
        }
        if (seen.has(real)) continue;
        seen.add(real);
        walk(full);
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (SOURCE_EXTENSIONS.includes(ext)) {
          files.push(toPosix(path.relative(root, full)));
        }
      }
    }
  }

  walk(root);
  files.sort();
  return files;
}

function toPosix(p) {
  return p.split(path.sep).join('/');
}

module.exports = { scanFiles, SOURCE_EXTENSIONS, IGNORED_DIRS, toPosix };
