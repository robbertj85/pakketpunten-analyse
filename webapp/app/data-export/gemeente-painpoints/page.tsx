import { promises as fs } from 'fs';
import path from 'path';
import GemeentePainpointsReport from '@/components/GemeentePainpointsReport';
import type { PainpointsPayload } from '@/components/PainpointsReport';

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
    };
    if (stats.model) painpoints.model = stats.model;
    if (stats.model_k8) painpoints.model_k8 = stats.model_k8;
  } catch {
    // pc4_stats.json may be absent in fresh checkouts
  }
  return painpoints;
}

export default async function GemeentePainpointsReportPage() {
  const payload = await getPainpoints();
  return <GemeentePainpointsReport payload={payload} />;
}
