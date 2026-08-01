# Backend Contract

Backends parse source files to extract import and function metadata for the dependency graph and CRAP annotations.

## Registry

The backend registry lives in `src/backends/index.js`, keyed by file extension:

```javascript
const BY_EXT = {
  '.js': jsBackend, '.jsx': jsBackend, '.mjs': jsBackend, '.cjs': jsBackend,
  '.ts': jsBackend, '.tsx': jsBackend,
};

function backendFor(relPath) {
  const m = /(\.[^.]+)$/.exec(relPath.toLowerCase());
  return (m && BY_EXT[m[1]]) || null;
}
```

Files with no registered backend (e.g., JSON, CSS, config files) contribute nodes to the graph and are included in the manifest's `skippedUnknown` list.

## Parse Contract

Each backend module exports a `parse(relPath, source, ctx)` function:

```javascript
/**
 * Parse a source file and extract imports and function metadata.
 * 
 * @param {string} relPath - Relative path to the file (from repo root)
 * @param {string} source - Full source code
 * @param {object} ctx - Context object with { root, loadTs? }
 * @returns {object} - { imports, functions, parser }
 */
function parse(relPath, source, ctx) {
  // ...
}
```

### Return Value

- **`imports`** (array of `{ specifier, dynamic }`):
  - `specifier`: import path (e.g., `'./utils'`, `'react'`)
  - `dynamic`: boolean — true only for dynamic imports (`import()` expressions), false for all static forms (ES6 import/export, `require()`)
  - Both static and dynamic imports are collected; static wins (duplicate specifier demoted to dynamic=false)

- **`functions`** (array of function records, or null):
  - Array when AST parsing succeeds; null when fallback to regex (see below)
  - Empty array is valid (file has no functions)

- **`parser`** (string):
  - `'acorn'`: JavaScript/JSX parsed with Acorn AST
  - `'typescript'`: TypeScript parsed with TypeScript compiler
  - `'regex'`: AST parsing failed; imports extracted by regex fallback

## Function Record Shape

Each function record captures metadata for CRAP scoring and visualization:

```javascript
{
  id: "src/utils.js#parseConfig@42",  // ${relPath}#${name}@${startLine}
  name: "parseConfig",                 // Function name or '<anonymous>'
  startLine: 42,                       // 1-based line number of function start
  endLine: 53,                         // 1-based line number of function end
  cc: 4                                // Cyclomatic complexity (base 1)
}
```

- **`id`** must be unique within a file and reproducible across runs
- **`name`** is inferred from context: function declaration name, variable name, property name, or `'<anonymous>'`
- **`startLine` and `endLine`** use 1-based line numbering (as reported by AST and coverage tools)
- **`cc` (cyclomatic complexity)** is the count of decision points + 1 (base 1)

## Decision Points (Cyclomatic Complexity)

A decision point adds 1 to cyclomatic complexity. For each of these, increment the enclosing function's `cc`:

- `if` statements
- Ternary operator (`condition ? true_branch : false_branch`)
- Loops: `for`, `for...in`, `for...of`, `while`, `do...while`
- `switch` case clauses (not `default`)
- `catch` clauses
- Logical operators: `&&`, `||`, `??`

**Nested functions are independent**: a decision inside a nested function does not increment its parent's CC.

## Regex Fallback Semantics

When AST parsing fails (acorn throws, TypeScript compiler throws, or TypeScript is unavailable), the backend:

1. Falls back to regex-based import extraction (see `src/parse.js`)
2. Returns `functions: null` to indicate no AST-level function data
3. Sets `parser: 'regex'`

This fallback preserves import edges in the graph but excludes the file from CRAP scoring.

Files in `manifest.regexFallback` can still appear in the map.html (with no function annotations) and contribute to the graph in topo.json.

## Manifest

After parsing all files, the graph includes a `manifest` object:

```javascript
{
  astParsed: 42,               // Number of files successfully parsed with AST
  regexFallback: ["src/bad.ts"], // Files that fell back to regex (AST failed)
  skippedUnknown: ["src/foo.json"] // Files with no registered backend
}
```

The manifest is included in the `topo.json` output; CLI stdout prints only nodes, edges, git status, and CRAP statistics.

## Adding a New Backend

To add support for a new language:

1. **Create a backend module** (e.g., `src/backends/python.js`):
   - Export `parse(relPath, source, ctx)` implementing the contract above
   - Return `{ imports, functions, parser }`
   - On parse failure, fall back to regex: `{ imports: parseImports(source), functions: null, parser: 'regex' }`

2. **Register the backend** in `src/backends/index.js`:
   ```javascript
   const pythonBackend = require('./python.js');
   const BY_EXT = {
     // ...existing...
     '.py': pythonBackend,
   };
   ```

3. **No core changes needed**:
   - Graph building, import resolution, and CRAP scoring are language-agnostic
   - Only the import and function extraction is backend-specific

### Graph Behavior

Note that **annotation and graphing are separable**:

- A file can be annotated with CRAP scores before import-graph edges are fully resolved (e.g., while TypeScript/Python support is incomplete)
- A file with `functions: null` (regex fallback) still contributes import edges and nodes to the graph
- The HTML visualization and topo.json work with partial data (e.g., functions for some files, not others)

## Coverage Kind Non-Mixing

Coverage data comes in different kinds:

- **`'statement'`**: Only statement coverage (lines covered)
- **`'min'`**: Minimum of statement and branch coverage (stricter)

When `buildAnnotations` rolls up CRAP scores per file, it detects mixed kinds:

- If a file has functions scored with different coverage kinds (e.g., one with statement-only, one with statement+branch), the file's annotation is marked `coverageKind: 'mixed'`
- **Important**: Scores with different kinds are not comparable and must not be mixed silently in roll-ups
- The `'mixed'` flag signals ambiguity for downstream consumers

## See Also

- `src/index.js`: Graph building and CRAP scoring entrypoint
- `src/crap.js`: CRAP formula and dataset/annotation building
- `src/coverage.js`: Coverage format loading (Istanbul, LCOV)
