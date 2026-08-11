// Sombra PWA — main application.
(function () {
  const C = SOMBRA.config, G = SOMBRA.geo, S = SOMBRA.shadows, R = SOMBRA.router, SRC = SOMBRA.sources;

  // ---- i18n --------------------------------------------------------------
  const STRINGS = {
    es: {
      tagline: "Rutas por la sombra · España",
      origin: "¿Desde dónde?", destination: "¿A dónde vas?",
      myLocation: "Mi ubicación", tapHint: "Toca el mapa: 1º origen, 2º destino",
      walk: "A pie", bike: "En bici", faster: "Más rápido", shadier: "Más sombra",
      now: "Ahora", find: "Buscar ruta a la sombra", computing: "Calculando sombras…",
      inShade: "a la sombra", vsFastest: "vs la más rápida", fastestHas: "que tiene",
      lowSun: "☁️ El sol está bajo — todo el camino va a la sombra",
      tooFar: "Demasiado lejos para el MVP. Elige puntos más cercanos.",
      samePoint: "Origen y destino casi coinciden.",
      dataError: "No se pudieron cargar los datos de OpenStreetMap. Reintenta en unos segundos.",
      noRoute: "No se encontró ruta entre esos puntos.",
      sources: "Fuentes de datos en vivo", clear: "Limpiar",
      min: "min",
      srcNames: {
        osm: "OpenStreetMap (Overpass)", catastro: "Catastro INSPIRE (nº de plantas)",
        photon: "Geocodificación (Photon)", sun: "Posición solar", lidar: "PNOA-LiDAR (copas de árboles)",
      },
      srcStates: { idle: "—", loading: "cargando…", ok: "✓", error: "sin conexión (fallback OSM)", roadmap: "pipeline listo · siguiente fase" },
    },
    ru: {
      tagline: "Маршруты через тень · Испания",
      origin: "Откуда?", destination: "Куда идём?",
      myLocation: "Моя геопозиция", tapHint: "Тапни по карте: 1-й тап — старт, 2-й — финиш",
      walk: "Пешком", bike: "Велосипед", faster: "Быстрее", shadier: "Больше тени",
      now: "Сейчас", find: "Найти маршрут через тень", computing: "Считаю тени…",
      inShade: "пути в тени", vsFastest: "к самому быстрому", fastestHas: "у него",
      lowSun: "☁️ Солнце низко — весь путь в тени",
      tooFar: "Слишком далеко для MVP. Выбери точки ближе.",
      samePoint: "Старт и финиш почти совпадают.",
      dataError: "Не удалось загрузить данные OpenStreetMap. Попробуй ещё раз через пару секунд.",
      noRoute: "Маршрут между точками не найден.",
      sources: "Живые источники данных", clear: "Сброс",
      min: "мин",
      srcNames: {
        osm: "OpenStreetMap (Overpass)", catastro: "Кадастр INSPIRE (этажность)",
        photon: "Геокодинг (Photon)", sun: "Положение солнца", lidar: "PNOA-LiDAR (кроны деревьев)",
      },
      srcStates: { idle: "—", loading: "загрузка…", ok: "✓", error: "недоступен (fallback на OSM)", roadmap: "пайплайн готов · след. фаза" },
    },
  };
  let lang = (navigator.language || "es").startsWith("ru") ? "ru" : "es";
  const t = (k) => STRINGS[lang][k];

  // ---- state -------------------------------------------------------------
  const state = {
    origin: null, dest: null, mode: "walk", shade: 0.5, departIdx: 0,
    busy: false, lastFetch: null, // {bboxKey, data, catastro}
  };
  const DEPART = [
    { label: () => t("now"), hours: 0 },
    { label: () => "+1 h", hours: 1 },
    { label: () => "+2 h", hours: 2 },
    { label: () => "18:00", fixed: 18 },
  ];
  const departDate = () => {
    const c = DEPART[state.departIdx];
    const d = new Date();
    if (c.hours) d.setTime(d.getTime() + c.hours * 3600e3);
    else if (c.fixed != null) {
      d.setHours(c.fixed, 0, 0, 0);
      if (d.getTime() < Date.now() - 60e3) d.setDate(d.getDate() + 1);
    }
    return d;
  };

  // ---- map ---------------------------------------------------------------
  const FALLBACK_STYLE = {
    version: 8,
    sources: { osm: { type: "raster", tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"], tileSize: 256, attribution: "© OpenStreetMap" } },
    layers: [{ id: "osm", type: "raster", source: "osm" }],
  };
  const map = new maplibregl.Map({
    container: "map", style: C.BASEMAP_STYLE,
    center: C.DEFAULT_CENTER, zoom: C.DEFAULT_ZOOM, attributionControl: { compact: true },
  });
  map.on("error", (e) => {
    if (e && e.error && /style|Failed to fetch|NetworkError/i.test(String(e.error.message)) && !map.__fellBack) {
      map.__fellBack = true;
      try { map.setStyle(FALLBACK_STYLE); } catch (_) {}
    }
  });
  let originMarker = null, destMarker = null;

  const GJ = (features) => ({ type: "FeatureCollection", features });
  const line = (coords, props = {}) => ({ type: "Feature", properties: props, geometry: { type: "LineString", coordinates: coords } });
  const poly = (ring, props = {}) => ({ type: "Feature", properties: props, geometry: { type: "Polygon", coordinates: [ring.concat([ring[0]])] } });

  function ensureLayers() {
    if (map.getSource("shadows")) return;
    map.addSource("shadows", { type: "geojson", data: GJ([]) });
    map.addLayer({ id: "shadows", type: "fill", source: "shadows", paint: { "fill-color": C.COLORS.shadow, "fill-opacity": 0.16 } });
    map.addSource("ghost", { type: "geojson", data: GJ([]) });
    map.addLayer({ id: "ghost", type: "line", source: "ghost", paint: { "line-color": C.COLORS.ghost, "line-width": 3, "line-dasharray": [2, 2] } });
    map.addSource("route", { type: "geojson", data: GJ([]) });
    map.addLayer({
      id: "route", type: "line", source: "route",
      layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-color": ["case", ["get", "shaded"], C.COLORS.shade, C.COLORS.sun], "line-width": 5.5 },
    });
  }
  map.on("load", ensureLayers);
  map.on("styledata", () => { try { ensureLayers(); } catch (_) {} });

  map.on("click", (e) => {
    const p = [e.lngLat.lng, e.lngLat.lat];
    if (!state.origin) setOrigin(p, `${p[1].toFixed(4)}, ${p[0].toFixed(4)}`);
    else setDest(p, `${p[1].toFixed(4)}, ${p[0].toFixed(4)}`);
    maybeRoute();
  });

  function setOrigin(p, label) {
    state.origin = p;
    el("originInput").value = label || "";
    if (originMarker) originMarker.remove();
    originMarker = new maplibregl.Marker({ color: "#16a34a" }).setLngLat(p).addTo(map);
  }
  function setDest(p, label) {
    state.dest = p;
    el("destInput").value = label || "";
    if (destMarker) destMarker.remove();
    destMarker = new maplibregl.Marker({ color: "#dc2626" }).setLngLat(p).addTo(map);
  }

  // ---- compute -----------------------------------------------------------
  function corridorBBox(o, d) {
    const distM = G.haversineKm(o[1], o[0], d[1], d[0]) * 1000;
    const buf = Math.max(C.MIN_BUFFER_M, C.BUFFER_FRACTION * distM);
    const meanLat = (o[1] + d[1]) / 2;
    const dlat = buf / 110574, dlon = buf / (111320 * Math.max(0.1, Math.cos((meanLat * Math.PI) / 180)));
    return [Math.min(o[1], d[1]) - dlat, Math.min(o[0], d[0]) - dlon,
            Math.max(o[1], d[1]) + dlat, Math.max(o[0], d[0]) + dlon];
  }

  async function compute() {
    if (!state.origin || !state.dest || state.busy) return;
    const o = state.origin, d = state.dest;
    const distKm = G.haversineKm(o[1], o[0], d[1], d[0]);
    const limit = state.mode === "walk" ? C.MAX_WALK_KM : C.MAX_BIKE_KM;
    if (distKm < 0.02) return showError(t("samePoint"));
    if (distKm > limit) return showError(t("tooFar"));

    state.busy = true; showBusy(true); showError(null);
    try {
      const bbox = corridorBBox(o, d);
      const bboxKey = bbox.map((v) => v.toFixed(3)).join(",");
      let data, catastro;
      if (state.lastFetch && state.lastFetch.bboxKey === bboxKey) {
        ({ data, catastro } = state.lastFetch);
      } else {
        [data, catastro] = await Promise.all([SRC.fetchCorridor(bbox), SRC.fetchCatastro(bbox)]);
        state.lastFetch = { bboxKey, data, catastro };
      }

      const proj = G.makeProjection((bbox[0] + bbox[2]) / 2, (bbox[1] + bbox[3]) / 2);
      const when = departDate();
      const sun = S.sunPosition((bbox[0] + bbox[2]) / 2, (bbox[1] + bbox[3]) / 2, when);
      SRC.report("sun", "ok", `elev ${sun.elevationDeg.toFixed(1)}° · az ${sun.azimuthDeg.toFixed(0)}°`);

      // Shadow casters: Catastro building parts (real floor counts) layered on top of
      // all OSM footprints (explicit tags or default height). Overlaps are harmless --
      // the shade test is point-in-any-polygon.
      const casters = [];
      for (const p of (catastro || [])) {
        if (p.floors > 0) casters.push({ ring: p.ring.map((c) => proj.toXY(c[0], c[1])), h: p.floors * C.METERS_PER_LEVEL });
      }
      for (const b of data.buildings) {
        casters.push({ ring: b.ring.map((c) => proj.toXY(c[0], c[1])), h: S.parseHeight(b.tags) });
      }
      for (const tr of data.trees) {
        if (tr.type === "point") {
          const [x, y] = proj.toXY(tr.coords[0][0], tr.coords[0][1]);
          casters.push({ ring: G.circleRing(x, y, C.TREE_R), h: C.TREE_H });
        } else {
          const pts = tr.coords.map((c) => proj.toXY(c[0], c[1]));
          for (let i = 0; i < pts.length; i += 1) casters.push({ ring: G.circleRing(pts[i][0], pts[i][1], 3), h: C.TREE_H });
        }
      }

      const index = S.buildIndex(casters, sun);
      const graph = R.buildGraph(data.ways, state.mode, proj);
      if (!graph.edges.length) return showError(t("dataError"));
      R.annotateShade(graph, index);

      const [ox, oy] = proj.toXY(o[0], o[1]);
      const [dx, dy] = proj.toXY(d[0], d[1]);
      const src = R.nearestNode(graph, ox, oy), dst = R.nearestNode(graph, dx, dy);
      const k = state.shade * C.MAX_SHADE_WEIGHT;
      const shady = R.route(graph, src, dst, sun.isLow ? 0 : k);
      const fastest = R.route(graph, src, dst, 0);
      if (!shady || !fastest) return showError(t("noRoute"));
      if (sun.isLow) { shady.shadePct = 100; fastest.shadePct = 100; }

      renderResult(shady, fastest, index, proj, sun);
    } catch (err) {
      console.error(err);
      showError(t("dataError"));
    } finally {
      state.busy = false; showBusy(false);
    }
  }

  function renderResult(shady, fastest, index, proj, sun) {
    ensureLayers();
    const shadowFeats = index.polys.slice(0, 8000).map((p) => poly(p.ring.map(([x, y]) => proj.toLonLat(x, y))));
    map.getSource("shadows").setData(GJ(shadowFeats));
    map.getSource("ghost").setData(GJ([line(fastest.coords)]));
    map.getSource("route").setData(GJ(shady.segments.map((s) => line(s.coords, { shaded: s.shaded }))));

    const speed = (state.mode === "walk" ? C.WALK_KMH : C.BIKE_KMH) * 1000 / 60;
    const durS = shady.distanceM / speed, durF = fastest.distanceM / speed;
    const extra = Math.max(0, Math.round(durS - durF));
    const stats = el("stats");
    stats.style.display = "block";
    if (sun.isLow) {
      stats.innerHTML = `<div class="stat-line">${t("lowSun")}</div>
        <div class="stat-sub">${Math.round(durS)} ${t("min")} · ${(shady.distanceM / 1000).toFixed(1)} km</div>`;
    } else {
      stats.innerHTML = `<div class="stat-line">${Math.round(durS)} ${t("min")} · ${(shady.distanceM / 1000).toFixed(1)} km ·
          <span class="pct">🌳 ${Math.round(shady.shadePct)}% ${t("inShade")}</span></div>
        <div class="chip-cmp">+${extra} ${t("min")} ${t("vsFastest")} (${t("fastestHas")} ${Math.round(fastest.shadePct)}%)</div>`;
    }

    const allCoords = shady.coords.concat(fastest.coords);
    const lons = allCoords.map((c) => c[0]), lats = allCoords.map((c) => c[1]);
    map.fitBounds([[Math.min(...lons), Math.min(...lats)], [Math.max(...lons), Math.max(...lats)]],
      { padding: { top: 60, bottom: 320, left: 40, right: 40 }, duration: 500 });
  }

  const maybeRoute = () => { if (state.origin && state.dest) compute(); };

  // ---- UI wiring ---------------------------------------------------------
  const el = (id) => document.getElementById(id);
  function showError(msg) {
    const e = el("error");
    e.style.display = msg ? "block" : "none";
    e.textContent = msg || "";
  }
  function showBusy(b) {
    el("cta").textContent = b ? t("computing") : t("find");
    el("cta").disabled = b;
  }

  function bindSearch(inputId, dropId, setter) {
    const input = el(inputId), drop = el(dropId);
    let timer = null;
    input.addEventListener("input", () => {
      clearTimeout(timer);
      const q = input.value.trim();
      if (q.length < 3) { drop.style.display = "none"; return; }
      timer = setTimeout(async () => {
        const res = await SRC.geocode(q, map.getCenter().toArray());
        drop.innerHTML = "";
        res.forEach((r) => {
          const div = document.createElement("div");
          div.className = "drop-item";
          div.textContent = r.name;
          div.onclick = () => {
            setter([r.lon, r.lat], r.name);
            drop.style.display = "none";
            map.flyTo({ center: [r.lon, r.lat], zoom: 15 });
            maybeRoute();
          };
          drop.appendChild(div);
        });
        drop.style.display = res.length ? "block" : "none";
      }, 350);
    });
    document.addEventListener("click", (ev) => { if (!drop.contains(ev.target) && ev.target !== input) drop.style.display = "none"; });
  }

  function renderSourcesPanel() {
    const box = el("sourcesList");
    box.innerHTML = "";
    for (const key of ["osm", "catastro", "photon", "sun", "lidar"]) {
      const st = SOMBRA.sourceStatus[key];
      const row = document.createElement("div");
      row.className = "src-row src-" + st.state;
      const mark = st.state === "ok" ? "🟢" : st.state === "loading" ? "🟡" : st.state === "error" ? "🔴" : st.state === "roadmap" ? "🔵" : "⚪";
      row.innerHTML = `<span class="src-mark">${mark}</span><span class="src-name">${t("srcNames")[key]}</span>
        <span class="src-detail">${st.detail || t("srcStates")[st.state]}</span>`;
      box.appendChild(row);
    }
  }
  SRC.onStatus(renderSourcesPanel);

  function applyLang() {
    el("tagline").textContent = t("tagline");
    el("originInput").placeholder = t("origin");
    el("destInput").placeholder = t("destination");
    el("locBtn").textContent = "📍 " + t("myLocation");
    el("hint").textContent = t("tapHint");
    el("modeWalk").textContent = "🚶 " + t("walk");
    el("modeBike").textContent = "🚴 " + t("bike");
    el("lblFaster").textContent = t("faster");
    el("lblShadier").textContent = t("shadier") + " 🌳";
    el("cta").textContent = t("find");
    el("sourcesTitle").textContent = "🔍 " + t("sources");
    el("clearBtn").textContent = t("clear");
    document.querySelectorAll(".depart-chip").forEach((c, i) => (c.textContent = DEPART[i].label()));
    renderSourcesPanel();
  }

  // events
  el("modeWalk").onclick = () => { state.mode = "walk"; el("modeWalk").classList.add("active"); el("modeBike").classList.remove("active"); state.lastFetch = null; maybeRoute(); };
  el("modeBike").onclick = () => { state.mode = "bike"; el("modeBike").classList.add("active"); el("modeWalk").classList.remove("active"); state.lastFetch = null; maybeRoute(); };
  el("shadeSlider").oninput = (e) => { state.shade = parseFloat(e.target.value); };
  el("shadeSlider").onchange = () => maybeRoute();
  document.querySelectorAll(".depart-chip").forEach((c, i) => {
    c.onclick = () => {
      state.departIdx = i;
      document.querySelectorAll(".depart-chip").forEach((x) => x.classList.remove("active"));
      c.classList.add("active");
      maybeRoute();
    };
  });
  el("cta").onclick = compute;
  el("clearBtn").onclick = () => {
    state.origin = state.dest = null;
    el("originInput").value = el("destInput").value = "";
    if (originMarker) originMarker.remove();
    if (destMarker) destMarker.remove();
    ["route", "ghost", "shadows"].forEach((s) => map.getSource(s) && map.getSource(s).setData(GJ([])));
    el("stats").style.display = "none";
    showError(null);
  };
  el("locBtn").onclick = () => {
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const p = [pos.coords.longitude, pos.coords.latitude];
        setOrigin(p, t("myLocation"));
        map.flyTo({ center: p, zoom: 15 });
        maybeRoute();
      },
      () => showError(t("dataError"))
    );
  };
  el("langEs").onclick = () => { lang = "es"; el("langEs").classList.add("active"); el("langRu").classList.remove("active"); applyLang(); };
  el("langRu").onclick = () => { lang = "ru"; el("langRu").classList.add("active"); el("langEs").classList.remove("active"); applyLang(); };
  el("sourcesTitle").onclick = () => {
    const b = el("sourcesList");
    b.style.display = b.style.display === "none" ? "block" : "none";
  };

  bindSearch("originInput", "originDrop", setOrigin);
  bindSearch("destInput", "destDrop", setDest);
  if (lang === "ru") { el("langRu").classList.add("active"); el("langEs").classList.remove("active"); }
  applyLang();

  // PWA service worker
  if ("serviceWorker" in navigator && location.protocol === "https:") {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }

  // Expose for testing
  window.SOMBRA.app = { state, compute, setOrigin, setDest, map };
})();
