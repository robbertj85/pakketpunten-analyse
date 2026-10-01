"""
GLS Parcel Shop Fetch - Nationwide grid-based approach using direct API calls.

Calls the GLS API (apm.gls.nl/glspoints/nearby) directly with POST requests,
searching from a grid of coordinates covering the Netherlands.

The geocode endpoint (GET /glspoints/geocode) is used to resolve postcodes
to coordinates, then the nearby endpoint returns parcel shops within a radius.
"""

import json
import time
import requests
from pathlib import Path
from datetime import datetime, timezone
from typing import Dict, Optional

# API configuration
GLS_API_BASE = "https://apm.gls.nl"
NEARBY_ENDPOINT = f"{GLS_API_BASE}/glspoints/nearby"
GEOCODE_ENDPOINT = f"{GLS_API_BASE}/glspoints/geocode"

HEADERS = {
    "Content-Type": "application/json",
    "Accept": "application/json",
    "Origin": "https://www.gls-info.nl",
    "Referer": "https://www.gls-info.nl/",
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
}

# Grid of coordinates covering the Netherlands with representative postcodes
# Using ~50km spacing to ensure good coverage with overlap
GRID_POSTCODES = [
    # North
    ("8911", "Leeuwarden"),
    ("9711", "Groningen"),
    ("1621", "Hoorn"),
    ("8232", "Lelystad"),
    ("9401", "Assen"),
    # Central
    ("1012", "Amsterdam"),
    ("3811", "Amersfoort"),
    ("8011", "Zwolle"),
    ("7511", "Enschede"),
    ("2511", "Den Haag"),
    ("3511", "Utrecht"),
    ("6811", "Arnhem"),
    ("7001", "Doetinchem"),
    # South
    ("4331", "Middelburg"),
    ("5038", "Tilburg"),
    ("5611", "Eindhoven"),
    ("5911", "Venlo"),
    ("4811", "Breda"),
    ("6041", "Roermond"),
    ("6211", "Maastricht"),
]

REQUEST_TIMEOUT = 30  # seconds per API call
MAX_RETRIES = 2


def extract_location(item: Dict) -> Optional[Dict]:
    """Extract standardized location data from a GLS API response item."""
    location_data = item.get('location', {})
    if not isinstance(location_data, dict):
        return None

    lat = location_data.get('latitude')
    lng = location_data.get('longitude')

    if lat is None or lng is None:
        return None

    try:
        lat = float(lat)
        lng = float(lng)
    except (ValueError, TypeError):
        return None

    if lat == 0 or lng == 0:
        return None

    # Extract name
    name1 = item.get('name1', '') or ''
    name2 = item.get('name2', '') or ''
    if name1 == 'Parcel Locker':
        name1 = 'Pakketautomaat'
    name = name1.strip()
    if name2 and name2.strip():
        name = f"{name} - {name2.strip()}" if name else name2.strip()

    # Address
    address_data = item.get('address', {}) or {}
    street = address_data.get('street', '') or ''
    house_no = str(address_data.get('houseNo', '') or '')
    house_addition = str(address_data.get('houseNoAddition', '') or '')
    street_nr = f"{house_no}{house_addition}".strip()
    postcode = address_data.get('zipCode', '') or ''
    city = address_data.get('city', '') or ''

    # Point type
    point_type = item.get('glsPointType', 0)
    punt_type = 'locker' if point_type == 4 else 'parcel_shop'

    loc_id = item.get('id', f"{lat}_{lng}")

    return {
        'id': str(loc_id),
        'locatieNaam': name,
        'straatNaam': street,
        'straatNr': street_nr,
        'postcode': postcode,
        'city': city,
        'latitude': lat,
        'longitude': lng,
        'vervoerder': 'GLS',
        'puntType': punt_type,
        'openingHours': item.get('openingHours') or [],
        'vacations': item.get('vacations') or [],
    }


def geocode_postcode(session: requests.Session, postcode: str) -> Optional[Dict]:
    """Resolve a postcode to coordinates using the GLS geocode API."""
    try:
        resp = session.get(
            GEOCODE_ENDPOINT,
            params={"location": postcode},
            headers=HEADERS,
            timeout=REQUEST_TIMEOUT,
        )
        if resp.status_code == 200:
            data = resp.json()
            if isinstance(data, dict) and 'latitude' in data and 'longitude' in data:
                return data
    except Exception as e:
        print(f"   Geocode error for {postcode}: {e}")
    return None


def search_nearby(session: requests.Session, lat: float, lng: float) -> list:
    """Search for GLS points near a coordinate. Returns list of raw items."""
    body = {
        "latitude": lat,
        "longitude": lng,
        "zipCode": "",
        "radius": 200,
        "pointTypes": 7,  # Depot(1) + ParcelShop(2) + ParcelLocker(4)
        "limit": 50,
        "minLockers": 0,
        "minParcelShops": 0,
        "minDepots": 0,
        "minBusinessPoints": 0,
        "pickupOnly": False,
        "centerPointLatitude": lat,
        "centerPointLongitude": lng,
        "domesticOnly": True,
    }

    for attempt in range(MAX_RETRIES + 1):
        try:
            resp = session.post(
                NEARBY_ENDPOINT,
                json=body,
                headers=HEADERS,
                timeout=REQUEST_TIMEOUT,
            )
            if resp.status_code == 200:
                data = resp.json()
                if isinstance(data, list):
                    return data
                return []
            elif resp.status_code == 504:
                print(f"   504 Gateway Timeout (attempt {attempt + 1}/{MAX_RETRIES + 1})")
                if attempt < MAX_RETRIES:
                    time.sleep(5)
                continue
            else:
                print(f"   HTTP {resp.status_code} (attempt {attempt + 1}/{MAX_RETRIES + 1})")
                if attempt < MAX_RETRIES:
                    time.sleep(3)
                continue
        except requests.Timeout:
            print(f"   Request timeout (attempt {attempt + 1}/{MAX_RETRIES + 1})")
            if attempt < MAX_RETRIES:
                time.sleep(5)
        except Exception as e:
            print(f"   Error: {e} (attempt {attempt + 1}/{MAX_RETRIES + 1})")
            if attempt < MAX_RETRIES:
                time.sleep(3)

    return []


def fetch_gls_grid() -> Dict[str, Dict]:
    """Fetch GLS locations using grid-based search with direct API calls."""
    print("=" * 80)
    print("GLS PARCEL SHOP LOCATION FETCH (Direct API)")
    print("=" * 80)
    print()
    print(f"Searching {len(GRID_POSTCODES)} grid points covering the Netherlands")
    print()

    all_locations: Dict[str, Dict] = {}
    errors = 0

    session = requests.Session()

    for idx, (postcode, city_name) in enumerate(GRID_POSTCODES, 1):
        print(f"[{idx}/{len(GRID_POSTCODES)}] {city_name} ({postcode})...")

        # Geocode the postcode to get coordinates
        coords = geocode_postcode(session, postcode)
        if not coords:
            print(f"   Failed to geocode {postcode}, skipping")
            errors += 1
            continue

        lat = coords['latitude']
        lng = coords['longitude']
        print(f"   Coordinates: {lat}, {lng}")

        # Search for nearby points
        items = search_nearby(session, lat, lng)

        if not items:
            print(f"   No results (API may be down)")
            errors += 1
        else:
            new_count = 0
            for item in items:
                loc = extract_location(item)
                if loc and loc['id'] not in all_locations:
                    all_locations[loc['id']] = loc
                    new_count += 1
            print(f"   Found {len(items)} points, {new_count} new (total: {len(all_locations)})")

        time.sleep(1)  # Be respectful between requests

    print()
    print(f"API errors/timeouts: {errors}/{len(GRID_POSTCODES)} grid points")

    return all_locations


def main():
    print()
    print(f"GLS Parcel Shop Location Fetch - Nationwide")
    print(f"Time: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print()

    all_locations = fetch_gls_grid()

    print()
    print("=" * 80)
    print("RESULTS SUMMARY")
    print("=" * 80)
    print(f"Total unique locations: {len(all_locations)}")

    # Count by type
    lockers = sum(1 for loc in all_locations.values() if loc['puntType'] == 'locker')
    shops = sum(1 for loc in all_locations.values() if loc['puntType'] == 'parcel_shop')
    print(f"  Lockers: {lockers}")
    print(f"  Parcel shops: {shops}")

    from cache_guard import safe_save

    cache_path = Path(__file__).parent.parent / "data" / "gls_all_locations.json"
    locations_list = list(all_locations.values())

    safe_save(
        carrier="GLS",
        new_locations=locations_list,
        output_path=cache_path,
        metadata={
            "method": "direct-api",
            "grid_points": len(GRID_POSTCODES),
        },
    )

    print()
    print("=" * 80)
    print("COMPLETE!")
    print("=" * 80)


if __name__ == "__main__":
    main()
