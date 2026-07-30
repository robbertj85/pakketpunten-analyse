import { promises as fs } from 'fs';
import path from 'path';
import Link from 'next/link';
import Locker3DView from '@/components/Locker3DView';
import { nearbyParcelPoints } from '@/lib/nearbyParcelPoints';

// Generic 3D entry for netwerkplanner lockers: the location comes entirely
// from query params (lat/lon + display context), so any planned pick can be
// visualised without a placement_suggestions record. The wall snap and
// building context resolve themselves from 3DBAG around the coordinate.

function parseNum(v: string | undefined): number | null {
  if (!v) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

async function gemeenteName(slug: string): Promise<string> {
  try {
    const p = path.join(process.cwd(), 'public', 'municipalities.json');
    const all = JSON.parse(await fs.readFile(p, 'utf-8')) as Array<{ name: string; slug: string }>;
    return all.find((m) => m.slug === slug)?.name ?? slug;
  } catch {
    return slug;
  }
}

export default async function NetworkLocker3DPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { slug } = await params;
  const sp = await searchParams;
  const lat = parseNum(sp.lat);
  const lon = parseNum(sp.lon);

  // NL bounds check — reject junk coordinates early.
  const valid =
    lat != null && lon != null && lat > 50.5 && lat < 53.8 && lon > 3.1 && lon < 7.3;

  // Andere data-export-pagina's (bijv. Pilotlocaties) linken hier ook naartoe.
  // Alleen interne data-export-paden accepteren, zodat `back` geen open
  // redirect wordt.
  const fromPilots = sp.back === '/data-export/pilotlocaties';
  const backHref = fromPilots ? sp.back! : `/data-export/netwerkplanner?gemeente=${slug}`;
  const backLabel = fromPilots ? 'Terug naar pilotlocaties' : 'Terug naar netwerkplanner';

  if (!valid) {
    return (
      <div className="p-6 bg-amber-50 border border-amber-200 rounded-lg text-amber-900">
        <h2 className="font-semibold mb-2">Locatie niet gevonden</h2>
        <p className="text-sm">
          Deze 3D-weergave verwacht geldige <code className="font-mono">lat</code> en{' '}
          <code className="font-mono">lon</code> parameters binnen Nederland.
        </p>
        <Link
          href={backHref}
          className="inline-block mt-3 text-sm text-blue-600 hover:text-blue-800"
        >
          ← Terug naar netwerkplanner
        </Link>
      </div>
    );
  }

  const label = sp.label || 'Kluislocatie';
  const rank = parseNum(sp.rank);
  const gain = parseNum(sp.gain);
  const cols = parseNum(sp.cols);

  const [gemeente, nearby] = await Promise.all([
    gemeenteName(slug),
    nearbyParcelPoints(slug, lat!, lon!),
  ]);

  return (
    <Locker3DView
      slug={slug}
      gemeente={gemeente}
      pc4=""
      lat={lat!}
      lon={lon!}
      bagId={sp.bag ?? null}
      bagGebruiksdoel={null}
      bagBouwjaar={null}
      estNewPop={gain}
      rank={rank}
      nearbyPoints={nearby}
      heading={`Kluislocatie — ${label}`}
      backHref={backHref}
      backLabel={backLabel}
      initialColumns={cols ?? undefined}
      poiCategory={sp.type ?? null}
      poiNaam={sp.type ? label : null}
    />
  );
}
