import { useEffect, useState, useCallback } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { apiFetchV2 } from '../hooks/apiFetchV2';
import { OverviewTab } from '../vehicleDetail/OverviewTab';
import { ServiceTab } from '../vehicleDetail/ServiceTab';
import { InspectionsTab } from '../vehicleDetail/InspectionsTab';
import { FuelTab } from '../vehicleDetail/FuelTab';
import { ActivityTab } from '../vehicleDetail/ActivityTab';
import { CostsTab } from '../vehicleDetail/CostsTab';
import { RecallsTab } from '../vehicleDetail/RecallsTab';
import { DamageTab } from '../vehicleDetail/DamageTab';
import { TiresTab } from '../vehicleDetail/TiresTab';
import { AssignmentsTab } from '../vehicleDetail/AssignmentsTab';
import { WorkOrdersTab } from '../vehicleDetail/WorkOrdersTab';
import { EmptyStateCard } from '../shell/EmptyStateCard';
import { useFleetV2View } from '../hooks/useFleetV2Audit';

export interface FleetVehicleDetail {
  id: number;
  vehicle_name: string | null;
  vehicle_number: string | null;
  vin: string | null;
  plate_number: string | null;
  plate_state: string | null;
  make: string | null;
  model: string | null;
  year: number | null;
  color: string | null;
  status: string | null;
  current_mileage: number | null;
}

type TabId = 'overview' | 'service' | 'inspections' | 'fuel' | 'issues' | 'work-orders' | 'documents' | 'costs' | 'recalls' | 'damage' | 'tires' | 'assignments' | 'activity';

const TABS: { id: TabId; label: string }[] = [
  { id: 'overview',    label: 'Overview' },
  { id: 'service',     label: 'Service' },
  { id: 'inspections', label: 'Inspections' },
  { id: 'fuel',        label: 'Fuel' },
  { id: 'issues',      label: 'Issues' },
  { id: 'work-orders', label: 'Work Orders' },
  { id: 'documents',   label: 'Documents' },
  { id: 'costs',       label: 'Costs' },
  { id: 'recalls',     label: 'Recalls' },
  { id: 'damage',      label: 'Damage' },
  { id: 'tires',       label: 'Tires' },
  { id: 'assignments', label: 'Assignments' },
  { id: 'activity',    label: 'Activity' },
];

const TAB_IDS = new Set<TabId>([
  'overview', 'service', 'inspections', 'fuel', 'issues', 'work-orders',
  'documents', 'costs', 'recalls', 'damage', 'tires', 'assignments', 'activity',
]);

function isTabId(v: string | null): v is TabId {
  return !!v && (TAB_IDS as Set<string>).has(v);
}

export function VehicleDetailRoute() {
  const { id } = useParams<{ id: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  useFleetV2View(`/fleet/v2/vehicles/${id ?? ''}`);
  const [vehicle, setVehicle] = useState<FleetVehicleDetail | null>(null);
  const [loadError, setLoadError] = useState(false);
  // Tab is URL-driven so an operator can land directly on, say,
  // /fleet/v2/vehicles/42?tab=inspections from a deep-link in dispatch or
  // a court-prep email. Falls through to 'overview' if the param is
  // missing or unknown — never throws on a bad ?tab=.
  const urlTab = searchParams.get('tab');
  const initialTab: TabId = isTabId(urlTab) ? urlTab : 'overview';
  const [activeTab, setActiveTab] = useState<TabId>(initialTab);

  // Sync local state when the URL changes (back/forward, paste new link).
  useEffect(() => {
    const next = searchParams.get('tab');
    if (isTabId(next) && next !== activeTab) {
      setActiveTab(next);
    }
    // Strip unknown ?tab= values silently rather than leaving stale junk.
    if (next && !isTabId(next)) {
      const cleaned = new URLSearchParams(searchParams);
      cleaned.delete('tab');
      setSearchParams(cleaned, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  const selectTab = useCallback((t: TabId) => {
    setActiveTab(t);
    const next = new URLSearchParams(searchParams);
    if (t === 'overview') next.delete('tab'); // keep the default URL clean
    else next.set('tab', t);
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);

  useEffect(() => {
    if (!id) return;
    setVehicle(null);
    setLoadError(false);
    apiFetchV2<FleetVehicleDetail>(`/fleet/${id}`)
      .then(setVehicle)
      .catch(() => setLoadError(true));
  }, [id]);

  if (loadError) {
    return (
      <div className="p-4 text-rmpg-400 text-sm">
        Vehicle #{id} could not be loaded. It may not exist or you may not have access.
        <div className="mt-2">
          <a href="/fleet/v2/vehicles" className="text-brand-400 hover:underline text-xs">Back to Vehicles</a>
        </div>
      </div>
    );
  }
  if (!vehicle) return <div className="p-4 text-rmpg-400 text-sm">Loading vehicle #{id}…</div>;

  return (
    <div className="h-full flex flex-col">
      <div className="sticky top-0 z-10 bg-surface-base border-b border-rmpg-700 px-4 py-3">
        <Link to="/fleet/v2/vehicles" className="text-xs text-rmpg-400 hover:text-brand-400 inline-flex items-center gap-1 mb-2">
          <ArrowLeft className="w-3 h-3" /> Back to Vehicles
        </Link>
        <div className="flex items-baseline justify-between">
          <div>
            <h1 className="text-lg font-semibold text-rmpg-100">
              {vehicle.vehicle_name ?? vehicle.vehicle_number ?? `Vehicle ${vehicle.id}`}
              <span className="ml-2 text-sm text-rmpg-400">{vehicle.plate_number} ({vehicle.plate_state})</span>
            </h1>
            <div className="text-[11px] text-rmpg-400 mt-0.5">
              {vehicle.year} {vehicle.make} {vehicle.model} · VIN {vehicle.vin ?? '—'} · {(vehicle.current_mileage ?? 0).toLocaleString()} mi
            </div>
          </div>
          <div className="px-2 py-1 text-[10px] rounded-sm bg-rmpg-700 text-rmpg-50">
            {(vehicle.status ?? 'unknown').replace(/_/g, ' ').toUpperCase()}
          </div>
        </div>
        <div role="tablist" aria-label="Vehicle tabs" className="mt-3 flex gap-1 overflow-x-auto">
          {TABS.map((t) => (
            <button
              key={t.id}
              role="tab"
              aria-selected={activeTab === t.id}
              onClick={() => selectTab(t.id)}
              className={`px-3 py-1 text-[11px] whitespace-nowrap rounded-t-sm ${
                activeTab === t.id ? 'bg-rmpg-700 text-rmpg-50' : 'text-rmpg-400 hover:text-rmpg-100'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>
      <div className="flex-1 overflow-y-auto">
        {activeTab === 'overview'    ? <OverviewTab vehicle={vehicle} /> :
         activeTab === 'service'     ? <ServiceTab vehicleId={vehicle.id} /> :
         activeTab === 'inspections' ? <InspectionsTab vehicleId={vehicle.id} /> :
         activeTab === 'fuel'        ? <FuelTab vehicleId={vehicle.id} /> :
         activeTab === 'activity'    ? <ActivityTab vehicleId={vehicle.id} /> :
         activeTab === 'costs'       ? <CostsTab vehicleId={vehicle.id} /> :
         activeTab === 'recalls'     ? <RecallsTab vehicleId={vehicle.id} /> :
         activeTab === 'damage'      ? <DamageTab vehicleId={vehicle.id} /> :
         activeTab === 'tires'       ? <TiresTab vehicleId={vehicle.id} /> :
         activeTab === 'work-orders' ? <WorkOrdersTab vehicleId={vehicle.id} /> :
         activeTab === 'assignments' ? <AssignmentsTab vehicleId={vehicle.id} /> : (
          <div className="p-4">
            <EmptyStateCard
              title={TABS.find((t) => t.id === activeTab)?.label ?? ''}
              plannedPr={
                activeTab === 'issues' ? 'PR 6' :
                'Phase 2'
              }
              description="This tab will land in a future PR of the Fleet Manager UI program."
            />
          </div>
        )}
      </div>
    </div>
  );
}
