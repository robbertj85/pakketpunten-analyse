

import requests
import os
import pandas as pd, geopandas as gpd
from typing import Any, Dict, Iterable, Optional
import re, json, ast
from geopy.geocoders import Nominatim
from geopy.distance import geodesic
from pathlib import Path
from datetime import datetime


# ---------- loading data ----------

# In-memory cache for gemeente polygons (session-level)
_gemeente_polygon_cache = {}

# Persistent cache configuration
POLYGON_CACHE_FILE = Path(__file__).parent / "data" / "municipality_polygon_cache.json"

# Persistent cache data (loaded on first use)
_persistent_polygon_cache = None
_persistent_cache_modified = False


def _is_cache_refresh_week() -> bool:
    """
    Check if current date is in a cache refresh week.
    Cache refreshes in the last week of June and last week of December.
    This aligns with Dutch municipal reorganizations (typically Jan 1).
    """
    today = datetime.now()
    month = today.month
    day = today.day

    # Last week of June (days 24-30)
    if month == 6 and day >= 24:
        return True

    # Last week of December (days 25-31)
    if month == 12 and day >= 25:
        return True

    return False


def _load_persistent_cache() -> dict:
    """Load the persistent polygon cache from disk."""
    global _persistent_polygon_cache

    if _persistent_polygon_cache is not None:
        return _persistent_polygon_cache

    if POLYGON_CACHE_FILE.exists():
        try:
            with open(POLYGON_CACHE_FILE, 'r', encoding='utf-8') as f:
                _persistent_polygon_cache = json.load(f)
            print(f"  📦 Loaded polygon cache: {len(_persistent_polygon_cache)} municipalities")
        except (json.JSONDecodeError, IOError) as e:
            print(f"  ⚠️  Could not load polygon cache: {e}")
            _persistent_polygon_cache = {}
    else:
        _persistent_polygon_cache = {}

    return _persistent_polygon_cache


def _save_persistent_cache() -> None:
    """Save the persistent polygon cache to disk."""
    global _persistent_polygon_cache, _persistent_cache_modified

    if _persistent_polygon_cache is None or not _persistent_cache_modified:
        return

    try:
        POLYGON_CACHE_FILE.parent.mkdir(parents=True, exist_ok=True)
        with open(POLYGON_CACHE_FILE, 'w', encoding='utf-8') as f:
            json.dump(_persistent_polygon_cache, f, indent=2, ensure_ascii=False)
        _persistent_cache_modified = False
    except IOError as e:
        print(f"  ⚠️  Could not save polygon cache: {e}")


def check_polygon_cache_expiry() -> None:
    """
    Check if polygon cache should be refreshed.
    Cache is cleared in the last week of June and December to pick up
    any Dutch municipal boundary changes (which typically happen Jan 1).
    """
    global _persistent_cache_modified

    if not _is_cache_refresh_week():
        return

    cache = _load_persistent_cache()

    if not cache:
        return

    # Check if cache was already refreshed this period
    # by looking at the cached_at dates
    today = datetime.now()
    refresh_month = today.month  # 6 or 12
    refresh_year = today.year

    # Check if any entry was cached in the current refresh period
    for data in cache.values():
        cached_at = data.get('cached_at', '')
        if cached_at:
            try:
                cached_date = datetime.fromisoformat(cached_at)
                # If cached in same month/year during refresh week, already refreshed
                if cached_date.year == refresh_year and cached_date.month == refresh_month and cached_date.day >= 24:
                    print(f"  📦 Cache already refreshed this period (last update: {cached_at[:10]})")
                    return
            except ValueError:
                continue

    # Clear the cache for refresh
    print(f"  🔄 Cache refresh period (last week of {'June' if refresh_month == 6 else 'December'})")
    print(f"  🗑️  Clearing {len(cache)} cached polygons for refresh...")
    cache.clear()
    _persistent_cache_modified = True
    _save_persistent_cache()


def get_polygon_cache_stats() -> dict:
    """Get statistics about the polygon cache."""
    cache = _load_persistent_cache()

    if not cache:
        return {"total": 0, "next_refresh": _get_next_refresh_date()}

    # Find oldest and newest cache dates
    cached_dates = []
    for data in cache.values():
        cached_at = data.get('cached_at', '')
        if cached_at:
            try:
                cached_dates.append(datetime.fromisoformat(cached_at))
            except ValueError:
                continue

    return {
        "total": len(cache),
        "oldest_cached": min(cached_dates).strftime('%Y-%m-%d') if cached_dates else None,
        "newest_cached": max(cached_dates).strftime('%Y-%m-%d') if cached_dates else None,
        "next_refresh": _get_next_refresh_date(),
        "is_refresh_week": _is_cache_refresh_week(),
    }


def _get_next_refresh_date() -> str:
    """Get the next cache refresh date."""
    today = datetime.now()

    # Check if we're before or after June 24
    june_refresh = datetime(today.year, 6, 24)
    dec_refresh = datetime(today.year, 12, 25)

    if today < june_refresh:
        return june_refresh.strftime('%Y-%m-%d')
    elif today < dec_refresh:
        return dec_refresh.strftime('%Y-%m-%d')
    else:
        return datetime(today.year + 1, 6, 24).strftime('%Y-%m-%d')


def _get_cached_polygon(gemeente_naam: str, country_hint: str = "Nederland"):
    """
    Get a municipality polygon from persistent cache if available.
    Returns GeoDataFrame or None if not cached.
    """
    from shapely import wkt

    cache = _load_persistent_cache()
    cache_key = f"{gemeente_naam}:{country_hint}"

    if cache_key not in cache:
        return None

    entry = cache[cache_key]

    try:
        geom = wkt.loads(entry['geometry_wkt'])
        gdf = gpd.GeoDataFrame(
            {'gemeente': [gemeente_naam]},
            geometry=[geom],
            crs="EPSG:4326"
        )
        return gdf
    except Exception as e:
        print(f"  ⚠️  Could not load cached polygon for '{gemeente_naam}': {e}")
        return None


def _cache_polygon(gemeente_naam: str, gdf: gpd.GeoDataFrame, country_hint: str = "Nederland"):
    """Store a municipality polygon in the persistent cache."""
    global _persistent_cache_modified

    from shapely import wkt

    cache = _load_persistent_cache()
    cache_key = f"{gemeente_naam}:{country_hint}"

    # Convert geometry to WKT for storage
    geom = gdf.geometry.iloc[0]
    geometry_wkt = wkt.dumps(geom, rounding_precision=6)

    cache[cache_key] = {
        'geometry_wkt': geometry_wkt,
        'cached_at': datetime.now().isoformat(),
        'gemeente': gemeente_naam
    }

    _persistent_cache_modified = True
    _save_persistent_cache()

# Initialize Nominatim geolocator (with user agent)
_nominatim_geolocator = Nominatim(user_agent="pakketpunten_app")


def get_lat_lon(gemeente_naam: str) -> tuple:
    """
    Get latitude and longitude for a municipality using Nominatim geocoding.

    Args:
        gemeente_naam: Name of the municipality

    Returns:
        tuple: (latitude, longitude)

    Raises:
        ValueError: If geocoding fails
    """
    import time

    # Add Netherlands to improve geocoding accuracy
    query = f"{gemeente_naam}, Netherlands"

    try:
        location = _nominatim_geolocator.geocode(query, timeout=10)
        if location:
            # Rate limit compliance - 1 request per second
            time.sleep(1)
            return (location.latitude, location.longitude)
        else:
            raise ValueError(f"Could not geocode '{gemeente_naam}'")
    except Exception as e:
        raise ValueError(f"Geocoding failed for '{gemeente_naam}': {e}")

# Municipality name mappings for special cases in Overpass API
# Maps user-provided names to official OSM names
GEMEENTE_NAME_MAPPING = {
    # Names with special characters (OSM actually uses the apostrophe)
    "s-Hertogenbosch": "'s-Hertogenbosch",  # Our data has no apostrophe, OSM has it
    # "Den Haag": "'s-Gravenhage",  # Commented out - "Den Haag" works with ISO filter

    # Names with parentheses (disambiguation) - OSM uses just "Bergen" as official name
    # but uses nat_name to distinguish. We map to nat_name for accurate filtering.
    "Bergen (L.)": "Bergen",  # Limburg - nat_name: "Bergen (L)", gemeentecode: 0893
    "Bergen (NH.)": "Bergen",  # Noord-Holland - nat_name: "Bergen (NH)", gemeentecode: 0373

    # Abbreviated names (c.a. = cum annexis = with additions)
    "Nuenen": "Nuenen c.a.",

    # Add more mappings as needed
}

# Municipality codes for disambiguation when multiple municipalities share the same name
# Maps user-provided names to CBS gemeentecode for precise OSM filtering
GEMEENTE_CODE_MAPPING = {
    "Bergen (L.)": "0893",   # Bergen in Limburg
    "Bergen (NH.)": "0373",  # Bergen in Noord-Holland
}

def get_gemeente_polygon(gemeente_naam: str, country_hint: str = "Nederland"):
    """
    Haalt de exacte gemeentegrens (polygon) op uit OpenStreetMap via Overpass API.

    Deze functie gebruikt admin_level=8 om volledige gemeentegrenzen op te halen,
    inclusief samengevoegde gebieden (bijv. Rotterdam met Hoek van Holland en Rozenburg).

    Uses a two-level caching strategy:
    1. In-memory cache (session-level, instant)
    2. Persistent file cache (survives restarts, expires after 25 batch runs)

    Parameters
    ----------
    gemeente_naam : str
        Naam van de gemeente, bv. "Utrecht".
    country_hint : str
        Optioneel land als zoekfilter (default: "Nederland").

    Returns
    -------
    geopandas.GeoDataFrame
        GeoDataFrame met de gemeentegrens als polygon geometry (EPSG:4326).
    """
    import time
    from shapely.geometry import shape

    # Apply name mapping for special cases
    original_name = gemeente_naam
    gemeente_naam = GEMEENTE_NAME_MAPPING.get(gemeente_naam, gemeente_naam)

    # Check if we need to use gemeentecode for disambiguation
    gemeentecode = GEMEENTE_CODE_MAPPING.get(original_name)

    # Level 1: Check in-memory cache first (fastest)
    cache_key = f"{original_name}:{country_hint}"
    if cache_key in _gemeente_polygon_cache:
        return _gemeente_polygon_cache[cache_key]

    # Level 2: Check persistent file cache (avoids API call)
    cached_gdf = _get_cached_polygon(original_name, country_hint)
    if cached_gdf is not None:
        # Store in in-memory cache for subsequent calls in same session
        _gemeente_polygon_cache[cache_key] = cached_gdf
        return cached_gdf

    # Add rate limiting for Overpass API (be nice to the server)
    time.sleep(1)

    # Retry logic with exponential backoff for timeouts
    max_retries = 5  # Increased from 3 to handle transient Overpass API issues
    retry_delay = 3  # seconds
    last_exception = None

    for attempt in range(max_retries):
        try:
            # Use Overpass API to get admin_level=8 boundary (municipality level)
            # This ensures we get the full municipality, not just the city center
            overpass_url = "https://overpass-api.de/api/interpreter"

            # Overpass QL query to find municipality boundary with admin_level=8
            # Increased timeout to 45s to reduce likelihood of 504 errors
            # Search within Netherlands (ISO3166-1=NL) to avoid getting wrong country (e.g., Breda, Iowa instead of Breda, NL)
            # For ambiguous names (like Bergen), add ref:gemeentecode filter for precise matching
            if gemeentecode:
                # Use gemeentecode for disambiguation (e.g., Bergen L. vs Bergen NH.)
                query = f"""
                [out:json][timeout:45];
                area["ISO3166-1"="NL"]["admin_level"="2"]->.searchArea;
                (
                  relation(area.searchArea)["admin_level"="8"]["boundary"="administrative"]["name"="{gemeente_naam}"]["ref:gemeentecode"="{gemeentecode}"];
                );
                out geom;
                """
            else:
                # Standard query by name only
                query = f"""
                [out:json][timeout:45];
                area["ISO3166-1"="NL"]["admin_level"="2"]->.searchArea;
                (
                  relation(area.searchArea)["admin_level"="8"]["boundary"="administrative"]["name"="{gemeente_naam}"];
                );
                out geom;
                """

            response = requests.post(
                overpass_url,
                data={'data': query},
                headers={'User-Agent': 'pakketpunten_boundary_fetcher/1.0'},
                timeout=90  # Increased from 60s to handle slower API responses
            )
            response.raise_for_status()
            data = response.json()

            if not data.get('elements') or len(data['elements']) == 0:
                if gemeentecode:
                    raise ValueError(f"Gemeente '{original_name}' niet gevonden via Overpass API (admin_level=8, gemeentecode={gemeentecode}).")
                else:
                    raise ValueError(f"Gemeente '{original_name}' niet gevonden via Overpass API (admin_level=8).")

            # Get the first relation (should be the municipality boundary)
            relation = data['elements'][0]

            if relation['type'] != 'relation':
                raise ValueError(f"Verwachtte een relation, kreeg {relation['type']}.")

            # Extract geometry from Overpass format
            # Overpass returns geometry in "members" array with "geometry" field
            geojson_feature = {
                "type": "Feature",
                "properties": relation.get('tags', {}),
                "geometry": _extract_geometry_from_overpass(relation)
            }

            # Convert to Shapely geometry
            geom = shape(geojson_feature['geometry'])

            # Validate and fix geometry (common OSM issue: self-intersections)
            if not geom.is_valid:
                print(f"  ⚠️  Invalid geometry detected for '{original_name}', attempting to fix...")
                geom = geom.buffer(0)  # Fix self-intersections and topology errors

            if not geom.is_valid:
                raise ValueError(f"Kon geometry voor '{original_name}' niet repareren.")

            # Create GeoDataFrame
            gdf = gpd.GeoDataFrame(
                {'gemeente': [original_name]},
                geometry=[geom],
                crs="EPSG:4326"
            )

            # Cache the result at both levels
            _gemeente_polygon_cache[cache_key] = gdf  # In-memory (session)
            _cache_polygon(original_name, gdf, country_hint)  # Persistent (file)

            return gdf

        except requests.exceptions.HTTPError as e:
            # Check if it's a timeout or rate limit error that we should retry
            if e.response is not None and e.response.status_code in [429, 504, 503]:
                last_exception = e
                error_type = "Gateway Timeout" if e.response.status_code == 504 else "Rate Limit/Service Unavailable"
                if attempt < max_retries - 1:
                    wait_time = retry_delay * (2 ** attempt)  # Exponential backoff
                    print(f"  ⏳ Overpass API {error_type} for '{original_name}' (HTTP {e.response.status_code})")
                    print(f"     Attempt {attempt + 1}/{max_retries}, retrying in {wait_time}s...")
                    time.sleep(wait_time)
                    continue
                else:
                    # All retries exhausted
                    raise ValueError(f"Overpass API fout voor '{original_name}': {e.response.status_code} {error_type} after {max_retries} attempts")
            else:
                # Other HTTP errors should not be retried
                raise ValueError(f"Overpass API fout voor '{original_name}': {e}")
        except requests.RequestException as e:
            # Network errors, timeouts, etc.
            last_exception = e
            if attempt < max_retries - 1:
                wait_time = retry_delay * (2 ** attempt)
                print(f"  ⏳ Network error for '{original_name}' (attempt {attempt + 1}/{max_retries}), retrying in {wait_time}s...")
                time.sleep(wait_time)
                continue
            else:
                raise ValueError(f"Overpass API fout voor '{original_name}': Network error after {max_retries} attempts - {e}")

    # If we get here, all retries failed
    if last_exception:
        raise ValueError(f"Overpass API fout voor '{original_name}': {last_exception}")


def _extract_geometry_from_overpass(relation):
    """
    Extracts GeoJSON geometry from an Overpass API relation response.

    Overpass returns relations with members (ways) that need to be connected
    end-to-end to form the complete municipality boundary polygon.
    """
    from shapely.geometry import Polygon, MultiPolygon, LineString, mapping
    from shapely.ops import linemerge, unary_union, polygonize

    # Collect all outer and inner ways
    outer_ways = []
    inner_ways = []

    for member in relation.get('members', []):
        if member['type'] != 'way':
            continue

        role = member.get('role', '')
        geometry = member.get('geometry', [])

        if not geometry:
            continue

        # Convert coordinate list to coordinates
        coords = [(point['lon'], point['lat']) for point in geometry]

        if role == 'outer':
            outer_ways.append(coords)
        elif role == 'inner':
            inner_ways.append(coords)

    if not outer_ways:
        raise ValueError("Geen outer ways gevonden in relation.")

    # Connect outer ways end-to-end to form continuous rings
    # OSM relations split boundaries into multiple ways that connect
    outer_lines = [LineString(coords) for coords in outer_ways if len(coords) >= 2]

    if not outer_lines:
        raise ValueError("Geen geldige outer ways gevonden.")

    # Merge connected linestrings into continuous lines
    merged = linemerge(outer_lines)

    # Convert merged lines to polygon(s)
    if merged.geom_type == 'LineString':
        # Single ring - create one polygon
        if not merged.is_closed:
            # Close the ring
            coords = list(merged.coords)
            coords.append(coords[0])
            merged = LineString(coords)

        geom = Polygon(merged)

    elif merged.geom_type == 'MultiLineString':
        # Multiple rings - try to polygonize
        polygons = list(polygonize(merged))

        if not polygons:
            # If polygonize fails, try creating polygons from closed rings
            polygons = []
            for line in merged.geoms:
                if line.is_closed or line.coords[0] == line.coords[-1]:
                    try:
                        polygons.append(Polygon(line))
                    except:
                        continue

        if len(polygons) == 0:
            raise ValueError("Kon geen polygons maken uit outer ways.")
        elif len(polygons) == 1:
            geom = polygons[0]
        else:
            geom = MultiPolygon(polygons)
    else:
        raise ValueError(f"Unexpected geometry type after merge: {merged.geom_type}")

    # Convert to GeoJSON
    return mapping(geom)


def get_gemeente_geometry(gemeente_naam: str, mode: str = "bbox", country_hint: str = "Nederland"):
    """
    Haalt geometrische info van een gemeente uit OpenStreetMap via admin_level=8 boundary.

    Deze functie haalt de EXACTE gemeentegrens (admin_level=8) op en berekent daaruit
    de bbox of circle, zodat de zoekparameters consistent zijn met de boundary filtering.

    Falls back to Nominatim geocoding if Overpass API fails (e.g., timeout, rate limit).

    Parameters
    ----------
    gemeente_naam : str
        Naam van de gemeente, bv. "Utrecht".
    mode : str
        "bbox"   -> retourneert (lat_min, lon_min, lat_max, lon_max)
        "circle" -> retourneert (center_lat, center_lon, radius_meters)
    country_hint : str
        Optioneel land als zoekfilter (default: "Nederland").

    Returns
    -------
    tuple
        Afhankelijk van mode:
        - bbox   -> (lat_min, lon_min, lat_max, lon_max)
        - circle -> (center_lat, center_lon, radius_meters)
    """
    # Try to get the exact municipality boundary (admin_level=8) from Overpass API
    try:
        gdf = get_gemeente_polygon(gemeente_naam, country_hint)
    except (ValueError, Exception) as e:
        # Overpass API failed - fall back to Nominatim geocoding with generous search radius
        print(f"  ⚠️  Overpass API unavailable for '{gemeente_naam}': {e}")
        print(f"  🔄 Falling back to Nominatim geocoding with generous search area")

        # Use Nominatim to get approximate center point
        lat, lon = get_lat_lon(gemeente_naam)

        if mode == "bbox":
            # Create a generous bbox around the center point (~20km radius)
            # 1 degree latitude ≈ 111 km, so 0.18 degrees ≈ 20 km.
            # Longitude degrees shrink with cos(lat) (~0.61 at 52N), so divide
            # the longitude offset by cos(lat) to keep both axes ~20 km.
            import math
            bbox_radius_deg = 0.18
            lon_radius_deg = bbox_radius_deg / math.cos(math.radians(lat))
            return (
                lat - bbox_radius_deg,  # bottom_left_lat
                lon - lon_radius_deg,   # bottom_left_lon
                lat + bbox_radius_deg,  # top_right_lat
                lon + lon_radius_deg    # top_right_lon
            )
        elif mode == "circle":
            # Return center with 20km radius (generous to capture all points)
            return lat, lon, 20000  # 20 km in meters
        else:
            raise ValueError(f"Onbekende mode: {mode}")

    # Extract bounds from the polygon
    bounds = gdf.total_bounds  # [minx, miny, maxx, maxy]
    west, south, east, north = bounds

    bottom_left_lat = south
    bottom_left_lon = west
    top_right_lat = north
    top_right_lon = east

    if mode == "bbox":
        return bottom_left_lat, bottom_left_lon, top_right_lat, top_right_lon

    elif mode == "circle":
        # Middelpunt
        center_lat = (south + north) / 2.0
        center_lon = (west + east) / 2.0
        center = (center_lat, center_lon)

        # Hoeken
        corners = [(south, west), (south, east), (north, west), (north, east)]

        # Radius = verste hoek
        radius_m = max(geodesic(center, c).meters for c in corners)

        return center_lat, center_lon, int(radius_m)

    else:
        raise ValueError("mode moet 'bbox' of 'circle' zijn.")

# ---------- helper functions for api calls ----------

def ensure_no_proxy(domains: Iterable[str]) -> None:
    """
    Voeg domeinen toe aan NO_PROXY zodat requests ze niet via een proxy stuurt.
    """
    no_proxy = os.environ.get("NO_PROXY", "")
    current = {d.strip() for d in no_proxy.split(",") if d.strip()}
    for d in domains:
        if d not in current:
            current.add(d)
    os.environ["NO_PROXY"] = ",".join(sorted(current))

def make_session(disable_env_proxy: bool = True) -> requests.Session:
    """
    Maak een requests.Session die (optioneel) geen omgevingsproxy’s gebruikt.
    """
    s = requests.Session()
    if disable_env_proxy:
        s.trust_env = False  # negeer systeem-/omgevingsproxy's
    return s

def fetch_json(
    url: str,
    *,
    params: Optional[Dict[str, Any]] = None,
    headers: Optional[Dict[str, str]] = None,
    no_proxy_domains: Optional[Iterable[str]] = None,
    timeout: float = 20.0,
    session: Optional[requests.Session] = None,
) -> Any:
    """
    Haal JSON op van een API-endpoint met nette defaults:
    - optioneel bepaalde domeinen aan NO_PROXY toevoegen
    - requests.Session herbruikbaar
    - expliciet geen proxy via proxies={"http": None, "https": None}
    """
    if no_proxy_domains:
        ensure_no_proxy(no_proxy_domains)

    sess = session or make_session(disable_env_proxy=True)
    hdrs = {"Accept": "application/json"}
    if headers:
        hdrs.update(headers)

    resp = sess.get(
        url,
        params=params,
        headers=hdrs,
        timeout=timeout,
        proxies={"http": None, "https": None}  # expliciet geen proxy
    )
    resp.raise_for_status()
    return resp.json()


# ---------- helper functions voor webscraping ----------

def extract_js_array(js_text, varname="locations"):
    "parsed 'var locations = [...]' uit de JS/HTML "
    m = re.search(rf'\b(var|let|const)\s+{re.escape(varname)}\s*=', js_text)
    if not m:
        m = re.search(rf'\b{re.escape(varname)}\s*=', js_text)
        if not m:
            raise ValueError(f"Kon '{varname} =' niet vinden.")
    i = m.end()
    while i < len(js_text) and js_text[i].isspace():
        i += 1
    if js_text[i] != "[":
        i = js_text.find("[", i)
    depth, start = 0, i
    in_str, quote, escape = False, "", False
    for j, ch in enumerate(js_text[i:], start=i):
        if in_str:
            if escape:
                escape = False
            elif ch == "\\":
                escape = True
            elif ch == quote:
                in_str = False
        else:
            if ch in ('"', "'"):
                in_str, quote = True, ch
            elif ch == "[":
                depth += 1
            elif ch == "]":
                depth -= 1
                if depth == 0:
                    return js_text[start:j+1]
    raise ValueError("Geen sluitende ] gevonden.")

def _slice_bracket_array(s: str, start_idx: int) -> str:
    depth = 0; in_str = False; esc = False; quote = ""
    for j in range(start_idx, len(s)):
        c = s[j]
        if in_str:
            if esc: esc = False
            elif c == "\\": esc = True
            elif c == quote: in_str = False
        else:
            if c in ("'", '"'):
                in_str = True; quote = c
            elif c == "[": depth += 1
            elif c == "]":
                depth -= 1
                if depth == 0:
                    return s[start_idx:j+1]
    raise ValueError("Geen sluitende ] gevonden.")

def _jsonish(a: str) -> str:
    # trailing comma's vóór ] of }
    a = re.sub(r',\s*([\]\}])', r'\1', a)
    # unicode line separators
    a = a.replace('\u2028','').replace('\u2029','')
    return a

def _parse_array_str(a: str):
    # 1) probeer JSON
    try:
        return json.loads(a)
    except json.JSONDecodeError:
        pass
    # 2) lichte schoonmaak en opnieuw
    a2 = _jsonish(a)
    try:
        return json.loads(a2)
    except json.JSONDecodeError:
        pass
    # 3) laatste redmiddel: Python literal
    a3 = a2.replace("true","True").replace("false","False").replace("null","None")
    return ast.literal_eval(a3)

def parse_locations_any(text: str, key: str = "locations"):
    s = text.strip()

    # Case 1: volledige assignment aanwezig
    m = re.search(rf'\b(var|let|const)\s+{re.escape(key)}\s*=', s)
    if not m:
        m = re.search(rf'\b{re.escape(key)}\s*=', s)
    if m:
        lb = s.find('[', m.end())
        if lb == -1:
            raise ValueError(f"Geen '[' na {key}= gevonden.")
        arr_txt = _slice_bracket_array(s, lb)
        return _parse_array_str(arr_txt)

    # Case 2: “losse rijen” – wrap tot een array van arrays
    wrapped = "[" + s.strip().strip(",") + "]"
    return _parse_array_str(wrapped)

def extract_points_array(text: str) -> list:
    """
    Zoekt in Next.js Flight (RSC) push-blokken naar een "points":[ ... ] JSON-array
    en geeft die terug als Python-lijst met dicts.
    """
    # 1) Vind alle Flight-snippers: self.__next_f.push([1,"..."])
    pattern = re.compile(r'self\.__next_f\.push\(\[1,"(.*?)"\]\)', re.DOTALL)
    matches = pattern.findall(text)

    # 2) Unescape de JS-string via JSON-decoder (behandelt \" en \uXXXX)
    decoded_chunks = []
    for m in matches:
        try:
            decoded_chunks.append(json.loads(f'"{m}"'))
        except json.JSONDecodeError:
            pass  # niet erg; ga door

    # 3) Zoek in elke gedecodeerde chunk naar "points":[ ... ] en pak de array
    for chunk in decoded_chunks:
        idx = chunk.find('"points"')
        if idx == -1:
            continue
        # zoek de eerste '[' na "points"
        lb = chunk.find('[', idx)
        if lb == -1:
            continue

        # balans-parser over de array (strings/escapes correct afhandelen)
        depth = 0
        in_str = False
        esc = False
        end = None
        for j in range(lb, len(chunk)):
            c = chunk[j]
            if in_str:
                if esc:
                    esc = False
                elif c == '\\':
                    esc = True
                elif c == '"':
                    in_str = False
            else:
                if c == '"':
                    in_str = True
                elif c == '[':
                    depth += 1
                elif c == ']':
                    depth -= 1
                    if depth == 0:
                        end = j + 1
                        break
        if end:
            arr_txt = chunk[lb:end]
            try:
                return json.loads(arr_txt)  
            except json.JSONDecodeError:
                # soms zitten er JS-achtige trailing commas of \u2028; probeer lichte schoonmaak
                cleaned = arr_txt.replace('\u2028', '').replace('\u2029', '')
                return json.loads(cleaned)

    raise ValueError("Kon geen 'points' array vinden in de RSC payload.")


# ---------- cleaning / transforming ----------

def json_to_dataframe(data) -> pd.DataFrame:
    """
    Zet API JSON-data om naar een Pandas DataFrame.
    
    Werking:
    - Detecteert of de response een dict of een list is.
    - Zoekt in dicts naar bekende sleutels ('data', 'items', 'results', 'locations').
    - Vindt de eerste lijst met records.
    - Normaliseert nested JSON naar een platte tabel.
    
    Parameters
    ----------
    data : dict of list
        JSON-data uit een API-response
    
    Returns
    -------
    pd.DataFrame
        DataFrame met de genormaliseerde records
    """
    if isinstance(data, dict):
        items = (
            data.get("data")
            or data.get("items")
            or data.get("results")
            or data.get("locations")
            or data
        )
        # Als items nog steeds een dict is, probeer een lijst te vinden
        if isinstance(items, dict):
            list_candidates = [v for v in items.values() if isinstance(v, list)]
            items = list_candidates[0] if list_candidates else []
    elif isinstance(data, list):
        items = data
    else:
        items = []

    if not isinstance(items, list) or len(items) == 0:
        raise RuntimeError(
            "Geen locaties gevonden in de API-respons. Controleer de structuur van de JSON."
        )

    # DataFrame maken (vlakken geneste velden af)
    df = pd.json_normalize(items)
    return df

def df_to_gdf(df: pd.DataFrame, vervoerder) -> gpd.GeoDataFrame:
    """
    Zet een DataFrame met latitude/longitude om naar een GeoDataFrame.
    Detecteert automatisch de juiste kolommen en hernoemt ze naar:
    - locatieNaam
    - straatNaam
    - latitude
    - longitude
    Voegt een extra kolom toe met vervoerder
    Output: GeoDataFrame met CRS=WGS84 (EPSG:4326)
    """
    # Kandidaten zoeken
    lat_col_candidates = [c for c in df.columns if c.lower().endswith(("lat","latitude"))]
    lon_col_candidates = [c for c in df.columns if c.lower().endswith(("lon","lng","longitude"))]

    if not lat_col_candidates or not lon_col_candidates:
        raise RuntimeError("Kon latitude/longitude kolommen niet automatisch vinden.")

    lat_col = lat_col_candidates[0]
    lon_col = lon_col_candidates[0]

    # Optionele kolommen 
    name_col_candidates = [c for c in df.columns if any(k in c.lower() for k in ["naam", "name","shopname","label","bedrijf","store"])]
    cap_col_candidates = [c for c in df.columns if any(k in c.lower() for k in ["allownrparcels", "operational_status.status"])]
    type_col_candidates = [c for c in df.columns if any(k in c.lower() for k in ["point_type", "shoptype", "type"])]
        
    # eerst specifiek zoeken naar 'straat' of 'street'
    street_candidates = [c for c in df.columns if any(k in c.lower() for k in ["street", "straat"])]
    nr_col_candidates = [c for c in df.columns if any(k in c.lower() for k in ["address.number", "number", "nummer", "nr"])]
    
    
    if street_candidates:
        addr_col_candidates = street_candidates 
    
    else:
        # pas als er geen 'straat' kolommen zijn, zoeken op bredere set
        addr_col_candidates = [c for c in df.columns if any(k in c.lower() for k in ["address", "adres", "vicinity"])]
        
    name_col = name_col_candidates[0] if name_col_candidates else None
    addr_col = addr_col_candidates[0] if addr_col_candidates else None
    cap_col = cap_col_candidates[0] if cap_col_candidates else None
    type_col = type_col_candidates[0] if type_col_candidates else None

    nr_col = None
    if nr_col_candidates:
        nr_col = nr_col_candidates[0]
        # uitzondering voor DHL
        if nr_col.lower() == "allownrparcels" and len(nr_col_candidates) > 1:
            nr_col = nr_col_candidates[1]
  

    # Subset + hernoemen
    rename_map = {}
    if name_col: rename_map[name_col] = "locatieNaam"
    if addr_col: rename_map[addr_col] = "straatNaam"
    if nr_col: rename_map[nr_col] = "straatNr"
    rename_map[lat_col] = "latitude"
    rename_map[lon_col] = "longitude"
    rename_map[cap_col] = "capaciteit"
    rename_map[type_col] = "puntType"

    # alleen kolommen behouden die in dataframe zitten
    valid_cols = [col for col in rename_map.keys() if col in df.columns]
    # selecteren en hernoemen
    df = df[valid_cols].rename(columns=rename_map)
    print(df.columns)


    # GeoDataFrame maken
    gdf = gpd.GeoDataFrame(
        df,
        geometry=gpd.points_from_xy(df["longitude"], df["latitude"]),
        crs="EPSG:4326"
    )

    # add name of vervoerder 
    gdf["vervoerder"] = vervoerder

    return gdf


# ---------- Output ----------

def save_output(kaartlagen, filename, format="gpkg"):
    output_dir = Path(__file__).resolve().parent / "output"
    output_dir.mkdir(exist_ok=True)
    
    if format == "gpkg":
        path = output_dir / f"{filename}.gpkg"
        for i, (name, gdf) in enumerate(kaartlagen.items()):
            mode = "w" if i == 0 else "a"
            gdf.to_file(path, layer=name, driver="GPKG", mode=mode)
        print(f"✅ Data opgeslagen als GeoPackage: {path}")

    elif format == "geojson":
        for name, gdf in kaartlagen.items():
            path = output_dir / f"{filename}_{name}.geojson"
            gdf.to_file(path, driver="GeoJSON")
            print(f"🌍 Data opgeslagen als GeoJSON: {path}")
    else:
        raise ValueError("Ongeldig formaat: kies 'gpkg' of 'geojson'")