import React, { useState, useEffect } from 'react';
import { apiFetch } from '../hooks/useApi';
import PanelTitleBar from '../components/PanelTitleBar';
import DataTable from '../components/DataTable';
import StatsCard from '../components/StatsCard';
import { Megaphone, FileText, Send, CheckCircle } from 'lucide-react';

export default function AlertsPage() {
  const [templates, setTemplates] = useState<Record<string, unknown>[]>([]);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({ templates: 0, batches: 0, sent_batches: 0 });

  useEffect(() => {
    Promise.all([
      apiFetch<{ data: Record<string, unknown>[] }>('/alerts/templates').then(r => setTemplates(r.data || [])),
      apiFetch<{ templates: number; batches: number; sent_batches: number }>('/alerts/stats').then(r => setStats(r)),
    ]).catch(console.error).finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="p-6 text-[#888888]">Loading notification system...</div>;

  return (
    <div className="p-4 space-y-4">
      <PanelTitleBar title="MASS NOTIFICATION" icon={Megaphone} />
      <div className="grid grid-cols-3 gap-3">
        <StatsCard icon={FileText} label="Templates" value={stats.templates} />
        <StatsCard icon={Send} label="Batches" value={stats.batches} />
        <StatsCard icon={CheckCircle} label="Sent" value={stats.sent_batches} />
      </div>
      <DataTable
        columns={[
          { key: 'template_name', label: 'Template' },
          { key: 'subject', label: 'Subject' },
          { key: 'channel', label: 'Channel' },
          { key: 'category', label: 'Category' },
          { key: 'created_at', label: 'Created' },
        ]}
        data={templates}
        emptyMessage="No notification templates"
      />
    </div>
  );
}
