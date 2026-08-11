// Graph construction from OSM ways + A* shade-aware routing.
(function () {
  const C = SOMBRA.config, G = SOMBRA.geo;
  const R = {};

  // ways: [{id, tags, coords: [[lon,lat],...], nodeIds: [...]}]
  R.buildGraph = function (ways, mode, proj) {
    const allowed = mode === "walk" ? C.HIGHWAY_WALK : C.HIGHWAY_BIKE;
    const usable = ways.filter((w) => {
      const hw = w.tags && w.tags.highway;
      if (!hw || !allowed.has(hw)) return false;
      if (mode === "bike" && w.tags.bicycle === "no") return false;
      if (w.tags.access === "private" || w.tags.foot === "no" && mode === "walk") return false;
      return true;
    });

    // Count node usage to find junctions
    const useCount = new Map();
    for (const w of usable)
      for (const id of w.nodeIds) useCount.set(id, (useCount.get(id) || 0) + 1);

    const nodes = new Map(); // id -> {x, y, lon, lat}
    const edges = []; // {a, b, pts, len, sunFrac}
    const adj = new Map(); // id -> [edgeIdx,...]

    const addNode = (id, lon, lat) => {
      if (!nodes.has(id)) {
        const [x, y] = proj.toXY(lon, lat);
        nodes.set(id, { x, y, lon, lat });
        adj.set(id, []);
      }
    };

    for (const w of usable) {
      let segStart = 0;
      for (let i = 1; i < w.nodeIds.length; i++) {
        const isJunction = useCount.get(w.nodeIds[i]) > 1 || i === w.nodeIds.length - 1;
        if (!isJunction) continue;
        const a = w.nodeIds[segStart], b = w.nodeIds[i];
        const coords = w.coords.slice(segStart, i + 1);
        if (a !== b && coords.length >= 2) {
          addNode(a, coords[0][0], coords[0][1]);
          addNode(b, coords[coords.length - 1][0], coords[coords.length - 1][1]);
          const pts = coords.map(([lon, lat]) => proj.toXY(lon, lat));
          const len = G.pathLength(pts);
          if (len > 0.5) {
            const idx = edges.length;
            edges.push({ a, b, pts, lonlat: coords, len, sunFrac: 1 });
            adj.get(a).push(idx);
            adj.get(b).push(idx);
          }
        }
        segStart = i;
      }
    }

    // Label connected components; routing sticks to the largest one so that
    // nearest-node snapping never lands on an isolated island.
    const comp = new Map();
    let compId = 0;
    const sizes = [];
    for (const id of nodes.keys()) {
      if (comp.has(id)) continue;
      const queue = [id];
      comp.set(id, compId);
      let size = 0;
      while (queue.length) {
        const cur = queue.pop();
        size++;
        for (const ei of adj.get(cur)) {
          const e = edges[ei];
          const nb = e.a === cur ? e.b : e.a;
          if (!comp.has(nb)) { comp.set(nb, compId); queue.push(nb); }
        }
      }
      sizes.push(size);
      compId++;
    }
    let largest = 0;
    for (let i = 1; i < sizes.length; i++) if (sizes[i] > sizes[largest]) largest = i;
    return { nodes, edges, adj, comp, largest };
  };

  R.annotateShade = function (graph, index) {
    for (const e of graph.edges) e.sunFrac = SOMBRA.shadows.sunFraction(index, e.pts);
  };

  R.nearestNode = function (graph, x, y) {
    let best = null, bestD = Infinity;
    for (const [id, n] of graph.nodes) {
      if (graph.comp.get(id) !== graph.largest) continue;
      const d = (n.x - x) ** 2 + (n.y - y) ** 2;
      if (d < bestD) { bestD = d; best = id; }
    }
    return best;
  };

  R.route = function (graph, srcId, dstId, k) {
    const dst = graph.nodes.get(dstId);
    const h = (id) => {
      const n = graph.nodes.get(id);
      return Math.hypot(n.x - dst.x, n.y - dst.y); // admissible (cost >= length)
    };
    const dist = new Map(), prev = new Map(), visited = new Set();
    const open = new MinHeap();
    dist.set(srcId, 0);
    open.push(h(srcId), srcId);
    while (open.size()) {
      const id = open.pop();
      if (id === dstId) break;
      if (visited.has(id)) continue;
      visited.add(id);
      for (const ei of graph.adj.get(id)) {
        const e = graph.edges[ei];
        const nb = e.a === id ? e.b : e.a;
        if (visited.has(nb)) continue;
        const w = e.len * (1 + k * e.sunFrac);
        const nd = dist.get(id) + w;
        if (nd < (dist.get(nb) ?? Infinity)) {
          dist.set(nb, nd);
          prev.set(nb, { id, ei });
          open.push(nd + h(nb), nb);
        }
      }
    }
    if (!prev.has(dstId) && srcId !== dstId) return null;

    // Reconstruct
    const edgeSeq = [];
    let cur = dstId;
    while (cur !== srcId) {
      const p = prev.get(cur);
      if (!p) return null;
      edgeSeq.push({ ei: p.ei, from: p.id, to: cur });
      cur = p.id;
    }
    edgeSeq.reverse();

    // Assemble geometry + stats + display segments
    let totalLen = 0, shadedLen = 0;
    const coords = [];
    const segments = [];
    let curFlag = null, curCoords = [];
    for (const step of edgeSeq) {
      const e = graph.edges[step.ei];
      let ll = e.lonlat;
      const first = graph.nodes.get(step.from);
      const d0 = Math.hypot(e.pts[0][0] - first.x, e.pts[0][1] - first.y);
      const d1 = Math.hypot(e.pts[e.pts.length - 1][0] - first.x, e.pts[e.pts.length - 1][1] - first.y);
      if (d1 < d0) ll = ll.slice().reverse();
      totalLen += e.len;
      shadedLen += e.len * (1 - e.sunFrac);
      const shaded = e.sunFrac < C.SHADED_THRESHOLD;
      const add = coords.length ? ll.slice(1) : ll;
      coords.push(...add);
      if (curFlag === null) { curFlag = shaded; curCoords = ll.slice(); }
      else if (shaded === curFlag) curCoords.push(...ll.slice(1));
      else {
        segments.push({ coords: curCoords, shaded: curFlag });
        curCoords = [curCoords[curCoords.length - 1], ...ll.slice(1)];
        curFlag = shaded;
      }
    }
    if (curCoords.length) segments.push({ coords: curCoords, shaded: curFlag });

    return {
      coords, segments,
      distanceM: totalLen,
      shadePct: totalLen ? (100 * shadedLen) / totalLen : 0,
    };
  };

  class MinHeap {
    constructor() { this.k = []; this.v = []; }
    size() { return this.k.length; }
    push(key, val) {
      this.k.push(key); this.v.push(val);
      let i = this.k.length - 1;
      while (i > 0) {
        const p = (i - 1) >> 1;
        if (this.k[p] <= this.k[i]) break;
        [this.k[p], this.k[i]] = [this.k[i], this.k[p]];
        [this.v[p], this.v[i]] = [this.v[i], this.v[p]];
        i = p;
      }
    }
    pop() {
      const top = this.v[0];
      const lk = this.k.pop(), lv = this.v.pop();
      if (this.k.length) {
        this.k[0] = lk; this.v[0] = lv;
        let i = 0;
        for (;;) {
          const l = 2 * i + 1, r = l + 1;
          let m = i;
          if (l < this.k.length && this.k[l] < this.k[m]) m = l;
          if (r < this.k.length && this.k[r] < this.k[m]) m = r;
          if (m === i) break;
          [this.k[m], this.k[i]] = [this.k[i], this.k[m]];
          [this.v[m], this.v[i]] = [this.v[i], this.v[m]];
          i = m;
        }
      }
      return top;
    }
  }

  window.SOMBRA.router = R;
})();
