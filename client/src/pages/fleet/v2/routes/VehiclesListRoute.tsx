import { useEffect, useMemo, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { LayoutGrid, Table as TableIcon, Plus } from 'lucide-react';
import { apiFetch } from '../../../../hooks/useApi';
import { FleetListShell } from '../shell/FleetListShell';
import { useFleetV2View } from '../hooks/useFleetV2Audit';
import VehicleFormModal, {
  EMPTY_VEHICLE_FORM,
  type VehicleFormState,
} from '../../modals/VehicleFormModal';

interface FleetVehicleRow {
  id: number;
  vehicle_name: string | null;
  vehicle_number: string | null;
  make: string | null;
  model: string | null;
  year: number | null;
  plate_number: string | null;
  plate_state: string | null;
  status: string | null;
  current_mileage: number | null;
}

type ViewMode = 'card' | 'table';

export function VehiclesListRoute() {
  useFleetV2View('/fleet/v2/vehicles');
  const [rows, setRows] = useState<FleetVehicleRow[]>([]);
  const [search, setSearch] = useState('');
  const [mode, setMode] = useState<ViewMode>('card');

  // ─── New Vehicle modal state ────────────────────────────
  // The header button used to be unwired (zero onClick) — click did nothing.
  // Reuses the same VehicleFormModal the legacy /fleet page mounts so the
  // form contract + validation stays identical across both surfaces.
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState<VehicleFormState>(EMPTY_VEHICLE_FORM);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  const fetchRows = useCallback(() => {
    // /api/fleet returns { data: FleetVehicleRow[], pagination: {...} } —
    // a wrapped envelope, NOT a bare array. The earlier defensive guard
    // `Array.isArray(r) ? r : []` was correct against crashes but silently
    // hid the data. Extract .data explicitly; accept a bare array too in
    // case the contract ever simplifies.
    apiFetch<FleetVehicleRow[] | { data: FleetVehicleRow[] }>('/fleet?limit=500')
      .then((r) => {
        const arr = Array.isArray(r)
          ? r
          : (r && Array.isArray((r as { data?: FleetVehicleRow[] }).data))
            ? (r as { data: FleetVehicleRow[] }).data
            : [];
        setRows(arr);
      })
      .catch(() => setRows([]));
  }, []);

  useEffect(() => { fetchRows(); }, [fetchRows]);

  const openNew = () => {
    setForm(EMPTY_VEHICLE_FORM);
    setModalOpen(true);
  };
  const closeNew = () => setModalOpen(false);

  const handleSave = async () => {
    if (!form.vehicle_number.trim()) return; // modal already shows inline error
    setSaving(true);
    setToast(null);
    try {
      const equipArr = form.equipment_str.split(',').map((s) => s.trim()).filter(Boolean);
      const payload = {
        vehicle_number: form.vehicle_number.trim(),
        make: form.make.trim() || null,
        model: form.model.trim() || null,
        year: form.year ? parseInt(form.year, 10) : null,
        color: form.color.trim() || null,
        vin: form.vin.trim() || null,
        plate_number: form.plate_number.trim() || null,
        plate_state: form.plate_state.trim() || null,
        status: form.status,
        current_mileage: form.current_mileage ? parseInt(form.current_mileage, 10) : null,
        next_service_mileage: form.next_service_mileage ? parseInt(form.next_service_mileage, 10) : null,
        insurance_expiry: form.insurance_expiry || null,
        registration_expiry: form.registration_expiry || null,
        equipment: equipArr,
        notes: form.notes.trim() || null,
      };
      await apiFetch('/fleet', { method: 'POST', body: JSON.stringify(payload) });
      setToast({ kind: 'ok', text: `Vehicle "${payload.vehicle_number}" created.` });
      setModalOpen(false);
      fetchRows();
    } catch (err) {
      setToast({ kind: 'err', text: err instanceof Error ? err.message : 'Failed to save vehicle' });
    } finally {
      setSaving(false);
    }
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) =>
      [r.vehicle_name, r.vehicle_number, r.make, r.model, r.plate_number]
        .filter(Boolean).join(' ').toLowerCase().includes(q)
    );
  }, [rows, search]);

  return (
    <FleetListShell
      title="Vehicles"
      searchPlaceholder="Search vehicles..."
      onSearchChange={setSearch}
      actions={
        <>
          <button
            onClick={() => setMode(mode === 'card' ? 'table' : 'card')}
            aria-label={mode === 'card' ? 'Switch to table view' : 'Switch to card view'}
            className="px-2 py-1 text-[11px] border border-rmpg-700 rounded-sm hover:bg-rmpg-800"
          >
            {mode === 'card' ? <TableIcon className="w-3 h-3 inline mr-1" /> : <LayoutGrid className="w-3 h-3 inline mr-1" />}
            {mode === 'card' ? 'Table view' : 'Card view'}
          </button>
          <button
            type="button"
            onClick={openNew}
            className="px-2 py-1 text-[11px] bg-brand-400 text-rmpg-950 rounded-sm hover:brightness-110"
            aria-label="New vehicle"
          >
            <Plus className="w-3 h-3 inline mr-1" /> New Vehicle
          </button>
        </>
      }
    >
      {toast ? (
        <div
          role="status"
          className={`mx-3 mt-2 px-3 py-2 rounded-sm border text-xs ${
            toast.kind === 'ok'
              ? 'border-emerald-500/40 text-emerald-300 bg-emerald-500/10'
              : 'border-red-500/40 text-red-300 bg-red-500/10'
          }`}
        >
          <div className="flex items-center justify-between gap-3">
            <span>{toast.text}</span>
            <button
              type="button"
              onClick={() => setToast(null)}
              className="text-[10px] underline opacity-80 hover:opacity-100"
            >
              dismiss
            </button>
          </div>
        </div>
      ) : null}
      {mode === 'card' ? <CardGrid rows={filtered} /> : <TableView rows={filtered} />}
      <VehicleFormModal
        isOpen={modalOpen}
        mode="new_vehicle"
        form={form}
        onChange={setForm}
        onSave={handleSave}
        onClose={closeNew}
        saving={saving}
      />
    </FleetListShell>
  );
}

function CardGrid({ rows }: { rows: FleetVehicleRow[] }) {
  return (
    <div className="p-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2">
      {rows.map((r) => (
        <Link
          key={r.id}
          to={`/fleet/v2/vehicles/${r.id}`}
          className="block p-3 rounded-sm border border-rmpg-700 bg-surface-raised hover:border-brand-400"
        >
          <div className="text-sm font-semibold text-rmpg-100">{r.vehicle_name ?? r.vehicle_number ?? `Vehicle ${r.id}`}</div>
          <div className="text-[10px] text-rmpg-400 mt-0.5">
            {r.year ?? ''} {r.make ?? ''} {r.model ?? ''}
          </div>
          <div className="text-[10px] text-rmpg-400 mt-1">{r.plate_number ?? '—'} ({r.plate_state ?? '—'})</div>
          <div className="text-[10px] text-rmpg-300 mt-2">{(r.current_mileage ?? 0).toLocaleString()} mi · {r.status ?? 'unknown'}</div>
        </Link>
      ))}
    </div>
  );
}

function TableView({ rows }: { rows: FleetVehicleRow[] }) {
  return (
    <table className="w-full text-[11px]">
      <thead className="bg-surface-base">
        <tr>
          <th className="text-left px-3 py-1.5 font-semibold">Name</th>
          <th className="text-left px-3 py-1.5 font-semibold">Make/Model</th>
          <th className="text-left px-3 py-1.5 font-semibold">Plate</th>
          <th className="text-right px-3 py-1.5 font-semibold">Miles</th>
          <th className="text-left px-3 py-1.5 font-semibold">Status</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.id} className="border-b border-rmpg-700 hover:bg-rmpg-800">
            <td className="px-3 py-0.5">
              <Link to={`/fleet/v2/vehicles/${r.id}`} className="text-rmpg-100 hover:text-brand-400">
                {r.vehicle_name ?? r.vehicle_number ?? `Vehicle ${r.id}`}
              </Link>
            </td>
            <td className="px-3 py-0.5 text-rmpg-300">{[r.year, r.make, r.model].filter(Boolean).join(' ')}</td>
            <td className="px-3 py-0.5 text-rmpg-300">{r.plate_number ?? '—'} ({r.plate_state ?? '—'})</td>
            <td className="px-3 py-0.5 text-right text-rmpg-300">{(r.current_mileage ?? 0).toLocaleString()}</td>
            <td className="px-3 py-0.5 text-rmpg-300">{r.status ?? 'unknown'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
