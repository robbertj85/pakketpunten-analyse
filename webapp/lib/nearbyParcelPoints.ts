import { promises as fs } from 'fs';
import path from 'path';

export interface NearbyPoint {
  lat: number;
  lon: number;
  vervoerder: string;
  naam: string;
  distanceM: number;
}

export function haversineM(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const R = 6371000;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLon = ((bLon - aLon) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((aLat * Math.PI) / 180) * Math.cos((bLat * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

interface GeoJson {
  features: Array<{
    geometry?: { type?: string; coordinates?: [number, number] };
    properties?: { type?: string; vervoerder?: string; locatieNaam?: string };
  }>;
}

/**
 * Existing parcel points within `radiusM` of a location (for the 3D context).
 * Server-only helper — reads public/data/{slug}.geojson from disk.
 */
export async function nearbyParcelPoints(
  slug: string,
  lat: number,
  lon: number,
  radiusM = 1500,
  maxPoints = 80,
): Promise<NearbyPoint[]> {
  let geo: GeoJson | null = null;
  try {
    const p = path.join(process.cwd(), 'public', 'data', `${slug}.geojson`);
    geo = JSON.parse(await fs.readFile(p, 'utf-8')) as GeoJson;
  } catch {
    return [];
  }
  if (!geo?.features) return [];
  const out: NearbyPoint[] = [];
  for (const f of geo.features) {
    if (f.properties?.type !== 'pakketpunt') continue;
    const c = f.geometry?.coordinates;
    if (!c) continue;
    const d = haversineM(lat, lon, c[1], c[0]);
    if (d > radiusM) continue;
    out.push({
      lat: c[1],
      lon: c[0],
      vervoerder: f.properties.vervoerder ?? 'onbekend',
      naam: f.properties.locatieNaam ?? '',
      distanceM: Math.round(d),
    });
  }
  return out.sort((a, b) => a.distanceM - b.distanceM).slice(0, maxPoints);
}
