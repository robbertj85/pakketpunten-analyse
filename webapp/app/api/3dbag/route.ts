import { NextRequest, NextResponse } from 'next/server';

// Server-side proxy for the 3DBAG API (https://api.3dbag.nl).
// 3DBAG sends no CORS headers, so the browser cannot fetch it directly; this
// same-origin route fetches it server-side and relays the CityJSON.

const API_BASE = 'https://api.3dbag.nl/collections/pand/items';
const BBOX_RE = /^-?\d+(\.\d+)?,-?\d+(\.\d+)?,-?\d+(\.\d+)?,-?\d+(\.\d+)?$/;

export async function GET(req: NextRequest) {
  const bbox = req.nextUrl.searchParams.get('bbox');
  const limitParamRaw = req.nextUrl.searchParams.get('limit');

  if (!bbox || !BBOX_RE.test(bbox)) {
    return NextResponse.json(
      { error: 'Invalid or missing bbox (expected minx,miny,maxx,maxy in EPSG:28992)' },
      { status: 400 },
    );
  }
  const limit = Math.min(500, Math.max(1, Number(limitParamRaw) || 200));

  const url = `${API_BASE}?bbox=${encodeURIComponent(bbox)}&limit=${limit}`;
  try {
    const upstream = await fetch(url, {
      headers: { Accept: 'application/json' },
      // Cache identical building queries at the edge for an hour.
      next: { revalidate: 3600 },
    });
    if (!upstream.ok) {
      return NextResponse.json(
        { error: `3DBAG upstream ${upstream.status}` },
        { status: 502 },
      );
    }
    const data = await upstream.json();
    return NextResponse.json(data, {
      headers: { 'Cache-Control': 'public, max-age=3600, stale-while-revalidate=86400' },
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'fetch failed' },
      { status: 502 },
    );
  }
}
