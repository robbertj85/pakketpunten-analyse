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
CBS_INCOME_PATH = ROOT / "data" / "cbs_pc4_income.json"
CBS_SES_PATH = ROOT / "data" / "cbs_pc4_ses_woa.json"
CBS_EXTRA_PATH = ROOT / "data" / "cbs_pc4_extra.json"
NDW_LOADING_PATH = ROOT / "data" / "ndw_pc4_loading_zones.json"
NDW_EMISSION_PATH = ROOT / "data" / "ndw_pc4_emission_zones.json"
OV_STOPS_PATH = ROOT / "data" / "ov_pc4_stops.json"
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
    pc4_gdf["area_km2"] = (pc4_rd.area / 1e6).round(4).fillna(0.0)

    print(f"Loading CBS population from {CBS_PC4_PATH.name}...")
    with open(CBS_PC4_PATH) as f:
        cbs = json.load(f)
    pop_lookup: dict[str, int] = cbs.get("pc4_population", {})

    # Optional CBS income + SES-WOA enrichments. Both scripts produce JSON
    # keyed by PC4; if either file is missing, the corresponding fields are
    # silently left out and the downstream model drops those features.
    income_lookup: dict[str, dict] = {}
    income_meta = None
    if CBS_INCOME_PATH.exists():
        print(f"Loading CBS income from {CBS_INCOME_PATH.name}...")
        with open(CBS_INCOME_PATH) as f:
            inc_payload = json.load(f)
        income_lookup = inc_payload.get("pc4", {})
        income_meta = {
            "source": inc_payload.get("source"),
            "reference_date": inc_payload.get("reference_date"),
            "income_unit": inc_payload.get("income_unit"),
        }
        n_with = sum(1 for v in income_lookup.values()
                     if v.get("avg_income_household") is not None)
        print(f"  → {n_with}/{len(income_lookup)} PC4s have income")

    ses_lookup: dict[str, dict] = {}
    ses_meta = None
    if CBS_SES_PATH.exists():
        print(f"Loading CBS SES-WOA from {CBS_SES_PATH.name}...")
        with open(CBS_SES_PATH) as f:
            ses_payload = json.load(f)
        ses_lookup = ses_payload.get("pc4", {})
        ses_meta = {
            "source": ses_payload.get("source"),
            "reference_date": ses_payload.get("reference_date"),
        }
        n_with = sum(1 for v in ses_lookup.values()
                     if v.get("ses_woa_total") is not None)
        print(f"  → {n_with}/{len(ses_lookup)} PC4s have SES-WOA score")

    extra_lookup: dict[str, dict] = {}
    extra_meta = None
    if CBS_EXTRA_PATH.exists():
        print(f"Loading CBS extra features from {CBS_EXTRA_PATH.name}...")
        with open(CBS_EXTRA_PATH) as f:
            extra_payload = json.load(f)
        extra_lookup = extra_payload.get("pc4", {})
        extra_meta = {
            "source": extra_payload.get("source"),
            "reference_date": extra_payload.get("reference_date"),
        }
        print(f"  → {len(extra_lookup)} PC4s with derived features")

    ndw_lookup: dict[str, dict] = {}
    ndw_meta = None
    if NDW_LOADING_PATH.exists():
        print(f"Loading NDW loading-zone counts from {NDW_LOADING_PATH.name}...")
        with open(NDW_LOADING_PATH) as f:
            ndw_payload = json.load(f)
        ndw_lookup = ndw_payload.get("pc4", {})
        ndw_meta = {
            "source": ndw_payload.get("source"),
            "reference_date": ndw_payload.get("reference_date"),
        }
        with_any = sum(1 for v in ndw_lookup.values() if v.get("loading_zones", 0) > 0)
        print(f"  → {with_any}/{len(ndw_lookup)} PC4s with at least one loading zone")

    emission_lookup: dict[str, dict] = {}
    emission_meta = None
    if NDW_EMISSION_PATH.exists():
        print(f"Loading NDW emission-zones from {NDW_EMISSION_PATH.name}...")
        with open(NDW_EMISSION_PATH) as f:
            em_payload = json.load(f)
        emission_lookup = em_payload.get("pc4", {})
        emission_meta = {
            "source": em_payload.get("source"),
            "reference_date": em_payload.get("reference_date"),
            "zone_count": em_payload.get("zone_count"),
        }
        in_zone = sum(1 for v in emission_lookup.values() if v.get("in_zone"))
        print(f"  → {in_zone}/{len(emission_lookup)} PC4s inside an emission zone")

    ov_lookup: dict[str, dict] = {}
    ov_meta = None
    if OV_STOPS_PATH.exists():
        print(f"Loading OV stops per PC4 from {OV_STOPS_PATH.name}...")
        with open(OV_STOPS_PATH) as f:
            ov_payload = json.load(f)
        ov_lookup = ov_payload.get("pc4", {})
        ov_meta = {
            "source": ov_payload.get("source"),
            "reference_date": ov_payload.get("reference_date"),
        }
        with_stops = sum(1 for v in ov_lookup.values() if v.get("ov_stops", 0) > 0)
        print(f"  → {with_stops}/{len(ov_lookup)} PC4s with ≥1 OV-stop")

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
        inc = income_lookup.get(pc4, {})
        ses = ses_lookup.get(pc4, {})
        ex = extra_lookup.get(pc4, {})
        ndw = ndw_lookup.get(pc4, {})
        em = emission_lookup.get(pc4, {})
        ov = ov_lookup.get(pc4, {})
        stats[pc4] = {
            "area_km2": float(row["area_km2"]),
            "population": int(pop_lookup.get(pc4, 0)),
            "municipality": munic if isinstance(munic, str) else None,
            "parcel_points": counts.get(pc4, {
                "total": 0, "locker": 0, "shop": 0, "by_carrier": {},
            }),
            # CBS 2022 income / WOZ (may be None if CBS suppressed the cell)
            "avg_income_household": inc.get("avg_income_household"),
            "pct_low_income_household": inc.get("pct_low_income_household"),
            "pct_high_income_household": inc.get("pct_high_income_household"),
            "avg_woz_value": inc.get("avg_woz_value"),
            # CBS maatwerk 2022 SES-WOA scores (standardized, mean 0)
            "ses_woa_total": ses.get("ses_woa_total"),
            "ses_woa_welvaart": ses.get("ses_woa_welvaart"),
            "ses_woa_arbeid": ses.get("ses_woa_arbeid"),
            # CBS Kerncijfers 2022 derived features (supply + demand side)
            "urbanity": ex.get("urbanity"),
            "oad": ex.get("oad"),
            "pct_age_25_45": ex.get("pct_age_25_45"),
            "pct_single_hh": ex.get("pct_single_hh"),
            "pct_multi_family": ex.get("pct_multi_family"),
            "pct_owner_occupied": ex.get("pct_owner_occupied"),
            "horeca_1km": ex.get("horeca_1km"),
            "supermarket_1km": ex.get("supermarket_1km"),
            "station_km": ex.get("station_km"),
            "highway_km": ex.get("highway_km"),
            # NDW verkeersborden 2026 — laad-/losplaatsen (RVV code E7)
            "loading_zones": ndw.get("loading_zones"),
            "loading_zones_per_km2": ndw.get("loading_zones_per_km2"),
            # NDW emissiezones (milieuzone + ZE-zone, lowEmissionZone)
            "in_emission_zone": em.get("in_zone"),
            # OVapi GTFS 2026 — halte-dichtheid
            "ov_stops": ov.get("ov_stops"),
            "ov_stops_per_km2": ov.get("ov_stops_per_km2"),
            "ov_train_stops": ov.get("ov_train_stops"),
        }

    payload = {
        "generated_from": {
            "pc4_polygons": PC4_PATH.name,
            "pakketpunten": NEDERLAND_PATH.name,
            "cbs_dataset": cbs.get("dataset"),
            "cbs_period": cbs.get("period"),
            "cbs_income": income_meta,
            "cbs_ses_woa": ses_meta,
            "cbs_extra": extra_meta,
            "ndw_loading_zones": ndw_meta,
            "ndw_emission_zones": emission_meta,
            "ov_stops": ov_meta,
        },
        "stats": dict(sorted(stats.items())),
    }
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    with open(OUTPUT, "w") as f:
        json.dump(payload, f, separators=(",", ":"), allow_nan=False)
    size = OUTPUT.stat().st_size / 1024
    print(f"✓ {len(stats)} PC4 stats → {OUTPUT} ({size:.0f} KB)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
