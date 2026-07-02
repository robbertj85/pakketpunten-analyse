// Client-side helpers for loading Google Photorealistic 3D Tiles through our
// same-origin proxy (/api/google3d/...). The proxy injects the API key and
// rate-limits, so nothing here ever touches a Google API key.

/** Root tileset URL — served by the proxy, which adds the key server-side. */
export const GOOGLE_3D_ROOT = '/api/google3d/v1/3dtiles/root.json';

const TILE_HOST = 'tile.googleapis.com';
const PROXY_PREFIX = '/api/google3d';

/**
 * Rewrite a tile URL so it goes through our proxy. The renderer resolves child
 * URIs against the tileset base, producing either absolute Google URLs or
 * absolute-path `/v1/3dtiles/...` URLs against our origin — both are mapped to
 * `/api/google3d/v1/3dtiles/...`. URLs already under the proxy pass through.
 *
 * Pass this as the `preprocessURL` prop of the tiles renderer.
 */
export function toGoogle3DProxyURL(url: string | URL): string {
  const raw = typeof url === 'string' ? url : url.toString();
  try {
    const origin = typeof window !== 'undefined' ? window.location.origin : 'http://localhost';
    const u = new URL(raw, origin);
    if (u.hostname === TILE_HOST && u.pathname.startsWith('/v1/3dtiles/')) {
      return `${PROXY_PREFIX}${u.pathname}${u.search}`;
    }
    if (u.pathname.startsWith('/v1/3dtiles/')) {
      // absolute-path child resolved against our own origin
      return `${PROXY_PREFIX}${u.pathname}${u.search}`;
    }
    return raw;
  } catch {
    return raw;
  }
}

export interface Google3DError {
  kind: 'rate_limited' | 'no_coverage' | 'not_configured' | 'error';
  message: string;
  retryAfterSec?: number;
}

/**
 * Probe the root tileset before mounting the heavy renderer. Returns null when
 * 3D tiles are available, or a typed error (rate-limited / no coverage / not
 * configured) the UI can act on. NOTE: a successful probe consumes one of the
 * per-IP rate-limit slots, so the renderer should reuse the same session rather
 * than re-fetch root.json.
 */
export async function probeGoogle3D(signal?: AbortSignal): Promise<Google3DError | null> {
  let res: Response;
  try {
    res = await fetch(GOOGLE_3D_ROOT, { signal });
  } catch {
    return { kind: 'error', message: '3D-tegels konden niet worden geladen.' };
  }
  if (res.ok) return null;
  if (res.status === 429) {
    const body = await res.json().catch(() => ({}));
    return {
      kind: 'rate_limited',
      message: body?.message ?? 'Te veel 3D-weergaven. Probeer het later opnieuw.',
      retryAfterSec: body?.retryAfterSec,
    };
  }
  if (res.status === 404) {
    return { kind: 'no_coverage', message: 'Geen fotorealistische 3D-dekking op deze locatie.' };
  }
  if (res.status === 403) {
    // Account/region can't be served 3D Tiles (billing off, Map Tiles API
    // disabled, or Google's EEA availability restriction). Permanent for this
    // key, so treat like a config problem and fall back to 3DBAG.
    return {
      kind: 'not_configured',
      message:
        'Fotorealistische 3D-tegels zijn niet beschikbaar voor dit account/deze regio (Google-beperking).',
    };
  }
  if (res.status === 500) {
    return { kind: 'not_configured', message: 'Google 3D-tegels zijn niet geconfigureerd.' };
  }
  return { kind: 'error', message: `3D-tegels niet beschikbaar (${res.status}).` };
}
