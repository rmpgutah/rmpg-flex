// ============================================================
// RMPG Flex — CRM Overwatch: Leads Pipeline Tab
// Lead management, pipeline view, detail panel, bulk actions
// ============================================================

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Search,
  Plus,
  RefreshCw,
  Filter,
  X,
  ExternalLink,
  Save,
  Loader2,
  ChevronRight,
  CheckSquare,
  Square,
  ArrowRight,
  UserPlus,
  XCircle,
  FileText,
  Phone,
  Mail,
  MapPin,
  Building2,
  Clock,
  DollarSign,
  Target,
  MessageSquare,
  Send,
  AlertTriangle,
} from 'lucide-react';
import { apiFetch } from '../../hooks/useApi';
import { formatPhoneInput } from '../../utils/formatters';
import { useToast } from '../ToastProvider';
import PanelTitleBar from '../PanelTitleBar';
import ScraperAdminPanel from './ScraperAdminPanel';
import type {
  CrmLead,
  CrmLeadActivity,
  PipelineSummary,
  LeadScrapeSource,
  PipelineStage,
  LeadSource,
} from '../../types';

// ── Stage colors ──────────────────────────────────────────
const STAGE_COLORS: Record<PipelineStage, string> = {
  new: '#3b82f6',
  contacted: '#8b5cf6',
  qualified: '#d4a017',
  proposal: '#f59e0b',
  negotiation: '#f97316',
  won: '#22c55e',
  lost: '#ef4444',
  dismissed: '#6b7280',
};

const STAGE_BADGE_CLASSES: Record<PipelineStage, string> = {
  new: 'text-blue-400 bg-blue-900/30 border-blue-700/50',
  contacted: 'text-purple-400 bg-purple-900/30 border-purple-700/50',
  qualified: 'text-yellow-400 bg-yellow-900/30 border-yellow-700/50',
  proposal: 'text-amber-400 bg-amber-900/30 border-amber-700/50',
  negotiation: 'text-orange-400 bg-orange-900/30 border-orange-700/50',
  won: 'text-green-400 bg-green-900/30 border-green-700/50',
  lost: 'text-red-400 bg-red-900/30 border-red-700/50',
  dismissed: 'text-rmpg-400 bg-rmpg-800/30 border-rmpg-700/50',
};

const SOURCE_LABELS: Record<LeadSource, string> = {
  utah_biz: 'Utah Biz',
  construction_permit: 'Construction',
  commercial_re: 'Commercial RE',
  liquor_license: 'DABC Liquor',
  utah_bar: 'Utah Bar',
  ut_commerce_collections: 'UT Commerce',
  ut_consumer_protection: 'UT Consumer',
  ut_courts: 'UT Courts',
  google_places: 'Google Places',
  ut_real_estate_licenses: 'UT Real Estate',
  cfpb_complaints: 'CFPB Complaints',
  manual: 'Manual',
};

const SOURCE_BADGE_CLASSES: Record<LeadSource, string> = {
  utah_biz: 'text-cyan-400 bg-cyan-900/30 border-cyan-700/50',
  construction_permit: 'text-amber-400 bg-amber-900/30 border-amber-700/50',
  commercial_re: 'text-emerald-400 bg-emerald-900/30 border-emerald-700/50',
  liquor_license: 'text-purple-400 bg-purple-900/30 border-purple-700/50',
  utah_bar: 'text-blue-400 bg-blue-900/30 border-blue-700/50',
  ut_commerce_collections: 'text-orange-400 bg-orange-900/30 border-orange-700/50',
  ut_consumer_protection: 'text-rose-400 bg-rose-900/30 border-rose-700/50',
  ut_courts: 'text-indigo-400 bg-indigo-900/30 border-indigo-700/50',
  google_places: 'text-green-400 bg-green-900/30 border-green-700/50',
  ut_real_estate_licenses: 'text-teal-400 bg-teal-900/30 border-teal-700/50',
  cfpb_complaints: 'text-yellow-400 bg-yellow-900/30 border-yellow-700/50',
  manual: 'text-rmpg-300 bg-rmpg-800/30 border-rmpg-700/50',
};

const PIPELINE_STAGES: PipelineStage[] = ['new', 'contacted', 'qualified', 'proposal', 'negotiation', 'won', 'lost', 'dismissed'];

function formatCurrency(val: number | null | undefined): string {
  if (!val) return '$0';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(val);
}

function formatDate(d?: string | null): string {
  if (!d) return '\u2014';
  return new Date(d.includes('T') ? d : d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatDateTime(d?: string | null): string {
  if (!d) return '\u2014';
  return new Date(d.includes('T') ? d : d + 'T00:00:00').toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function toDisplayLabel(s: string): string {
  return s.replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase());
}

function scoreColor(score: number): string {
  if (score >= 80) return 'bg-green-500';
  if (score >= 60) return 'bg-yellow-500';
  if (score >= 40) return 'bg-amber-500';
  if (score >= 20) return 'bg-orange-500';
  return 'bg-red-500';
}

// ════════════════════════════════════════════════════════
// LEADS TAB
// ════════════════════════════════════════════════════════
export default function LeadsTab() {
  const { addToast } = useToast();

  // ── Data state ──────────────────────────────────────
  const [leads, setLeads] = useState<CrmLead[]>([]);
  const [pipelineSummary, setPipelineSummary] = useState<PipelineSummary[]>([]);
  const [selectedLead, setSelectedLead] = useState<CrmLead | null>(null);
  const [leadActivities, setLeadActivities] = useState<CrmLeadActivity[]>([]);
  const [scrapeSources, setScrapeSources] = useState<LeadScrapeSource[]>([]);

  // ── UI state ────────────────────────────────────────
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showScraperPanel, setShowScraperPanel] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<number | string>>(new Set());

  // ── Filters ─────────────────────────────────────────
  const [filterSource, setFilterSource] = useState<string>('');
  const [filterStage, setFilterStage] = useState<string>('');
  const [filterSearch, setFilterSearch] = useState('');
  const [filterScoreMin, setFilterScoreMin] = useState<string>('');
  const [filterService, setFilterService] = useState<string>('');

  // ── Detail panel editing ────────────────────────────
  const [editNotes, setEditNotes] = useState('');
  const [newNoteSubject, setNewNoteSubject] = useState('');
  const [newNoteDetails, setNewNoteDetails] = useState('');

  // ── Create modal form ───────────────────────────────
  const [createForm, setCreateForm] = useState({
    business_name: '',
    contact_name: '',
    contact_email: '',
    contact_phone: '',
    address: '',
    city: '',
    state: 'UT',
    zip: '',
    business_type: '',
    estimated_value: '',
    notes: '',
  });

  // ── Fetch leads ─────────────────────────────────────
  const fetchLeads = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (filterSource) params.set('source', filterSource);
      if (filterStage) params.set('pipeline_stage', filterStage);
      if (filterSearch) params.set('search', filterSearch);
      if (filterScoreMin) params.set('score_min', filterScoreMin);
      if (filterService) params.set('service_interest', filterService);
      const qs = params.toString();
      const data = await apiFetch<CrmLead[]>(`/crm/leads${qs ? `?${qs}` : ''}`);
      if (data) setLeads(Array.isArray(data) ? data : []);
    } catch {
      addToast('Failed to load leads', 'error');
    } finally {
      setLoading(false);
    }
  }, [filterSource, filterStage, filterSearch, filterScoreMin, filterService, addToast]);

  const fetchPipeline = useCallback(async () => {
    try {
      const data = await apiFetch<PipelineSummary[]>('/crm/leads/pipeline-summary');
      if (data) setPipelineSummary(Array.isArray(data) ? data : []);
    } catch { /* silent */ }
  }, []);

  useEffect(() => { fetchLeads(); }, [fetchLeads]);
  useEffect(() => { fetchPipeline(); }, [fetchPipeline]);

  // ── Fetch lead activities when selected ─────────────
  useEffect(() => {
    if (!selectedLead) { setLeadActivities([]); return; }
    setEditNotes(selectedLead.notes || '');
    (async () => {
      try {
        const data = await apiFetch<CrmLeadActivity[]>(`/crm/lead-activity/${selectedLead.id}`);
        if (data) setLeadActivities(data);
      } catch { /* silent */ }
    })();
  }, [selectedLead]);

  // ── Pipeline summary totals ─────────────────────────
  const pipelineTotal = useMemo(() => pipelineSummary.reduce((s, p) => s + p.count, 0), [pipelineSummary]);

  // ── Actions ─────────────────────────────────────────
  const handleStageChange = async (leadId: number | string, stage: PipelineStage) => {
    try {
      await apiFetch(`/crm/leads/${leadId}/stage`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stage }),
      });
      addToast(`Lead moved to ${toDisplayLabel(stage)}`, 'success');
      fetchLeads();
      fetchPipeline();
      if (selectedLead?.id === leadId) {
        setSelectedLead(prev => prev ? { ...prev, pipeline_stage: stage } : null);
      }
    } catch {
      addToast('Failed to update stage', 'error');
    }
  };

  const handleConvert = async (leadId: number | string) => {
    try {
      const result = await apiFetch<{ client_id: number }>(`/crm/leads/${leadId}/convert`, { method: 'POST' });
      if (result) {
        addToast('Lead converted to client', 'success');
        fetchLeads();
        fetchPipeline();
        setSelectedLead(null);
      }
    } catch {
      addToast('Failed to convert lead', 'error');
    }
  };

  const handleSaveNotes = async () => {
    if (!selectedLead) return;
    setSaving(true);
    try {
      await apiFetch(`/crm/leads/${selectedLead.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notes: editNotes }),
      });
      addToast('Notes saved', 'success');
      setSelectedLead(prev => prev ? { ...prev, notes: editNotes } : null);
    } catch {
      addToast('Failed to save notes', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleAddNote = async () => {
    if (!selectedLead || !newNoteSubject.trim()) return;
    try {
      await apiFetch('/crm/lead-activity', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lead_id: selectedLead.id,
          activity_type: 'note',
          subject: newNoteSubject.trim(),
          details: newNoteDetails.trim() || undefined,
        }),
      });
      setNewNoteSubject('');
      setNewNoteDetails('');
      // Refresh activities
      const data = await apiFetch<CrmLeadActivity[]>(`/crm/lead-activity/${selectedLead.id}`);
      if (data) setLeadActivities(data);
      addToast('Note added', 'success');
    } catch {
      addToast('Failed to add note', 'error');
    }
  };

  const handleBulkAction = async (action: string, assignedTo?: string) => {
    if (selectedIds.size === 0) return;
    try {
      await apiFetch('/crm/leads/bulk-action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action,
          lead_ids: Array.from(selectedIds),
          assigned_to: assignedTo,
        }),
      });
      addToast(`Bulk action "${action}" applied to ${selectedIds.size} leads`, 'success');
      setSelectedIds(new Set());
      fetchLeads();
      fetchPipeline();
    } catch {
      addToast('Bulk action failed', 'error');
    }
  };

  const handleCreateLead = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!createForm.business_name.trim()) return;
    setSaving(true);
    try {
      await apiFetch('/crm/leads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...createForm,
          source: 'manual',
          estimated_value: createForm.estimated_value ? Number(createForm.estimated_value) : undefined,
        }),
      });
      addToast('Lead created', 'success');
      setShowCreateModal(false);
      setCreateForm({ business_name: '', contact_name: '', contact_email: '', contact_phone: '', address: '', city: '', state: 'UT', zip: '', business_type: '', estimated_value: '', notes: '' });
      fetchLeads();
      fetchPipeline();
    } catch {
      addToast('Failed to create lead', 'error');
    } finally {
      setSaving(false);
    }
  };

  const toggleSelect = (id: number | string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === leads.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(leads.map(l => l.id)));
    }
  };

  // ════════════════════════════════════════════════════════
  // RENDER
  // ════════════════════════════════════════════════════════
  return (
    <div className="flex flex-col h-full">
      {/* ── Top bar ──────────────────────────────────── */}
      <div className="flex items-center gap-2 flex-wrap px-3 py-2 bg-[#141e2b] border-b border-rmpg-700">
        <div className="relative flex-1 min-w-[200px] max-w-xs">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-rmpg-400" />
          <input
            type="text"
            placeholder="Search leads..."
            value={filterSearch}
            onChange={e => setFilterSearch(e.target.value)}
            className="w-full bg-[#0d1520] border border-rmpg-700 text-white text-sm pl-7 pr-2 py-1.5 rounded-sm focus:border-brand-500 focus:outline-none"
          />
        </div>
        <select
          value={filterSource}
          onChange={e => setFilterSource(e.target.value)}
          className="bg-[#0d1520] border border-rmpg-700 text-white text-xs px-2 py-1.5 rounded-sm focus:border-brand-500 focus:outline-none"
        >
          <option value="">All Sources</option>
          <option value="utah_biz">Utah Biz</option>
          <option value="construction_permit">Construction Permits</option>
          <option value="commercial_re">Commercial RE</option>
          <option value="liquor_license">DABC Liquor</option>
          <option value="utah_bar">Utah Bar Attorneys</option>
          <option value="ut_commerce_collections">UT Commerce Collections</option>
          <option value="ut_consumer_protection">UT Consumer Protection</option>
          <option value="ut_courts">Utah Courts Filings</option>
          <option value="google_places">Google Places</option>
          <option value="ut_real_estate_licenses">UT Real Estate Licenses</option>
          <option value="cfpb_complaints">CFPB Complaints</option>
          <option value="manual">Manual</option>
        </select>
        <select
          value={filterService}
          onChange={e => setFilterService(e.target.value)}
          className="bg-[#0d1520] border border-rmpg-700 text-white text-xs px-2 py-1.5 rounded-sm focus:border-brand-500 focus:outline-none"
        >
          <option value="">All Services</option>
          <option value="process_serving">Process Serving</option>
          <option value="repo_security">Repo Security</option>
          <option value="skip_tracing">Skip Tracing</option>
        </select>
        <select
          value={filterStage}
          onChange={e => setFilterStage(e.target.value)}
          className="bg-[#0d1520] border border-rmpg-700 text-white text-xs px-2 py-1.5 rounded-sm focus:border-brand-500 focus:outline-none"
        >
          <option value="">All Stages</option>
          {PIPELINE_STAGES.map(s => (
            <option key={s} value={s}>{toDisplayLabel(s)}</option>
          ))}
        </select>
        <select
          value={filterScoreMin}
          onChange={e => setFilterScoreMin(e.target.value)}
          className="bg-[#0d1520] border border-rmpg-700 text-white text-xs px-2 py-1.5 rounded-sm focus:border-brand-500 focus:outline-none"
        >
          <option value="">Min Score</option>
          <option value="20">20+</option>
          <option value="40">40+</option>
          <option value="60">60+</option>
          <option value="80">80+</option>
        </select>
        <button type="button"
          onClick={() => setShowCreateModal(true)}
          className="bg-brand-600 hover:bg-brand-500 text-white text-xs font-bold px-3 py-1.5 rounded-sm flex items-center gap-1"
        >
          <Plus className="w-3.5 h-3.5" /> Add Lead
        </button>
        <button type="button"
          onClick={() => setShowScraperPanel(!showScraperPanel)}
          className={`text-xs font-bold px-3 py-1.5 rounded-sm flex items-center gap-1 border ${showScraperPanel ? 'bg-brand-600/20 border-brand-500 text-brand-400' : 'bg-[#0d1520] border-rmpg-700 text-rmpg-300 hover:border-rmpg-600'}`}
        >
          <RefreshCw className="w-3.5 h-3.5" /> Scrapers
        </button>
      </div>

      {/* ── Scraper admin panel (collapsible) ─────────── */}
      {showScraperPanel && (
        <ScraperAdminPanel onClose={() => setShowScraperPanel(false)} />
      )}

      {/* ── Pipeline summary bar ─────────────────────── */}
      {pipelineSummary.length > 0 && (
        <div className="px-3 py-2 bg-[#0d1520] border-b border-rmpg-700">
          <div className="flex h-6 rounded-sm overflow-hidden border border-rmpg-700">
            {pipelineSummary.map(ps => {
              const pct = pipelineTotal > 0 ? (ps.count / pipelineTotal) * 100 : 0;
              if (pct === 0) return null;
              return (
                <div
                  key={ps.stage}
                  className="flex items-center justify-center text-[10px] font-bold text-white/90 cursor-pointer hover:brightness-110 transition-all"
                  style={{ width: `${pct}%`, backgroundColor: STAGE_COLORS[ps.stage], minWidth: pct > 0 ? '28px' : 0 }}
                  title={`${toDisplayLabel(ps.stage)}: ${ps.count} leads, ${formatCurrency(ps.total_value)}`}
                  onClick={() => setFilterStage(ps.stage)}
                >
                  {ps.count}
                </div>
              );
            })}
          </div>
          <div className="flex gap-3 mt-1 flex-wrap">
            {pipelineSummary.map(ps => (
              <div key={ps.stage} className="flex items-center gap-1 text-[10px] text-rmpg-400">
                <span className="w-2 h-2 rounded-sm" style={{ backgroundColor: STAGE_COLORS[ps.stage] }} />
                {toDisplayLabel(ps.stage)}: {ps.count} ({formatCurrency(ps.total_value)})
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Bulk action bar ──────────────────────────── */}
      {selectedIds.size > 0 && (
        <div className="flex items-center gap-2 px-3 py-1.5 bg-brand-600/10 border-b border-brand-700/50">
          <span className="text-xs text-brand-400 font-bold">{selectedIds.size} selected</span>
          <button type="button" onClick={() => handleBulkAction('mark_contacted')} className="bg-purple-600/20 hover:bg-purple-600/30 text-purple-400 text-xs font-bold px-2 py-1 rounded-sm border border-purple-700/50">
            Mark Contacted
          </button>
          <button type="button" onClick={() => handleBulkAction('dismiss')} className="bg-rmpg-700/30 hover:bg-rmpg-700/50 text-rmpg-300 text-xs font-bold px-2 py-1 rounded-sm border border-rmpg-600/50">
            Dismiss
          </button>
          <button type="button" onClick={() => { setSelectedIds(new Set()); }} className="text-rmpg-400 hover:text-rmpg-200 text-xs ml-2">
            Clear Selection
          </button>
        </div>
      )}

      {/* ── Main content area ────────────────────────── */}
      <div className="flex flex-1 overflow-hidden">
        {/* ── Lead list table ──────────────────────── */}
        <div className={`flex-1 overflow-auto ${selectedLead ? 'border-r border-rmpg-700' : ''}`}>
          {loading ? (
            <div className="flex items-center justify-center h-32">
              <Loader2 className="w-5 h-5 text-brand-400 animate-spin" />
            </div>
          ) : leads.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-32 text-rmpg-400 text-sm">
              <Target className="w-6 h-6 mb-2 opacity-50" />
              No leads found
            </div>
          ) : (
            <table className="w-full">
              <thead>
                <tr className="bg-[#0d1520] border-b border-rmpg-700 sticky top-0 z-10">
                  <th className="text-[10px] text-rmpg-400 uppercase tracking-wider px-2 py-1.5 text-left w-8">
                    <button type="button" onClick={toggleSelectAll} className="text-rmpg-400 hover:text-white">
                      {selectedIds.size === leads.length && leads.length > 0 ? <CheckSquare className="w-3.5 h-3.5" /> : <Square className="w-3.5 h-3.5" />}
                    </button>
                  </th>
                  <th className="text-[10px] text-rmpg-400 uppercase tracking-wider px-2 py-1.5 text-left w-14">Score</th>
                  <th className="text-[10px] text-rmpg-400 uppercase tracking-wider px-2 py-1.5 text-left">Business</th>
                  <th className="text-[10px] text-rmpg-400 uppercase tracking-wider px-2 py-1.5 text-left">Source</th>
                  <th className="text-[10px] text-rmpg-400 uppercase tracking-wider px-2 py-1.5 text-left">Stage</th>
                  <th className="text-[10px] text-rmpg-400 uppercase tracking-wider px-2 py-1.5 text-left">Contact</th>
                  <th className="text-[10px] text-rmpg-400 uppercase tracking-wider px-2 py-1.5 text-left">City</th>
                  <th className="text-[10px] text-rmpg-400 uppercase tracking-wider px-2 py-1.5 text-right">Est. Value</th>
                  <th className="text-[10px] text-rmpg-400 uppercase tracking-wider px-2 py-1.5 text-left">Created</th>
                </tr>
              </thead>
              <tbody>
                {leads.map(lead => (
                  <tr
                    key={lead.id}
                    onClick={() => setSelectedLead(lead)}
                    className={`border-b border-rmpg-700/50 cursor-pointer transition-colors ${selectedLead?.id === lead.id ? 'bg-brand-600/10' : 'hover:bg-[#1a2636]'}`}
                  >
                    <td className="px-2 py-1.5" onClick={e => { e.stopPropagation(); toggleSelect(lead.id); }}>
                      {selectedIds.has(lead.id) ? <CheckSquare className="w-3.5 h-3.5 text-brand-400" /> : <Square className="w-3.5 h-3.5 text-rmpg-500" />}
                    </td>
                    <td className="px-2 py-1.5">
                      <div className="flex items-center gap-1">
                        <div className="w-8 h-1.5 bg-rmpg-800 rounded-sm overflow-hidden">
                          <div className={`h-full ${scoreColor(lead.lead_score)} rounded-sm`} style={{ width: `${lead.lead_score}%` }} />
                        </div>
                        <span className="text-[10px] text-rmpg-400 font-mono">{lead.lead_score}</span>
                      </div>
                    </td>
                    <td className="px-2 py-1.5 text-xs text-white font-medium truncate max-w-[200px]">{lead.business_name}</td>
                    <td className="px-2 py-1.5">
                      <span className={`text-[10px] px-1.5 py-0.5 rounded-sm border ${SOURCE_BADGE_CLASSES[lead.source as LeadSource] || 'text-rmpg-400 bg-rmpg-800/30 border-rmpg-700/50'}`}>
                        {SOURCE_LABELS[lead.source as LeadSource] || lead.source}
                      </span>
                    </td>
                    <td className="px-2 py-1.5">
                      <span className={`text-[10px] px-1.5 py-0.5 rounded-sm border ${STAGE_BADGE_CLASSES[lead.pipeline_stage]}`}>
                        {toDisplayLabel(lead.pipeline_stage)}
                      </span>
                    </td>
                    <td className="px-2 py-1.5 text-xs text-rmpg-300 truncate max-w-[140px]">{lead.contact_name || '\u2014'}</td>
                    <td className="px-2 py-1.5 text-xs text-rmpg-300">{lead.city || '\u2014'}</td>
                    <td className="px-2 py-1.5 text-xs text-rmpg-300 text-right font-mono">{lead.estimated_value ? formatCurrency(lead.estimated_value) : '\u2014'}</td>
                    <td className="px-2 py-1.5 text-[10px] text-rmpg-400">{formatDate(lead.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* ── Lead detail side panel ───────────────── */}
        {selectedLead && (
          <div className="w-[380px] min-w-[340px] overflow-y-auto bg-[#141e2b] flex flex-col">
            {/* Header */}
            <div className="px-3 py-2 bg-[#0d1520] border-b border-rmpg-700 flex items-center gap-2">
              <div className="flex-1 min-w-0">
                <h3 className="text-sm font-bold text-white truncate">{selectedLead.business_name}</h3>
                <div className="flex items-center gap-2 mt-0.5">
                  <span className={`text-[10px] px-1.5 py-0.5 rounded-sm border ${STAGE_BADGE_CLASSES[selectedLead.pipeline_stage]}`}>
                    {toDisplayLabel(selectedLead.pipeline_stage)}
                  </span>
                  <span className="text-[10px] text-rmpg-400 font-mono">Score: {selectedLead.lead_score}</span>
                </div>
              </div>
              <button type="button" onClick={() => setSelectedLead(null)} className="text-rmpg-400 hover:text-white">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-3 space-y-3">
              {/* Stage change */}
              <div>
                <label className="text-[10px] text-rmpg-400 uppercase tracking-wider block mb-1">Move to Stage</label>
                <select
                  value={selectedLead.pipeline_stage}
                  onChange={e => handleStageChange(selectedLead.id, e.target.value as PipelineStage)}
                  className="w-full bg-[#0d1520] border border-rmpg-700 text-white text-xs px-2 py-1.5 rounded-sm focus:border-brand-500 focus:outline-none"
                >
                  {PIPELINE_STAGES.map(s => (
                    <option key={s} value={s}>{toDisplayLabel(s)}</option>
                  ))}
                </select>
              </div>

              {/* Contact info */}
              <div className="panel-beveled p-2 space-y-1.5">
                <div className="text-[10px] text-rmpg-400 uppercase tracking-wider mb-1">Contact</div>
                {selectedLead.contact_name && (
                  <div className="flex items-center gap-1.5 text-xs text-rmpg-300">
                    <UserPlus className="w-3 h-3 text-rmpg-500" /> {selectedLead.contact_name}
                    {selectedLead.contact_title && <span className="text-rmpg-500">({selectedLead.contact_title})</span>}
                  </div>
                )}
                {selectedLead.contact_email && (
                  <div className="flex items-center gap-1.5 text-xs text-rmpg-300">
                    <Mail className="w-3 h-3 text-rmpg-500" />
                    <a href={`mailto:${selectedLead.contact_email}`} className="text-brand-400 hover:underline">{selectedLead.contact_email}</a>
                  </div>
                )}
                {selectedLead.contact_phone && (
                  <div className="flex items-center gap-1.5 text-xs text-rmpg-300">
                    <Phone className="w-3 h-3 text-rmpg-500" /> {selectedLead.contact_phone}
                  </div>
                )}
              </div>

              {/* Address */}
              {(selectedLead.address || selectedLead.city) && (
                <div className="panel-beveled p-2 space-y-1">
                  <div className="text-[10px] text-rmpg-400 uppercase tracking-wider mb-1">Address</div>
                  <div className="flex items-start gap-1.5 text-xs text-rmpg-300">
                    <MapPin className="w-3 h-3 text-rmpg-500 mt-0.5 shrink-0" />
                    <div>
                      {selectedLead.address && <div>{selectedLead.address}</div>}
                      {(selectedLead.city || selectedLead.state || selectedLead.zip) && (
                        <div>{[selectedLead.city, selectedLead.state].filter(Boolean).join(', ')} {selectedLead.zip}</div>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* Source info */}
              <div className="panel-beveled p-2 space-y-1">
                <div className="text-[10px] text-rmpg-400 uppercase tracking-wider mb-1">Source</div>
                <div className="flex items-center gap-2">
                  <span className={`text-[10px] px-1.5 py-0.5 rounded-sm border ${SOURCE_BADGE_CLASSES[selectedLead.source as LeadSource] || 'text-rmpg-400 bg-rmpg-800/30 border-rmpg-700/50'}`}>
                    {SOURCE_LABELS[selectedLead.source as LeadSource] || selectedLead.source}
                  </span>
                  {selectedLead.source_id && <span className="text-[10px] text-rmpg-400 font-mono">#{selectedLead.source_id}</span>}
                </div>
                {selectedLead.source_url && (
                  <a href={/^https?:\/\//i.test(selectedLead.source_url) ? selectedLead.source_url : '#'} target="_blank" rel="noopener noreferrer" className="text-[10px] text-brand-400 hover:underline flex items-center gap-1">
                    <ExternalLink className="w-3 h-3" /> View Source
                  </a>
                )}
              </div>

              {/* Details */}
              <div className="panel-beveled p-2 space-y-1">
                <div className="text-[10px] text-rmpg-400 uppercase tracking-wider mb-1">Details</div>
                {selectedLead.estimated_value && (
                  <div className="flex items-center gap-1.5 text-xs text-rmpg-300">
                    <DollarSign className="w-3 h-3 text-rmpg-500" /> Est. Value: <span className="font-mono text-green-400">{formatCurrency(selectedLead.estimated_value)}</span>
                  </div>
                )}
                {selectedLead.business_type && (
                  <div className="flex items-center gap-1.5 text-xs text-rmpg-300">
                    <Building2 className="w-3 h-3 text-rmpg-500" /> {selectedLead.business_type}
                  </div>
                )}
                {selectedLead.industry && (
                  <div className="text-xs text-rmpg-300">Industry: {selectedLead.industry}</div>
                )}
                {selectedLead.permit_number && (
                  <div className="text-xs text-rmpg-300">Permit: {selectedLead.permit_number}</div>
                )}
                {selectedLead.license_number && (
                  <div className="text-xs text-rmpg-300">License: {selectedLead.license_number}</div>
                )}
                {selectedLead.next_follow_up && (
                  <div className="flex items-center gap-1.5 text-xs text-amber-400">
                    <Clock className="w-3 h-3" /> Follow up: {formatDate(selectedLead.next_follow_up)}
                  </div>
                )}
              </div>

              {/* Notes */}
              <div className="panel-beveled p-2">
                <div className="text-[10px] text-rmpg-400 uppercase tracking-wider mb-1">Notes</div>
                <textarea
                  value={editNotes}
                  onChange={e => setEditNotes(e.target.value)}
                  rows={3}
                  className="w-full bg-[#0d1520] border border-rmpg-700 text-white text-xs px-2 py-1.5 rounded-sm focus:border-brand-500 focus:outline-none resize-none"
                />
                <div className="flex justify-end mt-1">
                  <button type="button"
                    onClick={handleSaveNotes}
                    disabled={saving || editNotes === (selectedLead.notes || '')}
                    className="bg-brand-600 hover:bg-brand-500 disabled:opacity-40 text-white text-[10px] font-bold px-2 py-1 rounded-sm flex items-center gap-1"
                  >
                    {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />} Save
                  </button>
                </div>
              </div>

              {/* Add note */}
              <div className="panel-beveled p-2">
                <div className="text-[10px] text-rmpg-400 uppercase tracking-wider mb-1">Add Activity Note</div>
                <input
                  type="text"
                  placeholder="Subject"
                  value={newNoteSubject}
                  onChange={e => setNewNoteSubject(e.target.value)}
                  className="w-full bg-[#0d1520] border border-rmpg-700 text-white text-xs px-2 py-1 rounded-sm focus:border-brand-500 focus:outline-none mb-1"
                />
                <textarea
                  placeholder="Details (optional)"
                  value={newNoteDetails}
                  onChange={e => setNewNoteDetails(e.target.value)}
                  rows={2}
                  className="w-full bg-[#0d1520] border border-rmpg-700 text-white text-xs px-2 py-1 rounded-sm focus:border-brand-500 focus:outline-none resize-none"
                />
                <div className="flex justify-end mt-1">
                  <button type="button"
                    onClick={handleAddNote}
                    disabled={!newNoteSubject.trim()}
                    className="bg-brand-600 hover:bg-brand-500 disabled:opacity-40 text-white text-[10px] font-bold px-2 py-1 rounded-sm flex items-center gap-1"
                  >
                    <Send className="w-3 h-3" /> Add Note
                  </button>
                </div>
              </div>

              {/* Activity timeline */}
              <div>
                <div className="text-[10px] text-rmpg-400 uppercase tracking-wider mb-2">Activity Timeline</div>
                {leadActivities.length === 0 ? (
                  <div className="text-xs text-rmpg-500 text-center py-3">No activity yet</div>
                ) : (
                  <div className="space-y-2">
                    {leadActivities.map(act => (
                      <div key={act.id} className="panel-beveled p-2">
                        <div className="flex items-center gap-1.5 mb-0.5">
                          <span className="text-[10px] px-1 py-0.5 rounded-sm border text-rmpg-300 bg-rmpg-800/30 border-rmpg-700/50">
                            {toDisplayLabel(act.activity_type)}
                          </span>
                          <span className="text-[10px] text-rmpg-500 ml-auto">{formatDateTime(act.created_at)}</span>
                        </div>
                        {act.subject && <div className="text-xs text-white font-medium">{act.subject}</div>}
                        {act.details && <div className="text-[10px] text-rmpg-400 mt-0.5">{act.details}</div>}
                        {act.created_by_name && <div className="text-[10px] text-rmpg-500 mt-0.5">by {act.created_by_name}</div>}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Action buttons */}
              <div className="flex flex-col gap-1.5 pt-2 border-t border-rmpg-700">
                <button type="button"
                  onClick={() => {
                    // Navigate to proposals creation (parent CRM page can handle this)
                    addToast('Open Proposals tab to create a proposal for this lead', 'info');
                  }}
                  className="bg-brand-600 hover:bg-brand-500 text-white text-xs font-bold px-3 py-1.5 rounded-sm flex items-center gap-1 justify-center"
                >
                  <FileText className="w-3.5 h-3.5" /> Create Proposal
                </button>
                {selectedLead.pipeline_stage === 'won' && !selectedLead.client_id && (
                  <button type="button"
                    onClick={() => handleConvert(selectedLead.id)}
                    className="bg-green-600 hover:bg-green-500 text-white text-xs font-bold px-3 py-1.5 rounded-sm flex items-center gap-1 justify-center"
                  >
                    <ArrowRight className="w-3.5 h-3.5" /> Convert to Client
                  </button>
                )}
                {selectedLead.pipeline_stage !== 'dismissed' && selectedLead.pipeline_stage !== 'won' && (
                  <button type="button"
                    onClick={() => handleStageChange(selectedLead.id, 'dismissed')}
                    className="bg-rmpg-700/30 hover:bg-rmpg-700/50 text-rmpg-400 text-xs font-bold px-3 py-1.5 rounded-sm flex items-center gap-1 justify-center border border-rmpg-600/50"
                  >
                    <XCircle className="w-3.5 h-3.5" /> Dismiss
                  </button>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ── Create Lead Modal ────────────────────────── */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" role="dialog" aria-modal="true" onClick={() => setShowCreateModal(false)}>
          <div className="bg-[#141e2b] border border-rmpg-700 rounded-sm w-full max-w-md max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <PanelTitleBar title="Add Lead" icon={Plus}>
              <button type="button" onClick={() => setShowCreateModal(false)} className="text-rmpg-400 hover:text-white">
                <X className="w-4 h-4" />
              </button>
            </PanelTitleBar>
            <form onSubmit={handleCreateLead} className="p-3 space-y-2">
              <div>
                <label className="text-[10px] text-rmpg-400 uppercase tracking-wider block mb-0.5">Business Name *</label>
                <input
                  type="text"
                  required
                  value={createForm.business_name}
                  onChange={e => setCreateForm(f => ({ ...f, business_name: e.target.value }))}
                  className="w-full bg-[#0d1520] border border-rmpg-700 text-white text-sm px-2 py-1.5 rounded-sm focus:border-brand-500 focus:outline-none"
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[10px] text-rmpg-400 uppercase tracking-wider block mb-0.5">Contact Name</label>
                  <input
                    type="text"
                    value={createForm.contact_name}
                    onChange={e => setCreateForm(f => ({ ...f, contact_name: e.target.value }))}
                    className="w-full bg-[#0d1520] border border-rmpg-700 text-white text-sm px-2 py-1.5 rounded-sm focus:border-brand-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="text-[10px] text-rmpg-400 uppercase tracking-wider block mb-0.5">Business Type</label>
                  <select
                    value={createForm.business_type}
                    onChange={e => setCreateForm(f => ({ ...f, business_type: e.target.value }))}
                    className="w-full bg-[#0d1520] border border-rmpg-700 text-white text-sm px-2 py-1.5 rounded-sm focus:border-brand-500 focus:outline-none"
                  >
                    <option value="">Select...</option>
                    <option value="retail">Retail</option>
                    <option value="restaurant">Restaurant</option>
                    <option value="bar_nightclub">Bar/Nightclub</option>
                    <option value="hotel">Hotel</option>
                    <option value="office">Office</option>
                    <option value="warehouse">Warehouse</option>
                    <option value="construction">Construction</option>
                    <option value="residential_complex">Residential Complex</option>
                    <option value="event_venue">Event Venue</option>
                    <option value="other">Other</option>
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[10px] text-rmpg-400 uppercase tracking-wider block mb-0.5">Email</label>
                  <input
                    type="email"
                    value={createForm.contact_email}
                    onChange={e => setCreateForm(f => ({ ...f, contact_email: e.target.value }))}
                    className="w-full bg-[#0d1520] border border-rmpg-700 text-white text-sm px-2 py-1.5 rounded-sm focus:border-brand-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="text-[10px] text-rmpg-400 uppercase tracking-wider block mb-0.5">Phone</label>
                  <input
                    type="tel"
                    value={createForm.contact_phone}
                    onChange={e => setCreateForm(f => ({ ...f, contact_phone: formatPhoneInput(e.target.value) }))}
                    className="w-full bg-[#0d1520] border border-rmpg-700 text-white text-sm px-2 py-1.5 rounded-sm focus:border-brand-500 focus:outline-none"
                  />
                </div>
              </div>
              <div>
                <label className="text-[10px] text-rmpg-400 uppercase tracking-wider block mb-0.5">Address</label>
                <input
                  type="text"
                  value={createForm.address}
                  onChange={e => setCreateForm(f => ({ ...f, address: e.target.value }))}
                  className="w-full bg-[#0d1520] border border-rmpg-700 text-white text-sm px-2 py-1.5 rounded-sm focus:border-brand-500 focus:outline-none"
                />
              </div>
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="text-[10px] text-rmpg-400 uppercase tracking-wider block mb-0.5">City</label>
                  <input
                    type="text"
                    value={createForm.city}
                    onChange={e => setCreateForm(f => ({ ...f, city: e.target.value }))}
                    className="w-full bg-[#0d1520] border border-rmpg-700 text-white text-sm px-2 py-1.5 rounded-sm focus:border-brand-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="text-[10px] text-rmpg-400 uppercase tracking-wider block mb-0.5">State</label>
                  <input
                    type="text"
                    value={createForm.state}
                    onChange={e => setCreateForm(f => ({ ...f, state: e.target.value }))}
                    className="w-full bg-[#0d1520] border border-rmpg-700 text-white text-sm px-2 py-1.5 rounded-sm focus:border-brand-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="text-[10px] text-rmpg-400 uppercase tracking-wider block mb-0.5">ZIP</label>
                  <input
                    type="text"
                    value={createForm.zip}
                    onChange={e => setCreateForm(f => ({ ...f, zip: e.target.value }))}
                    className="w-full bg-[#0d1520] border border-rmpg-700 text-white text-sm px-2 py-1.5 rounded-sm focus:border-brand-500 focus:outline-none"
                  />
                </div>
              </div>
              <div>
                <label className="text-[10px] text-rmpg-400 uppercase tracking-wider block mb-0.5">Estimated Monthly Value</label>
                <input
                  type="number"
                  step="0.01"
                  value={createForm.estimated_value}
                  onChange={e => setCreateForm(f => ({ ...f, estimated_value: e.target.value }))}
                  className="w-full bg-[#0d1520] border border-rmpg-700 text-white text-sm px-2 py-1.5 rounded-sm focus:border-brand-500 focus:outline-none"
                />
              </div>
              <div>
                <label className="text-[10px] text-rmpg-400 uppercase tracking-wider block mb-0.5">Notes</label>
                <textarea
                  value={createForm.notes}
                  onChange={e => setCreateForm(f => ({ ...f, notes: e.target.value }))}
                  rows={3}
                  className="w-full bg-[#0d1520] border border-rmpg-700 text-white text-sm px-2 py-1.5 rounded-sm focus:border-brand-500 focus:outline-none resize-none"
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button type="button" onClick={() => setShowCreateModal(false)} className="text-rmpg-400 hover:text-white text-xs px-3 py-1.5">
                  Cancel
                </button>
                <button type="submit" disabled={saving} className="bg-brand-600 hover:bg-brand-500 disabled:opacity-40 text-white text-xs font-bold px-3 py-1.5 rounded-sm flex items-center gap-1">
                  {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />} Create Lead
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
