'use strict';

/**
 * Render the dependency graph to a single self-contained HTML document.
 *
 * Everything (styles + script + data) is inlined so the resulting `map.html`
 * opens offline with no network access and no external dependencies.
 *
 * @param {object} graph  { nodes, links, git, root }
 * @param {object} [meta] { root }
 * @returns {string} Full HTML document.
 */
function renderHtml(graph, meta = {}) {
  const data = JSON.stringify({
    nodes: graph.nodes,
    links: graph.links,
    git: graph.git,
    root: graph.root || '',
  })
    // Guard against a stray "</script>" inside file paths breaking the tag.
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026');

  const title = 'treasuremap — ' + escapeHtml(graph.root || meta.root || 'dependency graph');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>${STYLE}</style>
</head>
<body>
<header id="bar">
  <div class="brand">🗺️ <strong>treasuremap</strong> <span class="root">${escapeHtml(
    graph.root || ''
  )}</span></div>
  <div class="controls">
    <input id="search" type="search" placeholder="Filter files…" autocomplete="off" spellcheck="false">
    <button id="expandAll" type="button" title="Expand every node">Expand all</button>
    <button id="collapseAll" type="button" title="Collapse every node">Collapse all</button>
    <button id="reset" type="button" title="Re-run the layout">Re-layout</button>
  </div>
</header>
<aside id="legend">
  <div class="legend-group">
    <span class="legend-title">Nodes</span>
    <span class="swatch"><i class="dot" style="background:var(--unchanged)"></i>unchanged</span>
    <span class="swatch"><i class="dot" style="background:var(--added)"></i>added</span>
    <span class="swatch"><i class="dot" style="background:var(--modified)"></i>modified</span>
    <span class="swatch"><i class="dot" style="background:var(--deleted)"></i>deleted</span>
  </div>
  <div class="legend-group">
    <span class="legend-title">Edges</span>
    <span class="swatch"><i class="edge solid"></i>static import</span>
    <span class="swatch"><i class="edge dashed"></i>dynamic import</span>
  </div>
  <div class="legend-hint">Click a node to collapse its dependencies · drag to move · scroll to zoom</div>
</aside>
<svg id="graph"><g id="viewport"><g id="links"></g><g id="nodes"></g></g></svg>
<div id="tooltip" hidden></div>
<div id="empty" hidden>No source files found to map.</div>
<script>
const GRAPH = ${data};
${SCRIPT}
</script>
</body>
</html>
`;
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const STYLE = `
:root {
  --bg: #0f1420;
  --panel: #171d2b;
  --panel-2: #1e2636;
  --text: #e7ecf5;
  --muted: #93a1bd;
  --border: #2a3346;
  --accent: #6ea8fe;
  --unchanged: #4f7fd6;
  --added: #35c26b;
  --modified: #e8912d;
  --deleted: #e0533d;
  --edge: #46506a;
  --edge-hi: #9db4e0;
}
* { box-sizing: border-box; }
html, body { margin: 0; height: 100%; }
body {
  background: var(--bg);
  color: var(--text);
  font: 13px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  overflow: hidden;
}
#bar {
  position: fixed; top: 0; left: 0; right: 0; height: 48px; z-index: 10;
  display: flex; align-items: center; justify-content: space-between; gap: 12px;
  padding: 0 14px; background: var(--panel); border-bottom: 1px solid var(--border);
}
.brand { font-size: 15px; letter-spacing: .2px; }
.brand .root { color: var(--muted); font-weight: 400; margin-left: 6px; font-size: 13px; }
.controls { display: flex; align-items: center; gap: 8px; }
#search {
  background: var(--panel-2); border: 1px solid var(--border); color: var(--text);
  border-radius: 6px; padding: 6px 10px; width: 200px; outline: none;
}
#search:focus { border-color: var(--accent); }
.controls button {
  background: var(--panel-2); border: 1px solid var(--border); color: var(--text);
  border-radius: 6px; padding: 6px 10px; cursor: pointer;
}
.controls button:hover { border-color: var(--accent); color: #fff; }
#legend {
  position: fixed; left: 14px; bottom: 14px; z-index: 10;
  background: rgba(23,29,43,.9); border: 1px solid var(--border); border-radius: 8px;
  padding: 10px 12px; display: flex; flex-direction: column; gap: 8px; max-width: 260px;
  backdrop-filter: blur(4px);
}
.legend-group { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; }
.legend-title { color: var(--muted); font-weight: 600; width: 46px; }
.swatch { display: inline-flex; align-items: center; gap: 5px; color: var(--text); }
.dot { width: 11px; height: 11px; border-radius: 50%; display: inline-block; }
.edge { width: 20px; height: 0; border-top: 2px solid var(--edge-hi); display: inline-block; }
.edge.dashed { border-top-style: dashed; }
.legend-hint { color: var(--muted); font-size: 11px; line-height: 1.5; }
#graph { position: fixed; inset: 48px 0 0 0; width: 100%; height: calc(100% - 48px); cursor: grab; }
#graph.panning { cursor: grabbing; }
.link { stroke: var(--edge); stroke-width: 1.2; }
.link.dynamic { stroke-dasharray: 5 4; }
.link.hi { stroke: var(--edge-hi); stroke-width: 2; }
.link.dim { opacity: .08; }
.node { cursor: pointer; }
.node circle {
  stroke: #0b0f18; stroke-width: 1.5; transition: stroke .1s, stroke-width .1s;
}
.node.status-unchanged circle { fill: var(--unchanged); }
.node.status-added circle { fill: var(--added); }
.node.status-modified circle { fill: var(--modified); }
.node.status-deleted circle { fill: var(--deleted); }
.node.collapsed circle { stroke: #fff; stroke-width: 2.5; }
.node.hi circle { stroke: #fff; stroke-width: 2.5; }
.node.dim { opacity: .12; }
.node text {
  fill: var(--text); font-size: 10px; paint-order: stroke;
  stroke: rgba(11,15,24,.85); stroke-width: 3px; pointer-events: none;
  transition: opacity .1s;
}
.node.dim text { opacity: .15; }
.badge { fill: #0b0f18; }
.badge-text { fill: #fff; font-size: 8px; font-weight: 700; stroke: none; }
#tooltip {
  position: fixed; z-index: 20; pointer-events: none; max-width: 340px;
  background: var(--panel); border: 1px solid var(--border); border-radius: 6px;
  padding: 8px 10px; box-shadow: 0 6px 24px rgba(0,0,0,.4); font-size: 12px;
}
#tooltip .t-path { color: #fff; word-break: break-all; margin-bottom: 4px; }
#tooltip .t-meta { color: var(--muted); }
[hidden] { display: none !important; }
#empty {
  position: fixed; inset: 48px 0 0 0; display: flex; align-items: center;
  justify-content: center; color: var(--muted); font-size: 15px;
}
`;

// Client runtime. Kept as a template-free string so it can be inlined verbatim.
const SCRIPT = String.raw`
(function () {
  "use strict";

  var svg = document.getElementById("graph");
  var viewport = document.getElementById("viewport");
  var gLinks = document.getElementById("links");
  var gNodes = document.getElementById("nodes");
  var tooltip = document.getElementById("tooltip");
  var SVGNS = "http://www.w3.org/2000/svg";

  var nodes = GRAPH.nodes.map(function (n, i) {
    return { i: i, id: n.id, label: n.label, dir: n.dir, status: n.status,
             x: 0, y: 0, vx: 0, vy: 0, fx: null, fy: null };
  });
  var links = GRAPH.links.map(function (l) {
    return { source: nodes[l.source], target: nodes[l.target], dynamic: !!l.dynamic };
  });

  if (nodes.length === 0) {
    document.getElementById("empty").hidden = false;
    return;
  }

  // ---- adjacency ----------------------------------------------------------
  var outgoing = nodes.map(function () { return []; });
  var incoming = nodes.map(function () { return []; });
  links.forEach(function (l) {
    outgoing[l.source.i].push(l.target.i);
    incoming[l.target.i].push(l.source.i);
  });

  var collapsed = new Set();

  // Roots drive the visibility BFS. A node with no incoming edge is a root;
  // if the graph is fully cyclic, treat every node as a root so nothing is
  // permanently hidden.
  var roots = nodes.filter(function (n) { return incoming[n.i].length === 0; })
                   .map(function (n) { return n.i; });
  if (roots.length === 0) roots = nodes.map(function (n) { return n.i; });

  // A node is visible if it can be reached from a root without passing
  // *through* a collapsed node. Collapsing a node therefore hides exactly the
  // dependencies that hang off it (and nothing reachable another way).
  function computeVisible() {
    var visible = new Set();
    var queue = [];
    roots.forEach(function (r) { if (!visible.has(r)) { visible.add(r); queue.push(r); } });
    while (queue.length) {
      var id = queue.shift();
      if (collapsed.has(id)) continue;
      var outs = outgoing[id];
      for (var k = 0; k < outs.length; k++) {
        var t = outs[k];
        if (!visible.has(t)) { visible.add(t); queue.push(t); }
      }
    }
    return visible;
  }

  // ---- deterministic initial layout --------------------------------------
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  var rand = mulberry32(nodes.length * 2654435761 >>> 0 || 1);
  var radius0 = 40 + Math.sqrt(nodes.length) * 40;
  nodes.forEach(function (n, i) {
    var ang = (i / nodes.length) * Math.PI * 2;
    n.x = Math.cos(ang) * radius0 * (0.4 + rand());
    n.y = Math.sin(ang) * radius0 * (0.4 + rand());
  });

  // ---- SVG element construction ------------------------------------------
  links.forEach(function (l) {
    var line = document.createElementNS(SVGNS, "line");
    line.setAttribute("class", "link" + (l.dynamic ? " dynamic" : ""));
    l._el = line;
    gLinks.appendChild(line);
  });

  nodes.forEach(function (n) {
    var g = document.createElementNS(SVGNS, "g");
    g.setAttribute("class", "node status-" + n.status);
    var c = document.createElementNS(SVGNS, "circle");
    c.setAttribute("r", nodeRadius(n));
    var text = document.createElementNS(SVGNS, "text");
    text.setAttribute("x", nodeRadius(n) + 4);
    text.setAttribute("y", 3);
    text.textContent = n.label;
    g.appendChild(c);
    g.appendChild(text);

    // Badge (count of hidden direct dependencies) — shown only when collapsed.
    var badge = document.createElementNS(SVGNS, "g");
    badge.setAttribute("class", "badge-group");
    badge.style.display = "none";
    var bc = document.createElementNS(SVGNS, "circle");
    bc.setAttribute("class", "badge");
    bc.setAttribute("r", 7);
    bc.setAttribute("cx", nodeRadius(n) - 2);
    bc.setAttribute("cy", -nodeRadius(n) + 2);
    var bt = document.createElementNS(SVGNS, "text");
    bt.setAttribute("class", "badge-text");
    bt.setAttribute("x", nodeRadius(n) - 2);
    bt.setAttribute("y", -nodeRadius(n) + 5);
    bt.setAttribute("text-anchor", "middle");
    badge.appendChild(bc);
    badge.appendChild(bt);
    g.appendChild(badge);

    n._el = g;
    n._circle = c;
    n._text = text;
    n._badge = badge;
    n._badgeText = bt;
    gNodes.appendChild(g);

    attachNodeEvents(n);
  });

  function nodeRadius(n) {
    var deg = outgoing[n.i].length + incoming[n.i].length;
    return 5 + Math.min(9, Math.sqrt(deg) * 2.2);
  }

  // ---- force simulation ---------------------------------------------------
  var alpha = 1;
  var visibleSet = computeVisible();
  var visibleNodes = [];
  var running = true;

  function refreshVisibility() {
    visibleSet = computeVisible();
    visibleNodes = nodes.filter(function (n) { return visibleSet.has(n.i); });
    nodes.forEach(function (n) {
      var vis = visibleSet.has(n.i);
      n._el.style.display = vis ? "" : "none";
      var isCollapsed = collapsed.has(n.i) && outgoing[n.i].length > 0;
      n._el.classList.toggle("collapsed", isCollapsed);
      if (isCollapsed) {
        n._badge.style.display = "";
        n._badgeText.textContent = String(outgoing[n.i].length);
      } else {
        n._badge.style.display = "none";
      }
    });
    links.forEach(function (l) {
      var vis = visibleSet.has(l.source.i) && visibleSet.has(l.target.i) &&
                !collapsed.has(l.source.i);
      l._visible = vis;
      l._el.style.display = vis ? "" : "none";
    });
    reheat(0.7);
  }

  function reheat(a) { alpha = Math.max(alpha, a); running = true; requestTick(); }

  var CENTER = { x: 0, y: 0 };
  function tick() {
    var vn = visibleNodes;
    var n = vn.length;
    if (n === 0) { running = false; return; }

    // Repulsion via a spatial grid so large graphs stay responsive.
    var cell = 60;
    var grid = new Map();
    function key(cx, cy) { return cx + "," + cy; }
    for (var i = 0; i < n; i++) {
      var a = vn[i];
      var cx = Math.floor(a.x / cell), cy = Math.floor(a.y / cell);
      var k = key(cx, cy);
      var bucket = grid.get(k);
      if (!bucket) { bucket = []; grid.set(k, bucket); }
      bucket.push(a);
    }
    var repel = 900;
    for (var i2 = 0; i2 < n; i2++) {
      var a2 = vn[i2];
      var gx = Math.floor(a2.x / cell), gy = Math.floor(a2.y / cell);
      for (var dx = -1; dx <= 1; dx++) {
        for (var dy = -1; dy <= 1; dy++) {
          var bucket2 = grid.get(key(gx + dx, gy + dy));
          if (!bucket2) continue;
          for (var b = 0; b < bucket2.length; b++) {
            var other = bucket2[b];
            if (other === a2) continue;
            var ox = a2.x - other.x, oy = a2.y - other.y;
            var d2 = ox * ox + oy * oy || 0.01;
            if (d2 > cell * cell * 4) continue;
            var f = repel / d2;
            var d = Math.sqrt(d2);
            a2.vx += (ox / d) * f * alpha;
            a2.vy += (oy / d) * f * alpha;
          }
        }
      }
    }

    // Spring attraction along visible links.
    var spring = 0.02, rest = 70;
    for (var li = 0; li < links.length; li++) {
      var l = links[li];
      if (!l._visible) continue;
      var s = l.source, t = l.target;
      var lx = t.x - s.x, ly = t.y - s.y;
      var dist = Math.sqrt(lx * lx + ly * ly) || 0.01;
      var force = (dist - rest) * spring * alpha;
      var fx = (lx / dist) * force, fy = (ly / dist) * force;
      s.vx += fx; s.vy += fy;
      t.vx -= fx; t.vy -= fy;
    }

    // Gentle gravity toward the centre keeps disconnected pieces on screen.
    for (var gi = 0; gi < n; gi++) {
      var g = vn[gi];
      g.vx += (CENTER.x - g.x) * 0.002 * alpha;
      g.vy += (CENTER.y - g.y) * 0.002 * alpha;
    }

    // Integrate.
    for (var pi = 0; pi < n; pi++) {
      var p = vn[pi];
      if (p.fx !== null) { p.x = p.fx; p.vx = 0; }
      else { p.vx *= 0.82; p.x += p.vx; }
      if (p.fy !== null) { p.y = p.fy; p.vy = 0; }
      else { p.vy *= 0.82; p.y += p.vy; }
    }

    render();

    alpha *= 0.985;
    if (alpha < 0.01) { running = false; }
  }

  function render() {
    for (var i = 0; i < visibleNodes.length; i++) {
      var n = visibleNodes[i];
      n._el.setAttribute("transform", "translate(" + n.x.toFixed(2) + "," + n.y.toFixed(2) + ")");
    }
    for (var li = 0; li < links.length; li++) {
      var l = links[li];
      if (!l._visible) continue;
      l._el.setAttribute("x1", l.source.x.toFixed(2));
      l._el.setAttribute("y1", l.source.y.toFixed(2));
      l._el.setAttribute("x2", l.target.x.toFixed(2));
      l._el.setAttribute("y2", l.target.y.toFixed(2));
    }
  }

  var rafPending = false;
  function requestTick() {
    if (rafPending) return;
    rafPending = true;
    requestAnimationFrame(function () {
      rafPending = false;
      if (running) { tick(); if (running) requestTick(); }
    });
  }

  // ---- interaction: zoom / pan -------------------------------------------
  var view = { x: 0, y: 0, k: 1 };
  function applyView() {
    viewport.setAttribute("transform",
      "translate(" + view.x + "," + view.y + ") scale(" + view.k + ")");
  }
  function fitView() {
    var rect = svg.getBoundingClientRect();
    view.x = rect.width / 2;
    view.y = rect.height / 2;
    view.k = 1;
    applyView();
  }

  svg.addEventListener("wheel", function (e) {
    e.preventDefault();
    var rect = svg.getBoundingClientRect();
    var mx = e.clientX - rect.left, my = e.clientY - rect.top;
    var factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
    var nk = Math.max(0.1, Math.min(6, view.k * factor));
    // Zoom toward the cursor.
    view.x = mx - (mx - view.x) * (nk / view.k);
    view.y = my - (my - view.y) * (nk / view.k);
    view.k = nk;
    applyView();
  }, { passive: false });

  var panning = false, panStart = null;
  svg.addEventListener("mousedown", function (e) {
    if (e.target.closest(".node")) return; // node drag handled separately
    panning = true;
    panStart = { x: e.clientX - view.x, y: e.clientY - view.y };
    svg.classList.add("panning");
  });
  window.addEventListener("mousemove", function (e) {
    if (!panning) return;
    view.x = e.clientX - panStart.x;
    view.y = e.clientY - panStart.y;
    applyView();
  });
  window.addEventListener("mouseup", function () {
    panning = false;
    svg.classList.remove("panning");
  });

  // ---- interaction: node drag / click / hover ----------------------------
  function clientToWorld(clientX, clientY) {
    var rect = svg.getBoundingClientRect();
    return {
      x: (clientX - rect.left - view.x) / view.k,
      y: (clientY - rect.top - view.y) / view.k,
    };
  }

  function attachNodeEvents(n) {
    var moved = false;
    var down = false;

    n._el.addEventListener("mousedown", function (e) {
      e.stopPropagation();
      down = true; moved = false;
      var w = clientToWorld(e.clientX, e.clientY);
      n._dragOff = { x: n.x - w.x, y: n.y - w.y };
      n.fx = n.x; n.fy = n.y;

      function onMove(ev) {
        var w2 = clientToWorld(ev.clientX, ev.clientY);
        n.fx = w2.x + n._dragOff.x;
        n.fy = w2.y + n._dragOff.y;
        moved = true;
        reheat(0.5);
      }
      function onUp() {
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
        n.fx = null; n.fy = null;
        down = false;
        if (!moved) toggleCollapse(n);
      }
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    });

    n._el.addEventListener("mouseenter", function (e) { highlight(n); showTip(n, e); });
    n._el.addEventListener("mousemove", function (e) { moveTip(e); });
    n._el.addEventListener("mouseleave", function () { clearHighlight(); hideTip(); });
  }

  function toggleCollapse(n) {
    if (outgoing[n.i].length === 0) return; // nothing to collapse
    if (collapsed.has(n.i)) collapsed.delete(n.i);
    else collapsed.add(n.i);
    refreshVisibility();
  }

  // ---- highlight + tooltip ------------------------------------------------
  var STATUS_LABEL = {
    unchanged: "unchanged", added: "added", modified: "modified", deleted: "deleted",
  };

  function highlight(n) {
    var keep = new Set([n.i]);
    outgoing[n.i].forEach(function (t) { keep.add(t); });
    incoming[n.i].forEach(function (s) { keep.add(s); });
    nodes.forEach(function (m) {
      if (!visibleSet.has(m.i)) return;
      m._el.classList.toggle("hi", m.i === n.i);
      m._el.classList.toggle("dim", !keep.has(m.i));
    });
    links.forEach(function (l) {
      if (!l._visible) return;
      var touch = l.source.i === n.i || l.target.i === n.i;
      l._el.classList.toggle("hi", touch);
      l._el.classList.toggle("dim", !touch);
    });
  }
  function clearHighlight() {
    nodes.forEach(function (m) { m._el.classList.remove("hi", "dim"); });
    links.forEach(function (l) { l._el.classList.remove("hi", "dim"); });
    applySearch();
  }

  function showTip(n, e) {
    var deps = outgoing[n.i].length, used = incoming[n.i].length;
    tooltip.innerHTML =
      '<div class="t-path">' + escapeHtml(n.id) + '</div>' +
      '<div class="t-meta">' + STATUS_LABEL[n.status] + ' · ' +
      deps + ' dependenc' + (deps === 1 ? 'y' : 'ies') + ' · ' +
      'used by ' + used + '</div>';
    tooltip.hidden = false;
    moveTip(e);
  }
  function moveTip(e) {
    var pad = 14;
    var w = tooltip.offsetWidth, h = tooltip.offsetHeight;
    var x = e.clientX + pad, y = e.clientY + pad;
    if (x + w > window.innerWidth) x = e.clientX - w - pad;
    if (y + h > window.innerHeight) y = e.clientY - h - pad;
    tooltip.style.left = x + "px";
    tooltip.style.top = y + "px";
  }
  function hideTip() { tooltip.hidden = true; }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }

  // ---- search -------------------------------------------------------------
  var searchInput = document.getElementById("search");
  var query = "";
  function applySearch() {
    if (!query) {
      nodes.forEach(function (m) { m._el.classList.remove("dim", "hi"); });
      links.forEach(function (l) { l._el.classList.remove("dim"); });
      return;
    }
    var q = query.toLowerCase();
    nodes.forEach(function (m) {
      if (!visibleSet.has(m.i)) return;
      var hit = m.id.toLowerCase().indexOf(q) !== -1;
      m._el.classList.toggle("hi", hit);
      m._el.classList.toggle("dim", !hit);
    });
    links.forEach(function (l) {
      if (!l._visible) return;
      l._el.classList.add("dim");
    });
  }
  searchInput.addEventListener("input", function () {
    query = searchInput.value.trim();
    applySearch();
  });

  // ---- toolbar buttons ----------------------------------------------------
  document.getElementById("collapseAll").addEventListener("click", function () {
    nodes.forEach(function (n) { if (outgoing[n.i].length > 0) collapsed.add(n.i); });
    refreshVisibility();
  });
  document.getElementById("expandAll").addEventListener("click", function () {
    collapsed.clear();
    refreshVisibility();
  });
  document.getElementById("reset").addEventListener("click", function () {
    nodes.forEach(function (n, i) {
      var ang = (i / nodes.length) * Math.PI * 2;
      n.x = Math.cos(ang) * radius0 * (0.4 + rand());
      n.y = Math.sin(ang) * radius0 * (0.4 + rand());
      n.vx = 0; n.vy = 0;
    });
    fitView();
    reheat(1);
  });

  window.addEventListener("resize", function () { applyView(); });

  // ---- boot ---------------------------------------------------------------
  fitView();
  refreshVisibility();
  reheat(1);
})();
`;

module.exports = { renderHtml };
