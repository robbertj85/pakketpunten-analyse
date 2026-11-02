'use client';

import { useEffect, useMemo, useState } from 'react';
import { Circle, CircleMarker, MapContainer, Marker, Popup, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

import { EIGENDOM_COLOURS, EIGENDOM_LABELS, locatePick, type EigendomChoice, type LocatedPick } from '@/lib/terrain';
import type { ForecastPick } from '@/types/forecast';

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

function FitTo({ points }: { points: [number, number][] }) {
  const map = useMap();
  const key = points.map((p) => p.join(',')).join(';');
  useEffect(() => {
    if (points.length === 0) return;
    if (points.length === 1) map.setView(points[0], 15);
    else map.fitBounds(L.latLngBounds(points), { padding: [40, 40], maxZoom: 15 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, map]);
  return null;
}

/** A pick shown as a terrain-coloured disc with its year inside. */
function pickIcon(colour: string, year: string, selected: boolean) {
  const size = selected ? 30 : 24;
  return L.divIcon({
    className: '',
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    html: `<div style="width:${size}px;height:${size}px;border-radius:50%;background:${colour};border:2px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,.4);display:flex;align-items:center;justify-content:center;color:#fff;font:600 10px system-ui">'${year.slice(2)}</div>`,
  });
}

interface Props {
  slug: string;
  picks: ForecastPick[];
  choice: EigendomChoice;
  selected: number | null;
  onSelect: (rank: number) => void;
}

export default function ForecastMap({ slug, picks, choice, selected, onSelect }: Props) {
  const [existing, setExisting] = useState<[number, number][]>([]);

  useEffect(() => {
    let cancelled = false;
    fetch(`/data/${slug}.geojson`)
      .then((r) => (r.ok ? r.json() : null))
      .then((gj) => {
        if (cancelled || !gj) return;
        const pts: [number, number][] = [];
        for (const f of gj.features ?? []) {
          if (f.properties?.type === 'pakketpunt') pts.push([f.properties.latitude, f.properties.longitude]);
        }
        setExisting(pts);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [slug]);

  const located = useMemo(
    () => picks.map((p) => locatePick(p, choice)).filter((p): p is LocatedPick => p != null),
    [picks, choice],
  );
  const bounds = useMemo<[number, number][]>(
    () => (located.length ? located.map((l) => [l.lat, l.lon]) : existing.slice(0, 500)),
    [located, existing],
  );

  return (
    <MapContainer center={[52.1, 5.3]} zoom={8} className="h-[520px] w-full rounded-lg" preferCanvas scrollWheelZoom={false}>
      <ImperativeTileLayer
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        attribution="&copy; OpenStreetMap contributors"
      />
      <FitTo points={bounds} />
      {existing.map((p, i) => (
        <CircleMarker
          key={i}
          center={p}
          radius={3}
          pathOptions={{ color: '#4b5563', weight: 1, fillColor: '#9ca3af', fillOpacity: 0.8 }}
        />
      ))}
      {located
        .filter((l) => l.pick.privaat_niet_invulbaar)
        .map((l) => (
          <Circle
            key={`gap-${l.pick.rank}`}
            center={[l.pick.witte_vlek_lat, l.pick.witte_vlek_lon]}
            radius={400}
            pathOptions={{ color: EIGENDOM_COLOURS.publiek, weight: 1.5, dashArray: '6 4', fillOpacity: 0.04 }}
          />
        ))}
      {located.map((l) => (
        <Marker
          key={l.pick.rank}
          position={[l.lat, l.lon]}
          icon={pickIcon(EIGENDOM_COLOURS[l.terrain], l.pick.year, selected === l.pick.rank)}
          eventHandlers={{ click: () => onSelect(l.pick.rank) }}
        >
          <Popup>
            <div className="text-xs space-y-1 min-w-[220px]">
              <div className="font-semibold">
                Plek {l.pick.rank} · verwacht {l.pick.year} · PC4 {l.pick.pc4}
              </div>
              <div>
                {EIGENDOM_LABELS[l.terrain]}
                {l.host ? `: ${l.host.bron}` : ''}
              </div>
              {l.pick.adres && <div className="text-gray-600">{l.pick.adres}</div>}
              {l.pick.est_new_pop_within_400m != null && (
                <div>Bereikt ca. {Math.round(l.pick.est_new_pop_within_400m).toLocaleString('nl-NL')} nieuwe inwoners binnen 400 m</div>
              )}
              {l.pick.privaat_niet_invulbaar && (
                <div className="font-medium">Geen private locatie in deze witte vlek: alleen op publieke grond in te vullen.</div>
              )}
              {choice === 'mix' && l.pick.privaat && l.pick.publiek && (
                <div className="text-gray-600">Publiek alternatief: {l.pick.publiek.bron}</div>
              )}
            </div>
          </Popup>
        </Marker>
      ))}
    </MapContainer>
  );
}
