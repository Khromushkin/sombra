# Sombra PWA (static, zero backend)

Fully static web app: the **browser itself** talks to every data source, so hosting is any
static file server. Works anywhere in Spain (and mostly anywhere OSM has buildings).

Live sources (visible in the in-app "Fuentes de datos" panel):

* **OpenStreetMap / Overpass** — streets, building footprints, trees (CORS-open).
* **Catastro INSPIRE WFS** — `BuildingPart.numberOfFloorsAboveGround`, real floor counts for
  Spanish buildings. If the service or CORS fails, the app degrades to OSM heights and says so.
* **Photon** — geocoding.
* **SunCalc** — solar position (pure astronomy, in-browser).
* **PNOA-LiDAR** — tree canopies: precomputed local layer (`data/canopy_valencia.geojson`),
  pipeline in `../scripts/lidar_canopy.py`. Until the file exists the panel shows "next phase".

## Activating ALL sources (POC fact-check)

Two one-off commands on any machine with open internet, then commit + push:

```bash
# 1. Catastro: real floor counts for Valencia -> local layer (turns the source green)
pip install requests pyproj
python scripts/fetch_catastro.py --municipality 46900 \
    --bbox -0.42 39.44 -0.33 39.50 -o web/data/catastro_valencia.json
#    -> 178 529 building parts, 21 MB (4.3 MB over the wire, Pages gzips).
#    Re-running? The municipality zip is ~33 MB and slow; download it once and pass
#    --zip A.ES.SDGC.BU.46900.zip to skip steps 1-3.

# 2. PNOA-LiDAR: download 1-2 LAZ tiles covering central Valencia from
#    https://centrodedescargas.cnig.es (search "LiDAR", zoom to Valencia; the download
#    centre is interactive -- there is no scriptable direct URL), then:
pip install 'laspy[lazrs]' numpy shapely pyproj
python scripts/lidar_canopy.py PNOA*.laz -o web/data/canopy_valencia.geojson \
    --bbox -0.42 39.44 -0.33 39.50

git add web/data && git commit -m "data: Catastro + LiDAR local layers (Valencia)" && git push
```

The baked Catastro layer stores each part's **convex hull** rather than its raw ring: the shade
engine builds every shadow as `convexHull(footprint ∪ translated footprint)`, so the hull yields
identical shadows at half the vertices (41 MB → 21 MB). Coordinates keep 6 decimals (~0.11 m),
matching Catastro's own stated geometry accuracy — don't round further, parts are small
(median ~19 m²) and 1 m quantisation would visibly distort their shadows.

Regenerating a data layer that is already deployed? Bump `CACHE` in `sw.js` too — the service
worker is cache-first for everything same-origin, `data/` included.

The Catastro source also tries the live WFS on every request (direct, then via public
CORS proxies) for areas outside the precomputed layer.

## Run locally

```bash
cd web
python3 -m http.server 8080
# open http://localhost:8080
```

## Deploy (pick one, ~2 minutes)

* **GitHub Pages**: push the repo, Settings → Pages → deploy from branch, folder `/web`
  (or copy `web/` into a `gh-pages` branch root).
* **Cloudflare Pages / Netlify / Vercel**: create a project, set the output/publish
  directory to `web`, no build command.
* Any nginx/static hosting: `cp -r web/* /var/www/...`.

HTTPS is required for the service worker (installable PWA) and geolocation — all the hosts
above give it automatically.

## Notes

* Basemap: OpenFreeMap `liberty` style (no API key). Falls back to raster OSM tiles if the
  style fails to load.
* All routing and shadow math runs client-side (`js/shadows.js`, `js/router.js`):
  shadow polygon = convex hull of footprint + footprint translated by `h/tan(sun elevation)`
  away from the sun; per-edge sun exposure sampled every 4 m; A* with
  `cost = length × (1 + k × sun_fraction)`.
* Tested end-to-end with Playwright against real OSM data (Monaco extract) and a mock
  Catastro WFS response; see `../webtest` notes in the repo history.
