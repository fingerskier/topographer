# treasure-map
Visitation of repo changes

A collapsible tree view of a codebase.
Node labels are the file/module name.
Edges indicate a dependency/import.
Node colors:
- blue ~ unchanged in this commit
- green - additional code in this commit
- orange - code changes in this commit
- red - deleted in this commit
Edge style:
- solid ~ direct dependency
- dashed ~ dynamic import

Run it in the repo root.
If its not a git repo then everything is "this commit".
If it is a git repo then the current state is "this commit".
Output is a single map.html
