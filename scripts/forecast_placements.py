#!/usr/bin/env python3
"""
Where will the forecast growth land, and on whose ground?

Turns the midden-scenario forecast (scripts/forecast_growth.py) into probable
locations per gemeente per year, and says for each whether it can sit on
private property or needs public ground.

1. How growth lands, measured. Every carrier point that appeared in the last
   year (data/point_lifetimes.json, minus carrier intros and fetcher breaks) is
   checked against the network of the week before:
     - within 15 m of an existing point  -> co-locatie (an extra carrier at an
       existing location; needs no new place)
     - within 400 m                      -> verdichting (new location in an
       already covered area)
     - further                           -> witte vlek (new location in a gap)
   The gap share of new locations per urbanity class drives the split below,
   so the allocation follows what carriers actually did, not an ideal planner.

2. Per gemeente per year: new locaties = growth of unique locations; extra
   punten beyond that are co-location. New locaties split into witte vlek and
   verdichting by the measured share. Witte-vlek locations take the spots of
   placement_suggestions.json in order of how many uncovered inhabitants they
   reach (marginal spots first). Verdichting is reported per PC4, weighted by
   underservice (predicted minus actual points), because shop-driven
   densification does not have a predictable address.

3. Terrain per spot, with the inleverpuntenviewer method
   (scripts/classify_poi_ownership.py):
     - privaat host: the BAG pand the spot snapped to, if it can host a point
       (winkel/bijeenkomst/kantoor/zorg/onderwijs, or a shop within 60 m),
       or a privaat POI (supermarkt, winkelcentrum, ...) within 250 m.
     - publiek alternative: the nearest publiek POI within 250 m (bibliotheek,
       gemeentehuis, halte, inzamelpunt, ...), else the nearest public BGT
       ground (voetpad, plein, verharding, groen) sampled in rings up to
       120 m around the pocket's densest cell.
   A spot with no private host is flagged privaat_niet_invulbaar: purely
   residential pockets where the gap can only be closed on public ground.

Inputs:  webapp/public/data/forecast/*.json, placement_suggestions.json,
         poi/by-municipality/*.geojson (with eigendom), pc4_stats.json,
         population_coverage.json, data/point_lifetimes.json
Outputs: webapp/public/data/forecast_placements/{index,<slug>}.json
         data/bgt_terrain_cache.json (BGT lookups per sampled point)
"""

from __future__ import annotations

import argparse
import json
import math
import os
import sys
import threading
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from classify_poi_ownership import ONBEKEND, PRIVAAT, PUBLIEK, bgt_terrain  # noqa: E402
from point_categories import SAME_SPOT_M  # noqa: E402
from suggest_placements import _use_score  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
WEB = ROOT / "webapp" / "public" / "data"
FORECAST_DIR = WEB / "forecast"
OUT_DIR = WEB / "forecast_placements"
SUGGESTIONS = WEB / "placement_suggestions.json"
POI_DIR = WEB / "poi" / "by-municipality"
PC4_STATS = WEB / "pc4_stats.json"
COVERAGE = WEB / "population_coverage.json"
MUNICIPALITIES = ROOT / "webapp" / "public" / "municipalities.json"
LIFETIMES = ROOT / "data" / "point_lifetimes.json"
POPULATION = ROOT / "data" / "cbs" / "gemeente_population_forecast.json"
BGT_CACHE = ROOT / "data" / "bgt_terrain_cache.json"

SCENARIO = "midden"
COVER_M = 400
HOST_RADIUS_M = 250
PRIVATE_MAX_TIER = 1  # _use_score: winkel/bijeenkomst 0, kantoor/zorg/onderwijs 1
RING_OFFSETS_M = (0, 40, 80, 120)
RING_DIRECTIONS = 8

# Public POIs as placement hosts: civic buildings first, stops and the rest after.
PUBLIC_POI_TIER = {
    "bibliotheek": 0, "gemeentehuis": 0, "stadsdeelkantoor": 0, "inzamelpunt": 0,
    "metro_station": 0, "ns_station": 0, "ov_knooppunt": 0,
    "tram_halte": 1, "bus_halte": 1, "p_and_r": 1, "parkeergarage": 1,
    "fietsenstalling": 1, "sportveld": 1, "transformatorhuisje": 2,
}
PRIVATE_POI_TIER = {"supermarkt": 0, "winkelcentrum": 0}
TIER_PENALTY_M = 50

# Public BGT ground a locker can stand on. Carriageways, cycle paths and rails are not.
BGT_REJECT = ("rijbaan", "fietspad", "spoorbaan", "ov-baan", "baan voor", "transitie", "inrit")

_M_LAT = 111_250.0
_M_LON = 111_320.0 * math.cos(math.radians(52.2))


def xy(lon: float, lat: float) -> tuple[float, float]:
    return lon * _M_LON, lat * _M_LAT


def lonlat(x: float, y: float) -> tuple[float, float]:
    return x / _M_LON, y / _M_LAT


def load(path: Path):
    with open(path, encoding="utf-8") as handle:
        return json.load(handle)


def write(path: Path, payload):
    tmp = path.with_suffix(".json.tmp")
    with open(tmp, "w", encoding="utf-8") as handle:
        json.dump(payload, handle, ensure_ascii=False, separators=(",", ":"))
    os.replace(tmp, path)


class Grid:
    """Grid hash of points in metres for radius queries."""

    def __init__(self, cell: float):
        self.cell = cell
        self.cells: dict[tuple[int, int], list] = defaultdict(list)

    def add(self, x: float, y: float, item=None):
        self.cells[(int(x // self.cell), int(y // self.cell))].append((x, y, item))

    def nearest(self, x: float, y: float, radius: float):
        cx, cy = int(x // self.cell), int(y // self.cell)
        reach = int(math.ceil(radius / self.cell))
        best, best_d = None, radius
        for dx in range(-reach, reach + 1):
            for dy in range(-reach, reach + 1):
                for px, py, item in self.cells.get((cx + dx, cy + dy), ()):
                    d = math.hypot(px - x, py - y)
                    if d <= best_d:
                        best, best_d = item, d
        return best, (best_d if best is not None else None)

    def within(self, x: float, y: float, radius: float):
        cx, cy = int(x // self.cell), int(y // self.cell)
        reach = int(math.ceil(radius / self.cell))
        for dx in range(-reach, reach + 1):
            for dy in range(-reach, reach + 1):
                for px, py, item in self.cells.get((cx + dx, cy + dy), ()):
                    d = math.hypot(px - x, py - y)
                    if d <= radius:
                        yield item, d


# --- 1. measured landing pattern ------------------------------------------------


def measured_landing(lifetimes: dict, national: dict, slug_class: dict):
    """Classify every organic new point of the last year as co-locatie / verdichting / witte vlek."""
    weeks = lifetimes["weeks"]
    widx = {w: i for i, w in enumerate(weeks)}
    # Weeks where a carrier's new points are measurement, not growth.
    breaks = defaultdict(set)
    first_seen = {}
    for e in national["events"]:
        if e["type"] in ("note_rise", "auto_outlier"):
            continue
        carrier = e["carrier"].split(" (")[0]
        lo = widx.get(e["week"])
        hi = widx.get(e.get("until", e["week"]))
        if lo is None:
            continue
        for t in range(lo, (hi if hi is not None else lo) + 1):
            breaks[carrier].add(t)
            # A stale window ends with a catch-up week that dumps its backlog.
            breaks[carrier].add(t + 1)

    points = []
    for key, (first, last, cat, slug) in lifetimes["points"].items():
        carrier, lat, lon = key.split("|")
        points.append((carrier, float(lat), float(lon), first, last, cat, slug))
        first_seen[carrier] = min(first_seen.get(carrier, first), first)

    by_first = defaultdict(list)
    for p in points:
        by_first[p[3]].append(p)

    counts = defaultdict(lambda: {"co_locatie": 0, "verdichting": 0, "witte_vlek": 0})
    for t in range(1, len(weeks)):
        new = [p for p in by_first.get(t, ()) if t > first_seen[p[0]] and t not in breaks[p[0]]]
        if not new:
            continue
        grid = Grid(COVER_M)
        for p in points:
            if p[3] <= t - 1 <= p[4]:
                grid.add(*xy(p[2], p[1]), p[0])
        for p in new:
            x, y = xy(p[2], p[1])
            # The same carrier within 15 m the week before is the same point
            # with nudged coordinates (a new key), not a new point.
            if any(carrier == p[0] for carrier, _ in grid.within(x, y, SAME_SPOT_M)):
                continue
            _, d = grid.nearest(x, y, COVER_M)
            kind = "witte_vlek" if d is None else ("co_locatie" if d <= SAME_SPOT_M else "verdichting")
            cls = slug_class.get(p[6])
            counts[(cls, p[5])][kind] += 1
            counts[(cls, "alle")][kind] += 1
            counts[("alle", "alle")][kind] += 1
    return counts


def gap_share(counts, cls) -> float:
    """Witte-vlek share of new locations for an urbanity class, shrunk to the national share."""
    nat = counts[("alle", "alle")]
    nat_loc = nat["verdichting"] + nat["witte_vlek"]
    nat_share = nat["witte_vlek"] / nat_loc if nat_loc else 0.3
    c = counts.get((cls, "alle"))
    if not c:
        return nat_share
    n = c["verdichting"] + c["witte_vlek"]
    return (c["witte_vlek"] + 20 * nat_share) / (n + 20)


# --- 3. terrain -----------------------------------------------------------------


class BgtCache:
    def __init__(self, path: Path):
        self.path = path
        self.lock = threading.Lock()
        try:
            self.data = load(path)
        except (FileNotFoundError, json.JSONDecodeError):
            self.data = {}
        self.dirty = 0

    def get(self, lon: float, lat: float):
        key = f"{lon:.5f},{lat:.5f}"
        with self.lock:
            if key in self.data:
                return tuple(self.data[key])
        try:
            result = bgt_terrain(lon, lat)
        except Exception:  # noqa: BLE001 -- treated as unknown, retried next run
            return (ONBEKEND, "BGT: opzoeking mislukt")
        with self.lock:
            self.data[key] = list(result)
            self.dirty += 1
            if self.dirty % 250 == 0:
                write(self.path, self.data)
        return result

    def save(self):
        with self.lock:
            write(self.path, self.data)


def public_ground(lon: float, lat: float, cache: BgtCache):
    """Nearest acceptable public BGT ground in rings around a point."""
    x0, y0 = xy(lon, lat)
    for r in RING_OFFSETS_M:
        directions = [0.0] if r == 0 else [2 * math.pi * k / RING_DIRECTIONS for k in range(RING_DIRECTIONS)]
        for a in directions:
            plon, plat = lonlat(x0 + r * math.cos(a), y0 + r * math.sin(a))
            eigendom, bron = cache.get(plon, plat)
            if eigendom == PUBLIEK and not any(word in bron.lower() for word in BGT_REJECT):
                return {"lat": round(plat, 6), "lon": round(plon, 6), "bron": bron, "afstand_m": r}
    return None


def poi_index(slug: str):
    path = POI_DIR / f"{slug}.geojson"
    public, private = Grid(HOST_RADIUS_M), Grid(HOST_RADIUS_M)
    if not path.exists():
        return public, private, False
    classified = False
    for f in load(path).get("features", []):
        props = f.get("properties") or {}
        lon, lat = f["geometry"]["coordinates"][:2]
        cat = props.get("category")
        eigendom = props.get("eigendom")
        classified |= eigendom is not None
        item = {"categorie": cat, "naam": props.get("name") or "", "eigendom_bron": props.get("eigendom_bron"), "lat": lat, "lon": lon}
        if eigendom == PUBLIEK and cat in PUBLIC_POI_TIER:
            item["tier"] = PUBLIC_POI_TIER[cat]
            public.add(*xy(lon, lat), item)
        elif eigendom == PRIVAAT or cat in PRIVATE_POI_TIER:
            item["tier"] = PRIVATE_POI_TIER.get(cat, 1)
            private.add(*xy(lon, lat), item)
    return public, private, classified


def best_host(grid: Grid, lon: float, lat: float):
    best, best_score = None, None
    for item, d in grid.within(*xy(lon, lat), HOST_RADIUS_M):
        score = d + item["tier"] * TIER_PENALTY_M
        if best_score is None or score < best_score:
            best, best_score = {**item, "afstand_m": round(d)}, score
    return best


def terrain_for(spot: dict, public: Grid, private: Grid, cache: BgtCache):
    """(privaat option, publiek option, chosen terrein, bron) for one suggested spot."""
    anchor_lat = spot.get("pre_snap_lat") or spot["lat"]
    anchor_lon = spot.get("pre_snap_lon") or spot["lon"]

    privaat = None
    if spot.get("snapped_to_bag"):
        tier = _use_score(spot.get("bag_gebruiksdoel"))
        frontage = spot.get("bag_frontage_60m") or 0
        if tier <= PRIVATE_MAX_TIER or frontage >= 1:
            privaat = {
                "lat": spot["lat"],
                "lon": spot["lon"],
                "bron": f"BAG-pand ({spot.get('bag_gebruiksdoel') or 'onbekend gebruik'})"
                + (f", {frontage} winkel/horeca-panden binnen 60 m" if frontage else ""),
                "adres": (spot.get("adres") or {}).get("weergavenaam"),
            }
    if privaat is None:
        host = best_host(private, anchor_lon, anchor_lat)
        if host:
            privaat = {
                "lat": host["lat"],
                "lon": host["lon"],
                "bron": f"{host['categorie']}{' ' + host['naam'] if host['naam'] else ''} op {host['afstand_m']} m",
                "adres": None,
            }

    publiek = None
    host = best_host(public, anchor_lon, anchor_lat)
    if host:
        publiek = {
            "lat": host["lat"],
            "lon": host["lon"],
            "bron": f"{host['categorie']}{' ' + host['naam'] if host['naam'] else ''} ({host.get('eigendom_bron') or 'publiek'})",
            "afstand_m": host["afstand_m"],
        }
    else:
        # Also for spots with a private host: the publiek view shows every spot's
        # public alternative.
        publiek = public_ground(anchor_lon, anchor_lat, cache)

    if privaat:
        return privaat, publiek, PRIVAAT, privaat["bron"]
    if publiek:
        return None, publiek, PUBLIEK, publiek["bron"]
    return None, None, ONBEKEND, "geen private locatie en geen openbare grond gevonden"


# --- 2. allocation --------------------------------------------------------------


def yearly(forecast: dict, block: str):
    """[(year, net change)] from now to end 2030 for the midden median."""
    periods_y = forecast["periods"]["jaar"]
    months = forecast["periods"]["maand"]
    stock_y = forecast["scenarios"][SCENARIO][block]["stock"]["jaar"]["p50"]
    hist_m = forecast["history"][f"{block}_raw"]["maand"]
    now = hist_m[forecast["forecast_from"]["maand"]]
    out, prev = [], now
    for i, year in enumerate(periods_y):
        if i < forecast["forecast_from"]["jaar"] or stock_y[i] is None:
            continue
        out.append((year, stock_y[i] - prev))
        prev = stock_y[i]
    return out, now, months


def split_cumulative(total_by_year: list, share: float):
    """Round shares on the cumulative total so rounding never drifts."""
    out, cum, given = [], 0.0, 0
    for year, v in total_by_year:
        cum += max(v, 0)
        target = int(round(cum * share))
        out.append((year, target - given))
        given = target
    return out


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--only", nargs="*", help="limit to these gemeente slugs")
    parser.add_argument("--workers", type=int, default=8)
    args = parser.parse_args()

    national = load(FORECAST_DIR / "national.json")
    index = load(FORECAST_DIR / "index.json")
    suggestions = load(SUGGESTIONS)["by_municipality"]
    munis = {m["slug"]: m for m in load(MUNICIPALITIES)}
    pop = load(POPULATION)["gemeenten"]
    slug_class = {s: (pop.get(m.get("code") or "") or {}).get("stedelijkheid") for s, m in munis.items()}
    stats = load(PC4_STATS)["stats"]
    coverage = load(COVERAGE).get("pc4", {})
    name_to_slug = {m["name"]: s for s, m in munis.items()}

    print("Measuring where new points landed in the last year...")
    counts = measured_landing(load(LIFETIMES), national, slug_class)
    landing = {
        str(cls): {**v, "aandeel_witte_vlek_pct": round(100 * gap_share(counts, cls), 1)}
        for (cls, cat), v in sorted(counts.items(), key=lambda kv: str(kv[0])) if cat == "alle"
    }
    print(json.dumps(landing, indent=1))

    pc4_by_slug = defaultdict(list)
    for pc4, v in stats.items():
        slug = name_to_slug.get(v.get("municipality"))
        if slug:
            pc4_by_slug[slug].append((pc4, v))

    cache = BgtCache(BGT_CACHE)
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    slugs = [r["slug"] for r in index["gemeenten"]]
    if args.only:
        slugs = [s for s in slugs if s in set(args.only)]

    summary_rows = []
    for n_done, slug in enumerate(slugs, 1):
        forecast = load(FORECAST_DIR / f"{slug}.json")
        cls = slug_class.get(slug)
        p_gap = gap_share(counts, cls)
        loc_years, loc_now, _ = yearly(forecast, "locaties")
        pts_years, pts_now, _ = yearly(forecast, "punten")
        gap_years = split_cumulative(loc_years, p_gap)
        years = []
        for (year, d_loc), (_, d_pts), (_, n_gap) in zip(loc_years, pts_years, gap_years):
            new_loc = max(int(round(d_loc)), 0)
            years.append({
                "year": year,
                "nieuwe_punten": int(round(d_pts)),
                "nieuwe_locaties": new_loc,
                # A shrinking locatie count is not extra co-location.
                "co_locatie": max(int(round(d_pts)) - new_loc, 0),
                "witte_vlek": min(n_gap, new_loc),
                "verdichting": max(new_loc - n_gap, 0),
            })

        # Witte-vlek spots in order of reach.
        spots = []
        for pc in (suggestions.get(slug) or {}).get("pc4s", []):
            for s in pc.get("suggestions") or []:
                spots.append({**s, "pc4": pc["pc4"], "pc4_priority": pc["priority"]})
        spots.sort(key=lambda s: (not s.get("marginal", True), -(s.get("est_new_pop_within_400m") or 0)))

        assigned = []
        it = iter(spots)
        for y in years:
            for _ in range(y["witte_vlek"]):
                s = next(it, None)
                if s is None:
                    break
                assigned.append((y["year"], s))
            y["witte_vlek_zonder_plek"] = y["witte_vlek"] - sum(1 for yy, _ in assigned if yy == y["year"])

        public, private, classified = poi_index(slug)
        with ThreadPoolExecutor(args.workers) as pool:
            terrains = list(pool.map(lambda a: terrain_for(a[1], public, private, cache), assigned))

        picks = []
        for rank, ((year, s), (priv, publ, terrein, bron)) in enumerate(zip(assigned, terrains), 1):
            chosen = priv or publ or {"lat": s["lat"], "lon": s["lon"]}
            picks.append({
                "rank": rank,
                "year": year,
                "pc4": s["pc4"],
                "lat": chosen["lat"],
                "lon": chosen["lon"],
                "terrein": terrein,
                "terrein_bron": bron,
                "privaat": priv,
                "publiek": publ,
                "privaat_niet_invulbaar": priv is None,
                "est_new_pop_within_400m": s.get("est_new_pop_within_400m"),
                "marginal": s.get("marginal", True),
                "adres": (s.get("adres") or {}).get("weergavenaam"),
                "witte_vlek_lat": s.get("pre_snap_lat") or s["lat"],
                "witte_vlek_lon": s.get("pre_snap_lon") or s["lon"],
            })

        # Verdichting per PC4: weighted by underservice inside covered PC4s.
        weights = []
        for pc4, v in pc4_by_slug.get(slug, []):
            cov = (((coverage.get(pc4) or {}).get("total") or {}).get("400m") or {}).get("pct", 0)
            if (v.get("population") or 0) < 50:
                continue
            under = max((v.get("predicted_points") or 0) - ((v.get("parcel_points") or {}).get("total") or 0), 0)
            w = under + 0.1 * (v.get("population") or 0) / 1000
            weights.append((pc4, w, cov))
        # Verdichting happens where the network already reaches most inhabitants.
        covered = [row for row in weights if row[2] >= 50]
        weights = covered or weights
        total_w = sum(w for _, w, _ in weights) or 1
        densification = []
        for y in years:
            n = y["verdichting"]
            if n <= 0:
                continue
            raw = [(pc4, n * w / total_w) for pc4, w, _ in weights]
            base = {pc4: int(v) for pc4, v in raw}
            rest = n - sum(base.values())
            for pc4, v in sorted(raw, key=lambda kv: -(kv[1] - int(kv[1])))[:rest]:
                base[pc4] += 1
            densification.extend({"year": y["year"], "pc4": pc4, "count": c} for pc4, c in base.items() if c > 0)

        per_terrein = {PRIVAAT: 0, PUBLIEK: 0, ONBEKEND: 0}
        for p in picks:
            per_terrein[p["terrein"]] += 1
        n_picks = len(picks)
        need_public = sum(1 for p in picks if p["privaat_niet_invulbaar"])
        payload = {
            "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "slug": slug,
            "naam": forecast["naam"],
            "scenario": SCENARIO,
            "stedelijkheid": cls,
            "aandeel_witte_vlek_pct": round(100 * p_gap, 1),
            "poi_terrein_beschikbaar": classified,
            "punten_nu": pts_now,
            "locaties_nu": loc_now,
            "years": years,
            "picks": picks,
            "densification": densification,
            "summary": {
                "per_terrein": per_terrein,
                "plekken": n_picks,
                "privaat_niet_invulbaar": need_public,
                "aandeel_publiek_nodig_pct": round(100 * need_public / n_picks, 1) if n_picks else None,
                "witte_vlek_zonder_plek": sum(y["witte_vlek_zonder_plek"] for y in years),
            },
        }
        write(OUT_DIR / f"{slug}.json", payload)
        summary_rows.append({
            "slug": slug,
            "naam": forecast["naam"],
            "nieuwe_locaties": sum(y["nieuwe_locaties"] for y in years),
            "co_locatie": sum(y["co_locatie"] for y in years),
            "witte_vlek": sum(y["witte_vlek"] for y in years),
            "verdichting": sum(y["verdichting"] for y in years),
            **payload["summary"],
        })
        if n_done % 25 == 0 or n_done == len(slugs):
            print(f"  [{n_done}/{len(slugs)}] {slug}: {n_picks} plekken, {need_public} alleen publiek", flush=True)
            cache.save()

    cache.save()
    tot_picks = sum(r["plekken"] for r in summary_rows)
    tot_public = sum(r["privaat_niet_invulbaar"] for r in summary_rows)
    write(OUT_DIR / "index.json", {
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "scenario": SCENARIO,
        "landing": landing,
        "national": {
            "nieuwe_locaties": sum(r["nieuwe_locaties"] for r in summary_rows),
            "co_locatie": sum(r["co_locatie"] for r in summary_rows),
            "witte_vlek": sum(r["witte_vlek"] for r in summary_rows),
            "verdichting": sum(r["verdichting"] for r in summary_rows),
            "plekken": tot_picks,
            "privaat_niet_invulbaar": tot_public,
            "aandeel_publiek_nodig_pct": round(100 * tot_public / tot_picks, 1) if tot_picks else None,
            "witte_vlek_zonder_plek": sum(r["witte_vlek_zonder_plek"] for r in summary_rows),
        },
        "gemeenten": summary_rows,
    })
    print(f"Wrote {len(summary_rows)} gemeenten; {tot_picks} witte-vlek plekken, {tot_public} alleen op publieke grond")


if __name__ == "__main__":
    main()
