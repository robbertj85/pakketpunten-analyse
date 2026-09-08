// Fetch building geometry from the 3DBAG API (TU Delft, CC BY 4.0) and convert
// it into flat vertex arrays usable by three.js.
//
// API: https://api.3dbag.nl  — OGC API Features, returns CityJSON(Feature).
//   - by BAG pand id: /collections/pand/items/NL.IMBAG.Pand.{16-digit}
//   - by bbox (RD/EPSG:28992): /collections/pand/items?bbox=minx,miny,maxx,maxy
//
// CityJSON vertices are integers compressed by a per-response transform
// (real = vertex * scale + translate) in EPSG:7415 (RD x/y + NAP height, metres).
// We project them into a local scene frame: X=east, Y=up, Z=south, relative to
// a chosen origin (RD x/y). Every pand is grounded individually: its 3DBAG
// maaiveld (`b3_h_maaiveld`, the ground level next to the building) lands on
// y=0, so buildings never float above the flat ground plane when the
// neighbourhood is not level. The lowest vertex is NOT used for this: LoD 2.2
// solids may dip metres below ground (sunken parking, ramps), which would
// lift the real ground floor into the air. The target pand's maaiveld (m NAP)
// is reported as `groundZ` for display.
//
// The API pages at 50 panden per response (regardless of `limit`), so a bbox
// fetch follows the `next` links; each page carries its own transform.

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
  /**
   * Maaiveld (m NAP) of the target pand, or the median maaiveld of the loaded
   * panden when the target is absent. Informational: every pand is grounded
   * on y=0 individually.
   */
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
  links?: { rel?: string; href?: string }[];
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
  /** Called after every 3DBAG page with the number of panden fetched so far. */
  onProgress?: (buildingsSoFar: number) => void;
  signal?: AbortSignal;
}

/** 3DBAG serves at most this many panden per page whatever `limit` says. */
const PAGE_LIMIT = 100;
/** Stop paging once this many panden are collected (a 140 m box holds ~100). */
const MAX_BUILDINGS = 300;

type PageDoc = CityJsonLike & {
  features?: CityFeature[];
  CityObjects?: Record<string, CityObject>;
  vertices?: number[][];
};

/** Offset of the `next` link (OGC API Features paging), or null when done. */
function nextOffset(doc: PageDoc): number | null {
  const href = doc.links?.find((l) => l.rel === 'next')?.href;
  if (!href) return null;
  const m = /[?&]offset=(\d+)/.exec(href);
  return m ? Number(m[1]) : null;
}

/**
 * Fetch every page of panden in the bbox. Each page keeps its own transform:
 * 3DBAG re-bases the integer vertices per response, so stitching pages under
 * the first page's translate would shift later buildings by tens of metres.
 */
async function fetchAllPages(
  bbox: string,
  signal?: AbortSignal,
  onProgress?: (buildingsSoFar: number) => void,
): Promise<{ features: CityFeature[]; transform: Transform }[]> {
  const pages: { features: CityFeature[]; transform: Transform }[] = [];
  let offset: number | null = 0;
  let total = 0;
  while (offset != null && total < MAX_BUILDINGS) {
    const url =
      `${API_BASE}?bbox=${bbox}&limit=${PAGE_LIMIT}` + (offset > 0 ? `&offset=${offset}` : '');
    const res = await fetch(url, { signal });
    if (!res.ok) throw new Error(`3DBAG API ${res.status}`);
    const doc = (await res.json()) as PageDoc;
    // The response is either a CityJSONFeatureCollection (features[]) or a
    // single CityJSON document (CityObjects + vertices at the root).
    const features: CityFeature[] = doc.features ?? [
      { CityObjects: doc.CityObjects, vertices: doc.vertices },
    ];
    pages.push({ features, transform: resolveTransform(doc) });
    total += features.length;
    onProgress?.(total);
    if (features.length === 0) break;
    offset = nextOffset(doc);
  }
  return pages;
}

export async function fetchBuildingScene(
  opts: FetchBuildingsOptions,
): Promise<BuildingSceneData> {
  const { lat, lon, targetBagId, radiusM = 70, signal, onProgress } = opts;
  const origin = wgs84ToRd(lat, lon);
  const bbox = [
    Math.round(origin.x - radiusM),
    Math.round(origin.y - radiusM),
    Math.round(origin.x + radiusM),
    Math.round(origin.y + radiusM),
  ].join(',');

  // Fetched via a same-origin proxy (/api/3dbag) because api.3dbag.nl sends no
  // CORS headers, so the browser cannot reach it directly.
  const pages = await fetchAllPages(bbox, signal, onProgress);
  const buildings: BuildingMesh[] = [];
  // Grounding key per mesh (BAG id, so BuildingParts of one pand share a floor).
  const floorKeys: string[] = [];
  const floorByPand = new Map<string, number>();

  const normTarget = targetBagId ? stripPrefix(targetBagId) : null;

  // Vertices carry their absolute NAP height. We collect everything with raw
  // heights and ground each pand afterwards (its lowest vertex -> y=0).
  let targetFootprint: { x: number; z: number }[] | null = null;
  let targetFootprintScore = -Infinity;
  // Ground ring of every object: the wall snap must not put the cabinet inside
  // a neighbour (row houses share party walls) or inside the target itself.
  const groundRings: { x: number; z: number }[][] = [];

  for (const { features, transform } of pages) for (const feature of features) {
    const vertices = feature.vertices;
    const objects = feature.CityObjects;
    if (!vertices || !objects) continue;

    // Ground level of this pand from the parent Building's 3DBAG attributes
    // (the BuildingParts that carry the solids have no attributes).
    let maaiveld: number | null = null;
    for (const o of Object.values(objects)) {
      const m = o.attributes?.['b3_h_maaiveld'];
      if (typeof m === 'number' && Number.isFinite(m)) {
        maaiveld = m;
        break;
      }
    }

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
      let lowestRing: { x: number; z: number }[] | null = null;
      let lowestRingAvgY = Infinity;
      // Largest ring at ground level: the footprint the cabinet snaps to.
      let groundRing: { x: number; z: number }[] | null = null;
      let groundRingArea = 0;

      const toScene = (idx: number): [number, number, number] => {
        const v = vertices[idx];
        const rx = v[0] * transform.scale[0] + transform.translate[0];
        const ry = v[1] * transform.scale[1] + transform.translate[1];
        const rz = v[2] * transform.scale[2] + transform.translate[2];
        minRawY = Math.min(minRawY, rz);
        maxRawY = Math.max(maxRawY, rz);
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
        // Track the lowest ring (fallback) and the largest ring within 1 m of
        // the maaiveld (the real footprint; a sunken ramp ring sits lower).
        if (pts.length >= 4) {
          const avgY = pts.reduce((s, p) => s + p[1], 0) / pts.length;
          const ring2d = pts.map((p) => ({ x: p[0], z: p[2] }));
          if (avgY < lowestRingAvgY) {
            lowestRingAvgY = avgY;
            lowestRing = ring2d;
          }
          if (maaiveld != null && Math.abs(avgY - maaiveld) < 1.0) {
            const area = ringArea(ring2d);
            if (area > groundRingArea) {
              groundRingArea = area;
              groundRing = ring2d;
            }
          }
        }
      }

      if (tris.length === 0) continue;
      const footRing = groundRing ?? lowestRing;
      if (footRing) {
        groundRings.push(footRing);
        // Target footprint: prefer a ground-level ring (largest), else the
        // lowest ring across its parts.
        const score = groundRing ? groundRingArea : -1;
        if (isTarget && score > targetFootprintScore) {
          targetFootprintScore = score;
          targetFootprint = footRing;
        }
      }

      buildings.push({
        positions: new Float32Array(tris),
        bagId,
        isTarget,
        approxHeight: Number.isFinite(maxRawY - minRawY) ? maxRawY - minRawY : 0,
      });
      const key = bagId ?? `#${objId}`;
      floorKeys.push(key);
      const floor = maaiveld ?? minRawY;
      if (Number.isFinite(floor)) {
        floorByPand.set(key, Math.min(floorByPand.get(key) ?? Infinity, floor));
      }
    }
  }

  // Ground every pand on its own maaiveld so nothing floats; geometry below
  // ground (basements, ramps) simply disappears under the ground plane.
  let targetFloor: number | null = null;
  buildings.forEach((b, i) => {
    const floor = floorByPand.get(floorKeys[i]);
    if (floor == null || !Number.isFinite(floor)) return;
    if (b.isTarget) targetFloor = floor;
    if (floor === 0) return;
    for (let j = 1; j < b.positions.length; j += 3) b.positions[j] -= floor;
  });
  const floors = [...floorByPand.values()].filter(Number.isFinite).sort((a, b) => a - b);
  const groundZ: number =
    targetFloor ?? (floors.length ? floors[Math.floor(floors.length / 2)] : 0);

  // Convert the pre-snap (open white-spot) point into the local scene frame so
  // we can orient the locker toward open space.
  let openDir: { x: number; z: number } | null = null;
  if (opts.preSnapLat != null && opts.preSnapLon != null) {
    const pre = wgs84ToRd(opts.preSnapLat, opts.preSnapLon);
    openDir = { x: pre.x - origin.x, z: -(pre.y - origin.y) };
  }

  const snapCandidates = targetFootprint
    ? computeSnapCandidates(
        targetFootprint,
        openDir,
        groundRings.filter((r) => r !== targetFootprint),
      )
    : [];

  return { buildings, originRd: origin, groundZ, snapCandidates };
}

/**
 * Derive candidate locker placements flush against the target building's walls.
 * For each footprint edge the locker centre is the point ON that wall nearest
 * the suggestion coordinate (scene origin) — not the wall midpoint — offset
 * outward, facing away from the building. Large panden (shopping blocks) have
 * walls whose midpoints sit 50+ m from the suggestion; sliding along the wall
 * keeps the 3D placement true to the 2D advice.
 *
 * Ranking balances distance against facing the open white-spot (10 m of extra
 * distance is worth one full unit of openness), and candidates farther than
 * MAX_SNAP_DIST_M from the suggestion are dropped whenever a nearer wall exists.
 *
 * The outward side of a wall follows the ring's winding (the centroid test
 * fails on L-shaped buildings), and a pose is rejected when the cabinet
 * would stand inside the target or inside any neighbouring footprint (party
 * walls in a terrace) — those walls have no street side.
 */
const MAX_SNAP_DIST_M = 40;
/** Half-width (m) of the cabinet strip tested against neighbouring footprints. */
const SNAP_TEST_HALF_WIDTH_M = 1.5;

type Pt = { x: number; z: number };

/** Absolute shoelace area of a ring on the ground plane (x/z). */
function ringArea(ring: Pt[]): number {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    a += ring[j].x * ring[i].z - ring[i].x * ring[j].z;
  }
  return Math.abs(a) / 2;
}

/** Ray-casting point-in-polygon on the ground plane (x/z). */
function pointInRing(x: number, z: number, ring: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i];
    const b = ring[j];
    if (a.z > z !== b.z > z && x < ((b.x - a.x) * (z - a.z)) / (b.z - a.z) + a.x) {
      inside = !inside;
    }
  }
  return inside;
}

function computeSnapCandidates(
  footprint: Pt[],
  openPoint: Pt | null,
  obstacles: Pt[][] = [],
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

  // Winding of the ring (shoelace) decides which edge normal points outward.
  let area2 = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    area2 += a.x * b.z - b.x * a.z;
  }
  const ccw = area2 > 0;

  // The cabinet strip must be clear of every footprint, the target included.
  const blocked = (x: number, z: number, ax: number, az: number): boolean => {
    const probes: Pt[] = [
      { x, z },
      { x: x + ax * SNAP_TEST_HALF_WIDTH_M, z: z + az * SNAP_TEST_HALF_WIDTH_M },
      { x: x - ax * SNAP_TEST_HALF_WIDTH_M, z: z - az * SNAP_TEST_HALF_WIDTH_M },
    ];
    return probes.some(
      (p) => pointInRing(p.x, p.z, ring) || obstacles.some((o) => pointInRing(p.x, p.z, o)),
    );
  };

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

    // Point on this wall nearest the suggestion point (scene origin), kept
    // ~2 m clear of the corners so the cabinet doesn't overhang the façade.
    const tRaw = (-a.x * ex + -a.z * ez) / (len * len);
    const margin = Math.min(0.45, 2.0 / len);
    const t = Math.min(1 - margin, Math.max(margin, tRaw));
    const px = a.x + ex * t;
    const pz = a.z + ez * t;

    // Outward normal from the winding: for a counter-clockwise ring (in x/z)
    // the interior lies to the left of each edge, so outward is the right
    // normal; clockwise rings flip. Works for concave (L-shaped) footprints
    // where the centroid heuristic points into the building.
    let nx = ccw ? ez / len : -ez / len;
    let nz = ccw ? -ex / len : ex / len;
    const testX = px + nx * 0.5;
    const testZ = pz + nz * 0.5;
    if (pointInRing(testX, testZ, ring)) {
      // Winding hint wrong for this edge (self-touching ring): use the other side.
      nx = -nx;
      nz = -nz;
    }
    const offX = px + nx * (LOCKER_DEPTH / 2 + GAP);
    const offZ = pz + nz * (LOCKER_DEPTH / 2 + GAP);
    // Skip walls with no street side: party walls and inner corners.
    if (blocked(offX, offZ, ex / len, ez / len)) continue;

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
      x: offX,
      z: offZ,
      rotationY: Math.atan2(nx, nz),
      wallLength: len,
      openness,
    });
  }

  // Lower is better: metres from the suggestion, with a bonus for facing the
  // open white-spot (1.0 openness ≈ 10 m closer). Longest wall breaks ties.
  const score = (p: SnapPose) =>
    Math.hypot(p.x, p.z) - (openPoint ? p.openness * 10 : 0);
  candidates.sort((p, q) => score(p) - score(q) || q.wallLength - p.wallLength);

  // Cap the displacement: never present a far wall while a near one exists.
  const near = candidates.filter((p) => Math.hypot(p.x, p.z) <= MAX_SNAP_DIST_M);
  return (near.length > 0 ? near : candidates).slice(0, 8);
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
