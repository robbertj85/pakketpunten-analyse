// Fetch building geometry from the 3DBAG API (TU Delft, CC BY 4.0) and convert
// it into flat vertex arrays usable by three.js.
//
// API: https://api.3dbag.nl  — OGC API Features, returns CityJSON(Feature).
//   - by BAG pand id: /collections/pand/items/NL.IMBAG.Pand.{16-digit}
//   - by bbox (RD/EPSG:28992): /collections/pand/items?bbox=minx,miny,maxx,maxy
//
// CityJSON vertices are integers compressed by a shared transform
// (real = vertex * scale + translate) in EPSG:7415 (RD x/y + NAP height, metres).
// We project them into a local scene frame: X=east, Y=up, Z=south, relative to
// a chosen origin (RD x/y) and ground height.

import { wgs84ToRd } from './rd';

export interface BuildingMesh {
  /** Interleaved triangle positions (x,y,z, metres) in the local scene frame. */
  positions: Float32Array;
  /** BAG pand identificatie (without the NL.IMBAG.Pand prefix), if known. */
  bagId: string | null;
  /** True when this is the suggestion's target building. */
  isTarget: boolean;
  /** Ground footprint height (roof - ground) in metres, for labelling. */
  approxHeight: number;
}

/** A candidate placement against a building wall, in local scene coords. */
export interface SnapPose {
  /** Locker centre position (metres, scene frame; y is ground = 0). */
  x: number;
  z: number;
  /** Rotation around Y so the locker's branded face (+Z) points outward. */
  rotationY: number;
  /** Length of the wall segment (metres) — longer walls fit wider lockers. */
  wallLength: number;
  /** How well this wall faces the open white-spot (−1..1; higher = more open). */
  openness: number;
}

export interface BuildingSceneData {
  buildings: BuildingMesh[];
  /** RD origin used for the local frame. */
  originRd: { x: number; y: number };
  /** Ground (NAP) height used as scene y=0, metres. */
  groundZ: number;
  /**
   * Candidate locker placements flush against the target building's walls,
   * ordered best-first (nearest the suggestion point, longest walls). Empty
   * when the target building was not found.
   */
  snapCandidates: SnapPose[];
}

type Transform = { scale: [number, number, number]; translate: [number, number, number] };

interface CityJsonLike {
  transform?: Transform;
  metadata?: { transform?: Transform };
  CityJSON?: { transform?: Transform };
}

interface CityFeature {
  CityObjects?: Record<string, CityObject>;
  vertices?: number[][];
}

interface CityObject {
  type?: string;
  attributes?: Record<string, unknown>;
  geometry?: CityGeometry[];
}

interface CityGeometry {
  type?: string;
  lod?: string;
  // boundaries nesting depends on type; treat as unknown and walk it.
  boundaries?: unknown;
}

// Same-origin proxy route (see app/api/3dbag/route.ts) — 3DBAG has no CORS.
const API_BASE = '/api/3dbag';
// 3DBAG nests the 3D solids on BuildingPart children (LoD 1.2/1.3/2.2); the
// parent Building only carries a flat LoD 0 footprint, which we skip. We prefer
// the highest detail (2.2 — modelled roof shapes) and fall back downward.
const LOD_PREFERENCE = ['2.2', '1.3', '1.2'];

function resolveTransform(doc: CityJsonLike): Transform {
  return (
    doc.transform ??
    doc.metadata?.transform ??
    doc.CityJSON?.transform ?? {
      scale: [0.001, 0.001, 0.001],
      translate: [0, 0, 0],
    }
  );
}

/**
 * Pick the geometry whose lod best matches our preference order. Returns null
 * when the object has no true 3D LoD (e.g. a parent Building's LoD 0 footprint),
 * so such objects are skipped rather than drawn flat on the ground.
 */
function pickGeometry(geoms: CityGeometry[]): CityGeometry | null {
  for (const lod of LOD_PREFERENCE) {
    const g = geoms.find((x) => String(x.lod) === lod);
    if (g) return g;
  }
  return null;
}

/**
 * Normalise CityJSON boundaries (Solid / MultiSurface / CompositeSurface) into a
 * flat list of surfaces, each surface being an array of rings (outer first).
 */
function collectSurfaces(type: string | undefined, boundaries: unknown): number[][][] {
  const surfaces: number[][][] = [];
  if (!Array.isArray(boundaries)) return surfaces;

  const isRing = (v: unknown): v is number[] =>
    Array.isArray(v) && typeof v[0] === 'number';
  const isSurface = (v: unknown): v is number[][] =>
    Array.isArray(v) && isRing((v as unknown[])[0]);

  const pushSurface = (surf: unknown) => {
    if (isSurface(surf)) surfaces.push(surf as number[][]);
  };

  switch (type) {
    case 'Solid':
      // boundaries = [shell][surface][ring]
      for (const shell of boundaries as unknown[]) {
        if (Array.isArray(shell)) for (const surf of shell) pushSurface(surf);
      }
      break;
    case 'MultiSolid':
    case 'CompositeSolid':
      for (const solid of boundaries as unknown[]) {
        if (Array.isArray(solid))
          for (const shell of solid) {
            if (Array.isArray(shell)) for (const surf of shell) pushSurface(surf);
          }
      }
      break;
    case 'MultiSurface':
    case 'CompositeSurface':
    default:
      for (const surf of boundaries as unknown[]) pushSurface(surf);
      break;
  }
  return surfaces;
}

export interface FetchBuildingsOptions {
  /** Centre of the area (WGS84). */
  lat: number;
  lon: number;
  /** Target BAG pand id (16-digit) to highlight, if known. */
  targetBagId?: string | null;
  /**
   * The suggestion's pre-snap point (WGS84) — the representative point of the
   * open white-spot. Used to orient the locker toward open/public space.
   */
  preSnapLat?: number | null;
  preSnapLon?: number | null;
  /** Half-size of the fetch box in metres. */
  radiusM?: number;
  /**
   * Ground (NAP) height for scene y=0, metres. When omitted it is derived from
   * the lowest building vertex in the fetched area (no AHN call required).
   */
  groundZ?: number;
  signal?: AbortSignal;
}

export async function fetchBuildingScene(
  opts: FetchBuildingsOptions,
): Promise<BuildingSceneData> {
  const { lat, lon, targetBagId, radiusM = 70, signal } = opts;
  const origin = wgs84ToRd(lat, lon);
  const bbox = [
    Math.round(origin.x - radiusM),
    Math.round(origin.y - radiusM),
    Math.round(origin.x + radiusM),
    Math.round(origin.y + radiusM),
  ].join(',');

  // Fetched via a same-origin proxy (/api/3dbag) because api.3dbag.nl sends no
  // CORS headers, so the browser cannot reach it directly.
  const url = `${API_BASE}?bbox=${bbox}&limit=200`;
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`3DBAG API ${res.status}`);
  const doc = (await res.json()) as CityJsonLike & {
    features?: CityFeature[];
    CityObjects?: Record<string, CityObject>;
    vertices?: number[][];
  };

  const transform = resolveTransform(doc);
  const buildings: BuildingMesh[] = [];

  // The response is either a CityJSONFeatureCollection (features[]) or a single
  // CityJSON document (CityObjects + vertices at the root).
  const features: CityFeature[] = doc.features ?? [
    { CityObjects: doc.CityObjects, vertices: doc.vertices },
  ];

  const normTarget = targetBagId ? stripPrefix(targetBagId) : null;

  // Vertices carry their absolute NAP height; we collect everything with raw
  // heights, then offset the whole scene by the lowest vertex used so it sits on
  // y=0 (post-pass — robust regardless of how the API nests its transform).
  let globalMinRawY = Infinity;
  let targetFootprint: { x: number; z: number }[] | null = null;
  let targetFootprintAvgY = Infinity;

  for (const feature of features) {
    const vertices = feature.vertices;
    const objects = feature.CityObjects;
    if (!vertices || !objects) continue;

    for (const [objId, obj] of Object.entries(objects)) {
      if (!obj.geometry || obj.geometry.length === 0) continue;
      const geom = pickGeometry(obj.geometry);
      if (!geom) continue;

      const surfaces = collectSurfaces(geom.type, geom.boundaries);
      if (surfaces.length === 0) continue;

      const bagId = bagIdFromObject(objId, obj);
      const isTarget = normTarget != null && bagId != null && bagId.includes(normTarget);

      const tris: number[] = [];
      let minRawY = Infinity;
      let maxRawY = -Infinity;

      const toScene = (idx: number): [number, number, number] => {
        const v = vertices[idx];
        const rx = v[0] * transform.scale[0] + transform.translate[0];
        const ry = v[1] * transform.scale[1] + transform.translate[1];
        const rz = v[2] * transform.scale[2] + transform.translate[2];
        minRawY = Math.min(minRawY, rz);
        maxRawY = Math.max(maxRawY, rz);
        globalMinRawY = Math.min(globalMinRawY, rz);
        return [rx - origin.x, rz, -(ry - origin.y)];
      };

      for (const surface of surfaces) {
        const outer = surface[0];
        if (!outer || outer.length < 3) continue;
        const pts = outer.map(toScene);
        // Fan triangulation of the outer ring (holes ignored; LoD 1.2/1.3
        // surfaces are prismatic so this is exact).
        for (let i = 1; i < pts.length - 1; i++) {
          tris.push(...pts[0], ...pts[i], ...pts[i + 1]);
        }
        // For the target building, keep the lowest surface ring as its footprint.
        if (isTarget) {
          const avgY = pts.reduce((s, p) => s + p[1], 0) / pts.length;
          if (avgY < targetFootprintAvgY && pts.length >= 4) {
            targetFootprintAvgY = avgY;
            targetFootprint = pts.map((p) => ({ x: p[0], z: p[2] }));
          }
        }
      }

      if (tris.length === 0) continue;

      buildings.push({
        positions: new Float32Array(tris),
        bagId,
        isTarget,
        approxHeight: Number.isFinite(maxRawY - minRawY) ? maxRawY - minRawY : 0,
      });
    }
  }

  // Offset every vertex down so the lowest point rests on y=0.
  const groundZ = Number.isFinite(globalMinRawY) ? globalMinRawY : 0;
  if (groundZ !== 0) {
    for (const b of buildings) {
      for (let i = 1; i < b.positions.length; i += 3) b.positions[i] -= groundZ;
    }
  }

  // Convert the pre-snap (open white-spot) point into the local scene frame so
  // we can orient the locker toward open space.
  let openDir: { x: number; z: number } | null = null;
  if (opts.preSnapLat != null && opts.preSnapLon != null) {
    const pre = wgs84ToRd(opts.preSnapLat, opts.preSnapLon);
    openDir = { x: pre.x - origin.x, z: -(pre.y - origin.y) };
  }

  const snapCandidates = targetFootprint
    ? computeSnapCandidates(targetFootprint, openDir)
    : [];

  return { buildings, originRd: origin, groundZ, snapCandidates };
}

/**
 * Derive candidate locker placements flush against the target building's walls.
 * For each footprint edge it computes the midpoint, the outward normal and a
 * locker centre offset clear of the wall, facing outward. Candidates are ordered
 * best-first: nearest the suggestion point (scene origin), then longest walls.
 */
function computeSnapCandidates(
  footprint: { x: number; z: number }[],
  openPoint: { x: number; z: number } | null,
): SnapPose[] {
  const n = footprint.length;
  if (n < 3) return [];

  // Drop a duplicated closing vertex if present.
  const ring =
    Math.abs(footprint[0].x - footprint[n - 1].x) < 1e-6 &&
    Math.abs(footprint[0].z - footprint[n - 1].z) < 1e-6
      ? footprint.slice(0, -1)
      : footprint;

  const cx = ring.reduce((s, p) => s + p.x, 0) / ring.length;
  const cz = ring.reduce((s, p) => s + p.z, 0) / ring.length;

  const LOCKER_DEPTH = 0.89;
  const GAP = 0.12;
  const candidates: SnapPose[] = [];

  for (let i = 0; i < ring.length; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    const ex = b.x - a.x;
    const ez = b.z - a.z;
    const len = Math.hypot(ex, ez);
    if (len < 1.0) continue; // too short to host a locker

    const mx = (a.x + b.x) / 2;
    const mz = (a.z + b.z) / 2;

    // Two normal candidates; pick the one pointing away from the centroid.
    let nx = ez / len;
    let nz = -ex / len;
    if (nx * (mx - cx) + nz * (mz - cz) < 0) {
      nx = -nx;
      nz = -nz;
    }

    // Openness score: how well the outward normal points toward the open
    // white-spot (higher = faces public space, the ideal locker side).
    let openness = 0;
    if (openPoint) {
      const dx = openPoint.x - cx;
      const dz = openPoint.z - cz;
      const dl = Math.hypot(dx, dz) || 1;
      openness = (nx * dx + nz * dz) / dl;
    }

    candidates.push({
      x: mx + nx * (LOCKER_DEPTH / 2 + GAP),
      z: mz + nz * (LOCKER_DEPTH / 2 + GAP),
      rotationY: Math.atan2(nx, nz),
      wallLength: len,
      openness,
    });
  }

  // Best first: walls facing the open white-spot, then longest walls. Without an
  // open-space hint, fall back to the wall nearest the suggestion point.
  candidates.sort((p, q) => {
    if (openPoint && Math.abs(q.openness - p.openness) > 0.15) {
      return q.openness - p.openness;
    }
    if (!openPoint) {
      const dp = Math.hypot(p.x, p.z);
      const dq = Math.hypot(q.x, q.z);
      if (Math.abs(dp - dq) > 1.5) return dp - dq;
    }
    return q.wallLength - p.wallLength;
  });

  return candidates.slice(0, 8);
}

function stripPrefix(id: string): string {
  return id.replace(/^NL\.IMBAG\.Pand\./, '').replace(/\D/g, '');
}

function bagIdFromObject(objId: string, obj: CityObject): string | null {
  const attr = obj.attributes ?? {};
  const candidate =
    (attr['identificatie'] as string | undefined) ??
    (attr['pandidentificatie'] as string | undefined) ??
    objId;
  if (!candidate) return null;
  const digits = stripPrefix(String(candidate));
  return digits.length >= 8 ? digits : null;
}
