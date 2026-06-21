import { Link } from 'react-router-dom';
import { KpiRibbon } from '../shell/KpiRibbon';
import { SectionHeader } from '../shell/SectionHeader';
import { useFleetV2View } from '../hooks/useFleetV2Audit';

export function DashboardRoute() {
  useFleetV2View('/fleet/v2');
  return (
    <div className="h-full flex flex-col">
      <SectionHeader title="Dashboard" />
      <KpiRibbon />
      <div className="flex-1 overflow-y-auto p-4 grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card title="Upcoming Service" viewAllTo="/fleet/v2/service">
          <p className="text-sm text-rmpg-400">Service items due in the next 7 days.</p>
        </Card>
        <Card title="Recent Fuel Entries" viewAllTo="/fleet/v2/fuel">
          <p className="text-sm text-rmpg-400">Last 10 fuel logs.</p>
        </Card>
        <Card title="Recent Inspections" viewAllTo="/fleet/v2/inspections">
          <p className="text-sm text-rmpg-400">Last 10 inspections.</p>
        </Card>
      </div>
    </div>
  );
}

function Card({ title, viewAllTo, children }: { title: string; viewAllTo: string; children: React.ReactNode }) {
  return (
    <div className="rounded-sm border border-rmpg-700 bg-surface-raised p-4">
      <div className="flex items-baseline justify-between mb-2">
        <h2 className="text-sm font-semibold text-rmpg-100">{title}</h2>
        <Link to={viewAllTo} className="text-xs text-brand-400 hover:underline">View all →</Link>
      </div>
      {children}
    </div>
  );
}
