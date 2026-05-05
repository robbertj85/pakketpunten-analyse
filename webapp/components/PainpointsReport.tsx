'use client';

import { useEffect, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';

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
  predicted_points_k8?: number | null;
  delta_vs_predicted_k8?: number | null;
  expected_simple_rate: number | null;
}

interface Painpoint {
  city: string;
  g4_city?: string;
  municipality?: string | null;
  carriers: string[];
  gemeenten?: string[];
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

export interface ModelK8Meta {
  r2: number;
  features: string[];
  training_size: number;
  coverage_pct: number;
  delta_r2_vs_base?: number;
}

export interface ScatterPoint {
  pc4: string;
  pop: number;
  area: number;
  actual: number;
  predicted: number;
  // Optional CBS 2022 features (null when CBS suppressed the cell)
  avg_income?: number | null;
  pct_low_income?: number | null;
  pct_high_income?: number | null;
  avg_woz?: number | null;
  ses_total?: number | null;
  ses_welvaart?: number | null;
  ses_arbeid?: number | null;
  urbanity?: number | null;
  oad?: number | null;
  pct_age_25_45?: number | null;
  pct_single_hh?: number | null;
  pct_multi_family?: number | null;
  pct_owner_occupied?: number | null;
  horeca_1km?: number | null;
  supermarket_1km?: number | null;
  station_km?: number | null;
  highway_km?: number | null;
  loading_zones?: number | null;
  loading_zones_per_km2?: number | null;
  in_emission_zone?: number | null;
  ov_stops?: number | null;
  ov_stops_per_km2?: number | null;
  ov_train_stops?: number | null;
  // BRON 2022-2024 — 3-yr accident aggregates per PC4 (Rijkswaterstaat)
  crashes_total?: number | null;
  crashes_total_per_km2?: number | null;
  crashes_freight?: number | null;
  crashes_van?: number | null;
  crashes_freight_van_share?: number | null;
  crashes_freight_vs_vulnerable?: number | null;
  crashes_injury?: number | null;
  crashes_urban?: number | null;
  city?: string | null;
}

export interface PainpointsPayload {
  generated_at: string;
  source: string;
  painpoints: Record<string, Painpoint>;
  gemeente_status?: Record<string, 'ontvangen' | 'openstaand'>;
  model?: ModelMeta;
  model_k8?: ModelK8Meta | null;
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

function MultiSortHeader<K extends string>({
  label,
  sortKey,
  stack,
  onToggle,
  align = 'left',
}: {
  label: string;
  sortKey: K;
  stack: Array<{ key: K; dir: SortDir }>;
  onToggle: (k: K) => void;
  align?: 'left' | 'right';
}) {
  const idx = stack.findIndex((s) => s.key === sortKey);
  const isActive = idx >= 0;
  const dir = isActive ? stack[idx].dir : 'asc';
  const showPriority = isActive && stack.length > 1;
  return (
    <th className={`px-3 py-2 ${align === 'right' ? 'text-right' : 'text-left'}`}>
      <button
        type="button"
        onClick={() => onToggle(sortKey)}
        title="Klik om direct op deze kolom te sorteren. Gebruik de sort-rij hierboven voor meerdere niveaus."
        className={`inline-flex items-center gap-1 font-semibold uppercase text-xs tracking-wide transition ${
          isActive ? 'text-gray-900' : 'text-gray-600 hover:text-gray-900'
        }`}
      >
        <span>{label}</span>
        <span className={`text-[10px] leading-none ${isActive ? 'opacity-100' : 'opacity-30'}`}>
          {isActive ? (dir === 'asc' ? '▲' : '▼') : '▲'}
        </span>
        {showPriority && (
          <span className="text-[9px] leading-none bg-indigo-100 text-indigo-700 rounded px-1 py-0.5 font-bold tabular-nums">
            {idx + 1}
          </span>
        )}
      </button>
    </th>
  );
}

// Explicit multi-level sort builder — no hidden keyboard modifiers.
// Each level: column dropdown + direction toggle + remove button. "+ Extra
// sortering" appends a level. Identical in spirit to Excel's sort dialog.
function SortBuilder<K extends string>({
  stack,
  options,
  isNumeric,
  onChange,
}: {
  stack: Array<{ key: K; dir: SortDir }>;
  options: Array<{ value: K; label: string }>;
  isNumeric: (k: K) => boolean;
  onChange: (stack: Array<{ key: K; dir: SortDir }>) => void;
}) {
  const usedKeys = new Set(stack.map((s) => s.key));
  const firstUnused = options.find((o) => !usedKeys.has(o.value))?.value;
  const updateAt = (i: number, patch: Partial<{ key: K; dir: SortDir }>) => {
    const next = stack.slice();
    next[i] = { ...next[i], ...patch };
    onChange(next);
  };
  const removeAt = (i: number) => {
    const next = stack.slice();
    next.splice(i, 1);
    onChange(next.length ? next : [{ key: options[0].value, dir: 'asc' }]);
  };
  const addLevel = () => {
    if (!firstUnused) return;
    onChange([...stack, { key: firstUnused, dir: 'asc' }]);
  };
  return (
    <div className="bg-gray-50 border border-gray-200 rounded-md p-3 space-y-2">
      <div className="text-xs font-semibold text-gray-700 uppercase tracking-wide">Sorteren op</div>
      {stack.map((entry, i) => {
        const numeric = isNumeric(entry.key);
        const ascLabel = numeric ? 'laag → hoog' : 'A → Z';
        const descLabel = numeric ? 'hoog → laag' : 'Z → A';
        return (
          <div key={i} className="flex items-center gap-2 flex-wrap">
            <span className="text-xs text-gray-500 w-16 shrink-0">
              {i === 0 ? 'Primair' : i === 1 ? 'Dan op' : `Dan op (${i + 1})`}
            </span>
            <select
              value={entry.key}
              onChange={(e) => updateAt(i, { key: e.target.value as K })}
              className="text-sm border border-gray-300 rounded px-2 py-1 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              {options.map((o) => (
                <option
                  key={o.value}
                  value={o.value}
                  disabled={o.value !== entry.key && usedKeys.has(o.value)}
                >
                  {o.label}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => updateAt(i, { dir: entry.dir === 'asc' ? 'desc' : 'asc' })}
              className="text-sm border border-gray-300 bg-white rounded px-2 py-1 hover:bg-gray-100 transition tabular-nums"
            >
              {entry.dir === 'asc' ? `↑ ${ascLabel}` : `↓ ${descLabel}`}
            </button>
            {stack.length > 1 && (
              <button
                type="button"
                onClick={() => removeAt(i)}
                aria-label="Verwijder sorteer-niveau"
                className="text-gray-400 hover:text-blue-700 text-lg leading-none px-1"
              >
                ×
              </button>
            )}
          </div>
        );
      })}
      <div className="flex items-center gap-3 pt-1">
        <button
          type="button"
          onClick={addLevel}
          disabled={!firstUnused}
          className="text-xs font-medium text-indigo-700 hover:text-indigo-900 disabled:text-gray-400 disabled:cursor-not-allowed"
        >
          + Extra sortering toevoegen
        </button>
        {stack.length > 1 && (
          <button
            type="button"
            onClick={() => onChange([stack[0]])}
            className="text-xs text-gray-500 hover:text-gray-700 underline underline-offset-2"
          >
            Reset naar één niveau
          </button>
        )}
      </div>
    </div>
  );
}

export default function PainpointsReport({ payload }: { payload: PainpointsPayload }) {
  // This report covers ONLY PC4s flagged by carriers. PC4s that were only
  // reported by a G4-gemeente (and not by any carrier) live on the separate
  // /data-export/gemeente-painpoints page so the two source types stay
  // explicitly separated.
  const entries = useMemo(
    () =>
      Object.entries(payload.painpoints)
        .filter(([, v]) => (v.carriers?.length ?? 0) > 0)
        .sort(([a], [b]) => a.localeCompare(b)),
    [payload]
  );

  const [selectedPc4, setSelectedPc4] = useState<string | null>(null);

  // Welk regressie-model gebruiken we voor "Verwacht" en "Δ"?
  // - 'base' = α + β₁·population + β₂·area_km2 (R² ≈ 0.44, 100% PC4-dekking)
  // - 'k8'   = best-subset uit find_best_model.py (R² ≈ 0.54, 99.6% dekking;
  //           18 PC4s zonder avg_woz_value vallen automatisch terug op base)
  const [modelChoice, setModelChoice] = useState<'base' | 'k8'>(
    payload.model_k8 ? 'k8' : 'base'
  );
  const k8Available = !!payload.model_k8;
  const getPredicted = (s?: PainpointStats | null): number | null => {
    if (!s) return null;
    if (modelChoice === 'k8') {
      return s.predicted_points_k8 ?? s.predicted_points ?? null;
    }
    return s.predicted_points ?? null;
  };
  const getDelta = (s?: PainpointStats | null): number | null => {
    if (!s) return null;
    if (modelChoice === 'k8') {
      return s.delta_vs_predicted_k8 ?? s.delta_vs_predicted ?? null;
    }
    return s.delta_vs_predicted ?? null;
  };

  // Sort state for the main "per PC4" table — ordered stack for Excel-style
  // multi-column sorting. stack[0] is the primary key, stack[1] the tiebreaker, etc.
  type PC4Col = 'pc4' | 'city' | 'carriers' | 'count' | 'total' | 'locker' | 'shop'
    | 'population' | 'area' | 'density' | 'per_capita' | 'predicted' | 'delta';
  const [pc4SortStack, setPc4SortStack] = useState<Array<{ key: PC4Col; dir: SortDir }>>([
    { key: 'pc4', dir: 'asc' },
  ]);
  // Header click → make this column the single active sort (toggle direction
  // if it is already the primary). Multi-level sorting is done explicitly in
  // the SortBuilder above the table.
  const togglePc4Sort = (k: PC4Col) =>
    setPc4SortStack((stack) => {
      const primary = stack[0];
      if (primary && primary.key === k) {
        return [{ key: k, dir: primary.dir === 'asc' ? 'desc' : 'asc' }];
      }
      return [{ key: k, dir: 'asc' }];
    });
  const PC4_SORT_OPTIONS: Array<{ value: PC4Col; label: string }> = [
    { value: 'pc4', label: 'PC4' },
    { value: 'city', label: 'Stad' },
    { value: 'carriers', label: 'Gemeld door (carriers)' },
    { value: 'count', label: 'Aantal carriers' },
    { value: 'total', label: 'Pakketpunten' },
    { value: 'locker', label: 'Automaten' },
    { value: 'shop', label: 'Shops' },
    { value: 'population', label: 'Inwoners' },
    { value: 'area', label: 'Oppervlakte (km²)' },
    { value: 'density', label: 'PP per km²' },
    { value: 'per_capita', label: 'PP per 1 000 inw.' },
    { value: 'predicted', label: 'Verwacht (model)' },
    { value: 'delta', label: 'Δ (werkelijk − verwacht)' },
  ];
  const PC4_NUMERIC_COLS = new Set<PC4Col>([
    'count', 'total', 'locker', 'shop', 'population', 'area',
    'density', 'per_capita', 'predicted', 'delta',
  ]);
  const isPc4Numeric = (k: PC4Col) => PC4_NUMERIC_COLS.has(k);

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
          <h2 className="text-xl font-bold text-gray-900 mb-2">PC4-Pijnpunten — gemeld door carriers</h2>
          <p className="text-sm text-gray-600">
            Probleemgebieden zoals aangeleverd door <strong>vervoerders</strong> in het kader van het
            Convenant Duurzame Pakketlogistiek (G4). Bron:{' '}
            <code className="text-xs bg-gray-100 px-1 py-0.5 rounded">{payload.source}</code>, laatst
            bijgewerkt {new Date(payload.generated_at).toLocaleDateString('nl-NL')}.
            Klik op een rij om de kaart met de PC4-zone en pakketpunten te openen.
          </p>
          <p className="text-sm text-gray-600 mt-2">
            Pijnpunten die door de <strong>G4-gemeenten zelf</strong> zijn aangeleverd staan op een
            aparte pagina:{' '}
            <a
              href="/data-export/gemeente-painpoints"
              className="text-blue-700 hover:text-blue-900 underline underline-offset-2 font-medium"
            >
              Pijnpunten per gemeente →
            </a>
          </p>
        </section>


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
          <div className="mb-3">
            <SortBuilder
              stack={pc4SortStack}
              options={PC4_SORT_OPTIONS}
              isNumeric={isPc4Numeric}
              onChange={setPc4SortStack}
            />
          </div>
          <div className="overflow-x-auto bg-white border border-gray-200 rounded-lg">
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <MultiSortHeader label="PC4" sortKey="pc4" stack={pc4SortStack} onToggle={togglePc4Sort} />
                  <MultiSortHeader label="Stad" sortKey="city" stack={pc4SortStack} onToggle={togglePc4Sort} />
                  <MultiSortHeader label="Gemeld door" sortKey="carriers" stack={pc4SortStack} onToggle={togglePc4Sort} />
                  <MultiSortHeader label="#" sortKey="count" stack={pc4SortStack} onToggle={togglePc4Sort} align="right" />
                  <MultiSortHeader label="Pakketpunten" sortKey="total" stack={pc4SortStack} onToggle={togglePc4Sort} align="right" />
                  <MultiSortHeader label="Automaten" sortKey="locker" stack={pc4SortStack} onToggle={togglePc4Sort} align="right" />
                  <MultiSortHeader label="Shops" sortKey="shop" stack={pc4SortStack} onToggle={togglePc4Sort} align="right" />
                  <MultiSortHeader label="Inwoners" sortKey="population" stack={pc4SortStack} onToggle={togglePc4Sort} align="right" />
                  <MultiSortHeader label="km²" sortKey="area" stack={pc4SortStack} onToggle={togglePc4Sort} align="right" />
                  <MultiSortHeader label="PP/km²" sortKey="density" stack={pc4SortStack} onToggle={togglePc4Sort} align="right" />
                  <MultiSortHeader label="PP/1000 inw." sortKey="per_capita" stack={pc4SortStack} onToggle={togglePc4Sort} align="right" />
                  <MultiSortHeader label="Verwacht" sortKey="predicted" stack={pc4SortStack} onToggle={togglePc4Sort} align="right" />
                  <MultiSortHeader label="Δ" sortKey="delta" stack={pc4SortStack} onToggle={togglePc4Sort} align="right" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {entries
                  .slice()
                  .sort(([aPc4, av], [bPc4, bv]) => {
                    const getVal = (pc4: string, v: Painpoint, key: PC4Col) => {
                      const s = v.stats;
                      switch (key) {
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
                        case 'predicted': return getPredicted(s) ?? -1;
                        case 'delta': return getDelta(s) ?? 0;
                      }
                    };
                    for (const { key, dir } of pc4SortStack) {
                      const d = cmp(getVal(aPc4, av, key), getVal(bPc4, bv, key));
                      if (d !== 0) return dir === 'asc' ? d : -d;
                    }
                    return 0;
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
                    <td className="px-3 py-2 text-gray-700">{v.city}</td>
                    <td className="px-3 py-2">
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
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-gray-700">{v.carriers.length}</td>
                    <td className="px-3 py-2 text-right tabular-nums font-semibold text-gray-900">{v.pakketpunten.total}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-gray-700">{v.pakketpunten.locker}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-gray-700">{v.pakketpunten.shop}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-gray-700">{v.stats?.population != null ? v.stats.population.toLocaleString('nl-NL') : '—'}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-gray-700">{v.stats?.area_km2 != null ? v.stats.area_km2.toFixed(2) : '—'}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-gray-700">{v.stats?.points_per_km2 != null ? v.stats.points_per_km2.toFixed(1) : '—'}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-gray-700">{v.stats?.points_per_1000_inw != null ? v.stats.points_per_1000_inw.toFixed(2) : '—'}</td>
                    {(() => {
                      const pred = getPredicted(v.stats);
                      const delta = getDelta(v.stats);
                      return (
                        <>
                          <td className="px-3 py-2 text-right tabular-nums text-gray-700">{pred != null ? pred.toFixed(1) : '—'}</td>
                          <td className={`px-3 py-2 text-right tabular-nums font-semibold ${delta != null ? (delta >= 0 ? 'text-emerald-700' : 'text-red-700') : 'text-gray-500'}`}>{delta != null ? (delta >= 0 ? '+' : '') + delta.toFixed(1) : '—'}</td>
                        </>
                      );
                    })()}
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
                              selectedPc4 === r.pc4 ? 'bg-blue-50' : 'hover:bg-gray-50'
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
                            ? 'bg-blue-700 text-white'
                            : 'bg-gray-100 text-gray-700 hover:bg-blue-100 hover:text-blue-800'
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
              {selected.carriers.length > 0 && (
                <>
                  <div className="text-xs uppercase tracking-wide text-gray-500 mb-1">
                    Gemeld door carriers
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
