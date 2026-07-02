'use client';

import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { MapContainer, GeoJSON, CircleMarker, Circle, Marker, Popup, Tooltip, useMap } from 'react-leaflet';
import type { LatLngBoundsExpression } from 'leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

import type { PC4Record, PoiFeatureLite, PoiCategoryMeta, Suggestion } from './PlacementSuggestionsReport';
import { spotsOf } from './PlacementSuggestionsReport';
import { makePoiDivIcon } from '@/utils/poiIcons';

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
  selectedLatLon,
  fitTrigger,
}: {
  records: PC4Record[];
  selectedLatLon: [number, number] | null;
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

  // Whenever the user picks a pin / another spot (or the default selection
  // updates after the initial fit), fly to that coordinate. Skipped on the
  // same render as the fit so we don't get a snap-then-fly jitter.
  useEffect(() => {
    if (!selectedLatLon) return;
    if (lastFitTrigger.current !== fitTrigger) return; // fit hasn't run yet
    map.flyTo(selectedLatLon, 16, { duration: 0.8 });
  }, [selectedLatLon, fitTrigger, map]);

  return null;
}

const nlInt = (n: number) =>
  n.toLocaleString('nl-NL', { maximumFractionDigits: 0 });

interface Props {
  municipality: string;
  records: PC4Record[];
  selectedPc4: string | null;
  onSelectPc4: (pc4: string) => void;
  /** Chosen spot (plek 1/2/3) per PC4; default plek 1. */
  spotRankByPc4?: Record<string, number>;
  onSelectSpot?: (pc4: string, rank: number) => void;
  /** Toggleable POI layer (voorzieningen), null = hidden. */
  poiFeatures?: PoiFeatureLite[] | null;
  poiMeta?: PoiCategoryMeta;
  /** POI render style — icons (default) or small dots, like the main map. */
  poiStyle?: 'icons' | 'dots';
}

export default function SuggestionBigMap({
  municipality,
  records,
  selectedPc4,
  onSelectPc4,
  spotRankByPc4,
  onSelectSpot,
  poiFeatures,
  poiMeta,
  poiStyle = 'icons',
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

  // Active spot per record (plek 1/2/3) — the primary marker position.
  const activeSpot = (r: PC4Record): Suggestion | null => {
    const spots = spotsOf(r);
    if (spots.length === 0) return null;
    const rank = spotRankByPc4?.[r.pc4] ?? 1;
    return spots[Math.min(spots.length, Math.max(1, rank)) - 1];
  };

  const selectedLatLon = useMemo<[number, number] | null>(() => {
    const s = selectedRecord ? activeSpot(selectedRecord) : null;
    return s ? [s.lat, s.lon] : null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedRecord, spotRankByPc4]);

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
          selectedLatLon={selectedLatLon}
          fitTrigger={fitTriggerNum}
        />

        {/* Toggleable POI layers (voorzieningen) — icons or dots per category. */}
        {poiFeatures?.map((p, i) => {
          const meta = poiMeta?.[p.category];
          const color = meta?.color ?? '#64748b';
          const tooltip = (
            <Tooltip direction="top" offset={[0, -8]} opacity={0.95}>
              <span className="text-xs">
                {meta?.label ?? p.category}
                {p.name ? ` · ${p.name}` : ''}
              </span>
            </Tooltip>
          );
          if (poiStyle === 'dots') {
            return (
              <CircleMarker
                key={`poi-${i}`}
                center={[p.lat, p.lon]}
                radius={3.5}
                pathOptions={{ color: '#ffffff', weight: 1, fillColor: color, fillOpacity: 0.9 }}
              >
                {tooltip}
              </CircleMarker>
            );
          }
          return (
            <Marker
              key={`poi-${i}`}
              position={[p.lat, p.lon]}
              icon={makePoiDivIcon(p.category, color, 18)}
              zIndexOffset={-500}
            >
              {tooltip}
            </Marker>
          );
        })}

        {records.map((r, idx) => {
          const s = activeSpot(r);
          if (!s) return null;
          const isSelected = r.pc4 === selectedPc4;
          const spots = spotsOf(r);
          const activeIdx = spots.indexOf(s);
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
              {/* Alternative spots (plek 2/3) of the selected PC4 — dimmed,
                  clickable to switch the active spot. */}
              {isSelected &&
                spots.map((alt, ai) => {
                  if (ai === activeIdx) return null;
                  return (
                    <CircleMarker
                      key={`alt-${r.pc4}-${ai}`}
                      center={[alt.lat, alt.lon]}
                      radius={7}
                      pathOptions={{
                        color: '#92400e',
                        weight: 1.5,
                        fillColor: '#fcd34d',
                        fillOpacity: 0.65,
                        dashArray: '2,3',
                      }}
                      eventHandlers={{
                        click: () => onSelectSpot?.(r.pc4, ai + 1),
                      }}
                    >
                      <Tooltip direction="top" offset={[0, -8]} opacity={0.95}>
                        <span className="font-mono text-xs">
                          Plek {ai + 1} · +{nlInt(alt.est_new_pop_within_400m)} inw. — klik om te kiezen
                        </span>
                      </Tooltip>
                    </CircleMarker>
                  );
                })}
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
                    {spots.length > 1 ? ` · plek ${activeIdx + 1}` : ''}
                  </span>
                </Tooltip>
                <Popup>
                  <div className="text-sm" style={{ minWidth: 200 }}>
                    <div className="font-semibold text-gray-900">
                      #{idx + 1} · PC4 {r.pc4}
                      {spots.length > 1 ? ` · plek ${activeIdx + 1}` : ''}
                    </div>
                    <div className="text-xs text-gray-600 mt-0.5">
                      {municipality}
                    </div>
                    <div className="text-xs text-gray-700 mt-2">
                      Geschat extra bereik (400m):{' '}
                      <strong>{nlInt(s.est_new_pop_within_400m)}</strong>{' '}
                      inwoners
                    </div>
                    {s.poi_naam && (
                      <div className="text-xs text-pink-700 mt-1">
                        Bij {s.poi_category?.replaceAll('_', ' ')}: {s.poi_naam}
                      </div>
                    )}
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
