import React, { useState, useEffect, useCallback } from 'react';
import {
  Search, Loader2, MessageSquareWarning, UserCheck, Link2,
  X, Copy, Download,
} from 'lucide-react';
import PanelTitleBar from '../components/PanelTitleBar';
import IconButton from '../components/IconButton';
import { apiFetch } from '../hooks/useApi';
import { formatEnumValue, toDisplayLabel } from '../utils/formatters';
import { downloadTextFile, tipsToCsv } from '../utils/rmsListExport';

// ── Types ──
interface Tip {
  id: number;
  tracking_number: string;
  received_at: string;
  tip_type: string;
  description: string;
  urgency: string;
  status: string;
  assigned_to: string | null;
  assigned_to_name: string | null;
  source: string;
  location: string;
  linked_case_id: number | null;
  linked_case_number: string | null;
  notes: string;
  reviewed_at: string | null;
  reviewed_by: string | null;
}

interface TipStats {
  new_tips: number;
  reviewed: number;
  investigating: number;
  actionable: number;
}

interface Investigator {
  id: number;
  name: string;
  username: string;
}

const TIP_TYPES = ['criminal_activity', 'drug_activity', 'theft', 'fraud', 'missing_person', 'suspicious_activity', 'weapon', 'domestic', 'gang', 'other'];

const URGENCY_COLORS: Record<string, string> = {
  immediate: 'text-red-400',
  urgent: 'text-amber-400',
  routine: 'text-rmpg-400',
};

const STATUS_COLORS: Record<string, string> = {
  new: '[color:var(--panel-header-color)]',
  reviewed: 'text-blue-400',
  investigating: 'text-amber-400',
  actionable: 'text-green-400',
  closed: 'text-rmpg-400',
  unfounded: 'text-red-400',
};

export default function TipsPage() {
  const [tips, setTips] = useState<Tip[]>([]);
  const [stats, setStats] = useState<TipStats>({ new_tips: 0, reviewed: 0, investigating: 0, actionable: 0 });
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [filterType, setFilterType] = useState('');
  const [filterUrgency, setFilterUrgency] = useState('');

  // ── Detail panel state ──
  const [selectedTip, setSelectedTip] = useState<Tip | null>(null);

  // ── Assign state ──
  const [investigators, setInvestigators] = useState<Investigator[]>([]);
  const [assignOpen, setAssignOpen] = useState(false);
  const [assignTo, setAssignTo] = useState('');
  const [assigning, setAssigning] = useState(false);

  // ── Link case state ──
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkCaseNumber, setLinkCaseNumber] = useState('');
  const [linking, setLinking] = useState(false);

  // ── Fetch ──
  const fetchTips = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (searchQuery) params.set('search', searchQuery);
      if (filterStatus) params.set('status', filterStatus);
      const data = await apiFetch<{ data: Tip[]; stats: TipStats }>(`/tips?${params}`);
      setTips(data.data || []);
      setStats(data.stats || { new_tips: 0, reviewed: 0, investigating: 0, actionable: 0 });
    } catch { /* empty */ }
    finally { setLoading(false); }
  }, [searchQuery, filterStatus]);

  useEffect(() => { fetchTips(); }, [fetchTips]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && selectedTip) {
        setSelectedTip(null);
        setAssignOpen(false);
        setLinkOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectedTip]);

  // Fetch investigators for assignment
  useEffect(() => {
    apiFetch<Investigator[]>('/tips/investigators')
      .then(data => setInvestigators(Array.isArray(data) ? data : []))
      .catch(() => {});
  }, []);

  const handleSelectTip = (tip: Tip) => {
    setSelectedTip(tip);
    setAssignOpen(false);
    setLinkOpen(false);
  };

  const handleUpdateStatus = async (tipId: number, status: string) => {
    try {
      await apiFetch(`/tips/${tipId}/status`, {
        method: 'PUT',
        body: JSON.stringify({ status }),
      });
      fetchTips();
      if (selectedTip?.id === tipId) {
        setSelectedTip(prev => prev ? { ...prev, status } : null);
      }
    } catch { /* error */ }
  };

  const handleAssign = async () => {
    if (!selectedTip || !assignTo) return;
    setAssigning(true);
    try {
      await apiFetch(`/tips/${selectedTip.id}/assign`, {
        method: 'PUT',
        body: JSON.stringify({ assigned_to: assignTo }),
      });
      setAssignOpen(false);
      fetchTips();
      const inv = investigators.find(i => String(i.id) === assignTo);
      setSelectedTip(prev => prev ? { ...prev, assigned_to: assignTo, assigned_to_name: inv?.name || null } : null);
    } catch { /* error */ }
    finally { setAssigning(false); }
  };

  const visibleTips = tips.filter((t) => {
    if (filterType && t.tip_type !== filterType) return false;
    if (filterUrgency && t.urgency !== filterUrgency) return false;
    return true;
  });

  const copyTracking = (num: string) => {
    navigator.clipboard.writeText(num).catch(() => undefined);
  };

  const handleLinkCase = async () => {
    if (!selectedTip || !linkCaseNumber) return;
    setLinking(true);
    try {
      await apiFetch(`/tips/${selectedTip.id}/link-case`, {
        method: 'PUT',
        body: JSON.stringify({ case_number: linkCaseNumber }),
      });
      setLinkOpen(false);
      fetchTips();
    } catch { /* error */ }
    finally { setLinking(false); }
  };

  return (
    <div className="p-4 space-y-4">
      <PanelTitleBar title="ANONYMOUS TIPS" icon={MessageSquareWarning} />

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: 'New', value: stats.new_tips, color: '[color:var(--panel-header-color)]', status: 'new' },
          { label: 'Reviewed', value: stats.reviewed, color: 'text-blue-400', status: 'reviewed' },
          { label: 'Investigating', value: stats.investigating, color: 'text-amber-400', status: 'investigating' },
          { label: 'Actionable', value: stats.actionable, color: 'text-green-400', status: 'actionable' },
        ].map(s => (
          <button
            type="button"
            key={s.label}
            onClick={() => setFilterStatus(filterStatus === s.status ? '' : s.status)}
            className={`bg-surface-raised border rounded-[2px] p-3 text-left ${filterStatus === s.status ? 'border-accent-silver-600' : 'border-border-default'}`}
          >
            <div className={`text-lg font-bold ${s.color}`}>{s.value}</div>
            <div className="text-[10px] text-rmpg-400 uppercase tracking-wider">{s.label}</div>
          </button>
        ))}
      </div>

      {/* Search / Filter */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-4 h-4 text-accent-silver-500" />
          <input
            type="text"
            placeholder="Search tracking #, description..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="w-full pl-8 pr-3 py-1.5 bg-surface-sunken border border-border-default rounded-[2px] text-white text-xs focus:border-accent-silver-600 outline-none"
          />
        </div>
        <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}
          className="bg-surface-sunken border border-border-default rounded-[2px] px-2 py-1.5 text-white text-xs focus:border-accent-silver-600 outline-none">
          <option value="">All Status</option>
          {['new', 'reviewed', 'investigating', 'actionable', 'closed', 'unfounded'].map(s => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
        <select value={filterType} onChange={e => setFilterType(e.target.value)}
          className="bg-surface-sunken border border-border-default rounded-[2px] px-2 py-1.5 text-white text-xs focus:border-accent-silver-600 outline-none">
          <option value="">All Types</option>
          {TIP_TYPES.map(s => (
            <option key={s} value={s}>{toDisplayLabel(s)}</option>
          ))}
        </select>
        <select value={filterUrgency} onChange={e => setFilterUrgency(e.target.value)}
          className="bg-surface-sunken border border-border-default rounded-[2px] px-2 py-1.5 text-white text-xs focus:border-accent-silver-600 outline-none">
          <option value="">All Urgency</option>
          {['immediate', 'urgent', 'routine'].map(s => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
        <button
          type="button"
          disabled={visibleTips.length === 0}
          onClick={() => downloadTextFile('tips.csv', tipsToCsv(visibleTips))}
          className="flex items-center gap-1 px-2 py-1.5 text-xs border border-border-default rounded-[2px] text-rmpg-100 disabled:opacity-40"
        >
          <Download className="w-3 h-3" /> CSV
        </button>
      </div>

      {/* Main layout: Table + Detail Panel */}
      <div className="flex gap-4">
        {/* Table */}
        <div className={`bg-surface-raised border border-border-default rounded-[2px] overflow-hidden ${selectedTip ? 'flex-1' : 'w-full'}`}>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border-subtle">
                  {['Tracking #', 'Date', 'Type', 'Description', 'Urgency', 'Status', 'Assigned To'].map(h => (
                    <th key={h} className="text-left px-3 py-[3px] text-[9px] font-semibold text-rmpg-400 uppercase tracking-wider">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={7} className="text-center py-8 text-rmpg-400"><Loader2 className="w-5 h-5 animate-spin mx-auto" /></td></tr>
                ) : visibleTips.length === 0 ? (
                  <tr><td colSpan={7} className="text-center py-8 text-rmpg-400">No tips found</td></tr>
                ) : visibleTips.map(tip => (
                  <tr
                    key={tip.id}
                    onClick={() => handleSelectTip(tip)}
                    className={`border-b border-border-subtle hover:bg-surface-hover cursor-pointer
                      ${selectedTip?.id === tip.id ? 'bg-surface-hover' : ''}`}
                  >
                    <td className="px-3 py-[2px] text-rmpg-100 font-mono">{tip.tracking_number}</td>
                    <td className="px-3 py-[2px] text-rmpg-400">{tip.received_at}</td>
                    <td className="px-3 py-[2px] text-rmpg-400 capitalize">{toDisplayLabel(tip.tip_type)}</td>
                    <td className="px-3 py-[2px] text-rmpg-400 max-w-[200px] truncate">{tip.description}</td>
                    <td className={`px-3 py-[2px] font-semibold capitalize ${URGENCY_COLORS[tip.urgency] || 'text-rmpg-400'}`}>
                      {tip.urgency}
                    </td>
                    <td className={`px-3 py-[2px] font-semibold capitalize ${STATUS_COLORS[tip.status] || 'text-rmpg-400'}`}>
                      {formatEnumValue(tip.status)}
                    </td>
                    <td className="px-3 py-[2px] text-rmpg-400">{tip.assigned_to_name || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* ═══ Detail Panel ═══ */}
        {selectedTip && (
          <div className="w-[380px] shrink-0 bg-surface-raised border border-border-default rounded-[2px] overflow-y-auto max-h-[70vh]">
            <div className="flex items-center justify-between px-4 py-2 border-b border-border-subtle">
              <span className="text-sm font-semibold text-[color:var(--panel-header-color)]">{selectedTip.tracking_number}</span>
              <div className="flex items-center gap-1">
              <IconButton aria-label="Copy tracking number" onClick={() => copyTracking(selectedTip.tracking_number)}>
                <Copy className="w-4 h-4 text-accent-silver-500" />
              </IconButton>
              <IconButton aria-label="Close detail panel" onClick={() => setSelectedTip(null)}>
                <X className="w-4 h-4 text-accent-silver-500" />
              </IconButton>
              </div>
            </div>

            <div className="p-4 space-y-4">
              {/* Metadata */}
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div>
                  <span className="text-[10px] text-rmpg-400 uppercase block">Date</span>
                  <span className="text-white">{selectedTip.received_at}</span>
                </div>
                <div>
                  <span className="text-[10px] text-rmpg-400 uppercase block">Type</span>
                  <span className="text-white capitalize">{toDisplayLabel(selectedTip.tip_type)}</span>
                </div>
                <div>
                  <span className="text-[10px] text-rmpg-400 uppercase block">Urgency</span>
                  <span className={`font-semibold capitalize ${URGENCY_COLORS[selectedTip.urgency] || 'text-white'}`}>
                    {selectedTip.urgency}
                  </span>
                </div>
                <div>
                  <span className="text-[10px] text-rmpg-400 uppercase block">Status</span>
                  <span className={`font-semibold capitalize ${STATUS_COLORS[selectedTip.status] || 'text-white'}`}>
                    {formatEnumValue(selectedTip.status)}
                  </span>
                </div>
                <div>
                  <span className="text-[10px] text-rmpg-400 uppercase block">Source</span>
                  <span className="text-white">{selectedTip.source || '—'}</span>
                </div>
                <div>
                  <span className="text-[10px] text-rmpg-400 uppercase block">Location</span>
                  <span className="text-white">{selectedTip.location || '—'}</span>
                </div>
              </div>

              {/* Full description */}
              <div>
                <span className="text-[10px] text-rmpg-400 uppercase block mb-1">Description</span>
                <div className="text-xs text-white bg-surface-sunken border border-border-subtle rounded-[2px] p-2 whitespace-pre-wrap">
                  {selectedTip.description}
                </div>
              </div>

              {/* Assignment */}
              <div>
                <span className="text-[10px] text-rmpg-400 uppercase block mb-1">Assigned To</span>
                <div className="text-xs text-white">{selectedTip.assigned_to_name || 'Unassigned'}</div>
              </div>

              {/* Linked case */}
              {selectedTip.linked_case_number && (
                <div>
                  <span className="text-[10px] text-rmpg-400 uppercase block mb-1">Linked Case</span>
                  <div className="text-xs text-rmpg-100 font-mono">{selectedTip.linked_case_number}</div>
                </div>
              )}

              {/* Notes */}
              {selectedTip.notes && (
                <div>
                  <span className="text-[10px] text-rmpg-400 uppercase block mb-1">Notes</span>
                  <div className="text-xs text-rmpg-400 bg-surface-sunken border border-border-subtle rounded-[2px] p-2 whitespace-pre-wrap">
                    {selectedTip.notes}
                  </div>
                </div>
              )}

              {/* Status actions */}
              <div className="border-t border-border-subtle pt-3 space-y-2">
                <span className="text-[10px] text-rmpg-400 uppercase block">Update Status</span>
                <div className="flex flex-wrap gap-1">
                  {['reviewed', 'investigating', 'actionable', 'closed', 'unfounded'].map(s => (
                    <button
                      key={s}
                      onClick={() => handleUpdateStatus(selectedTip.id, s)}
                      disabled={selectedTip.status === s}
                      className={`px-2 py-1 text-[10px] rounded-[2px] border capitalize
                        ${selectedTip.status === s
                          ? 'bg-accent-silver-500/20 border-accent-silver-600 text-accent-silver-500'
                          : 'bg-surface-sunken border-border-default text-rmpg-400 hover:text-white hover:border-accent-silver-600'}`}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>

              {/* Assign button */}
              <div className="border-t border-border-subtle pt-3">
                {!assignOpen ? (
                  <button onClick={() => setAssignOpen(true)}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-surface-sunken border border-border-default rounded-[2px] text-xs text-white hover:border-accent-silver-600 w-full justify-center">
                    <UserCheck className="w-3.5 h-3.5" /> Assign to Investigator
                  </button>
                ) : (
                  <div className="space-y-2">
                    <select value={assignTo} onChange={e => setAssignTo(e.target.value)}
                      className="w-full px-2 py-1.5 bg-surface-sunken border border-border-default rounded-[2px] text-white text-xs focus:border-accent-silver-600 outline-none">
                      <option value="">Select investigator...</option>
                      {investigators.map(inv => (
                        <option key={inv.id} value={inv.id}>{inv.name}</option>
                      ))}
                    </select>
                    <div className="flex gap-2">
                      <button onClick={() => setAssignOpen(false)} className="flex-1 px-2 py-1 bg-surface-sunken border border-border-default rounded-[2px] text-xs text-rmpg-400 hover:text-white">Cancel</button>
                      <button onClick={handleAssign} disabled={assigning || !assignTo}
                        className="flex-1 px-2 py-1 bg-accent-silver-500 text-black text-xs font-semibold rounded-[2px] hover:bg-accent-silver-400 disabled:opacity-50">
                        {assigning ? 'Assigning...' : 'Assign'}
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* Link to case */}
              <div className="border-t border-border-subtle pt-3">
                {!linkOpen ? (
                  <button onClick={() => setLinkOpen(true)}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-surface-sunken border border-border-default rounded-[2px] text-xs text-white hover:border-accent-silver-600 w-full justify-center">
                    <Link2 className="w-3.5 h-3.5" /> Link to Case
                  </button>
                ) : (
                  <div className="space-y-2">
                    <input
                      type="text"
                      placeholder="Enter case number..."
                      value={linkCaseNumber}
                      onChange={e => setLinkCaseNumber(e.target.value)}
                      className="w-full px-2 py-1.5 bg-surface-sunken border border-border-default rounded-[2px] text-white text-xs font-mono focus:border-accent-silver-600 outline-none"
                    />
                    <div className="flex gap-2">
                      <button onClick={() => setLinkOpen(false)} className="flex-1 px-2 py-1 bg-surface-sunken border border-border-default rounded-[2px] text-xs text-rmpg-400 hover:text-white">Cancel</button>
                      <button onClick={handleLinkCase} disabled={linking || !linkCaseNumber}
                        className="flex-1 px-2 py-1 bg-accent-silver-500 text-black text-xs font-semibold rounded-[2px] hover:bg-accent-silver-400 disabled:opacity-50">
                        {linking ? 'Linking...' : 'Link'}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
