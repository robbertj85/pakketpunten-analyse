import { promises as fs } from 'fs';
import path from 'path';
import PainpointsReport, { PainpointsPayload, ScatterPoint } from '@/components/PainpointsReport';

async function getPainpoints(): Promise<PainpointsPayload> {
  const root = path.join(process.cwd(), 'public', 'data');
  const painpoints = JSON.parse(
    await fs.readFile(path.join(root, 'pc4_painpoints.json'), 'utf-8')
  ) as PainpointsPayload;

  try {
    const stats = JSON.parse(
      await fs.readFile(path.join(root, 'pc4_stats.json'), 'utf-8')
    ) as { model?: PainpointsPayload['model']; stats?: Record<string, any> };

    if (stats.model) painpoints.model = stats.model;

    // Compact scatter data: one row per PC4 with non-zero population.
    // Keeps JSON small (~100 KB) for the client bundle.
    if (stats.stats) {
      const scatter: ScatterPoint[] = [];
      let sumArea = 0;
      let nAreaRows = 0;
      for (const [pc4, v] of Object.entries(stats.stats)) {
        const pop = v.population ?? 0;
        const area = v.area_km2 ?? 0;
        const actual = v.parcel_points?.total ?? 0;
        if (pop >= 10 && area >= 0.05) {
          scatter.push({
            pc4,
            pop,
            area: Number(area.toFixed(3)),
            actual,
            predicted: Number((v.predicted_points ?? 0).toFixed(2)),
          });
          sumArea += area;
          nAreaRows += 1;
        }
      }
      painpoints.scatter = scatter;
      painpoints.mean_area_km2 = nAreaRows ? Number((sumArea / nAreaRows).toFixed(3)) : 0;
    }
  } catch {
    // pc4_stats.json may be absent in fresh checkouts
  }
  return painpoints;
}

export default async function PainpointsReportPage() {
  const payload = await getPainpoints();
  return <PainpointsReport payload={payload} />;
}
