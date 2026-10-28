#!/usr/bin/env python3
"""
Population outlook and urbanity class per gemeente, for the parcel-point forecast.

Two CBS StatLine tables:
- 86247NED "Gebieden in Nederland 2026": per gemeente the COROP area, province,
  stedelijkheid (1 = zeer sterk stedelijk ... 5 = niet stedelijk), inwonertal and
  omgevingsadressendichtheid.
- 85171NED "Regionale prognose 2023-2050; bevolking": the PBL/CBS population
  forecast. It is published per COROP area and province, not per gemeente, so each
  gemeente inherits the growth index of its COROP area (province as fallback).

Output: data/cbs/gemeente_population_forecast.json, keyed by GM code:
    {naam, corop, provincie, stedelijkheid, inwoners, oad,
     pop_index: {"2026": 1.0, "2027": ..., "2031": ...}}   # relative to 2026
"""

import json
import os
from datetime import datetime, timezone
from pathlib import Path

import requests

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "data" / "cbs" / "gemeente_population_forecast.json"

ODATA = "https://opendata.cbs.nl/ODataApi/odata"
GEBIEDEN = "86247NED"
PROGNOSE = "85171NED"
BASE_YEAR = 2026
YEARS = range(2025, 2032)


def fetch_all(url: str, params: dict) -> list:
    rows, session = [], requests.Session()
    while url:
        response = session.get(url, params=params, timeout=60)
        response.raise_for_status()
        payload = response.json()
        rows.extend(payload["value"])
        url, params = payload.get("odata.nextLink"), None
    return rows


def clean(value):
    return value.strip() if isinstance(value, str) else value


def main():
    gebieden = fetch_all(
        f"{ODATA}/{GEBIEDEN}/TypedDataSet",
        {
            "$format": "json",
            "$select": "RegioS,Naam_2,Code_10,Code_28,Code_54,Inwonertal_56,Omgevingsadressendichtheid_57",
        },
    )
    print(f"Gebieden in Nederland: {len(gebieden)} gemeenten")

    periods = ",".join(f"'{y}JJ00'" for y in YEARS)
    prognose = fetch_all(
        f"{ODATA}/{PROGNOSE}/TypedDataSet",
        {
            "$format": "json",
            "$filter": "Leeftijd eq '10000' and Geslacht eq 'T001038'",
            "$select": "RegioIndeling2021,Perioden,TotaleBevolking_1",
        },
    )
    population = {}
    for row in prognose:
        year = int(row["Perioden"][:4])
        if year in YEARS and row["TotaleBevolking_1"] is not None:
            population.setdefault(clean(row["RegioIndeling2021"]), {})[year] = row["TotaleBevolking_1"]
    print(f"Regionale prognose: {len(population)} regio's (NL, provincies, COROP)")

    def index_for(region: str):
        series = population.get(region)
        if not series or BASE_YEAR not in series:
            return None
        return {str(y): round(series[y] / series[BASE_YEAR], 5) for y in YEARS if y in series}

    national = index_for("NL01")
    result, fallbacks = {}, 0
    for row in gebieden:
        code = clean(row["RegioS"])
        corop, provincie = clean(row["Code_10"]), clean(row["Code_28"])
        idx = index_for(corop)
        if idx is None:
            idx = index_for(provincie) or national
            fallbacks += 1
        stedelijkheid = clean(row["Code_54"])
        result[code] = {
            "naam": clean(row["Naam_2"]),
            "corop": corop,
            "provincie": provincie,
            # Code_54 is e.g. "SV1"; keep the digit as the class.
            "stedelijkheid": int(stedelijkheid[-1]) if stedelijkheid and stedelijkheid[-1].isdigit() else None,
            "inwoners": row["Inwonertal_56"],
            "oad": row["Omgevingsadressendichtheid_57"],
            "pop_index": idx,
        }

    OUT.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "sources": {
            "gebieden": f"CBS StatLine {GEBIEDEN} (Gebieden in Nederland 2026)",
            "prognose": f"CBS/PBL StatLine {PROGNOSE} (Regionale prognose 2023-2050, COROP-niveau)",
        },
        "base_year": BASE_YEAR,
        "national_index": national,
        "gemeenten": result,
    }
    tmp = OUT.with_suffix(".json.tmp")
    with open(tmp, "w", encoding="utf-8") as handle:
        json.dump(payload, handle, ensure_ascii=False, indent=1)
    os.replace(tmp, OUT)
    print(f"Wrote {OUT.relative_to(ROOT)}: {len(result)} gemeenten ({fallbacks} via provincie/NL fallback)")
    print(f"NL index {BASE_YEAR}->2030: {national.get('2030')}")


if __name__ == "__main__":
    main()
