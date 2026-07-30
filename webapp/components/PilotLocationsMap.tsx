'use client';

import { useEffect, useMemo, useState } from 'react';
import { MapContainer, Marker, CircleMarker, Circle, Popup, useMap } from 'react-leaflet';
import type { LatLngBoundsExpression } from 'leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

import {
  STATUS_META,
  TYPE_META,
  streetViewUrl,
  type PilotLocation,
} from '@/lib/pilotLocations';

export interface ContextPoint {
  lat: number;
  lon: number;
  vervoerder: string;
  naam: string;
}

interface Props {
  locations: PilotLocation[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  /** Bestaande pakketpunten van de gemeente — context rond de pilotlocaties. */
  contextPoints: ContextPoint[];
  /** Loopafstand-cirkel rond de geselecteerde locatie, in meters. */
  radiusM: number;
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

/** Effect-based TileLayer — de component-variant van react-leaflet voegt de
 * laag tijdens render toe, wat onder React 19 crasht als de pane-tree nog niet
 * gemount is (`this.getPane().appendChild` op undefined). */
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

/** Zoom naar alle locaties van de gemeente; bij een selectie naar dat punt. */
function ViewController({
  bounds,
  focus,
}: {
  bounds: LatLngBoundsExpression | null;
  focus: [number, number] | null;
}) {
  const map = useMap();
  useEffect(() => {
    if (bounds) map.fitBounds(bounds, { padding: [48, 48] });
  }, [bounds, map]);
  useEffect(() => {
    if (focus) map.flyTo(focus, Math.max(map.getZoom(), 15), { duration: 0.6 });
  }, [focus, map]);
  return null;
}

function numberedIcon(rang: number, color: string, active: boolean): L.DivIcon {
  const size = active ? 34 : 26;
  return L.divIcon({
    className: '',
    html: `<div style="
      width:${size}px;height:${size}px;border-radius:9999px;
      background:${color};color:#fff;
      display:flex;align-items:center;justify-content:center;
      font-size:${active ? 15 : 12}px;font-weight:700;
      font-family:system-ui,sans-serif;
      border:${active ? 3 : 2}px solid #fff;
      box-shadow:0 1px 4px rgba(0,0,0,.45);
    ">${rang}</div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}

export default function PilotLocationsMap({
  locations,
  selectedId,
  onSelect,
  contextPoints,
  radiusM,
}: Props) {
  // MapContainer pas na de eerste commit mounten — anders kan React 19 de
  // leaflet-tree mid-render opnieuw opbouwen terwijl panes ontbreken.
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  const selected = useMemo(
    () => locations.find((l) => l.id === selectedId) ?? null,
    [locations, selectedId],
  );

  const bounds: LatLngBoundsExpression | null = useMemo(() => {
    if (locations.length === 0) return null;
    return L.latLngBounds(locations.map((l) => [l.lat, l.lon] as [number, number]));
  }, [locations]);

  const focus: [number, number] | null = useMemo(
    () => (selected ? [selected.lat, selected.lon] : null),
    [selected],
  );

  // Alleen de punten rond de selectie tekenen: het volledige gemeentebestand
  // (honderden punten) maakt de kaart onleesbaar en zegt niets over deze plek.
  const shownContext = useMemo(() => {
    if (!selected) return [];
    return contextPoints.filter(
      (p) =>
        Math.abs(p.lat - selected.lat) < 0.02 && Math.abs(p.lon - selected.lon) < 0.03,
    );
  }, [contextPoints, selected]);

  const fallbackCenter: [number, number] = locations[0]
    ? [locations[0].lat, locations[0].lon]
    : [52.09, 5.12];

  return (
    <div className="relative w-full h-full">
      {mounted && (
        <MapContainer
          center={fallbackCenter}
          zoom={13}
          style={{ width: '100%', height: '100%' }}
          preferCanvas
        >
          <ImperativeTileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          <ViewController bounds={bounds} focus={focus} />

          {shownContext.map((p, i) => (
            <CircleMarker
              key={`ctx-${i}`}
              center={[p.lat, p.lon]}
              radius={4}
              pathOptions={{
                fillColor: PROVIDER_COLOR[p.vervoerder] ?? '#9ca3af',
                fillOpacity: 0.85,
                color: '#ffffff',
                weight: 1,
              }}
            >
              <Popup>
                <div className="text-xs">
                  <div className="font-semibold text-gray-900">{p.naam || p.vervoerder}</div>
                  <div className="text-gray-600">Bestaand pakketpunt · {p.vervoerder}</div>
                  <a
                    href={streetViewUrl(p.lat, p.lon)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-block mt-1.5 font-medium text-blue-600 hover:text-blue-800 underline"
                  >
                    Bekijk in Street View
                  </a>
                </div>
              </Popup>
            </CircleMarker>
          ))}

          {selected && (
            <Circle
              center={[selected.lat, selected.lon]}
              radius={radiusM}
              pathOptions={{
                color: '#1d4ed8',
                weight: 1.5,
                fillColor: '#3b82f6',
                fillOpacity: 0.08,
                dashArray: '4,4',
              }}
            />
          )}

          {locations.map((loc) => {
            const active = loc.id === selectedId;
            return (
              <Marker
                key={loc.id}
                position={[loc.lat, loc.lon]}
                icon={numberedIcon(loc.rang, STATUS_META[loc.status].dot, active)}
                zIndexOffset={active ? 1000 : 0}
                eventHandlers={{ click: () => onSelect(loc.id) }}
              >
                <Popup>
                  <div className="text-sm">
                    <div className="font-semibold text-gray-900">
                      {loc.rang}. {loc.naam}
                    </div>
                    {loc.adres && <div className="text-gray-600">{loc.adres}</div>}
                    <div className="text-xs text-gray-600 mt-1">
                      {TYPE_META[loc.type].label} · {STATUS_META[loc.status].label}
                    </div>
                    <div className="text-xs font-mono text-gray-500 mt-1">
                      {loc.lat.toFixed(5)}, {loc.lon.toFixed(5)}
                    </div>
                    <a
                      href={streetViewUrl(loc.lat, loc.lon)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-block mt-2 text-xs font-medium text-blue-600 hover:text-blue-800 underline"
                    >
                      Bekijk in Street View
                    </a>
                  </div>
                </Popup>
              </Marker>
            );
          })}
        </MapContainer>
      )}
    </div>
  );
}
