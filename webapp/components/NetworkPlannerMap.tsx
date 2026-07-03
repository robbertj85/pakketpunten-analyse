'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { MapContainer, GeoJSON, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import buffer from '@turf/buffer';
import union from '@turf/union';
import { featureCollection, point } from '@turf/helpers';
import type { Feature, Polygon, MultiPolygon } from 'geojson';

import type { LockerNetworkPayload, NetworkScenario, CapacityDefaults } from '@/lib/lockerNetwork';
import { columnsNeeded, metersNeeded, nlInt, nlPct1, LOCKER_TYPES, carrierColor } from '@/lib/lockerNetwork';
import { makeCarrierLogoDivIcon } from '@/utils/poiIcons';

// Dot colours for the CBS-cell coverage state.
const COLOR_START = '#94a3b8';     // covered by existing network (slate)
const COLOR_NEW = '#10b981';       // newly covered by placed lockers (emerald)
const COLOR_UNCOVERED = '#ef4444'; // white spot (warm red)

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

function cellColor(rank: number, n: number): string {
  if (rank === 0) return COLOR_START;
  if (rank > 0 && rank <= n) return COLOR_NEW;
  return COLOR_UNCOVERED;
}

// Merged-buffer colour per loopafstand — matches the coverage-circle colours.
const MERGED_COLORS: Record<number, string> = {
  300: '#2563eb',
  400: '#16a34a',
  500: '#f59e0b',
};

type Poly = Feature<Polygon | MultiPolygon>;

// Pairwise merge (same approach as the hoofdkaart's "Samengevoegde buffers"
// and the 3D coverage overlay).
function pairwiseUnion(features: Poly[]): Poly | null {
  if (features.length === 0) return null;
  if (features.length === 1) return features[0];
  const next: Poly[] = [];
  for (let i = 0; i < features.length; i += 2) {
    if (i + 1 < features.length) {
      const result = union(featureCollection([features[i], features[i + 1]]));
      next.push((result as Poly) ?? features[i]);
    } else {
      next.push(features[i]);
    }
  }
  return pairwiseUnion(next);
}

/** Buffer a set of [lon, lat] points by `distance` m and union them into one
 * (multi)polygon — null if there are no points. */
function bufferUnion(points: [number, number][], distance: number): Poly | null {
  if (points.length === 0) return null;
  try {
    const fc = featureCollection(points.map((c) => point(c)));
    const buffered = buffer(fc, distance / 1000, { units: 'kilometers', steps: 24 });
    if (!buffered || buffered.features.length === 0) return null;
    return pairwiseUnion(buffered.features as Poly[]);
  } catch {
    return null;
  }
}

/**
 * The live-calculated merged coverage zone ("samengevoegde buffers"): the union
 * of the walking-distance buffers of the existing parcel points AND the selected
 * new lockers, rendered as one translucent polygon. Managed imperatively so a
 * slider drag just swaps the layer without remounting React children.
 */
function MergedBuffers({ geojson, color }: { geojson: Poly | null; color: string }) {
  const map = useMap();
  useEffect(() => {
    if (!geojson) return;
    const layer = L.geoJSON(geojson as never, {
      interactive: false,
      style: {
        color,
        weight: 2,
        opacity: 0.85,
        fillColor: color,
        fillOpacity: 0.2,
      },
    });
    layer.addTo(map);
    return () => {
      layer.remove();
    };
  }, [map, geojson, color]);
  return null;
}

/**
 * The CBS 100 m dot grid, managed imperatively on a canvas renderer. The
 * ~5-10k cells are created ONCE per scenario; slider changes only re-style
 * the cells whose coverage state flips between prevN and n (precomputed
 * rank buckets), so dragging stays smooth without re-rendering React
 * children or unioning any polygons.
 */
function CellGrid({
  payload,
  scenario,
  n,
}: {
  payload: LockerNetworkPayload;
  scenario: NetworkScenario;
  n: number;
}) {
  const map = useMap();
  const markersRef = useRef<L.CircleMarker[] | null>(null);
  const groupRef = useRef<L.LayerGroup | null>(null);
  const bucketsRef = useRef<Map<number, number[]> | null>(null);
  const prevNRef = useRef(0);
  const rafRef = useRef<number>(0);

  // (Re)build the grid when the scenario (or municipality) changes.
  useEffect(() => {
    const { lat, lon, pop } = payload.cells;
    const renderer = L.canvas({ padding: 0.3 });
    const group = L.layerGroup();
    const markers: L.CircleMarker[] = new Array(lat.length);
    const buckets = new Map<number, number[]>();
    for (let i = 0; i < lat.length; i++) {
      const rank = scenario.cell_rank[i];
      const arr = buckets.get(rank);
      if (arr) arr.push(i);
      else buckets.set(rank, [i]);
      const m = L.circleMarker([lat[i], lon[i]], {
        renderer,
        radius: pop[i] >= 100 ? 3.2 : pop[i] >= 25 ? 2.5 : 1.8,
        stroke: false,
        fillColor: cellColor(rank, prevNRef.current),
        fillOpacity: 0.55,
        interactive: false,
      });
      group.addLayer(m);
      markers[i] = m;
    }
    group.addTo(map);
    markersRef.current = markers;
    groupRef.current = group;
    bucketsRef.current = buckets;
    // Style for the current n (prevN may be stale from the old scenario).
    for (let i = 0; i < markers.length; i++) {
      markers[i].setStyle({ fillColor: cellColor(scenario.cell_rank[i], prevNRef.current) });
    }
    return () => {
      // Stop any pending restyle and any in-flight pan/zoom animation before
      // tearing the layers down — removing layers mid-animation is the classic
      // "el._leaflet_pos is undefined" crash. map.stop() itself needs the map
      // to be fully initialised (React dev double-mounting runs this cleanup
      // before Leaflet has positioned its panes), hence the _loaded guard.
      cancelAnimationFrame(rafRef.current);
      try {
        if ((map as unknown as { _loaded?: boolean })._loaded) map.stop();
      } catch {
        // map already tearing down — nothing to stop
      }
      group.remove();
      markersRef.current = null;
      groupRef.current = null;
      bucketsRef.current = null;
    };
  }, [map, payload, scenario]);

  // Slider updates: only touch the ranks in (prevN, n] or (n, prevN].
  useEffect(() => {
    const markers = markersRef.current;
    const buckets = bucketsRef.current;
    if (!markers || !buckets) return;
    const prevN = prevNRef.current;
    if (prevN === n) return;
    cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => {
      const lo = Math.min(prevN, n);
      const hi = Math.max(prevN, n);
      const color = n > prevN ? COLOR_NEW : COLOR_UNCOVERED;
      for (let rank = lo + 1; rank <= hi; rank++) {
        const idxs = buckets.get(rank);
        if (!idxs) continue;
        for (const i of idxs) markers[i].setStyle({ fillColor: color });
      }
      prevNRef.current = n;
    });
  }, [n]);

  return null;
}

function FitToCells({ payload }: { payload: LockerNetworkPayload }) {
  const map = useMap();
  const lastSlug = useRef<string | null>(null);
  useEffect(() => {
    if (lastSlug.current === payload.slug) return;
    lastSlug.current = payload.slug;
    const { lat, lon } = payload.cells;
    if (lat.length === 0) return;
    let minLat = lat[0], maxLat = lat[0], minLon = lon[0], maxLon = lon[0];
    for (let i = 1; i < lat.length; i++) {
      if (lat[i] < minLat) minLat = lat[i];
      if (lat[i] > maxLat) maxLat = lat[i];
      if (lon[i] < minLon) minLon = lon[i];
      if (lon[i] > maxLon) maxLon = lon[i];
    }
    // No animation: the cell grid is rebuilt at the same moment, and removing
    // canvas markers during an animated fit triggers Leaflet position errors.
    map.fitBounds(L.latLngBounds([minLat, minLon], [maxLat, maxLon]), {
      padding: [20, 20],
      animate: false,
    });
  }, [map, payload]);
  return null;
}

/** Placed lockers (rank <= n) — imperative markers in the type colour. */
function PlacedLockers({
  payload,
  scenario,
  n,
  distance,
  oohShare,
  showRadius,
  onView3D,
}: {
  payload: LockerNetworkPayload;
  scenario: NetworkScenario;
  n: number;
  distance: number;
  oohShare: number;
  showRadius: boolean;
  onView3D: (pickIndex: number) => string;
}) {
  const map = useMap();
  const groupRef = useRef<L.LayerGroup | null>(null);

  useEffect(() => {
    const group = L.layerGroup();
    const cap: CapacityDefaults = payload.capacity_defaults;
    for (let i = 0; i < Math.min(n, scenario.picks.length); i++) {
      const pick = scenario.picks[i];
      const cand = payload.candidates[pick.c];
      const meta = payload.type_meta[cand.type];
      const color = meta?.kleur ?? '#334155';
      if (showRadius) {
        L.circle([cand.lat, cand.lon], {
          radius: distance,
          color,
          weight: 1,
          opacity: 0.35,
          fillColor: color,
          fillOpacity: 0.05,
          interactive: false,
        }).addTo(group);
      }
      const cols = columnsNeeded(pick.gain, cap, oohShare);
      const meters = metersNeeded(cols, cap);
      const m = L.circleMarker([cand.lat, cand.lon], {
        radius: 8,
        color: '#ffffff',
        weight: 2,
        fillColor: color,
        fillOpacity: 1,
      });
      m.bindPopup(
        `<div style="font-size:13px;min-width:190px">` +
          `<div style="font-weight:600">#${i + 1} · ${meta?.label ?? cand.type}</div>` +
          (cand.naam ? `<div style="color:#4b5563">${cand.naam}</div>` : '') +
          `<div style="margin-top:6px;color:#374151">+${nlInt(pick.gain)} inwoners binnen ${distance} m</div>` +
          `<div style="color:#374151">${cols} kolommen · ${nlPct1(meters)} m kluis bij huidig OOH-aandeel</div>` +
          `<div style="margin-top:8px"><a href="${onView3D(i)}" style="display:block;text-align:center;padding:5px 8px;border-radius:4px;background:#4f46e5;color:#ffffff;text-decoration:none;font-weight:600;font-size:12px">Bekijk in 3D</a></div>` +
          `</div>`,
      );
      m.bindTooltip(`#${i + 1} · ${meta?.label ?? cand.type}`, { direction: 'top', offset: [0, -8] });
      group.addLayer(m);
    }
    group.addTo(map);
    groupRef.current = group;
    return () => {
      // Close a popup that may belong to a marker we are about to remove —
      // its close animation would otherwise reference a detached element.
      map.closePopup();
      group.remove();
      groupRef.current = null;
    };
  }, [map, payload, scenario, n, distance, oohShare, showRadius, onView3D]);

  return null;
}

interface BoundaryFeature {
  type: 'Feature';
  properties?: { type?: string; puntType?: string; vervoerder?: string; locatieNaam?: string };
  geometry: { type?: string; coordinates?: [number, number] };
}

interface ExistingLockerPoint {
  lat: number;
  lon: number;
  vervoerder: string;
  naam: string;
}

/** Existing lockers (bestaande automaten) with optional 300/400 m coverage
 * circles, rendered imperatively. Style: carrier-coloured dots or package
 * icons ("punten/iconen"). */
function ExistingLockers({
  points,
  style,
  circles300,
  circles400,
}: {
  points: ExistingLockerPoint[];
  style: 'punten' | 'iconen';
  circles300: boolean;
  circles400: boolean;
}) {
  const map = useMap();

  useEffect(() => {
    const group = L.layerGroup();
    for (const p of points) {
      if (circles300) {
        L.circle([p.lat, p.lon], {
          radius: 300,
          color: '#2563eb',
          weight: 1,
          opacity: 0.35,
          fillColor: '#2563eb',
          fillOpacity: 0.05,
          interactive: false,
        }).addTo(group);
      }
      if (circles400) {
        L.circle([p.lat, p.lon], {
          radius: 400,
          color: '#16a34a',
          weight: 1,
          opacity: 0.35,
          fillColor: '#16a34a',
          fillOpacity: 0.05,
          interactive: false,
        }).addTo(group);
      }
    }
    for (const p of points) {
      const color = carrierColor(p.vervoerder);
      const marker =
        style === 'iconen'
          ? L.marker([p.lat, p.lon], { icon: makeCarrierLogoDivIcon(p.vervoerder, 30) })
          : L.circleMarker([p.lat, p.lon], {
              radius: 4.5,
              color: '#ffffff',
              weight: 1.5,
              fillColor: color,
              fillOpacity: 0.95,
            });
      marker.bindTooltip(`${p.vervoerder}${p.naam ? ` · ${p.naam}` : ''}`, {
        direction: 'top',
        offset: [0, -8],
      });
      group.addLayer(marker);
    }
    group.addTo(map);
    return () => {
      group.remove();
    };
  }, [map, points, style, circles300, circles400]);

  return null;
}

interface Props {
  payload: LockerNetworkPayload;
  scenario: NetworkScenario;
  n: number;
  distance: number;
  oohShare: number;
  view3DHref: (pickIndex: number) => string;
}

export default function NetworkPlannerMap({
  payload,
  scenario,
  n,
  distance,
  oohShare,
  view3DHref,
}: Props) {
  const [mounted, setMounted] = useState(false);
  const [boundary, setBoundary] = useState<BoundaryFeature | null>(null);
  const [existingLockers, setExistingLockers] = useState<ExistingLockerPoint[]>([]);
  const [existingShops, setExistingShops] = useState<ExistingLockerPoint[]>([]);
  const [showRadius, setShowRadius] = useState(false);
  const [showExisting, setShowExisting] = useState(true);
  const [showExistingShops, setShowExistingShops] = useState(false);
  const [existingStyle, setExistingStyle] = useState<'punten' | 'iconen'>('punten');
  const [existingCircles300, setExistingCircles300] = useState(false);
  const [existingCircles400, setExistingCircles400] = useState(false);
  const [showMergedBuffers, setShowMergedBuffers] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Municipality outline + existing lockers from the per-municipality geojson.
  useEffect(() => {
    let cancelled = false;
    setBoundary(null);
    setExistingLockers([]);
    setExistingShops([]);
    fetch(`/data/${payload.slug}.geojson`)
      .then((r) => (r.ok ? r.json() : null))
      .then((g) => {
        if (cancelled || !g?.features) return;
        const feats = g.features as BoundaryFeature[];
        setBoundary(feats.find((f) => f.properties?.type === 'boundary') ?? null);
        const lockers: ExistingLockerPoint[] = [];
        const shops: ExistingLockerPoint[] = [];
        for (const f of feats) {
          if (f.properties?.type !== 'pakketpunt') continue;
          const c = f.geometry?.coordinates;
          if (!c) continue;
          const point = {
            lat: c[1],
            lon: c[0],
            vervoerder: f.properties?.vervoerder ?? 'onbekend',
            naam: f.properties?.locatieNaam ?? '',
          };
          if (LOCKER_TYPES.has(f.properties?.puntType ?? '')) lockers.push(point);
          else shops.push(point);
        }
        setExistingLockers(lockers);
        setExistingShops(shops);
      })
      .catch(() => setBoundary(null));
    return () => {
      cancelled = true;
    };
  }, [payload.slug]);

  const visibleExisting = useMemo(
    () => [
      ...(showExisting ? existingLockers : []),
      ...(showExistingShops ? existingShops : []),
    ],
    [showExisting, showExistingShops, existingLockers, existingShops],
  );

  // Merged coverage zone of the EXISTING points — heavy, so it is cached apart
  // from the slider (recomputes only on toggle / distance / visible-set change).
  const existingUnion = useMemo(() => {
    if (!showMergedBuffers) return null;
    return bufferUnion(
      visibleExisting.map((p) => [p.lon, p.lat] as [number, number]),
      distance,
    );
  }, [showMergedBuffers, visibleExisting, distance]);

  // Combined zone: existing union + the top-N proposed lockers. The pick part is
  // small (≤ n), so folding it into the cached existing union stays cheap while
  // dragging the slider.
  const mergedBuffer = useMemo(() => {
    if (!showMergedBuffers) return null;
    const parts: Poly[] = [];
    if (existingUnion) parts.push(existingUnion);
    const picks = scenario.picks.slice(0, Math.min(n, scenario.picks.length));
    if (picks.length > 0) {
      const pickUnion = bufferUnion(
        picks.map((pk) => {
          const cand = payload.candidates[pk.c];
          return [cand.lon, cand.lat] as [number, number];
        }),
        distance,
      );
      if (pickUnion) parts.push(pickUnion);
    }
    if (parts.length === 0) return null;
    try {
      return pairwiseUnion(parts);
    } catch {
      return existingUnion;
    }
  }, [showMergedBuffers, existingUnion, scenario, n, payload, distance]);

  const mergedColor = MERGED_COLORS[distance] ?? '#16a34a';

  const legend = useMemo(
    () => [
      { color: COLOR_START, label: 'Al gedekt bij start' },
      { color: COLOR_NEW, label: 'Nieuw gedekt' },
      { color: COLOR_UNCOVERED, label: 'Witte vlek' },
    ],
    [],
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
        zoom={11}
        style={{ width: '100%', height: '100%' }}
        preferCanvas
        scrollWheelZoom
      >
        <ImperativeTileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        {boundary && (
          <GeoJSON
            key={`b-${payload.slug}`}
            data={boundary as never}
            interactive={false}
            style={() => ({
              color: '#1e293b',
              weight: 2,
              fillOpacity: 0,
              dashArray: '6,4',
            })}
          />
        )}
        <FitToCells payload={payload} />
        {showMergedBuffers && <MergedBuffers geojson={mergedBuffer} color={mergedColor} />}
        <CellGrid payload={payload} scenario={scenario} n={n} />
        {visibleExisting.length > 0 && (
          <ExistingLockers
            points={visibleExisting}
            style={existingStyle}
            circles300={existingCircles300}
            circles400={existingCircles400}
          />
        )}
        <PlacedLockers
          payload={payload}
          scenario={scenario}
          n={n}
          distance={distance}
          oohShare={oohShare}
          showRadius={showRadius}
          onView3D={view3DHref}
        />
      </MapContainer>

      {/* Legend + radius toggle */}
      <div className="absolute bottom-3 left-3 z-[1000] bg-white/95 rounded-lg shadow px-3 py-2 text-[11px] space-y-1">
        {legend.map((l) => (
          <div key={l.label} className="flex items-center gap-1.5">
            <span
              className="inline-block w-2.5 h-2.5 rounded-full"
              style={{ background: l.color }}
            />
            <span className="text-gray-700">{l.label}</span>
          </div>
        ))}
        <label className="flex items-center gap-1.5 pt-1 border-t border-gray-200 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={showRadius}
            onChange={(e) => setShowRadius(e.target.checked)}
            className="rounded border-gray-300"
          />
          <span className="text-gray-700">Loopafstand nieuwe kluizen</span>
        </label>

        {/* Existing-lockers layers */}
        <div className="pt-1 border-t border-gray-200 space-y-1">
          <div className="flex items-center justify-between gap-2">
            <label className="flex items-center gap-1.5 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={showExisting}
                onChange={(e) => setShowExisting(e.target.checked)}
                className="rounded border-gray-300"
              />
              <span className="text-gray-700">
                Bestaande kluizen ({nlInt(existingLockers.length)})
              </span>
            </label>
            <div className="inline-flex rounded overflow-hidden border border-gray-300">
              {(['punten', 'iconen'] as const).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setExistingStyle(s)}
                  className={`px-1.5 py-0.5 text-[10px] font-semibold transition ${
                    existingStyle === s
                      ? 'bg-blue-700 text-white'
                      : 'bg-white text-gray-600 hover:bg-gray-50'
                  }`}
                >
                  {s === 'punten' ? 'Punten' : 'Iconen'}
                </button>
              ))}
            </div>
          </div>
          <label className="flex items-center gap-1.5 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={showExistingShops}
              onChange={(e) => setShowExistingShops(e.target.checked)}
              className="rounded border-gray-300"
            />
            <span className="text-gray-700">
              Bestaande pakketpunten - overig ({nlInt(existingShops.length)})
            </span>
          </label>
          <label className={`flex items-center gap-1.5 select-none ${visibleExisting.length > 0 ? 'cursor-pointer' : 'opacity-40'}`}>
            <input
              type="checkbox"
              checked={existingCircles300}
              disabled={visibleExisting.length === 0}
              onChange={(e) => setExistingCircles300(e.target.checked)}
              className="rounded border-gray-300"
            />
            <span className="text-gray-700">Dekkingscirkels 300 m</span>
            <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: '#2563eb' }} />
          </label>
          <label className={`flex items-center gap-1.5 select-none ${visibleExisting.length > 0 ? 'cursor-pointer' : 'opacity-40'}`}>
            <input
              type="checkbox"
              checked={existingCircles400}
              disabled={visibleExisting.length === 0}
              onChange={(e) => setExistingCircles400(e.target.checked)}
              className="rounded border-gray-300"
            />
            <span className="text-gray-700">Dekkingscirkels 400 m</span>
            <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: '#16a34a' }} />
          </label>
          <label className="flex items-center gap-1.5 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={showMergedBuffers}
              onChange={(e) => setShowMergedBuffers(e.target.checked)}
              className="rounded border-gray-300"
            />
            <span className="text-gray-700">
              Samengevoegde buffers ({distance} m · bestaand + nieuw)
            </span>
            <span
              className="inline-block w-2.5 h-2.5 rounded-full"
              style={{ background: mergedColor }}
            />
          </label>
        </div>
      </div>
    </div>
  );
}
