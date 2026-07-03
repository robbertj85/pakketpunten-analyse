"""Plan an optimal parcel-locker network per municipality (greedy set-cover).

Built for the DMI-hackathon challenge "Het Pakketkluis Netwerk" (Gemeente
Den Haag): design a covering network of unmanned parcel lockers so residents
live within 300-500 m walking distance, using creative but real locations.

Method
------
1. Candidates = public POIs from the per-municipality bundle
   (webapp/public/data/poi/by-municipality/{slug}.geojson): supermarkets,
   shopping centres, stations, tram/bus stops, parking garages, bicycle
   parkings, libraries, town halls, transformer houses. Deduplicated so a
   higher-priority type wins within 50 m.
2. Demand = CBS Vierkantstatistieken 100 m inhabited cells clipped to the
   municipality boundary (same grid as the coverage stats elsewhere in the
   app).
3. Greedy set-cover per scenario (walking distance R x start situation):
   repeatedly place a locker at the candidate covering the most *not yet
   covered* inhabitants within R, until the marginal gain drops below
   --min-gain or --max-picks is reached. Greedy solutions are nested, so the
   webapp can slide "aantal kluizen" from 0..N for free.
4. Per scenario a `cell_rank` array records for every cell when it first
   became covered (0 = at start, k = by pick k, -1 = never) - this powers the
   white-spot animation client-side without shipping any polygons.

Distance is Euclidean in RD (EPSG:28992), consistent with every other
coverage figure in this project. Walk-network isochrones are future work.

Output -> webapp/public/data/locker_network/{slug}.json

Run:
    python scripts/plan_locker_network.py --slug den-haag
    python scripts/plan_locker_network.py --all
"""
from __future__ import annotations

import argparse
import json
import math
import multiprocessing as mp
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

import geopandas as gpd
import numpy as np
from shapely.geometry import shape
from shapely.prepared import prep

ROOT = Path(__file__).parent.parent
DATA_DIR = ROOT / "webapp" / "public" / "data"
POI_DIR = DATA_DIR / "poi" / "by-municipality"
OUT_DIR = DATA_DIR / "locker_network"
MUNICIPALITIES_PATH = ROOT / "webapp" / "public" / "municipalities.json"
CBS_GRID_PATH = ROOT / "data" / "cbs" / "cbs_vk100_2024_inhabited.gpkg"

WGS84 = "EPSG:4326"
RD = "EPSG:28992"

# Same locker set as compute_population_coverage.py — keep in sync.
LOCKER_TYPES = {"packStation", "automaat", "dpd_box", "locker", "Buitenkluis"}

DEFAULT_DISTANCES = [300, 400, 500]
DEFAULT_STARTS = ["greenfield", "automaten", "alle-punten"]
DEDUPE_M = 50          # candidate near a higher-priority candidate is dropped
MIN_GAIN_DEFAULT = 25  # stop when the best pick adds fewer inhabitants
MIN_SPACING_DEFAULT = 100  # no two picked lockers within this distance
COVERAGE_STOP = 0.995  # stop when 99.5% of inhabitants are covered

# Candidate location types. Priority: lower = preferred (wins dedupe and
# tie-breaks) — mirrors where parcel lockers appear in practice. The dict is
# exported verbatim so the webapp shows the same definitions.
# fields: label, prioriteit, buitenruimte_24_7, sociale_controle (0-2)
TYPE_META: dict[str, dict] = {
    "winkelcentrum":       {"label": "Winkelcentrum",       "prioriteit": 0, "buiten_24_7": False, "sociale_controle": 2, "kleur": "#EA580C"},
    "supermarkt":          {"label": "Supermarkt",          "prioriteit": 1, "buiten_24_7": False, "sociale_controle": 2, "kleur": "#DB2777"},
    "ns_station":          {"label": "NS-station",          "prioriteit": 1, "buiten_24_7": True,  "sociale_controle": 2, "kleur": "#D97706"},
    "metro_station":       {"label": "Metrostation",        "prioriteit": 1, "buiten_24_7": True,  "sociale_controle": 2, "kleur": "#E2231A"},
    "ov_knooppunt":        {"label": "OV-knooppunt",        "prioriteit": 2, "buiten_24_7": True,  "sociale_controle": 2, "kleur": "#6B46C1"},
    "tram_halte":          {"label": "Tramhalte",           "prioriteit": 3, "buiten_24_7": True,  "sociale_controle": 1, "kleur": "#0073B7"},
    "parkeergarage":       {"label": "Parkeergarage",       "prioriteit": 3, "buiten_24_7": True,  "sociale_controle": 1, "kleur": "#475569"},
    "fietsenstalling":     {"label": "Fietsenstalling",     "prioriteit": 4, "buiten_24_7": True,  "sociale_controle": 1, "kleur": "#0891B2"},
    "bibliotheek":         {"label": "Bibliotheek",         "prioriteit": 4, "buiten_24_7": False, "sociale_controle": 1, "kleur": "#4338CA"},
    "gemeentehuis":        {"label": "Gemeentehuis",        "prioriteit": 4, "buiten_24_7": False, "sociale_controle": 1, "kleur": "#B45309"},
    "bus_halte":           {"label": "Bushalte",            "prioriteit": 5, "buiten_24_7": True,  "sociale_controle": 1, "kleur": "#1F8A4C"},
    "p_and_r":             {"label": "P+R",                 "prioriteit": 5, "buiten_24_7": True,  "sociale_controle": 0, "kleur": "#0EA5E9"},
    "transformatorhuisje": {"label": "Transformatorhuisje", "prioriteit": 6, "buiten_24_7": True,  "sociale_controle": 0, "kleur": "#52525B"},
}

# Transparent capacity assumptions — the webapp computes live capacity from
# these together with the out-of-home slider. Sources: ACM Post- en
# pakketmonitor 2024 counts 606M parcels in the total NL market (~34 per
# inhabitant incl. B2B); 24 per inhabitant per year is a conservative
# estimate of the consumer share. 1.5 days average dwell time per parcel,
# 85% practical occupancy ceiling, and the cabinet column layout from
# webapp/lib/lockerCatalog.ts. ACM publishes national totals only — no
# per-municipality split exists.
CAPACITY_DEFAULTS = {
    "pakketten_pp_jaar": 24,
    "verblijf_dagen": 1.5,
    "vakken_per_kolom": 9.3,
    "bezetting_max": 0.85,
    "kolommen_per_kast_max": 17,
}

METHODOLOGY = {
    "afstand": "euclidische straal in RD (EPSG:28992) — consistent met alle dekkingscijfers in deze app; loopnetwerk-isochronen zijn future work",
    "vraag": "CBS Vierkantstatistieken 100 m, bewoonde cellen (>=5 inwoners), geclipt op de gemeentegrens",
    "kandidaten": "OpenStreetMap-POI's (Overpass) per gemeente; ontdubbeld binnen 50 m op typeprioriteit",
    "optimalisatie": "greedy set-cover: iteratief de kandidaat met de grootste marginale populatiewinst binnen de loopafstand; greedy-oplossingen zijn genest zodat 'eerste N kluizen' altijd het N-kluizennetwerk is",
    "laad_los": "proxy: alle kandidaat-types zijn per definitie straat-adjacent (halte, garage, winkel); geen aparte NDW-check",
    "sociale_veiligheid": "indicatieve score per locatietype (2 = hoge sociale controle, 0 = aandachtspunt), geen harde uitsluiting",
}

# CBS grid shared with fork workers via module globals (copy-on-write).
_CBS_X: Optional[np.ndarray] = None   # RD x of cell centroids
_CBS_Y: Optional[np.ndarray] = None   # RD y of cell centroids
_CBS_POP: Optional[np.ndarray] = None
_CBS_LAT: Optional[np.ndarray] = None
_CBS_LON: Optional[np.ndarray] = None

_ARGS = None  # parsed CLI args, inherited by fork workers


def load_cbs_grid() -> None:
    """Load the inhabited-cell grid once into flat numpy arrays (module
    globals so fork workers inherit them without pickling)."""
    global _CBS_X, _CBS_Y, _CBS_POP, _CBS_LAT, _CBS_LON
    grid = gpd.read_file(CBS_GRID_PATH)
    if grid.crs != RD:
        grid = grid.to_crs(RD)
    cent = grid.geometry.centroid
    _CBS_X = cent.x.to_numpy()
    _CBS_Y = cent.y.to_numpy()
    _CBS_POP = grid["aantal_inwoners"].to_numpy(dtype=float)
    lonlat = gpd.GeoSeries(cent, crs=RD).to_crs(WGS84)
    _CBS_LAT = lonlat.y.to_numpy()
    _CBS_LON = lonlat.x.to_numpy()


def _load_boundary_and_points(slug: str):
    """Boundary polygon (RD) + existing parcel points (RD x/y arrays, split
    into all points and lockers only). Returns None when the municipality
    geojson or its boundary feature is missing."""
    path = DATA_DIR / f"{slug}.geojson"
    if not path.exists():
        return None
    with open(path) as f:
        g = json.load(f)
    boundary = None
    pts_all: list[tuple[float, float]] = []
    pts_locker: list[tuple[float, float]] = []
    for feat in g.get("features", []):
        t = feat.get("properties", {}).get("type")
        if t == "boundary":
            boundary = shape(feat["geometry"])
        elif t == "pakketpunt":
            c = feat.get("geometry", {}).get("coordinates")
            if not c:
                continue
            pts_all.append((c[0], c[1]))
            if feat["properties"].get("puntType") in LOCKER_TYPES:
                pts_locker.append((c[0], c[1]))
    if boundary is None:
        return None

    def to_rd(pts: list[tuple[float, float]]) -> tuple[np.ndarray, np.ndarray]:
        if not pts:
            return np.empty(0), np.empty(0)
        s = gpd.GeoSeries(gpd.points_from_xy([p[0] for p in pts], [p[1] for p in pts]), crs=WGS84).to_crs(RD)
        return s.x.to_numpy(), s.y.to_numpy()

    boundary_rd = gpd.GeoSeries([boundary], crs=WGS84).to_crs(RD).iloc[0]
    return boundary_rd, to_rd(pts_all), to_rd(pts_locker)


def _load_candidates(slug: str) -> list[dict]:
    """POI candidates (RD coords + meta), deduplicated on type priority."""
    path = POI_DIR / f"{slug}.geojson"
    if not path.exists():
        return []
    with open(path) as f:
        payload = json.load(f)
    raw: list[dict] = []
    lons, lats = [], []
    for feat in payload.get("features", []):
        p = feat.get("properties", {})
        cat = p.get("category")
        if cat not in TYPE_META:
            continue
        c = (feat.get("geometry") or {}).get("coordinates")
        if not c:
            continue
        lons.append(float(c[0]))
        lats.append(float(c[1]))
        raw.append({
            "type": cat,
            "naam": str(p.get("name") or ""),
            "lat": round(float(c[1]), 6),
            "lon": round(float(c[0]), 6),
            "prio": TYPE_META[cat]["prioriteit"],
        })
    if not raw:
        return []
    pts = gpd.GeoSeries(gpd.points_from_xy(lons, lats), crs=WGS84).to_crs(RD)
    for cand, x, y in zip(raw, pts.x.to_numpy(), pts.y.to_numpy()):
        cand["x"] = float(x)
        cand["y"] = float(y)

    # Dedupe: iterate by priority; drop candidates within DEDUPE_M of an
    # already accepted one (so a supermarket absorbs the bus stop out front).
    raw.sort(key=lambda c: (c["prio"], c["type"], -len(c["naam"])))
    kept: list[dict] = []
    kx: list[float] = []
    ky: list[float] = []
    d2max = DEDUPE_M * DEDUPE_M
    for cand in raw:
        if kx:
            ax = np.asarray(kx) - cand["x"]
            ay = np.asarray(ky) - cand["y"]
            if float(np.min(ax * ax + ay * ay)) <= d2max:
                continue
        kept.append(cand)
        kx.append(cand["x"])
        ky.append(cand["y"])
    return kept


def _candidate_flags(cands: list[dict]) -> None:
    """Attach transparent suitability flags (no hard filtering)."""
    ov_types = {"ns_station", "metro_station", "ov_knooppunt", "tram_halte", "bus_halte"}
    ovx = np.asarray([c["x"] for c in cands if c["type"] in ov_types])
    ovy = np.asarray([c["y"] for c in cands if c["type"] in ov_types])
    shopx = np.asarray([c["x"] for c in cands if c["type"] in ("supermarkt", "winkelcentrum")])
    shopy = np.asarray([c["y"] for c in cands if c["type"] in ("supermarkt", "winkelcentrum")])
    for c in cands:
        meta = TYPE_META[c["type"]]
        flags: list[str] = []
        if c["type"] in ov_types:
            flags.append("ov")
        elif ovx.size:
            d2 = (ovx - c["x"]) ** 2 + (ovy - c["y"]) ** 2
            if float(np.min(d2)) <= 150 * 150:
                flags.append("ov")
        sc = meta["sociale_controle"]
        if sc < 2 and shopx.size:
            d2 = (shopx - c["x"]) ** 2 + (shopy - c["y"]) ** 2
            if float(np.min(d2)) <= 100 * 100:
                sc = 2
        if sc >= 2:
            flags.append("sociale_controle")
        if meta["buiten_24_7"]:
            flags.append("24_7")
        if sc == 0:
            flags.append("aandachtspunt_sociale_veiligheid")
        c["flags"] = flags


def _cells_in_boundary(boundary_rd) -> np.ndarray:
    """Indices of CBS cells whose centroid lies inside the boundary."""
    minx, miny, maxx, maxy = boundary_rd.bounds
    bbox = np.nonzero(
        (_CBS_X >= minx) & (_CBS_X <= maxx) & (_CBS_Y >= miny) & (_CBS_Y <= maxy)
    )[0]
    if bbox.size == 0:
        return bbox
    prepared = prep(boundary_rd)
    from shapely.geometry import Point
    keep = [i for i in bbox if prepared.contains(Point(_CBS_X[i], _CBS_Y[i]))]
    return np.asarray(keep, dtype=int)


def _covered_mask(cx: np.ndarray, cy: np.ndarray, px: np.ndarray, py: np.ndarray, r: float) -> np.ndarray:
    """Boolean mask over cells (cx, cy): within r metres of any point (px, py)."""
    covered = np.zeros(cx.shape[0], dtype=bool)
    r2 = r * r
    for x, y in zip(px, py):
        near = np.nonzero(
            (np.abs(cx - x) <= r) & (np.abs(cy - y) <= r) & (~covered)
        )[0]
        if near.size == 0:
            continue
        d2 = (cx[near] - x) ** 2 + (cy[near] - y) ** 2
        covered[near[d2 <= r2]] = True
    return covered


def process_municipality(muni: dict) -> tuple[str, str]:
    """Compute all scenarios for one municipality and write its JSON.
    Returns (slug, status-message)."""
    slug = muni["slug"]
    args = _ARGS

    loaded = _load_boundary_and_points(slug)
    if loaded is None:
        return slug, "skip: geen boundary/geojson"
    boundary_rd, (all_x, all_y), (lock_x, lock_y) = loaded

    cell_idx = _cells_in_boundary(boundary_rd)
    if cell_idx.size == 0:
        return slug, "skip: geen bewoonde CBS-cellen"
    cx = _CBS_X[cell_idx]
    cy = _CBS_Y[cell_idx]
    cpop = _CBS_POP[cell_idx]
    pop_total = float(cpop.sum())

    cands = _load_candidates(slug)
    if not cands:
        return slug, "skip: geen POI-kandidaten"
    _candidate_flags(cands)
    n_cand = len(cands)
    cand_x = np.asarray([c["x"] for c in cands])
    cand_y = np.asarray([c["y"] for c in cands])
    cand_prio = np.asarray([c["prio"] for c in cands])

    max_picks_cap = min(args.max_picks, max(20, math.ceil(pop_total / 2000)))

    scenarios: dict[str, dict] = {}
    for r in args.distances:
        # Cell indices within r per candidate (shared across starts).
        cover_idx: list[np.ndarray] = []
        r2 = r * r
        for i in range(n_cand):
            near = np.nonzero(
                (np.abs(cx - cand_x[i]) <= r) & (np.abs(cy - cand_y[i]) <= r)
            )[0]
            if near.size:
                d2 = (cx[near] - cand_x[i]) ** 2 + (cy[near] - cand_y[i]) ** 2
                near = near[d2 <= r2]
            cover_idx.append(near)

        for start in args.starts:
            if start == "greenfield":
                covered0 = np.zeros(cx.shape[0], dtype=bool)
            elif start == "automaten":
                covered0 = _covered_mask(cx, cy, lock_x, lock_y, r)
            else:  # alle-punten
                covered0 = _covered_mask(cx, cy, all_x, all_y, r)

            covered = covered0.copy()
            cell_rank = np.where(covered0, 0, -1).astype(int)
            active = np.ones(n_cand, dtype=bool)
            picks: list[dict] = []
            cum = float(cpop[covered0].sum())
            spacing2 = args.min_spacing * args.min_spacing

            while len(picks) < max_picks_cap:
                if cum >= COVERAGE_STOP * pop_total:
                    break
                best_i = -1
                best_gain = 0.0
                best_prio = 99
                for i in range(n_cand):
                    if not active[i]:
                        continue
                    ci = cover_idx[i]
                    if ci.size == 0:
                        active[i] = False
                        continue
                    gain = float(cpop[ci[~covered[ci]]].sum())
                    if gain > best_gain or (gain == best_gain and gain > 0 and cand_prio[i] < best_prio):
                        best_i = i
                        best_gain = gain
                        best_prio = int(cand_prio[i])
                if best_i < 0 or best_gain < args.min_gain:
                    break
                rank = len(picks) + 1
                newly = cover_idx[best_i][~covered[cover_idx[best_i]]]
                cell_rank[newly] = rank
                covered[cover_idx[best_i]] = True
                cum += best_gain
                picks.append({"c": best_i, "gain": int(round(best_gain)), "cum": int(round(cum))})
                # Enforce spacing and self-removal.
                d2 = (cand_x - cand_x[best_i]) ** 2 + (cand_y - cand_y[best_i]) ** 2
                active[d2 <= spacing2] = False

            scenarios[f"{r}|{start}"] = {
                "start_covered": int(round(float(cpop[covered0].sum()))),
                "picks": picks,
                "cell_rank": cell_rank.tolist(),
            }

    n_cells = int(cell_idx.size)
    for key, sc in scenarios.items():
        assert len(sc["cell_rank"]) == n_cells, f"cell_rank mismatch in {slug} {key}"

    out = {
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "slug": slug,
        "gemeente": muni["name"],
        "methodology": METHODOLOGY,
        "params": {
            "distances": args.distances,
            "starts": args.starts,
            "min_gain": args.min_gain,
            "min_spacing_m": args.min_spacing,
            "dedupe_m": DEDUPE_M,
            "max_picks": max_picks_cap,
        },
        "type_meta": TYPE_META,
        "capacity_defaults": CAPACITY_DEFAULTS,
        "population_total": int(round(pop_total)),
        "cells": {
            "lat": [round(float(v), 5) for v in _CBS_LAT[cell_idx]],
            "lon": [round(float(v), 5) for v in _CBS_LON[cell_idx]],
            "pop": [int(v) for v in cpop],
        },
        "candidates": [
            {
                "lat": c["lat"], "lon": c["lon"],
                "type": c["type"], "naam": c["naam"],
                "flags": c["flags"],
            }
            for c in cands
        ],
        "existing": {
            "alle_punten": int(all_x.size),
            "automaten": int(lock_x.size),
        },
        "scenarios": scenarios,
    }
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    out_path = OUT_DIR / f"{slug}.json"
    out_path.write_text(json.dumps(out, separators=(",", ":"), allow_nan=False))
    kb = out_path.stat().st_size / 1024
    sc400 = scenarios.get("400|greenfield")
    n_picks = len(sc400["picks"]) if sc400 else 0
    return slug, f"ok: {n_cand} kandidaten, {n_cells} cellen, {n_picks} picks (400|greenfield), {kb:.0f} KB"


def main() -> int:
    global _ARGS
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--slug", type=str, default=None,
                        help="Comma-separated municipality slugs (e.g. den-haag)")
    parser.add_argument("--all", action="store_true",
                        help="Process every municipality in municipalities.json")
    parser.add_argument("--distances", type=str, default="300,400,500")
    parser.add_argument("--starts", type=str, default=",".join(DEFAULT_STARTS))
    parser.add_argument("--max-picks", type=int, default=300)
    parser.add_argument("--min-gain", type=int, default=MIN_GAIN_DEFAULT)
    parser.add_argument("--min-spacing", type=int, default=MIN_SPACING_DEFAULT)
    parser.add_argument("--jobs", type=int, default=max(1, mp.cpu_count() - 1))
    args = parser.parse_args()
    args.distances = [int(d) for d in args.distances.split(",")]
    args.starts = [s.strip() for s in args.starts.split(",")]
    for s in args.starts:
        if s not in DEFAULT_STARTS:
            parser.error(f"onbekende start '{s}' (kies uit {DEFAULT_STARTS})")
    _ARGS = args

    if not args.slug and not args.all:
        parser.error("geef --slug <slug[,slug]> of --all")

    with open(MUNICIPALITIES_PATH) as f:
        municipalities = [m for m in json.load(f) if m.get("slug") != "nederland"]
    if args.slug:
        wanted = {s.strip() for s in args.slug.split(",")}
        municipalities = [m for m in municipalities if m["slug"] in wanted]
        missing = wanted - {m["slug"] for m in municipalities}
        if missing:
            print(f"⚠️  onbekende slugs: {sorted(missing)}")
    if not municipalities:
        print("Geen gemeenten om te verwerken.")
        return 1

    print(f"Loading CBS 100m grid: {CBS_GRID_PATH.relative_to(ROOT)}")
    load_cbs_grid()
    print(f"  {_CBS_POP.size:,} inhabited cells")

    print(f"\nPlanning locker networks for {len(municipalities)} municipalities "
          f"({args.jobs} workers, R={args.distances}, starts={args.starts})...")
    ok = skipped = 0
    if args.jobs > 1 and len(municipalities) > 1:
        ctx = mp.get_context("fork")
        with ctx.Pool(args.jobs) as pool:
            for slug, msg in pool.imap_unordered(process_municipality, municipalities):
                print(f"  {slug}: {msg}", flush=True)
                if msg.startswith("ok"):
                    ok += 1
                else:
                    skipped += 1
    else:
        for muni in municipalities:
            slug, msg = process_municipality(muni)
            print(f"  {slug}: {msg}", flush=True)
            if msg.startswith("ok"):
                ok += 1
            else:
                skipped += 1

    total_kb = sum(p.stat().st_size for p in OUT_DIR.glob("*.json")) / 1024
    print(f"\n✅ {ok} municipalities written, {skipped} skipped "
          f"→ {OUT_DIR.relative_to(ROOT)} ({total_kb/1024:.1f} MB total)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
