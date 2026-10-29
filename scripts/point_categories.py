"""
Shared parcel-point helpers: the locker/shop split and physical-location dedupe.

LOCKER_TYPES must mirror webapp/types/pakketpunten.ts. Other scripts still keep
their own copy; new code imports it from here.

Two counts are used throughout the forecast:

- punten: one per carrier per point. Only the technical double count is removed
  (the same carrier point appearing twice, typically in two gemeente files where
  their boundaries overlap).
- locaties: unique physical locations. Points of any carrier that sit at the same
  spot merge into one location, so a shop that serves DHL, PostNL and VintedGo is
  three punten but one locatie. A rising punten/locaties ratio means the network
  is becoming more shared (white-label), which gemeenten actively want.
"""

import math
import re
from collections import defaultdict

LOCKER_TYPES = {
    "packStation",  # DHL
    "automaat",  # PostNL, InPost, Budbee
    "dpd_box",  # DPD
    "locker",  # Amazon, VintedGo
    "Buitenkluis",  # DeBuren
}

CATEGORIES = ("locker", "shop")

# Two points are one location when they are this close...
SAME_SPOT_M = 15.0
# ...or within this distance and share a normalised street address.
SAME_ADDRESS_M = 40.0

# Metres per degree around 52.2 N. Accurate to well under a metre at these
# distances anywhere in the Netherlands, and avoids a pyproj round trip.
_M_PER_DEG_LAT = 111_250.0
_M_PER_DEG_LON = 111_320.0 * math.cos(math.radians(52.2))


def point_category(punt_type: str) -> str:
    return "locker" if punt_type in LOCKER_TYPES else "shop"


def point_key(carrier: str, lat: float, lon: float) -> str:
    """Identity of one carrier point; ~1 m precision absorbs float noise."""
    return f"{carrier}|{lat:.5f}|{lon:.5f}"


def _address(props: dict) -> str:
    raw = f"{props.get('straatNaam') or ''} {props.get('straatNr') or ''}"
    return re.sub(r"[^a-z0-9]", "", raw.lower())


def pakketpunten(geojson: dict, exclude=frozenset()):
    """
    Yield (key, carrier, category, lat, lon, address) for each feature.

    Applies today's ingestion scope to older snapshots too, so a history built
    from them measures one definition throughout: Budbee boxes listed in the DPD
    feed are Budbee's (api_client.get_data_dpd skips them), and keys in exclude
    are dropped (statiegeld-only ViaTim points, see point_history.py).
    """
    for feature in geojson.get("features", []):
        props = feature.get("properties") or {}
        if props.get("type") != "pakketpunt":
            continue
        if props.get("vervoerder") == "DPD" and "budbee" in (props.get("locatieNaam") or "").lower():
            continue
        lat, lon = props.get("latitude"), props.get("longitude")
        if lat is None or lon is None:
            coords = (feature.get("geometry") or {}).get("coordinates") or []
            if len(coords) < 2:
                continue
            lon, lat = coords[0], coords[1]
        carrier = props.get("vervoerder") or "Unknown"
        key = point_key(carrier, lat, lon)
        if key in exclude:
            continue
        yield (
            key,
            carrier,
            point_category(props.get("puntType") or ""),
            float(lat),
            float(lon),
            _address(props),
        )


def cluster_locations(points):
    """
    Group points into physical locations.

    points: list of (carrier, lat, lon, address). Returns a list with one
    location id per point. Uses a grid hash plus union-find, so a national
    snapshot (~22k points) clusters in well under a second.
    """
    n = len(points)
    parent = list(range(n))

    def find(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    def union(i, j):
        ri, rj = find(i), find(j)
        if ri != rj:
            parent[rj] = ri

    xy = [(p[2] * _M_PER_DEG_LON, p[1] * _M_PER_DEG_LAT) for p in points]
    cell = SAME_ADDRESS_M
    grid = defaultdict(list)
    for i, (x, y) in enumerate(xy):
        grid[(int(x // cell), int(y // cell))].append(i)

    for (cx, cy), members in grid.items():
        neighbours = []
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                neighbours.extend(grid.get((cx + dx, cy + dy), ()))
        for i in members:
            xi, yi = xy[i]
            for j in neighbours:
                if j <= i:
                    continue
                d = math.hypot(xi - xy[j][0], yi - xy[j][1])
                if d <= SAME_SPOT_M or (
                    d <= SAME_ADDRESS_M and points[i][3] and points[i][3] == points[j][3]
                ):
                    union(i, j)

    return [find(i) for i in range(n)]


def location_counts(points):
    """(locaties, locaties met >= 2 vervoerders) for a list of (carrier, lat, lon, address)."""
    if not points:
        return 0, 0
    ids = cluster_locations(points)
    carriers = defaultdict(set)
    for loc, p in zip(ids, points):
        carriers[loc].add(p[0])
    multi = sum(1 for c in carriers.values() if len(c) >= 2)
    return len(carriers), multi
