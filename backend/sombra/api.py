"""Sombra FastAPI app."""
from __future__ import annotations

import logging
import time
from datetime import datetime
from typing import Literal
from zoneinfo import ZoneInfo

import httpx
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from . import config
from .data import DataUnavailable, get_corridor, straight_line_km
from .router import RoutingError, compute_route, prepare

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")
log = logging.getLogger("sombra.api")

app = FastAPI(title="Sombra", version="0.1.0", description="Shade-first walking & cycling routes for Spain")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


class LatLon(BaseModel):
    lat: float = Field(ge=-90, le=90)
    lon: float = Field(ge=-180, le=180)


class RouteRequest(BaseModel):
    origin: LatLon
    destination: LatLon
    mode: Literal["walk", "bike"] = "walk"
    depart_at: datetime | None = None
    shade_preference: float = Field(default=0.5, ge=0.0, le=1.0)


@app.get("/health")
def health():
    return {"ok": True}


@app.post("/api/route")
def route(req: RouteRequest):
    t0 = time.perf_counter()
    o = (req.origin.lat, req.origin.lon)
    d = (req.destination.lat, req.destination.lon)

    dist_km = straight_line_km(o, d)
    limit = config.MAX_WALK_KM if req.mode == "walk" else config.MAX_BIKE_KM
    if dist_km > limit:
        raise HTTPException(
            status_code=422,
            detail=f"Route too long for MVP: {dist_km:.1f} km straight-line "
                   f"(limit for {req.mode}: {limit:.0f} km). Pick closer points.",
        )
    if dist_km < 0.02:
        raise HTTPException(status_code=422, detail="Origin and destination are (almost) the same point.")

    when = req.depart_at or datetime.now(ZoneInfo(config.DEFAULT_TZ))
    if when.tzinfo is None:
        when = when.replace(tzinfo=ZoneInfo(config.DEFAULT_TZ))
    # Quantize to the cache time bucket
    when = when.replace(minute=(when.minute // config.TIME_BUCKET_MIN) * config.TIME_BUCKET_MIN, second=0, microsecond=0)

    try:
        corridor = get_corridor(o, d, req.mode)
    except DataUnavailable as exc:
        raise HTTPException(status_code=503, detail=f"Map data temporarily unavailable, please retry: {exc}")

    t_fetch = time.perf_counter()
    try:
        prep = prepare(corridor, when)
        shady = compute_route(prep, o, d, req.mode, req.shade_preference, kind="shady")
        fastest = compute_route(prep, o, d, req.mode, req.shade_preference, kind="fastest")
    except RoutingError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    t_done = time.perf_counter()

    log.info(
        "route %s %.4f,%.4f -> %.4f,%.4f | fetch %.2fs compute %.2fs | sun elev %.1f | shadows %d | shade %.0f%% vs %.0f%%",
        req.mode, o[0], o[1], d[0], d[1], t_fetch - t0, t_done - t_fetch,
        prep.sun.elevation_deg, prep.shade_count, shady.shade_pct, fastest.shade_pct,
    )

    def as_dict(r):
        return {
            "kind": r.kind,
            "geometry": {"type": "LineString", "coordinates": r.coords},
            "distance_m": r.distance_m,
            "duration_min": r.duration_min,
            "shade_pct": r.shade_pct,
            "segments": r.segments,
        }

    return {
        "routes": [as_dict(shady), as_dict(fastest)],
        "sun": {
            "elevation_deg": round(prep.sun.elevation_deg, 2),
            "azimuth_deg": round(prep.sun.azimuth_deg, 2),
            "is_low_sun": prep.sun.is_low,
        },
        "computed_for": when.isoformat(),
        "timings": {"fetch_s": round(t_fetch - t0, 2), "compute_s": round(t_done - t_fetch, 2), **prep.timings},
    }


@app.get("/api/geocode")
async def geocode(q: str = Query(min_length=2), lat: float | None = None, lon: float | None = None):
    params: dict = {"q": q, "limit": 5, "lang": "es"}
    if lat is not None and lon is not None:
        params.update({"lat": lat, "lon": lon})
    try:
        async with httpx.AsyncClient(timeout=8) as client:
            resp = await client.get(config.PHOTON_URL, params=params, headers={"User-Agent": "sombra-mvp/0.1"})
            resp.raise_for_status()
            data = resp.json()
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"Geocoder unavailable: {exc}")

    w, s, e, n = config.SPAIN_BBOX
    results = []
    for f in data.get("features", []):
        p = f.get("properties", {})
        gl = f.get("geometry", {}).get("coordinates", [None, None])
        if gl[0] is None:
            continue
        in_spain = w <= gl[0] <= e and s <= gl[1] <= n
        name = ", ".join(x for x in [p.get("name"), p.get("street"), p.get("city") or p.get("county")] if x)
        results.append({"name": name or q, "lat": gl[1], "lon": gl[0], "city": p.get("city"), "in_spain": in_spain})
    # Spain-biased ranking
    results.sort(key=lambda r: (not r["in_spain"]))
    return {"results": results[:5]}
