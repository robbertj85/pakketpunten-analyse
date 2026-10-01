'use client';

import {
  LockerSpec,
  CarrierSkin,
  CARRIER_SKINS,
  MIN_COLUMNS,
  MAX_COLUMNS,
} from '@/lib/lockerCatalog';
import { BuildingLoadStatus } from './BuildingContext';
import type { GroundMode } from './Locker3DScene';

interface LockerConfigPanelProps {
  spec: LockerSpec;
  columns: number;
  onColumns: (n: number) => void;
  skin: CarrierSkin;
  onSkin: (id: string) => void;
  rotationY: number;
  onRotation: (r: number) => void;
  showLabels: boolean;
  onShowLabels: (b: boolean) => void;
  showBuildings: boolean;
  onShowBuildings: (b: boolean) => void;
  groundMode: GroundMode;
  onGroundMode: (m: GroundMode) => void;
  buildingStatus: BuildingLoadStatus | null;
  autoSnap: boolean;
  onAutoSnap: (b: boolean) => void;
  snapCount: number;
  onCycleSide: () => void;
  hasManualPos: boolean;
  onResetPos: () => void;
  followLocker: boolean;
  onFollowLocker: (b: boolean) => void;
  onRecenter: () => void;
  /** Whether to show the Google photoreal toggle (off for EEA billing accounts). */
  showPhotoreal: boolean;
  photoreal: boolean;
  onPhotoreal: (b: boolean) => void;
  onFreezeLocation: () => void;
  isFrozen: boolean;
  showContext: boolean;
  onShowContext: (b: boolean) => void;
  nearbyCount: number;
  /** Walking-distance radius (m) of the merged coverage zone. */
  bufferRadius: number;
  onBufferRadius: (r: number) => void;
}

export default function LockerConfigPanel(props: LockerConfigPanelProps) {
  const { spec } = props;

  return (
    <div className="space-y-5 text-sm">
      {/* Locker type */}
      <div>
        <Label>Type automaat — {spec.columns} kolommen</Label>
        <input
          type="range"
          min={MIN_COLUMNS}
          max={MAX_COLUMNS}
          step={1}
          value={props.columns}
          onChange={(e) => props.onColumns(Number(e.target.value))}
          className="w-full mt-1 accent-blue-600"
        />
        <div className="flex justify-between text-[10px] text-subtle-foreground">
          <span>{MIN_COLUMNS} kol</span>
          <span>{MAX_COLUMNS} kol</span>
        </div>
        <div className="mt-2 grid grid-cols-3 gap-2 text-center">
          <Stat label="Lockers" value={String(spec.lockers)} />
          <Stat label="Breedte" value={`${spec.widthCm} cm`} />
          <Stat label="Vlak" value={`${((spec.widthCm * spec.depthCm) / 10000).toFixed(1)} m²`} />
        </div>
      </div>

      {/* Dimensions legend */}
      <div>
        <Label>Afmetingen (B × H × D)</Label>
        <div className="mt-1 space-y-1">
          <LegendRow color="#1d4ed8" name="Breedte (B)" value={`${spec.widthCm} cm`} />
          <LegendRow color="#047857" name="Hoogte (H)" value={`${spec.heightCm} cm`} />
          <LegendRow color="#b45309" name="Diepte (D)" value={`${spec.depthCm} cm`} />
        </div>
        <p className="mt-1 text-[11px] text-subtle-foreground">
          Hoogte en diepte zijn vast; breedte groeit ~49 cm per kolom.
        </p>
      </div>

      {/* Carrier skin */}
      <div>
        <Label>Uitstraling</Label>
        <div className="mt-1 flex flex-wrap gap-1.5">
          {CARRIER_SKINS.map((s) => (
            <button
              key={s.id}
              onClick={() => props.onSkin(s.id)}
              className={`px-2.5 py-1 text-xs rounded border transition ${
                props.skin.id === s.id
                  ? 'border-primary ring-1 ring-blue-300 bg-accent text-accent-foreground'
                  : 'border-border text-muted-foreground hover:border-input'
              }`}
            >
              <span
                className="inline-block w-2.5 h-2.5 rounded-full mr-1 align-middle"
                style={{ background: s.accent }}
              />
              {s.label}
            </button>
          ))}
        </div>
      </div>

      {/* Navigation */}
      <div className="border-t border-border pt-4">
        <Label>Navigatie</Label>
        <p className="mt-1 text-[11px] text-subtle-foreground">
          Muis: sleep = draaien · rechts-sleep = verschuiven · scroll = zoom.
          <br />
          <span className="text-muted-foreground font-medium">Klik de automaat aan</span> (of
          kies &ldquo;Automaat&rdquo; rechtsonder) en verplaats hem met de
          navigatieknoppen; hij zakt vanzelf op straatniveau.
        </p>
        <div className="mt-2 flex items-center gap-2">
          <button
            onClick={props.onRecenter}
            className="flex-1 px-2 py-1.5 text-xs font-semibold text-muted-foreground bg-secondary hover:bg-border border border-border rounded"
          >
            Centreer op automaat
          </button>
          {props.hasManualPos && (
            <button
              onClick={props.onResetPos}
              className="flex-1 px-2 py-1.5 text-xs font-semibold text-primary bg-accent hover:bg-accent border border-primary/30 rounded"
            >
              Terug naar gevel
            </button>
          )}
        </div>
        <label className="mt-2 flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
          <input
            type="checkbox"
            checked={props.followLocker}
            onChange={(e) => props.onFollowLocker(e.target.checked)}
            className="accent-blue-600"
          />
          Camera volgt automaat tijdens verplaatsen
        </label>
        <button
          onClick={props.onFreezeLocation}
          className="mt-3 w-full px-3 py-2 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 rounded shadow-sm"
        >
          {props.isFrozen ? 'Locatie opnieuw vastleggen' : 'Locatie vastleggen'}
        </button>
        <p className="mt-1 text-[11px] text-subtle-foreground">
          Legt de huidige plek vast en genereert coördinaten, adres, BAG-/kadasternummer
          en links naar Street View, Google Maps en de BAG-viewer (onderaan).
        </p>
      </div>

      {/* Rotation */}
      <div>
        <Label>Rotatie — {Math.round((props.rotationY * 180) / Math.PI)}°</Label>
        <input
          type="range"
          min={-180}
          max={180}
          step={1}
          value={Math.round((props.rotationY * 180) / Math.PI)}
          onChange={(e) => props.onRotation((Number(e.target.value) * Math.PI) / 180)}
          className="w-full mt-1 accent-blue-600"
        />
      </div>

      {/* Scene controls */}
      <div className="space-y-2 border-t border-border pt-4">
        {props.showPhotoreal && (
          <>
            <Toggle
              checked={props.photoreal}
              onChange={props.onPhotoreal}
              label="Fotorealistisch (Google 3D) — beta"
            />
            {props.photoreal && (
              <p className="text-[11px] text-subtle-foreground">
                Echte 3D-beelden van Google. Niet overal beschikbaar (vooral grote
                steden); buiten dekking val je terug op 3DBAG.
              </p>
            )}
          </>
        )}
        {!props.photoreal && (
          <>
            <Toggle
              checked={props.showBuildings}
              onChange={props.onShowBuildings}
              label="Gebouwen tonen (3DBAG, LoD 2.2)"
            />
            <div>
              <div className="text-[11px] text-muted-foreground mb-1">Ondergrond</div>
              <div className="grid grid-cols-3 gap-1">
                <GroundButton active={props.groundMode === 'aerial'} onClick={() => props.onGroundMode('aerial')} label="Luchtfoto" />
                <GroundButton active={props.groundMode === 'map'} onClick={() => props.onGroundMode('map')} label="Kaart" />
                <GroundButton active={props.groundMode === 'none'} onClick={() => props.onGroundMode('none')} label="Geen" />
              </div>
              <p className="mt-1 text-[11px] text-subtle-foreground">
                &ldquo;Kaart&rdquo; toont de PDOK-achtergrondkaart met straatnamen — handig
                om de plek te herkennen.
              </p>
            </div>
            <Toggle
              checked={props.autoSnap}
              onChange={props.onAutoSnap}
              label="Automaat tegen gevel plaatsen"
            />
            {props.autoSnap && props.snapCount > 1 && (
              <button
                onClick={props.onCycleSide}
                className="w-full px-2 py-1.5 text-xs font-semibold text-primary bg-accent hover:bg-accent border border-primary/30 rounded"
              >
                Andere zijde ({props.snapCount} gevels)
              </button>
            )}
          </>
        )}
        <Toggle
          checked={props.showLabels}
          onChange={props.onShowLabels}
          label="Maatlabels tonen"
        />
        <Toggle
          checked={props.showContext}
          onChange={props.onShowContext}
          label={`Omgeving & dekking (${props.nearbyCount} punten ≤1,5 km)`}
        />
        {props.showContext && (
          <div className="pl-6 space-y-1.5">
            <div className="flex items-center gap-2">
              <span className="text-[11px] text-muted-foreground">Loopafstand</span>
              <select
                value={props.bufferRadius}
                onChange={(e) => props.onBufferRadius(Number(e.target.value))}
                className="px-2 py-1 text-xs border border-input rounded bg-card"
              >
                <option value={300}>300 m</option>
                <option value={400}>400 m</option>
                <option value={500}>500 m</option>
              </select>
            </div>
            <p className="text-[11px] text-subtle-foreground">
              Gekleurd vlak: samengevoegde bufferzone van de bestaande pakketpunten
              (zoals op de hoofdkaart). Paarse cirkel: het bereik van de nieuwe kluis.
              De roze stippellijn toont de verschuiving van de dichtste 100 m-cel
              naar het BAG-pand.
            </p>
            <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-muted-foreground">
              <LegendDot
                color={props.bufferRadius === 300 ? '#2563eb' : props.bufferRadius === 500 ? '#f59e0b' : '#16a34a'}
                label={`Gedekt gebied (${props.bufferRadius} m)`}
              />
              <LegendDot color="#7c3aed" label="Nieuwe kluis" />
            </div>
          </div>
        )}
        {!props.photoreal && props.showBuildings && props.buildingStatus && (
          <p className="text-[11px] text-subtle-foreground">
            {props.buildingStatus.loading
              ? `Gebouwen laden uit 3DBAG…${
                  props.buildingStatus.count > 0 ? ` ${props.buildingStatus.count} tot nu toe` : ''
                }`
              : props.buildingStatus.error
                ? `3DBAG niet beschikbaar: ${props.buildingStatus.error}`
                : `${props.buildingStatus.count} gebouwen geladen${
                    props.buildingStatus.hasTarget ? ' · doelpand gemarkeerd' : ''
                  }${
                    props.buildingStatus.groundNap != null
                      ? ` · maaiveld ${props.buildingStatus.groundNap.toLocaleString('nl-NL', {
                          maximumFractionDigits: 1,
                        })} m NAP`
                      : ''
                  }`}
          </p>
        )}
      </div>
    </div>
  );
}

function GroundButton({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`px-2 py-1.5 text-xs font-semibold rounded border transition ${
        active
          ? 'border-primary ring-1 ring-blue-300 bg-accent text-accent-foreground'
          : 'border-border text-muted-foreground hover:border-input'
      }`}
    >
      {label}
    </button>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[11px] font-semibold uppercase tracking-wide text-subtle-foreground">
      {children}
    </div>
  );
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1">
      <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: color }} />
      {label}
    </span>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-muted rounded px-1 py-1.5">
      <div className="text-[10px] text-subtle-foreground">{label}</div>
      <div className="text-sm font-semibold text-foreground">{value}</div>
    </div>
  );
}

function LegendRow({ color, name, value }: { color: string; name: string; value: string }) {
  return (
    <div className="flex items-center justify-between text-xs">
      <span className="flex items-center gap-2 text-muted-foreground">
        <span className="inline-block w-3 h-3 rounded-sm" style={{ background: color }} />
        {name}
      </span>
      <span className="font-mono font-semibold text-foreground">{value}</span>
    </div>
  );
}

function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (b: boolean) => void;
  label: string;
}) {
  return (
    <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="accent-blue-600"
      />
      {label}
    </label>
  );
}

