import React, { useState, useEffect, useCallback } from 'react';
import { apiFetch } from '../hooks/useApi';
import PanelTitleBar from '../components/PanelTitleBar';
import DataTable from '../components/DataTable';
import StatsCard from '../components/StatsCard';
import { Shield, AlertTriangle as AlertIcon, TrendingDown, CheckCircle, RefreshCw } from 'lucide-react';

export default function RiskPage() {
  const [assessments, setAssessments] = useState<Record<string, unknown>[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState({ totalRisks: 0, highRisks: 0, mitigated: 0 });

  const load = useCallback(() => {
    setLoading(true); setError(null);
    Promise.all([
      apiFetch<{ data: Record<string, unknown>[] }>('/risk/assessments').then(r => setAssessments(r.data || [])),
      apiFetch<{ totalRisks: number; highRisks: number; mitigated: number }>('/risk/stats').then(r => setStats(r)),
    ]).catch(() => setError('Failed to load risk data.')).finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  if (error) return <div className="flex flex-col items-center justify-center py-20 px-4 text-center"><AlertIcon size={28} color="#ef4444" style={{ opacity: 0.5, marginBottom: 12 }} /><p className="text-[10px] text-[#fca5a5] mb-3">{error}</p><button onClick={load} className="btn-gold flex items-center gap-1.5"><RefreshCw size={12} />Retry</button></div>;

  return (
    <div className="p-4 space-y-4">
      <PanelTitleBar title="RISK MANAGEMENT" icon={Shield} />
      {loading ? <div className="space-y-3"><div className="grid grid-cols-3 gap-3">{Array(3).fill(0).map((_,i)=><div key={i} className="h-16 bg-[#0a0a0a] border border-[#1a1a1a] skeleton-block" />)}</div><div className="h-48 bg-[#0a0a0a] border border-[#1a1a1a] skeleton-block" /></div> : <>
        <div className="grid grid-cols-3 gap-3"><StatsCard icon={AlertIcon} label="Total Risks" value={stats.totalRisks} /><StatsCard icon={TrendingDown} label="High Risk" value={stats.highRisks} /><StatsCard icon={CheckCircle} label="Mitigated" value={stats.mitigated} /></div>
        <DataTable columns={[{ key: 'risk_title', label: 'Risk' },{ key: 'category', label: 'Category' },{ key: 'severity', label: 'Severity' },{ key: 'status', label: 'Status' },{ key: 'identified_date', label: 'Identified' }]} data={assessments} emptyMessage="No risk assessments" />
      </>}
    </div>
  );
}
