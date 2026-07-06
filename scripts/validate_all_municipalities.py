"""
Validate all municipality GeoJSON files for common data issues

This script checks for:
1. Empty bounds (causes Map fitBounds error)
2. Zero pakketpunten
3. Missing or invalid coordinates
4. Corrupt JSON
"""

import json
from pathlib import Path
from typing import List, Dict, Any

import pandas as pd

def validate_geojson(file_path: Path) -> Dict[str, Any]:
    """Validate a single GeoJSON file"""
    result = {
        'slug': file_path.stem,
        'valid': True,
        'issues': [],
        'warnings': [],
        'metadata': {}
    }

    try:
        with open(file_path, 'r', encoding='utf-8') as f:
            data = json.load(f)

        metadata = data.get('metadata', {})
        result['metadata'] = {
            'name': metadata.get('gemeente', 'Unknown'),
            'total_points': metadata.get('total_points', 0),
            'providers': metadata.get('providers', []),
            'bounds': metadata.get('bounds', [])
        }

        # Check 1: Empty or invalid bounds
        bounds = metadata.get('bounds', [])
        if not bounds or len(bounds) == 0:
            result['valid'] = False
            result['issues'].append('EMPTY_BOUNDS: Bounds array is empty (will cause Map crash)')
        elif len(bounds) != 4:
            result['valid'] = False
            result['issues'].append(f'INVALID_BOUNDS: Bounds has {len(bounds)} elements (expected 4)')
        elif any(b is None for b in bounds):
            result['valid'] = False
            result['issues'].append('NULL_BOUNDS: Bounds contains null values')

        # Check 2: Zero pakketpunten
        total_points = metadata.get('total_points', 0)
        if total_points == 0:
            result['warnings'].append('ZERO_POINTS: Municipality has no pakketpunten')

        # Check 3: Verify features match metadata
        features = data.get('features', [])
        pakketpunt_features = [f for f in features if f.get('properties', {}).get('type') == 'pakketpunt']

        if len(pakketpunt_features) != total_points:
            result['warnings'].append(
                f'POINT_MISMATCH: Metadata says {total_points} points but found {len(pakketpunt_features)} features'
            )

        # Check 4: Validate pakketpunt coordinates
        invalid_coords = []
        for i, feature in enumerate(pakketpunt_features):
            coords = feature.get('geometry', {}).get('coordinates', [])
            if len(coords) != 2:
                invalid_coords.append(f'Feature {i}: Wrong coordinate count ({len(coords)})')
            elif None in coords or any(c is None for c in coords):
                invalid_coords.append(f'Feature {i}: Null coordinates')
            elif not all(isinstance(c, (int, float)) for c in coords):
                invalid_coords.append(f'Feature {i}: Non-numeric coordinates')

        if invalid_coords:
            result['valid'] = False
            result['issues'].append(f'INVALID_COORDINATES: {len(invalid_coords)} features have bad coordinates')
            if len(invalid_coords) <= 5:
                result['issues'].extend(invalid_coords)

        # Check 5: No providers
        if not metadata.get('providers'):
            result['warnings'].append('NO_PROVIDERS: No providers listed in metadata')

    except json.JSONDecodeError as e:
        result['valid'] = False
        result['issues'].append(f'JSON_ERROR: Failed to parse JSON - {str(e)}')
    except Exception as e:
        result['valid'] = False
        result['issues'].append(f'UNKNOWN_ERROR: {str(e)}')

    return result


def main():
    """Validate all municipality GeoJSON files"""

    print("🔍 Validating all municipality GeoJSON files...")
    print("="*80)

    data_dir = Path("webapp/public/data")
    geojson_files = sorted([
        f for f in data_dir.glob("*.geojson")
        if f.name not in ['nederland.geojson', 'nederland-boundaries.geojson']
    ])

    print(f"Found {len(geojson_files)} municipality files\n")

    results = []
    invalid_count = 0
    warning_count = 0

    for file_path in geojson_files:
        result = validate_geojson(file_path)
        results.append(result)

        if not result['valid']:
            invalid_count += 1
        if result['warnings']:
            warning_count += 1

    # Separate results
    invalid_results = [r for r in results if not r['valid']]
    warning_results = [r for r in results if r['valid'] and r['warnings']]
    valid_results = [r for r in results if r['valid'] and not r['warnings']]

    # Print critical errors
    if invalid_results:
        print(f"\n❌ CRITICAL ERRORS ({len(invalid_results)} municipalities):")
        print("-"*80)
        for result in invalid_results:
            name = result['metadata']['name']
            slug = result['slug']
            print(f"\n{name} ({slug}):")
            for issue in result['issues']:
                print(f"  ❌ {issue}")
            if result['warnings']:
                for warning in result['warnings']:
                    print(f"  ⚠️  {warning}")

    # Print warnings
    if warning_results:
        print(f"\n\n⚠️  WARNINGS ({len(warning_results)} municipalities):")
        print("-"*80)
        for result in warning_results:
            name = result['metadata']['name']
            slug = result['slug']
            print(f"\n{name} ({slug}):")
            for warning in result['warnings']:
                print(f"  ⚠️  {warning}")

    # Summary
    print("\n" + "="*80)
    print("SUMMARY:")
    print(f"  Total municipalities: {len(results)}")
    print(f"  ✅ Valid: {len(valid_results)}")
    print(f"  ⚠️  Warnings: {len(warning_results)}")
    print(f"  ❌ Critical errors: {len(invalid_results)}")
    print("="*80)

    # Save detailed report
    report = {
        'timestamp': pd.Timestamp.now().isoformat() + 'Z',
        'total': len(results),
        'valid': len(valid_results),
        'warnings': len(warning_results),
        'errors': len(invalid_results),
        'critical_errors': [
            {
                'slug': r['slug'],
                'name': r['metadata']['name'],
                'issues': r['issues'],
                'warnings': r['warnings']
            }
            for r in invalid_results
        ],
        'warnings_only': [
            {
                'slug': r['slug'],
                'name': r['metadata']['name'],
                'warnings': r['warnings']
            }
            for r in warning_results
        ]
    }

    report_file = Path("validation_report.json")
    with open(report_file, 'w', encoding='utf-8') as f:
        json.dump(report, f, indent=2)

    print(f"\n📊 Detailed report saved to: {report_file}")

    # Return exit code
    return 1 if invalid_results else 0


if __name__ == "__main__":
    import sys
    sys.exit(main())
