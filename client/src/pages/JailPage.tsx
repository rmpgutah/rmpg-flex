import React, { useState, useEffect } from 'react';
import { apiFetch } from '../hooks/useApi';
import PanelTitleBar from '../components/PanelTitleBar';
import DataTable from '../components/DataTable';
import StatsCard from '../components/StatsCard';
import { Building2, Users, DoorOpen, ClipboardList } from 'lucide-react';

interface Inmate {
  id: number; booking_number: string; last_name: string; first_name: string;
  status: string; housing_unit: string; booking_date: string; gender: string; dob: string;
}

export default function JailPage() {
  const [inmates, setInmates] = useState<Inmate[]>([]);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({ total: 0, housed: 0, booked: 0 });

  useEffect(() => {
    Promise.all([
      apiFetch<{ data: Inmate[] }>('/jail/inmates').then(r => setInmates(r.data || [])),
      apiFetch<{ total: number; housed: number; booked: number }>('/jail/stats').then(r => setStats(r)),
    ]).catch(console.error).finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="p-6 text-[#888888]">Loading jail records...</div>;

  return (
    <div className="p-4 space-y-4">
      <PanelTitleBar title="JAIL MANAGEMENT" icon={Building2} />
      <div className="grid grid-cols-3 gap-3">
        <StatsCard icon={Users} label="Total Inmates" value={stats.total} />
        <StatsCard icon={DoorOpen} label="Currently Housed" value={stats.housed} />
        <StatsCard icon={ClipboardList} label="Booked (Intake)" value={stats.booked} />
      </div>
      <DataTable
        columns={[
          { key: 'booking_number', label: 'Booking #' },
          { key: 'last_name', label: 'Last Name' },
          { key: 'first_name', label: 'First Name' },
          { key: 'status', label: 'Status' },
          { key: 'housing_unit', label: 'Housing' },
          { key: 'booking_date', label: 'Booking Date' },
        ]}
        data={inmates}
        emptyMessage="No inmates in custody"
      />
    </div>
  );
}
