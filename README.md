# treasure-map

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
npx treasure-map
```

Output is a single `map.html`.

If it's not a git repo, everything is treated as "this commit".
If it is a git repo, the current state is "this commit".
