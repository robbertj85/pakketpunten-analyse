"""Generate placement suggestions for new pakketpunten per municipality.

Combines the existing regression model (predicted vs actual parcel points),
population-coverage gaps (% inhabitants beyond 400 m of any parcel point),
PC4 density (oad), and a buffer-overlap penalty into a single PC4-level
priority score. For the top-N PC4s in each municipality we then derive a
concrete suggested coordinate.

Suggestion derivation (in order):
  1. White-spot = PC4 polygon minus the existing 400 m buffer union.
  2. Mask the white-spot to **inhabited 100 m cells** (CBS Vierkantstatistieken
     100m, ``data/cbs/cbs_vk100_<year>_inhabited.gpkg``). Removes parks, water,
     farmland, golf courses — anywhere CBS recorded < 5 inhabitants.
  3. Pick the populated white-spot polygon with the highest CBS-grid headcount
     and use its representative point as a candidate.
  4. Snap to a nearby preferred POI (supermarkt, winkelcentrum, station, ...)
     when one sits within POI_SNAP_RADIUS_M, else to the nearest BAG pand via
     PDOK WFS, so the coordinate lands on a real, publicly accessible address.
  5. ``est_new_pop_within_400m`` = sum of CBS cells inside both the candidate's
     400 m buffer and the white-spot. Bounded — no uniform-density assumption.

Per PC4 up to MAX_SUGGESTIONS_PER_PC4 (3) spots are derived iteratively:
after spot k a 400 m buffer around it joins the exclusion union, so spot k+1
lands in the next-best uncovered pocket and its est_new_pop is a true
marginal gain (no double counting between spots).

Output → webapp/public/data/placement_suggestions.json

Run order:
    python scripts/fit_pc4_model.py        # writes predicted_points
    python scripts/fetch_cbs_100m_grid.py  # one-off, caches the grid
    python scripts/suggest_placements.py   # this script
"""
from __future__ import annotations

import argparse
import hashlib
import json
import multiprocessing as mp
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

import geopandas as gpd
import numpy as np
import pandas as pd
import requests
from shapely.geometry import shape, Point
from shapely.ops import unary_union
from shapely.geometry.base import BaseGeometry

ROOT = Path(__file__).parent.parent
STATS_PATH = ROOT / "webapp" / "public" / "data" / "pc4_stats.json"
COVERAGE_PATH = ROOT / "webapp" / "public" / "data" / "population_coverage.json"
PC4_PATH = ROOT / "webapp" / "public" / "data" / "pc4.geojson"
MUNICIPALITIES_PATH = ROOT / "webapp" / "public" / "municipalities.json"
DATA_DIR = ROOT / "webapp" / "public" / "data"
OUT_PATH = DATA_DIR / "placement_suggestions.json"
CBS_GRID_PATH = ROOT / "data" / "cbs" / "cbs_vk100_2024_inhabited.gpkg"
GTFS_STOPS_PATH = ROOT / "data" / "ov" / "gtfs_stops.json"
BAG_CACHE_PATH = ROOT / "data" / "bag_building_snap_cache.json"
BAG_WFS_URL = "https://service.pdok.nl/lv/bag/wfs/v2_0"

# If an OV-halte sits within this radius of the densest-cell rep point, we
# shift the snap target itself to the stop and look for buildings there.
# 400 m matches the 400 m walking-distance buffer used elsewhere in the app —
# any stop within walking distance is a valid placement target.
OV_TARGET_SHIFT_M = 400
# Reported nearest OV uses a slightly wider radius so the UI still shows
# "near OV" context for buildings that ended up close-but-not-shifted.
OV_REPORT_RADIUS_M = 400

WGS84 = "EPSG:4326"
RD = "EPSG:28992"

DEFAULT_WEIGHTS = {
    "underservice": 0.40,
    "uncovered_pop": 0.35,
    "density": 0.15,
    "overlap_penalty": -0.10,
}
TOP_N = 10                       # PC4s shipped per municipality (UI offers 5 / 10)
MIN_PC4_POPULATION = 50          # exclude industrial / water PC4s
MIN_WHITE_SPOT_AREA_M2 = 5_000   # discard slivers
SNAP_BBOX_M = 300                # search radius for BAG building snap
MAX_SUGGESTIONS_PER_PC4 = 3      # iterative spots per PC4 (plek 1/2/3 in UI)

# POI snapping: when a preferred public POI sits within this radius of the
# candidate cell, the snap target shifts to the POI itself (the BAG pand it
# occupies is then found at that coordinate). Bus stops are deliberately
# excluded — GTFS OV stops already cover transit and bus stops are too dense
# to be a meaningful "same building" signal.
POI_SNAP_RADIUS_M = 250
POI_DIR = DATA_DIR / "poi" / "by-municipality"
_POI_SNAP_TIER: dict[str, int] = {
    "supermarkt": 0, "winkelcentrum": 0,
    "ns_station": 1, "metro_station": 1, "ov_knooppunt": 1,
    "bibliotheek": 2, "gemeentehuis": 2,
    "tram_halte": 3, "parkeergarage": 3, "fietsenstalling": 3,
}

# CBS grid is loaded once in the parent process and inherited by workers via
# `multiprocessing.fork()`. Workers read these module-level globals rather
# than receiving the (large) GeoDataFrame through pickled args.
_CBS_GRID: Optional[gpd.GeoDataFrame] = None
_CBS_SINDEX = None
# OV stops (WGS84 → reprojected to RD on load) and their spatial index.
_OV_STOPS: Optional[gpd.GeoDataFrame] = None
_OV_SINDEX = None


def zscore(values: np.ndarray) -> np.ndarray:
    """z-score with safe fallback when stddev is 0 (all values equal)."""
    sd = float(np.std(values))
    if sd == 0:
        return np.zeros_like(values, dtype=float)
    return (values - float(np.mean(values))) / sd


def load_inputs() -> tuple[dict, dict, gpd.GeoDataFrame, list[dict]]:
    with open(STATS_PATH) as f:
        stats_payload = json.load(f)
    stats: dict[str, dict] = stats_payload["stats"]

    with open(COVERAGE_PATH) as f:
        coverage_payload = json.load(f)
    coverage_pc4: dict[str, dict] = coverage_payload["pc4"]

    pc4_gdf = gpd.read_file(PC4_PATH)
    pc4_gdf["pc4"] = pc4_gdf["pc4"].astype(str).str.zfill(4)
    pc4_gdf = pc4_gdf.to_crs(RD)

    with open(MUNICIPALITIES_PATH) as f:
        municipalities = json.load(f)
    # Skip "Nederland (totaal)" — placement advice is per-municipality only.
    municipalities = [m for m in municipalities if m.get("slug") != "nederland"]

    return stats, coverage_pc4, pc4_gdf, municipalities


def load_buffer_union_400m(slug: str) -> BaseGeometry | None:
    """Read the 400 m buffer union (in RD) for a municipality, or None if
    the municipality has no parcel points."""
    path = DATA_DIR / f"{slug}.geojson"
    if not path.exists():
        return None
    with open(path) as f:
        g = json.load(f)
    geoms = []
    for feat in g["features"]:
        if feat.get("properties", {}).get("type") == "buffer_union_400m":
            geoms.append(shape(feat["geometry"]))
    if not geoms:
        return None
    union = unary_union(geoms)
    # GeoJSON is WGS84; convert to RD for metric ops.
    return (
        gpd.GeoSeries([union], crs=WGS84).to_crs(RD).iloc[0]
    )


def process_municipality(args: tuple) -> tuple[str, dict | None]:
    """Score every PC4 in this municipality and pick suggestions for the top-N.

    Designed to run in a worker process — accepts plain-data args and returns
    a JSON-friendly dict.
    """
    (
        slug,
        gemeente_name,
        stats,
        coverage_pc4,
        pc4_polys_records,  # list of {"pc4": str, "geom_wkb": bytes}
        weights,
    ) = args

    # Re-hydrate PC4 polygons from WKB.
    from shapely import wkb as _wkb  # imported here so workers see it
    pc4_polys: dict[str, BaseGeometry] = {
        rec["pc4"]: _wkb.loads(rec["geom_wkb"]) for rec in pc4_polys_records
    }

    # PC4s the build_pc4_stats pipeline assigned to this gemeente.
    candidates: list[dict] = []
    for pc4, s in stats.items():
        if s.get("municipality") != gemeente_name:
            continue
        if (s.get("population") or 0) < MIN_PC4_POPULATION:
            continue
        if pc4 not in pc4_polys:
            continue
        cov = coverage_pc4.get(pc4)
        if not cov:
            continue
        actual = (s.get("parcel_points") or {}).get("total", 0)
        predicted_base = s.get("predicted_points")
        if predicted_base is None:
            predicted_base = actual
        predicted_k8 = s.get("predicted_points_k8")  # may be None for sparse PC4s
        pct_400 = (cov.get("total") or {}).get("400m", {}).get("pct", 0.0) or 0.0
        candidates.append({
            "pc4": pc4,
            "population": s["population"],
            "area_km2": s["area_km2"],
            "actual": actual,
            "predicted_base": float(predicted_base),
            "predicted_k8": float(predicted_k8) if predicted_k8 is not None else None,
            "underservice_base": max(0.0, float(predicted_base) - float(actual)),
            "underservice_k8": (
                max(0.0, float(predicted_k8) - float(actual))
                if predicted_k8 is not None else None
            ),
            "uncovered_pop": float(s["population"]) * (1.0 - pct_400 / 100.0),
            "density": float(s.get("oad") or 0.0),
            "coverage_pct_400m": pct_400,
        })

    if len(candidates) < 2:
        return slug, None  # not enough PC4s to z-score meaningfully

    buffer_union = load_buffer_union_400m(slug)  # noqa: E501  — 400 m chosen as the practical walkable threshold for parcel points

    # Compute overlap penalty in RD (m²): area(buffer ∩ pc4) / area(pc4).
    for c in candidates:
        poly = pc4_polys[c["pc4"]]
        pc4_area_m2 = float(poly.area)
        c["pc4_area_m2"] = pc4_area_m2
        if buffer_union is None or pc4_area_m2 == 0:
            c["overlap_penalty"] = 0.0
        else:
            try:
                overlap = poly.intersection(buffer_union).area
            except Exception:
                overlap = 0.0
            c["overlap_penalty"] = float(overlap) / pc4_area_m2

    df = pd.DataFrame(candidates)
    df["z_underservice_base"] = zscore(df["underservice_base"].to_numpy())
    # K8 is missing for sparse PC4s (BAG features absent). Z-score over the
    # subset that has it; PC4s without K8 get z = 0 (neutral).
    k8_mask = df["underservice_k8"].notna()
    df["z_underservice_k8"] = 0.0
    if k8_mask.sum() >= 2:
        df.loc[k8_mask, "z_underservice_k8"] = zscore(
            df.loc[k8_mask, "underservice_k8"].to_numpy()
        )
    df["z_uncovered_pop"] = zscore(df["uncovered_pop"].to_numpy())
    df["z_density"] = zscore(df["density"].to_numpy())
    df["z_overlap_penalty"] = zscore(df["overlap_penalty"].to_numpy())

    # Default-config priority drives the server-side ranking + which top-N
    # PC4s get pre-snapped to BAG. The client recomputes when weights/model
    # change but only re-sorts within this snapped set.
    df["priority"] = (
        weights["underservice"] * df["z_underservice_base"]
        + weights["uncovered_pop"] * df["z_uncovered_pop"]
        + weights["density"] * df["z_density"]
        + weights["overlap_penalty"] * df["z_overlap_penalty"]
    )

    df = df.sort_values("priority", ascending=False).reset_index(drop=True)

    # Suggest concrete points for the top-N PC4s. Up to MAX_SUGGESTIONS_PER_PC4
    # spots are derived iteratively per PC4: after spot k, a 400 m buffer
    # around it joins the exclusion union so spot k+1 targets the next-best
    # uncovered pocket and its est_new_pop is a true marginal gain. The buffer
    # is taken around the pre-snap point; the later BAG/POI snap moves spots
    # by well under 400 m, so the exclusion stays representative.
    top = df.head(TOP_N).copy()
    suggestion_lists: list[list[dict]] = []
    for _, row in top.iterrows():
        poly = pc4_polys[row["pc4"]]
        exclusion = buffer_union
        spots: list[dict] = []
        for rank in range(1, MAX_SUGGESTIONS_PER_PC4 + 1):
            sug = white_spot_suggestion(
                poly, exclusion, pc4_area_m2=row["pc4_area_m2"],
            )
            if sug is None:
                break
            sug["rank"] = rank
            spots.append(sug)
            spot_buffer = Point(sug["_rd_x"], sug["_rd_y"]).buffer(400)
            exclusion = (
                spot_buffer if exclusion is None
                else exclusion.union(spot_buffer)
            )
        suggestion_lists.append(spots)
    top["suggestions"] = suggestion_lists

    pc4_records = []
    for _, row in top.iterrows():
        pc4_records.append({
            "pc4": row["pc4"],
            # Default-weights priority (server-side ranking).
            "priority": round(float(row["priority"]), 3),
            # Raw signals — let the client recompute priority under
            # different weights / model.
            "underservice": round(float(row["underservice_base"]), 2),
            "underservice_base": round(float(row["underservice_base"]), 2),
            "underservice_k8": (
                round(float(row["underservice_k8"]), 2)
                if pd.notna(row["underservice_k8"]) else None
            ),
            # Z-scores normalised within this municipality so client-side
            # `Σ wᵢ · zᵢ` reproduces the server score exactly when weights
            # are unchanged.
            "z_underservice_base": round(float(row["z_underservice_base"]), 4),
            "z_underservice_k8": round(float(row["z_underservice_k8"]), 4),
            "z_uncovered_pop": round(float(row["z_uncovered_pop"]), 4),
            "z_density": round(float(row["z_density"]), 4),
            "z_overlap_penalty": round(float(row["z_overlap_penalty"]), 4),
            "actual": int(row["actual"]),
            # Backwards-compat field; new code should prefer predicted_base.
            "predicted": round(float(row["predicted_base"]), 2),
            "predicted_base": round(float(row["predicted_base"]), 2),
            "predicted_k8": (
                round(float(row["predicted_k8"]), 2)
                if pd.notna(row["predicted_k8"]) else None
            ),
            "uncovered_pop": int(round(float(row["uncovered_pop"]))),
            "density": int(round(float(row["density"]))),
            "overlap_pct": round(float(row["overlap_penalty"]) * 100, 1),
            "coverage_pct_400m": round(float(row["coverage_pct_400m"]), 1),
            "population": int(row["population"]),
            # `suggestion` (plek 1) kept for backward compat — same dict object
            # as suggestions[0], so the BAG/POI snap pass updates both.
            "suggestion": row["suggestions"][0] if row["suggestions"] else None,
            "suggestions": row["suggestions"],
        })

    return slug, {
        "gemeente": gemeente_name,
        "pc4s": pc4_records,
        "pc4_count_evaluated": int(len(df)),
    }


def _white_spot_parts(
    pc4_poly_rd: BaseGeometry, buffer_union_rd: BaseGeometry | None,
) -> list[BaseGeometry]:
    """Return individual polygon parts of (PC4 − buffer_union), filtered to
    those above MIN_WHITE_SPOT_AREA_M2."""
    if buffer_union_rd is None:
        white = pc4_poly_rd
    else:
        try:
            white = pc4_poly_rd.difference(buffer_union_rd)
        except Exception:
            return []
    if white.is_empty:
        return []
    if white.geom_type == "Polygon":
        parts = [white]
    elif white.geom_type == "MultiPolygon":
        parts = list(white.geoms)
    else:
        return []
    return [p for p in parts if p.area >= MIN_WHITE_SPOT_AREA_M2]


def _grid_cells_in(geom_rd: BaseGeometry) -> gpd.GeoDataFrame:
    """Return CBS 100m cells whose centroid lies inside ``geom_rd`` (in RD)."""
    if _CBS_GRID is None or _CBS_SINDEX is None:
        return gpd.GeoDataFrame(columns=["aantal_inwoners", "geometry"], crs=RD)
    candidate_idx = list(_CBS_SINDEX.intersection(geom_rd.bounds))
    if not candidate_idx:
        return _CBS_GRID.iloc[0:0]
    candidates = _CBS_GRID.iloc[candidate_idx]
    # Use cell centroid for the inside test — fast and stable on cell edges.
    centroids = candidates.geometry.centroid
    mask = centroids.within(geom_rd)
    return candidates[mask]


def white_spot_suggestion(
    pc4_poly_rd: BaseGeometry,
    buffer_union_rd: BaseGeometry | None,
    pc4_area_m2: float,
) -> dict | None:
    """Find the largest *populated* white-spot inside the PC4 and return a
    representative point plus the estimated CBS-grid population the new
    parcel point would newly cover within 400 m.

    Requires the CBS 100m inhabited-cell grid — main() hard-fails at startup
    when the grid file is missing, so ``_CBS_GRID`` is always loaded here.
    """
    if pc4_area_m2 == 0:
        return None
    parts = _white_spot_parts(pc4_poly_rd, buffer_union_rd)
    if not parts:
        return None

    # Score every white-spot part by total inhabitants in covered CBS cells.
    best_part: BaseGeometry | None = None
    best_pop = -1.0
    best_part_grid: gpd.GeoDataFrame | None = None
    for p in parts:
        cells = _grid_cells_in(p)
        pop = float(cells["aantal_inwoners"].sum()) if len(cells) else 0.0
        if pop > best_pop:
            best_pop = pop
            best_part = p
            best_part_grid = cells
    if best_part is None or best_pop <= 0:
        # No populated white-spot — drop suggestion (parks, water, etc.).
        return None

    rep = best_part.representative_point()

    # Pick the CBS cell with the highest count inside this part as the
    # candidate point — better than `representative_point()` because it
    # gravitates toward where people actually live within the polygon.
    if best_part_grid is not None and len(best_part_grid):
        densest = best_part_grid.loc[best_part_grid["aantal_inwoners"].idxmax()]
        cand = densest.geometry.centroid
        # Only accept the densest-cell centroid if it sits inside the white-
        # spot polygon (it should by construction, but cell centroids on the
        # polygon boundary can get rejected by `.within()` due to FP noise).
        if cand.within(best_part):
            rep = cand

    # Convert RD → WGS84 for storage.
    lonlat = gpd.GeoSeries([rep], crs=RD).to_crs(WGS84).iloc[0]
    lon, lat = float(lonlat.x), float(lonlat.y)

    # est_new_pop = inhabitants in cells covered by both the 400 m buffer and
    # the white-spot. Grid-based, no uniform-density assumption.
    buffer400 = rep.buffer(400)
    covered_cells = _grid_cells_in(buffer400.intersection(best_part))
    est_new_pop = int(round(float(covered_cells["aantal_inwoners"].sum())))

    return {
        "lat": round(lat, 6),
        "lon": round(lon, 6),
        "white_spot_area_m2": int(round(float(best_part.area))),
        "est_new_pop_within_400m": est_new_pop,
        # RD coords retained for the post-hoc BAG snap in main(); stripped
        # before JSON serialisation.
        "_rd_x": float(rep.x),
        "_rd_y": float(rep.y),
    }


# ---------- BAG building-snap (PDOK WFS) ---------------------------------- #
#
# PDOK BAG is the official Dutch building registry — strictly better than
# OSM for placement advice in NL: every footprint is authoritative, attributed
# (gebruiksdoel: woonfunctie / winkelfunctie / kantoorfunctie / …), and dated.
# We query layer ``bag:pand`` in RD (EPSG:28992), pick the nearest centroid
# to the suggestion, and prefer panden whose ``gebruiksdoel`` includes a
# user-facing function (woonfunctie / winkelfunctie / bijeenkomstfunctie /
# kantoorfunctie) over purely industrial buildings.

# Tiered preference for BAG `gebruiksdoel`. Lower tier = better match for a
# parcel point (the kind of building/POI a courier would actually use).
#
# In real life pakketpunten cluster at supermarkets, kiosks and cafés (high
# foot traffic, predictable opening hours). Pakketautomaten go on station
# forecourts and shop entrances. Residential buildings are a fallback when
# the area genuinely has no commercial frontage.
#
# BAG `gebruiksdoel` is a comma-separated list per pand, so we score every
# function present and pick the best (lowest) tier.
_USE_TIER: dict[str, int] = {
    "winkelfunctie":          0,  # supermarkets, shops, kiosks — the obvious win
    "bijeenkomstfunctie":     0,  # cafés, restaurants, community centres, churches
    "kantoorfunctie":         1,  # offices — secondary public access
    "gezondheidszorgfunctie": 1,  # clinics, GP practices
    "onderwijsfunctie":       1,  # schools, universities
    "woonfunctie":            2,  # residential — fallback in suburbs
    "logiesfunctie":          3,  # hotels, hostels — niche
    "sportfunctie":           3,  # gyms, sports halls — niche
    "industriefunctie":       4,  # warehouses, factories — last resort
    "celfunctie":             5,  # prisons — never
    "overige gebruiksfunctie":4,  # garages, sheds, agricultural
}
_DEFAULT_TIER = 4


def _load_poi_snap_index(slug: str) -> dict | None:
    """Load the per-municipality POI bundle and return a snap index (numpy
    arrays in RD + per-POI props) limited to the categories in
    ``_POI_SNAP_TIER``. Returns None when the bundle is missing or empty."""
    path = POI_DIR / f"{slug}.geojson"
    if not path.exists():
        return None
    try:
        with open(path) as f:
            payload = json.load(f)
    except Exception:
        return None
    lons, lats, props = [], [], []
    for feat in payload.get("features", []):
        p = feat.get("properties", {})
        cat = p.get("category")
        if cat not in _POI_SNAP_TIER:
            continue
        coords = (feat.get("geometry") or {}).get("coordinates")
        if not coords:
            continue
        lons.append(float(coords[0]))
        lats.append(float(coords[1]))
        props.append({
            "category": cat,
            "name": str(p.get("name") or ""),
            "osm_id": str(p.get("osm_id") or ""),
            "tier": _POI_SNAP_TIER[cat],
        })
    if not props:
        return None
    pts = gpd.GeoSeries(gpd.points_from_xy(lons, lats), crs=WGS84).to_crs(RD)
    return {
        "x": pts.x.to_numpy(),
        "y": pts.y.to_numpy(),
        "tier": np.array([p["tier"] for p in props], dtype=int),
        "props": props,
    }


def _nearest_snap_poi(
    rd_x: float, rd_y: float, poi_index: dict | None, max_dist_m: float,
) -> dict | None:
    """Best preferred POI within ``max_dist_m`` of (rd_x, rd_y), ranked by
    (tier, distance) so a supermarket beats a closer tram stop."""
    if poi_index is None:
        return None
    dx = poi_index["x"] - rd_x
    dy = poi_index["y"] - rd_y
    d2 = dx * dx + dy * dy
    in_range = np.nonzero(d2 <= max_dist_m * max_dist_m)[0]
    if in_range.size == 0:
        return None
    order = sorted(in_range, key=lambda i: (int(poi_index["tier"][i]), float(d2[i])))
    best = order[0]
    p = poi_index["props"][best]
    return {
        "category": p["category"],
        "name": p["name"],
        "osm_id": p["osm_id"],
        "rd_x": float(poi_index["x"][best]),
        "rd_y": float(poi_index["y"][best]),
        "distance_m": int(round(float(np.sqrt(d2[best])))),
    }


def _load_bag_cache() -> dict[str, dict]:
    if BAG_CACHE_PATH.exists():
        try:
            with open(BAG_CACHE_PATH) as f:
                return json.load(f)
        except Exception:
            return {}
    return {}


def _save_bag_cache(cache: dict[str, dict]) -> None:
    BAG_CACHE_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(BAG_CACHE_PATH, "w") as f:
        json.dump(cache, f, separators=(",", ":"))


def _cache_key(rd_x: float, rd_y: float) -> str:
    # 1 m precision — RD coords are already in metres.
    return f"{rd_x:.0f},{rd_y:.0f}"


def _use_score(gebruiksdoel: str | None) -> int:
    """Lower = more preferred. Returns the *best* tier among the (possibly
    multiple) functions listed in BAG ``gebruiksdoel`` so a mixed-use building
    tagged ``kantoorfunctie,winkelfunctie,woonfunctie`` scores as a shop, not
    a flat."""
    if not gebruiksdoel:
        return _DEFAULT_TIER
    g = gebruiksdoel.lower()
    return min(
        (tier for fn, tier in _USE_TIER.items() if fn in g),
        default=_DEFAULT_TIER,
    )


def _nearest_ov_stop(rd_x: float, rd_y: float, max_dist_m: float) -> dict | None:
    """Return the closest OV-halte (in RD) within ``max_dist_m`` metres of
    (rd_x, rd_y), or None if the index isn't loaded / nothing is in range.
    """
    if _OV_STOPS is None or _OV_SINDEX is None:
        return None
    bbox = (rd_x - max_dist_m, rd_y - max_dist_m,
            rd_x + max_dist_m, rd_y + max_dist_m)
    candidates = list(_OV_SINDEX.intersection(bbox))
    if not candidates:
        return None
    sub = _OV_STOPS.iloc[candidates]
    dx = sub.geometry.x - rd_x
    dy = sub.geometry.y - rd_y
    d2 = dx * dx + dy * dy
    idx = d2.idxmin()
    dist = float(np.sqrt(d2.loc[idx]))
    if dist > max_dist_m:
        return None
    row = _OV_STOPS.loc[idx]
    return {
        "name": str(row.get("name") or ""),
        "code": str(row.get("code") or ""),
        "platform": str(row.get("platform") or ""),
        "lat": float(row.get("lat", 0.0)),
        "lon": float(row.get("lon", 0.0)),
        "distance_m": int(round(dist)),
    }


def snap_to_nearest_bag_pand(
    rd_x: float, rd_y: float, cache: dict[str, dict],
    *, session: requests.Session, timeout: int = 30,
    poi_index: dict | None = None,
) -> dict | None:
    """Query PDOK BAG WFS for ``bag:pand`` footprints within ``SNAP_BBOX_M``
    metres of (rd_x, rd_y) in EPSG:28992 and return the best one.

    Snap-target resolution, in order:
      1. Preferred POI (supermarkt, winkelcentrum, station, ...) within
         ``POI_SNAP_RADIUS_M`` — the bbox centres on the POI so we find the
         pand the POI occupies; the POI is reported in the result.
      2. OV-halte within ``OV_TARGET_SHIFT_M`` (existing behaviour).
      3. The original candidate point.

    Ranking of panden: tier (lower = better) then distance, where tier comes
    from ``_use_score(gebruiksdoel)``.

    Returns ``{"rd_x", "rd_y", "lat", "lon", "distance_m", "bouwjaar",
    "gebruiksdoel", "identificatie", "nearest_ov": {...} | None,
    "poi": {...} | None}`` or None on failure / no footprints. Cached on disk
    so reruns don't re-hit PDOK.
    """
    # A POI shift changes the snap target, so it gets its own cache slot —
    # plain keys written by earlier runs (without POI logic) stay valid for
    # the no-POI case.
    rep_poi = _nearest_snap_poi(rd_x, rd_y, poi_index, POI_SNAP_RADIUS_M)
    key = _cache_key(rd_x, rd_y)
    if rep_poi is not None and rep_poi["osm_id"]:
        key = f"{key}|{rep_poi['osm_id']}"
    if key in cache:
        return cache[key] or None

    # Resolve the snap target FIRST: shift to a nearby preferred POI, else a
    # nearby OV-halte, so the PDOK bbox follows the target — not just the
    # sort order. Without this, buildings near the POI/stop would be outside
    # the search bbox and never seen.
    if rep_poi is not None:
        target_x, target_y = rep_poi["rd_x"], rep_poi["rd_y"]
    else:
        rep_ov = _nearest_ov_stop(rd_x, rd_y, OV_TARGET_SHIFT_M)
        if rep_ov is not None:
            ov_pt = gpd.GeoSeries(
                [Point(rep_ov["lon"], rep_ov["lat"])], crs=WGS84,
            ).to_crs(RD).iloc[0]
            target_x, target_y = float(ov_pt.x), float(ov_pt.y)
        else:
            target_x, target_y = rd_x, rd_y

    bbox = (
        target_x - SNAP_BBOX_M, target_y - SNAP_BBOX_M,
        target_x + SNAP_BBOX_M, target_y + SNAP_BBOX_M,
    )
    params = {
        "service": "WFS",
        "version": "2.0.0",
        "request": "GetFeature",
        "typeNames": "bag:pand",
        "outputFormat": "application/json",
        "srsName": "EPSG:28992",
        "bbox": f"{bbox[0]},{bbox[1]},{bbox[2]},{bbox[3]},EPSG:28992",
        "count": 200,
    }
    try:
        r = session.get(BAG_WFS_URL, params=params, timeout=timeout)
        r.raise_for_status()
        payload = r.json()
    except Exception as e:
        print(f"    BAG snap failed at RD ({rd_x:.0f},{rd_y:.0f}): {e}")
        return None

    candidates = []
    for feat in payload.get("features", []):
        geom = feat.get("geometry")
        if not geom:
            continue
        try:
            poly = shape(geom)
        except Exception:
            continue
        c = poly.centroid
        # Distance to the (possibly shifted) snap target.
        d2 = (c.x - target_x) ** 2 + (c.y - target_y) ** 2
        props = feat.get("properties", {})
        tier = _use_score(props.get("gebruiksdoel"))
        candidates.append((tier, d2, c.x, c.y, props))

    if not candidates:
        cache[key] = {}  # remember "no buildings" so we skip on retry
        return None

    # Sort by (use-tier, distance-to-target). Tier dominates so a shop always
    # beats a warehouse. The target shift above already biases distance
    # toward POIs/OV-haltes when one is nearby.
    candidates.sort(key=lambda t: (t[0], t[1]))
    tier, d2, cx, cy, props = candidates[0]
    # Reported nearest OV uses a wider radius so the UI can show it as a
    # context hint even when it didn't drive the snap.
    ov_near = _nearest_ov_stop(cx, cy, OV_REPORT_RADIUS_M)

    # Convert RD → WGS84 for the JSON output.
    lonlat = gpd.GeoSeries([Point(cx, cy)], crs=RD).to_crs(WGS84).iloc[0]
    result = {
        "rd_x": round(float(cx), 1),
        "rd_y": round(float(cy), 1),
        "lat": round(float(lonlat.y), 6),
        "lon": round(float(lonlat.x), 6),
        "distance_m": int(round(float(np.sqrt(d2)))),
        "bouwjaar": props.get("bouwjaar"),
        "gebruiksdoel": props.get("gebruiksdoel"),
        "identificatie": props.get("identificatie"),
        "nearest_ov": ov_near,
        # POI that drove the snap target (distance from the pre-snap
        # candidate point), or None when the snap was BAG/OV-only.
        "poi": (
            {
                "category": rep_poi["category"],
                "name": rep_poi["name"],
                "distance_m": rep_poi["distance_m"],
            }
            if rep_poi is not None else None
        ),
    }
    cache[key] = result
    return result


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--jobs", type=int, default=max(1, mp.cpu_count() - 1))
    parser.add_argument("--w-underservice", type=float, default=DEFAULT_WEIGHTS["underservice"])
    parser.add_argument("--w-uncovered-pop", type=float, default=DEFAULT_WEIGHTS["uncovered_pop"])
    parser.add_argument("--w-density", type=float, default=DEFAULT_WEIGHTS["density"])
    parser.add_argument("--w-overlap-penalty", type=float, default=DEFAULT_WEIGHTS["overlap_penalty"])
    parser.add_argument("--only", type=str, default=None,
                        help="Comma-separated list of municipality slugs to process (default: all)")
    parser.add_argument("--cbs-grid", type=Path, default=CBS_GRID_PATH,
                        help="CBS 100m inhabited-grid GPKG. If missing, falls back "
                             "to uniform-density estimates and skips the white-spot mask.")
    parser.add_argument("--gtfs-stops", type=Path, default=GTFS_STOPS_PATH,
                        help="GTFS OV-halte coordinates (JSON from fetch_gtfs_ov_stops.py). "
                             "If missing, the snap step skips the OV-proximity boost.")
    parser.add_argument("--no-bag-snap", action="store_true",
                        help="Skip the PDOK BAG building-snap step (offline / faster).")
    args = parser.parse_args()

    weights = {
        "underservice": args.w_underservice,
        "uncovered_pop": args.w_uncovered_pop,
        "density": args.w_density,
        "overlap_penalty": args.w_overlap_penalty,
    }

    print("Loading inputs...")
    stats, coverage_pc4, pc4_gdf, municipalities = load_inputs()
    print(f"  PC4 polygons: {len(pc4_gdf)} | Municipalities: {len(municipalities)}")

    # Surface model R² values from pc4_stats so the UI can label "base
    # (R²=0.44) vs k=8 (R²=0.58)" in the model toggle.
    with open(STATS_PATH) as f:
        _stats_payload = json.load(f)
    model_meta = {
        "base": (_stats_payload.get("model") or {}),
        "k8": (_stats_payload.get("model_k8") or {}),
    }

    # CBS 100m inhabited-cell grid. Loaded into a module-level global so all
    # forked workers inherit it via copy-on-write rather than re-reading the
    # 85 MB GPKG once per process.
    global _CBS_GRID, _CBS_SINDEX, _OV_STOPS, _OV_SINDEX
    if args.cbs_grid.exists():
        print(f"  Loading CBS 100m grid: {args.cbs_grid.relative_to(ROOT)}")
        _CBS_GRID = gpd.read_file(args.cbs_grid)
        if _CBS_GRID.crs != RD:
            _CBS_GRID = _CBS_GRID.to_crs(RD)
        _CBS_SINDEX = _CBS_GRID.sindex
        print(f"    {len(_CBS_GRID):,} inhabited cells loaded")
    else:
        # Hard requirement: without the inhabited-cell grid every suggestion
        # would silently get est_new_pop_within_400m = 0 and land on
        # unpopulated white-spots (parks, water). Refuse to run instead.
        print(f"ERROR: CBS grid {args.cbs_grid.relative_to(ROOT)} not found. "
              f"Run `python scripts/fetch_cbs_100m_grid.py` first.",
              file=sys.stderr)
        return 1

    # OV-haltes (GTFS). Stored as a small RD-projected GeoDataFrame so the
    # snap step can hand a tier-bonus to BAG panden near transit.
    if args.gtfs_stops.exists():
        print(f"  Loading OV-haltes: {args.gtfs_stops.relative_to(ROOT)}")
        with open(args.gtfs_stops) as f:
            ov_payload = json.load(f)
        ov_records = ov_payload.get("stops", [])
        ov_df = pd.DataFrame(ov_records)
        # Filter to roughly NL bbox so neighbour-country GTFS stops don't
        # bloat the index. RD only covers NL anyway, so out-of-area stops
        # are useless for our snap.
        ov_df = ov_df[
            ov_df["lat"].between(50.5, 53.7)
            & ov_df["lon"].between(3.2, 7.3)
        ].copy()
        _OV_STOPS = gpd.GeoDataFrame(
            ov_df,
            geometry=gpd.points_from_xy(ov_df["lon"], ov_df["lat"]),
            crs=WGS84,
        ).to_crs(RD)
        _OV_SINDEX = _OV_STOPS.sindex
        print(f"    {len(_OV_STOPS):,} OV-haltes within NL bbox")
    else:
        print(f"  ⚠️  GTFS stops {args.gtfs_stops.relative_to(ROOT)} not found — "
              f"running without OV-proximity boost (run "
              f"`python scripts/fetch_gtfs_ov_stops.py` to enable).")

    if args.only:
        only = {s.strip() for s in args.only.split(",")}
        municipalities = [m for m in municipalities if m["slug"] in only]
        print(f"  Filtered to {len(municipalities)} municipalities: {sorted(only)}")

    has_predicted = any(v.get("predicted_points") is not None for v in stats.values())
    if not has_predicted:
        print("  ⚠️  pc4_stats.json has no `predicted_points` field — run "
              "`python scripts/fit_pc4_model.py` first to enable the "
              "underservice signal. Continuing with underservice = 0 for now.")

    # Pre-build per-PC4 polygons in RD so workers don't reload pc4.geojson.
    # Pass as WKB to keep pickling small.
    pc4_polys: dict[str, bytes] = {
        pc4: geom.wkb
        for pc4, geom in zip(pc4_gdf["pc4"], pc4_gdf.geometry)
        if geom is not None and not geom.is_empty
    }
    # Group PC4 polygons by municipality (the stats file holds the mapping).
    polys_by_muni: dict[str, list[dict]] = {}
    for pc4, s in stats.items():
        muni = s.get("municipality")
        if muni and pc4 in pc4_polys:
            polys_by_muni.setdefault(muni, []).append(
                {"pc4": pc4, "geom_wkb": pc4_polys[pc4]}
            )

    tasks = []
    for muni in municipalities:
        gem = muni["name"]
        slug = muni["slug"]
        if gem not in polys_by_muni:
            continue
        tasks.append((slug, gem, stats, coverage_pc4, polys_by_muni[gem], weights))

    print(f"\nScoring {len(tasks)} municipalities with {args.jobs} workers...")
    results: dict[str, dict] = {}
    if args.jobs > 1 and len(tasks) > 1:
        ctx = mp.get_context("fork")
        with ctx.Pool(args.jobs) as pool:
            for slug, payload in pool.imap_unordered(process_municipality, tasks):
                if payload is not None:
                    results[slug] = payload
    else:
        for t in tasks:
            slug, payload = process_municipality(t)
            if payload is not None:
                results[slug] = payload

    # ---- BAG snap pass ---- #
    # Done sequentially (rather than in workers) so we can share a single
    # session + cache. ~5 PDOK calls per municipality × ~300 munis = ~1500
    # calls total, ~10 min on a warm cache, ~30 min cold. Cache hits are free.
    bag_snaps_done = bag_snaps_changed = bag_unsnapped = 0
    if not args.no_bag_snap:
        print(f"\nSnapping suggestions to nearest BAG building "
              f"(PDOK WFS, cache: {BAG_CACHE_PATH.relative_to(ROOT)})...")
        cache = _load_bag_cache()
        cache_size_at_start = len(cache)
        session = requests.Session()
        session.headers["User-Agent"] = "pakketpunten-analyse/1.0 (placement-suggestions)"
        try:
            for slug, payload in results.items():
                # POI snap index per municipality — small files, loaded once
                # per slug for all its suggestions.
                poi_index = _load_poi_snap_index(slug)
                for r in payload["pc4s"]:
                    for sug in r.get("suggestions") or []:
                        rd_x = sug.pop("_rd_x", None)
                        rd_y = sug.pop("_rd_y", None)
                        if rd_x is None or rd_y is None:
                            continue
                        snap = snap_to_nearest_bag_pand(
                            rd_x, rd_y, cache,
                            session=session, poi_index=poi_index,
                        )
                        bag_snaps_done += 1
                        if snap:
                            sug["snapped_to_bag"] = True
                            sug["pre_snap_lat"] = sug["lat"]
                            sug["pre_snap_lon"] = sug["lon"]
                            sug["lat"] = snap["lat"]
                            sug["lon"] = snap["lon"]
                            sug["bag_distance_m"] = snap["distance_m"]
                            sug["bag_gebruiksdoel"] = snap.get("gebruiksdoel")
                            sug["bag_bouwjaar"] = snap.get("bouwjaar")
                            sug["bag_identificatie"] = snap.get("identificatie")
                            sug["nearest_ov"] = snap.get("nearest_ov")
                            poi = snap.get("poi")
                            if poi:
                                sug["poi_category"] = poi.get("category")
                                sug["poi_naam"] = poi.get("name")
                                sug["poi_distance_m"] = poi.get("distance_m")
                            bag_snaps_changed += 1
                        else:
                            sug["snapped_to_bag"] = False
                            bag_unsnapped += 1
                        # Light politeness throttle when calls are uncached.
                        if len(cache) != cache_size_at_start:
                            time.sleep(0.05)
        finally:
            _save_bag_cache(cache)
        print(f"  {bag_snaps_done} suggestions processed: "
              f"{bag_snaps_changed} snapped, {bag_unsnapped} kept original; "
              f"cache size {cache_size_at_start} → {len(cache)}")
    else:
        # Strip RD coords even when we're skipping the snap — they're internal.
        for payload in results.values():
            for r in payload["pc4s"]:
                for sug in r.get("suggestions") or []:
                    sug.pop("_rd_x", None)
                    sug.pop("_rd_y", None)

    out = {
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "weights": weights,
        "top_n_per_municipality": TOP_N,
        "suggestions_per_pc4": MAX_SUGGESTIONS_PER_PC4,
        "poi_snap_radius_m": POI_SNAP_RADIUS_M,
        "min_pc4_population": MIN_PC4_POPULATION,
        "min_white_spot_area_m2": MIN_WHITE_SPOT_AREA_M2,
        "cbs_grid_used": _CBS_GRID is not None,
        "bag_snap_used": not args.no_bag_snap,
        "models": {
            "base": {
                "label": "Basismodel (populatie + oppervlakte)",
                "features": (model_meta["base"].get("features") or []),
                "r2": model_meta["base"].get("r2"),
            },
            "k8": {
                "label": "K=8 best-subset (R² hoger)",
                "features": (model_meta["k8"].get("features") or []),
                "r2": model_meta["k8"].get("r2"),
            },
        },
        "by_municipality": dict(sorted(results.items())),
    }
    OUT_PATH.write_text(json.dumps(out, separators=(",", ":"), allow_nan=False))
    size_kb = OUT_PATH.stat().st_size / 1024
    print(f"\n✅ Wrote {OUT_PATH.relative_to(ROOT)} "
          f"({len(results)} municipalities, {size_kb:.0f} KB)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
