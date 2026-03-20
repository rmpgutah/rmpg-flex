// ============================================================
// RMPG Flex — Officer Detail: Deployment History Tab
// ============================================================

import React, { useMemo } from 'react';
import {
  MapPinned, Plus, Calendar, Clock, Briefcase, Building2,
  Loader2,
} from 'lucide-react';
import type { Deployment } from '../../../types';
import { DEPLOYMENT_STATUS_COLORS } from '../utils/personnelConstants';
import { toDisplayLabel } from '../../../utils/formatters';

interface Props {
  deployments: Deployment[];
  loading: boolean;
  onAddDeployment: (officerId: string) => void;
  officerId: string;
}

export default function DeploymentDetailTab({ deployments, loading, onAddDeployment, officerId }: Props) {
  const currentDeployment = useMemo(
    () => deployments.find((d) => d.status === 'active'),
    [deployments],
  );

  const pastDeployments = useMemo(
    () => deployments.filter((d) => d.status !== 'active'),
    [deployments],
  );

  const formatDate = (d?: string) => {
    if (!d) return '-';
    return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };

  const pastBorderColor = (status: string) => {
    switch (status) {
      case 'completed': return 'border-l-rmpg-500';
      case 'cancelled': return 'border-l-red-500';
      case 'scheduled': return 'border-l-blue-500';
      default: return 'border-l-rmpg-600';
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="w-5 h-5 text-brand-400 animate-spin" />
        <span className="ml-2 text-xs text-rmpg-400">Loading deployment history...</span>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="section-header">
        <MapPinned className="w-3.5 h-3.5 section-icon" />
        <h3>Deployment History</h3>
        <div className="flex-1" />
        <button
          onClick={() => onAddDeployment(officerId)}
          className="toolbar-btn toolbar-btn-primary text-[10px] px-3 py-1 flex items-center gap-1"
        >
          <Plus className="w-3 h-3" />
          Add Deployment
        </button>
      </div>

      {/* Current Assignment */}
      {currentDeployment && (
        <div
          className="cascade-item panel-beveled p-3 border-l-2 border-l-green-500 border-t-2 border-t-green-500"
          style={{ background: '#0a1a0a' }}
        >
          <div className="flex items-center gap-2 mb-2">
            <span className="led-dot led-green" />
            <span className="text-[10px] font-bold uppercase text-green-400 tracking-wider">Current Assignment</span>
            <span className="badge-pill text-[9px] px-1.5 py-0.5 bg-green-900/50 text-green-400 border border-green-700/50 font-bold">
              ACTIVE
            </span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1.5">
            <div>
              <p className="field-label">Property</p>
              <p className="text-xs text-rmpg-100 font-semibold flex items-center gap-1">
                <Building2 className="w-3 h-3 text-rmpg-400" />
                {currentDeployment.property_name}
              </p>
            </div>
            <div>
              <p className="field-label">Client</p>
              <p className="text-xs text-rmpg-200">{currentDeployment.client_name || '-'}</p>
            </div>
            <div>
              <p className="field-label">Position</p>
              <p className="text-xs text-rmpg-200 flex items-center gap-1">
                <Briefcase className="w-3 h-3 text-rmpg-400" />
                {currentDeployment.position}
              </p>
            </div>
            <div>
              <p className="field-label">Start Date</p>
              <p className="text-xs text-rmpg-200 font-mono flex items-center gap-1">
                <Calendar className="w-3 h-3 text-rmpg-400" />
                {formatDate(currentDeployment.start_date)}
              </p>
            </div>
            {currentDeployment.hours_per_week != null && (
              <div>
                <p className="field-label">Hours/Week</p>
                <p className="text-xs text-rmpg-200 font-mono flex items-center gap-1">
                  <Clock className="w-3 h-3 text-rmpg-400" />
                  {currentDeployment.hours_per_week}
                </p>
              </div>
            )}
          </div>
          {currentDeployment.notes && (
            <p className="text-[10px] text-rmpg-400 mt-2 italic">{currentDeployment.notes}</p>
          )}
        </div>
      )}

      {/* Past Deployments */}
      {pastDeployments.length > 0 && (
        <div className="space-y-2">
          <div className="section-header">
            <Calendar className="w-3 h-3 section-icon" />
            <h3>Past Deployments</h3>
          </div>

          <div className="personnel-table panel-beveled overflow-x-auto bg-surface-sunken">
            <table className="table-dark w-full">
              <thead>
                <tr>
                  <th className="text-left">Property</th>
                  <th className="text-left">Client</th>
                  <th className="text-left">Position</th>
                  <th className="text-left">Date Range</th>
                  <th className="text-left">Status</th>
                </tr>
              </thead>
              <tbody>
                {pastDeployments.map((dep) => (
                  <tr key={dep.id} className={dep.status === 'cancelled' ? 'row-alert' : ''}>
                    <td>
                      <span className="text-xs text-rmpg-100 font-semibold">{dep.property_name}</span>
                    </td>
                    <td>
                      <span className="text-[11px] text-rmpg-300">{dep.client_name || '-'}</span>
                    </td>
                    <td>
                      <span className="text-[11px] text-rmpg-300">{dep.position}</span>
                    </td>
                    <td>
                      <span className="font-mono text-[10px] text-rmpg-300">
                        {formatDate(dep.start_date)} &mdash; {formatDate(dep.end_date)}
                      </span>
                    </td>
                    <td>
                      <span className={`badge-pill inline-block px-1.5 py-0.5 text-[9px] font-bold uppercase ${
                        DEPLOYMENT_STATUS_COLORS[dep.status] || DEPLOYMENT_STATUS_COLORS.completed
                      }`}>
                        {toDisplayLabel(dep.status)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Empty State */}
      {deployments.length === 0 && (
        <div className="text-center py-12">
          <div className="w-14 h-14 mx-auto mb-3 rounded-full border border-rmpg-700 flex items-center justify-center" style={{ background: '#0d1520' }}>
            <MapPinned className="w-7 h-7 text-rmpg-600 empty-state-icon" />
          </div>
          <p className="text-xs text-rmpg-500">No deployment history for this officer.</p>
          <p className="text-[10px] text-rmpg-600 mt-1">Click &quot;Add Deployment&quot; to assign a deployment.</p>
        </div>
      )}
    </div>
  );
}
