'use client';

import { useEffect, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import {
  ScatterChart, Scatter, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ZAxis, Legend,
} from 'recharts';

type ByCarrier = Record<string, { locker: number; shop: number }>;

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

interface PainpointStats {
  area_km2: number | null;
  population: number | null;
  points_per_km2: number | null;
  points_per_1000_inw: number | null;
  predicted_points: number | null;
  delta_vs_predicted: number | null;
  expected_simple_rate: number | null;
}

interface Painpoint {
  city: string;
  g4_city?: string;
  municipality?: string | null;
  carriers: string[];
  notes?: string[];
  stats?: PainpointStats;
  pakketpunten: {
    total: number;
    locker: number;
    shop: number;
    by_carrier: ByCarrier;
  };
  points: PainpointPoint[];
}

export interface ModelMeta {
  r2: number;
  intercept: number;
  coefficients: { population: number; area_km2: number };
  training_size: number;
  nationwide_rates: { points_per_inhabitant: number; points_per_km2: number };
}

export interface ScatterPoint {
  pc4: string;
  pop: number;
  area: number;
  actual: number;
  predicted: number;
}

export interface PainpointsPayload {
  generated_at: string;
  source: string;
  painpoints: Record<string, Painpoint>;
  model?: ModelMeta;
  scatter?: ScatterPoint[];
  mean_area_km2?: number;
}

const PainpointMiniMap = dynamic(() => import('./PainpointMiniMap'), {
  ssr: false,
  loading: () => (
    <div className="w-full h-full flex items-center justify-center text-sm text-gray-500">
      Kaart laden...
    </div>
  ),
});

function pluralize(n: number, singular: string, plural: string) {
  return n === 1 ? singular : plural;
}

type SortDir = 'asc' | 'desc';

function cmp(a: any, b: any): number {
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a ?? '').localeCompare(String(b ?? ''), 'nl');
}

function SortHeader<K extends string>({
  label,
  sortKey,
  activeKey,
  dir,
  onToggle,
  align = 'left',
}: {
  label: string;
  sortKey: K;
  activeKey: K;
  dir: SortDir;
  onToggle: (k: K) => void;
  align?: 'left' | 'right';
}) {
  const isActive = activeKey === sortKey;
  return (
    <th className={`px-3 py-2 ${align === 'right' ? 'text-right' : 'text-left'}`}>
      <button
        type="button"
        onClick={() => onToggle(sortKey)}
        className={`inline-flex items-center gap-1 font-semibold uppercase text-xs tracking-wide transition ${
          isActive ? 'text-gray-900' : 'text-gray-600 hover:text-gray-900'
        }`}
      >
        <span>{label}</span>
        <span className={`text-[10px] leading-none ${isActive ? 'opacity-100' : 'opacity-30'}`}>
          {isActive ? (dir === 'asc' ? '▲' : '▼') : '▲'}
        </span>
      </button>
    </th>
  );
}

export default function PainpointsReport({ payload }: { payload: PainpointsPayload }) {
  const entries = useMemo(
    () => Object.entries(payload.painpoints).sort(([a], [b]) => a.localeCompare(b)),
    [payload]
  );

  const [selectedPc4, setSelectedPc4] = useState<string | null>(null);

  // Sort state for the main "per PC4" table
  type PC4Col = 'pc4' | 'city' | 'carriers' | 'count' | 'total' | 'locker' | 'shop'
    | 'population' | 'area' | 'density' | 'per_capita' | 'predicted' | 'delta';
  const [pc4Sort, setPc4Sort] = useState<{ key: PC4Col; dir: SortDir }>({ key: 'pc4', dir: 'asc' });
  const togglePc4Sort = (k: PC4Col) =>
    setPc4Sort((s) => (s.key === k ? { key: k, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key: k, dir: 'asc' }));

  // Sort state for the per-carrier tables (shared across all carriers)
  type CarCol = 'pc4' | 'city' | 'total' | 'locker' | 'shop';
  const [carrierSort, setCarrierSort] = useState<{ key: CarCol; dir: SortDir }>({ key: 'pc4', dir: 'asc' });
  const toggleCarrierSort = (k: CarCol) =>
    setCarrierSort((s) => (s.key === k ? { key: k, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key: k, dir: 'asc' }));

  // Sort state for the side-panel per-carrier breakdown
  type PanelCol = 'carrier' | 'locker' | 'shop' | 'total';
  const [panelSort, setPanelSort] = useState<{ key: PanelCol; dir: SortDir }>({ key: 'carrier', dir: 'asc' });
  const togglePanelSort = (k: PanelCol) =>
    setPanelSort((s) => (s.key === k ? { key: k, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key: k, dir: 'asc' }));

  // Pre-compute scatter data and trendline. Highlight pain-point PC4s.
  const scatterData = useMemo(() => {
    const scatter = payload.scatter ?? [];
    const painSet = new Set(Object.keys(payload.painpoints));
    const other = scatter.filter((p) => !painSet.has(p.pc4));
    const pain = scatter.filter((p) => painSet.has(p.pc4));
    return { other, pain };
  }, [payload.scatter, payload.painpoints]);

  const trendLine = useMemo(() => {
    const m = payload.model;
    if (!m || !payload.scatter || payload.scatter.length === 0) return [];
    const meanArea = payload.mean_area_km2 ?? 1;
    const maxPop = Math.max(...payload.scatter.map((p) => p.pop));
    // 20 evenly-spaced points from 0 to maxPop
    const N = 20;
    const { intercept, coefficients } = m;
    return Array.from({ length: N }, (_, i) => {
      const pop = (maxPop * i) / (N - 1);
      const y = intercept + coefficients.population * pop + coefficients.area_km2 * meanArea;
      return { pop, actual: Math.max(0, y) };
    });
  }, [payload.model, payload.scatter, payload.mean_area_km2]);

  // Close panel with Escape
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSelectedPc4(null);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  // Totals
  const totalPC4 = entries.length;
  const totalFlags = entries.reduce((sum, [, v]) => sum + v.carriers.length, 0);
  const totalPoints = entries.reduce((sum, [, v]) => sum + v.pakketpunten.total, 0);
  const totalLockers = entries.reduce((sum, [, v]) => sum + v.pakketpunten.locker, 0);
  const totalShops = entries.reduce((sum, [, v]) => sum + v.pakketpunten.shop, 0);

  const byCity = new Map<string, string[]>();
  for (const [pc4, v] of entries) {
    if (!byCity.has(v.city)) byCity.set(v.city, []);
    byCity.get(v.city)!.push(pc4);
  }

  const byCarrier = new Map<string, { pc4: string; city: string; total: number; locker: number; shop: number }[]>();
  for (const [pc4, v] of entries) {
    for (const carrier of v.carriers) {
      if (!byCarrier.has(carrier)) byCarrier.set(carrier, []);
      byCarrier.get(carrier)!.push({
        pc4,
        city: v.city,
        total: v.pakketpunten.total,
        locker: v.pakketpunten.locker,
        shop: v.pakketpunten.shop,
      });
    }
  }
  const carrierList = [...byCarrier.entries()].sort(([a], [b]) => a.localeCompare(b));

  const selected = selectedPc4 ? payload.painpoints[selectedPc4] : null;

  return (
    <>
      <div className="space-y-8">
        {/* Intro */}
        <section>
          <h2 className="text-xl font-bold text-gray-900 mb-2">PC4-Pijnpunten per Carrier</h2>
          <p className="text-sm text-gray-600">
            Probleemgebieden zoals aangeleverd door vervoerders in het kader van het
            Convenant Duurzame Pakketlogistiek (G4). Bron:{' '}
            <code className="text-xs bg-gray-100 px-1 py-0.5 rounded">{payload.source}</code>, laatst
            bijgewerkt {new Date(payload.generated_at).toLocaleDateString('nl-NL')}.
            Klik op een rij om de kaart met de PC4-zone en pakketpunten te openen.
          </p>
        </section>

        {/* Netherlands-wide regression model + scatterplot */}
        {payload.model && (
          <section className="bg-white border border-gray-200 rounded-lg p-4 md:p-5 space-y-3">
            <div>
              <div className="text-xs uppercase tracking-wide text-gray-500 mb-1">Nederland-breed</div>
              <h3 className="text-lg font-semibold text-gray-900">Regressiemodel voor verwachte pakketpunten per PC4</h3>
              <p className="text-sm text-gray-700 leading-relaxed mt-1">
                OLS-regressie op alle {payload.model.training_size.toLocaleString('nl-NL')} Nederlandse PC4-gebieden
                (inwoners ≥ 10, oppervlakte ≥ 0,05 km²).
              </p>
              <div className="mt-2 inline-block font-mono text-sm bg-indigo-50 border border-indigo-200 text-indigo-900 rounded px-2 py-1">
                pakketpunten = {payload.model.intercept.toFixed(3)}
                {' + '}
                {payload.model.coefficients.population.toFixed(6)} × inwoners
                {' + '}
                {payload.model.coefficients.area_km2.toFixed(3)} × km²
              </div>
              <div className="mt-1 text-sm text-gray-700">
                R² = <span className="font-semibold">{payload.model.r2.toFixed(3)}</span>
                {' · '}
                ≈ +{(payload.model.coefficients.population * 1000).toFixed(2)} pakketpunten per 1 000 inwoners
                {' · '}
                +{payload.model.coefficients.area_km2.toFixed(2)} per extra km²
              </div>
              <p className="text-xs text-gray-500 mt-2 leading-relaxed">
                PC4-niveau R² is lager dan het gemeentelijke model (~0.87) — kleinere, ruisiger geografieën — maar
                geeft bruikbare verwachtingswaarden per postcode. Δ = werkelijk − voorspeld; negatieve Δ betekent
                minder pakketpunten dan op basis van inwoners en oppervlakte verwacht. Pijnpunt-PC4s zijn rood gemarkeerd.
              </p>
            </div>

            {scatterData.other.length > 0 && (
              <div className="h-80 md:h-96 -ml-2">
                <ResponsiveContainer width="100%" height="100%">
                  <ScatterChart margin={{ top: 10, right: 20, bottom: 30, left: 10 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                    <XAxis
                      type="number"
                      dataKey="pop"
                      name="Inwoners"
                      tickFormatter={(n) => (n >= 1000 ? `${(n / 1000).toFixed(0)}k` : String(n))}
                      label={{ value: 'Inwoners per PC4', position: 'insideBottom', offset: -10, fill: '#6b7280', fontSize: 12 }}
                      tick={{ fill: '#6b7280', fontSize: 11 }}
                    />
                    <YAxis
                      type="number"
                      dataKey="actual"
                      name="Pakketpunten"
                      label={{ value: 'Pakketpunten', angle: -90, position: 'insideLeft', fill: '#6b7280', fontSize: 12 }}
                      tick={{ fill: '#6b7280', fontSize: 11 }}
                    />
                    <ZAxis range={[20, 20]} />
                    <Tooltip
                      cursor={{ strokeDasharray: '3 3' }}
                      content={({ active, payload: tp }) => {
                        if (!active || !tp || !tp.length) return null;
                        const d = tp[0].payload as ScatterPoint;
                        if (!d.pc4) {
                          return (
                            <div className="bg-white border border-gray-200 rounded shadow px-2 py-1 text-xs">
                              <div className="font-semibold text-amber-700">Trendlijn</div>
                              <div>{Math.round(d.pop).toLocaleString('nl-NL')} inw. → {d.actual.toFixed(1)} PP</div>
                            </div>
                          );
                        }
                        return (
                          <div className="bg-white border border-gray-200 rounded shadow px-2 py-1 text-xs">
                            <div className="font-semibold font-mono">PC4 {d.pc4}</div>
                            <div>{d.pop.toLocaleString('nl-NL')} inw. · {d.area.toFixed(2)} km²</div>
                            <div>Werkelijk: <span className="font-semibold">{d.actual}</span></div>
                            <div>Verwacht: {d.predicted.toFixed(1)}</div>
                          </div>
                        );
                      }}
                    />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Scatter
                      name={`PC4-gebieden (${scatterData.other.length})`}
                      data={scatterData.other}
                      fill="#6366f1"
                      fillOpacity={0.35}
                    />
                    <Scatter
                      name={`Pijnpunten (${scatterData.pain.length})`}
                      data={scatterData.pain}
                      fill="#dc2626"
                      fillOpacity={0.9}
                      shape="circle"
                    />
                    {trendLine.length > 0 && (
                      <Scatter
                        name={`Trendlijn @ ø ${payload.mean_area_km2?.toFixed(2)} km²`}
                        data={trendLine}
                        fill="#f59e0b"
                        line={{ stroke: '#f59e0b', strokeWidth: 2 }}
                        shape={() => <></>}
                        legendType="line"
                      />
                    )}
                  </ScatterChart>
                </ResponsiveContainer>
              </div>
            )}
          </section>
        )}

        {/* Summary cards */}
        <section className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <div className="bg-white border border-gray-200 rounded-lg p-4">
            <div className="text-2xl font-bold text-gray-900">{totalPC4}</div>
            <div className="text-xs text-gray-500 mt-1">Unieke PC4-gebieden</div>
          </div>
          <div className="bg-white border border-gray-200 rounded-lg p-4">
            <div className="text-2xl font-bold text-gray-900">{totalFlags}</div>
            <div className="text-xs text-gray-500 mt-1">Carrier-meldingen</div>
          </div>
          <div className="bg-white border border-gray-200 rounded-lg p-4">
            <div className="text-2xl font-bold text-gray-900">{totalPoints}</div>
            <div className="text-xs text-gray-500 mt-1">Pakketpunten totaal</div>
          </div>
          <div className="bg-white border border-gray-200 rounded-lg p-4">
            <div className="text-2xl font-bold text-gray-900">{totalLockers}</div>
            <div className="text-xs text-gray-500 mt-1">Pakketautomaten</div>
          </div>
          <div className="bg-white border border-gray-200 rounded-lg p-4">
            <div className="text-2xl font-bold text-gray-900">{totalShops}</div>
            <div className="text-xs text-gray-500 mt-1">Pakketshops</div>
          </div>
        </section>

        {/* Table 1: PC4 → carriers + parcel point counts (clickable rows) */}
        <section>
          <h3 className="text-lg font-semibold text-gray-900 mb-3">Per postcodegebied</h3>
          <div className="overflow-x-auto bg-white border border-gray-200 rounded-lg">
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <SortHeader label="PC4" sortKey="pc4" activeKey={pc4Sort.key} dir={pc4Sort.dir} onToggle={togglePc4Sort} />
                  <SortHeader label="Stad" sortKey="city" activeKey={pc4Sort.key} dir={pc4Sort.dir} onToggle={togglePc4Sort} />
                  <SortHeader label="Gemeld door" sortKey="carriers" activeKey={pc4Sort.key} dir={pc4Sort.dir} onToggle={togglePc4Sort} />
                  <SortHeader label="#" sortKey="count" activeKey={pc4Sort.key} dir={pc4Sort.dir} onToggle={togglePc4Sort} align="right" />
                  <SortHeader label="Pakketpunten" sortKey="total" activeKey={pc4Sort.key} dir={pc4Sort.dir} onToggle={togglePc4Sort} align="right" />
                  <SortHeader label="Automaten" sortKey="locker" activeKey={pc4Sort.key} dir={pc4Sort.dir} onToggle={togglePc4Sort} align="right" />
                  <SortHeader label="Shops" sortKey="shop" activeKey={pc4Sort.key} dir={pc4Sort.dir} onToggle={togglePc4Sort} align="right" />
                  <SortHeader label="Inwoners" sortKey="population" activeKey={pc4Sort.key} dir={pc4Sort.dir} onToggle={togglePc4Sort} align="right" />
                  <SortHeader label="km²" sortKey="area" activeKey={pc4Sort.key} dir={pc4Sort.dir} onToggle={togglePc4Sort} align="right" />
                  <SortHeader label="PP/km²" sortKey="density" activeKey={pc4Sort.key} dir={pc4Sort.dir} onToggle={togglePc4Sort} align="right" />
                  <SortHeader label="PP/1000 inw." sortKey="per_capita" activeKey={pc4Sort.key} dir={pc4Sort.dir} onToggle={togglePc4Sort} align="right" />
                  <SortHeader label="Verwacht" sortKey="predicted" activeKey={pc4Sort.key} dir={pc4Sort.dir} onToggle={togglePc4Sort} align="right" />
                  <SortHeader label="Δ" sortKey="delta" activeKey={pc4Sort.key} dir={pc4Sort.dir} onToggle={togglePc4Sort} align="right" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {entries
                  .slice()
                  .sort(([aPc4, av], [bPc4, bv]) => {
                    const getVal = (pc4: string, v: Painpoint) => {
                      const s = v.stats;
                      switch (pc4Sort.key) {
                        case 'pc4': return pc4;
                        case 'city': return v.city;
                        case 'carriers': return v.carriers.join(',');
                        case 'count': return v.carriers.length;
                        case 'total': return v.pakketpunten.total;
                        case 'locker': return v.pakketpunten.locker;
                        case 'shop': return v.pakketpunten.shop;
                        case 'population': return s?.population ?? -1;
                        case 'area': return s?.area_km2 ?? -1;
                        case 'density': return s?.points_per_km2 ?? -1;
                        case 'per_capita': return s?.points_per_1000_inw ?? -1;
                        case 'predicted': return s?.predicted_points ?? -1;
                        case 'delta': return s?.delta_vs_predicted ?? 0;
                      }
                    };
                    const d = cmp(getVal(aPc4, av), getVal(bPc4, bv));
                    return pc4Sort.dir === 'asc' ? d : -d;
                  })
                  .map(([pc4, v]) => (
                  <tr
                    key={pc4}
                    onClick={() => setSelectedPc4(pc4)}
                    className={`cursor-pointer transition-colors ${
                      selectedPc4 === pc4 ? 'bg-red-50' : 'hover:bg-gray-50'
                    }`}
                  >
                    <td className="px-3 py-2 font-mono font-semibold text-gray-900">{pc4}</td>
                    <td className="px-3 py-2 text-gray-700">{v.city}</td>
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap gap-1">
                        {v.carriers.map((c) => (
                          <span
                            key={c}
                            className="inline-block px-2 py-0.5 text-xs font-semibold bg-red-100 text-red-800 rounded"
                          >
                            {c}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-gray-700">{v.carriers.length}</td>
                    <td className="px-3 py-2 text-right tabular-nums font-semibold text-gray-900">{v.pakketpunten.total}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-gray-700">{v.pakketpunten.locker}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-gray-700">{v.pakketpunten.shop}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-gray-700">{v.stats?.population != null ? v.stats.population.toLocaleString('nl-NL') : '—'}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-gray-700">{v.stats?.area_km2 != null ? v.stats.area_km2.toFixed(2) : '—'}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-gray-700">{v.stats?.points_per_km2 != null ? v.stats.points_per_km2.toFixed(1) : '—'}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-gray-700">{v.stats?.points_per_1000_inw != null ? v.stats.points_per_1000_inw.toFixed(2) : '—'}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-gray-700">{v.stats?.predicted_points != null ? v.stats.predicted_points.toFixed(1) : '—'}</td>
                    <td className={`px-3 py-2 text-right tabular-nums font-semibold ${v.stats?.delta_vs_predicted != null ? (v.stats.delta_vs_predicted >= 0 ? 'text-emerald-700' : 'text-red-700') : 'text-gray-500'}`}>{v.stats?.delta_vs_predicted != null ? (v.stats.delta_vs_predicted >= 0 ? '+' : '') + v.stats.delta_vs_predicted.toFixed(1) : '—'}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="bg-gray-50 font-semibold">
                <tr>
                  <td className="px-3 py-2" colSpan={3}>Totaal</td>
                  <td className="px-3 py-2 text-right tabular-nums">{totalFlags}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{totalPoints}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{totalLockers}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{totalShops}</td>
                  <td className="px-3 py-2" colSpan={6}></td>
                </tr>
              </tfoot>
            </table>
          </div>
        </section>

        {/* Table 2: carrier → PC4 painpoints (clickable rows) */}
        <section>
          <h3 className="text-lg font-semibold text-gray-900 mb-3">Per vervoerder</h3>
          <div className="space-y-4">
            {carrierList.map(([carrier, rows]) => {
              const sumTotal = rows.reduce((s, r) => s + r.total, 0);
              const sumLocker = rows.reduce((s, r) => s + r.locker, 0);
              const sumShop = rows.reduce((s, r) => s + r.shop, 0);
              return (
                <div key={carrier} className="bg-white border border-gray-200 rounded-lg overflow-hidden">
                  <div className="flex items-baseline justify-between px-4 py-3 bg-gray-50 border-b border-gray-200">
                    <h4 className="text-base font-semibold text-gray-900">{carrier}</h4>
                    <div className="text-xs text-gray-600">
                      {rows.length} {pluralize(rows.length, 'PC4-gebied', 'PC4-gebieden')} · {sumTotal}{' '}
                      {pluralize(sumTotal, 'pakketpunt', 'pakketpunten')} ({sumLocker} automaten, {sumShop} shops)
                    </div>
                  </div>
                  <table className="w-full text-sm">
                    <thead className="bg-white">
                      <tr>
                        <SortHeader label="PC4" sortKey="pc4" activeKey={carrierSort.key} dir={carrierSort.dir} onToggle={toggleCarrierSort} />
                        <SortHeader label="Stad" sortKey="city" activeKey={carrierSort.key} dir={carrierSort.dir} onToggle={toggleCarrierSort} />
                        <SortHeader label="Pakketpunten" sortKey="total" activeKey={carrierSort.key} dir={carrierSort.dir} onToggle={toggleCarrierSort} align="right" />
                        <SortHeader label="Automaten" sortKey="locker" activeKey={carrierSort.key} dir={carrierSort.dir} onToggle={toggleCarrierSort} align="right" />
                        <SortHeader label="Shops" sortKey="shop" activeKey={carrierSort.key} dir={carrierSort.dir} onToggle={toggleCarrierSort} align="right" />
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {rows
                        .slice()
                        .sort((a, b) => {
                          const av = a[carrierSort.key];
                          const bv = b[carrierSort.key];
                          const d = cmp(av, bv);
                          return carrierSort.dir === 'asc' ? d : -d;
                        })
                        .map((r) => (
                          <tr
                            key={r.pc4}
                            onClick={() => setSelectedPc4(r.pc4)}
                            className={`cursor-pointer transition-colors ${
                              selectedPc4 === r.pc4 ? 'bg-red-50' : 'hover:bg-gray-50'
                            }`}
                          >
                            <td className="px-3 py-2 font-mono font-semibold text-gray-900">{r.pc4}</td>
                            <td className="px-3 py-2 text-gray-700">{r.city}</td>
                            <td className="px-3 py-2 text-right tabular-nums font-semibold text-gray-900">{r.total}</td>
                            <td className="px-3 py-2 text-right tabular-nums text-gray-700">{r.locker}</td>
                            <td className="px-3 py-2 text-right tabular-nums text-gray-700">{r.shop}</td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              );
            })}
          </div>
        </section>

        {/* Per-city breakdown — PC4 chips are clickable */}
        <section>
          <h3 className="text-lg font-semibold text-gray-900 mb-3">Per stad</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {[...byCity.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([city, codes]) => {
              const cityTotal = codes.reduce((s, pc4) => s + payload.painpoints[pc4].pakketpunten.total, 0);
              return (
                <div key={city} className="bg-white border border-gray-200 rounded-lg p-4">
                  <div className="flex items-baseline justify-between mb-2">
                    <h4 className="font-semibold text-gray-900">{city}</h4>
                    <span className="text-xs text-gray-500">
                      {codes.length} PC4 · {cityTotal} pakketpunten
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {codes.slice().sort().map((pc4) => (
                      <button
                        key={pc4}
                        onClick={() => setSelectedPc4(pc4)}
                        className={`px-2 py-0.5 text-xs font-mono rounded transition ${
                          selectedPc4 === pc4
                            ? 'bg-red-600 text-white'
                            : 'bg-gray-100 text-gray-700 hover:bg-red-100 hover:text-red-800'
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
      </div>

      {/* Slide-in panel on the right */}
      {selectedPc4 && selected && (
        <>
          <div
            className="fixed inset-0 bg-black/30 z-40"
            onClick={() => setSelectedPc4(null)}
          />
          <aside className="fixed top-0 right-0 bottom-0 w-full md:w-[520px] z-50 bg-white shadow-2xl flex flex-col">
            {/* Header */}
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

            {/* Stats */}
            <div className="px-4 py-3 border-b border-gray-200 bg-gray-50">
              <div className="text-xs uppercase tracking-wide text-gray-500 mb-1">Gemeld als pijnpunt door</div>
              <div className="flex flex-wrap gap-1 mb-3">
                {selected.carriers.map((c) => (
                  <span key={c} className="px-2 py-0.5 text-xs font-semibold bg-red-100 text-red-800 rounded">
                    {c}
                  </span>
                ))}
              </div>
              {selected.notes && selected.notes.length > 0 && (
                <div className="mb-3 space-y-1">
                  {selected.notes.map((n, i) => (
                    <div key={i} className="text-xs text-amber-900 bg-amber-50 border border-amber-200 rounded px-2 py-1">
                      {n}
                    </div>
                  ))}
                </div>
              )}
              {selected.stats && (
                <div className="mb-3 grid grid-cols-2 gap-2 text-xs">
                  <div className="bg-white rounded border border-gray-200 px-2 py-1">
                    <div className="text-gray-500">Inwoners</div>
                    <div className="font-semibold text-gray-900">{selected.stats.population?.toLocaleString('nl-NL') ?? '—'}</div>
                  </div>
                  <div className="bg-white rounded border border-gray-200 px-2 py-1">
                    <div className="text-gray-500">Oppervlakte</div>
                    <div className="font-semibold text-gray-900">{selected.stats.area_km2?.toFixed(2) ?? '—'} km²</div>
                  </div>
                  <div className="bg-white rounded border border-gray-200 px-2 py-1">
                    <div className="text-gray-500">PP per 1000 inw.</div>
                    <div className="font-semibold text-gray-900">{selected.stats.points_per_1000_inw?.toFixed(2) ?? '—'}</div>
                  </div>
                  <div className="bg-white rounded border border-gray-200 px-2 py-1">
                    <div className="text-gray-500">PP per km²</div>
                    <div className="font-semibold text-gray-900">{selected.stats.points_per_km2?.toFixed(1) ?? '—'}</div>
                  </div>
                  <div className="bg-white rounded border border-gray-200 px-2 py-1 col-span-2">
                    <div className="text-gray-500">Verwacht (regressie) · Δ</div>
                    <div className="font-semibold text-gray-900">
                      {selected.stats.predicted_points?.toFixed(1) ?? '—'}
                      {selected.stats.delta_vs_predicted != null && (
                        <span className={`ml-2 ${selected.stats.delta_vs_predicted >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>
                          {selected.stats.delta_vs_predicted >= 0 ? '+' : ''}{selected.stats.delta_vs_predicted.toFixed(1)}
                        </span>
                      )}
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

            {/* Map */}
            <div className="flex-1 min-h-[300px]">
              <PainpointMiniMap pc4={selectedPc4} points={selected.points} />
            </div>

            {/* Per-carrier breakdown */}
            <div className="px-4 py-3 border-t border-gray-200 max-h-[40%] overflow-y-auto">
              <div className="text-xs uppercase tracking-wide text-gray-500 mb-2">Pakketpunten per vervoerder</div>
              {Object.keys(selected.pakketpunten.by_carrier).length === 0 ? (
                <div className="text-sm text-gray-500">Geen pakketpunten in dit gebied.</div>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr>
                      <SortHeader label="Vervoerder" sortKey="carrier" activeKey={panelSort.key} dir={panelSort.dir} onToggle={togglePanelSort} />
                      <SortHeader label="Automaten" sortKey="locker" activeKey={panelSort.key} dir={panelSort.dir} onToggle={togglePanelSort} align="right" />
                      <SortHeader label="Shops" sortKey="shop" activeKey={panelSort.key} dir={panelSort.dir} onToggle={togglePanelSort} align="right" />
                      <SortHeader label="Totaal" sortKey="total" activeKey={panelSort.key} dir={panelSort.dir} onToggle={togglePanelSort} align="right" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {Object.entries(selected.pakketpunten.by_carrier)
                      .sort(([ac, av], [bc, bv]) => {
                        const getVal = (c: string, x: { locker: number; shop: number }): any => {
                          switch (panelSort.key) {
                            case 'carrier': return c;
                            case 'locker': return x.locker;
                            case 'shop': return x.shop;
                            case 'total': return x.locker + x.shop;
                          }
                        };
                        const d = cmp(getVal(ac, av), getVal(bc, bv));
                        return panelSort.dir === 'asc' ? d : -d;
                      })
                      .map(([carrier, counts]) => (
                        <tr key={carrier}>
                          <td className="py-1 text-gray-900 font-medium">{carrier}</td>
                          <td className="py-1 text-right tabular-nums text-gray-700">{counts.locker}</td>
                          <td className="py-1 text-right tabular-nums text-gray-700">{counts.shop}</td>
                          <td className="py-1 text-right tabular-nums font-semibold text-gray-900">{counts.locker + counts.shop}</td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              )}
            </div>
          </aside>
        </>
      )}
    </>
  );
}
