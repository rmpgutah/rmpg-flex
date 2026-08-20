import { useRef, useEffect } from 'react';
import { Car } from 'lucide-react';
import FleetAnalyticsTab from '../tabs/FleetAnalyticsTab';
import FleetAnalysisFormsTab from '../tabs/FleetAnalysisFormsTab';
import FleetWorkOrdersTab from '../tabs/FleetWorkOrdersTab';
import FleetVendorsTab from '../tabs/FleetVendorsTab';
import FleetServiceTab from '../tabs/FleetServiceTab';
import FleetDriverPerformanceTab from '../tabs/FleetDriverPerformanceTab';
import MaintenanceMonitor from './MaintenanceMonitor';
import { FLEET_VIEWS, type FleetViewMode } from '../fleetConstants';
import type { FleetVehicle, FleetAnalytics } from '../../../types';

interface Props {
  viewMode: FleetViewMode;
  onViewModeChange: (mode: FleetViewMode) => void;
  onWorkOrdersVehicleFilter: (id: number | null) => void;
  fleetAnalytics: FleetAnalytics | null;
  fleetAnalyticsLoading: boolean;
  onFetchFleetAnalytics: (period?: string) => void;
  vehicles: FleetVehicle[];
  vehicleNumberById: Map<string | number, string>;
  workOrdersVehicleFilter: number | null;
  onSelectVehicle: (id: string | number) => void;
}

export default function FleetDashboardViews({
  viewMode, onViewModeChange, onWorkOrdersVehicleFilter,
  fleetAnalytics, fleetAnalyticsLoading, onFetchFleetAnalytics,
  vehicles, vehicleNumberById, workOrdersVehicleFilter, onSelectVehicle,
}: Props) {
  // Tracks whether the most recent viewMode change was keyboard-driven so the
  // tab receives DOM focus (WAI-ARIA roving tabindex pattern). Click paths
  // already focus their own button via the browser; this only fires for
  // ArrowLeft/Right/Home/End navigation.
  const pendingTabFocusRef = useRef(false);

  useEffect(() => {
    if (!pendingTabFocusRef.current) return;
    pendingTabFocusRef.current = false;
    document.getElementById(`fleet-view-tab-${viewMode}`)?.focus();
  }, [viewMode]);

  return (
    <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
      <div
        className="flex items-center border-b border-rmpg-700 bg-surface-sunken flex-shrink-0"
        role="tablist"
        aria-label="Fleet-wide views"
        onKeyDown={(e) => {
          if (!['ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(e.key)) return;
          e.preventDefault();
          const idx = FLEET_VIEWS.findIndex((v) => v.id === viewMode);
          let next: number;
          if (e.key === 'ArrowRight') next = (idx + 1) % FLEET_VIEWS.length;
          else if (e.key === 'ArrowLeft') next = (idx - 1 + FLEET_VIEWS.length) % FLEET_VIEWS.length;
          else if (e.key === 'Home') next = 0;
          else next = FLEET_VIEWS.length - 1;
          const target = FLEET_VIEWS[next];
          if (target.id === viewMode) return;
          if (target.id === 'work_orders') onWorkOrdersVehicleFilter(null);
          pendingTabFocusRef.current = true;
          onViewModeChange(target.id);
        }}
      >
        {FLEET_VIEWS.map(({ id, label }) => (
          <button
            type="button"
            key={id}
            role="tab"
            id={`fleet-view-tab-${id}`}
            aria-selected={viewMode === id}
            aria-controls="fleet-view-panel"
            tabIndex={viewMode === id ? 0 : -1}
            onClick={() => {
              if (id === 'work_orders') onWorkOrdersVehicleFilter(null);
              onViewModeChange(id);
            }}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider transition-all duration-150 border-b-2 ${
              viewMode === id
                ? 'text-brand-gold-500 border-brand-gold-500 bg-brand-gold-500/5'
                : 'text-fg-muted border-transparent hover:text-rmpg-200 hover:border-rmpg-600'
            }`}
          >
            {label}
          </button>
        ))}
      </div>
      <div
        className="flex-1 min-h-0 overflow-y-auto"
        role="tabpanel"
        id="fleet-view-panel"
        aria-labelledby={`fleet-view-tab-${viewMode}`}
      >
        {viewMode === 'dashboard' ? (
          <>
            <MaintenanceMonitor onSelectVehicle={(id) => onSelectVehicle(id)} />
            {fleetAnalytics ? (
              <div className="px-3 pb-3">
                <FleetAnalyticsTab
                  analytics={fleetAnalytics}
                  loading={fleetAnalyticsLoading}
                  onPeriodChange={(p) => onFetchFleetAnalytics(p)}
                />
              </div>
            ) : (
              <div className="flex items-center justify-center py-8">
                <div className="text-center">
                  <Car className="w-8 h-8 text-rmpg-600 mx-auto mb-2" />
                  <p className="text-xs text-rmpg-500">Select a vehicle to view details</p>
                  <p className="text-[10px] text-rmpg-600 mt-1">{vehicles.length} vehicles in fleet</p>
                </div>
              </div>
            )}
          </>
        ) : viewMode === 'analysis' ? (
          <FleetAnalysisFormsTab vehicles={vehicles} vehicleNumberById={vehicleNumberById} />
        ) : viewMode === 'work_orders' ? (
          <FleetWorkOrdersTab initialVehicleId={workOrdersVehicleFilter ?? undefined} />
        ) : viewMode === 'vendors' ? (
          <FleetVendorsTab />
        ) : viewMode === 'driver_performance' ? (
          <FleetDriverPerformanceTab />
        ) : (
          <FleetServiceTab />
        )}
      </div>
    </div>
  );
}
