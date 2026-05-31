import React, { useState, useEffect } from 'react';
import { apiFetch } from '../hooks/useApi';
import PanelTitleBar from '../components/PanelTitleBar';
import DataTable from '../components/DataTable';
import StatsCard from '../components/StatsCard';
import { Users } from 'lucide-react';

export default function CommunityPage() {
  const [events, setEvents] = useState<Record<string, unknown>[]>([]);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({ events: 0, tips: 0, watch_groups: 0, alerts: 0 });

  useEffect(() => {
    Promise.all([
      apiFetch<{ data: Record<string, unknown>[] }>('/community/events').then(r => setEvents(r.data || [])),
      apiFetch<{ events: number; tips: number; watch_groups: number; alerts: number }>('/community/stats').then(r => setStats(r)),
    ]).catch(console.error).finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="p-6 text-[#888888]">Loading community records...</div>;

  return (
    <div className="p-4 space-y-4">
      <PanelTitleBar title="COMMUNITY ENGAGEMENT" icon={Users} />
      <div className="grid grid-cols-4 gap-3">
        <StatsCard label="Events" value={stats.events} />
        <StatsCard label="Public Tips" value={stats.tips} />
        <StatsCard label="Watch Groups" value={stats.watch_groups} />
        <StatsCard label="Alerts Sent" value={stats.alerts} />
      </div>
      <DataTable
        columns={[
          { key: 'event_name', label: 'Event' },
          { key: 'event_type', label: 'Type' },
          { key: 'location', label: 'Location' },
          { key: 'start_date', label: 'Date' },
          { key: 'status', label: 'Status' },
        ]}
        rows={events}
        emptyText="No community events found"
      />
    </div>
  );
}
