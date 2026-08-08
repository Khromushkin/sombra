# 🌳 Sombra

Shade-first walking & cycling routes for Spain. Pick A and B — Sombra computes how building
and tree shadows fall at your departure time and routes you through the shade, showing what
percent of the path is shaded vs the fastest route.

Inspired by the Korean shade-routing apps that took off during the 2026 heatwaves.

## How it works

No citywide precomputation. Per request:

1. A corridor bbox is built around origin/destination (buffered envelope).
2. Street graph + buildings + trees for that bbox come from OpenStreetMap
   (Overpass API by default, or a local `.osm.pbf` — see providers below) and are disk-cached.
3. Sun elevation/azimuth for the departure time (astral). Each building casts a shadow polygon:
   `length = height / tan(elevation)`, direction = azimuth + 180°. Heights: `height` tag →
   `building:levels × 3.2 m` → 9 m default. Trees cast capsule shadows.
4. Every edge gets a `sun_fraction` (share of its length in the sun).
5. Dijkstra with `cost = length × (1 + k × sun_fraction)` where `k` comes from the shade
   slider. Two routes are returned: **shady** and **fastest** (k = 0), with shaded/sunny
   display segments.

If the sun is below ~3°, everything counts as shade and the fastest route is returned with a
friendly note.

## Backend

```bash
cd backend
pip install -r requirements.txt
make dev          # uvicorn on :8000
make test         # pytest (shadow-engine unit tests)
```

Endpoints: `POST /api/route`, `GET /api/geocode?q=...` (Photon proxy, Spain-biased), `GET /health`.

Request:

```json
{
  "origin": {"lat": 39.4699, "lon": -0.3763},
  "destination": {"lat": 39.4561, "lon": -0.3545},
  "mode": "walk",
  "depart_at": "2026-08-10T14:00:00+02:00",
  "shade_preference": 1.0
}
```

### Data providers

* **Overpass (default)** — works anywhere with zero setup. Needs open internet.
* **Local PBF** — `SOMBRA_PBF=/path/to/spain-latest.osm.pbf make dev` (pyrosm). Same code
  path used for offline tests (`backend/tests/fixtures/monaco.osm.pbf`).

### Smoke test (Valencia)

```bash
./scripts/smoke_valencia.sh
```

Plaza del Ayuntamiento → Ciudad de las Artes, walk, 14:00 vs 19:00 — `shade_pct` should
differ meaningfully, and at `shade_preference: 1.0` the shady route should deviate from the
fastest. A Sevilla route runs as the "second city, no code changes" check.

Verified offline against the Monaco fixture (dense Mediterranean city, 23k buildings):
14:00 → shady 30% shade vs fastest 11% (+18 m of distance); 19:30 → 74%; 23:00 → low-sun mode.

## App (Expo)

```bash
cd app
npm install
EXPO_PUBLIC_API_URL=http://<LAN-IP-of-backend>:8000 npx expo start
```

Scan the QR with Expo Go. Uses `react-native-maps` (works inside Expo Go — no dev build
needed). Set `EXPO_PUBLIC_API_URL` to your computer's LAN IP so the phone can reach the
backend. UI is Spanish-first with English fallback.

Status: typechecked (`npx tsc --noEmit`) — built in a cloud sandbox without a device;
first on-device run may need cosmetic tweaks.

## Roadmap

Catastro INSPIRE heights (real floor counts for ~all Spanish buildings) → PNOA LiDAR tree
canopies → precomputed top-10 cities → heat index + push "your walk home is 90% shaded in an
hour" → Latam/Africa via Google Open Buildings 2.5D.
