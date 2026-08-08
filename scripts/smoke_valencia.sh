#!/usr/bin/env bash
# Valencia smoke test -- run on a machine with open internet (uses Overpass API).
# Plaza del Ayuntamiento -> Ciudad de las Artes y las Ciencias, 14:00 vs 19:00.
API=${API:-http://localhost:8000}
for T in "14:00" "19:00"; do
  echo "== depart $T =="
  curl -s -X POST "$API/api/route" -H 'Content-Type: application/json' -d '{
    "origin": {"lat": 39.4699, "lon": -0.3763},
    "destination": {"lat": 39.4561, "lon": -0.3545},
    "mode": "walk",
    "depart_at": "2026-08-10T'"$T"':00+02:00",
    "shade_preference": 1.0
  }' | python3 -c "import sys,json; d=json.load(sys.stdin); [print(r['kind'], r['distance_m'],'m', r['duration_min'],'min', r['shade_pct'],'% shade') for r in d['routes']]"
done
echo "== Sevilla (no code changes) =="
curl -s -X POST "$API/api/route" -H 'Content-Type: application/json' -d '{
  "origin": {"lat": 37.3891, "lon": -5.9845},
  "destination": {"lat": 37.3826, "lon": -5.9963},
  "mode": "walk", "shade_preference": 1.0
}' | python3 -c "import sys,json; d=json.load(sys.stdin); [print(r['kind'], r['distance_m'],'m', r['shade_pct'],'% shade') for r in d['routes']]"
