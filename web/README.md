# Sombra PWA (static, zero backend)

Fully static web app: the **browser itself** talks to every data source, so hosting is any
static file server. Works anywhere in Spain (and mostly anywhere OSM has buildings).

Live sources (visible in the in-app "Fuentes de datos" panel):

* **OpenStreetMap / Overpass** — streets, building footprints, trees (CORS-open).
* **Catastro INSPIRE WFS** — `BuildingPart.numberOfFloorsAboveGround`, real floor counts for
  Spanish buildings. If the service or CORS fails, the app degrades to OSM heights and says so.
* **Photon** — geocoding.
* **SunCalc** — solar position (pure astronomy, in-browser).
* **PNOA-LiDAR** — tree canopies: precomputed layer, pipeline in `../scripts/lidar_canopy.py`
  (marked "next phase" in the panel).

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
