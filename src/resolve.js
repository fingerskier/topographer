'use strict';

const path = require('path');

const RESOLVE_EXTENSIONS = ['.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx', '.json'];
const INDEX_FILES = RESOLVE_EXTENSIONS.map((ext) => 'index' + ext);

/**
 * Decide whether a specifier refers to code inside the repo (a relative or
 * root-absolute path) rather than a 3rd-party module (a bare specifier).
 */
function isLocalSpecifier(specifier) {
  return specifier.startsWith('.') || specifier.startsWith('/');
}

/**
 * Resolve a local import specifier to a repo-relative source file.
 *
 * @param {string} fromFile  Repo-relative POSIX path of the importing file.
 * @param {string} specifier The import specifier (already known to be local).
 * @param {Set<string>} fileSet Set of known repo-relative POSIX file paths.
 * @returns {string|null} The resolved repo-relative path, or null if it does
 *   not point at a known source file (e.g. an asset or a stale import).
 */
function resolveImport(fromFile, specifier, fileSet) {
  const fromDir = path.posix.dirname(fromFile);
  // Root-absolute specifiers are resolved from the repo root.
  const base = specifier.startsWith('/')
    ? specifier.replace(/^\/+/, '')
    : path.posix.normalize(path.posix.join(fromDir, specifier));

  // Reject anything that escapes the repo root.
  if (base === '..' || base.startsWith('../')) return null;

  for (const candidate of candidatePaths(base)) {
    if (fileSet.has(candidate)) return candidate;
  }
  return null;
}

/**
 * Enumerate the paths Node/bundlers would try for a given base path:
 * the path itself, the path + each extension, and index files within it.
 */
function candidatePaths(base) {
  const out = [];
  out.push(base);
  for (const ext of RESOLVE_EXTENSIONS) out.push(base + ext);
  for (const index of INDEX_FILES) out.push(base ? base + '/' + index : index);
  return out;
}

module.exports = { resolveImport, isLocalSpecifier, RESOLVE_EXTENSIONS };
