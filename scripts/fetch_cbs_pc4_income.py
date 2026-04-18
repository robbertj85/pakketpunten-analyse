"""Download the CBS 'Kerncijfers per postcode' PC4 GeoPackage and extract
household-level income and WOZ value per PC4.

Source: https://www.cbs.nl/nl-nl/dossier/nederland-regionaal/geografische-data/gegevens-per-postcode

We use the **2022** publication ("vol" final). Later years (2023, 2024) are
also published by CBS but have ``gemiddeld_inkomen_huishouden`` 100%
suppressed in recent editions — income fields are only visible in the 2022
edition and earlier. 2022 aligns with the SES-WOA reference year, keeping
the two regressor families temporally consistent.

CBS uses sentinel values inside the numeric fields:
  -99995 → cell is suppressed ("geheim") because the underlying count is too
           small for privacy or statistical reliability.
  -99997 → cell aggregates 0-4 observations and is replaced by this placeholder.
Both are mapped to Python ``None`` / JSON ``null`` on output so downstream
regression code can treat them as missing rather than interpret them as
very-negative incomes.
"""
import json
import sys
import zipfile
from pathlib import Path

import requests

ROOT = Path(__file__).parent.parent
CACHE_DIR = ROOT / "data" / "cbs"
ZIP_PATH = CACHE_DIR / "cbs_pc4_2022.zip"
GPKG_PATH = CACHE_DIR / "cbs_pc4_2022_vol.gpkg"
OUTPUT = ROOT / "data" / "cbs_pc4_income.json"

DOWNLOAD_URL = "https://download.cbs.nl/postcode/2025-cbs_pc4_2022_vol.zip"
SENTINELS = {-99995, -99997, -99995.0, -99997.0}

FIELDS = [
    "postcode",
    "gemiddeld_inkomen_huishouden",
    "percentage_laag_inkomen_huishouden",
    "percentage_hoog_inkomen_huishouden",
    "gemiddelde_woz_waarde_woning",
    "aantal_part_huishoudens",
]


def ensure_gpkg() -> Path:
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    if not GPKG_PATH.exists():
        if not ZIP_PATH.exists():
            print(f"Downloading {DOWNLOAD_URL}...")
            with requests.get(DOWNLOAD_URL, stream=True, timeout=300) as r:
                r.raise_for_status()
                with open(ZIP_PATH, "wb") as f:
                    for chunk in r.iter_content(1 << 20):
                        f.write(chunk)
        print(f"Extracting {ZIP_PATH.name}...")
        with zipfile.ZipFile(ZIP_PATH) as z:
            z.extractall(CACHE_DIR)
    return GPKG_PATH


def clean(value):
    if value is None:
        return None
    try:
        v = float(value)
    except (TypeError, ValueError):
        return None
    if v != v:  # NaN
        return None
    if v in SENTINELS:
        return None
    return v


def main() -> int:
    try:
        from pyogrio import read_dataframe
    except ImportError:
        print("ERROR: pyogrio not installed. Install with: pip install pyogrio",
              file=sys.stderr)
        return 1

    gpkg = ensure_gpkg()
    print(f"Reading {gpkg.name}...")
    # read_geometry=False skips the polygon decode, ~20x faster here
    df = read_dataframe(gpkg, columns=FIELDS, read_geometry=False)
    print(f"  → {len(df)} rows")

    by_pc4: dict[str, dict] = {}
    for _, row in df.iterrows():
        pc4 = str(int(row["postcode"])).zfill(4)
        by_pc4[pc4] = {
            "avg_income_household": clean(row.get("gemiddeld_inkomen_huishouden")),
            "pct_low_income_household": clean(row.get("percentage_laag_inkomen_huishouden")),
            "pct_high_income_household": clean(row.get("percentage_hoog_inkomen_huishouden")),
            "avg_woz_value": clean(row.get("gemiddelde_woz_waarde_woning")),
            "n_private_households": clean(row.get("aantal_part_huishoudens")),
        }

    n_total = len(by_pc4)
    n_with_income = sum(1 for v in by_pc4.values() if v["avg_income_household"] is not None)
    print(f"  → {n_with_income}/{n_total} PC4s have an income value "
          f"({100 * n_with_income / n_total:.1f}% coverage)")

    payload = {
        "source": "CBS Kerncijfers per postcode 2022 (vol)",
        "dataset_url": DOWNLOAD_URL,
        "reference_date": "2022-01-01",
        "income_unit": "1000 EUR per huishouden per jaar",
        "woz_unit": "1000 EUR",
        "suppression_sentinels": sorted(SENTINELS),
        "pc4": dict(sorted(by_pc4.items())),
    }
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    with open(OUTPUT, "w") as f:
        json.dump(payload, f, separators=(",", ":"), allow_nan=False)
    print(f"✓ {n_total} PC4s → {OUTPUT}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
