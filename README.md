# topographer

Visualization of repo changes.

A collapsible dependency graph of a codebase, excluding 3rd-party modules.
Node labels are the file/module name.
Edges indicate a dependency/import.

Node colors:
- blue — unchanged in this commit
- green — added in this commit
- orange — modified in this commit
- red — deleted in this commit

Edge style:
- solid — direct dependency
- dashed — dynamic import

## Usage

Run the script in the repo root:

```
npx topographer [options] [root]
```

Options:
- `-o, --out <file>` — Output HTML file (default: map.html)
- `-r, --root <dir>` — Repo root to scan (default: current directory)
- `--crap` — Annotate functions with CRAP scores (CC² × (1−cov)³ + CC)
- `--coverage <file>` — Coverage report (Istanbul coverage-final.json or LCOV); default: auto-detect under coverage/
- `-v, --version` — Print version and exit
- `-h, --help` — Show this help

If it's not a git repo, everything is treated as "this commit".
If it is a git repo, the current state is "this commit".

## Outputs

- **`map.html`** — Interactive visualization of the dependency graph with optional CRAP risk view overlay.
- **`topo.json`** — Serialized graph (nodes, links, git status, manifest, and annotations if `--crap` was used).
- **`.crap/dataset.jsonl`** — Per-function CRAP scores and metadata (one JSON record per line, sorted by CRAP score descending, no-coverage functions last). Written only when `--crap` is used.

## Risk View

When `--crap` is enabled, the risk view highlights files by function complexity and coverage:

- **Halo color intensity** (orange to red) — Maximum CRAP score in the file (higher = more risky)
- **Dashed halo** — File has functions with no coverage data (null coverage is distinct from 0% coverage)

Hover over a node to see the file's max CRAP and count of above-threshold functions. Functions without coverage data are visibly separate from those with 0% coverage, making it clear where coverage is missing vs. explicitly low.
