import React, { useState, useEffect } from 'react';
import { apiFetch } from '../hooks/useApi';
import PanelTitleBar from '../components/PanelTitleBar';
import DataTable from '../components/DataTable';
import StatsCard from '../components/StatsCard';
import { DollarSign, FileText, Clock, Receipt } from 'lucide-react';

export default function BillingPage() {
  const [invoices, setInvoices] = useState<Record<string, unknown>[]>([]);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({ active_contracts: 0, outstanding_invoices: 0, total_outstanding_amount: 0, pending_expenses: 0 });

  useEffect(() => {
    Promise.all([
      apiFetch<{ data: Record<string, unknown>[] }>('/billing/invoices').then(r => setInvoices(r.data || [])),
      apiFetch<{ active_contracts: number; outstanding_invoices: number; total_outstanding_amount: number; pending_expenses: number }>('/billing/stats').then(r => setStats(r)),
    ]).catch(console.error).finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="p-6 text-[#888888]">Loading billing records...</div>;

  return (
    <div className="p-4 space-y-4">
      <PanelTitleBar title="BILLING & FINANCIAL" icon={DollarSign} />
      <div className="grid grid-cols-4 gap-3">
        <StatsCard icon={FileText} label="Active Contracts" value={stats.active_contracts} />
        <StatsCard icon={Clock} label="Outstanding" value={stats.outstanding_invoices} />
        <StatsCard icon={DollarSign} label="Total Owed" value={`$${(stats.total_outstanding_amount || 0).toLocaleString()}`} />
        <StatsCard icon={Receipt} label="Pending Expenses" value={stats.pending_expenses} />
      </div>
      <DataTable
        columns={[
          { key: 'invoice_number', label: 'Invoice #' },
          { key: 'client_name', label: 'Client' },
          { key: 'total_amount', label: 'Total' },
          { key: 'paid_amount', label: 'Paid' },
          { key: 'status', label: 'Status' },
          { key: 'issue_date', label: 'Issued' },
        ]}
        data={invoices}
        emptyMessage="No invoices found"
      />
    </div>
  );
}
