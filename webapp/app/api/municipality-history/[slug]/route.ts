import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

import { MunicipalityHistoryEntry, HistoryData } from '@/types/history';

export const dynamic = 'force-dynamic';

/**
 * One municipality's weekly history.
 *
 * totals_history.json holds all 344 of them and runs to ~4.7 MB, which is far
 * too much to hand a client component that shows one at a time. The statistics
 * page therefore fetches a single slug here when the reader picks a gemeente,
 * instead of receiving the whole file as a prop.
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await context.params;

    const historyPath = path.join(process.cwd(), 'public', 'data', 'totals_history.json');
    if (!fs.existsSync(historyPath)) {
      return NextResponse.json({ error: 'History data not available' }, { status: 404 });
    }

    const history = JSON.parse(fs.readFileSync(historyPath, 'utf-8')) as HistoryData;
    const entries: MunicipalityHistoryEntry[] = history.municipalities?.[slug]?.history ?? [];

    if (entries.length === 0) {
      return NextResponse.json(
        { error: `No history for '${slug}'`, slug, history: [] },
        { status: 404 }
      );
    }

    return NextResponse.json({ slug, history: entries });
  } catch (error) {
    console.error('Error reading municipality history:', error);
    return NextResponse.json({ error: 'Failed to read municipality history' }, { status: 500 });
  }
}
