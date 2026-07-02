'use client';

import { useMemo } from 'react';
import {
  ComposedChart,
  Area,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
  ResponsiveContainer,
} from 'recharts';

import type { LockerNetworkPayload } from '@/lib/lockerNetwork';
import { scenarioKey, nlPct1 } from '@/lib/lockerNetwork';

interface Props {
  payload: LockerNetworkPayload;
  distance: number;
  start: string;
  n: number;
}

/**
 * Coverage vs. number of lockers for the active scenario, with dashed
 * comparison lines for the other walking distances at the same start
 * situation (the 300 vs 500 m policy question at a glance).
 */
export default function NetworkCoverageChart({ payload, distance, start, n }: Props) {
  const { data, flatteningAt } = useMemo(() => {
    const active = payload.scenarios[scenarioKey(distance, start)];
    if (!active) return { data: [], flatteningAt: null as number | null };
    const pop = payload.population_total;
    const others = payload.params.distances.filter((d) => d !== distance);
    const maxLen = Math.max(
      active.picks.length,
      ...others.map((d) => payload.scenarios[scenarioKey(d, start)]?.picks.length ?? 0),
    );
    const rows: Record<string, number | null>[] = [];
    for (let i = 0; i <= maxLen; i++) {
      const row: Record<string, number | null> = { n: i };
      row.actief =
        i === 0
          ? (active.start_covered / pop) * 100
          : i <= active.picks.length
            ? (active.picks[i - 1].cum / pop) * 100
            : null;
      for (const d of others) {
        const sc = payload.scenarios[scenarioKey(d, start)];
        if (!sc) continue;
        row[`d${d}`] =
          i === 0
            ? (sc.start_covered / pop) * 100
            : i <= sc.picks.length
              ? (sc.picks[i - 1].cum / pop) * 100
              : null;
      }
      rows.push(row);
    }
    // Diminishing-returns marker: first pick whose gain drops below 5% of
    // the first pick's gain (or min_gain, whichever is larger).
    let flat: number | null = null;
    if (active.picks.length > 1) {
      const threshold = Math.max(payload.params.min_gain, active.picks[0].gain * 0.05);
      const idx = active.picks.findIndex((p) => p.gain < threshold);
      if (idx > 0) flat = idx + 1;
    }
    return { data: rows, flatteningAt: flat };
  }, [payload, distance, start]);

  if (data.length === 0) return null;

  const otherDistances = payload.params.distances.filter((d) => d !== distance);
  const otherStyles = ['#94a3b8', '#cbd5e1'];

  return (
    <div className="h-64">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 8, right: 16, bottom: 4, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
          <XAxis
            dataKey="n"
            tick={{ fontSize: 11 }}
            label={{ value: 'Aantal kluizen', position: 'insideBottom', offset: -2, fontSize: 11 }}
          />
          <YAxis
            domain={[0, 100]}
            tick={{ fontSize: 11 }}
            tickFormatter={(v: number) => `${v}%`}
            width={44}
          />
          <Tooltip
            formatter={(value, name) => [
              typeof value === 'number' ? `${nlPct1(value)}%` : '—',
              name === 'actief'
                ? `Dekking (${distance} m)`
                : `Dekking (${String(name).slice(1)} m)`,
            ]}
            labelFormatter={(v) => `${v} kluizen`}
          />
          {otherDistances.map((d, i) => (
            <Line
              key={d}
              type="monotone"
              dataKey={`d${d}`}
              stroke={otherStyles[i % otherStyles.length]}
              strokeDasharray="5 4"
              strokeWidth={1.5}
              dot={false}
              connectNulls={false}
            />
          ))}
          <Area
            type="monotone"
            dataKey="actief"
            stroke="#4338ca"
            strokeWidth={2.5}
            fill="#6366f1"
            fillOpacity={0.12}
            dot={false}
            connectNulls={false}
          />
          <ReferenceLine
            x={Math.min(n, data.length - 1)}
            stroke="#4338ca"
            strokeWidth={1.5}
            label={{ value: `${n}`, position: 'top', fontSize: 11, fill: '#4338ca' }}
          />
          {flatteningAt != null && (
            <ReferenceLine
              x={flatteningAt}
              stroke="#f59e0b"
              strokeDasharray="4 4"
              label={{
                value: 'afnemende meerwaarde',
                position: 'insideTopRight',
                fontSize: 10,
                fill: '#b45309',
              }}
            />
          )}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
