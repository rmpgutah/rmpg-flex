import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Eye, Copy, ScanLine } from 'lucide-react';
import { parseTimestamp } from '../../../utils/dateUtils';
import { useNavigate } from 'react-router';
import { apiFetch } from '../../../hooks/useApi';
import { useWebSocket } from '../../../context/WebSocketContext';
import { useGeolocation } from '../hooks/useGeolocation';
import { useContextMenu, type ContextMenuItem } from '../../../context/ContextMenuContext';
import { copyToClipboard, separator } from '../../../utils/contextMenuActions';

// See BolosCard for why we build menus inline (useMenuActions throws without
// ToastProvider/Router, which the bare-render tests don't mount).

// Server accepts lowercase statuses (see server/src/routes/dispatch/calls.ts:131).
// "Active" here = not cleared/closed/cancelled/archived.
const ACTIVE_STATUSES = 'pending,dispatched,enroute,onscene';

interface CallRow {
  id: number;
  call_number?: string;
  incident_type?: string;
  priority?: string | number;
  status?: string;
  location?: string;
  address?: string;
  location_address?: string;
  lat?: number | null;
  lng?: number | null;
  latitude?: number | null;
  longitude?: number | null;
  created_at?: string;
}

function haversineMiles(a: number, b: number, c: number, d: number): number {
  const toRad = (x: number) => (x * Math.PI) / 180;
  const R = 3958.8;
  const dLat = toRad(c - a);
  const dLng = toRad(d - b);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a)) * Math.cos(toRad(c)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function ageLabel(iso?: string): string {
  if (!iso) return '';
  const then = parseTimestamp(iso).getTime();
  if (isNaN(then)) return '';
  const mins = Math.max(0, Math.floor((Date.now() - then) / 60000));
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  return `${hrs}h`;
}

function prioNum(p: unknown): number | null {
  if (p == null) return null;
  const n = Number(p);
  return Number.isFinite(n) ? n : null;
}

export default function ActiveCallsCard() {
  const navigate = useNavigate();
  const { subscribe } = useWebSocket();
  const { openMenu } = useContextMenu();

  const [calls, setCalls] = useState<CallRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showDistance, setShowDistance] = useState(false);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { status: geoStatus, position } = useGeolocation({ enabled: showDistance });

  const fetchCalls = useCallback(async () => {
    try {
      setError(null);
      const res = await apiFetch<any>(
        `/api/dispatch/calls?status=${ACTIVE_STATUSES}&limit=20`,
      );
      const rows: CallRow[] = Array.isArray(res)
        ? res
        : Array.isArray(res?.data)
        ? res.data
        : Array.isArray(res?.calls)
        ? res.calls
        : Array.isArray(res?.rows)
        ? res.rows
        : [];
      setCalls(rows);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load calls');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchCalls();
  }, [fetchCalls]);

  useEffect(() => {
    const unsub = subscribe('dispatch_update' as any, () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => { fetchCalls(); }, 250);
    });
    return () => {
      unsub();
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [subscribe, fetchCalls]);

  const { p1Count, p2Count } = useMemo(() => {
    let p1 = 0, p2 = 0;
    for (const c of calls) {
      const n = prioNum(c.priority);
      if (n === 1) p1++;
      else if (n === 2) p2++;
    }
    return { p1Count: p1, p2Count: p2 };
  }, [calls]);

  const visible = useMemo(() => {
    const sorted = [...calls].sort((a, b) => {
      const ta = a.created_at ? parseTimestamp(a.created_at).getTime() : 0;
      const tb = b.created_at ? parseTimestamp(b.created_at).getTime() : 0;
      return tb - ta;
    });
    return sorted.slice(0, 6);
  }, [calls]);

  const handleRowClick = (call: CallRow) => {
    if (call.call_number) navigate(`/dispatch?call=${call.call_number}`);
  };

  // On-scene ALPR: open the field camera scoped to this call. Photos taken
  // there auto-attach to the call and every vehicle is extracted → a record
  // is created/linked to the call.
  const scanForCall = (call: CallRow) => navigate(`/field-camera?call_id=${call.id}&alpr=1`);

  // Right-click menu for a call row. 'Open call' reuses handleRowClick;
  // copy items use the standalone clipboard helper (no toast).
  const buildCallMenu = (c: CallRow, addr: string): ContextMenuItem[] => {
    const callNo = c.call_number || `#${c.id}`;
    const items: ContextMenuItem[] = [
      {
        label: 'Open call',
        icon: <Eye size={12} />,
        disabled: !c.call_number,
        onClick: () => handleRowClick(c),
      },
      separator(),
      {
        label: 'Scan vehicles (ALPR)',
        icon: <ScanLine size={12} />,
        onClick: () => scanForCall(c),
      },
      {
        label: 'Copy call #',
        icon: <Copy size={12} />,
        disabled: !c.call_number,
        onClick: () => { void copyToClipboard(callNo); },
      },
    ];
    if (addr) {
      items.push({
        label: 'Copy address',
        icon: <Copy size={12} />,
        onClick: () => { void copyToClipboard(addr); },
      });
    }
    return items;
  };

  const distanceFor = (c: CallRow): string => {
    if (!showDistance) return '';
    if (geoStatus !== 'granted' || !position) return '—';
    const lat = c.lat ?? c.latitude;
    const lng = c.lng ?? c.longitude;
    if (lat == null || lng == null) return '—';
    const mi = haversineMiles(position.lat, position.lng, Number(lat), Number(lng));
    return `${mi.toFixed(1)} mi`;
  };

  // ─── Render ───────────────────────────────────────────────
  if (loading) {
    return (
      <section className="bg-surface-base border border-border-default p-3">
        <h2 className="text-[color:var(--panel-header-color)] text-[10px] font-bold tracking-widest mb-2">ACTIVE CALLS</h2>
        <div className="h-[200px] animate-pulse bg-surface-raised border border-border-default" />
      </section>
    );
  }

  if (error) {
    return (
      <section className="bg-surface-base border border-border-default p-3">
        <h2 className="text-[color:var(--panel-header-color)] text-[10px] font-bold tracking-widest mb-2">ACTIVE CALLS</h2>
        <div className="flex items-center justify-between gap-2">
          <span className="text-amber-400 text-xs">{error}</span>
          <button
            type="button"
            onClick={() => { setLoading(true); fetchCalls(); }}
            className="min-h-[44px] h-11 px-3 bg-surface-raised border border-border-default text-rmpg-300 text-xs uppercase tracking-widest"
          >
            Retry
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="bg-surface-base border border-border-default p-3">
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-[color:var(--panel-header-color)] text-[10px] font-bold tracking-widest">ACTIVE CALLS</h2>
        {geoStatus === 'denied' ? (
          <span className="text-rmpg-500 text-[10px] italic">Enable Location in Settings</span>
        ) : (
          <button
            type="button"
            onClick={() => setShowDistance((v) => !v)}
            aria-pressed={showDistance}
            className={[
              'h-8 px-2 text-[10px] uppercase tracking-widest border',
              showDistance ? 'text-[color:var(--field-label-color)] border-accent-silver-400' : 'text-rmpg-400 border-border-default',
            ].join(' ')}
          >
            {showDistance ? 'Distance ON' : 'Show Distance'}
          </button>
        )}
      </div>

      <div className="flex items-center gap-2 mb-2">
        <span className="bg-red-900/40 text-red-300 px-2 py-0.5 text-[10px]">P1 · {p1Count}</span>
        <span className="bg-amber-900/40 text-amber-300 px-2 py-0.5 text-[10px]">P2 · {p2Count}</span>
      </div>

      {visible.length === 0 ? (
        <p className="text-rmpg-500 text-xs italic">No active calls.</p>
      ) : (
        <ul>
          {visible.map((c, i) => {
            const addr = c.address || c.location || c.location_address || '';
            const dist = distanceFor(c);
            const isLast = i === visible.length - 1;
            return (
              <li
                key={c.id}
                className={['flex items-center', isLast ? '' : 'border-b border-border-default'].join(' ')}
              >
                <button
                  type="button"
                  onClick={() => handleRowClick(c)}
                  onContextMenu={(e) => openMenu(e, buildCallMenu(c, addr))}
                  className="flex-1 min-w-0 min-h-[44px] py-2 text-rmpg-100 text-xs flex items-center justify-between gap-2 text-left"
                >
                  <span className="flex-1 min-w-0 truncate">
                    <span className="font-mono text-[color:var(--field-label-color)]">{c.call_number || `#${c.id}`}</span>
                    {c.incident_type ? <span className="text-rmpg-300"> · {c.incident_type}</span> : null}
                    {addr ? <span className="text-rmpg-500"> · {addr}</span> : null}
                  </span>
                  <span className="text-rmpg-400 text-[10px] font-mono shrink-0">
                    {dist ? `${dist} · ` : ''}{ageLabel(c.created_at)}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => scanForCall(c)}
                  className="min-h-[44px] min-w-[44px] flex items-center justify-center text-fg-muted hover:text-[color:var(--field-label-color)] shrink-0"
                  aria-label={`Scan vehicles on call ${c.call_number || c.id}`}
                  title="Scan vehicles (ALPR)"
                >
                  <ScanLine className="w-4 h-4" />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
