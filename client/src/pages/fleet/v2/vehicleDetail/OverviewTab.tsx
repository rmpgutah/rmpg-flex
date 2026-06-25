import { useEffect, useState } from 'react';
import type { FleetVehicleDetail } from '../routes/VehicleDetailRoute';
import { apiFetch } from '../../../hooks/useApi';
import FleetioConflictBadge from '../../../components/FleetioConflictBadge';
import type { ConflictBadgeConflict } from '../../../components/FleetioConflictBadge';

/** Map display label → rmpg field name for conflict matching. */
const FIELD_TO_COL: Record<string, string> = {
  VIN: 'vin',
  Year: 'year',
  Make: 'make',
  Model: 'model',
  Color: 'color',
  Plate: 'plate_number',
  'Vehicle #': 'vehicle_number',
  Status: 'status',
  Mileage: 'current_mileage',
};

/** PR 7'a stub Overview. PR 7'b will port the full 500-line FleetOverviewTab.
 *  For 7'a we render the essential fields so the Vehicle Detail screen has
 *  observable content (per spec §6.2 field-coverage rules). */
export function OverviewTab({ vehicle }: { vehicle: FleetVehicleDetail }) {
  const [conflicts, setConflicts] = useState<ConflictBadgeConflict[]>([]);

  useEffect(() => {
    let cancelled = false;
    apiFetch<{ conflicts: Record<string, unknown>[] }>(
      `/fleetio/conflicts?table=fleet_vehicles&id=${vehicle.id}`,
    )
      .then((r) => {
        if (cancelled || !r?.conflicts) return;
        setConflicts(r.conflicts.map((c) => ({
          id: c.id as number,
          field: c.field as string,
          local_value: c.local_value as string | null | undefined,
          remote_value: c.remote_value as string | null | undefined,
          resolution: c.resolution as string | null | undefined,
          created_at: c.created_at as string | undefined,
        })));
      })
      .catch(() => { if (!cancelled) setConflicts([]); });
    return () => { cancelled = true; };
  }, [vehicle.id]);

  const conflictByField = (field: string) =>
    conflicts.find((c) => c.field === field && (!c.resolution || c.resolution === 'unresolved'));

  return (
    <div className="p-4 grid grid-cols-1 lg:grid-cols-2 gap-4">
      <Section title="Identity">
        <Row label="VIN" value={vehicle.vin} conflict={conflictByField('vin')} />
        <Row label="Year" value={vehicle.year?.toString()} conflict={conflictByField('year')} />
        <Row label="Make" value={vehicle.make} conflict={conflictByField('make')} />
        <Row label="Model" value={vehicle.model} conflict={conflictByField('model')} />
        <Row label="Color" value={vehicle.color} conflict={conflictByField('color')} />
      </Section>
      <Section title="Registration">
        <Row label="Plate" value={`${vehicle.plate_number ?? '—'} (${vehicle.plate_state ?? '—'})`} conflict={conflictByField('plate_number')} />
        <Row label="Vehicle #" value={vehicle.vehicle_number} conflict={conflictByField('vehicle_number')} />
      </Section>
      <Section title="Operations">
        <Row label="Status" value={vehicle.status} conflict={conflictByField('status')} />
        <Row label="Mileage" value={vehicle.current_mileage?.toLocaleString()} conflict={conflictByField('current_mileage')} />
      </Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-sm border border-rmpg-700 bg-surface-raised">
      <div className="px-3 py-1.5 border-b border-rmpg-700 text-[10px] uppercase tracking-wide text-rmpg-400 font-semibold">{title}</div>
      <div className="p-3 space-y-1">{children}</div>
    </div>
  );
}

function Row({ label, value, conflict }: { label: string; value: string | null | undefined; conflict?: ConflictBadgeConflict }) {
  return (
    <div className="flex items-baseline justify-between text-[11px]">
      <span className="text-rmpg-400">{label}</span>
      <span className="flex items-center gap-1.5 text-rmpg-100">
        {value ?? '—'}
        {conflict ? <FleetioConflictBadge conflict={conflict} compact /> : null}
      </span>
    </div>
  );
}
