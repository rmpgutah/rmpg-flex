import React, { useState, useEffect, useCallback } from 'react';
import { apiFetch } from '../hooks/useApi';
import PanelTitleBar from '../components/PanelTitleBar';
import DataTable from '../components/DataTable';
import StatsCard from '../components/StatsCard';
import { DollarSign, FileText, Clock, CheckCircle, AlertTriangle, RefreshCw } from 'lucide-react';

export default function BillingPage() {
  const [invoices, setInvoices] = useState<Record<string, unknown>[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState({ totalInvoices: 0, unpaid: 0, revenueThisMonth: 0 });

  const load = useCallback(() => {
    setLoading(true); setError(null);
    Promise.all([
      apiFetch<{ data: Record<string, unknown>[] }>('/billing/invoices').then(r => setInvoices(r.data || [])),
      apiFetch<{ totalInvoices: number; unpaid: number; revenueThisMonth: number }>('/billing/stats').then(r => setStats(r)),
    ]).catch(() => setError('Failed to load billing data.')).finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  if (error) return <div className="flex flex-col items-center justify-center py-20 px-4 text-center"><AlertTriangle size={28} color="#ef4444" style={{ opacity: 0.5, marginBottom: 12 }} /><p className="text-[10px] text-[#fca5a5] mb-3">{error}</p><button onClick={load} className="btn-gold flex items-center gap-1.5"><RefreshCw size={12} />Retry</button></div>;

  return (
    <div className="p-4 space-y-4">
      <PanelTitleBar title="BILLING" icon={DollarSign} />
      {loading ? <div className="space-y-3"><div className="grid grid-cols-3 gap-3">{Array(3).fill(0).map((_,i)=><div key={i} className="h-16 bg-[#0a0a0a] border border-[#1a1a1a] skeleton-block" />)}</div><div className="h-48 bg-[#0a0a0a] border border-[#1a1a1a] skeleton-block" /></div> : <>
        <div className="grid grid-cols-3 gap-3"><StatsCard icon={FileText} label="Invoices" value={stats.totalInvoices} /><StatsCard icon={Clock} label="Unpaid" value={stats.unpaid} /><StatsCard icon={CheckCircle} label="Revenue (MTD)" value={`$${(stats.revenueThisMonth || 0).toLocaleString()}`} /></div>
        <DataTable columns={[{ key: 'invoice_number', label: 'Invoice #' },{ key: 'client_name', label: 'Client' },{ key: 'amount', label: 'Amount' },{ key: 'status', label: 'Status' },{ key: 'due_date', label: 'Due' }]} data={invoices} emptyMessage="No invoices" />
      </>}
    </div>
  );
}
