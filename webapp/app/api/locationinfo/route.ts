import { NextRequest, NextResponse } from 'next/server';
import { wgs84ToRd } from '@/lib/rd';

// Resolves a lat/lon into Dutch reference identifiers via open PDOK services
// (no API key): nearest address + BAG ids (Locatieserver) and the kadastrale
// perceel at the point (Kadastrale Kaart WFS). Proxied server-side so the page
// stays same-origin (no CSP changes) and the upstreams are reachable headless.

const NUM_RE = /^-?\d+(\.\d+)?$/;
const LOCSERVER = 'https://api.pdok.nl/bzk/locatieserver/search/v3_1/reverse';
const KADASTER_WFS = 'https://service.pdok.nl/kadaster/kadastralekaart/wfs/v5_0';

interface LocationInfo {
  lat: number;
  lon: number;
  rdx: number;
  rdy: number;
  address?: {
    weergavenaam?: string;
    straat?: string;
    huisnummer?: string;
    postcode?: string;
    woonplaats?: string;
    gemeente?: string;
    afstandM?: number | null;
  };
  bag?: {
    pandId?: string | null;
    verblijfsobjectId?: string | null;
    nummeraanduidingId?: string | null;
  };
  kadaster?: {
    aanduiding?: string;
    gemeente?: string | null;
    sectie?: string | null;
    perceelnummer?: string | number | null;
    oppervlakteM2?: number | null;
  };
}

export async function GET(req: NextRequest) {
  const latRaw = req.nextUrl.searchParams.get('lat');
  const lonRaw = req.nextUrl.searchParams.get('lon');
  if (!latRaw || !lonRaw || !NUM_RE.test(latRaw) || !NUM_RE.test(lonRaw)) {
    return NextResponse.json({ error: 'lat and lon are required' }, { status: 400 });
  }
  const lat = Number(latRaw);
  const lon = Number(lonRaw);
  const rd = wgs84ToRd(lat, lon);
  const out: LocationInfo = { lat, lon, rdx: Math.round(rd.x * 100) / 100, rdy: Math.round(rd.y * 100) / 100 };

  // 1) Nearest address + BAG ids.
  try {
    const url = `${LOCSERVER}?lat=${lat}&lon=${lon}&rows=1&type=adres&fl=*`;
    const r = await fetch(url, { headers: { Accept: 'application/json' }, next: { revalidate: 3600 } });
    if (r.ok) {
      const j = await r.json();
      const d = j?.response?.docs?.[0];
      if (d) {
        out.address = {
          weergavenaam: d.weergavenaam,
          straat: d.straatnaam,
          huisnummer: d.huis_nlt,
          postcode: d.postcode,
          woonplaats: d.woonplaatsnaam,
          gemeente: d.gemeentenaam,
          afstandM: typeof d.afstand === 'number' ? Math.round(d.afstand) : null,
        };
        out.bag = {
          pandId: Array.isArray(d.pandid) ? d.pandid[0] : d.pandid ?? null,
          verblijfsobjectId: d.adresseerbaarobject_id ?? null,
          nummeraanduidingId: d.nummeraanduiding_id ?? null,
        };
      }
    }
  } catch {
    /* best-effort */
  }

  // 2) Kadastrale perceel at the point. A tiny RD bbox reliably returns the
  //    containing perceel (the WFS ignores a cql_filter INTERSECTS here).
  try {
    const bbox = `${rd.x - 0.5},${rd.y - 0.5},${rd.x + 0.5},${rd.y + 0.5},urn:ogc:def:crs:EPSG::28992`;
    const url =
      `${KADASTER_WFS}?service=WFS&version=2.0.0&request=GetFeature` +
      `&typeNames=kadastralekaartv5:Perceel&outputFormat=application/json` +
      `&srsName=EPSG:28992&count=1&bbox=${encodeURIComponent(bbox)}`;
    const r = await fetch(url, { headers: { Accept: 'application/json' }, next: { revalidate: 3600 } });
    if (r.ok) {
      const j = await r.json();
      const p = j?.features?.[0]?.properties;
      if (p) {
        const gemeente = p.kadastraleGemeenteWaarde ?? p.AKRKadastraleGemeenteCodeWaarde ?? null;
        const sectie = p.sectie ?? null;
        const nummer = p.perceelnummer ?? null;
        out.kadaster = {
          gemeente,
          sectie,
          perceelnummer: nummer,
          aanduiding: [gemeente, sectie, nummer].filter((v) => v != null && v !== '').join(' '),
          oppervlakteM2: p.kadastraleGrootteWaarde ?? null,
        };
      }
    }
  } catch {
    /* best-effort */
  }

  return NextResponse.json(out, { headers: { 'Cache-Control': 'private, max-age=600' } });
}
