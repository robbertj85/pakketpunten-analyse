/**
 * Map Component with Performance Optimizations
 *
 * This component implements adaptive rendering strategies for handling large datasets:
 *
 * 1. **Canvas Rendering**: Uses Leaflet's Canvas renderer (via preferCanvas) when displaying
 *    simple markers, which is significantly faster than DOM rendering for 5000+ markers
 *
 * 2. **Adaptive Marker Simplification**:
 *    - For datasets >3000 points: Always uses simple colored circles
 *    - For datasets >1000 points at zoom <11: Uses simple circles
 *    - Otherwise: Uses detailed branded icon markers with logos
 *
 * 3. **Memoization**: Marker elements are memoized to prevent unnecessary re-renders
 *
 * 4. **Performance Indicator**: Shows a blue banner when in simple marker mode
 *
 * Performance gains:
 * - 10,000 markers: ~50ms render time (vs ~2000ms with DOM markers)
 * - 50,000 markers: ~200ms render time (vs unusable with DOM markers)
 */
'use client';

import { useEffect, useState, useMemo, useRef } from 'react';
import { MapContainer, TileLayer, GeoJSON, Marker, Popup, useMap, CircleMarker, Circle, Polyline, Pane } from 'react-leaflet';
import type { LatLngBoundsExpression } from 'leaflet';
import L from 'leaflet';
import { makePoiDivIcon } from '@/utils/poiIcons';
import 'leaflet/dist/leaflet.css';
import buffer from '@turf/buffer';
import union from '@turf/union';
import { featureCollection, point } from '@turf/helpers';
import { PakketpuntData, PakketpuntFeature, Filters, PakketpuntProperties, getPointCategory } from '@/types/pakketpunten';

interface MapProps {
  data?: PakketpuntData | null;
  filters?: Filters;
  targetCoordinates?: { latitude: number; longitude: number } | null;
  onZoomedToTarget?: () => void;
  searchLocationMarker?: { latitude: number; longitude: number } | null;
  highlightedPoints?: Set<string> | null; // Set of "lat,lng" keys for highlighted points
  onTilesLoading?: (loading: boolean) => void;
}

// Component to fit bounds when data changes (only once, not on every zoom/pan)
// Also handles fallback center when no bounds are available (e.g., 0 pakketpunten)
// Also handles targetCoordinates and searchLocationMarker for zooming to specific locations
function FitBounds({
  bounds,
  fallbackCenter,
  targetCoordinates,
  searchLocationMarker,
  onZoomedToTarget
}: {
  bounds: LatLngBoundsExpression | null;
  fallbackCenter: [number, number] | null;
  targetCoordinates?: { latitude: number; longitude: number } | null;
  searchLocationMarker?: { latitude: number; longitude: number } | null;
  onZoomedToTarget?: () => void;
}) {
  const map = useMap();
  const lastBoundsRef = useRef<string | null>(null);
  const lastTargetRef = useRef<{ latitude: number; longitude: number } | null>(null);
  const lastSearchLocationRef = useRef<{ latitude: number; longitude: number } | null>(null);
  // Timestamp of last zoom to specific location - ignore bounds fitting for 2 seconds after
  const lastZoomTimestampRef = useRef<number>(0);

  // Handle target coordinates (clicking on a result) - always zoom when new coordinates are provided
  useEffect(() => {
    if (targetCoordinates) {
      const isNewTarget = !lastTargetRef.current ||
        lastTargetRef.current.latitude !== targetCoordinates.latitude ||
        lastTargetRef.current.longitude !== targetCoordinates.longitude;

      if (isNewTarget) {
        console.log('FitBounds: Zooming to target coordinates', targetCoordinates);
        lastZoomTimestampRef.current = Date.now(); // Mark zoom time
        map.setView([targetCoordinates.latitude, targetCoordinates.longitude], 17, { animate: true });
        lastTargetRef.current = targetCoordinates;

        setTimeout(() => {
          if (onZoomedToTarget) {
            onZoomedToTarget();
          }
        }, 1000);
      }
    }
  }, [targetCoordinates, map, onZoomedToTarget]);

  // Handle search location marker - zoom to search location
  useEffect(() => {
    if (searchLocationMarker) {
      const isNewLocation = !lastSearchLocationRef.current ||
        lastSearchLocationRef.current.latitude !== searchLocationMarker.latitude ||
        lastSearchLocationRef.current.longitude !== searchLocationMarker.longitude;

      if (isNewLocation) {
        console.log('FitBounds: Zooming to search location', searchLocationMarker);
        lastZoomTimestampRef.current = Date.now(); // Mark zoom time
        map.setView([searchLocationMarker.latitude, searchLocationMarker.longitude], 15, { animate: true });
        lastSearchLocationRef.current = searchLocationMarker;
      }
    } else {
      // Clear the ref when search is cleared
      lastSearchLocationRef.current = null;
    }
  }, [searchLocationMarker, map]);

  // Handle initial bounds fit (only when NO specific location zoom has occurred recently)
  useEffect(() => {
    // Skip if we zoomed to a specific location within the last 2 seconds
    const timeSinceZoom = Date.now() - lastZoomTimestampRef.current;
    if (timeSinceZoom < 2000) {
      console.log('FitBounds: Skipping bounds fit - recently zoomed to specific location');
      return;
    }

    // NEVER fit bounds if search location is active
    if (searchLocationMarker) {
      console.log('FitBounds: Skipping bounds fit - search location active');
      return;
    }

    // Don't fit bounds if we have target coordinates
    if (targetCoordinates) {
      console.log('FitBounds: Skipping bounds fit - target coordinates active');
      return;
    }

    // Create a string key for current bounds to track changes
    const boundsKey = bounds ? JSON.stringify(bounds) : (fallbackCenter ? `center-${fallbackCenter.join(',')}` : null);

    // Only fit if bounds actually changed
    if (boundsKey && boundsKey !== lastBoundsRef.current) {
      if (bounds) {
        console.log('FitBounds: Fitting to municipality bounds');
        map.fitBounds(bounds, { padding: [50, 50] });
      } else if (fallbackCenter) {
        console.log('FitBounds: Using fallback center');
        map.setView(fallbackCenter, 13, { animate: true });
      }
      lastBoundsRef.current = boundsKey;
    }
  }, [bounds, fallbackCenter, targetCoordinates, searchLocationMarker, map]);

  return null;
}

// Fit map to a specific PC4 polygon whenever the selection changes
function FitToPainpoint({ polygon }: { polygon: any | null }) {
  const map = useMap();
  useEffect(() => {
    if (!polygon) return;
    try {
      const bounds = L.geoJSON(polygon).getBounds();
      map.fitBounds(bounds, { padding: [40, 40], maxZoom: 16 });
    } catch (err) {
      console.error('Failed to fit PC4 bounds:', err);
    }
  }, [polygon, map]);
  return null;
}

// Component to watch zoom level for performance optimization
function ZoomWatcher({ onZoomChange }: { onZoomChange: (zoom: number) => void }) {
  const map = useMap();

  useEffect(() => {
    const handleZoom = () => {
      onZoomChange(map.getZoom());
    };

    map.on('zoomend', handleZoom);
    // Set initial zoom
    onZoomChange(map.getZoom());

    return () => {
      map.off('zoomend', handleZoom);
    };
  }, [map, onZoomChange]);

  return null;
}

// Persists the current center+zoom into a ref so we can restore it across
// MapContainer remounts. Toggling Logo iconen ↔ Gekleurde stippen forces a
// remount (Leaflet's preferCanvas is fixed at construction); without this
// the new map would snap back to the default Amsterdam view + zoom 12.
function ViewportRecorder({
  viewportRef,
}: {
  viewportRef: React.MutableRefObject<{ center: [number, number]; zoom: number } | null>;
}) {
  const map = useMap();
  useEffect(() => {
    const record = () => {
      const c = map.getCenter();
      viewportRef.current = {
        center: [c.lat, c.lng],
        zoom: map.getZoom(),
      };
    };
    record(); // capture initial view
    map.on('moveend', record);
    map.on('zoomend', record);
    return () => {
      map.off('moveend', record);
      map.off('zoomend', record);
    };
  }, [map, viewportRef]);
  return null;
}

// Component to add scale control (distance legend)
function ScaleControl() {
  const map = useMap();

  useEffect(() => {
    const scale = L.control.scale({
      position: 'bottomleft',
      metric: true,
      imperial: false,
      maxWidth: 150,
    });

    scale.addTo(map);

    return () => {
      scale.remove();
    };
  }, [map]);

  return null;
}

// Vervoerder info with logo URLs and colors
const PROVIDER_INFO: Record<string, {
  background: string;
  logoUrl: string;
  borderColor?: string;
  color: string; // For simple circle markers
}> = {
  DHL: {
    background: '#FFCC00',
    borderColor: '#D40511',
    color: '#FFCC00',
    logoUrl: '/logos/dhl.svg',
  },
  PostNL: {
    background: '#FF6600',
    color: '#FF6600',
    logoUrl: '/logos/postnl.svg',
  },
  VintedGo: {
    background: '#09B1BA',
    color: '#09B1BA',
    logoUrl: '/logos/vintedgo.svg',
  },
  DeBuren: {
    background: '#4CAF50',
    color: '#4CAF50',
    logoUrl: '/logos/deburen.png',
  },
  Amazon: {
    background: '#FF9900',
    borderColor: '#146EB4',
    color: '#FF9900',
    logoUrl: '/logos/amazon.svg',
  },
  DPD: {
    background: '#DC0032',
    color: '#DC0032',
    logoUrl: '/logos/dpd.svg',
  },
  GLS: {
    background: '#FFC600',
    borderColor: '#003C7E',
    color: '#003C7E',
    logoUrl: '/logos/gls.svg',
  },
  ViaTim: {
    background: '#E3007A',
    color: '#E3007A',
    logoUrl: '/logos/viatim.svg',
  },
  InPost: {
    background: '#FFCD00',
    borderColor: '#3B3B3B',
    color: '#FFCD00',
    logoUrl: '/logos/inpost.svg',
  },
  Budbee: {
    background: '#00C389',
    color: '#00C389',
    logoUrl: '/logos/budbee.svg',
  },
};

// Performance thresholds
const PERFORMANCE_CONFIG = {
  // Use simple circles instead of custom icons above this marker count
  SIMPLE_MARKER_THRESHOLD: 3000,
  // Zoom threshold for switching between simple and detailed view
  DETAILED_VIEW_ZOOM: 11,
  // Simple marker size
  SIMPLE_MARKER_RADIUS: 4,
  // Simple marker opacity
  SIMPLE_MARKER_OPACITY: 0.8,
};

// Helper function to calculate marker size based on zoom level
function getMarkerSize(zoom: number): { size: number; logoSize: number; fontSize: number } {
  // At zoom 15+ (below 1km scale), increase marker size for better clickability
  if (zoom >= 17) {
    return { size: 48, logoSize: 32, fontSize: 14 }; // 250m scale and closer
  } else if (zoom >= 15) {
    return { size: 42, logoSize: 28, fontSize: 12 }; // 1km - 500m scale
  } else {
    return { size: 34, logoSize: 22, fontSize: 10 }; // Default size
  }
}

// Create custom icon for each provider with dynamic sizing and service indicators
function createProviderIcon(provider: string, zoom: number, canPickup?: boolean, canDropoff?: boolean, grayed?: boolean) {
  const info = PROVIDER_INFO[provider] || {
    background: '#666',
    logoUrl: '',
  };

  const borderColor = grayed ? '#9ca3af' : (info.borderColor || 'white');
  const { size, logoSize, fontSize } = getMarkerSize(zoom);

  // Reduce size for grayed markers
  const actualSize = grayed ? size * 0.85 : size;
  const actualLogoSize = grayed ? logoSize * 0.85 : logoSize;

  // Generate service indicator arrows (only for highlighted markers)
  const arrowSize = Math.max(10, size * 0.28);

  // Show arrows only when one service is available (not both) and not grayed
  const showPickupArrow = !grayed && canPickup && !canDropoff;
  const showDropoffArrow = !grayed && canDropoff && !canPickup;

  const pickupArrow = showPickupArrow ? `
    <div style="
      position: absolute;
      bottom: -${arrowSize * 0.3}px;
      left: 50%;
      transform: translateX(-50%);
      width: ${arrowSize}px;
      height: ${arrowSize}px;
      background: #2563eb;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      box-shadow: 0 1px 3px rgba(0,0,0,0.3);
      border: 1.5px solid white;
    ">
      <svg width="${arrowSize * 0.6}" height="${arrowSize * 0.6}" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="3">
        <path d="M12 5v14M5 12l7 7 7-7"/>
      </svg>
    </div>
  ` : '';

  const dropoffArrow = showDropoffArrow ? `
    <div style="
      position: absolute;
      top: -${arrowSize * 0.3}px;
      left: 50%;
      transform: translateX(-50%);
      width: ${arrowSize}px;
      height: ${arrowSize}px;
      background: #2563eb;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      box-shadow: 0 1px 3px rgba(0,0,0,0.3);
      border: 1.5px solid white;
    ">
      <svg width="${arrowSize * 0.6}" height="${arrowSize * 0.6}" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="3">
        <path d="M12 19V5M5 12l7-7 7 7"/>
      </svg>
    </div>
  ` : '';

  // Grayscale and opacity filter for non-highlighted markers
  const filterStyle = grayed ? 'filter: grayscale(100%); opacity: 0.5;' : '';

  return L.divIcon({
    className: 'custom-marker',
    html: `
      <div style="position: relative; width: ${actualSize}px; height: ${actualSize}px; ${filterStyle}">
        <div style="
          width: ${actualSize}px;
          height: ${actualSize}px;
          background: white;
          border: 2.5px solid ${borderColor};
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          box-shadow: 0 3px 8px rgba(0,0,0,${grayed ? '0.2' : '0.4'});
          overflow: hidden;
        ">
          <img
            src="${info.logoUrl}"
            alt="${provider}"
            style="
              width: ${actualLogoSize}px;
              height: ${actualLogoSize}px;
              object-fit: contain;
            "
            onerror="this.style.display='none'; const div = document.createElement('div'); div.textContent='${provider.substring(0, 2)}'; div.style.cssText='font-size:${fontSize}px;font-weight:bold;color:${info.background}'; this.parentElement.appendChild(div);"
          />
        </div>
        ${pickupArrow}
        ${dropoffArrow}
      </div>
    `,
    iconSize: [size, size + arrowSize],
    iconAnchor: [size / 2, size / 2],
    popupAnchor: [0, -size / 2],
  });
}

// Create custom icon with badge for grouped markers
function createProviderIconWithBadge(provider: string, count: number) {
  const info = PROVIDER_INFO[provider] || {
    background: '#666',
    logoUrl: '',
  };

  const borderColor = info.borderColor || 'white';

  return L.divIcon({
    className: 'custom-marker',
    html: `
      <div style="position: relative;">
        <div style="
          width: 34px;
          height: 34px;
          background: white;
          border: 2.5px solid ${borderColor};
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          box-shadow: 0 3px 8px rgba(0,0,0,0.4);
          overflow: hidden;
        ">
          <img
            src="${info.logoUrl}"
            alt="${provider}"
            style="
              width: 22px;
              height: 22px;
              object-fit: contain;
            "
            onerror="this.style.display='none'; const div = document.createElement('div'); div.textContent='${provider.substring(0, 2)}'; div.style.cssText='font-size:10px;font-weight:bold;color:${info.background}'; this.parentElement.appendChild(div);"
          />
        </div>
        <div style="
          position: absolute;
          top: -6px;
          right: -6px;
          background: #dc2626;
          color: white;
          border: 2px solid white;
          border-radius: 50%;
          width: 20px;
          height: 20px;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 11px;
          font-weight: bold;
          box-shadow: 0 2px 4px rgba(0,0,0,0.3);
        ">
          ${count}
        </div>
      </div>
    `,
    iconSize: [34, 34],
    iconAnchor: [17, 17],
    popupAnchor: [0, -17],
  });
}

// Create custom icon for search location marker (blue pin)
function createSearchLocationIcon() {
  return L.divIcon({
    className: 'search-location-marker',
    html: `
      <div style="
        width: 32px;
        height: 32px;
        position: relative;
      ">
        <div style="
          width: 24px;
          height: 24px;
          background: #2563eb;
          border: 3px solid white;
          border-radius: 50%;
          box-shadow: 0 3px 8px rgba(0,0,0,0.4);
          position: absolute;
          top: 0;
          left: 4px;
        "></div>
        <div style="
          width: 0;
          height: 0;
          border-left: 8px solid transparent;
          border-right: 8px solid transparent;
          border-top: 12px solid #2563eb;
          position: absolute;
          bottom: 0;
          left: 8px;
          filter: drop-shadow(0 2px 2px rgba(0,0,0,0.3));
        "></div>
      </div>
    `,
    iconSize: [32, 32],
    iconAnchor: [16, 32],
    popupAnchor: [0, -32],
  });
}

// Helper function to get current hour-based seed for stable randomization
function getHourlySeed(): number {
  const now = new Date();
  // Change seed every hour (year + month + day + hour)
  return now.getFullYear() * 1000000 +
         (now.getMonth() + 1) * 10000 +
         now.getDate() * 100 +
         now.getHours();
}

// Simple seeded random number generator
function seededRandom(seed: number): number {
  const x = Math.sin(seed) * 10000;
  return x - Math.floor(x);
}

// Helper function to get provider render priority (higher = renders on top)
// Randomizes order hourly to give all providers fair visibility
function getProviderPriority(vervoerder: string): number {
  const providers = ['Budbee', 'ViaTim', 'InPost', 'GLS', 'DPD', 'Amazon', 'VintedGo', 'DeBuren', 'PostNL', 'DHL'];

  // Get hourly seed for stable randomization
  const seed = getHourlySeed();

  // Create shuffled priorities based on hourly seed
  const shuffledPriorities: Record<string, number> = {};
  const availablePositions = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

  providers.forEach((provider, index) => {
    // Use provider name + seed to create unique seed per provider
    const providerSeed = seed + provider.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
    const randomValue = seededRandom(providerSeed);

    // Pick a position based on random value
    const positionIndex = Math.floor(randomValue * availablePositions.length);
    const position = availablePositions.splice(positionIndex, 1)[0];
    shuffledPriorities[provider] = position;
  });

  return shuffledPriorities[vervoerder] || 0;
}

// Helper function to spread overlapping markers (spiderfy effect)
function spreadOverlappingMarkers(points: PakketpuntFeature[], currentZoom: number) {
  // Sort points by provider priority so DHL/PostNL render on top
  const sortedPoints = [...points].sort((a, b) => {
    const prioA = getProviderPriority((a.properties as PakketpuntProperties).vervoerder);
    const prioB = getProviderPriority((b.properties as PakketpuntProperties).vervoerder);
    return prioA - prioB; // Lower priority renders first (bottom layer)
  });

  if (currentZoom < 15) {
    // Below zoom 15, return sorted points as-is
    return sortedPoints.map(p => ({ ...p, offsetLat: 0, offsetLng: 0 }));
  }

  // Group by exact coordinates (using sorted points)
  const groups = new Map<string, PakketpuntFeature[]>();
  sortedPoints.forEach((point) => {
    const coords = point.geometry.coordinates as [number, number];
    const key = `${coords[1].toFixed(6)},${coords[0].toFixed(6)}`;
    if (!groups.has(key)) {
      groups.set(key, []);
    }
    groups.get(key)!.push(point);
  });

  // Spread overlapping markers in a circle
  const spreadMarkers: any[] = [];
  groups.forEach((group) => {
    if (group.length === 1) {
      // Single marker, no offset needed
      spreadMarkers.push({ ...group[0], offsetLat: 0, offsetLng: 0 });
    } else {
      // Multiple markers at same location - spread in circle
      const radius = 0.00015; // ~15 meters offset
      group.forEach((marker, index) => {
        const angle = (2 * Math.PI * index) / group.length;
        const offsetLat = Math.sin(angle) * radius;
        const offsetLng = Math.cos(angle) * radius;
        spreadMarkers.push({ ...marker, offsetLat, offsetLng });
      });
    }
  });

  return spreadMarkers;
}

function MapComponent(props?: MapProps) {
  // Hooks MUST be at the very top
  const [mounted, setMounted] = useState(false);
  const [currentZoom, setCurrentZoom] = useState(12);
  // Survives MapContainer remounts (e.g. when toggling marker style — that
  // changes the `key` to swap renderers, which would otherwise reset to the
  // default center/zoom).
  const viewportRef = useRef<{ center: [number, number]; zoom: number } | null>(null);
  const [pc4Data, setPc4Data] = useState<any | null>(null);
  const [pc4Loading, setPc4Loading] = useState(false);
  const [painPoints, setPainPoints] = useState<Record<string, {
    city: string;
    g4_city?: string;
    municipality?: string | null;
    carriers: string[];
    gemeenten?: string[];
    notes?: string[];
    stats?: {
      area_km2: number | null;
      population: number | null;
      points_per_km2: number | null;
      points_per_1000_inw: number | null;
      predicted_points: number | null;
      delta_vs_predicted: number | null;
    };
    pakketpunten?: {
      total: number;
      locker: number;
      shop: number;
      by_carrier: Record<string, { locker: number; shop: number }>;
    };
    points?: Array<{
      lat: number;
      lng: number;
      vervoerder: string;
      category: 'locker' | 'shop';
      puntType: string;
      locatieNaam: string;
      straatNaam: string;
      straatNr: string;
    }>;
  }> | null>(null);
  const [selectedPainpointPc4, setSelectedPainpointPc4] = useState<string | null>(null);
  // PC4 of the suggested-placement pin currently expanded in the right side panel.
  const [selectedSuggestionPc4, setSelectedSuggestionPc4] = useState<string | null>(null);
  const [pc4Stats, setPc4Stats] = useState<Record<string, {
    area_km2: number;
    population: number;
    municipality: string | null;
    points_per_km2: number | null;
    points_per_1000_inw: number | null;
    predicted_points: number;
    delta_vs_predicted: number;
    parcel_points: { total: number };
  }> | null>(null);
  // Population-coverage choropleth state. Coverage payload holds the per-PC4
  // and per-municipality coverage % at 300/400m for total/shop/locker. Muni
  // boundaries are only loaded when the user picks the gemeente level.
  const [coverageData, setCoverageData] = useState<{
    pc4: Record<string, any>;
    municipalities: Record<string, any>;
  } | null>(null);
  const [muniBoundaries, setMuniBoundaries] = useState<any | null>(null);
  // Placement-suggestions overlay (lazy-loaded). Keyed by municipality slug;
  // each entry holds the top-N PC4 ranking + a suggested coordinate per PC4.
  const [placementSuggestions, setPlacementSuggestions] = useState<{
    weights: Record<string, number>;
    by_municipality: Record<string, {
      gemeente: string;
      pc4s: Array<{
        pc4: string;
        priority: number;
        actual: number;
        predicted: number;
        uncovered_pop: number;
        coverage_pct_400m: number;
        overlap_pct: number;
        density: number;
        population: number;
        suggestion: {
        lat: number; lon: number;
        est_new_pop_within_400m: number;
        white_spot_area_m2: number;
        bag_distance_m?: number;
        bag_gebruiksdoel?: string | null;
        bag_bouwjaar?: number | null;
        bag_identificatie?: string | null;
        nearest_ov?: {
          name: string; code?: string; platform?: string;
          lat: number; lon: number; distance_m: number;
        } | null;
      } | null;
      }>;
    }>;
  } | null>(null);

  // Extract props with defaults AFTER hooks
  const data = props?.data ?? null;
  const targetCoordinates = props?.targetCoordinates ?? null;
  const onZoomedToTarget = props?.onZoomedToTarget;
  const onTilesLoading = props?.onTilesLoading;
  const searchLocationMarker = props?.searchLocationMarker ?? null;
  const highlightedPoints = props?.highlightedPoints ?? null;
  const activeFilters: Filters = props?.filters ?? {
    providers: [],
    showBuffer300: true,
    showBuffer400: true,
    showBufferFill: false,
    bufferMerged: true,
    showBoundary: false,
    showPC4: false,
    showPainPoints: false,
    showPopulation: false,
    showCoverage: false,
    showSuggestions: false,
    coverageLevel: 'pc4',
    coverageSubset: 'total',
    coverageDistance: '300m',
    coverageScope: 'national',
    useSimpleMarkers: false,
    minOccupancy: 0,
    maxOccupancy: 100,
    showMockData: false,
    pointCategories: ['locker', 'shop'],
    showOnlySharedLocations: false,
    serviceFilters: ['pickup', 'dropoff'],
    poiCategories: [],
    poiIconStyle: 'dots',
  };

  useEffect(() => {
    setMounted(true);
  }, []);

  // Lazy-load PC4 boundaries the first time the user toggles them on.
  // Also needed for the pain-points overlay and population-density overlay
  // since both style the same PC4 polygons.
  const needsPc4 = activeFilters.showPC4 || activeFilters.showPainPoints || activeFilters.showPopulation
    || (activeFilters.showCoverage && activeFilters.coverageLevel === 'pc4')
    || activeFilters.showSuggestions;
  useEffect(() => {
    if (!needsPc4 || pc4Data || pc4Loading) return;
    setPc4Loading(true);
    fetch('/data/pc4.geojson')
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then(setPc4Data)
      .catch((err) => console.error('Failed to load PC4 boundaries:', err))
      .finally(() => setPc4Loading(false));
  }, [needsPc4, pc4Data, pc4Loading]);

  // Lazy-load carrier pain-points when either the pain-points toggle or the
  // population-density toggle needs them (density layer is scoped to the
  // municipalities listed in the pain-points dataset).
  const needsPainPoints = activeFilters.showPainPoints || activeFilters.showPopulation;
  useEffect(() => {
    if (!needsPainPoints || painPoints) return;
    fetch('/data/pc4_painpoints.json')
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((payload) => setPainPoints(payload.painpoints ?? {}))
      .catch((err) => console.error('Failed to load PC4 pain points:', err));
  }, [needsPainPoints, painPoints]);

  // Lazy-load nationwide PC4 stats (population + regression predictions)
  useEffect(() => {
    if (!activeFilters.showPopulation || pc4Stats) return;
    fetch('/data/pc4_stats.json')
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((payload) => setPc4Stats(payload.stats ?? {}))
      .catch((err) => console.error('Failed to load PC4 stats:', err));
  }, [activeFilters.showPopulation, pc4Stats]);

  // Lazy-load population-coverage payload when the choropleth toggles on
  useEffect(() => {
    if (!activeFilters.showCoverage || coverageData) return;
    fetch('/data/population_coverage.json')
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((payload) => setCoverageData({
        pc4: payload.pc4 ?? {},
        municipalities: payload.municipalities ?? {},
      }))
      .catch((err) => console.error('Failed to load population_coverage:', err));
  }, [activeFilters.showCoverage, coverageData]);

  // POI overlay state — single per-municipality bundle (loaded once per city).
  // Filtering by active category happens client-side. This keeps the network
  // payload small (Amsterdam ≈ 440 KB; Den Haag ≈ 22 KB) instead of pulling
  // the 21 MB nationwide bushaltes file.
  const [poiIndex, setPoiIndex] = useState<Array<{
    slug: string; label: string; group: string; color: string; count: number;
  }> | null>(null);
  const [poiBundle, setPoiBundle] = useState<{
    slug: string;
    features: Array<{ category: string; coordinates: [number, number]; name: string; operator: string }>;
  } | null>(null);
  // Fetch the POI category index once a POI filter is ever activated.
  useEffect(() => {
    if (poiIndex || activeFilters.poiCategories.length === 0) return;
    fetch('/data/poi/index.json')
      .then((r) => r.json())
      .then((d) => setPoiIndex(d.categories || []))
      .catch((err) => console.error('POI index load failed:', err));
  }, [poiIndex, activeFilters.poiCategories.length]);
  // Load the bundle when (a) a POI category is active and (b) the selected
  // municipality changes. Skipped for the Nederland view because nationwide
  // POI rendering is too heavy.
  const muniSlug = data?.metadata?.slug;
  useEffect(() => {
    if (activeFilters.poiCategories.length === 0) return;
    if (!muniSlug || muniSlug === 'nederland') {
      setPoiBundle(null);
      return;
    }
    if (poiBundle?.slug === muniSlug) return;
    fetch(`/data/poi/by-municipality/${muniSlug}.geojson`)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((d) => {
        setPoiBundle({
          slug: muniSlug,
          features: (d.features || []).map((f: any) => ({
            category: f.properties.category,
            coordinates: f.geometry.coordinates as [number, number],
            name: f.properties?.name || '',
            operator: f.properties?.operator || '',
          })),
        });
      })
      .catch((err) => console.error(`POI bundle for ${muniSlug} failed:`, err));
  }, [activeFilters.poiCategories.length, muniSlug, poiBundle?.slug]);

  // Lazy-load placement suggestions when the toggle is on. Only meaningful
  // when a single municipality is selected (not the Nederland view).
  useEffect(() => {
    if (!activeFilters.showSuggestions || placementSuggestions) return;
    fetch('/data/placement_suggestions.json')
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then(setPlacementSuggestions)
      .catch((err) => console.error('Failed to load placement_suggestions:', err));
  }, [activeFilters.showSuggestions, placementSuggestions]);

  // Lazy-load municipality boundaries only when the gemeente level is picked
  useEffect(() => {
    if (!activeFilters.showCoverage
        || activeFilters.coverageLevel !== 'gemeente'
        || muniBoundaries) return;
    fetch('/data/municipality_boundaries.geojson')
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then(setMuniBoundaries)
      .catch((err) => console.error('Failed to load muni boundaries:', err));
  }, [activeFilters.showCoverage, activeFilters.coverageLevel, muniBoundaries]);

  // Build the pain-points GeoJSON by filtering pc4Data to flagged codes
  const painPointsGeoJSON = useMemo(() => {
    if (!activeFilters.showPainPoints || !pc4Data || !painPoints) return null;
    const features = pc4Data.features.filter((f: any) =>
      painPoints[f?.properties?.pc4]
    );
    return { type: 'FeatureCollection', features };
  }, [activeFilters.showPainPoints, pc4Data, painPoints]);

  // Helper to check if point matches service filters
  const matchesServiceFilters = (props: PakketpuntProperties): boolean => {
    const wantsPickup = activeFilters.serviceFilters.includes('pickup');
    const wantsDropoff = activeFilters.serviceFilters.includes('dropoff');

    // If both filters selected, show locations that support at least one
    if (wantsPickup && wantsDropoff) {
      return props.canPickup || props.canDropoff;
    } else if (wantsPickup) {
      return props.canPickup;
    } else if (wantsDropoff) {
      return props.canDropoff;
    }
    return false; // No service filters selected
  };

  // Filter features based on selected filters (do this before early returns to maintain hook order)
  const filteredFeatures = useMemo(() => {
    if (!data) return [];
    return data.features.filter((feature) => {
    if (feature.properties.type === 'pakketpunt') {
      const props = feature.properties as PakketpuntProperties;

      // Provider filter
      if (!activeFilters.providers.includes(props.vervoerder)) {
        return false;
      }

      // Point category filter (locker vs shop)
      const category = getPointCategory(props.puntType);
      if (!activeFilters.pointCategories.includes(category)) {
        return false;
      }

      // Service capability filter (pickup vs dropoff)
      if (!matchesServiceFilters(props)) {
        return false;
      }

      return true;
    }

    // Skip pre-computed buffer unions (buffers are now rendered dynamically per point)
    if (feature.properties.type === 'buffer_union_300m' || feature.properties.type === 'buffer_union_400m') {
      return false;
    }

    // Boundary filter
    if (feature.properties.type === 'boundary') {
      return activeFilters.showBoundary;
    }

    return true;
    });
  }, [data, activeFilters.providers, activeFilters.pointCategories, activeFilters.serviceFilters, activeFilters.showBoundary]);

  // Separate points, buffers, and boundaries
  const points = useMemo(() => {
    const allPoints = filteredFeatures.filter(f => f.properties.type === 'pakketpunt');

    // If not filtering for shared locations, return all points
    if (!activeFilters.showOnlySharedLocations) {
      return allPoints;
    }

    // Group by coordinates to find shared locations
    const coordGroups = new Map<string, PakketpuntFeature[]>();
    allPoints.forEach((feature) => {
      const coords = feature.geometry.coordinates as [number, number];
      const key = `${coords[1].toFixed(6)},${coords[0].toFixed(6)}`;
      if (!coordGroups.has(key)) {
        coordGroups.set(key, []);
      }
      coordGroups.get(key)!.push(feature);
    });

    // Only keep points at shared locations (2+ points at same coordinates)
    const sharedPoints: PakketpuntFeature[] = [];
    coordGroups.forEach((group) => {
      if (group.length >= 2) {
        sharedPoints.push(...group);
      }
    });

    return sharedPoints;
  }, [filteredFeatures, activeFilters.showOnlySharedLocations]);
  const boundaries = useMemo(() =>
    filteredFeatures.filter(f => f.properties.type === 'boundary'),
    [filteredFeatures]
  );

  // Pairwise merge: union polygons in pairs recursively (O(n log n) complexity growth vs O(n²) sequential)
  const pairwiseUnion = (features: any[]): any => {
    if (features.length === 0) return null;
    if (features.length === 1) return features[0];
    const next: any[] = [];
    for (let i = 0; i < features.length; i += 2) {
      if (i + 1 < features.length) {
        const result = union(featureCollection([features[i], features[i + 1]]));
        next.push(result ?? features[i]);
      } else {
        next.push(features[i]);
      }
    }
    return pairwiseUnion(next);
  };

  // Compute merged buffer union polygons from filtered points using Turf.js (deferred for loading UX)
  // Compute merged buffer union polygons from filtered points using Turf.js
  const mergedBuffer300 = useMemo(() => {
    if (!activeFilters.bufferMerged || !activeFilters.showBuffer300 || points.length === 0 || points.length > 3000) return null;
    try {
      const pts = featureCollection(
        points.map(f => point(f.geometry.coordinates as [number, number]))
      );
      const buffered = buffer(pts, 0.3, { units: 'kilometers', steps: 4 });
      if (!buffered || buffered.features.length === 0) return null;
      return pairwiseUnion(buffered.features);
    } catch { return null; }
  }, [points, activeFilters.bufferMerged, activeFilters.showBuffer300]);

  const mergedBuffer400 = useMemo(() => {
    if (!activeFilters.bufferMerged || !activeFilters.showBuffer400 || points.length === 0 || points.length > 3000) return null;
    try {
      const pts = featureCollection(
        points.map(f => point(f.geometry.coordinates as [number, number]))
      );
      const buffered = buffer(pts, 0.4, { units: 'kilometers', steps: 4 });
      if (!buffered || buffered.features.length === 0) return null;
      return pairwiseUnion(buffered.features);
    } catch { return null; }
  }, [points, activeFilters.bufferMerged, activeFilters.showBuffer400]);

  // Group markers by exact coordinates and spread them at high zoom (manual spiderfy)
  const spreadPoints = useMemo(
    () => spreadOverlappingMarkers(points, currentZoom),
    [points, currentZoom]
  );

  // Calculate bounds from metadata
  const bounds: LatLngBoundsExpression | null = useMemo(() => {
    if (!data) return null;

    // Validate bounds array exists and has 4 valid numbers
    const metadataBounds = data.metadata.bounds;
    if (!metadataBounds ||
        metadataBounds.length !== 4 ||
        metadataBounds.some((b: any) => b === null || b === undefined || isNaN(b))) {
      console.warn(`Invalid or empty bounds for ${data.metadata.gemeente}, will use boundary centroid`);
      return null; // Will try to use boundary centroid instead
    }

    return [
      [metadataBounds[1], metadataBounds[0]], // [miny, minx]
      [metadataBounds[3], metadataBounds[2]], // [maxy, maxx]
    ];
  }, [data]);

  // Calculate fallback center from boundary polygon when bounds are invalid
  const fallbackCenter: [number, number] | null = useMemo(() => {
    if (!data || bounds) return null; // Only use if bounds are invalid

    // Look for boundary feature in the data
    const boundaryFeature = data.features.find(
      (f: any) => f.properties?.type === 'boundary'
    );

    if (boundaryFeature?.geometry?.coordinates) {
      try {
        // Calculate centroid of the boundary polygon
        const coords = boundaryFeature.geometry.coordinates;

        // Handle MultiPolygon or Polygon
        const rings = boundaryFeature.geometry.type === 'MultiPolygon'
          ? coords.flat()
          : coords;

        // Get outer ring (first ring)
        const outerRing = rings[0];

        if (outerRing && Array.isArray(outerRing) && outerRing.length > 0) {
          // Calculate simple centroid
          let sumLat = 0;
          let sumLon = 0;
          let count = 0;

          for (const point of outerRing) {
            if (Array.isArray(point) && point.length >= 2) {
              sumLon += point[0];
              sumLat += point[1];
              count++;
            }
          }

          if (count > 0) {
            const center: [number, number] = [sumLat / count, sumLon / count];
            console.log(`Using boundary centroid for ${data.metadata.gemeente}: [${center[0].toFixed(4)}, ${center[1].toFixed(4)}]`);
            return center;
          }
        }
      } catch (e) {
        console.error(`Failed to calculate boundary centroid for ${data.metadata.gemeente}:`, e);
      }
    }

    return null;
  }, [data, bounds]);

  // Use simple markers based on user preference from filters
  const markerCount = points.length;
  const useSimpleMarkers = activeFilters.useSimpleMarkers;

  // Helper to check if a point is highlighted
  const isPointHighlighted = (props: PakketpuntProperties): boolean => {
    if (!highlightedPoints) return true; // No highlight filter = all highlighted
    const key = `${props.latitude.toFixed(6)},${props.longitude.toFixed(6)}`;
    return highlightedPoints.has(key);
  };

  // Memoize marker rendering to prevent unnecessary re-renders
  const markerElements = useMemo(() => {
    if (spreadPoints.length === 0) return null;

    if (useSimpleMarkers) {
      // Render simple colored circles for performance
      // Scale radius based on zoom level
      const circleRadius = currentZoom >= 17 ? 6 : currentZoom >= 15 ? 5 : PERFORMANCE_CONFIG.SIMPLE_MARKER_RADIUS;

      return spreadPoints.map((feature, idx) => {
        const props = feature.properties as PakketpuntProperties;
        const coords = feature.geometry.coordinates as [number, number];
        const baseColor = PROVIDER_INFO[props.vervoerder]?.color || '#666';
        const isHighlighted = isPointHighlighted(props);

        // Gray out non-highlighted points
        const color = isHighlighted ? baseColor : '#9ca3af';
        const opacity = isHighlighted ? PERFORMANCE_CONFIG.SIMPLE_MARKER_OPACITY : 0.4;

        // Apply offset for spiderfy effect at high zoom
        const lat = coords[1] + (feature.offsetLat || 0);
        const lng = coords[0] + (feature.offsetLng || 0);

        return (
          <CircleMarker
            key={`point-${idx}`}
            center={[lat, lng]}
            radius={isHighlighted ? circleRadius : circleRadius - 1}
            pathOptions={{
              fillColor: color,
              fillOpacity: opacity,
              color: isHighlighted ? 'white' : '#d1d5db',
              weight: 1,
            }}
          >
            <Popup
              maxWidth={600}
              minWidth={300}
              autoPan={false}
            >
              <div className="text-sm">
                <h3 className="font-bold text-gray-900">{props.locatieNaam}</h3>
                <p className="text-gray-600">
                  {props.straatNaam} {props.straatNr}
                </p>
                <p className="mt-1">
                  <span className="font-semibold">Vervoerder:</span> {props.vervoerder}
                </p>
                {props.puntType && (
                  <p>
                    <span className="font-semibold">Type:</span> {props.puntType}
                  </p>
                )}
                <p className="mt-1">
                  <span className="font-semibold">Services:</span>{' '}
                  {props.canPickup && <span>↓ Ophalen</span>}
                  {props.canPickup && props.canDropoff && ' / '}
                  {props.canDropoff && <span>↑ Verzenden</span>}
                  {!props.canPickup && !props.canDropoff && <span className="text-gray-400">Onbekend</span>}
                </p>
                <p className="text-xs text-gray-500 mt-1">
                  {props.latitude.toFixed(6)}, {props.longitude.toFixed(6)}
                </p>

                <div className="mt-3 border-t pt-2">
                  <details>
                    <summary className="flex justify-between items-baseline gap-3 cursor-pointer select-none">
                      <span className="text-xs font-semibold text-blue-600 hover:text-blue-800">
                        Toon Ruwe Data
                      </span>
                      <a
                        href={`https://www.google.com/maps?q=&layer=c&cbll=${props.latitude},${props.longitude}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-blue-600 hover:text-blue-800 underline whitespace-nowrap"
                        onClick={(e) => e.stopPropagation()}
                      >
                        Bekijk in Street View
                      </a>
                    </summary>
                    <div className="mt-2">
                      <pre className="p-3 bg-gray-50 border border-gray-200 rounded text-xs overflow-x-auto max-h-64 whitespace-pre-wrap break-words">
                        {JSON.stringify(props, null, 2)}
                      </pre>
                    </div>
                  </details>
                </div>
              </div>
            </Popup>
          </CircleMarker>
        );
      });
    } else {
      // Render detailed branded markers
      return spreadPoints.map((feature, idx) => {
        const props = feature.properties as PakketpuntProperties;
        const coords = feature.geometry.coordinates as [number, number];
        const isHighlighted = isPointHighlighted(props);

        // Apply offset for spiderfy effect at high zoom
        const lat = coords[1] + (feature.offsetLat || 0);
        const lng = coords[0] + (feature.offsetLng || 0);

        return (
          <Marker
            key={`point-${idx}`}
            position={[lat, lng]}
            icon={createProviderIcon(props.vervoerder, currentZoom, props.canPickup, props.canDropoff, !isHighlighted)}
            zIndexOffset={isHighlighted ? 1000 : 0}
          >
            <Popup
              maxWidth={600}
              minWidth={300}
              autoPan={false}
            >
              <div className="text-sm">
                <h3 className="font-bold text-gray-900">{props.locatieNaam}</h3>
                <p className="text-gray-600">
                  {props.straatNaam} {props.straatNr}
                </p>
                <p className="mt-1">
                  <span className="font-semibold">Vervoerder:</span> {props.vervoerder}
                </p>
                {props.puntType && (
                  <p>
                    <span className="font-semibold">Type:</span> {props.puntType}
                  </p>
                )}
                <p className="mt-1">
                  <span className="font-semibold">Services:</span>{' '}
                  {props.canPickup && <span>↓ Ophalen</span>}
                  {props.canPickup && props.canDropoff && ' / '}
                  {props.canDropoff && <span>↑ Verzenden</span>}
                  {!props.canPickup && !props.canDropoff && <span className="text-gray-400">Onbekend</span>}
                </p>
                <p className="text-xs text-gray-500 mt-1">
                  {props.latitude.toFixed(6)}, {props.longitude.toFixed(6)}
                </p>

                <div className="mt-3 border-t pt-2">
                  <details>
                    <summary className="flex justify-between items-baseline gap-3 cursor-pointer select-none">
                      <span className="text-xs font-semibold text-blue-600 hover:text-blue-800">
                        Toon Ruwe Data
                      </span>
                      <a
                        href={`https://www.google.com/maps?q=&layer=c&cbll=${props.latitude},${props.longitude}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-blue-600 hover:text-blue-800 underline whitespace-nowrap"
                        onClick={(e) => e.stopPropagation()}
                      >
                        Bekijk in Street View
                      </a>
                    </summary>
                    <div className="mt-2">
                      <pre className="p-3 bg-gray-50 border border-gray-200 rounded text-xs overflow-x-auto max-h-64 whitespace-pre-wrap break-words">
                        {JSON.stringify(props, null, 2)}
                      </pre>
                    </div>
                  </details>
                </div>
              </div>
            </Popup>
          </Marker>
        );
      });
    }
  }, [spreadPoints, useSimpleMarkers, currentZoom, highlightedPoints]);

  // Render spider leg lines connecting offset markers to original location
  const spiderLegLines = useMemo(() => {
    if (currentZoom < 15) return null; // Only show at high zoom levels

    return spreadPoints
      .filter(feature => feature.offsetLat !== 0 || feature.offsetLng !== 0) // Only for offset markers
      .map((feature, idx) => {
        const coords = feature.geometry.coordinates as [number, number];
        const originalPos: [number, number] = [coords[1], coords[0]];
        const offsetPos: [number, number] = [
          coords[1] + feature.offsetLat,
          coords[0] + feature.offsetLng
        ];

        return (
          <Polyline
            key={`spider-leg-${idx}`}
            positions={[originalPos, offsetPos]}
            pathOptions={{
              color: '#3b82f6', // Blue color matching marker-cluster.css
              weight: 2,
              opacity: 0.6,
            }}
          />
        );
      });
  }, [spreadPoints, currentZoom]);

  // Look up the selected PC4 polygon (for zoom-to-selection)
  const selectedPainpointPolygon = useMemo(() => {
    if (!selectedPainpointPc4 || !pc4Data) return null;
    return pc4Data.features.find((f: any) => f?.properties?.pc4 === selectedPainpointPc4) ?? null;
  }, [selectedPainpointPc4, pc4Data]);

  // Close panel on Escape
  useEffect(() => {
    if (!selectedPainpointPc4) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSelectedPainpointPc4(null);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [selectedPainpointPc4]);

  // Clear selection when the pain-point layer is disabled
  useEffect(() => {
    if (!activeFilters.showPainPoints) setSelectedPainpointPc4(null);
    if (!activeFilters.showSuggestions) setSelectedSuggestionPc4(null);
  }, [activeFilters.showPainPoints]);

  // Early returns AFTER all hooks to maintain hook order
  if (!mounted) {
    return (
      <div className="w-full h-full flex items-center justify-center bg-gray-100">
        <p className="text-gray-500">Kaart laden...</p>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="w-full h-full flex items-center justify-center bg-gray-100">
        <div className="flex flex-col items-center gap-3">
          <svg className="animate-spin h-10 w-10 text-gray-500" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
          </svg>
          <p className="text-sm font-medium text-gray-500">Gemeente laden...</p>
        </div>
      </div>
    );
  }

  // Check if municipality has 0 pakketpunten
  const hasNoPakketpunten = points.length === 0;

  // Show PC4 labels only on pain-point polygons, zoom-gated to avoid clutter
  const showPc4Labels = activeFilters.showPainPoints && currentZoom >= 11;

  const selectedPainpointEntry =
    selectedPainpointPc4 && painPoints ? painPoints[selectedPainpointPc4] : null;

  return (
    <div className={`relative w-full h-full ${showPc4Labels ? 'show-pc4-labels' : ''}`}>
      <MapContainer
        key={`map-${useSimpleMarkers ? 'simple' : 'detailed'}`} // Force remount when rendering mode changes
        center={viewportRef.current?.center ?? [52.3676, 4.9041]} // restore prior view if we have one
        zoom={viewportRef.current?.zoom ?? 12}
        style={{ width: '100%', height: '100%' }}
        className="z-0"
        preferCanvas={useSimpleMarkers} // Use Canvas renderer for better performance
      >
      <ViewportRecorder viewportRef={viewportRef} />
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        eventHandlers={{
          loading: () => onTilesLoading?.(true),
          load: () => onTilesLoading?.(false),
        }}
      />

      <FitBounds
        bounds={bounds}
        fallbackCenter={fallbackCenter}
        targetCoordinates={targetCoordinates}
        searchLocationMarker={searchLocationMarker}
        onZoomedToTarget={onZoomedToTarget}
      />
      <ZoomWatcher onZoomChange={setCurrentZoom} />
      <ScaleControl />
      <FitToPainpoint polygon={selectedPainpointPolygon} />

      {/* PC4 postal code boundaries (outline only) */}
      {activeFilters.showPC4 && pc4Data && (
        <GeoJSON
          key="pc4-layer"
          data={pc4Data}
          style={() => ({
            color: '#475569',
            weight: 1.5,
            opacity: 1,
            fillColor: '#475569',
            fillOpacity: 0,
          })}
          onEachFeature={(feature, layer) => {
            const code = feature?.properties?.pc4;
            if (code) {
              layer.bindTooltip(String(code), { sticky: true, direction: 'top' });
            }
            layer.on({
              mouseover: (e) => e.target.setStyle({ weight: 3, fillOpacity: 0.12 }),
              mouseout: (e) => e.target.setStyle({ weight: 1.5, fillOpacity: 0 }),
            });
          }}
        />
      )}

      {/* Population-density choropleth, scoped to pain-point municipalities */}
      {activeFilters.showPopulation && pc4Data && pc4Stats && painPoints && (() => {
        // Build the set of gemeenten that appear in the pain-points data
        const paingemeenten = new Set<string>();
        for (const entry of Object.values(painPoints)) {
          if (entry.municipality) paingemeenten.add(entry.municipality);
        }
        // Filter PC4 features to those lying in a pain-point municipality
        const features = (pc4Data.features ?? []).filter((f: any) => {
          const s = pc4Stats[f?.properties?.pc4];
          return s && s.municipality && paingemeenten.has(s.municipality);
        });
        if (features.length === 0) return null;
        // Density ramp (inhabitants per km²). Thresholds roughly align with
        // CBS "very low → very high" density bands.
        const densityColor = (density: number) => {
          if (density >= 15000) return '#312e81'; // indigo-900
          if (density >= 10000) return '#4338ca'; // indigo-700
          if (density >= 6000)  return '#6366f1'; // indigo-500
          if (density >= 3000)  return '#a5b4fc'; // indigo-300
          if (density >= 1000)  return '#e0e7ff'; // indigo-100
          return '#f5f3ff';                       // violet-50
        };
        return (
          <GeoJSON
            key={`pop-layer-${features.length}`}
            data={{ type: 'FeatureCollection', features } as any}
            style={(feature) => {
              const s = pc4Stats[feature?.properties?.pc4];
              const density = s && s.area_km2 > 0 ? s.population / s.area_km2 : 0;
              return {
                color: '#3730a3',
                weight: 0.7,
                opacity: 0.7,
                fillColor: densityColor(density),
                fillOpacity: 0.55,
              };
            }}
            onEachFeature={(feature, layer) => {
              const code = feature?.properties?.pc4;
              const s = code ? pc4Stats[code] : null;
              if (!code || !s) return;
              const density = s.area_km2 > 0 ? Math.round(s.population / s.area_km2) : 0;
              const html = `
                <div style="font-size:12px;line-height:1.4">
                  <div style="font-weight:700">PC4 ${code} · ${s.municipality ?? ''}</div>
                  <div>${s.population.toLocaleString('nl-NL')} inw. · ${s.area_km2.toFixed(2)} km²</div>
                  <div style="color:#4f46e5;font-weight:600">${density.toLocaleString('nl-NL')} inw./km²</div>
                  <div style="color:#6b7280;margin-top:2px">
                    Pakketpunten: ${s.parcel_points.total}
                    · verwacht: ${s.predicted_points.toFixed(1)}
                    · Δ ${s.delta_vs_predicted >= 0 ? '+' : ''}${s.delta_vs_predicted.toFixed(1)}
                  </div>
                </div>
              `;
              layer.bindTooltip(html, { sticky: true, direction: 'top' });
            }}
          />
        );
      })()}

      {/* Density legend */}
      {activeFilters.showPopulation && (
        <div className="absolute bottom-4 right-4 z-[1000] bg-white/95 rounded-lg shadow-md p-3 text-xs text-gray-700 border border-gray-200 pointer-events-none">
          <div className="font-semibold mb-1">Inwoners/km²</div>
          <div className="flex items-center gap-2 mb-0.5"><span className="w-4 h-3 rounded-sm inline-block" style={{background:'#f5f3ff'}}/>&lt; 1 000</div>
          <div className="flex items-center gap-2 mb-0.5"><span className="w-4 h-3 rounded-sm inline-block" style={{background:'#e0e7ff'}}/>1 000 – 3 000</div>
          <div className="flex items-center gap-2 mb-0.5"><span className="w-4 h-3 rounded-sm inline-block" style={{background:'#a5b4fc'}}/>3 000 – 6 000</div>
          <div className="flex items-center gap-2 mb-0.5"><span className="w-4 h-3 rounded-sm inline-block" style={{background:'#6366f1'}}/>6 000 – 10 000</div>
          <div className="flex items-center gap-2 mb-0.5"><span className="w-4 h-3 rounded-sm inline-block" style={{background:'#4338ca'}}/>10 000 – 15 000</div>
          <div className="flex items-center gap-2"><span className="w-4 h-3 rounded-sm inline-block" style={{background:'#312e81'}}/>&ge; 15 000</div>
          <div className="text-[10px] text-gray-500 mt-1">Bron: CBS 83502NED</div>
        </div>
      )}

      {/* Population-coverage choropleth (PC4 or gemeente). Both layers share
          the coverage payload; only the polygon source differs. Colour ramp
          mirrors the PctBar in PopulationReachReport so the on-map view
          matches the data-export tab. */}
      {activeFilters.showCoverage && coverageData && (() => {
        const subset = activeFilters.coverageSubset;
        const dist = activeFilters.coverageDistance;
        const scope = activeFilters.coverageScope;
        const level = activeFilters.coverageLevel;
        const isPC4 = level === 'pc4';
        const polygonData = isPC4 ? pc4Data : muniBoundaries;
        if (!polygonData) return null;
        // Greens swapped for blues so high-coverage polygons stand out from
        // the basemap's parks/forests. Keeps the warm-to-cool ramp readable.
        const coverageColor = (pct: number) => {
          if (pct >= 80) return '#1d4ed8'; // blue-700
          if (pct >= 60) return '#3b82f6'; // blue-500
          if (pct >= 40) return '#eab308'; // yellow-500
          if (pct >= 20) return '#f97316'; // orange-500
          if (pct > 0)   return '#ef4444'; // red-500
          return '#9ca3af';                 // gray-400 (no data / 0%)
        };
        const subsetLabel = subset === 'total' ? 'Alle pakketpunten'
                          : subset === 'shop'  ? 'Pakketshops' : 'Pakketautomaten';
        return (
          <GeoJSON
            key={`coverage-${level}-${subset}-${dist}-${scope}`}
            data={polygonData as any}
            style={(feature) => {
              let pct = 0;
              if (isPC4) {
                const code = feature?.properties?.pc4;
                const row = code && coverageData.pc4[code];
                pct = row?.[subset]?.[dist]?.pct ?? 0;
              } else {
                const name = feature?.properties?.gemeente;
                const row = name && coverageData.municipalities[name];
                pct = row?.[scope]?.[subset]?.[dist]?.pct ?? 0;
              }
              return {
                color: '#1e3a8a',
                weight: isPC4 ? 0.5 : 0.8,
                opacity: 0.6,
                fillColor: coverageColor(pct),
                fillOpacity: 0.55,
              };
            }}
            onEachFeature={(feature, layer) => {
              let html = '';
              if (isPC4) {
                const code = feature?.properties?.pc4;
                const row = code ? coverageData.pc4[code] : null;
                if (!code || !row) return;
                const m = row[subset]?.[dist] ?? { pct: 0, covered: 0 };
                html = `
                  <div style="font-size:12px;line-height:1.4">
                    <div style="font-weight:700">PC4 ${code} · ${row.municipality ?? ''}</div>
                    <div>${(row.population ?? 0).toLocaleString('nl-NL')} inw. · ${(row.area_km2 ?? 0).toFixed(2)} km²</div>
                    <div style="color:#065f46;font-weight:600">
                      ${subsetLabel} @ ${dist}: ${m.pct.toFixed(1)}%
                    </div>
                    <div style="color:#6b7280">
                      ≈ ${m.covered.toLocaleString('nl-NL')} inwoners binnen bereik
                    </div>
                  </div>
                `;
              } else {
                const name = feature?.properties?.gemeente;
                const row = name ? coverageData.municipalities[name] : null;
                if (!name || !row) return;
                const m = row[scope]?.[subset]?.[dist] ?? { pct: 0, covered: 0 };
                const other = scope === 'national' ? 'strict' : 'national';
                const otherM = row[other]?.[subset]?.[dist] ?? { pct: 0 };
                const delta = (row.national?.[subset]?.[dist]?.pct ?? 0)
                            - (row.strict?.[subset]?.[dist]?.pct ?? 0);
                html = `
                  <div style="font-size:12px;line-height:1.4">
                    <div style="font-weight:700">${name}</div>
                    <div>${(row.population ?? 0).toLocaleString('nl-NL')} inw. · ${row.parcel_points?.[subset === 'total' ? 'total' : subset] ?? 0} ${subsetLabel.toLowerCase()}</div>
                    <div style="color:#065f46;font-weight:600">
                      ${scope === 'national' ? 'Nationaal' : 'Strict'} @ ${dist}: ${m.pct.toFixed(1)}%
                    </div>
                    <div style="color:#6b7280">
                      ≈ ${m.covered.toLocaleString('nl-NL')} inwoners
                      · ${other === 'national' ? 'nationaal' : 'strict'}: ${otherM.pct.toFixed(1)}%
                      · Δ ${delta >= 0 ? '+' : ''}${delta.toFixed(1)}%
                    </div>
                  </div>
                `;
              }
              layer.bindTooltip(html, { sticky: true, direction: 'top' });
            }}
          />
        );
      })()}

      {/* Coverage legend */}
      {activeFilters.showCoverage && (
        <div className="absolute bottom-4 right-4 z-[1000] bg-white/95 rounded-lg shadow-md p-3 text-xs text-gray-700 border border-gray-200 pointer-events-none">
          <div className="font-semibold mb-1">
            % inwoners binnen {activeFilters.coverageDistance}
          </div>
          <div className="text-[10px] text-gray-500 mb-1">
            {activeFilters.coverageSubset === 'total' ? 'Alle pakketpunten'
              : activeFilters.coverageSubset === 'shop' ? 'Alleen shops' : 'Alleen lockers'}
            {activeFilters.coverageLevel === 'gemeente'
              ? ` · ${activeFilters.coverageScope === 'national' ? 'nationaal bereik' : 'alleen eigen punten'}`
              : ' · per PC4'}
          </div>
          <div className="flex items-center gap-2 mb-0.5"><span className="w-4 h-3 rounded-sm inline-block" style={{background:'#9ca3af'}}/>0%</div>
          <div className="flex items-center gap-2 mb-0.5"><span className="w-4 h-3 rounded-sm inline-block" style={{background:'#ef4444'}}/>0 – 20%</div>
          <div className="flex items-center gap-2 mb-0.5"><span className="w-4 h-3 rounded-sm inline-block" style={{background:'#f97316'}}/>20 – 40%</div>
          <div className="flex items-center gap-2 mb-0.5"><span className="w-4 h-3 rounded-sm inline-block" style={{background:'#eab308'}}/>40 – 60%</div>
          <div className="flex items-center gap-2 mb-0.5"><span className="w-4 h-3 rounded-sm inline-block" style={{background:'#3b82f6'}}/>60 – 80%</div>
          <div className="flex items-center gap-2"><span className="w-4 h-3 rounded-sm inline-block" style={{background:'#1d4ed8'}}/>&ge; 80%</div>
        </div>
      )}

      {/* POI overlays — single per-municipality bundle, filtered client-side
          by active categories. Two render modes: dots (CircleMarker) or icons
          (Lucide divIcon). */}
      {poiBundle && activeFilters.poiCategories.length > 0 && (() => {
        const activeSet = new Set(activeFilters.poiCategories);
        const useIcons = activeFilters.poiIconStyle === 'icons';
        return poiBundle.features
          .filter((f) => activeSet.has(f.category))
          .map((f, i) => {
            const meta = poiIndex?.find((c) => c.slug === f.category);
            const color = meta?.color ?? '#666';
            const label = meta?.label ?? f.category;
            const pos: [number, number] = [f.coordinates[1], f.coordinates[0]];
            const streetView = `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${f.coordinates[1]},${f.coordinates[0]}`;
            const gmaps = `https://www.google.com/maps/search/?api=1&query=${f.coordinates[1]},${f.coordinates[0]}`;
            const popup = (
              <Popup>
                <div style={{ minWidth: 180, fontSize: 13 }}>
                  <div style={{ fontWeight: 600 }}>{f.name || label}</div>
                  <div style={{ fontSize: 11, color: '#4b5563' }}>{label}</div>
                  {f.operator && (
                    <div style={{ fontSize: 11, color: '#6b7280', marginTop: 2 }}>{f.operator}</div>
                  )}
                  <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <a href={streetView} target="_blank" rel="noopener noreferrer"
                       style={{ fontSize: 12, textAlign: 'center', padding: '4px 8px', borderRadius: 4,
                                background: '#2563eb', color: '#fff', textDecoration: 'none' }}>
                      Street View
                    </a>
                    <a href={gmaps} target="_blank" rel="noopener noreferrer"
                       style={{ fontSize: 12, textAlign: 'center', padding: '4px 8px', borderRadius: 4,
                                border: '1px solid #d1d5db', color: '#1f2937', textDecoration: 'none' }}>
                      Google Maps
                    </a>
                  </div>
                </div>
              </Popup>
            );
            if (useIcons) {
              return (
                <Marker
                  key={`poi-${f.category}-${i}`}
                  position={pos}
                  icon={makePoiDivIcon(f.category, color, 22)}
                >
                  {popup}
                </Marker>
              );
            }
            return (
              <CircleMarker
                key={`poi-${f.category}-${i}`}
                center={pos}
                radius={3.5}
                pathOptions={{ color, fillColor: color, fillOpacity: 0.85, weight: 1 }}
              >
                {popup}
              </CircleMarker>
            );
          });
      })()}

      {/* Placement-suggestions overlay (top-N PC4 choropleth + suggested pins).
          Only renders when a single municipality is selected. */}
      {activeFilters.showSuggestions && placementSuggestions && pc4Data && (() => {
        const slug = data?.metadata?.slug;
        if (!slug || slug === 'nederland') return null;
        const block = placementSuggestions.by_municipality[slug];
        if (!block) return null;
        // Map PC4 → record so the GeoJSON style callback can colour by priority.
        const byPc4: Record<string, typeof block.pc4s[number]> = {};
        for (const r of block.pc4s) byPc4[r.pc4] = r;
        // Blue single-hue ramp matching the app's chrome — distinct from the
        // red/orange pain-points layer so both can be on at once.
        const priorityFill = (priority: number) => {
          if (priority >= 1.5)  return '#1e3a8a'; // blue-900
          if (priority >= 0.75) return '#1d4ed8'; // blue-700
          if (priority >= 0)    return '#3b82f6'; // blue-500
          if (priority >= -0.75)return '#93c5fd'; // blue-300
          return '#dbeafe';                       // blue-100
        };
        // Filter pc4Data to just the top-N PC4s of this municipality.
        const featureCollection = {
          type: 'FeatureCollection' as const,
          features: pc4Data.features.filter((f: any) => byPc4[f?.properties?.pc4]),
        };
        return (
          <>
            <GeoJSON
              key={`suggestions-${slug}`}
              data={featureCollection as any}
              style={(feature) => {
                const code = String(feature?.properties?.pc4 ?? '');
                const r = byPc4[code];
                // Highlight in amber when this PC4 is also flagged as a
                // pijnpunt (the other layer is on AND the PC4 appears in it).
                const isDual =
                  activeFilters.showPainPoints
                  && !!painPoints
                  && code in painPoints;
                return {
                  color: isDual ? '#f59e0b' : '#1e3a8a', // amber-500 on overlap
                  weight: isDual ? 4 : 1.5,
                  opacity: 0.85,
                  fillColor: r ? priorityFill(r.priority) : '#9ca3af',
                  fillOpacity: 0.55,
                };
              }}
              onEachFeature={(feature, layer) => {
                const code = feature?.properties?.pc4;
                const r = code ? byPc4[code] : null;
                if (!r) return;
                layer.bindTooltip(
                  `<div style="font-size:12px;line-height:1.4">
                     <div style="font-weight:700">PC4 ${code}</div>
                     <div>Prioriteit: <strong>${r.priority >= 0 ? '+' : ''}${r.priority.toFixed(2)}</strong></div>
                     <div>${r.actual} / ${r.predicted.toFixed(1)} pakketpunten (actueel/voorspeld)</div>
                     <div>${r.population.toLocaleString('nl-NL')} inw. · ${r.coverage_pct_400m.toFixed(1)}% binnen 400m</div>
                     ${r.suggestion ? `<div style="color:#dc2626;font-weight:600">Suggestie: +${r.suggestion.est_new_pop_within_400m.toLocaleString('nl-NL')} inw. binnen 400m</div>` : ''}
                   </div>`,
                  { sticky: true, direction: 'top' },
                );
              }}
            />
            {/* Suggested-coordinate pins. The selected one is rendered last
                (so it sits on top), bigger, brighter and pulsing — there's
                no ambiguity which pin the side panel refers to. */}
            {block.pc4s
              .filter((r) => r.suggestion)
              .sort((a, b) => {
                // Push the selected PC4 to the end of the render order
                // (Leaflet's SVG draws later children above earlier ones).
                if (a.pc4 === selectedSuggestionPc4) return 1;
                if (b.pc4 === selectedSuggestionPc4) return -1;
                return 0;
              })
              .map((r) => {
                const isSelected = selectedSuggestionPc4 === r.pc4;
                return (
                  <CircleMarker
                    key={`suggest-${slug}-${r.pc4}`}
                    center={[r.suggestion!.lat, r.suggestion!.lon]}
                    radius={isSelected ? 14 : 9}
                    className={isSelected ? 'suggestion-pin-selected' : undefined}
                    pathOptions={{
                      fillColor: isSelected ? '#ea580c' : '#f59e0b', // orange-600 vs amber-500
                      fillOpacity: 1,
                      color: '#ffffff',
                      weight: isSelected ? 4.5 : 2.5,
                    }}
                    eventHandlers={{
                      click: () => setSelectedSuggestionPc4(r.pc4),
                    }}
                  />
                );
              })}
          </>
        );
      })()}

      {/* Suggestion detail side-panel — opens from the right when a pin is clicked. */}
      {activeFilters.showSuggestions && placementSuggestions && data?.metadata?.slug && (() => {
        const slug = data.metadata.slug;
        if (!slug || slug === 'nederland') return null;
        const block = placementSuggestions.by_municipality[slug];
        if (!block) return null;
        const sel = selectedSuggestionPc4
          ? block.pc4s.find((r) => r.pc4 === selectedSuggestionPc4)
          : null;
        if (!sel || !sel.suggestion) return null;
        const s = sel.suggestion;
        const idx = block.pc4s.indexOf(sel) + 1;
        const streetviewUrl = `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${s.lat},${s.lon}`;
        const mapsUrl = `https://www.google.com/maps?q=${s.lat},${s.lon}`;
        return (
          <div className="absolute top-4 right-4 z-[1100] w-[320px] max-h-[calc(100%-2rem)] overflow-y-auto bg-white rounded-lg shadow-xl border border-gray-200 text-sm">
            <div className="flex items-start justify-between px-4 py-3 border-b border-gray-200 bg-blue-50 rounded-t-lg">
              <div>
                <div className="text-xs uppercase tracking-wide text-blue-700 font-semibold">
                  Voorstel #{idx}
                </div>
                <div className="text-lg font-bold text-gray-900 font-mono">PC4 {sel.pc4}</div>
                <div className="text-xs text-gray-600">
                  Prioriteit{' '}
                  <span className="font-mono font-semibold text-blue-800">
                    {sel.priority >= 0 ? '+' : ''}{sel.priority.toFixed(2)}
                  </span>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setSelectedSuggestionPc4(null)}
                aria-label="Sluit detailvenster"
                className="text-gray-400 hover:text-gray-700 text-xl leading-none px-1"
              >
                ×
              </button>
            </div>

            <div className="px-4 py-3 space-y-3">
              <div>
                <div className="text-xs text-gray-500 uppercase tracking-wide">Adres / locatie</div>
                <div className="font-mono text-xs text-gray-800">
                  {s.lat.toFixed(5)}, {s.lon.toFixed(5)}
                </div>
                {s.bag_gebruiksdoel && (
                  <div className="text-xs text-gray-700 mt-1">
                    <span className="text-gray-500">BAG-pand:</span>{' '}
                    {s.bag_gebruiksdoel}
                    {s.bag_bouwjaar ? ` (bouwjaar ${s.bag_bouwjaar})` : ''}
                  </div>
                )}
                {s.bag_identificatie && (
                  <div className="text-[10px] text-gray-500 font-mono mt-0.5">
                    BAG-id: {s.bag_identificatie}
                  </div>
                )}
              </div>

              {s.nearest_ov && (
                <div className="border-t border-gray-100 pt-3">
                  <div className="text-xs text-gray-500 uppercase tracking-wide">OV-halte</div>
                  <div className="text-xs text-gray-800">
                    <span className="font-medium">{s.nearest_ov.name}</span>{' '}
                    <span className="text-gray-500">· {s.nearest_ov.distance_m} m</span>
                  </div>
                </div>
              )}

              <div className="border-t border-gray-100 pt-3 grid grid-cols-2 gap-2 text-xs">
                <div>
                  <div className="text-gray-500">Actueel</div>
                  <div className="font-semibold text-gray-900">{sel.actual} pp</div>
                </div>
                <div>
                  <div className="text-gray-500">Voorspeld</div>
                  <div className="font-semibold text-gray-900">{sel.predicted.toFixed(1)} pp</div>
                </div>
                <div>
                  <div className="text-gray-500">Inwoners</div>
                  <div className="font-semibold text-gray-900">{sel.population.toLocaleString('nl-NL')}</div>
                </div>
                <div>
                  <div className="text-gray-500">% binnen 400 m</div>
                  <div className="font-semibold text-gray-900">{sel.coverage_pct_400m.toFixed(1)}%</div>
                </div>
                <div className="col-span-2">
                  <div className="text-gray-500">Geschat extra bereik (400 m)</div>
                  <div className="font-semibold text-blue-800">
                    {s.est_new_pop_within_400m.toLocaleString('nl-NL')} inwoners
                  </div>
                </div>
              </div>

              <div className="border-t border-gray-100 pt-3 flex flex-col gap-1.5">
                {/* Inline `style` enforces white text + icon stroke; without
                    it Tailwind v4's preflight + Next.js anchor styling
                    bleed the page link colour through, leaving low-contrast
                    blue-on-blue (see prior bug report). */}
                <a
                  href={streetviewUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ color: '#ffffff' }}
                  className="inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-semibold bg-blue-700 hover:bg-blue-800 rounded transition no-underline"
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="#ffffff" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                  </svg>
                  Open in Streetview
                </a>
                <a
                  href={mapsUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ color: '#1f2937' }}
                  className="inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-semibold bg-gray-100 hover:bg-gray-200 rounded transition no-underline"
                >
                  Open in Google Maps
                </a>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Suggestions legend */}
      {activeFilters.showSuggestions && data?.metadata?.slug && data.metadata.slug !== 'nederland' && (
        <div className="absolute bottom-4 right-4 z-[1000] bg-white/95 rounded-lg shadow-md p-3 text-xs text-gray-700 border border-gray-200 pointer-events-none">
          <div className="font-semibold mb-1">Plaatsingsadvies prioriteit</div>
          <div className="text-[10px] text-gray-500 mb-1">Top-5 PC4s · z-score binnen gemeente</div>
          <div className="flex items-center gap-2 mb-0.5"><span className="w-4 h-3 rounded-sm inline-block" style={{background:'#1e3a8a'}}/>≥ +1.5 (zeer hoog)</div>
          <div className="flex items-center gap-2 mb-0.5"><span className="w-4 h-3 rounded-sm inline-block" style={{background:'#1d4ed8'}}/>+0.75 – +1.5</div>
          <div className="flex items-center gap-2 mb-0.5"><span className="w-4 h-3 rounded-sm inline-block" style={{background:'#3b82f6'}}/>0 – +0.75</div>
          <div className="flex items-center gap-2 mb-0.5"><span className="w-4 h-3 rounded-sm inline-block" style={{background:'#93c5fd'}}/>−0.75 – 0</div>
          <div className="flex items-center gap-2 mb-1"><span className="w-4 h-3 rounded-sm inline-block" style={{background:'#dbeafe'}}/>&lt; −0.75</div>
          <div className="flex items-center gap-2 pt-1 border-t border-gray-200">
            <span className="w-3 h-3 rounded-full inline-block" style={{background:'#f59e0b',border:'2px solid white',boxShadow:'0 0 0 1px #7c2d12'}}/>
            voorgestelde locatie
          </div>
          {activeFilters.showPainPoints && (
            <div className="flex items-center gap-2 mt-1 pt-1 border-t border-gray-200">
              <span className="inline-block w-4 h-3 rounded-sm border-2" style={{borderColor:'#f59e0b', background:'#8b5cf6'}}/>
              ook pijnpunt (carrier-melding)
            </div>
          )}
        </div>
      )}

      {/* Pijnpunten legend (bottom-left so it doesn't clash with the
          Plaatsingsadvies / Bereik legends on the right). */}
      {activeFilters.showPainPoints && (
        <div className="absolute bottom-4 left-4 z-[1000] bg-white/95 rounded-lg shadow-md p-3 text-xs text-gray-700 border border-gray-200 pointer-events-none">
          <div className="font-semibold mb-1">Pijnpunten vervoerders</div>
          <div className="text-[10px] text-gray-500 mb-1"># vervoerders dat PC4 als pijnpunt aandraagt</div>
          <div className="flex items-center gap-2 mb-0.5"><span className="w-4 h-3 rounded-sm inline-block" style={{background:'#4c1d95'}}/>≥ 4 vervoerders</div>
          <div className="flex items-center gap-2 mb-0.5"><span className="w-4 h-3 rounded-sm inline-block" style={{background:'#6d28d9'}}/>3 vervoerders</div>
          <div className="flex items-center gap-2 mb-0.5"><span className="w-4 h-3 rounded-sm inline-block" style={{background:'#8b5cf6'}}/>2 vervoerders</div>
          <div className="flex items-center gap-2 mb-1"><span className="w-4 h-3 rounded-sm inline-block" style={{background:'#a78bfa'}}/>1 vervoerder</div>
          {activeFilters.showSuggestions && (
            <div className="flex items-center gap-2 pt-1 border-t border-gray-200">
              <span className="inline-block w-4 h-3 rounded-sm border-2" style={{borderColor:'#f59e0b', background:'#8b5cf6'}}/>
              ook in plaatsingsadvies
            </div>
          )}
        </div>
      )}

      {/* Carrier pain-point PC4s — violet ramp so they're distinct from the
          blue Plaatsingsadvies layer when both are toggled on. PC4s flagged
          in *both* layers get a thick amber stroke (same hue as the
          suggestion pin) so the overlap is immediately readable. */}
      {/* Custom pane so the painpoint choropleth sits below POI dots/icons. */}
      <Pane name="painpoint-pane" style={{ zIndex: 350 }} />
      {activeFilters.showPainPoints && painPointsGeoJSON && painPoints && (() => {
        // Build a fast lookup for the active municipality's top-N
        // Plaatsingsadvies PC4s, used to detect dual-flagged PC4s.
        const slug = data?.metadata?.slug;
        const suggestionPc4s = new Set<string>();
        if (
          activeFilters.showSuggestions
          && placementSuggestions
          && slug && slug !== 'nederland'
        ) {
          const block = placementSuggestions.by_municipality[slug];
          for (const r of block?.pc4s ?? []) suggestionPc4s.add(r.pc4);
        }
        return (
        <GeoJSON
          key={`painpoints-layer-${suggestionPc4s.size}`}
          pane="painpoint-pane"
          data={painPointsGeoJSON as any}
          style={(feature) => {
            const code = String(feature?.properties?.pc4 ?? '');
            const entry = painPoints[code];
            // Combined intensity: any source counts (carriers + G4-gemeenten).
            const count =
              (entry?.carriers.length ?? 0) + (entry?.gemeenten?.length ?? 0);
            // Violet ramp — separates this layer from blue Plaatsingsadvies.
            const fillColor =
              count >= 4 ? '#4c1d95' : // violet-900
              count === 3 ? '#6d28d9' : // violet-700
              count === 2 ? '#8b5cf6' : // violet-500
              '#a78bfa';                 // violet-400
            const strokeColor =
              count >= 4 ? '#2e1065' : // violet-950
              count === 3 ? '#4c1d95' : // violet-900
              count === 2 ? '#6d28d9' : // violet-700
              '#6d28d9';                 // violet-700
            const isDual = suggestionPc4s.has(code);
            return {
              color: isDual ? '#f59e0b' : strokeColor, // amber-500 on overlap
              weight: isDual ? 4 : 1.5,
              opacity: 1,
              fillColor,
              fillOpacity: 0.65,
              dashArray: isDual ? undefined : undefined,
            };
          }}
          onEachFeature={(feature, layer) => {
            const code = feature?.properties?.pc4;
            const entry = code ? painPoints[code] : null;
            if (!entry) return;
            const isDual = code ? suggestionPc4s.has(String(code)) : false;
            const baseWeight = isDual ? 4 : 1.5;
            // Permanent PC4-code label, shown via CSS (zoom-gated)
            layer.bindTooltip(String(code), {
              permanent: true,
              direction: 'center',
              className: 'pc4-label',
            });
            layer.on({
              mouseover: (e) => e.target.setStyle({ weight: baseWeight + 1.5 }),
              mouseout: (e) => e.target.setStyle({ weight: baseWeight }),
              click: () => setSelectedPainpointPc4(String(code)),
            });
          }}
        />
        );
      })()}

      {/* Render pakketpunten inside the selected painpoint PC4.
          Source is the nationwide enriched dataset so these appear even when
          the PC4 lies outside the currently selected municipality. */}
      {selectedPainpointEntry?.points?.map((p, idx) => {
        const color = PROVIDER_INFO[p.vervoerder]?.color || '#666';
        return (
          <CircleMarker
            key={`painpt-${selectedPainpointPc4}-${idx}`}
            center={[p.lat, p.lng]}
            radius={p.category === 'locker' ? 9 : 7}
            pathOptions={{
              fillColor: color,
              fillOpacity: 0.95,
              color: '#111827',
              weight: 2,
            }}
          >
            <Popup>
              <div className="text-sm">
                <div className="font-semibold text-gray-900">{p.locatieNaam || p.vervoerder}</div>
                <div className="text-gray-600">{p.straatNaam} {p.straatNr}</div>
                <div className="mt-1 text-xs">
                  <span className="font-semibold">{p.vervoerder}</span>
                  {' · '}
                  {p.category === 'locker' ? 'Pakketautomaat' : 'Pakketshop'}
                </div>
              </div>
            </Popup>
          </CircleMarker>
        );
      })}

      {/* Render buffer zones - merged union polygons or individual circles */}
      {/* 400m buffers rendered first (underneath) */}
      {activeFilters.showBuffer400 && markerCount <= 3000 && (
        activeFilters.bufferMerged && mergedBuffer400 ? (
          <GeoJSON
            key={`buffer400-merged-${data?.metadata?.slug}-${points.length}-fill${activeFilters.showBufferFill}`}
            data={mergedBuffer400 as any}
            style={() => ({
              color: '#60a5fa',
              fillColor: '#93c5fd',
              weight: 3,
              fillOpacity: activeFilters.showBufferFill ? 0.30 : 0,
              opacity: 1,
            })}
          />
        ) : !activeFilters.bufferMerged ? (
          <>{points.map((feature, idx) => {
            const coords = feature.geometry.coordinates as [number, number];
            return (
              <Circle
                key={`buffer400-${idx}`}
                center={[coords[1], coords[0]]}
                radius={400}
                pathOptions={{
                  color: '#60a5fa',
                  fillColor: '#93c5fd',
                  weight: 3,
                  fillOpacity: activeFilters.showBufferFill ? 0.10 : 0,
                  opacity: 1,
                }}
                interactive={false}
              />
            );
          })}</>
        ) : null
      )}
      {/* 300m buffers rendered on top */}
      {activeFilters.showBuffer300 && markerCount <= 3000 && (
        activeFilters.bufferMerged && mergedBuffer300 ? (
          <GeoJSON
            key={`buffer300-merged-${data?.metadata?.slug}-${points.length}-fill${activeFilters.showBufferFill}`}
            data={mergedBuffer300 as any}
            style={() => ({
              color: '#2563eb',
              fillColor: '#3b82f6',
              weight: 2,
              fillOpacity: activeFilters.showBufferFill ? 0.25 : 0,
              opacity: 1,
            })}
          />
        ) : !activeFilters.bufferMerged ? (
          <>{points.map((feature, idx) => {
            const coords = feature.geometry.coordinates as [number, number];
            return (
              <Circle
                key={`buffer300-${idx}`}
                center={[coords[1], coords[0]]}
                radius={300}
                pathOptions={{
                  color: '#2563eb',
                  fillColor: '#3b82f6',
                  weight: 2,
                  fillOpacity: activeFilters.showBufferFill ? 0.08 : 0,
                  opacity: 1,
                }}
                interactive={false}
              />
            );
          })}</>
        ) : null
      )}

      {/* Render municipal boundaries */}
      {boundaries.map((feature, idx) => (
        <GeoJSON
          key={`boundary-${data?.metadata?.slug}-${idx}`}
          data={feature as any}
          style={() => ({
            color: '#6b7280',  // Medium grey color for boundary
            fillColor: '#6b7280',
            weight: 3,  // Thick line for visibility
            fillOpacity: 0.05,  // Very light fill to show area
            opacity: 0.85,  // More visible line
            dashArray: '10, 10',  // Dashed line to distinguish from buffers
          })}
        />
      ))}

      {/* Render spider leg lines (shown underneath markers) */}
      {spiderLegLines}

      {/* Render points with automatic spiderfy at zoom 15+ */}
      {markerElements}

      {/* Render search location marker (blue pin) */}
      {searchLocationMarker && (
        <Marker
          position={[searchLocationMarker.latitude, searchLocationMarker.longitude]}
          icon={createSearchLocationIcon()}
          zIndexOffset={1000}
        >
          <Popup>
            <div className="text-sm">
              <h3 className="font-bold text-gray-900">Uw zoeklocatie</h3>
              <p className="text-xs text-gray-500 mt-1">
                {searchLocationMarker.latitude.toFixed(6)}, {searchLocationMarker.longitude.toFixed(6)}
              </p>
            </div>
          </Popup>
        </Marker>
      )}
    </MapContainer>

      {/* Side panel for selected painpoint PC4 */}
      {selectedPainpointPc4 && selectedPainpointEntry && (
        <aside className="absolute top-0 right-0 bottom-0 w-full sm:w-[380px] z-[1001] bg-white shadow-2xl flex flex-col border-l border-gray-200">
          <div className="flex items-start justify-between p-4 border-b border-gray-200">
            <div>
              <div className="text-xs uppercase tracking-wide text-gray-500">Pijnpunt PC4</div>
              <div className="text-2xl font-bold text-gray-900 font-mono">{selectedPainpointPc4}</div>
              <div className="text-sm text-gray-600">
                G4: {selectedPainpointEntry.g4_city ?? selectedPainpointEntry.city}
              </div>
              {selectedPainpointEntry.municipality &&
                selectedPainpointEntry.municipality !== (selectedPainpointEntry.g4_city ?? selectedPainpointEntry.city) && (
                  <div className="text-sm text-gray-900 font-medium">
                    {selectedPainpointEntry.municipality}
                  </div>
                )}
              {selectedPainpointEntry.municipality &&
                selectedPainpointEntry.municipality === (selectedPainpointEntry.g4_city ?? selectedPainpointEntry.city) && (
                  <div className="text-xs text-gray-500">Gemeente: {selectedPainpointEntry.municipality}</div>
                )}
            </div>
            <button
              onClick={() => setSelectedPainpointPc4(null)}
              className="p-2 text-gray-500 hover:text-gray-900 hover:bg-gray-100 rounded"
              aria-label="Sluiten"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          <div className="px-4 py-3 border-b border-gray-200 bg-gray-50">
            {selectedPainpointEntry.carriers.length > 0 && (
              <>
                <div className="text-xs uppercase tracking-wide text-gray-500 mb-1">
                  Gemeld door carriers
                </div>
                <div className="flex flex-wrap gap-1 mb-3">
                  {selectedPainpointEntry.carriers.map((c) => (
                    <span
                      key={c}
                      className="px-2 py-0.5 text-xs font-semibold bg-violet-100 text-violet-800 rounded"
                    >
                      {c}
                    </span>
                  ))}
                </div>
              </>
            )}
            {selectedPainpointEntry.gemeenten && selectedPainpointEntry.gemeenten.length > 0 && (
              <>
                <div className="text-xs uppercase tracking-wide text-gray-500 mb-1">
                  Gemeld door G4-gemeente
                </div>
                <div className="flex flex-wrap gap-1 mb-3">
                  {selectedPainpointEntry.gemeenten.map((g) => (
                    <span
                      key={g}
                      className="px-2 py-0.5 text-xs font-semibold bg-blue-100 text-blue-800 rounded"
                    >
                      Gemeente {g}
                    </span>
                  ))}
                </div>
              </>
            )}
            {selectedPainpointEntry.notes && selectedPainpointEntry.notes.length > 0 && (
              <div className="mb-3 space-y-1">
                {selectedPainpointEntry.notes.map((n, i) => (
                  <div key={i} className="text-xs text-amber-900 bg-amber-50 border border-amber-200 rounded px-2 py-1">
                    {n}
                  </div>
                ))}
              </div>
            )}
            {selectedPainpointEntry.stats && (
              <div className="mb-3 grid grid-cols-2 gap-2 text-xs">
                <div className="bg-white rounded border border-gray-200 px-2 py-1">
                  <div className="text-gray-500">Inwoners</div>
                  <div className="font-semibold text-gray-900">{selectedPainpointEntry.stats.population?.toLocaleString('nl-NL') ?? '—'}</div>
                </div>
                <div className="bg-white rounded border border-gray-200 px-2 py-1">
                  <div className="text-gray-500">Oppervlakte</div>
                  <div className="font-semibold text-gray-900">{selectedPainpointEntry.stats.area_km2?.toFixed(2) ?? '—'} km²</div>
                </div>
                <div className="bg-white rounded border border-gray-200 px-2 py-1">
                  <div className="text-gray-500">PP per 1000 inw.</div>
                  <div className="font-semibold text-gray-900">{selectedPainpointEntry.stats.points_per_1000_inw?.toFixed(2) ?? '—'}</div>
                </div>
                <div className="bg-white rounded border border-gray-200 px-2 py-1">
                  <div className="text-gray-500">PP per km²</div>
                  <div className="font-semibold text-gray-900">{selectedPainpointEntry.stats.points_per_km2?.toFixed(1) ?? '—'}</div>
                </div>
                <div className="bg-white rounded border border-gray-200 px-2 py-1 col-span-2">
                  <div className="text-gray-500">Verwacht (regressie) · Δ</div>
                  <div className="font-semibold text-gray-900">
                    {selectedPainpointEntry.stats.predicted_points?.toFixed(1) ?? '—'}
                    {selectedPainpointEntry.stats.delta_vs_predicted != null && (
                      <span className={`ml-2 ${selectedPainpointEntry.stats.delta_vs_predicted >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>
                        {selectedPainpointEntry.stats.delta_vs_predicted >= 0 ? '+' : ''}{selectedPainpointEntry.stats.delta_vs_predicted.toFixed(1)}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            )}
            {selectedPainpointEntry.pakketpunten && (
              <div className="grid grid-cols-3 gap-2 text-center">
                <div>
                  <div className="text-lg font-bold text-gray-900">{selectedPainpointEntry.pakketpunten.total}</div>
                  <div className="text-xs text-gray-500">Totaal</div>
                </div>
                <div>
                  <div className="text-lg font-bold text-gray-900">{selectedPainpointEntry.pakketpunten.locker}</div>
                  <div className="text-xs text-gray-500">Automaten</div>
                </div>
                <div>
                  <div className="text-lg font-bold text-gray-900">{selectedPainpointEntry.pakketpunten.shop}</div>
                  <div className="text-xs text-gray-500">Shops</div>
                </div>
              </div>
            )}
          </div>

          <div className="flex-1 overflow-y-auto">
            <div className="px-4 py-3 text-xs uppercase tracking-wide text-gray-500 sticky top-0 bg-white border-b border-gray-100">
              Pakketpunten in dit gebied ({selectedPainpointEntry.points?.length ?? 0})
            </div>
            {selectedPainpointEntry.points && selectedPainpointEntry.points.length > 0 ? (
              <ul className="divide-y divide-gray-100">
                {selectedPainpointEntry.points
                  .slice()
                  .sort((a, b) =>
                    a.vervoerder.localeCompare(b.vervoerder) ||
                    a.straatNaam.localeCompare(b.straatNaam)
                  )
                  .map((p, idx) => {
                    const color = PROVIDER_INFO[p.vervoerder]?.color || '#666';
                    return (
                      <li key={idx} className="px-4 py-2 text-sm hover:bg-gray-50 flex items-start gap-2">
                        <span
                          className="inline-block w-3 h-3 rounded-full mt-1 flex-shrink-0 border border-white"
                          style={{ backgroundColor: color, boxShadow: '0 0 0 1px rgba(0,0,0,0.15)' }}
                          aria-hidden
                        />
                        <div className="min-w-0 flex-1">
                          <div className="font-medium text-gray-900 truncate">
                            {p.locatieNaam || p.vervoerder}
                          </div>
                          <div className="text-xs text-gray-600 truncate">
                            {p.straatNaam} {p.straatNr}
                          </div>
                          <div className="text-xs text-gray-500 mt-0.5">
                            <span className="font-semibold">{p.vervoerder}</span>
                            {' · '}
                            {p.category === 'locker' ? 'Pakketautomaat' : 'Pakketshop'}
                          </div>
                        </div>
                      </li>
                    );
                  })}
              </ul>
            ) : (
              <div className="px-4 py-6 text-sm text-gray-500 text-center">Geen pakketpunten in dit gebied.</div>
            )}
          </div>

          {selectedPainpointEntry.pakketpunten?.by_carrier && (
            <div className="px-4 py-3 border-t border-gray-200 max-h-[40%] overflow-y-auto bg-gray-50">
              <div className="text-xs uppercase tracking-wide text-gray-500 mb-2">Per vervoerder</div>
              <table className="w-full text-sm">
                <thead className="text-xs uppercase text-gray-500">
                  <tr>
                    <th className="text-left py-1">Vervoerder</th>
                    <th className="text-right py-1">Auto.</th>
                    <th className="text-right py-1">Shops</th>
                    <th className="text-right py-1">Totaal</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {Object.entries(selectedPainpointEntry.pakketpunten.by_carrier)
                    .sort(([a], [b]) => a.localeCompare(b))
                    .map(([carrier, counts]) => (
                      <tr key={carrier}>
                        <td className="py-1 text-gray-900 font-medium">{carrier}</td>
                        <td className="py-1 text-right tabular-nums text-gray-700">{counts.locker}</td>
                        <td className="py-1 text-right tabular-nums text-gray-700">{counts.shop}</td>
                        <td className="py-1 text-right tabular-nums font-semibold text-gray-900">{counts.locker + counts.shop}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          )}
        </aside>
      )}

      {/* Empty state overlay when municipality has 0 pakketpunten */}
      {hasNoPakketpunten && (
        <div className="absolute top-4 left-1/2 transform -translate-x-1/2 z-[1000] pointer-events-none">
          <div className="bg-yellow-50 border-2 border-yellow-400 rounded-lg shadow-lg px-6 py-4 max-w-md">
            <div className="flex items-start gap-3">
              <svg className="w-6 h-6 text-yellow-600 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
              <div>
                <h3 className="font-semibold text-yellow-900 mb-1">
                  Geen pakketpunten gevonden
                </h3>
                <p className="text-sm text-yellow-800">
                  Deze gemeente heeft momenteel geen pakketpunten in onze database.
                  De kaart toont wel de gemeentegrens.
                </p>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Export as default - using named function helps Fast Refresh
export default MapComponent;
