'use client';

import { useEffect, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import type { Feature, Point } from 'geojson';

import { haversineM } from '@/lib/pilotLocations';
import type { ContextPoint, SportLocation } from '@/components/SportLocationsMap';

const SportLocationsMap = dynamic(() => import('@/components/SportLocationsMap'), {
  ssr: false,
  loading: () => (
    <div className="w-full h-full flex items-center justify-center bg-secondary text-sm text-subtle-foreground">
      Kaart laden...
    </div>
  ),
});

const DATA_URL = '/data/sportlocaties/sportlocaties_rotterdam.geojson';
const RADII = [300, 400, 500] as const;

interface ExportData {
  metadata: {
    generated_at: string;
    gemeente_status?: string;
    downloads: { gpkg: string; qgis: string };
  };
  features: Feature[];
}

interface Geo {
  features: Array<{
    geometry?: { coordinates?: [number, number] };
    properties?: { type?: string; vervoerder?: string; locatieNaam?: string };
  }>;
}

export default function SportlocatiesPage() {
  const [data, setData] = useState<ExportData | null>(null);
  const [contextPoints, setContextPoints] = useState<ContextPoint[]>([]);
  const [radius, setRadius] = useState<number>(400);
  const [showContext, setShowContext] = useState(true);
  const [selectedNr, setSelectedNr] = useState<number | null>(null);

  useEffect(() => {
    fetch(DATA_URL)
      .then((res) => res.json())
      .then(setData)
      .catch(() => setData(null));
    fetch('/data/rotterdam.geojson')
      .then((res) => res.json())
      .then((geo: Geo) => {
        const pts: ContextPoint[] = [];
        for (const f of geo.features ?? []) {
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
      .catch(() => setContextPoints([]));
  }, []);

  const { locations, pc4ByNr, carrierPainpoints, gemeentePainpoints } = useMemo(() => {
    const locs: SportLocation[] = [];
    const pc4: Record<number, string | null> = {};
    const carriers: Feature[] = [];
    const gemeente: Feature[] = [];
    for (const f of data?.features ?? []) {
      const p = f.properties ?? {};
      if (p.laag === 'sportlocatie') {
        const [lon, lat] = (f.geometry as Point).coordinates;
        locs.push({ nr: p.nr, naam: p.naam, adres: p.adres, lat, lon });
        pc4[p.nr] = p.pc4_pijnpunt ?? null;
      } else if (p.laag === 'pijnpunt_carriers') carriers.push(f);
      else if (p.laag === 'pijnpunt_gemeente') gemeente.push(f);
    }
    return { locations: locs, pc4ByNr: pc4, carrierPainpoints: carriers, gemeentePainpoints: gemeente };
  }, [data]);

  const painpointByPc4 = useMemo(() => {
    const out: Record<string, { carriers?: string; gemeente: boolean }> = {};
    for (const f of carrierPainpoints) out[f.properties!.pc4] = { carriers: f.properties!.carriers, gemeente: false };
    for (const f of gemeentePainpoints) {
      const pc4 = f.properties!.pc4;
      out[pc4] = { ...out[pc4], gemeente: true };
    }
    return out;
  }, [carrierPainpoints, gemeentePainpoints]);

  const nearbyCounts = useMemo(() => {
    const out: Record<number, number> = {};
    for (const loc of locations) {
      out[loc.nr] = contextPoints.filter(
        (p) => haversineM(loc.lat, loc.lon, p.lat, p.lon) <= radius,
      ).length;
    }
    return out;
  }, [locations, contextPoints, radius]);

  const downloads = data?.metadata.downloads;

  return (
    <div className="space-y-6">
      <section
        data-tour="intro"
        className="bg-card rounded-lg shadow-sm border border-border overflow-hidden"
      >
        <div className="px-6 py-4 border-b border-border bg-accent">
          <h2 className="font-semibold text-accent-foreground">Sportlocaties Rotterdam</h2>
          <p className="text-sm text-primary">
            {locations.length || 8} sportcomplexen naast de PC4-pijnpunten van carriers en gemeente
          </p>
        </div>
        <div className="px-6 py-5 text-sm text-foreground leading-relaxed space-y-3">
          <p>
            Sportcomplexen in de gemeente Rotterdam als mogelijke plek voor een pakketkluis. De
            kaart toont daarnaast de <strong>postcodegebieden (PC4) die carriers als
            pijnpunt</strong> hebben aangemerkt, en de pijnpunten die de{' '}
            <strong>gemeente zelf</strong> heeft aangeleverd.
          </p>
          {data?.metadata.gemeente_status && data.metadata.gemeente_status !== 'ontvangen' && (
            <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded px-3 py-2">
              De pijnpunten van de gemeente Rotterdam zijn nog niet ontvangen (status:{' '}
              {data.metadata.gemeente_status}). Zodra ze binnen zijn verschijnen ze hier als
              paarse omlijning.
            </p>
          )}
        </div>
      </section>

      <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-4">
        <div className="flex flex-wrap items-end gap-6">
          <div>
            <label className="block text-xs font-medium text-subtle-foreground mb-1">
              Loopafstand
            </label>
            <div className="inline-flex rounded-lg border border-input overflow-hidden bg-card">
              {RADII.map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => setRadius(r)}
                  className={`px-3 py-2 text-sm font-medium transition-colors ${
                    radius === r
                      ? 'bg-primary text-primary-foreground'
                      : 'text-muted-foreground hover:bg-muted'
                  }`}
                >
                  {r} m
                </button>
              ))}
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm text-foreground pb-2">
            <input
              type="checkbox"
              checked={showContext}
              onChange={(e) => setShowContext(e.target.checked)}
            />
            Bestaande pakketpunten tonen
          </label>
        </div>

        <div data-tour="downloads" className="flex flex-wrap gap-2">
          <a
            href={downloads?.gpkg}
            download
            className="px-4 py-2 text-sm font-medium text-primary-foreground bg-primary hover:bg-primary/90 rounded-lg"
          >
            Download GeoPackage
          </a>
          <a
            href={downloads?.qgis}
            download
            className="px-4 py-2 text-sm font-medium text-muted-foreground bg-card border border-input hover:bg-muted rounded-lg"
          >
            Download QGIS-project
          </a>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)] gap-6 items-start">
        <div data-tour="lijst" className="space-y-3">
          {locations.map((loc) => {
            const active = loc.nr === selectedNr;
            const pc4 = pc4ByNr[loc.nr];
            const pijn = pc4 ? painpointByPc4[pc4] : undefined;
            return (
              <button
                key={loc.nr}
                type="button"
                onClick={() => setSelectedNr(loc.nr)}
                className={`w-full text-left bg-card rounded-lg border shadow-sm transition-colors px-5 py-4 ${
                  active
                    ? 'border-primary ring-2 ring-blue-100'
                    : 'border-border hover:border-input hover:bg-muted'
                }`}
              >
                <div className="flex items-start gap-3">
                  <span className="flex-shrink-0 w-7 h-7 rounded-full text-white text-sm font-bold flex items-center justify-center bg-orange-700">
                    {loc.nr}
                  </span>
                  <div className="min-w-0 flex-1">
                    <h3 className="text-sm font-semibold text-foreground">{loc.naam}</h3>
                    <p className="text-xs text-muted-foreground mt-0.5">{loc.adres}</p>
                    <p className="text-xs text-subtle-foreground mt-1.5">
                      <strong className="text-muted-foreground">{nearbyCounts[loc.nr] ?? '-'}</strong>{' '}
                      bestaande pakketpunt{nearbyCounts[loc.nr] === 1 ? '' : 'en'} binnen {radius} m
                    </p>
                    {pijn && (
                      <div className="flex flex-wrap gap-1.5 mt-2">
                        {pijn.carriers && (
                          <span className="px-1.5 py-px text-[10px] font-semibold rounded border bg-red-50 text-red-800 border-red-200">
                            PC4 {pc4} pijnpunt carriers: {pijn.carriers}
                          </span>
                        )}
                        {pijn.gemeente && (
                          <span className="px-1.5 py-px text-[10px] font-semibold rounded border bg-violet-50 text-violet-800 border-violet-200">
                            PC4 {pc4} pijnpunt gemeente
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </button>
            );
          })}
        </div>

        <div
          data-tour="kaart"
          className="bg-card rounded-lg shadow-sm border border-border overflow-hidden lg:sticky lg:top-4"
        >
          <div className="h-[640px]">
            <SportLocationsMap
              locations={locations}
              selectedNr={selectedNr}
              onSelect={setSelectedNr}
              carrierPainpoints={carrierPainpoints}
              gemeentePainpoints={gemeentePainpoints}
              contextPoints={contextPoints}
              showContext={showContext}
              radiusM={radius}
            />
          </div>
          <div className="px-4 py-2 text-[11px] text-subtle-foreground border-t border-border flex flex-wrap gap-x-5 gap-y-1">
            <span className="flex items-center gap-1.5">
              <span className="w-3 h-3 rounded-full bg-orange-700" /> Sportlocatie + loopafstand
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-3 h-3 border border-red-700 bg-red-600/25" /> Pijnpunt carriers (
              {carrierPainpoints.length} PC4)
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-3 h-3 border-2 border-violet-600" /> Pijnpunt gemeente (
              {gemeentePainpoints.length} PC4)
            </span>
            <span>Kleine bollen: bestaande pakketpunten per vervoerder</span>
          </div>
        </div>
      </div>

      <p className="text-xs text-subtle-foreground italic">
        Adressen gegeocodeerd via PDOK Locatieserver (BAG). Pijnpunten uit de PC4-uitvraag bij
        carriers en G4-gemeenten. GeoPackage en QGIS-project bevatten dezelfde lagen, met
        ingebedde stijlen
        {data ? `; gegenereerd ${new Date(data.metadata.generated_at).toLocaleDateString('nl-NL')}` : ''}.
      </p>
    </div>
  );
}
