'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import MunicipalityOverviewPanels from '@/components/overview/MunicipalityOverviewPanels';
import ProviderOverviewPanels from '@/components/overview/ProviderOverviewPanels';
import TotalOverviewPanels from '@/components/overview/TotalOverviewPanels';
import {
  CARRIER_LABELS,
  CARRIER_ORDER,
  CARRIER_SERIES_COLORS,
  Carrier,
} from '@/lib/carriers';
import { HistorySnapshot, MunicipalityHistoryEntry } from '@/types/history';
import { CarrierSources } from '@/types/sources';

const RADII = ['300', '400', '500'] as const;

const CATEGORY_LABELS: Record<string, string> = {
  locker: 'Pakketautomaat',
  shop: 'Pakketpunt',
};

export interface MunicipalityStats {
  slug: string;
  gemeente: string;
  provincie: string | null;
  code: string | null;
  population: number;
  area_km2: number;
  total: number;
  per_10k_inwoners: number;
  per_km2: number;
  vervoerders: Record<string, number>;
  categorieen: Record<string, number>;
  dekking: Record<string, number>;
}

export interface StatisticsPayload {
  generated_at: string;
  national: {
    total: number;
    population: number;
    area_km2: number;
    vervoerders: Record<string, number>;
    categorieen: Record<string, number>;
    dekking: Record<string, number>;
  };
  /** Per-carrier cache age. Rendered on /data-export/updates, not here. */
  bronnen?: CarrierSources;
  municipalities: MunicipalityStats[];
}

function formatNumber(value: number): string {
  return value.toLocaleString('nl-NL');
}

function ChartTooltip({
  active,
  payload,
  suffix,
}: {
  active?: boolean;
  payload?: { value: number; payload: { label: string } }[];
  suffix?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-border bg-popover px-2.5 py-1.5 text-xs shadow-md">
      <p className="font-medium text-foreground">{payload[0].payload.label}</p>
      <p className="tabular-nums text-muted-foreground">
        {formatNumber(payload[0].value)}
        {suffix ?? ''}
      </p>
    </div>
  );
}

/**
 * Ranked horizontal bars. Every row is named on the axis and labelled with its
 * value, so the colour is decoration — which it has to be at ten carriers.
 */
function RankedBars({
  data,
  suffix,
}: {
  data: { label: string; value: number; color: string }[];
  suffix?: string;
}) {
  if (data.length === 0) {
    return <p className="py-6 text-center text-sm text-muted-foreground">Geen data.</p>;
  }

  return (
    <ResponsiveContainer width="100%" height={Math.max(160, data.length * 30)}>
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 56, bottom: 4, left: 4 }}>
        <CartesianGrid horizontal={false} stroke="var(--border)" />
        <XAxis type="number" hide />
        <YAxis
          type="category"
          dataKey="label"
          width={96}
          tick={{ fill: 'var(--muted-foreground)', fontSize: 11 }}
          axisLine={false}
          tickLine={false}
        />
        <Tooltip
          cursor={{ fill: 'var(--muted)' }}
          content={<ChartTooltip suffix={suffix} />}
        />
        <Bar dataKey="value" radius={[0, 4, 4, 0]} barSize={14}>
          {data.map((entry) => (
            <Cell key={entry.label} fill={entry.color} />
          ))}
          <LabelList
            dataKey="value"
            position="right"
            formatter={(value: React.ReactNode) => formatNumber(Number(value)) + (suffix ?? '')}
            style={{ fontSize: 11, fill: 'var(--muted-foreground)' }}
          />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

/** A labelled proportion bar — used for the coverage radii. */
function CoverageMeter({ radius, ratio }: { radius: string; ratio: number }) {
  const percentage = ratio * 100;
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between">
        <span className="text-sm text-muted-foreground">binnen {radius} m</span>
        <span className="text-sm font-semibold tabular-nums text-foreground">
          {percentage.toFixed(1)}%
        </span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-primary"
          style={{ width: `${Math.min(percentage, 100)}%` }}
        />
      </div>
    </div>
  );
}

function StatTile({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <Card>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-bold tabular-nums text-foreground">{value}</p>
      {hint && <p className="mt-0.5 text-xs text-subtle-foreground">{hint}</p>}
    </Card>
  );
}

export default function StatisticsClient({
  statistics,
  snapshots,
  providers,
}: {
  statistics: StatisticsPayload;
  /**
   * Just the weekly totals, not the whole HistoryData: its `municipalities` key
   * is 4.7 MB of per-gemeente history that nothing here reads, and a prop on a
   * client component is shipped to the browser.
   */
  snapshots: HistorySnapshot[];
  providers: string[];
}) {
  // '' means all carriers together, matching the Totaal tile on the Data Matrix.
  const [carrier, setCarrier] = useState<string>('');
  const [slug, setSlug] = useState<string>('');
  const [query, setQuery] = useState('');

  /**
   * Per-gemeente history, fetched a slug at a time.
   *
   * totals_history.json carries all 344 municipalities in ~4.7 MB, so it can
   * neither be a prop nor be fetched whole. Results are cached per slug, and
   * `failed` keeps a 404 from being retried on every re-render.
   */
  const [histories, setHistories] = useState<Record<string, MunicipalityHistoryEntry[]>>({});
  const [failed, setFailed] = useState<Record<string, true>>({});

  useEffect(() => {
    if (!slug || histories[slug] || failed[slug]) return;

    let cancelled = false;

    fetch(`/api/municipality-history/${slug}`)
      .then((response) => (response.ok ? response.json() : Promise.reject(response.status)))
      .then((data: { history: MunicipalityHistoryEntry[] }) => {
        if (!cancelled) {
          setHistories((prev) => ({ ...prev, [slug]: data.history }));
        }
      })
      .catch(() => {
        if (!cancelled) {
          setFailed((prev) => ({ ...prev, [slug]: true }));
        }
      });

    return () => {
      cancelled = true;
    };
  }, [slug, histories, failed]);

  const municipalityHistory = slug ? (histories[slug] ?? null) : null;
  const historyUnavailable = slug ? Boolean(failed[slug]) : false;
  const historyLoading = Boolean(slug) && !municipalityHistory && !historyUnavailable;

  const selected = useMemo(
    () => statistics.municipalities.find((m) => m.slug === slug) ?? null,
    [statistics.municipalities, slug]
  );

  // The selected gemeente when there is one, otherwise the national roll-up.
  const scope = selected ?? statistics.national;

  const carrierBars = useMemo(
    () =>
      CARRIER_ORDER.map((carrier) => ({
        label: CARRIER_LABELS[carrier],
        value: scope.vervoerders[carrier] ?? 0,
        color: CARRIER_SERIES_COLORS[carrier as Carrier],
      }))
        .filter((entry) => entry.value > 0)
        .sort((a, b) => b.value - a.value),
    [scope]
  );

  const categoryBars = useMemo(
    () =>
      Object.entries(scope.categorieen)
        .map(([key, value]) => ({
          label: CATEGORY_LABELS[key] ?? key,
          value,
          color: 'var(--primary)',
        }))
        .sort((a, b) => b.value - a.value),
    [scope]
  );

  const ranked = useMemo(
    () =>
      [...statistics.municipalities]
        .filter((m) => m.total > 0)
        .sort((a, b) => b.per_10k_inwoners - a.per_10k_inwoners),
    [statistics.municipalities]
  );

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return ranked;
    return ranked.filter(
      (m) =>
        m.gemeente.toLowerCase().includes(needle) ||
        (m.provincie ?? '').toLowerCase().includes(needle)
    );
  }, [ranked, query]);

  const generated = new Date(statistics.generated_at).toLocaleDateString('nl-NL');

  return (
    <div className="space-y-6">
      {/*
        Historische ontwikkeling. Same panels as the Totaal- and vervoerder-tiles
        on the Data Matrix open in a modal, with a selector in place of the click.
      */}
      <section className="space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-foreground">
              {carrier || 'Alle vervoerders'}
            </h2>
            <p className="text-sm text-muted-foreground">
              {carrier
                ? 'Historische ontwikkeling pakketpunten'
                : 'Marktaandeel en groei per vervoerder'}
            </p>
          </div>

          <select
            value={carrier}
            onChange={(event) => setCarrier(event.target.value)}
            className="h-9 rounded-lg border border-input bg-card px-3 text-sm text-foreground"
            aria-label="Kies een vervoerder"
          >
            <option value="">Alle vervoerders</option>
            {providers.map((provider) => (
              <option key={provider} value={provider}>
                {provider}
              </option>
            ))}
          </select>
        </div>

        {snapshots.length === 0 ? (
          <Card>
            <p className="py-6 text-center text-sm text-muted-foreground">
              Nog geen historische snapshots. Draai{' '}
              <code className="rounded bg-muted px-1 py-0.5 text-xs">
                python scripts/update_totals_history.py
              </code>
              .
            </p>
          </Card>
        ) : carrier ? (
          <ProviderOverviewPanels providerName={carrier} snapshots={snapshots} />
        ) : (
          <TotalOverviewPanels snapshots={snapshots} providers={providers} />
        )}
      </section>

      <hr className="border-border" />

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-foreground">
            Dekking en dichtheid — {selected ? selected.gemeente : 'Nederland'}
          </h2>
          <p className="text-sm text-muted-foreground">
            {selected
              ? `${selected.provincie ?? 'Onbekend'} · ${formatNumber(selected.population)} inwoners · ${formatNumber(selected.area_km2)} km²`
              : `${formatNumber(statistics.municipalities.length)} gemeenten · bijgewerkt ${generated}`}
          </p>
        </div>

        <select
          value={slug}
          onChange={(event) => setSlug(event.target.value)}
          className="h-9 rounded-lg border border-input bg-card px-3 text-sm text-foreground"
          aria-label="Kies een gemeente"
        >
          <option value="">Heel Nederland</option>
          {[...statistics.municipalities]
            .sort((a, b) => a.gemeente.localeCompare(b.gemeente))
            .map((m) => (
              <option key={m.slug} value={m.slug}>
                {m.gemeente}
              </option>
            ))}
        </select>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="Pakketpunten" value={formatNumber(scope.total)} />
        <StatTile
          label="Per 10.000 inwoners"
          value={
            selected
              ? formatNumber(selected.per_10k_inwoners)
              : (statistics.national.total / statistics.national.population * 10_000).toFixed(1)
          }
        />
        <StatTile
          label="Per km²"
          value={
            selected
              ? formatNumber(selected.per_km2)
              : (statistics.national.total / statistics.national.area_km2).toFixed(2)
          }
        />
        <StatTile
          label="Dekking binnen 500 m"
          value={`${((scope.dekking['500'] ?? 0) * 100).toFixed(1)}%`}
          hint="van het landoppervlak"
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Per vervoerder</CardTitle>
          </CardHeader>
          <CardContent>
            <RankedBars data={carrierBars} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Per type locatie</CardTitle>
          </CardHeader>
          <CardContent>
            <RankedBars data={categoryBars} />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Dekkingsgraad</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Aandeel van het landoppervlak binnen loopafstand van een pakketpunt. Berekend
            in RD New (EPSG:28992), dus in echte meters.
          </p>
          {RADII.map((radius) => (
            <CoverageMeter key={radius} radius={radius} ratio={scope.dekking[radius] ?? 0} />
          ))}
        </CardContent>
      </Card>

      {/*
        The same dashboard the chart button on a Data Matrix row opens. Only for
        a chosen gemeente: the national history is already the top section.
      */}
      {selected && (
        <section className="space-y-4">
          <div>
            <h3 className="text-base font-semibold text-foreground">
              Ontwikkeling {selected.gemeente}
            </h3>
            <p className="text-sm text-muted-foreground">
              Marktaandeel en groei per vervoerder, week op week
            </p>
          </div>

          {historyLoading && (
            <Card>
              <p className="py-6 text-center text-sm text-muted-foreground">
                Historie laden...
              </p>
            </Card>
          )}

          {historyUnavailable && (
            <Card>
              <p className="py-6 text-center text-sm text-muted-foreground">
                Nog geen wekelijkse historie voor {selected.gemeente}.
              </p>
            </Card>
          )}

          {municipalityHistory && <MunicipalityOverviewPanels history={municipalityHistory} />}
        </section>
      )}

      <Card padded={false}>
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border p-3 sm:p-4">
          <CardTitle>Gemeenten op dichtheid</CardTitle>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Zoek gemeente of provincie..."
            className="h-9 w-56 rounded-lg border border-input bg-card px-3 text-sm text-foreground placeholder:text-subtle-foreground"
          />
        </div>
        <div className="max-h-[28rem] overflow-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-muted text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">#</th>
                <th className="px-3 py-2 font-medium">Gemeente</th>
                <th className="px-3 py-2 font-medium">Provincie</th>
                <th className="px-3 py-2 text-right font-medium">Punten</th>
                <th className="px-3 py-2 text-right font-medium">Per 10.000</th>
                <th className="px-3 py-2 text-right font-medium">Dekking 500 m</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((municipality) => (
                <tr
                  key={municipality.slug}
                  onClick={() => setSlug(municipality.slug)}
                  className="cursor-pointer border-t border-border transition-colors hover:bg-muted"
                >
                  <td className="px-3 py-2 tabular-nums text-subtle-foreground">
                    {ranked.indexOf(municipality) + 1}
                  </td>
                  <td className="px-3 py-2 font-medium text-foreground">
                    {municipality.gemeente}
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">{municipality.provincie}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-foreground">
                    {formatNumber(municipality.total)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-foreground">
                    {formatNumber(municipality.per_10k_inwoners)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                    {((municipality.dekking['500'] ?? 0) * 100).toFixed(1)}%
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {filtered.length === 0 && (
            <p className="p-6 text-center text-sm text-muted-foreground">
              Geen gemeente gevonden.
            </p>
          )}
        </div>
      </Card>
    </div>
  );
}
