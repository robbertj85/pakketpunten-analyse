import { promises as fs } from 'fs';
import path from 'path';
import PainpointsReport, { PainpointsPayload } from '@/components/PainpointsReport';

async function getPainpoints(): Promise<PainpointsPayload> {
  const root = path.join(process.cwd(), 'public', 'data');
  const painpoints = JSON.parse(
    await fs.readFile(path.join(root, 'pc4_painpoints.json'), 'utf-8')
  ) as PainpointsPayload;
  try {
    const stats = JSON.parse(
      await fs.readFile(path.join(root, 'pc4_stats.json'), 'utf-8')
    ) as { model?: PainpointsPayload['model'] };
    if (stats.model) painpoints.model = stats.model;
  } catch {
    // pc4_stats.json may be absent in fresh checkouts
  }
  return painpoints;
}

export default async function PainpointsReportPage() {
  const payload = await getPainpoints();
  return <PainpointsReport payload={payload} />;
}
