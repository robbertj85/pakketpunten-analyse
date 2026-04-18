'use client';

import { useEffect, useMemo, useState } from 'react';
import { MapContainer, TileLayer, GeoJSON, CircleMarker, Popup, useMap } from 'react-leaflet';
import type { LatLngBoundsExpression } from 'leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

interface PainpointPoint {
  lat: number;
  lng: number;
  vervoerder: string;
  category: 'locker' | 'shop';
  puntType: string;
  locatieNaam: string;
  straatNaam: string;
  straatNr: string;
}

interface Props {
  pc4: string;
  points: PainpointPoint[];
}

const PROVIDER_COLOR: Record<string, string> = {
  DHL: '#FFCC00',
  PostNL: '#FF6600',
  VintedGo: '#09B1BA',
  DeBuren: '#4CAF50',
  Amazon: '#FF9900',
  DPD: '#DC0032',
  GLS: '#003C7E',
  ViaTim: '#E3007A',
  InPost: '#FFCD00',
  Budbee: '#00C389',
};

// Fit the map to the polygon bounds whenever the PC4 changes
function FitToFeature({ bounds }: { bounds: LatLngBoundsExpression | null }) {
  const map = useMap();
  useEffect(() => {
    if (bounds) map.fitBounds(bounds, { padding: [20, 20] });
  }, [bounds, map]);
  return null;
}

export default function PainpointMiniMap({ pc4, points }: Props) {
  const [polygon, setPolygon] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setPolygon(null);
    fetch('/data/pc4.geojson')
      .then((res) => res.json())
      .then((data) => {
        if (cancelled) return;
        const feature = data.features.find(
          (f: any) => f.properties?.pc4 === pc4
        );
        setPolygon(feature ?? null);
      })
      .catch((err) => console.error('Failed to load pc4.geojson:', err))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [pc4]);

  // IMPORTANT: derive `bounds` via useMemo so we hand the same reference to
  // FitToFeature's effect across parent re-renders. Without memoisation, each
  // render built a new L.LatLngBounds, which retriggered fitBounds, which via
  // react-leaflet's moveend listener caused another parent render — classic
  // "Maximum update depth exceeded".
  const bounds: LatLngBoundsExpression | null = useMemo(
    () =>
      polygon
        ? (L.geoJSON(polygon).getBounds() as LatLngBoundsExpression)
        : null,
    [polygon],
  );

  // Default center — Dutch G4 roughly in the middle
  const fallbackCenter: [number, number] = points[0]
    ? [points[0].lat, points[0].lng]
    : [52.15, 5.3];

  return (
    <div className="relative w-full h-full">
      <MapContainer
        key={pc4}
        center={fallbackCenter}
        zoom={14}
        style={{ width: '100%', height: '100%' }}
        preferCanvas
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        {polygon && (
          <GeoJSON
            data={polygon}
            style={() => ({
              color: '#b91c1c',
              weight: 2,
              fillColor: '#ef4444',
              fillOpacity: 0.15,
            })}
          />
        )}
        <FitToFeature bounds={bounds} />
        {points.map((p, i) => {
          const color = PROVIDER_COLOR[p.vervoerder] || '#666';
          return (
            <CircleMarker
              key={i}
              center={[p.lat, p.lng]}
              radius={p.category === 'locker' ? 7 : 5}
              pathOptions={{
                fillColor: color,
                fillOpacity: 0.9,
                color: 'white',
                weight: 1.5,
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
                    {p.puntType && <span className="text-gray-500"> ({p.puntType})</span>}
                  </div>
                </div>
              </Popup>
            </CircleMarker>
          );
        })}
      </MapContainer>
      {loading && (
        <div className="absolute inset-0 bg-white/60 flex items-center justify-center pointer-events-none">
          <span className="text-sm text-gray-500">PC4 laden...</span>
        </div>
      )}
    </div>
  );
}
