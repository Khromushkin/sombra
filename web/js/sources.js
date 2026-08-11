// Live data sources: Overpass (OSM), Catastro INSPIRE WFS, Photon geocoding.
// Every fetch reports into SOMBRA.sourceStatus for the fact-check panel.
(function () {
  const C = SOMBRA.config;
  const SRC = {};

  SOMBRA.sourceStatus = {
    osm: { state: "idle" },
    catastro: { state: "idle" },
    photon: { state: "idle" },
    lidar: { state: "roadmap" },
    sun: { state: "ok", detail: "SunCalc (астрономия)" },
  };
  const listeners = [];
  SRC.onStatus = (fn) => listeners.push(fn);
  function report(name, state, detail) {
    SOMBRA.sourceStatus[name] = { state, detail };
    listeners.forEach((fn) => fn(name, SOMBRA.sourceStatus[name]));
  }
  SRC.report = report;

  // ---- Overpass ----------------------------------------------------------
  SRC.fetchCorridor = async function (bbox) {
    // bbox: [south, west, north, east]
    const [s, w, n, e] = bbox;
    const q = `[out:json][timeout:60];
(
  way["highway"](${s},${w},${n},${e});
  way["building"](${s},${w},${n},${e});
  relation["building"](${s},${w},${n},${e});
  node["natural"="tree"](${s},${w},${n},${e});
  way["natural"="tree_row"](${s},${w},${n},${e});
);
out geom;`;
    report("osm", "loading");
    let lastErr = null;
    for (const url of C.OVERPASS_URLS) {
      const t0 = performance.now();
      try {
        const resp = await fetch(url, {
          method: "POST",
          body: "data=" + encodeURIComponent(q),
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
        });
        if (!resp.ok) throw new Error("HTTP " + resp.status);
        const data = await resp.json();
        const parsed = parseOverpass(data);
        const ms = Math.round(performance.now() - t0);
        report("osm", "ok",
          `${parsed.ways.filter((w2) => w2.tags && w2.tags.highway).length} calles, ` +
          `${parsed.buildings.length} edificios, ${parsed.trees.length} árboles · ${ms} ms`);
        return parsed;
      } catch (err) {
        lastErr = err;
      }
    }
    report("osm", "error", String(lastErr));
    throw lastErr;
  };

  function parseOverpass(data) {
    const ways = [], buildings = [], trees = [];
    for (const el of data.elements || []) {
      if (el.type === "way" && el.geometry) {
        const coords = el.geometry.map((g) => [g.lon, g.lat]);
        const nodeIds = el.nodes || coords.map((c, i) => `${el.id}_${i}`);
        const w = { id: el.id, tags: el.tags || {}, coords, nodeIds };
        if (w.tags.highway) ways.push(w);
        if (w.tags.building) buildings.push({ ring: coords, tags: w.tags, source: "osm" });
        if (w.tags.natural === "tree_row") trees.push({ type: "row", coords });
      } else if (el.type === "relation" && el.tags && el.tags.building && el.members) {
        for (const m of el.members) {
          if (m.role === "outer" && m.geometry) {
            buildings.push({ ring: m.geometry.map((g) => [g.lon, g.lat]), tags: el.tags, source: "osm" });
          }
        }
      } else if (el.type === "node" && el.tags && el.tags.natural === "tree") {
        trees.push({ type: "point", coords: [[el.lon, el.lat]] });
      }
    }
    return { ways, buildings, trees };
  }

  // ---- Catastro INSPIRE WFS ---------------------------------------------
  // Returns building parts: [{ring: [[lon,lat],...], floors}]
  SRC.fetchCatastro = async function (bbox) {
    const [s, w, n, e] = bbox;
    const url = `${C.CATASTRO_WFS}?service=WFS&version=2.0.0&request=GetFeature` +
      `&typenames=bu:BuildingPart&srsname=urn:ogc:def:crs:EPSG::4326` +
      `&bbox=${s},${w},${n},${e},urn:ogc:def:crs:EPSG::4326&count=4000`;
    report("catastro", "loading");
    const t0 = performance.now();
    try {
      const resp = await fetch(url);
      if (!resp.ok) throw new Error("HTTP " + resp.status);
      const text = await resp.text();
      const parts = parseCatastroGML(text);
      const ms = Math.round(performance.now() - t0);
      if (parts.length === 0) throw new Error("0 building parts (¿fuera de cobertura?)");
      const withFloors = parts.filter((p) => p.floors > 0).length;
      report("catastro", "ok", `${parts.length} partes de edificio, ${withFloors} con nº de plantas · ${ms} ms`);
      return parts;
    } catch (err) {
      // CORS or service failure -> honest degradation to OSM-only heights
      report("catastro", "error", String(err).slice(0, 120));
      return [];
    }
  };

  function parseCatastroGML(text) {
    const doc = new DOMParser().parseFromString(text, "text/xml");
    const parts = [];
    const all = doc.getElementsByTagName("*");
    let current = null;
    for (let i = 0; i < all.length; i++) {
      const el = all[i];
      const ln = el.localName;
      if (ln === "BuildingPart") {
        if (current && current.ring) parts.push(current);
        current = { floors: 0, ring: null };
      } else if (current && ln === "numberOfFloorsAboveGround") {
        const v = parseInt(el.textContent.trim(), 10);
        if (isFinite(v)) current.floors = v;
      } else if (current && ln === "posList" && !current.ring) {
        const nums = el.textContent.trim().split(/\s+/).map(Number);
        const ring = [];
        // INSPIRE urn axis order: lat lon
        for (let j = 0; j + 1 < nums.length; j += 2) ring.push([nums[j + 1], nums[j]]);
        if (ring.length >= 3) current.ring = ring;
      }
    }
    if (current && current.ring) parts.push(current);
    return parts;
  }

  // ---- Photon geocoding --------------------------------------------------
  SRC.geocode = async function (q, near) {
    const p = new URLSearchParams({ q, limit: "5", lang: "es" });
    if (near) { p.set("lat", near[1]); p.set("lon", near[0]); }
    const t0 = performance.now();
    try {
      const resp = await fetch(`${C.PHOTON_URL}?${p}`);
      if (!resp.ok) throw new Error("HTTP " + resp.status);
      const data = await resp.json();
      report("photon", "ok", `Photon · ${Math.round(performance.now() - t0)} ms`);
      return (data.features || []).map((f) => ({
        name: [f.properties.name, f.properties.street, f.properties.city || f.properties.county]
          .filter(Boolean).join(", "),
        lon: f.geometry.coordinates[0],
        lat: f.geometry.coordinates[1],
      }));
    } catch (err) {
      report("photon", "error", String(err).slice(0, 100));
      return [];
    }
  };

  window.SOMBRA.sources = SRC;
})();
