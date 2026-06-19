'use client';

import { useEffect, useMemo, useState } from 'react';
import { Html, Edges } from '@react-three/drei';
import { ThreeEvent } from '@react-three/fiber';
import * as THREE from 'three';
import { LockerSpec, CarrierSkin } from '@/lib/lockerCatalog';

interface LockerModelProps {
  spec: LockerSpec;
  skin: CarrierSkin;
  rotationY?: number;
  showLabels?: boolean;
  position?: [number, number, number];
  /** Click the cabinet to select it (then it is moved with the nav buttons). */
  onSelect?: () => void;
  /** Highlight the cabinet as selected. */
  selected?: boolean;
}

/* ------------------------------------------------------------------ colours */

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
/** Shade a hex toward black (pct<0) or white (pct>0). */
function shade(hex: string, pct: number): string {
  const [r, g, b] = hexToRgb(hex);
  const t = pct < 0 ? 0 : 255;
  const p = Math.abs(pct);
  const mix = (c: number) => Math.round((t - c) * p + c);
  return `rgb(${mix(r)},${mix(g)},${mix(b)})`;
}
function isDark(hex: string): boolean {
  const [r, g, b] = hexToRgb(hex);
  return 0.299 * r + 0.587 * g + 0.114 * b < 115;
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  const rad = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  if (typeof ctx.roundRect === 'function') ctx.roundRect(x, y, w, h, rad);
  else {
    ctx.moveTo(x + rad, y);
    ctx.arcTo(x + w, y, x + w, y + h, rad);
    ctx.arcTo(x + w, y + h, x, y + h, rad);
    ctx.arcTo(x, y + h, x, y, rad);
    ctx.arcTo(x, y, x + w, y, rad);
    ctx.closePath();
  }
}

function fitContain(
  imgW: number,
  imgH: number,
  maxW: number,
  maxH: number,
): { w: number; h: number } {
  const ar = imgW / imgH;
  let w = maxW;
  let h = w / ar;
  if (h > maxH) {
    h = maxH;
    w = h * ar;
  }
  return { w, h };
}

/* --------------------------------------------------- front-face texture build */

function composeFace(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  spec: LockerSpec,
  rows: number,
  skin: CarrierSkin,
  logo: HTMLImageElement | null,
) {
  const dark = isDark(skin.body);
  const doorFill = dark ? shade(skin.body, 0.16) : shade(skin.body, -0.08);
  const doorEdge = dark ? shade(skin.body, 0.32) : shade(skin.body, 0.18);
  const frame = dark ? shade(skin.body, -0.45) : shade(skin.body, -0.3);
  const handle = dark ? shade(skin.body, 0.45) : shade(skin.body, -0.5);

  // Cabinet base colour.
  ctx.fillStyle = skin.body;
  ctx.fillRect(0, 0, W, H);

  // Branding regions reduce the door area (canvas y=0 is the top of the face).
  const headerH = skin.branding === 'topHeader' ? H * 0.15 : 0;
  const panelW = skin.branding === 'leftPanel' ? Math.max(W * 0.16, 150) : 0;
  const dx0 = panelW;
  const dy0 = headerH;
  const dW = W - dx0;
  const dH = H - dy0;

  // Door grid frame (the recessed gaps between doors).
  ctx.fillStyle = frame;
  ctx.fillRect(dx0, dy0, dW, dH);

  const cols = spec.columns;
  const cw = dW / cols;
  const ch = dH / rows;
  const gap = Math.max(3, Math.min(cw, ch) * 0.05);

  for (let c = 0; c < cols; c++) {
    for (let r = 0; r < rows; r++) {
      const x = dx0 + c * cw + gap / 2;
      const y = dy0 + r * ch + gap / 2;
      const ww = cw - gap;
      const hh = ch - gap;
      // door panel with a soft vertical sheen
      const grad = ctx.createLinearGradient(0, y, 0, y + hh);
      grad.addColorStop(0, doorEdge);
      grad.addColorStop(0.5, doorFill);
      grad.addColorStop(1, shade(skin.body, dark ? 0.06 : -0.16));
      ctx.fillStyle = grad;
      roundRect(ctx, x, y, ww, hh, Math.min(8, ww * 0.06));
      ctx.fill();
      // thin border
      ctx.strokeStyle = frame;
      ctx.lineWidth = Math.max(1, gap * 0.4);
      ctx.stroke();
      // handle / lock on the right edge
      ctx.fillStyle = handle;
      roundRect(ctx, x + ww * 0.84, y + hh * 0.4, ww * 0.05, hh * 0.2, 2);
      ctx.fill();
    }
  }

  // Branding band / panel.
  if (headerH > 0) {
    ctx.fillStyle = skin.accent;
    ctx.fillRect(0, 0, W, headerH);
  }
  if (panelW > 0) {
    ctx.fillStyle = skin.accent;
    ctx.fillRect(0, 0, panelW, H);
  }
  // Minimal logo tile (e.g. DPD) — a white plate top-left for the coloured logo.
  if (skin.branding === 'minimal' && logo) {
    ctx.fillStyle = '#ffffff';
    roundRect(ctx, W * 0.03, H * 0.04, W * 0.26, H * 0.13, 8);
    ctx.fill();
  }

  // Logo.
  if (logo && logo.naturalWidth > 0) {
    let region: { x: number; y: number; w: number; h: number };
    if (skin.branding === 'topHeader') region = { x: W * 0.03, y: headerH * 0.16, w: W * 0.42, h: headerH * 0.68 };
    else if (skin.branding === 'leftPanel') region = { x: panelW * 0.12, y: H * 0.32, w: panelW * 0.76, h: H * 0.42 };
    else if (skin.branding === 'fullWrap') region = { x: W * 0.16, y: H * 0.18, w: W * 0.5, h: H * 0.3 };
    else region = { x: W * 0.045, y: H * 0.05, w: W * 0.23, h: H * 0.11 };
    const { w, h } = fitContain(logo.naturalWidth, logo.naturalHeight, region.w, region.h);
    ctx.drawImage(logo, region.x + (region.w - w) / 2, region.y + (region.h - h) / 2, w, h);
  }

  // Touchscreen kiosk.
  const sW = W * 0.12;
  const sH = sW * 1.5;
  const sx = skin.branding === 'leftPanel' ? panelW / 2 - sW / 2 : W * 0.6;
  const sy = skin.branding === 'leftPanel' ? H * 0.12 : H * 0.42;
  ctx.fillStyle = '#0b0f17';
  roundRect(ctx, sx, sy, sW, sH, 8);
  ctx.fill();
  ctx.fillStyle = skin.screen;
  roundRect(ctx, sx + sW * 0.12, sy + sH * 0.1, sW * 0.76, sH * 0.6, 5);
  ctx.fill();
  // subtle screen glow
  ctx.fillStyle = 'rgba(59,130,246,0.35)';
  roundRect(ctx, sx + sW * 0.18, sy + sH * 0.16, sW * 0.64, sH * 0.32, 4);
  ctx.fill();
}

function useLockerFaceTexture(spec: LockerSpec, skin: CarrierSkin): THREE.CanvasTexture | null {
  const [texture, setTexture] = useState<THREE.CanvasTexture | null>(null);
  const rows = Math.max(4, Math.round(spec.lockers / spec.columns));

  useEffect(() => {
    let cancelled = false;
    const render = (logo: HTMLImageElement | null) => {
      if (cancelled || typeof document === 'undefined') return;
      const PX = 360;
      const W = Math.round((spec.widthCm / 100) * PX);
      const H = Math.round((spec.heightCm / 100) * PX);
      const canvas = document.createElement('canvas');
      canvas.width = W;
      canvas.height = H;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      composeFace(ctx, W, H, spec, rows, skin, logo);
      const tex = new THREE.CanvasTexture(canvas);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = 8;
      setTexture(tex);
    };

    if (skin.logo && typeof window !== 'undefined') {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => render(img);
      img.onerror = () => render(null);
      img.src = skin.logo;
    } else {
      // No logo — render on a microtask (avoid sync setState in effect).
      Promise.resolve().then(() => render(null));
    }
    return () => {
      cancelled = true;
    };
  }, [spec, rows, skin]);

  // Dispose superseded textures.
  useEffect(() => () => texture?.dispose(), [texture]);

  return texture;
}

/* --------------------------------------------------------------- the model */

export default function LockerModel({
  spec,
  skin,
  rotationY = 0,
  showLabels = true,
  position = [0, 0, 0],
  onSelect,
  selected = false,
}: LockerModelProps) {
  const w = spec.widthCm / 100;
  const h = spec.heightCm / 100;
  const d = spec.depthCm / 100;
  const faceTex = useLockerFaceTexture(spec, skin);

  // Box face order: +x, -x, +y, -y, +z(front), -z.
  const materials = useMemo(() => {
    const side = new THREE.MeshStandardMaterial({ color: skin.body, roughness: 0.6, metalness: 0.12 });
    const top = new THREE.MeshStandardMaterial({ color: shade(skin.body, isDark(skin.body) ? 0.08 : -0.05), roughness: 0.7 });
    const front = new THREE.MeshStandardMaterial({
      color: faceTex ? '#ffffff' : skin.body,
      map: faceTex ?? null,
      roughness: 0.5,
      metalness: 0.08,
    });
    return [side, side, top, side, front, side];
  }, [skin.body, faceTex]);

  useEffect(
    () => () => materials.forEach((m) => m.dispose()),
    [materials],
  );

  return (
    <group position={position} rotation={[0, rotationY, 0]}>
      <mesh
        position={[0, h / 2, 0]}
        material={materials}
        castShadow
        receiveShadow
        onClick={
          onSelect
            ? (e: ThreeEvent<MouseEvent>) => {
                e.stopPropagation();
                onSelect();
              }
            : undefined
        }
        onPointerOver={onSelect ? () => (document.body.style.cursor = 'pointer') : undefined}
        onPointerOut={onSelect ? () => (document.body.style.cursor = '') : undefined}
      >
        <boxGeometry args={[w, h, d]} />
        <Edges
          threshold={15}
          color={selected ? '#2563eb' : isDark(skin.body) ? '#000000' : '#9aa0a6'}
        />
      </mesh>

      {/* Selection ring on the ground */}
      {selected && (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.04, 0]}>
          <ringGeometry args={[Math.max(w, d) * 0.62, Math.max(w, d) * 0.78, 48]} />
          <meshBasicMaterial color="#2563eb" transparent opacity={0.75} depthWrite={false} />
        </mesh>
      )}

      {/* Plinth / base */}
      <mesh position={[0, 0.02, 0]} receiveShadow>
        <boxGeometry args={[w * 1.01, 0.04, d * 1.04]} />
        <meshStandardMaterial color="#1f2937" roughness={0.9} />
      </mesh>

      {showLabels && (
        <>
          <DimLabel position={[0, -0.18, d / 2]} text={`Breedte ${spec.widthCm} cm`} color="#1d4ed8" />
          <DimLabel position={[w / 2 + 0.15, h / 2, d / 2]} text={`Hoogte ${spec.heightCm} cm`} color="#047857" />
          <DimLabel position={[w / 2 + 0.05, 0.05, 0]} text={`Diepte ${spec.depthCm} cm`} color="#b45309" />
        </>
      )}
    </group>
  );
}

function DimLabel({
  position,
  text,
  color,
}: {
  position: [number, number, number];
  text: string;
  color: string;
}) {
  return (
    <Html position={position} center distanceFactor={10} occlude={false}>
      <div
        style={{
          background: color,
          color: '#fff',
          fontSize: 11,
          fontWeight: 600,
          padding: '2px 7px',
          borderRadius: 6,
          whiteSpace: 'nowrap',
          boxShadow: '0 1px 4px rgba(0,0,0,0.3)',
          fontFamily: 'system-ui, sans-serif',
          userSelect: 'none',
          pointerEvents: 'none',
        }}
      >
        {text}
      </div>
    </Html>
  );
}
