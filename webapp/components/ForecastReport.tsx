'use client';

import { useEffect, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceDot,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import MunicipalitySelector from '@/components/MunicipalitySelector';
import { EIGENDOM_COLOURS, EIGENDOM_LABELS, locatePick, type EigendomChoice } from '@/lib/terrain';
import {
  CARRIER_LABELS,
  CARRIER_ORDER,
  CARRIER_SERIES_COLORS,
  CARRIER_SERIES_COLORS_DARK,
  type Carrier,
} from '@/lib/carriers';
import type {
  AnyForecast,
  Betrouwbaarheid,
  Category,
  ForecastIndex,
  ForecastIndexRow,
  ForecastPlacements,
  ForecastPlacementsIndex,
  OlsFit,
  GemeenteForecast,
  Granularity,
  NationalForecast,
  Pakketvraag,
  Scenario,
} from '@/types/forecast';
import { isNational } from '@/types/forecast';

type Measure = 'punten' | 'locaties';
type CategoryChoice = 'alle' | Category;
type View = 'totaal' | 'vervoerder';

const ForecastMap = dynamic(() => import('./ForecastMap'), {
  ssr: false,
  loading: () => <div className="h-[520px] rounded-lg bg-muted animate-pulse" />,
});

const nl = new Intl.NumberFormat('nl-NL');
const nl1 = new Intl.NumberFormat('nl-NL', { maximumFractionDigits: 1, minimumFractionDigits: 1 });
const nl2 = new Intl.NumberFormat('nl-NL', { maximumFractionDigits: 2, minimumFractionDigits: 2 });
const MONTHS = ['jan', 'feb', 'mrt', 'apr', 'mei', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'];

const SCENARIO_LABELS: Record<Scenario, string> = { laag: 'Laag', midden: 'Midden', hoog: 'Hoog' };
const CATEGORY_LABELS: Record<CategoryChoice, string> = { alle: 'Alle punten', locker: 'Automaten', shop: 'Bemande punten' };
const RELIABILITY_STYLE: Record<Betrouwbaarheid, string> = {
  hoog: 'bg-success-muted text-success border-success/30',
  middel: 'bg-warning-muted text-warning border-warning/30',
  laag: 'bg-destructive-muted text-destructive border-destructive/30',
};

/* ------------------------------------------------------------------ helpers */

function fmt(v: number | null | undefined) {
  return v == null ? '—' : nl.format(Math.round(v));
}

function signed(v: number | null | undefined) {
  if (v == null) return '—';
  const r = Math.round(v);
  return `${r > 0 ? '+' : ''}${nl.format(r)}`;
}

function periodLabel(label: string, gran: Granularity) {
  if (gran === 'maand') {
    const [y, m] = label.split('-');
    return `${MONTHS[Number(m) - 1]} ${y}`;
  }
  if (gran === 'week') return label.replace('-W', ' wk ');
  return label;
}

/** Month (YYYY-MM) an ISO week belongs to: the month of its Thursday. */
function weekMonth(label: string) {
  const [y, w] = label.split('-W').map(Number);
  const jan4 = Date.UTC(y, 0, 4);
  const jan4Dow = (new Date(jan4).getUTCDay() + 6) % 7;
  const thursday = new Date(jan4 - jan4Dow * 86400000 + (w - 1) * 7 * 86400000 + 3 * 86400000);
  return `${thursday.getUTCFullYear()}-${String(thursday.getUTCMonth() + 1).padStart(2, '0')}`;
}

function csvCell(v: string | number | null | undefined): string {
  if (v == null) return '';
  if (typeof v === 'number') return String(v).replace('.', ',');
  return /[",;\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
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

function useDarkMode() {
  const [dark, setDark] = useState(false);
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const update = () => {
      const theme = document.documentElement.dataset.theme;
      setDark(theme === 'dark' || (theme !== 'light' && media.matches));
    };
    update();
    media.addEventListener('change', update);
    const observer = new MutationObserver(update);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => {
      media.removeEventListener('change', update);
      observer.disconnect();
    };
  }, []);
  return dark;
}

function SegControl<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: { value: T; label: string; disabled?: boolean }[];
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[11px] font-medium uppercase tracking-wide text-subtle-foreground">{label}</span>
      <div className="inline-flex rounded-lg bg-secondary p-1" role="group" aria-label={label}>
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            disabled={o.disabled}
            onClick={() => onChange(o.value)}
            aria-pressed={value === o.value}
            className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
              value === o.value ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function Tile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="bg-card rounded-lg shadow-sm border border-border p-4">
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      <div className="mt-1 text-2xl font-semibold text-foreground tabular-nums">{value}</div>
      {sub && <div className="mt-1 text-xs text-subtle-foreground">{sub}</div>}
    </div>
  );
}

function ReliabilityBadge({ level }: { level: Betrouwbaarheid }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 text-xs font-semibold rounded border ${RELIABILITY_STYLE[level]}`}>
      Betrouwbaarheid: {level}
    </span>
  );
}

const axisTick = { fill: 'var(--muted-foreground)', fontSize: 11 };

/* ------------------------------------------------------------------ series selection */

/** log: log(N) = a + b x week on the cleaned series; lin: cumulative organic growth = a + b x week. */
interface TrendFit {
  kind: 'log' | 'lin';
  ols: OlsFit;
}

/** Regression coefficients printed on the chart, next to the line they describe. */
function TrendBox({ fit, title }: { fit: TrendFit; title: string }) {
  const { ols } = fit;
  return (
    <div className="absolute right-6 bottom-12 z-10 max-w-[380px] rounded-md border border-border bg-card/90 px-3 py-2 text-[11px] leading-snug text-muted-foreground shadow-sm backdrop-blur-sm">
      <div className="flex items-center gap-2 font-semibold text-foreground">
        <svg width="18" height="6" aria-hidden>
          <line x1="0" y1="3" x2="18" y2="3" stroke="var(--muted-foreground)" strokeWidth={1.5} strokeDasharray="1 3" />
        </svg>
        {title}
      </div>
      {fit.kind === 'log' ? (
        <>
          <div className="mt-1 font-mono text-foreground">
            ln(N) = {nl2.format(ols.intercept)} + {(ols.helling * 100).toLocaleString('nl-NL', { maximumFractionDigits: 3 })}% x week
          </div>
          <div>
            b = {(ols.helling * 100).toLocaleString('nl-NL', { maximumFractionDigits: 3 })}%/week (SE{' '}
            {(ols.se * 100).toLocaleString('nl-NL', { maximumFractionDigits: 3 })}), {ols.groei_per_jaar_pct != null && ols.groei_per_jaar_pct >= 0 ? '+' : ''}
            {nl1.format(ols.groei_per_jaar_pct ?? 0)}% per jaar
            {ols.groei_per_jaar_95 ? ` (95%: ${nl1.format(ols.groei_per_jaar_95[0])} tot ${nl1.format(ols.groei_per_jaar_95[1])})` : ''}
          </div>
        </>
      ) : (
        <>
          <div className="mt-1 font-mono text-foreground">
            groei = {nl1.format(ols.intercept)} {ols.helling >= 0 ? '+' : '-'} {nl2.format(Math.abs(ols.helling))} x week
          </div>
          <div>
            b = {ols.helling >= 0 ? '+' : ''}
            {nl2.format(ols.helling)} punten per week (SE {nl2.format(ols.se)}), ca. {signed(ols.helling * 52)} per jaar
          </div>
        </>
      )}
      <div>
        R² = {ols.r2 != null ? nl2.format(ols.r2) : '—'} · n = {ols.n} weken
      </div>
    </div>
  );
}

interface Selected {
  labels: string[];
  ff: number;
  raw: (number | null)[];
  clean: (number | null)[] | null;
  trend: (number | null)[] | null;
  fit: TrendFit | null;
  p10: (number | null)[];
  p50: (number | null)[];
  p90: (number | null)[];
}

function selectSeries(f: AnyForecast, scen: Scenario, measure: Measure, cat: CategoryChoice, gran: Granularity): Selected {
  const block = f.scenarios[scen];
  const labels = f.periods[gran];
  const ff = f.forecast_from[gran];
  let stock;
  let raw: (number | null)[];
  let clean: (number | null)[] | null = null;
  let trend: (number | null)[] | null = null;
  let fit: TrendFit | null = null;
  const nat = isNational(f) ? f : null;
  if (measure === 'locaties') {
    stock = block.locaties.stock[gran];
    raw = f.history.locaties_raw[gran];
    if (nat) {
      clean = nat.history.locaties_clean[gran];
      trend = nat.history.trend_ols.locaties?.[gran] ?? null;
      fit = nat.regressies.locaties ? { kind: 'log', ols: nat.regressies.locaties } : null;
    }
  } else if (cat === 'alle') {
    stock = block.punten.stock[gran];
    raw = f.history.punten_raw[gran];
    clean = f.history.punten_clean[gran];
    if (nat) {
      trend = nat.history.trend_ols.punten?.[gran] ?? nat.history.punten_trend_ols[gran];
      fit = { kind: 'log', ols: nat.regressies.totaal };
    } else {
      const g = f as GemeenteForecast;
      trend = g.history.punten_trend_ols?.[gran] ?? null;
      fit = g.reliability.trend_eigen_data ? { kind: 'lin', ols: g.reliability.trend_eigen_data } : null;
    }
  } else {
    stock = block.categorie[cat].stock[gran];
    raw = f.history.categorie_raw[cat][gran];
    if (nat) {
      trend = nat.history.trend_ols[cat]?.[gran] ?? null;
      const ols = nat.regressies.categorie?.[cat];
      fit = ols ? { kind: 'log', ols } : null;
    }
  }
  return { labels, ff, raw, clean, trend, fit, p10: stock.p10, p50: stock.p50, p90: stock.p90 };
}

/** Median stock per carrier for the chosen category, month or year granularity. */
function carrierSeries(f: AnyForecast, scen: Scenario, cat: CategoryChoice, gran: 'maand' | 'jaar') {
  const per = f.scenarios[scen].per_vervoerder;
  const out: Partial<Record<Carrier, number[]>> = {};
  for (const c of CARRIER_ORDER) {
    const entry = per[c];
    if (!entry) continue;
    const parts = cat === 'alle' ? (['locker', 'shop'] as Category[]) : [cat];
    const series = f.periods[gran].map((_, i) =>
      parts.reduce((sum, k) => sum + (entry[k]?.[gran]?.[i] ?? 0), 0),
    );
    if (series.some((v) => v > 0)) out[c] = series;
  }
  return out;
}

/* ------------------------------------------------------------------ main */

export default function ForecastReport({ national, index }: { national: NationalForecast; index: ForecastIndex }) {
  const dark = useDarkMode();
  const palette = dark ? CARRIER_SERIES_COLORS_DARK : CARRIER_SERIES_COLORS;

  const [slug, setSlug] = useState('nederland');
  const [loaded, setLoaded] = useState<Record<string, GemeenteForecast>>({});
  const [failed, setFailed] = useState<string | null>(null);

  const [scen, setScen] = useState<Scenario>('midden');
  const [measure, setMeasure] = useState<Measure>('punten');
  const [cat, setCat] = useState<CategoryChoice>('alle');
  const [gran, setGran] = useState<Granularity>('maand');
  const [view, setView] = useState<View>('totaal');

  // Gemeente files are fetched on first selection and kept; until one arrives
  // the national forecast stays on screen.
  useEffect(() => {
    if (slug === 'nederland' || loaded[slug]) return;
    let cancelled = false;
    fetch(`/data/forecast/${slug}.json`)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<GemeenteForecast>;
      })
      .then((payload) => {
        if (!cancelled) setLoaded((prev) => ({ ...prev, [slug]: payload }));
      })
      .catch(() => {
        if (!cancelled) setFailed(slug);
      });
    return () => {
      cancelled = true;
    };
  }, [slug, loaded]);

  const data: AnyForecast = slug === 'nederland' ? national : (loaded[slug] ?? national);
  const error = failed === slug ? 'Prognose voor deze gemeente kon niet worden geladen.' : null;
  const loading = slug !== 'nederland' && !loaded[slug] && !error;

  const municipalities = useMemo(
    () => [
      { name: 'Nederland (totaal)', slug: 'nederland', province: 'Alle provincies', population: 0 },
      ...index.gemeenten.map((g) => ({ name: g.naam, slug: g.slug, province: g.provincie, population: g.inwoners ?? 0 })),
    ],
    [index],
  );

  // The per-carrier split only exists for punten; locaties have no carrier.
  const effectiveView: View = measure === 'locaties' ? 'totaal' : view;
  const head = data.headline;
  const isNl = isNational(data);
  const reliability = isNl ? null : (data as GemeenteForecast).reliability;

  return (
    <div className="space-y-6">
      <section data-tour="intro" className="bg-card rounded-lg shadow-md p-6">
        <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
          <div className="max-w-3xl">
            <h2 className="text-xl font-semibold text-foreground">Prognose pakketpunten tot en met 2030</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Verwachte groei van het aantal pakketpunten en automaten per week, maand en jaar, gecorrigeerd voor
              meetbreuken zoals nieuwe vervoerders in de data en bevroren caches. Gebaseerd op {national.periods.week.indexOf(national.last_week) + 1} weken
              historie tot {national.last_week.replace('-W', ' week ')}: lees de uitkomsten als scenario&apos;s, niet als zekerheden.
            </p>
          </div>
          <div data-tour="gemeente" className="w-full lg:w-80">
            <MunicipalitySelector municipalities={municipalities} selected={slug} onChange={setSlug} />
          </div>
        </div>

        <div data-tour="knoppen" className="mt-5 flex flex-wrap gap-4">
          <SegControl
            label="Scenario"
            value={scen}
            onChange={setScen}
            options={(['laag', 'midden', 'hoog'] as Scenario[]).map((s) => ({ value: s, label: SCENARIO_LABELS[s] }))}
          />
          <SegControl
            label="Telling"
            value={measure}
            onChange={setMeasure}
            options={[
              { value: 'punten', label: 'Punten' },
              { value: 'locaties', label: 'Unieke locaties' },
            ]}
          />
          <SegControl
            label="Categorie"
            value={cat}
            onChange={setCat}
            options={(['alle', 'locker', 'shop'] as CategoryChoice[]).map((c) => ({
              value: c,
              label: CATEGORY_LABELS[c],
              disabled: measure === 'locaties' && c !== 'alle',
            }))}
          />
          <SegControl
            label="Periode"
            value={gran}
            onChange={setGran}
            options={[
              { value: 'week', label: 'Week', disabled: effectiveView === 'vervoerder' },
              { value: 'maand', label: 'Maand' },
              { value: 'jaar', label: 'Jaar' },
            ]}
          />
          <SegControl
            label="Weergave"
            value={effectiveView}
            onChange={(v) => {
              setView(v);
              if (v === 'vervoerder' && gran === 'week') setGran('maand');
            }}
            options={[
              { value: 'totaal', label: 'Totaal' },
              { value: 'vervoerder', label: 'Per vervoerder', disabled: measure === 'locaties' },
            ]}
          />
        </div>
        {loading && <p className="mt-3 text-sm text-muted-foreground">Prognose laden...</p>}
        {error && <p className="mt-3 text-sm text-destructive">{error}</p>}
      </section>

      <section data-tour="kerncijfers" className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        <Tile
          label={`Punten nu (${data.last_week.replace('-W', ' wk ')})`}
          value={fmt(head.nu)}
          sub={`${nl1.format(head.aandeel_automaat_nu_pct)}% automaat`}
        />
        <Tile
          label="Punten eind 2030 (midden)"
          value={fmt(head.y2030)}
          sub={`scenario laag ${fmt(head.y2030_laag)} tot hoog ${fmt(head.y2030_hoog)}`}
        />
        <Tile label="Groei per jaar (midden)" value={`${nl1.format(head.cagr_pct)}%`} sub="gemiddeld, samengesteld tot eind 2030" />
        <Tile
          label="Unieke locaties nu / 2030"
          value={`${fmt(head.locaties_nu)} / ${fmt(head.locaties_2030)}`}
          sub="fysieke plekken, alle vervoerders samen"
        />
        <Tile
          label="Punten per locatie nu / 2030"
          value={`${nl2.format(head.punten_per_locatie_nu)} / ${nl2.format(head.punten_per_locatie_2030)}`}
          sub={`${nl1.format(head.multi_aandeel_nu_pct)}% van de locaties heeft 2+ vervoerders${
            head.multi_aandeel_2030_pct != null ? ` (2030: ${nl1.format(head.multi_aandeel_2030_pct)}%)` : ''
          }`}
        />
      </section>

      {reliability && <ReliabilityCard data={data as GemeenteForecast} />}

      <section data-tour="grafiek" className="bg-card rounded-lg shadow-md p-6">
        {effectiveView === 'totaal' ? (
          <ProjectionChart data={data} scen={scen} measure={measure} cat={cat} gran={gran} events={national.events} />
        ) : (
          <CarrierChart data={data} scen={scen} cat={cat} gran={gran === 'jaar' ? 'jaar' : 'maand'} palette={palette} />
        )}
      </section>

      <section data-tour="white-label" className="bg-card rounded-lg shadow-md p-6">
        <SharedLocationsChart data={data} scen={scen} gran={gran} multiFit={national.regressies.multi_vs_ratio} />
      </section>

      <section data-tour="groeitabel" className="bg-card rounded-lg shadow-md p-6">
        <GrowthTable data={data} scen={scen} cat={cat} palette={palette} />
      </section>

      <section data-tour="plaatsing" className="bg-card rounded-lg shadow-md p-6">
        <PlacementSection slug={slug} naam={data.naam} />
      </section>

      <section data-tour="ranking" className="bg-card rounded-lg shadow-md p-6">
        <RankingTable rows={index.gemeenten} onSelect={setSlug} selected={slug} />
      </section>

      <section data-tour="methode" className="bg-card rounded-lg shadow-md p-6">
        <Methodology national={national} rows={index.gemeenten} />
      </section>
    </div>
  );
}

/* ------------------------------------------------------------------ reliability */

function ReliabilityCard({ data }: { data: GemeenteForecast }) {
  const r = data.reliability;
  const items: [string, string, string][] = [
    ['Punten nu', fmt(r.n_now), 'Kleine aantallen zijn van nature onrustig.'],
    ['Bruikbare weken', `${r.weeks_clean}`, 'Weken met meetbare organische groei, na het wegfilteren van meetbreuken.'],
    ['Ruis per week', `${nl1.format(r.noise_cv * 100)}%`, 'Spreiding van de wekelijkse groei, als percentage van het huidige aantal.'],
    ['Signaal/ruis', nl2.format(r.snr), 'Gemiddelde groei gedeeld door de onzekerheid daarvan. Onder 2 is de trend niet duidelijk van ruis te onderscheiden.'],
    ['Eigen data', `${Math.round(r.shrinkage_weight * 100)}%`, 'Deel van de groeiverdeling dat uit de eigen historie komt; de rest komt uit huidig aandeel en ruimte tot het plafond.'],
    [
      'Terugtoets-fout',
      `${nl1.format(r.backtest_fout_pct)}%`,
      `Afwijking bij voorspellen van de laatste 12 weken uit de weken ervoor (niets voorspellen: ${nl1.format(r.backtest_naief_pct)}%).`,
    ],
    [
      'Trend eigen data',
      r.trend_eigen_data ? `${r.trend_eigen_data.helling >= 0 ? '+' : ''}${nl2.format(r.trend_eigen_data.helling)}/wk` : '—',
      r.trend_eigen_data
        ? `Lineaire regressie van de cumulatieve organische groei op de week: R² ${nl2.format(r.trend_eigen_data.r2 ?? 0)}, n = ${r.trend_eigen_data.n} weken, SE ${nl2.format(r.trend_eigen_data.se)}.`
        : 'Te weinig weken voor een regressie.',
    ],
    ['Bandbreedte 2030', r.pi_rel_width_2030 != null ? `${Math.round(r.pi_rel_width_2030 * 100)}%` : '—', 'Breedte P10-P90 ten opzichte van de middenwaarde.'],
  ];
  return (
    <section data-tour="betrouwbaarheid" className="bg-card rounded-lg shadow-md p-6">
      <div className="flex flex-wrap items-center gap-3">
        <h3 className="text-base font-semibold text-foreground">Hoe betrouwbaar is de prognose voor {data.naam}?</h3>
        <ReliabilityBadge level={r.betrouwbaarheid} />
      </div>
      {r.redenen.length > 0 && (
        <p className="mt-2 text-sm text-muted-foreground">
          {r.betrouwbaarheid === 'laag' ? 'De prognose leunt vooral op vergelijkbare gemeenten: ' : 'Let op: '}
          {r.redenen.join('; ')}.
        </p>
      )}
      <dl className="mt-4 grid grid-cols-2 md:grid-cols-4 xl:grid-cols-8 gap-3">
        {items.map(([label, value, help]) => (
          <div key={label} className="border border-border rounded-lg p-3" title={help}>
            <dt className="text-xs text-muted-foreground">{label}</dt>
            <dd className="mt-0.5 text-lg font-semibold text-foreground tabular-nums">{value}</dd>
            <dd className="mt-1 text-[11px] leading-snug text-subtle-foreground">{help}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

/* ------------------------------------------------------------------ charts */

function LegendSwatch({ kind, label }: { kind: 'raw' | 'clean' | 'forecast' | 'band' | 'trend'; label: string }) {
  const swatch =
    kind === 'band' ? (
      <span className="inline-block w-4 h-3 rounded-sm" style={{ background: 'var(--primary)', opacity: 0.18 }} />
    ) : (
      <svg width="20" height="8" aria-hidden>
        <line
          x1="0"
          y1="4"
          x2="20"
          y2="4"
          stroke={kind === 'raw' || kind === 'trend' ? 'var(--muted-foreground)' : 'var(--primary)'}
          strokeWidth={kind === 'trend' ? 1.5 : 2}
          strokeDasharray={kind === 'forecast' ? '5 3' : kind === 'trend' ? '1 3' : undefined}
        />
      </svg>
    );
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
      {swatch}
      {label}
    </span>
  );
}

function ProjectionChart({
  data,
  scen,
  measure,
  cat,
  gran,
  events,
}: {
  data: AnyForecast;
  scen: Scenario;
  measure: Measure;
  cat: CategoryChoice;
  gran: Granularity;
  events: NationalForecast['events'];
}) {
  const sel = useMemo(() => selectSeries(data, scen, measure, cat, gran), [data, scen, measure, cat, gran]);

  const rows = useMemo(() => {
    return sel.labels.map((label, i) => {
      let p50 = sel.p50[i];
      let p10 = sel.p10[i];
      let p90 = sel.p90[i];
      // Join the forecast onto the last history point so the lines connect.
      if (p50 == null && sel.p50[i + 1] != null && sel.raw[i] != null) {
        p50 = p10 = p90 = sel.raw[i];
      }
      return {
        label,
        raw: sel.raw[i],
        clean: sel.clean?.[i] ?? null,
        trend: sel.trend?.[i] ?? null,
        p50,
        band: p10 != null && p90 != null ? [p10, p90] : null,
      };
    });
  }, [sel]);

  // Carriers entering the data, as markers; every other break is in the table below.
  const markers = useMemo(() => {
    if (gran === 'jaar') return [];
    const seen = new Set<string>();
    return events
      .filter((e) => e.type === 'intro' && e.source === 'register')
      .map((e) => ({ x: gran === 'week' ? e.week : weekMonth(e.week), carrier: e.carrier }))
      .filter((m) => sel.labels.includes(m.x))
      .reduce<{ x: string; label: string }[]>((acc, m) => {
        if (seen.has(m.x)) {
          const existing = acc.find((a) => a.x === m.x);
          if (existing) existing.label += `, ${m.carrier}`;
          return acc;
        }
        seen.add(m.x);
        acc.push({ x: m.x, label: m.carrier });
        return acc;
      }, []);
  }, [events, gran, sel.labels]);

  const title =
    measure === 'locaties' ? 'Unieke locaties' : cat === 'alle' ? 'Pakketpunten' : CATEGORY_LABELS[cat];
  const nowLabel = sel.labels[sel.ff];
  const showClean = sel.clean != null;
  const fit = sel.trend ? sel.fit : null;

  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-base font-semibold text-foreground">
          {title} in {data.naam}, scenario {SCENARIO_LABELS[scen].toLowerCase()}
        </h3>
        <div className="flex flex-wrap gap-4">
          <LegendSwatch kind="raw" label="Gemeten" />
          {showClean && <LegendSwatch kind="clean" label="Gecorrigeerd voor meetbreuken" />}
          {fit && <LegendSwatch kind="trend" label="Regressielijn (OLS)" />}
          <LegendSwatch kind="forecast" label="Prognose (mediaan)" />
          <LegendSwatch kind="band" label="80%-band (P10-P90)" />
        </div>
      </div>
      <div className="relative h-96 mt-4">
        {fit && (
          <TrendBox
            fit={fit}
            title={
              fit.kind === 'log'
                ? 'Regressie op de gecorrigeerde reeks (log-lineair)'
                : 'Regressie op de eigen organische groei'
            }
          />
        )}
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={rows} margin={{ top: 16, right: 16, bottom: 4, left: 8 }}>
            <CartesianGrid vertical={false} stroke="var(--border)" />
            <XAxis
              dataKey="label"
              tick={axisTick}
              tickFormatter={(v: string) => periodLabel(v, gran)}
              minTickGap={24}
              stroke="var(--border)"
            />
            <YAxis tick={axisTick} tickFormatter={(v: number) => nl.format(v)} width={56} stroke="var(--border)" domain={['auto', 'auto']} />
            <Tooltip
              content={({ active, payload, label }) => {
                if (!active || !payload?.length) return null;
                const row = payload[0].payload as (typeof rows)[number];
                return (
                  <div className="bg-popover text-popover-foreground border border-border rounded-md shadow-md px-3 py-2 text-xs">
                    <div className="font-semibold mb-1">{periodLabel(String(label), gran)}</div>
                    {row.raw != null && <div>Gemeten: {fmt(row.raw)}</div>}
                    {row.clean != null && <div>Gecorrigeerd: {fmt(row.clean)}</div>}
                    {row.trend != null && <div className="text-muted-foreground">Lineaire trend: {fmt(row.trend)}</div>}
                    {row.p50 != null && row.raw == null && (
                      <>
                        <div>Prognose: {fmt(row.p50)}</div>
                        {row.band && (
                          <div className="text-muted-foreground">
                            80%-band: {fmt(row.band[0])} - {fmt(row.band[1])}
                          </div>
                        )}
                      </>
                    )}
                  </div>
                );
              }}
            />
            <Area
              dataKey="band"
              stroke="none"
              fill="var(--primary)"
              fillOpacity={0.15}
              isAnimationActive={false}
              connectNulls={false}
            />
            <Line dataKey="raw" stroke="var(--muted-foreground)" strokeWidth={2} dot={false} isAnimationActive={false} connectNulls />
            {fit && (
              <Line dataKey="trend" stroke="var(--muted-foreground)" strokeWidth={1.5} strokeDasharray="1 3" dot={false} isAnimationActive={false} connectNulls />
            )}
            {showClean && (
              <Line dataKey="clean" stroke="var(--primary)" strokeWidth={2} dot={false} isAnimationActive={false} connectNulls />
            )}
            <Line
              dataKey="p50"
              stroke="var(--primary)"
              strokeWidth={2}
              strokeDasharray="6 4"
              dot={false}
              isAnimationActive={false}
              connectNulls={false}
            />
            {nowLabel && (
              <ReferenceLine
                x={nowLabel}
                stroke="var(--subtle-foreground)"
                label={{ value: 'nu', position: 'top', fontSize: 11, fill: 'var(--muted-foreground)' }}
              />
            )}
            {markers.map((m, i) => (
              <ReferenceLine
                key={m.x}
                x={m.x}
                stroke="var(--border)"
                strokeWidth={1.5}
                // Stagger the labels: intros cluster within a few weeks.
                label={(props: { viewBox?: { x: number; y: number } }) => (
                  <text
                    x={(props.viewBox?.x ?? 0) + 4}
                    y={(props.viewBox?.y ?? 0) + 12 + (i % 3) * 13}
                    fontSize={10}
                    fill="var(--subtle-foreground)"
                  >
                    +{m.label}
                  </text>
                )}
              />
            ))}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <p className="mt-2 text-xs text-subtle-foreground">
        {showClean
          ? 'De gecorrigeerde lijn laat zien hoe het totaal zich had ontwikkeld als alle vervoerders vanaf het begin waren gemeten: toetreders tellen als niveau, niet als groei. '
          : 'Voor automaten en bemande punten is de gemeten reeks getoond; de groei is per vervoerder gecorrigeerd en daarna opgeteld. '}
        {fit
          ? fit.kind === 'log'
            ? 'De regressielijn is een rechte lijn door het logaritme van de gecorrigeerde reeks (constante procentuele groei); de prognose zelf is een gedempte trend en buigt daarom af. '
            : 'De regressielijn is een rechte lijn door de eigen organische groei van de gemeente (vast aantal punten per week); de prognose verdeelt de landelijke groei en kan daarvan afwijken. '
          : ''}
        Verticale lijnen markeren vervoerders die aan de data zijn toegevoegd; alle andere meetbreuken staan in de tabel onderaan.
      </p>
    </div>
  );
}

function CarrierChart({
  data,
  scen,
  cat,
  gran,
  palette,
}: {
  data: AnyForecast;
  scen: Scenario;
  cat: CategoryChoice;
  gran: 'maand' | 'jaar';
  palette: Record<Carrier, string>;
}) {
  const series = useMemo(() => carrierSeries(data, scen, cat, gran), [data, scen, cat, gran]);
  const carriers = CARRIER_ORDER.filter((c) => series[c]);
  const labels = data.periods[gran];
  const rows = labels.map((label, i) => {
    const row: Record<string, number | string> = { label };
    for (const c of carriers) row[c] = series[c]![i];
    return row;
  });
  const nowLabel = labels[data.forecast_from[gran]];

  const tooltip = (
    <Tooltip
      content={({ active, payload, label }) => {
        if (!active || !payload?.length) return null;
        const total = payload.reduce((s, p) => s + (Number(p.value) || 0), 0);
        return (
          <div className="bg-popover text-popover-foreground border border-border rounded-md shadow-md px-3 py-2 text-xs">
            <div className="font-semibold mb-1">{periodLabel(String(label), gran)}</div>
            {[...payload].reverse().map((p) => (
              <div key={String(p.dataKey)} className="flex items-center gap-2">
                <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: p.color }} />
                <span className="flex-1">{CARRIER_LABELS[p.dataKey as Carrier]}</span>
                <span className="tabular-nums">{fmt(Number(p.value))}</span>
              </div>
            ))}
            <div className="mt-1 pt-1 border-t border-border flex justify-between font-semibold">
              <span>Totaal</span>
              <span className="tabular-nums">{fmt(total)}</span>
            </div>
          </div>
        );
      }}
    />
  );

  return (
    <div>
      <h3 className="text-base font-semibold text-foreground">
        {CATEGORY_LABELS[cat]} per vervoerder in {data.naam}, scenario {SCENARIO_LABELS[scen].toLowerCase()}
      </h3>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
        {carriers.map((c) => (
          <span key={c} className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className="inline-block w-3 h-3 rounded-sm" style={{ background: palette[c] }} />
            {CARRIER_LABELS[c]}
          </span>
        ))}
      </div>
      <div className="h-96 mt-4">
        <ResponsiveContainer width="100%" height="100%">
          {gran === 'jaar' ? (
            <BarChart data={rows} margin={{ top: 16, right: 16, bottom: 4, left: 8 }} barCategoryGap="30%">
              <CartesianGrid vertical={false} stroke="var(--border)" />
              <XAxis dataKey="label" tick={axisTick} stroke="var(--border)" />
              <YAxis tick={axisTick} tickFormatter={(v: number) => nl.format(v)} width={56} stroke="var(--border)" />
              {tooltip}
              {carriers.map((c, i) => (
                <Bar
                  key={c}
                  dataKey={c}
                  stackId="s"
                  fill={palette[c]}
                  stroke="var(--card)"
                  strokeWidth={1}
                  radius={i === carriers.length - 1 ? [4, 4, 0, 0] : 0}
                  isAnimationActive={false}
                />
              ))}
            </BarChart>
          ) : (
            <AreaChart data={rows} margin={{ top: 16, right: 16, bottom: 4, left: 8 }}>
              <CartesianGrid vertical={false} stroke="var(--border)" />
              <XAxis dataKey="label" tick={axisTick} tickFormatter={(v: string) => periodLabel(v, 'maand')} minTickGap={24} stroke="var(--border)" />
              <YAxis tick={axisTick} tickFormatter={(v: number) => nl.format(v)} width={56} stroke="var(--border)" />
              {tooltip}
              {carriers.map((c) => (
                <Area
                  key={c}
                  dataKey={c}
                  stackId="s"
                  stroke="var(--card)"
                  strokeWidth={1}
                  fill={palette[c]}
                  fillOpacity={0.9}
                  isAnimationActive={false}
                />
              ))}
              {nowLabel && (
                <ReferenceLine
                  x={nowLabel}
                  stroke="var(--foreground)"
                  strokeDasharray="4 3"
                  label={{ value: 'prognose', position: 'insideTopRight', fontSize: 11, fill: 'var(--muted-foreground)' }}
                />
              )}
            </AreaChart>
          )}
        </ResponsiveContainer>
      </div>
      <p className="mt-2 text-xs text-subtle-foreground">
        Historie zoals gemeten (inclusief het moment waarop een vervoerder aan de data werd toegevoegd), daarna de
        mediaanprognose per vervoerder. Snelle groeiers, zoals een nieuwe vervoerder die automaten uitrolt, vlakken in
        het model in ongeveer vier maanden af naar de groei van hun categorie (automaten of bemande punten); een krimpend
        netwerk krimpt ongeveer een jaar door voordat het de markt volgt.
      </p>
    </div>
  );
}

function SharedLocationsChart({
  data,
  scen,
  gran,
  multiFit,
}: {
  data: AnyForecast;
  scen: Scenario;
  gran: Granularity;
  multiFit: OlsFit;
}) {
  const rows = useMemo(() => {
    const labels = data.periods[gran];
    const block = data.scenarios[scen];
    return labels.map((label, i) => {
      const locRaw = data.history.locaties_raw[gran][i];
      const multiRaw = data.history.locaties_multi_raw[gran][i];
      const ptsRaw = data.history.punten_raw[gran][i];
      const locF = block.locaties.stock[gran].p50[i];
      const multiF = block.locaties_multi.stock[gran].p50[i];
      const ptsF = block.punten.stock[gran].p50[i];
      const hist = locRaw != null && locRaw > 0 && multiRaw != null ? (100 * multiRaw) / locRaw : null;
      const fc = locRaw == null && locF != null && locF > 0 && multiF != null ? (100 * multiF) / locF : null;
      const ratio = locRaw ? (ptsRaw ?? 0) / locRaw : locF ? (ptsF ?? 0) / locF : null;
      return { label, hist, fc, ratio };
    });
  }, [data, scen, gran]);
  // Join forecast to the last measured point.
  const joined = rows.map((r, i) => (r.fc == null && rows[i + 1]?.fc != null ? { ...r, fc: r.hist } : r));

  // Weekly (punten per locatie, share) pairs and the regression the forecast moves along.
  const scatter = useMemo(() => {
    const pts = data.history.punten_raw.week;
    const loc = data.history.locaties_raw.week;
    const multi = data.history.locaties_multi_raw.week;
    const measured: { x: number; y: number; week: string }[] = [];
    data.periods.week.forEach((w, i) => {
      if (pts[i] != null && loc[i] && multi[i] != null) measured.push({ x: pts[i]! / loc[i]!, y: (100 * multi[i]!) / loc[i]!, week: w });
    });
    const last = measured[measured.length - 1];
    const yearIdx = data.periods.jaar.indexOf('2030');
    const block = data.scenarios[scen];
    const p2030 = block.punten.stock.jaar.p50[yearIdx];
    const l2030 = block.locaties.stock.jaar.p50[yearIdx];
    const m2030 = block.locaties_multi.stock.jaar.p50[yearIdx];
    const target = p2030 && l2030 && m2030 != null ? { x: p2030 / l2030, y: (100 * m2030) / l2030, week: '2030' } : null;
    // Nationally the line is the fit itself; a gemeente moves from its own point with the national slope.
    const national = isNational(data);
    const lineAt = (x: number) =>
      100 * (national ? multiFit.intercept + multiFit.helling * x : (last ? last.y / 100 : 0) + multiFit.helling * (x - (last?.x ?? x)));
    const xs = [...measured.map((m) => m.x), ...(target ? [target.x] : [])];
    const x0 = Math.min(...xs);
    const x1 = Math.max(...xs);
    const segment: [{ x: number; y: number }, { x: number; y: number }] = [
      { x: x0, y: lineAt(x0) },
      { x: x1, y: lineAt(x1) },
    ];
    return { measured, target, segment, x0, x1, national };
  }, [data, scen, multiFit]);

  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-base font-semibold text-foreground">Gedeelde locaties (white-label) in {data.naam}</h3>
        <div className="flex gap-4">
          <LegendSwatch kind="clean" label="Gemeten" />
          <LegendSwatch kind="forecast" label="Prognose" />
        </div>
      </div>
      <p className="mt-1 text-sm text-muted-foreground max-w-3xl">
        Aandeel fysieke locaties waar twee of meer vervoerders zitten. Een stijging betekent een meer gedeeld en flexibel
        netwerk: dezelfde winkel of kluis bedient meerdere vervoerders.
      </p>
      <div className="mt-3 grid lg:grid-cols-3 gap-6">
      <div className="h-64 lg:col-span-2">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={joined} margin={{ top: 8, right: 16, bottom: 4, left: 8 }}>
            <CartesianGrid vertical={false} stroke="var(--border)" />
            <XAxis dataKey="label" tick={axisTick} tickFormatter={(v: string) => periodLabel(v, gran)} minTickGap={24} stroke="var(--border)" />
            <YAxis tick={axisTick} tickFormatter={(v: number) => `${Math.round(v)}%`} width={44} domain={[0, 100]} stroke="var(--border)" />
            <Tooltip
              content={({ active, payload, label }) => {
                if (!active || !payload?.length) return null;
                const row = payload[0].payload as (typeof rows)[number];
                const v = row.hist ?? row.fc;
                return (
                  <div className="bg-popover text-popover-foreground border border-border rounded-md shadow-md px-3 py-2 text-xs">
                    <div className="font-semibold mb-1">{periodLabel(String(label), gran)}</div>
                    <div>Locaties met 2+ vervoerders: {v != null ? `${nl1.format(v)}%` : '—'}</div>
                    <div>Punten per locatie: {row.ratio != null ? nl2.format(row.ratio) : '—'}</div>
                  </div>
                );
              }}
            />
            <Line dataKey="hist" stroke="var(--primary)" strokeWidth={2} dot={false} isAnimationActive={false} connectNulls />
            <Line dataKey="fc" stroke="var(--primary)" strokeWidth={2} strokeDasharray="6 4" dot={false} isAnimationActive={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <div className="relative h-64">
        <div className="absolute left-14 top-2 z-10 rounded-md border border-border bg-card/90 px-3 py-2 text-[11px] leading-snug text-muted-foreground shadow-sm">
          <div className="font-mono text-foreground">
            aandeel = {nl2.format(multiFit.intercept)} + {nl2.format(multiFit.helling)} x punten/locatie
          </div>
          <div>
            b = {nl2.format(multiFit.helling)} (SE {nl2.format(multiFit.se)}) · R² = {multiFit.r2 != null ? nl2.format(multiFit.r2) : '—'} · n ={' '}
            {multiFit.n} weken
          </div>
          {!scatter.national && <div>Landelijke helling, vanaf het eigen punt van {data.naam}</div>}
        </div>
        <ResponsiveContainer width="100%" height="100%">
          <ScatterChart margin={{ top: 8, right: 16, bottom: 20, left: 8 }}>
            <CartesianGrid stroke="var(--border)" />
            <XAxis
              type="number"
              dataKey="x"
              domain={[Math.floor(scatter.x0 * 20) / 20, Math.ceil(scatter.x1 * 20) / 20]}
              tick={axisTick}
              tickFormatter={(v: number) => nl2.format(v)}
              stroke="var(--border)"
              label={{ value: 'Punten per locatie', position: 'insideBottom', offset: -10, fontSize: 11, fill: 'var(--muted-foreground)' }}
            />
            <YAxis type="number" dataKey="y" tick={axisTick} tickFormatter={(v: number) => `${Math.round(v)}%`} width={44} domain={[0, 100]} stroke="var(--border)" />
            <Tooltip
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const p = payload[0].payload as { x: number; y: number; week: string };
                return (
                  <div className="bg-popover text-popover-foreground border border-border rounded-md shadow-md px-3 py-2 text-xs">
                    <div className="font-semibold">{p.week === '2030' ? 'Prognose eind 2030' : p.week.replace('-W', ' week ')}</div>
                    <div>Punten per locatie: {nl2.format(p.x)}</div>
                    <div>Locaties met 2+ vervoerders: {nl1.format(p.y)}%</div>
                  </div>
                );
              }}
            />
            <ReferenceLine segment={scatter.segment} stroke="var(--muted-foreground)" strokeWidth={1.5} strokeDasharray="1 3" ifOverflow="extendDomain" />
            <Scatter data={scatter.measured} fill="var(--primary)" fillOpacity={0.6} isAnimationActive={false} />
            {scatter.target && (
              <Scatter data={[scatter.target]} fill="var(--card)" stroke="var(--primary)" strokeWidth={2} isAnimationActive={false} />
            )}
          </ScatterChart>
        </ResponsiveContainer>
        <p className="-mt-1 text-[11px] text-subtle-foreground">Stippen: gemeten weken. Open stip: prognose eind 2030.</p>
      </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ growth table */

function GrowthTable({
  data,
  scen,
  cat,
  palette,
}: {
  data: AnyForecast;
  scen: Scenario;
  cat: CategoryChoice;
  palette: Record<Carrier, string>;
}) {
  const [mode, setMode] = useState<'groei' | 'voorraad'>('groei');
  const [openYear, setOpenYear] = useState<string | null>(null);

  const years = data.periods.jaar;
  const ffMonth = data.forecast_from.maand;
  const yearCols = years.filter((y) => Number(y) >= Number(data.last_week.slice(0, 4)));
  const series = useMemo(() => carrierSeries(data, scen, cat, 'jaar'), [data, scen, cat]);
  const monthSeries = useMemo(() => carrierSeries(data, scen, cat, 'maand'), [data, scen, cat]);
  const carriers = CARRIER_ORDER.filter((c) => series[c]);

  const block = data.scenarios[scen];
  const totalStock = cat === 'alle' ? block.punten.stock : block.categorie[cat].stock;
  const totalHist = cat === 'alle' ? data.history.punten_raw : data.history.categorie_raw[cat];
  const yearTotal = years.map((_, i) => totalStock.jaar.p50[i] ?? totalHist.jaar[i]);
  const monthTotal = data.periods.maand.map((_, i) => totalStock.maand.p50[i] ?? totalHist.maand[i]);
  const nowTotal = monthTotal[ffMonth];

  const cell = (arr: (number | null)[], i: number) => {
    const yi = years.indexOf(yearCols[i]);
    if (mode === 'voorraad') return arr[yi];
    // 2026 growth runs from now; later years from the previous year end.
    const prev = i === 0 ? null : arr[yi - 1];
    return prev == null ? null : (arr[yi] ?? 0) - prev;
  };

  const nowFor = (c: Carrier) => monthSeries[c]?.[ffMonth] ?? 0;
  const growthNow = (arr: (number | null)[], now: number | null) => {
    const end = arr[years.indexOf('2030')];
    return end != null && now != null ? end - now : null;
  };

  // Month grid: net change per month of the selected scenario total.
  const monthsByYear = useMemo(() => {
    const out: Record<string, { label: string; v: number | null }[]> = {};
    data.periods.maand.forEach((label, i) => {
      if (i <= ffMonth) return;
      const y = label.slice(0, 4);
      const prev = monthTotal[i - 1];
      const cur = monthTotal[i];
      (out[y] ??= []).push({ label, v: prev != null && cur != null ? cur - prev : null });
    });
    return out;
  }, [data, ffMonth, monthTotal]);

  const exportCsv = () => {
    const header = ['vervoerder', 'nu', ...yearCols.map((y) => `eind ${y}`), 'groei nu-2030'];
    const rows: (string | number | null)[][] = [header];
    for (const c of carriers) {
      const arr = series[c]!;
      rows.push([CARRIER_LABELS[c], nowFor(c), ...yearCols.map((y) => arr[years.indexOf(y)]), growthNow(arr, nowFor(c))]);
    }
    rows.push(['Totaal', nowTotal, ...yearCols.map((y) => yearTotal[years.indexOf(y)]), growthNow(yearTotal, nowTotal)]);
    rows.push([]);
    rows.push(['maand', 'netto groei']);
    for (const [, months] of Object.entries(monthsByYear)) for (const m of months) rows.push([m.label, m.v]);
    downloadCsv(`prognose_${data.slug}_${scen}_${cat}.csv`, rows);
  };

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-foreground">
            {mode === 'groei' ? 'Netto groei' : 'Aantal'} per jaar en vervoerder ({CATEGORY_LABELS[cat].toLowerCase()})
          </h3>
          <p className="text-xs text-subtle-foreground mt-0.5">
            Scenario {SCENARIO_LABELS[scen].toLowerCase()}, mediaan. {yearCols[0]} telt vanaf nu ({data.last_week.replace('-W', ' wk ')}).
          </p>
        </div>
        <div className="flex items-end gap-3">
          <SegControl
            label="Toon"
            value={mode}
            onChange={setMode}
            options={[
              { value: 'groei', label: 'Netto groei' },
              { value: 'voorraad', label: 'Aantal eind jaar' },
            ]}
          />
          <button
            type="button"
            onClick={exportCsv}
            className="px-3 py-2 text-xs font-medium border border-input bg-card text-muted-foreground rounded-lg hover:bg-secondary transition"
          >
            CSV
          </button>
        </div>
      </div>

      <div className="mt-4 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-muted-foreground border-b border-border">
              <th className="py-2 pr-4 font-medium">Vervoerder</th>
              <th className="py-2 px-2 font-medium text-right">Nu</th>
              {yearCols.map((y) => (
                <th key={y} className="py-2 px-2 font-medium text-right">
                  {y}
                </th>
              ))}
              <th className="py-2 pl-2 font-medium text-right">Groei nu - 2030</th>
            </tr>
          </thead>
          <tbody>
            {carriers.map((c) => {
              const arr = series[c]!;
              const first = mode === 'groei' ? (arr[years.indexOf(yearCols[0])] ?? 0) - nowFor(c) : null;
              return (
                <tr key={c} className="border-b border-border/60">
                  <td className="py-1.5 pr-4">
                    <span className="inline-flex items-center gap-2">
                      <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: palette[c] }} />
                      {CARRIER_LABELS[c]}
                    </span>
                  </td>
                  <td className="py-1.5 px-2 text-right tabular-nums">{fmt(nowFor(c))}</td>
                  {yearCols.map((y, i) => (
                    <td key={y} className="py-1.5 px-2 text-right tabular-nums">
                      {mode === 'groei' ? signed(i === 0 ? first : cell(arr, i)) : fmt(cell(arr, i))}
                    </td>
                  ))}
                  <td className="py-1.5 pl-2 text-right tabular-nums font-medium">{signed(growthNow(arr, nowFor(c)))}</td>
                </tr>
              );
            })}
            <tr className="font-semibold">
              <td className="py-2 pr-4">Totaal</td>
              <td className="py-2 px-2 text-right tabular-nums">{fmt(nowTotal)}</td>
              {yearCols.map((y, i) => (
                <td key={y} className="py-2 px-2 text-right tabular-nums">
                  {mode === 'groei'
                    ? signed(i === 0 ? (yearTotal[years.indexOf(y)] ?? 0) - (nowTotal ?? 0) : cell(yearTotal, i))
                    : fmt(cell(yearTotal, i))}
                </td>
              ))}
              <td className="py-2 pl-2 text-right tabular-nums">{signed(growthNow(yearTotal, nowTotal))}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-subtle-foreground">
        Per vervoerder: het gemiddelde over de gesimuleerde toekomsten waarin het totaal rond de mediaan uitkomt, zodat de
        vervoerders optellen tot het totaal (afrondingsverschillen daargelaten).
      </p>

      <div className="mt-5">
        <h4 className="text-sm font-semibold text-foreground">Netto groei per maand (totaal)</h4>
        <div className="mt-2 flex flex-wrap gap-2">
          {Object.keys(monthsByYear).map((y) => (
            <button
              key={y}
              type="button"
              onClick={() => setOpenYear(openYear === y ? null : y)}
              aria-expanded={openYear === y}
              className={`px-3 py-1.5 text-xs font-medium rounded-md border ${
                openYear === y ? 'border-primary text-primary bg-primary/10' : 'border-input text-muted-foreground hover:bg-secondary'
              }`}
            >
              {y}
            </button>
          ))}
        </div>
        {openYear && (
          <div className="mt-3 grid grid-cols-3 sm:grid-cols-6 lg:grid-cols-12 gap-2">
            {monthsByYear[openYear].map((m) => (
              <div key={m.label} className="border border-border rounded-md p-2 text-center">
                <div className="text-[11px] text-muted-foreground">{periodLabel(m.label, 'maand')}</div>
                <div className="text-sm font-semibold tabular-nums text-foreground">{signed(m.v)}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ placement */

const STEDELIJKHEID: Record<string, string> = {
  '1': 'Zeer sterk stedelijk',
  '2': 'Sterk stedelijk',
  '3': 'Matig stedelijk',
  '4': 'Weinig stedelijk',
  '5': 'Niet stedelijk',
  alle: 'Nederland',
};

function TerrainBadge({ terrain }: { terrain: 'publiek' | 'privaat' | 'onbekend' }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs">
      <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: EIGENDOM_COLOURS[terrain] }} />
      {EIGENDOM_LABELS[terrain]}
    </span>
  );
}

function PlacementSection({ slug, naam }: { slug: string; naam: string }) {
  const [index, setIndex] = useState<ForecastPlacementsIndex | null>(null);
  const [files, setFiles] = useState<Record<string, ForecastPlacements | 'missing'>>({});
  const [choice, setChoice] = useState<EigendomChoice>('mix');
  const [selected, setSelected] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch('/data/forecast_placements/index.json')
      .then((r) => (r.ok ? r.json() : null))
      .then((payload) => !cancelled && setIndex(payload))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (slug === 'nederland' || files[slug]) return;
    let cancelled = false;
    fetch(`/data/forecast_placements/${slug}.json`)
      .then((r) => (r.ok ? r.json() : 'missing'))
      .then((payload) => !cancelled && setFiles((prev) => ({ ...prev, [slug]: payload })))
      .catch(() => !cancelled && setFiles((prev) => ({ ...prev, [slug]: 'missing' })));
    return () => {
      cancelled = true;
    };
  }, [slug, files]);

  if (!index) {
    return (
      <div>
        <h3 className="text-base font-semibold text-foreground">Waar landt de groei?</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Nog geen plaatsingsprognose. Run <code className="bg-secondary px-1 rounded">python scripts/forecast_placements.py</code>.
        </p>
      </div>
    );
  }

  const nat = index.national;
  const intro = (
    <p className="mt-1 text-sm text-muted-foreground max-w-4xl">
      Nieuwe punten komen op drie manieren bij: een extra vervoerder op een bestaande locatie, een nieuwe locatie in
      gebied dat al binnen 400 m van een punt ligt (verdichting), of een nieuwe locatie in een witte vlek. Hoeveel punten
      op bestaande locaties bijkomen, volgt uit de prognose van punten en van unieke locaties; welk deel van de nieuwe
      locaties in een witte vlek valt, volgt wat vervoerders het afgelopen jaar werkelijk deden. Witte-vlekplekken komen uit het plaatsingsadvies en
      krijgen een terreinlabel: is er een private locatie (winkel of ander bedrijf), of is alleen openbare grond over?
    </p>
  );

  if (slug === 'nederland') {
    const top = [...index.gemeenten]
      .filter((g) => g.privaat_niet_invulbaar > 0)
      .sort((a, b) => b.privaat_niet_invulbaar - a.privaat_niet_invulbaar)
      .slice(0, 12);
    return (
      <div>
        <h3 className="text-base font-semibold text-foreground">Waar landt de groei tot en met 2030?</h3>
        {intro}
        <div className="mt-4 grid grid-cols-2 lg:grid-cols-5 gap-4">
          <Tile label="Nieuwe locaties (midden)" value={fmt(nat.nieuwe_locaties)} sub={`plus ${fmt(nat.co_locatie)} extra vervoerders op bestaande locaties`} />
          <Tile label="Verdichting" value={fmt(nat.verdichting)} sub="nieuwe locaties in al bediend gebied" />
          <Tile label="Witte vlek" value={fmt(nat.witte_vlek)} sub={`${fmt(nat.plekken)} concrete plekken gevonden`} />
          <Tile
            label="Alleen publieke grond"
            value={nat.aandeel_publiek_nodig_pct != null ? `${nl1.format(nat.aandeel_publiek_nodig_pct)}%` : '—'}
            sub={`${fmt(nat.privaat_niet_invulbaar)} witte-vlekplekken zonder private locatie`}
          />
          <Tile label="Witte vlek zonder plek" value={fmt(nat.witte_vlek_zonder_plek)} sub="verwachte groei waarvoor het advies geen plek meer heeft" />
        </div>
        <div className="mt-6 grid lg:grid-cols-2 gap-6">
          <div>
            <h4 className="text-sm font-semibold text-foreground">Waar nieuwe punten het afgelopen jaar landden</h4>
            <table className="mt-2 w-full text-sm">
              <thead>
                <tr className="text-xs text-muted-foreground border-b border-border">
                  <th className="py-1.5 text-left font-medium">Stedelijkheid</th>
                  <th className="py-1.5 text-right font-medium">Co-locatie</th>
                  <th className="py-1.5 text-right font-medium">Verdichting</th>
                  <th className="py-1.5 text-right font-medium">Witte vlek</th>
                  <th className="py-1.5 text-right font-medium">Aandeel witte vlek</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(index.landing)
                  .filter(([k]) => k !== 'None')
                  .map(([k, v]) => (
                    <tr key={k} className={`border-b border-border/60 ${k === 'alle' ? 'font-semibold' : ''}`}>
                      <td className="py-1.5">{STEDELIJKHEID[k] ?? k}</td>
                      <td className="py-1.5 text-right tabular-nums">{fmt(v.co_locatie)}</td>
                      <td className="py-1.5 text-right tabular-nums">{fmt(v.verdichting)}</td>
                      <td className="py-1.5 text-right tabular-nums">{fmt(v.witte_vlek)}</td>
                      <td className="py-1.5 text-right tabular-nums">{nl1.format(v.aandeel_witte_vlek_pct)}%</td>
                    </tr>
                  ))}
              </tbody>
            </table>
            <p className="mt-2 text-xs text-subtle-foreground">
              Aandeel witte vlek = deel van de nieuwe locaties dat verder dan 400 m van het bestaande netwerk ligt. Toetreding
              van vervoerders en ophaalbreuken zijn niet meegeteld.
            </p>
          </div>
          <div>
            <h4 className="text-sm font-semibold text-foreground">Meeste witte-vlekplekken zonder private locatie</h4>
            <table className="mt-2 w-full text-sm">
              <thead>
                <tr className="text-xs text-muted-foreground border-b border-border">
                  <th className="py-1.5 text-left font-medium">Gemeente</th>
                  <th className="py-1.5 text-right font-medium">Plekken</th>
                  <th className="py-1.5 text-right font-medium">Alleen publiek</th>
                  <th className="py-1.5 text-right font-medium">Aandeel</th>
                </tr>
              </thead>
              <tbody>
                {top.map((g) => (
                  <tr key={g.slug} className="border-b border-border/60">
                    <td className="py-1.5">{g.naam}</td>
                    <td className="py-1.5 text-right tabular-nums">{fmt(g.plekken)}</td>
                    <td className="py-1.5 text-right tabular-nums">{fmt(g.privaat_niet_invulbaar)}</td>
                    <td className="py-1.5 text-right tabular-nums">
                      {g.aandeel_publiek_nodig_pct != null ? `${nl1.format(g.aandeel_publiek_nodig_pct)}%` : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-2 text-xs text-subtle-foreground">Kies een gemeente bovenaan de pagina voor de kaart met plekken.</p>
          </div>
        </div>
      </div>
    );
  }

  const file = files[slug];
  if (!file) return <p className="text-sm text-muted-foreground">Plaatsingsprognose laden...</p>;
  if (file === 'missing') {
    return (
      <div>
        <h3 className="text-base font-semibold text-foreground">Waar landt de groei in {naam}?</h3>
        <p className="mt-1 text-sm text-muted-foreground">Voor deze gemeente is geen plaatsingsprognose beschikbaar.</p>
      </div>
    );
  }

  const counts = {
    mix: file.picks.length,
    privaat: file.picks.filter((p) => p.privaat).length,
    publiek: file.picks.filter((p) => p.publiek).length,
  };
  const visible = file.picks.filter((p) => locatePick(p, choice) != null);
  const densTop = Object.entries(
    file.densification.reduce<Record<string, number>>((acc, d) => ({ ...acc, [d.pc4]: (acc[d.pc4] ?? 0) + d.count }), {}),
  )
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8);

  return (
    <div>
      <h3 className="text-base font-semibold text-foreground">Waar landt de groei in {file.naam}?</h3>
      {intro}
      <div className="mt-4 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-xs text-muted-foreground border-b border-border">
              <th className="py-1.5 text-left font-medium">Jaar</th>
              <th className="py-1.5 text-right font-medium">Nieuwe punten</th>
              <th className="py-1.5 text-right font-medium">Extra vervoerder op bestaande locatie</th>
              <th className="py-1.5 text-right font-medium">Nieuwe locaties</th>
              <th className="py-1.5 text-right font-medium">waarvan verdichting</th>
              <th className="py-1.5 text-right font-medium">waarvan witte vlek</th>
              <th className="py-1.5 text-right font-medium">Witte vlek zonder plek</th>
            </tr>
          </thead>
          <tbody>
            {file.years.map((y) => (
              <tr key={y.year} className="border-b border-border/60">
                <td className="py-1.5">{y.year}</td>
                <td className="py-1.5 text-right tabular-nums">{signed(y.nieuwe_punten)}</td>
                <td className="py-1.5 text-right tabular-nums">{fmt(y.co_locatie)}</td>
                <td className="py-1.5 text-right tabular-nums">{fmt(y.nieuwe_locaties)}</td>
                <td className="py-1.5 text-right tabular-nums">{fmt(y.verdichting)}</td>
                <td className="py-1.5 text-right tabular-nums">{fmt(y.witte_vlek)}</td>
                <td className="py-1.5 text-right tabular-nums">{fmt(y.witte_vlek_zonder_plek)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-1 text-xs text-subtle-foreground">
          Scenario midden. Aandeel witte vlek voor dit type gemeente: {nl1.format(file.aandeel_witte_vlek_pct)}% van de nieuwe locaties.
        </p>
      </div>

      <div className="mt-5 flex flex-wrap items-end justify-between gap-3">
        <SegControl
          label="Locaties"
          value={choice}
          onChange={(v) => {
            setChoice(v);
            setSelected(null);
          }}
          options={[
            { value: 'mix', label: `Publiek + privaat (${counts.mix})` },
            { value: 'privaat', label: `Privaat terrein (${counts.privaat})` },
            { value: 'publiek', label: `Publiek terrein (${counts.publiek})` },
          ]}
        />
        <div className="flex flex-wrap gap-4">
          <TerrainBadge terrain="privaat" />
          <TerrainBadge terrain="publiek" />
          <TerrainBadge terrain="onbekend" />
          <span className="inline-flex items-center gap-1.5 text-xs">
            <span className="inline-block w-3 h-3 rounded-full border border-dashed" style={{ borderColor: EIGENDOM_COLOURS.publiek }} />
            witte vlek zonder private locatie
          </span>
        </div>
      </div>
      {!file.poi_terrein_beschikbaar && (
        <p className="mt-2 text-xs text-warning">
          De voorzieningen in deze gemeente hebben nog geen terreinlabel; publieke alternatieven komen dan alleen uit de BGT.
        </p>
      )}
      <div className="mt-3">
        {file.picks.length > 0 ? (
          <ForecastMap slug={slug} picks={file.picks} choice={choice} selected={selected} onSelect={setSelected} />
        ) : (
          <p className="text-sm text-muted-foreground">
            Geen witte-vlekplekken verwacht tot en met 2030: de groei hier is verdichting of een extra vervoerder op een bestaande locatie.
          </p>
        )}
      </div>
      <p className="mt-2 text-xs text-subtle-foreground">
        Grijze stippen zijn de huidige punten. Elke gekleurde plek is een verwachte nieuwe locatie in een witte vlek, met het
        verwachte jaar erin. Terrein is een classificatie van de grond (OSM, categorie en BGT, zoals in de
        inleverpuntenviewer), geen juridisch eigendom: de eigenaar staat niet open in het Kadaster.
      </p>

      <div className="mt-5 grid lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 overflow-x-auto max-h-96">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-card">
              <tr className="text-xs text-muted-foreground border-b border-border">
                <th className="py-1.5 pr-2 text-left font-medium">Plek</th>
                <th className="py-1.5 pr-2 text-left font-medium">Jaar</th>
                <th className="py-1.5 pr-2 text-left font-medium">PC4</th>
                <th className="py-1.5 pr-2 text-left font-medium">Terrein</th>
                <th className="py-1.5 pr-2 text-left font-medium">Locatie</th>
                <th className="py-1.5 text-right font-medium">Nieuwe inwoners</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((p) => {
                const l = locatePick(p, choice)!;
                return (
                  <tr
                    key={p.rank}
                    onClick={() => setSelected(p.rank)}
                    className={`border-b border-border/60 cursor-pointer hover:bg-secondary ${selected === p.rank ? 'bg-accent' : ''}`}
                  >
                    <td className="py-1.5 pr-2 tabular-nums">{p.rank}</td>
                    <td className="py-1.5 pr-2">{p.year}</td>
                    <td className="py-1.5 pr-2">{p.pc4}</td>
                    <td className="py-1.5 pr-2 whitespace-nowrap">
                      <TerrainBadge terrain={l.terrain} />
                    </td>
                    <td className="py-1.5 pr-2 text-muted-foreground">{l.host?.bron ?? p.terrein_bron}</td>
                    <td className="py-1.5 text-right tabular-nums">{fmt(p.est_new_pop_within_400m)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div>
          <h4 className="text-sm font-semibold text-foreground">Verdichting: meest verwachte PC4-gebieden</h4>
          <p className="mt-1 text-xs text-subtle-foreground">
            Nieuwe locaties in al bediend gebied, verdeeld naar onderbediening (verwacht minus werkelijk aantal punten).
          </p>
          <table className="mt-2 w-full text-sm">
            <tbody>
              {densTop.map(([pc4, n]) => (
                <tr key={pc4} className="border-b border-border/60">
                  <td className="py-1.5">{pc4}</td>
                  <td className="py-1.5 text-right tabular-nums">{fmt(n)} tot en met 2030</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ ranking */

type SortKey = 'naam' | 'nu' | 'y2030' | 'groei_2030' | 'groei_pct' | 'groei_locaties_2030' | 'ppl' | 'betrouwbaarheid';
const RELIABILITY_ORDER: Record<Betrouwbaarheid, number> = { hoog: 0, middel: 1, laag: 2 };

function RankingTable({
  rows,
  onSelect,
  selected,
}: {
  rows: ForecastIndexRow[];
  onSelect: (slug: string) => void;
  selected: string;
}) {
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'groei_2030', dir: -1 });
  const [showLow, setShowLow] = useState(false);
  const [query, setQuery] = useState('');
  const [showAll, setShowAll] = useState(false);

  const value = (r: ForecastIndexRow, key: SortKey): number | string => {
    switch (key) {
      case 'naam':
        return r.naam;
      case 'groei_pct':
        return r.nu > 0 ? r.groei_2030 / r.nu : 0;
      case 'ppl':
        return r.punten_per_locatie_2030 - r.punten_per_locatie_nu;
      case 'betrouwbaarheid':
        return RELIABILITY_ORDER[r.betrouwbaarheid];
      default:
        return r[key];
    }
  };

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows
      .filter((r) => showLow || r.betrouwbaarheid !== 'laag')
      .filter((r) => !q || r.naam.toLowerCase().includes(q) || r.provincie.toLowerCase().includes(q))
      .sort((a, b) => {
        const va = value(a, sort.key);
        const vb = value(b, sort.key);
        if (typeof va === 'string' && typeof vb === 'string') return va.localeCompare(vb) * sort.dir;
        return ((va as number) - (vb as number)) * sort.dir;
      });
  }, [rows, sort, showLow, query]);

  const visible = showAll ? filtered : filtered.slice(0, 25);
  const hiddenLow = rows.filter((r) => r.betrouwbaarheid === 'laag').length;

  const header = (key: SortKey, label: string, right = true) => (
    <th className={`py-2 px-2 font-medium ${right ? 'text-right' : 'text-left'}`}>
      <button
        type="button"
        onClick={() => setSort((s) => ({ key, dir: s.key === key ? ((-s.dir) as 1 | -1) : key === 'naam' ? 1 : -1 }))}
        className="hover:text-foreground"
      >
        {label}
        {sort.key === key ? (sort.dir === 1 ? ' ▲' : ' ▼') : ''}
      </button>
    </th>
  );

  const exportCsv = () => {
    downloadCsv('prognose_gemeenten.csv', [
      ['gemeente', 'provincie', 'punten nu', 'punten 2030 midden', 'laag', 'hoog', 'groei', 'locaties nu', 'locaties 2030', 'punten per locatie nu', 'punten per locatie 2030', 'betrouwbaarheid', 'aandeel eigen data', 'terugtoets fout %'],
      ...filtered.map((r) => [
        r.naam, r.provincie, r.nu, r.y2030, r.y2030_laag, r.y2030_hoog, r.groei_2030, r.locaties_nu, r.locaties_2030,
        r.punten_per_locatie_nu, r.punten_per_locatie_2030, r.betrouwbaarheid, r.shrinkage_weight, r.backtest_fout_pct,
      ]),
    ]);
  };

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-foreground">Gemeenten: verwachte groei tot en met 2030</h3>
          <p className="text-xs text-subtle-foreground mt-0.5">
            Scenario midden. Klik op een gemeente om haar prognose hierboven te openen.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Zoek gemeente of provincie"
            className="px-3 py-1.5 text-sm border border-input rounded-md bg-card text-foreground"
          />
          <label className="inline-flex items-center gap-2 text-sm text-muted-foreground">
            <input type="checkbox" checked={showLow} onChange={(e) => setShowLow(e.target.checked)} />
            Toon lage betrouwbaarheid ({hiddenLow})
          </label>
          <button
            type="button"
            onClick={exportCsv}
            className="px-3 py-2 text-xs font-medium border border-input bg-card text-muted-foreground rounded-lg hover:bg-secondary transition"
          >
            CSV
          </button>
        </div>
      </div>
      <div className="mt-4 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-xs text-muted-foreground border-b border-border">
              {header('naam', 'Gemeente', false)}
              {header('nu', 'Nu')}
              {header('y2030', '2030')}
              {header('groei_2030', 'Groei')}
              {header('groei_pct', 'Groei %')}
              {header('groei_locaties_2030', 'Locaties nu - 2030')}
              {header('ppl', 'Punten/locatie')}
              {header('betrouwbaarheid', 'Betrouwbaarheid')}
            </tr>
          </thead>
          <tbody>
            {visible.map((r) => (
              <tr
                key={r.slug}
                onClick={() => {
                  onSelect(r.slug);
                  window.scrollTo({ top: 0, behavior: 'smooth' });
                }}
                className={`border-b border-border/60 cursor-pointer hover:bg-secondary ${selected === r.slug ? 'bg-accent' : ''}`}
              >
                <td className="py-1.5 px-2">
                  <div className="font-medium text-foreground">{r.naam}</div>
                  <div className="text-[11px] text-subtle-foreground">{r.provincie}</div>
                </td>
                <td className="py-1.5 px-2 text-right tabular-nums">{fmt(r.nu)}</td>
                <td className="py-1.5 px-2 text-right tabular-nums">
                  {fmt(r.y2030)}
                  <div className="text-[11px] text-subtle-foreground">
                    {fmt(r.y2030_laag)} - {fmt(r.y2030_hoog)}
                  </div>
                </td>
                <td className="py-1.5 px-2 text-right tabular-nums">{signed(r.groei_2030)}</td>
                <td className="py-1.5 px-2 text-right tabular-nums">
                  {r.nu > 0 ? `${nl1.format((100 * r.groei_2030) / r.nu)}%` : '—'}
                </td>
                <td className="py-1.5 px-2 text-right tabular-nums">
                  {fmt(r.locaties_nu)} - {fmt(r.locaties_2030)}
                </td>
                <td className="py-1.5 px-2 text-right tabular-nums">
                  {nl2.format(r.punten_per_locatie_nu)} - {nl2.format(r.punten_per_locatie_2030)}
                </td>
                <td className="py-1.5 px-2 text-right">
                  <span className={`inline-block px-1.5 py-px text-[11px] font-semibold rounded border ${RELIABILITY_STYLE[r.betrouwbaarheid]}`}>
                    {r.betrouwbaarheid}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {filtered.length > 25 && (
        <button
          type="button"
          onClick={() => setShowAll((v) => !v)}
          className="mt-3 text-sm font-medium text-primary hover:underline"
        >
          {showAll ? 'Toon top 25' : `Toon alle ${filtered.length} gemeenten`}
        </button>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ regressions */

type RegSortKey = 'standaard' | 'vervoerder' | 'categorie' | 'tempo' | 'pct' | 'w13' | 'r2' | 'n' | 'model' | 'schoon';

function RegressionTable({ national }: { national: NationalForecast }) {
  const reg = national.regressies;
  const multi = reg.multi_vs_ratio;
  const [sort, setSort] = useState<{ key: RegSortKey; dir: 1 | -1 }>({ key: 'standaard', dir: 1 });
  const [catFilter, setCatFilter] = useState<CategoryChoice>('alle');
  const [carrierFilter, setCarrierFilter] = useState<Carrier | 'alle'>('alle');
  const allRows = CARRIER_ORDER.flatMap((c) =>
    (['locker', 'shop'] as Category[])
      .map((k) => ({
        c,
        k,
        ols: reg.per_reeks[`${c}|${k}`],
        fit: national.fits[`${c}|${k}`],
        model: reg.model_komend_jaar?.[`${c}|${k}`],
      }))
      .filter((r) => r.ols || r.fit),
  );
  type Row = (typeof allRows)[number];
  const sortValue = (r: Row, key: RegSortKey): number | string | null => {
    switch (key) {
      case 'vervoerder':
        return CARRIER_LABELS[r.c];
      case 'categorie':
        return r.k === 'locker' ? 'automaat' : 'bemand punt';
      case 'tempo':
        return r.ols?.toename_per_jaar ?? null;
      case 'pct':
        return r.ols?.toename_per_jaar_pct ?? null;
      case 'w13':
        return r.ols?.toename_13w_per_jaar_pct ?? null;
      case 'r2':
        return r.ols?.r2 ?? null;
      case 'n':
        return r.ols?.n ?? null;
      case 'model':
        return r.model?.punten ?? null;
      case 'schoon':
        return r.fit?.n_obs ?? null;
      default:
        return null;
    }
  };
  const rows = allRows
    .filter((r) => catFilter === 'alle' || r.k === catFilter)
    .filter((r) => carrierFilter === 'alle' || r.c === carrierFilter)
    .map((r, i) => ({ r, i }))
    .sort((a, b) => {
      if (sort.key === 'standaard') return a.i - b.i;
      const va = sortValue(a.r, sort.key);
      const vb = sortValue(b.r, sort.key);
      // Empty cells last in both directions.
      if (va == null || vb == null) return va == null ? (vb == null ? a.i - b.i : 1) : -1;
      const d = typeof va === 'string' ? va.localeCompare(String(vb), 'nl') : va - (vb as number);
      return d * sort.dir || a.i - b.i;
    })
    .map(({ r }) => r);
  const carriersInTable = CARRIER_ORDER.filter((c) => allRows.some((r) => r.c === c));
  const header = (key: RegSortKey, label: string, cls: string) => {
    const text = key === 'vervoerder' || key === 'categorie';
    const active = sort.key === key;
    return (
      <th className={`${cls} font-medium`} aria-sort={active ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'}>
        <button
          type="button"
          onClick={() =>
            setSort((s) => ({ key, dir: s.key === key ? ((-s.dir) as 1 | -1) : text ? 1 : -1 }))
          }
          className={`hover:text-foreground ${active ? 'text-foreground' : ''}`}
          title={text ? 'Sorteer A-Z / Z-A' : 'Sorteer hoog-laag / laag-hoog'}
        >
          {label}
          {active ? (sort.dir === 1 ? ' ▲' : ' ▼') : ''}
        </button>
      </th>
    );
  };
  // Round first, so -0.04 shows as 0,0% instead of +-0,0%.
  const pct = (v: number | undefined) => {
    if (v == null) return '—';
    const r = Math.round(v * 10) / 10 || 0;
    return `${r > 0 ? '+' : ''}${nl1.format(r)}%`;
  };

  return (
    <div>
      <h4 className="text-sm font-semibold text-foreground">Regressies en modelparameters</h4>
      <p className="mt-1 text-xs text-subtle-foreground max-w-4xl">
        De prognose zelf is geen regressie maar een gedempte trend (Holt / ETS) per vervoerder en categorie. Ter vergelijking
        staat hier voor het totaal een lineaire regressie van log(aantal) op de week, op de voor meetbreuken gecorrigeerde
        reeks. Per vervoerder is dat een regressie van het aantal zelf op de week: het huidige tempo in punten erbij per jaar,
        ook als percentage van nu. Een samengestelde jaargroei zegt niets bij een vervoerder die net begint (InPost-automaten:
        van 7 naar ruim 350 in een half jaar). Daarnaast staat wat het model zelf de komende 52 weken verwacht.
      </p>
      <div className="mt-3 grid md:grid-cols-3 gap-3">
        <div className="border border-border rounded-lg p-3">
          <div className="text-xs text-muted-foreground">Totaal, lineaire trend op log(punten)</div>
          <div className="mt-0.5 text-lg font-semibold tabular-nums">{pct(reg.totaal.groei_per_jaar_pct)} per jaar</div>
          <div className="text-[11px] text-subtle-foreground">
            95%: {pct(reg.totaal.groei_per_jaar_95?.[0])} tot {pct(reg.totaal.groei_per_jaar_95?.[1])} · R²{' '}
            {nl2.format(reg.totaal.r2 ?? 0)} · n = {reg.totaal.n} weken · helling {nl2.format(reg.totaal.helling * 100)}%/wk (SE{' '}
            {nl2.format(reg.totaal.se * 100)})
          </div>
        </div>
        {reg.locaties && (
          <div className="border border-border rounded-lg p-3">
            <div className="text-xs text-muted-foreground">Unieke locaties, lineaire trend op log(locaties)</div>
            <div className="mt-0.5 text-lg font-semibold tabular-nums">{pct(reg.locaties.groei_per_jaar_pct)} per jaar</div>
            <div className="text-[11px] text-subtle-foreground">
              95%: {pct(reg.locaties.groei_per_jaar_95?.[0])} tot {pct(reg.locaties.groei_per_jaar_95?.[1])} · R²{' '}
              {nl2.format(reg.locaties.r2 ?? 0)} · n = {reg.locaties.n} weken
            </div>
          </div>
        )}
        <div className="border border-border rounded-lg p-3">
          <div className="text-xs text-muted-foreground">Gedeelde locaties = a + b x punten per locatie</div>
          <div className="mt-0.5 text-lg font-semibold tabular-nums">
            b = {nl2.format(multi.helling)} <span className="text-sm font-normal">(SE {nl2.format(multi.se)})</span>
          </div>
          <div className="text-[11px] text-subtle-foreground">
            a = {nl2.format(multi.intercept)} · R² {nl2.format(multi.r2 ?? 0)} · n = {multi.n} weken. Deze regressie stuurt de
            prognose van het aandeel locaties met 2+ vervoerders.
          </div>
        </div>
      </div>
      <div className="mt-4 flex flex-wrap items-end gap-4">
        <SegControl
          label="Categorie"
          value={catFilter}
          onChange={setCatFilter}
          options={[
            { value: 'alle', label: 'Alle' },
            { value: 'locker', label: 'Automaat' },
            { value: 'shop', label: 'Bemand punt' },
          ]}
        />
        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-medium uppercase tracking-wide text-subtle-foreground">Vervoerder</span>
          <select
            value={carrierFilter}
            onChange={(e) => setCarrierFilter(e.target.value as Carrier | 'alle')}
            className="px-3 py-2 text-sm border border-input rounded-md bg-card text-foreground"
          >
            <option value="alle">Alle vervoerders</option>
            {carriersInTable.map((c) => (
              <option key={c} value={c}>
                {CARRIER_LABELS[c]}
              </option>
            ))}
          </select>
        </label>
        {(sort.key !== 'standaard' || catFilter !== 'alle' || carrierFilter !== 'alle') && (
          <button
            type="button"
            onClick={() => {
              setSort({ key: 'standaard', dir: 1 });
              setCatFilter('alle');
              setCarrierFilter('alle');
            }}
            className="px-3 py-2 text-xs font-medium border border-input bg-card text-muted-foreground rounded-lg hover:bg-secondary transition"
          >
            Herstel
          </button>
        )}
        <span className="text-xs text-subtle-foreground pb-2">
          {rows.length} van {allRows.length} reeksen · klik op een kolomkop om te sorteren
        </span>
      </div>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-xs text-muted-foreground border-b border-border">
              {header('vervoerder', 'Vervoerder', 'py-1.5 pr-3 text-left')}
              {header('categorie', 'Categorie', 'py-1.5 pr-3 text-left')}
              {header('tempo', 'Tempo: punten erbij per jaar', 'py-1.5 px-2 text-right')}
              {header('pct', 'Als % van nu', 'py-1.5 px-2 text-right')}
              {header('w13', 'Laatste 13 weken', 'py-1.5 px-2 text-right')}
              <th className="py-1.5 px-2 text-right font-medium">95%-interval</th>
              {header('r2', 'R²', 'py-1.5 px-2 text-right')}
              {header('n', 'Weken', 'py-1.5 px-2 text-right')}
              {header('model', 'Model komende 52 weken', 'py-1.5 px-2 text-right')}
              {header('schoon', 'Schone weken', 'py-1.5 pl-2 text-right')}
            </tr>
          </thead>
          <tbody>
            {rows.map(({ c, k, ols, fit, model }) => (
              <tr key={`${c}-${k}`} className="border-b border-border/60">
                <td className="py-1.5 pr-3">{CARRIER_LABELS[c]}</td>
                <td className="py-1.5 pr-3 text-muted-foreground">{k === 'locker' ? 'automaat' : 'bemand punt'}</td>
                <td className="py-1.5 px-2 text-right tabular-nums">{ols ? signed(Math.round(ols.toename_per_jaar)) : '—'}</td>
                <td className="py-1.5 px-2 text-right tabular-nums">
                  {ols ? pct(ols.toename_per_jaar_pct) : '—'}
                  {ols?.aandeel_gemeten != null && ols.aandeel_gemeten < 0.5 ? (
                    <span className="text-warning" title="Minder dan de helft van de weken gemeten (bevroren cache); de rest volgt het tempo van de categorie">
                      {' '}*
                    </span>
                  ) : null}
                </td>
                <td className="py-1.5 px-2 text-right tabular-nums">{ols ? pct(ols.toename_13w_per_jaar_pct ?? undefined) : '—'}</td>
                <td className="py-1.5 px-2 text-right tabular-nums text-muted-foreground">
                  {ols?.toename_per_jaar_95 ? `${pct(ols.toename_per_jaar_95[0])} - ${pct(ols.toename_per_jaar_95[1])}` : '—'}
                </td>
                <td className="py-1.5 px-2 text-right tabular-nums">{ols?.r2 != null ? nl2.format(ols.r2) : '—'}</td>
                <td className="py-1.5 px-2 text-right tabular-nums">{ols?.n ?? '—'}</td>
                <td className="py-1.5 px-2 text-right tabular-nums">
                  {model ? `${signed(model.punten)} (${pct(model.pct)})` : '—'}
                </td>
                <td className="py-1.5 pl-2 text-right tabular-nums">{fit?.n_obs ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-subtle-foreground">
        Tempo: over de hele historie van de reeks; laatste 13 weken: hetzelfde over het laatste kwartaal, als jaartempo
        (seizoen telt mee: winkels sluiten in de zomer en kerstperiode tijdelijk). * = minder dan de helft van de weken
        gemeten. Model komende 52 weken: mediaan van scenario midden. Iedere reeks groeit met de markt van haar categorie (automaten of
        bemande punten) plus een eigen afwijking; die afwijking halveert in ongeveer vier maanden, de marktgroei dempt per
        scenario uit naar de groei van het aantal afhaalpakketten.
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ methodology */

const EVENT_TYPE_LABELS: Record<string, string> = {
  intro: 'Toegevoegd',
  level_reset: 'Andere ophaalmethode',
  stale: 'Bevroren cache',
  invalid: 'Foutieve snapshot',
  auto_drop: 'Onverklaarde daling',
  auto_rise: 'Onverklaarde sprong',
  auto_outlier: 'Uitschieter',
  auto_stale: 'Ongewijzigde telling',
  auto_gap: 'Ontbreekt',
  note_rise: 'Forse stijging (meegeteld)',
};

const DEMAND_SCENARIO_STYLE: Record<Scenario, { stroke: string; width: number }> = {
  laag: { stroke: 'var(--subtle-foreground)', width: 1.5 },
  midden: { stroke: 'var(--primary)', width: 2 },
  hoog: { stroke: 'var(--subtle-foreground)', width: 1.5 },
};

/** ACM parcel volume by year, then the three demand scenarios to 2030. */
function DemandChart({ data }: { data: Pakketvraag }) {
  const [reeks, setReeks] = useState<'pakketten' | 'afgehaald'>('pakketten');
  const scenarios: Scenario[] = ['laag', 'midden', 'hoog'];
  const rows = useMemo(() => {
    const first = Math.min(...Object.keys(data.volume_mln).map(Number));
    const last = Math.max(...scenarios.flatMap((sc) => (data.scenarios[sc].pad ?? []).map((p) => p.jaar)), data.basisjaar);
    const out = [];
    for (let y = first; y <= last; y++) {
      const key = String(y);
      const vol = data.volume_mln[key];
      const share = data.afhaal_aandeel[key];
      const row: Record<string, number | null> = {
        jaar: y,
        gemeten: reeks === 'pakketten' ? vol ?? null : vol != null && share != null ? vol * share : null,
        groei: data.groei_pct[key] ?? null,
      };
      for (const sc of scenarios) {
        const p = data.scenarios[sc].pad?.find((q) => q.jaar === y);
        row[sc] = p ? (reeks === 'pakketten' ? p.pakketten_mln : p.afgehaald_mln) : null;
        row[`${sc}_servicepunt`] = p?.servicepunt_mln ?? null;
        row[`${sc}_kluis`] = p?.kluis_mln ?? null;
      }
      out.push(row);
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, reeks]);
  const lastRow = rows[rows.length - 1];

  if (!scenarios.some((sc) => data.scenarios[sc].pad?.length)) return null;

  return (
    <div className="mt-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h4 className="text-sm font-semibold text-foreground">
            {reeks === 'pakketten' ? 'Pakketten in Nederland' : 'Afgehaalde pakketten (servicepunt en kluis)'}, miljoen per
            jaar
          </h4>
          <div className="mt-1 flex flex-wrap gap-4">
            <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
              <svg width="20" height="8" aria-hidden>
                <line x1="0" y1="4" x2="20" y2="4" stroke="var(--muted-foreground)" strokeWidth={2} />
                <circle cx="10" cy="4" r="3" fill="var(--muted-foreground)" />
              </svg>
              ACM gemeten
            </span>
            <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
              <svg width="20" height="8" aria-hidden>
                <line x1="0" y1="4" x2="20" y2="4" stroke="var(--primary)" strokeWidth={2} strokeDasharray="5 3" />
              </svg>
              Scenario midden
            </span>
            <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
              <svg width="20" height="8" aria-hidden>
                <line x1="0" y1="4" x2="20" y2="4" stroke="var(--subtle-foreground)" strokeWidth={1.5} strokeDasharray="5 3" />
              </svg>
              Scenario laag en hoog
            </span>
          </div>
        </div>
        <SegControl
          label="Reeks"
          value={reeks}
          onChange={setReeks}
          options={[
            { value: 'pakketten', label: 'Alle pakketten' },
            { value: 'afgehaald', label: 'Afgehaald' },
          ]}
        />
      </div>
      <div className="h-72 mt-3">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={rows} margin={{ top: 16, right: 56, bottom: 4, left: 8 }}>
            <CartesianGrid vertical={false} stroke="var(--border)" />
            <XAxis dataKey="jaar" tick={axisTick} stroke="var(--border)" interval={0} />
            <YAxis
              tick={axisTick}
              tickFormatter={(v: number) => nl.format(v)}
              width={48}
              stroke="var(--border)"
              domain={[0, 'auto']}
            />
            <Tooltip
              content={({ active, payload, label }) => {
                if (!active || !payload?.length) return null;
                const row = payload[0].payload as (typeof rows)[number];
                return (
                  <div className="bg-popover text-popover-foreground border border-border rounded-md shadow-md px-3 py-2 text-xs">
                    <div className="font-semibold mb-1">{label}</div>
                    {row.gemeten != null && <div>ACM: {fmt(row.gemeten)} mln</div>}
                    {row.groei != null && (
                      <div className="text-muted-foreground">
                        Groei volgens ACM: {row.groei > 0 ? '+' : ''}
                        {nl1.format(row.groei)}%
                      </div>
                    )}
                    {row.gemeten == null && row.groei != null && (
                      <div className="text-muted-foreground">Geen volume gepubliceerd in deze editie</div>
                    )}
                    {Number(label) > data.basisjaar &&
                      scenarios.map((sc) =>
                        row[sc] != null ? (
                          <div key={sc}>
                            {SCENARIO_LABELS[sc]}: {fmt(row[sc])} mln
                            {reeks === 'afgehaald' && (
                              <span className="text-muted-foreground">
                                {' '}
                                ({fmt(row[`${sc}_servicepunt`])} servicepunt, {fmt(row[`${sc}_kluis`])} kluis)
                              </span>
                            )}
                          </div>
                        ) : null,
                      )}
                  </div>
                );
              }}
            />
            <ReferenceLine
              x={data.basisjaar}
              stroke="var(--subtle-foreground)"
              label={{ value: 'laatste monitor', position: 'top', fontSize: 11, fill: 'var(--muted-foreground)' }}
            />
            <Line
              dataKey="gemeten"
              stroke="var(--muted-foreground)"
              strokeWidth={2}
              dot={{ r: 4, fill: 'var(--muted-foreground)', stroke: 'var(--card)', strokeWidth: 2 }}
              activeDot={{ r: 5 }}
              isAnimationActive={false}
              connectNulls
            />
            {scenarios.map((sc) => (
              <Line
                key={sc}
                dataKey={sc}
                stroke={DEMAND_SCENARIO_STYLE[sc].stroke}
                strokeWidth={DEMAND_SCENARIO_STYLE[sc].width}
                strokeDasharray="6 4"
                dot={false}
                isAnimationActive={false}
                connectNulls={false}
              />
            ))}
            {scenarios.map((sc) =>
              lastRow[sc] != null ? (
                <ReferenceDot
                  key={`${sc}-label`}
                  x={lastRow.jaar as number}
                  y={lastRow[sc] as number}
                  r={0}
                  label={{ value: SCENARIO_LABELS[sc].toLowerCase(), position: 'right', fontSize: 11, fill: 'var(--muted-foreground)' }}
                />
              ) : null,
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <p className="mt-2 text-xs text-subtle-foreground max-w-4xl">
        Punten zijn de volumes uit de ACM Post- en Pakketmonitor (2020 en 2023 zonder gepubliceerd volume; ACM herziet
        eerdere jaren tussen edities). Vanaf {data.basisjaar} de aannames per scenario:{' '}
        {scenarios
          .map(
            (sc) =>
              `${SCENARIO_LABELS[sc].toLowerCase()} ${data.scenarios[sc].volume_groei_pct >= 0 ? '+' : ''}${nl1.format(
                data.scenarios[sc].volume_groei_pct,
              )}% volume en ${data.scenarios[sc].afhaal_aandeel_pp_per_jaar >= 0 ? '+' : ''}${nl1.format(
                data.scenarios[sc].afhaal_aandeel_pp_per_jaar,
              )} procentpunt afhaalaandeel per jaar`,
          )
          .join('; ')}
        . De stijging van het afhaalaandeel gaat naar kluizen.
      </p>
    </div>
  );
}

function ParcelDemand({ data }: { data: Pakketvraag }) {
  const years = Array.from(new Set([...Object.keys(data.volume_mln), ...Object.keys(data.groei_pct)])).sort();
  const scenarios: Scenario[] = ['laag', 'midden', 'hoog'];
  return (
    <div>
      <h4 className="text-sm font-semibold text-foreground">Pakketvraag (ACM Post- en Pakketmonitor)</h4>
      <p className="mt-1 text-xs text-subtle-foreground max-w-4xl">
        Het aantal pakketten groeit sinds de coronapiek nauwelijks; de groei van het netwerk komt uit verdichting met
        kluizen. Daarom volgt het plafond de afhaalpakketten per inwoner, en dempt de marktgroei per categorie uit naar de
        groei van wat daar wordt afgehaald: bij bemande punten met het pakketvolume, bij kluizen ook met het stijgende
        afhaalaandeel (ACM 2025: 12,4% servicepunt, 5,3% kluis of andere plek). Pakketten per punt is een indicatie: ACM-volume maal het afhaalaandeel, gedeeld door de punten in
        deze data. ACM herziet eerdere jaren tussen edities, dus de reeks is niet volledig vergelijkbaar.
      </p>
      {data.per_inwoner && (
        <p className="mt-2 text-sm text-muted-foreground max-w-4xl">
          Per inwoner ({data.per_inwoner.jaar}, {nl1.format(data.per_inwoner.inwoners_mln)} mln inwoners):{' '}
          <strong className="text-foreground">{nl1.format(data.per_inwoner.totaal)}</strong> pakketten per jaar, waarvan{' '}
          <strong className="text-foreground">{nl1.format(data.per_inwoner.consument)}</strong> voor consumenten (B2C,{' '}
          {Math.round(100 * data.per_inwoner.b2c_aandeel)}%) en{' '}
          <strong className="text-foreground">{nl1.format(data.per_inwoner.afgehaald)}</strong> afgehaald bij een servicepunt of
          kluis. De Netwerkplanner rekent met dezelfde {Math.round(data.per_inwoner.consument)} consumentenpakketten per
          inwoner.
        </p>
      )}
      <DemandChart data={data} />
      <div className="mt-3 grid lg:grid-cols-2 gap-6">
        <table className="text-sm">
          <thead>
            <tr className="text-xs text-muted-foreground border-b border-border">
              <th className="py-1.5 pr-4 text-left font-medium">Jaar</th>
              <th className="py-1.5 px-2 text-right font-medium">Pakketten (mln)</th>
              <th className="py-1.5 px-2 text-right font-medium">Groei</th>
              <th className="py-1.5 px-2 text-right font-medium">Afhaalaandeel</th>
              <th className="py-1.5 pl-2 text-right font-medium">Kluizen (ACM)</th>
            </tr>
          </thead>
          <tbody>
            {years.map((y) => (
              <tr key={y} className="border-b border-border/60">
                <td className="py-1.5 pr-4">{y}</td>
                <td className="py-1.5 px-2 text-right tabular-nums">{data.volume_mln[y] != null ? fmt(data.volume_mln[y]) : '—'}</td>
                <td className="py-1.5 px-2 text-right tabular-nums">
                  {data.groei_pct[y] != null ? `${data.groei_pct[y] > 0 ? '+' : ''}${nl1.format(data.groei_pct[y])}%` : '—'}
                </td>
                <td className="py-1.5 px-2 text-right tabular-nums">
                  {data.afhaal_aandeel[y] != null ? `${nl1.format(100 * data.afhaal_aandeel[y])}%` : '—'}
                </td>
                <td className="py-1.5 pl-2 text-right tabular-nums">{data.kluizen_acm[y] != null ? fmt(data.kluizen_acm[y]) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <table className="text-sm">
          <thead>
            <tr className="text-xs text-muted-foreground border-b border-border">
              <th className="py-1.5 pr-4 text-left font-medium">Scenario</th>
              <th className="py-1.5 px-2 text-right font-medium">Volumegroei per jaar</th>
              <th className="py-1.5 px-2 text-right font-medium">Groei afhalen per jaar: servicepunt / kluis</th>
              <th className="py-1.5 pl-2 text-right font-medium">Afhaalpakketten per punt per week, nu / 2030</th>
            </tr>
          </thead>
          <tbody>
            {scenarios.map((sc) => {
              const v = data.scenarios[sc];
              return (
                <tr key={sc} className="border-b border-border/60" title={v.toelichting}>
                  <td className="py-1.5 pr-4 capitalize">{sc}</td>
                  <td className="py-1.5 px-2 text-right tabular-nums">
                    {v.volume_groei_pct >= 0 ? '+' : ''}
                    {nl1.format(v.volume_groei_pct)}%
                  </td>
                  <td className="py-1.5 px-2 text-right tabular-nums">
                    {v.vraag_groei_servicepunt_pct >= 0 ? '+' : ''}
                    {nl1.format(v.vraag_groei_servicepunt_pct)}% / {v.vraag_groei_kluis_pct >= 0 ? '+' : ''}
                    {nl1.format(v.vraag_groei_kluis_pct)}%
                  </td>
                  <td className="py-1.5 pl-2 text-right tabular-nums">
                    {fmt(v.pakketten_per_punt_per_week_nu)} / {fmt(v.pakketten_per_punt_per_week_2030)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-subtle-foreground">
        Bron: {data.bron}.{' '}
        {data.links.slice(0, 2).map((href, i) => (
          <a key={href} href={href} className="underline hover:text-foreground" target="_blank" rel="noopener noreferrer">
            {i === 0 ? 'Monitor 2025' : 'Monitor 2024'}
            {i === 0 ? ', ' : ''}
          </a>
        ))}
      </p>
    </div>
  );
}

function Methodology({ national, rows }: { national: NationalForecast; rows: ForecastIndexRow[] }) {
  const bt = national.backtest;
  const m = national.methodology;
  const text = (k: string) => (typeof m[k] === 'string' ? (m[k] as string) : '');
  const scatter = rows
    .filter((r) => r.nu > 0)
    .map((r) => ({ x: r.nu, y: r.backtest_fout_pct, naam: r.naam, b: r.betrouwbaarheid }));

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-base font-semibold text-foreground">Hoe de prognose werkt</h3>
        <dl className="mt-3 grid md:grid-cols-2 gap-4 text-sm">
          {[
            ['Meetbreuken eruit', text('opschoning')],
            ['Gedempte trend', text('trend')],
            ['Verzadiging', text('verzadiging')],
            ['Pakketvraag', text('pakketvraag')],
            ['Verdeling over gemeenten', text('gemeenten')],
            ['Punten en locaties', text('punten_vs_locaties')],
            ['Beperkingen', text('beperkingen')],
          ].map(([title, body]) => (
            <div key={title}>
              <dt className="font-medium text-foreground">{title}</dt>
              <dd className="mt-1 text-muted-foreground leading-relaxed">{body}</dd>
            </div>
          ))}
        </dl>
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        <div>
          <h4 className="text-sm font-semibold text-foreground">Terugtoets</h4>
          <p className="mt-1 text-sm text-muted-foreground">{bt.methode}.</p>
          <table className="mt-3 text-sm">
            <tbody>
              <tr>
                <td className="pr-6 py-1 text-muted-foreground">Gemiddelde fout prognosemodel</td>
                <td className="tabular-nums font-medium">{nl2.format(bt.mape_model)}%</td>
              </tr>
              <tr>
                <td className="pr-6 py-1 text-muted-foreground">Gemiddelde fout &quot;niets verandert&quot;</td>
                <td className="tabular-nums">{nl2.format(bt.mape_naive)}%</td>
              </tr>
              <tr>
                <td className="pr-6 py-1 text-muted-foreground">Gemiddelde fout ongedempte trend</td>
                <td className="tabular-nums">{nl2.format(bt.mape_linear)}%</td>
              </tr>
              <tr>
                <td className="pr-6 py-1 text-muted-foreground">Werkelijke waarde binnen 80%-band</td>
                <td className="tabular-nums">
                  {nl1.format(bt.dekking_p10_p90_pct)}% (ongekalibreerd {nl1.format(bt.dekking_ongekalibreerd_pct)}%)
                </td>
              </tr>
            </tbody>
          </table>
          <p className="mt-2 text-xs text-subtle-foreground">
            De onzekerheidsbanden zijn met factor {nl1.format(bt.onzekerheid_factor)} verbreed, zodat ze in de terugtoets
            minstens 80% van de werkelijke waarden bevatten.
          </p>

          <h4 className="mt-5 text-sm font-semibold text-foreground">Fout per gemeentegrootte</h4>
          <p className="mt-1 text-xs text-subtle-foreground">
            Mediane afwijking van het aantal punten na 12 weken, als de landelijke groei bekend is. Kleine gemeenten zijn
            veel onrustiger: daar zegt een prognose minder.
          </p>
          <table className="mt-2 w-full text-sm">
            <thead>
              <tr className="text-xs text-muted-foreground border-b border-border">
                <th className="py-1.5 text-left font-medium">Punten nu</th>
                <th className="py-1.5 text-right font-medium">Gemeenten</th>
                <th className="py-1.5 text-right font-medium">Fout model</th>
                <th className="py-1.5 text-right font-medium">Fout niets voorspellen</th>
              </tr>
            </thead>
            <tbody>
              {bt.gemeenten_per_grootte.map((row) => (
                <tr key={row.klasse} className="border-b border-border/60">
                  <td className="py-1.5">{row.klasse}</td>
                  <td className="py-1.5 text-right tabular-nums">{row.gemeenten}</td>
                  <td className="py-1.5 text-right tabular-nums">{nl1.format(row.fout_model_pct)}%</td>
                  <td className="py-1.5 text-right tabular-nums">{nl1.format(row.fout_naief_pct)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div>
          <h4 className="text-sm font-semibold text-foreground">Terugtoets-fout per gemeente</h4>
          <p className="mt-1 text-xs text-subtle-foreground">Ieder punt is een gemeente; horizontaal het aantal punten nu (log-schaal).</p>
          <div className="h-64 mt-2">
            <ResponsiveContainer width="100%" height="100%">
              <ScatterChart margin={{ top: 8, right: 16, bottom: 16, left: 8 }}>
                <CartesianGrid stroke="var(--border)" />
                <XAxis
                  type="number"
                  dataKey="x"
                  scale="log"
                  domain={[1, 1000]}
                  ticks={[1, 3, 10, 30, 100, 300, 1000]}
                  allowDataOverflow
                  tick={axisTick}
                  stroke="var(--border)"
                  label={{ value: 'Punten nu', position: 'insideBottom', offset: -8, fontSize: 11, fill: 'var(--muted-foreground)' }}
                />
                <YAxis
                  type="number"
                  dataKey="y"
                  tick={axisTick}
                  tickFormatter={(v: number) => `${v}%`}
                  width={44}
                  stroke="var(--border)"
                />
                <Tooltip
                  content={({ active, payload }) => {
                    if (!active || !payload?.length) return null;
                    const p = payload[0].payload as (typeof scatter)[number];
                    return (
                      <div className="bg-popover text-popover-foreground border border-border rounded-md shadow-md px-3 py-2 text-xs">
                        <div className="font-semibold">{p.naam}</div>
                        <div>{fmt(p.x)} punten, fout {nl1.format(p.y)}%</div>
                        <div>Betrouwbaarheid: {p.b}</div>
                      </div>
                    );
                  }}
                />
                <Scatter data={scatter} fill="var(--primary)" fillOpacity={0.55} isAnimationActive={false} />
              </ScatterChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {national.pakketvraag && <ParcelDemand data={national.pakketvraag} />}

      <RegressionTable national={national} />

      <div>
        <h4 className="text-sm font-semibold text-foreground">Meetbreuken in de data</h4>
        <p className="mt-1 text-xs text-subtle-foreground">
          Register: bekend uit de ophaalhistorie. Automatisch: door het model gevonden; die kunnen in het register worden
          opgenomen als de oorzaak bekend is.
        </p>
        <div className="mt-2 overflow-x-auto max-h-80">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-card">
              <tr className="text-xs text-muted-foreground border-b border-border">
                <th className="py-1.5 pr-3 text-left font-medium">Week</th>
                <th className="py-1.5 pr-3 text-left font-medium">Vervoerder</th>
                <th className="py-1.5 pr-3 text-left font-medium">Soort</th>
                <th className="py-1.5 pr-3 text-left font-medium">Toelichting</th>
                <th className="py-1.5 text-left font-medium">Bron</th>
              </tr>
            </thead>
            <tbody>
              {national.events.map((e) => (
                <tr key={`${e.carrier}-${e.type}-${e.week}`} className="border-b border-border/60">
                  <td className="py-1.5 pr-3 tabular-nums whitespace-nowrap">
                    {e.week}
                    {e.until ? ` t/m ${e.until}` : ''}
                  </td>
                  <td className="py-1.5 pr-3">{e.carrier}</td>
                  <td className="py-1.5 pr-3">{EVENT_TYPE_LABELS[e.type] ?? e.type}</td>
                  <td className="py-1.5 pr-3 text-muted-foreground">
                    {e.note ?? ''}
                    {e.change_pct != null ? `${e.note ? ' · ' : ''}${e.change_pct > 0 ? '+' : ''}${nl1.format(e.change_pct)}% in een week` : ''}
                  </td>
                  <td className="py-1.5 text-muted-foreground">{e.source === 'register' ? 'Register' : 'Automatisch'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
