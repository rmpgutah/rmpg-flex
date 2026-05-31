import React, { useState, useEffect, useCallback } from 'react';
import { apiFetch } from '../hooks/useApi';
import PanelTitleBar from '../components/PanelTitleBar';
import DataTable from '../components/DataTable';
import StatsCard from '../components/StatsCard';
import { Megaphone, FileText, Send, CheckCircle, AlertTriangle, RefreshCw } from 'lucide-react';

export default function AlertsPage() {
  const [templates, setTemplates] = useState<Record<string, unknown>[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState({ templates: 0, batches: 0, sent_batches: 0 });

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    Promise.all([
      apiFetch<{ data: Record<string, unknown>[] }>('/alerts/templates').then(r => setTemplates(r.data || [])),
      apiFetch<{ templates: number; batches: number; sent_batches: number }>('/alerts/stats').then(r => setStats(r)),
    ]).catch(_err => setError('Failed to load notification data.')).finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  if (error) return (
    <div className="flex flex-col items-center justify-center py-20 px-4 text-center">
      <AlertTriangle size={28} color="#ef4444" style={{ opacity: 0.5, marginBottom: 12 }} />
      <p className="text-[10px] text-[#fca5a5] mb-3">{error}</p>
      <button onClick={load} className="btn-gold flex items-center gap-1.5"><RefreshCw size={12} />Retry</button>
    </div>
  );

  return (
    <div className="p-4 space-y-4">
      <PanelTitleBar title="MASS NOTIFICATION" icon={Megaphone} />
      {loading ? (
        <div className="space-y-3">
          <div className="grid grid-cols-3 gap-3">{Array(3).fill(0).map((_,i)=><div key={i} className="h-16 bg-[#0a0a0a] border border-[#1a1a1a] skeleton-block" />)}</div>
          <div className="h-48 bg-[#0a0a0a] border border-[#1a1a1a] skeleton-block" />
        </div>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-3">
            <StatsCard icon={FileText} label="Templates" value={stats.templates} />
            <StatsCard icon={Send} label="Batches" value={stats.batches} />
            <StatsCard icon={CheckCircle} label="Sent" value={stats.sent_batches} />
          </div>
          <DataTable
            columns={[{ key: 'template_name', label: 'Template' },{ key: 'subject', label: 'Subject' },{ key: 'channel', label: 'Channel' },{ key: 'category', label: 'Category' },{ key: 'created_at', label: 'Created' }]}
            data={templates}
            emptyMessage="No notification templates"
          />
        </>
      )}
    </div>
  );
}
