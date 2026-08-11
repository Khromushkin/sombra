#!/usr/bin/env python3
"""Download Spanish Cadastre INSPIRE building parts for a municipality and bake a
compact local layer for the Sombra PWA.

Run on a machine with open internet (takes ~1-2 min):

    pip install requests pyproj
    python scripts/fetch_catastro.py --municipality 46900 \
        --bbox -0.42 39.44 -0.33 39.50 \
        -o web/data/catastro_valencia.json

46900 = Valencia city. The bbox (W S E N, EPSG:4326) clips the output so the layer
stays a few MB. Commit the resulting file and push -- the PWA picks it up
automatically and the Catastro source turns green as "capa local".

Data: (c) Direccion General del Catastro, INSPIRE ATOM download service.
Reuse of *transformed* cadastral data, commercial included, is authorised by the
Catastro licence; this file is a transformation (clipped, simplified, re-projected).
"""
from __future__ import annotations

import argparse
import io
import json
import re
import sys
import zipfile
import xml.etree.ElementTree as ET

MASTER_ATOM = "https://www.catastro.hacienda.gob.es/INSPIRE/buildings/ES.SDGC.BU.atom.xml"


def find_links(atom_xml: str) -> list[str]:
    hrefs = re.findall(r'href="([^"]+)"', atom_xml)
    hrefs += re.findall(r"<id>([^<]+)</id>", atom_xml)
    return hrefs


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--municipality", required=True, help="5-digit code, e.g. 46900 for Valencia")
    ap.add_argument("--bbox", nargs=4, type=float, metavar=("W", "S", "E", "N"),
                    help="clip bbox in lon/lat; strongly recommended")
    ap.add_argument("-o", "--out", default="web/data/catastro_local.json")
    args = ap.parse_args()

    import requests
    from pyproj import Transformer

    muni = args.municipality
    province = muni[:2]
    ses = requests.Session()
    ses.headers["User-Agent"] = "sombra-poc/0.1 (open data fetch)"

    print(f"1/4 master ATOM -> province {province}")
    master = ses.get(MASTER_ATOM, timeout=60).text
    prov_links = [h for h in find_links(master) if f"atom_{province}" in h or f"ES.SDGC.bu.atom_{province}" in h.lower()]
    if not prov_links:
        prov_links = [h for h in find_links(master) if h.endswith(".xml") and f"_{province}" in h]
    if not prov_links:
        print("Could not find the province ATOM feed. Inspect", MASTER_ATOM, file=sys.stderr)
        return 1

    print(f"2/4 province ATOM -> municipality {muni}")
    prov = ses.get(prov_links[0], timeout=60).text
    zips = [h for h in find_links(prov) if muni in h and h.lower().endswith(".zip")]
    if not zips:
        print("Municipality zip not found in the province feed.", file=sys.stderr)
        return 1

    print(f"3/4 downloading {zips[0]}")
    blob = ses.get(zips[0], timeout=300).content
    zf = zipfile.ZipFile(io.BytesIO(blob))
    gml_name = next((n for n in zf.namelist() if "buildingpart" in n.lower() and n.lower().endswith(".gml")), None)
    if not gml_name:
        print("buildingpart GML not found in the zip:", zf.namelist(), file=sys.stderr)
        return 1

    print(f"4/4 parsing {gml_name}")
    data = zf.read(gml_name)
    head = data[:4000].decode("utf-8", "ignore")
    m = re.search(r"EPSG:{1,2}:?(\d{4,5})", head)
    epsg = int(m.group(1)) if m else 25830
    tr = Transformer.from_crs(f"EPSG:{epsg}", "EPSG:4326", always_xy=True)

    W, S, E, N = args.bbox if args.bbox else (-180, -90, 180, 90)
    parts = []
    floors, ring = 0, None
    for _, el in ET.iterparse(io.BytesIO(data), events=("end",)):
        tag = el.tag.rsplit("}", 1)[-1]
        if tag == "numberOfFloorsAboveGround":
            try:
                floors = int(el.text.strip())
            except (TypeError, ValueError):
                floors = 0
        elif tag == "posList" and ring is None:
            nums = [float(x) for x in (el.text or "").split()]
            ring = [(nums[i], nums[i + 1]) for i in range(0, len(nums) - 1, 2)]
        elif tag == "BuildingPart":
            if ring and floors > 0:
                lonlat = [tr.transform(x, y) for x, y in ring]
                if any(W <= lon <= E and S <= lat <= N for lon, lat in lonlat):
                    parts.append([floors, [[round(lon, 6), round(lat, 6)] for lon, lat in lonlat]])
            floors, ring = 0, None
            el.clear()

    out = {
        "source": "Catastro INSPIRE ATOM (transformed)",
        "municipality": muni,
        "bbox": [W, S, E, N],
        "parts": parts,
    }
    with open(args.out, "w") as f:
        json.dump(out, f, separators=(",", ":"))
    print(f"OK: {len(parts)} building parts -> {args.out} "
          f"({round(len(json.dumps(out)) / 1e6, 1)} MB)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
