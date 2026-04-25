"""Aggregate BRON accidents (2022-2024) to PC4 level.

Reads ``data/bron_all_accidents.json`` (produced by ``fetch_bron_accidents.py``),
spatially joins each point against ``webapp/public/data/pc4.geojson``, and emits
eight per-PC4 aggregates designed to feed the regression model as a new
"Verkeersveiligheid" feature group.

Outputs ``data/bron_pc4_accidents.json``::

    {
      "source": "Rijkswaterstaat BRON (2022-2024)",
      "reference_date": "...",
      "pc4": {
        "1011": {
          "crashes_total": 123,
          "crashes_total_per_km2": 45.6,
          "crashes_freight": 4,
          "crashes_van": 18,
          "crashes_freight_van_share": 0.18,
          "crashes_freight_vs_vulnerable": 5,
          "crashes_injury": 22,
          "crashes_urban": 110
        }, ...
      }
    }

Definitions:
  - freight  = Vrachtauto | Trekker | Trekker met oplegger (either party)
  - van      = Bestelauto (either party)
  - vulnerable = Fiets | e-bike | Voetganger | Bromfiets | Snorfiets | Scootmobiel
  - injury   = verkeersongeval_afloop in {Letsel, Dodelijk} (filters out UMS — the
               severity band with the weakest police-reporting coverage)
  - urban    = bebouwde_kom == 'Binnen'
"""
from __future__ import annotations

import json
import sys
from datetime import datetime, timezone
from pathlib import Path

import geopandas as gpd
import pandas as pd
from shapely.geometry import Point

ROOT = Path(__file__).parent.parent
BRON_PATH = ROOT / "data" / "bron_all_accidents.json"
PC4_PATH = ROOT / "webapp" / "public" / "data" / "pc4.geojson"
OUTPUT = ROOT / "data" / "bron_pc4_accidents.json"

FREIGHT = {"Vrachtauto", "Trekker", "Trekker met oplegger"}
VAN = {"Bestelauto"}
VULNERABLE = {"Fiets", "e-bike", "Voetganger", "Bromfiets", "Snorfiets", "Scootmobiel"}
INJURY_OUTCOMES = {"Letsel", "Dodelijk"}


def main() -> int:
    if not BRON_PATH.exists():
        print(f"✗ Missing {BRON_PATH}. Run scripts/fetch_bron_accidents.py first.")
        return 1

    print(f"Loading BRON accidents from {BRON_PATH.name}...")
    with open(BRON_PATH) as f:
        bron = json.load(f)
    accidents = bron["accidents"]
    print(f"  → {len(accidents):,} accidents")

    df = pd.DataFrame(accidents)
    # Drop rows without usable geometry (defensive — fetch already filters).
    before = len(df)
    df = df.dropna(subset=["x", "y"]).copy()
    if len(df) < before:
        print(f"  ⚠ dropped {before - len(df)} rows without geometry")

    # Precompute boolean classifications once; fast vectorised aggregation below.
    p1 = df["p1"].fillna("")
    p2 = df["p2"].fillna("")
    df["is_freight"] = p1.isin(FREIGHT) | p2.isin(FREIGHT)
    df["is_van"] = p1.isin(VAN) | p2.isin(VAN)
    # Freight/van vs. vulnerable: one side freight-or-van, other side vulnerable.
    fv_side1 = (p1.isin(FREIGHT) | p1.isin(VAN)) & p2.isin(VULNERABLE)
    fv_side2 = (p2.isin(FREIGHT) | p2.isin(VAN)) & p1.isin(VULNERABLE)
    df["is_fv_vs_vuln"] = fv_side1 | fv_side2
    df["is_injury"] = df["afloop"].isin(INJURY_OUTCOMES)
    df["is_urban"] = df["urban"] == "Binnen"

    print("Building point GeoDataFrame (EPSG:28992)...")
    gdf = gpd.GeoDataFrame(
        df.drop(columns=["x", "y"]),
        geometry=[Point(xy) for xy in zip(df["x"], df["y"])],
        crs="EPSG:28992",
    )

    print(f"Loading PC4 polygons from {PC4_PATH.name}...")
    pc4 = gpd.read_file(PC4_PATH)
    pc4["pc4"] = pc4["pc4"].astype(str).str.zfill(4)
    # PC4 file is WGS84 — reproject to RD to match BRON point geometry.
    pc4_rd = pc4.to_crs("EPSG:28992")
    # Use the projected geometry for the sjoin; keep area_km2 from the same CRS.
    pc4_rd["area_km2"] = pc4_rd.area / 1e6

    print("Spatial join: accidents → PC4...")
    joined = gpd.sjoin(
        gdf, pc4_rd[["pc4", "area_km2", "geometry"]], how="inner", predicate="within"
    )
    print(f"  → {len(joined):,} accidents matched to a PC4 "
          f"({100 * len(joined) / len(gdf):.1f}%)")

    print("Aggregating per PC4...")
    grouped = joined.groupby("pc4").agg(
        crashes_total=("id", "count"),
        crashes_freight=("is_freight", "sum"),
        crashes_van=("is_van", "sum"),
        crashes_freight_vs_vulnerable=("is_fv_vs_vuln", "sum"),
        crashes_injury=("is_injury", "sum"),
        crashes_urban=("is_urban", "sum"),
    )
    # area per PC4 for density — take the unique value from the join rather than
    # re-computing (grouped rows share the same polygon, so max == the value).
    area_by_pc4 = joined.groupby("pc4")["area_km2"].max()
    grouped = grouped.join(area_by_pc4.rename("area_km2"))
    grouped["crashes_total_per_km2"] = (
        grouped["crashes_total"] / grouped["area_km2"].replace(0, pd.NA)
    )
    # Expressed as a percentage (0-100) to match the existing pct_* conventions
    # elsewhere in pc4_stats.json. An accident can involve both a truck and a van
    # on opposite sides, so (freight + van) can exceed total — clip to avoid
    # ratios > 1 that would only confuse the regression.
    grouped["crashes_freight_van_share"] = (
        100.0
        * (grouped["crashes_freight"] + grouped["crashes_van"]).clip(upper=grouped["crashes_total"])
        / grouped["crashes_total"].replace(0, pd.NA)
    )

    # Ensure every PC4 has a row (zeros for PC4s with no accidents).
    all_pc4 = set(pc4_rd["pc4"].tolist())
    missing = all_pc4 - set(grouped.index)
    if missing:
        zero_row = pd.DataFrame(
            0, index=sorted(missing),
            columns=grouped.columns,
        )
        # Carry the right area for those PC4s too, so a non-zero density isn't
        # accidentally produced by a NaN fallback elsewhere.
        area_lookup = pc4_rd.set_index("pc4")["area_km2"]
        zero_row["area_km2"] = [float(area_lookup.get(p, 0.0)) for p in zero_row.index]
        zero_row["crashes_total_per_km2"] = 0.0
        zero_row["crashes_freight_van_share"] = 0.0
        grouped = pd.concat([grouped, zero_row]).sort_index()

    # Cast & round for compact JSON. Shares are unit-less ratios [0,1]; density
    # is accidents per km²; absolute counts stay integer.
    out: dict[str, dict] = {}
    for pc4_code, row in grouped.iterrows():
        out[pc4_code] = {
            "crashes_total": int(row["crashes_total"]),
            "crashes_total_per_km2": round(float(row["crashes_total_per_km2"] or 0.0), 2),
            "crashes_freight": int(row["crashes_freight"]),
            "crashes_van": int(row["crashes_van"]),
            "crashes_freight_van_share": round(float(row["crashes_freight_van_share"] or 0.0), 2),
            "crashes_freight_vs_vulnerable": int(row["crashes_freight_vs_vulnerable"]),
            "crashes_injury": int(row["crashes_injury"]),
            "crashes_urban": int(row["crashes_urban"]),
        }

    payload = {
        "source": "Rijkswaterstaat BRON (Bestand geRegistreerde Ongevallen Nederland)",
        "service": bron.get("service"),
        "layer": bron.get("layer"),
        "reference_date": bron.get("fetched_at"),
        "years": "2022-2024",
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "accident_count_input": len(gdf),
        "accident_count_matched": int(len(joined)),
        "pc4_count": len(out),
        "definitions": {
            "freight": sorted(FREIGHT),
            "van": sorted(VAN),
            "vulnerable": sorted(VULNERABLE),
            "injury": sorted(INJURY_OUTCOMES),
            "urban": "bebouwde_kom == 'Binnen'",
        },
        "pc4": dict(sorted(out.items())),
    }
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    with open(OUTPUT, "w") as f:
        json.dump(payload, f, separators=(",", ":"), allow_nan=False)
    size_kb = OUTPUT.stat().st_size / 1024
    nonzero = sum(1 for v in out.values() if v["crashes_total"] > 0)
    print(f"✓ {len(out):,} PC4s ({nonzero:,} with ≥1 accident) → {OUTPUT} ({size_kb:.0f} KB)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
