"""Fetch the nationwide 2022-2024 BRON accident dataset to local cache.

BRON (Bestand geRegistreerde Ongevallen Nederland) is Rijkswaterstaat's
registered-accidents database, published as an ArcGIS FeatureServer with
point geometry in RD New (EPSG:28992). We paginate the combined 2022-2024
layer (~382k accidents) in 2000-row batches — that's the service's
``maxRecordCount`` — and save a flat list for the PC4 enrichment step.

We only pull the columns we need for the traffic-safety features so the
cached JSON stays small (~40 MB instead of 200+):

  - jaar_ongeval          year, for possible time-window filters
  - partij_1_objecttype   first vehicle / object type (trucks, vans, ...)
  - partij_2_objecttype   second party (bikes, pedestrians, ...)
  - verkeersongeval_afloop  outcome: Dodelijk / Letsel / Uitsluitend materiele schade
  - bebouwde_kom          Ja/Nee — inside built-up area
  - x, y                  RD coordinates (EPSG:28992)

Re-run with ``--force`` to refresh.
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import requests

ROOT = Path(__file__).parent.parent
OUTPUT = ROOT / "data" / "bron_all_accidents.json"

SERVICE = (
    "https://geo.rijkswaterstaat.nl/arcgis/rest/services/GDR"
    "/verkeersongevallen_nederland/FeatureServer"
)
LAYER_ID = 3  # ongevallen_2022_2024 (combined)
PAGE_SIZE = 2000  # matches service maxRecordCount
FIELDS = [
    "verkeersongeval_nummer",
    "jaar_ongeval",
    "partij_1_objecttype",
    "partij_2_objecttype",
    "verkeersongeval_afloop",
    "bebouwde_kom",
]


def fetch_page(session: requests.Session, offset: int) -> dict:
    """One paginated request against the ArcGIS FeatureServer."""
    params = {
        "where": "1=1",
        "outFields": ",".join(FIELDS),
        "returnGeometry": "true",
        "outSR": "28992",  # keep the native RD; avoids reprojection on the server
        "resultOffset": offset,
        "resultRecordCount": PAGE_SIZE,
        "orderByFields": "verkeersongeval_nummer",
        "f": "json",
    }
    url = f"{SERVICE}/{LAYER_ID}/query"
    for attempt in range(4):
        try:
            r = session.get(url, params=params, timeout=60)
            r.raise_for_status()
            data = r.json()
            if "error" in data:
                raise RuntimeError(f"ArcGIS error: {data['error']}")
            return data
        except (requests.RequestException, ValueError, RuntimeError) as exc:
            wait = 2 ** attempt
            print(f"  ⚠ attempt {attempt + 1} failed ({exc}); retrying in {wait}s")
            time.sleep(wait)
    raise RuntimeError(f"Failed to fetch offset {offset} after 4 attempts")


def get_total_count(session: requests.Session) -> int:
    url = f"{SERVICE}/{LAYER_ID}/query"
    r = session.get(
        url,
        params={"where": "1=1", "returnCountOnly": "true", "f": "json"},
        timeout=30,
    )
    r.raise_for_status()
    return int(r.json()["count"])


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--force", action="store_true", help="refetch even if cache exists")
    args = parser.parse_args()

    if OUTPUT.exists() and not args.force:
        with open(OUTPUT) as f:
            cached = json.load(f)
        n = len(cached.get("accidents", []))
        print(f"✓ cache already present: {OUTPUT} ({n:,} accidents). Use --force to refetch.")
        return 0

    session = requests.Session()
    session.headers.update({"User-Agent": "pakketpunten-analyse/BRON-fetch"})

    print("Querying total row count...")
    total = get_total_count(session)
    print(f"  → {total:,} accidents to fetch in pages of {PAGE_SIZE}")

    accidents: list[dict] = []
    offset = 0
    t0 = time.time()
    while offset < total:
        page = fetch_page(session, offset)
        feats = page.get("features", [])
        if not feats:
            break
        for feat in feats:
            geom = feat.get("geometry") or {}
            attrs = feat.get("attributes") or {}
            # Keep the record compact — stripped keys, rounded coords.
            accidents.append({
                "id": attrs.get("verkeersongeval_nummer"),
                "year": attrs.get("jaar_ongeval"),
                "p1": attrs.get("partij_1_objecttype"),
                "p2": attrs.get("partij_2_objecttype"),
                "afloop": attrs.get("verkeersongeval_afloop"),
                "urban": attrs.get("bebouwde_kom"),
                "x": round(geom.get("x"), 2) if geom.get("x") is not None else None,
                "y": round(geom.get("y"), 2) if geom.get("y") is not None else None,
            })
        offset += len(feats)
        pct = 100 * offset / total
        elapsed = time.time() - t0
        rate = offset / elapsed if elapsed > 0 else 0
        eta = (total - offset) / rate if rate > 0 else 0
        print(f"  {offset:>7,}/{total:,} ({pct:5.1f}%) · {rate:.0f} rec/s · ETA {eta:5.0f}s")

    print(f"Fetched {len(accidents):,} accidents in {time.time() - t0:.0f}s")

    payload = {
        "source": "Rijkswaterstaat BRON (Bestand geRegistreerde Ongevallen Nederland)",
        "service": SERVICE,
        "layer": "ongevallen_2022_2024",
        "fetched_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "crs": "EPSG:28992",
        "fields": ["id", "year", "p1", "p2", "afloop", "urban", "x", "y"],
        "count": len(accidents),
        "accidents": accidents,
    }
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    with open(OUTPUT, "w") as f:
        json.dump(payload, f, separators=(",", ":"), allow_nan=False)
    size_mb = OUTPUT.stat().st_size / (1024 * 1024)
    print(f"✓ {len(accidents):,} accidents → {OUTPUT} ({size_mb:.1f} MB)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
