// ============================================================
// RMPG Flex — Evidence / Property Room Page
// ============================================================
// Standalone property room management with chain-of-custody
// workflow, storage location tracking, and disposition pipeline.
// ============================================================

import React, { useState, useEffect, useCallback } from 'react';
import {
  Package, Search, Plus, ChevronDown, MapPin, Clock, User,
  ArrowRightLeft, CheckCircle, AlertTriangle, X, Save, Loader2,
  Box, Warehouse, Tag, FileText, Archive,
} from 'lucide-react';
import PanelTitleBar from '../components/PanelTitleBar';
import StatusBadge from '../components/StatusBadge';
// ExportButton omitted — no dedicated export endpoint for evidence
import { apiFetch } from '../hooks/useApi';
import { useLiveSync } from '../hooks/useLiveSync';
import { useIsMobile } from '../hooks/useIsMobile';
import { useToast } from '../components/ToastProvider';

const STATUS_COLORS: Record<string, string> = {
  checked_in: 'bg-green-900/50 text-green-400 border-green-700/50',
  in_storage: 'bg-blue-900/50 text-blue-400 border-blue-700/50',
  checked_out: 'bg-amber-900/50 text-amber-400 border-amber-700/50',
  submitted_to_le: 'bg-purple-900/50 text-purple-400 border-purple-700/50',
  pending_disposition: 'bg-orange-900/50 text-orange-400 border-orange-700/50',
  released: 'bg-teal-900/50 text-teal-400 border-teal-700/50',
  disposed: 'bg-rmpg-700/50 text-rmpg-400 border-rmpg-600/50',
};

const TYPE_LABELS: Record<string, string> = {
  weapon: 'Weapon', narcotics: 'Narcotics', currency: 'Currency', electronics: 'Electronics',
  documents: 'Documents', vehicle: 'Vehicle', clothing: 'Clothing', biological: 'Biological',
  other: 'Other',
};

const CHAIN_ACTIONS = [
  { value: 'check_in', label: 'Check In', icon: '📥' },
  { value: 'check_out', label: 'Check Out', icon: '📤' },
  { value: 'transfer', label: 'Transfer', icon: '🔄' },
  { value: 'lab_submit', label: 'Submit to Lab/LE', icon: '🔬' },
  { value: 'release', label: 'Release to Owner', icon: '✅' },
  { value: 'dispose', label: 'Dispose', icon: '🗑️' },
];

export default function EvidencePropertyPage() {
  const isMobile = useIsMobile();
  const { addToast } = useToast();

  const [items, setItems] = useState<any[]>([]);
  const [selected, setSelected] = useState<any | null>(null);
  const [stats, setStats] = useState<any>(null);
  const [locations, setLocations] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  // Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [filterType, setFilterType] = useState('');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalCount, setTotalCount] = useState(0);

  // Chain of custody modal
  const [chainModalOpen, setChainModalOpen] = useState(false);
  const [chainAction, setChainAction] = useState('check_in');
  const [chainLocation, setChainLocation] = useState('');
  const [chainNotes, setChainNotes] = useState('');
  const [chainSubmitting, setChainSubmitting] = useState(false);

  // Detail tab
  const [detailTab, setDetailTab] = useState<'info' | 'chain'>('info');

  const fetchItems = useCallback(async (opts?: { silent?: boolean }) => {
    if (!opts?.silent) setLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(page), per_page: '50',
        ...(searchQuery ? { search: searchQuery } : {}),
        ...(filterStatus ? { status: filterStatus } : {}),
        ...(filterType ? { type: filterType } : {}),
      });
      const res = await apiFetch<{ data: any[]; pagination: any }>(`/records/evidence?${params}`);
      setItems(res.data || []);
      setTotalPages(res.pagination?.totalPages || 1);
      setTotalCount(res.pagination?.total || 0);
    } catch { /* silent */ } finally { setLoading(false); }
  }, [page, searchQuery, filterStatus, filterType]);

  const fetchStats = useCallback(async () => {
    try {
      const res = await apiFetch<{ data: any }>('/records/evidence/stats');
      setStats(res.data);
    } catch { /* silent */ }
  }, []);

  const fetchLocations = useCallback(async () => {
    try {
      const res = await apiFetch<{ data: any[] }>('/records/evidence/locations');
      setLocations(res.data || []);
    } catch { /* silent */ }
  }, []);

  useEffect(() => { fetchItems(); }, [fetchItems]);
  useEffect(() => { fetchStats(); fetchLocations(); }, [fetchStats, fetchLocations]);
  useLiveSync('records', () => { fetchItems({ silent: true }); fetchStats(); });

  const handleChainAction = async () => {
    if (!selected) return;
    setChainSubmitting(true);
    try {
      await apiFetch(`/records/evidence/${selected.id}/chain-action`, {
        method: 'POST',
        body: JSON.stringify({
          action: chainAction,
          to_location: chainLocation || undefined,
          notes: chainNotes || undefined,
        }),
      });
      addToast('Chain of custody action recorded', 'success');
      setChainModalOpen(false);
      setChainNotes('');
      fetchItems({ silent: true });
      // Re-fetch selected item
      const updated = await apiFetch<{ data: any }>(`/records/evidence/${selected.id}`);
      setSelected(updated.data);
    } catch (err: any) {
      addToast(err.message || 'Failed to record action', 'error');
    } finally { setChainSubmitting(false); }
  };

  const chainOfCustody = selected?.chain_of_custody
    ? (typeof selected.chain_of_custody === 'string' ? JSON.parse(selected.chain_of_custody) : selected.chain_of_custody)
    : [];

  return (
    <div className={`h-full flex ${isMobile ? 'flex-col' : ''}`}>
      {/* ── Left Panel: List ── */}
      <div className={`flex flex-col ${isMobile ? 'h-1/2' : 'w-[420px]'} border-r border-rmpg-700`}>
        <PanelTitleBar title="Evidence / Property Room" icon={Package}>
          <span className="text-[9px] font-mono text-rmpg-500">{totalCount} items</span>
        </PanelTitleBar>

        {/* Stats Row */}
        {stats && (
          <div className="flex gap-2 px-2 py-1.5 border-b border-rmpg-700 bg-surface-sunken overflow-x-auto">
            <div className="text-center px-2">
              <div className="text-[10px] font-mono text-rmpg-500">TOTAL</div>
              <div className="text-sm font-bold text-white">{stats.total_items || 0}</div>
            </div>
            <div className="text-center px-2">
              <div className="text-[10px] font-mono text-rmpg-500">IN STORAGE</div>
              <div className="text-sm font-bold text-blue-400">{stats.by_status?.in_storage || 0}</div>
            </div>
            <div className="text-center px-2">
              <div className="text-[10px] font-mono text-rmpg-500">CHECKED OUT</div>
              <div className="text-sm font-bold text-amber-400">{stats.by_status?.checked_out || 0}</div>
            </div>
            <div className="text-center px-2">
              <div className="text-[10px] font-mono text-rmpg-500">PENDING</div>
              <div className="text-sm font-bold text-orange-400">{stats.pending_disposition || 0}</div>
            </div>
          </div>
        )}

        {/* Filters */}
        <div className="flex gap-1 p-1.5 border-b border-rmpg-700 bg-surface-base">
          <div className="flex-1 relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 text-rmpg-500" style={{ width: 12, height: 12 }} />
            <input
              value={searchQuery}
              onChange={e => { setSearchQuery(e.target.value); setPage(1); }}
              placeholder="Search evidence..."
              className="w-full pl-7 pr-2 py-1 text-xs bg-surface-sunken border border-rmpg-700 text-white placeholder-rmpg-500 focus:border-brand-600 outline-none"
            />
          </div>
          <select
            value={filterStatus}
            onChange={e => { setFilterStatus(e.target.value); setPage(1); }}
            className="text-[10px] bg-surface-sunken border border-rmpg-700 text-rmpg-300 px-1 py-1 outline-none"
          >
            <option value="">All Status</option>
            <option value="checked_in">Checked In</option>
            <option value="in_storage">In Storage</option>
            <option value="checked_out">Checked Out</option>
            <option value="submitted_to_le">Submitted to LE</option>
            <option value="pending_disposition">Pending Disposition</option>
            <option value="released">Released</option>
            <option value="disposed">Disposed</option>
          </select>
          <select
            value={filterType}
            onChange={e => { setFilterType(e.target.value); setPage(1); }}
            className="text-[10px] bg-surface-sunken border border-rmpg-700 text-rmpg-300 px-1 py-1 outline-none"
          >
            <option value="">All Types</option>
            {Object.entries(TYPE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </div>

        {/* Item List */}
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center h-32">
              <Loader2 className="w-5 h-5 animate-spin text-rmpg-500" />
            </div>
          ) : items.length === 0 ? (
            <div className="text-center py-8 text-rmpg-500 text-xs">No evidence items found</div>
          ) : (
            items.map(item => (
              <button
                key={item.id}
                onClick={() => { setSelected(item); setDetailTab('info'); }}
                className={`w-full text-left px-3 py-2 border-b border-rmpg-800 transition-colors ${
                  selected?.id === item.id ? 'bg-brand-900/20 border-l-2 border-l-brand-500' : 'hover:bg-rmpg-800/40 border-l-2 border-l-transparent'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-mono font-bold text-white truncate">
                    {item.evidence_number || `EV-${item.id}`}
                  </span>
                  <span className={`text-[9px] px-1.5 py-0.5 border ${STATUS_COLORS[item.status] || STATUS_COLORS.in_storage}`}>
                    {(item.status || 'unknown').replace(/_/g, ' ').toUpperCase()}
                  </span>
                </div>
                <div className="text-[10px] text-rmpg-300 truncate mt-0.5">{item.description || 'No description'}</div>
                <div className="flex items-center gap-2 mt-1 text-[9px] text-rmpg-500">
                  <span className="flex items-center gap-1">
                    <Tag style={{ width: 9, height: 9 }} />
                    {TYPE_LABELS[item.type] || item.type}
                  </span>
                  {item.storage_location && (
                    <span className="flex items-center gap-1">
                      <Warehouse style={{ width: 9, height: 9 }} />
                      {item.storage_location}
                    </span>
                  )}
                </div>
              </button>
            ))
          )}
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-3 py-1.5 border-t border-rmpg-700 bg-surface-base">
            <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1} className="text-[10px] text-rmpg-400 disabled:opacity-30">← Prev</button>
            <span className="text-[9px] font-mono text-rmpg-500">Page {page}/{totalPages}</span>
            <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages} className="text-[10px] text-rmpg-400 disabled:opacity-30">Next →</button>
          </div>
        )}
      </div>

      {/* ── Right Panel: Detail ── */}
      <div className="flex-1 flex flex-col bg-surface-base">
        {selected ? (
          <>
            <PanelTitleBar title={selected.evidence_number || `Evidence #${selected.id}`} icon={Box}>
              <button
                onClick={() => { setChainAction('check_in'); setChainLocation(''); setChainNotes(''); setChainModalOpen(true); }}
                className="toolbar-btn toolbar-btn-primary"
              >
                <ArrowRightLeft style={{ width: 11, height: 11 }} />
                <span className="hidden sm:inline">Chain Action</span>
              </button>
            </PanelTitleBar>

            {/* Tabs */}
            <div className="flex border-b border-rmpg-700">
              {(['info', 'chain'] as const).map(tab => (
                <button
                  key={tab}
                  onClick={() => setDetailTab(tab)}
                  className={`px-4 py-1.5 text-[10px] font-bold uppercase tracking-wider transition-colors ${
                    detailTab === tab ? 'text-white border-b-2 border-brand-500 bg-brand-900/10' : 'text-rmpg-500 hover:text-rmpg-300'
                  }`}
                >
                  {tab === 'info' ? 'Details' : 'Chain of Custody'}
                </button>
              ))}
            </div>

            <div className="flex-1 overflow-y-auto p-4">
              {detailTab === 'info' ? (
                <div className="space-y-4">
                  {/* Status + Type */}
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`text-[10px] px-2 py-1 border font-bold ${STATUS_COLORS[selected.status] || ''}`}>
                      {(selected.status || '').replace(/_/g, ' ').toUpperCase()}
                    </span>
                    <span className="text-[10px] px-2 py-1 border bg-rmpg-700/50 text-rmpg-300 border-rmpg-600/50">
                      {TYPE_LABELS[selected.type] || selected.type}
                    </span>
                  </div>

                  {/* Detail grid */}
                  <div className="grid grid-cols-2 gap-3">
                    {[
                      ['Description', selected.description],
                      ['Storage Location', selected.storage_location],
                      ['Incident #', selected.incident_id ? `INC-${selected.incident_id}` : '—'],
                      ['Collected By', selected.collected_by_name || `Officer #${selected.collected_by || '—'}`],
                      ['Collection Date', selected.collected_date ? new Date(selected.collected_date).toLocaleDateString() : '—'],
                      ['Serial Number', selected.serial_number || '—'],
                      ['Make / Model', [selected.make, selected.model].filter(Boolean).join(' ') || '—'],
                      ['Quantity', selected.quantity || '1'],
                      ['Estimated Value', selected.estimated_value ? `$${Number(selected.estimated_value).toFixed(2)}` : '—'],
                    ].map(([label, value]) => (
                      <div key={label as string}>
                        <div className="text-[9px] font-mono text-rmpg-500 uppercase">{label}</div>
                        <div className="text-xs text-white mt-0.5">{value || '—'}</div>
                      </div>
                    ))}
                  </div>

                  {/* Notes */}
                  {selected.notes && (
                    <div className="panel-beveled p-3">
                      <div className="text-[9px] font-mono text-rmpg-500 uppercase mb-1">Notes</div>
                      <div className="text-xs text-rmpg-300 whitespace-pre-wrap">{selected.notes}</div>
                    </div>
                  )}
                </div>
              ) : (
                /* Chain of Custody Tab */
                <div className="space-y-2">
                  {chainOfCustody.length === 0 ? (
                    <div className="text-center py-8 text-rmpg-500 text-xs">No chain of custody entries yet</div>
                  ) : (
                    chainOfCustody.slice().reverse().map((entry: any, idx: number) => (
                      <div key={idx} className="panel-beveled p-3 flex gap-3">
                        <div className="flex-shrink-0 w-8 h-8 flex items-center justify-center bg-surface-sunken border border-rmpg-700 text-sm">
                          {CHAIN_ACTIONS.find(a => a.value === entry.action)?.icon || '📋'}
                        </div>
                        <div className="flex-1">
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-bold text-white">
                              {CHAIN_ACTIONS.find(a => a.value === entry.action)?.label || entry.action}
                            </span>
                            <span className="text-[9px] font-mono text-rmpg-500">
                              {entry.timestamp ? new Date(entry.timestamp).toLocaleString() : ''}
                            </span>
                          </div>
                          <div className="text-[10px] text-rmpg-400 mt-0.5">
                            By: {entry.user_name || `User #${entry.user_id}`}
                          </div>
                          {(entry.from_location || entry.to_location) && (
                            <div className="text-[10px] text-rmpg-400">
                              {entry.from_location && <span>From: {entry.from_location}</span>}
                              {entry.from_location && entry.to_location && <span> → </span>}
                              {entry.to_location && <span>To: {entry.to_location}</span>}
                            </div>
                          )}
                          {entry.notes && <div className="text-[10px] text-rmpg-300 mt-1 italic">{entry.notes}</div>}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center">
              <Package className="w-10 h-10 text-rmpg-600 mx-auto mb-2" />
              <div className="text-xs text-rmpg-500">Select an evidence item to view details</div>
            </div>
          </div>
        )}
      </div>

      {/* ── Chain of Custody Action Modal ── */}
      {chainModalOpen && selected && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="panel-surface w-full max-w-md mx-4">
            <PanelTitleBar title="Record Chain of Custody Action" icon={ArrowRightLeft}>
              <button onClick={() => setChainModalOpen(false)} className="toolbar-btn"><X style={{ width: 12, height: 12 }} /></button>
            </PanelTitleBar>
            <div className="p-4 space-y-3">
              <div>
                <label className="text-[10px] font-mono text-rmpg-500 uppercase">Action</label>
                <select
                  value={chainAction}
                  onChange={e => setChainAction(e.target.value)}
                  className="w-full mt-1 px-2 py-1.5 text-xs bg-surface-sunken border border-rmpg-700 text-white outline-none"
                >
                  {CHAIN_ACTIONS.map(a => <option key={a.value} value={a.value}>{a.icon} {a.label}</option>)}
                </select>
              </div>

              {(chainAction === 'check_in' || chainAction === 'transfer') && (
                <div>
                  <label className="text-[10px] font-mono text-rmpg-500 uppercase">Destination Location</label>
                  <select
                    value={chainLocation}
                    onChange={e => setChainLocation(e.target.value)}
                    className="w-full mt-1 px-2 py-1.5 text-xs bg-surface-sunken border border-rmpg-700 text-white outline-none"
                  >
                    <option value="">Select location...</option>
                    {locations.map((l: any) => <option key={l.name} value={l.name}>{l.name}</option>)}
                  </select>
                </div>
              )}

              <div>
                <label className="text-[10px] font-mono text-rmpg-500 uppercase">Notes</label>
                <textarea
                  value={chainNotes}
                  onChange={e => setChainNotes(e.target.value)}
                  rows={3}
                  className="w-full mt-1 px-2 py-1.5 text-xs bg-surface-sunken border border-rmpg-700 text-white outline-none resize-none"
                  placeholder="Optional notes..."
                />
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-rmpg-700">
                <button onClick={() => setChainModalOpen(false)} className="toolbar-btn">Cancel</button>
                <button onClick={handleChainAction} disabled={chainSubmitting} className="toolbar-btn toolbar-btn-primary">
                  {chainSubmitting ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save style={{ width: 11, height: 11 }} />}
                  Record Action
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
