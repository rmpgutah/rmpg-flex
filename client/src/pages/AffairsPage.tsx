import React, { useState, useEffect } from 'react';
import { apiFetch } from '../hooks/useApi';
import PanelTitleBar from '../components/PanelTitleBar';
import DataTable from '../components/DataTable';
import StatsCard from '../components/StatsCard';
import { ShieldAlert, FileText, Clock, Flag } from 'lucide-react';

interface Complaint {
  id: number; complaint_number: string; complainant_name: string;
  complaint_type: string; status: string; subject_officer_name: string; created_at: string;
}

export default function AffairsPage() {
  const [complaints, setComplaints] = useState<Complaint[]>([]);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({ total_complaints: 0, open_complaints: 0, unresolved_flags: 0 });

  useEffect(() => {
    Promise.all([
      apiFetch<{ data: Complaint[] }>('/affairs/complaints').then(r => setComplaints(r.data || [])),
      apiFetch<{ total_complaints: number; open_complaints: number; unresolved_flags: number }>('/affairs/stats').then(r => setStats(r)),
    ]).catch(console.error).finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="p-6 text-[#888888]">Loading internal affairs records...</div>;

  return (
    <div className="p-4 space-y-4">
      <PanelTitleBar title="INTERNAL AFFAIRS" icon={ShieldAlert} />
      <div className="grid grid-cols-3 gap-3">
        <StatsCard icon={FileText} label="Total Complaints" value={stats.total_complaints} />
        <StatsCard icon={Clock} label="Open Complaints" value={stats.open_complaints} />
        <StatsCard icon={Flag} label="Active Flags" value={stats.unresolved_flags} />
      </div>
      <DataTable
        columns={[
          { key: 'complaint_number', label: 'Case #' },
          { key: 'complainant_name', label: 'Complainant' },
          { key: 'complaint_type', label: 'Type' },
          { key: 'subject_officer_name', label: 'Subject Officer' },
          { key: 'status', label: 'Status' },
          { key: 'created_at', label: 'Filed' },
        ]}
        data={complaints}
        emptyMessage="No complaints found"
      />
    </div>
  );
}
