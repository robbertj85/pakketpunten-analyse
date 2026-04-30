'use client';

import { useEffect, useMemo, useState } from 'react';
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

/* ------------------------------------------------------------------ Types */

export interface Suggestion {
  lat: number;
  lon: number;
  white_spot_area_m2: number;
  est_new_pop_within_400m: number;
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
  suggestion: Suggestion | null;
}

export interface MunicipalityBlock {
  gemeente: string;
  pc4s: PC4Record[];
  pc4_count_evaluated: number;
}

export interface PainpointEntry {
  city?: string;
  municipality?: string;
  carriers: string[];
  notes?: string[];
  pakketpunten?: { total: number; locker: number; shop: number };
}
export type PainpointsByPc4 = Record<string, PainpointEntry>;

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
    'gemeente_slug', 'gemeente', 'rank', 'pc4', 'priority',
    'actual', 'predicted', 'underservice',
    'population', 'uncovered_pop', 'coverage_pct_400m', 'overlap_pct', 'density',
    'sug_lat', 'sug_lon', 'sug_white_spot_m2', 'sug_est_new_pop_400m',
    'sug_bag_id', 'sug_bag_use', 'sug_bag_year', 'sug_snap_distance_m',
  ];
  const rows: (string | number | null)[][] = [header];
  for (const [slug, block] of Object.entries(payload.by_municipality)) {
    block.pc4s.forEach((r, idx) => {
      rows.push([
        slug, block.gemeente, idx + 1, r.pc4, r.priority,
        r.actual, r.predicted, r.underservice,
        r.population, r.uncovered_pop, r.coverage_pct_400m, r.overlap_pct, r.density,
        r.suggestion?.lat ?? null,
        r.suggestion?.lon ?? null,
        r.suggestion?.white_spot_area_m2 ?? null,
        r.suggestion?.est_new_pop_within_400m ?? null,
        r.suggestion?.bag_identificatie ?? null,
        r.suggestion?.bag_gebruiksdoel ?? null,
        r.suggestion?.bag_bouwjaar ?? null,
        r.suggestion?.bag_distance_m ?? null,

      ]);
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
  // How many PC4s to show in the ranking + mini-maps. Server ships up to 10;
  // default UI is 5 to keep the page focused.
  type TopN = 5 | 10;
  const [topN, setTopN] = useState<TopN>(5);
  // Pijnpunten cross-reference threshold — show PC4s with ≥ this many carrier
  // mentions. Default 2 (3 isn't very useful since the dataset's max is 3).
  const [painpointThreshold, setPainpointThreshold] = useState<number>(2);

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

  // PC4s in the selected gemeente that carriers flagged as pijnpunten.
  const muniPainpoints = useMemo(() => {
    if (!painpoints || !block) return [];
    const muniName = block.gemeente;
    const rows: Array<{ pc4: string; entry: PainpointEntry }> = [];
    for (const [pc4, entry] of Object.entries(painpoints)) {
      if (entry.municipality !== muniName) continue;
      if ((entry.carriers?.length ?? 0) < painpointThreshold) continue;
      rows.push({ pc4, entry });
    }
    rows.sort(
      (a, b) =>
        b.entry.carriers.length - a.entry.carriers.length ||
        a.pc4.localeCompare(b.pc4),
    );
    return rows;
  }, [painpoints, block, painpointThreshold]);

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
      <div className="mb-6 p-4 bg-blue-50 border border-blue-200 rounded-lg text-sm text-blue-900">
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
      <div className="bg-white rounded-lg shadow-md p-4 mb-6 flex flex-wrap items-center gap-4">
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
          <section className="bg-white rounded-lg shadow-md p-6 mb-6">
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
          <section className="bg-white rounded-lg shadow-md p-6 mb-6">
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

          {/* Mini-maps */}
          <section className="bg-white rounded-lg shadow-md p-6">
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
                return (
                <div key={r.pc4} className="border border-gray-200 rounded-lg overflow-hidden">
                  <div className="px-3 py-2 bg-gray-50 border-b border-gray-200 flex items-center justify-between">
                    <div className="text-sm">
                      <span className="font-mono font-semibold text-gray-900">#{newRank} · PC4 {r.pc4}</span>
                    </div>
                    <span className={`text-xs px-2 py-0.5 rounded font-mono tabular-nums ${priorityTone(newScore)}`}>
                      {newScore >= 0 ? '+' : ''}{nlNum1(newScore)}
                    </span>
                  </div>
                  <div className="h-56">
                    <SuggestionMiniMap
                      pc4={r.pc4}
                      suggestion={r.suggestion}
                      muniGeojson={muniGeojson}
                    />
                  </div>
                  <div className="px-3 py-2 text-xs text-gray-600 bg-white border-t border-gray-100">
                    {r.suggestion ? (
                      <>
                        <div>
                          Coördinaat: <span className="font-mono">{r.suggestion.lat.toFixed(5)}, {r.suggestion.lon.toFixed(5)}</span>
                          {' · '}
                          Wit vlak: {nlInt(r.suggestion.white_spot_area_m2 / 1000)} k m²
                          {' · '}
                          Schat. nieuw bereikt: <strong>{nlInt(r.suggestion.est_new_pop_within_400m)}</strong> inw.
                        </div>
                        {r.suggestion.snapped_to_bag && r.suggestion.bag_gebruiksdoel && (
                          <div className="text-[11px] text-blue-700 mt-0.5">
                            BAG-pand: {r.suggestion.bag_gebruiksdoel}
                            {r.suggestion.bag_bouwjaar ? ` (bouwjaar ${r.suggestion.bag_bouwjaar})` : ''}
                            {r.suggestion.bag_distance_m != null && `, ${r.suggestion.bag_distance_m} m verschoven`}
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

      {/* Pijnpunten cross-reference — PC4s flagged by ≥N carriers in this gemeente */}
      {painpoints && block && (
        <section className="mt-8 bg-white rounded-lg shadow-md p-6">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
            <div>
              <h3 className="text-lg font-semibold text-gray-900">
                Pijnpunten gemeld door vervoerders
              </h3>
              <p className="text-sm text-gray-600">
                PC4s in {block.gemeente} die door minimaal{' '}
                <strong>{painpointThreshold}</strong>{' '}
                {painpointThreshold === 1 ? 'vervoerder' : 'vervoerders'} als
                pijnpunt zijn aangedragen.
              </p>
            </div>
            <div className="flex items-center gap-2 text-xs">
              <label htmlFor="pp-threshold" className="text-gray-600">
                Drempel:
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
                Volledig overzicht →
              </Link>
            </div>
          </div>

          {muniPainpoints.length === 0 ? (
            <p className="text-sm text-gray-500 italic">
              Geen PC4s gevonden met ≥ {painpointThreshold}{' '}
              vervoerder-meldingen in {block.gemeente}. Verlaag de drempel om
              meer te zien.
            </p>
          ) : (
            <div className="overflow-x-auto -mx-6 px-6">
              <table className="w-full text-sm">
                <thead className="border-b border-gray-200">
                  <tr className="text-left">
                    <th className="px-2 py-2 text-xs font-semibold text-gray-600">PC4</th>
                    <th className="px-2 py-2 text-xs font-semibold text-gray-600 text-right">
                      # vervoerders
                    </th>
                    <th className="px-2 py-2 text-xs font-semibold text-gray-600">Vervoerders</th>
                    <th className="px-2 py-2 text-xs font-semibold text-gray-600 text-right">
                      Bestaande PP
                    </th>
                    <th className="px-2 py-2 text-xs font-semibold text-gray-600">In top-5 advies?</th>
                    <th className="px-2 py-2 text-xs font-semibold text-gray-600">Detail</th>
                  </tr>
                </thead>
                <tbody>
                  {muniPainpoints.map(({ pc4, entry }) => {
                    const inTop5 = rankedPc4s.some((r) => r.pc4 === pc4);
                    const top5Rank = rankedPc4s.findIndex((r) => r.pc4 === pc4) + 1;
                    return (
                      <tr key={pc4} className="border-b border-gray-100 hover:bg-blue-50/40">
                        <td className="px-2 py-2 font-mono text-gray-900">{pc4}</td>
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
                            href={`/data-export/painpoints#${pc4}`}
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
            Bron: handmatig samengestelde lijst uit bilaterale gesprekken met
            vervoerders. PC4s die ook in de top-5 prioriteits-PC4s staan
            (kolom &quot;In top-5 advies?&quot;) zijn dubbel-bevestigde
            kandidaten — zowel data-gedreven als door carriers genoemd.
          </p>
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
