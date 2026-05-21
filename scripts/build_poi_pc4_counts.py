"""Aggregate POI counts per PC4 polygon.

Reads every webapp/public/data/poi/*.geojson, spatially joins the points to
the nationwide PC4 polygons (pc4.geojson), and writes
webapp/public/data/poi_pc4_counts.json with one entry per PC4 holding the
count per POI category. Used by the painpoints report and the new POIs page
to surface POI density per PC4 (e.g. "PC4 1012: 18 fietsenstallingen, 4 OV
knooppunten, 2 winkelcentra").
"""
from __future__ import annotations

import json
import sys
from collections import defaultdict
from pathlib import Path

import geopandas as gpd
import pandas as pd
from shapely.geometry import shape

ROOT = Path(__file__).parent.parent
POI_DIR = ROOT / "webapp" / "public" / "data" / "poi"
PC4_PATH = ROOT / "webapp" / "public" / "data" / "pc4.geojson"
OUT_PATH = ROOT / "webapp" / "public" / "data" / "poi_pc4_counts.json"


def main() -> int:
    index_path = POI_DIR / "index.json"
    if not index_path.exists():
        print(f"Missing {index_path}; run scripts/fetch_pois.py first", file=sys.stderr)
        return 1
    index = json.load(open(index_path))["categories"]

    print(f"Loading PC4 polygons from {PC4_PATH.name}…")
    pc4 = gpd.read_file(PC4_PATH)
    pc4["pc4"] = pc4["pc4"].astype(str).str.zfill(4)
    pc4 = pc4[["pc4", "geometry"]]

    # counts[pc4][category] = int
    counts: dict[str, dict[str, int]] = defaultdict(lambda: defaultdict(int))
    totals: dict[str, int] = {}

    for cat in index:
        slug = cat["slug"]
        path = POI_DIR / f"{slug}.geojson"
        if not path.exists():
            continue
        data = json.load(open(path))
        feats = data.get("features", [])
        if not feats:
            totals[slug] = 0
            continue
        records = []
        for f in feats:
            g = f.get("geometry")
            if not g or g.get("type") != "Point":
                continue
            records.append({
                "category": slug,
                "geometry": shape(g),
            })
        gdf = gpd.GeoDataFrame(records, crs="EPSG:4326")
        joined = gpd.sjoin(gdf, pc4, how="inner", predicate="within")
        per_pc4 = joined.groupby("pc4").size()
        for pc4_code, n in per_pc4.items():
            counts[pc4_code][slug] = int(n)
        totals[slug] = len(gdf)
        print(f"  {slug:>22} : {len(gdf):>6} points → {len(per_pc4)} PC4s")

    out = {
        "categories": [c["slug"] for c in index],
        "totals": totals,
        "counts": {k: dict(v) for k, v in sorted(counts.items())},
    }
    with open(OUT_PATH, "w") as f:
        json.dump(out, f, separators=(",", ":"), ensure_ascii=False)
    print(f"\n✓ Wrote {OUT_PATH.relative_to(ROOT)} — {len(out['counts'])} PC4s × {len(index)} categories")
    return 0


if __name__ == "__main__":
    sys.exit(main())
