'use client';

import { useMemo, useState } from 'react';

/* ------------------------------------------------------------------ Types */

type Subset = 'total' | 'shop' | 'locker';
type Distance = '300m' | '400m' | '500m';
type Scope = 'national' | 'strict';

interface CoverageMetric {
  covered: number;
  pct: number;
}
type CoverageBySubset = Record<Subset, Record<Distance, CoverageMetric>>;

interface MunicipalityEntry {
  population: number;
  pc4_count: number;
  parcel_points: { total: number; shop: number; locker: number };
  national: CoverageBySubset;
  strict: CoverageBySubset;
}

interface PC4Entry {
  municipality: string | null;
  population: number;
  area_km2: number;
  total: Record<Distance, { pct: number; covered: number }>;
  shop: Record<Distance, { pct: number; covered: number }>;
  locker: Record<Distance, { pct: number; covered: number }>;
}

interface NationalEntry {
  population: number;
  total: Record<Distance, CoverageMetric>;
  shop: Record<Distance, CoverageMetric>;
  locker: Record<Distance, CoverageMetric>;
}

export interface PopulationReachPayload {
  generated_at: string;
  methodology: {
    buffer_distances_m: number[];
    subsets: string[];
    apportionment: string;
    scope_national: string;
    scope_strict: string;
    pc4_to_municipality: string;
    buffer_circle_segments: number;
  };
  sources: Record<string, string>;
  national: NationalEntry;
  municipalities: Record<string, MunicipalityEntry>;
  pc4: Record<string, PC4Entry>;
}

/* ------------------------------------------------------------- Formatters */

const nlInt = (n: number) => n.toLocaleString('nl-NL', { maximumFractionDigits: 0 });
const nlPct = (p: number) => p.toLocaleString('nl-NL', {
  minimumFractionDigits: 1, maximumFractionDigits: 1,
});

function pctTone(pct: number): string {
  // Same red→yellow→blue ramp as the map choropleth (avoids clashing with
  // the basemap's green parks/forests).
  if (pct >= 80) return 'bg-blue-700';
  if (pct >= 60) return 'bg-blue-500';
  if (pct >= 40) return 'bg-yellow-500';
  if (pct >= 20) return 'bg-orange-500';
  return 'bg-red-500';
}

function PctBar({ pct, tone }: { pct: number; tone?: string }) {
  return (
    <div className="flex items-center gap-2 min-w-[110px]">
      <div className="flex-1 h-2 bg-gray-100 rounded overflow-hidden">
        <div
          className={`h-full ${tone ?? pctTone(pct)}`}
          style={{ width: `${Math.min(100, Math.max(0, pct))}%` }}
        />
      </div>
      <span className="text-xs font-mono tabular-nums w-12 text-right text-gray-700">
        {nlPct(pct)}%
      </span>
    </div>
  );
}

/* ----------------------------------------------------------- CSV export */

function csvCell(v: unknown): string {
  if (v == null) return '';
  const s = String(v);
  return /[",;\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function downloadCsv(filename: string, rows: (string | number | null | undefined)[][]) {
  const csv = rows.map((r) => r.map(csvCell).join(';')).join('\r\n');
  // Excel-friendly: BOM + semicolons (NL locale defaults to ; as separator)
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

function exportMunicipalitiesCsv(payload: PopulationReachPayload) {
  const header = ['gemeente', 'inwoners', 'pc4_count',
    'pp_total', 'pp_shop', 'pp_locker'];
  for (const scope of ['national', 'strict'] as const) {
    for (const subset of ['total', 'shop', 'locker'] as const) {
      for (const dist of ['300m', '400m', '500m'] as const) {
        header.push(`${scope}_${subset}_${dist}_pct`);
        header.push(`${scope}_${subset}_${dist}_covered`);
      }
    }
  }
  const rows: (string | number)[][] = [header];
  for (const [name, m] of Object.entries(payload.municipalities)) {
    const row: (string | number)[] = [
      name, m.population, m.pc4_count,
      m.parcel_points.total, m.parcel_points.shop, m.parcel_points.locker,
    ];
    for (const scope of ['national', 'strict'] as const) {
      for (const subset of ['total', 'shop', 'locker'] as const) {
        for (const dist of ['300m', '400m', '500m'] as const) {
          row.push(m[scope][subset][dist].pct);
          row.push(m[scope][subset][dist].covered);
        }
      }
    }
    rows.push(row);
  }
  downloadCsv('bereik_per_gemeente.csv', rows);
}

function exportPc4Csv(payload: PopulationReachPayload) {
  const header = ['pc4', 'gemeente', 'inwoners', 'area_km2'];
  for (const subset of ['total', 'shop', 'locker'] as const) {
    for (const dist of ['300m', '400m', '500m'] as const) {
      header.push(`${subset}_${dist}_pct`);
      header.push(`${subset}_${dist}_covered`);
    }
  }
  const rows: (string | number | null)[][] = [header];
  for (const [pc4, v] of Object.entries(payload.pc4)) {
    const row: (string | number | null)[] = [
      pc4, v.municipality ?? '', v.population, v.area_km2,
    ];
    for (const subset of ['total', 'shop', 'locker'] as const) {
      for (const dist of ['300m', '400m', '500m'] as const) {
        row.push(v[subset][dist].pct);
        row.push(v[subset][dist].covered);
      }
    }
    rows.push(row);
  }
  downloadCsv('bereik_per_pc4.csv', rows);
}

function CsvButton({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button
      onClick={onClick}
      className="px-3 py-2 text-xs font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg hover:bg-emerald-100 transition flex items-center gap-1.5"
      title="Download als CSV (Excel-compatibel)"
    >
      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
      </svg>
      {label}
    </button>
  );
}

/* ---------------------------------------------------------------- Sorting */

type SortDir = 'asc' | 'desc';
interface SortState<K extends string> { key: K; dir: SortDir }

function cmp(a: unknown, b: unknown): number {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a).localeCompare(String(b), 'nl');
}

function SortHeader<K extends string>({
  label, k, sort, setSort, align = 'left',
}: {
  label: string; k: K;
  sort: SortState<K>;
  setSort: (s: SortState<K>) => void;
  align?: 'left' | 'right' | 'center';
}) {
  const active = sort.key === k;
  const arrow = active ? (sort.dir === 'asc' ? ' ↑' : ' ↓') : '';
  const alignCls = align === 'right' ? 'text-right' : align === 'center' ? 'text-center' : 'text-left';
  return (
    <th
      className={`${alignCls} px-2 py-2 text-xs font-semibold text-gray-600 cursor-pointer select-none hover:text-gray-900 whitespace-nowrap`}
      onClick={() =>
        setSort({
          key: k,
          dir: active && sort.dir === 'desc' ? 'asc' : 'desc',
        })
      }
    >
      {label}{arrow}
    </th>
  );
}

/* ------------------------------------------------------------------- UI */

const SUBSET_LABEL: Record<Subset, string> = {
  total: 'Alle pakketpunten', shop: 'Pakketshops', locker: 'Pakketautomaten',
};
const SUBSET_SHORT: Record<Subset, string> = {
  total: 'Alles', shop: 'Shops', locker: 'Lockers',
};
const DISTANCES: Distance[] = ['300m', '400m', '500m'];

// Cohort filter: G4 = vier grote steden (Convenant Duurzame Stadslogistiek)
// G40 = stedennetwerk van middelgrote gemeenten (~41 leden, peilmoment 2024).
const G4_MUNIS = new Set<string>([
  'Amsterdam', 'Rotterdam', 'Den Haag', 'Utrecht',
]);
const G40_MUNIS = new Set<string>([
  'Alkmaar', 'Almelo', 'Almere', 'Alphen aan den Rijn', 'Amersfoort',
  'Amstelveen', 'Apeldoorn', 'Arnhem', 'Assen', 'Breda',
  'Delft', 'Deventer', 'Dordrecht', 'Ede', 'Eindhoven',
  'Emmen', 'Enschede', 'Gouda', 'Groningen', 'Haarlem',
  'Haarlemmermeer', 'Heerlen', 'Helmond', 'Hengelo', 's-Hertogenbosch',
  'Hilversum', 'Hoorn', 'Leeuwarden', 'Leiden', 'Lelystad',
  'Maastricht', 'Nijmegen', 'Oss', 'Roosendaal', 'Schiedam',
  'Sittard-Geleen', 'Tilburg', 'Venlo', 'Zaanstad', 'Zoetermeer',
  'Zwolle',
]);

type Cohort = 'all' | 'g4' | 'g40';
function inCohort(name: string, cohort: Cohort): boolean {
  if (cohort === 'all') return true;
  if (cohort === 'g4')  return G4_MUNIS.has(name);
  return G40_MUNIS.has(name);
}

function SegControl<T extends string>({
  value, options, onChange,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="inline-flex rounded-lg bg-gray-100 p-1">
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
            value === o.value
              ? 'bg-white text-gray-900 shadow-sm'
              : 'text-gray-600 hover:text-gray-900'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/* --------------------------------------------------------------- Sections */

interface CoverageCardData {
  total: Record<Distance, CoverageMetric>;
  shop: Record<Distance, CoverageMetric>;
  locker: Record<Distance, CoverageMetric>;
}

function CoverageCardGrid({ data }: { data: CoverageCardData }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      {(['total', 'shop', 'locker'] as Subset[]).map((s) => (
        <div key={s} className="border border-gray-200 rounded-lg p-4">
          <div className="text-xs uppercase tracking-wide text-gray-500 mb-2">
            {SUBSET_LABEL[s]}
          </div>
          {DISTANCES.map((d) => {
            const m = data[s][d];
            return (
              <div key={d} className="flex items-baseline justify-between py-1">
                <span className="text-sm text-gray-600 w-14">{d}</span>
                <div className="flex-1">
                  <PctBar pct={m.pct} />
                </div>
                <span className="text-xs text-gray-500 ml-2 w-28 text-right tabular-nums">
                  {nlInt(m.covered)} inw.
                </span>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

function NationalSummary({ nat }: { nat: NationalEntry }) {
  const pop = nat.population;
  return (
    <section data-tour="landelijk" className="bg-white rounded-lg shadow-md p-6 mb-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2 mb-4">
        <h2 className="text-xl font-bold text-gray-900">Landelijk bereik</h2>
        <p className="text-sm text-gray-600">
          {nlInt(pop)} inwoners in {nlInt(Object.keys(nat.total).length)} metingen
        </p>
      </div>
      <CoverageCardGrid data={nat} />
    </section>
  );
}

/* Multi-select municipality comparison: same 3-card layout as the national
   summary, repeated per selected gemeente. G4/G40 preset buttons quickly
   fill the selection; individual munis can be added via the search box. */
function MunicipalityComparison({
  payload,
}: {
  payload: PopulationReachPayload;
}) {
  const allNames = useMemo(
    () => Object.keys(payload.municipalities).sort((a, b) => a.localeCompare(b, 'nl')),
    [payload]
  );
  const [selected, setSelected] = useState<string[]>([]);
  const [scope, setScope] = useState<Scope>('national');
  const [query, setQuery] = useState('');

  const selectedSet = useMemo(() => new Set(selected), [selected]);

  const addAll = (names: Iterable<string>) => {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const n of names) {
        if (allNames.includes(n)) next.add(n);
      }
      return [...next].sort((a, b) => a.localeCompare(b, 'nl'));
    });
  };
  const remove = (name: string) =>
    setSelected((prev) => prev.filter((n) => n !== name));
  const clear = () => setSelected([]);

  const suggestions = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [] as string[];
    return allNames
      .filter((n) => !selectedSet.has(n) && n.toLowerCase().includes(q))
      .slice(0, 8);
  }, [allNames, selectedSet, query]);

  const presetCounts = useMemo(() => ({
    g4:  allNames.filter((n) => G4_MUNIS.has(n)).length,
    g40: allNames.filter((n) => G40_MUNIS.has(n)).length,
  }), [allNames]);

  return (
    <section data-tour="vergelijk" className="bg-white rounded-lg shadow-md p-6 mb-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2 mb-4">
        <div>
          <h2 className="text-xl font-bold text-gray-900">Vergelijk gemeenten</h2>
          <p className="text-sm text-gray-600">
            Kies één of meer gemeenten en bekijk dezelfde 300m / 400m / 500m
            grafieken voor shops, automaten en alle pakketpunten samen.
          </p>
        </div>
        <SegControl
          value={scope}
          onChange={setScope}
          options={[
            { value: 'national', label: 'Nationaal (incl. buren)' },
            { value: 'strict',   label: 'Strict (alleen eigen pp)' },
          ]}
        />
      </div>

      {/* Controls: preset buttons + searchable add + clear */}
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <button
          type="button"
          onClick={() => addAll(G4_MUNIS)}
          className="px-3 py-1.5 text-xs font-medium border border-blue-300 bg-blue-50 text-blue-800 rounded hover:bg-blue-100 transition"
        >
          + G4 ({presetCounts.g4})
        </button>
        <button
          type="button"
          onClick={() => addAll(G40_MUNIS)}
          className="px-3 py-1.5 text-xs font-medium border border-blue-300 bg-blue-50 text-blue-800 rounded hover:bg-blue-100 transition"
        >
          + G40 ({presetCounts.g40})
        </button>
        {selected.length > 0 && (
          <button
            type="button"
            onClick={clear}
            className="px-3 py-1.5 text-xs font-medium border border-gray-300 bg-white text-gray-700 rounded hover:bg-gray-100 transition"
          >
            Wis selectie
          </button>
        )}
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Voeg gemeente toe…"
            className="w-full px-3 py-1.5 text-sm border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
            list="muni-suggestions"
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                const exact = allNames.find(
                  (n) => n.toLowerCase() === query.trim().toLowerCase()
                );
                if (exact && !selectedSet.has(exact)) {
                  addAll([exact]);
                  setQuery('');
                }
              }
            }}
          />
          {suggestions.length > 0 && (
            <div className="absolute z-10 left-0 right-0 mt-1 bg-white border border-gray-200 rounded shadow-lg max-h-60 overflow-auto">
              {suggestions.map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => {
                    addAll([n]);
                    setQuery('');
                  }}
                  className="block w-full text-left px-3 py-1.5 text-sm hover:bg-blue-50 hover:text-blue-800"
                >
                  {n}
                </button>
              ))}
            </div>
          )}
        </div>
        <span className="text-xs text-gray-500 ml-auto tabular-nums">
          {selected.length} geselecteerd
        </span>
      </div>

      {/* Selection chips */}
      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-4">
          {selected.map((name) => (
            <span
              key={name}
              className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium bg-blue-100 text-blue-800 rounded"
            >
              {name}
              <button
                type="button"
                onClick={() => remove(name)}
                aria-label={`Verwijder ${name}`}
                className="text-blue-700 hover:text-blue-900 leading-none"
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}

      {/* Per-municipality cards */}
      {selected.length === 0 ? (
        <div className="text-sm text-gray-500 italic py-6 text-center">
          Geen gemeenten geselecteerd. Gebruik de knoppen of de zoekbalk hierboven.
        </div>
      ) : (
        <div className="space-y-6">
          {selected.map((name) => {
            const m = payload.municipalities[name];
            if (!m) return null;
            const data = scope === 'national' ? m.national : m.strict;
            const points = m.parcel_points;
            return (
              <div
                key={name}
                className="border border-gray-200 rounded-lg p-4 bg-gray-50"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2 mb-3">
                  <h3 className="text-lg font-semibold text-gray-900">{name}</h3>
                  <p className="text-xs text-gray-600 tabular-nums">
                    {nlInt(m.population)} inwoners · {nlInt(points.total)} pakketpunten
                    {' '}({nlInt(points.shop)} shops, {nlInt(points.locker)} automaten)
                    {' · '}
                    {scope === 'national' ? 'incl. buurgemeenten' : 'alleen eigen punten'}
                  </p>
                </div>
                <CoverageCardGrid data={data} />
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

/* Municipality table: shows national + strict side-by-side so the
   "elasticity" column (nat − strict) makes the border effect visible.  */

type MuniSortKey =
  | 'name' | 'population' | 'points' | 'pct_nat' | 'pct_strict'
  | 'covered_nat' | 'covered_strict' | 'delta';

function MunicipalityTable({
  payload, subset, distance,
}: {
  payload: PopulationReachPayload;
  subset: Subset;
  distance: Distance;
}) {
  const [q, setQ] = useState('');
  const [cohort, setCohort] = useState<Cohort>('all');
  const [sort, setSort] = useState<SortState<MuniSortKey>>({
    key: 'pct_nat', dir: 'desc',
  });

  const rows = useMemo(() => {
    const out: {
      name: string; population: number; points: number;
      pct_nat: number; pct_strict: number;
      covered_nat: number; covered_strict: number;
      delta: number;
    }[] = [];
    for (const [name, m] of Object.entries(payload.municipalities)) {
      const nat = m.national[subset][distance];
      const str = m.strict[subset][distance];
      out.push({
        name,
        population: m.population,
        points: subset === 'total'
          ? m.parcel_points.total
          : subset === 'shop' ? m.parcel_points.shop : m.parcel_points.locker,
        pct_nat: nat.pct,
        pct_strict: str.pct,
        covered_nat: nat.covered,
        covered_strict: str.covered,
        delta: nat.pct - str.pct,
      });
    }
    return out;
  }, [payload, subset, distance]);

  const filteredSorted = useMemo(() => {
    const needle = q.trim().toLowerCase();
    let list = cohort === 'all'
      ? rows
      : rows.filter((r) => inCohort(r.name, cohort));
    if (needle) list = list.filter((r) => r.name.toLowerCase().includes(needle));
    list = list.slice();
    list.sort((a, b) => {
      const d = cmp(a[sort.key], b[sort.key]);
      return sort.dir === 'asc' ? d : -d;
    });
    return list;
  }, [rows, q, cohort, sort]);

  const cohortCounts = useMemo(() => ({
    all: rows.length,
    g4:  rows.filter((r) => inCohort(r.name, 'g4')).length,
    g40: rows.filter((r) => inCohort(r.name, 'g40')).length,
  }), [rows]);

  return (
    <section data-tour="per-gemeente" className="bg-white rounded-lg shadow-md p-6 mb-6">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div>
          <h2 className="text-xl font-bold text-gray-900">Per gemeente</h2>
          <p className="text-sm text-gray-600">
            {SUBSET_LABEL[subset]} · {distance} · Δ = nationaal − strict (grens-effect)
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <SegControl
            value={cohort}
            onChange={setCohort}
            options={[
              { value: 'all', label: `Alle (${cohortCounts.all})` },
              { value: 'g4',  label: `G4 (${cohortCounts.g4})` },
              { value: 'g40', label: `G40 (${cohortCounts.g40})` },
            ]}
          />
          <CsvButton onClick={() => exportMunicipalitiesCsv(payload)} label="CSV" />
          <input
            type="text"
            placeholder={`Zoek in ${filteredSorted.length} gemeenten...`}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent w-56"
          />
        </div>
      </div>
      <div className="overflow-x-auto -mx-6 px-6">
        <table className="w-full text-sm">
          <thead className="border-b border-gray-200">
            <tr>
              <SortHeader label="Gemeente"   k="name"            sort={sort} setSort={setSort} />
              <SortHeader label="Inwoners"   k="population"      sort={sort} setSort={setSort} align="right" />
              <SortHeader label="PP"         k="points"          sort={sort} setSort={setSort} align="right" />
              <SortHeader label="% Nationaal" k="pct_nat"         sort={sort} setSort={setSort} />
              <SortHeader label="Inw. (nat.)" k="covered_nat"     sort={sort} setSort={setSort} align="right" />
              <SortHeader label="% Strict"    k="pct_strict"      sort={sort} setSort={setSort} />
              <SortHeader label="Inw. (str.)" k="covered_strict"  sort={sort} setSort={setSort} align="right" />
              <SortHeader label="Δ %"         k="delta"           sort={sort} setSort={setSort} align="right" />
            </tr>
          </thead>
          <tbody>
            {filteredSorted.map((r) => (
              <tr key={r.name} className="border-b border-gray-100 hover:bg-gray-50">
                <td className="px-2 py-2 font-medium text-gray-900 whitespace-nowrap">{r.name}</td>
                <td className="px-2 py-2 text-right tabular-nums text-gray-700">{nlInt(r.population)}</td>
                <td className="px-2 py-2 text-right tabular-nums text-gray-700">{nlInt(r.points)}</td>
                <td className="px-2 py-2"><PctBar pct={r.pct_nat} /></td>
                <td className="px-2 py-2 text-right tabular-nums text-gray-600">{nlInt(r.covered_nat)}</td>
                <td className="px-2 py-2"><PctBar pct={r.pct_strict} tone="bg-blue-500" /></td>
                <td className="px-2 py-2 text-right tabular-nums text-gray-600">{nlInt(r.covered_strict)}</td>
                <td className="px-2 py-2 text-right tabular-nums">
                  <span className={r.delta >= 0 ? 'text-emerald-600' : 'text-gray-500'}>
                    {r.delta >= 0 ? '+' : ''}{nlPct(r.delta)}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {filteredSorted.length === 0 && (
          <p className="py-8 text-center text-sm text-gray-500">Geen resultaten.</p>
        )}
      </div>
    </section>
  );
}

/* ---------------------------------------------------------- PC4 detail */

type PC4SortKey = 'pc4' | 'muni' | 'pop' | 'area' | 'pct300' | 'pct400' | 'pct500';

function PC4Table({
  payload, subset,
}: {
  payload: PopulationReachPayload;
  subset: Subset;
}) {
  const [q, setQ] = useState('');
  const [muniFilter, setMuniFilter] = useState<string>('');
  const [cohort, setCohort] = useState<Cohort>('all');
  const [sort, setSort] = useState<SortState<PC4SortKey>>({ key: 'pop', dir: 'desc' });

  const muniOptions = useMemo(() => {
    const set = new Set<string>();
    for (const v of Object.values(payload.pc4)) {
      if (v.municipality) set.add(v.municipality);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'nl'));
  }, [payload.pc4]);

  const rows = useMemo(() => {
    const out: {
      pc4: string; muni: string; pop: number; area: number;
      pct300: number; pct400: number; pct500: number;
      covered300: number; covered400: number; covered500: number;
    }[] = [];
    for (const [pc4, v] of Object.entries(payload.pc4)) {
      out.push({
        pc4,
        muni: v.municipality ?? '—',
        pop: v.population,
        area: v.area_km2,
        pct300: v[subset]['300m'].pct,
        pct400: v[subset]['400m'].pct,
        pct500: v[subset]['500m'].pct,
        covered300: v[subset]['300m'].covered,
        covered400: v[subset]['400m'].covered,
        covered500: v[subset]['500m'].covered,
      });
    }
    return out;
  }, [payload.pc4, subset]);

  const filteredSorted = useMemo(() => {
    const needle = q.trim().toLowerCase();
    let list = rows;
    if (cohort !== 'all') list = list.filter((r) => inCohort(r.muni, cohort));
    if (muniFilter) list = list.filter((r) => r.muni === muniFilter);
    if (needle) list = list.filter((r) =>
      r.pc4.toLowerCase().includes(needle) ||
      r.muni.toLowerCase().includes(needle)
    );
    list = list.slice();
    list.sort((a, b) => {
      const d = cmp(a[sort.key], b[sort.key]);
      return sort.dir === 'asc' ? d : -d;
    });
    return list;
  }, [rows, q, muniFilter, cohort, sort]);

  const MAX_ROWS = 500;
  const shown = filteredSorted.slice(0, MAX_ROWS);

  return (
    <section data-tour="per-pc4" className="bg-white rounded-lg shadow-md p-6">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div>
          <h2 className="text-xl font-bold text-gray-900">Per PC4</h2>
          <p className="text-sm text-gray-600">
            {SUBSET_LABEL[subset]} · {filteredSorted.length.toLocaleString('nl-NL')} PC4s
            {filteredSorted.length > MAX_ROWS ? ` (eerste ${MAX_ROWS} getoond)` : ''}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <SegControl
            value={cohort}
            onChange={setCohort}
            options={[
              { value: 'all', label: 'Alle' },
              { value: 'g4',  label: 'G4' },
              { value: 'g40', label: 'G40' },
            ]}
          />
          <CsvButton onClick={() => exportPc4Csv(payload)} label="CSV" />
          <select
            value={muniFilter}
            onChange={(e) => setMuniFilter(e.target.value)}
            className="px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          >
            <option value="">Alle gemeenten</option>
            {muniOptions.map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
          <input
            type="text"
            placeholder="Zoek PC4 of gemeente..."
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent w-48"
          />
        </div>
      </div>
      <div className="overflow-x-auto -mx-6 px-6">
        <table className="w-full text-sm">
          <thead className="border-b border-gray-200">
            <tr>
              <SortHeader label="PC4"      k="pc4"    sort={sort} setSort={setSort} />
              <SortHeader label="Gemeente" k="muni"   sort={sort} setSort={setSort} />
              <SortHeader label="Inwoners" k="pop"    sort={sort} setSort={setSort} align="right" />
              <SortHeader label="Opp. km²" k="area"   sort={sort} setSort={setSort} align="right" />
              <SortHeader label="% 300m"   k="pct300" sort={sort} setSort={setSort} />
              <SortHeader label="% 400m"   k="pct400" sort={sort} setSort={setSort} />
              <SortHeader label="% 500m"   k="pct500" sort={sort} setSort={setSort} />
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.pc4} className="border-b border-gray-100 hover:bg-gray-50">
                <td className="px-2 py-2 font-mono text-gray-900">{r.pc4}</td>
                <td className="px-2 py-2 text-gray-700 whitespace-nowrap">{r.muni}</td>
                <td className="px-2 py-2 text-right tabular-nums text-gray-700">{nlInt(r.pop)}</td>
                <td className="px-2 py-2 text-right tabular-nums text-gray-600">
                  {r.area.toLocaleString('nl-NL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </td>
                <td className="px-2 py-2"><PctBar pct={r.pct300} /></td>
                <td className="px-2 py-2"><PctBar pct={r.pct400} tone="bg-blue-500" /></td>
                <td className="px-2 py-2"><PctBar pct={r.pct500} tone="bg-indigo-500" /></td>
              </tr>
            ))}
          </tbody>
        </table>
        {filteredSorted.length === 0 && (
          <p className="py-8 text-center text-sm text-gray-500">Geen resultaten.</p>
        )}
      </div>
    </section>
  );
}

/* ----------------------------------------------------------------- Root */

export default function PopulationReachReport({
  payload,
}: {
  payload: PopulationReachPayload;
}) {
  const [subset, setSubset] = useState<Subset>('total');
  const [distance, setDistance] = useState<Distance>('300m');

  return (
    <>
      {/* Intro / methodology */}
      <div data-tour="intro" className="mb-6 p-4 bg-indigo-50 border border-indigo-200 rounded-lg text-sm text-indigo-900">
        <h2 className="font-semibold mb-1">Bereik van inwoners</h2>
        <p>
          Per PC4 tellen we de inwoners van CBS Vierkantstatistiek-cellen (100&nbsp;m × 100&nbsp;m)
          waarvan het centrum binnen 300&nbsp;m / 400&nbsp;m / 500&nbsp;m van een pakketpunt ligt.
          Onbewoonde ruimte (water, parken, industrieterreinen, akkers) telt als 0 — dus
          géén uniforme dichtheidsaanname meer. De gemeente-waarde is een grid-sommatie
          over alle CBS-cellen binnen die gemeente.
        </p>
        <p className="mt-1">
          <strong>Nationaal</strong>: buffer-unie gebouwd uit álle pakketpunten in NL
          (een shop in buurgemeente telt mee). <strong>Strict</strong>: alleen punten
          binnen dezelfde gemeente. Het verschil (Δ) toont het grens-effect.
        </p>
      </div>

      {/* National summary */}
      <NationalSummary nat={payload.national} />

      {/* Multi-select gemeente comparison */}
      <MunicipalityComparison payload={payload} />

      {/* Controls */}
      <div data-tour="controls" className="bg-white rounded-lg shadow-md p-4 mb-6 flex flex-wrap items-center gap-6">
        <div className="flex items-center gap-3">
          <span className="text-sm font-medium text-gray-700">Afstand</span>
          <SegControl
            value={distance}
            onChange={setDistance}
            options={DISTANCES.map((d) => ({ value: d, label: d }))}
          />
        </div>
        <div className="flex items-center gap-3">
          <span className="text-sm font-medium text-gray-700">Type</span>
          <SegControl
            value={subset}
            onChange={setSubset}
            options={[
              { value: 'total',  label: SUBSET_SHORT.total },
              { value: 'shop',   label: SUBSET_SHORT.shop },
              { value: 'locker', label: SUBSET_SHORT.locker },
            ]}
          />
        </div>
      </div>

      {/* Municipality table */}
      <MunicipalityTable payload={payload} subset={subset} distance={distance} />

      {/* PC4 table */}
      <PC4Table payload={payload} subset={subset} />

      {/* Footnote */}
      <div className="mt-8 p-4 bg-gray-50 border border-gray-200 rounded-lg text-xs text-gray-600 space-y-1">
        <p>
          <strong>Methodologie</strong>: {payload.methodology.apportionment}.{' '}
          Buffer-cirkels met {payload.methodology.buffer_circle_segments} segmenten.{' '}
          PC4→gemeente via centroid (conform pc4_stats.json).
        </p>
        <p>
          <strong>Bronnen</strong>: parcel-locations uit {payload.sources.parcel_points}.
          PC4-populatie uit CBS 83502NED. PC4-geometrie uit {payload.sources.pc4_polygons}.
          Gemeente-geometrie uit {payload.sources.municipality_polygons}.
        </p>
        <p>Gegenereerd op {new Date(payload.generated_at).toLocaleString('nl-NL')}.</p>
      </div>
    </>
  );
}
