# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a dual-component system for collecting, analyzing, and visualizing parcel point (pakketpunten) locations across Dutch municipalities:
- **Python backend**: Data collection via APIs and web scraping (DHL, PostNL, DPD, Amazon, VintedGo, De Buren) with geospatial analysis using GeoPandas
- **Next.js webapp**: Interactive map visualization with Leaflet, featuring filters, statistics, and performance optimizations for large datasets

## Common Development Commands

### Python Backend

```bash
# Setup virtual environment
python3 -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate
pip install -r requirements.txt

# Generate data for a single municipality
python main.py --gemeente Amsterdam --filename test --format geojson

# Batch generate all municipalities (for webapp)
cd scripts
python batch_generate.py

# Fetch complete DHL grid data (nationwide) - Run once, then cached
python scripts/dhl_grid_fetch.py

# Fetch complete DPD data (nationwide) - Run once, then cached
python scripts/dpd_fetch_all.py

# Batch generate all municipalities (automatically uses cached DHL/DPD data if available)
cd scripts
python batch_generate.py

# Create national overview
python scripts/create_national_overview.py

# Generate provincial boundary chunks (for Nederland view)
python scripts/create_provincial_boundaries.py

# Statistical Analysis - Fetch CBS data and run correlation analysis
python scripts/fetch_cbs_municipality_data.py  # Fetch area data from CBS
python scripts/municipality_statistics_analysis.py  # Run statistical analysis

# Fetch Rijkswaterstaat BRON traffic-safety data (2022-2024, ~382k accidents)
# and aggregate to PC4 level — feeds the regression report's new
# "Verkeersveiligheid" feature group. Re-run when BRON publishes new years.
python scripts/fetch_bron_accidents.py      # ~5 min, caches to data/bron_all_accidents.json
python scripts/enrich_pc4_accidents.py      # sjoin → data/bron_pc4_accidents.json
python scripts/build_pc4_stats.py           # merges BRON fields into pc4_stats.json

# Best-subset regression search (33 candidate features incl. BRON).
# Parallelised across CPU cores; --max-k 8 evaluates ~19.5M OLS fits.
python scripts/find_best_model.py --max-k 8 --jobs 7   # ~25-30 min on 8-core M-series
python scripts/find_best_model.py --max-k 6            # ~2-3 min for a quick leaderboard

# Population coverage (% inwoners within 300m / 400m / 500m of a parcel point).
# Parallelised via multiprocessing.fork; re-run when parcel points, PC4
# boundaries, or the municipality polygon cache change. Output powers the
# webapp's "Bereik inwoners" tab at /data-export/bereik plus the choropleth
# layer on the main map.
python scripts/compute_population_coverage.py  # ~2-3 min on 8-core M-series

# Placement-suggestion engine (per municipality). Combines regression
# residuals (predicted minus actual parcel points), 400 m population-coverage
# gap, PC4 density (oad), and a buffer-overlap penalty into a single PC4-level
# priority score, then derives a suggested coordinate.
#
# Suggestion derivation chain:
#   1. White-spot = PC4 polygon − 400 m buffer union of existing pakketpunten.
#   2. Mask to inhabited 100 m cells (CBS Vierkantstatistieken — drops parks,
#      water, farmland, golf courses).
#   3. Pick the populated white-spot polygon with the highest CBS-grid
#      headcount; representative point of the densest 100 m cell inside it.
#   4. Snap to nearest BAG `pand` via PDOK WFS (preferring woon/winkel/kantoor/
#      bijeenkomst above industrie). Result has BAG-id + bouwjaar + snap distance.
#   5. est_new_pop_within_400m = sum of CBS cells inside both the 400 m buffer
#      and the white-spot.
#
# Pre-reqs: fit_pc4_model.py (writes predicted_points) and fetch_cbs_100m_grid.py
# (one-off, caches data/cbs/cbs_vk100_2024_inhabited.gpkg).
# Output → webapp/public/data/placement_suggestions.json + caches BAG snaps in
# data/bag_building_snap_cache.json (1371 entries on first full run, free thereafter).
python scripts/fit_pc4_model.py
python scripts/fetch_cbs_100m_grid.py            # one-off, ~30s download
python scripts/suggest_placements.py             # ~3-5 min cold (PDOK calls), ~30s warm

# Build the simplified municipality boundary GeoJSON used by the gemeente-
# level coverage choropleth. Re-run when the polygon cache changes.
python scripts/build_municipality_boundaries.py  # ~5s
```

### Statistical Analysis

The project includes a comprehensive statistical analysis system that correlates municipality data with parcel point coverage. This is a **backend-only** analysis tool that generates reports - not integrated into the webapp.

```bash
# 1. Fetch municipality area data from CBS (Statistics Netherlands)
source venv/bin/activate
python scripts/fetch_cbs_municipality_data.py

# 2. Run statistical analysis (correlation + linear regression)
python scripts/municipality_statistics_analysis.py

# 3. Generate professional PDF report with charts
python scripts/generate_pdf_report.py

# Output files (in output/ directory):
# - municipality_statistics_analysis.txt (text report)
# - municipality_statistics_data.json (detailed data)
# - municipality_statistics_data.csv (CSV export)
# - municipality_statistics_report.pdf (professional PDF with charts)
```

**Analysis Features**:
- **Correlation Analysis**: Calculates Pearson correlation coefficients between parcel points and:
  - Population (strong positive: ~0.92)
  - Area in km² (weak positive: ~0.40)
  - Population density
- **Linear Regression Model**: Predicts expected parcel points based on population and area
  - Formula: `Parcel Points = α + β₁(Population) + β₂(Area km²)`
  - R² score: ~87% variance explained
  - Interpretation: For every 1,000 inhabitants → ~0.3 additional parcel points expected
- **Performance Rankings**: Identifies overperforming and underperforming municipalities
  - Top overperformers: Municipalities with more parcel points than predicted
  - Top underperformers: Municipalities with fewer parcel points than predicted

### Next.js Webapp

```bash
cd webapp

# Install dependencies
npm install

# Development server (http://localhost:3000)
npm run dev

# Production build
npm run build
npm start

# Lint
npm run lint
```

## Architecture

### Python Backend Architecture

**Core Pipeline** (`main.py`):
1. `api_client.py` → Fetch raw data from multiple carrier APIs
2. `geo_analysis.py` → Generate buffer zones (300m/400m) in RD projection (EPSG:28992)
3. `visualize.py` → Legacy Folium map generation (static HTML)
4. `utils.py` → Coordinate transformation, geocoding, data normalization

**Key Patterns**:
- **CRS transformations**: Always WGS84 (EPSG:4326) for API/web → RD New (EPSG:28992) for metric calculations → back to WGS84 for output
- **API-specific search geometries**: DHL uses circle (lat/lon/radius), PostNL uses bbox, VintedGo uses bounds
- **Mock data**: `bezettingsgraad` (occupancy) is randomly generated for demonstration only
- **Grid-based fetching**: For nationwide coverage (DHL/DPD), use grid-based scripts instead of per-municipality calls to avoid API limits

**Data Flow**:
```
API calls (per municipality) → GeoDataFrame → CRS transform → Buffer analysis →
GeoJSON export → webapp/public/data/{slug}.geojson
```

### Next.js Webapp Architecture

**Component Hierarchy** (`app/page.tsx`):
```
Home (page.tsx)
├── MunicipalitySelector → Dropdown with autocomplete
├── FilterPanel → Provider filters, buffer toggles, occupancy slider
├── StatsPanel → Dynamic counts per provider
└── Map → Leaflet with adaptive rendering
```

**Map Component Performance Strategy** (`components/Map.tsx`):

The Map component implements **adaptive rendering** for handling 1,000-50,000+ markers:

1. **Canvas Rendering**: Uses Leaflet's `preferCanvas` when `useSimpleMarkers` is enabled (10x faster for large datasets)
2. **Simple vs Detailed Markers**:
   - Simple mode: Colored `CircleMarker` elements (4-6px radius based on zoom)
   - Detailed mode: Custom `divIcon` with carrier logos (local SVGs in `/public/logos/`)
3. **Automatic Spiderfy**: At zoom ≥15, markers with identical coordinates are spread in a circular pattern with blue connecting lines
4. **Provider Render Priority**: Randomized hourly using seeded RNG to ensure fair visibility (prevents one carrier from always being on top)
5. **Dynamic Icon Sizing**: Marker size scales with zoom level (34px → 42px → 48px) for better clickability

**State Management**: React hooks with `useMemo` for expensive computations (filtering, grouping, spreading overlapping markers)

**Data Loading**:
- `/municipalities.json` → List of available municipalities
- `/data/{slug}.geojson` → Complete municipality data (pakketpunten + buffer unions)
- `/data/boundaries/index.json` → Provincial boundary index (for Nederland view)
- `/data/boundaries/provincie-{slug}.geojson` → Individual province boundaries (12 files)

**Provincial Boundary Loading** (Nederland view only):
When viewing the national map with boundaries enabled, the system loads boundaries using a chunked approach:
1. **Split Strategy**: The full Netherlands boundary (originally 187MB, too large for GitHub) is split into 12 provincial files (0.3-7.8 MB each)
2. **Parallel Loading**: All 12 provincial files are loaded simultaneously using `loadProvincialBoundaries()` from `utils/boundaryLoader.ts`
3. **Progress Tracking**: Real-time progress indicator shows "Loading: X/12 provinces (Y%)" with a progress bar
4. **Automatic Merging**: Provincial boundaries are merged into a single GeoJSON FeatureCollection transparently
5. **On-Demand**: Boundaries only load when user clicks the "Gemeentegrens" checkbox in the Nederland view

### TypeScript Types (`webapp/types/pakketpunten.ts`)

All GeoJSON features follow this structure:
- **Pakketpunt features**: `type: 'pakketpunt'` with properties: `locatieNaam`, `straatNaam`, `straatNr`, `vervoerder`, `puntType`, `bezettingsgraad`, `latitude`, `longitude`
- **Buffer features**: `type: 'buffer_union_300m' | 'buffer_union_400m'` with `buffer_m` property

## Coordinate Reference Systems (CRS)

**Critical**: This project uses two CRS throughout:
- **WGS84 (EPSG:4326)**: All API inputs/outputs, GeoJSON files, web maps (lat/lon in degrees)
- **RD New (EPSG:28992)**: Dutch grid system for metric calculations (buffer zones in meters)

Always transform to RD New before distance/buffer operations, then back to WGS84 for output.

## Cache-Based Data Loading

The system automatically uses cached data when available:

### DHL Grid Data (`data/dhl_all_locations.json`)
- Generated once using `scripts/dhl_grid_fetch.py` (grid-based approach, ~3,800+ locations)
- `api_client.get_data_dhl()` automatically loads from cache if file exists
- Falls back to 50-result API call if cache not found
- Cache filtered by municipality bounding box (fast pre-filter)
- Final polygon filtering in `get_data_pakketpunten()` ensures accurate boundaries

### DPD Complete Data (`data/dpd_all_locations.json`)
- Generated once using `scripts/dpd_fetch_all.py` (~1,900 locations)
- `api_client.get_data_dpd()` automatically loads from cache if file exists
- Falls back to 100-result API call if cache not found
- Same bbox + polygon filtering approach as DHL

### Workflow
1. **First time**: Run `dhl_grid_fetch.py` and `dpd_fetch_all.py` to create caches
2. **Regular updates**: Run `batch_generate.py` - automatically uses cached data
3. **Regenerate caches**: Re-run grid fetch scripts when you want updated data

### BRON accident data (`data/bron_all_accidents.json`, `data/bron_pc4_accidents.json`)
- Source: Rijkswaterstaat **BRON (Bestand geRegistreerde Ongevallen Nederland)** — open ArcGIS FeatureServer at `https://geo.rijkswaterstaat.nl/arcgis/rest/services/GDR/verkeersongevallen_nederland/FeatureServer`, layer 3 (`ongevallen_2022_2024`, point geometry in EPSG:28992, ~382k records).
- `fetch_bron_accidents.py` paginates the REST endpoint in 2000-row batches (~5 min) and saves a compact record per accident (id, year, both party types, severity, urban flag, RD x/y). Re-run with `--force` to refresh.
- `enrich_pc4_accidents.py` does the PC4 sjoin and computes 8 aggregates per postcode: `crashes_total`, `crashes_total_per_km2`, `crashes_freight` (Vrachtauto + Trekker variants), `crashes_van` (Bestelauto), `crashes_freight_van_share` (%), `crashes_freight_vs_vulnerable` (freight/van × ped/bike/moped), `crashes_injury` (Letsel + Dodelijk only), `crashes_urban` (`bebouwde_kom = Binnen`).
- `build_pc4_stats.py` merges these into `pc4_stats.json` so the regression report's "Verkeersveiligheid (BRON 2022-2024)" feature group can use them.
- Caveat: BRON is police-reported; ~90% complete for fatalities but 20-50% for UMS (uitsluitend materiele schade). Use `crashes_injury` when you want a less-biased count. No truck/van *exposure* (km driven) is included — that would need NDW's Hastig intensity dataset, which is license-restricted to road authorities, OR free proxies (BAG non-residential m², IBIS bedrijventerreinen) not yet integrated.

## API Integration Notes

### Rate Limiting
- **Nominatim (geocoding)**: 1 request/second enforced in `utils.py`
- **Batch processing**: `batch_generate.py` uses 2-second delays between municipalities
- **DHL API**: Limit 50 results per call (use grid approach for nationwide coverage)
- **PostNL API**: Requires bounding box (not center/radius)

### Data Sources
- **DHL**: `api-gw.dhlparcel.nl` - Circle search (lat/lon/radius)
- **PostNL**: `productprijslokatie.postnl.nl` - Bounding box search
- **DPD**: `pickup.dpd.cz` - Address-based search (cached nationwide, ~1900 locations)
- **Amazon**: OpenStreetMap Overpass API - Community-maintained data
- **VintedGo**: `vintedgo.com` - Web scraping with bounds parameter
- **De Buren**: `mijnburen.deburen.nl` - Web scraping with JS array extraction

All API calls use `requests.Session()` with proxy bypass for specific domains (handled in `utils.make_session()`).

## Output Formats

### GeoJSON Structure
```json
{
  "type": "FeatureCollection",
  "metadata": {
    "gemeente": "Amsterdam",
    "slug": "amsterdam",
    "generated_at": "2025-01-15T10:30:00Z",
    "total_points": 156,
    "providers": ["DHL", "PostNL", "VintedGo", "DeBuren"],
    "bounds": [4.72, 52.28, 5.07, 52.43]
  },
  "features": [
    // Pakketpunt features (type: "pakketpunt")
    // Buffer union features (type: "buffer_union_300m", "buffer_union_400m")
  ]
}
```

### File Organization
- **Python outputs**: `output/` directory (legacy)
- **Webapp data**: `webapp/public/data/` directory
  - `{slug}.geojson` → Per-municipality data
  - `municipalities.json` → Municipality index
  - `summary.json` → Batch processing results
  - `totals_history.json` → Historical weekly snapshots (append-only, updated via `scripts/update_totals_history.py`)
  - `boundaries/` → Provincial boundary chunks (12 files, ~46MB total)
    - `index.json` → Metadata about all provincial files
    - `provincie-{slug}.geojson` → Individual province boundaries
  - `placement_suggestions.json` → Per-municipality top-5 placement advice. Each suggestion is an actual BAG building (pand id + bouwjaar + gebruiksdoel) inside the largest CBS-populated white-spot of its PC4. Population estimate comes from CBS 100 m cells inside the 400 m buffer × white-spot intersection. Produced by `scripts/suggest_placements.py`.

## Performance Considerations

### Python
- **Geocoding cache**: `utils.py` caches Nominatim results to disk
- **Grid-based fetching**: For DHL/DPD, fetch once nationwide instead of per-municipality
- **Batch processing**: Rate-limited to respect API usage policies

### Next.js
- **Dynamic imports**: Map component uses `next/dynamic` with `ssr: false` to avoid Leaflet SSR issues
- **Memoization**: Expensive operations (filtering, spreading markers) are memoized
- **Canvas rendering**: Enabled for 3000+ markers (50ms vs 2000ms render time)
- **Simple markers**: Automatically enabled for "Nederland" national view
- **GeoJSON size**: Amsterdam ≈100 KB, national overview ≈5 MB

## Data Attribution Requirements

When using generated data, include:
```
Data bronnen:
- DHL Parcel Netherlands (https://www.dhl.nl)
- PostNL (https://www.postnl.nl)
- VintedGo / Mondial Relay (https://vintedgo.com)
- De Buren (https://deburen.nl)
- Gemeente grenzen © OpenStreetMap contributors
- Verkeersongevallen (BRON 2022-2024) © Rijkswaterstaat (publiek domein) — geo.rijkswaterstaat.nl
- Bedrijfslogo's © respectieve merkhouders

Bezettingsgraad data is willekeurig gegenereerd voor demonstratie (niet echt)
```

## Known Limitations

- **Bezettingsgraad (occupancy)**: Mock data only - not real capacity information
- **DPD via `api_client.get_data_dpd()`**: Limited to 100 results (use `dpd_fetch_all.py` + integration script for complete coverage)
- **Amazon via OSM**: OpenStreetMap data is community-maintained and may have gaps
- **De Buren**: Web scraping - may break if website structure changes
- **Logo loading**: Uses local SVG files in `webapp/public/logos/` (falls back to initials if missing)
- **Nederland view**: Very large dataset (50,000+ markers) - simple markers recommended

## Provider Coverage Summary

| Provider | Method | Auth Required | Coverage | Cache-Based | Grid Fetch |
|----------|--------|---------------|----------|-------------|------------|
| DHL | Public REST API | No | ~2000+ | Optional | Yes |
| PostNL | Public Widget API | No | High | No | No |
| DPD | Public REST API | No | ~1900 | Yes (recommended) | No |
| Amazon | OSM Overpass API | No | Low (community data) | Optional | No |
| VintedGo | Web Scraping | No | Medium | No | No |
| De Buren | Web Scraping | No | Low | No | No |

**Notes**:
- **Grid Fetch**: Providers using grid-based approach for complete nationwide coverage
- **Cache-Based**: Recommended to run fetch once and cache results for faster municipality generation
