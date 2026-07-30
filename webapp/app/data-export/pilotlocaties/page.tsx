'use client';

import { useEffect, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';

import {
  PILOT_LOCATIONS,
  STATUS_META,
  TYPE_META,
  haversineM,
  pilotGemeenten,
  streetViewUrl,
  type PilotLocation,
  type PilotStatus,
} from '@/lib/pilotLocations';
import type { ContextPoint } from '@/components/PilotLocationsMap';

const PilotLocationsMap = dynamic(() => import('@/components/PilotLocationsMap'), {
  ssr: false,
  loading: () => (
    <div className="w-full h-full flex items-center justify-center bg-gray-100 text-sm text-gray-500">
      Kaart laden...
    </div>
  ),
});

const RADII = [300, 400, 500] as const;

const COORD_BRON_LABEL: Record<PilotLocation['coordBron'], string> = {
  aangeleverd: 'coordinaat aangeleverd',
  'pdok-bag': 'gegeocodeerd via PDOK/BAG',
  osm: 'coordinaat uit OpenStreetMap',
  kaartpin: 'coordinaat uit gedeelde kaartpin',
};

interface Geo {
  features: Array<{
    geometry?: { coordinates?: [number, number] };
    properties?: { type?: string; vervoerder?: string; locatieNaam?: string };
  }>;
}

export default function PilotlocatiesPage() {
  const gemeenten = useMemo(() => pilotGemeenten(), []);
  const [slug, setSlug] = useState(gemeenten[0]?.slug ?? '');
  const [radius, setRadius] = useState<number>(400);
  const [contextPoints, setContextPoints] = useState<ContextPoint[]>([]);
  const [loadingPoints, setLoadingPoints] = useState(true);

  const locations = useMemo(
    () => PILOT_LOCATIONS.filter((l) => l.slug === slug).sort((a, b) => a.rang - b.rang),
    [slug],
  );
  const [pickedId, setPickedId] = useState<string | null>(null);
  // Selectie afleiden in plaats van resetten via een effect: wisselt de
  // gemeente, dan valt de vorige keuze buiten `locations` en pakt de lijst
  // automatisch de eerste locatie.
  const selected = locations.find((l) => l.id === pickedId) ?? locations[0] ?? null;
  const selectedId = selected?.id ?? null;

  // Bestaande pakketpunten van de gemeente ophalen — context op de kaart en
  // input voor het aantal punten binnen loopafstand per pilotlocatie.
  useEffect(() => {
    if (!slug) return;
    let cancelled = false;
    setLoadingPoints(true);
    setContextPoints([]);
    fetch(`/data/${slug}.geojson`)
      .then((res) => res.json())
      .then((data: Geo) => {
        if (cancelled) return;
        const pts: ContextPoint[] = [];
        for (const f of data.features ?? []) {
          if (f.properties?.type !== 'pakketpunt') continue;
          const c = f.geometry?.coordinates;
          if (!c) continue;
          pts.push({
            lat: c[1],
            lon: c[0],
            vervoerder: f.properties.vervoerder ?? 'onbekend',
            naam: f.properties.locatieNaam ?? '',
          });
        }
        setContextPoints(pts);
      })
      .catch(() => setContextPoints([]))
      .finally(() => {
        if (!cancelled) setLoadingPoints(false);
      });
    return () => {
      cancelled = true;
    };
  }, [slug]);

  /** Aantal bestaande pakketpunten binnen de gekozen loopafstand, per locatie. */
  const nearbyCounts = useMemo(() => {
    const out: Record<string, number> = {};
    for (const loc of locations) {
      out[loc.id] = contextPoints.filter(
        (p) => haversineM(loc.lat, loc.lon, p.lat, p.lon) <= radius,
      ).length;
    }
    return out;
  }, [locations, contextPoints, radius]);

  const statusTelling = useMemo(() => {
    const out: Partial<Record<PilotStatus, number>> = {};
    for (const loc of locations) out[loc.status] = (out[loc.status] ?? 0) + 1;
    return out;
  }, [locations]);

  return (
    <div className="space-y-6">
      {/* Intro */}
      <section
        data-tour="intro"
        className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden"
      >
        <div className="px-6 py-4 border-b border-gray-100 bg-blue-50">
          <h2 className="font-semibold text-blue-900">Kandidaat-pilotlocaties</h2>
          <p className="text-sm text-blue-700">
            Werklijst uit de gesprekken met gemeenten — {PILOT_LOCATIONS.length} locaties in{' '}
            {gemeenten.length} gemeenten
          </p>
        </div>
        <div className="px-6 py-5 text-sm text-gray-800 leading-relaxed space-y-3">
          <p>
            Deze pagina bundelt de locaties die in gesprekken met gemeenten naar voren zijn
            gekomen als mogelijke plek voor een pilot met een pakketkluis. Het is een{' '}
            <strong>handmatige lijst</strong>: de locaties komen uit overleg, niet uit het
            rekenmodel. Wil je zien welke plekken het model aandraagt, gebruik dan{' '}
            <Link href="/data-export/suggesties" className="text-blue-600 hover:text-blue-800">
              Plaatsingsadvies
            </Link>{' '}
            of de{' '}
            <Link
              href="/data-export/netwerkplanner"
              className="text-blue-600 hover:text-blue-800"
            >
              Netwerkplanner
            </Link>
            .
          </p>
          <p>
            Per locatie staat vermeld waar het coordinaat vandaan komt en wat er nog
            geverifieerd moet worden. Toets de inrichting altijd aan de{' '}
            <Link
              href="/data-export/beleidsprincipes"
              className="text-blue-600 hover:text-blue-800"
            >
              beleidsprincipes
            </Link>{' '}
            van de betreffende gemeente.
          </p>
        </div>
      </section>

      {/* Gemeente + loopafstand */}
      <div
        data-tour="gemeente-select"
        className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4"
      >
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Gemeente</label>
          <div className="flex gap-2">
            {gemeenten.map((g) => (
              <button
                key={g.slug}
                type="button"
                onClick={() => setSlug(g.slug)}
                className={`px-4 py-2 text-sm font-medium rounded-lg border transition-colors ${
                  slug === g.slug
                    ? 'bg-blue-600 text-white border-blue-600'
                    : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
                }`}
              >
                {g.gemeente}
                <span
                  className={`ml-2 text-xs ${
                    slug === g.slug ? 'text-blue-100' : 'text-gray-500'
                  }`}
                >
                  {g.aantal}
                </span>
              </button>
            ))}
          </div>
        </div>
        <div data-tour="loopafstand">
          <label className="block text-xs font-medium text-gray-500 mb-1">
            Loopafstand voor omgevingscheck
          </label>
          <div className="inline-flex rounded-lg border border-gray-300 overflow-hidden bg-white">
            {RADII.map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => setRadius(r)}
                className={`px-3 py-2 text-sm font-medium transition-colors ${
                  radius === r
                    ? 'bg-blue-600 text-white'
                    : 'text-gray-700 hover:bg-gray-50'
                }`}
              >
                {r} m
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Statuslegenda */}
      <div
        data-tour="legenda"
        className="bg-white rounded-lg shadow-sm border border-gray-200 px-6 py-4"
      >
        <div className="flex flex-wrap gap-x-8 gap-y-3">
          {(Object.keys(STATUS_META) as PilotStatus[]).map((s) => (
            <div key={s} className="flex items-start gap-2 text-xs">
              <span
                className="flex-shrink-0 mt-1 w-2.5 h-2.5 rounded-full"
                style={{ background: STATUS_META[s].dot }}
              />
              <div>
                <div className="font-semibold text-gray-900">
                  {STATUS_META[s].label}
                  {statusTelling[s] ? (
                    <span className="ml-1 font-normal text-gray-500">
                      ({statusTelling[s]})
                    </span>
                  ) : null}
                </div>
                <div className="text-gray-600 max-w-[15rem]">{STATUS_META[s].uitleg}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] gap-6 items-start">
        {/* Lijst */}
        <div data-tour="lijst" className="space-y-3">
          {locations.map((loc) => {
            const active = loc.id === selectedId;
            const count = nearbyCounts[loc.id];
            return (
              <button
                key={loc.id}
                type="button"
                onClick={() => setPickedId(loc.id)}
                className={`w-full text-left bg-white rounded-lg border shadow-sm transition-colors px-5 py-4 ${
                  active
                    ? 'border-blue-500 ring-2 ring-blue-100'
                    : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
                }`}
              >
                <div className="flex items-start gap-3">
                  <span
                    className="flex-shrink-0 w-7 h-7 rounded-full text-white text-sm font-bold flex items-center justify-center"
                    style={{ background: STATUS_META[loc.status].dot }}
                  >
                    {loc.rang}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-sm font-semibold text-gray-900">{loc.naam}</h3>
                      <span
                        className={`px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide rounded border ${
                          STATUS_META[loc.status].badge
                        }`}
                      >
                        {STATUS_META[loc.status].label}
                      </span>
                    </div>
                    <p className="text-xs text-gray-600 mt-0.5">
                      {loc.adres ?? TYPE_META[loc.type].label}
                    </p>
                    <p className="text-xs text-gray-500 mt-1.5">
                      {TYPE_META[loc.type].label}
                      {' · '}
                      {loadingPoints || count === undefined ? (
                        <span className="text-gray-400">punten laden...</span>
                      ) : (
                        <>
                          <strong className="text-gray-700">{count}</strong> bestaande
                          pakketpunt{count === 1 ? '' : 'en'} binnen {radius} m
                        </>
                      )}
                    </p>
                    {loc.letOp && (
                      <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded px-2 py-1 mt-2">
                        Let op: {loc.letOp}
                      </p>
                    )}
                  </div>
                </div>
              </button>
            );
          })}
        </div>

        {/* Kaart + detail */}
        <div className="space-y-4 lg:sticky lg:top-4">
          <div
            data-tour="kaart"
            className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden"
          >
            <div className="h-[420px]">
              <PilotLocationsMap
                locations={locations}
                selectedId={selectedId}
                onSelect={setPickedId}
                contextPoints={contextPoints}
                radiusM={radius}
              />
            </div>
            <p className="px-4 py-2 text-[11px] text-gray-500 border-t border-gray-100">
              Genummerde bollen zijn pilotlocaties (kleur = status). Kleine bollen zijn
              bestaande pakketpunten in de omgeving, gekleurd per vervoerder. De
              stippellijn is de gekozen loopafstand van {radius} m. Klik een bol voor de
              details en een Street View-link.
            </p>
          </div>

          {selected && (
            <div
              data-tour="detail"
              className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden"
            >
              <div className="px-6 py-4 border-b border-gray-100 bg-gray-50">
                <h3 className="font-semibold text-gray-900">
                  {selected.rang}. {selected.naam}
                </h3>
                <p className="text-xs text-gray-600 mt-0.5">
                  {selected.gemeente}
                  {selected.adres ? ` · ${selected.adres}` : ''}
                </p>
              </div>
              <div className="px-6 py-5 space-y-4 text-sm text-gray-800">
                <div>
                  <div className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">
                    Type locatie
                  </div>
                  <p className="font-medium">{TYPE_META[selected.type].label}</p>
                  <p className="text-xs text-gray-600 mt-0.5">
                    {TYPE_META[selected.type].uitleg}
                  </p>
                </div>

                <div>
                  <div className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">
                    Toelichting
                  </div>
                  <ul className="space-y-2">
                    {selected.toelichting.map((t, i) => (
                      <li key={i} className="flex gap-3">
                        <span
                          className="flex-shrink-0 mt-1.5 w-1.5 h-1.5 rounded-full"
                          style={{ background: STATUS_META[selected.status].dot }}
                        />
                        <span className="leading-relaxed">{t}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                {selected.vervolg && (
                  <div className="bg-blue-50 border border-blue-200 rounded px-4 py-3">
                    <div className="text-xs font-semibold text-blue-900 uppercase tracking-wide mb-1">
                      Vervolgstap
                    </div>
                    <p className="text-sm text-blue-900">{selected.vervolg}</p>
                  </div>
                )}

                <div className="grid grid-cols-2 gap-4 pt-1">
                  <div>
                    <div className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">
                      Coordinaat
                    </div>
                    <p className="font-mono text-xs text-gray-800">
                      {selected.lat.toFixed(6)}, {selected.lon.toFixed(6)}
                    </p>
                    <p className="text-[11px] text-gray-500 mt-0.5">
                      {COORD_BRON_LABEL[selected.coordBron]}
                    </p>
                  </div>
                  <div>
                    <div className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">
                      Binnen {radius} m
                    </div>
                    <p className="text-gray-800">
                      {loadingPoints ? (
                        <span className="text-gray-400 text-xs">laden...</span>
                      ) : (
                        <>
                          <strong>{nearbyCounts[selected.id] ?? 0}</strong> bestaande
                          pakketpunten
                        </>
                      )}
                    </p>
                  </div>
                </div>

                <div className="flex flex-wrap gap-2 pt-2 border-t border-gray-100">
                  <Link
                    href={`/data-export/netwerkplanner/3d/${selected.slug}?lat=${selected.lat}&lon=${selected.lon}&label=${encodeURIComponent(
                      selected.naam,
                    )}&afstand=${radius}&back=${encodeURIComponent('/data-export/pilotlocaties')}`}
                    className="px-3 py-2 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg"
                  >
                    3D-weergave
                  </Link>
                  <a
                    href={streetViewUrl(selected.lat, selected.lon)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="px-3 py-2 text-xs font-medium text-gray-700 bg-white border border-gray-300 hover:bg-gray-50 rounded-lg"
                  >
                    Street View
                  </a>
                  <a
                    href={`https://www.openstreetmap.org/?mlat=${selected.lat}&mlon=${selected.lon}#map=18/${selected.lat}/${selected.lon}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="px-3 py-2 text-xs font-medium text-gray-700 bg-white border border-gray-300 hover:bg-gray-50 rounded-lg"
                  >
                    Open in OpenStreetMap
                  </a>
                  {selected.bron && (
                    <a
                      href={selected.bron.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="px-3 py-2 text-xs font-medium text-gray-700 bg-white border border-gray-300 hover:bg-gray-50 rounded-lg"
                    >
                      {selected.bron.label}
                    </a>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      <p className="text-xs text-gray-500 italic">
        Handmatig bijgehouden lijst uit gesprekken met gemeenten. Status en locaties kunnen
        wijzigen; aan deze pagina kunnen geen rechten worden ontleend.
      </p>
    </div>
  );
}
