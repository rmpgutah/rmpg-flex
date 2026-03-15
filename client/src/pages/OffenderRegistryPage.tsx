// ============================================================
// RMPG Flex — Known Offender Registry Page
// ============================================================
// Flagged person alert management with severity-based ordering,
// ban zones, watch lists, and alert trigger workflows.
// ============================================================

import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  UserX, Search, Plus, AlertTriangle, Shield, MapPin, Clock, User,
  X, Save, Loader2, Eye, Ban, ShieldAlert, ShieldCheck,
} from 'lucide-react';
import type { OffenderAlert, OffenderAlertType, AlertSeverity } from '../types';
import PanelTitleBar from '../components/PanelTitleBar';
// ExportButton omitted — no dedicated export endpoint
import { apiFetch } from '../hooks/useApi';
import { useLiveSync } from '../hooks/useLiveSync';
import { useIsMobile } from '../hooks/useIsMobile';
import { useToast } from '../components/ToastProvider';
import { useFormValidation } from '../hooks/useFormValidation';

const ALERT_TYPES: { value: OffenderAlertType; label: string }[] = [
  { value: 'ban_zone', label: 'Ban Zone' }, { value: 'watch_list', label: 'Watch List' },
  { value: 'sex_offender', label: 'Sex Offender' }, { value: 'gang_member', label: 'Gang Member' },
  { value: 'probation', label: 'Probation' }, { value: 'parole', label: 'Parole' },
  { value: 'mental_health', label: 'Mental Health' }, { value: 'violent_history', label: 'Violent History' },
  { value: 'warrant_flag', label: 'Warrant Flag' },
];

const SEVERITY_COLORS: Record<string, string> = {
  danger: 'bg-red-900/60 text-red-300 border-red-600/50',
  warning: 'bg-amber-900/50 text-amber-400 border-amber-700/50',
  caution: 'bg-yellow-900/50 text-yellow-400 border-yellow-700/50',
  info: 'bg-blue-900/50 text-blue-400 border-blue-700/50',
};

const TYPE_COLORS: Record<string, string> = {
  ban_zone: 'bg-red-900/50 text-red-400 border-red-700/50',
  watch_list: 'bg-amber-900/50 text-amber-400 border-amber-700/50',
  sex_offender: 'bg-purple-900/60 text-purple-300 border-purple-600/50',
  gang_member: 'bg-orange-900/50 text-orange-400 border-orange-700/50',
  probation: 'bg-blue-900/50 text-blue-400 border-blue-700/50',
  parole: 'bg-cyan-900/50 text-cyan-400 border-cyan-700/50',
  mental_health: 'bg-teal-900/50 text-teal-400 border-teal-700/50',
  violent_history: 'bg-red-900/70 text-red-300 border-red-600/50',
  warrant_flag: 'bg-rose-900/50 text-rose-400 border-rose-700/50',
};

const EMPTY_FORM = {
  person_id: '', alert_type: 'watch_list' as OffenderAlertType, description: '',
  severity: 'caution' as AlertSeverity, expiration_date: '', notes: '',
};

// ─── Colorado DOC Search Panel ─────────────────────────────
interface CdocResult {
  doc_number: string;
  first_name: string;
  last_name: string;
  dob: string | null;
  facility: string | null;
  status: string | null;
  photo_url: string | null;
  offenses: string | null;
  person_id: number | null;
}

function CdocSearchPanel() {
  const [lastName, setLastName] = useState('');
  const [firstName, setFirstName] = useState('');
  const [results, setResults] = useState<CdocResult[]>([]);
  const [selectedOffender, setSelectedOffender] = useState<CdocResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);

  const searchCdoc = async () => {
    if (!lastName.trim()) return;
    setLoading(true);
    setSearched(true);
    try {
      const params = new URLSearchParams({ lastName: lastName.trim() });
      if (firstName.trim()) params.set('firstName', firstName.trim());
      const res = await apiFetch<{ data: CdocResult[] }>(`/colorado-doc/search?${params}`);
      setResults(res.data || []);
    } catch { setResults([]); }
    finally { setLoading(false); }
  };

  return (
    <>
      <div className="px-3 py-2 border-b border-rmpg-700 bg-surface-sunken">
        <div className="text-[9px] font-mono text-rmpg-500 uppercase tracking-wider mb-2">Colorado DOC Offender Search</div>
        <div className="flex gap-1">
          <input
            value={lastName}
            onChange={e => setLastName(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && searchCdoc()}
            placeholder="Last name *"
            className="flex-1 px-2 py-1 text-xs bg-surface-sunken border border-rmpg-700 text-white placeholder-rmpg-500 outline-none focus:border-brand-600"
          />
          <input
            value={firstName}
            onChange={e => setFirstName(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && searchCdoc()}
            placeholder="First name"
            className="flex-1 px-2 py-1 text-xs bg-surface-sunken border border-rmpg-700 text-white placeholder-rmpg-500 outline-none focus:border-brand-600"
          />
          <button onClick={searchCdoc} disabled={loading || !lastName.trim()} className="toolbar-btn toolbar-btn-primary px-2">
            {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Search style={{ width: 11, height: 11 }} />}
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {selectedOffender ? (
          <div className="p-3 space-y-3">
            <button onClick={() => setSelectedOffender(null)} className="text-[10px] text-brand-400 hover:text-brand-300 flex items-center gap-1">
              <X style={{ width: 10, height: 10 }} /> Back to results
            </button>
            <div className="flex gap-3 items-start">
              {selectedOffender.photo_url && (
                <img src={selectedOffender.photo_url} alt="Mugshot" className="w-20 h-24 object-cover border border-rmpg-600" />
              )}
              <div className="flex-1">
                <div className="text-sm font-bold text-white">{selectedOffender.last_name}, {selectedOffender.first_name}</div>
                <div className="text-[10px] text-rmpg-400 font-mono">DOC# {selectedOffender.doc_number}</div>
                {selectedOffender.dob && <div className="text-[10px] text-rmpg-400">DOB: {new Date(selectedOffender.dob).toLocaleDateString()}</div>}
                {selectedOffender.status && (
                  <span className={`inline-block mt-1 text-[9px] px-1.5 py-0.5 font-bold border ${
                    selectedOffender.status.toLowerCase().includes('incarcerat') ? 'bg-red-900/50 text-red-300 border-red-700/50' :
                    selectedOffender.status.toLowerCase().includes('parol') ? 'bg-amber-900/50 text-amber-400 border-amber-700/50' :
                    'bg-blue-900/40 text-blue-400 border-blue-700/40'
                  }`}>
                    {selectedOffender.status.toUpperCase()}
                  </span>
                )}
              </div>
            </div>
            {selectedOffender.facility && (
              <div className="panel-beveled p-2">
                <div className="text-[9px] font-mono text-rmpg-500 uppercase mb-1">Facility</div>
                <div className="text-xs text-white">{selectedOffender.facility}</div>
              </div>
            )}
            {selectedOffender.offenses && (
              <div className="panel-beveled p-2">
                <div className="text-[9px] font-mono text-rmpg-500 uppercase mb-1">Offenses</div>
                <div className="text-xs text-rmpg-300 whitespace-pre-wrap">{selectedOffender.offenses}</div>
              </div>
            )}
            {selectedOffender.person_id && (
              <div className="text-[9px] text-green-400 border border-green-700/40 bg-green-900/20 px-2 py-1">
                Linked to local person record #{selectedOffender.person_id}
              </div>
            )}
          </div>
        ) : results.length > 0 ? (
          results.map(r => (
            <button
              key={r.doc_number}
              onClick={() => setSelectedOffender(r)}
              className="w-full text-left px-3 py-2 border-b border-rmpg-700/50 hover:bg-rmpg-700/30 transition-colors"
            >
              <div className="flex items-center gap-2">
                {r.photo_url && <img src={r.photo_url} alt="" className="w-8 h-10 object-cover border border-rmpg-600 flex-shrink-0" />}
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-bold text-white truncate">{r.last_name}, {r.first_name}</div>
                  <div className="text-[10px] text-rmpg-400 font-mono">DOC# {r.doc_number}</div>
                </div>
                {r.status && (
                  <span className={`text-[8px] px-1 py-0 font-bold border flex-shrink-0 ${
                    r.status.toLowerCase().includes('incarcerat') ? 'bg-red-900/50 text-red-300 border-red-700/50' :
                    r.status.toLowerCase().includes('parol') ? 'bg-amber-900/50 text-amber-400 border-amber-700/50' :
                    'bg-rmpg-700 text-rmpg-300 border-rmpg-600'
                  }`}>
                    {r.status.toUpperCase()}
                  </span>
                )}
              </div>
            </button>
          ))
        ) : searched && !loading ? (
          <div className="flex-1 flex items-center justify-center p-8">
            <div className="text-center">
              <Shield className="w-8 h-8 text-rmpg-600 mx-auto mb-2" />
              <div className="text-xs text-rmpg-500">No CDOC records found</div>
            </div>
          </div>
        ) : (
          <div className="flex-1 flex items-center justify-center p-8">
            <div className="text-center">
              <UserX className="w-10 h-10 text-rmpg-600 mx-auto mb-2" />
              <div className="text-xs text-rmpg-500 mb-1">Select an alert or search Colorado DOC</div>
              <div className="text-[10px] text-rmpg-600">Enter a last name above to search the Colorado Department of Corrections offender database</div>
            </div>
          </div>
        )}
      </div>
    </>
  );
}

export default function OffenderRegistryPage() {
  const isMobile = useIsMobile();
  const { addToast } = useToast();
  const { errors: formErrors, validate: validateForm, clearAllErrors } = useFormValidation();

  const [alerts, setAlerts] = useState<OffenderAlert[]>([]);
  const [selected, setSelected] = useState<OffenderAlert | null>(null);
  const [stats, setStats] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  // Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [filterType, setFilterType] = useState('');
  const [filterSeverity, setFilterSeverity] = useState('');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalCount, setTotalCount] = useState(0);

  // Form
  const [formOpen, setFormOpen] = useState(false);
  const [formData, setFormData] = useState({ ...EMPTY_FORM });
  const [submitting, setSubmitting] = useState(false);

  // Person search
  const [personSearch, setPersonSearch] = useState('');
  const [personResults, setPersonResults] = useState<any[]>([]);
  const [selectedPerson, setSelectedPerson] = useState<any>(null);
  const personSearchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchAlerts = useCallback(async (opts?: { silent?: boolean }) => {
    if (!opts?.silent) setLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(page), limit: '50',
        ...(searchQuery ? { search: searchQuery } : {}),
        ...(filterType ? { alert_type: filterType } : {}),
        ...(filterSeverity ? { severity: filterSeverity } : {}),
      });
      const res = await apiFetch<{ data: OffenderAlert[]; pagination: any }>(`/offender-registry?${params}`);
      setAlerts(res.data || []);
      setTotalPages(res.pagination?.totalPages || 1);
      setTotalCount(res.pagination?.total || 0);
    } catch { /* silent */ } finally { setLoading(false); }
  }, [page, searchQuery, filterType, filterSeverity]);

  const fetchStats = useCallback(async () => {
    try { const res = await apiFetch<{ data: any }>('/offender-registry/stats'); setStats(res.data); } catch {}
  }, []);

  useEffect(() => { fetchAlerts(); }, [fetchAlerts]);
  useEffect(() => { fetchStats(); }, [fetchStats]);
  useLiveSync('records', () => { fetchAlerts({ silent: true }); fetchStats(); });

  // Person search debounce
  useEffect(() => {
    if (personSearch.length < 2) { setPersonResults([]); return; }
    if (personSearchTimer.current) clearTimeout(personSearchTimer.current);
    personSearchTimer.current = setTimeout(async () => {
      try {
        const res = await apiFetch<{ data: any[] }>(`/records/persons?search=${encodeURIComponent(personSearch)}&per_page=8`);
        setPersonResults(res.data || []);
      } catch { setPersonResults([]); }
    }, 300);
    return () => { if (personSearchTimer.current) clearTimeout(personSearchTimer.current); };
  }, [personSearch]);

  const handleCreate = async () => {
    const isValid = validateForm(formData, {
      person_id: { required: true },
      description: { required: true, minLength: 3 },
    });
    if (!isValid) return;
    setSubmitting(true);
    try {
      await apiFetch('/offender-registry', { method: 'POST', body: JSON.stringify(formData) });
      addToast('Offender alert created', 'success');
      setFormOpen(false);
      setFormData({ ...EMPTY_FORM });
      setSelectedPerson(null);
      setPersonSearch('');
      fetchAlerts({ silent: true }); fetchStats();
    } catch (err: any) { addToast(err.message, 'error'); }
    finally { setSubmitting(false); }
  };

  const handleClear = async (id: number) => {
    try {
      await apiFetch(`/offender-registry/${id}/clear`, { method: 'PUT' });
      addToast('Alert cleared', 'success');
      fetchAlerts({ silent: true }); fetchStats();
      if (selected?.id === id) setSelected(null);
    } catch (err: any) { addToast(err.message, 'error'); }
  };

  const severityIcon = (severity: string) => {
    switch (severity) {
      case 'danger': return <ShieldAlert style={{ width: 14, height: 14 }} className="text-red-400" />;
      case 'warning': return <AlertTriangle style={{ width: 14, height: 14 }} className="text-amber-400" />;
      default: return <Shield style={{ width: 14, height: 14 }} className="text-blue-400" />;
    }
  };

  return (
    <div className={`h-full flex ${isMobile ? 'flex-col' : ''}`}>
      {/* ── Left Panel ── */}
      <div className={`flex flex-col ${isMobile ? 'h-1/2' : 'w-[400px]'} border-r border-rmpg-700`}>
        <PanelTitleBar title="Known Offender Registry" icon={UserX}>
          <button onClick={() => { clearAllErrors(); setFormOpen(true); setFormData({ ...EMPTY_FORM }); setSelectedPerson(null); setPersonSearch(''); }} className="toolbar-btn toolbar-btn-primary">
            <Plus style={{ width: 11, height: 11 }} /> New Alert
          </button>
        </PanelTitleBar>

        {/* Stats */}
        {stats && (
          <div className="flex gap-2 px-2 py-1.5 border-b border-rmpg-700 bg-surface-sunken overflow-x-auto">
            <div className="text-center px-2">
              <div className="text-[10px] font-mono text-rmpg-500">ALERTS</div>
              <div className="text-sm font-bold text-white">{stats.total_alerts || 0}</div>
            </div>
            <div className="text-center px-2">
              <div className="text-[10px] font-mono text-rmpg-500">PERSONS</div>
              <div className="text-sm font-bold text-blue-400">{stats.total_persons || 0}</div>
            </div>
            <div className="text-center px-2">
              <div className="text-[10px] font-mono text-rmpg-500">DANGER</div>
              <div className="text-sm font-bold text-red-400">{stats.by_severity?.danger || 0}</div>
            </div>
            <div className="text-center px-2">
              <div className="text-[10px] font-mono text-rmpg-500">EXPIRING</div>
              <div className="text-sm font-bold text-amber-400">{stats.expiring_soon || 0}</div>
            </div>
          </div>
        )}

        {/* Filters */}
        <div className="flex gap-1 p-1.5 border-b border-rmpg-700 bg-surface-base">
          <div className="flex-1 relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 text-rmpg-500" style={{ width: 12, height: 12 }} />
            <input value={searchQuery} onChange={e => { setSearchQuery(e.target.value); setPage(1); }} placeholder="Search alerts..." className="w-full pl-7 pr-2 py-1 text-xs bg-surface-sunken border border-rmpg-700 text-white placeholder-rmpg-500 focus:border-brand-600 outline-none" />
          </div>
          <select value={filterType} onChange={e => { setFilterType(e.target.value); setPage(1); }} className="text-[10px] bg-surface-sunken border border-rmpg-700 text-rmpg-300 px-1 outline-none">
            <option value="">All Types</option>
            {ALERT_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
          <select value={filterSeverity} onChange={e => { setFilterSeverity(e.target.value); setPage(1); }} className="text-[10px] bg-surface-sunken border border-rmpg-700 text-rmpg-300 px-1 outline-none">
            <option value="">All Severity</option>
            <option value="danger">Danger</option>
            <option value="warning">Warning</option>
            <option value="caution">Caution</option>
            <option value="info">Info</option>
          </select>
        </div>

        {/* Alert List */}
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center h-32"><Loader2 className="w-5 h-5 animate-spin text-rmpg-500" /></div>
          ) : alerts.length === 0 ? (
            <div className="text-center py-8 text-rmpg-500 text-xs">No active alerts found</div>
          ) : (
            alerts.map(alert => (
              <button
                key={alert.id}
                onClick={() => setSelected(alert)}
                className={`w-full text-left px-3 py-2 border-b border-rmpg-800 transition-colors ${
                  selected?.id === alert.id ? 'bg-brand-900/20 border-l-2 border-l-brand-500' : 'hover:bg-rmpg-800/40 border-l-2 border-l-transparent'
                } ${alert.severity === 'danger' ? 'border-l-red-600' : ''}`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    {severityIcon(alert.severity)}
                    <span className="text-[11px] font-bold text-white">
                      {alert.person_name || `Person #${alert.person_id}`}
                    </span>
                  </div>
                  <span className={`text-[9px] px-1.5 py-0.5 border ${SEVERITY_COLORS[alert.severity] || ''}`}>
                    {alert.severity.toUpperCase()}
                  </span>
                </div>
                <div className="flex items-center gap-2 mt-1 text-[9px] text-rmpg-500">
                  <span className={`px-1 border ${TYPE_COLORS[alert.alert_type] || ''}`}>
                    {alert.alert_type.replace(/_/g, ' ')}
                  </span>
                  <span className="truncate">{alert.description}</span>
                </div>
              </button>
            ))
          )}
        </div>

        {totalPages > 1 && (
          <div className="flex items-center justify-between px-3 py-1.5 border-t border-rmpg-700 bg-surface-base">
            <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1} className="text-[10px] text-rmpg-400 disabled:opacity-30">← Prev</button>
            <span className="text-[9px] font-mono text-rmpg-500">Page {page}/{totalPages}</span>
            <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages} className="text-[10px] text-rmpg-400 disabled:opacity-30">Next →</button>
          </div>
        )}
      </div>

      {/* ── Right Panel ── */}
      <div className="flex-1 flex flex-col bg-surface-base">
        {selected ? (
          <>
            <PanelTitleBar title={`Alert — ${selected.person_name || `Person #${selected.person_id}`}`} icon={ShieldAlert}>
              <button onClick={() => handleClear(selected.id)} className="toolbar-btn" style={{ color: '#22c55e' }}>
                <ShieldCheck style={{ width: 11, height: 11 }} /> Clear Alert
              </button>
            </PanelTitleBar>

            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {/* Badges */}
              <div className="flex items-center gap-2 flex-wrap">
                <span className={`text-[10px] px-2 py-1 border font-bold ${SEVERITY_COLORS[selected.severity] || ''}`}>
                  {selected.severity.toUpperCase()}
                </span>
                <span className={`text-[10px] px-2 py-1 border font-bold ${TYPE_COLORS[selected.alert_type] || ''}`}>
                  {selected.alert_type.replace(/_/g, ' ').toUpperCase()}
                </span>
              </div>

              {/* Person card */}
              <div className="panel-beveled p-3">
                <div className="text-[9px] font-mono text-rmpg-500 uppercase mb-2">Person Information</div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div><span className="text-[9px] text-rmpg-500">Name:</span> <span className="text-xs text-white font-bold">{selected.person_name || '—'}</span></div>
                  <div><span className="text-[9px] text-rmpg-500">DOB:</span> <span className="text-xs text-white">{selected.dob ? new Date(selected.dob).toLocaleDateString() : '—'}</span></div>
                  {selected.is_sex_offender && (
                    <span className="text-[9px] px-1.5 py-0.5 bg-purple-900/50 text-purple-300 border border-purple-600/50 col-span-2 w-fit">SEX OFFENDER</span>
                  )}
                  {selected.gang_affiliation && (
                    <span className="text-[9px] px-1.5 py-0.5 bg-orange-900/50 text-orange-300 border border-orange-600/50 col-span-2 w-fit">GANG: {selected.gang_affiliation}</span>
                  )}
                </div>
              </div>

              {/* Alert details */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {[
                  ['Description', selected.description],
                  ['Effective Date', selected.effective_date ? new Date(selected.effective_date).toLocaleDateString() : '—'],
                  ['Expiration Date', selected.expiration_date ? new Date(selected.expiration_date).toLocaleDateString() : 'No expiration'],
                  ['Restriction Radius', selected.restriction_radius_ft ? `${selected.restriction_radius_ft} ft` : '—'],
                  ['Created', selected.created_at ? new Date(selected.created_at).toLocaleString() : '—'],
                ].map(([label, value]) => (
                  <div key={label as string}>
                    <div className="text-[9px] font-mono text-rmpg-500 uppercase">{label}</div>
                    <div className="text-xs text-white mt-0.5">{value || '—'}</div>
                  </div>
                ))}
              </div>

              {selected.notes && (
                <div className="panel-beveled p-3">
                  <div className="text-[9px] font-mono text-rmpg-500 uppercase mb-1">Notes</div>
                  <div className="text-xs text-rmpg-300 whitespace-pre-wrap">{selected.notes}</div>
                </div>
              )}
            </div>
          </>
        ) : (
          <div className="flex-1 flex flex-col">
            {/* CDOC Search */}
            <CdocSearchPanel />
          </div>
        )}
      </div>

      {/* ── New Alert Modal ── */}
      {formOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="panel-surface w-full max-w-lg mx-4">
            <PanelTitleBar title="New Offender Alert" icon={Plus}>
              <button onClick={() => setFormOpen(false)} className="toolbar-btn"><X style={{ width: 12, height: 12 }} /></button>
            </PanelTitleBar>
            <div className="p-4 space-y-3">
              {/* Person search */}
              <div>
                <label className="field-label">Person *</label>
                {selectedPerson ? (
                  <div className="mt-1 flex items-center gap-2 px-2 py-1.5 bg-surface-sunken border border-rmpg-700">
                    <User style={{ width: 12, height: 12 }} className="text-rmpg-500" />
                    <span className="text-xs text-white">{selectedPerson.first_name} {selectedPerson.last_name}</span>
                    <button onClick={() => { setSelectedPerson(null); setFormData(p => ({ ...p, person_id: '' })); setPersonSearch(''); }} className="ml-auto text-rmpg-500 hover:text-white">
                      <X style={{ width: 10, height: 10 }} />
                    </button>
                  </div>
                ) : (
                  <div className="relative">
                    <input value={personSearch} onChange={e => setPersonSearch(e.target.value)} placeholder="Search by name..." className={`w-full mt-1 px-2 py-1.5 text-xs bg-surface-sunken border text-white placeholder-rmpg-500 outline-none ${formErrors.person_id ? 'border-red-500' : 'border-rmpg-700'}`} />
                    {formErrors.person_id && <p className="text-red-400 text-[10px] mt-0.5">{formErrors.person_id}</p>}
                    {personResults.length > 0 && (
                      <div className="absolute z-10 top-full left-0 right-0 bg-surface-base border border-rmpg-700 max-h-40 overflow-y-auto">
                        {personResults.map(p => (
                          <button
                            key={p.id}
                            onClick={() => { setSelectedPerson(p); setFormData(prev => ({ ...prev, person_id: String(p.id) })); setPersonResults([]); }}
                            className="w-full text-left px-3 py-1.5 text-xs text-rmpg-300 hover:bg-rmpg-700/40 hover:text-white border-b border-rmpg-800"
                          >
                            {p.first_name} {p.last_name} {p.dob ? `(${new Date(p.dob).toLocaleDateString()})` : ''}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="field-label">Alert Type</label>
                  <select value={formData.alert_type} onChange={e => setFormData(p => ({ ...p, alert_type: e.target.value as OffenderAlertType }))} className="w-full mt-1 px-2 py-1.5 text-xs bg-surface-sunken border border-rmpg-700 text-white outline-none">
                    {ALERT_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="field-label">Severity</label>
                  <select value={formData.severity} onChange={e => setFormData(p => ({ ...p, severity: e.target.value as AlertSeverity }))} className="w-full mt-1 px-2 py-1.5 text-xs bg-surface-sunken border border-rmpg-700 text-white outline-none">
                    <option value="info">Info</option><option value="caution">Caution</option><option value="warning">Warning</option><option value="danger">Danger</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="field-label">Description *</label>
                <textarea value={formData.description} onChange={e => setFormData(p => ({ ...p, description: e.target.value }))} rows={3} className={`w-full mt-1 px-2 py-1.5 text-xs bg-surface-sunken border text-white outline-none resize-none ${formErrors.description ? 'border-red-500' : 'border-rmpg-700'}`} />
                {formErrors.description && <p className="text-red-400 text-[10px] mt-0.5">{formErrors.description}</p>}
              </div>

              <div>
                <label className="field-label">Expiration Date</label>
                <input type="date" value={formData.expiration_date} onChange={e => setFormData(p => ({ ...p, expiration_date: e.target.value }))} className="w-full mt-1 px-2 py-1.5 text-xs bg-surface-sunken border border-rmpg-700 text-white outline-none" />
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-rmpg-700">
                <button onClick={() => setFormOpen(false)} className="toolbar-btn">Cancel</button>
                <button onClick={handleCreate} disabled={submitting} className="toolbar-btn toolbar-btn-primary">
                  {submitting ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save style={{ width: 11, height: 11 }} />}
                  Create Alert
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
