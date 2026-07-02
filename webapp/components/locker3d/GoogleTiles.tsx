'use client';

import { useContext, useEffect, useRef, useState } from 'react';
import { useThree, useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import {
  TilesRenderer,
  TilesPlugin,
  TilesRendererContext,
} from '3d-tiles-renderer/r3f';
import { ReorientationPlugin } from '3d-tiles-renderer/plugins';
import {
  GOOGLE_3D_ROOT,
  toGoogle3DProxyURL,
  probeGoogle3D,
  type Google3DError,
} from '@/lib/google3d';

const DEG2RAD = Math.PI / 180;

// Starting guess for the ground's ellipsoid height (m) in the Netherlands:
// geoid undulation (~43 m) plus near-sea-level terrain. AutoGround refines this
// per-site by raycasting the real tile surface, so the exact value is not
// critical — it just needs to be in the right ballpark for the first frames.
const NL_GROUND_ELLIPSOID_HEIGHT = 43;

/**
 * Minimal tiles plugin that rewrites every requested URL through our proxy.
 * The renderer invokes `preprocessURL` on each plugin for both the root tileset
 * and every child tile, so this keeps the whole tree same-origin and keyless.
 */
class ProxyURLPlugin {
  name = 'PROXY_URL_PLUGIN';
  preprocessURL = (uri: string | URL): string => toGoogle3DProxyURL(uri);
}

/**
 * Drops the locker onto the real Google ground. The locker stands at the scene
 * origin (y=0); ReorientationPlugin recenters the tileset so the point at
 * `height` along the ellipsoid normal is the origin. We don't know that height
 * exactly, so once tiles exist we raycast straight down through the origin, read
 * the surface y, and nudge `height` by that amount — one pass lands the ground
 * at y=0 regardless of local terrain/geoid.
 */
// Plausible ellipsoid-height band for NL ground (geoid ~43 m ± terrain). The
// corrected reference height is clamped here so a bad sample can never fling the
// locker hundreds of metres.
const MIN_GROUND_H = 10;
const MAX_GROUND_H = 120;
// Ignore raycast hits this far from the deck — they are coarse low-LOD tiles
// sampled before refinement, not the real surface.
const OUTLIER_M = 60;

function AutoGround({
  baseHeight,
  onResolved,
}: {
  baseHeight: number;
  onResolved: (height: number) => void;
}) {
  const tiles = useContext(TilesRendererContext);
  const invalidate = useThree((s) => s.invalidate);
  const raycaster = useRef(new THREE.Raycaster());
  const done = useRef(false);
  const frames = useRef(0);
  const lastY = useRef<number | null>(null);

  useFrame(() => {
    if (done.current || !tiles?.group) return;
    // Give the tileset a moment to start refining before sampling.
    if (frames.current++ < 30) return;

    raycaster.current.set(new THREE.Vector3(0, 1500, 0), new THREE.Vector3(0, -1, 0));
    raycaster.current.far = 5000;
    const hits = raycaster.current.intersectObject(tiles.group, true);
    if (hits.length === 0) return; // no geometry under the origin yet

    const surfaceY = hits[0].point.y;
    if (Math.abs(surfaceY) > OUTLIER_M) return; // coarse-tile outlier — keep waiting

    // Commit only once the reading is stable across two frames (fine tiles in).
    if (lastY.current === null || Math.abs(surfaceY - lastY.current) > 0.5) {
      lastY.current = surfaceY;
      return;
    }

    done.current = true;
    if (Math.abs(surfaceY) > 0.3) {
      const next = Math.min(MAX_GROUND_H, Math.max(MIN_GROUND_H, baseHeight + surfaceY));
      onResolved(next);
      invalidate();
    }
  });

  return null;
}

/** Reports the tiles' Object3D group up to the scene (for ground raycasting). */
function GroundExposer({ onGround }: { onGround: (g: THREE.Object3D | null) => void }) {
  const tiles = useContext(TilesRendererContext);
  useEffect(() => {
    onGround(tiles?.group ?? null);
    return () => onGround(null);
  }, [tiles, onGround]);
  return null;
}

interface GoogleTilesProps {
  lat: number;
  lon: number;
  onError?: (e: Google3DError) => void;
  onReady?: () => void;
  /** Receives the tiles group so the scene can raycast the surface. */
  onGround?: (g: THREE.Object3D | null) => void;
}

/**
 * Renders Google Photorealistic 3D Tiles inside the existing local scene, with
 * the suggestion's lat/lon at the origin (so the locker stands on the real
 * ground). All tile traffic flows through /api/google3d (key server-side,
 * rate-limited); coverage / rate-limit problems are reported via onError so the
 * caller can fall back to the 3DBAG scene.
 */
export default function GoogleTiles({ lat, lon, onError, onReady, onGround }: GoogleTilesProps) {
  const [groundHeight, setGroundHeight] = useState(NL_GROUND_ELLIPSOID_HEIGHT);

  // Probe once to classify coverage / rate-limit / config errors. The proxy
  // dedupes this against the renderer's own root fetch, so it costs no extra
  // rate-limit slot.
  useEffect(() => {
    const ctrl = new AbortController();
    probeGoogle3D(ctrl.signal).then((err) => {
      if (ctrl.signal.aborted) return;
      if (err) onError?.(err);
      else onReady?.();
    });
    return () => ctrl.abort();
  }, [lat, lon, onError, onReady]);

  // Reset the ground guess when the location changes.
  useEffect(() => {
    setGroundHeight(NL_GROUND_ELLIPSOID_HEIGHT);
  }, [lat, lon]);

  return (
    // errorTarget = max screen-space error (px) before a tile refines; lower =
    // sharper geometry/textures at the cost of more tile streaming (free within
    // a session — bandwidth/perf only). Default is 6; 1 = maximum on-screen
    // detail Google serves for the area.
    <TilesRenderer url={GOOGLE_3D_ROOT} errorTarget={1}>
      <TilesPlugin plugin={ProxyURLPlugin} />
      <TilesPlugin
        plugin={ReorientationPlugin}
        args={[{ lat: lat * DEG2RAD, lon: lon * DEG2RAD, height: groundHeight, recenter: true }]}
      />
      <AutoGround baseHeight={groundHeight} onResolved={setGroundHeight} />
      {onGround && <GroundExposer onGround={onGround} />}
    </TilesRenderer>
  );
}
