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
    ) as {
      model?: PainpointsPayload['model'];
      model_k8?: PainpointsPayload['model_k8'];
      stats?: Record<string, any>;
    };

    if (stats.model) painpoints.model = stats.model;
    if (stats.model_k8) painpoints.model_k8 = stats.model_k8;

    // Compact scatter data: one row per PC4 with non-zero population.
    // Extra CBS features (income, SES-WOA) travel along so the client-side
    // model builder can re-fit OLS with any subset without a round trip.
    // Numbers are truncated to modest precision to keep the gzipped payload
    // well under 500 KB.
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
    // pc4_stats.json may be absent in fresh checkouts
  }
  return painpoints;
}

export default async function PainpointsReportPage() {
  const payload = await getPainpoints();
  return <PainpointsReport payload={payload} />;
}
