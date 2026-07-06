'use client';

import { useEffect, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import type { PainpointsPayload } from './PainpointsReport';

type GemeenteStatus = 'ontvangen' | 'openstaand';

const PainpointMiniMap = dynamic(() => import('./PainpointMiniMap'), {
  ssr: false,
  loading: () => (
    <div className="w-full h-full flex items-center justify-center text-sm text-gray-500">
      Kaart laden...
    </div>
  ),
});

type SortDir = 'asc' | 'desc';

function cmp(a: unknown, b: unknown): number {
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a ?? '').localeCompare(String(b ?? ''), 'nl');
}

const G4 = ['Amsterdam', 'Rotterdam', 'Den Haag', 'Utrecht'] as const;

export default function GemeentePainpointsReport({ payload }: { payload: PainpointsPayload }) {
  // Only PC4s with at least one gemeente flag.
  const entries = useMemo(
    () =>
      Object.entries(payload.painpoints)
        .filter(([, v]) => (v.gemeenten?.length ?? 0) > 0)
        .sort(([a], [b]) => a.localeCompare(b)),
    [payload]
  );

  const [selectedPc4, setSelectedPc4] = useState<string | null>(null);
  type Col =
    | 'pc4' | 'gemeente' | 'carriers' | 'total' | 'locker' | 'shop'
    | 'population' | 'area' | 'density' | 'predicted' | 'delta';
  const [sort, setSort] = useState<{ key: Col; dir: SortDir }>({ key: 'pc4', dir: 'asc' });
  const toggleSort = (k: Col) =>
    setSort((s) => (s.key === k ? { key: k, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key: k, dir: 'asc' }));

  // Welk regressie-model gebruiken we voor "Verwacht" en "Δ"?
  // - 'base' = α + β₁·population + β₂·area_km2 (R² ≈ 0.44, 100% PC4-dekking)
  // - 'k8'   = best-subset uit find_best_model.py (R² ≈ 0.54, 99.6% dekking;
  //           18 PC4s zonder avg_woz_value vallen automatisch terug op base)
  const [modelChoice, setModelChoice] = useState<'base' | 'k8'>(
    payload.model_k8 ? 'k8' : 'base'
  );
  const k8Available = !!payload.model_k8;
  type Stats = NonNullable<PainpointsPayload['painpoints'][string]['stats']>;
  const getPredicted = (s?: Stats | null): number | null => {
    if (!s) return null;
    if (modelChoice === 'k8') {
      return s.predicted_points_k8 ?? s.predicted_points ?? null;
    }
    return s.predicted_points ?? null;
  };
  const getDelta = (s?: Stats | null): number | null => {
    if (!s) return null;
    if (modelChoice === 'k8') {
      return s.delta_vs_predicted_k8 ?? s.delta_vs_predicted ?? null;
    }
    return s.delta_vs_predicted ?? null;
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSelectedPc4(null);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  // Group by gemeente: each gemeente lists the PC4s it flagged.
  const byGemeente = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const [pc4, v] of entries) {
      for (const g of v.gemeenten ?? []) {
        if (!m.has(g)) m.set(g, []);
        m.get(g)!.push(pc4);
      }
    }
    for (const codes of m.values()) codes.sort();
    return m;
  }, [entries]);

  const totalPC4 = entries.length;
  const totalFlags = entries.reduce((s, [, v]) => s + (v.gemeenten?.length ?? 0), 0);
  const totalPoints = entries.reduce((s, [, v]) => s + v.pakketpunten.total, 0);

  const selected = selectedPc4 ? payload.painpoints[selectedPc4] : null;
  const status = (payload.gemeente_status ?? {}) as Record<string, GemeenteStatus>;

  return (
    <>
      <div className="space-y-8">
        {/* Intro */}
        <section data-tour="intro">
          <h2 className="text-xl font-bold text-gray-900 mb-2">PC4-Pijnpunten — gemeld door G4-gemeenten</h2>
          <p className="text-sm text-gray-600">
            Knelpuntgebieden zoals aangeleverd door de <strong>G4-gemeenten</strong> zelf
            (via hun convenant-contactpersoon) — los van de carrier-pijnpunten. Bron:{' '}
            <code className="text-xs bg-gray-100 px-1 py-0.5 rounded">{payload.source}</code>, laatst
            bijgewerkt {new Date(payload.generated_at).toLocaleDateString('nl-NL')}.
          </p>
          <p className="text-sm text-gray-600 mt-2">
            Pijnpunten die door <strong>vervoerders</strong> zijn gemeld staan op:{' '}
            <a
              href="/data-export/painpoints"
              className="text-blue-700 hover:text-blue-900 underline underline-offset-2 font-medium"
            >
              Pijnpunten per carrier →
            </a>
          </p>
        </section>

        {/* Status per gemeente — also shows openstaande gemeenten */}
        <section data-tour="status-g4">
          <h3 className="text-lg font-semibold text-gray-900 mb-3">Status per G4-gemeente</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {G4.map((city) => {
              const codes = byGemeente.get(city) ?? [];
              const isOpen = (status[city] ?? (codes.length ? 'ontvangen' : 'openstaand')) === 'openstaand';
              return (
                <div
                  key={city}
                  className={`bg-white border rounded-lg p-4 ${
                    isOpen ? 'border-amber-200' : 'border-gray-200'
                  }`}
                >
                  <div className="flex items-baseline justify-between mb-2">
                    <h4 className="font-semibold text-gray-900">Gemeente {city}</h4>
                    {isOpen ? (
                      <span className="text-xs px-2 py-0.5 rounded bg-amber-100 text-amber-800 font-semibold uppercase tracking-wide">
                        Openstaand
                      </span>
                    ) : (
                      <span className="text-xs text-gray-500">
                        {codes.length} PC4-gebieden
                      </span>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {codes.map((pc4) => (
                      <button
                        key={pc4}
                        onClick={() => setSelectedPc4(pc4)}
                        className={`px-2 py-0.5 text-xs font-mono rounded transition ${
                          selectedPc4 === pc4
                            ? 'bg-blue-700 text-white'
                            : 'bg-blue-50 text-blue-800 hover:bg-blue-100'
                        }`}
                      >
                        {pc4}
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* Summary cards */}
        <section data-tour="samenvatting" className="grid grid-cols-2 md:grid-cols-3 gap-3">
          <div className="bg-white border border-gray-200 rounded-lg p-4">
            <div className="text-2xl font-bold text-gray-900">{totalPC4}</div>
            <div className="text-xs text-gray-500 mt-1">Unieke PC4-gebieden</div>
          </div>
          <div className="bg-white border border-gray-200 rounded-lg p-4">
            <div className="text-2xl font-bold text-gray-900">{totalFlags}</div>
            <div className="text-xs text-gray-500 mt-1">Gemeente-meldingen</div>
          </div>
          <div className="bg-white border border-gray-200 rounded-lg p-4">
            <div className="text-2xl font-bold text-gray-900">{totalPoints}</div>
            <div className="text-xs text-gray-500 mt-1">Pakketpunten in deze gebieden</div>
          </div>
        </section>

        {/* Per-PC4 table */}
        <section data-tour="pc4-tabel">
          <h3 className="text-lg font-semibold text-gray-900 mb-3">Per postcodegebied</h3>
          {k8Available && (
            <div className="mb-3 flex flex-wrap items-center gap-3 bg-blue-50 border border-blue-200 rounded-md px-3 py-2 text-sm">
              <span className="font-semibold text-gray-800">Verwacht-model:</span>
              <div className="inline-flex rounded border border-blue-300 overflow-hidden">
                {(['base', 'k8'] as const).map((k) => {
                  const active = modelChoice === k;
                  const r2 = k === 'k8' ? payload.model_k8?.r2 : payload.model?.r2;
                  return (
                    <button
                      key={k}
                      type="button"
                      onClick={() => setModelChoice(k)}
                      className={`px-3 py-1 text-xs font-medium transition ${
                        active
                          ? 'bg-blue-700 text-white'
                          : 'bg-white text-blue-800 hover:bg-blue-100'
                      }`}
                    >
                      {k === 'base' ? 'Basis (pop + opp)' : 'K=8 best-subset'}
                      {r2 != null && (
                        <span className="ml-1.5 opacity-80 tabular-nums">
                          R²={r2.toFixed(2)}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
              <a
                href="/data-export/schatting"
                className="text-blue-700 hover:text-blue-900 underline underline-offset-2"
              >
                uitleg over de modellen →
              </a>
              {modelChoice === 'k8' && (
                <span className="text-xs text-gray-600">
                  18 PC4&apos;s zonder WOZ-waarde vallen terug op het basismodel.
                </span>
              )}
            </div>
          )}
          <div className="overflow-x-auto bg-white border border-gray-200 rounded-lg">
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  {([
                    ['pc4', 'PC4', 'left'],
                    ['gemeente', 'Gemeente', 'left'],
                    ['carriers', 'Ook gemeld door carriers', 'left'],
                    ['total', 'Pakketpunten', 'right'],
                    ['locker', 'Automaten', 'right'],
                    ['shop', 'Shops', 'right'],
                    ['population', 'Inwoners', 'right'],
                    ['area', 'km²', 'right'],
                    ['density', 'PP/km²', 'right'],
                    ['predicted', 'Verwacht', 'right'],
                    ['delta', 'Δ', 'right'],
                  ] as Array<[Col, string, 'left' | 'right']>).map(([key, label, align]) => (
                    <th key={key} className={`px-3 py-2 ${align === 'right' ? 'text-right' : 'text-left'}`}>
                      <button
                        type="button"
                        onClick={() => toggleSort(key)}
                        className={`inline-flex items-center gap-1 font-semibold uppercase text-xs tracking-wide transition ${
                          sort.key === key ? 'text-gray-900' : 'text-gray-600 hover:text-gray-900'
                        }`}
                      >
                        <span>{label}</span>
                        <span className={`text-[10px] leading-none ${sort.key === key ? 'opacity-100' : 'opacity-30'}`}>
                          {sort.key === key ? (sort.dir === 'asc' ? '▲' : '▼') : '▲'}
                        </span>
                      </button>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {entries
                  .slice()
                  .sort(([aPc4, av], [bPc4, bv]) => {
                    const get = (pc4: string, v: typeof av, k: Col) => {
                      const s = v.stats;
                      switch (k) {
                        case 'pc4': return pc4;
                        case 'gemeente': return (v.gemeenten ?? []).join(',');
                        case 'carriers': return v.carriers.join(',');
                        case 'total': return v.pakketpunten.total;
                        case 'locker': return v.pakketpunten.locker;
                        case 'shop': return v.pakketpunten.shop;
                        case 'population': return s?.population ?? null;
                        case 'area': return s?.area_km2 ?? null;
                        case 'density': return s?.points_per_km2 ?? null;
                        case 'predicted': return getPredicted(s) ?? null;
                        case 'delta': return getDelta(s) ?? null;
                      }
                    };
                    const a = get(aPc4, av, sort.key);
                    const b = get(bPc4, bv, sort.key);
                    // Ontbrekende waarden altijd onderaan, ongeacht sorteerrichting.
                    if (a == null || b == null) {
                      if (a == null && b == null) return 0;
                      return a == null ? 1 : -1;
                    }
                    const d = cmp(a, b);
                    return sort.dir === 'asc' ? d : -d;
                  })
                  .map(([pc4, v]) => (
                    <tr
                      key={pc4}
                      onClick={() => setSelectedPc4(pc4)}
                      className={`cursor-pointer transition-colors ${
                        selectedPc4 === pc4 ? 'bg-blue-50' : 'hover:bg-gray-50'
                      }`}
                    >
                      <td className="px-3 py-2 font-mono font-semibold text-gray-900">{pc4}</td>
                      <td className="px-3 py-2">
                        <div className="flex flex-wrap gap-1">
                          {(v.gemeenten ?? []).map((g) => (
                            <span
                              key={g}
                              className="inline-block px-2 py-0.5 text-xs font-semibold bg-blue-100 text-blue-800 rounded"
                            >
                              {g}
                            </span>
                          ))}
                        </div>
                      </td>
                      <td className="px-3 py-2">
                        {v.carriers.length === 0 ? (
                          <span className="text-xs text-gray-400 italic">— alleen gemeente —</span>
                        ) : (
                          <div className="flex flex-wrap gap-1">
                            {v.carriers.map((c) => (
                              <span
                                key={c}
                                className="inline-block px-2 py-0.5 text-xs font-semibold bg-blue-100 text-blue-800 rounded"
                              >
                                {c}
                              </span>
                            ))}
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums font-semibold text-gray-900">{v.pakketpunten.total}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-gray-700">{v.pakketpunten.locker}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-gray-700">{v.pakketpunten.shop}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-gray-700">{v.stats?.population != null ? v.stats.population.toLocaleString('nl-NL') : '—'}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-gray-700">{v.stats?.area_km2 != null ? v.stats.area_km2.toFixed(2) : '—'}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-gray-700">{v.stats?.points_per_km2 != null ? v.stats.points_per_km2.toFixed(1) : '—'}</td>
                      {(() => {
                        const pred = getPredicted(v.stats);
                        const delta = getDelta(v.stats);
                        return (
                          <>
                            <td className="px-3 py-2 text-right tabular-nums text-gray-700">{pred != null ? pred.toFixed(1) : '—'}</td>
                            <td className={`px-3 py-2 text-right tabular-nums font-semibold ${delta != null ? (delta >= 0 ? 'text-emerald-700' : 'text-red-700') : 'text-gray-500'}`}>
                              {delta != null ? (delta >= 0 ? '+' : '') + delta.toFixed(1) : '—'}
                            </td>
                          </>
                        );
                      })()}
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      {/* Slide-in panel */}
      {selectedPc4 && selected && (
        <>
          <div
            className="fixed inset-0 bg-black/30 z-40"
            onClick={() => setSelectedPc4(null)}
          />
          <aside className="fixed top-0 right-0 bottom-0 w-full md:w-[520px] z-50 bg-white shadow-2xl flex flex-col">
            <div className="flex items-start justify-between p-4 border-b border-gray-200">
              <div>
                <div className="text-xs uppercase tracking-wide text-gray-500">Postcodegebied</div>
                <div className="text-2xl font-bold text-gray-900 font-mono">{selectedPc4}</div>
                <div className="text-sm text-gray-600">
                  G4: {selected.g4_city ?? selected.city}
                </div>
                {selected.municipality &&
                  selected.municipality !== (selected.g4_city ?? selected.city) && (
                    <div className="text-sm text-gray-900 font-medium">{selected.municipality}</div>
                  )}
              </div>
              <button
                onClick={() => setSelectedPc4(null)}
                className="p-2 text-gray-500 hover:text-gray-900 hover:bg-gray-100 rounded"
                aria-label="Sluiten"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="px-4 py-3 border-b border-gray-200 bg-gray-50">
              {selected.gemeenten && selected.gemeenten.length > 0 && (
                <>
                  <div className="text-xs uppercase tracking-wide text-gray-500 mb-1">
                    Gemeld door G4-gemeente
                  </div>
                  <div className="flex flex-wrap gap-1 mb-3">
                    {selected.gemeenten.map((g) => (
                      <span
                        key={g}
                        className="px-2 py-0.5 text-xs font-semibold bg-blue-100 text-blue-800 rounded"
                      >
                        Gemeente {g}
                      </span>
                    ))}
                  </div>
                </>
              )}
              {selected.carriers.length > 0 && (
                <>
                  <div className="text-xs uppercase tracking-wide text-gray-500 mb-1">
                    Ook gemeld door carriers
                  </div>
                  <div className="flex flex-wrap gap-1 mb-3">
                    {selected.carriers.map((c) => (
                      <span
                        key={c}
                        className="px-2 py-0.5 text-xs font-semibold bg-blue-100 text-blue-800 rounded"
                      >
                        {c}
                      </span>
                    ))}
                  </div>
                </>
              )}
              {selected.notes && selected.notes.length > 0 && (
                <div className="mb-3 space-y-1">
                  {selected.notes.map((n, i) => (
                    <div
                      key={i}
                      className="text-xs text-amber-900 bg-amber-50 border border-amber-200 rounded px-2 py-1"
                    >
                      {n}
                    </div>
                  ))}
                </div>
              )}
              {selected.stats && (
                <div className="mb-3 grid grid-cols-2 gap-2 text-xs">
                  <div className="bg-white rounded border border-gray-200 px-2 py-1">
                    <div className="text-gray-500">Inwoners</div>
                    <div className="font-semibold text-gray-900">
                      {selected.stats.population?.toLocaleString('nl-NL') ?? '—'}
                    </div>
                  </div>
                  <div className="bg-white rounded border border-gray-200 px-2 py-1">
                    <div className="text-gray-500">Oppervlakte</div>
                    <div className="font-semibold text-gray-900">
                      {selected.stats.area_km2?.toFixed(2) ?? '—'} km²
                    </div>
                  </div>
                  <div className="bg-white rounded border border-gray-200 px-2 py-1">
                    <div className="text-gray-500">PP per 1000 inw.</div>
                    <div className="font-semibold text-gray-900">
                      {selected.stats.points_per_1000_inw?.toFixed(2) ?? '—'}
                    </div>
                  </div>
                  <div className="bg-white rounded border border-gray-200 px-2 py-1">
                    <div className="text-gray-500">PP per km²</div>
                    <div className="font-semibold text-gray-900">
                      {selected.stats.points_per_km2?.toFixed(1) ?? '—'}
                    </div>
                  </div>
                  <div className="bg-white rounded border border-gray-200 px-2 py-1 col-span-2">
                    <div className="text-gray-500">
                      Verwacht ({modelChoice === 'k8' ? 'k=8' : 'basis'}) · Δ
                    </div>
                    <div className="font-semibold text-gray-900">
                      {(() => {
                        const pred = getPredicted(selected.stats);
                        const delta = getDelta(selected.stats);
                        return (
                          <>
                            {pred != null ? pred.toFixed(1) : '—'}
                            {delta != null && (
                              <span className={`ml-2 ${delta >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>
                                {delta >= 0 ? '+' : ''}{delta.toFixed(1)}
                              </span>
                            )}
                          </>
                        );
                      })()}
                    </div>
                  </div>
                </div>
              )}
              <div className="grid grid-cols-3 gap-2 text-center">
                <div>
                  <div className="text-lg font-bold text-gray-900">{selected.pakketpunten.total}</div>
                  <div className="text-xs text-gray-500">Totaal</div>
                </div>
                <div>
                  <div className="text-lg font-bold text-gray-900">{selected.pakketpunten.locker}</div>
                  <div className="text-xs text-gray-500">Automaten</div>
                </div>
                <div>
                  <div className="text-lg font-bold text-gray-900">{selected.pakketpunten.shop}</div>
                  <div className="text-xs text-gray-500">Shops</div>
                </div>
              </div>
            </div>

            <div className="flex-1 min-h-[300px]">
              <PainpointMiniMap pc4={selectedPc4} points={selected.points} />
            </div>
          </aside>
        </>
      )}
    </>
  );
}
