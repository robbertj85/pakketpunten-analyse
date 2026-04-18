import { promises as fs } from 'fs';
import path from 'path';
import RegressionReport from '@/components/RegressionReport';
import type { PainpointsPayload, ScatterPoint } from '@/components/PainpointsReport';

// Same loader as the painpoints tab — we need the pain-point set to colour
// the scatter plot (red vs blue), plus the full PC4 feature row for each
// point so the client-side model builder has data to work with.
async function getPayload(): Promise<PainpointsPayload> {
  const root = path.join(process.cwd(), 'public', 'data');
  const painpoints = JSON.parse(
    await fs.readFile(path.join(root, 'pc4_painpoints.json'), 'utf-8')
  ) as PainpointsPayload;

  try {
    const stats = JSON.parse(
      await fs.readFile(path.join(root, 'pc4_stats.json'), 'utf-8')
    ) as { model?: PainpointsPayload['model']; stats?: Record<string, any> };

    if (stats.model) painpoints.model = stats.model;

    if (stats.stats) {
      const scatter: ScatterPoint[] = [];
      let sumArea = 0;
      let nAreaRows = 0;
      const round = (v: any, digits = 2): number | null => {
        if (v == null || typeof v !== 'number' || Number.isNaN(v)) return null;
        const m = 10 ** digits;
        return Math.round(v * m) / m;
      };
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
            avg_income: round(v.avg_income_household, 2),
            pct_low_income: round(v.pct_low_income_household, 1),
            pct_high_income: round(v.pct_high_income_household, 1),
            avg_woz: round(v.avg_woz_value, 0),
            ses_total: round(v.ses_woa_total, 3),
            ses_welvaart: round(v.ses_woa_welvaart, 3),
            ses_arbeid: round(v.ses_woa_arbeid, 3),
            urbanity: round(v.urbanity, 0),
            oad: round(v.oad, 0),
            pct_age_25_45: round(v.pct_age_25_45, 1),
            pct_single_hh: round(v.pct_single_hh, 1),
            pct_multi_family: round(v.pct_multi_family, 1),
            pct_owner_occupied: round(v.pct_owner_occupied, 0),
            horeca_1km: round(v.horeca_1km, 0),
            supermarket_1km: round(v.supermarket_1km, 0),
            station_km: round(v.station_km, 2),
            highway_km: round(v.highway_km, 2),
          });
          sumArea += area;
          nAreaRows += 1;
        }
      }
      painpoints.scatter = scatter;
      painpoints.mean_area_km2 = nAreaRows ? Number((sumArea / nAreaRows).toFixed(3)) : 0;
    }
  } catch {
    /* pc4_stats.json may be absent in fresh checkouts */
  }
  return painpoints;
}

export default async function SchattingPage() {
  const payload = await getPayload();
  return <RegressionReport payload={payload} />;
}
