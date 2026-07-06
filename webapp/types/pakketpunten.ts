export interface Municipality {
  name: string;
  slug: string;
  province: string;
  population: number;
}

export interface PakketpuntProperties {
  type: 'pakketpunt';
  locatieNaam: string;
  straatNaam: string;
  straatNr: string;
  vervoerder: 'DHL' | 'PostNL' | 'VintedGo' | 'DeBuren' | 'DPD' | 'Amazon' | 'GLS' | 'ViaTim' | 'InPost' | 'Budbee';
  puntType: string;
  bezettingsgraad: number;
  latitude: number;
  longitude: number;
  canPickup: boolean;
  canDropoff: boolean;
}

export interface BufferProperties {
  type: 'buffer_union_300m' | 'buffer_union_400m' | 'boundary';
  buffer_m?: number;
  gemeente?: string;
}

export type FeatureProperties = PakketpuntProperties | BufferProperties;

export interface PakketpuntFeature {
  type: 'Feature';
  geometry: {
    type: 'Point' | 'Polygon' | 'MultiPolygon';
    coordinates: number[] | number[][] | number[][][];
  };
  properties: FeatureProperties;
}

export interface PakketpuntData {
  type: 'FeatureCollection';
  metadata: {
    gemeente: string;
    slug: string;
    generated_at: string;
    total_points: number;
    providers: string[];
    bounds: [number, number, number, number]; // [minx, miny, maxx, maxy]
  };
  features: PakketpuntFeature[];
}

export interface Filters {
  providers: string[];
  showBuffer300: boolean;
  showBuffer400: boolean;
  showBufferFill: boolean;
  bufferMerged: boolean;
  showBoundary: boolean;
  showPC4: boolean;
  showPainPoints: boolean;
  showPopulation: boolean;
  showCoverage: boolean;
  showSuggestions: boolean;
  coverageLevel: CoverageLevel;
  coverageSubset: CoverageSubset;
  coverageDistance: CoverageDistance;
  coverageScope: CoverageScope;
  useSimpleMarkers: boolean;
  minOccupancy: number;
  maxOccupancy: number;
  showMockData: boolean;
  pointCategories: PointCategory[];
  showOnlySharedLocations: boolean;
  serviceFilters: ServiceFilter[];
  // Active POI categories (slugs from /data/poi/index.json). When non-empty,
  // the Map lazy-loads each category and renders it as a coloured CircleMarker
  // overlay. Empty array means no POI layer is rendered.
  poiCategories: string[];
  // 'dots'  → coloured CircleMarker (fastest, used for dense layers like bus stops)
  // 'icons' → Lucide divIcon with category-specific glyph (prettier, slower)
  poiIconStyle: 'dots' | 'icons';
}

// Population-coverage choropleth (data sourced from population_coverage.json)
export type CoverageLevel    = 'pc4' | 'gemeente';
export type CoverageSubset   = 'total' | 'shop' | 'locker';
export type CoverageDistance = '300m' | '400m' | '500m';
// 'strict' only meaningful at gemeente level; PC4 layer always uses national
export type CoverageScope    = 'national' | 'strict';

// Service capability filter: pickup (receive) vs dropoff (send)
export type ServiceFilter = 'pickup' | 'dropoff';

// Normalized point category: locker (automated) vs shop (staffed)
export type PointCategory = 'locker' | 'shop';

// Mapping of carrier-specific puntType values to normalized categories
// Lockers (automated machines):
//   - DHL: packStation
//   - PostNL: automaat
//   - DPD: dpd_box
//   - Amazon: locker
//   - DeBuren: Buitenkluis
//   - GLS: locker
// Shops (staffed locations):
//   - DHL: parcelShop
//   - PostNL: servicepunt
//   - DPD: pickup_point
//   - Amazon: 3p (3rd party counter)
//   - VintedGo: parcel_shop, social
//   - DeBuren: Afhaalpunt, Afhaalcentrum
//   - GLS: parcel_shop
//   - ViaTim: servicepunt (all are staffed shops)
//   - InPost: servicepunt (PUDO shops), automaat (parcel lockers)
//   - Budbee: automaat (all are parcel lockers)
const LOCKER_TYPES = new Set([
  'packStation',      // DHL
  'automaat',         // PostNL, InPost, Budbee
  'dpd_box',          // DPD
  'locker',           // Amazon, VintedGo
  'Buitenkluis',      // DeBuren
]);

export function getPointCategory(puntType: string): PointCategory {
  return LOCKER_TYPES.has(puntType) ? 'locker' : 'shop';
}

export function getCategoryLabel(category: PointCategory): string {
  return category === 'locker' ? 'Pakketautomaat' : 'Pakketpunt';
}
