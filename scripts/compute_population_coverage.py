"""Compute population coverage (% inwoners within 300m / 400m of a parcel point).

Output: ``webapp/public/data/population_coverage.json``

Per PC4 polygon and per municipality, for six combinations
({total, shop, locker} × {300m, 400m}):

  coverage_fraction = area(PC4 ∩ buffer_union) / area(PC4)
  covered_population = PC4_population × coverage_fraction

Municipality-level aggregation is population-weighted:

  pct_covered = Σ(PC4_pop × fraction) / Σ(PC4_pop)

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
from shapely import wkt
from shapely.geometry import shape
from shapely.ops import unary_union
from shapely.validation import make_valid

ROOT = Path(__file__).parent.parent
PC4_PATH        = ROOT / "webapp" / "public" / "data" / "pc4.geojson"
NEDERLAND_PATH  = ROOT / "webapp" / "public" / "data" / "nederland.geojson"
CBS_PC4_PATH    = ROOT / "data" / "cbs_pc4.json"
MUNI_CACHE_PATH = ROOT / "data" / "municipality_polygon_cache.json"
OUTPUT          = ROOT / "webapp" / "public" / "data" / "population_coverage.json"

LOCKER_TYPES = {"packStation", "automaat", "dpd_box", "locker", "Buitenkluis"}
BUFFER_DISTANCES_M = [300, 400, 500]
SUBSETS = ["total", "shop", "locker"]
BUFFER_RESOLUTION = 8  # 32-segment circles — plenty accurate for 300-400m


def categorize(punt_type: str) -> str:
    return "locker" if punt_type in LOCKER_TYPES else "shop"


def safe_intersection_area(geom, union):
    """Robust intersection area: repair geometries once on GEOS failure."""
    try:
        return geom.intersection(union).area
    except Exception:
        g = geom if geom.is_valid else make_valid(geom)
        u = union if union.is_valid else make_valid(union)
        try:
            return g.intersection(u).area
        except Exception:
            return g.buffer(0).intersection(u.buffer(0)).area


def build_union_from_geoms(geoms, distance_m: int):
    if not geoms:
        return None
    buffered = [g.buffer(distance_m, resolution=BUFFER_RESOLUTION)
                for g in geoms if g is not None and not g.is_empty]
    if not buffered:
        return None
    u = unary_union(buffered)
    # unary_union of many near-tangent circles can yield geometries with
    # ring self-touches. make_valid repairs them so later intersections
    # don't throw TopologyException.
    if not u.is_valid:
        u = make_valid(u)
    return u


# ───────────────────────────────────────────────────────────────────────
# Worker shared state. Populated in the parent process BEFORE each Pool
# forks, so children inherit via copy-on-write memory. Workers only READ
# these — never mutate — to preserve COW sharing.
# ───────────────────────────────────────────────────────────────────────
_PC4_DATA: list | None = None
#   tuple per PC4: (pc4_str, muni, pop, area_m2, area_km2, geom)
_NATIONAL_UNIONS: dict | None = None
#   dict[(subset, dist)] -> union geom (or None if empty)
_POINTS_BY_SUBSET: dict | None = None
#   dict[subset] -> list of point geoms (total / shop / locker, national)
_POINTS_BY_MUNI: dict | None = None
#   dict[muni_name] -> list of (point_geom, category)
_MUNI_PC4_INDICES: dict | None = None
#   dict[muni_name] -> list of indices into _PC4_DATA


def _worker_union(key):
    """Build one (subset, distance) national buffer union."""
    subset, dist = key
    geoms = _POINTS_BY_SUBSET[subset]
    return key, build_union_from_geoms(geoms, dist)


def _worker_pc4(idx):
    """Compute national-scope coverage for one PC4 row."""
    pc4, muni, pop, area_m2, area_km2, geom = _PC4_DATA[idx]
    row = {
        "pc4": pc4,
        "municipality": muni,
        "population": pop,
        "area_km2": area_km2,
    }
    for subset in SUBSETS:
        for dist in BUFFER_DISTANCES_M:
            u = _NATIONAL_UNIONS[(subset, dist)]
            if u is None or area_m2 == 0 or not geom.intersects(u):
                frac = 0.0
            else:
                frac = safe_intersection_area(geom, u) / area_m2
                frac = max(0.0, min(1.0, frac))
            row[f"{subset}_{dist}_pct"] = round(frac * 100, 2)
            row[f"{subset}_{dist}_covered"] = pop * frac
    return row


def _worker_muni_strict(muni_name):
    """Strict per-muni coverage: union from muni's own points only."""
    point_list = _POINTS_BY_MUNI.get(muni_name, [])
    pc4_indices = _MUNI_PC4_INDICES.get(muni_name, [])
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
            covered = 0.0
            if u is not None:
                for idx in pc4_indices:
                    _, _, pop, area_m2, _, geom = _PC4_DATA[idx]
                    if area_m2 == 0 or not geom.intersects(u):
                        continue
                    frac = safe_intersection_area(geom, u) / area_m2
                    frac = max(0.0, min(1.0, frac))
                    covered += pop * frac
            result[f"{subset}_{dist}_covered_strict"] = covered
    return result


def metric_block(covered: float, pop: float) -> dict:
    pct = round((covered / pop * 100), 2) if pop > 0 else 0.0
    return {"covered": int(round(covered)), "pct": pct}


def main() -> int:
    global _PC4_DATA, _NATIONAL_UNIONS, _POINTS_BY_SUBSET
    global _POINTS_BY_MUNI, _MUNI_PC4_INDICES

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
    pc4_gdf["area_m2"] = pc4_gdf.area
    pc4_gdf["area_km2"] = (pc4_gdf["area_m2"] / 1e6).round(4)

    print(f"Loading CBS population from {CBS_PC4_PATH.name}...")
    with open(CBS_PC4_PATH) as f:
        cbs = json.load(f)
    pop_lookup = cbs.get("pc4_population", {})
    pc4_gdf["population"] = (
        pc4_gdf["pc4"].map(pop_lookup).fillna(0).astype(int)
    )

    pc4_gdf = pc4_gdf.reset_index(drop=True)

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

    # Attribute PC4s to municipalities via centroid sjoin against the FULL
    # 342-muni polygon cache. The earlier approach of reading
    # pc4_stats.json's `municipality` field truncated to 319 munis because
    # the provincial boundary chunks pc4_stats relies on are missing some
    # cities (Alkmaar, Breda, Deventer, ...). representative_point() handles
    # multi-polygons; sjoin_nearest handles edge cases where the centroid
    # falls in a tiny boundary gap.
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
    print(f"Inputs ready in {time.time() - t0:.1f}s")

    # ─── Shape data into flat lists for workers ─────────────────────────
    _PC4_DATA = [
        (row["pc4"], row["municipality"], int(row["population"]),
         float(row["area_m2"]), float(row["area_km2"]), row.geometry)
        for _, row in pc4_gdf.iterrows()
    ]
    print(f"Prepared {len(_PC4_DATA)} PC4 tuples")

    _POINTS_BY_SUBSET = {
        "total":  [g for g in points_gdf.geometry],
        "shop":   [g for g, c in zip(points_gdf.geometry, points_gdf["category"]) if c == "shop"],
        "locker": [g for g, c in zip(points_gdf.geometry, points_gdf["category"]) if c == "locker"],
    }

    _POINTS_BY_MUNI = defaultdict(list)
    for g, c, m in zip(points_gdf.geometry, points_gdf["category"], points_gdf["municipality"]):
        if m:
            _POINTS_BY_MUNI[m].append((g, c))
    _POINTS_BY_MUNI = dict(_POINTS_BY_MUNI)

    _MUNI_PC4_INDICES = defaultdict(list)
    for i, (_, muni, _, _, _, _) in enumerate(_PC4_DATA):
        if muni:
            _MUNI_PC4_INDICES[muni].append(i)
    _MUNI_PC4_INDICES = dict(_MUNI_PC4_INDICES)

    ctx = mp.get_context("fork")

    # ─── Phase 1: 6 national buffer unions in parallel ───────────────────
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

    _NATIONAL_UNIONS = national_unions  # expose to phase-2 workers via fork

    # ─── Phase 2a: per-PC4 national-scope coverage ──────────────────────
    t2 = time.time()
    print(f"Phase 2a: per-PC4 national coverage ({len(_PC4_DATA)} PC4s)...")
    pc4_rows: list = []
    # Chunk size balances task overhead vs progress granularity
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
            "apportionment": "dasymetric uniform-density within each PC4",
            "scope_national": "buffer union built from ALL NL parcel points (cross-border reach allowed)",
            "scope_strict":   "buffer union built only from parcel points within the same municipality",
            "pc4_to_municipality": "PC4 representative_point sjoin_nearest against municipality_polygon_cache (full 342 munis)",
            "buffer_circle_segments": BUFFER_RESOLUTION * 4,
        },
        "sources": {
            "parcel_points": "webapp/public/data/nederland.geojson",
            "pc4_polygons": "webapp/public/data/pc4.geojson",
            "pc4_population": "CBS 83502NED",
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
    return 0


if __name__ == "__main__":
    # macOS + Python 3.8+ defaults to 'spawn'; we explicitly ask for 'fork' via
    # get_context() per-Pool, so no global set_start_method is needed. The
    # OBJC_DISABLE_INITIALIZE_FORK_SAFETY workaround is only required if a
    # loaded library initialises ObjC state — we don't.
    raise SystemExit(main())
