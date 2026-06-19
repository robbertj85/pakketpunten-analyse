import { NextRequest, NextResponse } from 'next/server';

// Server-side proxy for the PDOK aerial-photo WMS (open data, Actueel_orthoHR,
// 25 cm RGB). Fetched server-side and relayed so the browser stays same-origin
// (avoids CORS/CSP friction) and can drape the image as a ground texture.

const WMS = 'https://service.pdok.nl/hwh/luchtfotorgb/wms/v1_0';
const BBOX_RE = /^-?\d+(\.\d+)?,-?\d+(\.\d+)?,-?\d+(\.\d+)?,-?\d+(\.\d+)?$/;

export async function GET(req: NextRequest) {
  const bbox = req.nextUrl.searchParams.get('bbox');
  const size = Math.min(2048, Math.max(256, Number(req.nextUrl.searchParams.get('size')) || 1536));
  if (!bbox || !BBOX_RE.test(bbox)) {
    return NextResponse.json(
      { error: 'Invalid or missing bbox (minx,miny,maxx,maxy in EPSG:28992)' },
      { status: 400 },
    );
  }

  const url =
    `${WMS}?service=WMS&version=1.3.0&request=GetMap&layers=Actueel_orthoHR` +
    `&styles=&crs=EPSG:28992&bbox=${bbox}&width=${size}&height=${size}&format=image/jpeg`;

  try {
    const upstream = await fetch(url, { next: { revalidate: 86400 } });
    if (!upstream.ok) {
      return NextResponse.json({ error: `PDOK WMS ${upstream.status}` }, { status: 502 });
    }
    const buf = await upstream.arrayBuffer();
    return new NextResponse(buf, {
      headers: {
        'Content-Type': upstream.headers.get('content-type') ?? 'image/jpeg',
        'Cache-Control': 'public, max-age=86400, stale-while-revalidate=604800',
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'fetch failed' },
      { status: 502 },
    );
  }
}
