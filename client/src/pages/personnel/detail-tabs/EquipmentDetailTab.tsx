// ============================================================
// RMPG Flex — Officer Equipment Detail Tab
// ============================================================

import React, { useState, useEffect, useCallback } from 'react';
import { Package, Plus, Edit2, Trash2, Loader2, Box, LogIn, LogOut, Clock } from 'lucide-react';
import type { OfficerEquipment } from '../../../types';
import { apiFetch } from '../../../hooks/useApi';
import { EQUIPMENT_STATUS_COLORS, EQUIPMENT_CONDITION_COLORS } from '../utils/personnelConstants';

interface Props {
  equipment: OfficerEquipment[];
  onAdd: () => void;
  onEdit: (eq: OfficerEquipment) => void;
  onDelete: (eqId: string) => void;
  loading: boolean;
}

const timeAgo = (date: string): string => {
  if (!date) return '—';
  const parsed = new Date(date).getTime();
  if (Number.isNaN(parsed)) return '—';
  const ms = Date.now() - parsed;
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
};

export default function EquipmentDetailTab({
  equipment,
  onAdd,
  onEdit,
  onDelete,
  loading,
}: Props) {
  const [checkoutLogs, setCheckoutLogs] = useState<Record<string, any[]>>({});
  const [expandedLogId, setExpandedLogId] = useState<string | null>(null);
  const [checkingOut, setCheckingOut] = useState<string | null>(null);

  const fetchCheckoutLog = useCallback(async (equipId: string) => {
    try {
      const logs = await apiFetch<any[]>(`/personnel/equipment/${equipId}/checkout-log`);
      setCheckoutLogs(prev => ({ ...prev, [equipId]: logs }));
    } catch { /* silent */ }
  }, []);

  const handleCheckout = async (equipId: string) => {
    setCheckingOut(equipId);
    try {
      await apiFetch(`/personnel/equipment/${equipId}/checkout`, { method: 'POST', body: JSON.stringify({}) });
      fetchCheckoutLog(equipId);
    } catch { /* silent */ }
    finally { setCheckingOut(null); }
  };

  const handleCheckin = async (equipId: string) => {
    setCheckingOut(equipId);
    try {
      await apiFetch(`/personnel/equipment/${equipId}/checkin`, { method: 'POST', body: JSON.stringify({}) });
      fetchCheckoutLog(equipId);
    } catch { /* silent */ }
    finally { setCheckingOut(null); }
  };

  const toggleLog = (equipId: string) => {
    if (expandedLogId === equipId) {
      setExpandedLogId(null);
    } else {
      setExpandedLogId(equipId);
      if (!checkoutLogs[equipId]) fetchCheckoutLog(equipId);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-4 h-4 text-brand-400 animate-spin" role="status" aria-label="Loading" />
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
      <div className="flex items-center justify-between">
        <h3 className="field-label text-brand-400 flex items-center gap-1.5">
          <Package className="w-3 h-3" />
          Equipment
        </h3>
        <button type="button"
          onClick={onAdd}
          className="toolbar-btn toolbar-btn-primary flex items-center gap-1 text-[10px]"
        >
          <Plus className="w-3 h-3" />
          Issue Equipment
        </button>
      </div>

      {/* Status Overview */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        <div className="panel-beveled p-2 text-center bg-surface-base border-t-2 border-t-green-500">
          <p className="text-lg font-bold text-green-400 font-mono">{issuedCount}</p>
          <p className="field-label">Issued</p>
        </div>
        <div className="panel-beveled p-2 text-center bg-surface-base border-t-2 border-t-rmpg-500">
          <p className="text-lg font-bold text-rmpg-200 font-mono">{equipment.length}</p>
          <p className="field-label">Total Items</p>
        </div>
        <div className="panel-beveled p-2 text-center bg-surface-base border-t-2 border-t-red-500">
          <p className="text-lg font-bold text-red-400 font-mono">{alertCount}</p>
          <p className="field-label">Alerts</p>
        </div>
      </div>

      {/* Equipment Cards */}
      {equipment.length > 0 ? (
        <div className="space-y-3">
          {equipment.map((eq) => (
            <div
              key={eq.id}
              className={`panel-beveled p-3 bg-surface-base ${topBorderColor(eq.status)}`}
            >
              {/* Title row */}
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <span className={ledClass(eq.status)} />
                  <h4 className="text-xs font-semibold text-rmpg-100">{typeLabel(eq.equipment_type)}</h4>
                  <span className={`text-[9px] px-1.5 py-0.5 font-bold ${EQUIPMENT_STATUS_COLORS[eq.status] || 'bg-rmpg-700 text-rmpg-300'}`}>
                    {statusLabel(eq.status)}
                  </span>
                </div>
                <div className="flex items-center gap-1">
                  <button type="button"
                    onClick={() => onEdit(eq)}
                    className="toolbar-btn p-1"
                    title="Edit equipment"
                  >
                    <Edit2 className="w-3 h-3" />
                  </button>
                  <button type="button"
                    onClick={() => onDelete(eq.id)}
                    className="toolbar-btn toolbar-btn-danger p-1"
                    title="Delete equipment"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              </div>

              {/* Detail grid */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-x-4 gap-y-1 mb-2">
                <div>
                  <p className="field-label">Make / Model</p>
                  <p className="text-xs text-rmpg-100">
                    {[eq.make, eq.model].filter(Boolean).join(' ') || '-'}
                  </p>
                </div>
                <div>
                  <p className="field-label">Serial #</p>
                  <p className="text-xs text-rmpg-100 font-mono">{eq.serial_number || '-'}</p>
                </div>
                <div>
                  <p className="field-label">Asset Tag</p>
                  <p className="text-xs text-rmpg-100 font-mono">{eq.asset_tag || '-'}</p>
                </div>
              </div>

              {/* Condition & Date row */}
              <div className="flex items-center gap-4 text-xs">
                <div className="flex items-center gap-1.5">
                  <span className="field-label">Condition:</span>
                  <span className={`font-medium capitalize ${EQUIPMENT_CONDITION_COLORS[eq.condition] || 'text-rmpg-400'}`}>
                    {eq.condition}
                  </span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="field-label">Issued:</span>
                  <span className="text-rmpg-100 font-mono">{formatDate(eq.issued_date)}</span>
                </div>
                {eq.returned_date && (
                  <div className="flex items-center gap-1.5">
                    <span className="field-label">Returned:</span>
                    <span className="text-rmpg-100 font-mono">{formatDate(eq.returned_date)}</span>
                  </div>
                )}
              </div>

              {/* Notes */}
              {eq.notes && (
                <div className="panel-inset px-2 py-1.5 mt-2">
                  <p className="text-[10px] text-rmpg-400 italic">
                    {eq.notes}
                  </p>
                </div>
              )}

              {/* Checkout/Checkin Controls */}
              <div className="flex items-center gap-2 mt-2 pt-2 border-t border-rmpg-700/50">
                {eq.status === 'issued' ? (
                  <button type="button" onClick={() => handleCheckin(eq.id)} disabled={checkingOut === eq.id}
                    className="flex items-center gap-1 px-2 py-1 text-[10px] bg-blue-900/30 text-blue-300 border border-blue-700/40 hover:bg-blue-900/50">
                    <LogIn className="w-3 h-3" /> {checkingOut === eq.id ? '...' : 'Check In'}
                  </button>
                ) : (
                  <button type="button" onClick={() => handleCheckout(eq.id)} disabled={checkingOut === eq.id}
                    className="flex items-center gap-1 px-2 py-1 text-[10px] bg-green-900/30 text-green-300 border border-green-700/40 hover:bg-green-900/50">
                    <LogOut className="w-3 h-3" /> {checkingOut === eq.id ? '...' : 'Check Out'}
                  </button>
                )}
                <button type="button" onClick={() => toggleLog(eq.id)}
                  className="flex items-center gap-1 px-2 py-1 text-[10px] text-rmpg-400 hover:text-rmpg-200">
                  <Clock className="w-3 h-3" /> History
                </button>
                {eq.status === 'issued' && (
                  <span className="ml-auto text-[9px] font-bold text-green-400 flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" /> Currently checked out
                  </span>
                )}
              </div>

              {/* Checkout Log */}
              {expandedLogId === eq.id && (
                <div className="mt-2 space-y-1 max-h-[150px] overflow-y-auto">
                  {(checkoutLogs[eq.id] || []).length === 0 ? (
                    <div className="text-[10px] text-rmpg-500 text-center py-2">No checkout history</div>
                  ) : (
                    (checkoutLogs[eq.id] || []).map((log: any) => (
                      <div key={log.id} className="flex items-center gap-2 text-[10px] px-2 py-1 bg-surface-sunken border border-rmpg-700/30">
                        <span className={log.action === 'checkout' ? 'text-green-400' : 'text-blue-400'}>
                          {log.action === 'checkout' ? 'OUT' : 'IN'}
                        </span>
                        <span className="text-rmpg-400">{new Date(log.created_at).toLocaleString()}</span>
                        <span className="text-rmpg-300">by {log.checked_by_name || 'Unknown'}</span>
                        {log.notes && <span className="text-rmpg-500 italic">{log.notes}</span>}
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      ) : (
        <div className="panel-beveled p-10 text-center bg-surface-base" role="status">
          <div className="w-14 h-14 mx-auto mb-3 rounded-full border border-rmpg-700 flex items-center justify-center bg-surface-sunken">
            <Box className="w-7 h-7 text-rmpg-600" />
          </div>
          <p className="text-sm text-rmpg-400 font-medium">No equipment issued</p>
          <p className="text-[10px] text-rmpg-600 mt-1">Click "Add Equipment" to issue gear</p>
        </div>
      )}
    </div>
  );
}
