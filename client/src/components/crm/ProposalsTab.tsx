// ============================================================
// RMPG Flex — CRM Overwatch: Proposals Tab
// Proposal management, templates, stage tracking
// ============================================================

import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Plus,
  X,
  Loader2,
  FileText,
  Send,
  Eye,
  CheckCircle,
  XCircle,
  Clock,
  DollarSign,
  Calendar,
  Save,
  Edit3,
  Printer,
  History,
} from 'lucide-react';
import { apiFetch } from '../../hooks/useApi';
import { useToast } from '../ToastProvider';
import PanelTitleBar from '../PanelTitleBar';
import { generateProposalPdf } from '../../utils/proposalPdf';
import type {
  CrmProposal,
  CrmProposalTemplate,
  CrmProposalVersion,
  ProposalStage,
  CrmLead,
  Client,
} from '../../types';

// ── Stage colors ──────────────────────────────────────────
const PROPOSAL_STAGE_CLASSES: Record<ProposalStage, string> = {
  draft: 'text-rmpg-400 bg-rmpg-800/30 border-rmpg-700/50',
  sent: 'text-blue-400 bg-blue-900/30 border-blue-700/50',
  viewed: 'text-purple-400 bg-purple-900/30 border-purple-700/50',
  accepted: 'text-green-400 bg-green-900/30 border-green-700/50',
  rejected: 'text-red-400 bg-red-900/30 border-red-700/50',
  expired: 'text-amber-400 bg-amber-900/30 border-amber-700/50',
};

const PROPOSAL_STAGES: ProposalStage[] = ['draft', 'sent', 'viewed', 'accepted', 'rejected', 'expired'];
const PROPOSAL_TIMELINE_STAGES: ProposalStage[] = ['draft', 'sent', 'viewed', 'accepted'];

function formatCurrency(val: number | null | undefined): string {
  if (!val) return '$0';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(val);
}

function formatDate(d?: string | null): string {
  if (!d) return '\u2014';
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function toDisplayLabel(s: string): string {
  return s.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

// ════════════════════════════════════════════════════════
// PROPOSALS TAB
// ════════════════════════════════════════════════════════
interface ProposalsTabProps {
  prefillData?: { title?: string; scope_of_work?: string; total_value?: string } | null;
  onPrefillConsumed?: () => void;
}

export default function ProposalsTab({ prefillData, onPrefillConsumed }: ProposalsTabProps = {}) {
  const { addToast } = useToast();

  // ── Data state ──────────────────────────────────────
  const [proposals, setProposals] = useState<CrmProposal[]>([]);
  const [templates, setTemplates] = useState<CrmProposalTemplate[]>([]);
  const [leads, setLeads] = useState<CrmLead[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [selectedProposal, setSelectedProposal] = useState<CrmProposal | null>(null);

  // ── UI state ────────────────────────────────────────
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [filterStage, setFilterStage] = useState<string>('');
  const [filterTemplate, setFilterTemplate] = useState<string>('');

  // ── Create form ─────────────────────────────────────
  const [form, setForm] = useState({
    title: '',
    template_type: '',
    lead_id: '',
    client_id: '',
    scope_of_work: '',
    terms: '',
    monthly_value: '',
    total_value: '',
    billing_frequency: 'monthly',
    proposed_start: '',
    proposed_end: '',
    contract_length_months: '',
    valid_until: '',
    notes: '',
  });

  // ── Edit state for detail panel ─────────────────────
  const [editMode, setEditMode] = useState(false);
  const [editForm, setEditForm] = useState<Partial<CrmProposal>>({});

  // ── Detail sub-tab ──────────────────────────────────
  const [detailTab, setDetailTab] = useState<'info' | 'history'>('info');

  // ── Version history ─────────────────────────────────
  const [versions, setVersions] = useState<CrmProposalVersion[]>([]);
  const [versionsLoading, setVersionsLoading] = useState(false);
  const [expandedVersions, setExpandedVersions] = useState<Set<number>>(new Set());

  // ── PDF export ──────────────────────────────────────
  const [exportingPdf, setExportingPdf] = useState(false);

  // ── Send ────────────────────────────────────────────
  const [sending, setSending] = useState(false);

  // ── Fetch data ──────────────────────────────────────
  const fetchProposals = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (filterStage) params.set('stage', filterStage);
      const qs = params.toString();
      const data = await apiFetch<CrmProposal[]>(`/api/crm/proposals${qs ? `?${qs}` : ''}`);
      if (data) setProposals(data);
    } catch {
      addToast('Failed to load proposals', 'error');
    } finally {
      setLoading(false);
    }
  }, [filterStage, addToast]);

  const fetchTemplates = useCallback(async () => {
    try {
      const data = await apiFetch<CrmProposalTemplate[]>('/api/crm/proposal-templates');
      if (data) setTemplates(data);
    } catch { /* silent */ }
  }, []);

  const fetchLeads = useCallback(async () => {
    try {
      const data = await apiFetch<CrmLead[]>('/api/crm/leads?pipeline_stage=qualified');
      if (data) setLeads(data);
    } catch { /* silent */ }
  }, []);

  const fetchClients = useCallback(async () => {
    try {
      const data = await apiFetch<Client[]>('/api/clients');
      if (data) setClients(data);
    } catch { /* silent */ }
  }, []);

  const fetchVersions = useCallback(async (id: number | string) => {
    setVersionsLoading(true);
    try {
      const data = await apiFetch<CrmProposalVersion[]>(`/api/crm/proposals/${id}/versions`);
      if (data) setVersions(data);
    } catch {
      addToast('Failed to load version history', 'error');
    } finally {
      setVersionsLoading(false);
    }
  }, [addToast]);

  // ── PDF export ──────────────────────────────────────
  const handleExportPdf = async () => {
    if (!selectedProposal) return;
    setExportingPdf(true);
    try {
      const clientData = selectedProposal.client_id
        ? clients.find(c => c.id === selectedProposal.client_id) || null
        : null;
      await generateProposalPdf(selectedProposal, clientData);
    } catch {
      addToast('Failed to generate PDF', 'error');
    } finally {
      setExportingPdf(false);
    }
  };

  // ── Send proposal ───────────────────────────────────
  const handleSendProposal = async () => {
    if (!selectedProposal) return;
    setSending(true);
    try {
      await apiFetch(`/api/crm/proposals/${selectedProposal.id}/send`, { method: 'POST' });
      addToast('Proposal sent', 'success');
      fetchProposals();
      const updated = await apiFetch<CrmProposal>(`/api/crm/proposals/${selectedProposal.id}`);
      if (updated) setSelectedProposal(updated);
    } catch {
      addToast('Failed to send proposal', 'error');
    } finally {
      setSending(false);
    }
  };

  useEffect(() => { fetchProposals(); }, [fetchProposals]);
  useEffect(() => {
    fetchTemplates();
    fetchLeads();
    fetchClients();
  }, [fetchTemplates, fetchLeads, fetchClients]);

  // ── Reset detail sub-tab when proposal changes ───────
  useEffect(() => {
    if (selectedProposal) {
      setDetailTab('info');
      setExpandedVersions(new Set());
      setVersions([]);
    }
  }, [selectedProposal?.id]);

  // ── Handle pre-fill from lead quick-convert ──────────
  const appliedPrefillRef = useRef<typeof prefillData>(undefined);
  useEffect(() => {
    if (prefillData && prefillData !== appliedPrefillRef.current) {
      appliedPrefillRef.current = prefillData;
      setForm(f => ({
        ...f,
        title: prefillData.title || f.title,
        scope_of_work: prefillData.scope_of_work || f.scope_of_work,
        total_value: prefillData.total_value || f.total_value,
      }));
      setShowCreateModal(true);
      onPrefillConsumed?.();
    }
  }, [prefillData, onPrefillConsumed]);

  // ── Template auto-fill ──────────────────────────────
  const handleTemplateChange = (templateType: string) => {
    setForm(f => ({ ...f, template_type: templateType }));
    const tpl = templates.find(t => t.template_type === templateType);
    if (tpl) {
      setForm(f => ({
        ...f,
        scope_of_work: tpl.default_scope || f.scope_of_work,
        terms: tpl.default_terms || f.terms,
        monthly_value: tpl.default_monthly_value?.toString() || f.monthly_value,
        billing_frequency: tpl.default_billing_frequency || f.billing_frequency,
        contract_length_months: tpl.default_contract_months?.toString() || f.contract_length_months,
      }));
    }
  };

  // ── Stage change ────────────────────────────────────
  const handleStageChange = async (id: number | string, stage: ProposalStage) => {
    try {
      await apiFetch(`/api/crm/proposals/${id}/stage`, {
        method: 'PUT',
        body: JSON.stringify({ stage }),
      });
      addToast(`Proposal ${toDisplayLabel(stage)}`, 'success');
      fetchProposals();
      if (selectedProposal?.id === id) {
        setSelectedProposal(prev => prev ? { ...prev, stage } : null);
      }
    } catch {
      addToast('Failed to update proposal stage', 'error');
    }
  };

  // ── Save edits ──────────────────────────────────────
  const handleSaveEdits = async () => {
    if (!selectedProposal) return;
    setSaving(true);
    try {
      await apiFetch(`/api/crm/proposals/${selectedProposal.id}`, {
        method: 'PUT',
        body: JSON.stringify(editForm),
      });
      addToast('Proposal updated', 'success');
      setEditMode(false);
      fetchProposals();
      // Refresh selected
      const updated = await apiFetch<CrmProposal>(`/api/crm/proposals/${selectedProposal.id}`);
      if (updated) setSelectedProposal(updated);
    } catch {
      addToast('Failed to update proposal', 'error');
    } finally {
      setSaving(false);
    }
  };

  // ── Create proposal ─────────────────────────────────
  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.title.trim()) return;
    setSaving(true);
    try {
      await apiFetch('/api/crm/proposals', {
        method: 'POST',
        body: JSON.stringify({
          ...form,
          lead_id: form.lead_id ? Number(form.lead_id) : undefined,
          client_id: form.client_id ? Number(form.client_id) : undefined,
          monthly_value: form.monthly_value ? Number(form.monthly_value) : 0,
          total_value: form.total_value ? Number(form.total_value) : 0,
          contract_length_months: form.contract_length_months ? Number(form.contract_length_months) : undefined,
        }),
      });
      addToast('Proposal created', 'success');
      setShowCreateModal(false);
      setForm({ title: '', template_type: '', lead_id: '', client_id: '', scope_of_work: '', terms: '', monthly_value: '', total_value: '', billing_frequency: 'monthly', proposed_start: '', proposed_end: '', contract_length_months: '', valid_until: '', notes: '' });
      fetchProposals();
    } catch {
      addToast('Failed to create proposal', 'error');
    } finally {
      setSaving(false);
    }
  };

  // ── Expiry countdown helper ──────────────────────────
  const renderExpiryChip = (validUntil?: string | null) => {
    if (!validUntil) return null;
    const now = new Date();
    const exp = new Date(validUntil);
    const diffMs = exp.getTime() - now.getTime();
    const days = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
    if (days < 0) {
      return (
        <span className="text-[10px] px-1.5 py-0.5 rounded-sm border bg-red-900/30 border-red-700/50 text-red-400 font-bold tracking-wider">
          EXPIRED
        </span>
      );
    }
    const color = days > 14
      ? 'bg-green-900/30 border-green-700/50 text-green-400'
      : 'bg-amber-900/30 border-amber-700/50 text-amber-400';
    return (
      <span className={`text-[10px] px-1.5 py-0.5 rounded-sm border ${color}`}>
        Expires in {days}d
      </span>
    );
  };

  // ── Stage timeline renderer ──────────────────────────
  const renderStageTimeline = (proposal: CrmProposal) => {
    let stageTimestamps: Record<string, string> = {};
    try {
      if (proposal.stage_entered_at) {
        stageTimestamps = JSON.parse(proposal.stage_entered_at);
      }
    } catch { /* ignore */ }

    // fallback: use individual timestamp fields
    if (!stageTimestamps.sent && proposal.sent_at) stageTimestamps.sent = proposal.sent_at;
    if (!stageTimestamps.viewed && proposal.viewed_at) stageTimestamps.viewed = proposal.viewed_at;
    if (!stageTimestamps.accepted && proposal.accepted_at) stageTimestamps.accepted = proposal.accepted_at;
    if (!stageTimestamps.draft && proposal.created_at) stageTimestamps.draft = proposal.created_at;

    const currentIdx = PROPOSAL_TIMELINE_STAGES.indexOf(proposal.stage);

    return (
      <div className="panel-beveled p-2">
        <div className="text-[10px] text-rmpg-400 uppercase tracking-wider mb-2">Stage Timeline</div>
        <div className="flex items-start gap-0">
          {PROPOSAL_TIMELINE_STAGES.map((s, idx) => {
            const isPast = idx < currentIdx;
            const isActive = idx === currentIdx;
            const ts = stageTimestamps[s];
            const dotColor = isActive
              ? 'bg-brand-500 border-brand-400'
              : isPast
                ? 'bg-green-600 border-green-500'
                : 'bg-rmpg-700 border-rmpg-600';
            const labelColor = isActive
              ? 'text-brand-400'
              : isPast
                ? 'text-green-400'
                : 'text-rmpg-600';

            return (
              <div key={s} className="flex-1 flex flex-col items-center">
                <div className="flex items-center w-full">
                  {idx > 0 && (
                    <div className={`flex-1 h-px ${isPast || isActive ? 'bg-green-700' : 'bg-rmpg-700'}`} />
                  )}
                  <div className={`w-2 h-2 rounded-full border ${dotColor} flex-shrink-0`} />
                  {idx < PROPOSAL_TIMELINE_STAGES.length - 1 && (
                    <div className={`flex-1 h-px ${isPast ? 'bg-green-700' : 'bg-rmpg-700'}`} />
                  )}
                </div>
                <div className={`text-[9px] font-bold mt-1 ${labelColor}`}>{toDisplayLabel(s)}</div>
                <div className="text-[8px] text-rmpg-500 text-center leading-tight">
                  {ts ? formatDate(ts) : '—'}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  // ════════════════════════════════════════════════════════
  // RENDER
  // ════════════════════════════════════════════════════════
  return (
    <div className="flex flex-col h-full">
      {/* ── Top bar ──────────────────────────────────── */}
      <div className="flex items-center gap-2 flex-wrap px-3 py-2 bg-[#141e2b] border-b border-rmpg-700">
        <select
          value={filterStage}
          onChange={e => setFilterStage(e.target.value)}
          className="bg-[#0d1520] border border-rmpg-700 text-white text-xs px-2 py-1.5 rounded-sm focus:border-brand-500 focus:outline-none"
        >
          <option value="">All Stages</option>
          {PROPOSAL_STAGES.map(s => (
            <option key={s} value={s}>{toDisplayLabel(s)}</option>
          ))}
        </select>
        <select
          value={filterTemplate}
          onChange={e => setFilterTemplate(e.target.value)}
          className="bg-[#0d1520] border border-rmpg-700 text-white text-xs px-2 py-1.5 rounded-sm focus:border-brand-500 focus:outline-none"
        >
          <option value="">All Templates</option>
          {templates.map(t => (
            <option key={t.id} value={t.template_type}>{t.name}</option>
          ))}
        </select>
        <div className="flex-1" />
        <button
          onClick={() => setShowCreateModal(true)}
          className="bg-brand-600 hover:bg-brand-500 text-white text-xs font-bold px-3 py-1.5 rounded-sm flex items-center gap-1"
        >
          <Plus className="w-3.5 h-3.5" /> New Proposal
        </button>
      </div>

      {/* ── Main content area ────────────────────────── */}
      <div className="flex flex-1 overflow-hidden">
        {/* ── Proposal list ────────────────────────── */}
        <div className={`flex-1 overflow-auto ${selectedProposal ? 'border-r border-rmpg-700' : ''}`}>
          {loading ? (
            <div className="flex items-center justify-center h-32">
              <Loader2 className="w-5 h-5 text-brand-400 animate-spin" />
            </div>
          ) : proposals.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-32 text-rmpg-400 text-sm">
              <FileText className="w-6 h-6 mb-2 opacity-50" />
              No proposals found
            </div>
          ) : (
            <table className="w-full">
              <thead>
                <tr className="bg-[#0d1520] border-b border-rmpg-700 sticky top-0 z-10">
                  <th className="text-[10px] text-rmpg-400 uppercase tracking-wider px-2 py-1.5 text-left">Proposal #</th>
                  <th className="text-[10px] text-rmpg-400 uppercase tracking-wider px-2 py-1.5 text-left">Title</th>
                  <th className="text-[10px] text-rmpg-400 uppercase tracking-wider px-2 py-1.5 text-left">Lead/Client</th>
                  <th className="text-[10px] text-rmpg-400 uppercase tracking-wider px-2 py-1.5 text-left">Stage</th>
                  <th className="text-[10px] text-rmpg-400 uppercase tracking-wider px-2 py-1.5 text-right">Monthly</th>
                  <th className="text-[10px] text-rmpg-400 uppercase tracking-wider px-2 py-1.5 text-right">Total</th>
                  <th className="text-[10px] text-rmpg-400 uppercase tracking-wider px-2 py-1.5 text-left">Valid Until</th>
                  <th className="text-[10px] text-rmpg-400 uppercase tracking-wider px-2 py-1.5 text-left">Created</th>
                </tr>
              </thead>
              <tbody>
                {proposals
                  .filter(p => !filterTemplate || p.template_type === filterTemplate)
                  .map(prop => (
                  <tr
                    key={prop.id}
                    onClick={() => { setSelectedProposal(prop); setEditMode(false); }}
                    className={`border-b border-rmpg-700/50 cursor-pointer transition-colors ${selectedProposal?.id === prop.id ? 'bg-brand-600/10' : 'hover:bg-[#1a2636]'}`}
                  >
                    <td className="px-2 py-1.5 text-xs text-brand-400 font-mono">{prop.proposal_number}</td>
                    <td className="px-2 py-1.5 text-xs text-white font-medium truncate max-w-[200px]">{prop.title}</td>
                    <td className="px-2 py-1.5 text-xs text-rmpg-300 truncate max-w-[150px]">
                      {prop.lead_name || prop.client_name || '\u2014'}
                    </td>
                    <td className="px-2 py-1.5">
                      <span className={`text-[10px] px-1.5 py-0.5 rounded-sm border ${PROPOSAL_STAGE_CLASSES[prop.stage]}`}>
                        {toDisplayLabel(prop.stage)}
                      </span>
                    </td>
                    <td className="px-2 py-1.5 text-xs text-rmpg-300 text-right font-mono">{formatCurrency(prop.monthly_value)}</td>
                    <td className="px-2 py-1.5 text-xs text-rmpg-300 text-right font-mono">{formatCurrency(prop.total_value)}</td>
                    <td className="px-2 py-1.5 text-[10px] text-rmpg-400">{formatDate(prop.valid_until)}</td>
                    <td className="px-2 py-1.5 text-[10px] text-rmpg-400">{formatDate(prop.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* ── Proposal detail side panel ────────────── */}
        {selectedProposal && (
          <div className="w-[400px] min-w-[360px] overflow-y-auto bg-[#141e2b] flex flex-col">
            {/* Header */}
            <div className="px-3 py-2 bg-[#0d1520] border-b border-rmpg-700 flex items-center gap-2">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[10px] text-brand-400 font-mono">{selectedProposal.proposal_number}</span>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded-sm border ${PROPOSAL_STAGE_CLASSES[selectedProposal.stage]}`}>
                    {toDisplayLabel(selectedProposal.stage)}
                  </span>
                  {renderExpiryChip(selectedProposal.valid_until)}
                </div>
                <h3 className="text-sm font-bold text-white truncate">{selectedProposal.title}</h3>
              </div>
              <div className="flex items-center gap-1">
                {/* Export PDF */}
                <button
                  onClick={handleExportPdf}
                  disabled={exportingPdf}
                  title="Export PDF"
                  className="toolbar-btn text-xs p-1 flex items-center gap-1 disabled:opacity-40"
                >
                  {exportingPdf ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Printer className="w-3.5 h-3.5" />}
                </button>
                {/* Send button (only if draft) */}
                {selectedProposal.stage === 'draft' && (
                  <button
                    onClick={handleSendProposal}
                    disabled={sending}
                    title="Send Proposal"
                    className="toolbar-btn-primary text-xs px-2 py-1 flex items-center gap-1 disabled:opacity-40"
                  >
                    {sending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />}
                    Send
                  </button>
                )}
                {selectedProposal.stage === 'draft' && (
                  <button
                    onClick={() => { setEditMode(!editMode); setEditForm(selectedProposal); }}
                    className={`text-xs p-1 rounded-sm ${editMode ? 'text-brand-400' : 'text-rmpg-400 hover:text-white'}`}
                  >
                    <Edit3 className="w-3.5 h-3.5" />
                  </button>
                )}
                <button onClick={() => setSelectedProposal(null)} className="text-rmpg-400 hover:text-white">
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Sub-tabs */}
            <div className="flex border-b border-rmpg-700 bg-[#0d1520]">
              {(['info', 'history'] as const).map(tab => (
                <button
                  key={tab}
                  onClick={() => {
                    setDetailTab(tab);
                    if (tab === 'history' && versions.length === 0) {
                      fetchVersions(selectedProposal.id);
                    }
                  }}
                  className={`text-[10px] uppercase tracking-wider px-3 py-1.5 border-b-2 transition-colors ${
                    detailTab === tab
                      ? 'border-brand-500 text-brand-400'
                      : 'border-transparent text-rmpg-500 hover:text-rmpg-300'
                  }`}
                >
                  {tab === 'info' ? <><FileText className="w-3 h-3 inline mr-1" />Info</> : <><History className="w-3 h-3 inline mr-1" />History</>}
                </button>
              ))}
            </div>

            {/* History tab */}
            {detailTab === 'history' && (
              <div className="flex-1 overflow-y-auto p-3">
                {versionsLoading ? (
                  <div className="flex items-center justify-center h-16">
                    <Loader2 className="w-4 h-4 animate-spin text-brand-400" />
                  </div>
                ) : versions.length === 0 ? (
                  <div className="text-xs text-rmpg-500 text-center py-8">No version history available</div>
                ) : (
                  <div className="space-y-1.5">
                    {versions.map(v => (
                      <div key={v.id} className="panel-beveled p-2">
                        <div className="flex items-center justify-between">
                          <span className="text-xs text-white font-mono">v{v.version}</span>
                          <span className="text-[10px] text-rmpg-400">
                            {v.edited_by || 'unknown'} &mdash; {new Date(v.edited_at).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                          </span>
                          <button
                            onClick={() => setExpandedVersions(prev => {
                              const next = new Set(prev);
                              if (next.has(v.id)) next.delete(v.id); else next.add(v.id);
                              return next;
                            })}
                            className="text-[10px] text-rmpg-500 hover:text-rmpg-300 ml-2"
                          >
                            {expandedVersions.has(v.id) ? '▲' : '▼'}
                          </button>
                        </div>
                        {expandedVersions.has(v.id) && (
                          <pre className="mt-1.5 text-[9px] text-rmpg-400 bg-[#0d1520] rounded-sm p-2 overflow-auto max-h-40 whitespace-pre-wrap break-all">
                            {(() => {
                              try { return JSON.stringify(JSON.parse(v.snapshot), null, 2); } catch { return v.snapshot; }
                            })()}
                          </pre>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {detailTab === 'info' && (
            <div className="flex-1 overflow-y-auto p-3 space-y-3">
              {/* Stage timeline */}
              {renderStageTimeline(selectedProposal)}

              {/* Stage action buttons */}
              <div className="flex gap-1.5 flex-wrap">
                {selectedProposal.stage === 'sent' && (
                  <button onClick={() => handleStageChange(selectedProposal.id, 'viewed')} className="bg-purple-600/20 hover:bg-purple-600/30 text-purple-400 text-xs font-bold px-2 py-1 rounded-sm border border-purple-700/50 flex items-center gap-1">
                    <Eye className="w-3 h-3" /> Mark Viewed
                  </button>
                )}
                {(selectedProposal.stage === 'sent' || selectedProposal.stage === 'viewed') && (
                  <>
                    <button onClick={() => handleStageChange(selectedProposal.id, 'accepted')} className="bg-green-600/20 hover:bg-green-600/30 text-green-400 text-xs font-bold px-2 py-1 rounded-sm border border-green-700/50 flex items-center gap-1">
                      <CheckCircle className="w-3 h-3" /> Accept
                    </button>
                    <button onClick={() => handleStageChange(selectedProposal.id, 'rejected')} className="bg-red-600/20 hover:bg-red-600/30 text-red-400 text-xs font-bold px-2 py-1 rounded-sm border border-red-700/50 flex items-center gap-1">
                      <XCircle className="w-3 h-3" /> Reject
                    </button>
                  </>
                )}
              </div>

              {/* Linked lead/client */}
              <div className="panel-beveled p-2 space-y-1">
                <div className="text-[10px] text-rmpg-400 uppercase tracking-wider mb-1">Linked To</div>
                {selectedProposal.lead_name && (
                  <div className="text-xs text-rmpg-300">Lead: <span className="text-white">{selectedProposal.lead_name}</span></div>
                )}
                {selectedProposal.client_name && (
                  <div className="text-xs text-rmpg-300">Client: <span className="text-white">{selectedProposal.client_name}</span></div>
                )}
                {!selectedProposal.lead_name && !selectedProposal.client_name && (
                  <div className="text-xs text-rmpg-500">Not linked</div>
                )}
              </div>

              {/* Financial details */}
              <div className="panel-beveled p-2 space-y-1">
                <div className="text-[10px] text-rmpg-400 uppercase tracking-wider mb-1">Financial</div>
                {editMode ? (
                  <div className="space-y-1.5">
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="text-[10px] text-rmpg-500">Monthly Value</label>
                        <input
                          type="number"
                          value={editForm.monthly_value || ''}
                          onChange={e => setEditForm(f => ({ ...f, monthly_value: Number(e.target.value) }))}
                          className="w-full bg-[#0d1520] border border-rmpg-700 text-white text-xs px-2 py-1 rounded-sm focus:border-brand-500 focus:outline-none"
                        />
                      </div>
                      <div>
                        <label className="text-[10px] text-rmpg-500">Total Value</label>
                        <input
                          type="number"
                          value={editForm.total_value || ''}
                          onChange={e => setEditForm(f => ({ ...f, total_value: Number(e.target.value) }))}
                          className="w-full bg-[#0d1520] border border-rmpg-700 text-white text-xs px-2 py-1 rounded-sm focus:border-brand-500 focus:outline-none"
                        />
                      </div>
                    </div>
                    <div>
                      <label className="text-[10px] text-rmpg-500">Billing Frequency</label>
                      <select
                        value={editForm.billing_frequency || 'monthly'}
                        onChange={e => setEditForm(f => ({ ...f, billing_frequency: e.target.value }))}
                        className="w-full bg-[#0d1520] border border-rmpg-700 text-white text-xs px-2 py-1 rounded-sm focus:border-brand-500 focus:outline-none"
                      >
                        <option value="monthly">Monthly</option>
                        <option value="quarterly">Quarterly</option>
                        <option value="annually">Annually</option>
                        <option value="one_time">One-Time</option>
                      </select>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="flex items-center gap-1.5 text-xs text-rmpg-300">
                      <DollarSign className="w-3 h-3 text-rmpg-500" /> Monthly: <span className="font-mono text-green-400">{formatCurrency(selectedProposal.monthly_value)}</span>
                    </div>
                    <div className="flex items-center gap-1.5 text-xs text-rmpg-300">
                      <DollarSign className="w-3 h-3 text-rmpg-500" /> Total: <span className="font-mono text-green-400">{formatCurrency(selectedProposal.total_value)}</span>
                    </div>
                    <div className="text-xs text-rmpg-300">Billing: {toDisplayLabel(selectedProposal.billing_frequency || 'monthly')}</div>
                  </>
                )}
              </div>

              {/* Dates */}
              <div className="panel-beveled p-2 space-y-1">
                <div className="text-[10px] text-rmpg-400 uppercase tracking-wider mb-1">Dates</div>
                {editMode ? (
                  <div className="space-y-1.5">
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="text-[10px] text-rmpg-500">Start Date</label>
                        <input
                          type="date"
                          value={editForm.proposed_start || ''}
                          onChange={e => setEditForm(f => ({ ...f, proposed_start: e.target.value }))}
                          className="w-full bg-[#0d1520] border border-rmpg-700 text-white text-xs px-2 py-1 rounded-sm focus:border-brand-500 focus:outline-none"
                        />
                      </div>
                      <div>
                        <label className="text-[10px] text-rmpg-500">End Date</label>
                        <input
                          type="date"
                          value={editForm.proposed_end || ''}
                          onChange={e => setEditForm(f => ({ ...f, proposed_end: e.target.value }))}
                          className="w-full bg-[#0d1520] border border-rmpg-700 text-white text-xs px-2 py-1 rounded-sm focus:border-brand-500 focus:outline-none"
                        />
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="text-[10px] text-rmpg-500">Valid Until</label>
                        <input
                          type="date"
                          value={editForm.valid_until || ''}
                          onChange={e => setEditForm(f => ({ ...f, valid_until: e.target.value }))}
                          className="w-full bg-[#0d1520] border border-rmpg-700 text-white text-xs px-2 py-1 rounded-sm focus:border-brand-500 focus:outline-none"
                        />
                      </div>
                      <div>
                        <label className="text-[10px] text-rmpg-500">Contract Months</label>
                        <input
                          type="number"
                          value={editForm.contract_length_months || ''}
                          onChange={e => setEditForm(f => ({ ...f, contract_length_months: Number(e.target.value) }))}
                          className="w-full bg-[#0d1520] border border-rmpg-700 text-white text-xs px-2 py-1 rounded-sm focus:border-brand-500 focus:outline-none"
                        />
                      </div>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="flex items-center gap-1.5 text-xs text-rmpg-300">
                      <Calendar className="w-3 h-3 text-rmpg-500" /> Start: {formatDate(selectedProposal.proposed_start)}
                    </div>
                    <div className="flex items-center gap-1.5 text-xs text-rmpg-300">
                      <Calendar className="w-3 h-3 text-rmpg-500" /> End: {formatDate(selectedProposal.proposed_end)}
                    </div>
                    <div className="text-xs text-rmpg-300">Valid Until: {formatDate(selectedProposal.valid_until)}</div>
                    {selectedProposal.contract_length_months && (
                      <div className="text-xs text-rmpg-300">Contract: {selectedProposal.contract_length_months} months</div>
                    )}
                  </>
                )}
              </div>

              {/* Stage timestamps */}
              {(selectedProposal.sent_at || selectedProposal.viewed_at || selectedProposal.accepted_at || selectedProposal.rejected_at) && (
                <div className="panel-beveled p-2 space-y-1">
                  <div className="text-[10px] text-rmpg-400 uppercase tracking-wider mb-1">History</div>
                  {selectedProposal.sent_at && <div className="text-[10px] text-rmpg-400"><Send className="w-3 h-3 inline mr-1" /> Sent: {formatDate(selectedProposal.sent_at)}</div>}
                  {selectedProposal.viewed_at && <div className="text-[10px] text-rmpg-400"><Eye className="w-3 h-3 inline mr-1" /> Viewed: {formatDate(selectedProposal.viewed_at)}</div>}
                  {selectedProposal.accepted_at && <div className="text-[10px] text-green-400"><CheckCircle className="w-3 h-3 inline mr-1" /> Accepted: {formatDate(selectedProposal.accepted_at)}</div>}
                  {selectedProposal.rejected_at && <div className="text-[10px] text-red-400"><XCircle className="w-3 h-3 inline mr-1" /> Rejected: {formatDate(selectedProposal.rejected_at)}</div>}
                  {selectedProposal.rejection_reason && <div className="text-[10px] text-red-300 ml-4">Reason: {selectedProposal.rejection_reason}</div>}
                </div>
              )}

              {/* Scope of work */}
              <div className="panel-beveled p-2">
                <div className="text-[10px] text-rmpg-400 uppercase tracking-wider mb-1">Scope of Work</div>
                {editMode ? (
                  <textarea
                    value={editForm.scope_of_work || ''}
                    onChange={e => setEditForm(f => ({ ...f, scope_of_work: e.target.value }))}
                    rows={5}
                    className="w-full bg-[#0d1520] border border-rmpg-700 text-white text-xs px-2 py-1.5 rounded-sm focus:border-brand-500 focus:outline-none resize-none"
                  />
                ) : (
                  <div className="text-xs text-rmpg-300 whitespace-pre-wrap">{selectedProposal.scope_of_work || 'No scope defined'}</div>
                )}
              </div>

              {/* Terms */}
              <div className="panel-beveled p-2">
                <div className="text-[10px] text-rmpg-400 uppercase tracking-wider mb-1">Terms</div>
                {editMode ? (
                  <textarea
                    value={editForm.terms || ''}
                    onChange={e => setEditForm(f => ({ ...f, terms: e.target.value }))}
                    rows={4}
                    className="w-full bg-[#0d1520] border border-rmpg-700 text-white text-xs px-2 py-1.5 rounded-sm focus:border-brand-500 focus:outline-none resize-none"
                  />
                ) : (
                  <div className="text-xs text-rmpg-300 whitespace-pre-wrap">{selectedProposal.terms || 'No terms defined'}</div>
                )}
              </div>

              {/* Notes */}
              <div className="panel-beveled p-2">
                <div className="text-[10px] text-rmpg-400 uppercase tracking-wider mb-1">Notes</div>
                {editMode ? (
                  <textarea
                    value={editForm.notes || ''}
                    onChange={e => setEditForm(f => ({ ...f, notes: e.target.value }))}
                    rows={3}
                    className="w-full bg-[#0d1520] border border-rmpg-700 text-white text-xs px-2 py-1.5 rounded-sm focus:border-brand-500 focus:outline-none resize-none"
                  />
                ) : (
                  <div className="text-xs text-rmpg-300 whitespace-pre-wrap">{selectedProposal.notes || '\u2014'}</div>
                )}
              </div>

              {/* Save edits button */}
              {editMode && (
                <div className="flex justify-end pt-1">
                  <button
                    onClick={handleSaveEdits}
                    disabled={saving}
                    className="bg-brand-600 hover:bg-brand-500 disabled:opacity-40 text-white text-xs font-bold px-3 py-1.5 rounded-sm flex items-center gap-1"
                  >
                    {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />} Save Changes
                  </button>
                </div>
              )}
            </div>
            )}
          </div>
        )}
      </div>

      {/* ── Create Proposal Modal ────────────────────── */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={() => setShowCreateModal(false)}>
          <div className="bg-[#141e2b] border border-rmpg-700 rounded-sm w-full max-w-lg max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <PanelTitleBar title="New Proposal" icon={FileText}>
              <button onClick={() => setShowCreateModal(false)} className="text-rmpg-400 hover:text-white">
                <X className="w-4 h-4" />
              </button>
            </PanelTitleBar>
            <form onSubmit={handleCreate} className="p-3 space-y-2">
              <div>
                <label className="text-[10px] text-rmpg-400 uppercase tracking-wider block mb-0.5">Title *</label>
                <input
                  type="text"
                  required
                  value={form.title}
                  onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
                  className="w-full bg-[#0d1520] border border-rmpg-700 text-white text-sm px-2 py-1.5 rounded-sm focus:border-brand-500 focus:outline-none"
                />
              </div>
              <div>
                <label className="text-[10px] text-rmpg-400 uppercase tracking-wider block mb-0.5">Template</label>
                <select
                  value={form.template_type}
                  onChange={e => handleTemplateChange(e.target.value)}
                  className="w-full bg-[#0d1520] border border-rmpg-700 text-white text-sm px-2 py-1.5 rounded-sm focus:border-brand-500 focus:outline-none"
                >
                  <option value="">Select template...</option>
                  {templates.filter(t => t.is_active).map(t => (
                    <option key={t.id} value={t.template_type}>{t.name}</option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[10px] text-rmpg-400 uppercase tracking-wider block mb-0.5">Link to Lead</label>
                  <select
                    value={form.lead_id}
                    onChange={e => setForm(f => ({ ...f, lead_id: e.target.value }))}
                    className="w-full bg-[#0d1520] border border-rmpg-700 text-white text-xs px-2 py-1.5 rounded-sm focus:border-brand-500 focus:outline-none"
                  >
                    <option value="">None</option>
                    {leads.map(l => (
                      <option key={l.id} value={l.id}>{l.business_name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-[10px] text-rmpg-400 uppercase tracking-wider block mb-0.5">Link to Client</label>
                  <select
                    value={form.client_id}
                    onChange={e => setForm(f => ({ ...f, client_id: e.target.value }))}
                    className="w-full bg-[#0d1520] border border-rmpg-700 text-white text-xs px-2 py-1.5 rounded-sm focus:border-brand-500 focus:outline-none"
                  >
                    <option value="">None</option>
                    {clients.map(c => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div>
                <label className="text-[10px] text-rmpg-400 uppercase tracking-wider block mb-0.5">Scope of Work</label>
                <textarea
                  value={form.scope_of_work}
                  onChange={e => setForm(f => ({ ...f, scope_of_work: e.target.value }))}
                  rows={4}
                  className="w-full bg-[#0d1520] border border-rmpg-700 text-white text-sm px-2 py-1.5 rounded-sm focus:border-brand-500 focus:outline-none resize-none"
                />
              </div>
              <div>
                <label className="text-[10px] text-rmpg-400 uppercase tracking-wider block mb-0.5">Terms</label>
                <textarea
                  value={form.terms}
                  onChange={e => setForm(f => ({ ...f, terms: e.target.value }))}
                  rows={3}
                  className="w-full bg-[#0d1520] border border-rmpg-700 text-white text-sm px-2 py-1.5 rounded-sm focus:border-brand-500 focus:outline-none resize-none"
                />
              </div>
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="text-[10px] text-rmpg-400 uppercase tracking-wider block mb-0.5">Monthly Value</label>
                  <input
                    type="number"
                    step="0.01"
                    value={form.monthly_value}
                    onChange={e => setForm(f => ({ ...f, monthly_value: e.target.value }))}
                    className="w-full bg-[#0d1520] border border-rmpg-700 text-white text-sm px-2 py-1.5 rounded-sm focus:border-brand-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="text-[10px] text-rmpg-400 uppercase tracking-wider block mb-0.5">Total Value</label>
                  <input
                    type="number"
                    step="0.01"
                    value={form.total_value}
                    onChange={e => setForm(f => ({ ...f, total_value: e.target.value }))}
                    className="w-full bg-[#0d1520] border border-rmpg-700 text-white text-sm px-2 py-1.5 rounded-sm focus:border-brand-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="text-[10px] text-rmpg-400 uppercase tracking-wider block mb-0.5">Billing</label>
                  <select
                    value={form.billing_frequency}
                    onChange={e => setForm(f => ({ ...f, billing_frequency: e.target.value }))}
                    className="w-full bg-[#0d1520] border border-rmpg-700 text-white text-sm px-2 py-1.5 rounded-sm focus:border-brand-500 focus:outline-none"
                  >
                    <option value="monthly">Monthly</option>
                    <option value="quarterly">Quarterly</option>
                    <option value="annually">Annually</option>
                    <option value="one_time">One-Time</option>
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="text-[10px] text-rmpg-400 uppercase tracking-wider block mb-0.5">Start Date</label>
                  <input
                    type="date"
                    value={form.proposed_start}
                    onChange={e => setForm(f => ({ ...f, proposed_start: e.target.value }))}
                    className="w-full bg-[#0d1520] border border-rmpg-700 text-white text-sm px-2 py-1.5 rounded-sm focus:border-brand-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="text-[10px] text-rmpg-400 uppercase tracking-wider block mb-0.5">End Date</label>
                  <input
                    type="date"
                    value={form.proposed_end}
                    onChange={e => setForm(f => ({ ...f, proposed_end: e.target.value }))}
                    className="w-full bg-[#0d1520] border border-rmpg-700 text-white text-sm px-2 py-1.5 rounded-sm focus:border-brand-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="text-[10px] text-rmpg-400 uppercase tracking-wider block mb-0.5">Contract Months</label>
                  <input
                    type="number"
                    value={form.contract_length_months}
                    onChange={e => setForm(f => ({ ...f, contract_length_months: e.target.value }))}
                    className="w-full bg-[#0d1520] border border-rmpg-700 text-white text-sm px-2 py-1.5 rounded-sm focus:border-brand-500 focus:outline-none"
                  />
                </div>
              </div>
              <div>
                <label className="text-[10px] text-rmpg-400 uppercase tracking-wider block mb-0.5">Valid Until</label>
                <input
                  type="date"
                  value={form.valid_until}
                  onChange={e => setForm(f => ({ ...f, valid_until: e.target.value }))}
                  className="w-full bg-[#0d1520] border border-rmpg-700 text-white text-sm px-2 py-1.5 rounded-sm focus:border-brand-500 focus:outline-none"
                />
              </div>
              <div>
                <label className="text-[10px] text-rmpg-400 uppercase tracking-wider block mb-0.5">Notes</label>
                <textarea
                  value={form.notes}
                  onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                  rows={2}
                  className="w-full bg-[#0d1520] border border-rmpg-700 text-white text-sm px-2 py-1.5 rounded-sm focus:border-brand-500 focus:outline-none resize-none"
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button type="button" onClick={() => setShowCreateModal(false)} className="text-rmpg-400 hover:text-white text-xs px-3 py-1.5">
                  Cancel
                </button>
                <button type="submit" disabled={saving} className="bg-brand-600 hover:bg-brand-500 disabled:opacity-40 text-white text-xs font-bold px-3 py-1.5 rounded-sm flex items-center gap-1">
                  {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />} Create Proposal
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
