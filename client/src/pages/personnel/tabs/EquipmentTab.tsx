// ============================================================
// RMPG Flex — Personnel: Equipment Tab (All Equipment)
// ============================================================

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Package, Plus, Edit3, Trash2, AlertTriangle, Box, ArrowRightLeft, Loader2,
  FileText, Download, Search, X,
} from 'lucide-react';
import { apiFetch } from '../../../hooks/useApi';
import type { OfficerEquipment, EquipmentType } from '../../../types';
import { EQUIPMENT_STATUS_COLORS, EQUIPMENT_CONDITION_COLORS } from '../utils/personnelConstants';
import { parseTimestamp } from '../../../utils/dateUtils';
import { useContextMenu, type ContextMenuItem } from '../../../context/ContextMenuContext';
import { useMenuActions } from '../../../utils/contextMenuActions';
import { openEquipmentCustodyPdf, type CheckoutLogEntry } from '../../../utils/equipmentCustodyPdf';
import { exportToCsv } from '../../../utils/csvExport';

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
  /** Optional initial type filter / search seed driven by URL deep-link.
   *  PersonnelPage hands these in once when /personnel?item_id=… /
   *  ?serial=… / ?assigned_to=… land — the tab then owns its own state
   *  so filter chip clicks still work normally. */
  initialTypeFilter?: EquipmentType | 'all';
  initialSearchQuery?: string;
  /** Equipment id to scroll into view + flash-highlight on mount. Resolved
   *  by PersonnelPage so it can validate the row exists before clearing
   *  the URL param. Cleared by EquipmentTab once the row scrolls in. */
  highlightItemId?: string | null;
  /** Prepared-by attribution surfaced on the PDF + (eventually) the
   *  signature block. PersonnelPage already has useAuth(). */
  preparedBy?: string;
}

export default function EquipmentTab({
  equipment, onAddEquipment, onEditEquipment, onDeleteEquipment,
  initialTypeFilter, initialSearchQuery, highlightItemId, preparedBy,
}: Props) {
  const [typeFilter, setTypeFilter] = useState<EquipmentType | 'all'>(initialTypeFilter ?? 'all');
  const [searchQuery, setSearchQuery] = useState<string>(initialSearchQuery ?? '');
  const [checkoutLog, setCheckoutLog] = useState<{ id: number; equipment_id: number; officer_name: string; equipment_name: string; action: string; notes: string; created_at: string }[]>([]);
  const [showCheckoutLog, setShowCheckoutLog] = useState(false);
  const [logLoading, setLogLoading] = useState(false);
  // Row PDF generation pulls the per-item checkout log on demand — the
  // table itself only renders the recent activity feed, not per-row history.
  // We cache by item id so reopening the PDF doesn't refetch.
  const perItemLogCache = useRef<Map<string, CheckoutLogEntry[]>>(new Map());
  const [pdfBusy, setPdfBusy] = useState<string | null>(null);

  // Deep-link: keep filter/search synced if the URL param changes
  // (PersonnelPage may re-call this after archive flip).
  useEffect(() => { if (initialTypeFilter !== undefined) setTypeFilter(initialTypeFilter); }, [initialTypeFilter]);
  useEffect(() => { if (initialSearchQuery !== undefined) setSearchQuery(initialSearchQuery); }, [initialSearchQuery]);

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
    const q = searchQuery.trim().toLowerCase();
    return equipment.filter((e) => {
      if (typeFilter !== 'all' && e.equipment_type !== typeFilter) return false;
      if (!q) return true;
      // Match serial / asset tag / make / model / officer — the operator
      // tends to know one of these when looking for a row, not the id.
      const hay = [e.serial_number, e.asset_tag, e.make, e.model, e.officer_name]
        .filter(Boolean).map(s => String(s).toLowerCase()).join('  ');
      return hay.includes(q);
    });
  }, [equipment, typeFilter, searchQuery]);

  const hasActiveFilter = typeFilter !== 'all' || searchQuery.trim().length > 0;

  const alertCount = stats.lostDamaged;

  function formatDate(dateStr?: string): string {
    if (!dateStr) return '-';
    return parseTimestamp(dateStr).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
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
    { label: 'Maintenance', value: stats.maintenance, color: 'text-rmpg-400', bgClass: 'bg-surface-base', border: 'border-border-default/30', topBorder: 'border-t-rmpg-500' },
    { label: 'Retired', value: stats.retired, color: 'text-rmpg-400', bgClass: 'bg-surface-base', border: 'border-rmpg-700', topBorder: 'border-t-rmpg-600' },
  ];

  // ── PDF: court-ready custody form per item ──
  // Pulls the per-item checkout log on demand (the table itself only loads
  // the recent activity feed) so the PDF chain-of-custody section is
  // populated. The cache keeps a repeat-click from re-fetching.
  const handleOpenPdf = async (eq: OfficerEquipment) => {
    setPdfBusy(eq.id);
    try {
      let log = perItemLogCache.current.get(eq.id);
      if (!log) {
        try {
          const fetched = await apiFetch<any[]>(`/personnel/equipment/${eq.id}/checkout-log`);
          log = Array.isArray(fetched) ? fetched as CheckoutLogEntry[] : [];
          perItemLogCache.current.set(eq.id, log);
        } catch {
          // Network/permission failure — the PDF still renders with the
          // item block + signature lines and just prints "No checkout
          // history recorded" rather than blowing up the whole action.
          log = [];
        }
      }
      openEquipmentCustodyPdf({ item: eq, checkoutLog: log, preparedBy });
    } finally {
      setPdfBusy(null);
    }
  };

  // ── CSV export: filtered view ──
  const handleExportCsv = () => {
    const rows = filtered.map((e) => ({
      officer: e.officer_name || '',
      type: typeLabel(e.equipment_type),
      make: e.make || '',
      model: e.model || '',
      serial: e.serial_number || '',
      asset_tag: e.asset_tag || '',
      condition: e.condition || '',
      status: e.status || '',
      issued: e.issued_date || '',
      returned: e.returned_date || '',
    }));
    const stamp = new Date().toISOString().slice(0, 10);
    exportToCsv(`equipment_${stamp}.csv`, rows, [
      { key: 'officer', label: 'Officer' },
      { key: 'type', label: 'Type' },
      { key: 'make', label: 'Make' },
      { key: 'model', label: 'Model' },
      { key: 'serial', label: 'Serial #' },
      { key: 'asset_tag', label: 'Asset Tag' },
      { key: 'condition', label: 'Condition' },
      { key: 'status', label: 'Status' },
      { key: 'issued', label: 'Issued Date' },
      { key: 'returned', label: 'Returned Date' },
    ]);
  };

  // Right-click context menu
  const { openMenu } = useContextMenu();
  const m = useMenuActions();
  const buildRowMenu = (eq: OfficerEquipment): ContextMenuItem[] => [
    m.action('Edit equipment', () => onEditEquipment(eq), { icon: <Edit3 size={12} /> }),
    m.action('Open custody PDF', () => handleOpenPdf(eq), { icon: <FileText size={12} /> }),
    m.separator(),
    m.copy('Copy serial #', eq.serial_number),
    m.copy('Copy asset tag', eq.asset_tag),
    m.copy('Copy officer', eq.officer_name),
    m.copyId(eq.id),
    m.separator(),
    m.action('Delete equipment', () => onDeleteEquipment(eq.id), { icon: <Trash2 size={12} />, danger: true }),
  ];

  // ── Scroll/highlight the deep-linked row once it's rendered ──
  // PersonnelPage validates the id resolves to a real row before
  // passing it down; we just need to flash the row + bring it into
  // view. Listing inside the equipment dependency means a late-
  // hydrating row still scrolls in when it eventually appears.
  const rowRefs = useRef<Map<string, HTMLTableRowElement>>(new Map());
  const [flashId, setFlashId] = useState<string | null>(null);
  useEffect(() => {
    if (!highlightItemId) return;
    const el = rowRefs.current.get(highlightItemId);
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setFlashId(highlightItemId);
    const t = window.setTimeout(() => setFlashId(null), 2200);
    return () => window.clearTimeout(t);
  }, [highlightItemId, filtered]);

  // Set document title
  useEffect(() => { document.title = 'Personnel - Equipment \u2014 RMPG Flex'; }, []);

  return (
    <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Package className="w-4 h-4 text-brand-400" />
          <h2 className="text-sm font-bold text-rmpg-200 uppercase tracking-wider">Equipment</h2>
          <span className="text-[11px] font-mono text-rmpg-500">({equipment.length})</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="relative">
            <Search className="w-3 h-3 text-rmpg-500 absolute left-2 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search serial / asset / officer..."
              className="input-dark text-[10px] pl-6 pr-7 py-1 min-h-[26px] w-[220px]"
              aria-label="Search equipment"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="absolute right-1 top-1/2 -translate-y-1/2 text-rmpg-500 hover:text-rmpg-200 p-0.5"
                aria-label="Clear search"
                title="Clear search"
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </div>
          <button
            type="button"
            onClick={handleExportCsv}
            disabled={filtered.length === 0}
            className="toolbar-btn text-[10px] px-2 py-1.5 flex items-center gap-1.5 disabled:opacity-50"
            title="Export filtered equipment to CSV"
          >
            <Download className="w-3 h-3" />
            CSV
          </button>
          <button type="button" onClick={onAddEquipment} className="toolbar-btn toolbar-btn-primary text-[10px] px-3 py-1.5 flex items-center gap-1.5">
            <Plus className="w-3 h-3" />
            Issue Equipment
          </button>
        </div>
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
              typeFilter === t.value ? 'toolbar-btn toolbar-btn-primary' : 'toolbar-btn'
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
                <span className={`font-bold ${log.action === 'checkout' ? 'text-green-400' : log.action === 'return' ? 'text-rmpg-400' : 'text-amber-400'}`}>
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
                  {hasActiveFilter && equipment.length > 0 ? (
                    <>
                      <p className="text-[10px] text-rmpg-500">No equipment matches your filters.</p>
                      <p className="text-[9px] text-rmpg-600 mt-0.5">
                        Showing 0 of {equipment.length} items.
                      </p>
                      <button
                        type="button"
                        onClick={() => { setTypeFilter('all'); setSearchQuery(''); }}
                        className="toolbar-btn text-[10px] mt-2"
                      >
                        Clear filters
                      </button>
                    </>
                  ) : (
                    <>
                      <p className="text-[10px] text-rmpg-500">No equipment issued yet.</p>
                      <p className="text-[9px] text-rmpg-600 mt-0.5">
                        Click <span className="font-semibold">Issue Equipment</span> (or press <kbd className="px-1 border border-rmpg-700 rounded">N</kbd>) to record the first item.
                      </p>
                    </>
                  )}
                </td>
              </tr>
            ) : (
              filtered.map((eq) => (
                <tr
                  key={eq.id}
                  ref={(el) => {
                    if (el) rowRefs.current.set(eq.id, el);
                    else rowRefs.current.delete(eq.id);
                  }}
                  className={`${eq.status === 'lost' || eq.status === 'damaged' ? 'bg-red-900/10' : ''} ${flashId === eq.id ? 'ring-2 ring-brand-400/70 transition-shadow' : ''}`}
                  onContextMenu={(e) => openMenu(e, buildRowMenu(eq))}
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
                        onClick={() => handleOpenPdf(eq)}
                        disabled={pdfBusy === eq.id}
                        className="toolbar-btn p-1 disabled:opacity-50"
                        title="Open custody PDF (court-ready)"
                        aria-label="Open custody PDF"
                      >
                        {pdfBusy === eq.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <FileText className="w-3 h-3" />}
                      </button>
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
