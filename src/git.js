'use strict';

const { execFileSync } = require('child_process');

/**
 * Status buckets for a file relative to the current commit (HEAD).
 *   'added'     — new in the working tree (untracked or staged add)
 *   'modified'  — changed content (or renamed/copied/type-changed)
 *   'deleted'   — removed from the working tree
 *   'unchanged' — no pending change
 */

function git(root, args) {
  return execFileSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
    maxBuffer: 64 * 1024 * 1024,
  });
}

function isGitRepo(root) {
  try {
    const out = git(root, ['rev-parse', '--is-inside-work-tree']).trim();
    return out === 'true';
  } catch (_err) {
    return false;
  }
}

/**
 * Build a map of repo-relative POSIX path -> status for every path that has a
 * pending change against HEAD. Paths not present in the map are unchanged.
 *
 * If `root` is not a git repository, returns null — callers then treat the
 * whole tree as "this commit" (added).
 *
 * @returns {{ statuses: Map<string,string>, deleted: string[] } | null}
 */
function getGitStatus(root) {
  if (!isGitRepo(root)) return null;

  let raw;
  try {
    // -z gives NUL-separated records with unquoted paths; -uall lists every
    // untracked file individually rather than collapsing directories.
    raw = git(root, ['status', '--porcelain=v1', '-z', '-uall']);
  } catch (_err) {
    return { statuses: new Map(), deleted: [] };
  }

  const statuses = new Map();
  const deleted = [];
  const records = raw.split('\0');

  for (let i = 0; i < records.length; i++) {
    const record = records[i];
    if (!record) continue;

    const x = record[0];
    const y = record[1];
    let pathPart = record.slice(3);

    // Renames/copies encode "R  old\0new"; with -z the new path is in this
    // record and the old path is the *next* NUL-separated field.
    if (x === 'R' || x === 'C') {
      const oldPath = records[++i];
      // The moved-from path is gone at its old location.
      if (oldPath) markDeleted(statuses, deleted, oldPath);
      // The moved-to path counts as a modification of tracked content.
      set(statuses, pathPart, 'modified');
      continue;
    }

    const status = classify(x, y);
    if (status === 'deleted') {
      markDeleted(statuses, deleted, pathPart);
    } else {
      set(statuses, pathPart, status);
    }
  }

  return { statuses, deleted };
}

function classify(x, y) {
  // Untracked or ignored-but-forced -> added.
  if (x === '?' || y === '?') return 'added';
  if (x === 'D' || y === 'D') return 'deleted';
  if (x === 'A' || y === 'A') return 'added';
  // Modified, type-changed, updated-but-unmerged, etc.
  return 'modified';
}

// 'deleted' should not be overwritten by a weaker status; otherwise the last
// write wins (a file only appears once in porcelain output anyway).
function set(statuses, path, status) {
  const existing = statuses.get(path);
  if (existing === 'deleted') return;
  statuses.set(path, status);
}

function markDeleted(statuses, deleted, path) {
  statuses.set(path, 'deleted');
  if (!deleted.includes(path)) deleted.push(path);
}

module.exports = { isGitRepo, getGitStatus };
