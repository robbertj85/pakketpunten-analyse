import { promises as fs } from 'fs';
import path from 'path';
import PlacementSuggestionsReport, {
  PlacementSuggestionsPayload,
  PainpointsByPc4,
} from '@/components/PlacementSuggestionsReport';

async function readJson<T>(rel: string): Promise<T | null> {
  try {
    const p = path.join(process.cwd(), 'public', 'data', rel);
    return JSON.parse(await fs.readFile(p, 'utf-8')) as T;
  } catch {
    return null;
  }
}

interface PainpointsFile {
  painpoints: PainpointsByPc4;
}

export default async function SuggestiesPage() {
  const [payload, painpointsFile] = await Promise.all([
    readJson<PlacementSuggestionsPayload>('placement_suggestions.json'),
    readJson<PainpointsFile>('pc4_painpoints.json'),
  ]);
  if (!payload) {
    return (
      <div className="p-6 bg-amber-50 border border-amber-200 rounded-lg text-amber-900">
        <h2 className="font-semibold mb-2">placement_suggestions.json ontbreekt</h2>
        <p className="text-sm">
          Run{' '}
          <code className="bg-amber-100 px-1 rounded">
            python scripts/fit_pc4_model.py
          </code>{' '}
          gevolgd door{' '}
          <code className="bg-amber-100 px-1 rounded">
            python scripts/suggest_placements.py
          </code>{' '}
          om de dataset te genereren.
        </p>
      </div>
    );
  }
  return (
    <PlacementSuggestionsReport
      payload={payload}
      painpoints={painpointsFile?.painpoints ?? null}
    />
  );
}
