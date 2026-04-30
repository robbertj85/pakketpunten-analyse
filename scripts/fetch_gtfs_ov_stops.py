"""Download Dutch GTFS feed and extract OV-halte coordinates.

Source: OVapi (https://gtfs.ovapi.nl/nl/gtfs-nl.zip), the consolidated GTFS
feed for all Dutch public transport (bus, tram, metro, train, ferry).

We only need ``stops.txt``; the full feed is ~240 MB but stops.txt is < 5 MB.
The script streams the zip, extracts that one entry, and writes a compact
JSON list of ``{id, name, lat, lon, mode}`` records — the minimum we need to
spatial-join against placement suggestions.
"""
from __future__ import annotations

import argparse
import csv
import io
import json
import sys
import zipfile
from collections import Counter
from pathlib import Path

import requests

ROOT = Path(__file__).parent.parent
CACHE_DIR = ROOT / "data" / "ov"
ZIP_PATH = CACHE_DIR / "gtfs-nl.zip"
OUT_PATH = CACHE_DIR / "gtfs_stops.json"

GTFS_URL = "https://gtfs.ovapi.nl/nl/gtfs-nl.zip"


def download(force: bool = False) -> Path:
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    if ZIP_PATH.exists() and not force:
        size_mb = ZIP_PATH.stat().st_size / 1e6
        print(f"  ✓ {ZIP_PATH.name} cached ({size_mb:.0f} MB)")
        return ZIP_PATH
    print(f"  Downloading {GTFS_URL}...")
    r = requests.get(GTFS_URL, timeout=600, stream=True)
    r.raise_for_status()
    total = int(r.headers.get("content-length", 0))
    with open(ZIP_PATH, "wb") as f:
        downloaded = 0
        for chunk in r.iter_content(chunk_size=1 << 20):  # 1 MB chunks
            f.write(chunk)
            downloaded += len(chunk)
            if total:
                pct = 100 * downloaded / total
                print(f"\r    {downloaded/1e6:.0f} / {total/1e6:.0f} MB "
                      f"({pct:.0f}%)", end="", flush=True)
    print()
    print(f"  ✓ saved {ZIP_PATH.relative_to(ROOT)} "
          f"({ZIP_PATH.stat().st_size / 1e6:.0f} MB)")
    return ZIP_PATH


def extract_stops(zip_path: Path) -> list[dict]:
    with zipfile.ZipFile(zip_path) as zf:
        if "stops.txt" not in zf.namelist():
            raise SystemExit(f"stops.txt missing from {zip_path}; entries: "
                             f"{zf.namelist()[:5]}…")
        with zf.open("stops.txt") as src:
            text = io.TextIOWrapper(src, encoding="utf-8-sig", newline="")
            reader = csv.DictReader(text)
            rows = list(reader)
    print(f"  {len(rows):,} GTFS stop rows")
    return rows


def to_records(rows: list[dict]) -> list[dict]:
    """Keep only board-able stops (location_type 0 or empty), drop parent
    station entries (location_type 1) — those are abstract groupings, the
    actual platforms are separate entries. Cast lat/lon to float."""
    out: list[dict] = []
    skipped_parent = 0
    skipped_invalid = 0
    for r in rows:
        loc = (r.get("location_type") or "").strip()
        if loc == "1":
            skipped_parent += 1
            continue
        try:
            lat = float(r["stop_lat"])
            lon = float(r["stop_lon"])
        except (KeyError, ValueError):
            skipped_invalid += 1
            continue
        # Skip stops with degenerate coordinates (some GTFS files have 0,0).
        if lat == 0 and lon == 0:
            skipped_invalid += 1
            continue
        out.append({
            "id": r.get("stop_id") or "",
            "code": r.get("stop_code") or "",
            "name": r.get("stop_name") or "",
            "lat": round(lat, 6),
            "lon": round(lon, 6),
            "platform": r.get("platform_code") or "",
        })
    print(f"  → {len(out):,} board-able stops "
          f"(skipped {skipped_parent} parent stations, "
          f"{skipped_invalid} invalid coords)")
    return out


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--force", action="store_true",
                        help="Re-download the GTFS zip even if cached.")
    args = parser.parse_args()

    print("OV-haltes — Dutch GTFS feed (OVapi)")
    zip_path = download(force=args.force)
    rows = extract_stops(zip_path)
    records = to_records(rows)

    # Sample a few names so we can eyeball the parse.
    sample = [(r["name"], r["lat"], r["lon"]) for r in records[:5]]
    print(f"  Sample: {sample}")

    payload = {
        "source": GTFS_URL,
        "downloaded_at": ZIP_PATH.stat().st_mtime if ZIP_PATH.exists() else None,
        "count": len(records),
        "stops": records,
    }
    OUT_PATH.write_text(json.dumps(payload, separators=(",", ":")))
    print(f"\n✅ Wrote {OUT_PATH.relative_to(ROOT)} "
          f"({OUT_PATH.stat().st_size / 1e6:.1f} MB, {len(records):,} stops)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
