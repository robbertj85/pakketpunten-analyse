"""Convert PC4_Postcodes_per_Carrier2.xlsx into pc4_painpoints.json.

The spreadsheet lists G4-city PC4 "pijnpunten" reported by two distinct types
of source: (a) carriers (DPD/PostNL/DHL/GLS/Budbee/VintedGo/ViaTim/...) and
(b) the G4 municipalities themselves. Multiple sources can flag the same PC4.

The 30-april-2026 revision (file v2) added the separate "DETAIL: G4-Gemeente
knelpuntgebieden" block. Carrier-supplied and gemeente-supplied PC4s are kept
strictly separate in the output so the UI can show them on distinct pages.

The "Contactpersoon" column in the gemeente block is intentionally ignored —
personal names are not propagated into the JSON or the webapp.

Output shape:
    {
      "generated_at": "...",
      "source": "PC4_Postcodes_per_Carrier2.xlsx",
      "painpoints": {
        "1072": {
          "city": "Amsterdam",
          "carriers": ["DPD", "Budbee", "VintedGo"],
          "gemeenten": ["Amsterdam"]
        },
        ...
      },
      "gemeente_status": {
        "Amsterdam": "ontvangen",
        "Rotterdam": "openstaand",
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
SOURCE = ROOT / "PC4_Postcodes_per_Carrier2.xlsx"
OUTPUT = ROOT / "webapp" / "public" / "data" / "pc4_painpoints.json"

# Pain-points reported outside the main Excel (e.g. bilateral gesprekken).
# Each entry: (city, carrier, [pc4 codes], note)
BILATERAL_ADDITIONS: list[tuple[str, str, list[str], str]] = [
    ("Amsterdam", "ViaTim", ["1012", "1013", "1016", "1017", "1018"],
     "Bilateraal gesprek 3 april 2026"),
]


def _find_section_starts(df: pd.DataFrame) -> dict[str, int]:
    """Return the row index *after* each section's header row.

    Sections of interest:
      - 'carrier_detail':  "DETAIL: Alle PC4-codes per stad" (header row 'Stad' / 'Carrier' / 'PC4-code(s)')
      - 'gemeente_detail': "DETAIL: G4-Gemeente knelpuntgebieden" (header row 'Stad' / 'Contactpersoon' / 'PC4-code(s)')
    """
    starts: dict[str, int] = {}
    for i, val in df[0].items():
        if not isinstance(val, str):
            continue
        s = val.strip()
        if s.startswith("DETAIL: Alle PC4-codes per stad"):
            # The next row is the header ('Stad'/'Carrier'/'PC4-code(s)'); data starts after that.
            starts["carrier_detail"] = i + 2
        elif s.startswith("DETAIL: G4-Gemeente"):
            starts["gemeente_detail"] = i + 2
    return starts


def _empty_entry(city: str) -> dict:
    return {"city": city, "carriers": [], "gemeenten": []}


def _parse_carrier_detail(df: pd.DataFrame, start: int, painpoints: dict[str, dict]) -> None:
    current_city = None
    for _, row in df.iloc[start:].iterrows():
        city = row[0] if pd.notna(row[0]) else None
        carrier = row[1] if pd.notna(row[1]) else None
        codes_cell = row[2] if pd.notna(row[2]) else None

        if city:
            # Section ends at the next non-data block (e.g. "DETAIL: G4-Gemeente …" or STATUS row).
            city_str = str(city).strip()
            if city_str.startswith("DETAIL:") or city_str.startswith("STATUS:"):
                return
            if not carrier or not codes_cell:
                return
            current_city = city_str

        if not carrier or not codes_cell or not current_city:
            continue

        carrier = str(carrier).strip()
        for code in re.split(r"[·,;\s]+", str(codes_cell)):
            code = code.strip()
            if not re.fullmatch(r"\d{4}", code):
                continue
            entry = painpoints.setdefault(code, _empty_entry(current_city))
            if carrier not in entry["carriers"]:
                entry["carriers"].append(carrier)


def _parse_gemeente_detail(
    df: pd.DataFrame,
    start: int,
    painpoints: dict[str, dict],
    gemeente_status: dict[str, str],
) -> None:
    """Each row: Stad | Contactpersoon | PC4-code(s) | Aantal.

    The contactperson column is intentionally ignored to keep personal names
    out of the JSON. Rows whose code cell is "Openstaand" / "—" / empty mark
    a gemeente as still openstaand.
    """
    for _, row in df.iloc[start:].iterrows():
        city = row[0] if pd.notna(row[0]) else None
        codes_cell = row[2] if pd.notna(row[2]) else None

        if not city:
            continue
        city_str = str(city).strip()
        if city_str.startswith("STATUS:") or city_str.startswith("DETAIL:"):
            break

        if not codes_cell:
            gemeente_status.setdefault(city_str, "openstaand")
            continue
        codes_str = str(codes_cell).strip()
        if "Openstaand" in codes_str or codes_str in {"—", "-"}:
            gemeente_status[city_str] = "openstaand"
            continue

        any_added = False
        for code in re.split(r"[·,;\s]+", codes_str):
            code = code.strip()
            if not re.fullmatch(r"\d{4}", code):
                continue
            entry = painpoints.setdefault(code, _empty_entry(city_str))
            if city_str not in entry["gemeenten"]:
                entry["gemeenten"].append(city_str)
            any_added = True
        if any_added:
            gemeente_status[city_str] = "ontvangen"


def main() -> int:
    df = pd.read_excel(SOURCE, sheet_name=0, header=None)

    sections = _find_section_starts(df)
    if "carrier_detail" not in sections:
        print("Could not locate 'DETAIL: Alle PC4-codes per stad' section", file=sys.stderr)
        return 1

    painpoints: dict[str, dict] = {}
    gemeente_status: dict[str, str] = {}
    _parse_carrier_detail(df, sections["carrier_detail"], painpoints)

    if "gemeente_detail" in sections:
        _parse_gemeente_detail(
            df, sections["gemeente_detail"], painpoints, gemeente_status
        )

    # Merge in out-of-band additions (e.g. bilateral conversations not yet
    # reflected in the Excel). These are still carrier-side sources.
    notes: dict[str, list[str]] = {}
    for city, carrier, codes, note in BILATERAL_ADDITIONS:
        for code in codes:
            if not re.fullmatch(r"\d{4}", code):
                continue
            entry = painpoints.setdefault(code, _empty_entry(city))
            if carrier not in entry["carriers"]:
                entry["carriers"].append(carrier)
            notes.setdefault(code, []).append(f"{carrier}: {note}")
    for code, note_list in notes.items():
        existing = painpoints[code].get("notes", [])
        for n in note_list:
            if n not in existing:
                existing.append(n)
        painpoints[code]["notes"] = existing

    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "source": SOURCE.name,
        "painpoints": dict(sorted(painpoints.items())),
        "gemeente_status": dict(sorted(gemeente_status.items())),
    }
    with open(OUTPUT, "w") as f:
        json.dump(payload, f, separators=(",", ":"), ensure_ascii=False)

    total_carrier_flags = sum(len(v["carriers"]) for v in painpoints.values())
    total_gem_flags = sum(len(v.get("gemeenten", [])) for v in painpoints.values())
    pc4_carrier_only = sum(
        1 for v in painpoints.values() if v["carriers"] and not v.get("gemeenten")
    )
    pc4_gemeente_only = sum(
        1 for v in painpoints.values() if v.get("gemeenten") and not v["carriers"]
    )
    pc4_both = sum(
        1 for v in painpoints.values() if v["carriers"] and v.get("gemeenten")
    )
    print(
        f"✓ Wrote {len(painpoints)} unique PC4s "
        f"({total_carrier_flags} carrier-flags, {total_gem_flags} gemeente-flags) "
        f"→ {OUTPUT}"
    )
    print(
        f"  carrier-only: {pc4_carrier_only}  •  gemeente-only: {pc4_gemeente_only}  •  beide: {pc4_both}"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
