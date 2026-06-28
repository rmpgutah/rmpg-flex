import React, { useState, useEffect, useCallback } from 'react';
import {
  Search, Loader2, MessageSquareWarning, Eye, UserCheck, Link2,
  X, ChevronRight,
} from 'lucide-react';
import PanelTitleBar from '../components/PanelTitleBar';
import IconButton from '../components/IconButton';
import { apiFetch } from '../hooks/useApi';

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
  routine: 'text-[#888888]',
};

const STATUS_COLORS: Record<string, string> = {
  new: 'text-[#d4a017]',
  reviewed: 'text-blue-400',
  investigating: 'text-amber-400',
  actionable: 'text-green-400',
  closed: 'text-[#888888]',
  unfounded: 'text-red-400',
};

export default function TipsPage() {
  const [tips, setTips] = useState<Tip[]>([]);
  const [stats, setStats] = useState<TipStats>({ new_tips: 0, reviewed: 0, investigating: 0, actionable: 0 });
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterStatus, setFilterStatus] = useState('');

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
          { label: 'New', value: stats.new_tips, color: 'text-[#d4a017]' },
          { label: 'Reviewed', value: stats.reviewed, color: 'text-blue-400' },
          { label: 'Investigating', value: stats.investigating, color: 'text-amber-400' },
          { label: 'Actionable', value: stats.actionable, color: 'text-green-400' },
        ].map(s => (
          <div key={s.label} className="bg-[#141414] border border-[#222222] rounded-[2px] p-3">
            <div className={`text-lg font-bold ${s.color}`}>{s.value}</div>
            <div className="text-[10px] text-[#888888] uppercase tracking-wider">{s.label}</div>
          </div>
        ))}
      </div>

      {/* Search / Filter */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-4 h-4 text-[#888888]" />
          <input
            type="text"
            placeholder="Search tracking #, description..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="w-full pl-8 pr-3 py-1.5 bg-[#0a0a0a] border border-[#222222] rounded-[2px] text-white text-xs focus:border-[#d4a017] outline-none"
          />
        </div>
        <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}
          className="bg-[#0a0a0a] border border-[#222222] rounded-[2px] px-2 py-1.5 text-white text-xs focus:border-[#d4a017] outline-none">
          <option value="">All Status</option>
          {['new', 'reviewed', 'investigating', 'actionable', 'closed', 'unfounded'].map(s => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
      </div>

      {/* Main layout: Table + Detail Panel */}
      <div className="flex gap-4">
        {/* Table */}
        <div className={`bg-[#141414] border border-[#222222] rounded-[2px] overflow-hidden ${selectedTip ? 'flex-1' : 'w-full'}`}>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-[#222222]">
                  {['Tracking #', 'Date', 'Type', 'Description', 'Urgency', 'Status', 'Assigned To'].map(h => (
                    <th key={h} className="text-left px-3 py-[3px] text-[9px] font-semibold text-[#888888] uppercase tracking-wider">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={7} className="text-center py-8 text-[#888888]"><Loader2 className="w-5 h-5 animate-spin mx-auto" /></td></tr>
                ) : tips.length === 0 ? (
                  <tr><td colSpan={7} className="text-center py-8 text-[#888888]">No tips found</td></tr>
                ) : tips.map(tip => (
                  <tr
                    key={tip.id}
                    onClick={() => handleSelectTip(tip)}
                    className={`border-b border-[#1a1a1a] hover:bg-[#1a1a1a] cursor-pointer
                      ${selectedTip?.id === tip.id ? 'bg-[#1a1a1a]' : ''}`}
                  >
                    <td className="px-3 py-[2px] text-[#d4a017] font-mono">{tip.tracking_number}</td>
                    <td className="px-3 py-[2px] text-[#888888]">{tip.received_at}</td>
                    <td className="px-3 py-[2px] text-[#888888] capitalize">{tip.tip_type.replace(/_/g, ' ')}</td>
                    <td className="px-3 py-[2px] text-[#888888] max-w-[200px] truncate">{tip.description}</td>
                    <td className={`px-3 py-[2px] font-semibold capitalize ${URGENCY_COLORS[tip.urgency] || 'text-[#888888]'}`}>
                      {tip.urgency}
                    </td>
                    <td className={`px-3 py-[2px] font-semibold capitalize ${STATUS_COLORS[tip.status] || 'text-[#888888]'}`}>
                      {tip.status}
                    </td>
                    <td className="px-3 py-[2px] text-[#888888]">{tip.assigned_to_name || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* ═══ Detail Panel ═══ */}
        {selectedTip && (
          <div className="w-[380px] shrink-0 bg-[#141414] border border-[#222222] rounded-[2px] overflow-y-auto max-h-[70vh]">
            <div className="flex items-center justify-between px-4 py-2 border-b border-[#222222]">
              <span className="text-sm font-semibold text-[#d4a017]">{selectedTip.tracking_number}</span>
              <IconButton aria-label="Close detail panel" onClick={() => setSelectedTip(null)}>
                <X className="w-4 h-4 text-[#888888]" />
              </IconButton>
            </div>

            <div className="p-4 space-y-4">
              {/* Metadata */}
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div>
                  <span className="text-[10px] text-[#888888] uppercase block">Date</span>
                  <span className="text-white">{selectedTip.received_at}</span>
                </div>
                <div>
                  <span className="text-[10px] text-[#888888] uppercase block">Type</span>
                  <span className="text-white capitalize">{selectedTip.tip_type.replace(/_/g, ' ')}</span>
                </div>
                <div>
                  <span className="text-[10px] text-[#888888] uppercase block">Urgency</span>
                  <span className={`font-semibold capitalize ${URGENCY_COLORS[selectedTip.urgency] || 'text-white'}`}>
                    {selectedTip.urgency}
                  </span>
                </div>
                <div>
                  <span className="text-[10px] text-[#888888] uppercase block">Status</span>
                  <span className={`font-semibold capitalize ${STATUS_COLORS[selectedTip.status] || 'text-white'}`}>
                    {selectedTip.status}
                  </span>
                </div>
                <div>
                  <span className="text-[10px] text-[#888888] uppercase block">Source</span>
                  <span className="text-white">{selectedTip.source || '—'}</span>
                </div>
                <div>
                  <span className="text-[10px] text-[#888888] uppercase block">Location</span>
                  <span className="text-white">{selectedTip.location || '—'}</span>
                </div>
              </div>

              {/* Full description */}
              <div>
                <span className="text-[10px] text-[#888888] uppercase block mb-1">Description</span>
                <div className="text-xs text-white bg-[#0a0a0a] border border-[#1a1a1a] rounded-[2px] p-2 whitespace-pre-wrap">
                  {selectedTip.description}
                </div>
              </div>

              {/* Assignment */}
              <div>
                <span className="text-[10px] text-[#888888] uppercase block mb-1">Assigned To</span>
                <div className="text-xs text-white">{selectedTip.assigned_to_name || 'Unassigned'}</div>
              </div>

              {/* Linked case */}
              {selectedTip.linked_case_number && (
                <div>
                  <span className="text-[10px] text-[#888888] uppercase block mb-1">Linked Case</span>
                  <div className="text-xs text-[#d4a017] font-mono">{selectedTip.linked_case_number}</div>
                </div>
              )}

              {/* Notes */}
              {selectedTip.notes && (
                <div>
                  <span className="text-[10px] text-[#888888] uppercase block mb-1">Notes</span>
                  <div className="text-xs text-[#888888] bg-[#0a0a0a] border border-[#1a1a1a] rounded-[2px] p-2 whitespace-pre-wrap">
                    {selectedTip.notes}
                  </div>
                </div>
              )}

              {/* Status actions */}
              <div className="border-t border-[#222222] pt-3 space-y-2">
                <span className="text-[10px] text-[#888888] uppercase block">Update Status</span>
                <div className="flex flex-wrap gap-1">
                  {['reviewed', 'investigating', 'actionable', 'closed', 'unfounded'].map(s => (
                    <button
                      key={s}
                      onClick={() => handleUpdateStatus(selectedTip.id, s)}
                      disabled={selectedTip.status === s}
                      className={`px-2 py-1 text-[10px] rounded-[2px] border capitalize
                        ${selectedTip.status === s
                          ? 'bg-[#d4a017]/20 border-[#d4a017] text-[#d4a017]'
                          : 'bg-[#0a0a0a] border-[#222222] text-[#888888] hover:text-white hover:border-[#d4a017]'}`}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>

              {/* Assign button */}
              <div className="border-t border-[#222222] pt-3">
                {!assignOpen ? (
                  <button onClick={() => setAssignOpen(true)}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-[#0a0a0a] border border-[#222222] rounded-[2px] text-xs text-white hover:border-[#d4a017] w-full justify-center">
                    <UserCheck className="w-3.5 h-3.5" /> Assign to Investigator
                  </button>
                ) : (
                  <div className="space-y-2">
                    <select value={assignTo} onChange={e => setAssignTo(e.target.value)}
                      className="w-full px-2 py-1.5 bg-[#0a0a0a] border border-[#222222] rounded-[2px] text-white text-xs focus:border-[#d4a017] outline-none">
                      <option value="">Select investigator...</option>
                      {investigators.map(inv => (
                        <option key={inv.id} value={inv.id}>{inv.name}</option>
                      ))}
                    </select>
                    <div className="flex gap-2">
                      <button onClick={() => setAssignOpen(false)} className="flex-1 px-2 py-1 bg-[#0a0a0a] border border-[#222222] rounded-[2px] text-xs text-[#888888] hover:text-white">Cancel</button>
                      <button onClick={handleAssign} disabled={assigning || !assignTo}
                        className="flex-1 px-2 py-1 bg-[#d4a017] text-black text-xs font-semibold rounded-[2px] hover:bg-[#b8891a] disabled:opacity-50">
                        {assigning ? 'Assigning...' : 'Assign'}
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* Link to case */}
              <div className="border-t border-[#222222] pt-3">
                {!linkOpen ? (
                  <button onClick={() => setLinkOpen(true)}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-[#0a0a0a] border border-[#222222] rounded-[2px] text-xs text-white hover:border-[#d4a017] w-full justify-center">
                    <Link2 className="w-3.5 h-3.5" /> Link to Case
                  </button>
                ) : (
                  <div className="space-y-2">
                    <input
                      type="text"
                      placeholder="Enter case number..."
                      value={linkCaseNumber}
                      onChange={e => setLinkCaseNumber(e.target.value)}
                      className="w-full px-2 py-1.5 bg-[#0a0a0a] border border-[#222222] rounded-[2px] text-white text-xs font-mono focus:border-[#d4a017] outline-none"
                    />
                    <div className="flex gap-2">
                      <button onClick={() => setLinkOpen(false)} className="flex-1 px-2 py-1 bg-[#0a0a0a] border border-[#222222] rounded-[2px] text-xs text-[#888888] hover:text-white">Cancel</button>
                      <button onClick={handleLinkCase} disabled={linking || !linkCaseNumber}
                        className="flex-1 px-2 py-1 bg-[#d4a017] text-black text-xs font-semibold rounded-[2px] hover:bg-[#b8891a] disabled:opacity-50">
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
