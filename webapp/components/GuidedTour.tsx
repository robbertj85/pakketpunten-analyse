'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

export interface TourStep {
  /** CSS selector of the element to spotlight, e.g. '[data-tour="kaart"]'.
   * When the element is missing (data still loading, collapsed panel), the
   * step falls back to a centered card so the explanation is never lost. */
  target: string;
  title: string;
  body: string;
}

interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

const PAD = 8; // spotlight padding around the target
const TOOLTIP_W = 380;

/**
 * Lightweight guided tour: dims the page, spotlights the current step's
 * element (scrolled into view), and shows an explanatory card next to it.
 * No external dependencies; Dutch UI; ESC or "Sluiten" ends the tour.
 */
export default function GuidedTour({
  steps,
  onClose,
}: {
  steps: TourStep[];
  onClose: () => void;
}) {
  const [idx, setIdx] = useState(0);
  const [rect, setRect] = useState<Rect | null>(null);
  const rafRef = useRef(0);
  const step = steps[Math.min(idx, steps.length - 1)];

  // Scroll the target into view on step change.
  useEffect(() => {
    const el = document.querySelector(step.target);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [step.target]);

  // Track the target's rect every frame while the tour is open — this follows
  // smooth scrolling, window resizes and late-loading content for free.
  useEffect(() => {
    let mounted = true;
    const tick = () => {
      if (!mounted) return;
      const el = document.querySelector(step.target);
      if (el) {
        const r = el.getBoundingClientRect();
        setRect((prev) => {
          if (
            prev &&
            Math.abs(prev.top - r.top) < 1 &&
            Math.abs(prev.left - r.left) < 1 &&
            Math.abs(prev.width - r.width) < 1 &&
            Math.abs(prev.height - r.height) < 1
          ) {
            return prev;
          }
          return { top: r.top, left: r.left, width: r.width, height: r.height };
        });
      } else {
        setRect(null);
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      mounted = false;
      cancelAnimationFrame(rafRef.current);
    };
  }, [step.target]);

  const close = useCallback(() => onClose(), [onClose]);

  // Keyboard: ESC closes, arrows navigate.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
      else if (e.key === 'ArrowRight' && idx < steps.length - 1) setIdx(idx + 1);
      else if (e.key === 'ArrowLeft' && idx > 0) setIdx(idx - 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [idx, steps.length, close]);

  // Tooltip placement: below the spotlight when it fits, else above; centered
  // fallback when the target is missing.
  const vw = typeof window !== 'undefined' ? window.innerWidth : 1200;
  const vh = typeof window !== 'undefined' ? window.innerHeight : 800;
  let tipStyle: React.CSSProperties;
  if (rect) {
    const left = Math.max(12, Math.min(vw - TOOLTIP_W - 12, rect.left + rect.width / 2 - TOOLTIP_W / 2));
    const below = rect.top + rect.height + PAD + 12;
    const placeBelow = below + 220 < vh || rect.top < 240;
    tipStyle = placeBelow
      ? { top: Math.min(below, vh - 200), left }
      : { top: undefined, bottom: vh - rect.top + PAD + 12, left };
  } else {
    tipStyle = { top: '40%', left: vw / 2 - TOOLTIP_W / 2 };
  }

  return (
    <div className="fixed inset-0 z-[2000]" role="dialog" aria-modal="true">
      {/* Click-catcher; the spotlight "hole" is drawn by the box-shadow below. */}
      <div className="absolute inset-0" onClick={close} />
      {rect ? (
        <div
          className="absolute rounded-lg pointer-events-none transition-all duration-200"
          style={{
            top: rect.top - PAD,
            left: rect.left - PAD,
            width: rect.width + PAD * 2,
            height: rect.height + PAD * 2,
            boxShadow: '0 0 0 9999px rgba(15, 23, 42, 0.55)',
            outline: '2px solid #3b82f6',
          }}
        />
      ) : (
        <div className="absolute inset-0 bg-slate-900/55 pointer-events-none" />
      )}

      <div
        className="absolute bg-white rounded-xl shadow-2xl border border-gray-200 p-4"
        style={{ width: TOOLTIP_W, maxWidth: 'calc(100vw - 24px)', ...tipStyle }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-baseline justify-between gap-2">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-blue-700">
            Stap {idx + 1} van {steps.length}
          </div>
          <button
            type="button"
            onClick={close}
            className="text-xs text-gray-400 hover:text-gray-600"
          >
            Sluiten
          </button>
        </div>
        <h4 className="text-sm font-bold text-gray-900 mt-1">{step.title}</h4>
        <p className="text-xs text-gray-600 mt-1.5 leading-relaxed">{step.body}</p>
        {!rect && (
          <p className="text-[11px] text-amber-700 mt-1.5">
            Dit onderdeel is nu niet zichtbaar (mogelijk nog aan het laden of ingeklapt).
          </p>
        )}
        <div className="flex items-center justify-between mt-3">
          <div className="flex gap-1">
            {steps.map((_, i) => (
              <button
                key={i}
                type="button"
                onClick={() => setIdx(i)}
                aria-label={`Stap ${i + 1}`}
                className={`w-1.5 h-1.5 rounded-full transition ${
                  i === idx ? 'bg-blue-600' : 'bg-gray-300 hover:bg-gray-400'
                }`}
              />
            ))}
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setIdx(Math.max(0, idx - 1))}
              disabled={idx === 0}
              className="px-3 py-1.5 text-xs font-semibold rounded border border-gray-300 text-gray-700 disabled:opacity-40 hover:bg-gray-50"
            >
              Vorige
            </button>
            {idx < steps.length - 1 ? (
              <button
                type="button"
                onClick={() => setIdx(idx + 1)}
                className="px-3 py-1.5 text-xs font-semibold rounded bg-blue-700 text-white hover:bg-blue-800"
              >
                Volgende
              </button>
            ) : (
              <button
                type="button"
                onClick={close}
                className="px-3 py-1.5 text-xs font-semibold rounded bg-blue-700 text-white hover:bg-blue-800"
              >
                Klaar
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
