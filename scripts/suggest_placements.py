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
     when one sits within POI_SNAP_RADIUS_M, else to a BAG pand via PDOK WFS,
     so the coordinate lands on a real, publicly accessible building. Panden
     are ranked by ``distance + use_tier * SNAP_TIER_PENALTY_M - frontage
     - bonus`` within SNAP_MAX_M of the pre-snap point. ``frontage`` rewards
     commercial surroundings (winkel/bijeenkomst panden within
     FRONTAGE_RADIUS_M: a shopping street scores 4-5, a corner shop between
     houses 0-1) and a house-only pand with no commercial neighbour gets an
     extra penalty, so spots land on shopping streets rather than between
     houses; ``bonus`` rewards the pand at a preferred POI / OV-halte.
  5. ``est_new_pop_within_400m`` = sum of CBS cells inside both the *snapped*
     building's 400 m buffer and the white-spot. Bounded — no uniform-density
     assumption. The pre-snap value is kept as ``est_new_pop_pre_snap``.
  6. Nearest address (PDOK Locatieserver reverse geocode) is attached as
     ``adres`` so the UI can name the spot; cached in
     ``data/address_reverse_cache.json``.

Per PC4 up to MAX_SUGGESTIONS_PER_PC4 (5) spots are derived iteratively:
after spot k a 400 m buffer around it joins the exclusion union, so spot k+1
lands in the next-best uncovered pocket and its est_new_pop is a true
marginal gain (no double counting between spots, ``marginal: true``). Once
no populated pocket is left, the remaining slots are filled with
*alternatives*: the exclusion around earlier spots shrinks to
MIN_SPOT_SEPARATION_M so the next-densest place in the same pocket becomes a
spot (``marginal: false``, its reach overlaps with earlier spots — it is an
alternative site, not an extra gain). Spots within one PC4 never
share a BAG pand and stay >= MIN_SPOT_SEPARATION_M apart; when no distinct
building qualifies the spot keeps its pre-snap coordinate (snapped_to_bag =
false).

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
import statistics
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

import geopandas as gpd
import numpy as np
import pandas as pd
import requests
from pyproj import Transformer
from shapely import wkb as shapely_wkb
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
# v2: caches the ranked candidate list per snap target (v1 only stored the
# winner, which cannot be de-duplicated across spots). v1 file is left as is.
BAG_CACHE_PATH = ROOT / "data" / "bag_building_snap_cache_v2.json"
BAG_WFS_URL = "https://service.pdok.nl/lv/bag/wfs/v2_0"
ADDRESS_CACHE_PATH = ROOT / "data" / "address_reverse_cache.json"
LOCSERVER_REVERSE_URL = "https://api.pdok.nl/bzk/locatieserver/search/v3_1/reverse"

# If an OV-halte sits within this radius of the densest-cell rep point, we
# shift the snap target itself to the stop and look for buildings there.
# 400 m matches the 400 m walking-distance buffer used elsewhere in the app —
# any stop within walking distance is a valid placement target.
OV_TARGET_SHIFT_M = 250
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
SNAP_MAX_M = 250                 # panden farther than this from the pre-snap point are ignored
FRONTAGE_RADIUS_M = 60           # commercial frontage = winkel/bijeenkomst panden within this
FRONTAGE_BONUS_M = 40            # score bonus per commercial neighbour (capped at FRONTAGE_MAX)
FRONTAGE_MAX = 5
BETWEEN_HOUSES_PENALTY_M = 100   # extra penalty for a non-shop pand with no commercial neighbour
SNAP_BBOX_M = SNAP_MAX_M + FRONTAGE_RADIUS_M  # WFS bbox half-size (candidates + their neighbours)
WFS_PAGE = 1000                  # PDOK BAG WFS page size (paginated with startIndex)
SNAP_TIER_PENALTY_M = 75         # snap score = distance_m + use_tier * this - frontage - target bonus
SNAP_POI_BONUS_M = 100           # bonus for the pand at a preferred POI (supermarkt, station, ...)
SNAP_OV_BONUS_M = 50             # bonus for the pand at an OV-halte
SNAP_TARGET_HIT_M = 40           # a pand 'is at' the POI/OV when its centroid is within this
SNAP_CANDIDATES_KEPT = 10        # ranked candidates cached per snap target
MIN_SPOT_SEPARATION_M = 100      # snapped spots within one PC4 stay at least this far apart
MAX_SUGGESTIONS_PER_PC4 = 5      # iterative spots per PC4 (plek 1..5 in UI)

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
# RD -> WGS84 for single points (much cheaper than a GeoSeries round-trip).
_RD_TO_WGS84 = Transformer.from_crs(RD, WGS84, always_xy=True)


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
    # is taken around the pre-snap point; the later BAG/POI snap is capped at
    # SNAP_MAX_M and de-duplicated per PC4 in run_snap_pass(), and the reach
    # is recomputed at the snapped building.
    top = df.head(TOP_N).copy()
    suggestion_lists: list[list[dict]] = []
    for _, row in top.iterrows():
        poly = pc4_polys[row["pc4"]]
        exclusion = buffer_union
        spots: list[dict] = []
        chosen: list[Point] = []
        marginal = True
        for rank in range(1, MAX_SUGGESTIONS_PER_PC4 + 1):
            sug = white_spot_suggestion(
                poly, exclusion, pc4_area_m2=row["pc4_area_m2"],
            )
            if sug is None and marginal and chosen:
                # No uncovered pocket left: switch to fill mode. Earlier spots
                # now only exclude a MIN_SPOT_SEPARATION_M disk, so the next-
                # densest place in the same pocket becomes an alternative.
                marginal = False
                exclusion = unary_union(
                    ([buffer_union] if buffer_union is not None else [])
                    + [p.buffer(MIN_SPOT_SEPARATION_M) for p in chosen]
                )
                sug = white_spot_suggestion(
                    poly, exclusion, pc4_area_m2=row["pc4_area_m2"],
                )
            if sug is None:
                break
            sug["rank"] = rank
            sug["marginal"] = marginal
            spots.append(sug)
            pt = Point(sug["_rd_x"], sug["_rd_y"])
            chosen.append(pt)
            spot_buffer = pt.buffer(400 if marginal else MIN_SPOT_SEPARATION_M)
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
        "est_new_pop_pre_snap": est_new_pop,
        # RD coords retained for the post-hoc BAG snap in main(); stripped
        # before JSON serialisation.
        "_rd_x": float(rep.x),
        "_rd_y": float(rep.y),
        # Simplified white-spot polygon (WKB) so main() can recompute the
        # reach estimate at the *snapped* building. Stripped before output.
        "_white_spot_wkb": shapely_wkb.dumps(best_part.simplify(2)),
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


def _wfs_pand_features(
    bbox: tuple[float, float, float, float], *, session: requests.Session,
    timeout: int = 30, max_pages: int = 5,
) -> list[dict]:
    """All ``bag:pand`` features in the RD bbox, following WFS 2.0 paging
    (``startIndex``). A 500 m box in a city centre holds ~1.5-2k panden, far
    beyond a single ``count`` — the earlier 200-cap silently dropped most
    candidates in dense areas."""
    feats: list[dict] = []
    start = 0
    for _ in range(max_pages):
        params = {
            "service": "WFS",
            "version": "2.0.0",
            "request": "GetFeature",
            "typeNames": "bag:pand",
            "outputFormat": "application/json",
            "srsName": "EPSG:28992",
            "bbox": f"{bbox[0]},{bbox[1]},{bbox[2]},{bbox[3]},EPSG:28992",
            "count": WFS_PAGE,
            "startIndex": start,
            # Only what the snap needs (~30% smaller pages than the full record).
            "propertyName": "identificatie,gebruiksdoel,bouwjaar,geom",
        }
        r = session.get(BAG_WFS_URL, params=params, timeout=timeout)
        r.raise_for_status()
        page = r.json().get("features", [])
        feats.extend(page)
        if len(page) < WFS_PAGE:
            break
        start += WFS_PAGE
    return feats


def _is_commercial(gebruiksdoel: str | None) -> bool:
    g = (gebruiksdoel or "").lower()
    return "winkelfunctie" in g or "bijeenkomstfunctie" in g


def fetch_bag_candidates(
    rd_x: float, rd_y: float, cache: dict[str, dict],
    *, session: requests.Session, timeout: int = 30,
    poi_index: dict | None = None,
) -> dict | None:
    """Query PDOK BAG WFS for ``bag:pand`` footprints around the snap target
    of (rd_x, rd_y) and return a *ranked candidate list* (not just a winner),
    so the caller can de-duplicate buildings across the spots of one PC4.

    Snap-target resolution, in order:
      1. Preferred POI (supermarkt, winkelcentrum, station, ...) within
         ``POI_SNAP_RADIUS_M`` — the bbox centres on the POI so we find the
         pand the POI occupies; the POI is reported in the result.
      2. OV-halte within ``OV_TARGET_SHIFT_M``.
      3. The original candidate point.

    Ranking: ``score = distance_m + use_tier * SNAP_TIER_PENALTY_M - bonus``
    over the panden within ``SNAP_MAX_M`` of the *pre-snap point* (the CBS
    population centre), where ``bonus`` rewards the pand sitting at the
    POI (SNAP_POI_BONUS_M) or OV-halte (SNAP_OV_BONUS_M). Tier still matters
    (a shop 75 m away ties with a house next door) but can no longer drag a
    spot hundreds of metres from the people it should serve. When nothing
    lies within the radius the 3 nearest panden are returned with
    ``beyond_radius`` set, so a spot in open terrain still lands on a
    building.

    Returns ``{"target_rd_x", "target_rd_y", "beyond_radius", "poi": {...} |
    None, "candidates": [{"identificatie", "rd_x", "rd_y", "distance_m",
    "tier", "bouwjaar", "gebruiksdoel"}, ...]}`` or None on request failure
    (not cached, so a rerun retries). Cached on disk per snap target.
    Thread-safe: only reads module globals and does atomic dict writes.
    """
    rep_poi = _nearest_snap_poi(rd_x, rd_y, poi_index, POI_SNAP_RADIUS_M)
    key = _cache_key(rd_x, rd_y)
    if rep_poi is not None and rep_poi["osm_id"]:
        key = f"{key}|{rep_poi['osm_id']}"
    if key in cache:
        return cache[key] or None

    # Resolve the POI / OV target (bonus only — ranking distance is always
    # measured from the pre-snap point). The bbox is centred between the two
    # so both neighbourhoods are covered.
    target_bonus = 0.0
    if rep_poi is not None:
        target_x, target_y = rep_poi["rd_x"], rep_poi["rd_y"]
        target_bonus = SNAP_POI_BONUS_M
    else:
        rep_ov = _nearest_ov_stop(rd_x, rd_y, OV_TARGET_SHIFT_M)
        if rep_ov is not None:
            target_x, target_y = _wgs84_to_rd(rep_ov["lat"], rep_ov["lon"])
            target_bonus = SNAP_OV_BONUS_M
        else:
            target_x, target_y = rd_x, rd_y

    # Box around the pre-snap point: every candidate within SNAP_MAX_M plus
    # the FRONTAGE_RADIUS_M ring of neighbours each candidate is scored on.
    bbox = (
        rd_x - SNAP_BBOX_M, rd_y - SNAP_BBOX_M,
        rd_x + SNAP_BBOX_M, rd_y + SNAP_BBOX_M,
    )
    try:
        features = _wfs_pand_features(bbox, session=session, timeout=timeout)
    except Exception as e:
        print(f"    BAG snap failed at RD ({rd_x:.0f},{rd_y:.0f}): {e}")
        return None

    panden: list[tuple[float, float, dict, bool]] = []  # (cx, cy, props, commercial)
    for feat in features:
        # Footprint bbox centre is within a metre or two of the centroid for
        # ordinary panden and avoids building a shapely polygon per feature.
        fb = feat.get("bbox")
        if fb and len(fb) == 4:
            cx, cy = (fb[0] + fb[2]) / 2, (fb[1] + fb[3]) / 2
        else:
            geom = feat.get("geometry")
            if not geom:
                continue
            try:
                c = shape(geom).centroid
            except Exception:
                continue
            cx, cy = float(c.x), float(c.y)
        props = feat.get("properties", {})
        panden.append((cx, cy, props, _is_commercial(props.get("gebruiksdoel"))))
    del features
    if not panden:
        cache[key] = {}  # remember "no buildings" so we skip on retry
        return None

    xs = np.array([p[0] for p in panden])
    ys = np.array([p[1] for p in panden])
    commercial = np.array([p[3] for p in panden])

    scored: list[dict] = []
    for i, (cx, cy, props, _com) in enumerate(panden):
        dist = float(np.hypot(cx - rd_x, cy - rd_y))
        dist_target = float(np.hypot(cx - target_x, cy - target_y))
        at_target = target_bonus > 0 and dist_target <= SNAP_TARGET_HIT_M
        tier = _use_score(props.get("gebruiksdoel"))
        # Commercial frontage: winkel/bijeenkomst panden around this one
        # (itself excluded). Shopping streets score 4-5, side streets 0-1.
        near = (np.hypot(xs - cx, ys - cy) <= FRONTAGE_RADIUS_M) & commercial
        near[i] = False
        frontage = int(near.sum())
        score = dist + tier * SNAP_TIER_PENALTY_M
        score -= min(frontage, FRONTAGE_MAX) * FRONTAGE_BONUS_M
        if at_target:
            score -= target_bonus
        if tier >= 1 and frontage == 0:
            score += BETWEEN_HOUSES_PENALTY_M  # a house/office between houses
        scored.append({
            "identificatie": props.get("identificatie"),
            "rd_x": round(cx, 1),
            "rd_y": round(cy, 1),
            "distance_m": int(round(dist)),
            "at_target": at_target,
            "tier": tier,
            "frontage_60m": frontage,
            "bouwjaar": props.get("bouwjaar"),
            "gebruiksdoel": props.get("gebruiksdoel"),
            "_score": score,
        })

    in_radius = [c for c in scored if c["distance_m"] <= SNAP_MAX_M]
    beyond_radius = not in_radius
    if in_radius:
        in_radius.sort(key=lambda c: (c["_score"], c["distance_m"]))
        top = in_radius[:SNAP_CANDIDATES_KEPT]
    else:
        scored.sort(key=lambda c: c["distance_m"])
        top = scored[:3]
    for c in top:
        c.pop("_score", None)

    result = {
        "target_rd_x": round(float(target_x), 1),
        "target_rd_y": round(float(target_y), 1),
        "beyond_radius": beyond_radius,
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
        "candidates": top,
    }
    cache[key] = result
    return result


def choose_bag_pand(
    ranked: dict | None, used_ids: set[str], used_points: list[tuple[float, float]],
) -> dict | None:
    """First ranked candidate that is not already used by an earlier spot of
    the same PC4 and lies >= MIN_SPOT_SEPARATION_M from those spots."""
    if not ranked:
        return None
    for c in ranked.get("candidates", []):
        ident = c.get("identificatie")
        if ident and ident in used_ids:
            continue
        if any(
            np.hypot(c["rd_x"] - ux, c["rd_y"] - uy) < MIN_SPOT_SEPARATION_M
            for ux, uy in used_points
        ):
            continue
        return c
    return None


def _wgs84_to_rd(lat: float, lon: float) -> tuple[float, float]:
    x, y = _RD_TO_WGS84.transform(lon, lat, direction="INVERSE")
    return float(x), float(y)


def _rd_to_wgs84(rd_x: float, rd_y: float) -> tuple[float, float]:
    lon, lat = _RD_TO_WGS84.transform(rd_x, rd_y)
    return float(lat), float(lon)


def _load_json_cache(path: Path) -> dict[str, dict]:
    if path.exists():
        try:
            with open(path) as f:
                return json.load(f)
        except Exception:
            return {}
    return {}


def _save_json_cache(path: Path, cache: dict[str, dict]) -> None:
    """Atomic write of a snapshot: `dict(cache)` copies under the GIL, so
    worker threads may keep inserting while the checkpoint is serialised,
    and the temp-file rename never leaves a truncated cache behind."""
    path.parent.mkdir(parents=True, exist_ok=True)
    snapshot = dict(cache)
    tmp = path.with_suffix(path.suffix + ".tmp")
    with open(tmp, "w") as f:
        json.dump(snapshot, f, separators=(",", ":"))
    tmp.replace(path)


def reverse_geocode_address(
    lat: float, lon: float, cache: dict[str, dict],
    *, session: requests.Session, timeout: int = 20,
) -> dict | None:
    """Nearest address for (lat, lon) via the PDOK Locatieserver reverse
    endpoint (open, no key). Returns ``{weergavenaam, straat, huisnummer,
    postcode, woonplaats, afstand_m, nummeraanduiding_id,
    verblijfsobject_id}`` or None. Addresses only — no person data. Cached
    on disk per coordinate (6 dp); failures are not cached so reruns retry.
    """
    key = f"{lat:.6f},{lon:.6f}"
    if key in cache:
        return cache[key] or None
    params = {
        "lat": f"{lat:.6f}",
        "lon": f"{lon:.6f}",
        "rows": 1,
        "type": "adres",
        "fl": "weergavenaam,straatnaam,huis_nlt,postcode,woonplaatsnaam,"
              "afstand,nummeraanduiding_id,adresseerbaarobject_id",
    }
    try:
        r = session.get(LOCSERVER_REVERSE_URL, params=params, timeout=timeout)
        r.raise_for_status()
        docs = (r.json().get("response") or {}).get("docs") or []
    except Exception as e:
        print(f"    Reverse geocode failed at ({lat:.5f},{lon:.5f}): {e}")
        return None
    if not docs:
        cache[key] = {}
        return None
    d = docs[0]
    afstand = d.get("afstand")
    result = {
        "weergavenaam": d.get("weergavenaam"),
        "straat": d.get("straatnaam"),
        "huisnummer": d.get("huis_nlt"),
        "postcode": d.get("postcode"),
        "woonplaats": d.get("woonplaatsnaam"),
        "afstand_m": int(round(float(afstand))) if afstand is not None else None,
        "nummeraanduiding_id": d.get("nummeraanduiding_id"),
        "verblijfsobject_id": d.get("adresseerbaarobject_id"),
    }
    cache[key] = result
    return result


def _strip_internal(sug: dict) -> None:
    for k in ("_rd_x", "_rd_y", "_white_spot_wkb"):
        sug.pop(k, None)


def run_snap_pass(
    results: dict[str, dict], *, workers: int,
) -> dict:
    """Snap every spot to a distinct BAG pand, recompute its reach at the
    snapped building and attach the nearest address.

    Phase A (threaded): fetch ranked pand candidates per spot (PDOK WFS).
    Phase B (sequential, rank order per PC4): choose a distinct pand,
              recompute est_new_pop at the snapped point, attach nearest OV.
    Phase C (threaded): reverse-geocode the final coordinate.
    """
    bag_cache = _load_json_cache(BAG_CACHE_PATH)
    addr_cache = _load_json_cache(ADDRESS_CACHE_PATH)
    bag_size0, addr_size0 = len(bag_cache), len(addr_cache)
    session = requests.Session()
    session.headers["User-Agent"] = "pakketpunten-analyse/1.0 (placement-suggestions)"
    throttle = threading.Semaphore(workers)
    save_lock = threading.Lock()
    SAVE_EVERY = 250  # new cache entries between checkpoint writes

    def _checkpoint(path: Path, cache: dict, counter: list[int]) -> None:
        """Write the cache every SAVE_EVERY new entries (a hard kill by the OS
        skips `finally`, so long cold runs must not lose their progress)."""
        counter[0] += 1
        if counter[0] % SAVE_EVERY == 0:
            with save_lock:
                _save_json_cache(path, cache)

    # Flatten all spots, keeping PC4 grouping and rank order.
    jobs: list[tuple[str, dict, list[dict]]] = []  # (slug, pc4 record, spots)
    for slug, payload in results.items():
        for rec in payload["pc4s"]:
            spots = rec.get("suggestions") or []
            if spots:
                jobs.append((slug, rec, spots))
    poi_indexes = {slug: _load_poi_snap_index(slug) for slug in results}

    stats = {
        "spots": 0, "snapped": 0, "unsnapped": 0, "no_distinct": 0,
        "beyond_radius": 0, "with_address": 0, "duplicates": 0, "dist": [],
    }

    # ---- Phase A: candidates ------------------------------------------- #
    bag_new = [0]

    def _fetch(args: tuple) -> dict | None:
        slug, sug = args
        with throttle:
            before = len(bag_cache)
            out = fetch_bag_candidates(
                sug["_rd_x"], sug["_rd_y"], bag_cache,
                session=session, poi_index=poi_indexes.get(slug),
            )
            if len(bag_cache) != before:
                _checkpoint(BAG_CACHE_PATH, bag_cache, bag_new)
                time.sleep(0.02)  # politeness when uncached
            return out

    flat = [(slug, sug) for slug, _rec, spots in jobs for sug in spots
            if sug.get("_rd_x") is not None]
    print(f"  Phase A: BAG candidates for {len(flat):,} spots "
          f"({workers} workers, cache {bag_size0:,} entries)...")
    try:
        with ThreadPoolExecutor(max_workers=workers) as ex:
            ranked_list = list(ex.map(_fetch, flat))
    finally:
        _save_json_cache(BAG_CACHE_PATH, bag_cache)
    ranked_by_id = {id(sug): rk for (_s, sug), rk in zip(flat, ranked_list)}

    # ---- Phase B: choose + recompute ----------------------------------- #
    print("  Phase B: choosing distinct panden and recomputing reach...")
    for _slug, _rec, spots in jobs:
        used_ids: set[str] = set()
        used_points: list[tuple[float, float]] = []
        seen_ids: list[str] = []
        for sug in spots:
            stats["spots"] += 1
            rd_x, rd_y = sug.get("_rd_x"), sug.get("_rd_y")
            ranked = ranked_by_id.get(id(sug))
            chosen = choose_bag_pand(ranked, used_ids, used_points) if rd_x is not None else None
            if chosen is None:
                if ranked and ranked.get("candidates"):
                    # Every suitable pand is already taken by an earlier spot:
                    # drop this spot rather than show a bare cell centroid.
                    sug["_drop"] = True
                    stats["no_distinct"] += 1
                    continue
                sug["snapped_to_bag"] = False
                stats["unsnapped"] += 1
                if rd_x is not None:
                    used_points.append((rd_x, rd_y))
                continue
            cx, cy = chosen["rd_x"], chosen["rd_y"]
            lat, lon = _rd_to_wgs84(cx, cy)
            sug["snapped_to_bag"] = True
            sug["pre_snap_lat"] = sug["lat"]
            sug["pre_snap_lon"] = sug["lon"]
            sug["lat"] = round(lat, 6)
            sug["lon"] = round(lon, 6)
            sug["bag_distance_m"] = int(round(float(np.hypot(cx - rd_x, cy - rd_y))))
            sug["bag_gebruiksdoel"] = chosen.get("gebruiksdoel")
            sug["bag_bouwjaar"] = chosen.get("bouwjaar")
            sug["bag_identificatie"] = chosen.get("identificatie")
            sug["bag_frontage_60m"] = chosen.get("frontage_60m")
            sug["bag_beyond_radius"] = bool(ranked.get("beyond_radius"))
            sug["nearest_ov"] = _nearest_ov_stop(cx, cy, OV_REPORT_RADIUS_M)
            poi = ranked.get("poi")
            if poi and chosen.get("at_target"):
                sug["poi_category"] = poi.get("category")
                sug["poi_naam"] = poi.get("name")
                sug["poi_distance_m"] = poi.get("distance_m")
            # Reach at the building actually shown, not at the CBS cell.
            wkb_bytes = sug.get("_white_spot_wkb")
            if wkb_bytes:
                try:
                    part = shapely_wkb.loads(wkb_bytes)
                    cells = _grid_cells_in(Point(cx, cy).buffer(400).intersection(part))
                    sug["est_new_pop_within_400m"] = int(round(float(cells["aantal_inwoners"].sum())))
                except Exception:
                    pass
            if chosen.get("identificatie"):
                used_ids.add(chosen["identificatie"])
                seen_ids.append(chosen["identificatie"])
            used_points.append((cx, cy))
            stats["snapped"] += 1
            stats["dist"].append(sug["bag_distance_m"])
            if ranked.get("beyond_radius"):
                stats["beyond_radius"] += 1
        if len(seen_ids) != len(set(seen_ids)):
            stats["duplicates"] += 1
        dropped = [sug for sug in spots if sug.get("_drop")]
        if dropped:
            spots[:] = [sug for sug in spots if not sug.get("_drop")]
            for i, sug in enumerate(spots, start=1):
                sug["rank"] = i
            _rec["suggestion"] = spots[0] if spots else None

    # ---- Phase C: addresses -------------------------------------------- #
    addr_new = [0]

    def _addr(sug: dict) -> dict | None:
        with throttle:
            before = len(addr_cache)
            out = reverse_geocode_address(sug["lat"], sug["lon"], addr_cache, session=session)
            if len(addr_cache) != before:
                _checkpoint(ADDRESS_CACHE_PATH, addr_cache, addr_new)
                time.sleep(0.02)
            return out

    all_spots = [sug for _s, _r, spots in jobs for sug in spots]
    print(f"  Phase C: nearest address for {len(all_spots):,} spots "
          f"(cache {addr_size0:,} entries)...")
    try:
        with ThreadPoolExecutor(max_workers=workers) as ex:
            addresses = list(ex.map(_addr, all_spots))
    finally:
        _save_json_cache(ADDRESS_CACHE_PATH, addr_cache)
    for sug, adres in zip(all_spots, addresses):
        # Keep the output lean (the main map lazy-loads this file): the
        # display name already carries street, number and place.
        sug["adres"] = (
            {k: adres.get(k) for k in (
                "weergavenaam", "postcode", "afstand_m",
                "nummeraanduiding_id", "verblijfsobject_id",
            )}
            if adres else None
        )
        if adres:
            stats["with_address"] += 1
        _strip_internal(sug)

    dist = sorted(stats["dist"])
    stats['spots'] -= stats['no_distinct']
    print(f"  {stats['spots']:,} spots: {stats['snapped']:,} snapped, "
          f"{stats['unsnapped']:,} kept pre-snap point, "
          f"{stats['no_distinct']:,} dropped (no distinct pand left), "
          f"{stats['beyond_radius']:,} beyond {SNAP_MAX_M} m radius")
    if dist:
        print(f"  snap distance median {statistics.median(dist):.0f} m, "
              f"p90 {dist[int(len(dist) * 0.9)]} m, max {dist[-1]} m")
    print(f"  PC4s with a duplicate pand among spots: {stats['duplicates']} (expected 0)")
    print(f"  spots with address: {stats['with_address']:,}/{stats['spots']:,}")
    print(f"  caches: BAG {bag_size0:,} -> {len(bag_cache):,}, "
          f"address {addr_size0:,} -> {len(addr_cache):,}")
    return stats


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
                        help="Skip the PDOK BAG building-snap and address step (offline / faster).")
    parser.add_argument("--snap-workers", type=int, default=4,
                        help="Parallel PDOK requests during the snap/address pass (default 4).")
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

    # ---- BAG snap + address pass ---- #
    # Sequential per PC4 (dedup needs rank order) but the PDOK calls run in a
    # small thread pool. ~11k WFS + ~11k reverse-geocode calls cold (~20 min
    # with 4 workers); warm caches make a rerun take about a minute.
    snap_stats: dict | None = None
    if not args.no_bag_snap:
        print(f"\nSnapping suggestions to distinct BAG panden + nearest address "
              f"(PDOK, caches: {BAG_CACHE_PATH.relative_to(ROOT)}, "
              f"{ADDRESS_CACHE_PATH.relative_to(ROOT)})...")
        snap_stats = run_snap_pass(results, workers=max(1, args.snap_workers))
    else:
        # Strip internal fields even when we're skipping the snap.
        for payload in results.values():
            for r in payload["pc4s"]:
                for sug in r.get("suggestions") or []:
                    _strip_internal(sug)

    out = {
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "weights": weights,
        "top_n_per_municipality": TOP_N,
        "suggestions_per_pc4": MAX_SUGGESTIONS_PER_PC4,
        "poi_snap_radius_m": POI_SNAP_RADIUS_M,
        "snap_max_m": SNAP_MAX_M,
        "snap_tier_penalty_m": SNAP_TIER_PENALTY_M,
        "frontage_radius_m": FRONTAGE_RADIUS_M,
        "min_spot_separation_m": MIN_SPOT_SEPARATION_M,
        "address_lookup_used": snap_stats is not None,
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
