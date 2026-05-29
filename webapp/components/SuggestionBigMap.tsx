'use client';

import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { MapContainer, GeoJSON, CircleMarker, Circle, Popup, Tooltip, useMap } from 'react-leaflet';
import type { LatLngBoundsExpression } from 'leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

import type { PC4Record } from './PlacementSuggestionsReport';

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

interface PC4Feature {
  type: 'Feature';
  properties: { pc4: string };
  geometry: unknown;
}

function FitOrFlyTo({
  records,
  selected,
  fitTrigger,
}: {
  records: PC4Record[];
  selected: PC4Record | null;
  fitTrigger: number;
}) {
  const map = useMap();
  const lastFitTrigger = useRef<number | null>(null);

  // First view per municipality: fit all pins so the user gets the lay of the
  // land. We track `fitTrigger` so this only happens when the set of records
  // changes (gemeente switch / topN toggle) — not when the user merely picks
  // a different pin.
  useEffect(() => {
    if (lastFitTrigger.current === fitTrigger) return;
    lastFitTrigger.current = fitTrigger;
    const pts: [number, number][] = records
      .filter((r) => r.suggestion)
      .map((r) => [r.suggestion!.lat, r.suggestion!.lon]);
    if (pts.length === 0) return;
    if (pts.length === 1) {
      map.setView(pts[0], 15);
      return;
    }
    map.fitBounds(L.latLngBounds(pts), { padding: [60, 60], maxZoom: 14 });
  }, [records, fitTrigger, map]);

  // Whenever the user picks a pin (or the default selection updates after the
  // initial fit), fly to that coordinate. Skipped on the same render as the
  // fit so we don't get a snap-then-fly jitter.
  useEffect(() => {
    if (!selected?.suggestion) return;
    if (lastFitTrigger.current !== fitTrigger) return; // fit hasn't run yet
    map.flyTo(
      [selected.suggestion.lat, selected.suggestion.lon],
      16,
      { duration: 0.8 },
    );
  }, [selected, fitTrigger, map]);

  return null;
}

const nlInt = (n: number) =>
  n.toLocaleString('nl-NL', { maximumFractionDigits: 0 });

interface Props {
  municipality: string;
  records: PC4Record[];
  selectedPc4: string | null;
  onSelectPc4: (pc4: string) => void;
}

export default function SuggestionBigMap({
  municipality,
  records,
  selectedPc4,
  onSelectPc4,
}: Props) {
  const [mounted, setMounted] = useState(false);
  const [pc4Features, setPc4Features] = useState<PC4Feature[] | null>(null);
  const [loadingPc4, setLoadingPc4] = useState(true);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Load pc4.geojson once and keep the features for the top-N PC4s. Browser
  // cache makes this cheap even though the mini-maps fetch the same file.
  useEffect(() => {
    let cancelled = false;
    setLoadingPc4(true);
    fetch('/data/pc4.geojson')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled || !data) return;
        const wanted = new Set(records.map((r) => r.pc4));
        const feats = (data.features as PC4Feature[]).filter((f) =>
          wanted.has(f.properties?.pc4),
        );
        setPc4Features(feats);
      })
      .catch(() => setPc4Features(null))
      .finally(() => !cancelled && setLoadingPc4(false));
    return () => {
      cancelled = true;
    };
  }, [records]);

  // A monotonic counter so the fit-to-suggestions effect re-runs when the
  // municipality / top-N set changes, but NOT when the user selects an
  // individual PC4 (that path is handled by FlyToSelected).
  const fitTrigger = useMemo(() => {
    return `${municipality}-${records.map((r) => r.pc4).join(',')}`;
  }, [municipality, records]);

  const fitTriggerNum = useMemo(() => {
    let h = 0;
    for (let i = 0; i < fitTrigger.length; i++) {
      h = (h * 31 + fitTrigger.charCodeAt(i)) | 0;
    }
    return h;
  }, [fitTrigger]);

  const selectedRecord = useMemo(
    () => records.find((r) => r.pc4 === selectedPc4) ?? null,
    [records, selectedPc4],
  );

  if (!mounted) {
    return (
      <div className="w-full h-full flex items-center justify-center bg-gray-50 text-sm text-gray-500">
        Kaart laden…
      </div>
    );
  }

  return (
    <div className="relative w-full h-full">
      <MapContainer
        center={[52.15, 5.3]}
        zoom={7}
        style={{ width: '100%', height: '100%' }}
        preferCanvas
        scrollWheelZoom
      >
        <ImperativeTileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />

        {pc4Features && pc4Features.length > 0 && (
          <GeoJSON
            key={`pc4-${fitTriggerNum}-${selectedPc4 ?? 'none'}`}
            data={{ type: 'FeatureCollection', features: pc4Features } as never}
            interactive={false}
            style={(feature) => {
              const code = (feature?.properties as { pc4?: string })?.pc4;
              const isSelected = code === selectedPc4;
              return {
                color: isSelected ? '#1d4ed8' : '#64748b',
                weight: isSelected ? 2.5 : 1,
                fillColor: '#3b82f6',
                fillOpacity: isSelected ? 0.18 : 0.06,
              };
            }}
          />
        )}

        <FitOrFlyTo
          records={records}
          selected={selectedRecord}
          fitTrigger={fitTriggerNum}
        />

        {records.map((r, idx) => {
          if (!r.suggestion) return null;
          const isSelected = r.pc4 === selectedPc4;
          const s = r.suggestion;
          const streetviewUrl = `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${s.lat},${s.lon}`;
          const mapsUrl = `https://www.google.com/maps?q=${s.lat},${s.lon}`;
          return (
            <Fragment key={`group-${r.pc4}`}>
              {isSelected && (
                <Circle
                  center={[s.lat, s.lon]}
                  radius={400}
                  pathOptions={{
                    color: '#b45309',
                    weight: 1.5,
                    fillColor: '#fbbf24',
                    fillOpacity: 0.10,
                    dashArray: '4,4',
                  }}
                />
              )}
              <CircleMarker
                center={[s.lat, s.lon]}
                radius={isSelected ? 13 : 9}
                pathOptions={{
                  color: isSelected ? '#7c2d12' : '#92400e',
                  weight: isSelected ? 3 : 2,
                  fillColor: isSelected ? '#ea580c' : '#f59e0b',
                  fillOpacity: 1,
                }}
                eventHandlers={{
                  click: () => onSelectPc4(r.pc4),
                }}
              >
                <Tooltip direction="top" offset={[0, -8]} opacity={0.95}>
                  <span className="font-mono text-xs">
                    #{idx + 1} · PC4 {r.pc4}
                  </span>
                </Tooltip>
                <Popup>
                  <div className="text-sm" style={{ minWidth: 200 }}>
                    <div className="font-semibold text-gray-900">
                      #{idx + 1} · PC4 {r.pc4}
                    </div>
                    <div className="text-xs text-gray-600 mt-0.5">
                      {municipality}
                    </div>
                    <div className="text-xs text-gray-700 mt-2">
                      Geschat extra bereik (400m):{' '}
                      <strong>{nlInt(s.est_new_pop_within_400m)}</strong>{' '}
                      inwoners
                    </div>
                    {s.bag_gebruiksdoel && (
                      <div className="text-xs text-blue-800 mt-1">
                        BAG: {s.bag_gebruiksdoel}
                        {s.bag_bouwjaar ? ` (${s.bag_bouwjaar})` : ''}
                      </div>
                    )}
                    <div
                      style={{
                        marginTop: 10,
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 4,
                      }}
                    >
                      <a
                        href={streetviewUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{
                          fontSize: 12,
                          textAlign: 'center',
                          padding: '5px 8px',
                          borderRadius: 4,
                          background: '#1d4ed8',
                          color: '#ffffff',
                          textDecoration: 'none',
                          fontWeight: 600,
                        }}
                      >
                        Open in Streetview
                      </a>
                      <a
                        href={mapsUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{
                          fontSize: 12,
                          textAlign: 'center',
                          padding: '5px 8px',
                          borderRadius: 4,
                          border: '1px solid #d1d5db',
                          color: '#1f2937',
                          textDecoration: 'none',
                        }}
                      >
                        Open in Google Maps
                      </a>
                    </div>
                  </div>
                </Popup>
              </CircleMarker>
            </Fragment>
          );
        })}
      </MapContainer>

      {loadingPc4 && !pc4Features && (
        <div className="absolute inset-0 bg-white/60 flex items-center justify-center pointer-events-none">
          <span className="text-xs text-gray-500">PC4-grenzen laden…</span>
        </div>
      )}
    </div>
  );
}
