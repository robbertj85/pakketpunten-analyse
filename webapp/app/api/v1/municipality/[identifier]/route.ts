import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

import { checkRateLimit, clientIp, rateLimitHeaders } from '@/lib/rateLimit';

const RATE_LIMIT = 60; // requests per window
const RATE_LIMIT_WINDOW = 60 * 60 * 1000; // 1 hour in milliseconds

interface Municipality {
  name: string;
  slug: string;
  province: string;
  population: number;
  code: string | null;
}

// Mapping table for common Dutch municipality name variations
// Maps alternative names/spellings to canonical slugs in our database
//
// Common variations:
// 1. Apostrophe 's-: Official CBS names vs common names
// 2. Spaces/hyphens: Different formatting styles
// 3. Parenthetical disambiguation: With/without regional identifiers
// 4. Historical names: Old spellings still in use
const MUNICIPALITY_ALIAS_MAPPING: Record<string, string> = {
  // Den Haag / 's-Gravenhage variations
  "'s-gravenhage": "den-haag",
  "s-gravenhage": "den-haag",
  "sgravenhage": "den-haag",
  "'s gravenhage": "den-haag",
  "s gravenhage": "den-haag",
  "the hague": "den-haag",
  "haag": "den-haag",

  // Den Bosch / 's-Hertogenbosch variations
  "'s-hertogenbosch": "s-hertogenbosch",
  "shertogenbosch": "s-hertogenbosch",
  "'s hertogenbosch": "s-hertogenbosch",
  "s hertogenbosch": "s-hertogenbosch",
  "den bosch": "s-hertogenbosch",
  "den-bosch": "s-hertogenbosch",  // Slug-style variation
  "denbosch": "s-hertogenbosch",   // Without spaces/hyphens
  "bosch": "s-hertogenbosch",

  // Bergen variations (with/without regional identifiers)
  "bergen (nh)": "bergen-(nh.)",
  "bergen nh": "bergen-(nh.)",
  "bergen noord-holland": "bergen-(nh.)",
  "bergen noord holland": "bergen-(nh.)",
  "bergen (noord-holland)": "bergen-(nh.)",
  "bergen n.h.": "bergen-(nh.)",
  "bergen n-h": "bergen-(nh.)",

  "bergen (l)": "bergen-(l.)",
  "bergen l": "bergen-(l.)",
  "bergen limburg": "bergen-(l.)",
  "bergen (limburg)": "bergen-(l.)",
  "bergen l.": "bergen-(l.)",

  // Hengelo variations
  "hengelo (o)": "hengelo",
  "hengelo o": "hengelo",
  "hengelo (overijssel)": "hengelo",
  "hengelo overijssel": "hengelo",
  "hengelo o.": "hengelo",

  "hengelo (gld)": "hengelo",
  "hengelo gld": "hengelo",
  "hengelo (gelderland)": "hengelo",
  "hengelo gelderland": "hengelo",

  // Beek variations
  "beek (l)": "beek",
  "beek l": "beek",
  "beek (limburg)": "beek",
  "beek limburg": "beek",
  "beek l.": "beek",

  // Laren variations
  "laren (nh)": "laren",
  "laren nh": "laren",
  "laren (noord-holland)": "laren",
  "laren noord-holland": "laren",
  "laren noord holland": "laren",
  "laren n.h.": "laren",

  // Middelburg variations
  "middelburg (z)": "middelburg",
  "middelburg z": "middelburg",
  "middelburg (zeeland)": "middelburg",
  "middelburg zeeland": "middelburg",
  "middelburg z.": "middelburg",

  // Rijswijk variations
  "rijswijk (zh)": "rijswijk",
  "rijswijk zh": "rijswijk",
  "rijswijk (zuid-holland)": "rijswijk",
  "rijswijk zuid-holland": "rijswijk",
  "rijswijk zuid holland": "rijswijk",
  "rijswijk z.h.": "rijswijk",

  // Stein variations
  "stein (l)": "stein",
  "stein l": "stein",
  "stein (limburg)": "stein",
  "stein limburg": "stein",
  "stein l.": "stein",

  // Groningen variations
  "groningen (gemeente)": "groningen",

  // Utrecht variations
  "utrecht (gemeente)": "utrecht",

  // Valkenburg variations
  "valkenburg (zh)": "valkenburg-aan-de-geul",
  "valkenburg (l)": "valkenburg-aan-de-geul",
  "valkenburg": "valkenburg-aan-de-geul",

  // Nuenen variations
  "nuenen gerwen en nederwetten": "nuenen",
  "nuenen, gerwen en nederwetten": "nuenen",
};

function normalizeIdentifier(identifier: string): string {
  return identifier.toLowerCase().trim();
}

function findMunicipalityByIdentifier(
  municipalities: Municipality[],
  identifier: string
): Municipality | null {
  const normalized = normalizeIdentifier(identifier);

  // Try exact slug match (fastest)
  let match = municipalities.find((m) => m.slug === normalized);
  if (match) return match;

  // Try alias mapping (e.g., "Den Bosch" -> "s-hertogenbosch")
  if (MUNICIPALITY_ALIAS_MAPPING[normalized]) {
    const aliasSlug = MUNICIPALITY_ALIAS_MAPPING[normalized];
    match = municipalities.find((m) => m.slug === aliasSlug);
    if (match) return match;
  }

  // Try CBS code match (e.g., GM0363 for Amsterdam)
  match = municipalities.find((m) => {
    if (!m.code) return false;
    // Remove whitespace from CBS codes (they have trailing spaces in CBS data)
    const cleanCode = m.code.trim();
    return cleanCode.toLowerCase() === normalized;
  });
  if (match) return match;

  // Try municipality name match (case-insensitive)
  match = municipalities.find(
    (m) => normalizeIdentifier(m.name) === normalized
  );
  if (match) return match;

  // Try fuzzy matching: remove special characters and spaces
  // This helps with variations like "s-Hertogenbosch" vs "'s-Hertogenbosch"
  const fuzzyNormalized = normalized.replace(/[''\-\s().]/g, '');
  match = municipalities.find((m) => {
    const fuzzyName = m.name.toLowerCase().replace(/[''\-\s().]/g, '');
    const fuzzySlug = m.slug.replace(/[''\-\s().]/g, '');
    return fuzzyName === fuzzyNormalized || fuzzySlug === fuzzyNormalized;
  });
  if (match) return match;

  return null;
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ identifier: string }> }
) {
  try {
    const limit = checkRateLimit(
      `api-v1-municipality:${clientIp(request)}`,
      RATE_LIMIT,
      RATE_LIMIT_WINDOW
    );

    if (!limit.allowed) {
      return new NextResponse(
        JSON.stringify({
          error: 'Rate limit exceeded',
          message: `Maximum ${RATE_LIMIT} requests per hour`,
        }),
        {
          status: 429,
          headers: {
            'Content-Type': 'application/json',
            'Retry-After': String(limit.retryAfterSeconds),
            ...rateLimitHeaders(limit),
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type',
          },
        }
      );
    }

    // Get identifier from path params
    const { identifier } = await context.params;

    if (!identifier) {
      return new NextResponse(
        JSON.stringify({
          error: 'Missing identifier',
          message: 'Please provide a municipality identifier (name, slug, or CBS code)',
        }),
        {
          status: 400,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
          },
        }
      );
    }

    // Load municipalities metadata
    const municipalitiesPath = path.join(
      process.cwd(),
      'public',
      'municipalities.json'
    );

    if (!fs.existsSync(municipalitiesPath)) {
      return new NextResponse(
        JSON.stringify({
          error: 'Municipalities data not found',
        }),
        {
          status: 500,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
          },
        }
      );
    }

    const municipalities: Municipality[] = JSON.parse(
      fs.readFileSync(municipalitiesPath, 'utf-8')
    );

    // Find municipality by identifier
    const municipality = findMunicipalityByIdentifier(municipalities, identifier);

    if (!municipality) {
      return new NextResponse(
        JSON.stringify({
          error: 'Municipality not found',
          message: `No municipality found for identifier: "${identifier}"`,
          hint: 'Try using a municipality name (e.g., "Amsterdam"), slug (e.g., "amsterdam"), or CBS code (e.g., "GM0363")',
        }),
        {
          status: 404,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
          },
        }
      );
    }

    // Skip "Nederland (totaal)" - it's not a real municipality
    if (municipality.slug === 'nederland') {
      return new NextResponse(
        JSON.stringify({
          error: 'Invalid municipality',
          message: 'National overview data is not available via the API. Please use individual municipality endpoints.',
        }),
        {
          status: 400,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
          },
        }
      );
    }

    // Read the GeoJSON file
    const filePath = path.join(
      process.cwd(),
      'public',
      'data',
      `${municipality.slug}.geojson`
    );

    if (!fs.existsSync(filePath)) {
      return new NextResponse(
        JSON.stringify({
          error: 'Data not found',
          message: `Data file for municipality "${municipality.name}" does not exist`,
        }),
        {
          status: 404,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
          },
        }
      );
    }

    const fileContent = fs.readFileSync(filePath, 'utf-8');
    const geojson = JSON.parse(fileContent);

    // Return GeoJSON with proper headers
    return new NextResponse(JSON.stringify(geojson, null, 2), {
      headers: {
        'Content-Type': 'application/geo+json',
        'Cache-Control': 'public, max-age=3600, stale-while-revalidate=86400',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        'X-RateLimit-Limit': String(RATE_LIMIT),
        'X-Municipality-Name': municipality.name,
        'X-Municipality-Slug': municipality.slug,
        'X-Municipality-Code': municipality.code || 'N/A',
      },
    });
  } catch (error) {
    console.error('API error:', error);
    return new NextResponse(
      JSON.stringify({
        error: 'Internal server error',
        message: 'An unexpected error occurred while processing your request',
      }),
      {
        status: 500,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      }
    );
  }
}

// Handle OPTIONS for CORS preflight
export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400',
    },
  });
}
