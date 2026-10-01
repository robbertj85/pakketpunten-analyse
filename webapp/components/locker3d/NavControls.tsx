'use client';

import { ReactNode } from 'react';

export type NavMode = 'camera' | 'object';

/**
 * Held-button navigation input, read every frame by NavDriver inside the Canvas.
 *   x: strafe left(-)/right(+)      y: up(-)/down(+) on screen
 *   z: backward(-)/forward(+)       rot: rotate ccw(-)/cw(+)
 * In 'camera' mode these fly the camera; in 'object' mode they move/turn the locker.
 */
export interface NavInput {
  x: number;
  y: number;
  z: number;
  rot: number;
}

interface NavControlsProps {
  mode: NavMode;
  onMode: (m: NavMode) => void;
  inputRef: { current: NavInput };
}

export default function NavControls({ mode, onMode, inputRef }: NavControlsProps) {
  // Press-and-hold: set the axis on pointer-down, clear it on up/leave/cancel.
  const hold = (field: keyof NavInput, value: number) => ({
    onPointerDown: (e: React.PointerEvent) => {
      e.preventDefault();
      e.stopPropagation();
      inputRef.current[field] = value;
    },
    onPointerUp: () => {
      inputRef.current[field] = 0;
    },
    onPointerLeave: () => {
      inputRef.current[field] = 0;
    },
    onPointerCancel: () => {
      inputRef.current[field] = 0;
    },
  });

  return (
    <div className="absolute bottom-3 right-3 z-[1000] flex flex-col items-end gap-2 select-none">
      {/* Mode toggle */}
      <div className="flex p-0.5 bg-card/45 backdrop-blur-sm rounded-lg shadow-md text-[11px] font-semibold">
        <ModeButton active={mode === 'camera'} onClick={() => onMode('camera')}>
          Camera <KeyHint active={mode === 'camera'}>C</KeyHint>
        </ModeButton>
        <ModeButton active={mode === 'object'} onClick={() => onMode('object')}>
          Automaat <KeyHint active={mode === 'object'}>A</KeyHint>
        </ModeButton>
      </div>

      <div className="flex items-stretch gap-2 bg-card/40 backdrop-blur-sm rounded-lg shadow-md p-2">
        {/* D-pad: pan / strafe */}
        <div className="grid grid-cols-3 grid-rows-3 gap-1">
          <span />
          <NavBtn title="Omhoog" {...hold('y', -1)}>▲</NavBtn>
          <span />
          <NavBtn title="Links" {...hold('x', -1)}>◀</NavBtn>
          <NavBtn title="Rechtsom draaien" subtle {...hold('rot', 1)}>⟳</NavBtn>
          <NavBtn title="Rechts" {...hold('x', 1)}>▶</NavBtn>
          <NavBtn title="Linksom draaien" subtle {...hold('rot', -1)}>⟲</NavBtn>
          <NavBtn title="Omlaag" {...hold('y', 1)}>▼</NavBtn>
          <span />
        </div>

        {/* Forward / backward — prominent */}
        <div className="flex flex-col gap-1">
          <ForwardBtn title="Vooruit" {...hold('z', 1)}>
            <span className="text-base leading-none">▲</span>
            <span className="text-[10px] font-bold tracking-wide">VOORUIT</span>
          </ForwardBtn>
          <ForwardBtn title="Achteruit" {...hold('z', -1)}>
            <span className="text-[10px] font-bold tracking-wide">ACHTERUIT</span>
            <span className="text-base leading-none">▼</span>
          </ForwardBtn>
        </div>
      </div>
    </div>
  );
}

function KeyHint({ children, active }: { children: ReactNode; active: boolean }) {
  return (
    <kbd
      className={`ml-0.5 px-1 rounded text-[9px] font-mono align-middle ${
        active ? 'bg-card/25 text-white' : 'bg-border text-subtle-foreground'
      }`}
    >
      {children}
    </kbd>
  );
}

function ModeButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`px-2.5 py-1 rounded-md transition ${
        active ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
      }`}
    >
      {children}
    </button>
  );
}

function NavBtn({
  children,
  title,
  subtle = false,
  ...handlers
}: {
  children: ReactNode;
  title: string;
  subtle?: boolean;
} & React.HTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      title={title}
      className={`w-8 h-8 flex items-center justify-center rounded-md text-sm leading-none touch-none transition ${
        subtle
          ? 'bg-card/30 hover:bg-card/60 text-subtle-foreground'
          : 'bg-card/70 hover:bg-accent active:bg-blue-200 text-muted-foreground'
      }`}
      {...handlers}
    >
      {children}
    </button>
  );
}

function ForwardBtn({
  children,
  title,
  ...handlers
}: {
  children: ReactNode;
  title: string;
} & React.HTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      title={title}
      className="flex-1 w-[4.5rem] flex flex-col items-center justify-center gap-0.5 rounded-md bg-primary hover:bg-primary/90 active:bg-primary/80 text-primary-foreground shadow-sm touch-none transition"
      {...handlers}
    >
      {children}
    </button>
  );
}
