#!/usr/bin/env python3
"""PNOA-LiDAR -> tree canopy polygons (GeoJSON) for Sombra.

Usage:
  1. Download LAZ tiles for your area from the CNIG download centre
     (https://centrodedescargas.cnig.es -> LiDAR). Free, CC BY 4.0-compatible
     license, attribution: "(c) Instituto Geografico Nacional de Espana".
  2. pip install laspy[lazrs] numpy shapely
  3. python scripts/lidar_canopy.py tile1.laz tile2.laz ... -o canopy.geojson

Method (simple canopy-height-model):
  * keep points classified as vegetation (ASPRS classes 3/4/5),
  * grid them at CELL m resolution, taking max height per cell,
  * subtract the ground grid (class 2) -> canopy height,
  * cells with canopy >= MIN_TREE_H become polygons, dissolved into crowns.

Output GeoJSON (EPSG:4326) with {height} per crown -- drop it next to the
Sombra backend or serve as a static layer for the PWA.
"""
from __future__ import annotations

import argparse
import json
import sys

import numpy as np

CELL = 2.0          # grid cell, meters
MIN_TREE_H = 2.5    # minimum canopy height to count as a tree, meters
VEG_CLASSES = (3, 4, 5)
GROUND_CLASS = 2


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("laz", nargs="+", help="PNOA LAZ/LAS tiles")
    ap.add_argument("-o", "--out", default="canopy.geojson")
    ap.add_argument("--bbox", nargs=4, type=float, metavar=("W", "S", "E", "N"),
                    help="clip output to this lon/lat bbox; keeps the layer small")
    args = ap.parse_args()

    try:
        import laspy
        from pyproj import Transformer
        from shapely.geometry import box, mapping, Point
        from shapely.ops import unary_union
        from shapely.strtree import STRtree
    except ImportError as e:
        print(f"Missing dependency: {e}. pip install 'laspy[lazrs]' numpy shapely pyproj", file=sys.stderr)
        return 1

    clip = box(*args.bbox) if args.bbox else None  # lon/lat, applied after reprojection
    crowns = []
    for path in args.laz:
        las = laspy.read(path)
        cls = np.asarray(las.classification)
        x, y, z = np.asarray(las.x), np.asarray(las.y), np.asarray(las.z)

        veg = np.isin(cls, VEG_CLASSES)
        gnd = cls == GROUND_CLASS
        if not veg.any() or not gnd.any():
            print(f"{path}: no vegetation/ground points, skipped")
            continue

        x0, y0 = x.min(), y.min()
        ix = ((x - x0) / CELL).astype(np.int32)
        iy = ((y - y0) / CELL).astype(np.int32)
        nx, ny = ix.max() + 1, iy.max() + 1

        def grid_max(mask):
            g = np.full((nx, ny), -np.inf)
            np.maximum.at(g, (ix[mask], iy[mask]), z[mask])
            return g

        veg_g = grid_max(veg)
        gnd_g = grid_max(gnd)
        # fill ground gaps with local median so canopy height stays sane
        gnd_fill = np.where(np.isfinite(gnd_g), gnd_g, np.nanmedian(np.where(np.isfinite(gnd_g), gnd_g, np.nan)))
        canopy = veg_g - gnd_fill

        cells = np.argwhere(canopy >= MIN_TREE_H)
        print(f"{path}: {len(cells)} canopy cells")
        if not len(cells):
            continue
        cell_h = canopy[cells[:, 0], cells[:, 1]]
        # LiDAR PNOA is delivered in UTM (EPSG:258xx); read CRS from the header
        epsg = None
        try:
            crs = las.header.parse_crs()
            epsg = crs.to_epsg() if crs else None
        except Exception:
            pass
        epsg = epsg or 25830
        tr = Transformer.from_crs(f"EPSG:{epsg}", "EPSG:4326", always_xy=True)

        polys = [box(x0 + cx * CELL, y0 + cy * CELL, x0 + (cx + 1) * CELL, y0 + (cy + 1) * CELL)
                 for cx, cy in cells]
        centers = [Point(x0 + (cx + 0.5) * CELL, y0 + (cy + 0.5) * CELL) for cx, cy in cells]
        tree = STRtree(centers)

        dissolved = unary_union(polys).simplify(0.5)
        geoms = dissolved.geoms if hasattr(dissolved, "geoms") else [dissolved]
        from shapely.ops import transform as shp_transform
        for g in geoms:
            # Height of THIS crown = tallest cell inside it, not the tile maximum.
            inside = [i for i in tree.query(g) if g.intersects(centers[i])]
            h = float(cell_h[inside].max()) if inside else MIN_TREE_H
            g84 = shp_transform(tr.transform, g)
            if clip and not clip.intersects(g84):
                continue
            crowns.append({"type": "Feature", "properties": {"height": round(h, 1)},
                           "geometry": mapping(g84)})

    json.dump({"type": "FeatureCollection", "features": crowns}, open(args.out, "w"))
    print(f"Wrote {len(crowns)} crowns -> {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
