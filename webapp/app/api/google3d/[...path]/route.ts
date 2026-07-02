import { NextRequest, NextResponse } from 'next/server';
import { rateLimit } from '@/lib/rateLimit';

// Server-side proxy for Google Photorealistic 3D Tiles (Map Tiles API).
//
// Why a full proxy instead of using the key in the browser:
//   1. The API key stays server-side (GOOGLE_MAPS_API_KEY) — never shipped to
//      the client, so it can't be lifted and abused against our quota.
//   2. It lets us rate-limit per IP. Only the root tileset request counts as a
//      "locker load" (one Google billable session ≈ one root.json). Child tile
//      requests stream freely within that session and are not metered.
//
// The client (components/locker3d/GoogleTiles.tsx) points the tiles renderer at
// /api/google3d/v1/3dtiles/root.json and rewrites every child URL back through
// here, so the whole tile tree is same-origin and keyless.
//
// Session handling: Google embeds a session token in root.json's child URIs and
// expects it appended to every subsequent request. Rather than scavenge it from
// client requests (fragile — browser caching or multi-instance means a session-
// bearing request may never reach the instance that later serves a session-less
// nested tile), the proxy fetches and caches its OWN session token server-side
// and injects it into every child request.

const TILE_HOST = 'https://tile.googleapis.com';
const ALLOWED_PREFIX = 'v1/3dtiles/';
const ROOT_PATH = 'v1/3dtiles/root.json';

// Rate limit: 10 locker loads (root requests) per IP, then a 15-minute cooldown.
const MAX_LOADS = 10;
const WINDOW_MS = 15 * 60 * 1000;

// A single locker view may hit root.json a few times in quick succession (a
// coverage probe, the renderer itself, a React StrictMode double-mount). Treat
// root requests from the same IP within this window as one metered load.
const DEDUPE_MS = 20 * 1000;
const lastRoot = new Map<string, number>();

// Cached server-side session token. One token is valid across a whole tile tree
// for its lifetime; refresh well within Google's expiry and on auth failure.
const SESSION_TTL_MS = 25 * 60 * 1000;
let serverSession: { token: string; at: number } | null = null;

function clientIp(req: NextRequest): string {
  const xff = req.headers.get('x-forwarded-for');
  if (xff) return xff.split(',')[0].trim();
  return req.headers.get('x-real-ip') ?? 'unknown';
}

function extractSession(tilesetJson: string): string | null {
  const m = tilesetJson.match(/[?&]session=([A-Za-z0-9_-]+)/);
  return m ? m[1] : null;
}

/** Return a cached session token, fetching a fresh one from root.json if needed. */
async function ensureSession(key: string, force = false): Promise<string | null> {
  const now = Date.now();
  if (!force && serverSession && now - serverSession.at < SESSION_TTL_MS) {
    return serverSession.token;
  }
  const res = await fetch(`${TILE_HOST}/${ROOT_PATH}?key=${encodeURIComponent(key)}`);
  if (!res.ok) return null;
  const token = extractSession(await res.text());
  if (token) serverSession = { token, at: now };
  return token;
}

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ path: string[] }> },
) {
  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (!key) {
    return NextResponse.json(
      { error: 'GOOGLE_MAPS_API_KEY is not configured on the server' },
      { status: 500 },
    );
  }

  const { path } = await ctx.params;
  const segments = path.join('/');

  // Only ever proxy the 3D tiles path space.
  if (!segments.startsWith(ALLOWED_PREFIX) || segments.includes('..')) {
    return NextResponse.json({ error: 'forbidden path' }, { status: 400 });
  }

  const isRoot = segments === ROOT_PATH;

  // Meter only the root request (one per locker view), deduping rapid repeats.
  if (isRoot) {
    const ip = clientIp(req);
    const now = Date.now();
    const prev = lastRoot.get(ip) ?? 0;
    const isDuplicate = now - prev < DEDUPE_MS;
    lastRoot.set(ip, now);
    const rl = isDuplicate
      ? { ok: true, remaining: MAX_LOADS, retryAfterSec: 0 }
      : rateLimit(`g3d:${ip}`, MAX_LOADS, WINDOW_MS);
    if (!rl.ok) {
      return NextResponse.json(
        {
          error: 'rate_limited',
          message: `Limiet van ${MAX_LOADS} 3D-weergaven bereikt. Probeer het over ${Math.ceil(
            rl.retryAfterSec / 60,
          )} min opnieuw.`,
          retryAfterSec: rl.retryAfterSec,
        },
        { status: 429, headers: { 'Retry-After': String(rl.retryAfterSec) } },
      );
    }
  }

  const buildUpstream = (sessionToken: string | null): URL => {
    const url = new URL(`${TILE_HOST}/${segments}`);
    req.nextUrl.searchParams.forEach((value, k) => {
      if (k !== 'key' && k !== 'session') url.searchParams.set(k, value);
    });
    url.searchParams.set('key', key);
    if (sessionToken) url.searchParams.set('session', sessionToken);
    return url;
  };

  try {
    // Root needs no session (it issues one); children always get the cached one.
    let session = isRoot ? null : await ensureSession(key);
    let upstream = await fetch(buildUpstream(session), { headers: { Accept: '*/*' } });

    // A child rejected with an auth error usually means the session expired —
    // refresh once and retry.
    if (!isRoot && (upstream.status === 401 || upstream.status === 403)) {
      session = await ensureSession(key, true);
      upstream = await fetch(buildUpstream(session), { headers: { Accept: '*/*' } });
    }

    if (!upstream.ok) {
      // 404 = no Photorealistic 3D coverage at this location (common for small
      // municipalities). 401/403 = the account/region can't be served 3D Tiles
      // at all (billing off, Map Tiles API disabled, or the EEA availability
      // restriction — https://developers.google.com/maps/comms/eea/map-tiles).
      // Both are permanent for this key, so pass 403 through with Google's own
      // message rather than masking it as a transient 502. Everything else is a
      // genuine upstream fault → 502.
      let googleMessage: string | undefined;
      try {
        const body = await upstream.json();
        googleMessage = body?.error?.message;
      } catch {
        /* non-JSON error body — ignore */
      }
      const isAuth = upstream.status === 401 || upstream.status === 403;
      const status = upstream.status === 404 ? 404 : isAuth ? 403 : 502;
      return NextResponse.json(
        { error: `google ${upstream.status}`, message: googleMessage },
        { status },
      );
    }

    const contentType = upstream.headers.get('content-type') ?? 'application/octet-stream';
    const buf = await upstream.arrayBuffer();

    // Cache the session from the root response so the first child needn't refetch.
    if (isRoot) {
      const token = extractSession(new TextDecoder().decode(buf));
      if (token) serverSession = { token, at: Date.now() };
    }

    return new NextResponse(buf, {
      headers: {
        'Content-Type': contentType,
        // Children are session-scoped and safe to cache briefly. Root is NOT
        // cached, so a reload always re-validates the session server-side.
        'Cache-Control': isRoot ? 'no-store' : 'private, max-age=600',
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'fetch failed' },
      { status: 502 },
    );
  }
}
