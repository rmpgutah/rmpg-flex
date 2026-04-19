import { useState } from 'react';
import { HelpCircle, X } from 'lucide-react';

const ROWS: { color: string; shape: 'circle' | 'triangle-up' | 'triangle-down' | 'square'; label: string }[] = [
  { color: '#22c55e', shape: 'triangle-up', label: 'Unit (moving)' },
  { color: '#22c55e', shape: 'circle', label: 'Unit (stationary)' },
  { color: '#ef4444', shape: 'triangle-down', label: 'Call (P1)' },
  { color: '#f59e0b', shape: 'triangle-down', label: 'Call (P2)' },
  { color: '#ef4444', shape: 'circle', label: 'Active Panic Alert' },
  { color: '#06b6d4', shape: 'circle', label: 'Field Interview' },
  { color: '#22c55e', shape: 'circle', label: 'Patrol Checkpoint' },
  { color: '#fbbf24', shape: 'circle', label: 'Fleet Vehicle' },
  { color: '#f97316', shape: 'circle', label: 'Repeat Address' },
  { color: '#ec4899', shape: 'circle', label: 'Predicted Hotspot' },
  { color: '#a855f7', shape: 'square', label: 'Geofence Zone' },
  { color: '#3b82f6', shape: 'circle', label: 'Your Location' },
];

const SHORTCUTS: { key: string; action: string }[] = [
  { key: 'R', action: 'Recenter map' },
  { key: 'F', action: 'Toggle fullscreen' },
  { key: 'M', action: 'Snap (screenshot)' },
  { key: 'G', action: 'Find me (geolocate)' },
  { key: 'Esc', action: 'Close popups / menus' },
  { key: '+/-', action: 'Zoom' },
  { key: 'Drag', action: 'Pan' },
  { key: 'R-click', action: 'Context menu' },
  { key: 'Shift-drag unit', action: 'Drag-to-dispatch' },
];

function ShapeSwatch({ shape, color }: { shape: typeof ROWS[number]['shape']; color: string }) {
  switch (shape) {
    case 'circle':
      return <div className="w-3 h-3 rounded-full" style={{ background: color, border: '1px solid #0a0a0a' }} aria-hidden="true" />;
    case 'triangle-up':
      return (
        <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
          <polygon points="6,1 11,11 1,11" fill={color} stroke="#0a0a0a" strokeWidth="1" />
        </svg>
      );
    case 'triangle-down':
      return (
        <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
          <polygon points="6,11 11,1 1,1" fill={color} stroke="#0a0a0a" strokeWidth="1" />
        </svg>
      );
    case 'square':
      return <div className="w-3 h-3" style={{ background: `${color}33`, border: `1px solid ${color}` }} aria-hidden="true" />;
  }
}

interface MapV2LegendProps {
  /** Vertical offset from the bottom-right corner; lets MapPageV2 stack
   *  this above other floating chrome. Default places it above the
   *  geolocate button. */
  bottomOffset?: number;
}

/**
 * Legend / shortcuts dialog for /map-v2 — bottom-right '?' button
 * opens a small overlay listing every marker shape+color and the
 * keyboard shortcuts. Helps new dispatchers discover features without
 * a separate user manual.
 */
export default function MapV2Legend({ bottomOffset = 44 }: MapV2LegendProps) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="Legend & shortcuts"
        aria-label="Open legend and keyboard shortcuts"
        className="absolute right-2 z-20 p-1.5 bg-[#141414] border border-[#222222] hover:bg-[#1a1a1a] text-[#9ca3af]"
        style={{ bottom: bottomOffset }}
      >
        <HelpCircle className="w-4 h-4" aria-hidden="true" />
      </button>
      {open && (
        <div
          className="fixed inset-0 z-[200] bg-[#000000aa] flex items-center justify-center p-4"
          onClick={() => setOpen(false)}
          role="dialog"
          aria-label="Map V2 legend and shortcuts"
        >
          <div
            className="bg-[#0a0a0a] border border-[#222222] font-mono text-[11px] tracking-wide max-w-[640px] w-full max-h-[80vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-3 py-2 border-b border-[#222222] bg-[#0d0d0d]">
              <span className="font-bold text-[#d4a017] uppercase tracking-widest">MAP V2 — Legend & Shortcuts</span>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close legend"
                className="p-1 hover:bg-[#1a1a1a] text-[#888888]"
              >
                <X className="w-3 h-3" aria-hidden="true" />
              </button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1 p-3">
              <div>
                <div className="text-[9px] font-bold text-[#666666] uppercase tracking-widest mb-1">Markers</div>
                {ROWS.map((r, i) => (
                  <div key={i} className="flex items-center gap-2 py-1">
                    <ShapeSwatch shape={r.shape} color={r.color} />
                    <span className="text-[#e5e7eb]">{r.label}</span>
                  </div>
                ))}
              </div>
              <div>
                <div className="text-[9px] font-bold text-[#666666] uppercase tracking-widest mb-1">Shortcuts</div>
                {SHORTCUTS.map((s, i) => (
                  <div key={i} className="flex items-center justify-between py-1">
                    <span className="text-[#e5e7eb]">{s.action}</span>
                    <kbd className="text-[#d4a017] bg-[#141414] border border-[#222222] px-1.5 py-0 text-[9px] font-bold">
                      {s.key}
                    </kbd>
                  </div>
                ))}
              </div>
            </div>
            <div className="px-3 py-2 border-t border-[#222222] bg-[#0d0d0d] text-[#666666] text-[9px]">
              Click anywhere outside the dialog to close. Press Esc when popups are open.
            </div>
          </div>
        </div>
      )}
    </>
  );
}
