"""Corridor data layer: on-demand street graph + buildings + trees for a bbox.

Two providers behind one interface:

* OverpassProvider (default) -- osmnx / Overpass API, works anywhere in Spain
  (or the world) with zero preprocessing.
* PBFProvider -- reads a local Geofabrik-style .osm.pbf via pyrosm. Set the
  SOMBRA_PBF env var to a file path. This is the production-scale path (and the
  offline test path).

Results are cached on disk keyed by quantized bbox + mode.
"""
from __future__ import annotations

import logging
import math
import pickle
from dataclasses import dataclass
from typing import Protocol

import diskcache
import networkx as nx

from . import config

log = logging.getLogger("sombra.data")

_cache = diskcache.Cache(str(config.CACHE_DIR / "corridors"), size_limit=2 * 1024**3)


class DataUnavailable(Exception):
    """Raised when the upstream data source (e.g. Overpass) fails."""


@dataclass
class CorridorData:
    """Unprojected (EPSG:4326) corridor data."""

    graph: nx.MultiDiGraph
    buildings: list  # list[(shapely geometry, tags dict)]
    trees: list      # list[shapely geometry]
    bbox: tuple      # (west, south, east, north)


def straight_line_km(o: tuple[float, float], d: tuple[float, float]) -> float:
    """Haversine distance in km. Points are (lat, lon)."""
    r = 6371.0088
    lat1, lon1, lat2, lon2 = map(math.radians, [o[0], o[1], d[0], d[1]])
    dlat, dlon = lat2 - lat1, lon2 - lon1
    a = math.sin(dlat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


def corridor_bbox(o: tuple[float, float], d: tuple[float, float]) -> tuple[float, float, float, float]:
    """(west, south, east, north) around origin/destination with buffer."""
    dist_m = straight_line_km(o, d) * 1000.0
    buffer_m = max(config.MIN_BUFFER_M, config.BUFFER_FRACTION * dist_m)
    mean_lat = (o[0] + d[0]) / 2.0
    dlat = buffer_m / 111_320.0
    dlon = buffer_m / (111_320.0 * max(0.1, math.cos(math.radians(mean_lat))))
    south, north = min(o[0], d[0]) - dlat, max(o[0], d[0]) + dlat
    west, east = min(o[1], d[1]) - dlon, max(o[1], d[1]) + dlon
    return (west, south, east, north)


def _quantize_bbox(bbox: tuple[float, float, float, float]) -> tuple[float, float, float, float]:
    q = config.BBOX_QUANT_DEG
    w, s, e, n = bbox
    return (
        math.floor(w / q) * q,
        math.floor(s / q) * q,
        math.ceil(e / q) * q,
        math.ceil(n / q) * q,
    )


class Provider(Protocol):
    name: str

    def fetch(self, bbox: tuple[float, float, float, float], mode: str) -> CorridorData: ...


class OverpassProvider:
    name = "overpass"

    def fetch(self, bbox, mode: str) -> CorridorData:
        import osmnx as ox

        ox.settings.use_cache = True
        ox.settings.cache_folder = str(config.CACHE_DIR / "osmnx")
        ox.settings.log_console = False
        network_type = "walk" if mode == "walk" else "bike"
        try:
            graph = ox.graph_from_bbox(bbox, network_type=network_type, simplify=True, retain_all=True)
            try:
                bld = ox.features_from_bbox(bbox, tags={"building": True})
            except Exception:  # no buildings in bbox is not fatal
                bld = None
            try:
                nat = ox.features_from_bbox(bbox, tags={"natural": ["tree", "tree_row"]})
            except Exception:
                nat = None
        except Exception as exc:  # Overpass down / timeout / rate limited
            raise DataUnavailable(f"OpenStreetMap data fetch failed: {exc}") from exc

        # osmnx uses a MultiIndex column layout; normalize columns we care about
        buildings = _pandas_records(bld)
        trees = [g for g in (nat.geometry.tolist() if nat is not None and len(nat) else [])]
        return CorridorData(graph=graph, buildings=buildings, trees=trees, bbox=bbox)


def _pandas_records(gdf) -> list:
    if gdf is None or len(gdf) == 0:
        return []
    records = []
    for idx, row in gdf.iterrows():
        geom = row.get("geometry")
        if geom is None or geom.is_empty or geom.geom_type not in ("Polygon", "MultiPolygon"):
            continue
        tags = {}
        for key in ("height", "building:levels"):
            v = row.get(key)
            if v is not None and v == v:
                tags[key] = v
        records.append((geom, tags))
    return records


class PBFProvider:
    name = "pbf"

    def __init__(self, path: str):
        self.path = path

    def fetch(self, bbox, mode: str) -> CorridorData:
        import pyrosm
        from pyrosm.graphs import to_networkx  # noqa: F401  (via to_graph)

        w, s, e, n = bbox
        try:
            osm = pyrosm.OSM(self.path, bounding_box=[w, s, e, n])
            network_type = "walking" if mode == "walk" else "cycling"
            nodes, edges = osm.get_network(network_type=network_type, nodes=True)
            if nodes is None or edges is None or len(edges) == 0:
                raise DataUnavailable("No streets found in the requested area (is it covered by the PBF?)")
            graph = osm.to_graph(
                nodes,
                edges,
                graph_type="networkx",
                osmnx_compatible=True,
                retain_all=False,  # keep the largest connected component
                force_bidirectional=(mode == "walk"),
            )
            bld = osm.get_buildings()
            nat = osm.get_natural()
        except DataUnavailable:
            raise
        except Exception as exc:
            raise DataUnavailable(f"PBF read failed: {exc}") from exc

        buildings = _pandas_records(bld)
        trees = []
        if nat is not None and len(nat):
            mask = nat["natural"].isin(["tree", "tree_row"]) if "natural" in nat.columns else None
            sel = nat[mask] if mask is not None else nat
            trees = [g for g in sel.geometry.tolist() if g is not None and not g.is_empty]
        return CorridorData(graph=graph, buildings=buildings, trees=trees, bbox=bbox)


def get_provider() -> Provider:
    if config.PBF_PATH:
        return PBFProvider(config.PBF_PATH)
    return OverpassProvider()


def get_corridor(o: tuple[float, float], d: tuple[float, float], mode: str) -> CorridorData:
    """Cached corridor fetch. o/d are (lat, lon)."""
    provider = get_provider()
    bbox = _quantize_bbox(corridor_bbox(o, d))
    key = (provider.name, mode, bbox)
    cached = _cache.get(key)
    if cached is not None:
        log.info("corridor cache hit %s", key)
        return pickle.loads(cached)
    log.info("corridor cache miss %s -- fetching", key)
    data = provider.fetch(bbox, mode)
    _cache.set(key, pickle.dumps(data), expire=7 * 24 * 3600)
    return data
