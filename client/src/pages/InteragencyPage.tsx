import React, { useState, useEffect, useCallback } from 'react';
import { apiFetch } from '../hooks/useApi';
import PanelTitleBar from '../components/PanelTitleBar';
import DataTable from '../components/DataTable';
import StatsCard from '../components/StatsCard';
import { Globe, Users, FileText, CheckCircle, AlertTriangle, RefreshCw } from 'lucide-react';

export default function InteragencyPage() {
  const [partners, setPartners] = useState<Record<string, unknown>[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState({ totalPartners: 0, activeMOUs: 0, pendingRequests: 0 });

  const load = useCallback(() => {
    setLoading(true); setError(null);
    Promise.all([
      apiFetch<{ data: Record<string, unknown>[] }>('/interagency/partners').then(r => setPartners(r.data || [])),
      apiFetch<{ totalPartners: number; activeMOUs: number; pendingRequests: number }>('/interagency/stats').then(r => setStats(r)),
    ]).catch(() => setError('Failed to load interagency data.')).finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  if (error) return <div className="flex flex-col items-center justify-center py-20 px-4 text-center"><AlertTriangle size={28} color="#ef4444" style={{ opacity: 0.5, marginBottom: 12 }} /><p className="text-[10px] text-[#fca5a5] mb-3">{error}</p><button onClick={load} className="btn-gold flex items-center gap-1.5"><RefreshCw size={12} />Retry</button></div>;

  return (
    <div className="p-4 space-y-4">
      <PanelTitleBar title="INTERAGENCY" icon={Globe} />
      {loading ? <div className="space-y-3"><div className="grid grid-cols-3 gap-3">{Array(3).fill(0).map((_,i)=><div key={i} className="h-16 bg-[#0a0a0a] border border-[#1a1a1a] skeleton-block" />)}</div><div className="h-48 bg-[#0a0a0a] border border-[#1a1a1a] skeleton-block" /></div> : <>
        <div className="grid grid-cols-3 gap-3"><StatsCard icon={Users} label="Partners" value={stats.totalPartners} /><StatsCard icon={FileText} label="Active MOUs" value={stats.activeMOUs} /><StatsCard icon={CheckCircle} label="Pending" value={stats.pendingRequests} /></div>
        <DataTable columns={[{ key: 'agency_name', label: 'Agency' },{ key: 'agency_type', label: 'Type' },{ key: 'jurisdiction', label: 'Jurisdiction' },{ key: 'mou_status', label: 'MOU' },{ key: 'contact_name', label: 'Contact' }]} data={partners} emptyMessage="No interagency partners" />
      </>}
    </div>
  );
}
