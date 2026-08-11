// Local planar projection + small geometry helpers (all distances in meters).
(function () {
  const G = {};

  G.makeProjection = function (lat0, lon0) {
    const kx = 111320 * Math.cos((lat0 * Math.PI) / 180);
    const ky = 110574;
    return {
      toXY: (lon, lat) => [(lon - lon0) * kx, (lat - lat0) * ky],
      toLonLat: (x, y) => [x / kx + lon0, y / ky + lat0],
    };
  };

  G.haversineKm = function (lat1, lon1, lat2, lon2) {
    const r = 6371.0088, rad = Math.PI / 180;
    const dlat = (lat2 - lat1) * rad, dlon = (lon2 - lon1) * rad;
    const a = Math.sin(dlat / 2) ** 2 +
      Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dlon / 2) ** 2;
    return 2 * r * Math.asin(Math.sqrt(a));
  };

  G.pathLength = function (pts) {
    let L = 0;
    for (let i = 1; i < pts.length; i++) L += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    return L;
  };

  // Andrew's monotone chain convex hull. pts: [[x,y],...] -> hull ring (no repeat of first point)
  G.convexHull = function (pts) {
    const p = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    if (p.length <= 2) return p;
    const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
    const lower = [];
    for (const q of p) {
      while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop();
      lower.push(q);
    }
    const upper = [];
    for (let i = p.length - 1; i >= 0; i--) {
      const q = p[i];
      while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop();
      upper.push(q);
    }
    lower.pop(); upper.pop();
    return lower.concat(upper);
  };

  G.pointInPolygon = function (x, y, ring) {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
      if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  };

  G.bboxOfRing = function (ring) {
    let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
    for (const [x, y] of ring) {
      if (x < minx) minx = x; if (x > maxx) maxx = x;
      if (y < miny) miny = y; if (y > maxy) maxy = y;
    }
    return [minx, miny, maxx, maxy];
  };

  // Regular n-gon approximating a circle
  G.circleRing = function (cx, cy, r, n = 8) {
    const ring = [];
    for (let i = 0; i < n; i++) {
      const a = (2 * Math.PI * i) / n;
      ring.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
    }
    return ring;
  };

  window.SOMBRA.geo = G;
})();
