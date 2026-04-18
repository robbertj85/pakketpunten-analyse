"""Fetch PC4 (4-digit postal code) boundaries for the Netherlands.

Downloads the community-maintained cartomap dataset (CBS-derived PC4 polygons in
WGS84), simplifies the geometry to shrink file size, strips non-essential
properties, and writes the result to webapp/public/data/pc4.geojson for use by
the map layer.

Source: https://github.com/cartomap/nl (ODbL, derived from CBS open data)
"""
import json
import sys
from pathlib import Path

import geopandas as gpd
import requests

SOURCE_URL = "https://cartomap.github.io/nl/wgs84/postcode4_2024.geojson"
OUTPUT_PATH = Path(__file__).parent.parent / "webapp" / "public" / "data" / "pc4.geojson"
SIMPLIFY_TOLERANCE_DEG = 0.00005  # ~5m at NL latitudes (cartomap is already generalized)


def main() -> int:
    print(f"Downloading PC4 boundaries from {SOURCE_URL}...")
    resp = requests.get(SOURCE_URL, timeout=120)
    resp.raise_for_status()
    raw = resp.json()
    print(f"  → {len(raw.get('features', []))} features, {len(resp.content) / 1024 / 1024:.1f} MB raw")

    gdf = gpd.GeoDataFrame.from_features(raw["features"], crs="EPSG:4326")

    # Identify the PC4 code column (cartomap uses 'postcode4')
    pc4_col = next((c for c in ("postcode4", "PC4", "pc4", "postcode") if c in gdf.columns), None)
    if pc4_col is None:
        print(f"ERROR: could not find PC4 column. Available: {list(gdf.columns)}", file=sys.stderr)
        return 1

    gdf = gdf[[pc4_col, "geometry"]].rename(columns={pc4_col: "pc4"})
    gdf["pc4"] = gdf["pc4"].astype(str).str.zfill(4)

    print(f"Simplifying geometries (tolerance={SIMPLIFY_TOLERANCE_DEG}°)...")
    gdf["geometry"] = gdf.geometry.simplify(SIMPLIFY_TOLERANCE_DEG, preserve_topology=True)

    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    gdf.to_file(OUTPUT_PATH, driver="GeoJSON")

    # Rewrite with compact separators to shave extra bytes
    with open(OUTPUT_PATH) as f:
        data = json.load(f)
    with open(OUTPUT_PATH, "w") as f:
        json.dump(data, f, separators=(",", ":"))

    size_mb = OUTPUT_PATH.stat().st_size / 1024 / 1024
    print(f"✓ Wrote {len(gdf)} PC4 areas → {OUTPUT_PATH} ({size_mb:.1f} MB)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
