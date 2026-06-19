'use client';

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useThree, useFrame } from '@react-three/fiber';
import { OrbitControls, Grid, Sky } from '@react-three/drei';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import * as THREE from 'three';
import { LockerSpec, CarrierSkin } from '@/lib/lockerCatalog';
import { wgs84ToRd } from '@/lib/rd';
import type { Google3DError } from '@/lib/google3d';
import LockerModel from './LockerModel';
import BuildingContext, { BuildingLoadStatus } from './BuildingContext';
import GoogleTiles from './GoogleTiles';
import CoverageContext, { type NearbyPoint } from './CoverageContext';
import type { NavInput, NavMode } from './NavControls';

interface Locker3DSceneProps {
  spec: LockerSpec;
  skin: CarrierSkin;
  rotationY: number;
  lockerPosition?: [number, number, number];
  /** Position the camera frames on (the snap point — stable during manual moves). */
  framePosition?: [number, number, number];
  /** Outward facing direction of the active wall (for camera framing). */
  faceDir?: [number, number];
  showLabels: boolean;
  showBuildings: boolean;
  showAerial: boolean;
  /** When true, replace the 3DBAG/PDOK ground with Google Photorealistic 3D Tiles. */
  photoreal?: boolean;
  onPhotoError?: (e: Google3DError) => void;
  onPhotoReady?: () => void;
  /** Grab-and-drag the cabinet to here (scene XZ on the ground surface). */
  onMoveLocker?: (x: number, z: number) => void;
  /** On-screen nav pad: which target the buttons drive, and their held state. */
  navMode?: NavMode;
  navInputRef?: { current: NavInput };
  onNudgeRotation?: (delta: number) => void;
  /** Clicking the cabinet selects it (buttons move it); clicking away deselects. */
  onSelectObject?: () => void;
  onDeselect?: () => void;
  /** Keep the locker centred in view while it is moved with the buttons. */
  followLocker?: boolean;
  /** Bumping this number re-frames the camera on the locker on demand. */
  recenterNonce?: number;
  lat: number;
  lon: number;
  targetBagId?: string | null;
  preSnapLat?: number | null;
  preSnapLon?: number | null;
  onBuildingStatus?: (s: BuildingLoadStatus) => void;
  /** Placement-advice context overlay: nearby points + coverage rings + displacement. */
  showContext?: boolean;
  nearbyPoints?: NearbyPoint[];
  bagDistanceM?: number | null;
  /** Bumping this frames a wide overview to reveal the context overlay. */
  contextNonce?: number;
}

/** Half-size (metres) of the aerial ground tile around the suggestion point. */
const GROUND_HALF_M = 120;

export default function Locker3DScene({
  spec,
  skin,
  rotationY,
  lockerPosition = [0, 0, 0],
  framePosition,
  faceDir,
  showLabels,
  showBuildings,
  showAerial,
  photoreal = false,
  onPhotoError,
  onPhotoReady,
  onMoveLocker,
  navMode = 'camera',
  navInputRef,
  onNudgeRotation,
  onSelectObject,
  onDeselect,
  followLocker = true,
  recenterNonce = 0,
  lat,
  lon,
  targetBagId,
  preSnapLat,
  preSnapLon,
  onBuildingStatus,
  showContext = false,
  nearbyPoints,
  bagDistanceM,
  contextNonce = 0,
}: Locker3DSceneProps) {
  const frame = framePosition ?? lockerPosition;
  const handleStatus = useCallback(
    (s: BuildingLoadStatus) => onBuildingStatus?.(s),
    [onBuildingStatus],
  );

  // Selecting the cabinet (clicking it, or the "Automaat" toggle) hands the nav
  // buttons to the locker; the mouse always drives the camera. `groundY` clamps
  // the cabinet onto the real surface under it (Google tile roof/street).
  const selected = navMode === 'object';
  const [groundY, setGroundY] = useState(0);
  const groundObjRef = useRef<THREE.Object3D | null>(null);
  const lockerXZ: [number, number] = [lockerPosition[0], lockerPosition[2]];
  const lockerRenderPos: [number, number, number] = [lockerPosition[0], groundY, lockerPosition[2]];

  return (
    <Canvas
      shadows
      dpr={[1, 2]}
      camera={{ position: [10, 7, 13], fov: 45, near: 0.1, far: 2000 }}
      style={{ background: 'linear-gradient(#bcd6f0, #e8f0f8)' }}
      onPointerMissed={() => onDeselect?.()}
    >
      <Sky sunPosition={[60, 40, 30]} distance={1000} />
      <ambientLight intensity={0.55} />
      <hemisphereLight intensity={1.05} groundColor="#b9bcc2" />
      <directionalLight
        position={[18, 26, 14]}
        intensity={1.7}
        castShadow
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
        shadow-camera-left={-40}
        shadow-camera-right={40}
        shadow-camera-top={40}
        shadow-camera-bottom={-40}
      />

      {/* Ground: Google photoreal tiles, a PDOK aerial photo, or a neutral grid. */}
      {photoreal ? (
        <GoogleTiles
          lat={lat}
          lon={lon}
          onError={onPhotoError}
          onReady={onPhotoReady}
          onGround={(g) => (groundObjRef.current = g)}
        />
      ) : showAerial ? (
        <AerialGround lat={lat} lon={lon} halfM={showContext ? 600 : GROUND_HALF_M} />
      ) : (
        <>
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.01, 0]} receiveShadow>
            <planeGeometry args={[400, 400]} />
            <meshStandardMaterial color="#c8c4bc" roughness={1} />
          </mesh>
          <Grid
            position={[0, 0, 0]}
            args={[200, 200]}
            cellSize={1}
            cellThickness={0.5}
            cellColor="#9ca3af"
            sectionSize={5}
            sectionThickness={1}
            sectionColor="#6b7280"
            fadeDistance={80}
            fadeStrength={1}
            infiniteGrid
          />
        </>
      )}

      <Suspense fallback={null}>
        {!photoreal && showBuildings && (
          <BuildingContext
            lat={lat}
            lon={lon}
            targetBagId={targetBagId}
            preSnapLat={preSnapLat}
            preSnapLon={preSnapLon}
            onStatus={handleStatus}
          />
        )}
        {/* Photoreal: compute the wall-snap from 3DBAG without drawing the grey
            boxes (Google provides the buildings), so the locker still parks
            against the façade instead of inside the building. */}
        {photoreal && (
          <BuildingContext
            lat={lat}
            lon={lon}
            targetBagId={targetBagId}
            preSnapLat={preSnapLat}
            preSnapLon={preSnapLon}
            onStatus={handleStatus}
            render={false}
          />
        )}
        <LockerModel
          spec={spec}
          skin={skin}
          rotationY={rotationY}
          position={lockerRenderPos}
          showLabels={showLabels}
          selected={selected}
          onSelect={onSelectObject}
        />
      </Suspense>

      {showContext && nearbyPoints && (
        <CoverageContext
          originLat={lat}
          originLon={lon}
          nearbyPoints={nearbyPoints}
          preSnapLat={preSnapLat}
          preSnapLon={preSnapLon}
          bagDistanceM={bagDistanceM}
        />
      )}

      <GroundClamp
        photoreal={photoreal}
        groundObjRef={groundObjRef}
        lockerXZ={lockerXZ}
        onGroundY={setGroundY}
      />

      {navInputRef && (
        <NavDriver
          mode={navMode}
          inputRef={navInputRef}
          onMoveLocker={onMoveLocker}
          onNudgeRotation={onNudgeRotation}
          followLocker={followLocker}
          lockerRenderPos={lockerRenderPos}
        />
      )}

      <OrbitControls
        makeDefault
        target={[frame[0], 1, frame[2]]}
        minDistance={2}
        maxDistance={showContext ? 1600 : 140}
        maxPolarAngle={Math.PI / 2.05}
        enableDamping
        screenSpacePanning={false}
      />

      <CameraRig
        framePosition={frame}
        lockerPosition={lockerRenderPos}
        faceDir={faceDir}
        recenterNonce={recenterNonce}
        contextNonce={contextNonce}
        photoreal={photoreal}
      />
    </Canvas>
  );
}

/**
 * Handles grab-and-drag of the cabinet and clamps it onto the ground surface.
 * While `dragging`, the pointer is raycast against the ground (Google tiles in
 * photoreal mode, else the y=0 plane) and the locker follows it. Independently,
 * whatever surface is beneath it (roof or street), so it rests on the real
 * ground wherever the nav buttons move it.
 */
function GroundClamp({
  photoreal,
  groundObjRef,
  lockerXZ,
  onGroundY,
}: {
  photoreal: boolean;
  groundObjRef: { current: THREE.Object3D | null };
  lockerXZ: [number, number];
  onGroundY: (y: number) => void;
}) {
  const down = useMemo(() => new THREE.Vector3(0, -1, 0), []);
  const vray = useMemo(() => new THREE.Raycaster(), []);
  const lastY = useRef(0);

  useFrame(() => {
    // Clamp the locker onto the surface beneath it. At the origin we trust
    // AutoGround (which sets the surface there to y=0); we only raycast once the
    // cabinet has been moved off-centre, so the two systems never fight.
    // Outliers (coarse tiles mid-load) are ignored and the result is eased.
    const moved = Math.abs(lockerXZ[0]) > 0.01 || Math.abs(lockerXZ[1]) > 0.01;
    let target = 0;
    if (photoreal && groundObjRef.current && moved) {
      vray.set(new THREE.Vector3(lockerXZ[0], 1500, lockerXZ[1]), down);
      vray.far = 6000;
      const hits = vray.intersectObject(groundObjRef.current, true);
      if (hits.length && Math.abs(hits[0].point.y) < 60) target = hits[0].point.y;
      else target = lastY.current; // no hit / outlier — hold
    }
    const next = lastY.current + (target - lastY.current) * 0.25;
    if (Math.abs(next - lastY.current) > 0.02) {
      lastY.current = next;
      onGroundY(next);
    }
  });

  return null;
}

/**
 * Drives the on-screen nav pad. Every frame it reads the held-button input and
 * either flies the camera (pan/forward/rotate, all moving camera+target together
 * so the orbit distance and limits are preserved) or moves/turns the locker
 * (camera-relative ground motion + rotation).
 */
function NavDriver({
  mode,
  inputRef,
  onMoveLocker,
  onNudgeRotation,
  followLocker,
  lockerRenderPos,
}: {
  mode: NavMode;
  inputRef: { current: NavInput };
  onMoveLocker?: (x: number, z: number) => void;
  onNudgeRotation?: (delta: number) => void;
  followLocker?: boolean;
  lockerRenderPos: [number, number, number];
}) {
  const camera = useThree((s) => s.camera);
  const controls = useThree((s) => s.controls) as OrbitControlsImpl | null;
  const rightH = useMemo(() => new THREE.Vector3(), []);
  const upv = useMemo(() => new THREE.Vector3(), []);
  const fwdH = useMemo(() => new THREE.Vector3(), []);
  const move = useMemo(() => new THREE.Vector3(), []);
  const off = useMemo(() => new THREE.Vector3(), []);
  const followTmp = useMemo(() => new THREE.Vector3(), []);

  useFrame((_, delta) => {
    const inp = inputRef.current;
    if (!inp || (!inp.x && !inp.y && !inp.z && !inp.rot) || !controls) return;
    const dt = Math.min(delta, 0.05);
    const target = controls.target;

    // Camera basis (horizontal forward/right, screen up).
    rightH.setFromMatrixColumn(camera.matrixWorld, 0);
    rightH.y = 0;
    if (rightH.lengthSq() < 1e-6) rightH.set(1, 0, 0);
    rightH.normalize();
    upv.setFromMatrixColumn(camera.matrixWorld, 1);
    fwdH.copy(target).sub(camera.position);
    fwdH.y = 0;
    if (fwdH.lengthSq() < 1e-6) fwdH.set(0, 0, -1);
    fwdH.normalize();

    if (mode === 'object') {
      const speed = 6 * dt; // m/s over the ground
      const forward = -inp.y + inp.z; // up-arrow and "+" both move the locker away
      const nx = lockerRenderPos[0] + rightH.x * inp.x * speed + fwdH.x * forward * speed;
      const nz = lockerRenderPos[2] + rightH.z * inp.x * speed + fwdH.z * forward * speed;
      if (inp.x || inp.y || inp.z) {
        if (onMoveLocker) onMoveLocker(nx, nz);
        // Keep the cabinet in view while it is being moved (only while moving, so
        // it doesn't fight free mouse-orbit the rest of the time).
        if (followLocker) {
          followTmp.set(nx, lockerRenderPos[1] + 1.1, nz);
          target.lerp(followTmp, 0.5);
          controls.update();
        }
      }
      if (inp.rot && onNudgeRotation) onNudgeRotation(inp.rot * dt * 1.2);
      return;
    }

    // Camera mode: pan / fly / orbit, moving camera and target together.
    const dist = camera.position.distanceTo(target);
    const pan = Math.max(2, dist) * dt * 0.9;
    move.set(0, 0, 0);
    move.addScaledVector(rightH, inp.x * pan); // strafe
    move.addScaledVector(upv, -inp.y * pan); // screen up/down
    move.addScaledVector(fwdH, inp.z * pan); // forward/back
    camera.position.add(move);
    target.add(move);

    if (inp.rot) {
      const ang = -inp.rot * dt * 1.2;
      off.copy(camera.position).sub(target);
      const cos = Math.cos(ang);
      const sin = Math.sin(ang);
      const rx = off.x * cos - off.z * sin;
      const rz = off.x * sin + off.z * cos;
      off.x = rx;
      off.z = rz;
      camera.position.copy(target).add(off);
    }
    controls.update();
  });

  return null;
}

/**
 * Drapes a PDOK aerial photo (via /api/luchtfoto) over a ground plane sized to a
 * square box around the suggestion point. Because the box is centred on the same
 * RD origin the buildings use, the photo lines up with the 3D geometry. Falls
 * back to a neutral plane if the image fails to load.
 */
function AerialGround({ lat, lon, halfM }: { lat: number; lon: number; halfM: number }) {
  const [texture, setTexture] = useState<THREE.Texture | null>(null);
  const [failed, setFailed] = useState(false);

  const bbox = useMemo(() => {
    const o = wgs84ToRd(lat, lon);
    return {
      minx: o.x - halfM,
      miny: o.y - halfM,
      maxx: o.x + halfM,
      maxy: o.y + halfM,
    };
  }, [lat, lon, halfM]);

  useEffect(() => {
    let cancelled = false;
    const url = `/api/luchtfoto?bbox=${bbox.minx},${bbox.miny},${bbox.maxx},${bbox.maxy}&size=2048`;
    const loader = new THREE.TextureLoader();
    loader.load(
      url,
      (tex) => {
        if (cancelled) return;
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.anisotropy = 8;
        setTexture(tex);
      },
      undefined,
      () => !cancelled && setFailed(true),
    );
    return () => {
      cancelled = true;
    };
  }, [bbox]);

  // Plane is centred on the RD origin (scene 0,0), so it sits at [0, y, 0].
  // The orthophoto uses an unlit material so it always shows its true colours
  // (a lit material would render the photo black inside building shadows).
  const size = halfM * 2;
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.02, 0]}>
      <planeGeometry args={[size, size]} />
      {/* key forces a fresh material when the texture arrives — adding a map to
          an existing material otherwise needs an explicit shader recompile. */}
      <meshBasicMaterial
        key={texture ? 'aerial' : 'plain'}
        map={texture ?? undefined}
        color={texture ? '#ffffff' : failed ? '#b8b4ac' : '#9aa0a6'}
      />
    </mesh>
  );
}

/**
 * Reframes the camera to look at the locker from outside (along the wall's
 * outward normal) whenever the placement changes — e.g. on first load or when
 * the user cycles to another building side.
 */
function CameraRig({
  framePosition,
  lockerPosition,
  faceDir,
  recenterNonce,
  contextNonce,
  photoreal,
}: {
  framePosition: [number, number, number];
  lockerPosition: [number, number, number];
  faceDir?: [number, number];
  recenterNonce: number;
  contextNonce: number;
  photoreal: boolean;
}) {
  const camera = useThree((s) => s.camera);
  const controls = useThree((s) => s.controls) as OrbitControlsImpl | null;
  const prevPhotoreal = useRef(photoreal);

  // Default to a 3/4 view when no wall direction is known.
  const fx = faceDir ? faceDir[0] : 0.6;
  const fz = faceDir ? faceDir[1] : 0.8;

  const applyFrame = (pos: [number, number, number]) => {
    const [lx, ly, lz] = pos;
    const len = Math.hypot(fx, fz) || 1;
    const ox = fx / len;
    const oz = fz / len;
    const sx = oz;
    const sz = -ox;
    const dist = 9;
    camera.position.set(lx + ox * dist + sx * 4, ly + 6, lz + oz * dist + sz * 4);
    camera.lookAt(lx, ly + 1.1, lz);
    if (controls) {
      controls.target.set(lx, ly + 1.1, lz);
      controls.update();
    }
  };

  // Re-frame on the snap point when the placement (or wall side) changes. The
  // photoreal toggle is a pure render swap: the camera (position, target, zoom)
  // is kept exactly as-is so you see the same spot, just rendered as 3D tiles.
  const frameKey = `${framePosition[0].toFixed(2)},${framePosition[2].toFixed(2)},${fx.toFixed(2)},${fz.toFixed(2)}`;
  useEffect(() => {
    if (prevPhotoreal.current !== photoreal) {
      prevPhotoreal.current = photoreal;
      return; // keep the camera untouched across the toggle
    }
    // In photoreal the camera is driven by the nav pad, "Centreer" and the user;
    // don't yank it when the snap pose updates the placement.
    if (photoreal) return;
    applyFrame(framePosition);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frameKey, camera, controls, photoreal]);

  // Re-frame on the current locker position on explicit "recenter".
  useEffect(() => {
    if (recenterNonce > 0) applyFrame(lockerPosition);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recenterNonce]);

  // Pull back to a wide oblique overview when the context overlay is enabled,
  // so the ~650 m of nearby points and coverage rings come into view.
  useEffect(() => {
    if (contextNonce > 0) {
      camera.position.set(260, 520, 620);
      camera.lookAt(0, 0, 0);
      if (controls) {
        controls.target.set(0, 0, 0);
        controls.update();
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contextNonce]);

  return null;
}
