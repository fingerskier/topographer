'use strict';

/**
 * Extract import/require specifiers from source text.
 *
 * We strip comments first to cut down on false positives, then run a handful
 * of regexes covering ES module and CommonJS syntax. Each result is flagged as
 * `dynamic` (a `import(...)` expression) or not (static `import`/`require`).
 *
 * This is intentionally a lightweight lexical scan rather than a full parser:
 * treasure-map has zero runtime dependencies so it stays fast under `npx`.
 *
 * @param {string} source File contents.
 * @returns {Array<{specifier: string, dynamic: boolean}>}
 */
function parseImports(source) {
  const code = stripComments(source);
  const found = new Map(); // specifier -> dynamic (static wins over dynamic)

  const add = (specifier, dynamic) => {
    if (!specifier) return;
    if (found.has(specifier)) {
      // A static edge always takes precedence over a dynamic one.
      if (!dynamic) found.set(specifier, false);
    } else {
      found.set(specifier, dynamic);
    }
  };

  let m;

  // Dynamic import: import('x')  — matched first so static forms can override.
  const dynamicImport = /\bimport\s*\(\s*(['"])([^'"]+)\1\s*\)/g;
  while ((m = dynamicImport.exec(code))) add(m[2], true);

  // import ... from 'x'   /   export ... from 'x'
  const fromImport = /\b(?:import|export)\b[^;'"]*?\bfrom\s*(['"])([^'"]+)\1/g;
  while ((m = fromImport.exec(code))) add(m[2], false);

  // Side-effect import: import 'x'
  const bareImport = /\bimport\s*(['"])([^'"]+)\1/g;
  while ((m = bareImport.exec(code))) add(m[2], false);

  // require('x')  (CommonJS, static)
  const requireCall = /\brequire\s*\(\s*(['"])([^'"]+)\1\s*\)/g;
  while ((m = requireCall.exec(code))) add(m[2], false);

  const out = [];
  for (const [specifier, dynamic] of found) out.push({ specifier, dynamic });
  return out;
}

/**
 * Remove `//` line comments and block comments. String and template literals
 * are preserved so specifiers inside them survive. This is a small state
 * machine rather than a regex to avoid mangling `//` inside strings or URLs.
 */
function stripComments(source) {
  let out = '';
  const n = source.length;
  let i = 0;
  let state = 'code'; // code | line | block | single | double | template

  while (i < n) {
    const c = source[i];
    const next = source[i + 1];

    switch (state) {
      case 'code':
        if (c === '/' && next === '/') {
          state = 'line';
          i += 2;
        } else if (c === '/' && next === '*') {
          state = 'block';
          i += 2;
        } else if (c === "'") {
          state = 'single';
          out += c;
          i++;
        } else if (c === '"') {
          state = 'double';
          out += c;
          i++;
        } else if (c === '`') {
          state = 'template';
          out += c;
          i++;
        } else {
          out += c;
          i++;
        }
        break;

      case 'line':
        if (c === '\n') {
          state = 'code';
          out += c;
        }
        i++;
        break;

      case 'block':
        if (c === '*' && next === '/') {
          state = 'code';
          i += 2;
        } else {
          // Preserve newlines to keep line-oriented regexes sane.
          if (c === '\n') out += c;
          i++;
        }
        break;

      case 'single':
      case 'double':
      case 'template': {
        const quote = state === 'single' ? "'" : state === 'double' ? '"' : '`';
        if (c === '\\') {
          out += c + (next || '');
          i += 2;
        } else if (c === quote) {
          state = 'code';
          out += c;
          i++;
        } else {
          out += c;
          i++;
        }
        break;
      }
    }
  }

  return out;
}

module.exports = { parseImports, stripComments };
