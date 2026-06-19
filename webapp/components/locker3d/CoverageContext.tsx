'use client';

import { useMemo } from 'react';
import * as THREE from 'three';
import { Line, Html } from '@react-three/drei';
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
  /** How many of the nearest points also get 300/400/500 m coverage rings. */
  ringsForNearest?: number;
}

// Coverage-ring colours by radius (matches the legend in the config panel).
const RINGS: { r: number; color: string }[] = [
  { r: 300, color: '#2563eb' },
  { r: 400, color: '#16a34a' },
  { r: 500, color: '#f59e0b' },
];

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

/**
 * Overlays the placement-advice context onto the 3D ground: existing parcel
 * points within range (markers, coloured per carrier) with their 300/400/500 m
 * coverage rings, plus the displacement from the densest 100 m-cell to the
 * snapped building. Everything is drawn on the y=0 plane around the scene origin
 * (the suggestion coordinate).
 */
export default function CoverageContext({
  originLat,
  originLon,
  nearbyPoints,
  preSnapLat,
  preSnapLon,
  bagDistanceM,
  ringsForNearest = 8,
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

  return (
    <group>
      {/* Coverage rings of the nearest existing points. */}
      {nearbyPoints.slice(0, ringsForNearest).map((p, i) => {
        const [x, z] = toScene(p.lat, p.lon);
        return (
          <group key={`rings-${i}`} position={[x, 0, z]}>
            {RINGS.map(({ r, color }) => (
              <mesh key={r} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.03, 0]}>
                <ringGeometry args={[r - 1.6, r + 1.6, 120]} />
                <meshBasicMaterial
                  color={color}
                  transparent
                  opacity={0.55}
                  side={THREE.DoubleSide}
                  depthWrite={false}
                />
              </mesh>
            ))}
          </group>
        );
      })}

      {/* Existing parcel points. */}
      {nearbyPoints.map((p, i) => {
        const [x, z] = toScene(p.lat, p.lon);
        const c = carrierColor(p.vervoerder);
        return (
          <group key={`pt-${i}`} position={[x, 0, z]}>
            <mesh position={[0, 4, 0]}>
              <cylinderGeometry args={[0.5, 0.5, 8, 8]} />
              <meshBasicMaterial color={c} />
            </mesh>
            <mesh position={[0, 8.5, 0]}>
              <sphereGeometry args={[3.2, 16, 16]} />
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
