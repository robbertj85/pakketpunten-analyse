import { promises as fs } from 'fs';
import path from 'path';
import NetworkPlanner from '@/components/NetworkPlanner';

export const metadata = {
  title: 'Netwerkplanner pakketkluizen',
};

interface MunicipalityEntry {
  name: string;
  slug: string;
}

export default async function NetwerkplannerPage() {
  // Which municipalities have a computed network? (locker_network/{slug}.json)
  let slugs: string[] = [];
  try {
    const dir = path.join(process.cwd(), 'public', 'data', 'locker_network');
    slugs = (await fs.readdir(dir))
      .filter((f) => f.endsWith('.json'))
      .map((f) => f.replace(/\.json$/, ''));
  } catch {
    slugs = [];
  }

  if (slugs.length === 0) {
    return (
      <div className="p-6 bg-amber-50 border border-amber-200 rounded-lg text-amber-900">
        <h2 className="font-semibold mb-2">Nog geen netwerkdata</h2>
        <p className="text-sm">
          Genereer de netwerkdata eerst met{' '}
          <code className="font-mono bg-amber-100 px-1 rounded">
            python scripts/plan_locker_network.py --all
          </code>{' '}
          en herlaad deze pagina.
        </p>
      </div>
    );
  }

  // Names from municipalities.json, sorted Dutch-alphabetically.
  let names: Record<string, string> = {};
  try {
    const p = path.join(process.cwd(), 'public', 'municipalities.json');
    const all = JSON.parse(await fs.readFile(p, 'utf-8')) as MunicipalityEntry[];
    names = Object.fromEntries(all.map((m) => [m.slug, m.name]));
  } catch {
    names = {};
  }
  const municipalities = slugs
    .map((slug) => ({ slug, name: names[slug] ?? slug }))
    .sort((a, b) => a.name.localeCompare(b.name, 'nl'));

  const defaultSlug = slugs.includes('den-haag') ? 'den-haag' : municipalities[0].slug;

  return <NetworkPlanner municipalities={municipalities} defaultSlug={defaultSlug} />;
}
