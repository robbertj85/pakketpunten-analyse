import { promises as fs } from 'fs';
import path from 'path';
import PainpointsReport, { PainpointsPayload } from '@/components/PainpointsReport';

async function getPainpoints(): Promise<PainpointsPayload> {
  const p = path.join(process.cwd(), 'public', 'data', 'pc4_painpoints.json');
  const content = await fs.readFile(p, 'utf-8');
  return JSON.parse(content) as PainpointsPayload;
}

export default async function PainpointsReportPage() {
  const payload = await getPainpoints();
  return <PainpointsReport payload={payload} />;
}
