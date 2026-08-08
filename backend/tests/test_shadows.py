import math
from datetime import datetime
from zoneinfo import ZoneInfo

import pytest
from shapely.geometry import LineString, Point, Polygon

from sombra import config
from sombra.shadows import (
    ShadeIndex,
    SunPosition,
    build_shade_index,
    building_shadow,
    parse_height,
    shadow_offset,
    sun_position,
)

BOX_10M = Polygon([(0, 0), (10, 0), (10, 10), (0, 10)])


def test_shadow_length_45deg():
    # 10 m building, sun elevation 45deg -> 10 m shadow
    sun = SunPosition(elevation_deg=45.0, azimuth_deg=180.0)
    dx, dy = shadow_offset(10.0, sun)
    assert math.hypot(dx, dy) == pytest.approx(10.0, abs=1e-6)


def test_shadow_direction_sun_due_south():
    # Sun due south (azimuth 180) -> shadow points north (+y)
    sun = SunPosition(elevation_deg=45.0, azimuth_deg=180.0)
    shadow = building_shadow(BOX_10M, 10.0, sun)
    assert shadow.covers(Point(5, 15))       # north of the box: shaded
    assert not shadow.covers(Point(5, -5))   # south of the box: sunny
    assert shadow.bounds[3] == pytest.approx(20.0, abs=1e-6)  # 10 m box + 10 m shadow


def test_shadow_direction_sun_due_west():
    # Sun due west (azimuth 270) -> shadow points east (+x)
    sun = SunPosition(elevation_deg=45.0, azimuth_deg=270.0)
    shadow = building_shadow(BOX_10M, 10.0, sun)
    assert shadow.covers(Point(15, 5))
    assert not shadow.covers(Point(-5, 5))


def test_shadow_capped_at_max_length():
    sun = SunPosition(elevation_deg=1.0 + config.LOW_SUN_ELEVATION_DEG, azimuth_deg=180.0)
    dx, dy = shadow_offset(100.0, sun)
    assert math.hypot(dx, dy) <= config.MAX_SHADOW_LEN_M + 1e-6


def test_low_sun_mode():
    sun = SunPosition(elevation_deg=config.LOW_SUN_ELEVATION_DEG, azimuth_deg=90.0)
    assert sun.is_low
    assert building_shadow(BOX_10M, 10.0, sun) is None
    assert SunPosition(elevation_deg=-5.0, azimuth_deg=0.0).is_low  # night


def test_height_fallback_chain():
    assert parse_height({"height": "12.5"}) == pytest.approx(12.5)
    assert parse_height({"height": "12 m"}) == pytest.approx(12.0)
    assert parse_height({"building:levels": "4"}) == pytest.approx(4 * config.METERS_PER_LEVEL)
    assert parse_height({"height": "garbage", "building:levels": "2"}) == pytest.approx(2 * config.METERS_PER_LEVEL)
    assert parse_height({}) == pytest.approx(config.DEFAULT_BUILDING_HEIGHT_M)


def test_edge_sun_fraction_half_shaded():
    sun = SunPosition(elevation_deg=45.0, azimuth_deg=180.0)
    index = build_shade_index([(BOX_10M, {"height": "10"})], [], sun)
    # Edge running north from the box roof edge: y 10..30; shade covers y<=20
    edge = LineString([(5, 10), (5, 30)])
    assert index.sun_fraction(edge) == pytest.approx(0.5, abs=0.01)
    # Edge fully in the sun, far away
    assert index.sun_fraction(LineString([(500, 0), (500, 20)])) == 1.0


def test_empty_index_is_all_sun():
    index = ShadeIndex([])
    assert index.sun_fraction(LineString([(0, 0), (10, 0)])) == 1.0


def test_sun_position_valencia_summer_noon():
    when = datetime(2026, 8, 8, 14, 0, tzinfo=ZoneInfo("Europe/Madrid"))
    sun = sun_position(39.47, -0.376, when)
    assert sun.elevation_deg > 55  # high summer sun
    assert not sun.is_low
    evening = sun_position(39.47, -0.376, datetime(2026, 8, 8, 23, 0, tzinfo=ZoneInfo("Europe/Madrid")))
    assert evening.is_low
