// ============================================================
// RMPG Flex — Sex Offender Registry Lookup Module
// Professional law enforcement registry search and review
// interface with mugshot display, demographics, addresses,
// offenses, compliance status, and officer verification.
// ============================================================

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Search, Loader2, Plus, ChevronLeft, ChevronRight,
  X, AlertTriangle, Shield, ShieldAlert, ShieldCheck, ShieldOff,
  MapPin, Briefcase, GraduationCap, Car, FileText, Clock,
  User, CheckCircle, XCircle, Eye, Edit2, Link2, Save,
  Upload, Download, UserX, Calendar, Hash, Fingerprint,
} from 'lucide-react';
import type { SexOffenderRecord, SORAddress, SOROffense, SORVehicle, SORTier, SORStatus } from '../types';
import PanelTitleBar from '../components/PanelTitleBar';
import SplitPanel from '../components/SplitPanel';
import { apiFetch } from '../hooks/useApi';
import { useLiveSync } from '../hooks/useLiveSync';
import { useToast } from '../components/ToastProvider';
import { useAuth } from '../context/AuthContext';
import ExportButton from '../components/ExportButton';

// Re-type apiFetch for raw Response access (needed for PUT/POST error handling)
async function apiRaw(endpoint: string, options?: RequestInit): Promise<Response> {
  const url = endpoint.startsWith('/api') ? endpoint : `/api${endpoint}`;
  const token = localStorage.getItem('rmpg_token');
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options?.headers as Record<string, string>),
  };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  return fetch(url, { ...options, headers });
}

const PAGE_SIZE = 25;

// ── Tier / Status Display Config ────────────────────────────

const TIER_CONFIG: Record<number, { label: string; color: string; bg: string; border: string }> = {
  1: { label: 'Tier 1', color: '#4ade80', bg: 'rgba(34,197,94,0.15)', border: 'rgba(34,197,94,0.3)' },
  2: { label: 'Tier 2', color: '#fbbf24', bg: 'rgba(245,158,11,0.15)', border: 'rgba(245,158,11,0.3)' },
  3: { label: 'Tier 3', color: '#f87171', bg: 'rgba(239,68,68,0.15)', border: 'rgba(239,68,68,0.3)' },
};

const STATUS_CONFIG: Record<string, { label: string; color: string; ledClass: string }> = {
  compliant:      { label: 'Compliant',      color: '#4ade80', ledClass: 'led-green' },
  non_compliant:  { label: 'Non-Compliant',  color: '#fbbf24', ledClass: 'led-amber' },
  absconded:      { label: 'Absconded',      color: '#f87171', ledClass: 'led-red'   },
  incarcerated:   { label: 'Incarcerated',   color: '#94a3b8', ledClass: ''          },
  removed:        { label: 'Removed',        color: '#64748b', ledClass: ''          },
};

const RISK_COLORS: Record<string, string> = {
  low:      '#4ade80',
  moderate: '#fbbf24',
  high:     '#f87171',
  svp:      '#dc2626',
};

// ── JSON Parse Helper ───────────────────────────────────────

function parseJson<T>(raw: string | undefined | null, fallback: T[]): T[] {
  if (!raw) return fallback;
  try { return JSON.parse(raw); } catch { return fallback; }
}

function formatDate(d?: string | null): string {
  if (!d) return '—';
  try {
    const dt = new Date(d);
    return dt.toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' });
  } catch { return d; }
}

function calcAge(dob?: string | null): string {
  if (!dob) return '';
  try {
    const birth = new Date(dob);
    const today = new Date();
    let age = today.getFullYear() - birth.getFullYear();
    if (today.getMonth() < birth.getMonth() || (today.getMonth() === birth.getMonth() && today.getDate() < birth.getDate())) age--;
    return `(${age})`;
  } catch { return ''; }
}

// ============================================================
// MAIN COMPONENT
// ============================================================

export default function SexOffenderRegistryPage() {
  const { user } = useAuth();
  const { addToast } = useToast();

  // ── Data State ────────────────────────────────────────────
  const [records, setRecords] = useState<SexOffenderRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<SexOffenderRecord | null>(null);
  const [page, setPage] = useState(1);
  const [totalRecords, setTotalRecords] = useState(0);
  const [stats, setStats] = useState<any>(null);

  // ── Filter State ──────────────────────────────────────────
  const [search, setSearch] = useState('');
  const [tierFilter, setTierFilter] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<string>('');

  // ── Modal State ───────────────────────────────────────────
  const [showAddModal, setShowAddModal] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);
  const [editingRecord, setEditingRecord] = useState<SexOffenderRecord | null>(null);
  const [verifying, setVerifying] = useState(false);

  // ── Link Person State ───────────────────────────────────
  const [showLinkPerson, setShowLinkPerson] = useState(false);
  const [linkSearch, setLinkSearch] = useState('');
  const [linkResults, setLinkResults] = useState<any[]>([]);
  const [linkSearching, setLinkSearching] = useState(false);
  const [linkSubmitting, setLinkSubmitting] = useState(false);

  // ── Fetch records (declared before handlers that depend on it) ──
  const fetchRecords = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), limit: String(PAGE_SIZE) });
      if (search) params.set('search', search);
      if (tierFilter) params.set('tier', tierFilter);
      if (statusFilter) params.set('status', statusFilter);

      const body = await apiFetch<{ data: SexOffenderRecord[]; pagination: any }>(`/sex-offender-registry?${params}`);
      setRecords(body.data || []);
      setTotalRecords(body.pagination?.total || 0);
    } catch (err) {
      console.error('Failed to fetch SOR records:', err);
    } finally {
      setLoading(false);
    }
  }, [page, search, tierFilter, statusFilter]);

  const handleLinkPersonSearch = useCallback(async (q: string) => {
    setLinkSearch(q);
    if (q.length < 2) { setLinkResults([]); return; }
    setLinkSearching(true);
    try {
      const res = await apiRaw(`/api/records/persons/search?q=${encodeURIComponent(q)}`);
      if (res.ok) {
        const data = await res.json();
        setLinkResults(data.data || data || []);
      }
    } catch { /* ignore */ }
    setLinkSearching(false);
  }, []);

  const handleLinkPerson = useCallback(async (personId: string) => {
    if (!selected) return;
    setLinkSubmitting(true);
    try {
      const res = await apiRaw(`/api/sex-offender-registry/${selected.id}`, {
        method: 'PUT',
        body: JSON.stringify({ person_id: personId }),
      });
      if (res.ok) {
        addToast('Person linked to sex offender record', 'success');
        setShowLinkPerson(false);
        setLinkSearch('');
        setLinkResults([]);
        fetchRecords();
      } else {
        const err = await res.json().catch(() => ({ error: 'Failed' }));
        addToast(err.error || 'Link failed', 'error');
      }
    } catch {
      addToast('Network error', 'error');
    }
    setLinkSubmitting(false);
  }, [selected, addToast, fetchRecords]);

  const fetchStats = useCallback(async () => {
    try {
      const body = await apiFetch<{ data: any }>('/sex-offender-registry/stats');
      setStats(body.data);
    } catch { /* silent */ }
  }, []);

  useEffect(() => { fetchRecords(); }, [fetchRecords]);
  useEffect(() => { fetchStats(); }, [fetchStats]);
  useLiveSync('sex-offender-registry', () => { fetchRecords(); fetchStats(); });

  // ── Debounced search ──────────────────────────────────────
  const [searchInput, setSearchInput] = useState('');
  useEffect(() => {
    const t = setTimeout(() => { setSearch(searchInput); setPage(1); }, 350);
    return () => clearTimeout(t);
  }, [searchInput]);

  // ── Pagination ────────────────────────────────────────────
  const totalPages = Math.ceil(totalRecords / PAGE_SIZE);

  // ── Verify compliance ─────────────────────────────────────
  const handleVerify = async (record: SexOffenderRecord, newStatus?: string) => {
    setVerifying(true);
    try {
      const res = await apiRaw(`/sex-offender-registry/${record.id}/verify`, {
        method: 'PUT',
        body: JSON.stringify({ status: newStatus || 'compliant' }),
      });
      if (res.ok) {
        const body = await res.json() as any;
        addToast('Compliance verification logged', 'success');
        setRecords(prev => prev.map(r => r.id === record.id ? {
          ...r,
          last_verification: body.data.last_verification,
          next_verification_due: body.data.next_verification_due,
          registration_status: (newStatus || 'compliant') as any,
        } : r));
        if (selected?.id === record.id) {
          setSelected(prev => prev ? {
            ...prev,
            last_verification: body.data.last_verification,
            next_verification_due: body.data.next_verification_due,
            registration_status: (newStatus || 'compliant') as any,
          } : null);
        }
        fetchStats();
      }
    } catch { addToast('Verification failed', 'error'); }
    finally { setVerifying(false); }
  };

  // ── Save Record (Add/Edit) ────────────────────────────────
  const handleSaveRecord = async (formData: Partial<SexOffenderRecord>) => {
    try {
      const isEdit = !!editingRecord;
      const url = isEdit ? `/sex-offender-registry/${editingRecord!.id}` : '/sex-offender-registry';
      const res = await apiRaw(url, {
        method: isEdit ? 'PUT' : 'POST',
        body: JSON.stringify(formData),
      });
      if (res.ok) {
        addToast(isEdit ? 'Record updated' : 'Record created', 'success');
        setShowAddModal(false);
        setEditingRecord(null);
        fetchRecords();
        fetchStats();
      } else {
        const err = await res.json() as any;
        addToast(err.error || 'Save failed', 'error');
      }
    } catch { addToast('Save failed', 'error'); }
  };

  // ── Import Records ────────────────────────────────────────
  const handleImport = async (importRecords: any[]) => {
    try {
      const res = await apiRaw('/sex-offender-registry/import', {
        method: 'POST',
        body: JSON.stringify({ records: importRecords }),
      });
      if (res.ok) {
        const body = await res.json() as any;
        addToast(`Imported ${body.data.imported} records (${body.data.skipped} skipped)`, 'success');
        setShowImportModal(false);
        fetchRecords();
        fetchStats();
      }
    } catch { addToast('Import failed', 'error'); }
  };

  // ── Computed Values ───────────────────────────────────────
  const statTotal = stats?.total || 0;
  const statCompliant = stats?.by_status?.compliant || 0;
  const statNonCompliant = stats?.non_compliant || 0;
  const statDueVerify = stats?.due_for_verification || 0;
  const statTier3 = stats?.by_tier?.[3] || 0;

  // ============================================================
  // LEFT PANEL — Registry List
  // ============================================================
  const leftPanel = (
    <div className="flex flex-col h-full  bg-surface-sunken">
      {/* Stats Strip */}
      <div
        className="flex items-center gap-4 px-3 py-1.5 text-[11px] font-mono flex-shrink-0 overflow-x-auto"
        style={{ background: 'linear-gradient(180deg, var(--surface-raised) 0%, var(--surface-base) 100%)', borderBottom: '1px solid var(--border-default)' }}
      >
        <span className="flex items-center gap-1.5">
          <span className="led-dot led-amber" style={{ width: 6, height: 6 }} />
          <span className="text-amber-400 font-bold">{statTotal}</span>
          <span className="text-rmpg-500">Total</span>
        </span>
        <span className="flex items-center gap-1.5">
          <span className="led-dot led-green" style={{ width: 6, height: 6 }} />
          <span className="text-green-400">{statCompliant}</span>
          <span className="text-rmpg-500">Compliant</span>
        </span>
        <span className="flex items-center gap-1.5">
          <span className="led-dot led-red" style={{ width: 6, height: 6 }} />
          <span className="text-red-400 font-bold">{statNonCompliant}</span>
          <span className="text-rmpg-500">Non-Compl</span>
        </span>
        <span className="flex items-center gap-1.5">
          <span className="text-red-300">{statTier3}</span>
          <span className="text-rmpg-500">Tier 3</span>
        </span>
        {statDueVerify > 0 && (
          <span className="flex items-center gap-1.5">
            <Clock size={10} className="text-amber-400" />
            <span className="text-amber-300">{statDueVerify}</span>
            <span className="text-rmpg-500">Due</span>
          </span>
        )}
      </div>

      {/* Search + Filters */}
      <div
        className="flex items-center gap-2 px-3 py-2 flex-shrink-0 flex-wrap"
        style={{ background: 'var(--surface-base)', borderBottom: '1px solid var(--border-default)' }}
      >
        <div className="relative flex-1 min-w-[140px]">
          <Search size={13} className="absolute left-2 top-1/2 -translate-y-1/2 text-rmpg-500" />
          <input
            type="text"
            value={searchInput}
            onChange={e => setSearchInput(e.target.value)}
            placeholder="Search name or registry ID..."
            className="w-full pl-7 pr-2 py-1 text-xs bg-surface-sunken border border-rmpg-700 rounded-sm text-white placeholder-rmpg-600 focus:border-brand-500 focus:outline-none"
          />
        </div>
        <select
          value={tierFilter}
          onChange={e => { setTierFilter(e.target.value); setPage(1); }}
          className="text-[11px] bg-surface-sunken border border-rmpg-700 rounded-sm text-rmpg-300 px-1.5 py-1 focus:border-brand-500 focus:outline-none"
        >
          <option value="">All Tiers</option>
          <option value="1">Tier 1</option>
          <option value="2">Tier 2</option>
          <option value="3">Tier 3</option>
        </select>
        <select
          value={statusFilter}
          onChange={e => { setStatusFilter(e.target.value); setPage(1); }}
          className="text-[11px] bg-surface-sunken border border-rmpg-700 rounded-sm text-rmpg-300 px-1.5 py-1 focus:border-brand-500 focus:outline-none"
        >
          <option value="">All Status</option>
          <option value="compliant">Compliant</option>
          <option value="non_compliant">Non-Compliant</option>
          <option value="absconded">Absconded</option>
          <option value="incarcerated">Incarcerated</option>
        </select>
      </div>

      {/* Record List */}
      <div className="flex-1 overflow-y-auto min-h-0">
        {loading ? (
          <div className="flex items-center justify-center h-32 text-rmpg-500">
            <Loader2 size={20} className="animate-spin mr-2" /> Loading...
          </div>
        ) : records.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-32 text-rmpg-500 text-xs">
            <UserX size={24} className="mb-2 opacity-50" />
            No records found
          </div>
        ) : (
          <div className="divide-y divide-rmpg-800/50">
            {records.map(r => {
              const tier = TIER_CONFIG[r.tier] || TIER_CONFIG[1];
              const status = STATUS_CONFIG[r.registration_status] || STATUS_CONFIG.compliant;
              const isSelected = selected?.id === r.id;
              return (
                <button
                  key={r.id}
                  onClick={() => setSelected(r)}
                  className="w-full flex items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-rmpg-800/30"
                  style={{
                    background: isSelected ? 'rgba(26,90,158,0.15)' : undefined,
                    borderLeft: isSelected ? '3px solid var(--brand-blue)' : '3px solid transparent',
                  }}
                >
                  {/* Mugshot Thumbnail */}
                  <div
                    className="w-12 h-14 rounded-sm flex-shrink-0 flex items-center justify-center overflow-hidden"
                    style={{ background: 'var(--surface-raised)', border: '1px solid var(--border-strong)' }}
                  >
                    {r.photo_url ? (
                      <img src={r.photo_url} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <User size={20} className="text-rmpg-600" />
                    )}
                  </div>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-white text-xs font-bold truncate">
                        {r.last_name.toUpperCase()}, {r.first_name}
                      </span>
                      {/* Tier Badge */}
                      <span
                        className="text-[9px] font-bold px-1.5 py-0.5 rounded-sm flex-shrink-0"
                        style={{ background: tier.bg, color: tier.color, border: `1px solid ${tier.border}` }}
                      >
                        {tier.label}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 mt-0.5">
                      {/* Status LED */}
                      {status.ledClass && (
                        <span className={`led-dot ${status.ledClass}`} style={{ width: 6, height: 6 }} />
                      )}
                      <span className="text-[10px]" style={{ color: status.color }}>{status.label}</span>
                      {r.dob && (
                        <span className="text-[10px] text-rmpg-500">DOB: {formatDate(r.dob)} {calcAge(r.dob)}</span>
                      )}
                    </div>
                    {r.registry_id && (
                      <div className="text-[9px] text-rmpg-600 mt-0.5 font-mono">{r.registry_id}</div>
                    )}
                  </div>

                  {/* Risk indicator */}
                  {r.risk_level && (
                    <div className="flex-shrink-0">
                      <ShieldAlert size={14} style={{ color: RISK_COLORS[r.risk_level] || '#94a3b8' }} />
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div
          className="flex items-center justify-between px-3 py-1.5 text-[10px] text-rmpg-500 flex-shrink-0"
          style={{ background: 'var(--surface-base)', borderTop: '1px solid var(--border-default)' }}
        >
          <span>{(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, totalRecords)} of {totalRecords}</span>
          <div className="flex items-center gap-1">
            <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
              className="toolbar-btn p-0.5 disabled:opacity-30"><ChevronLeft size={12} /></button>
            {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
              const p = page <= 3 ? i + 1 : page + i - 2;
              if (p < 1 || p > totalPages) return null;
              return (
                <button key={p} onClick={() => setPage(p)}
                  className={`px-1.5 py-0.5 rounded-sm text-[10px] ${p === page ? 'bg-brand-500/30 text-brand-300 font-bold' : 'hover:bg-rmpg-800 text-rmpg-400'}`}
                >{p}</button>
              );
            })}
            <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}
              className="toolbar-btn p-0.5 disabled:opacity-30"><ChevronRight size={12} /></button>
          </div>
        </div>
      )}
    </div>
  );

  // ============================================================
  // RIGHT PANEL — Detail Profile
  // ============================================================
  const rightPanel = selected ? (
    <div className="h-full overflow-y-auto  bg-surface-sunken">
      {/* Close button */}
      <button
        onClick={() => setSelected(null)}
        className="absolute top-2 right-2 z-10 toolbar-btn p-1"
        title="Close"
      >
        <X size={14} />
      </button>

      {/* Header Section */}
      <div className="p-4 relative" style={{ background: 'linear-gradient(180deg, var(--surface-raised) 0%, var(--surface-base) 100%)', borderBottom: '1px solid var(--border-default)' }}>
        <div className="flex gap-4">
          {/* Large Mugshot */}
          <div
            className="w-[100px] h-[130px] rounded-sm flex-shrink-0 flex items-center justify-center overflow-hidden bg-surface-sunken border-2 border-rmpg-600"
          >
            {selected.photo_url ? (
              <img src={selected.photo_url} alt="" className="w-full h-full object-cover" />
            ) : (
              <User size={40} className="text-rmpg-600" />
            )}
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-white font-bold text-base truncate">
              {selected.last_name.toUpperCase()}, {selected.first_name} {selected.middle_name || ''}
            </h2>
            <div className="flex items-center gap-2 mt-1 flex-wrap">
              {/* Tier badge */}
              {(() => {
                const t = TIER_CONFIG[selected.tier] || TIER_CONFIG[1];
                return (
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-sm"
                    style={{ background: t.bg, color: t.color, border: `1px solid ${t.border}` }}>
                    {t.label}
                  </span>
                );
              })()}
              {/* Risk Level */}
              {selected.risk_level && (
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-sm uppercase"
                  style={{
                    background: `${RISK_COLORS[selected.risk_level]}15`,
                    color: RISK_COLORS[selected.risk_level],
                    border: `1px solid ${RISK_COLORS[selected.risk_level]}40`,
                  }}>
                  {selected.risk_level === 'svp' ? 'SVP' : selected.risk_level} Risk
                </span>
              )}
              {/* Status */}
              {(() => {
                const s = STATUS_CONFIG[selected.registration_status] || STATUS_CONFIG.compliant;
                return (
                  <span className="flex items-center gap-1 text-[10px]" style={{ color: s.color }}>
                    {s.ledClass && <span className={`led-dot ${s.ledClass}`} style={{ width: 6, height: 6 }} />}
                    {s.label}
                  </span>
                );
              })()}
            </div>
            {selected.registry_id && (
              <div className="text-[11px] text-rmpg-400 font-mono mt-1.5 flex items-center gap-1">
                <Hash size={10} /> {selected.registry_id}
              </div>
            )}
            {selected.registration_date && (
              <div className="text-[10px] text-rmpg-500 mt-0.5">
                Registered: {formatDate(selected.registration_date)}
                {selected.registration_jurisdiction && ` • ${selected.registration_jurisdiction}`}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Demographics Section */}
      <DetailSection title="Demographics" icon={<Fingerprint size={12} />}>
        <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[11px]">
          <Field label="DOB" value={`${formatDate(selected.dob)} ${calcAge(selected.dob)}`} />
          <Field label="Gender" value={selected.gender} />
          <Field label="Race" value={selected.race} />
          <Field label="Height" value={selected.height} />
          <Field label="Weight" value={selected.weight} />
          <Field label="Hair" value={selected.hair_color} />
          <Field label="Eyes" value={selected.eye_color} />
          <Field label="Conviction State" value={selected.conviction_state} />
        </div>
        {selected.scars_marks_tattoos && (
          <div className="mt-2 text-[11px]">
            <span className="text-rmpg-500">Scars/Marks/Tattoos: </span>
            <span className="text-rmpg-300">{selected.scars_marks_tattoos}</span>
          </div>
        )}
        {selected.aliases && (() => {
          const aliases = parseJson<string>(selected.aliases, []);
          return aliases.length > 0 ? (
            <div className="mt-1 text-[11px]">
              <span className="text-rmpg-500">Aliases: </span>
              <span className="text-amber-400">{aliases.join(', ')}</span>
            </div>
          ) : null;
        })()}
      </DetailSection>

      {/* Addresses Section */}
      {(() => {
        const addrs = parseJson<SORAddress>(selected.addresses, []);
        return addrs.length > 0 ? (
          <DetailSection title="Addresses" icon={<MapPin size={12} />}>
            <div className="space-y-2">
              {addrs.map((a, i) => (
                <div key={i} className="flex items-start gap-2 text-[11px]">
                  <span className="text-rmpg-500 flex-shrink-0 w-14 uppercase text-[9px] font-bold mt-0.5"
                    style={{ color: a.type === 'home' ? '#4ade80' : a.type === 'work' ? '#60a5fa' : a.type === 'school' ? '#c084fc' : '#fbbf24' }}>
                    {a.type}
                  </span>
                  <div>
                    <div className="text-rmpg-200">{a.street}</div>
                    <div className="text-rmpg-400">{a.city}, {a.state} {a.zip}</div>
                    {a.verified_date && <div className="text-[9px] text-rmpg-600">Verified: {formatDate(a.verified_date)}</div>}
                  </div>
                </div>
              ))}
            </div>
          </DetailSection>
        ) : null;
      })()}

      {/* Offenses Section */}
      {(() => {
        const offs = parseJson<SOROffense>(selected.offenses, []);
        return offs.length > 0 ? (
          <DetailSection title="Offenses" icon={<FileText size={12} />}>
            <div className="space-y-2">
              {offs.map((o, i) => (
                <div key={i} className="p-2 rounded-sm bg-surface-sunken border border-rmpg-700">
                  <div className="flex items-center gap-2">
                    <span className="text-red-400 text-[11px] font-mono font-bold">{o.statute}</span>
                    {o.date && <span className="text-[10px] text-rmpg-500">{formatDate(o.date)}</span>}
                  </div>
                  <div className="text-[11px] text-rmpg-300 mt-0.5">{o.description}</div>
                  <div className="flex gap-3 mt-0.5 text-[9px] text-rmpg-500">
                    {o.victim_age && <span>Victim Age: {o.victim_age}</span>}
                    {o.court && <span>Court: {o.court}</span>}
                    {o.case_number && <span>Case: {o.case_number}</span>}
                  </div>
                </div>
              ))}
            </div>
          </DetailSection>
        ) : null;
      })()}

      {/* Compliance Section */}
      <DetailSection title="Compliance Status" icon={<ShieldCheck size={12} />}>
        <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[11px]">
          <Field label="Status" value={
            <span className="flex items-center gap-1" style={{ color: (STATUS_CONFIG[selected.registration_status] || STATUS_CONFIG.compliant).color }}>
              {(STATUS_CONFIG[selected.registration_status] || STATUS_CONFIG.compliant).ledClass && (
                <span className={`led-dot ${(STATUS_CONFIG[selected.registration_status] || STATUS_CONFIG.compliant).ledClass}`} style={{ width: 6, height: 6 }} />
              )}
              {(STATUS_CONFIG[selected.registration_status] || STATUS_CONFIG.compliant).label}
            </span>
          } />
          <Field label="Tier" value={`${selected.tier} (${selected.tier === 3 ? '90-day' : selected.tier === 2 ? '180-day' : '365-day'} check)`} />
          <Field label="Last Verified" value={formatDate(selected.last_verification)} />
          <Field label="Next Due" value={
            selected.next_verification_due ? (
              <span style={{ color: new Date(selected.next_verification_due) < new Date() ? '#f87171' : '#4ade80' }}>
                {formatDate(selected.next_verification_due)}
              </span>
            ) : '—'
          } />
          <Field label="Registered" value={formatDate(selected.registration_date)} />
          <Field label="Expires" value={formatDate(selected.expiration_date)} />
        </div>
        <div className="flex gap-2 mt-3">
          <button
            onClick={() => handleVerify(selected)}
            disabled={verifying}
            className="toolbar-btn px-3 py-1 text-[11px] flex items-center gap-1"
            style={{ background: 'rgba(34,197,94,0.15)', border: '1px solid rgba(34,197,94,0.3)', color: '#4ade80' }}
          >
            {verifying ? <Loader2 size={12} className="animate-spin" /> : <CheckCircle size={12} />}
            Verify Compliant
          </button>
          <button
            onClick={() => handleVerify(selected, 'non_compliant')}
            disabled={verifying}
            className="toolbar-btn px-3 py-1 text-[11px] flex items-center gap-1"
            style={{ background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.3)', color: '#f87171' }}
          >
            <XCircle size={12} /> Flag Non-Compliant
          </button>
        </div>
      </DetailSection>

      {/* Vehicles Section */}
      {(() => {
        const vehs = parseJson<SORVehicle>(selected.vehicles, []);
        return vehs.length > 0 ? (
          <DetailSection title="Vehicles" icon={<Car size={12} />}>
            <div className="space-y-1">
              {vehs.map((v, i) => (
                <div key={i} className="flex items-center gap-2 text-[11px] text-rmpg-300">
                  <Car size={11} className="text-rmpg-500" />
                  <span>{[v.year, v.color, v.make, v.model].filter(Boolean).join(' ')}</span>
                  {v.plate && <span className="font-mono text-amber-400">{v.state || ''} {v.plate}</span>}
                </div>
              ))}
            </div>
          </DetailSection>
        ) : null;
      })()}

      {/* Employment & School Section */}
      {(selected.employer || selected.school) && (
        <DetailSection title="Employment & School" icon={<Briefcase size={12} />}>
          {selected.employer && (
            <div className="text-[11px] mb-1">
              <span className="text-rmpg-500">Employer: </span>
              <span className="text-rmpg-200">{selected.employer}</span>
              {selected.employer_address && <div className="text-rmpg-400 text-[10px] ml-[65px]">{selected.employer_address}</div>}
            </div>
          )}
          {selected.school && (
            <div className="text-[11px]">
              <span className="text-rmpg-500">School: </span>
              <span className="text-rmpg-200">{selected.school}</span>
              {selected.school_address && <div className="text-rmpg-400 text-[10px] ml-[47px]">{selected.school_address}</div>}
            </div>
          )}
        </DetailSection>
      )}

      {/* Restrictions Section */}
      {(selected.restrictions || parseJson(selected.conditions, []).length > 0) && (
        <DetailSection title="Restrictions & Conditions" icon={<ShieldOff size={12} />}>
          {selected.restrictions && (
            <div className="text-[11px] text-rmpg-300 mb-2">{selected.restrictions}</div>
          )}
          {(() => {
            const conds = parseJson<string>(selected.conditions, []);
            return conds.length > 0 ? (
              <div className="space-y-0.5">
                {conds.map((c, i) => (
                  <div key={i} className="flex items-start gap-1.5 text-[11px] text-rmpg-400">
                    <span className="text-rmpg-600 mt-0.5">•</span> {c}
                  </div>
                ))}
              </div>
            ) : null;
          })()}
          {selected.supervising_officer && (
            <div className="text-[11px] mt-2">
              <span className="text-rmpg-500">Supervising Officer: </span>
              <span className="text-rmpg-300">{selected.supervising_officer}</span>
            </div>
          )}
        </DetailSection>
      )}

      {/* Notes Section */}
      {selected.notes && (
        <DetailSection title="Notes" icon={<FileText size={12} />}>
          <div className="text-[11px] text-rmpg-300 whitespace-pre-wrap">{selected.notes}</div>
        </DetailSection>
      )}

      {/* Quick Actions */}
      <div className="p-3 flex gap-2 flex-wrap" style={{ borderTop: '1px solid var(--border-default)' }}>
        <button
          onClick={() => { setEditingRecord(selected); setShowAddModal(true); }}
          className="toolbar-btn px-3 py-1.5 text-[11px] flex items-center gap-1.5"
        >
          <Edit2 size={11} /> Edit Entry
        </button>
        <button
          className="toolbar-btn px-3 py-1.5 text-[11px] flex items-center gap-1.5"
          onClick={() => { setShowLinkPerson(true); setLinkSearch(''); setLinkResults([]); }}
        >
          <Link2 size={11} /> Link Person
        </button>
        <div className="flex-1" />
        <span className="text-[9px] text-rmpg-600 self-center">
          Source: {selected.source} • ID: {selected.id}
        </span>
      </div>
    </div>
  ) : (
    <div className="flex flex-col items-center justify-center h-full text-rmpg-500  bg-surface-sunken">
      <ShieldAlert size={48} className="mb-3 opacity-20" />
      <span className="text-sm">Select a record to view details</span>
    </div>
  );

  // ============================================================
  // RENDER
  // ============================================================
  return (
    <div className="flex flex-col h-full  bg-surface-sunken">
      {/* Title Bar */}
      <PanelTitleBar
        title="Sex Offender Registry"
        icon={ShieldAlert}
      >
        <div className="flex items-center gap-2">
          <button
            onClick={() => { setEditingRecord(null); setShowAddModal(true); }}
            className="toolbar-btn px-2.5 py-1 text-[11px] flex items-center gap-1.5"
          >
            <Plus size={12} /> Add Entry
          </button>
          <button
            onClick={() => setShowImportModal(true)}
            className="toolbar-btn px-2.5 py-1 text-[11px] flex items-center gap-1.5"
          >
            <Upload size={12} /> Import
          </button>
          <ExportButton exportUrl="/api/sex-offender-registry/export/csv" exportFilename="sex-offenders.csv" />
        </div>
      </PanelTitleBar>

      {/* Main Content — SplitPanel */}
      <div className="flex-1 min-h-0">
        <SplitPanel
          left={leftPanel}
          right={rightPanel}
          rightVisible={!!selected}
          initialRatio={0.38}
          minLeftPx={300}
          minRightPx={400}
          persistKey="sor-split"
          leftLabel="Registry"
          rightLabel="Profile"
        />
      </div>

      {/* ── Add/Edit Modal ────────────────────────────────── */}
      {showAddModal && (
        <RecordFormModal
          record={editingRecord}
          onSave={handleSaveRecord}
          onClose={() => { setShowAddModal(false); setEditingRecord(null); }}
        />
      )}

      {/* ── Import Modal ──────────────────────────────────── */}
      {showImportModal && (
        <ImportModal
          onImport={handleImport}
          onClose={() => setShowImportModal(false)}
        />
      )}

      {/* ── Link Person Modal ──────────────────────────────── */}
      {showLinkPerson && selected && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={() => setShowLinkPerson(false)}>
          <div
            className="bg-surface-raised border border-rmpg-600 shadow-xl w-[440px] max-w-[95vw]"
            style={{ borderRadius: 2 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-4 py-2.5 border-b border-rmpg-600 flex items-center justify-between">
              <h3 className="text-xs font-bold text-rmpg-100 uppercase tracking-wider">
                Link to Person Record
              </h3>
              <button onClick={() => setShowLinkPerson(false)} className="text-rmpg-400 hover:text-white">
                <X size={14} />
              </button>
            </div>
            <div className="p-4 space-y-3">
              <p className="text-[11px] text-rmpg-300">
                Link <span className="text-white font-bold">{selected.first_name} {selected.last_name}</span> to an existing person record in the RMS.
              </p>
              <div className="relative">
                <Search size={14} className="absolute left-2 top-2 text-rmpg-500" />
                <input
                  value={linkSearch}
                  onChange={(e) => handleLinkPersonSearch(e.target.value)}
                  placeholder="Search persons by name..."
                  className="w-full pl-7 pr-3 py-1.5 text-xs bg-surface-sunken border border-rmpg-600 text-white placeholder-rmpg-500"
                  style={{ borderRadius: 2 }}
                  autoFocus
                />
              </div>
              {linkSearching && (
                <div className="flex items-center gap-2 text-[10px] text-rmpg-400">
                  <Loader2 size={12} className="animate-spin" /> Searching…
                </div>
              )}
              {linkResults.length > 0 && (
                <div className="max-h-48 overflow-y-auto space-y-1">
                  {linkResults.map((p: any) => (
                    <button
                      key={p.id}
                      onClick={() => handleLinkPerson(p.id)}
                      disabled={linkSubmitting}
                      className="w-full flex items-center gap-2 px-2 py-1.5 bg-surface-sunken border border-rmpg-700 hover:bg-rmpg-700 transition-colors text-left disabled:opacity-50"
                    >
                      <User size={12} className="text-rmpg-400 shrink-0" />
                      <span className="text-[11px] text-white font-bold truncate">
                        {p.last_name}, {p.first_name}
                      </span>
                      {p.dob && (
                        <span className="text-[10px] text-rmpg-400">DOB: {formatDate(p.dob)}</span>
                      )}
                      <span className="flex-1" />
                      <Link2 size={10} className="text-brand-400 shrink-0" />
                    </button>
                  ))}
                </div>
              )}
              {linkSearch.length >= 2 && !linkSearching && linkResults.length === 0 && (
                <p className="text-[10px] text-rmpg-500 text-center py-2">No matching persons found</p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================
// HELPER COMPONENTS
// ============================================================

function DetailSection({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="px-4 py-3" style={{ borderBottom: '1px solid var(--border-default)' }}>
      <h3 className="flex items-center gap-1.5 text-[11px] font-bold text-rmpg-400 uppercase tracking-wider mb-2">
        {icon} {title}
      </h3>
      {children}
    </div>
  );
}

function Field({ label, value }: { label: string; value?: React.ReactNode }) {
  return (
    <div>
      <span className="text-rmpg-500">{label}: </span>
      <span className="text-rmpg-200">{value || '—'}</span>
    </div>
  );
}

// ============================================================
// RECORD FORM MODAL (Add / Edit)
// ============================================================

function RecordFormModal({
  record,
  onSave,
  onClose,
}: {
  record: SexOffenderRecord | null;
  onSave: (data: Partial<SexOffenderRecord>) => void;
  onClose: () => void;
}) {
  const [form, setForm] = useState<any>({
    first_name: record?.first_name || '',
    last_name: record?.last_name || '',
    middle_name: record?.middle_name || '',
    registry_id: record?.registry_id || '',
    dob: record?.dob || '',
    gender: record?.gender || '',
    race: record?.race || '',
    height: record?.height || '',
    weight: record?.weight || '',
    hair_color: record?.hair_color || '',
    eye_color: record?.eye_color || '',
    scars_marks_tattoos: record?.scars_marks_tattoos || '',
    tier: record?.tier || 1,
    risk_level: record?.risk_level || '',
    registration_status: record?.registration_status || 'compliant',
    registration_date: record?.registration_date || '',
    expiration_date: record?.expiration_date || '',
    registration_jurisdiction: record?.registration_jurisdiction || '',
    conviction_state: record?.conviction_state || '',
    employer: record?.employer || '',
    employer_address: record?.employer_address || '',
    school: record?.school || '',
    school_address: record?.school_address || '',
    restrictions: record?.restrictions || '',
    supervising_officer: record?.supervising_officer || '',
    notes: record?.notes || '',
  });
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.first_name || !form.last_name) return;
    setSaving(true);
    await onSave(form);
    setSaving(false);
  };

  const set = (key: string, val: any) => setForm((f: any) => ({ ...f, [key]: val }));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div
        className="w-full max-w-2xl max-h-[85vh] overflow-y-auto rounded-sm shadow-2xl bg-surface-base border border-rmpg-600"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-3" style={{ background: 'var(--surface-raised)', borderBottom: '1px solid var(--border-strong)' }}>
          <h2 className="text-sm font-bold text-white flex items-center gap-2">
            <ShieldAlert size={14} className="text-red-400" />
            {record ? 'Edit Registry Entry' : 'New Registry Entry'}
          </h2>
          <button onClick={onClose} className="toolbar-btn p-1"><X size={14} /></button>
        </div>
        <form onSubmit={handleSubmit} className="p-4 space-y-4">
          {/* Name */}
          <div className="grid grid-cols-3 gap-2">
            <FormField label="First Name *" value={form.first_name} onChange={v => set('first_name', v)} />
            <FormField label="Middle Name" value={form.middle_name} onChange={v => set('middle_name', v)} />
            <FormField label="Last Name *" value={form.last_name} onChange={v => set('last_name', v)} />
          </div>

          {/* Registry & Classification */}
          <div className="grid grid-cols-3 gap-2">
            <FormField label="Registry ID" value={form.registry_id} onChange={v => set('registry_id', v)} placeholder="UT-SO-XXXXXXXX" />
            <div>
              <label className="block text-[10px] text-rmpg-500 mb-0.5 uppercase">Tier</label>
              <select value={form.tier} onChange={e => set('tier', parseInt(e.target.value, 10))}
                className="w-full text-xs bg-surface-sunken border border-rmpg-700 rounded-sm text-white px-2 py-1.5 focus:border-brand-500 focus:outline-none">
                <option value={1}>Tier 1 — Low</option>
                <option value={2}>Tier 2 — Moderate</option>
                <option value={3}>Tier 3 — High</option>
              </select>
            </div>
            <div>
              <label className="block text-[10px] text-rmpg-500 mb-0.5 uppercase">Risk Level</label>
              <select value={form.risk_level} onChange={e => set('risk_level', e.target.value)}
                className="w-full text-xs bg-surface-sunken border border-rmpg-700 rounded-sm text-white px-2 py-1.5 focus:border-brand-500 focus:outline-none">
                <option value="">— None —</option>
                <option value="low">Low</option>
                <option value="moderate">Moderate</option>
                <option value="high">High</option>
                <option value="svp">SVP (Sexually Violent Predator)</option>
              </select>
            </div>
          </div>

          {/* Demographics */}
          <div className="grid grid-cols-4 gap-2">
            <FormField label="DOB" type="date" value={form.dob} onChange={v => set('dob', v)} />
            <FormField label="Gender" value={form.gender} onChange={v => set('gender', v)} />
            <FormField label="Race" value={form.race} onChange={v => set('race', v)} />
            <FormField label="Conviction State" value={form.conviction_state} onChange={v => set('conviction_state', v)} />
          </div>
          <div className="grid grid-cols-4 gap-2">
            <FormField label="Height" value={form.height} onChange={v => set('height', v)} placeholder="5'10&quot;" />
            <FormField label="Weight" value={form.weight} onChange={v => set('weight', v)} placeholder="180 lbs" />
            <FormField label="Hair Color" value={form.hair_color} onChange={v => set('hair_color', v)} />
            <FormField label="Eye Color" value={form.eye_color} onChange={v => set('eye_color', v)} />
          </div>
          <FormField label="Scars / Marks / Tattoos" value={form.scars_marks_tattoos} onChange={v => set('scars_marks_tattoos', v)} multiline />

          {/* Registration */}
          <div className="grid grid-cols-3 gap-2">
            <div>
              <label className="block text-[10px] text-rmpg-500 mb-0.5 uppercase">Status</label>
              <select value={form.registration_status} onChange={e => set('registration_status', e.target.value)}
                className="w-full text-xs bg-surface-sunken border border-rmpg-700 rounded-sm text-white px-2 py-1.5 focus:border-brand-500 focus:outline-none">
                <option value="compliant">Compliant</option>
                <option value="non_compliant">Non-Compliant</option>
                <option value="absconded">Absconded</option>
                <option value="incarcerated">Incarcerated</option>
              </select>
            </div>
            <FormField label="Reg. Date" type="date" value={form.registration_date} onChange={v => set('registration_date', v)} />
            <FormField label="Expiration" type="date" value={form.expiration_date} onChange={v => set('expiration_date', v)} />
          </div>
          <FormField label="Jurisdiction" value={form.registration_jurisdiction} onChange={v => set('registration_jurisdiction', v)} />

          {/* Employment / School */}
          <div className="grid grid-cols-2 gap-2">
            <FormField label="Employer" value={form.employer} onChange={v => set('employer', v)} />
            <FormField label="Employer Address" value={form.employer_address} onChange={v => set('employer_address', v)} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <FormField label="School" value={form.school} onChange={v => set('school', v)} />
            <FormField label="School Address" value={form.school_address} onChange={v => set('school_address', v)} />
          </div>

          {/* Supervision */}
          <FormField label="Supervising Officer" value={form.supervising_officer} onChange={v => set('supervising_officer', v)} />
          <FormField label="Restrictions" value={form.restrictions} onChange={v => set('restrictions', v)} multiline />
          <FormField label="Notes" value={form.notes} onChange={v => set('notes', v)} multiline />

          {/* Submit */}
          <div className="flex justify-end gap-2 pt-2" style={{ borderTop: '1px solid var(--border-default)' }}>
            <button type="button" onClick={onClose} className="toolbar-btn px-4 py-1.5 text-xs">Cancel</button>
            <button
              type="submit"
              disabled={saving || !form.first_name || !form.last_name}
              className="px-4 py-1.5 text-xs font-bold rounded-sm flex items-center gap-1.5 disabled:opacity-50"
              style={{ background: 'var(--brand-blue)', color: '#fff', border: '1px solid #2a7acf' }}
            >
              {saving ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
              {record ? 'Update' : 'Create'} Entry
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function FormField({
  label, value, onChange, type = 'text', placeholder, multiline,
}: {
  label: string; value: string; onChange: (v: string) => void;
  type?: string; placeholder?: string; multiline?: boolean;
}) {
  const cls = "w-full text-xs bg-surface-sunken border border-rmpg-700 rounded-sm text-white px-2 py-1.5 focus:border-brand-500 focus:outline-none placeholder-rmpg-600";
  return (
    <div>
      <label className="block text-[10px] text-rmpg-500 mb-0.5 uppercase">{label}</label>
      {multiline ? (
        <textarea value={value} onChange={e => onChange(e.target.value)} rows={2}
          className={cls} placeholder={placeholder} />
      ) : (
        <input type={type} value={value} onChange={e => onChange(e.target.value)}
          className={cls} placeholder={placeholder} />
      )}
    </div>
  );
}

// ============================================================
// IMPORT MODAL
// ============================================================

function ImportModal({
  onImport,
  onClose,
}: {
  onImport: (records: any[]) => void;
  onClose: () => void;
}) {
  const [jsonText, setJsonText] = useState('');
  const [parsed, setParsed] = useState<any[] | null>(null);
  const [error, setError] = useState('');

  const handleParse = () => {
    try {
      const data = JSON.parse(jsonText);
      const arr = Array.isArray(data) ? data : data.records || data.data || [];
      if (!Array.isArray(arr) || arr.length === 0) {
        setError('No records found in JSON');
        return;
      }
      setParsed(arr);
      setError('');
    } catch {
      setError('Invalid JSON format');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div
        className="w-full max-w-xl max-h-[70vh] overflow-y-auto rounded-sm shadow-2xl bg-surface-base border border-rmpg-600"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-3" style={{ background: 'var(--surface-raised)', borderBottom: '1px solid var(--border-strong)' }}>
          <h2 className="text-sm font-bold text-white flex items-center gap-2">
            <Upload size={14} /> Import Records
          </h2>
          <button onClick={onClose} className="toolbar-btn p-1"><X size={14} /></button>
        </div>
        <div className="p-4 space-y-3">
          <p className="text-[11px] text-rmpg-400">
            Paste a JSON array of records. Each record must have at least <code className="text-brand-400">first_name</code> and <code className="text-brand-400">last_name</code> fields.
          </p>
          <textarea
            value={jsonText}
            onChange={e => { setJsonText(e.target.value); setParsed(null); }}
            rows={8}
            className="w-full text-xs bg-surface-sunken border border-rmpg-700 rounded-sm text-white px-3 py-2 font-mono focus:border-brand-500 focus:outline-none placeholder-rmpg-600"
            placeholder='[{"first_name": "John", "last_name": "Doe", "tier": 2, ...}]'
          />
          {error && <div className="text-red-400 text-[11px]">{error}</div>}
          {parsed && (
            <div className="text-green-400 text-[11px]">
              ✓ {parsed.length} records parsed successfully
            </div>
          )}
          <div className="flex justify-end gap-2">
            <button onClick={handleParse} className="toolbar-btn px-3 py-1.5 text-[11px]">
              Parse JSON
            </button>
            <button
              onClick={() => parsed && onImport(parsed)}
              disabled={!parsed}
              className="px-3 py-1.5 text-[11px] font-bold rounded-sm disabled:opacity-40"
              style={{ background: 'var(--brand-blue)', color: '#fff', border: '1px solid #2a7acf' }}
            >
              Import {parsed ? parsed.length : 0} Records
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
