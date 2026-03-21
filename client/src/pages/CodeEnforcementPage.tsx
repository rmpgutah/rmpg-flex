// ============================================================
// RMPG Flex — Code Enforcement Page
// ============================================================
// Municipal code violations and vehicle tow management with
// tabbed interface, status workflows, and fine tracking.
// ============================================================

import React, { useState, useEffect, useCallback } from 'react';
import {
  Construction, Search, Plus, Truck, MapPin, Clock, User,
  X, Save, Loader2, AlertTriangle, DollarSign, FileText,
  ChevronDown, Eye, Hash, CheckCircle,
} from 'lucide-react';
import type { CodeViolation, VehicleTow, ViolationType, ViolationStatus, TowStatus, TowReason } from '../types';
import PanelTitleBar from '../components/PanelTitleBar';
// ExportButton omitted — no dedicated export endpoint
import { apiFetch } from '../hooks/useApi';
import { useDistrictOptions } from '../hooks/useDistrictLookup';
import { useLiveSync } from '../hooks/useLiveSync';
import { useIsMobile } from '../hooks/useIsMobile';
import { useToast } from '../components/ToastProvider';
import { useFormValidation } from '../hooks/useFormValidation';
import { isValidVIN, isValidPlate } from '../utils/validate';

const VIOLATION_TYPES: { value: ViolationType; label: string }[] = [
  { value: 'noise', label: 'Noise' }, { value: 'property_maintenance', label: 'Property Maintenance' },
  { value: 'zoning', label: 'Zoning' }, { value: 'signage', label: 'Signage' },
  { value: 'health', label: 'Health' }, { value: 'fire', label: 'Fire' },
  { value: 'nuisance', label: 'Nuisance' }, { value: 'other', label: 'Other' },
];

const VIOLATION_STATUS_COLORS: Record<string, string> = {
  open: 'bg-red-900/50 text-red-400 border-red-700/50',
  notice_sent: 'bg-amber-900/50 text-amber-400 border-amber-700/50',
  reinspection: 'bg-blue-900/50 text-blue-400 border-blue-700/50',
  resolved: 'bg-green-900/50 text-green-400 border-green-700/50',
  referred: 'bg-purple-900/50 text-purple-400 border-purple-700/50',
  voided: 'bg-rmpg-700/50 text-rmpg-400 border-rmpg-600/50',
};

const TOW_STATUS_COLORS: Record<string, string> = {
  ordered: 'bg-blue-900/50 text-blue-400 border-blue-700/50',
  dispatched: 'bg-cyan-900/50 text-cyan-400 border-cyan-700/50',
  in_progress: 'bg-amber-900/50 text-amber-400 border-amber-700/50',
  completed: 'bg-green-900/50 text-green-400 border-green-700/50',
  released: 'bg-teal-900/50 text-teal-400 border-teal-700/50',
  cancelled: 'bg-rmpg-700/50 text-rmpg-400 border-rmpg-600/50',
};

const TOW_REASONS: { value: TowReason; label: string }[] = [
  { value: 'parking_violation', label: 'Parking Violation' }, { value: 'abandoned', label: 'Abandoned' },
  { value: 'evidence', label: 'Evidence' }, { value: 'accident', label: 'Accident' },
  { value: 'stolen_recovery', label: 'Stolen Recovery' }, { value: 'private_property', label: 'Private Property' },
  { value: 'other', label: 'Other' },
];

const EMPTY_VIOLATION = {
  violation_type: 'other' as ViolationType, location: '', description: '',
  code_section: '', severity: 'low', fine_amount: '', compliance_deadline: '', notes: '',
  section_id: '', zone_id: '', beat_id: '',
};

const EMPTY_TOW = {
  vehicle_year: '', vehicle_make: '', vehicle_model: '', vehicle_color: '',
  vehicle_plate: '', vehicle_vin: '', tow_from: '', tow_to: '',
  tow_reason: 'parking_violation' as TowReason, tow_company: '', tow_fee: '', storage_fee: '', notes: '',
};

export default function CodeEnforcementPage() {
  const isMobile = useIsMobile();
  const { addToast } = useToast();
  const { sections: sectionOptions, sectionLabels, zoneLabels, zonesForSection, beatsForZone, getBeatLabel } = useDistrictOptions();
  const { errors: vFormErrors, validate: validateVForm, clearAllErrors: clearVErrors } = useFormValidation();
  const { errors: tFormErrors, validate: validateTForm, clearAllErrors: clearTErrors } = useFormValidation();

  const [activeTab, setActiveTab] = useState<'violations' | 'tows'>('violations');

  // Violations state
  const [violations, setViolations] = useState<CodeViolation[]>([]);
  const [selectedViolation, setSelectedViolation] = useState<CodeViolation | null>(null);
  const [vLoading, setVLoading] = useState(true);
  const [vSearch, setVSearch] = useState('');
  const [vFilterStatus, setVFilterStatus] = useState('');
  const [vPage, setVPage] = useState(1);
  const [vTotalPages, setVTotalPages] = useState(1);
  const [vTotalCount, setVTotalCount] = useState(0);

  // Tows state
  const [tows, setTows] = useState<VehicleTow[]>([]);
  const [selectedTow, setSelectedTow] = useState<VehicleTow | null>(null);
  const [tLoading, setTLoading] = useState(true);
  const [tSearch, setTSearch] = useState('');
  const [tFilterStatus, setTFilterStatus] = useState('');
  const [tPage, setTPage] = useState(1);
  const [tTotalPages, setTTotalPages] = useState(1);
  const [tTotalCount, setTTotalCount] = useState(0);

  // Stats
  const [stats, setStats] = useState<any>(null);

  // Forms
  const [vFormOpen, setVFormOpen] = useState(false);
  const [vFormData, setVFormData] = useState({ ...EMPTY_VIOLATION });
  const [tFormOpen, setTFormOpen] = useState(false);
  const [tFormData, setTFormData] = useState({ ...EMPTY_TOW });
  const [submitting, setSubmitting] = useState(false);

  // Fetch violations
  const fetchViolations = useCallback(async (opts?: { silent?: boolean }) => {
    if (!opts?.silent) setVLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(vPage), limit: '50',
        ...(vSearch ? { search: vSearch } : {}),
        ...(vFilterStatus ? { status: vFilterStatus } : {}),
      });
      const res = await apiFetch<{ data: CodeViolation[]; pagination: any }>(`/code-enforcement/violations?${params}`);
      setViolations(res.data || []);
      setVTotalPages(res.pagination?.totalPages || 1);
      setVTotalCount(res.pagination?.total || 0);
    } catch { addToast('Failed to load violations', 'error'); } finally { setVLoading(false); }
  }, [vPage, vSearch, vFilterStatus]);

  // Fetch tows
  const fetchTows = useCallback(async (opts?: { silent?: boolean }) => {
    if (!opts?.silent) setTLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(tPage), limit: '50',
        ...(tSearch ? { search: tSearch } : {}),
        ...(tFilterStatus ? { status: tFilterStatus } : {}),
      });
      const res = await apiFetch<{ data: VehicleTow[]; pagination: any }>(`/code-enforcement/tows?${params}`);
      setTows(res.data || []);
      setTTotalPages(res.pagination?.totalPages || 1);
      setTTotalCount(res.pagination?.total || 0);
    } catch { addToast('Failed to load tow records', 'error'); } finally { setTLoading(false); }
  }, [tPage, tSearch, tFilterStatus]);

  const fetchStats = useCallback(async () => {
    try { const res = await apiFetch<{ data: any }>('/code-enforcement/stats'); setStats(res.data); } catch (e) { console.warn('[CodeEnforcement] fetch stats failed:', e); }
  }, []);

  useEffect(() => { fetchViolations(); }, [fetchViolations]);
  useEffect(() => { fetchTows(); }, [fetchTows]);
  useEffect(() => { fetchStats(); }, [fetchStats]);
  useLiveSync('records', () => { fetchViolations({ silent: true }); fetchTows({ silent: true }); fetchStats(); });

  const handleCreateViolation = async () => {
    const isValid = validateVForm(vFormData, {
      location: { required: true },
      description: { required: true, minLength: 3 },
    });
    if (!isValid) return;
    setSubmitting(true);
    try {
      const zoneBeat = [vFormData.zone_id, vFormData.beat_id].filter(Boolean).join('/') || undefined;
      await apiFetch('/code-enforcement/violations', { method: 'POST', body: JSON.stringify({ ...vFormData, zone_beat: zoneBeat }) });
      addToast('Violation created', 'success');
      setVFormOpen(false);
      setVFormData({ ...EMPTY_VIOLATION });
      fetchViolations({ silent: true }); fetchStats();
    } catch (err: any) { addToast(err?.message || 'Operation failed', 'error'); }
    finally { setSubmitting(false); }
  };

  const handleCreateTow = async () => {
    const isValid = validateTForm(tFormData, {
      vehicle_make: { required: true },
      tow_from: { required: true },
      vehicle_vin: { custom: (v) => !v || isValidVIN(v), customMessage: 'VIN must be 17 alphanumeric characters' },
      vehicle_plate: { custom: (v) => !v || isValidPlate(v), customMessage: 'Invalid license plate format' },
    });
    if (!isValid) return;
    setSubmitting(true);
    try {
      await apiFetch('/code-enforcement/tows', { method: 'POST', body: JSON.stringify(tFormData) });
      addToast('Tow order created', 'success');
      setTFormOpen(false);
      setTFormData({ ...EMPTY_TOW });
      fetchTows({ silent: true }); fetchStats();
    } catch (err: any) { addToast(err?.message || 'Operation failed', 'error'); }
    finally { setSubmitting(false); }
  };

  const handleViolationStatus = async (id: number, status: string) => {
    try {
      await apiFetch(`/code-enforcement/violations/${id}/status`, { method: 'PUT', body: JSON.stringify({ status }) });
      addToast(`Violation → ${status.replace(/_/g, ' ')}`, 'success');
      fetchViolations({ silent: true }); fetchStats();
      if (selectedViolation?.id === id) {
        const updated = await apiFetch<{ data: CodeViolation }>(`/code-enforcement/violations/${id}`);
        setSelectedViolation(updated.data);
      }
    } catch (err: any) { addToast(err?.message || 'Operation failed', 'error'); }
  };

  const handleTowStatus = async (id: number, status: string) => {
    try {
      await apiFetch(`/code-enforcement/tows/${id}/status`, { method: 'PUT', body: JSON.stringify({ status }) });
      addToast(`Tow → ${status.replace(/_/g, ' ')}`, 'success');
      fetchTows({ silent: true }); fetchStats();
      if (selectedTow?.id === id) {
        const updated = await apiFetch<{ data: VehicleTow }>(`/code-enforcement/tows/${id}`);
        setSelectedTow(updated.data);
      }
    } catch (err: any) { addToast(err?.message || 'Operation failed', 'error'); }
  };

  return (
    <div className={`h-full flex ${isMobile ? 'flex-col' : ''}`}>
      {/* ── Left Panel ── */}
      <div className={`flex flex-col ${isMobile ? 'h-1/2' : 'w-[400px]'} border-r border-rmpg-700`}>
        <PanelTitleBar title="Code Enforcement" icon={Construction}>
          <button
            onClick={() => activeTab === 'violations' ? (clearVErrors(), setVFormOpen(true), setVFormData({ ...EMPTY_VIOLATION })) : (clearTErrors(), setTFormOpen(true), setTFormData({ ...EMPTY_TOW }))}
            className="toolbar-btn toolbar-btn-primary"
          >
            <Plus style={{ width: 11, height: 11 }} />
            New
          </button>
        </PanelTitleBar>

        {/* Stats */}
        {stats && (
          <div className="flex gap-2 px-2 py-1.5 border-b border-rmpg-700 bg-surface-sunken overflow-x-auto">
            <div className="text-center px-2">
              <div className="text-[10px] font-mono text-rmpg-500">VIOLATIONS</div>
              <div className="text-sm font-bold text-red-400">{stats.violations?.open || 0}</div>
            </div>
            <div className="text-center px-2">
              <div className="text-[10px] font-mono text-rmpg-500">TOWS</div>
              <div className="text-sm font-bold text-amber-400">{stats.tows?.active || 0}</div>
            </div>
            <div className="text-center px-2">
              <div className="text-[10px] font-mono text-rmpg-500">PKG TODAY</div>
              <div className="text-sm font-bold text-blue-400">{stats.parking_citations_today || 0}</div>
            </div>
          </div>
        )}

        {/* Tab toggle */}
        <div className="flex border-b border-rmpg-700">
          <button
            onClick={() => setActiveTab('violations')}
            className={`flex-1 ${isMobile ? 'py-3 text-xs' : 'py-1.5 text-[10px]'} font-bold uppercase tracking-wider ${activeTab === 'violations' ? 'text-white border-b-2 border-brand-500 bg-brand-900/10' : 'text-rmpg-500'}`}
            style={isMobile ? { minHeight: 48 } : undefined}
          >
            Violations ({vTotalCount})
          </button>
          <button
            onClick={() => setActiveTab('tows')}
            className={`flex-1 ${isMobile ? 'py-3 text-xs' : 'py-1.5 text-[10px]'} font-bold uppercase tracking-wider ${activeTab === 'tows' ? 'text-white border-b-2 border-brand-500 bg-brand-900/10' : 'text-rmpg-500'}`}
            style={isMobile ? { minHeight: 48 } : undefined}
          >
            Tows ({tTotalCount})
          </button>
        </div>

        {/* Filters */}
        <div className={`flex ${isMobile ? 'flex-col' : ''} gap-1 p-1.5 border-b border-rmpg-700 bg-surface-base`}>
          {activeTab === 'violations' ? (
            <>
              <div className="flex-1 relative">
                <Search className="absolute left-2 top-1/2 -translate-y-1/2 text-rmpg-500" style={{ width: 12, height: 12 }} />
                <input value={vSearch} onChange={e => { setVSearch(e.target.value); setVPage(1); }} placeholder="Search violations..." className={`w-full pl-7 pr-2 ${isMobile ? 'py-2.5 text-sm' : 'py-1 text-xs'} bg-surface-sunken border border-rmpg-700 text-white placeholder-rmpg-500 focus:border-brand-600 outline-none`} style={isMobile ? { minHeight: 44 } : undefined} />
              </div>
              <select value={vFilterStatus} onChange={e => { setVFilterStatus(e.target.value); setVPage(1); }} className={`${isMobile ? 'text-sm py-2' : 'text-[10px]'} bg-surface-sunken border border-rmpg-700 text-rmpg-300 px-1 outline-none`} style={isMobile ? { minHeight: 44 } : undefined}>
                <option value="">All</option>
                {Object.keys(VIOLATION_STATUS_COLORS).map(s => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
              </select>
            </>
          ) : (
            <>
              <div className="flex-1 relative">
                <Search className="absolute left-2 top-1/2 -translate-y-1/2 text-rmpg-500" style={{ width: 12, height: 12 }} />
                <input value={tSearch} onChange={e => { setTSearch(e.target.value); setTPage(1); }} placeholder="Search tows..." className={`w-full pl-7 pr-2 ${isMobile ? 'py-2.5 text-sm' : 'py-1 text-xs'} bg-surface-sunken border border-rmpg-700 text-white placeholder-rmpg-500 focus:border-brand-600 outline-none`} style={isMobile ? { minHeight: 44 } : undefined} />
              </div>
              <select value={tFilterStatus} onChange={e => { setTFilterStatus(e.target.value); setTPage(1); }} className={`${isMobile ? 'text-sm py-2' : 'text-[10px]'} bg-surface-sunken border border-rmpg-700 text-rmpg-300 px-1 outline-none`} style={isMobile ? { minHeight: 44 } : undefined}>
                <option value="">All</option>
                {Object.keys(TOW_STATUS_COLORS).map(s => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
              </select>
            </>
          )}
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto">
          {activeTab === 'violations' ? (
            vLoading ? <div className="flex items-center justify-center h-32"><Loader2 className="w-5 h-5 animate-spin text-rmpg-500" /></div> :
            violations.length === 0 ? <div className="text-center py-8 text-rmpg-500 text-xs">No violations found</div> :
            violations.map(v => (
              <button
                key={v.id}
                onClick={() => setSelectedViolation(v)}
                className={`w-full text-left px-3 ${isMobile ? 'py-3' : 'py-2'} border-b border-rmpg-800 transition-colors ${
                  selectedViolation?.id === v.id ? 'bg-brand-900/20 border-l-2 border-l-brand-500' : 'hover:bg-rmpg-800/40 border-l-2 border-l-transparent'
                }`}
                style={isMobile ? { minHeight: 56 } : undefined}
              >
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-mono font-bold text-white">{v.violation_number}</span>
                  <span className={`text-[9px] px-1.5 py-0.5 border ${VIOLATION_STATUS_COLORS[v.status] || ''}`}>
                    {v.status.replace(/_/g, ' ').toUpperCase()}
                  </span>
                </div>
                <div className="text-[10px] text-rmpg-300 truncate mt-0.5">{v.description}</div>
                <div className="flex items-center gap-2 mt-1 text-[9px] text-rmpg-500">
                  <MapPin style={{ width: 9, height: 9 }} />
                  <span className="truncate">{v.location}</span>
                  {v.fine_amount && !isNaN(Number(v.fine_amount)) && <span className="text-amber-400">${Number(v.fine_amount).toFixed(0)}</span>}
                  {((v as any).section_id || (v as any).zone_id || (v as any).beat_id) && (
                    <span className="font-mono text-rmpg-400">{[(v as any).section_id, (v as any).zone_id, (v as any).beat_id].filter(Boolean).join('/')}</span>
                  )}
                </div>
              </button>
            ))
          ) : (
            tLoading ? <div className="flex items-center justify-center h-32"><Loader2 className="w-5 h-5 animate-spin text-rmpg-500" /></div> :
            tows.length === 0 ? <div className="text-center py-8 text-rmpg-500 text-xs">No tows found</div> :
            tows.map(t => (
              <button
                key={t.id}
                onClick={() => setSelectedTow(t)}
                className={`w-full text-left px-3 ${isMobile ? 'py-3' : 'py-2'} border-b border-rmpg-800 transition-colors ${
                  selectedTow?.id === t.id ? 'bg-brand-900/20 border-l-2 border-l-brand-500' : 'hover:bg-rmpg-800/40 border-l-2 border-l-transparent'
                }`}
                style={isMobile ? { minHeight: 56 } : undefined}
              >
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-mono font-bold text-white">{t.tow_number}</span>
                  <span className={`text-[9px] px-1.5 py-0.5 border ${TOW_STATUS_COLORS[t.status] || ''}`}>
                    {t.status.replace(/_/g, ' ').toUpperCase()}
                  </span>
                </div>
                <div className="text-[10px] text-rmpg-300 truncate mt-0.5">
                  {[t.vehicle_year, t.vehicle_color, t.vehicle_make, t.vehicle_model].filter(Boolean).join(' ')}
                </div>
                <div className="flex items-center gap-2 mt-1 text-[9px] text-rmpg-500">
                  {t.vehicle_plate && <span className="font-mono">{t.vehicle_plate}</span>}
                  <span className="truncate">{t.tow_from}</span>
                </div>
              </button>
            ))
          )}
        </div>
      </div>

      {/* ── Right Panel ── */}
      <div className="flex-1 flex flex-col bg-surface-base">
        {activeTab === 'violations' && selectedViolation ? (
          <>
            <PanelTitleBar title={selectedViolation.violation_number} icon={Construction}>
            </PanelTitleBar>
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              <div className="flex items-center gap-2 flex-wrap">
                <span className={`text-[10px] px-2 py-1 border font-bold ${VIOLATION_STATUS_COLORS[selectedViolation.status] || ''}`}>
                  {selectedViolation.status.replace(/_/g, ' ').toUpperCase()}
                </span>
                <span className="text-[10px] px-2 py-1 border bg-rmpg-700/30 text-rmpg-300 border-rmpg-600/50">
                  {VIOLATION_TYPES.find(v => v.value === selectedViolation.violation_type)?.label || selectedViolation.violation_type}
                </span>
              </div>
              {/* Status actions */}
              <div className="panel-beveled p-3">
                <div className="text-[9px] font-mono text-rmpg-500 uppercase mb-2">Actions</div>
                <div className={`flex flex-wrap ${isMobile ? 'gap-2' : 'gap-1'}`}>
                  {['notice_sent', 'reinspection', 'resolved', 'referred', 'voided'].filter(s => s !== selectedViolation.status).map(s => (
                    <button key={s} onClick={() => handleViolationStatus(selectedViolation.id, s)} className={`${isMobile ? 'text-xs px-3 py-2' : 'text-[10px] px-2 py-1'} border border-rmpg-600 text-rmpg-300 hover:bg-rmpg-700/40 transition-colors`} style={isMobile ? { minHeight: 48 } : undefined}>
                      {s.replace(/_/g, ' ')}
                    </button>
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {[
                  ['Location', selectedViolation.location],
                  ['Description', selectedViolation.description],
                  ['Code Section', selectedViolation.code_section || '—'],
                  ['Severity', selectedViolation.severity],
                  ['Fine Amount', selectedViolation.fine_amount && !isNaN(Number(selectedViolation.fine_amount)) ? `$${Number(selectedViolation.fine_amount).toFixed(2)}` : '—'],
                  ['Compliance Deadline', selectedViolation.compliance_deadline ? new Date(selectedViolation.compliance_deadline).toLocaleDateString() : '—'],
                  ['S/Z/B', [(selectedViolation as any).section_id, (selectedViolation as any).zone_id, (selectedViolation as any).beat_id].filter(Boolean).join('/') || '—'],
                  ['Created', selectedViolation.created_at ? new Date(selectedViolation.created_at).toLocaleString() : '—'],
                ].map(([label, value]) => (
                  <div key={label as string}>
                    <div className="text-[9px] font-mono text-rmpg-500 uppercase">{label}</div>
                    <div className="text-xs text-white mt-0.5">{value || '—'}</div>
                  </div>
                ))}
              </div>
            </div>
          </>
        ) : activeTab === 'tows' && selectedTow ? (
          <>
            <PanelTitleBar title={selectedTow.tow_number} icon={Truck}>
            </PanelTitleBar>
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              <div className="flex items-center gap-2 flex-wrap">
                <span className={`text-[10px] px-2 py-1 border font-bold ${TOW_STATUS_COLORS[selectedTow.status] || ''}`}>
                  {selectedTow.status.replace(/_/g, ' ').toUpperCase()}
                </span>
                <span className="text-[10px] px-2 py-1 border bg-rmpg-700/30 text-rmpg-300 border-rmpg-600/50">
                  {TOW_REASONS.find(r => r.value === selectedTow.tow_reason)?.label || selectedTow.tow_reason}
                </span>
              </div>
              <div className="panel-beveled p-3">
                <div className="text-[9px] font-mono text-rmpg-500 uppercase mb-2">Actions</div>
                <div className={`flex flex-wrap ${isMobile ? 'gap-2' : 'gap-1'}`}>
                  {['dispatched', 'in_progress', 'completed', 'released', 'cancelled'].filter(s => s !== selectedTow.status).map(s => (
                    <button key={s} onClick={() => handleTowStatus(selectedTow.id, s)} className={`${isMobile ? 'text-xs px-3 py-2' : 'text-[10px] px-2 py-1'} border border-rmpg-600 text-rmpg-300 hover:bg-rmpg-700/40 transition-colors`} style={isMobile ? { minHeight: 48 } : undefined}>
                      {s.replace(/_/g, ' ')}
                    </button>
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {[
                  ['Vehicle', [selectedTow.vehicle_year, selectedTow.vehicle_color, selectedTow.vehicle_make, selectedTow.vehicle_model].filter(Boolean).join(' ')],
                  ['Plate', selectedTow.vehicle_plate || '—'],
                  ['VIN', selectedTow.vehicle_vin || '—'],
                  ['Tow From', selectedTow.tow_from],
                  ['Tow To', selectedTow.tow_to || '—'],
                  ['Tow Company', selectedTow.tow_company || '—'],
                  ['Tow Fee', selectedTow.tow_fee && !isNaN(Number(selectedTow.tow_fee)) ? `$${Number(selectedTow.tow_fee).toFixed(2)}` : '—'],
                  ['Storage Fee', selectedTow.storage_fee_daily && !isNaN(Number(selectedTow.storage_fee_daily)) ? `$${Number(selectedTow.storage_fee_daily).toFixed(2)}` : '—'],
                ].map(([label, value]) => (
                  <div key={label as string}>
                    <div className="text-[9px] font-mono text-rmpg-500 uppercase">{label}</div>
                    <div className="text-xs text-white mt-0.5">{value || '—'}</div>
                  </div>
                ))}
              </div>
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center">
              <Construction className="w-10 h-10 text-rmpg-600 mx-auto mb-2" />
              <div className="text-xs text-rmpg-500">Select an item to view details</div>
            </div>
          </div>
        )}
      </div>

      {/* ── New Violation Modal ── */}
      {vFormOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="panel-surface w-full max-w-lg mx-4">
            <PanelTitleBar title="New Code Violation" icon={Plus}>
              <button onClick={() => setVFormOpen(false)} className="toolbar-btn"><X style={{ width: 12, height: 12 }} /></button>
            </PanelTitleBar>
            <div className="p-4 space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="field-label">Type</label>
                  <select value={vFormData.violation_type} onChange={e => setVFormData(p => ({ ...p, violation_type: e.target.value as ViolationType }))} className="w-full mt-1 px-2 py-1.5 text-xs bg-surface-sunken border border-rmpg-700 text-white outline-none">
                    {VIOLATION_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="field-label">Severity</label>
                  <select value={vFormData.severity} onChange={e => setVFormData(p => ({ ...p, severity: e.target.value }))} className="w-full mt-1 px-2 py-1.5 text-xs bg-surface-sunken border border-rmpg-700 text-white outline-none">
                    <option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option><option value="critical">Critical</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="field-label">Location *</label>
                <input value={vFormData.location} onChange={e => setVFormData(p => ({ ...p, location: e.target.value }))} className={`w-full mt-1 px-2 py-1.5 text-xs bg-surface-sunken border text-white outline-none ${vFormErrors.location ? 'border-red-500' : 'border-rmpg-700'}`} />
                {vFormErrors.location && <p className="text-red-400 text-[10px] mt-0.5">{vFormErrors.location}</p>}
              </div>
              <div>
                <label className="field-label">Description *</label>
                <textarea value={vFormData.description} onChange={e => setVFormData(p => ({ ...p, description: e.target.value }))} rows={3} className={`w-full mt-1 px-2 py-1.5 text-xs bg-surface-sunken border text-white outline-none resize-none ${vFormErrors.description ? 'border-red-500' : 'border-rmpg-700'}`} />
                {vFormErrors.description && <p className="text-red-400 text-[10px] mt-0.5">{vFormErrors.description}</p>}
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="field-label">Code Section</label>
                  <input value={vFormData.code_section} onChange={e => setVFormData(p => ({ ...p, code_section: e.target.value }))} className="w-full mt-1 px-2 py-1.5 text-xs bg-surface-sunken border border-rmpg-700 text-white outline-none" />
                </div>
                <div>
                  <label className="field-label">Fine Amount</label>
                  <input value={vFormData.fine_amount} onChange={e => setVFormData(p => ({ ...p, fine_amount: e.target.value }))} type="number" className="w-full mt-1 px-2 py-1.5 text-xs bg-surface-sunken border border-rmpg-700 text-white outline-none" />
                </div>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="field-label">Section</label>
                  <select className="w-full mt-1 px-2 py-1.5 text-xs bg-surface-sunken border border-rmpg-700 text-white outline-none"
                    value={vFormData.section_id || ''} onChange={e => setVFormData(p => ({...p, section_id: e.target.value, zone_id: '', beat_id: ''}))}>
                    <option value="">—</option>
                    {sectionOptions.map(s => <option key={s} value={s}>{sectionLabels.get(s) || s}</option>)}
                  </select>
                </div>
                <div>
                  <label className="field-label">Zone</label>
                  <select className="w-full mt-1 px-2 py-1.5 text-xs bg-surface-sunken border border-rmpg-700 text-white outline-none"
                    value={vFormData.zone_id || ''} onChange={e => setVFormData(p => ({...p, zone_id: e.target.value, beat_id: ''}))}>
                    <option value="">—</option>
                    {zonesForSection(vFormData.section_id).map(z => <option key={z} value={z}>{zoneLabels.get(z) || z}</option>)}
                  </select>
                </div>
                <div>
                  <label className="field-label">Beat</label>
                  <select className="w-full mt-1 px-2 py-1.5 text-xs bg-surface-sunken border border-rmpg-700 text-white outline-none"
                    value={vFormData.beat_id || ''} onChange={e => setVFormData(p => ({...p, beat_id: e.target.value}))}>
                    <option value="">—</option>
                    {beatsForZone(vFormData.zone_id).map(b => <option key={b} value={b}>{getBeatLabel(vFormData.zone_id, b)}</option>)}
                  </select>
                </div>
              </div>
              <div className={`flex ${isMobile ? 'flex-col gap-2' : 'justify-end gap-2'} pt-2 border-t border-rmpg-700`}>
                <button onClick={handleCreateViolation} disabled={submitting} className={`toolbar-btn toolbar-btn-primary ${isMobile ? 'w-full justify-center' : ''}`} style={isMobile ? { minHeight: 48, fontSize: 14 } : undefined}>
                  {submitting ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save style={{ width: 11, height: 11 }} />}
                  Create
                </button>
                <button onClick={() => setVFormOpen(false)} className={`toolbar-btn ${isMobile ? 'w-full justify-center' : ''}`} style={isMobile ? { minHeight: 48, fontSize: 14 } : undefined}>Cancel</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── New Tow Modal ── */}
      {tFormOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="panel-surface w-full max-w-lg mx-4">
            <PanelTitleBar title="New Tow Order" icon={Truck}>
              <button onClick={() => setTFormOpen(false)} className="toolbar-btn"><X style={{ width: 12, height: 12 }} /></button>
            </PanelTitleBar>
            <div className="p-4 space-y-3">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                <div><label className="field-label">Year</label><input value={tFormData.vehicle_year} onChange={e => setTFormData(p => ({ ...p, vehicle_year: e.target.value }))} className="w-full mt-1 px-2 py-1.5 text-xs bg-surface-sunken border border-rmpg-700 text-white outline-none" /></div>
                <div><label className="field-label">Make *</label><input value={tFormData.vehicle_make} onChange={e => setTFormData(p => ({ ...p, vehicle_make: e.target.value }))} className={`w-full mt-1 px-2 py-1.5 text-xs bg-surface-sunken border text-white outline-none ${tFormErrors.vehicle_make ? 'border-red-500' : 'border-rmpg-700'}`} />{tFormErrors.vehicle_make && <p className="text-red-400 text-[10px] mt-0.5">{tFormErrors.vehicle_make}</p>}</div>
                <div><label className="field-label">Model</label><input value={tFormData.vehicle_model} onChange={e => setTFormData(p => ({ ...p, vehicle_model: e.target.value }))} className="w-full mt-1 px-2 py-1.5 text-xs bg-surface-sunken border border-rmpg-700 text-white outline-none" /></div>
                <div><label className="field-label">Color</label><input value={tFormData.vehicle_color} onChange={e => setTFormData(p => ({ ...p, vehicle_color: e.target.value }))} className="w-full mt-1 px-2 py-1.5 text-xs bg-surface-sunken border border-rmpg-700 text-white outline-none" /></div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div><label className="field-label">Plate</label><input value={tFormData.vehicle_plate} onChange={e => setTFormData(p => ({ ...p, vehicle_plate: e.target.value }))} className={`w-full mt-1 px-2 py-1.5 text-xs bg-surface-sunken border text-white outline-none ${tFormErrors.vehicle_plate ? 'border-red-500' : 'border-rmpg-700'}`} />{tFormErrors.vehicle_plate && <p className="text-red-400 text-[10px] mt-0.5">{tFormErrors.vehicle_plate}</p>}</div>
                <div><label className="field-label">Reason</label><select value={tFormData.tow_reason} onChange={e => setTFormData(p => ({ ...p, tow_reason: e.target.value as TowReason }))} className="w-full mt-1 px-2 py-1.5 text-xs bg-surface-sunken border border-rmpg-700 text-white outline-none">{TOW_REASONS.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}</select></div>
              </div>
              <div><label className="field-label">Tow From *</label><input value={tFormData.tow_from} onChange={e => setTFormData(p => ({ ...p, tow_from: e.target.value }))} className={`w-full mt-1 px-2 py-1.5 text-xs bg-surface-sunken border text-white outline-none ${tFormErrors.tow_from ? 'border-red-500' : 'border-rmpg-700'}`} />{tFormErrors.tow_from && <p className="text-red-400 text-[10px] mt-0.5">{tFormErrors.tow_from}</p>}</div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div><label className="field-label">Tow Company</label><input value={tFormData.tow_company} onChange={e => setTFormData(p => ({ ...p, tow_company: e.target.value }))} className="w-full mt-1 px-2 py-1.5 text-xs bg-surface-sunken border border-rmpg-700 text-white outline-none" /></div>
                <div><label className="field-label">Tow Fee ($)</label><input value={tFormData.tow_fee} onChange={e => setTFormData(p => ({ ...p, tow_fee: e.target.value }))} type="number" className="w-full mt-1 px-2 py-1.5 text-xs bg-surface-sunken border border-rmpg-700 text-white outline-none" /></div>
              </div>
              <div className={`flex ${isMobile ? 'flex-col gap-2' : 'justify-end gap-2'} pt-2 border-t border-rmpg-700`}>
                <button onClick={handleCreateTow} disabled={submitting} className={`toolbar-btn toolbar-btn-primary ${isMobile ? 'w-full justify-center' : ''}`} style={isMobile ? { minHeight: 48, fontSize: 14 } : undefined}>
                  {submitting ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save style={{ width: 11, height: 11 }} />}
                  Create Tow
                </button>
                <button onClick={() => setTFormOpen(false)} className={`toolbar-btn ${isMobile ? 'w-full justify-center' : ''}`} style={isMobile ? { minHeight: 48, fontSize: 14 } : undefined}>Cancel</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
