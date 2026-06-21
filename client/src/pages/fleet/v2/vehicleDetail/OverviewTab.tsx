import type { FleetVehicleDetail } from '../routes/VehicleDetailRoute';

/** PR 7'a stub Overview. PR 7'b will port the full 500-line FleetOverviewTab.
 *  For 7'a we render the essential fields so the Vehicle Detail screen has
 *  observable content (per spec §6.2 field-coverage rules). */
export function OverviewTab({ vehicle }: { vehicle: FleetVehicleDetail }) {
  return (
    <div className="p-4 grid grid-cols-1 lg:grid-cols-2 gap-4">
      <Section title="Identity">
        <Row label="VIN" value={vehicle.vin} />
        <Row label="Year" value={vehicle.year?.toString()} />
        <Row label="Make" value={vehicle.make} />
        <Row label="Model" value={vehicle.model} />
        <Row label="Color" value={vehicle.color} />
      </Section>
      <Section title="Registration">
        <Row label="Plate" value={`${vehicle.plate_number ?? '—'} (${vehicle.plate_state ?? '—'})`} />
        <Row label="Vehicle #" value={vehicle.vehicle_number} />
      </Section>
      <Section title="Operations">
        <Row label="Status" value={vehicle.status} />
        <Row label="Mileage" value={vehicle.current_mileage?.toLocaleString()} />
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

function Row({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="flex items-baseline justify-between text-[11px]">
      <span className="text-rmpg-400">{label}</span>
      <span className="text-rmpg-100">{value ?? '—'}</span>
    </div>
  );
}
