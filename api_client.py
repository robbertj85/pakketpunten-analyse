
import requests
import pandas as pd, geopandas as gpd
from utils import extract_js_array, parse_locations_any
from utils import make_session, get_gemeente_geometry, get_gemeente_polygon, fetch_json, json_to_dataframe, df_to_gdf, extract_points_array

# ---------- data ophalen voor "De Buren" ----------

def get_data_deburen(gemeente):
    """
    Parameters
    ----------
    gemeente : str
        Naam van de gemeente waarvoor de pakketpunten moeten worden opgehaald.

    Returns
    -------
    geopandas.GeoDataFrame
        Een GeoDataFrame met de pakketpuntlocaties binnen de opgegeven gemeente.
    """
    headers = {"User-Agent": "Mozilla/5.0"}
    url = "https://mijnburen.deburen.nl/maps"

    response = requests.get(url, headers=headers, timeout=30)
    response.raise_for_status()  

    js_text = extract_js_array(response.text)
    rows = parse_locations_any(js_text)[0]

    cols = ["naam","lat","lon","id","straat","nummer","postcode","city","flag_a","type","flag_b","flag_c"]
    df = pd.DataFrame(rows, columns=cols)

    # Geen pre-filter op plaatsnaam: die mist punten in meergemeentelijke
    # gemeenten (bijv. Sneek in Súdwest-Fryslân). De polygon-filter in
    # get_data_pakketpunten() doet de echte gemeentefiltering.
    gdf = df_to_gdf(df, "DeBuren")
    # DeBuren: All locations support both pickup and dropoff
    gdf['canPickup'] = True
    gdf['canDropoff'] = True
    return gdf


# ---------- data ophalen voor "DHL" ----------


def get_data_dhl(lat, lon, radius, gemeente=None):
    """
    Fetch DHL parcel points. Uses cached grid data if available, otherwise calls API.

    Parameters
    ----------
    lat : float
        Latitude for API search circle (fallback only)
    lon : float
        Longitude for API search circle (fallback only)
    radius : int
        Radius in meters for API search circle (fallback only)
    gemeente : str, optional
        Municipality name for filtering cached data by polygon boundary

    Returns
    -------
    geopandas.GeoDataFrame
        GeoDataFrame with DHL parcel point locations
    """
    from pathlib import Path
    import json
    from shapely.geometry import Point

    # Try to load from cache if gemeente is provided
    cache_file = Path(__file__).parent / "data" / "dhl_all_locations.json"

    if gemeente and cache_file.exists():
        try:
            # Load complete DHL dataset from cache
            with open(cache_file, 'r', encoding='utf-8') as f:
                cache_data = json.load(f)

            locations = cache_data.get('locations', [])

            if locations:
                # Convert to DataFrame
                rows = []
                for loc in locations:
                    geo = loc.get('geoLocation', {})
                    addr = loc.get('address', {})
                    service_types = loc.get('serviceTypes', [])

                    # DHL: Check serviceTypes for pickup/dropoff capability
                    # parcel-last-mile = pickup (receive), parcel-first-mile = dropoff (send)
                    can_pickup = 'parcel-last-mile' in service_types
                    can_dropoff = 'parcel-first-mile' in service_types

                    rows.append({
                        'locatieNaam': loc.get('name', ''),
                        'straatNaam': addr.get('street', ''),
                        'straatNr': str(addr.get('number', '')) + (addr.get('addition', '') or ''),
                        'latitude': geo.get('latitude'),
                        'longitude': geo.get('longitude'),
                        'puntType': loc.get('shopType', ''),
                        'vervoerder': 'DHL',
                        'canPickup': can_pickup,
                        'canDropoff': can_dropoff,
                    })

                df = pd.DataFrame(rows)

                # Filter out rows without coordinates
                df = df.dropna(subset=['latitude', 'longitude'])

                # Create GeoDataFrame
                geometry = [Point(row['longitude'], row['latitude']) for _, row in df.iterrows()]
                gdf_all = gpd.GeoDataFrame(df, geometry=geometry, crs='EPSG:4326')

                # Return all points - polygon filtering happens in get_data_pakketpunten()
                print(f"  📦 DHL: Loaded {len(gdf_all)} points from cache (will be filtered by polygon)")
                return gdf_all

        except Exception as e:
            print(f"  ⚠️  DHL cache load failed ({e}), falling back to API")

    # Fallback: Use API with 50-result limit
    session = make_session()
    data = fetch_json(
        "https://api-gw.dhlparcel.nl/parcel-shop-locations/NL/by-geo",
        params={
            "latitude": lat,
            "longitude": lon,
            "radius": radius,
            "limit": 50,  # API default is 15, max is 50
        },
        no_proxy_domains=["api-gw.dhlparcel.nl"],
        session=session,
    )

    df = json_to_dataframe(data)
    gdf = df_to_gdf(df, "DHL")
    return gdf


# ---------- data ophalen voor "PostNL" ----------

# PostNL location type mapping based on properties.id
# 405 = Pakket- en briefautomaat (locker)
# 1, 2, 404, 408 = Postkantoor/ServicePoint (shop)
POSTNL_TYPE_MAPPING = {
    405: 'automaat',      # Locker
    1: 'servicepunt',     # Shop
    2: 'servicepunt',     # Shop
    404: 'servicepunt',   # Shop (e.g., GAMMA)
    408: 'servicepunt',   # Shop
}


def get_data_postnl(bottom_left_lat, bottom_left_lon, top_right_lat, top_right_lon):
    """
    Fetch PostNL parcel points within a bounding box.

    Parameters
    ----------
    bottom_left_lat, bottom_left_lon, top_right_lat, top_right_lon : float
        Bounding box coordinates for the search area.

    Returns
    -------
    geopandas.GeoDataFrame
        GeoDataFrame with PostNL parcel point locations including puntType.
    """
    from shapely.geometry import Point

    session = make_session()

    data = fetch_json(
        url="https://productprijslokatie.postnl.nl/location-widget/api/locations",
        params={
            "country": "nld",
            "business": "false",
            "filters": "[]",
            "productFilters": '[{"productId":"23"}]',
            "defaultFilters": "[]",
            "bottomLeftLat": bottom_left_lat,
            "bottomLeftLon": bottom_left_lon,
            "topRightLat": top_right_lat,
            "topRightLon": top_right_lon,
            "lang": "NL",
        },
        no_proxy_domains=["productprijslokatie.postnl.nl"],
        session=session,
    )

    # Extract items from response
    items = data.get('items', []) if isinstance(data, dict) else data

    if not items:
        # Return empty GeoDataFrame with correct structure
        df = pd.DataFrame(columns=['locatieNaam', 'straatNaam', 'straatNr', 'latitude', 'longitude', 'puntType', 'vervoerder'])
        return gpd.GeoDataFrame(df, geometry=[], crs='EPSG:4326')

    # Convert to DataFrame with standardized columns
    rows = []
    for loc in items:
        coords = loc.get('coordinates', {})
        addr = loc.get('internationalAddress', {})
        props = loc.get('properties', {})

        # Map properties.id to puntType
        prop_id = props.get('id')
        punt_type = POSTNL_TYPE_MAPPING.get(prop_id, 'servicepunt')

        # Build street number with extension
        street_nr = str(addr.get('buildingNumber', ''))
        if addr.get('buildingNumberExtension'):
            street_nr += addr.get('buildingNumberExtension')

        rows.append({
            'locatieNaam': loc.get('locationName', ''),
            'straatNaam': addr.get('streetName', ''),
            'straatNr': street_nr,
            'latitude': coords.get('latitude'),
            'longitude': coords.get('longitude'),
            'puntType': punt_type,
            'vervoerder': 'PostNL',
            'canPickup': True,   # PostNL: All locations support pickup
            'canDropoff': True,  # PostNL: All locations support dropoff
        })

    df = pd.DataFrame(rows)

    # Filter out rows without coordinates
    df = df.dropna(subset=['latitude', 'longitude'])

    # Create GeoDataFrame
    geometry = [Point(row['longitude'], row['latitude']) for _, row in df.iterrows()]
    gdf = gpd.GeoDataFrame(df, geometry=geometry, crs='EPSG:4326')

    return gdf


# ---------- data ophalen voor "DPD" ----------

def get_data_dpd(gemeente):
    """
    Fetch DPD parcel points. Uses cached complete data if available, otherwise calls API.

    Parameters
    ----------
    gemeente : str
        Municipality name for filtering cached data by polygon boundary

    Returns
    -------
    geopandas.GeoDataFrame
        GeoDataFrame with DPD parcel point locations
    """
    from pathlib import Path
    import json
    from shapely.geometry import Point

    # Try to load from cache
    cache_file = Path(__file__).parent / "data" / "dpd_all_locations.json"

    if cache_file.exists():
        try:
            # Load complete DPD dataset from cache
            with open(cache_file, 'r', encoding='utf-8') as f:
                cache_data = json.load(f)

            locations = cache_data.get('locations', [])

            if locations:
                # Convert to DataFrame
                rows = []
                for loc in locations:
                    # Budbee-boxen in de DPD-feed worden door get_data_budbee() uitgegeven; hier overslaan om dubbeltelling te voorkomen
                    if 'budbee' in (loc.get('company') or '').lower():
                        continue
                    rows.append({
                        'locatieNaam': loc.get('company', ''),
                        'straatNaam': loc.get('street', ''),
                        'straatNr': loc.get('house_number', ''),
                        'latitude': loc.get('latitude'),
                        'longitude': loc.get('longitude'),
                        'puntType': loc.get('pickup_network_type', ''),
                        'vervoerder': 'DPD',
                        'canPickup': bool(loc.get('pickup_allowed', 0)),
                        'canDropoff': bool(loc.get('dropoff_allowed', 0)),
                    })

                df = pd.DataFrame(rows)

                # Filter out rows without coordinates
                df = df.dropna(subset=['latitude', 'longitude'])

                # Create GeoDataFrame
                geometry = [Point(row['longitude'], row['latitude']) for _, row in df.iterrows()]
                gdf_all = gpd.GeoDataFrame(df, geometry=geometry, crs='EPSG:4326')

                # Return all points - polygon filtering happens in get_data_pakketpunten()
                print(f"  📦 DPD: Loaded {len(gdf_all)} points from cache (will be filtered by polygon)")
                return gdf_all

        except Exception as e:
            print(f"  ⚠️  DPD cache load failed ({e}), falling back to API")

    # Fallback: Use API with 100-result limit
    session = make_session()

    data = fetch_json(
        url="https://pickup.dpd.cz/api/GetParcelShopsByAddress",
        params={
            "address": gemeente,
            "limit": 100,  # API maximum (enough for most municipalities)
        },
        no_proxy_domains=["pickup.dpd.cz"],
        session=session,
    )

    # Extract items from response structure
    # Response format: {"status": "ok", "count": X, "data": {"items": [...]}}
    items = []
    if isinstance(data, dict):
        if 'data' in data and isinstance(data['data'], dict):
            items = data['data'].get('items', [])
        elif 'items' in data:
            items = data['items']
    elif isinstance(data, list):
        items = data

    # Convert to dataframe with standardized columns
    rows = []
    for loc in items:
        # Budbee-boxen in de DPD-feed worden door get_data_budbee() uitgegeven; hier overslaan om dubbeltelling te voorkomen
        if 'budbee' in (loc.get('company') or '').lower():
            continue

        street = loc.get('street', '')
        house_number = loc.get('house_number', '')

        rows.append({
            'locatieNaam': loc.get('company', ''),
            'straatNaam': street,
            'straatNr': house_number,
            'latitude': loc.get('latitude'),
            'longitude': loc.get('longitude'),
            'puntType': loc.get('pickup_network_type', ''),
            'vervoerder': 'DPD',
        })

    if not rows:
        # Return empty GeoDataFrame with correct structure
        df = pd.DataFrame(columns=['locatieNaam', 'straatNaam', 'straatNr', 'latitude', 'longitude', 'puntType', 'vervoerder'])
        return df_to_gdf(df, "DPD")

    df = pd.DataFrame(rows)
    gdf = df_to_gdf(df, "DPD")
    return gdf


# ---------- data ophalen voor "Amazon" ----------

def get_data_amazon(gemeente=None):
    """
    Fetch Amazon Hub Locker and Counter locations from cached data.

    Uses pre-fetched data from scripts/amazon_fetch_all.py which scrapes
    amazon.nl/ulp using Playwright. Run that script first to populate the cache.

    Parameters
    ----------
    gemeente : str, optional
        Municipality name (not used for filtering here, polygon filtering
        happens in get_data_pakketpunten)

    Returns
    -------
    geopandas.GeoDataFrame
        GeoDataFrame with Amazon Hub location data
    """
    from pathlib import Path
    import json
    from shapely.geometry import Point

    # Load from cache file
    cache_file = Path(__file__).parent / "data" / "amazon_all_locations.json"

    if cache_file.exists():
        try:
            with open(cache_file, 'r', encoding='utf-8') as f:
                cache_data = json.load(f)

            # Handle both old format (plain list) and new format (with metadata)
            if isinstance(cache_data, dict) and 'locations' in cache_data:
                locations = cache_data.get('locations', [])
            elif isinstance(cache_data, list):
                locations = cache_data
            else:
                locations = []

            if locations:
                # Convert to DataFrame with standardized columns
                rows = []
                for loc in locations:
                    rows.append({
                        'locatieNaam': loc.get('locatieNaam', loc.get('name', '')),
                        'straatNaam': loc.get('straatNaam', loc.get('address', '')),
                        'straatNr': loc.get('straatNr', ''),
                        'latitude': loc.get('latitude'),
                        'longitude': loc.get('longitude'),
                        'puntType': loc.get('puntType', loc.get('type', '')),
                        'vervoerder': 'Amazon',
                        'canPickup': True,   # Amazon: Pickup only (receive packages)
                        'canDropoff': False, # Amazon: No dropoff (cannot send packages)
                    })

                df = pd.DataFrame(rows)

                # Filter out rows without coordinates
                df = df.dropna(subset=['latitude', 'longitude'])

                # Create GeoDataFrame
                geometry = [Point(row['longitude'], row['latitude']) for _, row in df.iterrows()]
                gdf_all = gpd.GeoDataFrame(df, geometry=geometry, crs='EPSG:4326')

                # Return all points - polygon filtering happens in get_data_pakketpunten()
                print(f"  📦 Amazon: Loaded {len(gdf_all)} points from cache (will be filtered by polygon)")
                return gdf_all

        except Exception as e:
            print(f"  ⚠️  Amazon cache load failed ({e})")

    # No cache available
    print("  ⚠️  Amazon cache not found. Run: python scripts/amazon_fetch_all.py")
    df = pd.DataFrame(columns=['locatieNaam', 'straatNaam', 'straatNr', 'latitude', 'longitude', 'puntType', 'vervoerder', 'canPickup', 'canDropoff'])
    from shapely.geometry import Point
    return gpd.GeoDataFrame(df, geometry=[], crs='EPSG:4326')


# ---------- data ophalen voor "GLS" ----------

def get_data_gls(gemeente=None):
    """
    Fetch GLS parcel points from cached data.

    Uses pre-fetched data from scripts/gls_fetch_poc.py which scrapes
    gls-info.nl using Playwright. Run that script first to populate the cache.

    Parameters
    ----------
    gemeente : str, optional
        Municipality name (not used for filtering here, polygon filtering
        happens in get_data_pakketpunten)

    Returns
    -------
    geopandas.GeoDataFrame
        GeoDataFrame with GLS parcel point locations
    """
    from pathlib import Path
    import json
    from shapely.geometry import Point

    # Load from cache file
    cache_file = Path(__file__).parent / "data" / "gls_all_locations.json"

    locations = []
    if cache_file.exists():
        try:
            with open(cache_file, 'r', encoding='utf-8') as f:
                cache_data = json.load(f)
            locations = cache_data.get('locations', [])
        except:
            pass

    if locations:
        # Convert to DataFrame with standardized columns
        rows = []
        for loc in locations:
            rows.append({
                'locatieNaam': loc.get('locatieNaam', ''),
                'straatNaam': loc.get('straatNaam', ''),
                'straatNr': loc.get('straatNr', ''),
                'latitude': loc.get('latitude'),
                'longitude': loc.get('longitude'),
                'puntType': loc.get('puntType', ''),
                'vervoerder': 'GLS',
                'canPickup': True,   # GLS: All locations support pickup
                'canDropoff': True,  # GLS: All locations support dropoff
            })

        df = pd.DataFrame(rows)

        # Filter out rows without coordinates
        df = df.dropna(subset=['latitude', 'longitude'])

        # Create GeoDataFrame
        geometry = [Point(row['longitude'], row['latitude']) for _, row in df.iterrows()]
        gdf_all = gpd.GeoDataFrame(df, geometry=geometry, crs='EPSG:4326')

        print(f"  📦 GLS: Loaded {len(gdf_all)} points from cache (will be filtered by polygon)")
        return gdf_all

    # No cache available
    print("  ⚠️  GLS cache not found. Run: python scripts/gls_fetch_poc.py")
    df = pd.DataFrame(columns=['locatieNaam', 'straatNaam', 'straatNr', 'latitude', 'longitude', 'puntType', 'vervoerder', 'canPickup', 'canDropoff'])
    from shapely.geometry import Point
    return gpd.GeoDataFrame(df, geometry=[], crs='EPSG:4326')


# ---------- data ophalen voor "ViaTim" ----------

def get_data_viatim(gemeente=None):
    """
    Fetch ViaTim service point locations from cached data.

    Uses pre-fetched data from scripts/viatim_fetch_all.py.

    Parameters
    ----------
    gemeente : str, optional
        Municipality name (not used for filtering here, polygon filtering
        happens in get_data_pakketpunten)

    Returns
    -------
    geopandas.GeoDataFrame
        GeoDataFrame with ViaTim service point locations
    """
    from pathlib import Path
    import json
    from shapely.geometry import Point

    cache_file = Path(__file__).parent / "data" / "viatim_all_locations.json"

    if cache_file.exists():
        try:
            with open(cache_file, 'r', encoding='utf-8') as f:
                cache_data = json.load(f)

            locations = cache_data.get('locations', [])

            if locations:
                rows = []
                for loc in locations:
                    rows.append({
                        'locatieNaam': loc.get('locatieNaam', ''),
                        'straatNaam': loc.get('straatNaam', ''),
                        'straatNr': loc.get('straatNr', ''),
                        'latitude': loc.get('latitude'),
                        'longitude': loc.get('longitude'),
                        'puntType': 'servicepunt',
                        'vervoerder': 'ViaTim',
                        'canPickup': True,
                        'canDropoff': True,
                    })

                df = pd.DataFrame(rows)
                df = df.dropna(subset=['latitude', 'longitude'])

                geometry = [Point(row['longitude'], row['latitude']) for _, row in df.iterrows()]
                gdf_all = gpd.GeoDataFrame(df, geometry=geometry, crs='EPSG:4326')

                print(f"  📦 ViaTim: Loaded {len(gdf_all)} points from cache (will be filtered by polygon)")
                return gdf_all

        except Exception as e:
            print(f"  ⚠️  ViaTim cache load failed ({e})")

    print("  ⚠️  ViaTim cache not found. Run: python scripts/viatim_fetch_all.py")
    df = pd.DataFrame(columns=['locatieNaam', 'straatNaam', 'straatNr', 'latitude', 'longitude', 'puntType', 'vervoerder', 'canPickup', 'canDropoff'])
    from shapely.geometry import Point
    return gpd.GeoDataFrame(df, geometry=[], crs='EPSG:4326')


# ---------- data ophalen voor "InPost" ----------

def get_data_inpost(gemeente=None):
    """
    Fetch InPost parcel locker and PUDO locations from cached data.

    Uses pre-fetched data from scripts/inpost_fetch_all.py.

    Parameters
    ----------
    gemeente : str, optional
        Municipality name (not used for filtering here, polygon filtering
        happens in get_data_pakketpunten)

    Returns
    -------
    geopandas.GeoDataFrame
        GeoDataFrame with InPost location data
    """
    from pathlib import Path
    import json
    from shapely.geometry import Point

    cache_file = Path(__file__).parent / "data" / "inpost_all_locations.json"

    if cache_file.exists():
        try:
            with open(cache_file, 'r', encoding='utf-8') as f:
                cache_data = json.load(f)

            locations = cache_data.get('locations', [])

            if locations:
                rows = []
                for loc in locations:
                    rows.append({
                        'locatieNaam': loc.get('locatieNaam', ''),
                        'straatNaam': loc.get('straatNaam', ''),
                        'straatNr': loc.get('straatNr', ''),
                        'latitude': loc.get('latitude'),
                        'longitude': loc.get('longitude'),
                        'puntType': loc.get('puntType', 'servicepunt'),
                        'vervoerder': 'InPost',
                        'canPickup': True,
                        'canDropoff': True,
                    })

                df = pd.DataFrame(rows)
                df = df.dropna(subset=['latitude', 'longitude'])

                geometry = [Point(row['longitude'], row['latitude']) for _, row in df.iterrows()]
                gdf_all = gpd.GeoDataFrame(df, geometry=geometry, crs='EPSG:4326')

                print(f"  📦 InPost: Loaded {len(gdf_all)} points from cache (will be filtered by polygon)")
                return gdf_all

        except Exception as e:
            print(f"  ⚠️  InPost cache load failed ({e})")

    print("  ⚠️  InPost cache not found. Run: python scripts/inpost_fetch_all.py")
    df = pd.DataFrame(columns=['locatieNaam', 'straatNaam', 'straatNr', 'latitude', 'longitude', 'puntType', 'vervoerder', 'canPickup', 'canDropoff'])
    from shapely.geometry import Point
    return gpd.GeoDataFrame(df, geometry=[], crs='EPSG:4326')


# ---------- data ophalen voor "Budbee" ----------

def get_data_budbee(gemeente=None):
    """
    Fetch Budbee box/locker locations from cached data.

    Uses pre-fetched data from scripts/budbee_fetch_all.py (DPD cache + OSM).

    Parameters
    ----------
    gemeente : str, optional
        Municipality name (not used for filtering here, polygon filtering
        happens in get_data_pakketpunten)

    Returns
    -------
    geopandas.GeoDataFrame
        GeoDataFrame with Budbee locker locations
    """
    from pathlib import Path
    import json
    from shapely.geometry import Point

    cache_file = Path(__file__).parent / "data" / "budbee_all_locations.json"

    if cache_file.exists():
        try:
            with open(cache_file, 'r', encoding='utf-8') as f:
                cache_data = json.load(f)

            locations = cache_data.get('locations', [])

            if locations:
                rows = []
                for loc in locations:
                    rows.append({
                        'locatieNaam': loc.get('locatieNaam', ''),
                        'straatNaam': loc.get('straatNaam', ''),
                        'straatNr': loc.get('straatNr', ''),
                        'latitude': loc.get('latitude'),
                        'longitude': loc.get('longitude'),
                        'puntType': loc.get('puntType', 'automaat'),
                        'vervoerder': 'Budbee',
                        'canPickup': True,
                        'canDropoff': True,
                    })

                df = pd.DataFrame(rows)
                df = df.dropna(subset=['latitude', 'longitude'])

                geometry = [Point(row['longitude'], row['latitude']) for _, row in df.iterrows()]
                gdf_all = gpd.GeoDataFrame(df, geometry=geometry, crs='EPSG:4326')

                print(f"  📦 Budbee: Loaded {len(gdf_all)} points from cache (will be filtered by polygon)")
                return gdf_all

        except Exception as e:
            print(f"  ⚠️  Budbee cache load failed ({e})")

    print("  ⚠️  Budbee cache not found. Run: python scripts/budbee_fetch_all.py")
    df = pd.DataFrame(columns=['locatieNaam', 'straatNaam', 'straatNr', 'latitude', 'longitude', 'puntType', 'vervoerder', 'canPickup', 'canDropoff'])
    from shapely.geometry import Point
    return gpd.GeoDataFrame(df, geometry=[], crs='EPSG:4326')


# ---------- data ophalen voor "VintedGo" ----------

def get_data_vintedgo(lat, lon, south, west, north, east):
    """
    Parameters
    ----------
    gemeente : str
        Naam van de gemeente waarvoor de pakketpunten moeten worden opgehaald.

    Returns
    -------
    geopandas.GeoDataFrame
        Een GeoDataFrame met de pakketpuntlocaties binnen de opgegeven gemeente.
    """
    url = ("https://vintedgo.com/nl/carrier-locations"
        f"?lat={lat}"
        f"&lng={lon}"
        f"&bounds=%7B%22south%22%3A{south}%2C%22west%22%3A{west}%2C%22north%22%3A{north}%2C%22east%22%3A{east}%7D"
        "&region=europe")

    headers = {"User-Agent": "Mozilla/5.0"}
    txt = requests.get(url, headers=headers, timeout=30).text
    points = extract_points_array(txt)

    # pak de puntenlijst uit
    points_list = points[3]['points']

    # Handle empty results
    if not points_list:
        return gpd.GeoDataFrame(columns=['locatieNaam', 'straatNaam', 'straatNr', 'vervoerder', 'geometry', 'canPickup', 'canDropoff'],
                                 crs="EPSG:4326")

    # return als dataframe
    df = pd.json_normalize(points_list)
    gdf = df_to_gdf(df, "VintedGo")
    # VintedGo: All locations support both pickup and dropoff
    gdf['canPickup'] = True
    gdf['canDropoff'] = True
    return gdf


# ---------- maak 1 dataset van alle gevonden pakketpunten ----------

def get_data_pakketpunten(gemeente, return_carrier_status=False):

    # haal coordinaten op voor het zoekgebied o.b.v. de gemeente
    lat, lon, radius = get_gemeente_geometry(gemeente, mode="circle")
    bottom_left_lat, bottom_left_lon, top_right_lat, top_right_lon = get_gemeente_geometry(gemeente, mode="bbox")
    south, west, north, east = bottom_left_lat, bottom_left_lon, top_right_lat, top_right_lon

    # Track carrier-level success/failure
    carrier_status = {}
    gdfs_to_concat = []

    # Amazon
    try:
        gdf_amazon = get_data_amazon(gemeente)
        gdfs_to_concat.append(gdf_amazon)
        carrier_status['Amazon'] = {'success': True, 'count': len(gdf_amazon), 'error': None}
    except Exception as e:
        print(f"  ⚠️  Amazon fetch failed: {e}")
        carrier_status['Amazon'] = {'success': False, 'count': 0, 'error': str(e)}

    # De Buren
    try:
        gdf_deburen = get_data_deburen(gemeente)
        gdfs_to_concat.append(gdf_deburen)
        carrier_status['DeBuren'] = {'success': True, 'count': len(gdf_deburen), 'error': None}
    except Exception as e:
        print(f"  ⚠️  DeBuren fetch failed: {e}")
        carrier_status['DeBuren'] = {'success': False, 'count': 0, 'error': str(e)}

    # DHL
    try:
        gdf_dhl = get_data_dhl(lat, lon, radius, gemeente=gemeente)
        gdfs_to_concat.append(gdf_dhl)
        carrier_status['DHL'] = {'success': True, 'count': len(gdf_dhl), 'error': None}
    except Exception as e:
        print(f"  ⚠️  DHL fetch failed: {e}")
        carrier_status['DHL'] = {'success': False, 'count': 0, 'error': str(e)}

    # DPD
    try:
        gdf_dpd = get_data_dpd(gemeente)
        gdfs_to_concat.append(gdf_dpd)
        carrier_status['DPD'] = {'success': True, 'count': len(gdf_dpd), 'error': None}
    except Exception as e:
        print(f"  ⚠️  DPD fetch failed: {e}")
        carrier_status['DPD'] = {'success': False, 'count': 0, 'error': str(e)}

    # PostNL
    try:
        gdf_postnl = get_data_postnl(bottom_left_lat, bottom_left_lon, top_right_lat, top_right_lon)
        gdfs_to_concat.append(gdf_postnl)
        carrier_status['PostNL'] = {'success': True, 'count': len(gdf_postnl), 'error': None}
    except Exception as e:
        print(f"  ⚠️  PostNL fetch failed: {e}")
        carrier_status['PostNL'] = {'success': False, 'count': 0, 'error': str(e)}

    # VintedGo
    try:
        gdf_vintedgo = get_data_vintedgo(lat, lon, south, west, north, east)
        gdfs_to_concat.append(gdf_vintedgo)
        carrier_status['VintedGo'] = {'success': True, 'count': len(gdf_vintedgo), 'error': None}
    except Exception as e:
        print(f"  ⚠️  VintedGo fetch failed: {e}")
        carrier_status['VintedGo'] = {'success': False, 'count': 0, 'error': str(e)}

    # GLS
    try:
        gdf_gls = get_data_gls(gemeente)
        gdfs_to_concat.append(gdf_gls)
        carrier_status['GLS'] = {'success': True, 'count': len(gdf_gls), 'error': None}
    except Exception as e:
        print(f"  ⚠️  GLS fetch failed: {e}")
        carrier_status['GLS'] = {'success': False, 'count': 0, 'error': str(e)}

    # ViaTim
    try:
        gdf_viatim = get_data_viatim(gemeente)
        gdfs_to_concat.append(gdf_viatim)
        carrier_status['ViaTim'] = {'success': True, 'count': len(gdf_viatim), 'error': None}
    except Exception as e:
        print(f"  ⚠️  ViaTim fetch failed: {e}")
        carrier_status['ViaTim'] = {'success': False, 'count': 0, 'error': str(e)}

    # InPost
    try:
        gdf_inpost = get_data_inpost(gemeente)
        gdfs_to_concat.append(gdf_inpost)
        carrier_status['InPost'] = {'success': True, 'count': len(gdf_inpost), 'error': None}
    except Exception as e:
        print(f"  ⚠️  InPost fetch failed: {e}")
        carrier_status['InPost'] = {'success': False, 'count': 0, 'error': str(e)}

    # Budbee
    try:
        gdf_budbee = get_data_budbee(gemeente)
        gdfs_to_concat.append(gdf_budbee)
        carrier_status['Budbee'] = {'success': True, 'count': len(gdf_budbee), 'error': None}
    except Exception as e:
        print(f"  ⚠️  Budbee fetch failed: {e}")
        carrier_status['Budbee'] = {'success': False, 'count': 0, 'error': str(e)}

    # Combine all successful fetches
    if gdfs_to_concat:
        gdf = gpd.GeoDataFrame(
            pd.concat(gdfs_to_concat, ignore_index=True),
            crs='EPSG:4326'
        )
    else:
        # No carriers succeeded - return empty GeoDataFrame
        gdf = gpd.GeoDataFrame(columns=['locatieNaam', 'straatNaam', 'straatNr', 'latitude', 'longitude', 'geometry', 'puntType', 'vervoerder'], crs='EPSG:4326')

    # NIEUWE FILTER: alleen pakketpunten binnen de gemeentegrens behouden
    print(f"  📍 {len(gdf)} pakketpunten gevonden in zoekgebied (voor boundary filter)")

    try:
        gemeente_polygon = get_gemeente_polygon(gemeente)
        gemeente_geom = gemeente_polygon.geometry.iloc[0]
    except Exception as e:
        # Zonder gemeentepolygoon zou de ongefilterde set (incl. landelijke
        # caches met ~19k punten) als gemeentedata worden gepubliceerd.
        # Hard falen; batch_generate.py vangt dit per gemeente af.
        raise RuntimeError(
            f"Gemeentegrens voor '{gemeente}' kon niet worden opgehaald; "
            f"afgebroken om te voorkomen dat ongefilterde landelijke data wordt gepubliceerd ({e})"
        ) from e

    # Filter: behoud alleen punten binnen de gemeentegrens
    gdf_filtered = gdf[gdf.geometry.within(gemeente_geom)].copy()

    removed_count = len(gdf) - len(gdf_filtered)
    print(f"  ✂️  {removed_count} pakketpunten buiten gemeentegrens verwijderd")
    print(f"  ✅ {len(gdf_filtered)} pakketpunten binnen gemeentegrens '{gemeente}'")

    gdf = gdf_filtered

    desired_order = [
    "locatieNaam",
    "straatNaam",
    "straatNr",
    "latitude",
    "longitude",
    "geometry",
    "puntType",
    "vervoerder",
    "canPickup",
    "canDropoff"
    ]

    # Ensure all columns exist (for backwards compatibility)
    for col in ['canPickup', 'canDropoff']:
        if col not in gdf.columns:
            gdf[col] = True  # Default to True if missing

    gdf = gdf[desired_order]

    # Update carrier_status counts after polygon filtering
    if return_carrier_status:
        for carrier in carrier_status:
            if carrier_status[carrier]['success']:
                filtered_count = len(gdf[gdf['vervoerder'] == carrier])
                carrier_status[carrier]['count'] = filtered_count
        return gdf, carrier_status
    return gdf