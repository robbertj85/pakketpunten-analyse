'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  MapContainer,
  TileLayer,
  CircleMarker,
  Marker,
  Popup,
  GeoJSON,
  Pane,
  useMap,
} from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { makePoiDivIcon } from '@/utils/poiIcons';

interface PoiCategoryMeta {
  slug: string;
  label: string;
  group: 'ov' | 'publiek' | 'onderwijs' | 'voorzieningen';
  color: string;
  count: number;
}

interface BundleFeature {
  type: 'Feature';
  geometry: { type: 'Point'; coordinates: [number, number] };
  properties: { category: string; name: string; operator: string };
}

interface Bundle {
  type: 'FeatureCollection';
  metadata: {
    gemeente: string;
    slug: string;
    total: number;
    by_category: Record<string, number>;
  };
  features: BundleFeature[];
}

interface PainpointEntry {
  city: string;
  carriers: string[];
  gemeenten?: string[];
  pois?: Record<string, number>;
  pakketpunten?: { total: number; locker: number; shop: number };
}

const GROUP_LABEL: Record<PoiCategoryMeta['group'], string> = {
  ov: 'OV-locaties',
  publiek: 'Publieke gebouwen',
  onderwijs: 'Onderwijs',
  voorzieningen: 'Voorzieningen',
};
const GROUP_ORDER: PoiCategoryMeta['group'][] = ['ov', 'publiek', 'onderwijs', 'voorzieningen'];

interface MunicipalityOpt {
  slug: string;
  name: string;
  population?: number;
}

const G4_DEFAULT = 'amsterdam';

function FitToBundle({ features }: { features: BundleFeature[] }) {
  const map = useMap();
  useEffect(() => {
    if (features.length === 0) return;
    const bounds = L.latLngBounds(
      features.map((f) => [f.geometry.coordinates[1], f.geometry.coordinates[0]])
    );
    map.fitBounds(bounds, { padding: [30, 30] });
  }, [features, map]);
  return null;
}

export default function PoiExplorer() {
  const [categories, setCategories] = useState<PoiCategoryMeta[]>([]);
  const [active, setActive] = useState<Set<string>>(new Set());
  const [showPainpoints, setShowPainpoints] = useState(false);
  const [pc4Geo, setPc4Geo] = useState<any | null>(null);
  const [painpoints, setPainpoints] = useState<Record<string, PainpointEntry>>({});
  const [selectedPc4, setSelectedPc4] = useState<string | null>(null);

  // Per-municipality bundle
  const [muniIndex, setMuniIndex] = useState<Record<string, { gemeente: string; total: number; by_category: Record<string, number> }>>({});
  const [municipalities, setMunicipalities] = useState<MunicipalityOpt[]>([]);
  const [selectedMuni, setSelectedMuni] = useState<string>(G4_DEFAULT);
  const [bundle, setBundle] = useState<Bundle | null>(null);
  const [bundleLoading, setBundleLoading] = useState(false);
  const [iconStyle, setIconStyle] = useState<'dots' | 'icons'>('dots');

  // Load category metadata
  useEffect(() => {
    fetch('/data/poi/index.json')
      .then((r) => r.json())
      .then((d) => setCategories(d.categories || []))
      .catch((err) => console.error('POI index load failed:', err));
  }, []);

  // Load per-municipality index
  useEffect(() => {
    fetch('/data/poi/by-municipality/index.json')
      .then((r) => r.json())
      .then(setMuniIndex)
      .catch((err) => console.error('POI muni index load failed:', err));
  }, []);

  // Load municipality list (only those we have POI bundles for)
  useEffect(() => {
    fetch('/municipalities.json')
      .then((r) => r.json())
      .then((d: MunicipalityOpt[]) => setMunicipalities(d))
      .catch((err) => console.error('Municipality list load failed:', err));
  }, []);

  // Load bundle for selected municipality
  useEffect(() => {
    if (!selectedMuni) return;
    setBundleLoading(true);
    setBundle(null);
    fetch(`/data/poi/by-municipality/${selectedMuni}.geojson`)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((d: Bundle) => setBundle(d))
      .catch((err) => {
        console.error(`Bundle for ${selectedMuni} failed:`, err);
        setBundle({
          type: 'FeatureCollection',
          metadata: { gemeente: '?', slug: selectedMuni, total: 0, by_category: {} },
          features: [],
        });
      })
      .finally(() => setBundleLoading(false));
  }, [selectedMuni]);

  // Painpoint polygons + entries
  useEffect(() => {
    if (!showPainpoints || pc4Geo) return;
    Promise.all([
      fetch('/data/pc4.geojson').then((r) => r.json()),
      fetch('/data/pc4_painpoints.json').then((r) => r.json()),
    ])
      .then(([geo, pp]) => {
        const codes = new Set(Object.keys(pp.painpoints));
        const filtered = {
          ...geo,
          features: geo.features.filter((f: any) =>
            codes.has(String(f.properties?.pc4 ?? '').padStart(4, '0'))
          ),
        };
        setPc4Geo(filtered);
        setPainpoints(pp.painpoints);
      })
      .catch((err) => console.error('Failed to load painpoints overlay:', err));
  }, [showPainpoints, pc4Geo]);

  // Group categories
  const grouped = useMemo(() => {
    const out: Record<string, PoiCategoryMeta[]> = { ov: [], publiek: [], onderwijs: [], voorzieningen: [] };
    categories.forEach((c) => { (out[c.group] ||= []).push(c); });
    return out;
  }, [categories]);

  // Default: enable all OV categories present in this city's bundle
  useEffect(() => {
    if (!bundle || categories.length === 0 || active.size > 0) return;
    const present = new Set(Object.keys(bundle.metadata.by_category));
    const defaults = categories.filter((c) => c.group === 'ov' && present.has(c.slug)).map((c) => c.slug);
    if (defaults.length > 0) setActive(new Set(defaults));
  }, [bundle, categories, active.size]);

  const toggleCategory = (slug: string) => {
    setActive((prev) => {
      const next = new Set(prev);
      if (next.has(slug)) next.delete(slug); else next.add(slug);
      return next;
    });
  };
  const toggleGroup = (group: string, on: boolean) => {
    const present = new Set(Object.keys(bundle?.metadata.by_category || {}));
    const slugs = (grouped[group] || []).filter((c) => present.has(c.slug)).map((c) => c.slug);
    setActive((prev) => {
      const next = new Set(prev);
      slugs.forEach((s) => (on ? next.add(s) : next.delete(s)));
      return next;
    });
  };

  const colorForSlug = (slug: string) => categories.find((c) => c.slug === slug)?.color ?? '#666';
  const labelForSlug = (slug: string) => categories.find((c) => c.slug === slug)?.label ?? slug;

  // Filter bundle features by active categories
  const visibleFeatures = useMemo(() => {
    if (!bundle) return [];
    return bundle.features.filter((f) => active.has(f.properties.category));
  }, [bundle, active]);

  const selectedEntry = selectedPc4 ? painpoints[selectedPc4] : null;

  // Municipality dropdown — only those with a POI bundle, sorted by population desc.
  const muniOptions = useMemo(() => {
    return municipalities
      .filter((m) => muniIndex[m.slug])
      .sort((a, b) => (b.population ?? 0) - (a.population ?? 0));
  }, [municipalities, muniIndex]);

  const currentMeta = muniIndex[selectedMuni];

  return (
    <div className="flex flex-col lg:flex-row gap-4 h-[calc(100vh-220px)] min-h-[600px]">
      {/* Sidebar */}
      <aside data-tour="sidebar" className="lg:w-80 w-full lg:flex-shrink-0 bg-white rounded-lg shadow-md p-4 overflow-y-auto">
        <h2 className="text-lg font-semibold text-gray-900 mb-2">Publieke POI&apos;s</h2>
        <p className="text-xs text-gray-600 mb-3">
          Data uit OpenStreetMap, gefilterd op de geselecteerde gemeente.
        </p>

        <label className="block text-xs font-medium text-gray-700 mb-1">Gemeente</label>
        <select
          data-tour="gemeente-select"
          value={selectedMuni}
          onChange={(e) => { setSelectedMuni(e.target.value); setActive(new Set()); }}
          className="w-full mb-3 px-2 py-1.5 border border-gray-300 rounded text-sm focus:ring-1 focus:ring-teal-500"
        >
          {muniOptions.map((m) => (
            <option key={m.slug} value={m.slug}>
              {m.name} ({muniIndex[m.slug]?.total.toLocaleString('nl-NL')} POIs)
            </option>
          ))}
        </select>

        {bundleLoading && (
          <div className="text-xs text-gray-500 mb-3">Laden…</div>
        )}

        <div className="mb-3">
          <label className="block text-xs font-medium text-gray-700 mb-1">Weergave</label>
          <div data-tour="weergave" className="inline-flex w-full rounded border border-gray-200 overflow-hidden text-xs">
            <button
              type="button"
              className={`flex-1 px-2 py-1 ${iconStyle === 'dots' ? 'bg-teal-600 text-white' : 'text-gray-600 hover:bg-gray-50'}`}
              onClick={() => setIconStyle('dots')}
            >
              Dots
            </button>
            <button
              type="button"
              className={`flex-1 px-2 py-1 ${iconStyle === 'icons' ? 'bg-teal-600 text-white' : 'text-gray-600 hover:bg-gray-50'}`}
              onClick={() => setIconStyle('icons')}
            >
              Iconen
            </button>
          </div>
        </div>

        <div data-tour="pijnpunten" className="mb-4 p-2 rounded bg-violet-50 border border-violet-200">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={showPainpoints}
              onChange={(e) => setShowPainpoints(e.target.checked)}
            />
            <span className="text-sm font-medium text-violet-900">Toon pijnpunten (PC4-niveau)</span>
          </label>
          {showPainpoints && (
            <div className="mt-2 flex items-center gap-1 text-[10px] text-violet-900">
              <span className="text-violet-700">bronnen:</span>
              <span className="inline-flex items-center gap-0.5">
                <span className="inline-block w-3 h-3 rounded-sm" style={{ background: '#a78bfa', border: '1px solid #6d28d9' }} />1
              </span>
              <span className="inline-flex items-center gap-0.5">
                <span className="inline-block w-3 h-3 rounded-sm" style={{ background: '#8b5cf6', border: '1px solid #6d28d9' }} />2
              </span>
              <span className="inline-flex items-center gap-0.5">
                <span className="inline-block w-3 h-3 rounded-sm" style={{ background: '#6d28d9', border: '1px solid #4c1d95' }} />3
              </span>
              <span className="inline-flex items-center gap-0.5">
                <span className="inline-block w-3 h-3 rounded-sm" style={{ background: '#4c1d95', border: '1px solid #2e1065' }} />4+
              </span>
            </div>
          )}
        </div>

        {GROUP_ORDER.map((group) => {
          const list = grouped[group] || [];
          if (list.length === 0) return null;
          const present = currentMeta?.by_category ?? {};
          const allOn = list.every((c) => active.has(c.slug) || !present[c.slug]);
          const anyPresent = list.some((c) => (present[c.slug] ?? 0) > 0);
          if (!anyPresent) return null;
          return (
            <div key={group} data-tour={group === GROUP_ORDER[0] ? 'categorieen' : undefined} className="mb-4">
              <div className="flex items-center justify-between mb-1">
                <h3 className="text-xs uppercase tracking-wide font-semibold text-gray-500">
                  {GROUP_LABEL[group]}
                </h3>
                <button
                  type="button"
                  onClick={() => toggleGroup(group, !allOn)}
                  className="text-xs text-blue-600 hover:text-blue-800"
                >
                  {allOn ? 'Alles uit' : 'Alles aan'}
                </button>
              </div>
              <div className="space-y-1">
                {list.map((c) => {
                  const n = present[c.slug] ?? 0;
                  const disabled = n === 0;
                  return (
                    <label
                      key={c.slug}
                      className={`flex items-center gap-2 px-2 py-1 rounded ${disabled ? 'opacity-40 cursor-not-allowed' : 'hover:bg-gray-50 cursor-pointer'}`}
                    >
                      <input
                        type="checkbox"
                        checked={active.has(c.slug)}
                        onChange={() => !disabled && toggleCategory(c.slug)}
                        disabled={disabled}
                      />
                      <span
                        className="inline-block w-3 h-3 rounded-full flex-shrink-0"
                        style={{ background: c.color }}
                      />
                      <span className="text-sm text-gray-800 flex-1">{c.label}</span>
                      <span className="text-xs text-gray-500 tabular-nums">
                        {n.toLocaleString('nl-NL')}
                      </span>
                    </label>
                  );
                })}
              </div>
            </div>
          );
        })}

        {selectedEntry && (
          <div className="mt-6 p-3 bg-red-50 border border-red-200 rounded">
            <div className="text-xs uppercase tracking-wide text-red-700 mb-1">
              Pijnpunt PC4 {selectedPc4}
            </div>
            <div className="text-sm font-semibold text-gray-900 mb-1">{selectedEntry.city}</div>
            <div className="text-xs text-gray-700 mb-2">
              Carriers: {selectedEntry.carriers.join(', ') || '—'}
              {selectedEntry.gemeenten && selectedEntry.gemeenten.length > 0 &&
                ` · Gemeenten: ${selectedEntry.gemeenten.join(', ')}`}
            </div>
            {selectedEntry.pakketpunten && (
              <div className="text-xs text-gray-700 mb-2">
                Pakketpunten: <span className="font-semibold">{selectedEntry.pakketpunten.total}</span>
                {' '}({selectedEntry.pakketpunten.locker} automaten, {selectedEntry.pakketpunten.shop} shops)
              </div>
            )}
            {selectedEntry.pois && Object.keys(selectedEntry.pois).length > 0 && (
              <div className="mt-2">
                <div className="text-xs uppercase tracking-wide text-gray-500 mb-1">POI&apos;s in PC4</div>
                <ul className="text-xs space-y-0.5">
                  {Object.entries(selectedEntry.pois)
                    .sort(([, a], [, b]) => b - a)
                    .map(([slug, n]) => (
                      <li key={slug} className="flex items-center gap-2">
                        <span
                          className="inline-block w-2 h-2 rounded-full"
                          style={{ background: colorForSlug(slug) }}
                        />
                        <span className="flex-1">{labelForSlug(slug)}</span>
                        <span className="font-semibold tabular-nums">{n}</span>
                      </li>
                    ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </aside>

      {/* Map */}
      <div data-tour="kaart" className="flex-1 bg-white rounded-lg shadow-md overflow-hidden min-h-[400px]">
        <MapContainer
          center={[52.15, 5.3]}
          zoom={8}
          style={{ width: '100%', height: '100%' }}
        >
          <TileLayer
            attribution='&copy; OpenStreetMap'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          {bundle && bundle.features.length > 0 && (
            <FitToBundle features={bundle.features} />
          )}
          {/* Painpoint choropleth sits in a custom pane below the default
              overlayPane (zIndex 400) so POI dots/icons render on top. */}
          <Pane name="painpoint-pane" style={{ zIndex: 350 }} />
          {showPainpoints && pc4Geo && (
            <GeoJSON
              key={`painpoints-${Object.keys(painpoints).length}`}
              pane="painpoint-pane"
              data={pc4Geo}
              style={(feature) => {
                const code = String(feature?.properties?.pc4 ?? '').padStart(4, '0');
                const entry = painpoints[code];
                // Combined intensity = carrier-flags + gemeente-flags
                // (same ramp as the main map's painpoint layer).
                const count = (entry?.carriers.length ?? 0) + (entry?.gemeenten?.length ?? 0);
                const fillColor =
                  count >= 4 ? '#4c1d95' :
                  count === 3 ? '#6d28d9' :
                  count === 2 ? '#8b5cf6' :
                                '#a78bfa';
                const strokeColor =
                  count >= 4 ? '#2e1065' :
                  count === 3 ? '#4c1d95' :
                  count === 2 ? '#6d28d9' :
                                '#6d28d9';
                return {
                  color: strokeColor,
                  weight: 1.5,
                  opacity: 1,
                  fillColor,
                  fillOpacity: 0.6,
                };
              }}
              onEachFeature={(feature, layer) => {
                const code = String(feature.properties?.pc4 ?? '').padStart(4, '0');
                layer.on({ click: () => setSelectedPc4(code) });
                const entry = painpoints[code];
                if (entry) {
                  const count = entry.carriers.length + (entry.gemeenten?.length ?? 0);
                  layer.bindTooltip(
                    `PC4 ${code} — ${entry.city} (${count} bron${count === 1 ? '' : 'nen'})<br>`
                    + `Carriers: ${entry.carriers.join(', ') || '—'}`
                    + (entry.gemeenten?.length ? `<br>Gemeenten: ${entry.gemeenten.join(', ')}` : ''),
                    { sticky: true }
                  );
                }
              }}
            />
          )}
          {visibleFeatures.map((f, i) => {
            const color = colorForSlug(f.properties.category);
            const label = labelForSlug(f.properties.category);
            const [lng, lat] = f.geometry.coordinates;
            const pos: [number, number] = [lat, lng];
            const streetView = `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${lat},${lng}`;
            const gmaps = `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
            const osm = `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=18/${lat}/${lng}`;
            // Inline styles (rather than Tailwind) so Leaflet's default
            // `.leaflet-popup-content a` link styling can't override colours.
            const popup = (
              <Popup>
                <div style={{ minWidth: 200, fontSize: 13 }}>
                  <div style={{ fontWeight: 600 }}>{f.properties.name || label}</div>
                  <div style={{ fontSize: 11, color: '#4b5563' }}>{label}</div>
                  {f.properties.operator && (
                    <div style={{ fontSize: 11, color: '#6b7280', marginTop: 2 }}>{f.properties.operator}</div>
                  )}
                  <div style={{ fontSize: 10, color: '#9ca3af', marginTop: 4, fontVariantNumeric: 'tabular-nums' }}>
                    {lat.toFixed(6)}, {lng.toFixed(6)}
                  </div>
                  <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <a href={streetView} target="_blank" rel="noopener noreferrer"
                       style={{ fontSize: 12, textAlign: 'center', padding: '5px 8px', borderRadius: 4,
                                background: '#2563eb', color: '#fff', textDecoration: 'none', fontWeight: 500 }}>
                      Open in Google Street View
                    </a>
                    <a href={gmaps} target="_blank" rel="noopener noreferrer"
                       style={{ fontSize: 12, textAlign: 'center', padding: '4px 8px', borderRadius: 4,
                                border: '1px solid #d1d5db', color: '#1f2937', textDecoration: 'none' }}>
                      Google Maps
                    </a>
                    <a href={osm} target="_blank" rel="noopener noreferrer"
                       style={{ fontSize: 12, textAlign: 'center', padding: '4px 8px', borderRadius: 4,
                                border: '1px solid #d1d5db', color: '#1f2937', textDecoration: 'none' }}>
                      OpenStreetMap
                    </a>
                  </div>
                </div>
              </Popup>
            );
            if (iconStyle === 'icons') {
              return (
                <Marker
                  key={`${f.properties.category}-${i}`}
                  position={pos}
                  icon={makePoiDivIcon(f.properties.category, color, 24)}
                >
                  {popup}
                </Marker>
              );
            }
            return (
              <CircleMarker
                key={`${f.properties.category}-${i}`}
                center={pos}
                radius={6}
                pathOptions={{ color, fillColor: color, fillOpacity: 0.85, weight: 1 }}
              >
                {popup}
              </CircleMarker>
            );
          })}
        </MapContainer>
      </div>
    </div>
  );
}
