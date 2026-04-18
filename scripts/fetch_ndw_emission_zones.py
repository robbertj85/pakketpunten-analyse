"""Download NDW emissiezones (DATEX II) and flag PC4s that overlap a
milieuzone or zero-emissie-zone.

Source: https://opendata.ndw.nu/emissiezones.xml.gz (~120 KB)

Zones are delivered as DATEX II ``urbanVehicleAccessRegulation`` records
with ``controlledZoneType=lowEmissionZone`` and polygon geometry in GML
``posList`` format (space-separated lat/lon pairs). We parse the XML,
reconstruct Shapely polygons, spatial-join against PC4 polygons, and
emit a per-PC4 JSON with:

  - in_zone:        1 if the PC4 intersects *any* zone, 0 otherwise
  - zone_count:     number of overlapping zones (usually 0 or 1)
  - zone_names:     names of the overlapping zones

Rationale for the regression: zero-emissie-zones restrict combustion
trucks from delivering to doorsteps, which is expected to *increase*
demand for pickup points inside those zones as operators rely on PUDO
networks. Milieuzones (older diesel bans) have a similar but weaker
effect. Both sit at ``controlledZoneType=lowEmissionZone`` so we treat
them as one binary flag for now.
"""
import gzip
import json
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

import requests

ROOT = Path(__file__).parent.parent
CACHE_DIR = ROOT / "data" / "ndw"
GZ_PATH = CACHE_DIR / "emissiezones.xml.gz"
PC4_PATH = ROOT / "webapp" / "public" / "data" / "pc4.geojson"
OUTPUT = ROOT / "data" / "ndw_pc4_emission_zones.json"

DOWNLOAD_URL = "https://opendata.ndw.nu/emissiezones.xml.gz"

# DATEX II namespaces used in the payload
NS = {
    "mc":  "http://datex2.eu/schema/3/messageContainer",
    "cz":  "http://datex2.eu/schema/3/controlledZone",
    "com": "http://datex2.eu/schema/3/common",
    "loc": "http://datex2.eu/schema/3/locationReferencing",
}


def ensure_download() -> Path:
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    if GZ_PATH.exists():
        return GZ_PATH
    print(f"Downloading {DOWNLOAD_URL}...")
    r = requests.get(DOWNLOAD_URL, timeout=120)
    r.raise_for_status()
    GZ_PATH.write_bytes(r.content)
    return GZ_PATH


def parse_pos_list(text: str) -> list[tuple[float, float]]:
    """DATEX II / GML posList is space-separated 'lat lon lat lon ...'."""
    vals = [float(v) for v in text.replace(",", " ").split()]
    coords: list[tuple[float, float]] = []
    for i in range(0, len(vals) - 1, 2):
        lat, lon = vals[i], vals[i + 1]
        # Shapely wants (x, y) = (lon, lat)
        coords.append((lon, lat))
    return coords


def extract_zones() -> list[dict]:
    with gzip.open(GZ_PATH, "rb") as f:
        root = ET.parse(f).getroot()
    zones: list[dict] = []
    for reg in root.iter(f"{{{NS['cz']}}}urbanVehicleAccessRegulation"):
        name_el = reg.find(f"cz:name/com:values/com:value", NS)
        name = name_el.text.strip() if (name_el is not None and name_el.text) else "onbekend"
        ztype_el = reg.find(f"cz:controlledZoneType", NS)
        ztype = ztype_el.text.strip() if (ztype_el is not None and ztype_el.text) else ""
        status_el = reg.find(f"cz:status", NS)
        status = status_el.text.strip() if (status_el is not None and status_el.text) else ""
        # Polygon lives deep inside; use iter() to find any posList
        for pl in reg.iter(f"{{{NS['loc']}}}posList"):
            if not (pl.text and pl.text.strip()):
                continue
            coords = parse_pos_list(pl.text)
            if len(coords) < 4:
                continue
            zones.append({
                "name": name, "type": ztype, "status": status, "coords": coords,
            })
    return zones


def main() -> int:
    ensure_download()
    print("Parsing DATEX II payload...")
    zones = extract_zones()
    active = [z for z in zones if z["status"] == "active" or z["status"] == ""]
    print(f"  → {len(zones)} zone polygons ({len(active)} active)")
    if not zones:
        print("No zones extracted — aborting.", file=sys.stderr)
        return 1

    print("Spatial join against PC4 polygons...")
    import geopandas as gpd
    from shapely.geometry import Polygon

    zone_gdf = gpd.GeoDataFrame(
        [{"name": z["name"], "type": z["type"]} for z in active],
        geometry=[Polygon(z["coords"]) for z in active],
        crs="EPSG:4326",
    )
    # Repair any self-intersecting polygons via buffer(0)
    zone_gdf["geometry"] = zone_gdf.geometry.buffer(0)

    pc4 = gpd.read_file(PC4_PATH)
    pc4["pc4"] = pc4["pc4"].astype(str).str.zfill(4)

    joined = gpd.sjoin(pc4[["pc4", "geometry"]], zone_gdf,
                       how="left", predicate="intersects")

    by_pc4: dict[str, dict] = {}
    for code in pc4["pc4"]:
        by_pc4[code] = {"in_zone": 0, "zone_count": 0, "zone_names": []}
    import pandas as pd
    for _, row in joined.iterrows():
        ir = row.get("index_right")
        if ir is None or (isinstance(ir, float) and pd.isna(ir)):
            continue
        code = row["pc4"]
        raw_name = row.get("name")
        name = "onbekend" if (raw_name is None or (isinstance(raw_name, float) and pd.isna(raw_name))) else str(raw_name)
        entry = by_pc4[code]
        if name not in entry["zone_names"]:
            entry["zone_names"].append(name)
        entry["zone_count"] = len(entry["zone_names"])
        entry["in_zone"] = 1

    with_any = sum(1 for v in by_pc4.values() if v["in_zone"])
    print(f"  → {with_any}/{len(by_pc4)} PC4s inside an emission zone")

    payload = {
        "source": "NDW emissiezones (DATEX II, lowEmissionZone)",
        "dataset_url": DOWNLOAD_URL,
        "reference_date": "actueel",
        "zone_count": len(active),
        "pc4": dict(sorted(by_pc4.items())),
    }
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    with open(OUTPUT, "w") as f:
        json.dump(payload, f, separators=(",", ":"), allow_nan=False)
    print(f"✓ {len(by_pc4)} PC4s → {OUTPUT}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
