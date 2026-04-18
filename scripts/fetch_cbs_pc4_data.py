"""Fetch total population per PC4 from CBS dataset 83502NED.

Writes ``data/cbs_pc4.json`` keyed by 4-digit postcode with the total
inhabitants for the latest available year.
"""
import json
import sys
from pathlib import Path

import requests

ROOT = Path(__file__).parent.parent
OUTPUT = ROOT / "data" / "cbs_pc4.json"
DATASET = "83502NED"
BASE = f"https://opendata.cbs.nl/ODataApi/odata/{DATASET}"


def latest_period() -> str:
    # CBS OData doesn't reliably honour $orderby on Perioden, so fetch all
    # and pick the highest key (e.g. "2025JJ00").
    r = requests.get(
        f"{BASE}/Perioden",
        params={"$format": "json", "$select": "Key"},
        timeout=60,
    )
    r.raise_for_status()
    return max(item["Key"] for item in r.json()["value"])


def fetch_totals(period: str) -> dict[str, int]:
    params = {
        "$format": "json",
        "$filter": (
            f"Geslacht eq 'T001038' and Leeftijd eq '10000' and Perioden eq '{period}'"
        ),
        "$select": "Postcode,Bevolking_1",
    }
    out: dict[str, int] = {}
    url = f"{BASE}/TypedDataSet"
    while url:
        r = requests.get(url, params=params, timeout=120)
        r.raise_for_status()
        payload = r.json()
        for row in payload.get("value", []):
            code = (row.get("Postcode") or "").strip()
            pop = row.get("Bevolking_1")
            if not code.startswith("PC") or pop is None:
                continue
            pc4 = code[2:6]
            if pc4.isdigit():
                out[pc4] = int(pop)
        url = payload.get("odata.nextLink")
        params = None  # already encoded in nextLink
    return out


def main() -> int:
    period = latest_period()
    print(f"Fetching CBS {DATASET} for period {period}...")
    populations = fetch_totals(period)
    if not populations:
        print("No rows returned — dataset format may have changed", file=sys.stderr)
        return 1
    total = sum(populations.values())
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "dataset": DATASET,
        "period": period,
        "pc4_population": dict(sorted(populations.items())),
    }
    with open(OUTPUT, "w") as f:
        json.dump(payload, f, separators=(",", ":"))
    print(f"✓ {len(populations)} PC4s, {total:,} total inhabitants → {OUTPUT}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
