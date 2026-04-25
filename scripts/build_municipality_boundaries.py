"""Build a simplified single GeoJSON of all 342 municipality boundaries.

Used as the basemap layer for the gemeente-level coverage choropleth on
the main webapp map. Source polygons come from
``data/municipality_polygon_cache.json`` (stored as WKT, ~13 MB).

We simplify with Douglas-Peucker at ~30m tolerance which is invisible on a
country-scale Leaflet view but slashes the payload from ~30 MB to ~2-4 MB.

Output: ``webapp/public/data/municipality_boundaries.geojson``
"""
import json
from pathlib import Path

from shapely import wkt
from shapely.geometry import mapping
from shapely.ops import transform
from pyproj import Transformer

ROOT = Path(__file__).parent.parent
SRC = ROOT / "data" / "municipality_polygon_cache.json"
OUT = ROOT / "webapp" / "public" / "data" / "municipality_boundaries.geojson"

# Tolerance in metres (RD New). 30 m is well below 1 px at the typical
# zoom levels for a national choropleth.
SIMPLIFY_TOLERANCE_M = 30


def main() -> int:
    print(f"Loading {SRC.name}...")
    with open(SRC) as f:
        cache = json.load(f)

    # Cached WKTs are stored in EPSG:4326 (WGS84). Project to RD for
    # metric simplification, then back to WGS84 for the GeoJSON.
    to_rd = Transformer.from_crs(4326, 28992, always_xy=True).transform
    to_wgs = Transformer.from_crs(28992, 4326, always_xy=True).transform

    features = []
    n_skipped = 0
    for key, v in cache.items():
        gem = v.get("gemeente") or key.split(":")[0]
        try:
            g = wkt.loads(v["geometry_wkt"])
        except Exception as e:
            print(f"  skip {gem}: {e}")
            n_skipped += 1
            continue
        g_rd = transform(to_rd, g)
        g_simple = g_rd.simplify(SIMPLIFY_TOLERANCE_M, preserve_topology=True)
        g_wgs = transform(to_wgs, g_simple)
        features.append({
            "type": "Feature",
            "properties": {"gemeente": gem},
            "geometry": mapping(g_wgs),
        })

    payload = {"type": "FeatureCollection", "features": features}
    OUT.parent.mkdir(parents=True, exist_ok=True)
    with open(OUT, "w") as f:
        # Use compact separators; coordinate precision capped via shapely
        # output (typically ~12 digits) — could trim further with a custom
        # encoder, but the simplified geometry is the bulk of the win.
        json.dump(payload, f, separators=(",", ":"))
    size_mb = OUT.stat().st_size / 1e6
    print(f"Wrote {OUT.relative_to(ROOT)}: {len(features)} munis, "
          f"{size_mb:.2f} MB ({n_skipped} skipped)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
