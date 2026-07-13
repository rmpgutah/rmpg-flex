import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { KpiRibbon } from '../shell/KpiRibbon';
import { SectionHeader } from '../shell/SectionHeader';
import { useFleetV2View } from '../hooks/useFleetV2Audit';
import { apiFetchV2 } from '../hooks/apiFetchV2';

interface AnalyticsResp {
  fleet_summary?: {
    vehicles_needing_service?: number;
    inspections_failing?: number;
  };
  fuel_summary?: {
    total_entries?: number;
  };
}

interface OverdueAlert { id: number }

export function DashboardRoute() {
  useFleetV2View('/fleet/v2');
  // The cards used to display literal text ("Service items due in next 7
  // days.") with no API call backing it — rendered-but-never-fetched.
  // Page-24 audit wires real counts so the dashboard isn't lying. Each
  // cell degrades to '—' on fetch failure rather than blocking render,
  // matching how KpiRibbon handles partial outages.
  const [analytics, setAnalytics] = useState<AnalyticsResp | null>(null);
  const [overdueCount, setOverdueCount] = useState<number | null>(null);
  // Tracks whether the initial fetch has settled at all, independent of
  // whether individual fields came back populated — without this, a field
  // that's legitimately absent from the response (rather than "not yet
  // fetched") reads as `undefined` forever and the card shows "Loading…"
  // indefinitely instead of falling back to its empty state.
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    // directWorker: true — the rmpgutah.us proxy dispatcher (rmpg-api-proxy)
    // has served stale/empty payloads for this endpoint (verified live: proxy
    // GET returned {fleet_summary:{total_vehicles:0}} with no fuel_summary/
    // cost_per_mile_ranking, while api.rmpgutah.us directly returned the real
    // data), so every card here silently read as empty. Same workaround
    // pattern as the POST /records/businesses dispatcher bug documented in
    // useApi.ts.
    Promise.allSettled([
      apiFetchV2<AnalyticsResp>('/fleet/analytics?period=90d', { directWorker: true }),
      apiFetchV2<OverdueAlert[]>('/fleet/overdue-inspections', { directWorker: true }),
    ]).then(([a, o]) => {
      if (cancelled) return;
      if (a.status === 'fulfilled') setAnalytics(a.value);
      if (o.status === 'fulfilled' && Array.isArray(o.value)) setOverdueCount(o.value.length);
      setLoaded(true);
    });
    return () => { cancelled = true; };
  }, []);

  const needsService = loaded ? (analytics?.fleet_summary?.vehicles_needing_service ?? 0) : undefined;
  const failingInspections = loaded ? (analytics?.fleet_summary?.inspections_failing ?? 0) : undefined;
  const fuelEntries = loaded ? (analytics?.fuel_summary?.total_entries ?? 0) : undefined;

  return (
    <div className="h-full flex flex-col">
      <SectionHeader title="Dashboard" />
      <KpiRibbon />
      <div className="flex-1 overflow-y-auto p-4 grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card title="Upcoming Service" viewAllTo="/fleet/v2/service">
          <Stat
            count={needsService}
            label="vehicles need service"
            empty="No vehicles flagged for service."
          />
        </Card>
        <Card title="Recent Fuel Entries" viewAllTo="/fleet/v2/fuel">
          <Stat
            count={fuelEntries}
            label="entries in last 90 days"
            empty="No fuel entries yet."
          />
        </Card>
        <Card title="Inspection Issues" viewAllTo="/fleet/v2/inspections">
          <Stat
            count={(overdueCount ?? 0) + (failingInspections ?? 0)}
            label={`${overdueCount ?? '—'} overdue · ${failingInspections ?? '—'} failing`}
            empty="No inspection issues."
          />
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

function Stat({ count, label, empty }: { count: number | null | undefined; label: string; empty: string }) {
  if (count == null) return <p className="text-sm text-rmpg-400">Loading…</p>;
  if (count === 0) return <p className="text-sm text-rmpg-400">{empty}</p>;
  return (
    <div>
      <div className="text-2xl font-semibold text-rmpg-100">{count.toLocaleString()}</div>
      <div className="text-xs text-rmpg-400 mt-1">{label}</div>
    </div>
  );
}
