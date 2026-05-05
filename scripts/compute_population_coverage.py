"""Compute population coverage (% inwoners within 300m / 400m / 500m of a parcel point).

Output: ``webapp/public/data/population_coverage.json``

Per PC4 polygon and per municipality, for nine combinations
({total, shop, locker} × {300m, 400m, 500m}):

  covered_population = Σ aantal_inwoners over CBS 100m cells whose centroid
                       lies inside (PC4 ∩ buffer_union)
  pc4_population     = Σ aantal_inwoners over CBS 100m cells whose centroid
                       lies inside the PC4

Population numerator AND denominator both come from the CBS Vierkant­statistiek
100m grid (``data/cbs/cbs_vk100_<year>_inhabited.gpkg``). This is genuine
dasymetric mapping: empty space (water, parks, industrial estates, agriculture)
contributes 0 to the denominator, so a parcel point on the edge of a residential
strip flanked by farmland is correctly credited with reaching the residents
rather than being diluted across the whole PC4 polygon.

Earlier versions used a uniform-density assumption (population × area-fraction);
that overcounted reach in PC4s with large uninhabited zones.

Municipality-level aggregation is grid-summed:

  pct_covered = Σ_{cells in muni ∩ buffer} pop / Σ_{cells in muni} pop

Two scopes are computed so the user can see the elasticity between them:

  national  — buffer union built from ALL NL parcel points. A point in an
              adjacent municipality can reach residents across the border.
  strict    — buffer union built only from parcel points inside the same
              municipality. Administrative view.

Parallelised across CPU cores using multiprocessing with the 'fork' start
method, so workers inherit the loaded geodata via copy-on-write memory and
we avoid pickling big MultiPolygons per task.
"""
import json
import multiprocessing as mp
import os
import sys
import time
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

import geopandas as gpd
import numpy as np
from shapely import wkt
from shapely.geometry import shape
from shapely.ops import unary_union
from shapely.prepared import prep
from shapely.validation import make_valid

ROOT = Path(__file__).parent.parent
PC4_PATH        = ROOT / "webapp" / "public" / "data" / "pc4.geojson"
NEDERLAND_PATH  = ROOT / "webapp" / "public" / "data" / "nederland.geojson"
CBS_GRID_PATH   = ROOT / "data" / "cbs" / "cbs_vk100_2024_inhabited.gpkg"
MUNI_CACHE_PATH = ROOT / "data" / "municipality_polygon_cache.json"
OUTPUT          = ROOT / "webapp" / "public" / "data" / "population_coverage.json"

LOCKER_TYPES = {"packStation", "automaat", "dpd_box", "locker", "Buitenkluis"}
BUFFER_DISTANCES_M = [300, 400, 500]
SUBSETS = ["total", "shop", "locker"]
BUFFER_RESOLUTION = 8  # 32-segment circles — plenty accurate for 300-500m


def categorize(punt_type: str) -> str:
    return "locker" if punt_type in LOCKER_TYPES else "shop"


def build_union_from_geoms(geoms, distance_m: int):
    if not geoms:
        return None
    buffered = [g.buffer(distance_m, resolution=BUFFER_RESOLUTION)
                for g in geoms if g is not None and not g.is_empty]
    if not buffered:
        return None
    u = unary_union(buffered)
    if not u.is_valid:
        u = make_valid(u)
    return u


# ───────────────────────────────────────────────────────────────────────
# Worker shared state. Populated in the parent process BEFORE each Pool
# forks, so children inherit via copy-on-write memory. Workers only READ
# these — never mutate — to preserve COW sharing.
# ───────────────────────────────────────────────────────────────────────
_CELL_X: np.ndarray | None = None        # cell-centroid x in RD (m)
_CELL_Y: np.ndarray | None = None        # cell-centroid y in RD (m)
_CELL_POP: np.ndarray | None = None      # aantal_inwoners per cell
_CELL_PC4_IDX: np.ndarray | None = None  # PC4 row index per cell, -1 = outside any PC4
_CELL_MUNI: np.ndarray | None = None     # muni name per cell (object ndarray), '' = none
_PC4_DATA: list | None = None
#   tuple per PC4: (pc4_str, muni, area_km2, geom)
_NATIONAL_UNIONS: dict | None = None
#   dict[(subset, dist)] -> union geom (or None if empty)
_POINTS_BY_SUBSET: dict | None = None
_POINTS_BY_MUNI: dict | None = None
_MUNI_PC4_INDICES: dict | None = None
_PC4_CELL_INDICES: list | None = None    # list[ndarray] — cell indices per PC4
_MUNI_CELL_INDICES: dict | None = None   # dict[muni_name] -> cell indices ndarray


def _worker_union(key):
    """Build one (subset, distance) national buffer union."""
    subset, dist = key
    geoms = _POINTS_BY_SUBSET[subset]
    return key, build_union_from_geoms(geoms, dist)


def _mask_cells_in_union(cell_idx: np.ndarray, union) -> np.ndarray:
    """Boolean mask: which of the given cell indices have centroid in union?
    Uses shapely's prepared geometry for batch contains.
    """
    if union is None or len(cell_idx) == 0:
        return np.zeros(len(cell_idx), dtype=bool)
    pu = prep(union)
    xs = _CELL_X[cell_idx]
    ys = _CELL_Y[cell_idx]
    # Bounding-box prefilter — prep.contains() on points is already fast,
    # but a numpy bbox check trims obvious outsiders cheaply.
    minx, miny, maxx, maxy = union.bounds
    bbox = (xs >= minx) & (xs <= maxx) & (ys >= miny) & (ys <= maxy)
    out = np.zeros(len(cell_idx), dtype=bool)
    from shapely.geometry import Point as _Point
    for i in np.nonzero(bbox)[0]:
        if pu.contains(_Point(xs[i], ys[i])):
            out[i] = True
    return out


def _worker_pc4(idx):
    """Compute national-scope coverage for one PC4 row using CBS 100m cells."""
    pc4, muni, area_km2, _geom = _PC4_DATA[idx]
    cell_idx = _PC4_CELL_INDICES[idx]
    pop_total = int(_CELL_POP[cell_idx].sum()) if len(cell_idx) else 0
    row = {
        "pc4": pc4,
        "municipality": muni,
        "population": pop_total,
        "area_km2": area_km2,
    }
    for subset in SUBSETS:
        for dist in BUFFER_DISTANCES_M:
            u = _NATIONAL_UNIONS[(subset, dist)]
            if u is None or pop_total == 0:
                covered = 0
            else:
                mask = _mask_cells_in_union(cell_idx, u)
                covered = int(_CELL_POP[cell_idx][mask].sum())
            frac = covered / pop_total if pop_total > 0 else 0.0
            row[f"{subset}_{dist}_pct"] = round(frac * 100, 2)
            row[f"{subset}_{dist}_covered"] = covered
    return row


def _worker_muni_strict(muni_name):
    """Strict per-muni coverage: union from muni's own points only, summed
    over CBS cells inside that muni's PC4s.
    """
    point_list = _POINTS_BY_MUNI.get(muni_name, [])
    cell_idx = _MUNI_CELL_INDICES.get(muni_name, np.array([], dtype=np.int64))
    result = {
        "name": muni_name,
        "points_total": len(point_list),
        "points_shop":   sum(1 for _, c in point_list if c == "shop"),
        "points_locker": sum(1 for _, c in point_list if c == "locker"),
    }
    for subset in SUBSETS:
        sub = [g for g, c in point_list if (subset == "total" or c == subset)]
        for dist in BUFFER_DISTANCES_M:
            u = build_union_from_geoms(sub, dist)
            if u is None or len(cell_idx) == 0:
                covered = 0
            else:
                mask = _mask_cells_in_union(cell_idx, u)
                covered = int(_CELL_POP[cell_idx][mask].sum())
            result[f"{subset}_{dist}_covered_strict"] = covered
    return result


def metric_block(covered: float, pop: float) -> dict:
    pct = round((covered / pop * 100), 2) if pop > 0 else 0.0
    return {"covered": int(round(covered)), "pct": pct}


def main() -> int:
    global _PC4_DATA, _NATIONAL_UNIONS, _POINTS_BY_SUBSET
    global _POINTS_BY_MUNI, _MUNI_PC4_INDICES
    global _CELL_X, _CELL_Y, _CELL_POP, _CELL_PC4_IDX, _CELL_MUNI
    global _PC4_CELL_INDICES, _MUNI_CELL_INDICES

    n_jobs = int(os.environ.get("N_JOBS", max(1, (os.cpu_count() or 8) - 1)))
    print(f"Using {n_jobs} parallel workers (set N_JOBS env to override)")

    # ─── Load inputs ────────────────────────────────────────────────────
    t0 = time.time()
    print("Loading PC4 polygons...")
    pc4_gdf = gpd.read_file(PC4_PATH)
    pc4_gdf["pc4"] = pc4_gdf["pc4"].astype(str).str.zfill(4)
    pc4_gdf = pc4_gdf.to_crs("EPSG:28992")
    pc4_gdf = pc4_gdf[pc4_gdf.geometry.notna()].copy()
    pc4_gdf["geometry"] = pc4_gdf.geometry.apply(
        lambda g: g if (g is not None and g.is_valid) else make_valid(g)
    )
    pc4_gdf["area_km2"] = (pc4_gdf.area / 1e6).round(4)
    pc4_gdf = pc4_gdf.reset_index(drop=True)

    if not CBS_GRID_PATH.exists():
        print(f"❌ CBS grid not found at {CBS_GRID_PATH}. Run "
              f"`python scripts/fetch_cbs_100m_grid.py` first.")
        return 1
    print(f"Loading CBS 100m inhabited grid from {CBS_GRID_PATH.name}...")
    cells_gdf = gpd.read_file(CBS_GRID_PATH)
    if cells_gdf.crs is None:
        cells_gdf = cells_gdf.set_crs("EPSG:28992")
    elif cells_gdf.crs.to_epsg() != 28992:
        cells_gdf = cells_gdf.to_crs("EPSG:28992")
    print(f"  → {len(cells_gdf):,} inhabited cells, "
          f"{int(cells_gdf['aantal_inwoners'].sum()):,} residents")

    print(f"Loading parcel points from {NEDERLAND_PATH.name}...")
    with open(NEDERLAND_PATH) as f:
        ned = json.load(f)
    point_records = []
    for feat in ned.get("features", []):
        props = feat.get("properties", {})
        if props.get("type") != "pakketpunt":
            continue
        point_records.append({
            "geometry": shape(feat["geometry"]),
            "vervoerder": props.get("vervoerder", ""),
            "puntType": props.get("puntType", ""),
            "category": categorize(props.get("puntType", "")),
        })
    points_gdf = gpd.GeoDataFrame(point_records, crs="EPSG:4326").to_crs("EPSG:28992")
    n_shop   = int((points_gdf["category"] == "shop").sum())
    n_locker = int((points_gdf["category"] == "locker").sum())
    print(f"  → {len(points_gdf)} points: {n_shop} shops, {n_locker} lockers")

    print(f"Loading municipality polygons from {MUNI_CACHE_PATH.name}...")
    with open(MUNI_CACHE_PATH) as f:
        muni_cache = json.load(f)
    muni_records = [
        {"municipality": v.get("gemeente") or key.split(":")[0],
         "geometry": wkt.loads(v["geometry_wkt"])}
        for key, v in muni_cache.items()
    ]
    muni_gdf = gpd.GeoDataFrame(muni_records, crs="EPSG:4326").to_crs("EPSG:28992")
    print(f"  → {len(muni_gdf)} municipalities")

    print("Attributing PC4s to municipalities via centroid sjoin...")
    pc4_centroids = pc4_gdf.copy()
    pc4_centroids["geometry"] = pc4_centroids.geometry.representative_point()
    pc4_located = gpd.sjoin_nearest(
        pc4_centroids[["pc4", "geometry"]],
        muni_gdf[["municipality", "geometry"]],
        how="left",
    )
    pc4_to_muni = dict(zip(pc4_located["pc4"], pc4_located["municipality"]))
    pc4_gdf["municipality"] = pc4_gdf["pc4"].map(pc4_to_muni)

    print("Attributing points to municipalities via sjoin...")
    joined = gpd.sjoin(
        points_gdf,
        muni_gdf[["municipality", "geometry"]],
        how="left",
        predicate="within",
    )
    joined = joined[~joined.index.duplicated(keep="first")]
    points_gdf["municipality"] = joined["municipality"]
    n_unmatched = int(points_gdf["municipality"].isna().sum())
    if n_unmatched:
        print(f"  → {n_unmatched} points fell outside all muni polygons "
              "(only contribute to national-scope union)")

    # ─── Cell → PC4 (centroid sjoin) ────────────────────────────────────
    print("Attributing CBS cells to PC4s via centroid sjoin...")
    cells_gdf["geometry"] = cells_gdf.geometry.centroid
    cell_pc4_join = gpd.sjoin(
        cells_gdf[["aantal_inwoners", "geometry"]],
        pc4_gdf[["pc4", "municipality", "geometry"]],
        how="left",
        predicate="within",
    )
    cell_pc4_join = cell_pc4_join[~cell_pc4_join.index.duplicated(keep="first")]
    cell_pc4_join = cell_pc4_join.reindex(cells_gdf.index)

    pc4_idx_lookup = {p: i for i, p in enumerate(pc4_gdf["pc4"].tolist())}
    pc4_idx_arr = (
        cell_pc4_join["pc4"]
        .map(pc4_idx_lookup)
        .fillna(-1)
        .astype(np.int64)
        .to_numpy()
    )
    muni_arr = (
        cell_pc4_join["municipality"].fillna("").astype(str).to_numpy()
    )
    cell_xy = np.array([(g.x, g.y) for g in cells_gdf.geometry])
    n_outside = int((pc4_idx_arr == -1).sum())
    if n_outside:
        print(f"  → {n_outside:,} cells fell outside all PC4 polygons "
              "(ignored)")
    print(f"Inputs ready in {time.time() - t0:.1f}s")

    # ─── Shape data into worker-shared globals ─────────────────────────
    _CELL_X = cell_xy[:, 0]
    _CELL_Y = cell_xy[:, 1]
    _CELL_POP = cells_gdf["aantal_inwoners"].astype(np.int64).to_numpy()
    _CELL_PC4_IDX = pc4_idx_arr
    _CELL_MUNI = muni_arr

    _PC4_DATA = [
        (row["pc4"], row["municipality"], float(row["area_km2"]), row.geometry)
        for _, row in pc4_gdf.iterrows()
    ]
    print(f"Prepared {len(_PC4_DATA)} PC4 tuples")

    # Cell indices grouped by PC4 row — vectorised groupby via argsort + split.
    _PC4_CELL_INDICES = [np.array([], dtype=np.int64) for _ in range(len(_PC4_DATA))]
    valid = _CELL_PC4_IDX >= 0
    cells_with_pc4 = np.nonzero(valid)[0]
    sort_order = cells_with_pc4[np.argsort(_CELL_PC4_IDX[cells_with_pc4], kind="stable")]
    sorted_pc4 = _CELL_PC4_IDX[sort_order]
    split_points = np.searchsorted(sorted_pc4, np.arange(len(_PC4_DATA) + 1))
    for i in range(len(_PC4_DATA)):
        _PC4_CELL_INDICES[i] = sort_order[split_points[i]:split_points[i + 1]]

    _POINTS_BY_SUBSET = {
        "total":  list(points_gdf.geometry),
        "shop":   [g for g, c in zip(points_gdf.geometry, points_gdf["category"]) if c == "shop"],
        "locker": [g for g, c in zip(points_gdf.geometry, points_gdf["category"]) if c == "locker"],
    }

    _POINTS_BY_MUNI = defaultdict(list)
    for g, c, m in zip(points_gdf.geometry, points_gdf["category"], points_gdf["municipality"]):
        if m:
            _POINTS_BY_MUNI[m].append((g, c))
    _POINTS_BY_MUNI = dict(_POINTS_BY_MUNI)

    _MUNI_PC4_INDICES = defaultdict(list)
    for i, (_, muni, _, _) in enumerate(_PC4_DATA):
        if muni:
            _MUNI_PC4_INDICES[muni].append(i)
    _MUNI_PC4_INDICES = dict(_MUNI_PC4_INDICES)

    # Cell indices per muni — concatenation of cells per PC4 in that muni.
    _MUNI_CELL_INDICES = {}
    for muni_name, pc4_indices in _MUNI_PC4_INDICES.items():
        parts = [_PC4_CELL_INDICES[i] for i in pc4_indices]
        _MUNI_CELL_INDICES[muni_name] = (
            np.concatenate(parts) if parts else np.array([], dtype=np.int64)
        )

    ctx = mp.get_context("fork")

    # ─── Phase 1: 9 national buffer unions in parallel ───────────────────
    t1 = time.time()
    union_keys = [(s, d) for s in SUBSETS for d in BUFFER_DISTANCES_M]
    print(f"Phase 1: building {len(union_keys)} national buffer unions in parallel...")
    national_unions: dict = {}
    with ctx.Pool(min(len(union_keys), n_jobs)) as pool:
        for key, u in pool.imap_unordered(_worker_union, union_keys):
            national_unions[key] = u
            n_pts = len(_POINTS_BY_SUBSET[key[0]])
            area_km2 = (u.area / 1e6) if u is not None else 0.0
            print(f"  done {key[0]:6s} @ {key[1]:3d}m: {n_pts:5d} pts → "
                  f"union {area_km2:7.1f} km²")
    print(f"Phase 1 done in {time.time() - t1:.1f}s")

    _NATIONAL_UNIONS = national_unions

    # ─── Phase 2a: per-PC4 national-scope coverage ──────────────────────
    t2 = time.time()
    print(f"Phase 2a: per-PC4 national coverage ({len(_PC4_DATA)} PC4s)...")
    pc4_rows: list = []
    chunk = max(20, len(_PC4_DATA) // (n_jobs * 8))
    with ctx.Pool(n_jobs) as pool:
        done = 0
        next_tick = 500
        for row in pool.imap_unordered(_worker_pc4,
                                       range(len(_PC4_DATA)),
                                       chunksize=chunk):
            pc4_rows.append(row)
            done += 1
            if done >= next_tick:
                print(f"  {done}/{len(_PC4_DATA)}...")
                next_tick += 500
    print(f"Phase 2a done in {time.time() - t2:.1f}s")

    # ─── Phase 2b: strict per-muni coverage (parallel) ──────────────────
    t3 = time.time()
    muni_names = list(_MUNI_PC4_INDICES.keys())
    print(f"Phase 2b: strict per-muni coverage ({len(muni_names)} munis)...")
    strict_results: list = []
    with ctx.Pool(n_jobs) as pool:
        done = 0
        next_tick = 50
        for res in pool.imap_unordered(_worker_muni_strict,
                                       muni_names,
                                       chunksize=8):
            strict_results.append(res)
            done += 1
            if done >= next_tick:
                print(f"  {done}/{len(muni_names)}...")
                next_tick += 50
    print(f"Phase 2b done in {time.time() - t3:.1f}s")

    # ─── Roll up ─────────────────────────────────────────────────────────
    print("Rolling up national + national-scope municipality totals...")
    muni_accum: dict = defaultdict(lambda: defaultdict(float))
    nation: dict = defaultdict(float)
    for r in pc4_rows:
        pop = r["population"]
        muni = r["municipality"]
        nation["population"] += pop
        if muni:
            muni_accum[muni]["population"] += pop
            muni_accum[muni]["pc4_count"] += 1
        for subset in SUBSETS:
            for dist in BUFFER_DISTANCES_M:
                covered = r[f"{subset}_{dist}_covered"]
                nation[f"{subset}_{dist}_covered"] += covered
                if muni:
                    muni_accum[muni][f"{subset}_{dist}_covered_nat"] += covered

    # Merge strict results
    for res in strict_results:
        name = res["name"]
        muni_accum[name]["points_total"]  = res["points_total"]
        muni_accum[name]["points_shop"]   = res["points_shop"]
        muni_accum[name]["points_locker"] = res["points_locker"]
        for subset in SUBSETS:
            for dist in BUFFER_DISTANCES_M:
                muni_accum[name][f"{subset}_{dist}_covered_strict"] = \
                    res[f"{subset}_{dist}_covered_strict"]

    # ─── Shape final output ──────────────────────────────────────────────
    print("Assembling output payload...")
    munis_out = {}
    for muni_name, a in muni_accum.items():
        pop = a["population"]
        entry = {
            "population": int(round(pop)),
            "pc4_count": int(a["pc4_count"]),
            "parcel_points": {
                "total": int(a["points_total"]),
                "shop": int(a["points_shop"]),
                "locker": int(a["points_locker"]),
            },
            "national": {},
            "strict": {},
        }
        for subset in SUBSETS:
            entry["national"][subset] = {
                f"{dist}m": metric_block(a[f"{subset}_{dist}_covered_nat"], pop)
                for dist in BUFFER_DISTANCES_M
            }
            entry["strict"][subset] = {
                f"{dist}m": metric_block(a[f"{subset}_{dist}_covered_strict"], pop)
                for dist in BUFFER_DISTANCES_M
            }
        munis_out[muni_name] = entry

    pc4_out = {}
    for r in pc4_rows:
        entry = {
            "municipality": r["municipality"],
            "population": r["population"],
            "area_km2": r["area_km2"],
        }
        for subset in SUBSETS:
            entry[subset] = {
                f"{dist}m": {
                    "pct": r[f"{subset}_{dist}_pct"],
                    "covered": int(round(r[f"{subset}_{dist}_covered"])),
                }
                for dist in BUFFER_DISTANCES_M
            }
        pc4_out[r["pc4"]] = entry

    national_pop = nation["population"]
    national_out = {"population": int(round(national_pop))}
    for subset in SUBSETS:
        national_out[subset] = {
            f"{dist}m": metric_block(nation[f"{subset}_{dist}_covered"], national_pop)
            for dist in BUFFER_DISTANCES_M
        }

    payload = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "methodology": {
            "buffer_distances_m": BUFFER_DISTANCES_M,
            "subsets": SUBSETS,
            "apportionment": (
                "CBS Vierkantstatistiek 100m grid: covered = Σ aantal_inwoners "
                "over inhabited cells whose centroid lies in (PC4 ∩ buffer-union); "
                "denominator = Σ over cells whose centroid lies in the PC4. "
                "Empty space (water, parks, industrial estates, agriculture) "
                "contributes 0 — no uniform-density assumption."
            ),
            "scope_national": "buffer union built from ALL NL parcel points (cross-border reach allowed)",
            "scope_strict":   "buffer union built only from parcel points within the same municipality",
            "pc4_to_municipality": "PC4 representative_point sjoin_nearest against municipality_polygon_cache (full 342 munis)",
            "buffer_circle_segments": BUFFER_RESOLUTION * 4,
        },
        "sources": {
            "parcel_points": "webapp/public/data/nederland.geojson",
            "pc4_polygons": "webapp/public/data/pc4.geojson",
            "pc4_population": (
                f"CBS Vierkantstatistiek 100m grid ({CBS_GRID_PATH.name}) — "
                "summed per PC4 from inhabited cells"
            ),
            "municipality_polygons": "data/municipality_polygon_cache.json",
        },
        "national": national_out,
        "municipalities": munis_out,
        "pc4": pc4_out,
    }

    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    with open(OUTPUT, "w") as f:
        json.dump(payload, f, separators=(",", ":"))
    size_mb = OUTPUT.stat().st_size / 1e6
    print(f"\nWrote {OUTPUT.relative_to(ROOT)} ({size_mb:.2f} MB)")
    print(f"Total elapsed: {time.time() - t0:.1f}s")
    print(f"National (all / 300m): {national_out['total']['300m']['pct']}%")
    print(f"National (all / 400m): {national_out['total']['400m']['pct']}%")
    print(f"National (all / 500m): {national_out['total']['500m']['pct']}%")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
