'use strict';
const jsBackend = require('./js.js');

// Registry keyed by extension. GH #4 adds more backends here; core stays untouched.
const BY_EXT = {
  '.js': jsBackend, '.jsx': jsBackend, '.mjs': jsBackend, '.cjs': jsBackend,
  '.ts': jsBackend, '.tsx': jsBackend,
};

function backendFor(relPath) {
  const m = /(\.[^.]+)$/.exec(relPath.toLowerCase());
  return (m && BY_EXT[m[1]]) || null;
}

module.exports = { backendFor };
