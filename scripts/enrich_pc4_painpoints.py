"""Enrich pc4_painpoints.json with parcel-point counts per PC4.

For each pain-point PC4 we spatially join the nationwide pakketpunt features
(nederland.geojson) against the PC4 polygon (pc4.geojson) and bucket by carrier
and locker/shop category. The result is written back to pc4_painpoints.json so
the report page can render without any client-side geo work.

Run after either pc4_painpoints.json or nederland.geojson changes.
"""
import json
import sys
from pathlib import Path

import geopandas as gpd
import pandas as pd
from shapely.geometry import shape

ROOT = Path(__file__).parent.parent
PAINPOINTS_PATH = ROOT / "webapp" / "public" / "data" / "pc4_painpoints.json"
PC4_PATH = ROOT / "webapp" / "public" / "data" / "pc4.geojson"
NEDERLAND_PATH = ROOT / "webapp" / "public" / "data" / "nederland.geojson"
BOUNDARIES_DIR = ROOT / "webapp" / "public" / "data" / "boundaries"
PC4_STATS_PATH = ROOT / "webapp" / "public" / "data" / "pc4_stats.json"

# Mirror of webapp/types/pakketpunten.ts getPointCategory
LOCKER_TYPES = {
    "packStation",  # DHL
    "automaat",     # PostNL, InPost, Budbee
    "dpd_box",      # DPD
    "locker",       # Amazon, VintedGo, GLS
    "Buitenkluis",  # DeBuren
}


def categorize(punt_type: str) -> str:
    return "locker" if punt_type in LOCKER_TYPES else "shop"


def main() -> int:
    with open(PAINPOINTS_PATH) as f:
        payload = json.load(f)
    painpoints: dict[str, dict] = payload["painpoints"]

    print(f"Loading PC4 polygons from {PC4_PATH.name}...")
    pc4_gdf = gpd.read_file(PC4_PATH)
    pc4_gdf["pc4"] = pc4_gdf["pc4"].astype(str).str.zfill(4)
    pc4_subset = pc4_gdf[pc4_gdf["pc4"].isin(painpoints.keys())].copy()
    print(f"  → {len(pc4_subset)}/{len(painpoints)} pain-point PC4 polygons matched")

    # Determine the actual municipality for each pain-point PC4 by joining
    # the polygon centroids against the nationwide municipality boundaries.
    print("Loading municipality boundaries from all provinces...")
    boundary_parts = []
    for boundary_file in sorted(BOUNDARIES_DIR.glob("provincie-*.geojson")):
        boundary_parts.append(gpd.read_file(boundary_file)[["gemeente", "geometry"]])
    if boundary_parts:
        boundary_gdf = gpd.GeoDataFrame(
            pd.concat(boundary_parts, ignore_index=True), crs=boundary_parts[0].crs
        )
        print(f"  → {len(boundary_gdf)} municipality polygons loaded")
        centroids = pc4_subset.copy()
        centroids["geometry"] = centroids.geometry.representative_point()
        located = gpd.sjoin_nearest(centroids, boundary_gdf, how="left")
        pc4_to_municipality = dict(zip(located["pc4"], located["gemeente"]))
    else:
        print("  ⚠ no boundary files found, skipping municipality lookup")
        pc4_to_municipality = {}

    print(f"Loading pakketpunten from {NEDERLAND_PATH.name}...")
    with open(NEDERLAND_PATH) as f:
        nederland = json.load(f)

    # Build a GeoDataFrame of just the pakketpunt point features
    pakketpunt_records = []
    for feat in nederland["features"]:
        props = feat.get("properties", {})
        if props.get("type") != "pakketpunt":
            continue
        pakketpunt_records.append({
            "geometry": shape(feat["geometry"]),
            "vervoerder": props.get("vervoerder", "Unknown"),
            "category": categorize(props.get("puntType", "")),
        })
    pt_gdf = gpd.GeoDataFrame(pakketpunt_records, crs="EPSG:4326")
    print(f"  → {len(pt_gdf)} pakketpunt features nationwide")

    print("Running spatial join...")
    joined = gpd.sjoin(pt_gdf, pc4_subset[["pc4", "geometry"]], how="inner", predicate="within")
    print(f"  → {len(joined)} points fell inside pain-point PC4s")

    # Keep a lookup of each point's original properties so we can ship full
    # details (name, street) alongside the aggregation counts.
    point_props_by_idx: dict[int, dict] = {}
    idx = 0
    for feat in nederland["features"]:
        props = feat.get("properties", {})
        if props.get("type") != "pakketpunt":
            continue
        point_props_by_idx[idx] = props
        idx += 1

    # Aggregate counts per PC4 and collect point details
    counts: dict[str, dict] = {}
    details: dict[str, list[dict]] = {}
    for pc4, group in joined.groupby("pc4"):
        providers: dict[str, dict[str, int]] = {}
        pc4_points: list[dict] = []
        for original_idx, row in group.iterrows():
            p = row["vervoerder"]
            c = row["category"]
            providers.setdefault(p, {"locker": 0, "shop": 0})[c] += 1
            geom = row["geometry"]
            orig = point_props_by_idx.get(original_idx, {})
            pc4_points.append({
                "lat": round(geom.y, 6),
                "lng": round(geom.x, 6),
                "vervoerder": p,
                "category": c,
                "puntType": orig.get("puntType", ""),
                "locatieNaam": orig.get("locatieNaam", ""),
                "straatNaam": orig.get("straatNaam", ""),
                "straatNr": orig.get("straatNr", ""),
            })
        total_locker = sum(p["locker"] for p in providers.values())
        total_shop = sum(p["shop"] for p in providers.values())
        counts[pc4] = {
            "total": total_locker + total_shop,
            "locker": total_locker,
            "shop": total_shop,
            "by_carrier": providers,
        }
        details[pc4] = pc4_points

    # Load nationwide PC4 stats (population, area, model predictions)
    pc4_stats: dict[str, dict] = {}
    if PC4_STATS_PATH.exists():
        with open(PC4_STATS_PATH) as f:
            pc4_stats = json.load(f).get("stats", {})
        print(f"Loaded PC4 stats for {len(pc4_stats)} PC4s")
    else:
        print(f"⚠ {PC4_STATS_PATH.name} missing — run build_pc4_stats.py + fit_pc4_model.py first")

    # Merge into painpoints payload
    # Keep "city" as the G4 convenant city that reported the PC4, and add
    # "municipality" for the actual municipality the polygon sits in.
    for pc4, entry in painpoints.items():
        entry["g4_city"] = entry.get("city")
        municipality = pc4_to_municipality.get(pc4)
        entry["municipality"] = municipality if isinstance(municipality, str) else None
        entry["pakketpunten"] = counts.get(pc4, {
            "total": 0, "locker": 0, "shop": 0, "by_carrier": {},
        })
        entry["points"] = details.get(pc4, [])
        stat = pc4_stats.get(pc4)
        if stat:
            entry["stats"] = {
                "area_km2": stat.get("area_km2"),
                "population": stat.get("population"),
                "points_per_km2": stat.get("points_per_km2"),
                "points_per_1000_inw": stat.get("points_per_1000_inw"),
                "predicted_points": stat.get("predicted_points"),
                "delta_vs_predicted": stat.get("delta_vs_predicted"),
                "predicted_points_k8": stat.get("predicted_points_k8"),
                "delta_vs_predicted_k8": stat.get("delta_vs_predicted_k8"),
                "expected_simple_rate": stat.get("expected_simple_rate"),
            }

    payload["painpoints"] = painpoints
    with open(PAINPOINTS_PATH, "w") as f:
        json.dump(payload, f, separators=(",", ":"), ensure_ascii=False)

    matched = sum(1 for v in painpoints.values() if v["pakketpunten"]["total"] > 0)
    total_points = sum(v["pakketpunten"]["total"] for v in painpoints.values())
    print(f"✓ Enriched {len(painpoints)} PC4s "
          f"({matched} with ≥1 pakketpunt, {total_points} points total) "
          f"→ {PAINPOINTS_PATH}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
