import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { LayoutGrid, Table as TableIcon, Plus } from 'lucide-react';
import { apiFetch } from '../../../../hooks/useApi';
import { FleetListShell } from '../shell/FleetListShell';
import { useFleetV2View } from '../hooks/useFleetV2Audit';

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

  useEffect(() => {
    apiFetch<FleetVehicleRow[]>('/fleet')
      .then((r) => setRows(Array.isArray(r) ? r : []))
      .catch(() => setRows([]));
  }, []);

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
          <button className="px-2 py-1 text-[11px] bg-brand-400 text-rmpg-950 rounded-sm hover:brightness-110">
            <Plus className="w-3 h-3 inline mr-1" /> New Vehicle
          </button>
        </>
      }
    >
      {mode === 'card' ? <CardGrid rows={filtered} /> : <TableView rows={filtered} />}
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
