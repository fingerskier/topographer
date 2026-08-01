# CRAP Annotator Design (GH #3, contract-shaped for #4)

Date: 2026-08-01
Status: approved

## Goal

Extend the pipeline from `discover → graph → render` to
`discover → parse → graph → annotate → render`, with CRAP scoring as the
first annotator. `CRAP(fn) = CC² × (1 − cov)³ + CC`, threshold 30.

## Architecture

One AST pass per file replaces the regex import scan as the primary parser.
Imports and functions are extracted from the same tree (issue #3: "no second
parser"). The old regex scanner (`src/parse.js`) is kept as a fallback only.

New modules:

### `src/backends/js.js` — reference backend (contract for #4)

Contract: `parse(file, source) → { imports[], functions[] }` where
`functions[] = { id, name, startLine, endLine, cc }`.

- `.js/.jsx/.mjs/.cjs`: acorn + acorn-jsx (new runtime deps — deliberate
  break of the zero-dependency rule; acorn has no transitive deps and stays
  fast under npx).
- `.ts/.tsx`: `typescript` compiler API, resolved from the **scanned repo's**
  `node_modules` (optional). Absent ⇒ TS files fall back to regex imports and
  their functions are flagged `no_data`.
- Parse failure on any file ⇒ regex fallback for edges; functions `no_data`;
  file counted in the manifest — never silently dropped.

Backend registry is keyed by file extension. Tree-sitter, Python, and the
additional coverage formats (coverage.py, Cobertura, JaCoCo) are all deferred
to #4; this module is the only backend shipped now.

### `src/coverage.js` — coverage ingestion (never runs tests)

- Loaders: Istanbul JSON (`coverage-final.json`), LCOV (`lcov.info`).
- Normalizes to per-file line/branch maps.
- Coverage kind = `min(statement, branch)`; statement-only fallback when
  branch data is absent; kind recorded per function.

### `src/crap.js` — scoring

- Match functions ↔ coverage by normalized path + line span.
- Unmatched ⇒ `crap: null` (never assume 0%). Null is visibly distinct from
  0%-covered everywhere (dataset and rendering).
- Flags: `above_threshold`, `refactor_only` (CC ≥ 31), `no_coverage_data`,
  `test_file` (excluded from roll-ups by default).

## Decision points (CC)

Per function, base 1, counting: `if`, ternary, `for`/`while`/`do`/`for-in`/
`for-of`, `case` arm, `catch`, `&&`, `||`, `??`. Optional-chain
short-circuits excluded. Nested functions counted separately, not into the
parent.

## Outputs

- `map.html` — self-contained, embeds its data (unchanged model; must stay
  double-clickable from `file://`).
- `topo.json` — always written next to `map.html`:
  `{ nodes, links, git, root, annotations? }` (per owner's issue-3 comment —
  topo info consumable by other tools/agents).
- `.crap/dataset.jsonl` — written only with `--crap`. One record per
  function:
  `{ id, file, lines: [start, end], name, cc, coverage: {kind, value} | null,
  crap, threshold_coverage, flags[] }`.
  Deterministic: stable ids (`file#name@startLine`), sorted crap desc, nulls
  last.

## CLI

`npx topographer [dir] --crap [--coverage <path>]`

- No `--coverage` ⇒ auto-detect `coverage/coverage-final.json`, then
  `coverage/lcov.info`.
- Coverage missing entirely ⇒ still score CC; all functions get
  `no_coverage_data`, crap null.
- Explicit `--coverage` path bad or malformed ⇒ hard error with a format
  hint.
- `--out` behavior unchanged.

## Rendering

- View toggle: change view (today's look) ↔ risk view.
- Risk view: halo ring per node; radius/opacity scaled by log(max CRAP in
  file). Gray dashed halo = no coverage data. Node fill stays git-status in
  both views.
- Collapsed node badge in risk view: max(hidden crap) + count above
  threshold. **Mean is prohibited** — the non-linearity is the signal.
- Legend updates per view.
- Note: current collapse is dependency-subtree hide (not folder grouping);
  "collapsed module" roll-up maps onto that mechanism.

## Exclusions

`node_modules` and existing ignored dirs apply to annotation exactly as they
do to scanning.

## Testing (red/green TDD)

Unit:
- CC counting fixtures: ternaries, nested functions, switch arms, logical
  operators, async/generators, class methods, arrows.
- Coverage loaders: Istanbul and LCOV fixtures, branch-absent fallback.
- CRAP math + flag edges: cc = 31, coverage absent, 0% vs null.
- Matcher: path normalization, off-by-one line spans.

Integration:
- Run on this repo with a checked-in fixture coverage file ⇒ deterministic
  `dataset.jsonl` snapshot.
- Existing `test/graph.test.js` stays green; import-behavior parity check
  (regex vs AST) over the fixture set.

## Out of scope (deferred to #4)

Tree-sitter backend, Python (and Tier-2 languages), coverage.py / Cobertura /
JaCoCo loaders, cross-language roll-up rules beyond recording coverage kind.
Stretch item `crap × log(fan-in)` ranking is also deferred.
