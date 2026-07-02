'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { lockerSpec, CARRIER_SKINS } from '@/lib/lockerCatalog';
import { wgs84ToRd, rdToWgs84 } from '@/lib/rd';
import LockerConfigPanel from '@/components/locker3d/LockerConfigPanel';
import LocationExportPanel from '@/components/locker3d/LocationExportPanel';
import NavControls, { NavInput, NavMode } from '@/components/locker3d/NavControls';
import { BuildingLoadStatus } from '@/components/locker3d/BuildingContext';
import type { NearbyPoint } from '@/components/locker3d/CoverageContext';
import type { Google3DError } from '@/lib/google3d';

// Google Photorealistic 3D Tiles are BLOCKED for EEA (incl. NL) billing accounts
// since Google's 8 July 2025 EEA policy change — the Map Tiles API returns 403,
// so the toggle would only ever fall back to 3DBAG. The renderer + proxy code is
// kept intact (see components/locker3d/GoogleTiles.tsx) for a future non-EEA
// billing account or a Cesium-ion route; flip NEXT_PUBLIC_ENABLE_GOOGLE_3D=true
// to bring the toggle back. Default off → 3DBAG is the intended view.
const GOOGLE_3D_ENABLED = process.env.NEXT_PUBLIC_ENABLE_GOOGLE_3D === 'true';

const Locker3DScene = dynamic(() => import('@/components/locker3d/Locker3DScene'), {
  ssr: false,
  loading: () => <SceneSkeleton label="3D-omgeving laden…" />,
});
const OrientationMiniMap = dynamic(
  () => import('@/components/locker3d/OrientationMiniMap'),
  { ssr: false },
);

export interface Locker3DViewProps {
  slug: string;
  gemeente: string;
  pc4: string;
  lat: number;
  lon: number;
  bagId: string | null;
  bagGebruiksdoel: string | null;
  bagBouwjaar: number | null;
  estNewPop: number | null;
  rank: number | null;
  preSnapLat?: number | null;
  preSnapLon?: number | null;
  bagDistanceM?: number | null;
  nearbyPoints?: NearbyPoint[];
  // POI the placement snapped to (supermarkt, station, ...), when applicable.
  poiCategory?: string | null;
  poiNaam?: string | null;
  poiDistanceM?: number | null;
  // Generic-entry overrides (netwerkplanner 3D route). Defaults keep the
  // plaatsingsadvies behaviour unchanged.
  backHref?: string;
  backLabel?: string;
  heading?: string;
  initialColumns?: number;
}

export default function Locker3DView(props: Locker3DViewProps) {
  const [columns, setColumns] = useState(() =>
    Math.min(17, Math.max(4, props.initialColumns ?? 6)),
  ); // default 6 kol / 302 cm — matches the reference example
  const [skinId, setSkinId] = useState('whitelabel');
  const [rotationY, setRotationY] = useState(0);
  const [showLabels, setShowLabels] = useState(true);
  const [showBuildings, setShowBuildings] = useState(true);
  const [showAerial, setShowAerial] = useState(true);
  const [buildingStatus, setBuildingStatus] = useState<BuildingLoadStatus | null>(null);

  // Auto-snap to a building wall
  const [autoSnap, setAutoSnap] = useState(true);
  const [sideIndex, setSideIndex] = useState(0);

  // Grab the cabinet to drag it; manualPos holds its dragged scene XZ.
  const [manualPos, setManualPos] = useState<{ x: number; z: number } | null>(null);
  const [followLocker, setFollowLocker] = useState(true);
  const [recenterNonce, setRecenterNonce] = useState(0);

  // Photoreal mode: Google 3D Tiles ground (backup to the 3DBAG scene).
  const [photoreal, setPhotoreal] = useState(false);
  const [photoError, setPhotoError] = useState<Google3DError | null>(null);

  // On-screen navigation pad.
  const [navMode, setNavMode] = useState<NavMode>('camera');
  const navInputRef = useRef<NavInput>({ x: 0, y: 0, z: 0, rot: 0 });

  // Frozen export location (the locker's lat/lon captured by "Locatie vastleggen").
  const [frozen, setFrozen] = useState<{ lat: number; lon: number } | null>(null);

  // Placement-advice context overlay (nearby points + merged buffer zone +
  // displacement). On by default so the coverage zone and neighbouring parcel
  // points are visible without extra clicks. The zone radius is selectable
  // (300/400/500 m), matching the "Samengevoegde buffers" on the main map.
  const [showContext, setShowContext] = useState(true);
  const [bufferRadius, setBufferRadius] = useState(400);
  const [contextNonce, setContextNonce] = useState(0);

  // Keyboard shortcuts: C = camera, A = automaat (select the locker). Ignored
  // while typing in a field.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      const tag = t?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || t?.isContentEditable) return;
      const k = e.key.toLowerCase();
      if (k === 'c') setNavMode('camera');
      else if (k === 'a') setNavMode('object');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const spec = useMemo(() => lockerSpec(columns), [columns]);
  const skin = useMemo(
    () => CARRIER_SKINS.find((s) => s.id === skinId) ?? CARRIER_SKINS[0],
    [skinId],
  );

  const snapCandidates = buildingStatus?.snapCandidates ?? [];
  // Park the cabinet against the building façade in BOTH modes. In photoreal the
  // raw suggestion coordinate sits inside Google's solid building mesh, so the
  // same 3DBAG-derived wall-snap (computed invisibly under the tiles) is what
  // keeps it against the gevel rather than buried in the building.
  const activePose =
    autoSnap && snapCandidates.length > 0 && (photoreal || showBuildings)
      ? snapCandidates[sideIndex % snapCandidates.length]
      : null;
  // The snap point the camera frames on — stable while the locker is dragged.
  const framePosition: [number, number, number] = activePose
    ? [activePose.x, 0, activePose.z]
    : [0, 0, 0];
  // Manual drag position overrides the snap point for the locker itself.
  const lockerPosition: [number, number, number] = manualPos
    ? [manualPos.x, 0, manualPos.z]
    : framePosition;

  // The locker's live geographic position: convert its scene XZ (metres from the
  // suggestion origin; +x = East, +z = South) back to RD and then to WGS84.
  const originRd = useMemo(() => wgs84ToRd(props.lat, props.lon), [props.lat, props.lon]);
  const currentLatLon = useMemo(
    () => rdToWgs84(originRd.x + lockerPosition[0], originRd.y - lockerPosition[2]),
    [originRd, lockerPosition],
  );
  const sceneRotation = (activePose?.rotationY ?? 0) + rotationY;
  const faceDir: [number, number] | undefined = activePose
    ? [Math.sin(activePose.rotationY), Math.cos(activePose.rotationY)]
    : undefined;

  const cycleSide = () => {
    setManualPos(null); // a fresh snap side overrides a manual move
    setSideIndex((i) => i + 1);
  };

  const backHref = props.backHref ?? `/data-export/suggesties?gemeente=${props.slug}`;
  const backLabel = props.backLabel ?? 'Terug naar plaatsingsadvies';
  const gm = `https://www.google.com/maps?q=${props.lat},${props.lon}`;

  return (
    <div>
      {/* Breadcrumb / header */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link href={backHref} className="text-sm text-blue-600 hover:text-blue-800">
            ← {backLabel}
          </Link>
          <h2 className="text-xl font-bold text-gray-900 mt-1">
            {props.heading ?? `Locker in beeld — PC4 ${props.pc4}`}
          </h2>
          <p className="text-sm text-gray-600">
            {props.gemeente}
            {props.rank ? ` · voorstel #${props.rank}` : ''} ·{' '}
            <span className="font-mono">
              {props.lat.toFixed(5)}, {props.lon.toFixed(5)}
            </span>
          </p>
          {(props.bagGebruiksdoel || props.bagBouwjaar || props.estNewPop != null || props.poiNaam) && (
            <p className="text-xs text-gray-500 mt-0.5">
              {props.poiNaam && (
                <span>
                  Bij {props.poiCategory ? `${props.poiCategory.replaceAll('_', ' ')}: ` : ''}
                  {props.poiNaam}
                  {' · '}
                </span>
              )}
              {props.bagGebruiksdoel && <span>BAG-pand: {props.bagGebruiksdoel}</span>}
              {props.bagBouwjaar && <span> · bouwjaar {props.bagBouwjaar}</span>}
              {props.estNewPop != null && (
                <span> · geschat extra bereik {props.estNewPop.toLocaleString('nl-NL')} inw. (400 m)</span>
              )}
              {props.bagDistanceM != null && (
                <span> · {props.bagDistanceM} m verschoven t.o.v. dichtste 100 m-cel</span>
              )}
            </p>
          )}
        </div>
        <a
          href={gm}
          target="_blank"
          rel="noopener noreferrer"
          className="px-3 py-2 text-xs font-semibold bg-gray-100 hover:bg-gray-200 rounded"
        >
          Open in Google Maps
        </a>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-4">
        {/* Config panel */}
        <aside className="bg-white rounded-lg shadow-md p-4 h-fit lg:sticky lg:top-4">
          <LockerConfigPanel
            spec={spec}
            columns={columns}
            onColumns={setColumns}
            skin={skin}
            onSkin={setSkinId}
            rotationY={rotationY}
            onRotation={setRotationY}
            showLabels={showLabels}
            onShowLabels={setShowLabels}
            showBuildings={showBuildings}
            onShowBuildings={setShowBuildings}
            showAerial={showAerial}
            onShowAerial={setShowAerial}
            buildingStatus={buildingStatus}
            autoSnap={autoSnap}
            onAutoSnap={setAutoSnap}
            snapCount={snapCandidates.length}
            onCycleSide={cycleSide}
            hasManualPos={manualPos !== null}
            onResetPos={() => setManualPos(null)}
            followLocker={followLocker}
            onFollowLocker={setFollowLocker}
            onRecenter={() => setRecenterNonce((n) => n + 1)}
            showPhotoreal={GOOGLE_3D_ENABLED}
            photoreal={photoreal}
            onPhotoreal={(b) => {
              setPhotoError(null);
              setPhotoreal(b);
            }}
            onFreezeLocation={() =>
              setFrozen({ lat: currentLatLon.lat, lon: currentLatLon.lon })
            }
            isFrozen={frozen !== null}
            showContext={showContext}
            onShowContext={(b) => {
              setShowContext(b);
              if (b) setContextNonce((n) => n + 1);
            }}
            nearbyCount={props.nearbyPoints?.length ?? 0}
            bufferRadius={bufferRadius}
            onBufferRadius={setBufferRadius}
          />
        </aside>

        {/* Scene */}
        <div className="bg-white rounded-lg shadow-md overflow-hidden">
          <div className="h-[600px] lg:h-[720px] relative">
            <Locker3DScene
              spec={spec}
              skin={skin}
              rotationY={sceneRotation}
              lockerPosition={lockerPosition}
              framePosition={framePosition}
              faceDir={faceDir}
              showLabels={showLabels}
              showBuildings={showBuildings}
              showAerial={showAerial}
              photoreal={photoreal}
              onPhotoError={setPhotoError}
              onPhotoReady={() => setPhotoError(null)}
              onMoveLocker={(x, z) => setManualPos({ x, z })}
              navMode={navMode}
              navInputRef={navInputRef}
              onNudgeRotation={(d) => setRotationY((r) => r + d)}
              onSelectObject={() => setNavMode('object')}
              onDeselect={() => setNavMode('camera')}
              followLocker={followLocker}
              recenterNonce={recenterNonce}
              lat={props.lat}
              lon={props.lon}
              targetBagId={props.bagId}
              preSnapLat={props.preSnapLat}
              preSnapLon={props.preSnapLon}
              onBuildingStatus={setBuildingStatus}
              showContext={showContext}
              nearbyPoints={props.nearbyPoints}
              bagDistanceM={props.bagDistanceM}
              bufferRadius={bufferRadius}
              contextNonce={contextNonce}
            />

            {/* Photoreal fallback banner */}
            {photoreal && photoError && (
              <div className="absolute top-3 left-1/2 -translate-x-1/2 z-[1000] max-w-sm">
                <div className="rounded-md bg-amber-50 border border-amber-300 px-3 py-2 text-xs text-amber-900 shadow-md text-center">
                  <p>{photoError.message}</p>
                  <button
                    onClick={() => {
                      setPhotoError(null);
                      setPhotoreal(false);
                    }}
                    className="mt-1 font-semibold text-blue-700 hover:text-blue-900 underline"
                  >
                    Terug naar 3DBAG-weergave
                  </button>
                </div>
              </div>
            )}

            {/* Orientation inset map */}
            <div className="absolute bottom-3 left-3 w-52 h-40 rounded-lg overflow-hidden border-2 border-white shadow-lg z-[1000]">
              <OrientationMiniMap lat={props.lat} lon={props.lon} />
            </div>

            {/* On-screen navigation pad */}
            <NavControls mode={navMode} onMode={setNavMode} inputRef={navInputRef} />
          </div>
          <div className="px-4 py-2 text-[11px] text-gray-500 border-t border-gray-100">
            {photoreal
              ? 'Fotorealistische 3D-tegels © Google · '
              : 'Gebouwen © 3DBAG (TU Delft, CC BY 4.0) · Luchtfoto © PDOK · '}
            Afmetingen uit standaard automaat-tabel
          </div>
        </div>
      </div>

      {/* Frozen-location report: coordinates, address, BAG/kadaster + viewer links. */}
      <LocationExportPanel frozen={frozen} />
    </div>
  );
}

function SceneSkeleton({ label }: { label: string }) {
  return (
    <div className="h-full w-full flex items-center justify-center bg-gray-100 text-sm text-gray-500">
      {label}
    </div>
  );
}
