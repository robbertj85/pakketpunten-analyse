import { promises as fs } from 'fs';
import path from 'path';
import GemeentePainpointsReport from '@/components/GemeentePainpointsReport';
import type { PainpointsPayload } from '@/components/PainpointsReport';

async function getPainpoints(): Promise<PainpointsPayload> {
  const root = path.join(process.cwd(), 'public', 'data');
  return JSON.parse(
    await fs.readFile(path.join(root, 'pc4_painpoints.json'), 'utf-8')
  ) as PainpointsPayload;
}

export default async function GemeentePainpointsReportPage() {
  const payload = await getPainpoints();
  return <GemeentePainpointsReport payload={payload} />;
}
