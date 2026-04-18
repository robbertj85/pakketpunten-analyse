"""Extract supply-side and demand-side features from the same CBS PC4
GeoPackage that ``fetch_cbs_pc4_income.py`` already downloaded, without
re-downloading it.

The Kerncijfers-per-postcode bundle contains ~130 columns — only a small
subset was used up to now (income + WOZ). This script derives the rest of
the features that theory says matter for parcel-point placement:

  Demand-side
    urbanity                 stedelijkheid 1-5 (CBS ordinal)
    oad                      omgevingsadressendichtheid (continuous)
    pct_age_25_45            aandeel bevolking 25-45 jaar (peak e-commerce age)
    pct_single_hh            aandeel eenpersoonshuishoudens
    pct_multi_family         aandeel meergezinswoningen (flats → missed deliveries)
    pct_owner_occupied       aandeel koopwoningen

  Supply-side
    horeca_1km               café + cafetaria + restaurant binnen 1 km
    supermarket_1km          grote supermarkten binnen 1 km
    station_km               afstand tot dichtstbijzijnde treinstation
    highway_km               afstand tot dichtstbijzijnde oprit hoofdverkeersweg

CBS sentinels (-99995, -99997) become None so downstream regression code
can treat them as missing. Percentages derived from two counts return
None when either denominator is missing or zero. Output goes to
``data/cbs_pc4_extra.json``; the income fetcher must have run first to
populate the cache.
"""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).parent.parent
GPKG_PATH = ROOT / "data" / "cbs" / "cbs_pc4_2022_vol.gpkg"
OUTPUT = ROOT / "data" / "cbs_pc4_extra.json"
SENTINELS = {-99995, -99997, -99995.0, -99997.0}

RAW_COLUMNS = [
    "postcode",
    "aantal_inwoners",
    "aantal_inwoners_25_tot_45_jaar",
    "aantal_part_huishoudens",
    "aantal_eenpersoonshuishoudens",
    "aantal_woningen",
    "aantal_meergezins_woningen",
    "percentage_koopwoningen",
    "omgevingsadressendichtheid",
    "stedelijkheid",
    "cafe_aantal_binnen_1_km",
    "cafetaria_aantal_binnen_1_km",
    "restaurant_aantal_binnen_1_km",
    "grote_supermarkt_aantal_binnen_1_km",
    "dichtstbijzijnde_treinstation_afstand_in_km",
    "dichtstbijzijnde_oprit_hoofdverkeersweg_afstand_in_km",
]


def clean(value):
    if value is None:
        return None
    try:
        v = float(value)
    except (TypeError, ValueError):
        return None
    if v != v or v in SENTINELS:
        return None
    return v


def pct(num, den):
    a, b = clean(num), clean(den)
    if a is None or b is None or b <= 0:
        return None
    return round(100 * a / b, 2)


def main() -> int:
    if not GPKG_PATH.exists():
        print(f"ERROR: {GPKG_PATH} not found — run fetch_cbs_pc4_income.py first.",
              file=sys.stderr)
        return 1

    try:
        from pyogrio import read_dataframe
    except ImportError:
        print("ERROR: pyogrio not installed. Install with: pip install pyogrio",
              file=sys.stderr)
        return 1

    print(f"Reading {GPKG_PATH.name} (no geometry)...")
    df = read_dataframe(GPKG_PATH, columns=RAW_COLUMNS, read_geometry=False)
    print(f"  → {len(df)} rows")

    by_pc4: dict[str, dict] = {}
    for _, row in df.iterrows():
        pc4 = str(int(row["postcode"])).zfill(4)
        horeca = sum(
            (clean(row[c]) or 0)
            for c in (
                "cafe_aantal_binnen_1_km",
                "cafetaria_aantal_binnen_1_km",
                "restaurant_aantal_binnen_1_km",
            )
            if clean(row[c]) is not None
        )
        # If all three horeca counts are missing (geheim), we don't want to
        # output 0 because that's wrong — it's unknown. Check at least one
        # source had a non-null value.
        horeca_known = any(
            clean(row[c]) is not None
            for c in (
                "cafe_aantal_binnen_1_km",
                "cafetaria_aantal_binnen_1_km",
                "restaurant_aantal_binnen_1_km",
            )
        )

        by_pc4[pc4] = {
            "urbanity": clean(row["stedelijkheid"]),
            "oad": clean(row["omgevingsadressendichtheid"]),
            "pct_age_25_45": pct(
                row["aantal_inwoners_25_tot_45_jaar"], row["aantal_inwoners"]
            ),
            "pct_single_hh": pct(
                row["aantal_eenpersoonshuishoudens"], row["aantal_part_huishoudens"]
            ),
            "pct_multi_family": pct(
                row["aantal_meergezins_woningen"], row["aantal_woningen"]
            ),
            "pct_owner_occupied": clean(row["percentage_koopwoningen"]),
            "horeca_1km": float(horeca) if horeca_known else None,
            "supermarket_1km": clean(row["grote_supermarkt_aantal_binnen_1_km"]),
            "station_km": clean(row["dichtstbijzijnde_treinstation_afstand_in_km"]),
            "highway_km": clean(
                row["dichtstbijzijnde_oprit_hoofdverkeersweg_afstand_in_km"]
            ),
        }

    # Coverage summary
    keys = list(next(iter(by_pc4.values())).keys())
    print("Coverage:")
    for k in keys:
        n_with = sum(1 for v in by_pc4.values() if v[k] is not None)
        print(f"  {k:<22} {n_with:>5}/{len(by_pc4)}  ({100*n_with/len(by_pc4):.0f}%)")

    payload = {
        "source": "CBS Kerncijfers per postcode 2022 (vol) — derived features",
        "reference_date": "2022-01-01",
        "pc4": dict(sorted(by_pc4.items())),
    }
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    with open(OUTPUT, "w") as f:
        json.dump(payload, f, separators=(",", ":"), allow_nan=False)
    print(f"✓ {len(by_pc4)} PC4s → {OUTPUT}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
