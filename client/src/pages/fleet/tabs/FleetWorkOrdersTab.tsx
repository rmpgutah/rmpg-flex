import { useEffect, useState, useCallback, useRef } from 'react';
import { Plus, ClipboardList } from 'lucide-react';
import { apiFetch } from '../../../hooks/useApi';
import PanelTitleBar from '../../../components/PanelTitleBar';
import FleetioConflictBadge from '../../../components/FleetioConflictBadge';
import type { ConflictBadgeConflict } from '../../../components/FleetioConflictBadge';
import WorkOrderFormModal, { type WorkOrderFormVehicle } from '../modals/WorkOrderFormModal';
import type { WorkOrder, WorkOrderStats, WorkOrderStatus } from '../../../types';
import { safeDateStr } from '../../../utils/dateUtils';

const STATUS_LABELS: Record<WorkOrderStatus, string> = {
  open: 'Open',
  in_progress: 'In progress',
  waiting_parts: 'Waiting parts',
  completed: 'Completed',
  cancelled: 'Cancelled',
};

const STATUS_TONES: Record<WorkOrderStatus, string> = {
  open: 'bg-amber-500/15 text-amber-300',
  in_progress: 'bg-blue-500/15 text-blue-300',
  waiting_parts: 'bg-purple-500/15 text-purple-300',
  completed: 'bg-emerald-500/15 text-emerald-300',
  cancelled: 'bg-rmpg-700/40 text-rmpg-400',
};

interface Props {
  initialVehicleId?: number;
}

export default function FleetWorkOrdersTab({ initialVehicleId }: Props) {
  const [rows, setRows] = useState<WorkOrder[]>([]);
  const [vehicles, setVehicles] = useState<WorkOrderFormVehicle[]>([]);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | WorkOrderStatus>('all');
  const [openOnly, setOpenOnly] = useState(true);
  const [vehicleFilter, setVehicleFilter] = useState<number | null>(initialVehicleId ?? null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [conflicts, setConflicts] = useState<Map<number, ConflictBadgeConflict[]>>(new Map());
  const [stats, setStats] = useState<WorkOrderStats | null>(null);
  const [statsLoading, setStatsLoading] = useState(true);
  const fetchedIds = useRef<string>('');

  useEffect(() => {
    const ids = rows.map((r) => r.id);
    const key = ids.join(',');
    if (!ids.length || key === fetchedIds.current) return;
    fetchedIds.current = key;
    let cancelled = false;
    apiFetch<{ conflicts: Record<string, unknown>[] }>(`/fleetio/conflicts?table=work_order&ids=${ids.join(',')}`)
      .then((r) => {
        if (cancelled || !r?.conflicts) return;
        const map = new Map<number, ConflictBadgeConflict[]>();
        for (const c of r.conflicts) {
          const rmpgId = c.rmpg_id as number;
          if (!map.has(rmpgId)) map.set(rmpgId, []);
          map.get(rmpgId)!.push({
            id: c.id as number,
            field: c.field as string,
            local_value: c.local_value as string | null | undefined,
            remote_value: c.remote_value as string | null | undefined,
            resolution: c.resolution as string | null | undefined,
            created_at: c.created_at as string | undefined,
          });
        }
        setConflicts(map);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [rows]);

  const fetchRows = useCallback(() => {
    setErr(null);
    const params = new URLSearchParams();
    if (statusFilter !== 'all') params.set('status', statusFilter);
    if (openOnly) params.set('open_only', '1');
    if (vehicleFilter != null) params.set('vehicle_id', String(vehicleFilter));
    params.set('limit', '200');
    apiFetch<{ count: number; data: WorkOrder[] }>(`/work-orders?${params.toString()}`)
      .then((r) => { setRows(r?.data ?? []); setLoading(false); })
      .catch((e) => { setErr(e instanceof Error ? e.message : 'Failed to load'); setLoading(false); });
  }, [statusFilter, openOnly, vehicleFilter]);

  useEffect(() => { fetchRows(); }, [fetchRows]);

  useEffect(() => {
    let cancelled = false;
    setStatsLoading(true);
    apiFetch<{ stats: WorkOrderStats }>('/work-orders/stats')
      .then((r) => { if (!cancelled) { setStats(r?.stats ?? null); setStatsLoading(false); } })
      .catch(() => { if (!cancelled) setStatsLoading(false); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    apiFetch<WorkOrderFormVehicle[] | { data: WorkOrderFormVehicle[] }>('/fleet?limit=500')
      .then((r) => {
        if (!cancelled) {
          const arr = Array.isArray(r) ? r : (r && Array.isArray((r as { data?: WorkOrderFormVehicle[] }).data)) ? (r as { data: WorkOrderFormVehicle[] }).data : [];
          setVehicles(arr);
        }
      })
      .catch(() => { if (!cancelled) setVehicles([]); });
    return () => { cancelled = true; };
  }, []);

  const vehicleLabel = (vid: number) => {
    const v = vehicles.find((x) => x.id === vid);
    if (!v) return `Vehicle #${vid}`;
    return v.vehicle_number ?? v.vehicle_name ?? `Vehicle #${vid}`;
  };

  const filtered = rows.filter((r) => {
    // Belt-and-suspenders: `fetchRows` already sends `vehicle_id` as a
    // server-side filter, but re-apply it client-side too so a vehicle-scoped
    // view (e.g. the "View all" deep-link from FleetPage) never leaks rows
    // for other vehicles even if the server response is unfiltered.
    if (vehicleFilter != null && r.vehicle_id !== vehicleFilter) return false;
    if (!search.trim()) return true;
    const q = search.trim().toLowerCase();
    return [r.summary, r.number, r.notes, vehicleLabel(r.vehicle_id)].filter(Boolean).join(' ').toLowerCase().includes(q);
  });

  return (
    <div className="p-4 space-y-3">
      <PanelTitleBar title="WORK ORDERS" icon={ClipboardList}>
        <select
          className="px-2 py-1 text-[11px] bg-surface-base border border-rmpg-700 rounded-sm text-rmpg-100"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as 'all' | WorkOrderStatus)}
          aria-label="Filter by status"
        >
          <option value="all">All statuses</option>
          <option value="open">Open</option>
          <option value="in_progress">In progress</option>
          <option value="waiting_parts">Waiting parts</option>
          <option value="completed">Completed</option>
          <option value="cancelled">Cancelled</option>
        </select>
        <label className="text-[11px] text-rmpg-300 flex items-center gap-1">
          <input type="checkbox" checked={openOnly} onChange={(e) => setOpenOnly(e.target.checked)} className="accent-brand-400" />
          Open only
        </label>
        {vehicleFilter != null && (
          <button type="button" onClick={() => setVehicleFilter(null)} className="text-[10px] text-brand-400 hover:underline">
            Vehicle: {vehicleLabel(vehicleFilter)} — clear ✕
          </button>
        )}
        <button type="button" onClick={() => setModalOpen(true)} className="inline-flex items-center gap-1 px-2 py-1 text-[11px] bg-brand-400 text-rmpg-950 rounded-sm hover:brightness-110">
          <Plus className="w-3 h-3" /> New Work Order
        </button>
      </PanelTitleBar>

      <input
        type="text"
        placeholder="Search by vehicle, summary, or WO number…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="w-full max-w-sm px-2 py-1 text-[11px] bg-surface-base border border-rmpg-700 rounded-sm text-rmpg-100 placeholder:text-rmpg-500"
      />

      {!statsLoading && stats && (
        <div className="grid grid-cols-5 gap-2 px-1 py-2">
          <Stat label="Total Open" value={(stats.open ?? 0) + (stats.in_progress ?? 0) + (stats.waiting_parts ?? 0)} />
          <Stat label="Overdue" value={stats.overdue_count} tone={stats.overdue_count > 0 ? 'text-red-400' : 'text-rmpg-400'} />
          <Stat label="Scheduled" value={stats.scheduled_count} tone="text-blue-400" />
          <Stat label="Est. Cost" value={`$${(stats.total_estimated_cost ?? 0).toLocaleString()}`} />
          <Stat label="Actual Cost" value={`$${(stats.total_actual_cost ?? 0).toLocaleString()}`} />
        </div>
      )}

      {err ? (
        <div className="p-3 rounded-sm border border-red-500/40 text-red-300 text-xs">{err}</div>
      ) : loading ? (
        <div className="p-4 text-xs text-rmpg-400">Loading work orders…</div>
      ) : filtered.length === 0 ? (
        <div className="p-4 text-xs text-rmpg-400">
          {rows.length === 0 ? 'No work orders yet. Click "New Work Order" to create the first one.' : 'No work orders match the current filters.'}
        </div>
      ) : (
        <table className="w-full text-[11px]">
          <thead className="bg-surface-base">
            <tr>
              <th className="text-left px-3 py-[3px] text-[9px] font-semibold">WO #</th>
              <th className="text-left px-3 py-[3px] text-[9px] font-semibold">Vehicle</th>
              <th className="text-left px-3 py-[3px] text-[9px] font-semibold">Status</th>
              <th className="text-left px-3 py-[3px] text-[9px] font-semibold">Opened</th>
              <th className="text-left px-3 py-[3px] text-[9px] font-semibold">Summary</th>
              <th className="text-right px-3 py-[3px] text-[9px] font-semibold">Est</th>
              <th className="text-right px-3 py-[3px] text-[9px] font-semibold">Actual</th>
              <th className="text-center px-3 py-[3px] text-[9px] font-semibold">Sync</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => (
              <tr key={r.id} className="border-b border-rmpg-800/40 hover:bg-rmpg-800/40">
                <td className="px-3 py-[2px] text-[11px] font-mono text-rmpg-100">{r.number ?? `#${r.id}`}</td>
                <td className="px-3 py-[2px] text-[11px] text-rmpg-100">{vehicleLabel(r.vehicle_id)}</td>
                <td className="px-3 py-[2px] text-[11px]">
                  <span className={`px-1.5 py-0.5 rounded-sm text-[10px] uppercase tracking-wide ${STATUS_TONES[r.status]}`}>{STATUS_LABELS[r.status]}</span>
                </td>
                <td className="px-3 py-[2px] text-[11px] font-mono text-rmpg-300">{safeDateStr(r.opened_at)}</td>
                <td className="px-3 py-[2px] text-[11px] text-rmpg-200 max-w-[280px] truncate" title={r.summary ?? ''}>{r.summary ?? '—'}</td>
                <td className="px-3 py-[2px] text-[11px] text-right text-rmpg-300 font-mono">{r.est_cost != null ? `$${r.est_cost.toFixed(2)}` : '—'}</td>
                <td className="px-3 py-[2px] text-[11px] text-right text-rmpg-100 font-mono">{r.actual_cost != null ? `$${r.actual_cost.toFixed(2)}` : '—'}</td>
                <td className="px-3 py-[2px] text-[11px] text-center">
                  {(() => {
                    const c = conflicts.get(r.id);
                    return c?.length ? (
                      <div className="inline-flex gap-0.5">{c.map((x) => <FleetioConflictBadge key={x.id} conflict={x} compact />)}</div>
                    ) : (
                      <span className="text-rmpg-500">—</span>
                    );
                  })()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {modalOpen ? (
        <WorkOrderFormModal
          vehicles={vehicles}
          onClose={() => setModalOpen(false)}
          onCreated={() => { setModalOpen(false); fetchRows(); }}
        />
      ) : null}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string | number; tone?: string }) {
  return (
    <div className="panel-beveled p-2 text-center bg-surface-sunken">
      <div className="text-[9px] text-rmpg-500 uppercase tracking-wider font-bold">{label}</div>
      <div className={`text-lg font-bold font-mono ${tone ?? 'text-rmpg-100'}`}>{value}</div>
    </div>
  );
}
