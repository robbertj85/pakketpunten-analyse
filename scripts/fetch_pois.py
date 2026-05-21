"""Fetch public POI categories from OpenStreetMap (Overpass API), nationwide.

Outputs one GeoJSON per category under webapp/public/data/poi/<slug>.geojson
plus an index.json describing all layers. Used by:
  - the new /data-export/pois page
  - the main-map POI layer toggles
  - scripts/build_poi_pc4_counts.py (per-PC4 aggregations)

Categories are deliberately limited to nationwide-consistent OSM tags. Where
the OSM tagging is coarse (e.g. fietsenstallingen), we filter to the subset
that is most relevant for an OOH/locker-placement analysis (covered stalling
only, multi-storey/underground parking only, etc.).
"""
from __future__ import annotations

import json
import sys
import time
from pathlib import Path
from typing import Iterable

import requests

ROOT = Path(__file__).parent.parent
OUT_DIR = ROOT / "webapp" / "public" / "data" / "poi"
OUT_DIR.mkdir(parents=True, exist_ok=True)

# Nationwide bbox (south, west, north, east) — covers the entire Netherlands
# including Wadden + Zeeland. Avoids hitting Belgian/German nodes since the
# Overpass `[area:3600047796]` filter would also work but is slower.
NL_BBOX = (50.65, 3.20, 53.75, 7.25)

OVERPASS_URL = "https://overpass-api.de/api/interpreter"
HEADERS = {"User-Agent": "pakketpunten-analyse/1.0 (POI fetch)"}

# Each entry: slug → (label, color, overpass query body).
# Use `out center;` so ways/relations come back with a single representative
# point we can render without further geometry processing.
CATEGORIES: list[dict] = [
    # ── OV ────────────────────────────────────────────────────────────────
    {
        "slug": "ns_station",
        "label": "NS-stations",
        "group": "ov",
        "color": "#FFC900",
        "icon": "train",
        "query": """
          node[railway=station][station!=subway][station!=light_rail]({bbox});
          way[railway=station][station!=subway][station!=light_rail]({bbox});
          relation[railway=station][station!=subway][station!=light_rail]({bbox});
        """,
    },
    {
        "slug": "metro_station",
        "label": "Metrostations",
        "group": "ov",
        "color": "#E2231A",
        "icon": "metro",
        "query": """
          node[station=subway]({bbox});
          way[station=subway]({bbox});
          relation[station=subway]({bbox});
          node[railway=station][station=subway]({bbox});
        """,
    },
    {
        "slug": "tram_halte",
        "label": "Tramhaltes",
        "group": "ov",
        "color": "#0073B7",
        "icon": "tram",
        "query": """
          node[railway=tram_stop]({bbox});
          node[public_transport=stop_position][tram=yes]({bbox});
        """,
    },
    {
        "slug": "bus_halte",
        "label": "Bushaltes",
        "group": "ov",
        "color": "#1F8A4C",
        "icon": "bus",
        "query": """
          node[highway=bus_stop]({bbox});
        """,
    },
    {
        "slug": "ov_knooppunt",
        "label": "OV-knooppunten",
        "group": "ov",
        "color": "#6B46C1",
        "icon": "transit",
        "query": """
          node[public_transport=station]({bbox});
          way[public_transport=station]({bbox});
          relation[public_transport=station]({bbox});
        """,
    },
    # ── Publieke gebouwen ─────────────────────────────────────────────────
    {
        "slug": "gemeentehuis",
        "label": "Gemeentehuizen",
        "group": "publiek",
        "color": "#B45309",
        "icon": "townhall",
        "query": """
          node[amenity=townhall]({bbox});
          way[amenity=townhall]({bbox});
          relation[amenity=townhall]({bbox});
        """,
    },
    {
        "slug": "stadsdeelkantoor",
        "label": "Stadsdeelkantoren",
        "group": "publiek",
        "color": "#92400E",
        "icon": "district",
        "query": """
          node[office=government]["government"~"district|borough"]({bbox});
          way[office=government]["government"~"district|borough"]({bbox});
          relation[office=government]["government"~"district|borough"]({bbox});
          node[amenity=townhall]["townhall:type"="district"]({bbox});
          way[amenity=townhall]["townhall:type"="district"]({bbox});
        """,
    },
    {
        "slug": "inzamelpunt",
        "label": "Inzamelpunten",
        "group": "publiek",
        "color": "#0F766E",
        "icon": "recycling",
        "query": """
          node[amenity=recycling][recycling_type=centre]({bbox});
          way[amenity=recycling][recycling_type=centre]({bbox});
        """,
    },
    {
        "slug": "bibliotheek",
        "label": "Bibliotheken",
        "group": "publiek",
        "color": "#4338CA",
        "icon": "library",
        "query": """
          node[amenity=library]({bbox});
          way[amenity=library]({bbox});
          relation[amenity=library]({bbox});
        """,
    },
    {
        "slug": "ziekenhuis",
        "label": "Ziekenhuizen",
        "group": "publiek",
        "color": "#DC2626",
        "icon": "hospital",
        "query": """
          node[amenity=hospital]({bbox});
          way[amenity=hospital]({bbox});
          relation[amenity=hospital]({bbox});
        """,
    },
    {
        "slug": "transformatorhuisje",
        "label": "Transformatorhuisjes",
        "group": "publiek",
        "color": "#52525B",
        "icon": "power",
        "query": """
          node[power=transformer]({bbox});
          way[power=transformer]({bbox});
          node[building=transformer_tower]({bbox});
          way[building=transformer_tower]({bbox});
          node[power=substation][substation~"minor_distribution|distribution"]({bbox});
          way[power=substation][substation~"minor_distribution|distribution"]({bbox});
        """,
    },
    # ── Onderwijs ─────────────────────────────────────────────────────────
    {
        "slug": "universiteit",
        "label": "Universiteiten",
        "group": "onderwijs",
        "color": "#7C3AED",
        "icon": "university",
        "query": """
          node[amenity=university]({bbox});
          way[amenity=university]({bbox});
          relation[amenity=university]({bbox});
        """,
    },
    {
        "slug": "hogeschool",
        "label": "Hogescholen",
        "group": "onderwijs",
        "color": "#A855F7",
        "icon": "college",
        "query": """
          node[amenity=college]({bbox});
          way[amenity=college]({bbox});
          relation[amenity=college]({bbox});
        """,
    },
    {
        "slug": "middelbare_school",
        "label": "Middelbare scholen",
        "group": "onderwijs",
        "color": "#C026D3",
        "icon": "school",
        "query": """
          node[amenity=school]["isced:level"~"2|3"]({bbox});
          way[amenity=school]["isced:level"~"2|3"]({bbox});
          relation[amenity=school]["isced:level"~"2|3"]({bbox});
        """,
    },
    # ── Voorzieningen ─────────────────────────────────────────────────────
    {
        "slug": "sportveld",
        "label": "Sportcomplexen",
        "group": "voorzieningen",
        "color": "#16A34A",
        "icon": "sport",
        "query": """
          way[leisure=sports_centre]({bbox});
          relation[leisure=sports_centre]({bbox});
          way[leisure=stadium]({bbox});
          relation[leisure=stadium]({bbox});
        """,
    },
    {
        "slug": "winkelcentrum",
        "label": "Winkelcentra",
        "group": "voorzieningen",
        "color": "#EA580C",
        "icon": "mall",
        "query": """
          node[shop=mall]({bbox});
          way[shop=mall]({bbox});
          relation[shop=mall]({bbox});
        """,
    },
    {
        "slug": "fietsenstalling",
        "label": "Fietsenstallingen (overdekt)",
        "group": "voorzieningen",
        "color": "#0891B2",
        "icon": "bike",
        "query": """
          node[amenity=bicycle_parking][bicycle_parking~"shed|lockers|building|underground|covered"]({bbox});
          way[amenity=bicycle_parking][bicycle_parking~"shed|lockers|building|underground|covered"]({bbox});
          node[amenity=bicycle_parking][covered=yes]({bbox});
          way[amenity=bicycle_parking][covered=yes]({bbox});
        """,
    },
    {
        "slug": "parkeergarage",
        "label": "Parkeergarages",
        "group": "voorzieningen",
        "color": "#475569",
        "icon": "garage",
        "query": """
          node[amenity=parking][parking~"multi-storey|underground"]({bbox});
          way[amenity=parking][parking~"multi-storey|underground"]({bbox});
          relation[amenity=parking][parking~"multi-storey|underground"]({bbox});
        """,
    },
    {
        "slug": "p_and_r",
        "label": "P+R-locaties",
        "group": "voorzieningen",
        "color": "#0EA5E9",
        "icon": "pr",
        "query": """
          node[amenity=parking][park_ride~"yes|designated"]({bbox});
          way[amenity=parking][park_ride~"yes|designated"]({bbox});
          relation[amenity=parking][park_ride~"yes|designated"]({bbox});
        """,
    },
]


def _build_query(body: str) -> str:
    bbox_str = ",".join(str(v) for v in NL_BBOX)
    body = body.format(bbox=bbox_str).strip()
    return f"[out:json][timeout:180];({body});out center tags;"


def _fetch(query: str, attempt: int = 0) -> dict:
    try:
        r = requests.post(
            OVERPASS_URL,
            data={"data": query},
            headers=HEADERS,
            timeout=240,
        )
        r.raise_for_status()
        return r.json()
    except requests.HTTPError as e:
        # 429/504 → back off and retry once
        if attempt < 2 and e.response.status_code in (429, 502, 503, 504):
            wait = 30 * (attempt + 1)
            print(f"    rate-limited / gateway timeout — waiting {wait}s and retrying")
            time.sleep(wait)
            return _fetch(query, attempt + 1)
        raise


def _to_features(elements: Iterable[dict], cat: dict) -> list[dict]:
    feats = []
    for el in elements:
        if el["type"] == "node":
            lon, lat = el.get("lon"), el.get("lat")
        else:
            c = el.get("center") or {}
            lon, lat = c.get("lon"), c.get("lat")
        if lon is None or lat is None:
            continue
        tags = el.get("tags", {})
        feats.append({
            "type": "Feature",
            "geometry": {"type": "Point", "coordinates": [round(lon, 6), round(lat, 6)]},
            "properties": {
                "osm_id": f"{el['type']}/{el['id']}",
                "category": cat["slug"],
                "name": tags.get("name") or tags.get("ref") or "",
                "operator": tags.get("operator", ""),
            },
        })
    return feats


def main() -> int:
    only = set(sys.argv[1:]) or None
    index: list[dict] = []
    for cat in CATEGORIES:
        if only and cat["slug"] not in only:
            continue
        print(f"→ {cat['slug']} ({cat['label']})…", flush=True)
        q = _build_query(cat["query"])
        try:
            data = _fetch(q)
        except Exception as e:
            print(f"    ERROR: {e}")
            continue
        feats = _to_features(data.get("elements", []), cat)
        payload = {
            "type": "FeatureCollection",
            "metadata": {
                "slug": cat["slug"],
                "label": cat["label"],
                "group": cat["group"],
                "color": cat["color"],
                "icon": cat["icon"],
                "source": "OpenStreetMap (Overpass API)",
                "count": len(feats),
            },
            "features": feats,
        }
        out_path = OUT_DIR / f"{cat['slug']}.geojson"
        with open(out_path, "w") as f:
            json.dump(payload, f, separators=(",", ":"), ensure_ascii=False)
        print(f"    {len(feats):>6} features  →  {out_path.relative_to(ROOT)}")
        index.append({
            "slug": cat["slug"],
            "label": cat["label"],
            "group": cat["group"],
            "color": cat["color"],
            "icon": cat["icon"],
            "count": len(feats),
            "file": f"poi/{cat['slug']}.geojson",
        })
        # Be polite to Overpass between categories
        time.sleep(2)

    # Update index — preserve entries for categories we skipped this run.
    index_path = OUT_DIR / "index.json"
    if index_path.exists() and only:
        prior = json.load(open(index_path)).get("categories", [])
        by_slug = {c["slug"]: c for c in prior}
        for c in index:
            by_slug[c["slug"]] = c
        index = [by_slug[c["slug"]] for c in CATEGORIES if c["slug"] in by_slug]

    with open(index_path, "w") as f:
        json.dump({"categories": index}, f, indent=2, ensure_ascii=False)
    print(f"\n✓ Wrote index with {len(index)} categories → {index_path.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
