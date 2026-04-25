import { promises as fs } from 'fs';
import path from 'path';
import PopulationReachReport, {
  PopulationReachPayload,
} from '@/components/PopulationReachReport';

async function getPayload(): Promise<PopulationReachPayload | null> {
  try {
    const p = path.join(process.cwd(), 'public', 'data', 'population_coverage.json');
    return JSON.parse(await fs.readFile(p, 'utf-8')) as PopulationReachPayload;
  } catch {
    return null;
  }
}

export default async function BereikPage() {
  const payload = await getPayload();
  if (!payload) {
    return (
      <div className="p-6 bg-amber-50 border border-amber-200 rounded-lg text-amber-900">
        <h2 className="font-semibold mb-2">population_coverage.json ontbreekt</h2>
        <p className="text-sm">
          Run <code className="bg-amber-100 px-1 rounded">
            python scripts/compute_population_coverage.py
          </code> om de dataset te genereren.
        </p>
      </div>
    );
  }
  return <PopulationReachReport payload={payload} />;
}
