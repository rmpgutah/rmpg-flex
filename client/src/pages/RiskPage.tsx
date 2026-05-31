import React, { useState, useEffect } from 'react';
import { apiFetch } from '../hooks/useApi';
import PanelTitleBar from '../components/PanelTitleBar';
import DataTable from '../components/DataTable';
import StatsCard from '../components/StatsCard';
import { Shield, AlertTriangle, ClipboardCheck, FileText } from 'lucide-react';

export default function RiskPage() {
  const [assessments, setAssessments] = useState<Record<string, unknown>[]>([]);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({ active_assessments: 0, pending_inspections: 0, open_claims: 0 });

  useEffect(() => {
    Promise.all([
      apiFetch<{ data: Record<string, unknown>[] }>('/risk/assessments').then(r => setAssessments(r.data || [])),
      apiFetch<{ active_assessments: number; pending_inspections: number; open_claims: number }>('/risk/stats').then(r => setStats(r)),
    ]).catch(console.error).finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="p-6 text-[#888888]">Loading risk records...</div>;

  return (
    <div className="p-4 space-y-4">
      <PanelTitleBar title="RISK MANAGEMENT" icon={Shield} />
      <div className="grid grid-cols-3 gap-3">
        <StatsCard icon={AlertTriangle} label="Active Assessments" value={stats.active_assessments} />
        <StatsCard icon={ClipboardCheck} label="Pending Inspections" value={stats.pending_inspections} />
        <StatsCard icon={FileText} label="Open Claims" value={stats.open_claims} />
      </div>
      <DataTable
        columns={[
          { key: 'assessment_number', label: 'Assessment #' },
          { key: 'entity_type', label: 'Entity' },
          { key: 'risk_level', label: 'Risk Level' },
          { key: 'risk_category', label: 'Category' },
          { key: 'assessed_date', label: 'Date' },
          { key: 'status', label: 'Status' },
        ]}
        data={assessments}
        emptyMessage="No risk assessments found"
      />
    </div>
  );
}
