// ============================================================
// RMPG Flex — Personnel: Deployment Management Tab
// ============================================================

import React, { useState, useMemo } from 'react';
import {
  MapPinned, Plus, AlertTriangle, Users, Calendar, CheckCircle,
  Loader2,
} from 'lucide-react';
import type { Deployment, CoverageGap, DeploymentStatus } from '../../../types';
import type { OfficerWithStatus } from '../utils/personnelMappers';
import { DEPLOYMENT_STATUS_COLORS } from '../utils/personnelConstants';
import { toDisplayLabel } from '../../../utils/formatters';

type StatusFilter = 'all' | DeploymentStatus;

interface Props {
  deployments: Deployment[];
  coverageGaps: CoverageGap[];
  officers: OfficerWithStatus[];
  loading: boolean;
  onAddDeployment: () => void;
}

export default function DeploymentTab({ deployments, coverageGaps, officers, loading, onAddDeployment }: Props) {
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');

  const filtered = useMemo(() => {
    if (statusFilter === 'all') return deployments;
    return deployments.filter((d) => d.status === statusFilter);
  }, [deployments, statusFilter]);

  const activeCount = deployments.filter((d) => d.status === 'active').length;
  const scheduledCount = deployments.filter((d) => d.status === 'scheduled').length;
  const completedCount = deployments.filter((d) => d.status === 'completed').length;

  // Unassigned = officers not in any active deployment
  const activeOfficerIds = useMemo(() => {
    const ids = new Set<string>();
    for (const d of deployments) {
      if (d.status === 'active') ids.add(d.officer_id);
    }
    return ids;
  }, [deployments]);

  const unassignedCount = officers.filter((o) => o.is_active && !activeOfficerIds.has(o.id)).length;

  const gapsWithDeficit = coverageGaps.filter((g) => g.gap > 0);

  const formatDate = (d?: string) => {
    if (!d) return '-';
    return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };

  const FILTER_BUTTONS: { value: StatusFilter; label: string }[] = [
    { value: 'all', label: 'All' },
    { value: 'active', label: 'Active' },
    { value: 'scheduled', label: 'Scheduled' },
    { value: 'completed', label: 'Completed' },
    { value: 'cancelled', label: 'Cancelled' },
  ];

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center py-20">
        <Loader2 className="w-5 h-5 text-brand-400 animate-spin" />
        <span className="ml-2 text-xs text-rmpg-400">Loading deployments...</span>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
      {/* Fixed Header */}
      <div className="flex-shrink-0 px-4 py-2.5 border-b border-rmpg-600" style={{ background: 'linear-gradient(180deg, var(--surface-raised) 0%, var(--surface-base) 100%)' }}>
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5">
              <MapPinned className="w-3.5 h-3.5 text-brand-400" />
              <span className="text-xs font-bold text-rmpg-200 uppercase tracking-wider">Deployments</span>
            </div>
            <div className="panel-inset flex items-center gap-0.5 px-1 py-0.5">
              {FILTER_BUTTONS.map((btn) => (
                <button
                  key={btn.value}
                  onClick={() => setStatusFilter(btn.value)}
                  className={`text-[10px] px-2.5 py-1 ${
                    statusFilter === btn.value ? 'toolbar-btn-primary' : 'toolbar-btn'
                  }`}
                >
                  {btn.label}
                </button>
              ))}
            </div>
          </div>
          <button
            onClick={onAddDeployment}
            className="toolbar-btn-primary text-[10px] px-3 py-1 flex items-center gap-1"
          >
            <Plus className="w-3 h-3" />
            Add Deployment
          </button>
        </div>
      </div>
      {/* Scrollable Content */}
      <div className="flex-1 overflow-y-auto min-h-0 p-4 space-y-3">

      {/* ── Coverage Gap Alert ── */}
      {gapsWithDeficit.length > 0 && (
        <div className="alert-banner alert-banner-warning" style={{ '--alert-color': '#f59e0b', animationDuration: '2s' } as React.CSSProperties}>
          <div className="flex items-center gap-2 mb-2">
            <AlertTriangle className="w-4 h-4 text-red-400 animate-pulse" />
            <span className="text-xs font-bold text-red-400 uppercase tracking-wider">
              Coverage Gaps Detected
            </span>
            <span className="text-[9px] text-red-500/70 font-mono ml-auto">
              {gapsWithDeficit.length} gap{gapsWithDeficit.length !== 1 ? 's' : ''}
            </span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            {gapsWithDeficit.map((gap) => (
              <div
                key={`${gap.property_id}-${gap.shift_type}`}
                className="gap-indicator panel-beveled p-2 flex items-center gap-2 bg-surface-sunken"
              >
                <span className={gap.gap > 0 ? 'led-dot led-red' : 'led-dot led-off'} />
                <div className="flex-1 min-w-0">
                  <p className="text-[10px] text-rmpg-100 font-semibold truncate">{gap.property_name}</p>
                  <p className="text-[9px] text-rmpg-400 font-mono">
                    {gap.assigned_officers}/{gap.required_officers} assigned
                    <span className="text-red-400 ml-1">(-{gap.gap})</span>
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Summary Cards ── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <div
          className="stat-pod summary-card-shimmer cascade-item"
          style={{ '--pod-glow': 'rgba(255,255,255,0.06)' } as React.CSSProperties}
        >
          <p className="stat-value text-lg font-bold font-mono text-rmpg-100">{deployments.length}</p>
          <p className="stat-label text-[8px] uppercase text-rmpg-400 font-bold tracking-wider">Total Deployments</p>
        </div>
        <div
          className="stat-pod summary-card-shimmer cascade-item"
          style={{ '--pod-glow': 'rgba(34,197,94,0.12)' } as React.CSSProperties}
        >
          <p className="stat-value text-lg font-bold font-mono text-green-400">{activeCount}</p>
          <p className="stat-label text-[8px] uppercase text-green-400/70 font-bold tracking-wider">Active</p>
        </div>
        <div
          className="stat-pod summary-card-shimmer cascade-item"
          style={{ '--pod-glow': 'rgba(59,130,246,0.12)' } as React.CSSProperties}
        >
          <p className="stat-value text-lg font-bold font-mono text-blue-400">{scheduledCount}</p>
          <p className="stat-label text-[8px] uppercase text-blue-400/70 font-bold tracking-wider">Scheduled</p>
        </div>
        <div
          className="stat-pod summary-card-shimmer cascade-item"
          style={{ '--pod-glow': 'rgba(245,158,11,0.12)' } as React.CSSProperties}
        >
          <p className="stat-value text-lg font-bold font-mono text-amber-400">{unassignedCount}</p>
          <p className="stat-label text-[8px] uppercase text-amber-400/70 font-bold tracking-wider">Unassigned Officers</p>
        </div>
      </div>

      {/* ── Deployment Table ── */}
      {filtered.length === 0 ? (
        <div className="empty-state-container text-center py-16">
          <div className="empty-state-icon mx-auto mb-3">
            <MapPinned className="w-7 h-7 text-rmpg-600" />
          </div>
          <p className="text-xs text-rmpg-400">No deployments found</p>
          <p className="text-[10px] text-rmpg-600 mt-1">Create a deployment or adjust the filter above.</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="personnel-table w-full text-[11px]">
            <thead className="sticky top-0 z-10">
              <tr>
                <th className="text-left py-1.5 px-2">Officer</th>
                <th className="text-left py-1.5 px-2">Property</th>
                <th className="text-left py-1.5 px-2">Client</th>
                <th className="text-left py-1.5 px-2">Position</th>
                <th className="text-left py-1.5 px-2">Start Date</th>
                <th className="text-left py-1.5 px-2">End Date</th>
                <th className="text-right py-1.5 px-2">Hrs/Wk</th>
                <th className="text-left py-1.5 px-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((dep) => (
                <tr
                  key={dep.id}
                  className="border-t border-rmpg-800 hover:bg-brand-500/5 hover:border-l-2 hover:border-l-brand-500 transition-colors"
                >
                  <td className="py-1.5 px-2 text-rmpg-100 font-semibold">{dep.officer_name}</td>
                  <td className="py-1.5 px-2 text-rmpg-100 font-bold">{dep.property_name}</td>
                  <td className="py-1.5 px-2 text-rmpg-400">{dep.client_name || '-'}</td>
                  <td className="py-1.5 px-2 text-rmpg-300">{dep.position}</td>
                  <td className="py-1.5 px-2 text-rmpg-300 font-mono text-[10px]">{formatDate(dep.start_date)}</td>
                  <td className="py-1.5 px-2 text-rmpg-300 font-mono text-[10px]">{formatDate(dep.end_date)}</td>
                  <td className="py-1.5 px-2 text-right text-rmpg-200 font-mono">{dep.hours_per_week ?? '-'}</td>
                  <td className="py-1.5 px-2">
                    <span className={`badge-pill inline-block px-1.5 py-0.5 text-[9px] font-bold uppercase ${
                      DEPLOYMENT_STATUS_COLORS[dep.status] || DEPLOYMENT_STATUS_COLORS.active
                    }`}>
                      {toDisplayLabel(dep.status)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      </div>
    </div>
  );
}
