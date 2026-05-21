"""Split nationwide POI GeoJSONs into per-municipality bundles.

Reads webapp/public/data/poi/*.geojson + the 12 provincial boundary files,
joins POIs against municipality polygons, and writes one combined bundle per
municipality with all categories:

    webapp/public/data/poi/by-municipality/<slug>.geojson

The bundle keeps a flat features array where each feature's `properties.category`
identifies the layer. This lets the webapp load a single (small) file per city
instead of pulling the 21 MB nationwide bushaltes file every time.
"""
from __future__ import annotations

import json
import re
import sys
from collections import defaultdict
from pathlib import Path

import geopandas as gpd
import pandas as pd
from shapely.geometry import shape

ROOT = Path(__file__).parent.parent
POI_DIR = ROOT / "webapp" / "public" / "data" / "poi"
BOUNDARIES_DIR = ROOT / "webapp" / "public" / "data" / "boundaries"
OUT_DIR = POI_DIR / "by-municipality"
OUT_DIR.mkdir(parents=True, exist_ok=True)


def _slug(name: str) -> str:
    s = name.lower()
    s = (s.replace("ë", "e").replace("ï", "i").replace("ö", "o").replace("ü", "u")
           .replace("á", "a").replace("é", "e").replace("í", "i").replace("ó", "o")
           .replace("ú", "u").replace("'", "").replace("à", "a").replace("è", "e"))
    s = re.sub(r"[^a-z0-9]+", "-", s).strip("-")
    return s


def main() -> int:
    index_path = POI_DIR / "index.json"
    if not index_path.exists():
        print(f"Missing {index_path}; run scripts/fetch_pois.py first", file=sys.stderr)
        return 1
    categories = json.load(open(index_path))["categories"]

    print("Loading municipality boundaries from all provinces…")
    parts = []
    for f in sorted(BOUNDARIES_DIR.glob("provincie-*.geojson")):
        parts.append(gpd.read_file(f)[["gemeente", "geometry"]])
    if not parts:
        print("No provincial boundary files found", file=sys.stderr)
        return 1
    munis = gpd.GeoDataFrame(pd.concat(parts, ignore_index=True), crs=parts[0].crs)
    munis["slug"] = munis["gemeente"].map(_slug)
    print(f"  → {len(munis)} municipalities")

    # bundle[slug] = {"gemeente": ..., "by_category": {cat: int}, "features": [...]}
    bundles: dict[str, dict] = {}
    for cat in categories:
        slug = cat["slug"]
        path = POI_DIR / f"{slug}.geojson"
        if not path.exists():
            continue
        data = json.load(open(path))
        feats = data.get("features", [])
        if not feats:
            print(f"  {slug:>22} : empty")
            continue
        records = [{
            "geometry": shape(f["geometry"]),
            "name": f["properties"].get("name", ""),
            "operator": f["properties"].get("operator", ""),
        } for f in feats if f.get("geometry", {}).get("type") == "Point"]
        gdf = gpd.GeoDataFrame(records, crs="EPSG:4326")
        joined = gpd.sjoin(gdf, munis[["slug", "gemeente", "geometry"]],
                           how="inner", predicate="within")
        for _, row in joined.iterrows():
            muni_slug = row["slug"]
            b = bundles.setdefault(muni_slug, {
                "gemeente": row["gemeente"],
                "by_category": defaultdict(int),
                "features": [],
            })
            b["by_category"][slug] += 1
            b["features"].append({
                "type": "Feature",
                "geometry": {
                    "type": "Point",
                    "coordinates": [round(row["geometry"].x, 6), round(row["geometry"].y, 6)],
                },
                "properties": {
                    "category": slug,
                    "name": row["name"] or "",
                    "operator": row["operator"] or "",
                },
            })
        print(f"  {slug:>22} : {len(joined):>6} points → {joined['slug'].nunique()} munis")

    # Write per-municipality bundle
    written = 0
    for muni_slug, b in bundles.items():
        out = {
            "type": "FeatureCollection",
            "metadata": {
                "gemeente": b["gemeente"],
                "slug": muni_slug,
                "by_category": dict(sorted(b["by_category"].items(), key=lambda x: -x[1])),
                "total": len(b["features"]),
            },
            "features": b["features"],
        }
        with open(OUT_DIR / f"{muni_slug}.geojson", "w") as f:
            json.dump(out, f, separators=(",", ":"), ensure_ascii=False)
        written += 1

    # Lightweight index for the webapp (slug → counts) so the page can show
    # the available cities without downloading every bundle.
    index = {muni_slug: {
        "gemeente": b["gemeente"],
        "total": len(b["features"]),
        "by_category": dict(sorted(b["by_category"].items(), key=lambda x: -x[1])),
    } for muni_slug, b in sorted(bundles.items())}
    with open(OUT_DIR / "index.json", "w") as f:
        json.dump(index, f, indent=2, ensure_ascii=False)
    print(f"\n✓ Wrote {written} per-municipality bundles → {OUT_DIR.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
