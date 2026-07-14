import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, CheckCircle2 } from 'lucide-react';
import { apiFetch } from '../hooks/useApi';

export interface ConflictBadgeConflict {
  id: number;
  field: string;
  local_value?: string | null;
  remote_value?: string | null;
  rmpg_table?: string;
  rmpg_id?: number;
  resolution?: string | null;
  created_at?: string;
}

interface FleetioConflictBadgeProps {
  conflict: ConflictBadgeConflict;
  compact?: boolean;
  onResolved?: () => void;
}

export default function FleetioConflictBadge({ conflict, compact, onResolved }: FleetioConflictBadgeProps) {
  const [resolving, setResolving] = useState(false);
  // Tracks a resolution just applied by this instance so the resolved view
  // shows immediately even if the parent doesn't re-fetch/re-pass an
  // updated `conflict.resolution` prop (onResolved is optional).
  const [localResolution, setLocalResolution] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState({ x: 0, y: 0 });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  const effectiveResolution = localResolution ?? conflict.resolution;

  useEffect(() => {
    if (!open) return;
    const onClickOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        triggerRef.current && !triggerRef.current.contains(target) &&
        popoverRef.current && !popoverRef.current.contains(target)
      ) {
        setOpen(false);
      }
    };
    const onScroll = () => setOpen(false);
    document.addEventListener('mousedown', onClickOutside);
    window.addEventListener('scroll', onScroll, { capture: true });
    return () => {
      document.removeEventListener('mousedown', onClickOutside);
      window.removeEventListener('scroll', onScroll, { capture: true });
    };
  }, [open]);

  if (effectiveResolution && effectiveResolution !== 'unresolved') {
    return (
      <span className="inline-flex items-center gap-1 text-[9px] px-1.5 py-0.5 rounded-sm bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
        <CheckCircle2 className="w-2.5 h-2.5" />
        {effectiveResolution === 'local_wins' ? 'Kept local' : effectiveResolution === 'remote_wins' ? 'Used remote' : 'Resolved'}
      </span>
    );
  }

  const resolve = (resolution: 'local_wins' | 'remote_wins') => {
    setResolving(true);
    apiFetch<{ success: boolean }>(`/fleetio/conflicts/${conflict.id}/resolve`, {
      method: 'POST',
      body: JSON.stringify({ resolution }),
    })
      .then(() => {
        setResolving(false);
        setLocalResolution(resolution);
        setOpen(false);
        onResolved?.();
      })
      .catch(() => setResolving(false));
  };

  if (compact) {
    const openPopover = () => {
      if (triggerRef.current) {
        const rect = triggerRef.current.getBoundingClientRect();
        setCoords({ x: rect.left, y: rect.bottom + 4 });
      }
      setOpen(true);
    };

    return (
      <>
        <button
          ref={triggerRef}
          type="button"
          onClick={() => (open ? setOpen(false) : openPopover())}
          className="inline-flex items-center gap-1 text-[9px] px-1.5 py-0.5 rounded-sm bg-amber-500/10 text-amber-400 border border-amber-500/30"
          aria-expanded={open}
          aria-label={`Conflict on ${conflict.field}`}
        >
          <AlertTriangle className="w-2.5 h-2.5" />
          {conflict.field}
        </button>
        {open && createPortal(
          <div
            ref={popoverRef}
            className="fixed z-[9999] px-2 py-1.5 text-[10px] shadow-lg max-w-xs"
            style={{
              left: coords.x,
              top: coords.y,
              background: 'var(--surface-overlay)',
              color: '#d4a017',
              border: '1px solid var(--border-default)',
              borderLeft: '2px solid #d4a017',
            }}
          >
            <div className="space-y-1">
              <div className="font-semibold text-amber-300">{conflict.field}</div>
              <div className="grid grid-cols-2 gap-x-2 gap-y-0.5 text-[9px]">
                <span className="text-rmpg-400">Local:</span>
                <span className="text-rmpg-100 truncate max-w-[120px]">{conflict.local_value ?? '—'}</span>
                <span className="text-rmpg-400">Remote:</span>
                <span className="text-rmpg-100 truncate max-w-[120px]">{conflict.remote_value ?? '—'}</span>
              </div>
              <div className="flex items-center gap-1 pt-1">
                <button
                  type="button"
                  disabled={resolving}
                  onClick={() => resolve('local_wins')}
                  className="text-[9px] px-1 py-0.5 border border-rmpg-700 rounded-sm hover:bg-rmpg-800 disabled:opacity-50"
                >
                  Keep local
                </button>
                <button
                  type="button"
                  disabled={resolving}
                  onClick={() => resolve('remote_wins')}
                  className="text-[9px] px-1 py-0.5 border border-rmpg-700 rounded-sm hover:bg-rmpg-800 disabled:opacity-50"
                >
                  Use remote
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )}
      </>
    );
  }

  return (
    <div className="inline-flex items-center gap-1 text-[10px] px-2 py-1 rounded-sm bg-amber-500/10 text-amber-300 border border-amber-500/30">
      <AlertTriangle className="w-3 h-3 flex-shrink-0" />
      <span className="font-mono">{conflict.field}</span>
      <span className="text-[9px] text-rmpg-400 mx-1">local: {conflict.local_value ?? '—'}</span>
      <span className="text-[9px] text-rmpg-400 mr-1">vs remote: {conflict.remote_value ?? '—'}</span>
      <button
        type="button"
        disabled={resolving}
        onClick={() => resolve('local_wins')}
        className="text-[9px] px-1 py-0.5 border border-rmpg-700 rounded-sm hover:bg-rmpg-800 disabled:opacity-50"
      >
        Keep local
      </button>
      <button
        type="button"
        disabled={resolving}
        onClick={() => resolve('remote_wins')}
        className="text-[9px] px-1 py-0.5 border border-rmpg-700 rounded-sm hover:bg-rmpg-800 disabled:opacity-50"
      >
        Use remote
      </button>
    </div>
  );
}
