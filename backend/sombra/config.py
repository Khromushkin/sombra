"""Sombra backend configuration."""
from __future__ import annotations

import os
from pathlib import Path

CACHE_DIR = Path(os.environ.get("SOMBRA_CACHE_DIR", Path(__file__).resolve().parent.parent / ".cache"))
CACHE_DIR.mkdir(parents=True, exist_ok=True)

# Optional local PBF file (production-scale / offline provider). If set, data is
# read from this file instead of the Overpass API.
PBF_PATH = os.environ.get("SOMBRA_PBF")

DEFAULT_TZ = "Europe/Madrid"

# Route guard rails (straight-line distance)
MAX_WALK_KM = 10.0
MAX_BIKE_KM = 25.0

# Speeds for duration estimates
WALK_KMH = 4.7
BIKE_KMH = 15.0

# Corridor bbox buffer: max(500 m, 25% of straight-line distance)
MIN_BUFFER_M = 500.0
BUFFER_FRACTION = 0.25

# Cache quantization
BBOX_QUANT_DEG = 0.005  # ~500 m
TIME_BUCKET_MIN = 15

# Shadow model
LOW_SUN_ELEVATION_DEG = 3.0
MAX_SHADOW_LEN_M = 150.0
DEFAULT_BUILDING_HEIGHT_M = 9.0  # ~3 floors, conservative default for Spanish urban fabric
METERS_PER_LEVEL = 3.2
TREE_RADIUS_M = 4.0
TREE_HEIGHT_M = 8.0
TREE_ROW_BUFFER_M = 3.0

# Router
SHADED_EDGE_THRESHOLD = 0.5  # edge counts as "shaded" for display if sun_fraction < 0.5
MAX_SHADE_WEIGHT = 3.0       # k = shade_preference * MAX_SHADE_WEIGHT

PHOTON_URL = os.environ.get("SOMBRA_PHOTON_URL", "https://photon.komoot.io/api")
# Rough bias box for Spain (used to rank geocoding results)
SPAIN_BBOX = (-9.5, 35.8, 4.5, 43.9)  # west, south, east, north
