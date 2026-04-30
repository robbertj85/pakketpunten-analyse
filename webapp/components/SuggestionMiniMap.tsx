'use client';

import { memo, useEffect, useMemo, useState } from 'react';
import { MapContainer, GeoJSON, CircleMarker, Circle, Popup, useMap } from 'react-leaflet';
import type { LatLngBoundsExpression } from 'leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

import type { Suggestion } from './PlacementSuggestionsReport';

/** Effect-based replacement for `<TileLayer>` from react-leaflet. The
 * component-style TileLayer fires `onAdd` during render, which crashes under
 * React 19's concurrent renderer when the map's pane tree isn't yet attached
 * (`this.getPane().appendChild` blows up on undefined). Adding the layer via
 * useEffect runs after commit, when the map is guaranteed to be mounted. */
function ImperativeTileLayer({ url, attribution }: { url: string; attribution: string }) {
  const map = useMap();
  useEffect(() => {
    const layer = L.tileLayer(url, { attribution });
    layer.addTo(map);
    return () => {
      layer.remove();
    };
  }, [map, url, attribution]);
  return null;
}

interface MuniGeojsonFeature {
  type: 'Feature';
  properties?: { type?: string };
  geometry: unknown;
}
interface MuniGeojson {
  type: 'FeatureCollection';
  features: MuniGeojsonFeature[];
}

interface Props {
  pc4: string;
  suggestion: Suggestion | null;
  muniGeojson: unknown | null;
}

function FitToBounds({ bounds }: { bounds: LatLngBoundsExpression | null }) {
  const map = useMap();
  useEffect(() => {
    if (bounds) map.fitBounds(bounds, { padding: [12, 12] });
  }, [bounds, map]);
  return null;
}

function SuggestionMiniMapImpl({ pc4, suggestion, muniGeojson }: Props) {
  const [polygon, setPolygon] = useState<MuniGeojsonFeature | null>(null);
  const [loading, setLoading] = useState(true);
  // Defer the MapContainer until after first commit. React 19's concurrent
  // renderer can otherwise tear down + remount the leaflet tree mid-flight
  // (parent slider drags fire dozens of renders), and TileLayer crashes when
  // its pane parent goes missing — `this.getPane().appendChild` is undefined.
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setPolygon(null);
    fetch('/data/pc4.geojson')
      .then((res) => res.json())
      .then((data) => {
        if (cancelled) return;
        const feat = data.features.find(
          (f: MuniGeojsonFeature & { properties?: { pc4?: string } }) =>
            f.properties?.pc4 === pc4,
        );
        setPolygon(feat ?? null);
      })
      .catch(() => setPolygon(null))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [pc4]);

  const bounds: LatLngBoundsExpression | null = useMemo(
    () => (polygon ? (L.geoJSON(polygon as never).getBounds() as LatLngBoundsExpression) : null),
    [polygon],
  );

  const bufferUnion = useMemo(() => {
    if (!muniGeojson || typeof muniGeojson !== 'object') return null;
    const fc = muniGeojson as MuniGeojson;
    if (!Array.isArray(fc.features)) return null;
    const feat = fc.features.find(
      (f) => f.properties?.type === 'buffer_union_400m',
    );
    return feat ?? null;
  }, [muniGeojson]);

  const fallbackCenter: [number, number] = suggestion
    ? [suggestion.lat, suggestion.lon]
    : [52.15, 5.3];

  return (
    <div className="relative w-full h-full">
      {mounted && (
      <MapContainer
        key={pc4}
        center={fallbackCenter}
        zoom={14}
        style={{ width: '100%', height: '100%' }}
        preferCanvas
      >
        <ImperativeTileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        {polygon && (
          <GeoJSON
            data={polygon as never}
            style={() => ({
              color: '#1e3a8a', // blue-900
              weight: 2,
              fillColor: '#3b82f6', // blue-500
              fillOpacity: 0.10,
            })}
          />
        )}
        {bufferUnion && (
          <GeoJSON
            key={`buf-${pc4}`}
            data={bufferUnion as never}
            style={() => ({
              color: '#7c3aed',
              weight: 1,
              fillColor: '#a78bfa',
              fillOpacity: 0.18,
            })}
          />
        )}
        <FitToBounds bounds={bounds} />
        {suggestion && (
          <>
            <Circle
              center={[suggestion.lat, suggestion.lon]}
              radius={400}
              pathOptions={{
                color: '#b45309', // amber-700 — pairs with the amber pin
                weight: 1.5,
                fillColor: '#fbbf24', // amber-400
                fillOpacity: 0.10,
                dashArray: '4,4',
              }}
            />
            <CircleMarker
              center={[suggestion.lat, suggestion.lon]}
              radius={8}
              pathOptions={{
                fillColor: '#f59e0b', // amber-500
                fillOpacity: 1,
                color: '#7c2d12', // amber-900
                weight: 2.5,
              }}
            >
              <Popup>
                <div className="text-sm">
                  <div className="font-semibold text-gray-900">Voorgestelde locatie · PC4 {pc4}</div>
                  <div className="text-xs font-mono text-gray-700 mt-1">
                    {suggestion.lat.toFixed(5)}, {suggestion.lon.toFixed(5)}
                  </div>
                  <div className="text-xs text-gray-600 mt-1">
                    Geschat extra bereik (400m): <strong>{suggestion.est_new_pop_within_400m.toLocaleString('nl-NL')}</strong> inwoners
                  </div>
                </div>
              </Popup>
            </CircleMarker>
          </>
        )}
      </MapContainer>
      )}
      {loading && (
        <div className="absolute inset-0 bg-white/60 flex items-center justify-center pointer-events-none">
          <span className="text-xs text-gray-500">PC4 laden...</span>
        </div>
      )}
    </div>
  );
}

// Wrap in React.memo so slider drags in the parent don't re-render the
// mini-maps at all when the relevant props haven't changed. The shallow
// comparison works because `rankedPc4s` preserves the original
// `r.suggestion` reference even when re-spreading rows for the new priority.
const SuggestionMiniMap = memo(SuggestionMiniMapImpl);
export default SuggestionMiniMap;
