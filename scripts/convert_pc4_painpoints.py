"""Convert PC4_Postcodes_per_Carrier.xlsx into pc4_painpoints.json.

The spreadsheet lists G4-city PC4 "pijnpunten" per carrier; multiple carriers
can flag the same PC4. This script groups by PC4 so each postcode appears once
with the list of carriers that reported it.

Output shape:
    {
      "generated_at": "...",
      "source": "PC4_Postcodes_per_Carrier.xlsx",
      "painpoints": {
        "1072": { "city": "Amsterdam", "carriers": ["DPD", "Budbee", "VintedGo"] },
        ...
      }
    }
"""
import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).parent.parent
SOURCE = ROOT / "PC4_Postcodes_per_Carrier.xlsx"
OUTPUT = ROOT / "webapp" / "public" / "data" / "pc4_painpoints.json"


def main() -> int:
    df = pd.read_excel(SOURCE, sheet_name=0, header=None)

    # The detail block starts after the row whose first cell is "Stad"
    header_idx = df.index[df[0] == "Stad"].tolist()
    if not header_idx:
        print("Could not locate 'Stad' header row", file=sys.stderr)
        return 1
    start = header_idx[0] + 1

    painpoints: dict[str, dict] = {}
    current_city = None

    for _, row in df.iloc[start:].iterrows():
        city = row[0] if pd.notna(row[0]) else None
        carrier = row[1] if pd.notna(row[1]) else None
        codes_cell = row[2] if pd.notna(row[2]) else None

        if city:
            # Blank/section-break rows or status rows end the detail table
            if not carrier or not codes_cell:
                break
            current_city = str(city).strip()

        if not carrier or not codes_cell or not current_city:
            continue

        carrier = str(carrier).strip()
        for code in re.split(r"[·,;\s]+", str(codes_cell)):
            code = code.strip()
            if not re.fullmatch(r"\d{4}", code):
                continue
            entry = painpoints.setdefault(code, {"city": current_city, "carriers": []})
            if carrier not in entry["carriers"]:
                entry["carriers"].append(carrier)

    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "source": SOURCE.name,
        "painpoints": dict(sorted(painpoints.items())),
    }
    with open(OUTPUT, "w") as f:
        json.dump(payload, f, separators=(",", ":"), ensure_ascii=False)

    total_carrier_flags = sum(len(v["carriers"]) for v in painpoints.values())
    print(
        f"✓ Wrote {len(painpoints)} unique PC4s "
        f"({total_carrier_flags} carrier-flags) → {OUTPUT}"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
