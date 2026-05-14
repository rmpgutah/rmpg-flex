// ============================================================
// RMPG Flex — Personnel: Equipment Tab (All Equipment)
// ============================================================

import { useEffect, useMemo, useState } from 'react';
import {
  Package, Plus, Edit3, Trash2, AlertTriangle, Box, ArrowRightLeft, Loader2,
} from 'lucide-react';
import { apiFetch } from '../../../hooks/useApi';
import type { OfficerEquipment, EquipmentType } from '../../../types';
import { EQUIPMENT_STATUS_COLORS, EQUIPMENT_CONDITION_COLORS } from '../utils/personnelConstants';

const EQUIPMENT_TYPES: { value: EquipmentType | 'all'; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'radio', label: 'Radio' },
  { value: 'body_camera', label: 'Body Camera' },
  { value: 'firearm', label: 'Firearm' },
  { value: 'taser', label: 'Taser' },
  { value: 'baton', label: 'Baton' },
  { value: 'handcuffs', label: 'Handcuffs' },
  { value: 'vest', label: 'Vest' },
  { value: 'badge', label: 'Badge' },
  { value: 'id_card', label: 'ID Card' },
  { value: 'keys', label: 'Keys' },
  { value: 'flashlight', label: 'Flashlight' },
  { value: 'vehicle_key', label: 'Vehicle Key' },
  { value: 'laptop', label: 'Laptop' },
  { value: 'phone', label: 'Phone' },
  { value: 'other', label: 'Other' },
];

interface Props {
  equipment: OfficerEquipment[];
  onAddEquipment: () => void;
  onEditEquipment: (eq: OfficerEquipment) => void;
  onDeleteEquipment: (eqId: string) => void;
}

export default function EquipmentTab({ equipment, onAddEquipment, onEditEquipment, onDeleteEquipment }: Props) {
  const [typeFilter, setTypeFilter] = useState<EquipmentType | 'all'>('all');
  const [checkoutLog, setCheckoutLog] = useState<{ id: number; equipment_id: number; officer_name: string; equipment_name: string; action: string; notes: string; created_at: string }[]>([]);
  const [showCheckoutLog, setShowCheckoutLog] = useState(false);
  const [logLoading, setLogLoading] = useState(false);

  useEffect(() => {
    setLogLoading(true);
    apiFetch<any>('/api/personnel/equipment-log?days=30')
      .then((d: any) => Array.isArray(d) ? setCheckoutLog(d) : setCheckoutLog([]))
      .catch(() => setCheckoutLog([]))
      .finally(() => setLogLoading(false));
  }, []);

  const stats = useMemo(() => {
    const issued = equipment.filter((e) => e.status === 'issued').length;
    const returned = equipment.filter((e) => e.status === 'returned').length;
    const lostDamaged = equipment.filter((e) => e.status === 'lost' || e.status === 'damaged').length;
    const maintenance = equipment.filter((e) => e.status === 'maintenance').length;
    const retired = equipment.filter((e) => e.status === 'retired').length;
    return { total: equipment.length, issued, returned, lostDamaged, maintenance, retired };
  }, [equipment]);

  const filtered = useMemo(() => {
    if (typeFilter === 'all') return equipment;
    return equipment.filter((e) => e.equipment_type === typeFilter);
  }, [equipment, typeFilter]);

  const alertCount = stats.lostDamaged;

  function formatDate(dateStr?: string): string {
    if (!dateStr) return '-';
    return new Date(dateStr.includes('T') ? dateStr : dateStr + 'T00:00:00').toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
  }

  function statusLabel(status: string): string {
    return status.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  }

  function typeLabel(type: string): string {
    return type.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  }

  function statusLedClass(status: string): string {
    switch (status) {
      case 'issued': return 'led-dot led-green';
      case 'maintenance': return 'led-dot led-gray';
      case 'damaged': return 'led-dot led-amber';
      case 'lost': return 'led-dot led-red';
      case 'returned': return 'led-dot led-off';
      case 'retired': return 'led-dot led-off';
      default: return 'led-dot led-off';
    }
  }

  const SUMMARY_CARDS = [
    { label: 'Total', value: stats.total, color: 'text-rmpg-300', bgClass: 'bg-surface-base', border: 'border-rmpg-700', topBorder: 'border-t-rmpg-500' },
    { label: 'Issued', value: stats.issued, color: 'text-green-400', bgClass: 'bg-surface-base', border: 'border-green-700/30', topBorder: 'border-t-green-500' },
    { label: 'Returned', value: stats.returned, color: 'text-rmpg-400', bgClass: 'bg-surface-base', border: 'border-rmpg-700', topBorder: 'border-t-rmpg-600' },
    { label: 'Lost / Damaged', value: stats.lostDamaged, color: 'text-red-400', bgClass: 'bg-surface-base', border: 'border-red-700/30', topBorder: 'border-t-red-500' },
    { label: 'Maintenance', value: stats.maintenance, color: 'text-gray-400', bgClass: 'bg-surface-base', border: 'border-gray-700/30', topBorder: 'border-t-gray-500' },
    { label: 'Retired', value: stats.retired, color: 'text-rmpg-400', bgClass: 'bg-surface-base', border: 'border-rmpg-700', topBorder: 'border-t-rmpg-600' },
  ];

  // Set document title
  useEffect(() => { document.title = 'Personnel - Equipment \u2014 RMPG Flex'; }, []);

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Package className="w-4 h-4 text-brand-400" />
          <h2 className="text-sm font-bold text-rmpg-200 uppercase tracking-wider">Equipment</h2>
        </div>
        <button type="button" onClick={onAddEquipment} className="toolbar-btn-primary text-[10px] px-3 py-1.5 flex items-center gap-1.5">
          <Plus className="w-3 h-3" />
          Issue Equipment
        </button>
      </div>

      {/* Alert Banner */}
      {alertCount > 0 && (
        <div className="panel-beveled p-3 flex items-center gap-3 border border-red-700/40 border-l-2 border-l-red-500 bg-surface-base">
          <AlertTriangle className="w-4 h-4 text-red-400 flex-shrink-0" />
          <div className="flex-1">
            <span className="text-xs text-red-400 font-semibold">
              {alertCount} item{alertCount !== 1 ? 's' : ''} lost or damaged
            </span>
          </div>
        </div>
      )}

      {/* Summary Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
        {SUMMARY_CARDS.map((card) => (
          <div
            key={card.label}
            className={`panel-beveled p-2.5 text-center border border-t-2 ${card.border} ${card.bgClass} ${card.topBorder}`}
          >
            <div className={`text-sm font-bold font-mono ${card.color}`}>{card.value}</div>
            <div className="text-[7px] text-rmpg-500 uppercase">{card.label}</div>
          </div>
        ))}
      </div>

      {/* Type Filter */}
      <div className="panel-inset p-2 flex items-center gap-1.5 flex-wrap">
        {EQUIPMENT_TYPES.map((t) => (
          <button type="button"
            key={t.value}
            onClick={() => setTypeFilter(t.value)}
            className={`text-[10px] px-2.5 py-1 ${
              typeFilter === t.value ? 'toolbar-btn-primary' : 'toolbar-btn'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Checkout/Return Log */}
      <div className="panel-beveled p-3 bg-surface-base">
        <button type="button" onClick={() => setShowCheckoutLog(!showCheckoutLog)}
          className="text-[9px] text-rmpg-400 uppercase font-bold tracking-wider flex items-center gap-1.5 w-full">
          <ArrowRightLeft className="w-3 h-3" /> Equipment Checkout Log ({checkoutLog.length})
          <span className="ml-auto text-[8px] text-rmpg-500">{showCheckoutLog ? 'Hide' : 'Show'}</span>
        </button>
        {showCheckoutLog && logLoading && (
          <div className="mt-2 flex items-center justify-center py-4">
            <Loader2 className="w-4 h-4 animate-spin text-rmpg-400" />
            <span className="ml-2 text-[9px] text-rmpg-500">Loading checkout log...</span>
          </div>
        )}
        {showCheckoutLog && !logLoading && checkoutLog.length === 0 && (
          <p className="mt-2 text-[9px] text-rmpg-500 text-center py-3">No checkout activity in the last 30 days</p>
        )}
        {showCheckoutLog && !logLoading && checkoutLog.length > 0 && (
          <div className="mt-2 space-y-0.5 max-h-[200px] overflow-y-auto">
            {checkoutLog.slice(0, 20).map((log) => (
              <div key={log.id} className="flex items-center justify-between px-2 py-1 bg-surface-sunken rounded text-[9px]">
                <span className="text-rmpg-300">{log.officer_name || '-'}</span>
                <span className={`font-bold ${log.action === 'checkout' ? 'text-green-400' : log.action === 'return' ? 'text-gray-400' : 'text-amber-400'}`}>
                  {log.action?.toUpperCase()}
                </span>
                <span className="text-rmpg-200">{log.equipment_name}</span>
                <span className="text-rmpg-500 font-mono">{log.created_at?.slice(0, 10)}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Equipment Table */}
      <div className="panel-beveled overflow-x-auto bg-surface-sunken">
        <table className="table-dark w-full">
          <thead className="sticky top-0 z-10">
            <tr>
              <th className="text-left">Officer</th>
              <th className="text-left">Type</th>
              <th className="text-left">Make / Model</th>
              <th className="text-left">Serial #</th>
              <th className="text-left">Asset Tag</th>
              <th className="text-left">Condition</th>
              <th className="text-left">Issued</th>
              <th className="text-left">Status</th>
              <th className="text-center">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={9} className="text-center py-8">
                  <div className="w-12 h-12 mx-auto mb-2 rounded-full border border-rmpg-700 flex items-center justify-center bg-surface-base">
                    <Box className="w-6 h-6 text-rmpg-600" />
                  </div>
                  <p className="text-[10px] text-rmpg-500">No equipment found.</p>
                  <p className="text-[9px] text-rmpg-600 mt-0.5">Issue equipment to track officer gear and assets.</p>
                </td>
              </tr>
            ) : (
              filtered.map((eq) => (
                <tr
                  key={eq.id}
                  className={eq.status === 'lost' || eq.status === 'damaged' ? 'bg-red-900/10' : ''}
                >
                  <td>
                    <span className="text-xs text-rmpg-200">{eq.officer_name || '-'}</span>
                  </td>
                  <td>
                    <span className="text-xs text-rmpg-300 font-medium">{typeLabel(eq.equipment_type)}</span>
                  </td>
                  <td>
                    <span className="text-xs text-rmpg-300">
                      {[eq.make, eq.model].filter(Boolean).join(' ') || '-'}
                    </span>
                  </td>
                  <td>
                    <span className="text-xs font-mono text-rmpg-400">{eq.serial_number || '-'}</span>
                  </td>
                  <td>
                    <span className="text-xs font-mono text-rmpg-400">{eq.asset_tag || '-'}</span>
                  </td>
                  <td>
                    <span className={`text-xs font-medium capitalize ${EQUIPMENT_CONDITION_COLORS[eq.condition] || 'text-rmpg-400'}`}>
                      {eq.condition}
                    </span>
                  </td>
                  <td>
                    <span className="text-xs font-mono text-rmpg-400">{formatDate(eq.issued_date)}</span>
                  </td>
                  <td>
                    <div className="flex items-center gap-1.5">
                      <span className={statusLedClass(eq.status)} />
                      <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 text-[9px] font-bold ${
                        EQUIPMENT_STATUS_COLORS[eq.status] || 'bg-rmpg-700 text-rmpg-400 border border-rmpg-600'
                      }`}>
                        {statusLabel(eq.status)}
                      </span>
                    </div>
                  </td>
                  <td className="text-center">
                    <div className="flex items-center justify-center gap-1">
                      <button type="button"
                        onClick={() => onEditEquipment(eq)}
                        className="toolbar-btn p-1"
                        title="Edit equipment"
                      >
                        <Edit3 className="w-3 h-3" />
                      </button>
                      <button type="button"
                        onClick={() => onDeleteEquipment(eq.id)}
                        className="toolbar-btn toolbar-btn-danger p-1"
                        title="Delete equipment"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
