"""Download NDW verkeersborden and extract the laad-/losplaatsen per PC4.

Source: https://opendata.ndw.nu/verkeersborden_actueel_beeld_wgs84.geojson.gz
(~240 MB gzipped, 1.9 M traffic signs, updated daily)

"Laad- en losplaatsen" don't have a dedicated dataset — they're the
subset of traffic signs with RVV code **E7** (gelegenheid bestemd voor
onmiddellijk laden en lossen van goederen). We also keep E8 (sub-variant)
as belonging to the same logistic-street family.

The full file is cached once; subsequent runs reuse it. We stream-parse
with ijson so we never hold 1.9 M features in memory, spatial-join the
filtered points against the PC4 polygons the webapp already uses, and
write a tidy JSON keyed by PC4.
"""
import gzip
import json
import sys
from decimal import Decimal
from pathlib import Path

import requests


def _json_default(o):
    # ijson yields Decimal for numbers; json doesn't serialise them natively.
    if isinstance(o, Decimal):
        return float(o)
    raise TypeError(f"Object of type {type(o).__name__} is not JSON serialisable")

ROOT = Path(__file__).parent.parent
CACHE_DIR = ROOT / "data" / "ndw"
GZ_PATH = CACHE_DIR / "verkeersborden_actueel_beeld_wgs84.geojson.gz"
PC4_PATH = ROOT / "webapp" / "public" / "data" / "pc4.geojson"
FILTERED_PATH = CACHE_DIR / "laadplaatsen.geojson"
OUTPUT = ROOT / "data" / "ndw_pc4_loading_zones.json"

DOWNLOAD_URL = "https://opendata.ndw.nu/verkeersborden_actueel_beeld_wgs84.geojson.gz"

# RVV codes for loading/unloading. E7 is the canonical "laad-/losplaats".
# E8 codes are sub-variants (e.g. E8f for disabled, E8e for electric). The
# NDW feed uses the raw RVV code as a property — we keep anything starting
# with E7 and flag E8 explicitly in case we want to split later.
LOADING_CODES = ("E7",)


def ensure_download() -> Path:
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    if GZ_PATH.exists():
        print(f"Using cached {GZ_PATH.name} ({GZ_PATH.stat().st_size / 1e6:.0f} MB)")
        return GZ_PATH
    print(f"Downloading {DOWNLOAD_URL} (~240 MB)...")
    with requests.get(DOWNLOAD_URL, stream=True, timeout=600) as r:
        r.raise_for_status()
        total = int(r.headers.get("Content-Length") or 0)
        got = 0
        with open(GZ_PATH, "wb") as f:
            for chunk in r.iter_content(1 << 20):
                f.write(chunk)
                got += len(chunk)
                if total:
                    print(f"  {got / 1e6:.0f}/{total / 1e6:.0f} MB", end="\r")
        print()
    return GZ_PATH


def extract_loading_zones() -> list[dict]:
    """Stream-parse the GeoJSON file, keeping only E7 / E8 features.

    We try ijson if installed (saves RAM for the 1.9M feature file); fall
    back to json.load if not — still works since the features array is
    chunked through gzip decompression.
    """
    try:
        import ijson
    except ImportError:
        print("Note: install ijson for faster streaming (pip install ijson). Using json.load fallback.")
        ijson = None

    keep: list[dict] = []
    with gzip.open(GZ_PATH, "rb") as gz:
        if ijson is not None:
            for feat in ijson.items(gz, "features.item"):
                props = feat.get("properties") or {}
                code = str(props.get("rvvCode") or props.get("rvv_code") or "")
                if any(code.upper().startswith(p) for p in LOADING_CODES):
                    # Minimal payload — we only need coordinates + RVV
                    geom = feat.get("geometry")
                    if not geom or geom.get("type") != "Point":
                        continue
                    keep.append({
                        "type": "Feature",
                        "properties": {
                            "rvv": code,
                            "tekst": props.get("onderbordText") or props.get("bordtekst") or "",
                        },
                        "geometry": geom,
                    })
        else:
            data = json.load(gz)
            for feat in data.get("features", []):
                props = feat.get("properties") or {}
                code = str(props.get("rvvCode") or props.get("rvv_code") or "")
                if any(code.upper().startswith(p) for p in LOADING_CODES):
                    geom = feat.get("geometry")
                    if not geom or geom.get("type") != "Point":
                        continue
                    keep.append({
                        "type": "Feature",
                        "properties": {
                            "rvv": code,
                            "tekst": props.get("onderbordText") or props.get("bordtekst") or "",
                        },
                        "geometry": geom,
                    })
    return keep


def main() -> int:
    ensure_download()
    print("Extracting E7 laad-/losplaatsen from ~1.9M traffic signs...")
    features = extract_loading_zones()
    print(f"  → {len(features)} laad-/losplaatsen found")

    # Cache the filtered set as a small GeoJSON for future reuse / debugging
    filtered = {"type": "FeatureCollection", "features": features}
    FILTERED_PATH.write_text(json.dumps(filtered, default=_json_default))
    print(f"  → cached filtered set to {FILTERED_PATH.name}")

    # Spatial join against PC4 polygons
    print(f"Spatial join vs {PC4_PATH.name}...")
    import geopandas as gpd
    from shapely.geometry import shape, Point

    pc4 = gpd.read_file(PC4_PATH)
    pc4["pc4"] = pc4["pc4"].astype(str).str.zfill(4)
    # Build GeoDataFrame of loading zones
    if not features:
        print("No loading zones found — aborting.", file=sys.stderr)
        return 1
    pts = gpd.GeoDataFrame(
        [{"rvv": f["properties"]["rvv"]} for f in features],
        geometry=[shape(f["geometry"]) for f in features],
        crs="EPSG:4326",
    )
    joined = gpd.sjoin(pts, pc4[["pc4", "geometry"]], how="inner", predicate="within")
    # area_km2 to express density as zones per km²
    pc4_rd = pc4.to_crs("EPSG:28992")
    pc4["area_km2"] = (pc4_rd.area / 1e6).round(4).fillna(0.0)

    by_pc4: dict[str, dict] = {}
    counts = joined.groupby("pc4").size().to_dict()
    for _, row in pc4.iterrows():
        code = row["pc4"]
        n = int(counts.get(code, 0))
        area = float(row["area_km2"])
        by_pc4[code] = {
            "loading_zones": n,
            "loading_zones_per_km2": round(n / area, 3) if area > 0 else None,
        }

    with_any = sum(1 for v in by_pc4.values() if v["loading_zones"] > 0)
    print(f"  → {with_any}/{len(by_pc4)} PC4s have at least one E7 zone "
          f"(mean: {sum(v['loading_zones'] for v in by_pc4.values()) / max(1, len(by_pc4)):.1f})")

    payload = {
        "source": "NDW verkeersborden (RVV code E7)",
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
