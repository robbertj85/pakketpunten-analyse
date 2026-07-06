'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import dynamic from 'next/dynamic';

const SuggestionMiniMap = dynamic(() => import('./SuggestionMiniMap'), {
  ssr: false,
  loading: () => (
    <div className="w-full h-full flex items-center justify-center bg-gray-50 text-xs text-gray-500">
      Kaart laden...
    </div>
  ),
});

const SuggestionBigMap = dynamic(() => import('./SuggestionBigMap'), {
  ssr: false,
  loading: () => (
    <div className="w-full h-full flex items-center justify-center bg-gray-50 text-sm text-gray-500">
      Kaart laden…
    </div>
  ),
});

const PainpointMiniMap = dynamic(() => import('./PainpointMiniMap'), {
  ssr: false,
  loading: () => (
    <div className="w-full h-full flex items-center justify-center bg-gray-50 text-xs text-gray-500">
      Kaart laden...
    </div>
  ),
});

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

/* ------------------------------------------------------------------ Types */

export interface Suggestion {
  lat: number;
  lon: number;
  white_spot_area_m2: number;
  est_new_pop_within_400m: number;
  /** Iteration rank within the PC4 (plek 1/2/3). */
  rank?: number;
  /** True when the coordinate has been snapped to a real BAG pand. */
  snapped_to_bag?: boolean;
  /** Distance (m) from the densest-cell centroid to the snapped building. */
  bag_distance_m?: number;
  /** Comma-separated list of building uses, e.g. "woonfunctie,winkelfunctie". */
  bag_gebruiksdoel?: string | null;
  bag_bouwjaar?: number | null;
  bag_identificatie?: string | null;
  pre_snap_lat?: number;
  pre_snap_lon?: number;
  /** POI (supermarkt, station, ...) that drove the snap target, if any. */
  poi_category?: string | null;
  poi_naam?: string | null;
  poi_distance_m?: number | null;
}

export interface PC4Record {
  pc4: string;
  priority: number;
  /** Backwards-compat: same as underservice_base. */
  underservice: number;
  underservice_base: number;
  underservice_k8: number | null;
  z_underservice_base: number;
  z_underservice_k8: number;
  z_uncovered_pop: number;
  z_density: number;
  z_overlap_penalty: number;
  actual: number;
  /** Backwards-compat: same as predicted_base. */
  predicted: number;
  predicted_base: number;
  predicted_k8: number | null;
  uncovered_pop: number;
  density: number;
  overlap_pct: number;
  coverage_pct_400m: number;
  population: number;
  /** Plek 1 — kept for backward compat; equals suggestions[0]. */
  suggestion: Suggestion | null;
  /** Iteratively derived spots (plek 1/2/3) within this PC4. */
  suggestions?: Suggestion[];
}

export interface MunicipalityBlock {
  gemeente: string;
  pc4s: PC4Record[];
  pc4_count_evaluated: number;
}

/** All spots of a PC4 (plek 1/2/3), falling back to the legacy single field. */
export function spotsOf(r: PC4Record): Suggestion[] {
  if (r.suggestions && r.suggestions.length > 0) return r.suggestions;
  return r.suggestion ? [r.suggestion] : [];
}

/** POI feature as shown on the suggestion maps (toggleable icon layer). */
export interface PoiFeatureLite {
  category: string;
  name: string;
  lat: number;
  lon: number;
}

/** category slug → color/label, from /data/poi/index.json. */
export type PoiCategoryMeta = Record<string, { color: string; label: string }>;

/** Categories shown on the plaatsingsadvies maps — the same set the snap
 * step targets, so the map explains where suggestions gravitate to. */
export const PLAATSING_POI_CATEGORIES = new Set([
  'supermarkt', 'winkelcentrum',
  'ns_station', 'metro_station', 'ov_knooppunt', 'tram_halte',
  'parkeergarage', 'fietsenstalling',
  'bibliotheek', 'gemeentehuis',
]);

export interface PainpointEntry {
  city?: string;
  municipality?: string;
  carriers: string[];
  gemeenten?: string[];
  notes?: string[];
  pakketpunten?: { total: number; locker: number; shop: number };
  points?: PainpointPoint[];
}
export type PainpointsByPc4 = Record<string, PainpointEntry>;

export type PainpointMatchKind = 'carrier' | 'gemeente' | 'both';

export function painpointMatch(entry: PainpointEntry | undefined): PainpointMatchKind | null {
  if (!entry) return null;
  const c = (entry.carriers?.length ?? 0) > 0;
  const g = (entry.gemeenten?.length ?? 0) > 0;
  if (c && g) return 'both';
  if (c) return 'carrier';
  if (g) return 'gemeente';
  return null;
}

export interface ModelMeta {
  label: string;
  features: string[];
  r2: number | null;
}

export interface PlacementSuggestionsPayload {
  generated_at: string;
  weights: {
    underservice: number;
    uncovered_pop: number;
    density: number;
    overlap_penalty: number;
  };
  top_n_per_municipality: number;
  min_pc4_population: number;
  min_white_spot_area_m2: number;
  models?: { base: ModelMeta; k8: ModelMeta };
  by_municipality: Record<string, MunicipalityBlock>;
}

/* ------------------------------------------------------------- Formatters */

const nlInt = (n: number) =>
  n.toLocaleString('nl-NL', { maximumFractionDigits: 0 });
const nlNum1 = (n: number) =>
  n.toLocaleString('nl-NL', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

function priorityTone(priority: number): string {
  // Blue ramp matching the app chrome — distinct from the red/orange pain-points layer.
  if (priority >= 1.5) return 'bg-blue-900 text-white';
  if (priority >= 0.75) return 'bg-blue-700 text-white';
  if (priority >= 0) return 'bg-blue-500 text-white';
  if (priority >= -0.75) return 'bg-blue-300 text-blue-900';
  return 'bg-blue-100 text-blue-900';
}

function csvCell(v: unknown): string {
  if (v == null) return '';
  // NL-Excel: komma als decimaalteken (scheidingsteken is ';').
  if (typeof v === 'number') return String(v).replace('.', ',');
  const s = String(v);
  return /[",;\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function downloadCsv(filename: string, rows: (string | number | null | undefined)[][]) {
  const csv = rows.map((r) => r.map(csvCell).join(';')).join('\r\n');
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function exportAllCsv(payload: PlacementSuggestionsPayload) {
  const header = [
    'gemeente_slug', 'gemeente', 'rank', 'pc4', 'plek', 'priority',
    'actual', 'predicted', 'underservice',
    'population', 'uncovered_pop', 'coverage_pct_400m', 'overlap_pct', 'density',
    'sug_lat', 'sug_lon', 'sug_white_spot_m2', 'sug_est_new_pop_400m',
    'sug_bag_id', 'sug_bag_use', 'sug_bag_year', 'sug_snap_distance_m',
    'sug_poi_category', 'sug_poi_naam', 'sug_poi_distance_m',
  ];
  const rows: (string | number | null)[][] = [header];
  for (const [slug, block] of Object.entries(payload.by_municipality)) {
    block.pc4s.forEach((r, idx) => {
      const spots = spotsOf(r);
      const spotRows: (Suggestion | null)[] = spots.length > 0 ? spots : [null];
      spotRows.forEach((s, spotIdx) => {
        rows.push([
          slug, block.gemeente, idx + 1, r.pc4, s ? spotIdx + 1 : null, r.priority,
          r.actual, r.predicted, r.underservice,
          r.population, r.uncovered_pop, r.coverage_pct_400m, r.overlap_pct, r.density,
          // Coördinaten als string zodat ze de punt als decimaalteken houden.
          s ? String(s.lat) : null,
          s ? String(s.lon) : null,
          s?.white_spot_area_m2 ?? null,
          s?.est_new_pop_within_400m ?? null,
          s?.bag_identificatie ?? null,
          s?.bag_gebruiksdoel ?? null,
          s?.bag_bouwjaar ?? null,
          s?.bag_distance_m ?? null,
          s?.poi_category ?? null,
          s?.poi_naam ?? null,
          s?.poi_distance_m ?? null,
        ]);
      });
    });
  }
  downloadCsv('plaatsingsadvies.csv', rows);
}

/* ------------------------------------------------------------------- UI */

export default function PlacementSuggestionsReport({
  payload,
  painpoints,
}: {
  payload: PlacementSuggestionsPayload;
  painpoints: PainpointsByPc4 | null;
}) {
  const slugs = useMemo(
    () =>
      Object.keys(payload.by_municipality).sort((a, b) =>
        payload.by_municipality[a].gemeente.localeCompare(
          payload.by_municipality[b].gemeente,
          'nl',
        ),
      ),
    [payload],
  );

  const [slug, setSlug] = useState<string>(() => slugs[0] ?? '');

  // On first client render, prefer the user's last selected gemeente from
  // localStorage / ?gemeente= so navigating between pages stays sticky.
  // We only override the lazy-init slugs[0] default when a valid gemeente
  // slug is found — 'nederland' / 'alle-gemeenten' (the national view) is
  // not a key in by_municipality, so it's correctly ignored.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const raw = params.get('gemeente');
    const candidates = [
      raw === 'alle-gemeenten' ? null : raw,
      window.localStorage.getItem('lastSelectedMunicipality'),
    ].filter((v): v is string => Boolean(v));
    for (const c of candidates) {
      if (c && payload.by_municipality[c]) {
        setSlug(c);
        return;
      }
    }
    // No persisted choice — keep the alphabetical default.
  }, [payload]);

  // Persist any change so the main map and other pages pick it up next time.
  useEffect(() => {
    if (!slug || typeof window === 'undefined') return;
    window.localStorage.setItem('lastSelectedMunicipality', slug);
  }, [slug]);
  // How many PC4s to show in the ranking + mini-maps. Server ships up to 10
  // and that's the default so the big map shows the full advised set.
  type TopN = 5 | 10;
  const [topN, setTopN] = useState<TopN>(10);
  // Pijnpunten cross-reference threshold — show PC4s with ≥ this many carrier
  // mentions. Default 2 (3 isn't very useful since the dataset's max is 3).
  const [painpointThreshold, setPainpointThreshold] = useState<number>(2);
  // Mini-map filter for the bottom Pijnpunt-locaties grid.
  type PainpointFilter = 'all' | 'carrier' | 'gemeente' | 'both';
  const [painpointFilter, setPainpointFilter] = useState<PainpointFilter>('all');

  // PC4 currently focused on the big map / side panel. Initially set to the
  // top-ranked PC4 so the side panel is never empty when the page loads.
  const [selectedPc4, setSelectedPc4] = useState<string | null>(null);
  const bigMapRef = useRef<HTMLDivElement | null>(null);

  // Chosen spot (plek 1/2/3) per PC4 — lets the user iterate through the
  // iteratively derived placements within a PC4. Reset on gemeente switch.
  const [spotRankByPc4, setSpotRankByPc4] = useState<Record<string, number>>({});
  const setSpotRank = (pc4: string, rank: number) =>
    setSpotRankByPc4((m) => ({ ...m, [pc4]: rank }));
  useEffect(() => {
    setSpotRankByPc4({});
  }, [slug]);
  const activeSpotOf = (r: PC4Record): Suggestion | null => {
    const spots = spotsOf(r);
    if (spots.length === 0) return null;
    const rank = spotRankByPc4[r.pc4] ?? 1;
    return spots[Math.min(spots.length, Math.max(1, rank)) - 1];
  };

  // Toggleable POI layers (voorzieningen) on the suggestion maps. Lazily
  // fetched per gemeente the first time the master toggle goes on. Every
  // category in the bundle becomes its own layer; the snap-target categories
  // are on by default and rendering defaults to icons.
  const [showPois, setShowPois] = useState(false);
  const [poiFeatures, setPoiFeatures] = useState<PoiFeatureLite[] | null>(null);
  const [poiMeta, setPoiMeta] = useState<PoiCategoryMeta>({});
  const [poiOrder, setPoiOrder] = useState<string[]>([]);
  const [poiSelected, setPoiSelected] = useState<Record<string, boolean>>({});
  const [poiStyle, setPoiStyle] = useState<'icons' | 'dots'>('icons');
  const [poiLoading, setPoiLoading] = useState(false);
  useEffect(() => {
    setPoiFeatures(null);
    setPoiSelected({});
  }, [slug]);
  useEffect(() => {
    if (!showPois || !slug || poiFeatures !== null) return;
    let cancelled = false;
    setPoiLoading(true);
    Promise.all([
      fetch(`/data/poi/by-municipality/${slug}.geojson`).then((r) => (r.ok ? r.json() : null)),
      fetch('/data/poi/index.json').then((r) => (r.ok ? r.json() : null)),
    ])
      .then(([bundle, index]) => {
        if (cancelled) return;
        const feats: PoiFeatureLite[] = [];
        for (const f of bundle?.features ?? []) {
          const cat = f?.properties?.category as string | undefined;
          const c = f?.geometry?.coordinates as [number, number] | undefined;
          if (!cat || !c) continue;
          feats.push({
            category: cat,
            name: (f.properties?.name as string) || '',
            lat: c[1],
            lon: c[0],
          });
        }
        setPoiFeatures(feats);
        const meta: PoiCategoryMeta = {};
        const order: string[] = [];
        for (const cat of index?.categories ?? []) {
          meta[cat.slug] = { color: cat.color, label: cat.label };
          order.push(cat.slug);
        }
        setPoiMeta(meta);
        setPoiOrder(order);
        const present = new Set(feats.map((f) => f.category));
        setPoiSelected((prev) => {
          const next: Record<string, boolean> = {};
          for (const cat of present) {
            next[cat] = prev[cat] ?? PLAATSING_POI_CATEGORIES.has(cat);
          }
          return next;
        });
      })
      .catch(() => !cancelled && setPoiFeatures([]))
      .finally(() => !cancelled && setPoiLoading(false));
    return () => {
      cancelled = true;
    };
  }, [showPois, slug, poiFeatures]);

  // Categories present in this gemeente (index order) with feature counts.
  const poiCategories = useMemo(() => {
    if (!poiFeatures) return [];
    const counts = new Map<string, number>();
    for (const f of poiFeatures) counts.set(f.category, (counts.get(f.category) ?? 0) + 1);
    const known = poiOrder.filter((c) => counts.has(c));
    const unknown = [...counts.keys()].filter((c) => !poiOrder.includes(c)).sort();
    return [...known, ...unknown].map((c) => ({
      category: c,
      count: counts.get(c) ?? 0,
      label: poiMeta[c]?.label ?? c,
      color: poiMeta[c]?.color ?? '#64748b',
    }));
  }, [poiFeatures, poiOrder, poiMeta]);

  const visiblePoiFeatures = useMemo(
    () => (poiFeatures ?? []).filter((f) => poiSelected[f.category]),
    [poiFeatures, poiSelected],
  );

  const handleSelectPc4 = (pc4: string, scroll = false) => {
    setSelectedPc4(pc4);
    if (scroll && bigMapRef.current) {
      bigMapRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  // ---- User-adjustable weights + regression model ---- //
  const defaultWeights = payload.weights;
  type ModelKey = 'base' | 'k8';
  const [model, setModel] = useState<ModelKey>('base');
  const [weights, setWeights] = useState({
    underservice: defaultWeights.underservice,
    uncovered_pop: defaultWeights.uncovered_pop,
    density: defaultWeights.density,
    overlap_penalty: defaultWeights.overlap_penalty,
  });
  const isDefaultConfig =
    model === 'base'
    && weights.underservice === defaultWeights.underservice
    && weights.uncovered_pop === defaultWeights.uncovered_pop
    && weights.density === defaultWeights.density
    && weights.overlap_penalty === defaultWeights.overlap_penalty;
  const resetConfig = () => {
    setModel('base');
    setWeights({ ...defaultWeights });
  };
  // Re-rank the *server-shipped* top-N using the user's chosen weights/model.
  // We don't bring in new PC4s — the original top-N comes from the default
  // config, so under exotic weights some PC4s may be missing. Acceptable
  // first cut; pre-snapping more would multiply the PDOK call budget.
  const score = (r: PC4Record): number => {
    const zUnder = model === 'k8' ? r.z_underservice_k8 : r.z_underservice_base;
    return (
      weights.underservice * zUnder
      + weights.uncovered_pop * r.z_uncovered_pop
      + weights.density * r.z_density
      + weights.overlap_penalty * r.z_overlap_penalty
    );
  };

  // Lazy-load the municipality's parcel-point geojson so the mini-maps can
  // overlay existing buffer-union polygons.
  const [muniGeojson, setMuniGeojson] = useState<unknown | null>(null);
  const [muniLoading, setMuniLoading] = useState(false);
  useEffect(() => {
    if (!slug) return;
    setMuniLoading(true);
    setMuniGeojson(null);
    fetch(`/data/${slug}.geojson`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => setMuniGeojson(data))
      .catch(() => setMuniGeojson(null))
      .finally(() => setMuniLoading(false));
  }, [slug]);

  const block = slug ? payload.by_municipality[slug] : null;

  // Re-rank the shipped top-N using the user's current weights + model.
  // When the config matches defaults this is a no-op (same order, same score).
  const rankedPc4sFull = useMemo(() => {
    if (!block) return [] as PC4Record[];
    return [...block.pc4s]
      .map((r) => ({ ...r, priority: score(r) }))
      .sort((a, b) => b.priority - a.priority);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [block, weights, model]);
  // Slice to the user's chosen top-N for table + mini-map rendering.
  const rankedPc4s = useMemo(
    () => rankedPc4sFull.slice(0, topN),
    [rankedPc4sFull, topN],
  );
  // The server ships up to TOP_N PC4s — that caps how many the toggle can show.
  const availableTopN = block?.pc4s.length ?? 0;

  // Records to feed into the big map: drop any PC4 without a snapped suggestion
  // (the white-spot was too small / no inhabited cells). Preserves rank order.
  const bigMapRecords = useMemo(
    () => rankedPc4s.filter((r) => r.suggestion),
    [rankedPc4s],
  );

  // Keep selectedPc4 valid as the ranking changes — fall back to the top-ranked
  // record so the side panel is never empty.
  useEffect(() => {
    if (bigMapRecords.length === 0) {
      setSelectedPc4(null);
      return;
    }
    if (selectedPc4 && bigMapRecords.some((r) => r.pc4 === selectedPc4)) return;
    setSelectedPc4(bigMapRecords[0].pc4);
  }, [bigMapRecords, selectedPc4]);

  const selectedRecord = useMemo(
    () => bigMapRecords.find((r) => r.pc4 === selectedPc4) ?? null,
    [bigMapRecords, selectedPc4],
  );
  const selectedRank = useMemo(
    () => (selectedRecord ? bigMapRecords.indexOf(selectedRecord) + 1 : 0),
    [bigMapRecords, selectedRecord],
  );

  // PC4s in the selected gemeente flagged as a pijnpunt by either a carrier
  // (≥ threshold carriers) OR by the G4-gemeente itself. Gemeente-flagged
  // PC4s are always included regardless of the carrier-threshold slider.
  const muniPainpoints = useMemo(() => {
    if (!painpoints || !block) return [];
    const muniName = block.gemeente;
    const rows: Array<{ pc4: string; entry: PainpointEntry; kind: PainpointMatchKind }> = [];
    for (const [pc4, entry] of Object.entries(painpoints)) {
      if (entry.municipality !== muniName) continue;
      const kind = painpointMatch(entry);
      if (!kind) continue;
      const passesCarrierThreshold = (entry.carriers?.length ?? 0) >= painpointThreshold;
      const hasGemeenteFlag = (entry.gemeenten?.length ?? 0) > 0;
      if (!passesCarrierThreshold && !hasGemeenteFlag) continue;
      rows.push({ pc4, entry, kind });
    }
    rows.sort(
      (a, b) =>
        b.entry.carriers.length - a.entry.carriers.length ||
        (b.entry.gemeenten?.length ?? 0) - (a.entry.gemeenten?.length ?? 0) ||
        a.pc4.localeCompare(b.pc4),
    );
    return rows;
  }, [painpoints, block, painpointThreshold]);

  // Quick lookup for the map-card badges: PC4 → match kind (or null).
  const matchByPc4 = useMemo(() => {
    const m = new Map<string, PainpointMatchKind>();
    if (!painpoints || !block) return m;
    const muniName = block.gemeente;
    for (const [pc4, entry] of Object.entries(painpoints)) {
      if (entry.municipality !== muniName) continue;
      const kind = painpointMatch(entry);
      if (kind) m.set(pc4, kind);
    }
    return m;
  }, [painpoints, block]);

  // Max carriers seen across the whole painpoints dataset — caps the slider.
  const painpointMaxCarriers = useMemo(() => {
    if (!painpoints) return 0;
    let max = 0;
    for (const e of Object.values(painpoints)) {
      max = Math.max(max, e.carriers?.length ?? 0);
    }
    return max;
  }, [painpoints]);

  return (
    <>
      {/* Intro */}
      <div data-tour="intro" className="mb-6 p-4 bg-blue-50 border border-blue-200 rounded-lg text-sm text-blue-900">
        <h2 className="font-semibold mb-1">Plaatsingsadvies pakketpunten</h2>
        <p>
          Per gemeente rangschikken we de PC4s op een prioriteitsscore die vier
          signalen combineert: <strong>onderbezetting</strong> (regressie:
          voorspelde minus actuele pakketpunten), <strong>onbereikte inwoners</strong>{' '}
          (binnen 400m van een bestaand punt), <strong>adresdichtheid</strong>{' '}
          (CBS oad), en een <strong>overlap-penalty</strong> voor PC4s waar bestaande
          400m-cirkels al een groot deel van de oppervlakte beslaan.
        </p>
        <p className="mt-1">
          Voor de top-{payload.top_n_per_municipality} stelt het systeem een concrete coördinaat voor:
          het representatieve punt van het grootste &quot;witte vlak&quot; in de PC4
          (PC4-polygoon minus de 400m buffer-unie). Dit is een statistisch advies — de
          uiteindelijke locatiekeuze hangt af van bereikbaarheid, panden, vergunningen, etc.
        </p>
      </div>

      {/* Controls */}
      <div data-tour="gemeente-bar" className="bg-white rounded-lg shadow-md p-4 mb-6 flex flex-wrap items-center gap-4">
        <div className="flex items-center gap-3 flex-1 min-w-[280px]">
          <label className="text-sm font-medium text-gray-700">Gemeente</label>
          <select
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            className="flex-1 px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          >
            {slugs.map((s) => (
              <option key={s} value={s}>
                {payload.by_municipality[s].gemeente}
              </option>
            ))}
          </select>
        </div>
        <button
          onClick={() => exportAllCsv(payload)}
          className="px-3 py-2 text-xs font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg hover:bg-emerald-100 transition flex items-center gap-1.5"
          title="Download alle gemeenten als CSV"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
          CSV (alle gemeenten)
        </button>
        <div className="text-xs text-gray-500 ml-auto">
          Gewichten: onderbezetting {payload.weights.underservice.toFixed(2)} · onbereik{' '}
          {payload.weights.uncovered_pop.toFixed(2)} · dichtheid{' '}
          {payload.weights.density.toFixed(2)} · overlap{' '}
          {payload.weights.overlap_penalty.toFixed(2)}
        </div>
      </div>

      {block ? (
        <>
          {/* Summary card */}
          <section data-tour="ranking" className="bg-white rounded-lg shadow-md p-6 mb-6">
            <div className="flex items-baseline justify-between mb-2 gap-3 flex-wrap">
              <h2 className="text-xl font-bold text-gray-900">{block.gemeente}</h2>
              <div className="flex items-center gap-3">
                <p className="text-sm text-gray-600">
                  Top {rankedPc4s.length} prioriteits-PC4s uit{' '}
                  {nlInt(block.pc4_count_evaluated)} geëvalueerd
                </p>
                <div className="inline-flex rounded-lg bg-gray-100 p-1">
                  {([5, 10] as const).map((n) => {
                    const disabled = n > availableTopN;
                    return (
                      <button
                        key={n}
                        type="button"
                        onClick={() => setTopN(n)}
                        disabled={disabled}
                        className={`px-3 py-1 text-xs font-medium rounded-md transition ${
                          topN === n
                            ? 'bg-white text-gray-900 shadow-sm'
                            : disabled
                              ? 'text-gray-400 cursor-not-allowed'
                              : 'text-gray-600 hover:text-gray-900'
                        }`}
                        title={
                          disabled
                            ? `Slechts ${availableTopN} PC4s beschikbaar voor deze gemeente`
                            : undefined
                        }
                      >
                        Top {n}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
            <p className="text-sm text-gray-700">
              Totaal extra inwoners die de top-{rankedPc4s.length} suggesties zouden bereiken
              (binnen 400m van het voorgestelde punt, dasymetrisch geschat):{' '}
              <strong>
                {nlInt(
                  rankedPc4s.reduce(
                    (s, r) => s + (r.suggestion?.est_new_pop_within_400m ?? 0),
                    0,
                  ),
                )}
              </strong>{' '}
              inwoners.
            </p>
          </section>

          {/* Adjustable weights + model toggle. Re-ranks the existing top-N
              client-side; doesn't fetch new PC4s. */}
          <section data-tour="gewichten" className="bg-white rounded-lg shadow-md p-6 mb-6">
            <div className="flex flex-wrap items-baseline justify-between gap-3 mb-3">
              <h3 className="text-lg font-semibold text-gray-900">
                Gewichten & regressiemodel
              </h3>
              <button
                type="button"
                onClick={resetConfig}
                disabled={isDefaultConfig}
                className={`text-xs font-medium px-3 py-1.5 rounded transition ${
                  isDefaultConfig
                    ? 'text-gray-400 bg-gray-100 cursor-default'
                    : 'text-blue-700 bg-blue-50 hover:bg-blue-100'
                }`}
              >
                Reset naar standaard
              </button>
            </div>
            <p className="text-xs text-gray-600 mb-4">
              De score is{' '}
              <span className="font-mono">
                Σ wᵢ·z(signaalᵢ)
              </span>{' '}
              met z-normalisatie binnen de gemeente. Schuif de balken om
              gevoeligheid te onderzoeken — alleen de bestaande top-{rankedPc4s.length}{' '}
              PC4s worden hersorteerd (geen nieuwe PC4s).
            </p>

            {payload.models && (
              <div className="mb-4 flex items-center gap-3 text-sm">
                <span className="font-medium text-gray-700">Regressiemodel:</span>
                <div className="inline-flex rounded-lg bg-gray-100 p-1">
                  {(['base', 'k8'] as const).map((k) => {
                    const meta = payload.models![k];
                    const r2 = meta.r2 != null ? `R² ${meta.r2.toFixed(2)}` : '';
                    return (
                      <button
                        key={k}
                        onClick={() => setModel(k)}
                        className={`px-3 py-1.5 text-xs font-medium rounded-md transition ${
                          model === k
                            ? 'bg-white text-gray-900 shadow-sm'
                            : 'text-gray-600 hover:text-gray-900'
                        }`}
                      >
                        {k === 'base' ? 'Basis (pop+opp)' : 'K=8 best-subset'}
                        <span className="ml-1.5 text-[10px] text-gray-500 font-mono">{r2}</span>
                      </button>
                    );
                  })}
                </div>
                <span className="text-[11px] text-gray-500">
                  {model === 'k8'
                    ? `Features: ${payload.models.k8.features.join(', ')}`
                    : `Features: ${payload.models.base.features.join(', ')}`}
                </span>
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              {([
                ['underservice', 'Onderbezetting', -1, 1, 0.05],
                ['uncovered_pop', 'Onbereikte inwoners', -1, 1, 0.05],
                ['density', 'Dichtheid (oad)', -1, 1, 0.05],
                ['overlap_penalty', 'Overlap-penalty', -1, 1, 0.05],
              ] as const).map(([key, label, min, max, step]) => (
                <label key={key} className="block text-xs">
                  <div className="flex items-baseline justify-between mb-1">
                    <span className="font-medium text-gray-700">{label}</span>
                    <span className="font-mono tabular-nums text-gray-900">
                      {weights[key] >= 0 ? '+' : ''}{weights[key].toFixed(2)}
                    </span>
                  </div>
                  <input
                    type="range"
                    min={min} max={max} step={step}
                    value={weights[key]}
                    onChange={(e) =>
                      setWeights((w) => ({ ...w, [key]: Number(e.target.value) }))
                    }
                    className="w-full accent-blue-600"
                  />
                  <div className="flex justify-between text-[10px] text-gray-400 font-mono">
                    <span>{min.toFixed(1)}</span>
                    <span>standaard {defaultWeights[key].toFixed(2)}</span>
                    <span>+{max.toFixed(1)}</span>
                  </div>
                </label>
              ))}
            </div>
          </section>

          {/* Table */}
          <section className="bg-white rounded-lg shadow-md p-6 mb-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-3">Ranking</h3>
            <div className="overflow-x-auto -mx-6 px-6">
              <table className="w-full text-sm">
                <thead className="border-b border-gray-200">
                  <tr className="text-left">
                    <th className="px-2 py-2 text-xs font-semibold text-gray-600">#</th>
                    <th className="px-2 py-2 text-xs font-semibold text-gray-600">PC4</th>
                    <th className="px-2 py-2 text-xs font-semibold text-gray-600">Prioriteit</th>
                    <th className="px-2 py-2 text-xs font-semibold text-gray-600 text-right">Actueel</th>
                    <th className="px-2 py-2 text-xs font-semibold text-gray-600 text-right">Voorspeld</th>
                    <th className="px-2 py-2 text-xs font-semibold text-gray-600 text-right">Onderbez.</th>
                    <th className="px-2 py-2 text-xs font-semibold text-gray-600 text-right">Inwoners</th>
                    <th className="px-2 py-2 text-xs font-semibold text-gray-600 text-right">Onbereikt</th>
                    <th className="px-2 py-2 text-xs font-semibold text-gray-600 text-right">% 400m bereik</th>
                    <th className="px-2 py-2 text-xs font-semibold text-gray-600 text-right">Overlap</th>
                    <th className="px-2 py-2 text-xs font-semibold text-gray-600 text-right">Dichtheid (oad)</th>
                    <th className="px-2 py-2 text-xs font-semibold text-gray-600 text-right">+inw. binnen 400m</th>
                  </tr>
                </thead>
                <tbody>
                  {rankedPc4s.map((r, idx) => (
                    <tr key={r.pc4} className="border-b border-gray-100 hover:bg-gray-50">
                      <td className="px-2 py-2 text-gray-500 tabular-nums">{idx + 1}</td>
                      <td className="px-2 py-2 font-mono text-gray-900">{r.pc4}</td>
                      <td className="px-2 py-2">
                        <span className={`inline-block px-2 py-0.5 rounded text-xs font-mono tabular-nums ${priorityTone(r.priority)}`}>
                          {r.priority >= 0 ? '+' : ''}{nlNum1(r.priority)}
                        </span>
                      </td>
                      <td className="px-2 py-2 text-right tabular-nums text-gray-700">{r.actual}</td>
                      <td className="px-2 py-2 text-right tabular-nums text-gray-700">
                        {nlNum1(model === 'k8' && r.predicted_k8 != null ? r.predicted_k8 : r.predicted_base)}
                      </td>
                      <td className="px-2 py-2 text-right tabular-nums text-gray-700">
                        {nlNum1(
                          model === 'k8' && r.underservice_k8 != null
                            ? r.underservice_k8 : r.underservice_base,
                        )}
                      </td>
                      <td className="px-2 py-2 text-right tabular-nums text-gray-700">{nlInt(r.population)}</td>
                      <td className="px-2 py-2 text-right tabular-nums text-gray-700">{nlInt(r.uncovered_pop)}</td>
                      <td className="px-2 py-2 text-right tabular-nums text-gray-600">{nlNum1(r.coverage_pct_400m)}%</td>
                      <td className="px-2 py-2 text-right tabular-nums text-gray-600">{nlNum1(r.overlap_pct)}%</td>
                      <td className="px-2 py-2 text-right tabular-nums text-gray-600">{nlInt(r.density)}</td>
                      <td className="px-2 py-2 text-right tabular-nums font-semibold text-blue-800">
                        {r.suggestion ? nlInt(r.suggestion.est_new_pop_within_400m) : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {/* Big map + detail panel — overview of all top-N suggestions */}
          <section
            data-tour="grote-kaart"
            ref={bigMapRef}
            className="bg-white rounded-lg shadow-md p-6 mb-6 scroll-mt-6"
          >
            <div className="flex flex-wrap items-baseline justify-between gap-2 mb-3">
              <h3 className="text-lg font-semibold text-gray-900">
                Voorgestelde locaties op kaart
              </h3>
              <div className="flex flex-wrap items-center gap-3">
                <label data-tour="poi-toggle" className="flex items-center gap-1.5 text-xs text-gray-700 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={showPois}
                    onChange={(e) => setShowPois(e.target.checked)}
                    className="rounded border-gray-300"
                  />
                  Voorzieningen tonen
                  {poiLoading && <span className="text-gray-400">(laden…)</span>}
                  {showPois && poiFeatures && !poiLoading && (
                    <span className="text-gray-400">({visiblePoiFeatures.length})</span>
                  )}
                </label>
                <p className="text-xs text-gray-500">
                  Klik een pin op de kaart of een kaartje hieronder om de details
                  in het rechterpaneel te zien.
                </p>
              </div>
            </div>

            {/* POI layer panel: one toggle per category + render style. */}
            {showPois && poiFeatures && (
              <div className="mb-3 p-3 bg-gray-50 border border-gray-200 rounded-lg">
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                  <label className="flex items-center gap-1.5 text-xs text-gray-700">
                    Weergave
                    <select
                      value={poiStyle}
                      onChange={(e) => setPoiStyle(e.target.value as 'icons' | 'dots')}
                      className="px-2 py-1 text-xs border border-gray-300 rounded bg-white"
                    >
                      <option value="icons">Iconen</option>
                      <option value="dots">Stippen</option>
                    </select>
                  </label>
                  <div className="flex gap-2 text-[11px]">
                    <button
                      type="button"
                      onClick={() =>
                        setPoiSelected(Object.fromEntries(poiCategories.map((c) => [c.category, true])))
                      }
                      className="text-blue-700 hover:text-blue-900 font-semibold"
                    >
                      Alles aan
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setPoiSelected(Object.fromEntries(poiCategories.map((c) => [c.category, false])))
                      }
                      className="text-blue-700 hover:text-blue-900 font-semibold"
                    >
                      Alles uit
                    </button>
                  </div>
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {poiCategories.map((c) => {
                    const active = !!poiSelected[c.category];
                    return (
                      <button
                        key={c.category}
                        type="button"
                        onClick={() =>
                          setPoiSelected((prev) => ({ ...prev, [c.category]: !active }))
                        }
                        className={`flex items-center gap-1.5 px-2 py-1 rounded-full border text-[11px] transition ${
                          active
                            ? 'bg-white border-gray-300 text-gray-800 shadow-sm'
                            : 'bg-gray-100 border-gray-200 text-gray-400'
                        }`}
                        title={`${c.label} (${c.count})`}
                      >
                        <span
                          className="inline-block w-2.5 h-2.5 rounded-full"
                          style={{ background: active ? c.color : '#9ca3af' }}
                        />
                        {c.label}
                        <span className={active ? 'text-gray-400' : 'text-gray-300'}>{c.count}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {bigMapRecords.length === 0 ? (
              <div className="p-4 bg-amber-50 border border-amber-200 rounded text-sm text-amber-900">
                Geen suggesties met snappable BAG-pand voor deze top-{topN}.
              </div>
            ) : (
              <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-4">
                <div className="h-[560px] lg:h-[640px] rounded-lg overflow-hidden border border-gray-200">
                  <SuggestionBigMap
                    municipality={block.gemeente}
                    records={bigMapRecords}
                    selectedPc4={selectedPc4}
                    onSelectPc4={(pc4) => handleSelectPc4(pc4, false)}
                    spotRankByPc4={spotRankByPc4}
                    onSelectSpot={setSpotRank}
                    poiFeatures={showPois ? visiblePoiFeatures : null}
                    poiMeta={poiMeta}
                    poiStyle={poiStyle}
                  />
                </div>

                <aside data-tour="detailpaneel" className="border border-gray-200 rounded-lg overflow-hidden flex flex-col h-[560px] lg:h-[640px]">
                  {selectedRecord && activeSpotOf(selectedRecord) ? (() => {
                    const r = selectedRecord;
                    const spots = spotsOf(r);
                    const activeRank = spotRankByPc4[r.pc4] ?? 1;
                    const s = activeSpotOf(r)!;
                    const sv = `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${s.lat},${s.lon}`;
                    const gm = `https://www.google.com/maps?q=${s.lat},${s.lon}`;
                    const predicted =
                      model === 'k8' && r.predicted_k8 != null
                        ? r.predicted_k8 : r.predicted_base;
                    return (
                      <>
                        <div className="px-4 py-3 bg-blue-50 border-b border-blue-100">
                          <div className="text-[10px] uppercase tracking-wide text-blue-700 font-semibold">
                            Voorstel #{selectedRank}
                          </div>
                          <div className="text-xl font-bold text-gray-900 font-mono">
                            PC4 {r.pc4}
                          </div>
                          <div className="text-xs text-gray-600">
                            {block.gemeente}
                            {' · prioriteit '}
                            <span className="font-mono font-semibold text-blue-800">
                              {r.priority >= 0 ? '+' : ''}{nlNum1(r.priority)}
                            </span>
                          </div>
                          {spots.length > 1 && (
                            <div className="mt-2 flex items-center gap-1.5">
                              <span className="text-[10px] uppercase tracking-wide text-gray-500 font-semibold">
                                Plek
                              </span>
                              <div className="inline-flex rounded overflow-hidden border border-blue-200">
                                {spots.map((_, i) => (
                                  <button
                                    key={i}
                                    type="button"
                                    onClick={() => setSpotRank(r.pc4, i + 1)}
                                    className={`px-2.5 py-1 text-xs font-semibold transition ${
                                      activeRank === i + 1
                                        ? 'bg-blue-700 text-white'
                                        : 'bg-white text-blue-700 hover:bg-blue-50'
                                    }`}
                                  >
                                    {i + 1}
                                  </button>
                                ))}
                              </div>
                              <span className="text-[10px] text-gray-500">
                                iteratief afgeleid binnen deze PC4
                              </span>
                            </div>
                          )}
                        </div>

                        <div className="px-4 py-3 space-y-3 text-xs overflow-y-auto flex-1 min-h-0">
                          <div>
                            <div className="text-gray-500 uppercase tracking-wide">
                              Coördinaat
                            </div>
                            <div className="font-mono text-gray-800">
                              {s.lat.toFixed(5)}, {s.lon.toFixed(5)}
                            </div>
                          </div>

                          <div className="border-t border-gray-100 pt-3">
                            <div className="text-gray-500 uppercase tracking-wide">
                              BAG-pand
                            </div>
                            {s.snapped_to_bag && s.bag_gebruiksdoel ? (
                              <>
                                {s.poi_naam && (
                                  <div className="text-pink-700 font-semibold">
                                    Bij {s.poi_category?.replaceAll('_', ' ')}: {s.poi_naam}
                                    {s.poi_distance_m != null ? ` (${s.poi_distance_m} m)` : ''}
                                  </div>
                                )}
                                <div className="text-gray-800">
                                  {s.bag_gebruiksdoel}
                                  {s.bag_bouwjaar ? ` · bouwjaar ${s.bag_bouwjaar}` : ''}
                                </div>
                                {s.bag_identificatie && (
                                  <div className="font-mono text-[10px] text-gray-500 mt-0.5">
                                    BAG-id: {s.bag_identificatie}
                                  </div>
                                )}
                                {s.bag_distance_m != null && (
                                  <div className="text-[11px] text-gray-500 mt-0.5">
                                    {s.bag_distance_m} m verschoven t.o.v. dichtste 100 m-cel
                                  </div>
                                )}
                              </>
                            ) : (
                              <div className="text-gray-500 italic">
                                Geen BAG-snap (representatief punt van de witte vlek)
                              </div>
                            )}
                          </div>

                          <div className="border-t border-gray-100 pt-3 grid grid-cols-2 gap-2">
                            <div>
                              <div className="text-gray-500">Actueel</div>
                              <div className="font-semibold text-gray-900">
                                {r.actual} pp
                              </div>
                            </div>
                            <div>
                              <div className="text-gray-500">Voorspeld</div>
                              <div className="font-semibold text-gray-900">
                                {nlNum1(predicted)} pp
                              </div>
                            </div>
                            <div>
                              <div className="text-gray-500">Inwoners</div>
                              <div className="font-semibold text-gray-900">
                                {nlInt(r.population)}
                              </div>
                            </div>
                            <div>
                              <div className="text-gray-500">Onbereikt (400 m)</div>
                              <div className="font-semibold text-gray-900">
                                {nlInt(r.uncovered_pop)}
                              </div>
                            </div>
                            <div>
                              <div className="text-gray-500">% binnen 400 m</div>
                              <div className="font-semibold text-gray-900">
                                {nlNum1(r.coverage_pct_400m)}%
                              </div>
                            </div>
                            <div>
                              <div className="text-gray-500">Overlap</div>
                              <div className="font-semibold text-gray-900">
                                {nlNum1(r.overlap_pct)}%
                              </div>
                            </div>
                            <div>
                              <div className="text-gray-500">Dichtheid (oad)</div>
                              <div className="font-semibold text-gray-900">
                                {nlInt(r.density)}
                              </div>
                            </div>
                            <div>
                              <div className="text-gray-500">Wit vlak</div>
                              <div className="font-semibold text-gray-900">
                                {nlNum1(s.white_spot_area_m2 / 10000)} ha
                              </div>
                            </div>
                          </div>

                          <div className="border-t border-gray-100 pt-3">
                            <div className="text-gray-500 uppercase tracking-wide">
                              Geschat extra bereik (400 m)
                            </div>
                            <div className="text-lg font-bold text-blue-800">
                              {nlInt(s.est_new_pop_within_400m)} inwoners
                            </div>
                          </div>

                          <div className="border-t border-gray-100 pt-3 flex flex-col gap-1.5">
                            <Link
                              href={`/data-export/suggesties/3d/${slug}/${r.pc4}${activeRank > 1 ? `?rank=${activeRank}` : ''}`}
                              style={{ color: '#ffffff' }}
                              className="inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-semibold bg-indigo-600 hover:bg-indigo-700 rounded transition no-underline"
                            >
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
                              </svg>
                              Bekijk in 3D
                            </Link>
                            <a
                              href={sv}
                              target="_blank"
                              rel="noopener noreferrer"
                              style={{ color: '#ffffff' }}
                              className="inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-semibold bg-blue-700 hover:bg-blue-800 rounded transition no-underline"
                            >
                              Open in Streetview
                            </a>
                            <a
                              href={gm}
                              target="_blank"
                              rel="noopener noreferrer"
                              style={{ color: '#1f2937' }}
                              className="inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-semibold bg-gray-100 hover:bg-gray-200 rounded transition no-underline"
                            >
                              Open in Google Maps
                            </a>
                          </div>
                        </div>
                      </>
                    );
                  })() : (
                    <div className="p-4 text-sm text-gray-500">
                      Selecteer een suggestie op de kaart.
                    </div>
                  )}
                </aside>
              </div>
            )}
          </section>

          {/* Mini-maps */}
          <section data-tour="minimaps" className="bg-white rounded-lg shadow-md p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-3">Voorgestelde locaties</h3>
            {muniLoading && (
              <p className="text-sm text-gray-500 mb-3">Gemeente-data laden...</p>
            )}
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {/* Mini-maps render in *server* order — never reorder, because
                  moving a Leaflet MapContainer in the DOM breaks its internal
                  pane refs (TileLayer.getPane() returns undefined). We
                  filter to the PC4s in the user's current top-N (which can
                  change with weights/model/topN toggle) but keep them in
                  server order so React only mounts/unmounts trailing maps. */}
              {(() => {
                const topNSet = new Set(rankedPc4s.map((r) => r.pc4));
                return block.pc4s.filter((r) => topNSet.has(r.pc4));
              })().map((r) => {
                const newRank =
                  rankedPc4s.findIndex((rr) => rr.pc4 === r.pc4) + 1;
                const newScore = rankedPc4s.find(
                  (rr) => rr.pc4 === r.pc4,
                )?.priority ?? r.priority;
                const match = matchByPc4.get(r.pc4) ?? null;
                const matchBadge = (() => {
                  if (!match) return null;
                  const label =
                    match === 'both'
                      ? 'Pijnpunt · carrier + gemeente'
                      : match === 'carrier'
                        ? 'Pijnpunt · carrier'
                        : 'Pijnpunt · gemeente';
                  const tone =
                    match === 'both'
                      ? 'bg-blue-700 text-white border-blue-800'
                      : match === 'carrier'
                        ? 'bg-blue-100 text-blue-800 border-blue-200'
                        : 'bg-blue-50 text-blue-800 border-blue-300';
                  return (
                    <span
                      className={`text-[10px] uppercase tracking-wide font-semibold px-1.5 py-0.5 rounded border ${tone}`}
                      title={label}
                    >
                      {label}
                    </span>
                  );
                })();
                const isSelected = selectedPc4 === r.pc4;
                const cardSpots = spotsOf(r);
                const cardRank = Math.min(
                  Math.max(1, spotRankByPc4[r.pc4] ?? 1),
                  Math.max(1, cardSpots.length),
                );
                const cardSpot = cardSpots[cardRank - 1] ?? null;
                return (
                <div
                  key={r.pc4}
                  className={`border rounded-lg overflow-hidden transition ${
                    isSelected
                      ? 'border-blue-500 ring-2 ring-blue-200'
                      : 'border-gray-200 hover:border-blue-300'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => cardSpot && handleSelectPc4(r.pc4, true)}
                    disabled={!cardSpot}
                    className={`w-full px-3 py-2 bg-gray-50 border-b border-gray-200 flex items-center justify-between gap-2 flex-wrap text-left ${
                      cardSpot
                        ? 'cursor-pointer hover:bg-blue-50'
                        : 'cursor-default'
                    }`}
                    title={
                      cardSpot
                        ? 'Bekijk op de grote kaart hierboven'
                        : 'Geen snappable suggestie'
                    }
                  >
                    <div className="text-sm flex items-center gap-2 flex-wrap">
                      <span className="font-mono font-semibold text-gray-900">#{newRank} · PC4 {r.pc4}</span>
                      {matchBadge}
                      {isSelected && (
                        <span className="text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded bg-blue-700 text-white">
                          Geselecteerd
                        </span>
                      )}
                    </div>
                    <span className={`text-xs px-2 py-0.5 rounded font-mono tabular-nums ${priorityTone(newScore)}`}>
                      {newScore >= 0 ? '+' : ''}{nlNum1(newScore)}
                    </span>
                  </button>
                  <div className="h-56">
                    <SuggestionMiniMap
                      pc4={r.pc4}
                      suggestion={cardSpot}
                      spots={r.suggestions}
                      muniGeojson={muniGeojson}
                    />
                  </div>
                  <div className="px-3 py-2 text-xs text-gray-600 bg-white border-t border-gray-100">
                    {cardSpot ? (
                      <>
                        {cardSpots.length > 1 && (
                          <div className="flex items-center gap-1.5 mb-1.5">
                            <span className="text-[10px] uppercase tracking-wide text-gray-500 font-semibold">
                              Plek
                            </span>
                            <div className="inline-flex rounded overflow-hidden border border-blue-200">
                              {cardSpots.map((_, i) => (
                                <button
                                  key={i}
                                  type="button"
                                  onClick={() => setSpotRank(r.pc4, i + 1)}
                                  className={`px-2 py-0.5 text-[11px] font-semibold transition ${
                                    cardRank === i + 1
                                      ? 'bg-blue-700 text-white'
                                      : 'bg-white text-blue-700 hover:bg-blue-50'
                                  }`}
                                >
                                  {i + 1}
                                </button>
                              ))}
                            </div>
                            <Link
                              href={`/data-export/suggesties/3d/${slug}/${r.pc4}${cardRank > 1 ? `?rank=${cardRank}` : ''}`}
                              className="ml-auto text-[11px] font-semibold text-indigo-700 hover:text-indigo-900"
                            >
                              Bekijk in 3D
                            </Link>
                          </div>
                        )}
                        <div>
                          Coördinaat: <span className="font-mono">{cardSpot.lat.toFixed(5)}, {cardSpot.lon.toFixed(5)}</span>
                          {' · '}
                          Wit vlak: {nlNum1(cardSpot.white_spot_area_m2 / 10000)} ha
                          {' · '}
                          Schat. nieuw bereikt: <strong>{nlInt(cardSpot.est_new_pop_within_400m)}</strong> inw.
                        </div>
                        {cardSpot.poi_naam && (
                          <div className="text-[11px] text-pink-700 mt-0.5">
                            Bij {cardSpot.poi_category?.replaceAll('_', ' ')}: {cardSpot.poi_naam}
                            {cardSpot.poi_distance_m != null ? ` (${cardSpot.poi_distance_m} m)` : ''}
                          </div>
                        )}
                        {cardSpot.snapped_to_bag && cardSpot.bag_gebruiksdoel && (
                          <div className="text-[11px] text-blue-700 mt-0.5">
                            BAG-pand: {cardSpot.bag_gebruiksdoel}
                            {cardSpot.bag_bouwjaar ? ` (bouwjaar ${cardSpot.bag_bouwjaar})` : ''}
                            {cardSpot.bag_distance_m != null && `, ${cardSpot.bag_distance_m} m verschoven`}
                          </div>
                        )}
                      </>
                    ) : (
                      <em>Geen bewoond wit vlak ≥ {nlInt(payload.min_white_spot_area_m2)} m² — PC4 al gedekt of de witte vlek is park / water / industrie.</em>
                    )}
                  </div>
                </div>
                );
              })}
            </div>
          </section>
        </>
      ) : (
        <div className="p-6 bg-amber-50 border border-amber-200 rounded-lg text-amber-900 text-sm">
          Geen gemeente geselecteerd.
        </div>
      )}

      {/* Pijnpunten cross-reference — PC4s flagged by carriers ≥ threshold OR by the G4-gemeente */}
      {painpoints && block && (
        <section className="mt-8 bg-white rounded-lg shadow-md p-6">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
            <div>
              <h3 className="text-lg font-semibold text-gray-900">
                Pijnpunten in {block.gemeente}
              </h3>
              <p className="text-sm text-gray-600">
                PC4s aangedragen door minimaal{' '}
                <strong>{painpointThreshold}</strong>{' '}
                {painpointThreshold === 1 ? 'vervoerder' : 'vervoerders'} of
                door de gemeente zelf. Gemeente-meldingen tellen altijd mee,
                ongeacht de drempel.
              </p>
            </div>
            <div className="flex items-center gap-2 text-xs">
              <label htmlFor="pp-threshold" className="text-gray-600">
                Drempel carriers:
              </label>
              <input
                id="pp-threshold"
                type="range"
                min={1}
                max={Math.max(3, painpointMaxCarriers)}
                step={1}
                value={painpointThreshold}
                onChange={(e) => setPainpointThreshold(Number(e.target.value))}
                className="w-24 accent-blue-600"
              />
              <span className="font-mono tabular-nums w-6 text-right">
                {painpointThreshold}
              </span>
              <Link
                href="/data-export/painpoints"
                className="ml-3 inline-flex items-center gap-1 text-blue-700 hover:text-blue-900 font-medium"
              >
                Carriers →
              </Link>
              <Link
                href="/data-export/gemeente-painpoints"
                className="inline-flex items-center gap-1 text-blue-700 hover:text-blue-900 font-medium"
              >
                Gemeenten →
              </Link>
            </div>
          </div>

          {muniPainpoints.length === 0 ? (
            <p className="text-sm text-gray-500 italic">
              Geen pijnpunten gevonden in {block.gemeente} met de huidige
              drempel. Verlaag de drempel om meer te zien.
            </p>
          ) : (
            <div className="overflow-x-auto -mx-6 px-6">
              <table className="w-full text-sm">
                <thead className="border-b border-gray-200">
                  <tr className="text-left">
                    <th className="px-2 py-2 text-xs font-semibold text-gray-600">PC4</th>
                    <th className="px-2 py-2 text-xs font-semibold text-gray-600">Bron</th>
                    <th className="px-2 py-2 text-xs font-semibold text-gray-600 text-right">
                      # vervoerders
                    </th>
                    <th className="px-2 py-2 text-xs font-semibold text-gray-600">Vervoerders</th>
                    <th className="px-2 py-2 text-xs font-semibold text-gray-600">Gemeente</th>
                    <th className="px-2 py-2 text-xs font-semibold text-gray-600 text-right">
                      Bestaande PP
                    </th>
                    <th className="px-2 py-2 text-xs font-semibold text-gray-600">In top-{topN} advies?</th>
                    <th className="px-2 py-2 text-xs font-semibold text-gray-600">Detail</th>
                  </tr>
                </thead>
                <tbody>
                  {muniPainpoints.map(({ pc4, entry, kind }) => {
                    const inTop5 = rankedPc4s.some((r) => r.pc4 === pc4);
                    const top5Rank = rankedPc4s.findIndex((r) => r.pc4 === pc4) + 1;
                    const kindLabel =
                      kind === 'both' ? 'Carrier + gemeente'
                      : kind === 'carrier' ? 'Carrier'
                      : 'Gemeente';
                    const kindTone =
                      kind === 'both' ? 'bg-blue-700 text-white'
                      : kind === 'carrier' ? 'bg-blue-100 text-blue-800'
                      : 'bg-blue-50 text-blue-800 border border-blue-300';
                    return (
                      <tr key={pc4} className="border-b border-gray-100 hover:bg-blue-50/40">
                        <td className="px-2 py-2 font-mono text-gray-900">{pc4}</td>
                        <td className="px-2 py-2">
                          <span className={`inline-block px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide rounded ${kindTone}`}>
                            {kindLabel}
                          </span>
                        </td>
                        <td className="px-2 py-2 text-right tabular-nums font-semibold text-blue-800">
                          {entry.carriers.length}
                        </td>
                        <td className="px-2 py-2">
                          <div className="flex flex-wrap gap-1">
                            {entry.carriers.map((c) => (
                              <span
                                key={c}
                                className="inline-block px-1.5 py-0.5 text-[10px] font-medium bg-blue-100 text-blue-800 rounded"
                              >
                                {c}
                              </span>
                            ))}
                          </div>
                        </td>
                        <td className="px-2 py-2">
                          {(entry.gemeenten ?? []).length === 0 ? (
                            <span className="text-gray-400">—</span>
                          ) : (
                            <div className="flex flex-wrap gap-1">
                              {(entry.gemeenten ?? []).map((g) => (
                                <span
                                  key={g}
                                  className="inline-block px-1.5 py-0.5 text-[10px] font-medium bg-blue-50 text-blue-800 border border-blue-300 rounded"
                                >
                                  Gemeente {g}
                                </span>
                              ))}
                            </div>
                          )}
                        </td>
                        <td className="px-2 py-2 text-right tabular-nums text-gray-700">
                          {entry.pakketpunten?.total ?? '—'}
                        </td>
                        <td className="px-2 py-2 text-xs">
                          {inTop5 ? (
                            <span className="inline-block px-2 py-0.5 bg-blue-700 text-white rounded font-mono">
                              #{top5Rank}
                            </span>
                          ) : (
                            <span className="text-gray-400">—</span>
                          )}
                        </td>
                        <td className="px-2 py-2 text-xs">
                          <Link
                            href={`/data-export/${kind === 'gemeente' ? 'gemeente-painpoints' : 'painpoints'}#${pc4}`}
                            className="text-blue-700 hover:text-blue-900 font-medium"
                          >
                            Bekijk →
                          </Link>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          <p className="mt-3 text-[11px] text-gray-500">
            Bronnen: <Link href="/data-export/painpoints" className="text-blue-700 hover:text-blue-900">vervoerder-meldingen</Link>{' '}
            (Convenant Duurzame Pakketlogistiek) en{' '}
            <Link href="/data-export/gemeente-painpoints" className="text-blue-700 hover:text-blue-900">G4-gemeenten</Link>.
            PC4s die ook in de top-{topN} prioriteits-PC4s staan (kolom &quot;In
            top-{topN} advies?&quot;) zijn dubbel-bevestigde kandidaten — zowel
            data-gedreven als door een externe partij genoemd.
          </p>
        </section>
      )}

      {/* Pijnpunt-locaties op de kaart — mini-map per PC4 in this gemeente */}
      {painpoints && block && muniPainpoints.length > 0 && (
        <section className="mt-8 bg-white rounded-lg shadow-md p-6">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
            <div>
              <h3 className="text-lg font-semibold text-gray-900">
                Pijnpunt-locaties in {block.gemeente}
              </h3>
              <p className="text-sm text-gray-600">
                Mini-kaart per pijnpunt-PC4 — toont de PC4-zone en de
                bestaande pakketpunten erin. Filter op bron via de knoppen
                hieronder.
              </p>
            </div>
            <div
              className="inline-flex rounded-md shadow-sm"
              role="group"
              aria-label="Filter pijnpunten op bron"
            >
              {(
                [
                  ['all', 'Alle'],
                  ['carrier', 'Carrier'],
                  ['gemeente', 'Gemeente'],
                  ['both', 'Carrier + gemeente'],
                ] as Array<[PainpointFilter, string]>
              ).map(([key, label], idx, arr) => {
                const active = painpointFilter === key;
                const first = idx === 0;
                const last = idx === arr.length - 1;
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setPainpointFilter(key)}
                    className={`px-3 py-1.5 text-xs font-semibold border transition ${
                      active
                        ? 'bg-blue-700 text-white border-blue-700'
                        : 'bg-white text-blue-700 border-gray-300 hover:bg-blue-50'
                    } ${first ? 'rounded-l-md' : ''} ${last ? 'rounded-r-md' : ''} ${
                      !first ? '-ml-px' : ''
                    }`}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </div>

          {(() => {
            const filtered = muniPainpoints.filter(({ kind }) =>
              painpointFilter === 'all' ? true : kind === painpointFilter,
            );
            if (filtered.length === 0) {
              return (
                <p className="text-sm text-gray-500 italic">
                  Geen pijnpunten in deze categorie voor {block.gemeente}.
                </p>
              );
            }
            return (
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                {filtered.map(({ pc4, entry, kind }) => {
                  const inTop5 = rankedPc4s.some((r) => r.pc4 === pc4);
                  const top5Rank =
                    rankedPc4s.findIndex((r) => r.pc4 === pc4) + 1;
                  const kindLabel =
                    kind === 'both'
                      ? 'Carrier + gemeente'
                      : kind === 'carrier'
                        ? 'Carrier'
                        : 'Gemeente';
                  const kindTone =
                    kind === 'both'
                      ? 'bg-blue-700 text-white'
                      : kind === 'carrier'
                        ? 'bg-blue-100 text-blue-800'
                        : 'bg-blue-50 text-blue-800 border border-blue-300';
                  return (
                    <div
                      key={pc4}
                      className="border border-gray-200 rounded-lg overflow-hidden"
                    >
                      <div className="px-3 py-2 bg-gray-50 border-b border-gray-200 flex items-center justify-between gap-2 flex-wrap">
                        <div className="text-sm flex items-center gap-2 flex-wrap">
                          <span className="font-mono font-semibold text-gray-900">
                            PC4 {pc4}
                          </span>
                          <span
                            className={`text-[10px] uppercase tracking-wide font-semibold px-1.5 py-0.5 rounded ${kindTone}`}
                          >
                            {kindLabel}
                          </span>
                        </div>
                        {inTop5 && (
                          <span className="text-[10px] uppercase tracking-wide font-semibold px-1.5 py-0.5 rounded bg-blue-700 text-white font-mono">
                            Top-{topN} #{top5Rank}
                          </span>
                        )}
                      </div>
                      <div className="h-56">
                        <PainpointMiniMap pc4={pc4} points={entry.points ?? []} />
                      </div>
                      <div className="px-3 py-2 text-xs text-gray-600 bg-white border-t border-gray-100 space-y-1">
                        {entry.carriers.length > 0 && (
                          <div className="flex flex-wrap gap-1 items-center">
                            <span className="text-gray-500">Carriers:</span>
                            {entry.carriers.map((c) => (
                              <span
                                key={c}
                                className="inline-block px-1.5 py-0.5 text-[10px] font-medium bg-blue-100 text-blue-800 rounded"
                              >
                                {c}
                              </span>
                            ))}
                          </div>
                        )}
                        {(entry.gemeenten ?? []).length > 0 && (
                          <div className="flex flex-wrap gap-1 items-center">
                            <span className="text-gray-500">Gemeente:</span>
                            {(entry.gemeenten ?? []).map((g) => (
                              <span
                                key={g}
                                className="inline-block px-1.5 py-0.5 text-[10px] font-medium bg-blue-50 text-blue-800 border border-blue-300 rounded"
                              >
                                Gemeente {g}
                              </span>
                            ))}
                          </div>
                        )}
                        {entry.pakketpunten && (
                          <div className="text-gray-600">
                            Bestaande PP:{' '}
                            <strong>{entry.pakketpunten.total}</strong>{' '}
                            ({entry.pakketpunten.locker} automaten,{' '}
                            {entry.pakketpunten.shop} shops)
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })()}
        </section>
      )}

      {/* Methodology footnote */}
      <div className="mt-8 p-4 bg-gray-50 border border-gray-200 rounded-lg text-xs text-gray-600 space-y-1">
        <p>
          <strong>Score</strong>: priority = {payload.weights.underservice.toFixed(2)}·z(onderbezetting)
          {' + '}{payload.weights.uncovered_pop.toFixed(2)}·z(onbereikte inwoners)
          {' + '}{payload.weights.density.toFixed(2)}·z(oad)
          {' '}{payload.weights.overlap_penalty.toFixed(2)}·z(overlap-penalty),
          waarbij z()-normalisatie binnen de gemeente plaatsvindt (relatieve ranking).
        </p>
        <p>
          <strong>Witte-vlak-detectie</strong>: PC4-polygoon minus 400m buffer-unie van bestaande pakketpunten,
          gemaskeerd op bewoonde 100m-vakjes uit de CBS Vierkantstatistieken (2024). Wit vlak in een park,
          plas, industriegebied of golfbaan valt automatisch af. Slivers &lt; {nlInt(payload.min_white_spot_area_m2)} m² worden genegeerd.
          De gekozen polygoon is degene met de hoogste totale CBS-bevolking; binnen die polygoon kiest het systeem
          het zwaartepunt van het dichtstbevolkte 100m-vak.
        </p>
        <p>
          <strong>Snap naar BAG</strong>: het kandidaatpunt wordt vervolgens gesnapt naar het dichtstbijzijnde
          BAG-pand (PDOK WFS, voorkeur woon/winkel/kantoor/bijeenkomst boven industrie). Hierdoor landt elk advies
          op een echt gebouw met BAG-id en bouwjaar.
        </p>
        <p>
          <strong>Schatting nieuw bereik</strong>: som van inwoners in de CBS 100m-cellen die zowel binnen de 400m-cirkel
          rond de suggestie als binnen de witte vlek liggen. Géén uniforme-dichtheid-aanname meer.
        </p>
        <p>
          <strong>Caveat</strong>: dit is een data-gedreven heuristiek. Onderbezetting r²≈0.44 (basismodel populatie+oppervlakte);
          regressie voorspelt geen vraag, alleen statistische verwachting. Lokaal beleid (vergunningen, openingstijden,
          carrier-aanwezigheid) is leidend.
        </p>
        <p>Gegenereerd op {new Date(payload.generated_at).toLocaleString('nl-NL')}.</p>
      </div>
    </>
  );
}
