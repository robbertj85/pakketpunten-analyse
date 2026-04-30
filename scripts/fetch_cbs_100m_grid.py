"""Download the CBS Vierkantstatistieken 100m × 100m grid (Netherlands).

The grid contains population + housing counts per 100×100 m cell in RD New
(EPSG:28992). CBS suppresses small-cell counts using negative sentinels:
  - `aantal_inwoners == -99997` ⇒ count was suppressed (< 5 inhabitants)
  - `aantal_inwoners == -99998` ⇒ secondary suppression
  - `aantal_inwoners == -99999` ⇒ no data
We treat any of those as 0 inhabitants for downstream "is this cell inhabited?"
checks (lower bound — privacy-suppressed cells have ≥ 1 but < 5 inhabitants,
which is fine to ignore for placement-suggestion purposes).

Output: ``data/cbs_vk100_<year>.gpkg`` — same schema as the upstream CBS file,
but filtered to cells with `aantal_inwoners > 0` to halve the size.
"""
from __future__ import annotations

import argparse
import io
import sys
import zipfile
from pathlib import Path

import geopandas as gpd
import requests

ROOT = Path(__file__).parent.parent
CACHE_DIR = ROOT / "data" / "cbs"

# Verified working URLs (May 2025 release of 2024 data, retrieved 2026-04).
RELEASES = {
    "2024": "https://download.cbs.nl/vierkant/100/2025-cbs_vk100_2024_v1.zip",
    "2023": "https://download.cbs.nl/vierkant/100/2024-cbs_vk100_2023_v1.zip",
}
# CBS uses negative sentinels for privacy-suppressed cells. Treat as 0 for
# our downstream "is this cell inhabited?" filter.
SUPPRESSION_SENTINELS = {-99997, -99998, -99999}


def download(year: str) -> Path:
    if year not in RELEASES:
        raise SystemExit(f"Unknown release year {year!r}; choose from {list(RELEASES)}")
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    zip_path = CACHE_DIR / f"cbs_vk100_{year}.zip"
    if zip_path.exists():
        print(f"  ✓ {zip_path.name} already cached "
              f"({zip_path.stat().st_size / 1e6:.1f} MB)")
        return zip_path
    url = RELEASES[year]
    print(f"  Downloading {url}...")
    r = requests.get(url, timeout=300, stream=True)
    r.raise_for_status()
    with open(zip_path, "wb") as f:
        for chunk in r.iter_content(chunk_size=1 << 16):
            f.write(chunk)
    print(f"  ✓ saved {zip_path.relative_to(ROOT)} "
          f"({zip_path.stat().st_size / 1e6:.1f} MB)")
    return zip_path


def extract_gpkg(zip_path: Path) -> Path:
    out_path = zip_path.with_suffix(".gpkg")
    if out_path.exists():
        return out_path
    with zipfile.ZipFile(zip_path) as zf:
        gpkg_member = next(
            (n for n in zf.namelist() if n.endswith(".gpkg")), None
        )
        if not gpkg_member:
            raise SystemExit(f"No .gpkg inside {zip_path}: {zf.namelist()}")
        print(f"  extracting {gpkg_member}...")
        with zf.open(gpkg_member) as src, open(out_path, "wb") as dst:
            while True:
                chunk = src.read(1 << 16)
                if not chunk:
                    break
                dst.write(chunk)
    return out_path


def filter_inhabited(gpkg_path: Path, year: str) -> Path:
    """Keep only cells with `aantal_inwoners > 0` (after sentinel cleaning).
    Halves the file size and lets downstream code skip the suppression check.
    """
    out = CACHE_DIR / f"cbs_vk100_{year}_inhabited.gpkg"
    if out.exists():
        print(f"  ✓ {out.name} already filtered "
              f"({out.stat().st_size / 1e6:.1f} MB)")
        return out
    print(f"  Reading {gpkg_path.name}...")
    gdf = gpd.read_file(gpkg_path)
    print(f"    {len(gdf):,} cells, columns: {list(gdf.columns)[:8]}…")

    pop_col = next(
        (c for c in gdf.columns if c.lower() in {"aantal_inwoners", "inwoner", "inwoners"}),
        None,
    )
    if pop_col is None:
        raise SystemExit(
            f"No population column found in {gpkg_path}; columns = {list(gdf.columns)}"
        )

    # Replace sentinels with 0, then keep only inhabited cells. Drop the
    # other 30+ columns (age/gender/income breakdowns we don't need) so the
    # filtered file stays small enough to keep on disk between runs.
    gdf[pop_col] = gdf[pop_col].where(~gdf[pop_col].isin(SUPPRESSION_SENTINELS), 0)
    inhabited = gdf[gdf[pop_col] > 0][[pop_col, "geometry"]].copy()
    inhabited = inhabited.rename(columns={pop_col: "aantal_inwoners"})
    print(f"    {len(inhabited):,} inhabited cells "
          f"({100 * len(inhabited) / len(gdf):.1f}%)")
    inhabited.to_file(out, driver="GPKG")
    print(f"  ✓ wrote {out.relative_to(ROOT)} "
          f"({out.stat().st_size / 1e6:.1f} MB)")
    return out


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--year", default="2024", choices=list(RELEASES),
        help="CBS release year (default: 2024)",
    )
    args = parser.parse_args()

    print(f"CBS Vierkantstatistieken 100m — release {args.year}")
    zip_path = download(args.year)
    gpkg = extract_gpkg(zip_path)
    filter_inhabited(gpkg, args.year)
    print("\nDone. Use data/cbs/cbs_vk100_<year>_inhabited.gpkg in downstream scripts.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
