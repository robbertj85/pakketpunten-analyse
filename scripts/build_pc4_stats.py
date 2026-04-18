"""Build a single nationwide PC4 stats table.

Per PC4 area polygon we compute:
  - area_km2     (from RD New-projected polygon, accurate metric area)
  - population   (CBS 83502NED, latest year)
  - municipality (from provincial boundary sjoin)
  - parcel_points: total / locker / shop / by_carrier (from nederland.geojson)

The result is written to ``webapp/public/data/pc4_stats.json``. It serves both
the regression model training set and the map layer dataset (density, counts).
"""
import json
import sys
from pathlib import Path

import geopandas as gpd
import pandas as pd
from shapely.geometry import shape

ROOT = Path(__file__).parent.parent
PC4_PATH = ROOT / "webapp" / "public" / "data" / "pc4.geojson"
NEDERLAND_PATH = ROOT / "webapp" / "public" / "data" / "nederland.geojson"
CBS_PC4_PATH = ROOT / "data" / "cbs_pc4.json"
BOUNDARIES_DIR = ROOT / "webapp" / "public" / "data" / "boundaries"
OUTPUT = ROOT / "webapp" / "public" / "data" / "pc4_stats.json"

LOCKER_TYPES = {"packStation", "automaat", "dpd_box", "locker", "Buitenkluis"}


def categorize(punt_type: str) -> str:
    return "locker" if punt_type in LOCKER_TYPES else "shop"


def main() -> int:
    print(f"Loading {PC4_PATH.name}...")
    pc4_gdf = gpd.read_file(PC4_PATH)
    pc4_gdf["pc4"] = pc4_gdf["pc4"].astype(str).str.zfill(4)

    # Accurate metric area via RD New projection
    print("Computing PC4 areas in EPSG:28992...")
    pc4_rd = pc4_gdf.to_crs("EPSG:28992")
    pc4_gdf["area_km2"] = (pc4_rd.area / 1e6).round(4)

    print(f"Loading CBS population from {CBS_PC4_PATH.name}...")
    with open(CBS_PC4_PATH) as f:
        cbs = json.load(f)
    pop_lookup: dict[str, int] = cbs.get("pc4_population", {})

    print("Joining PC4s with municipality boundaries...")
    boundary_parts = [
        gpd.read_file(p)[["gemeente", "geometry"]]
        for p in sorted(BOUNDARIES_DIR.glob("provincie-*.geojson"))
    ]
    boundary_gdf = gpd.GeoDataFrame(
        pd.concat(boundary_parts, ignore_index=True), crs=boundary_parts[0].crs
    )
    centroids = pc4_gdf.copy()
    centroids["geometry"] = centroids.geometry.representative_point()
    # sjoin_nearest handles the edge cases where representative points fall
    # in small polygon gaps (e.g. Den Haag 2593). For interior points the
    # distance is 0 so results match a strict "within" join.
    located = gpd.sjoin_nearest(
        centroids[["pc4", "geometry"]], boundary_gdf, how="left"
    )
    pc4_to_municipality = dict(zip(located["pc4"], located["gemeente"]))

    print(f"Loading pakketpunten from {NEDERLAND_PATH.name}...")
    with open(NEDERLAND_PATH) as f:
        nederland = json.load(f)
    pakket_records = []
    for feat in nederland["features"]:
        props = feat.get("properties", {})
        if props.get("type") != "pakketpunt":
            continue
        pakket_records.append({
            "geometry": shape(feat["geometry"]),
            "vervoerder": props.get("vervoerder", "Unknown"),
            "category": categorize(props.get("puntType", "")),
        })
    pt_gdf = gpd.GeoDataFrame(pakket_records, crs="EPSG:4326")
    print(f"  → {len(pt_gdf)} pakketpunten nationwide")

    print("Spatial join: pakketpunten → PC4...")
    joined = gpd.sjoin(
        pt_gdf, pc4_gdf[["pc4", "geometry"]], how="inner", predicate="within"
    )

    counts: dict[str, dict] = {}
    for pc4, group in joined.groupby("pc4"):
        providers: dict[str, dict[str, int]] = {}
        for _, row in group.iterrows():
            providers.setdefault(row["vervoerder"], {"locker": 0, "shop": 0})[row["category"]] += 1
        tot_locker = sum(p["locker"] for p in providers.values())
        tot_shop = sum(p["shop"] for p in providers.values())
        counts[pc4] = {
            "total": tot_locker + tot_shop,
            "locker": tot_locker,
            "shop": tot_shop,
            "by_carrier": providers,
        }

    # Assemble final table
    stats: dict[str, dict] = {}
    for _, row in pc4_gdf.iterrows():
        pc4 = row["pc4"]
        munic = pc4_to_municipality.get(pc4)
        stats[pc4] = {
            "area_km2": float(row["area_km2"]),
            "population": int(pop_lookup.get(pc4, 0)),
            "municipality": munic if isinstance(munic, str) else None,
            "parcel_points": counts.get(pc4, {
                "total": 0, "locker": 0, "shop": 0, "by_carrier": {},
            }),
        }

    payload = {
        "generated_from": {
            "pc4_polygons": PC4_PATH.name,
            "pakketpunten": NEDERLAND_PATH.name,
            "cbs_dataset": cbs.get("dataset"),
            "cbs_period": cbs.get("period"),
        },
        "stats": dict(sorted(stats.items())),
    }
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    with open(OUTPUT, "w") as f:
        json.dump(payload, f, separators=(",", ":"))
    size = OUTPUT.stat().st_size / 1024
    print(f"✓ {len(stats)} PC4 stats → {OUTPUT} ({size:.0f} KB)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
