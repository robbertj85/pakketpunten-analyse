import { promises as fs } from 'fs';
import path from 'path';
import Link from 'next/link';
import Locker3DView from '@/components/Locker3DView';
import { PlacementSuggestionsPayload } from '@/components/PlacementSuggestionsReport';
import { nearbyParcelPoints } from '@/lib/nearbyParcelPoints';

async function readJson<T>(rel: string): Promise<T | null> {
  try {
    const p = path.join(process.cwd(), 'public', 'data', rel);
    return JSON.parse(await fs.readFile(p, 'utf-8')) as T;
  } catch {
    return null;
  }
}

export default async function Locker3DPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string; pc4: string }>;
  searchParams: Promise<{ rank?: string }>;
}) {
  const { slug, pc4 } = await params;
  const { rank: rankParam } = await searchParams;
  const payload = await readJson<PlacementSuggestionsPayload>('placement_suggestions.json');

  const block = payload?.by_municipality?.[slug] ?? null;
  const idx = block?.pc4s.findIndex((r) => r.pc4 === pc4) ?? -1;
  const record = idx >= 0 ? block!.pc4s[idx] : null;

  // Plek 1/2/3 within the PC4 (?rank=2). Falls back to the legacy single
  // `suggestion` field for payloads generated before the top-3 upgrade.
  const spots = record?.suggestions ?? (record?.suggestion ? [record.suggestion] : []);
  const spotRank = Math.max(1, Math.min(spots.length, parseInt(rankParam ?? '1', 10) || 1));
  const s = spots[spotRank - 1] ?? null;

  if (!record || !s) {
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

  const nearby = await nearbyParcelPoints(slug, s.lat, s.lon);
  const heading =
    spots.length > 1
      ? `Locker in beeld — PC4 ${record.pc4}, plek ${spotRank}`
      : undefined;
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
      poiCategory={s.poi_category ?? null}
      poiNaam={s.poi_naam ?? null}
      poiDistanceM={s.poi_distance_m ?? null}
      heading={heading}
    />
  );
}
