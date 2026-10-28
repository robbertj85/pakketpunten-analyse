#!/usr/bin/env python3
"""
Weekly parcel-point history split by carrier x category (locker/shop), with
both counts the forecast needs: punten (per carrier) and locaties (unique
physical locations, see scripts/point_categories.py).

totals_history.json only knows per-carrier totals. This file adds the category
split and the location dedupe, and stays out of webapp/public because the
forecast script is its only reader.

Usage:
    python scripts/point_history.py --backfill   # rebuild from git, one commit per ISO week
    python scripts/point_history.py              # add/replace the current week from the working tree

Outputs:
    data/point_history.json    column-oriented weekly counts (national + per gemeente)
    data/point_lifetimes.json  first/last week each carrier point was seen, for
                               finding where new points actually appeared
"""

import argparse
import json
import os
import subprocess
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

from point_categories import CATEGORIES, location_counts, pakketpunten

ROOT = Path(__file__).resolve().parent.parent
GEOJSON_DIR = ROOT / "webapp" / "public" / "data"
HISTORY_PATH = ROOT / "data" / "point_history.json"
LIFETIMES_PATH = ROOT / "data" / "point_lifetimes.json"

# Same start as backfill_totals_history.py: earlier weeks predate API fixes.
MIN_WEEK = "2025-W47"
NOT_A_GEMEENTE = {"nederland", "nederland-boundaries", "pc4", "municipality_boundaries"}


def week_label(date: datetime) -> str:
    year, week, _ = date.isocalendar()
    return f"{year}-W{week:02d}"


def snapshot(files):
    """
    Count one week. files: iterable of (slug, geojson dict).

    A carrier point present in two gemeente files counts once nationally and is
    kept in the first gemeente it was seen in, so gemeenten sum to the national
    total.
    """
    seen = {}
    by_gemeente = defaultdict(dict)
    for slug, data in files:
        for key, carrier, category, lat, lon, address in pakketpunten(data):
            if key in seen:
                continue
            seen[key] = (slug, carrier, category, lat, lon, address)
            by_gemeente[slug][key] = seen[key]

    def summarise(points):
        punten = defaultdict(lambda: {c: 0 for c in CATEGORIES})
        for _, carrier, category, *_ in points:
            punten[carrier][category] += 1
        locaties, multi = location_counts([(p[1], p[3], p[4], p[5]) for p in points])
        return {"punten": dict(punten), "locaties": locaties, "locaties_multi": multi}

    result = {
        "national": summarise(list(seen.values())),
        "municipalities": {slug: summarise(list(pts.values())) for slug, pts in by_gemeente.items()},
    }
    return result, {k: (v[0], v[1], v[2]) for k, v in seen.items()}


# --- git access ---------------------------------------------------------------


def git(*args) -> str:
    return subprocess.run(["git", *args], cwd=ROOT, capture_output=True, text=True, check=True).stdout


def weekly_commits():
    """Latest robot data commit per ISO week, oldest first."""
    out = git("log", "--format=%H %cI %s", "--", "webapp/public/data/*.geojson")
    commits, seen = [], set()
    for line in out.splitlines():
        parts = line.split(" ", 2)
        if len(parts) < 3 or "Update pakketpunten data" not in parts[2]:
            continue
        date = datetime.fromisoformat(parts[1])
        label = week_label(date)
        if label < MIN_WEEK or label in seen:
            continue
        seen.add(label)
        commits.append({"hash": parts[0], "date": date.strftime("%Y-%m-%d"), "week": label})
    return list(reversed(commits))


class BlobReader:
    """One long-lived `git cat-file --batch`, far faster than a git show per file."""

    def __init__(self):
        self.proc = subprocess.Popen(
            ["git", "cat-file", "--batch"], cwd=ROOT, stdin=subprocess.PIPE, stdout=subprocess.PIPE
        )

    def read(self, rev_path: str):
        self.proc.stdin.write(rev_path.encode() + b"\n")
        self.proc.stdin.flush()
        header = self.proc.stdout.readline().split()
        if len(header) < 3 or header[1] == b"missing":
            return None
        size = int(header[2])
        body = self.proc.stdout.read(size)
        self.proc.stdout.read(1)  # trailing newline
        return body

    def close(self):
        self.proc.stdin.close()
        self.proc.wait()


def commit_files(reader: BlobReader, commit: str):
    names = git("ls-tree", "--name-only", commit, "webapp/public/data/").splitlines()
    for name in sorted(names):
        if not name.endswith(".geojson"):
            continue
        slug = Path(name).stem
        if slug in NOT_A_GEMEENTE:
            continue
        body = reader.read(f"{commit}:{name}")
        if body is None:
            continue
        try:
            yield slug, json.loads(body)
        except json.JSONDecodeError:
            print(f"  skip unreadable {slug} @ {commit[:8]}")


def working_tree_files():
    for path in sorted(GEOJSON_DIR.glob("*.geojson")):
        if path.stem in NOT_A_GEMEENTE:
            continue
        with open(path, encoding="utf-8") as handle:
            yield path.stem, json.load(handle)


# --- column-oriented storage ----------------------------------------------------


def empty_history():
    return {"weeks": [], "dates": [], "national": {}, "municipalities": {}}


def _series_put(series: dict, snap: dict, idx: int, n_weeks: int):
    """Write one week's summary into column arrays, padding new keys with 0."""

    def column(container, key):
        arr = container.setdefault(key, [])
        arr.extend([0] * (n_weeks - len(arr)))
        return arr

    column(series, "locaties")[idx] = snap["locaties"]
    column(series, "locaties_multi")[idx] = snap["locaties_multi"]
    punten = series.setdefault("punten", {})
    for carrier, cats in snap["punten"].items():
        per_cat = punten.setdefault(carrier, {})
        for cat in CATEGORIES:
            column(per_cat, cat)[idx] = cats.get(cat, 0)


def _pad_all(series: dict, n_weeks: int):
    for key in ("locaties", "locaties_multi"):
        arr = series.setdefault(key, [])
        arr.extend([0] * (n_weeks - len(arr)))
    for per_cat in series.get("punten", {}).values():
        for cat in CATEGORIES:
            arr = per_cat.setdefault(cat, [])
            arr.extend([0] * (n_weeks - len(arr)))


def put_week(history: dict, week: str, date: str, snap: dict):
    if week in history["weeks"]:
        idx = history["weeks"].index(week)
        history["dates"][idx] = date
    else:
        history["weeks"].append(week)
        history["dates"].append(date)
        idx = len(history["weeks"]) - 1
    n = len(history["weeks"])

    # Zero the week first so a carrier that vanished from a gemeente reads 0.
    for series in [history["national"], *history["municipalities"].values()]:
        _pad_all(series, n)
        for key in ("locaties", "locaties_multi"):
            series[key][idx] = 0
        for per_cat in series.get("punten", {}).values():
            for cat in CATEGORIES:
                per_cat[cat][idx] = 0

    _series_put(history["national"], snap["national"], idx, n)
    for slug, gsnap in snap["municipalities"].items():
        _series_put(history["municipalities"].setdefault(slug, {}), gsnap, idx, n)
    for series in [history["national"], *history["municipalities"].values()]:
        _pad_all(series, n)


def put_lifetimes(lifetimes: dict, week: str, points: dict):
    weeks = lifetimes.setdefault("weeks", [])
    if week not in weeks:
        weeks.append(week)
    idx = weeks.index(week)
    table = lifetimes.setdefault("points", {})
    for key, (slug, carrier, category) in points.items():
        entry = table.get(key)
        if entry is None:
            table[key] = [idx, idx, category, slug]
        else:
            entry[0] = min(entry[0], idx)
            entry[1] = max(entry[1], idx)
            entry[2], entry[3] = category, slug


def save(path: Path, data: dict):
    data["updated_at"] = datetime.now(timezone.utc).isoformat(timespec="seconds")
    tmp = path.with_suffix(".json.tmp")
    with open(tmp, "w", encoding="utf-8") as handle:
        json.dump(data, handle, separators=(",", ":"))
    os.replace(tmp, path)


def load(path: Path, default):
    if path.exists():
        with open(path, encoding="utf-8") as handle:
            return json.load(handle)
    return default


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--backfill", action="store_true", help="rebuild all weeks from git history")
    args = parser.parse_args()

    if args.backfill:
        history, lifetimes = empty_history(), {}
        commits = weekly_commits()
        print(f"Backfilling {len(commits)} weeks from git...")
        reader = BlobReader()
        try:
            for i, c in enumerate(commits, 1):
                snap, points = snapshot(commit_files(reader, c["hash"]))
                put_week(history, c["week"], c["date"], snap)
                put_lifetimes(lifetimes, c["week"], points)
                nat = snap["national"]
                total = sum(sum(v.values()) for v in nat["punten"].values())
                print(f"  [{i:2d}/{len(commits)}] {c['week']} {c['hash'][:8]}  punten={total:,}  locaties={nat['locaties']:,}")
        finally:
            reader.close()
    else:
        history = load(HISTORY_PATH, empty_history())
        lifetimes = load(LIFETIMES_PATH, {})
        now = datetime.now(timezone.utc)
        snap, points = snapshot(working_tree_files())
        put_week(history, week_label(now), now.strftime("%Y-%m-%d"), snap)
        put_lifetimes(lifetimes, week_label(now), points)
        nat = snap["national"]
        total = sum(sum(v.values()) for v in nat["punten"].values())
        print(f"{week_label(now)}: punten={total:,} locaties={nat['locaties']:,} multi={nat['locaties_multi']:,}")

    save(HISTORY_PATH, history)
    save(LIFETIMES_PATH, lifetimes)
    print(f"Wrote {HISTORY_PATH.relative_to(ROOT)} ({len(history['weeks'])} weeks) and {LIFETIMES_PATH.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
