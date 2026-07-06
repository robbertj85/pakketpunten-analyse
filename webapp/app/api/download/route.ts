import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

// Simple in-memory rate limiter
// In production, use Redis or a proper rate limiting service
const rateLimitStore = new Map<string, { count: number; resetTime: number }>();

const RATE_LIMIT = 5; // downloads per hour
const RATE_LIMIT_WINDOW = 60 * 60 * 1000; // 1 hour in milliseconds

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const record = rateLimitStore.get(ip);

  if (!record || now > record.resetTime) {
    // Create new record or reset expired one
    rateLimitStore.set(ip, {
      count: 1,
      resetTime: now + RATE_LIMIT_WINDOW,
    });
    return true;
  }

  if (record.count >= RATE_LIMIT) {
    return false;
  }

  record.count++;
  return true;
}

function convertGeoJSONToCSV(geojson: any): string {
  const features = geojson.features.filter(
    (f: any) => f.properties.type === 'pakketpunt'
  );

  if (features.length === 0) {
    return 'Geen pakketpunten gevonden';
  }

  // CSV header (bezettingsgraad is willekeurig gegenereerde demo-data)
  const headers = [
    'locatieNaam',
    'straatNaam',
    'straatNr',
    'latitude',
    'longitude',
    'vervoerder',
    'puntType',
    'bezettingsgraad_mock',
  ];

  const rows = features.map((feature: any) => {
    const props = feature.properties;
    const coords = feature.geometry.coordinates;

    return [
      props.locatieNaam || '',
      props.straatNaam || '',
      props.straatNr || '',
      coords[1], // latitude
      coords[0], // longitude
      props.vervoerder || '',
      props.puntType || '',
      props.bezettingsgraad ?? '',
    ]
      .map((value) => {
        // Escape CSV values
        let stringValue = String(value);
        // Formula-injection bescherming: spreadsheet-formules onschadelijk
        // maken in tekstvelden afkomstig van derden (alleen strings).
        if (typeof value === 'string' && /^[=+\-@]/.test(stringValue)) {
          stringValue = `'${stringValue}`;
        }
        if (stringValue.includes(',') || stringValue.includes('"') || stringValue.includes('\n')) {
          return `"${stringValue.replace(/"/g, '""')}"`;
        }
        return stringValue;
      })
      .join(',');
  });

  return [headers.join(','), ...rows].join('\n');
}

export async function GET(request: NextRequest) {
  try {
    // Get client IP
    const ip = request.headers.get('x-forwarded-for') ||
               request.headers.get('x-real-ip') ||
               'unknown';

    // Check rate limit
    if (!checkRateLimit(ip)) {
      return new NextResponse('Rate limit exceeded. Maximum 5 downloads per hour.', {
        status: 429,
        headers: {
          'Retry-After': '3600',
        },
      });
    }

    // Get query parameters
    const searchParams = request.nextUrl.searchParams;
    const slug = searchParams.get('slug');
    const format = searchParams.get('format') as 'json' | 'csv';

    if (!slug || !format) {
      return new NextResponse('Missing slug or format parameter', { status: 400 });
    }

    if (format !== 'json' && format !== 'csv') {
      return new NextResponse('Invalid format. Use json or csv', { status: 400 });
    }

    // SECURITY: Validate slug to prevent path traversal attacks
    // Only allow lowercase letters, numbers, and hyphens
    if (!slug.match(/^[a-z0-9-]+$/)) {
      return new NextResponse('Invalid municipality slug', { status: 400 });
    }

    // Read the GeoJSON file
    const filePath = path.join(process.cwd(), 'public', 'data', `${slug}.geojson`);

    if (!fs.existsSync(filePath)) {
      return new NextResponse('Municipality not found', { status: 404 });
    }

    const fileContent = fs.readFileSync(filePath, 'utf-8');
    const geojson = JSON.parse(fileContent);

    if (format === 'json') {
      // Return GeoJSON as-is
      return new NextResponse(fileContent, {
        headers: {
          'Content-Type': 'application/geo+json',
          'Content-Disposition': `attachment; filename="pakketpunten-${slug}.geojson"`,
        },
      });
    } else {
      // Convert to CSV
      const csv = convertGeoJSONToCSV(geojson);

      return new NextResponse(csv, {
        headers: {
          'Content-Type': 'text/csv',
          'Content-Disposition': `attachment; filename="pakketpunten-${slug}.csv"`,
        },
      });
    }
  } catch (error) {
    console.error('Download error:', error);
    return new NextResponse('Internal server error', { status: 500 });
  }
}
