// ============================================================
// RMPG Flex — fleet-v2 Work Orders list (Fleet.io PR 5b)
// ------------------------------------------------------------
// Consumes the work-orders backend that landed in PR 5 (#1495):
//   GET  /api/work-orders                — list (filters: vehicle_id, status, open_only)
//   POST /api/work-orders                — create header
// The DETAIL view (header + line items + attachments + comments + close
// wizard) is its own focused PR (5c); for now clicking a row opens the
// legacy /fleet maintenance tab in a new tab.
// ============================================================
import { useEffect, useState, useCallback } from 'react';
import { Plus } from 'lucide-react';
import { apiFetch } from '../../../../hooks/useApi';
import { FleetListShell } from '../shell/FleetListShell';
import { useFleetV2View } from '../hooks/useFleetV2Audit';

interface WorkOrderRow {
  id: number;
  vehicle_id: number;
  status: 'open' | 'in_progress' | 'waiting_parts' | 'completed' | 'cancelled';
  number: string | null;
  opened_at: string;
  closed_at: string | null;
  summary: string | null;
  vendor_id: number | null;
  est_cost: number | null;
  actual_cost: number | null;
  category_code: string | null;
  notes: string | null;
}

interface VehicleStub { id: number; vehicle_number: string | null; vehicle_name: string | null; }

const STATUS_LABELS: Record<WorkOrderRow['status'], string> = {
  open: 'Open',
  in_progress: 'In progress',
  waiting_parts: 'Waiting parts',
  completed: 'Completed',
  cancelled: 'Cancelled',
};

const STATUS_TONES: Record<WorkOrderRow['status'], string> = {
  open: 'bg-amber-500/15 text-amber-300',
  in_progress: 'bg-blue-500/15 text-blue-300',
  waiting_parts: 'bg-purple-500/15 text-purple-300',
  completed: 'bg-emerald-500/15 text-emerald-300',
  cancelled: 'bg-rmpg-700/40 text-rmpg-400',
};

export function WorkOrdersRoute() {
  useFleetV2View('/fleet/v2/work-orders');

  const [rows, setRows] = useState<WorkOrderRow[]>([]);
  const [vehicles, setVehicles] = useState<VehicleStub[]>([]);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | WorkOrderRow['status']>('all');
  const [openOnly, setOpenOnly] = useState(true);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);

  const fetchRows = useCallback(() => {
    setErr(null);
    const params = new URLSearchParams();
    if (statusFilter !== 'all') params.set('status', statusFilter);
    if (openOnly) params.set('open_only', '1');
    params.set('limit', '200');
    apiFetch<{ count: number; data: WorkOrderRow[] }>(`/work-orders?${params.toString()}`)
      .then((r) => { setRows(r?.data ?? []); setLoading(false); })
      .catch((e) => { setErr(e instanceof Error ? e.message : 'Failed to load'); setLoading(false); });
  }, [statusFilter, openOnly]);

  useEffect(() => { fetchRows(); }, [fetchRows]);

  useEffect(() => {
    // /api/fleet returns { data, pagination } — unwrap.
    apiFetch<VehicleStub[] | { data: VehicleStub[] }>('/fleet?limit=500')
      .then((r) => {
        const arr = Array.isArray(r)
          ? r
          : (r && Array.isArray((r as { data?: VehicleStub[] }).data))
            ? (r as { data: VehicleStub[] }).data
            : [];
        setVehicles(arr);
      })
      .catch(() => setVehicles([]));
  }, []);

  const vehicleLabel = (vid: number) => {
    const v = vehicles.find((x) => x.id === vid);
    if (!v) return `Vehicle #${vid}`;
    return v.vehicle_number ?? v.vehicle_name ?? `Vehicle #${vid}`;
  };

  const filtered = rows.filter((r) => {
    if (!search.trim()) return true;
    const q = search.trim().toLowerCase();
    return [r.summary, r.number, r.notes, vehicleLabel(r.vehicle_id)]
      .filter(Boolean)
      .join(' ')
      .toLowerCase()
      .includes(q);
  });

  return (
    <FleetListShell
      title="Work Orders"
      searchPlaceholder="Search by vehicle, summary, or WO number…"
      onSearchChange={setSearch}
      actions={
        <>
          <select
            className="px-2 py-1 text-[11px] bg-surface-base border border-rmpg-700 rounded-sm text-rmpg-100"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as 'all' | WorkOrderRow['status'])}
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
            <input
              type="checkbox"
              checked={openOnly}
              onChange={(e) => setOpenOnly(e.target.checked)}
              className="accent-brand-400"
            />
            Open only
          </label>
          <button
            type="button"
            onClick={() => setModalOpen(true)}
            className="inline-flex items-center gap-1 px-2 py-1 text-[11px] bg-brand-400 text-rmpg-950 rounded-sm hover:brightness-110"
            aria-label="New work order"
          >
            <Plus className="w-3 h-3" /> New Work Order
          </button>
        </>
      }
    >
      {err ? (
        <div className="m-3 p-3 rounded-sm border border-red-500/40 text-red-300 text-xs">
          {err}
        </div>
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
              <th className="text-left px-3 py-1.5 font-semibold">WO #</th>
              <th className="text-left px-3 py-1.5 font-semibold">Vehicle</th>
              <th className="text-left px-3 py-1.5 font-semibold">Status</th>
              <th className="text-left px-3 py-1.5 font-semibold">Opened</th>
              <th className="text-left px-3 py-1.5 font-semibold">Summary</th>
              <th className="text-right px-3 py-1.5 font-semibold">Est</th>
              <th className="text-right px-3 py-1.5 font-semibold">Actual</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => (
              <tr key={r.id} className="border-b border-rmpg-800/40 hover:bg-rmpg-800/40">
                <td className="px-3 py-1 font-mono text-rmpg-100">{r.number ?? `#${r.id}`}</td>
                <td className="px-3 py-1 text-rmpg-100">{vehicleLabel(r.vehicle_id)}</td>
                <td className="px-3 py-1">
                  <span className={`px-1.5 py-0.5 rounded-sm text-[10px] uppercase tracking-wide ${STATUS_TONES[r.status]}`}>
                    {STATUS_LABELS[r.status]}
                  </span>
                </td>
                <td className="px-3 py-1 font-mono text-rmpg-300">{shortDate(r.opened_at)}</td>
                <td className="px-3 py-1 text-rmpg-200 max-w-[320px] truncate" title={r.summary ?? ''}>
                  {r.summary ?? '—'}
                </td>
                <td className="px-3 py-1 text-right text-rmpg-300 font-mono">{fmtUsd(r.est_cost)}</td>
                <td className="px-3 py-1 text-right text-rmpg-100 font-mono">{fmtUsd(r.actual_cost)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {modalOpen ? (
        <NewWorkOrderModal
          vehicles={vehicles}
          onClose={() => setModalOpen(false)}
          onCreated={() => { setModalOpen(false); fetchRows(); }}
        />
      ) : null}
    </FleetListShell>
  );
}

// ─── New WO modal ─────────────────────────────────────────

interface NewWorkOrderModalProps {
  vehicles: VehicleStub[];
  onClose: () => void;
  onCreated: () => void;
}

function NewWorkOrderModal({ vehicles, onClose, onCreated }: NewWorkOrderModalProps) {
  const [vehicleId, setVehicleId] = useState('');
  const [number, setNumber] = useState('');
  const [summary, setSummary] = useState('');
  const [status, setStatus] = useState<WorkOrderRow['status']>('open');
  const [estCost, setEstCost] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const handleSave = () => {
    setErr(null);
    if (!vehicleId) {
      setErr('Vehicle is required.');
      return;
    }
    setSaving(true);
    apiFetch<{ data: WorkOrderRow }>('/work-orders', {
      method: 'POST',
      body: JSON.stringify({
        vehicle_id: parseInt(vehicleId, 10),
        number: number.trim() || null,
        summary: summary.trim() || null,
        status,
        est_cost: estCost ? parseFloat(estCost) : null,
        notes: notes.trim() || null,
      }),
    })
      .then(() => { setSaving(false); onCreated(); })
      .catch((e) => {
        setSaving(false);
        setErr(e instanceof Error ? e.message : 'Failed to create work order');
      });
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="new-wo-title"
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.6)' }}
      onClick={saving ? undefined : onClose}
    >
      <div
        className="bg-surface-raised border border-rmpg-700 rounded-sm w-[480px] max-w-full mx-4 max-h-[80vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between px-4 py-2 border-b border-rmpg-700">
          <h2 id="new-wo-title" className="text-sm font-semibold text-rmpg-100">New Work Order</h2>
          <button type="button" onClick={onClose} className="text-xs text-rmpg-400 hover:text-rmpg-100" disabled={saving}>
            ✕
          </button>
        </header>
        <div className="p-4 space-y-3">
          {err ? (
            <div className="px-3 py-2 rounded-sm border border-red-500/40 text-red-300 text-xs">{err}</div>
          ) : null}
          <Field label="Vehicle *">
            <select
              className="w-full px-2 py-1 text-[12px] bg-surface-base border border-rmpg-700 rounded-sm text-rmpg-100"
              value={vehicleId}
              onChange={(e) => setVehicleId(e.target.value)}
              aria-required
              aria-invalid={!vehicleId && err ? true : undefined}
            >
              <option value="">— select vehicle —</option>
              {vehicles.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.vehicle_number ?? v.vehicle_name ?? `Vehicle ${v.id}`}
                </option>
              ))}
            </select>
          </Field>
          <Field label="WO Number (optional)">
            <input
              type="text"
              className="w-full px-2 py-1 text-[12px] bg-surface-base border border-rmpg-700 rounded-sm text-rmpg-100 font-mono"
              value={number}
              onChange={(e) => setNumber(e.target.value)}
              placeholder="Shop-assigned number"
            />
          </Field>
          <Field label="Summary">
            <input
              type="text"
              className="w-full px-2 py-1 text-[12px] bg-surface-base border border-rmpg-700 rounded-sm text-rmpg-100"
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              placeholder="Short one-liner"
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Status">
              <select
                className="w-full px-2 py-1 text-[12px] bg-surface-base border border-rmpg-700 rounded-sm text-rmpg-100"
                value={status}
                onChange={(e) => setStatus(e.target.value as WorkOrderRow['status'])}
              >
                <option value="open">Open</option>
                <option value="in_progress">In progress</option>
                <option value="waiting_parts">Waiting parts</option>
              </select>
            </Field>
            <Field label="Est. cost ($)">
              <input
                type="number"
                inputMode="decimal"
                step="0.01"
                className="w-full px-2 py-1 text-[12px] bg-surface-base border border-rmpg-700 rounded-sm text-rmpg-100 font-mono"
                value={estCost}
                onChange={(e) => setEstCost(e.target.value)}
              />
            </Field>
          </div>
          <Field label="Notes">
            <textarea
              className="w-full px-2 py-1 text-[12px] bg-surface-base border border-rmpg-700 rounded-sm text-rmpg-100 h-16 resize-none"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </Field>
        </div>
        <footer className="flex items-center justify-end gap-2 px-4 py-2 border-t border-rmpg-700">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="px-2 py-1 text-[11px] border border-rmpg-700 rounded-sm hover:bg-rmpg-800 text-rmpg-100"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="px-2 py-1 text-[11px] bg-brand-400 text-rmpg-950 rounded-sm hover:brightness-110 disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Create'}
          </button>
        </footer>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[10px] text-rmpg-400 uppercase tracking-wide mb-0.5">{label}</div>
      {children}
    </div>
  );
}

// ─── helpers ──────────────────────────────────────────────

function fmtUsd(n: number | null | undefined): string {
  if (n == null) return '—';
  return `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function shortDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  // SQLite "YYYY-MM-DD HH:MM:SS" → just the date portion.
  return iso.slice(0, 10);
}
