"""Download the CBS SES-WOA per PC4 maatwerk XLSX (2021/2022) and emit a
tidy JSON keyed on PC4.

Source: https://www.cbs.nl/nl-nl/maatwerk/2024/24/sociaal-economische-status-per-viercijferige-postcode

The XLSX has two tabs: Tabel 1 (incl. studentenhuishoudens) and Tabel 2
(excl.). For parcel-point demand analysis we keep *incl. studenten* since
students also generate parcel traffic and dense student-heavy PC4s would
otherwise look artificially poor.

Missing values are encoded as "." in the source; they're converted to
``None``. The output keeps only the most recent reporting year (2022
voorlopig) and the SES-WOA total + sub-scores that matter for a
regression: total score, deelscore financiële welvaart, deelscore
arbeidsverleden.
"""
import json
import sys
from pathlib import Path

import pandas as pd
import requests

ROOT = Path(__file__).parent.parent
CACHE_DIR = ROOT / "data" / "cbs"
XLSX_PATH = CACHE_DIR / "ses_pc4_2021_2022.xlsx"
OUTPUT = ROOT / "data" / "cbs_pc4_ses_woa.json"
DOWNLOAD_URL = (
    "https://www.cbs.nl/-/media/_excel/2024/24/"
    "ses_pc4_2021_2022_incl_exclstudentenv4.xlsx"
)

# Zero-indexed columns in "Tabel 1" (incl. studentenhuishoudens)
COL_YEAR = 0
COL_PC4 = 1
COL_HOUSEHOLDS = 2
COL_INCOME_MEAN_PCT = 10     # Gestandaardiseerd inkomen: Gemiddelde percentielgroep
COL_WEALTH_MEAN_PCT = 14     # Financiële Welvaart: Gemiddelde percentielgroep
COL_DEELSCORE_WELVAART = 19  # SES-WOA deelscore financiële welvaart
COL_DEELSCORE_WORK = 20      # SES-WOA deelscore arbeidsverleden
COL_SES_TOTAL = 22           # Gemiddelde SES-WOA totaalscore (standardized z)
TARGET_YEAR = 2022           # 2021 = definitief; 2022 = voorlopig


def ensure_xlsx() -> Path:
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    if not XLSX_PATH.exists():
        print(f"Downloading {DOWNLOAD_URL}...")
        r = requests.get(DOWNLOAD_URL, timeout=300)
        r.raise_for_status()
        XLSX_PATH.write_bytes(r.content)
    return XLSX_PATH


def clean_num(value):
    if value is None:
        return None
    if isinstance(value, str):
        value = value.strip()
        if value in {"", ".", "x"}:
            return None
        try:
            value = float(value.replace(",", "."))
        except ValueError:
            return None
    try:
        v = float(value)
    except (TypeError, ValueError):
        return None
    if v != v:  # NaN
        return None
    return v


def main() -> int:
    xlsx = ensure_xlsx()
    print(f"Reading {xlsx.name} · sheet 'Tabel 1' (incl. studenten)...")
    df = pd.read_excel(xlsx, sheet_name="Tabel 1", header=None, skiprows=4)
    df.columns = [f"c{i}" for i in range(df.shape[1])]
    # Drop any fully-empty trailing rows
    df = df.dropna(subset=[f"c{COL_PC4}"])
    df = df[df[f"c{COL_YEAR}"] == TARGET_YEAR].copy()
    print(f"  → {len(df)} PC4 rows for {TARGET_YEAR}")

    by_pc4: dict[str, dict] = {}
    for _, row in df.iterrows():
        try:
            pc4 = str(int(row[f"c{COL_PC4}"])).zfill(4)
        except (TypeError, ValueError):
            continue
        by_pc4[pc4] = {
            "ses_woa_total": clean_num(row[f"c{COL_SES_TOTAL}"]),
            "ses_woa_welvaart": clean_num(row[f"c{COL_DEELSCORE_WELVAART}"]),
            "ses_woa_arbeid": clean_num(row[f"c{COL_DEELSCORE_WORK}"]),
            "income_percentile_mean": clean_num(row[f"c{COL_INCOME_MEAN_PCT}"]),
            "wealth_percentile_mean": clean_num(row[f"c{COL_WEALTH_MEAN_PCT}"]),
            "n_households": clean_num(row[f"c{COL_HOUSEHOLDS}"]),
        }

    n_total = len(by_pc4)
    n_with_score = sum(1 for v in by_pc4.values() if v["ses_woa_total"] is not None)
    print(f"  → {n_with_score}/{n_total} PC4s have an SES-WOA total score "
          f"({100 * n_with_score / n_total:.1f}% coverage)")

    payload = {
        "source": (
            "CBS maatwerk 2024/24: Sociaal-economische status per "
            "viercijferige postcode (incl. studentenhuishoudens)"
        ),
        "dataset_url": DOWNLOAD_URL,
        "reference_date": f"{TARGET_YEAR}-01-01",
        "status": "voorlopig" if TARGET_YEAR == 2022 else "definitief",
        "pc4": dict(sorted(by_pc4.items())),
    }
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    with open(OUTPUT, "w") as f:
        json.dump(payload, f, separators=(",", ":"), allow_nan=False)
    print(f"✓ {n_total} PC4s → {OUTPUT}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
