import { NextRequest, NextResponse } from 'next/server';

// Server-side proxy for the PDOK BRT-Achtergrondkaart WMTS (open data,
// TU Kadaster). Relayed server-side so the browser stays same-origin — the
// 3D viewer stitches these tiles into a single canvas texture and drapes it as
// a street-map ground (with street names), an alternative to the aerial photo.
//
// Tiles are the standard Nederlandse WMTS grid in EPSG:28992 (RD):
//   template .../{style}/EPSG:28992/{z}/{col}/{row}.png
// so they line up 1:1 with the RD-based 3D geometry.

const BASE = 'https://service.pdok.nl/brt/achtergrondkaart/wmts/v2_0';
const STYLES = new Set(['standaard', 'grijs', 'pastel', 'water']);

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const style = sp.get('style') ?? 'standaard';
  const z = Number(sp.get('z'));
  const col = Number(sp.get('col'));
  const row = Number(sp.get('row'));

  if (
    !STYLES.has(style) ||
    !Number.isInteger(z) || z < 0 || z > 14 ||
    !Number.isInteger(col) || col < 0 || col > 100000 ||
    !Number.isInteger(row) || row < 0 || row > 100000
  ) {
    return NextResponse.json({ error: 'Invalid tile request' }, { status: 400 });
  }

  const url = `${BASE}/${style}/EPSG:28992/${z}/${col}/${row}.png`;
  try {
    const upstream = await fetch(url, { next: { revalidate: 604800 } });
    if (!upstream.ok) {
      // Out-of-range tiles legitimately 404 at the grid edges — pass that through
      // quietly so the client can skip them.
      return NextResponse.json({ error: `PDOK WMTS ${upstream.status}` }, { status: upstream.status });
    }
    const contentType = upstream.headers.get('content-type') ?? '';
    if (!contentType.startsWith('image/')) {
      return NextResponse.json({ error: 'PDOK WMTS returned a non-image response' }, { status: 502 });
    }
    const buf = await upstream.arrayBuffer();
    return new NextResponse(buf, {
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=604800, stale-while-revalidate=2592000',
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'fetch failed' },
      { status: 502 },
    );
  }
}
