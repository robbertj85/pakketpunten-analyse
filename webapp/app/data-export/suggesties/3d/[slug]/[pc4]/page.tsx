import { promises as fs } from 'fs';
import path from 'path';
import Link from 'next/link';
import Locker3DView from '@/components/Locker3DView';
import { PlacementSuggestionsPayload } from '@/components/PlacementSuggestionsReport';

async function readJson<T>(rel: string): Promise<T | null> {
  try {
    const p = path.join(process.cwd(), 'public', 'data', rel);
    return JSON.parse(await fs.readFile(p, 'utf-8')) as T;
  } catch {
    return null;
  }
}

export interface NearbyPoint {
  lat: number;
  lon: number;
  vervoerder: string;
  naam: string;
  distanceM: number;
}

function haversineM(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const R = 6371000;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLon = ((bLon - aLon) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((aLat * Math.PI) / 180) * Math.cos((bLat * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

interface GeoJson {
  features: Array<{
    geometry?: { type?: string; coordinates?: [number, number] };
    properties?: { type?: string; vervoerder?: string; locatieNaam?: string };
  }>;
}

/** Existing parcel points within `radiusM` of the suggestion (for the 3D context). */
async function nearbyPoints(slug: string, lat: number, lon: number, radiusM = 650): Promise<NearbyPoint[]> {
  const geo = await readJson<GeoJson>(`${slug}.geojson`);
  if (!geo?.features) return [];
  const out: NearbyPoint[] = [];
  for (const f of geo.features) {
    if (f.properties?.type !== 'pakketpunt') continue;
    const c = f.geometry?.coordinates;
    if (!c) continue;
    const d = haversineM(lat, lon, c[1], c[0]);
    if (d > radiusM) continue;
    out.push({
      lat: c[1],
      lon: c[0],
      vervoerder: f.properties.vervoerder ?? 'onbekend',
      naam: f.properties.locatieNaam ?? '',
      distanceM: Math.round(d),
    });
  }
  return out.sort((a, b) => a.distanceM - b.distanceM).slice(0, 60);
}

export default async function Locker3DPage({
  params,
}: {
  params: Promise<{ slug: string; pc4: string }>;
}) {
  const { slug, pc4 } = await params;
  const payload = await readJson<PlacementSuggestionsPayload>('placement_suggestions.json');

  const block = payload?.by_municipality?.[slug] ?? null;
  const idx = block?.pc4s.findIndex((r) => r.pc4 === pc4) ?? -1;
  const record = idx >= 0 ? block!.pc4s[idx] : null;

  if (!record || !record.suggestion) {
    return (
      <div className="p-6 bg-amber-50 border border-amber-200 rounded-lg text-amber-900">
        <h2 className="font-semibold mb-2">Suggestie niet gevonden</h2>
        <p className="text-sm">
          Geen plaatsingssuggestie voor PC4 {pc4} in {slug}.
        </p>
        <Link
          href={`/data-export/suggesties?gemeente=${slug}`}
          className="inline-block mt-3 text-sm text-blue-600 hover:text-blue-800"
        >
          ← Terug naar plaatsingsadvies
        </Link>
      </div>
    );
  }

  const s = record.suggestion;
  const nearby = await nearbyPoints(slug, s.lat, s.lon);
  return (
    <Locker3DView
      slug={slug}
      gemeente={block!.gemeente}
      pc4={record.pc4}
      lat={s.lat}
      lon={s.lon}
      bagId={s.bag_identificatie ?? null}
      bagGebruiksdoel={s.bag_gebruiksdoel ?? null}
      bagBouwjaar={s.bag_bouwjaar ?? null}
      estNewPop={s.est_new_pop_within_400m ?? null}
      rank={idx + 1}
      preSnapLat={s.pre_snap_lat ?? null}
      preSnapLon={s.pre_snap_lon ?? null}
      bagDistanceM={s.bag_distance_m ?? null}
      nearbyPoints={nearby}
    />
  );
}
