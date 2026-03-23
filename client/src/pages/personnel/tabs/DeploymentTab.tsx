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
    <div className="flex-1 overflow-y-auto p-4 space-y-3">
      {/* Coverage Gap Alert */}
      {gapsWithDeficit.length > 0 && (
        <div className="panel-beveled p-3 border border-red-700/40 border-l-2 border-l-red-500 bg-[#1a0a0a]">
          <div className="flex items-center gap-2 mb-2">
            <AlertTriangle className="w-4 h-4 text-red-400" />
            <span className="text-xs font-bold text-red-400 uppercase tracking-wider">Coverage Gaps Detected</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            {gapsWithDeficit.map((gap) => (
              <div
                key={`${gap.property_id}-${gap.shift_type}`}
                className="panel-beveled p-2 flex items-center gap-2 bg-surface-sunken"
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

      {/* Summary Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <div className="panel-beveled p-2.5 text-center bg-surface-base border-t-2 border-t-rmpg-500">
          <p className="text-lg font-bold font-mono text-rmpg-100">{deployments.length}</p>
          <p className="text-[8px] uppercase text-rmpg-400 font-bold tracking-wider">Total Deployments</p>
        </div>
        <div className="panel-beveled p-2.5 text-center bg-[#0a1a0a] border-t-2 border-t-green-500">
          <p className="text-lg font-bold font-mono text-green-400">{activeCount}</p>
          <p className="text-[8px] uppercase text-green-400/70 font-bold tracking-wider">Active</p>
        </div>
        <div className="panel-beveled p-2.5 text-center bg-[#0a0f1a] border-t-2 border-t-blue-500">
          <p className="text-lg font-bold font-mono text-blue-400">{scheduledCount}</p>
          <p className="text-[8px] uppercase text-blue-400/70 font-bold tracking-wider">Scheduled</p>
        </div>
        <div className="panel-beveled p-2.5 text-center bg-[#1a170a] border-t-2 border-t-amber-500">
          <p className="text-lg font-bold font-mono text-amber-400">{unassignedCount}</p>
          <p className="text-[8px] uppercase text-amber-400/70 font-bold tracking-wider">Unassigned Officers</p>
        </div>
      </div>

      {/* Header & Filter */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          {FILTER_BUTTONS.map((btn) => (
            <button type="button"
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
        <button type="button" onClick={onAddDeployment} className="toolbar-btn-primary text-[10px] px-3 py-1 flex items-center gap-1">
          <Plus className="w-3 h-3" />
          Add Deployment
        </button>
      </div>

      {/* Table */}
      {filtered.length === 0 ? (
        <div className="text-center py-12">
          <div className="w-14 h-14 mx-auto mb-3 rounded-full border border-rmpg-700 flex items-center justify-center bg-surface-base">
            <MapPinned className="w-7 h-7 text-rmpg-600" />
          </div>
          <p className="text-xs text-rmpg-500">No deployments found.</p>
          <p className="text-[10px] text-rmpg-600 mt-1">Create a deployment or adjust the filter.</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="table-dark w-full text-[11px]">
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
                <tr key={dep.id} className="border-t border-rmpg-800 hover:bg-rmpg-800/30 transition-colors">
                  <td className="py-1.5 px-2 text-rmpg-100">{dep.officer_name}</td>
                  <td className="py-1.5 px-2 text-rmpg-100 font-medium">{dep.property_name}</td>
                  <td className="py-1.5 px-2 text-rmpg-400">{dep.client_name || '-'}</td>
                  <td className="py-1.5 px-2 text-rmpg-300">{dep.position}</td>
                  <td className="py-1.5 px-2 text-rmpg-300 font-mono text-[10px]">{formatDate(dep.start_date)}</td>
                  <td className="py-1.5 px-2 text-rmpg-300 font-mono text-[10px]">{formatDate(dep.end_date)}</td>
                  <td className="py-1.5 px-2 text-right text-rmpg-200 font-mono">{dep.hours_per_week ?? '-'}</td>
                  <td className="py-1.5 px-2">
                    <span className={`inline-block px-1.5 py-0.5 text-[9px] font-bold uppercase ${
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
  );
}
