"""
Create a national overview by aggregating all municipality data
"""

import json
from pathlib import Path
import geopandas as gpd
from shapely.geometry import shape
import pandas as pd

def create_national_overview():
    """Combine all municipality GeoJSON files into a national overview"""

    print("🇳🇱 Creating National Overview...")

    data_dir = Path("webapp/public/data")
    # Exclude nederland.geojson and nederland-boundaries.geojson (own outputs)
    # to avoid re-ingesting them during aggregation
    geojson_files = [
        f for f in data_dir.glob("*.geojson")
        if f.name not in ("nederland.geojson", "nederland-boundaries.geojson")
    ]

    if not geojson_files:
        print("❌ No GeoJSON files found!")
        return

    print(f"Found {len(geojson_files)} municipality files (excluding nederland.geojson)")

    all_features = []
    boundary_features = []
    provider_stats = {}

    # Read all GeoJSON files
    for geojson_file in geojson_files:
        with open(geojson_file, 'r', encoding='utf-8') as f:
            data = json.load(f)

        # Extract pakketpunt features and boundary features (not buffers)
        for feature in data['features']:
            if feature['properties'].get('type') == 'pakketpunt':
                all_features.append(feature)

                # Count by provider
                provider = feature['properties'].get('vervoerder', 'Unknown')
                provider_stats[provider] = provider_stats.get(provider, 0) + 1
            elif feature['properties'].get('type') == 'boundary':
                boundary_features.append(feature)

    total_points = len(all_features)
    print(f"\n📊 Processed {len(geojson_files)} municipality files")

    print(f"\n📊 National Statistics:")
    print(f"  Total points: {total_points}")
    print(f"  Providers:")
    for provider, count in sorted(provider_stats.items(), key=lambda x: x[1], reverse=True):
        print(f"    {provider}: {count} points ({count/total_points*100:.1f}%)")

    # Create GeoDataFrame to calculate national bounds
    gdf = gpd.GeoDataFrame.from_features(all_features, crs="EPSG:4326")
    bounds = gdf.total_bounds  # [minx, miny, maxx, maxy]

    # Create national GeoJSON (pakketpunten only - no boundaries)
    national_data = {
        "type": "FeatureCollection",
        "metadata": {
            "gemeente": "Nederland",
            "slug": "nederland",
            "generated_at": pd.Timestamp.now().isoformat() + "Z",
            "total_points": total_points,
            "providers": sorted(provider_stats.keys()),
            "bounds": bounds.tolist(),
            "municipalities_included": len(geojson_files),
            "provider_stats": provider_stats
        },
        "features": all_features
    }

    # Save national overview (pakketpunten only)
    output_file = data_dir / "nederland.geojson"
    with open(output_file, 'w', encoding='utf-8') as f:
        json.dump(national_data, f, ensure_ascii=False, indent=2)

    file_size_mb = output_file.stat().st_size / (1024 * 1024)

    print(f"\n✅ National overview created:")
    print(f"   File: {output_file}")
    print(f"   Size: {file_size_mb:.1f} MB")
    print(f"   Points: {total_points}")
    print(f"   Municipalities: {len(geojson_files)}")

    # Create separate boundaries file
    boundaries_data = {
        "type": "FeatureCollection",
        "metadata": {
            "gemeente": "Nederland",
            "slug": "nederland-boundaries",
            "generated_at": pd.Timestamp.now().isoformat() + "Z",
            "municipalities_included": len(geojson_files),
            "boundaries_count": len(boundary_features)
        },
        "features": boundary_features
    }

    # Save boundaries separately
    boundaries_file = data_dir / "nederland-boundaries.geojson"
    with open(boundaries_file, 'w', encoding='utf-8') as f:
        json.dump(boundaries_data, f, ensure_ascii=False, indent=2)

    boundaries_size_mb = boundaries_file.stat().st_size / (1024 * 1024)

    print(f"\n✅ Boundaries file created:")
    print(f"   File: {boundaries_file}")
    print(f"   Size: {boundaries_size_mb:.1f} MB")
    print(f"   Boundaries: {len(boundary_features)}")

    return provider_stats

def update_municipalities_json():
    """Add Nederland entry to municipalities.json"""

    municipalities_file = Path("webapp/public/municipalities.json")

    with open(municipalities_file, 'r', encoding='utf-8') as f:
        municipalities = json.load(f)

    # Check if Nederland already exists
    if any(m['slug'] == 'nederland' for m in municipalities):
        print("\n'Nederland' already in municipalities.json")
        return

    # Add Nederland as first entry
    nederland = {
        "name": "🇳🇱 Nederland (Landelijk)",
        "slug": "nederland",
        "province": "Alle provincies",
        "population": sum(m['population'] for m in municipalities)
    }

    municipalities.insert(0, nederland)

    with open(municipalities_file, 'w', encoding='utf-8') as f:
        json.dump(municipalities, f, ensure_ascii=False, indent=2)

    print(f"\n✅ Added 'Nederland' to municipalities.json")
    print(f"   Total population: {nederland['population']:,}")

if __name__ == "__main__":
    provider_stats = create_national_overview()
    update_municipalities_json()

    print("\n" + "="*60)
    print("✅ National Overview Complete!")
    print("="*60)
