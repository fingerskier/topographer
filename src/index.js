'use strict';

const fs = require('fs');
const path = require('path');

const { scanFiles } = require('./scan.js');
const { resolveImport, isLocalSpecifier } = require('./resolve.js');
const { getGitStatus } = require('./git.js');
const { renderHtml } = require('./render.js');
const { backendFor } = require('./backends/index.js');
const { loadTs } = require('./backends/js.js');
const { loadCoverage } = require('./coverage.js');
const { buildDataset, buildAnnotations } = require('./crap.js');

/**
 * Build the dependency graph for a repo and write it to an HTML file.
 *
 * All generated assets land as siblings of `outPath`, which defaults to
 * `<root>/.topographer/map.html`.
 *
 * @param {{ root: string, outPath?: string|null, crap?: boolean, coveragePath?: string|null }} options
 * @returns {{ outPath: string, topoPath: string, datasetPath: string|null, written: string[], graph: object, stats: object }}
 */
function run({ root, outPath = null, crap = true, coveragePath = null }) {
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
    throw new Error(`not a directory: ${root}`);
  }
  if (!outPath) outPath = path.join(root, '.topographer', 'map.html');
  const outDir = path.dirname(outPath);
  fs.mkdirSync(outDir, { recursive: true });

  const graph = buildGraph(root);

  let annotations = null;
  let crapStats = null;
  let datasetPath = null;
  if (crap) {
    const covFile = resolveCoverage(root, coveragePath); // throws if explicit path given and unusable
    const coverage = covFile ? loadCoverage(covFile, root) : null;
    const records = buildDataset({ functionsByFile: graph.functionsByFile, coverage });
    annotations = buildAnnotations(records);

    datasetPath = path.join(outDir, 'crap.jsonl');
    fs.writeFileSync(
      datasetPath,
      records.map((r) => JSON.stringify(r)).join('\n') + '\n',
      'utf8'
    );
    let warning = null;
    if (coverage) {
      let matched = 0;
      for (const key of coverage.keys()) if (graph.functionsByFile.has(key)) matched++;
      if (matched === 0) {
        warning =
          `coverage file ${covFile} matched 0 of ${coverage.size} covered paths against scanned sources ` +
          `(compiled .js paths vs .ts sources?) — all functions unscored`;
      }
    }
    crapStats = {
      functions: records.length,
      scored: records.filter((r) => r.crap !== null).length,
      aboveThreshold: records.filter((r) => r.flags.includes('above_threshold')).length,
      coverageFile: covFile,
      warning,
    };
  }

  const html = renderHtml(graph, { root, annotations });
  fs.writeFileSync(outPath, html, 'utf8');

  const topoPath = path.join(outDir, 'topo.json');
  const topo = {
    nodes: graph.nodes,
    links: graph.links,
    git: graph.git,
    root: graph.root,
    manifest: graph.manifest,
  };
  if (annotations !== null) topo.annotations = annotations;
  fs.writeFileSync(topoPath, JSON.stringify(topo, null, 2) + '\n', 'utf8');

  const written = [outPath, topoPath];
  if (datasetPath) written.push(datasetPath);

  return {
    outPath,
    topoPath,
    datasetPath,
    written,
    graph,
    stats: {
      nodes: graph.nodes.length,
      edges: graph.links.length,
      git: graph.git,
      manifest: graph.manifest,
      crap: crapStats,
    },
  };
}

function resolveCoverage(root, coveragePath) {
  if (coveragePath) {
    if (!fs.existsSync(coveragePath)) throw new Error(`coverage file not found: ${coveragePath}`);
    return coveragePath; // format errors surface from loadCoverage
  }
  for (const candidate of ['coverage/coverage-final.json', 'coverage/lcov.info']) {
    const p = path.join(root, candidate);
    if (fs.existsSync(p)) return p;
  }
  return null; // no coverage — still score CC, all functions no_coverage_data
}

/**
 * Produce a serialisable graph: `{ nodes, links, git }`.
 *
 * Nodes are source files (plus any git-deleted source files). Links are local
 * imports resolved to those files; 3rd-party/bare specifiers are dropped.
 */
function buildGraph(root) {
  const files = scanFiles(root);
  const gitStatus = getGitStatus(root); // null when not a git repo

  // The universe of paths we can resolve imports against. Include deleted
  // files so that stale imports still draw an edge to the (red) node.
  const deleted = gitStatus ? gitStatus.deleted : [];
  const allPaths = new Set(files);
  for (const d of deleted) allPaths.add(d);

  const nodes = [];
  const nodeIndex = new Map(); // path -> node index

  const addNode = (relPath, status) => {
    if (nodeIndex.has(relPath)) return nodeIndex.get(relPath);
    const idx = nodes.length;
    nodeIndex.set(relPath, idx);
    nodes.push({
      id: relPath,
      label: path.posix.basename(relPath),
      dir: path.posix.dirname(relPath) === '.' ? '' : path.posix.dirname(relPath),
      status,
    });
    return idx;
  };

  const statusFor = (relPath) => {
    if (!gitStatus) return 'added'; // not a git repo => everything is "this commit"
    return gitStatus.statuses.get(relPath) || 'unchanged';
  };

  // Create nodes for every known path (present + deleted) up front so that
  // edges can reference either endpoint.
  for (const rel of files) addNode(rel, statusFor(rel));
  for (const rel of deleted) addNode(rel, 'deleted');

  // Collect edges, de-duplicating (a pair may be imported multiple ways).
  const linkKey = new Map(); // "from->to" -> { source, target, dynamic }

  const functionsByFile = new Map();
  const manifest = { astParsed: 0, regexFallback: [], skippedUnknown: [] };
  const ctx = { root, loadTs };

  for (const rel of files) {
    let source;
    try {
      source = fs.readFileSync(path.join(root, rel), 'utf8');
    } catch (_err) {
      continue;
    }

    const backend = backendFor(rel);
    let imports;
    if (backend) {
      const parsed = backend.parse(rel, source, ctx);
      imports = parsed.imports;
      functionsByFile.set(rel, parsed.functions);
      if (parsed.parser === 'regex') manifest.regexFallback.push(rel);
      else manifest.astParsed++;
    } else {
      imports = [];
      functionsByFile.set(rel, null);
      manifest.skippedUnknown.push(rel);
    }

    for (const imp of imports) {
      if (!isLocalSpecifier(imp.specifier)) continue; // skip 3rd-party
      const target = resolveImport(rel, imp.specifier, allPaths);
      if (!target || target === rel) continue; // unresolved or self-import
      const key = rel + ' ' + target;
      const existing = linkKey.get(key);
      if (existing) {
        // A static edge downgrades an existing dynamic one to solid.
        if (!imp.dynamic) existing.dynamic = false;
      } else {
        linkKey.set(key, {
          source: nodeIndex.get(rel),
          target: nodeIndex.get(target),
          dynamic: imp.dynamic,
        });
      }
    }
  }

  const links = Array.from(linkKey.values());

  manifest.regexFallback.sort();
  manifest.skippedUnknown.sort();

  return {
    nodes,
    links,
    git: Boolean(gitStatus),
    root: path.basename(root) || root,
    functionsByFile,
    manifest,
  };
}

module.exports = { run, buildGraph };
