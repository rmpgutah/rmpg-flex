import React, { useEffect, useRef } from 'react';

export interface SnapZone {
  id: string;
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SnapLayoutsProps {
  windowId: string;
  taskbarH: number;
  onSnap: (zone: SnapZone) => void;
  onDismiss: () => void;
}

const WIDE_BREAKPOINT = 1400;

export function computeSnapZones(viewportW: number, viewportH: number, taskbarH: number): SnapZone[] {
  const dH = viewportH - taskbarH;

  if (viewportW >= WIDE_BREAKPOINT) {
    const third = Math.floor(viewportW / 3);
    const twoThirds = viewportW - third;
    const half = Math.floor(dH / 2);
    return [
      { id: 'left-third', label: 'Left third', x: 0, y: 0, width: third, height: dH },
      { id: 'center-third', label: 'Center third', x: third, y: 0, width: third, height: dH },
      { id: 'right-third', label: 'Right third', x: third * 2, y: 0, width: viewportW - third * 2, height: dH },
      { id: 'top-left', label: 'Top-left quarter', x: 0, y: 0, width: third, height: half },
      { id: 'top-right', label: 'Top-right quarter', x: third * 2, y: 0, width: viewportW - third * 2, height: half },
      { id: 'bottom-left', label: 'Bottom-left quarter', x: 0, y: half, width: third, height: dH - half },
      { id: 'bottom-right', label: 'Bottom-right quarter', x: third * 2, y: half, width: viewportW - third * 2, height: dH - half },
      { id: 'right-two-thirds', label: 'Right two-thirds', x: third, y: 0, width: twoThirds, height: dH },
    ];
  }

  const half = Math.floor(viewportW / 2);
  const halfH = Math.floor(dH / 2);
  return [
    { id: 'left-half', label: 'Left half', x: 0, y: 0, width: half, height: dH },
    { id: 'right-half', label: 'Right half', x: half, y: 0, width: viewportW - half, height: dH },
    { id: 'top-left-quarter', label: 'Top-left', x: 0, y: 0, width: half, height: halfH },
    { id: 'top-right-quarter', label: 'Top-right', x: half, y: 0, width: viewportW - half, height: halfH },
    { id: 'bottom-left-quarter', label: 'Bottom-left', x: 0, y: halfH, width: half, height: dH - halfH },
    { id: 'bottom-right-quarter', label: 'Bottom-right', x: half, y: halfH, width: viewportW - half, height: dH - halfH },
  ];
}

export default function SnapLayouts({ taskbarH, onSnap, onDismiss }: SnapLayoutsProps) {
  const ref = useRef<HTMLDivElement>(null);
  const zones = computeSnapZones(window.innerWidth, window.innerHeight, taskbarH);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onDismiss();
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onDismiss(); };
    document.addEventListener('mousedown', handler);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', handler);
      window.removeEventListener('keydown', onKey);
    };
  }, [onDismiss]);

  const isWide = window.innerWidth >= WIDE_BREAKPOINT;

  return (
    <div
      ref={ref}
      data-testid="snap-layouts-overlay"
      style={{
        position: 'absolute',
        bottom: 'calc(100% + 4px)',
        left: '50%',
        transform: 'translateX(-50%)',
        background: 'var(--surface-raised)',
        border: '1px solid var(--border-strong)',
        boxShadow: '0 8px 24px var(--window-shadow)',
        borderRadius: 2,
        padding: 8,
        display: 'grid',
        gridTemplateColumns: isWide ? 'repeat(3, 1fr)' : 'repeat(2, 1fr)',
        gap: 4,
        zIndex: 10001,
        minWidth: isWide ? 280 : 200,
      }}
      role="dialog"
      aria-label="Snap layout zones"
    >
      <div style={{ gridColumn: '1 / -1', fontSize: 9, fontWeight: 600, color: 'var(--field-label-color)', letterSpacing: '0.08em', marginBottom: 4 }}>
        SNAP LAYOUT
      </div>
      {zones.map(zone => (
        <button
          key={zone.id}
          type="button"
          aria-label={`Snap to ${zone.label}`}
          onClick={() => { onSnap(zone); onDismiss(); }}
          style={{
            height: 40,
            background: 'rgba(var(--rmpg-700-rgb, 30 60 95), 0.6)',
            border: '1px solid var(--border-subtle)',
            borderRadius: 2,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 9,
            color: 'var(--text-secondary)',
            transition: 'background 120ms',
          }}
          onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(var(--rmpg-500-rgb, 62 116 168), 0.5)'; }}
          onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(var(--rmpg-700-rgb, 30 60 95), 0.6)'; }}
        >
          {zone.label}
        </button>
      ))}
    </div>
  );
}
