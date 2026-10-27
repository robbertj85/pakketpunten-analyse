'use client';

import { useEffect, useMemo, useState } from 'react';
import { MapContainer, Marker, CircleMarker, Circle, GeoJSON, Popup, useMap } from 'react-leaflet';
import type { Feature, FeatureCollection } from 'geojson';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

import { CARRIER_SERIES_COLORS, type Carrier } from '@/lib/carriers';
import { streetViewUrl } from '@/lib/pilotLocations';

export interface SportLocation {
  nr: number;
  naam: string;
  adres: string;
  lat: number;
  lon: number;
}

export interface ContextPoint {
  lat: number;
  lon: number;
  vervoerder: string;
  naam: string;
}

interface Props {
  locations: SportLocation[];
  selectedNr: number | null;
  onSelect: (nr: number) => void;
  carrierPainpoints: Feature[];
  gemeentePainpoints: Feature[];
  contextPoints: ContextPoint[];
  showContext: boolean;
  radiusM: number;
}

/** Rotterdam centrum; de kaart opent ingezoomd op de stad. */
const ROTTERDAM: [number, number] = [51.922, 4.47];

/** Effect-based TileLayer — zie PilotLocationsMap voor de React 19-reden. */
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

function FocusController({ focus }: { focus: [number, number] | null }) {
  const map = useMap();
  useEffect(() => {
    if (focus) map.flyTo(focus, Math.max(map.getZoom(), 15), { duration: 0.6 });
  }, [focus, map]);
  return null;
}

function numberedIcon(nr: number, active: boolean): L.DivIcon {
  const size = active ? 34 : 26;
  return L.divIcon({
    className: '',
    html: `<div style="
      width:${size}px;height:${size}px;border-radius:9999px;
      background:#c2410c;color:#fff;
      display:flex;align-items:center;justify-content:center;
      font-size:${active ? 15 : 12}px;font-weight:700;
      font-family:system-ui,sans-serif;
      border:${active ? 3 : 2}px solid #fff;
      box-shadow:0 1px 4px rgba(0,0,0,.45);
    ">${nr}</div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}

function painpointPopup(f: Feature, layer: L.Layer, bron: string) {
  const p = (f.properties ?? {}) as Record<string, string | number>;
  const regels = [
    `<div style="font-weight:600">PC4 ${p.pc4}${p.gemeente ? ` · ${p.gemeente}` : ''}</div>`,
    `<div style="color:#6b7280">${bron}</div>`,
  ];
  if (p.carriers) regels.push(`<div style="margin-top:4px"><b>Carriers:</b> ${p.carriers}</div>`);
  if (p.toelichting) regels.push(`<div style="color:#6b7280">${p.toelichting}</div>`);
  regels.push(`<div style="margin-top:4px">${p.pakketpunten} bestaande pakketpunten in deze PC4</div>`);
  layer.bindPopup(`<div style="font-size:12px">${regels.join('')}</div>`);
}

export default function SportLocationsMap({
  locations,
  selectedNr,
  onSelect,
  carrierPainpoints,
  gemeentePainpoints,
  contextPoints,
  showContext,
  radiusM,
}: Props) {
  // MapContainer pas na de eerste commit mounten (React 19 / leaflet panes).
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- bewuste mount-vlag
    setMounted(true);
  }, []);

  const selected = locations.find((l) => l.nr === selectedNr) ?? null;
  const focus: [number, number] | null = useMemo(
    () => (selected ? [selected.lat, selected.lon] : null),
    [selected],
  );

  const carrierFc: FeatureCollection = useMemo(
    () => ({ type: 'FeatureCollection', features: carrierPainpoints }),
    [carrierPainpoints],
  );
  const gemeenteFc: FeatureCollection = useMemo(
    () => ({ type: 'FeatureCollection', features: gemeentePainpoints }),
    [gemeentePainpoints],
  );

  return (
    <div className="relative w-full h-full">
      {mounted && (
        <MapContainer
          center={ROTTERDAM}
          zoom={12}
          style={{ width: '100%', height: '100%' }}
          preferCanvas
        >
          <ImperativeTileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          <FocusController focus={focus} />

          {carrierPainpoints.length > 0 && (
            <GeoJSON
              key={`carriers-${carrierPainpoints.length}`}
              data={carrierFc}
              style={() => ({ color: '#b91c1c', weight: 1, fillColor: '#dc2626', fillOpacity: 0.25 })}
              onEachFeature={(f, layer) => painpointPopup(f, layer, 'Pijnpunt volgens carriers')}
            />
          )}
          {gemeentePainpoints.length > 0 && (
            <GeoJSON
              key={`gemeente-${gemeentePainpoints.length}`}
              data={gemeenteFc}
              style={() => ({ color: '#7c3aed', weight: 3, fillOpacity: 0 })}
              onEachFeature={(f, layer) => painpointPopup(f, layer, 'Pijnpunt volgens de gemeente')}
            />
          )}

          {showContext &&
            contextPoints.map((p, i) => (
              <CircleMarker
                key={`ctx-${i}`}
                center={[p.lat, p.lon]}
                radius={4}
                pathOptions={{
                  fillColor: CARRIER_SERIES_COLORS[p.vervoerder as Carrier] ?? '#9ca3af',
                  fillOpacity: 0.85,
                  color: '#ffffff',
                  weight: 1,
                }}
              >
                <Popup>
                  <div className="text-xs">
                    <div className="font-semibold text-foreground">{p.naam || p.vervoerder}</div>
                    <div className="text-muted-foreground">Bestaand pakketpunt · {p.vervoerder}</div>
                  </div>
                </Popup>
              </CircleMarker>
            ))}

          {locations.map((loc) => (
            <Circle
              key={`r-${loc.nr}`}
              center={[loc.lat, loc.lon]}
              radius={radiusM}
              pathOptions={{
                color: '#c2410c',
                weight: loc.nr === selectedNr ? 2 : 1,
                fillColor: '#f97316',
                fillOpacity: loc.nr === selectedNr ? 0.12 : 0.05,
                dashArray: '4,4',
              }}
            />
          ))}

          {locations.map((loc) => {
            const active = loc.nr === selectedNr;
            return (
              <Marker
                key={loc.nr}
                position={[loc.lat, loc.lon]}
                icon={numberedIcon(loc.nr, active)}
                zIndexOffset={active ? 1000 : 0}
                eventHandlers={{ click: () => onSelect(loc.nr) }}
              >
                <Popup>
                  <div className="text-sm">
                    <div className="font-semibold text-foreground">
                      {loc.nr}. {loc.naam}
                    </div>
                    <div className="text-muted-foreground">{loc.adres}</div>
                    <a
                      href={streetViewUrl(loc.lat, loc.lon)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-block mt-2 text-xs font-medium text-primary underline"
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
