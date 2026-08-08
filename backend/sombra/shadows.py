"""Shadow engine: sun position, shadow polygons, per-edge sun exposure.

All geometric functions operate in a projected CRS (meters). The caller is
responsible for projecting geometries before calling in here.
"""
from __future__ import annotations

import math
from dataclasses import dataclass
from datetime import datetime

from astral import Observer
from astral.sun import azimuth as astral_azimuth
from astral.sun import elevation as astral_elevation
from shapely.geometry import LineString, MultiPolygon, Point, Polygon
from shapely.geometry.base import BaseGeometry
from shapely.affinity import translate
from shapely.ops import unary_union
from shapely.strtree import STRtree

from . import config


@dataclass(frozen=True)
class SunPosition:
    elevation_deg: float
    azimuth_deg: float

    @property
    def is_low(self) -> bool:
        """Sun low enough that everything is effectively shaded (or it's night)."""
        return self.elevation_deg <= config.LOW_SUN_ELEVATION_DEG


def sun_position(lat: float, lon: float, when: datetime) -> SunPosition:
    """Sun elevation/azimuth for a tz-aware datetime at (lat, lon)."""
    obs = Observer(latitude=lat, longitude=lon)
    return SunPosition(
        elevation_deg=astral_elevation(obs, when),
        azimuth_deg=astral_azimuth(obs, when),
    )


def parse_height(tags: dict) -> float:
    """Building height in meters: height -> building:levels * 3.2 -> default."""
    raw = tags.get("height")
    if raw is not None:
        try:
            return float(str(raw).lower().replace("m", "").replace(",", ".").strip())
        except ValueError:
            pass
    raw = tags.get("building:levels")
    if raw is not None:
        try:
            levels = float(str(raw).split(";")[0].replace(",", "."))
            if levels > 0:
                return levels * config.METERS_PER_LEVEL
        except ValueError:
            pass
    return config.DEFAULT_BUILDING_HEIGHT_M


def shadow_offset(height_m: float, sun: SunPosition) -> tuple[float, float]:
    """(dx, dy) in meters from an object's base to the tip of its shadow.

    The shadow points away from the sun: direction = azimuth + 180deg.
    dx is easting, dy is northing (projected CRS).
    """
    if sun.is_low:
        return (0.0, 0.0)
    length = min(height_m / math.tan(math.radians(sun.elevation_deg)), config.MAX_SHADOW_LEN_M)
    direction = math.radians(sun.azimuth_deg + 180.0)
    return (length * math.sin(direction), length * math.cos(direction))


def _hull_shadow(geom: BaseGeometry, dx: float, dy: float) -> BaseGeometry:
    """Shadow of a convex-ish footprint: hull of footprint + translated footprint.

    NOTE: over-approximates shadows of strongly concave buildings (fills inner
    courtyards). Acceptable for MVP -- it errs toward predicting *more* shade
    near building edges where real shade usually exists.
    """
    moved = translate(geom, xoff=dx, yoff=dy)
    return unary_union([geom, moved]).convex_hull


def building_shadow(footprint: BaseGeometry, height_m: float, sun: SunPosition) -> BaseGeometry | None:
    if sun.is_low or footprint.is_empty:
        return None
    dx, dy = shadow_offset(height_m, sun)
    parts = footprint.geoms if isinstance(footprint, MultiPolygon) else [footprint]
    shadows = [_hull_shadow(p, dx, dy) for p in parts if not p.is_empty]
    if not shadows:
        return None
    return unary_union(shadows)


def tree_shadow(geom: BaseGeometry, sun: SunPosition) -> BaseGeometry | None:
    """Shadow for natural=tree (point) or natural=tree_row (line)."""
    if sun.is_low or geom is None or geom.is_empty:
        return None
    dx, dy = shadow_offset(config.TREE_HEIGHT_M, sun)
    if isinstance(geom, Point):
        crown = geom.buffer(config.TREE_RADIUS_M, quad_segs=4)
    elif isinstance(geom, LineString):
        crown = geom.buffer(config.TREE_ROW_BUFFER_M, quad_segs=4)
    else:  # polygons (rare for trees) -- treat like a crown already
        crown = geom
    return _hull_shadow(crown, dx, dy)


class ShadeIndex:
    """Spatial index over shadow polygons for fast per-edge queries."""

    def __init__(self, shadow_geoms: list[BaseGeometry]):
        self._geoms = [g for g in shadow_geoms if g is not None and not g.is_empty]
        self._tree = STRtree(self._geoms) if self._geoms else None

    @property
    def count(self) -> int:
        return len(self._geoms)

    def sun_fraction(self, edge_geom: LineString) -> float:
        """Fraction of the edge length exposed to the sun (0 = fully shaded)."""
        if self._tree is None:
            return 1.0
        if edge_geom.length < 1.0:
            # Degenerate edge: sample the midpoint.
            mid = edge_geom.interpolate(0.5, normalized=True)
            idx = self._tree.query(mid)
            for i in idx:
                if self._geoms[i].covers(mid):
                    return 0.0
            return 1.0
        idx = self._tree.query(edge_geom)
        if len(idx) == 0:
            return 1.0
        shade = unary_union([self._geoms[i] for i in idx])
        shaded_len = edge_geom.intersection(shade).length
        return max(0.0, min(1.0, 1.0 - shaded_len / edge_geom.length))


def build_shade_index(
    building_records: list[tuple[BaseGeometry, dict]],
    tree_geoms: list[BaseGeometry],
    sun: SunPosition,
) -> ShadeIndex:
    """building_records: (projected footprint, tags) pairs. tree_geoms: projected."""
    shadows: list[BaseGeometry] = []
    for footprint, tags in building_records:
        s = building_shadow(footprint, parse_height(tags), sun)
        if s is not None:
            shadows.append(s)
    for g in tree_geoms:
        s = tree_shadow(g, sun)
        if s is not None:
            shadows.append(s)
    return ShadeIndex(shadows)
