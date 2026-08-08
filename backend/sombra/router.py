"""Shade-aware routing over a corridor graph.

Pipeline: project graph to local UTM -> compute shadow index -> annotate each
edge with sun_fraction -> Dijkstra with cost = length * (1 + k * sun_fraction)
-> extract geometry, shade %, and shaded/sunny display segments.
"""
from __future__ import annotations

import logging
import time
from dataclasses import dataclass
from datetime import datetime

import networkx as nx
from pyproj import Transformer
from shapely.geometry import LineString, Point

from . import config
from .data import CorridorData
from .shadows import ShadeIndex, SunPosition, build_shade_index, sun_position

log = logging.getLogger("sombra.router")


class RoutingError(Exception):
    pass


@dataclass
class RouteResult:
    kind: str                 # "shady" | "fastest"
    coords: list              # [(lon, lat), ...]
    distance_m: float
    duration_min: float
    shade_pct: float
    segments: list            # [{"coords": [...], "shaded": bool}]


@dataclass
class PreparedCorridor:
    graph_proj: nx.MultiDiGraph
    to_wgs: Transformer
    sun: SunPosition
    shade_count: int
    timings: dict


def _edge_geometry(G: nx.MultiDiGraph, u, v, data) -> LineString:
    geom = data.get("geometry")
    if geom is not None:
        return geom
    return LineString([(G.nodes[u]["x"], G.nodes[u]["y"]), (G.nodes[v]["x"], G.nodes[v]["y"])])


def prepare(corridor: CorridorData, when: datetime) -> PreparedCorridor:
    """Project everything, compute per-edge sun fractions for `when`."""
    import osmnx as ox
    from shapely.ops import transform as shp_transform

    timings = {}
    t0 = time.perf_counter()

    center_lat = (corridor.bbox[1] + corridor.bbox[3]) / 2
    center_lon = (corridor.bbox[0] + corridor.bbox[2]) / 2
    sun = sun_position(center_lat, center_lon, when)

    G = ox.project_graph(corridor.graph)
    crs = G.graph["crs"]
    to_proj = Transformer.from_crs("EPSG:4326", crs, always_xy=True)
    to_wgs = Transformer.from_crs(crs, "EPSG:4326", always_xy=True)
    timings["project_s"] = round(time.perf_counter() - t0, 3)

    t1 = time.perf_counter()
    if sun.is_low:
        index = ShadeIndex([])
        shade_count = 0
    else:
        proj = lambda g: shp_transform(to_proj.transform, g)  # noqa: E731
        buildings = [(proj(geom), tags) for geom, tags in corridor.buildings]
        trees = [proj(g) for g in corridor.trees]
        index = build_shade_index(buildings, trees, sun)
        shade_count = index.count
    timings["shadows_s"] = round(time.perf_counter() - t1, 3)

    t2 = time.perf_counter()
    for u, v, k, data in G.edges(keys=True, data=True):
        geom = _edge_geometry(G, u, v, data)
        data["geometry"] = geom
        if "length" not in data or data["length"] is None:
            data["length"] = geom.length
        if sun.is_low:
            data["sun_fraction"] = 0.0  # everything effectively shaded
        elif index.count == 0:
            data["sun_fraction"] = 1.0
        else:
            data["sun_fraction"] = index.sun_fraction(geom)
    timings["annotate_s"] = round(time.perf_counter() - t2, 3)

    return PreparedCorridor(graph_proj=G, to_wgs=to_wgs, sun=sun, shade_count=shade_count, timings=timings)


def _nearest_node(G: nx.MultiDiGraph, x: float, y: float):
    import osmnx as ox

    return ox.distance.nearest_nodes(G, x, y)


def _route_edges(G: nx.MultiDiGraph, path: list, weight: str):
    """Cheapest parallel edge for each consecutive node pair."""
    for u, v in zip(path[:-1], path[1:]):
        best = min(G[u][v].values(), key=lambda d: d.get(weight, d.get("length", 1.0)))
        yield u, v, best


def _speed_m_min(mode: str) -> float:
    kmh = config.WALK_KMH if mode == "walk" else config.BIKE_KMH
    return kmh * 1000.0 / 60.0


def compute_route(
    prep: PreparedCorridor,
    origin: tuple[float, float],
    destination: tuple[float, float],
    mode: str,
    shade_preference: float,
    kind: str,
) -> RouteResult:
    """origin/destination are (lat, lon). kind selects the cost function."""
    G = prep.graph_proj
    k = 0.0 if kind == "fastest" else max(0.0, min(1.0, shade_preference)) * config.MAX_SHADE_WEIGHT

    to_proj = Transformer.from_crs("EPSG:4326", G.graph["crs"], always_xy=True)
    ox_, oy_ = to_proj.transform(origin[1], origin[0])
    dx_, dy_ = to_proj.transform(destination[1], destination[0])
    try:
        src = _nearest_node(G, ox_, oy_)
        dst = _nearest_node(G, dx_, dy_)
    except Exception as exc:
        raise RoutingError(f"Could not snap points to the street network: {exc}") from exc
    if src == dst:
        raise RoutingError("Origin and destination snap to the same street node -- too close.")

    def cost(u, v, ds):
        # ds is the {key: data} dict of parallel edges; take the cheapest one
        return min(
            d.get("length", 1.0) * (1.0 + k * d.get("sun_fraction", 1.0))
            for d in ds.values()
        )

    try:
        path = nx.shortest_path(G, src, dst, weight=cost)
    except nx.NetworkXNoPath as exc:
        raise RoutingError("No path found between these points.") from exc

    # store per-edge display cost for parallel-edge picking
    for u, v, data in G.edges(data=True):
        data["_cost"] = data.get("length", 1.0) * (1.0 + k * data.get("sun_fraction", 1.0))

    coords: list = []
    segments: list = []
    total_len = 0.0
    shaded_len = 0.0
    cur_flag = None
    cur_coords: list = []

    for u, v, data in _route_edges(G, path, "_cost"):
        geom = data["geometry"]
        # orient geometry from u to v
        ux, uy = G.nodes[u]["x"], G.nodes[u]["y"]
        pts = list(geom.coords)
        if Point(pts[-1]).distance(Point(ux, uy)) < Point(pts[0]).distance(Point(ux, uy)):
            pts = pts[::-1]
        length = data.get("length", geom.length)
        sun_frac = data.get("sun_fraction", 1.0)
        total_len += length
        shaded_len += length * (1.0 - sun_frac)
        shaded = sun_frac < config.SHADED_EDGE_THRESHOLD

        lonlat = [prep.to_wgs.transform(x, y) for x, y in pts]
        if coords:
            lonlat = lonlat[1:]  # avoid duplicating the shared node
        coords.extend(lonlat)

        if cur_flag is None:
            cur_flag, cur_coords = shaded, [prep.to_wgs.transform(x, y) for x, y in pts]
        elif shaded == cur_flag:
            cur_coords.extend(lonlat)
        else:
            segments.append({"coords": [[round(a, 6), round(b, 6)] for a, b in cur_coords], "shaded": cur_flag})
            cur_coords = [cur_coords[-1]] + lonlat
            cur_flag = shaded
    if cur_coords:
        segments.append({"coords": [[round(a, 6), round(b, 6)] for a, b in cur_coords], "shaded": cur_flag})

    if total_len == 0:
        raise RoutingError("Empty route.")

    shade_pct = 100.0 * shaded_len / total_len
    if prep.sun.is_low:
        shade_pct = 100.0
    return RouteResult(
        kind=kind,
        coords=[[round(a, 6), round(b, 6)] for a, b in coords],
        distance_m=round(total_len, 1),
        duration_min=round(total_len / _speed_m_min(mode), 1),
        shade_pct=round(shade_pct, 1),
        segments=segments,
    )
