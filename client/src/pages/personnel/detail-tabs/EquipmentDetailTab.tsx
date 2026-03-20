// ============================================================
// RMPG Flex — Officer Equipment Detail Tab
// ============================================================

import React from 'react';
import { Package, Plus, Edit2, Trash2, Loader2, Box } from 'lucide-react';
import type { OfficerEquipment } from '../../../types';
import { EQUIPMENT_STATUS_COLORS, EQUIPMENT_CONDITION_COLORS } from '../utils/personnelConstants';

interface Props {
  equipment: OfficerEquipment[];
  onAdd: () => void;
  onEdit: (eq: OfficerEquipment) => void;
  onDelete: (eqId: string) => void;
  loading: boolean;
}

export default function EquipmentDetailTab({
  equipment,
  onAdd,
  onEdit,
  onDelete,
  loading,
}: Props) {
  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-4 h-4 text-brand-400 animate-spin" />
        <span className="ml-2 text-xs text-rmpg-400">Loading equipment...</span>
      </div>
    );
  }

  const issuedCount = equipment.filter((e) => e.status === 'issued').length;
  const alertCount = equipment.filter((e) => e.status === 'lost' || e.status === 'damaged').length;

  const topBorderColor = (status: string) => {
    switch (status) {
      case 'issued': return 'border-t-2 border-t-green-500';
      case 'maintenance': return 'border-t-2 border-t-blue-500';
      case 'lost': return 'border-t-2 border-t-red-500';
      case 'damaged': return 'border-t-2 border-t-amber-500';
      default: return 'border-t-2 border-t-rmpg-600';
    }
  };

  const ledClass = (status: string) => {
    switch (status) {
      case 'issued': return 'led-dot led-green';
      case 'maintenance': return 'led-dot led-blue';
      case 'damaged': return 'led-dot led-amber';
      case 'lost': return 'led-dot led-red';
      default: return 'led-dot led-off';
    }
  };

  const formatDate = (d?: string) => {
    if (!d) return '-';
    return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };

  const typeLabel = (type: string) =>
    type.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

  const statusLabel = (status: string) =>
    status.replace(/_/g, ' ').toUpperCase();

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="section-header">
        <Package className="w-3.5 h-3.5 section-icon" />
        <h3>Equipment</h3>
        <div className="flex-1" />
        <button
          onClick={onAdd}
          className="toolbar-btn toolbar-btn-primary flex items-center gap-1 text-[10px]"
        >
          <Plus className="w-3 h-3" />
          Issue Equipment
        </button>
      </div>

      {/* Status Overview */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        <div className="stat-pod panel-beveled p-2 text-center bg-surface-base border-t-2 border-t-green-500 summary-card-shimmer" style={{ '--pod-glow': 'rgba(34, 197, 94, 0.12)' } as React.CSSProperties}>
          <p className="text-lg font-bold text-green-400 font-mono stat-value">{issuedCount}</p>
          <p className="field-label stat-label">Issued</p>
        </div>
        <div className="stat-pod panel-beveled p-2 text-center bg-surface-base border-t-2 border-t-rmpg-500 summary-card-shimmer" style={{ '--pod-glow': 'rgba(148, 163, 184, 0.08)' } as React.CSSProperties}>
          <p className="text-lg font-bold text-rmpg-200 font-mono stat-value">{equipment.length}</p>
          <p className="field-label stat-label">Total Items</p>
        </div>
        <div className="stat-pod panel-beveled p-2 text-center bg-surface-base border-t-2 border-t-red-500 summary-card-shimmer" style={{ '--pod-glow': 'rgba(239, 68, 68, 0.12)' } as React.CSSProperties}>
          <p className="text-lg font-bold text-red-400 font-mono stat-value">{alertCount}</p>
          <p className="field-label stat-label">Alerts</p>
        </div>
      </div>

      {/* Alert banner for lost/damaged */}
      {alertCount > 0 && (
        <div className="alert-banner alert-banner-critical panel-beveled p-2.5 flex items-center gap-2 border border-red-700/40 border-l-2 border-l-red-500 bg-[#1a0a0a]">
          <span className="led-dot led-red" />
          <span className="text-[10px] text-red-400 font-semibold">
            {alertCount} item{alertCount !== 1 ? 's' : ''} flagged as lost or damaged — review required
          </span>
        </div>
      )}

      {/* Equipment Table */}
      {equipment.length > 0 ? (
        <div className="personnel-table panel-beveled overflow-x-auto bg-surface-sunken">
          <table className="table-dark w-full">
            <thead>
              <tr>
                <th className="text-left">Type</th>
                <th className="text-left">Make / Model</th>
                <th className="text-left">Serial #</th>
                <th className="text-left">Asset Tag</th>
                <th className="text-left">Condition</th>
                <th className="text-left">Status</th>
                <th className="text-left">Issued</th>
                <th className="text-center">Actions</th>
              </tr>
            </thead>
            <tbody>
              {equipment.map((eq) => (
                <tr key={eq.id} className={eq.status === 'lost' || eq.status === 'damaged' ? 'row-alert' : ''}>
                  <td>
                    <div className="flex items-center gap-1.5">
                      <span className={ledClass(eq.status)} />
                      <span className="text-xs font-semibold text-rmpg-100">{typeLabel(eq.equipment_type)}</span>
                    </div>
                  </td>
                  <td>
                    <span className="text-xs text-rmpg-200">{[eq.make, eq.model].filter(Boolean).join(' ') || '-'}</span>
                  </td>
                  <td>
                    <span className="text-xs text-rmpg-200 font-mono">{eq.serial_number || '-'}</span>
                  </td>
                  <td>
                    <span className="text-xs text-rmpg-200 font-mono">{eq.asset_tag || '-'}</span>
                  </td>
                  <td>
                    <span className={`text-xs font-medium capitalize ${EQUIPMENT_CONDITION_COLORS[eq.condition] || 'text-rmpg-400'}`}>
                      {eq.condition}
                    </span>
                  </td>
                  <td>
                    <span className={`badge-pill text-[9px] px-1.5 py-0.5 font-bold ${EQUIPMENT_STATUS_COLORS[eq.status] || 'bg-rmpg-700 text-rmpg-300'}`}>
                      {statusLabel(eq.status)}
                    </span>
                  </td>
                  <td>
                    <span className="text-xs text-rmpg-200 font-mono">{formatDate(eq.issued_date)}</span>
                    {eq.returned_date && (
                      <span className="block text-[9px] text-rmpg-500 font-mono">ret: {formatDate(eq.returned_date)}</span>
                    )}
                  </td>
                  <td className="text-center">
                    <div className="flex items-center justify-center gap-1">
                      <button
                        onClick={() => onEdit(eq)}
                        className="toolbar-btn p-1"
                        title="Edit equipment"
                      >
                        <Edit2 className="w-3 h-3" />
                      </button>
                      <button
                        onClick={() => onDelete(eq.id)}
                        className="toolbar-btn toolbar-btn-danger p-1"
                        title="Delete equipment"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="empty-state-container panel-beveled p-8 text-center bg-surface-base">
          <Box className="w-8 h-8 text-rmpg-600 mx-auto mb-2 empty-state-icon" />
          <p className="text-xs text-rmpg-400">No equipment issued</p>
          <p className="text-[10px] text-rmpg-600 mt-1">Click &quot;Issue Equipment&quot; to assign gear.</p>
        </div>
      )}
    </div>
  );
}
