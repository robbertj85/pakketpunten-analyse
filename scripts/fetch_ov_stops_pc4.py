"""Count public-transport stops per PC4 from the nationwide GTFS feed.

Source: https://gtfs.ovapi.nl/nl/gtfs-nl.zip (~260 MB, refreshed daily)

GTFS' ``stops.txt`` is a ~6 MB CSV with lat/lon for every stop on every
Dutch carrier (NS, RET, HTM, GVB, Connexxion, Arriva, Qbuzz, regional
buses, and the tram/metro nets). We extract those, filter to "parent"
stop points (``location_type=0`` or blank — actual stop locations, not
stations/groupings), and spatial-join against PC4 polygons.

Three derived features per PC4:

  - ov_stops          total count of GTFS stops inside the polygon
  - ov_stops_per_km2  density, normalised to PC4 area
  - ov_train_stops    subset where stop name contains "Station" or the
                      stop_id starts with NS-style patterns, as a proxy
                      for heavy-rail presence. Approximate but fine for
                      a "near-rail?" binary.

The full GTFS zip is cached in ``data/ov/``. Only stops.txt is actually
read, so the memory footprint stays small.
"""
import csv
import io
import json
import sys
import zipfile
from pathlib import Path

import requests

ROOT = Path(__file__).parent.parent
CACHE_DIR = ROOT / "data" / "ov"
ZIP_PATH = CACHE_DIR / "gtfs-nl.zip"
PC4_PATH = ROOT / "webapp" / "public" / "data" / "pc4.geojson"
OUTPUT = ROOT / "data" / "ov_pc4_stops.json"

DOWNLOAD_URL = "https://gtfs.ovapi.nl/nl/gtfs-nl.zip"


def ensure_download() -> Path:
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    if ZIP_PATH.exists():
        return ZIP_PATH
    print(f"Downloading {DOWNLOAD_URL} (~260 MB)...")
    with requests.get(DOWNLOAD_URL, stream=True, timeout=600) as r:
        r.raise_for_status()
        with open(ZIP_PATH, "wb") as f:
            for chunk in r.iter_content(1 << 20):
                f.write(chunk)
    return ZIP_PATH


def load_stops() -> list[dict]:
    """Read stops.txt from the GTFS zip. Keeps the minimum we need:
    stop_id, stop_name, stop_lat, stop_lon, and location_type."""
    with zipfile.ZipFile(ZIP_PATH) as z:
        with z.open("stops.txt") as raw:
            text = io.TextIOWrapper(raw, encoding="utf-8-sig")
            reader = csv.DictReader(text)
            out: list[dict] = []
            for row in reader:
                try:
                    lat = float(row["stop_lat"])
                    lon = float(row["stop_lon"])
                except (ValueError, KeyError):
                    continue
                # location_type: 0 or blank = stop, 1 = station, 2 = entrance
                loc_type = (row.get("location_type") or "0").strip() or "0"
                if loc_type not in ("0", ""):
                    continue
                out.append({
                    "id": row.get("stop_id", ""),
                    "name": row.get("stop_name", "") or "",
                    "lat": lat,
                    "lon": lon,
                })
    return out


def main() -> int:
    ensure_download()
    print("Reading stops.txt from GTFS bundle...")
    stops = load_stops()
    print(f"  → {len(stops)} transit stops")
    if not stops:
        print("No stops parsed — aborting.", file=sys.stderr)
        return 1

    import geopandas as gpd
    import pandas as pd
    from shapely.geometry import Point

    # stop_name heuristic for trainstations: Dutch train stops carry names
    # like "Amsterdam Centraal", "Utrecht Overvecht", etc. We just match on
    # " Centraal" / "Station " / typical NS suffixes. Good enough for a
    # binary flag; not production-grade routing.
    TRAIN_MARKERS = (
        " station", "station ", "centraal", "centrum", "amstel", "sloterdijk",
    )
    def is_train(name: str) -> bool:
        n = name.lower()
        return any(m in n for m in TRAIN_MARKERS)

    pts = gpd.GeoDataFrame(
        [{"is_train": is_train(s["name"])} for s in stops],
        geometry=[Point(s["lon"], s["lat"]) for s in stops],
        crs="EPSG:4326",
    )
    pc4 = gpd.read_file(PC4_PATH)
    pc4["pc4"] = pc4["pc4"].astype(str).str.zfill(4)
    pc4_rd = pc4.to_crs("EPSG:28992")
    pc4["area_km2"] = (pc4_rd.area / 1e6).round(4).fillna(0.0)

    print("Spatial join stops → PC4...")
    joined = gpd.sjoin(pts, pc4[["pc4", "geometry"]],
                       how="inner", predicate="within")
    totals = joined.groupby("pc4").size().to_dict()
    train_counts = joined[joined["is_train"]].groupby("pc4").size().to_dict()

    by_pc4: dict[str, dict] = {}
    for _, row in pc4.iterrows():
        code = row["pc4"]
        n = int(totals.get(code, 0))
        nt = int(train_counts.get(code, 0))
        area = float(row["area_km2"])
        by_pc4[code] = {
            "ov_stops": n,
            "ov_stops_per_km2": round(n / area, 3) if area > 0 else None,
            "ov_train_stops": nt,
        }
    with_any = sum(1 for v in by_pc4.values() if v["ov_stops"] > 0)
    with_train = sum(1 for v in by_pc4.values() if v["ov_train_stops"] > 0)
    print(f"  → {with_any}/{len(by_pc4)} PC4s have ≥1 OV-stop")
    print(f"  → {with_train}/{len(by_pc4)} PC4s have ≥1 train-like stop")

    payload = {
        "source": "OVapi nationwide GTFS feed",
        "dataset_url": DOWNLOAD_URL,
        "reference_date": "actueel (dagelijks)",
        "pc4": dict(sorted(by_pc4.items())),
    }
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    with open(OUTPUT, "w") as f:
        json.dump(payload, f, separators=(",", ":"), allow_nan=False)
    print(f"✓ {len(by_pc4)} PC4s → {OUTPUT}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
