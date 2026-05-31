import React, { useState, useEffect } from 'react';
import { apiFetch } from '../hooks/useApi';
import PanelTitleBar from '../components/PanelTitleBar';
import DataTable from '../components/DataTable';
import StatsCard from '../components/StatsCard';
import { Share2, Building2, FileText, ArrowRightLeft } from 'lucide-react';

export default function InteragencyPage() {
  const [partners, setPartners] = useState<Record<string, unknown>[]>([]);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({ partners: 0, active_agreements: 0, total_exchanges: 0 });

  useEffect(() => {
    Promise.all([
      apiFetch<{ data: Record<string, unknown>[] }>('/interagency/partners').then(r => setPartners(r.data || [])),
      apiFetch<{ partners: number; active_agreements: number; total_exchanges: number }>('/interagency/stats').then(r => setStats(r)),
    ]).catch(console.error).finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="p-6 text-[#888888]">Loading interagency records...</div>;

  return (
    <div className="p-4 space-y-4">
      <PanelTitleBar title="INTERAGENCY DATA SHARING" icon={Share2} />
      <div className="grid grid-cols-3 gap-3">
        <StatsCard icon={Building2} label="Partner Agencies" value={stats.partners} />
        <StatsCard icon={FileText} label="Active Agreements" value={stats.active_agreements} />
        <StatsCard icon={ArrowRightLeft} label="Data Exchanges" value={stats.total_exchanges} />
      </div>
      <DataTable
        columns={[
          { key: 'agency_name', label: 'Agency' },
          { key: 'agency_type', label: 'Type' },
          { key: 'jurisdiction', label: 'Jurisdiction' },
          { key: 'data_share_level', label: 'Share Level' },
          { key: 'status', label: 'Status' },
        ]}
        data={partners}
        emptyMessage="No interagency partners found"
      />
    </div>
  );
}
