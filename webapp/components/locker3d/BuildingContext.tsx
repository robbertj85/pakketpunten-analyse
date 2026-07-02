'use client';

import { useEffect, useMemo, useState } from 'react';
import * as THREE from 'three';
import { fetchBuildingScene, BuildingMesh, SnapPose } from '@/lib/threedbag';

interface BuildingContextProps {
  lat: number;
  lon: number;
  targetBagId?: string | null;
  preSnapLat?: number | null;
  preSnapLon?: number | null;
  radiusM?: number;
  onStatus?: (status: BuildingLoadStatus) => void;
  /** When false, fetch + report the snap poses but draw no meshes (used under
   *  Google photoreal tiles, which already provide the buildings). */
  render?: boolean;
}

export interface BuildingLoadStatus {
  loading: boolean;
  error: string | null;
  count: number;
  hasTarget: boolean;
  snapCandidates: SnapPose[];
}

/**
 * Fetches nearby building geometry from 3DBAG and renders it as context around
 * the locker. The target building (matching the suggestion's BAG id) is tinted
 * to make the placement legible.
 */
export default function BuildingContext({
  lat,
  lon,
  targetBagId,
  preSnapLat,
  preSnapLon,
  radiusM = 70,
  onStatus,
  render = true,
}: BuildingContextProps) {
  const [buildings, setBuildings] = useState<BuildingMesh[]>([]);

  useEffect(() => {
    const ctrl = new AbortController();
    let cancelled = false;
    onStatus?.({ loading: true, error: null, count: 0, hasTarget: false, snapCandidates: [] });

    fetchBuildingScene({ lat, lon, targetBagId, preSnapLat, preSnapLon, radiusM, signal: ctrl.signal })
      .then((data) => {
        if (cancelled) return;
        setBuildings(data.buildings);
        onStatus?.({
          loading: false,
          error: null,
          count: data.buildings.length,
          hasTarget: data.buildings.some((b) => b.isTarget),
          snapCandidates: data.snapCandidates,
        });
      })
      .catch((err: unknown) => {
        if (cancelled || (err instanceof DOMException && err.name === 'AbortError')) return;
        setBuildings([]);
        onStatus?.({
          loading: false,
          error: err instanceof Error ? err.message : 'Onbekende fout',
          count: 0,
          hasTarget: false,
          snapCandidates: [],
        });
      });

    return () => {
      cancelled = true;
      ctrl.abort();
    };
  }, [lat, lon, targetBagId, preSnapLat, preSnapLon, radiusM, onStatus]);

  if (!render) return null;

  return (
    <group>
      {buildings.map((b, i) => (
        <BuildingMeshView key={i} mesh={b} />
      ))}
    </group>
  );
}

function BuildingMeshView({ mesh }: { mesh: BuildingMesh }) {
  const geometry = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(mesh.positions, 3));
    g.computeVertexNormals();
    return g;
  }, [mesh.positions]);

  useEffect(() => () => geometry.dispose(), [geometry]);

  return (
    <mesh geometry={geometry} castShadow={mesh.isTarget} receiveShadow>
      <meshStandardMaterial
        color={mesh.isTarget ? '#f5a35a' : '#cfcbc3'}
        roughness={0.85}
        metalness={0.05}
        flatShading
        side={THREE.DoubleSide}
        // Ghost the surrounding buildings so they don't hide the locker.
        transparent={!mesh.isTarget}
        opacity={mesh.isTarget ? 1 : 0.5}
        depthWrite={mesh.isTarget}
      />
    </mesh>
  );
}
