// Shadow engine: sun position (suncalc), shadow polygons, sampled shade tests.
(function () {
  const C = SOMBRA.config, G = SOMBRA.geo;
  const S = {};

  S.sunPosition = function (lat, lon, date) {
    const p = SunCalc.getPosition(date, lat, lon);
    // suncalc azimuth: 0 = south, positive westward. Convert to compass (0 = north, clockwise).
    const azimuthDeg = ((p.azimuth * 180) / Math.PI + 180) % 360;
    const elevationDeg = (p.altitude * 180) / Math.PI;
    return { elevationDeg, azimuthDeg, isLow: elevationDeg <= C.LOW_SUN_DEG };
  };

  S.parseHeight = function (tags) {
    if (!tags) return C.DEFAULT_BUILDING_H;
    if (tags.height) {
      const h = parseFloat(String(tags.height).replace(",", ".").replace(/m/i, "").trim());
      if (isFinite(h) && h > 0) return h;
    }
    const lv = tags["building:levels"];
    if (lv) {
      const n = parseFloat(String(lv).split(";")[0].replace(",", "."));
      if (isFinite(n) && n > 0) return n * C.METERS_PER_LEVEL;
    }
    return C.DEFAULT_BUILDING_H;
  };

  S.shadowOffset = function (heightM, sun) {
    if (sun.isLow) return [0, 0];
    const L = Math.min(heightM / Math.tan((sun.elevationDeg * Math.PI) / 180), C.MAX_SHADOW_LEN_M);
    const dir = ((sun.azimuthDeg + 180) * Math.PI) / 180;
    return [L * Math.sin(dir), L * Math.cos(dir)]; // [dx east, dy north]
  };

  // casters: [{ring: [[x,y],...], h: meters}]  ->  ShadeIndex
  S.buildIndex = function (casters, sun) {
    const polys = [];
    if (!sun.isLow) {
      for (const c of casters) {
        const [dx, dy] = S.shadowOffset(c.h, sun);
        const moved = c.ring.map(([x, y]) => [x + dx, y + dy]);
        const hull = G.convexHull(c.ring.concat(moved));
        if (hull.length >= 3) polys.push({ ring: hull, bbox: G.bboxOfRing(hull) });
      }
    }
    // spatial grid buckets
    const cell = C.GRID_CELL_M, grid = new Map();
    polys.forEach((p, i) => {
      const [minx, miny, maxx, maxy] = p.bbox;
      for (let gx = Math.floor(minx / cell); gx <= Math.floor(maxx / cell); gx++)
        for (let gy = Math.floor(miny / cell); gy <= Math.floor(maxy / cell); gy++) {
          const k = gx + ":" + gy;
          if (!grid.has(k)) grid.set(k, []);
          grid.get(k).push(i);
        }
    });
    return { polys, grid, cell, count: polys.length, isLow: sun.isLow };
  };

  S.pointShaded = function (index, x, y) {
    if (index.isLow) return true;
    const k = Math.floor(x / index.cell) + ":" + Math.floor(y / index.cell);
    const bucket = index.grid.get(k);
    if (!bucket) return false;
    for (const i of bucket) {
      const p = index.polys[i];
      const b = p.bbox;
      if (x < b[0] || x > b[2] || y < b[1] || y > b[3]) continue;
      if (G.pointInPolygon(x, y, p.ring)) return true;
    }
    return false;
  };

  // Fraction of the polyline length in the SUN (1 = full sun), sampled every SAMPLE_STEP_M.
  S.sunFraction = function (index, pts) {
    if (index.isLow) return 0;
    if (index.count === 0) return 1;
    let total = 0, shaded = 0;
    for (let i = 1; i < pts.length; i++) {
      const [x1, y1] = pts[i - 1], [x2, y2] = pts[i];
      const segLen = Math.hypot(x2 - x1, y2 - y1);
      const n = Math.max(1, Math.round(segLen / C.SAMPLE_STEP_M));
      for (let s = 0; s < n; s++) {
        const t = (s + 0.5) / n;
        if (S.pointShaded(index, x1 + (x2 - x1) * t, y1 + (y2 - y1) * t)) shaded += segLen / n;
        total += segLen / n;
      }
    }
    return total === 0 ? 1 : Math.max(0, Math.min(1, 1 - shaded / total));
  };

  window.SOMBRA.shadows = S;
})();
