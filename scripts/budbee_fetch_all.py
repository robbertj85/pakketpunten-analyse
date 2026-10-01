"""
Fetch all Budbee box/locker locations in the Netherlands.

Budbee (now Instabee) operates parcel lockers primarily in Albert Heijn
and H&M stores. Their official API requires merchant credentials, so we
combine two freely available sources:

1. DPD cache: The existing dpd_all_locations.json contains ~195 Budbee
   lockers (identifiable by "Budbee" in the company name)
2. OpenStreetMap: Overpass API query for brand=Budbee nodes in NL

These are deduplicated by proximity (50m threshold) to produce a
combined dataset.

Usage:
    python scripts/budbee_fetch_all.py
"""

import json
import math
import sys
from pathlib import Path
from datetime import datetime
from typing import Dict, List, Tuple
from collections import defaultdict

sys.path.insert(0, str(Path(__file__).parent.parent))

from utils import overpass_post  # noqa: E402


def haversine_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Calculate distance in meters between two lat/lon points."""
    R = 6371000  # Earth radius in meters
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlam = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlam / 2) ** 2
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def fetch_from_dpd_cache() -> List[Dict]:
    """
    Extract Budbee locations from existing DPD cache.

    Returns
    -------
    list of dict
        Budbee locations found in DPD data
    """
    cache_file = Path(__file__).parent.parent / "data" / "dpd_all_locations.json"

    if not cache_file.exists():
        print("   ⚠️  DPD cache not found at data/dpd_all_locations.json")
        return []

    with open(cache_file, 'r', encoding='utf-8') as f:
        dpd_data = json.load(f)

    locations = dpd_data.get('locations', [])
    budbee_locs = []

    for loc in locations:
        company = (loc.get('company', '') or '').lower()
        if 'budbee' not in company:
            continue

        budbee_locs.append({
            'locatieNaam': loc.get('company', ''),
            'straatNaam': loc.get('street', ''),
            'straatNr': loc.get('house_number', ''),
            'postcode': loc.get('postcode', ''),
            'city': loc.get('city', ''),
            'latitude': loc.get('latitude'),
            'longitude': loc.get('longitude'),
            'puntType': 'automaat',
            'source': 'dpd_cache',
        })

    return budbee_locs


def fetch_from_osm() -> List[Dict]:
    """
    Fetch Budbee locations from OpenStreetMap via Overpass API.

    Returns
    -------
    list of dict
        Budbee locations from OSM
    """
    overpass_query = """
    [out:json][timeout:60];
    area["ISO3166-1"="NL"]->.nl;
    (
      node["brand"="Budbee"](area.nl);
      node["operator"~"Budbee",i](area.nl);
      node["name"~"Budbee",i](area.nl);
    );
    out body;
    """

    # overpass_post carries the User-Agent and the 429 backoff. Without the
    # header overpass-api.de answers 406 and this source returns nothing,
    # which is how Budbee ran on DPD data alone for weeks.
    try:
        data = overpass_post(overpass_query)
    except ValueError as e:
        print(f"   ❌ {e}")
        return []

    elements = data.get('elements', [])
    locations = []

    for el in elements:
        if el.get('type') != 'node':
            continue

        tags = el.get('tags', {})
        lat = el.get('lat')
        lon = el.get('lon')

        if not lat or not lon:
            continue

        # Build name from available tags
        name = tags.get('name', '') or tags.get('brand', 'Budbee')
        street = tags.get('addr:street', '')
        housenumber = tags.get('addr:housenumber', '')
        postcode = tags.get('addr:postcode', '')
        city = tags.get('addr:city', '')

        locations.append({
            'locatieNaam': name,
            'straatNaam': street,
            'straatNr': housenumber,
            'postcode': postcode,
            'city': city,
            'latitude': lat,
            'longitude': lon,
            'puntType': 'automaat',
            'source': 'osm',
            'osm_id': el.get('id'),
        })

    return locations


def deduplicate(dpd_locs: List[Dict], osm_locs: List[Dict], threshold_m: float = 50) -> List[Dict]:
    """
    Merge DPD and OSM locations, removing OSM duplicates within threshold.

    DPD locations are preferred (more complete data). OSM locations are
    only added if they're more than threshold_m away from any DPD location.
    """
    combined = list(dpd_locs)  # Start with all DPD locations
    added_from_osm = 0
    skipped_duplicates = 0

    for osm_loc in osm_locs:
        osm_lat = osm_loc.get('latitude', 0)
        osm_lon = osm_loc.get('longitude', 0)

        is_duplicate = False
        for dpd_loc in dpd_locs:
            dpd_lat = dpd_loc.get('latitude', 0)
            dpd_lon = dpd_loc.get('longitude', 0)

            dist = haversine_m(osm_lat, osm_lon, dpd_lat, dpd_lon)
            if dist < threshold_m:
                is_duplicate = True
                break

        if is_duplicate:
            skipped_duplicates += 1
        else:
            combined.append(osm_loc)
            added_from_osm += 1

    print(f"   DPD locations:       {len(dpd_locs)}")
    print(f"   OSM locations:       {len(osm_locs)}")
    print(f"   OSM duplicates:      {skipped_duplicates} (within {threshold_m}m of DPD location)")
    print(f"   OSM unique added:    {added_from_osm}")
    print(f"   Combined total:      {len(combined)}")

    return combined


def fetch_all_budbee_locations() -> List[Dict]:
    """
    Fetch all Budbee locations from DPD cache + OSM, deduplicated.

    Returns
    -------
    list of dict
        Combined and deduplicated Budbee locations
    """
    print("=" * 80)
    print("BUDBEE COMPLETE LOCATION FETCH")
    print("=" * 80)
    print()

    # Source 1: DPD cache
    print("📦 Source 1: DPD cache (Budbee lockers in DPD dataset)...")
    dpd_locs = fetch_from_dpd_cache()
    print(f"   Found {len(dpd_locs)} Budbee locations in DPD cache")
    print()

    # Source 2: OpenStreetMap
    print("🌍 Source 2: OpenStreetMap (Overpass API)...")
    osm_locs = fetch_from_osm()
    print(f"   Found {len(osm_locs)} Budbee locations in OSM")
    print()

    # Deduplicate
    print("🔄 Deduplicating (50m threshold)...")
    combined = deduplicate(dpd_locs, osm_locs)
    print()

    print(f"✅ Total unique Budbee locations: {len(combined)}")

    return combined


def analyze_locations(locations: List[Dict]):
    """Print statistics about fetched locations."""
    print()
    print("=" * 80)
    print("ANALYSIS")
    print("=" * 80)
    print()

    # Count by source
    source_counts = defaultdict(int)
    for loc in locations:
        source_counts[loc.get('source', 'unknown')] += 1

    print("📦 By source:")
    for source, count in sorted(source_counts.items(), key=lambda x: -x[1]):
        print(f"   {source:20s}: {count:4d}")

    # Count by city (top 10)
    city_counts = defaultdict(int)
    for loc in locations:
        city = loc.get('city', 'Unknown') or 'Unknown'
        city_counts[city] += 1

    print()
    print("🏙️  Top 10 cities by location count:")
    for i, (city, count) in enumerate(sorted(city_counts.items(), key=lambda x: -x[1])[:10], 1):
        print(f"   {i:2d}. {city:25s}: {count:3d} locations")

    # Geographic coverage
    lats = [loc.get('latitude', 0) for loc in locations if loc.get('latitude')]
    lons = [loc.get('longitude', 0) for loc in locations if loc.get('longitude')]

    if lats and lons:
        print()
        print("🌍 Geographic coverage:")
        print(f"   Latitude:  {min(lats):.4f}° to {max(lats):.4f}°")
        print(f"   Longitude: {min(lons):.4f}° to {max(lons):.4f}°")


def save_results(locations: List[Dict]):
    """Save locations to JSON file."""
    print()
    print("=" * 80)
    print("SAVING RESULTS")
    print("=" * 80)
    print()

    from cache_guard import safe_save

    output_path = Path(__file__).parent.parent / "data" / "budbee_all_locations.json"

    safe_save(
        carrier="Budbee",
        new_locations=locations,
        output_path=output_path,
        metadata={
            "method": "dpd-cache-plus-osm",
            "sources": [
                "data/dpd_all_locations.json (Budbee entries)",
                "OpenStreetMap Overpass API (brand=Budbee)",
            ],
            "country": "Netherlands",
            "note": "For complete coverage (~1000+ locations), request API access at onboarding@budbee.com",
        },
    )


def main():
    print()
    print(f"Starting Budbee location fetch...")
    print(f"Time: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print()

    locations = fetch_all_budbee_locations()

    if not locations:
        print()
        print("❌ Failed to fetch locations")
        return 1

    analyze_locations(locations)
    save_results(locations)

    print()
    print("=" * 80)
    print("✅ COMPLETE!")
    print("=" * 80)
    print()
    print("Note: This dataset contains ~280 locations from DPD + OSM.")
    print("For full coverage (~1000+), contact onboarding@budbee.com for API access.")
    print()
    return 0


if __name__ == "__main__":
    sys.exit(main())
