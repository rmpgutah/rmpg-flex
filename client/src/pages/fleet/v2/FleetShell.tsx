import { useState } from 'react';
import { Routes, Route } from 'react-router-dom';
import { Menu } from 'lucide-react';
import { useIsMobile } from '../../../hooks/useIsMobile';
import { useNoindexDuringSoak } from './hooks/useNoindexDuringSoak';
import { Sidebar, SIDEBAR_SECTIONS } from './Sidebar';
import { DashboardRoute } from './routes/DashboardRoute';
import { VehiclesListRoute } from './routes/VehiclesListRoute';
import { VehicleDetailRoute } from './routes/VehicleDetailRoute';
import { FuelEntriesRoute } from './routes/FuelEntriesRoute';
import { ServiceRoute } from './routes/ServiceRoute';
import { InspectionsRoute } from './routes/InspectionsRoute';
import { VendorsRoute } from './routes/VendorsRoute';
import { PersonnelRoute } from './routes/PersonnelRoute';
import { DashCamerasRoute } from './routes/DashCamerasRoute';
import { GpsTrackingRoute } from './routes/GpsTrackingRoute';
import { AnalysisFormsRoute } from './routes/AnalysisFormsRoute';
import { ReportsRoute } from './routes/ReportsRoute';
import { InsightsRoute } from './routes/InsightsRoute';
import { EmptyStateCard } from './shell/EmptyStateCard';

export default function FleetShell() {
  useNoindexDuringSoak();
  const isMobile = useIsMobile();
  const [drawerOpen, setDrawerOpen] = useState(false);

  function emptyFor(id: string) {
    if (id === 'work-orders') return { plannedPr: 'PR 5', description: 'Vehicle in-shop tracking.' };
    if (id === 'issues') return { plannedPr: 'PR 6', description: 'Tracked findings and their resolution.' };
    if (id === 'documents') return { plannedPr: 'Phase 2', description: 'Per-vehicle uploaded documents.' };
    if (id === 'parts') return { plannedPr: 'Phase 2', description: 'Parts catalog and inventory.' };
    return { plannedPr: "PR 7'b", description: 'Built in the next PR of the Fleet Manager UI program.' };
  }

  return (
    <div className="flex h-full bg-surface-base">
      {isMobile ? (
        <>
          <button
            onClick={() => setDrawerOpen((v) => !v)}
            aria-label="Open menu"
            className="fixed top-2 left-2 z-50 p-2 rounded-sm bg-surface-raised border border-rmpg-700"
          >
            <Menu className="w-4 h-4" />
          </button>
          {drawerOpen ? (
            <div className="fixed inset-0 z-40 bg-black/50" onClick={() => setDrawerOpen(false)}>
              <Sidebar />
            </div>
          ) : null}
        </>
      ) : (
        <Sidebar />
      )}
      <main className="flex-1 overflow-hidden">
        <Routes>
          <Route index element={<DashboardRoute />} />
          <Route path="vehicles" element={<VehiclesListRoute />} />
          <Route path="vehicles/:id/*" element={<VehicleDetailRoute />} />
          <Route path="fuel" element={<FuelEntriesRoute />} />
          <Route path="service" element={<ServiceRoute />} />
          <Route path="inspections" element={<InspectionsRoute />} />
          <Route path="vendors" element={<VendorsRoute />} />
          <Route path="personnel" element={<PersonnelRoute />} />
          <Route path="dash-cameras" element={<DashCamerasRoute />} />
          <Route path="gps" element={<GpsTrackingRoute />} />
          <Route path="analysis" element={<AnalysisFormsRoute />} />
          <Route path="reports" element={<ReportsRoute />} />
          <Route path="insights" element={<InsightsRoute />} />
          {SIDEBAR_SECTIONS
            .filter((s) => !['dashboard', 'vehicles', 'fuel', 'service', 'inspections', 'vendors', 'personnel', 'dash-cameras', 'gps', 'analysis', 'reports', 'insights'].includes(s.id))
            .map((s) => {
              const sub = s.path.replace(/^\/fleet\/v2\/?/, '') || '';
              const e = emptyFor(s.id);
              return (
                <Route
                  key={s.id}
                  path={sub}
                  element={
                    <div className="p-4">
                      <EmptyStateCard
                        title={s.label}
                        plannedPr={e.plannedPr}
                        description={e.description}
                        fleetioUrl={s.fleetioUrl}
                      />
                    </div>
                  }
                />
              );
            })}
        </Routes>
      </main>
    </div>
  );
}
