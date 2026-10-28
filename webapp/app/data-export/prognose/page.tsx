import { promises as fs } from 'fs';
import path from 'path';
import ForecastReport from '@/components/ForecastReport';
import type { ForecastIndex, NationalForecast } from '@/types/forecast';

async function readJson<T>(rel: string): Promise<T | null> {
  try {
    const p = path.join(process.cwd(), 'public', 'data', rel);
    return JSON.parse(await fs.readFile(p, 'utf-8')) as T;
  } catch {
    return null;
  }
}

export default async function PrognosePage() {
  // Per-gemeente files are fetched client-side on selection; only the national
  // forecast and the ranking index ship with the page.
  const [national, index] = await Promise.all([
    readJson<NationalForecast>('forecast/national.json'),
    readJson<ForecastIndex>('forecast/index.json'),
  ]);
  if (!national || !index) {
    return (
      <div className="p-6 bg-warning-muted border border-border rounded-lg text-foreground">
        <h2 className="font-semibold mb-2">Prognosedata ontbreekt</h2>
        <p className="text-sm">
          Run <code className="bg-secondary px-1 rounded">python scripts/point_history.py --backfill</code>{' '}
          en daarna <code className="bg-secondary px-1 rounded">python scripts/forecast_growth.py</code>.
        </p>
      </div>
    );
  }
  return <ForecastReport national={national} index={index} />;
}
