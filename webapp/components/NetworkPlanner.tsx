'use client';

import { useEffect, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';

import type { LockerNetworkPayload } from '@/lib/lockerNetwork';
import {
  START_LABELS,
  FLAG_LABELS,
  scenarioKey,
  networkCapacity,
  columnsNeeded,
  metersNeeded,
  nlInt,
  nlPct1,
} from '@/lib/lockerNetwork';
import NetworkCoverageChart from '@/components/NetworkCoverageChart';

const NetworkPlannerMap = dynamic(() => import('@/components/NetworkPlannerMap'), {
  ssr: false,
  loading: () => (
    <div className="w-full h-full flex items-center justify-center bg-gray-50 text-sm text-gray-500">
      Kaart laden…
    </div>
  ),
});

interface MunicipalityOption {
  slug: string;
  name: string;
}

interface Props {
  municipalities: MunicipalityOption[];
  defaultSlug: string;
}

export default function NetworkPlanner({ municipalities, defaultSlug }: Props) {
  const [slug, setSlug] = useState(defaultSlug);
  const [payload, setPayload] = useState<LockerNetworkPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [distance, setDistance] = useState(400);
  const [start, setStart] = useState<string>('alle-punten');
  const [n, setN] = useState(25);
  const [oohPct, setOohPct] = useState(80);
  const [showAssumptions, setShowAssumptions] = useState(false);

  // Sticky gemeente selection, shared with the rest of the app.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const candidates = [
      params.get('gemeente'),
      window.localStorage.getItem('lastSelectedMunicipality'),
    ].filter((v): v is string => Boolean(v));
    for (const c of candidates) {
      if (municipalities.some((m) => m.slug === c)) {
        setSlug(c);
        return;
      }
    }
  }, [municipalities]);
  useEffect(() => {
    if (slug && typeof window !== 'undefined') {
      window.localStorage.setItem('lastSelectedMunicipality', slug);
    }
  }, [slug]);

  // Load the per-municipality payload (client-side; gzip + browser cache).
  useEffect(() => {
    if (!slug) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(`/data/locker_network/${slug}.json`)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((data: LockerNetworkPayload) => {
        if (cancelled) return;
        setPayload(data);
      })
      .catch(() => !cancelled && setError('Netwerkdata voor deze gemeente kon niet geladen worden.'))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [slug]);

  const scenario = payload?.scenarios[scenarioKey(distance, start)] ?? null;
  const maxN = scenario?.picks.length ?? 0;

  // Clamp / re-default N when the scenario changes.
  useEffect(() => {
    if (!scenario) return;
    setN((cur) => Math.min(Math.max(0, cur), scenario.picks.length));
  }, [scenario]);

  const oohShare = oohPct / 100;

  const stats = useMemo(() => {
    if (!payload || !scenario) return null;
    const pop = payload.population_total;
    const covered = n === 0
      ? scenario.start_covered
      : scenario.picks[Math.min(n, scenario.picks.length) - 1]?.cum ?? scenario.start_covered;
    const capacity = networkCapacity(scenario, n, payload.capacity_defaults, oohShare);
    return {
      pop,
      covered,
      pct: (covered / pop) * 100,
      startPct: (scenario.start_covered / pop) * 100,
      capacity,
    };
  }, [payload, scenario, n, oohShare]);

  const view3DHref = useMemo(() => {
    return (pickIndex: number): string => {
      if (!payload || !scenario) return '#';
      const pick = scenario.picks[pickIndex];
      const cand = payload.candidates[pick.c];
      const meta = payload.type_meta[cand.type];
      const cols = columnsNeeded(pick.gain, payload.capacity_defaults, oohShare);
      const params = new URLSearchParams({
        lat: String(cand.lat),
        lon: String(cand.lon),
        label: cand.naam || meta?.label || cand.type,
        type: cand.type,
        rank: String(pickIndex + 1),
        gain: String(pick.gain),
        cols: String(Math.min(17, Math.max(4, cols))),
        afstand: String(distance),
      });
      return `/data-export/netwerkplanner/3d/${payload.slug}?${params.toString()}`;
    };
  }, [payload, scenario, oohShare, distance]);

  // Vertical controls panel — rendered left of the map, and standalone while
  // the payload is loading so gemeente switching always stays possible.
  const controlsPanel = (
    <aside className="bg-white rounded-lg shadow-md p-4 h-fit lg:sticky lg:top-4 space-y-5">
      <div data-tour="gemeente">
        <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">
          Gemeente
        </label>
        <select
          value={slug}
          onChange={(e) => setSlug(e.target.value)}
          className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md bg-white"
        >
          {municipalities.map((m) => (
            <option key={m.slug} value={m.slug}>
              {m.name}
            </option>
          ))}
        </select>
      </div>

      <div data-tour="loopafstand">
        <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">
          Loopafstand
        </label>
        <div className="inline-flex rounded-md overflow-hidden border border-blue-200">
          {(payload?.params.distances ?? [300, 400, 500]).map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => setDistance(d)}
              className={`px-4 py-2 text-sm font-semibold transition ${
                distance === d
                  ? 'bg-blue-700 text-white'
                  : 'bg-white text-blue-700 hover:bg-blue-50'
              }`}
            >
              {d} m
            </button>
          ))}
        </div>
      </div>

      <div data-tour="startsituatie">
        <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">
          Startsituatie
        </label>
        <select
          value={start}
          onChange={(e) => setStart(e.target.value)}
          className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md bg-white"
        >
          {(payload?.params.starts ?? Object.keys(START_LABELS)).map((s) => (
            <option key={s} value={s}>
              {START_LABELS[s] ?? s}
            </option>
          ))}
        </select>
      </div>

      <div data-tour="ooh-slider">
        <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">
          Aandeel out-of-home: <span className="text-blue-800">{oohPct}%</span>
        </label>
        <input
          type="range"
          min={10}
          max={100}
          step={5}
          value={oohPct}
          onChange={(e) => setOohPct(Number(e.target.value))}
          className="w-full accent-blue-600"
        />
        <p className="text-[11px] text-gray-400 mt-0.5">
          Bepaalt alleen de capaciteitsschatting (kolommen/kasten), niet de locaties.
        </p>
      </div>

      <div data-tour="n-slider" className="mt-5">
        <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">
          Aantal kluizen: <span className="text-blue-800 text-sm">{n}</span>
          {maxN > 0 && <span className="text-gray-400 font-normal"> / {maxN}</span>}
        </label>
        <input
          type="range"
          min={0}
          max={maxN}
          value={Math.min(n, maxN)}
          onChange={(e) => setN(Number(e.target.value))}
          disabled={maxN === 0}
          className="w-full accent-blue-600"
        />
      </div>
    </aside>
  );

  return (
    <div className="space-y-6">
      {/* Intro */}
      <section data-tour="intro" className="bg-white rounded-lg shadow-md p-6">
        <h2 className="text-xl font-bold text-gray-900">Netwerkplanner pakketkluizen</h2>
        <p className="text-sm text-gray-600 mt-1 max-w-3xl">
          Ontwerp een dekkend netwerk van pakketkluizen: het algoritme plaatst kluizen
          een voor een op bestaande, publiek toegankelijke locaties (supermarkten,
          OV-haltes, parkeergarages, trafohuisjes) — telkens op de plek die de meeste
          nog onbereikte inwoners binnen loopafstand brengt. Schuif met het aantal
          kluizen en de beleidsknoppen om het effect direct op de kaart te zien.
        </p>
        <p className="text-xs text-gray-400 mt-2">
          Loopafstand is hemelsbreed (RD-projectie), consistent met de overige
          dekkingscijfers in deze app. Vraagdata: CBS Vierkantstatistieken 100 m ·
          locaties: OpenStreetMap.
        </p>
      </section>

      {error && (
        <div className="p-6 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-900">
          {error}
        </div>
      )}

      {!payload && (
        <section className="grid grid-cols-1 lg:grid-cols-[280px_minmax(0,1fr)] gap-4">
          {controlsPanel}
          <div className="bg-white rounded-lg shadow-md p-6 text-sm text-gray-500">
            {loading ? 'Netwerkdata laden…' : 'Geen netwerkdata beschikbaar voor deze gemeente.'}
          </div>
        </section>
      )}

      {payload && scenario && stats && (
        <>
          {/* Stat tiles */}
          <section data-tour="tegels" className="grid grid-cols-2 xl:grid-cols-4 gap-4">
            <StatTile
              label={`Dekking binnen ${distance} m`}
              value={`${nlPct1(stats.pct)}%`}
              sub={`start ${nlPct1(stats.startPct)}%`}
              accent
            />
            <StatTile
              label="Inwoners binnen loopafstand"
              value={nlInt(stats.covered)}
              sub={`van ${nlInt(stats.pop)}`}
            />
            <StatTile
              label="Kluizen geplaatst"
              value={nlInt(n)}
              sub={`van max ${nlInt(maxN)} zinvolle locaties`}
            />
            <StatTile
              label={`Capaciteit bij ${oohPct}% OOH`}
              value={`${nlInt(stats.capacity.columns)} kolommen`}
              sub={`${nlPct1(stats.capacity.meters)} m kluis · ${nlInt(stats.capacity.cabinets)} kasten · ${nlInt(stats.capacity.parcelsPerDay)} pakketten/dag`}
            />
          </section>

          {/* Controls + map + picks list */}
          <section className="grid grid-cols-1 lg:grid-cols-[280px_minmax(0,1fr)_340px] gap-4">
            {controlsPanel}
            <div data-tour="kaart" className="bg-white rounded-lg shadow-md overflow-hidden h-[560px] lg:h-[640px]">
              <NetworkPlannerMap
                payload={payload}
                scenario={scenario}
                n={n}
                distance={distance}
                oohShare={oohShare}
                view3DHref={view3DHref}
              />
            </div>
            <aside data-tour="picks" className="bg-white rounded-lg shadow-md overflow-hidden flex flex-col h-[560px] lg:h-[640px]">
              <div className="px-4 py-3 bg-blue-50 border-b border-blue-100">
                <h3 className="text-sm font-semibold text-gray-900">
                  Geplaatste kluizen (volgorde van impact)
                </h3>
                <p className="text-[11px] text-gray-500 mt-0.5">
                  Elke kluis staat op een bestaande locatie; klik voor 3D-beeld.
                </p>
              </div>
              <div className="overflow-y-auto flex-1 min-h-0 divide-y divide-gray-100">
                {n === 0 && (
                  <p className="p-4 text-sm text-gray-500">
                    Schuif het aantal kluizen omhoog om het netwerk op te bouwen.
                  </p>
                )}
                {scenario.picks.slice(0, n).map((pick, i) => {
                  const cand = payload.candidates[pick.c];
                  const meta = payload.type_meta[cand.type];
                  const cols = columnsNeeded(pick.gain, payload.capacity_defaults, oohShare);
                  const meters = metersNeeded(cols, payload.capacity_defaults);
                  return (
                    <div key={i} className="px-4 py-2.5 text-xs">
                      <div className="flex items-center gap-2">
                        <span className="font-mono font-semibold text-gray-500">#{i + 1}</span>
                        <span
                          className="inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold text-white"
                          style={{ background: meta?.kleur ?? '#334155' }}
                        >
                          {meta?.label ?? cand.type}
                        </span>
                        <span className="font-semibold text-gray-900 truncate">
                          {cand.naam || '—'}
                        </span>
                      </div>
                      <div className="mt-1 text-gray-600">
                        +{nlInt(pick.gain)} inwoners · {cols} kolommen · {nlPct1(meters)} m kluis
                      </div>
                      {cand.flags.length > 0 && (
                        <div className="mt-1 flex flex-wrap gap-1">
                          {cand.flags.map((f) => (
                            <span
                              key={f}
                              className={`px-1.5 py-0.5 rounded text-[10px] border ${
                                f === 'aandachtspunt_sociale_veiligheid'
                                  ? 'bg-amber-50 text-amber-800 border-amber-200'
                                  : 'bg-gray-50 text-gray-600 border-gray-200'
                              }`}
                            >
                              {FLAG_LABELS[f] ?? f}
                            </span>
                          ))}
                        </div>
                      )}
                      <div className="mt-1.5">
                        <Link
                          href={view3DHref(i)}
                          className="text-[11px] font-semibold text-indigo-700 hover:text-indigo-900"
                        >
                          Bekijk in 3D
                        </Link>
                      </div>
                    </div>
                  );
                })}
              </div>
            </aside>
          </section>

          {/* Coverage curve */}
          <section data-tour="curve" className="bg-white rounded-lg shadow-md p-6">
            <div className="flex flex-wrap items-baseline justify-between gap-2 mb-2">
              <h3 className="text-lg font-semibold text-gray-900">
                Dekkingscurve — {START_LABELS[start] ?? start}
              </h3>
              <p className="text-xs text-gray-500">
                Gestippeld: dezelfde startsituatie bij de andere loopafstanden.
              </p>
            </div>
            <NetworkCoverageChart payload={payload} distance={distance} start={start} n={n} />
          </section>

          {/* Assumptions */}
          <section data-tour="aannames" className="bg-white rounded-lg shadow-md p-6">
            <button
              type="button"
              onClick={() => setShowAssumptions((b) => !b)}
              className="text-sm font-semibold text-gray-900"
            >
              {showAssumptions ? '▾' : '▸'} Aannames en methode
            </button>
            {showAssumptions && (
              <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-4 text-xs text-gray-600">
                <div className="space-y-1.5">
                  {Object.entries(payload.methodology).map(([k, v]) => (
                    <p key={k}>
                      <span className="font-semibold text-gray-800 capitalize">{k.replaceAll('_', ' ')}:</span>{' '}
                      {v}
                    </p>
                  ))}
                </div>
                <div className="space-y-1.5">
                  <p className="font-semibold text-gray-800">Capaciteitsmodel</p>
                  <p>
                    {payload.capacity_defaults.pakketten_pp_jaar} pakketten per inwoner per jaar ·
                    verblijftijd {payload.capacity_defaults.verblijf_dagen.toLocaleString('nl-NL')} dagen ·
                    max. bezetting {Math.round(payload.capacity_defaults.bezetting_max * 100)}% ·
                    {' '}{payload.capacity_defaults.vakken_per_kolom.toLocaleString('nl-NL')} vakken per kolom ·
                    max. {payload.capacity_defaults.kolommen_per_kast_max} kolommen per kast.
                    Strekkende meters volgen de maatvoering uit de 3D-viewer:
                    49 cm per kolom plus 8 cm frame per kast.
                  </p>
                  <p>
                    Bestaand netwerk in deze gemeente: {nlInt(payload.existing.alle_punten)} pakketpunten,
                    waarvan {nlInt(payload.existing.automaten)} automaten.
                  </p>
                  <p className="text-gray-400">
                    Gegenereerd: {new Date(payload.generated_at).toLocaleString('nl-NL')}
                  </p>
                </div>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}

function StatTile({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: string;
  sub?: string;
  accent?: boolean;
}) {
  return (
    <div
      className={`rounded-lg shadow-md p-4 ${
        accent ? 'bg-blue-700 text-white' : 'bg-white'
      }`}
    >
      <div
        className={`text-[11px] uppercase tracking-wide font-semibold ${
          accent ? 'text-blue-200' : 'text-gray-500'
        }`}
      >
        {label}
      </div>
      <div className={`text-2xl font-bold mt-1 ${accent ? 'text-white' : 'text-gray-900'}`}>
        {value}
      </div>
      {sub && (
        <div className={`text-[11px] mt-0.5 ${accent ? 'text-blue-200' : 'text-gray-500'}`}>
          {sub}
        </div>
      )}
    </div>
  );
}
