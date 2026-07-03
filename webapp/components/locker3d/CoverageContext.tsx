'use client';

import { useMemo } from 'react';
import * as THREE from 'three';
import { Line, Html } from '@react-three/drei';
import buffer from '@turf/buffer';
import union from '@turf/union';
import { featureCollection, point } from '@turf/helpers';
import type { Feature, Polygon, MultiPolygon } from 'geojson';
import { wgs84ToRd } from '@/lib/rd';

export interface NearbyPoint {
  lat: number;
  lon: number;
  vervoerder: string;
  naam: string;
  distanceM: number;
}

interface CoverageContextProps {
  originLat: number;
  originLon: number;
  nearbyPoints: NearbyPoint[];
  preSnapLat?: number | null;
  preSnapLon?: number | null;
  bagDistanceM?: number | null;
  /** Walking-distance radius (m) for the merged buffer zone: 300 / 400 / 500. */
  bufferRadius?: number;
}

// Zone colour per radius — matches the buffer colours used elsewhere in the app.
export const BUFFER_COLORS: Record<number, string> = {
  300: '#2563eb',
  400: '#16a34a',
  500: '#f59e0b',
};

const CARRIER_COLORS: Record<string, string> = {
  postnl: '#ff6200',
  dhl: '#ffcc00',
  dpd: '#dc0032',
  amazon: '#ff9900',
  vintedgo: '#09b1ba',
  deburen: '#7c3aed',
  gls: '#06038d',
  inpost: '#ffcd00',
  viatim: '#e11d48',
  budbee: '#1f9d55',
};
function carrierColor(v: string): string {
  return CARRIER_COLORS[v.toLowerCase().replace(/[^a-z]/g, '')] ?? '#475569';
}

// Pairwise merge (same approach as the main map's "Samengevoegde buffers").
function pairwiseUnion(features: Feature<Polygon | MultiPolygon>[]): Feature<Polygon | MultiPolygon> | null {
  if (features.length === 0) return null;
  if (features.length === 1) return features[0];
  const next: Feature<Polygon | MultiPolygon>[] = [];
  for (let i = 0; i < features.length; i += 2) {
    if (i + 1 < features.length) {
      const result = union(featureCollection([features[i], features[i + 1]]));
      next.push((result as Feature<Polygon | MultiPolygon>) ?? features[i]);
    } else {
      next.push(features[i]);
    }
  }
  return pairwiseUnion(next);
}

/**
 * Overlays the placement-advice context onto the 3D ground: the merged
 * buffer zone ("samengevoegde buffers") of the existing parcel points at the
 * chosen walking distance, the points themselves (pins coloured per carrier),
 * a ring showing the new locker's own reach, and the displacement from the
 * densest 100 m-cell to the snapped building. Everything is drawn on the y=0
 * plane around the scene origin (the suggestion coordinate).
 */
export default function CoverageContext({
  originLat,
  originLon,
  nearbyPoints,
  preSnapLat,
  preSnapLon,
  bagDistanceM,
  bufferRadius = 400,
}: CoverageContextProps) {
  const origin = useMemo(() => wgs84ToRd(originLat, originLon), [originLat, originLon]);
  const toScene = useMemo(
    () =>
      (lat: number, lon: number): [number, number] => {
        const p = wgs84ToRd(lat, lon);
        return [p.x - origin.x, -(p.y - origin.y)];
      },
    [origin],
  );

  const preSnap = useMemo(() => {
    if (preSnapLat == null || preSnapLon == null) return null;
    const [x, z] = toScene(preSnapLat, preSnapLon);
    return { x, z };
  }, [preSnapLat, preSnapLon, toScene]);

  const zoneColor = BUFFER_COLORS[bufferRadius] ?? BUFFER_COLORS[400];

  // Merged buffer zone of the existing points at the chosen radius — the same
  // computation as the main map's "Samengevoegde buffers", but rendered as a
  // flat translucent zone on the 3D ground. Shapes are built in scene metres
  // ((x, -z) because the mesh is rotated -90° about X).
  const zone = useMemo(() => {
    if (nearbyPoints.length === 0) return null;
    try {
      const pts = featureCollection(nearbyPoints.map((p) => point([p.lon, p.lat])));
      const buffered = buffer(pts, bufferRadius / 1000, { units: 'kilometers', steps: 24 });
      if (!buffered || buffered.features.length === 0) return null;
      const merged = pairwiseUnion(buffered.features as Feature<Polygon | MultiPolygon>[]);
      if (!merged?.geometry) return null;
      const polys: number[][][][] =
        merged.geometry.type === 'Polygon'
          ? [merged.geometry.coordinates as number[][][]]
          : (merged.geometry.coordinates as number[][][][]);

      const shapes: THREE.Shape[] = [];
      const outlines: [number, number, number][][] = [];
      for (const rings of polys) {
        if (!rings.length) continue;
        const toShapePts = (ring: number[][]) =>
          ring.map(([lon, lat]) => {
            const [x, z] = toScene(lat, lon);
            return new THREE.Vector2(x, -z);
          });
        const shape = new THREE.Shape(toShapePts(rings[0]));
        for (let h = 1; h < rings.length; h++) {
          shape.holes.push(new THREE.Path(toShapePts(rings[h])));
        }
        shapes.push(shape);
        for (const ring of rings) {
          outlines.push(
            ring.map(([lon, lat]) => {
              const [x, z] = toScene(lat, lon);
              return [x, 0.06, z] as [number, number, number];
            }),
          );
        }
      }
      if (!shapes.length) return null;
      return { geometry: new THREE.ShapeGeometry(shapes), outlines };
    } catch {
      return null;
    }
  }, [nearbyPoints, bufferRadius, toScene]);

  return (
    <group>
      {/* Merged coverage zone of existing points ("samengevoegde buffers"). */}
      {zone && (
        <>
          <mesh
            geometry={zone.geometry}
            rotation={[-Math.PI / 2, 0, 0]}
            position={[0, 0.04, 0]}
          >
            <meshBasicMaterial
              color={zoneColor}
              transparent
              opacity={0.32}
              side={THREE.DoubleSide}
              depthWrite={false}
            />
          </mesh>
          {zone.outlines.map((pts, i) => (
            <Line key={`zo-${i}`} points={pts} color={zoneColor} lineWidth={2.5} transparent opacity={0.95} />
          ))}
        </>
      )}

      {/* The new locker's own reach at the same walking distance — faint filled
          disc plus a crisp outline ring. */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.045, 0]}>
        <circleGeometry args={[bufferRadius, 96]} />
        <meshBasicMaterial
          color="#7c3aed"
          transparent
          opacity={0.1}
          side={THREE.DoubleSide}
          depthWrite={false}
        />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.05, 0]}>
        <ringGeometry args={[bufferRadius - bufferRadius * 0.008, bufferRadius + bufferRadius * 0.008, 128]} />
        <meshBasicMaterial
          color="#7c3aed"
          transparent
          opacity={0.9}
          side={THREE.DoubleSide}
          depthWrite={false}
        />
      </mesh>

      {/* Existing parcel points — pin size scales with the walking distance so
          they stay visible in the (large) context overview. */}
      {nearbyPoints.map((p, i) => {
        const [x, z] = toScene(p.lat, p.lon);
        const c = carrierColor(p.vervoerder);
        const stem = bufferRadius * 0.055; // ~22 m tall at 400 m
        const head = bufferRadius * 0.022; // ~9 m head at 400 m
        return (
          <group key={`pt-${i}`} position={[x, 0, z]}>
            <mesh position={[0, stem / 2, 0]}>
              <cylinderGeometry args={[head * 0.15, head * 0.15, stem, 8]} />
              <meshBasicMaterial color={c} />
            </mesh>
            <mesh position={[0, stem + head * 0.6, 0]}>
              <sphereGeometry args={[head, 16, 16]} />
              <meshBasicMaterial color={c} />
            </mesh>
          </group>
        );
      })}

      {/* Densest 100 m-cell → snapped building displacement. */}
      {preSnap && (
        <>
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[preSnap.x, 0.05, preSnap.z]}>
            <ringGeometry args={[3.5, 5.5, 32]} />
            <meshBasicMaterial color="#db2777" transparent opacity={0.9} side={THREE.DoubleSide} />
          </mesh>
          <Line
            points={[
              [preSnap.x, 0.3, preSnap.z],
              [0, 0.3, 0],
            ]}
            color="#db2777"
            lineWidth={2}
            dashed
            dashSize={3}
            gapSize={2}
          />
          {bagDistanceM != null && (
            <Html
              position={[preSnap.x / 2, 2, preSnap.z / 2]}
              center
              distanceFactor={120}
              occlude={false}
            >
              <div
                style={{
                  background: '#db2777',
                  color: '#fff',
                  fontSize: 11,
                  fontWeight: 600,
                  padding: '2px 7px',
                  borderRadius: 6,
                  whiteSpace: 'nowrap',
                  fontFamily: 'system-ui, sans-serif',
                  userSelect: 'none',
                  pointerEvents: 'none',
                }}
              >
                {bagDistanceM} m verschoven t.o.v. dichtste 100 m-cel
              </div>
            </Html>
          )}
        </>
      )}
    </group>
  );
}
