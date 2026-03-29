// ============================================================
// RMPG Flex — Driver's License Search Page
// Standalone DL search against structured local records +
// live MicroBilt API. Split-panel layout with search form,
// results list, and detailed DL record view.
// ============================================================

import React, {useState, useCallback, useEffect, useRef} from 'react';
import { Search, CreditCard, User, MapPin, ChevronRight, Shield, ShieldCheck, Calendar, Database, Wifi, Plus, AlertTriangle, Camera, Loader2, X } from 'lucide-react';
import { apiFetch } from '../hooks/useApi';
import PanelTitleBar from '../components/PanelTitleBar';
import { useIsMobile } from '../hooks/useIsMobile';
import ManualDlEntryModal, { type ManualDlFormData } from '../components/ManualDlEntryModal';
import { useToast } from '../components/ToastProvider';

const US_STATES = [
  'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA','KS','KY',
  'LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND',
  'OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY','DC',
];

interface DlSubject {
  id?: number;
  first_name: string;
  middle_name?: string;
  last_name: string;
  full_name?: string;
  suffix?: string;
  date_of_birth?: string;
  gender?: string;
  height?: string;
  weight?: string;
  eye_color?: string;
  hair_color?: string;
  race?: string;
  dl_number: string;
  dl_state: string;
  dl_class?: string;
  dl_status?: string;
  dl_expiration?: string;
  dl_issue_date?: string;
  dl_restrictions?: string;
  dl_endorsements?: string;
  addresses?: { address?: string; address2?: string; city?: string; state?: string; postal_code?: string; country?: string }[];
  source?: string;
  match_source?: string;
  match_score?: number;
  fetched_at?: string;
}

interface DlSearchResponse {
  hit: boolean;
  source: string;
  subjects: DlSubject[];
  searchId: number;
  resultCount: number;
}

const timeAgo = (date: string): string => {
  if (!date) return '—';
  const parsed = new Date(date).getTime();
  if (Number.isNaN(parsed)) return '—';
  const ms = Date.now() - parsed;
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
};

export default function DlSearchPage() {
  const isMobile = useIsMobile();
  const { addToast } = useToast();
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [dlNumber, setDlNumber] = useState('');
  const [state, setState] = useState('');
  const [dob, setDob] = useState('');
  const [results, setResults] = useState<DlSubject[]>([]);
  const [selected, setSelected] = useState<DlSubject | null>(null);
  const [source, setSource] = useState('');
  const [loading, setLoading] = useState(false);
  const [fetchError, setFetchError] = useState('');
  const [showManualEntry, setShowManualEntry] = useState(false);
  const [isManualSubmitting, setIsManualSubmitting] = useState(false);

  // ── DL OCR Scanner ──
  const [ocrLoading, setOcrLoading] = useState(false);
  const [ocrResult, setOcrResult] = useState<any>(null);
  const [showOcrPreview, setShowOcrPreview] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── DL Verification via RapidAPI ──
  const [verifying, setVerifying] = useState(false);
  const [verifyResult, setVerifyResult] = useState<any>(null);

  const handleVerifyDl = useCallback(async () => {
    if (!dlNumber.trim()) { addToast('Enter a DL number to verify', 'warning'); return; }
    setVerifying(true);
    setVerifyResult(null);
    try {
      const data = await apiFetch<any>('/dl-records/verify', {
        method: 'POST',
        body: JSON.stringify({ dl_number: dlNumber.trim(), date_of_birth: dob || undefined, dl_state: state || undefined }),
      });
      setVerifyResult(data.parsed);
      if (data.parsed?.verified) {
        addToast('DL Verified', 'success');
      } else {
        addToast('DL could not be verified', 'warning');
      }
    } catch (err: any) {
      addToast(err.message || 'Verification failed', 'error');
    } finally {
      setVerifying(false);
    }
  }, [dlNumber, dob, state, addToast]);

  const handleCreatePersonFromVerify = useCallback(async () => {
    if (!verifyResult) return;
    try {
      const nameParts = (verifyResult.name || '').split(' ');
      const resp = await apiFetch<any>('/records/persons', {
        method: 'POST',
        body: JSON.stringify({
          first_name: verifyResult.first_name || nameParts[0] || '',
          last_name: verifyResult.last_name || nameParts.slice(-1)[0] || '',
          dob: verifyResult.date_of_birth || '',
          address: verifyResult.address || '',
          dl_number: verifyResult.dl_number || '',
          dl_state: verifyResult.dl_state || '',
          dl_class: verifyResult.dl_class || '',
          dl_expiry: verifyResult.dl_expiry || '',
          notes: `Created from DL verification on ${new Date().toLocaleDateString()}`,
          flags: ['dl_verify_imported'],
        }),
      });
      if (resp?.id) {
        addToast(`Person record #${resp.id} created from verification`, 'success');
      }
    } catch (err: any) {
      addToast(err.message || 'Failed to create person record', 'error');
    }
  }, [verifyResult, addToast]);

  // ── Feature 42: Registration Alerts ──
  const [regAlerts, setRegAlerts] = useState<any>(null);
  const handleCheckRegistration = async () => {
    try {
      const data = await apiFetch<any>('/records/vehicles/alerts/expired-registration');
      setRegAlerts(data?.data || data);
    } catch { addToast('Failed to check registration alerts', 'error'); }
  };

  // ── Feature 44: Stolen Vehicle Check ──
  const [stolenResult, setStolenResult] = useState<any>(null);
  const [stolenPlate, setStolenPlate] = useState('');
  const handleStolenCheck = async () => {
    if (!stolenPlate.trim()) return;
    try {
      const data = await apiFetch<any>('/records/vehicles/stolen-check', {
        method: 'POST', body: JSON.stringify({ plate_number: stolenPlate.trim() }),
      });
      setStolenResult(data?.data || data);
    } catch (err: any) { addToast(err?.message || 'Stolen check failed', 'error'); }
  };

  const handleSearch = useCallback(async () => {
    if (!lastName.trim() && !dlNumber.trim()) return;
    setLoading(true);
    setSelected(null);
    setFetchError('');
    try {
      const body: any = {};
      if (firstName.trim()) body.firstName = firstName.trim();
      if (lastName.trim()) body.lastName = lastName.trim();
      if (dlNumber.trim()) body.dlNumber = dlNumber.trim();
      if (state) body.state = state;
      if (dob) body.dob = dob;

      const data = await apiFetch<DlSearchResponse>('/microbilt/dl/search', {
        method: 'POST',
        body: JSON.stringify(body),
      });
      setResults(data.subjects || []);
      setSource(data.source || 'NONE');
    } catch (err: any) {
      console.error('DL search error:', err);
      setFetchError(err?.message || 'Failed to load data');
      addToast('Failed to search driver\'s license records', 'error');
      setResults([]);
      setSource('ERROR');
    }
    setLoading(false);
  }, [firstName, lastName, dlNumber, state, dob]);

  const handleManualSubmit = useCallback(async (data: ManualDlFormData) => {
    setIsManualSubmitting(true);
    try {
      await apiFetch('/dl-records', { method: 'POST', body: JSON.stringify(data) });
      addToast('DL record saved successfully', 'success');
      setShowManualEntry(false);
      // Re-trigger search to show the new record
      if (lastName.trim() || dlNumber.trim()) handleSearch();
    } catch (err) {
      console.error('Manual DL save error:', err);
      addToast('Failed to save DL record', 'error');
    }
    setIsManualSubmitting(false);
  }, [lastName, dlNumber, handleSearch]);

  const handleOcrUpload = useCallback(async (file: File) => {
    setOcrLoading(true);
    setOcrResult(null);
    try {
      const formData = new FormData();
      formData.append('image', file);

      const token = localStorage.getItem('rmpg_token');
      const resp = await fetch('/api/dl-records/ocr-scan', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` },
        body: formData,
      });

      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ error: 'Upload failed' }));
        throw new Error(err.error || `Upload failed (${resp.status})`);
      }

      const data = await resp.json();
      if (data.parsed) {
        setOcrResult(data.parsed);
        setShowOcrPreview(true);
        addToast('DL scanned successfully — review extracted data', 'success');
      } else {
        addToast('OCR returned no data', 'warning');
      }
    } catch (err: any) {
      addToast(err.message || 'DL scan failed', 'error');
    } finally {
      setOcrLoading(false);
    }
  }, [addToast]);

  const handleCreatePersonFromOcr = useCallback(async () => {
    if (!ocrResult) return;
    try {
      const resp = await apiFetch<any>('/records/persons', {
        method: 'POST',
        body: JSON.stringify({
          first_name: ocrResult.first_name,
          last_name: ocrResult.last_name,
          middle_name: ocrResult.middle_name,
          dob: ocrResult.date_of_birth,
          gender: ocrResult.gender?.charAt(0)?.toUpperCase() || '',
          height: ocrResult.height,
          weight: ocrResult.weight,
          eye_color: ocrResult.eye_color,
          hair_color: ocrResult.hair_color,
          address: ocrResult.address,
          city: ocrResult.city,
          state: ocrResult.state,
          zip: ocrResult.zip,
          dl_number: ocrResult.dl_number,
          dl_state: ocrResult.dl_state,
          dl_class: ocrResult.dl_class,
          dl_expiry: ocrResult.dl_expiry,
          notes: `Created from DL OCR scan on ${new Date().toLocaleDateString()}`,
          flags: ['dl_ocr_imported'],
        }),
      });

      if (resp?.id) {
        addToast(`Person record #${resp.id} created for ${ocrResult.first_name} ${ocrResult.last_name}`, 'success');
        setShowOcrPreview(false);
        setOcrResult(null);
        // Also save as DL record
        try {
          await apiFetch('/dl-records', {
            method: 'POST',
            body: JSON.stringify({
              ...ocrResult,
              source: 'DL_OCR_SCAN',
            }),
          });
        } catch { /* secondary — person record is primary */ }
      }
    } catch (err: any) {
      addToast(err.message || 'Failed to create person record', 'error');
    }
  }, [ocrResult, addToast]);

  const sourceBadge = (src: string) => {
    if (src === 'MICROBILT_API' || src === 'MICROBILT_DL') {
      return <span className="text-[8px] font-bold uppercase px-1 py-0.5 bg-green-900/50 text-green-400 border border-green-700/50 inline-flex items-center gap-0.5"><Wifi className="w-2.5 h-2.5" />API</span>;
    }
    return <span className="text-[8px] font-bold uppercase px-1 py-0.5 bg-blue-900/50 text-blue-400 border border-blue-700/50 inline-flex items-center gap-0.5"><Database className="w-2.5 h-2.5" />LOCAL</span>;
  };

  const statusBadge = (status: string) => {
    if (!status) return null;
    const s = status.toUpperCase();
    const isValid = s === 'VALID' || s === 'ACTIVE';
    return (
      <span className={`text-[8px] font-bold uppercase px-1 py-0.5 border ${
        isValid ? 'bg-green-900/50 text-green-400 border-green-700/50' : 'bg-red-900/50 text-red-400 border-red-700/50'
      }`}>{s}</span>
    );
  };

  const formatDate = (d: string | undefined) => {
    if (!d) return '—';
    try {
      const dt = new Date(d);
      return isNaN(dt.getTime()) ? d : dt.toLocaleDateString();
    } catch { return d; }
  };

  // Desktop search bar
  const searchControls = (
    <div className="flex items-center gap-1.5 flex-wrap">
      <input className="input-dark text-[10px] w-28 min-h-[36px]" placeholder="Last Name" value={lastName}
        onChange={(e) => setLastName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleSearch()} />
      <input className="input-dark text-[10px] w-28 min-h-[36px]" placeholder="First Name" value={firstName}
        onChange={(e) => setFirstName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleSearch()} />
      <input className="input-dark text-[10px] w-28 min-h-[36px]" placeholder="DL Number" value={dlNumber}
        onChange={(e) => setDlNumber(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleSearch()} />
      <select className="select-dark text-[10px] w-16 min-h-[36px]" value={state} onChange={(e) => setState(e.target.value)}>
        <option value="">State</option>
        {US_STATES.map(s => <option key={s} value={s}>{s}</option>)}
      </select>
      <input className="input-dark text-[10px] w-28 min-h-[36px]" type="date" placeholder="DOB" value={dob}
        onChange={(e) => setDob(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleSearch()} />
      <button type="button" onClick={handleSearch} disabled={loading} className="toolbar-btn toolbar-btn-primary text-[10px]">
        {loading ? 'Searching...' : 'Search'}
      </button>
      <button type="button" onClick={() => setShowManualEntry(true)} className="toolbar-btn text-[10px]">
        <Plus className="w-3 h-3" /> Manual Entry
      </button>
      <button type="button" onClick={() => fileInputRef.current?.click()} disabled={ocrLoading} className="toolbar-btn text-[10px]">
        {ocrLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Camera className="w-3 h-3" />}
        {ocrLoading ? 'Scanning...' : 'Scan DL'}
      </button>
      <button
        type="button"
        onClick={handleVerifyDl}
        disabled={verifying || !dlNumber.trim()}
        className="flex items-center gap-1.5 px-3 py-2 bg-green-600 hover:bg-green-500 disabled:opacity-40 rounded-sm text-[11px] font-bold text-white transition-colors"
        title="Verify DL via RapidAPI"
      >
        {verifying ? <Loader2 size={14} className="animate-spin" /> : <ShieldCheck size={14} />}
        Verify
      </button>
    </div>
  );

  // Set document title
  useEffect(() => { document.title = 'DL Search \u2014 RMPG Flex'; }, []);

  return (
    <div className="h-full flex flex-col bg-surface-base text-white overflow-hidden">
      {/* Hidden file input for DL OCR — always in DOM so toolbar button works */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={e => {
          const file = e.target.files?.[0];
          if (file) handleOcrUpload(file);
          e.target.value = '';
        }}
      />
      {fetchError && (
        <div className="mx-4 mt-2 p-2 bg-red-900/30 border border-red-700/50 text-red-400 text-xs flex items-center gap-2" role="alert">
          <AlertTriangle className="w-3 h-3 text-red-400 flex-shrink-0" />
          <span className="flex-1">{fetchError}</span>
          <button type="button" onClick={() => setFetchError('')} className="ml-auto text-red-500 hover:text-red-300 text-[10px]" aria-label="Dismiss error">dismiss</button>
        </div>
      )}
      {!isMobile && <PanelTitleBar title="DL Search" icon={CreditCard}>{searchControls}</PanelTitleBar>}

      {/* Mobile search bar */}
      {isMobile && (
        <div className="flex flex-col gap-1.5 px-3 py-2 flex-shrink-0" style={{ background: '#0d1520', borderBottom: '1px solid #1e3048' }}>
          <div className="flex items-center gap-1.5">
            <input className="input-dark text-[10px] flex-1 min-h-[36px]" placeholder="Last Name" value={lastName}
              onChange={(e) => setLastName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleSearch()} />
            <input className="input-dark text-[10px] flex-1 min-h-[36px]" placeholder="First Name" value={firstName}
              onChange={(e) => setFirstName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleSearch()} />
          </div>
          <div className="flex items-center gap-1.5">
            <input className="input-dark text-[10px] flex-1 min-h-[36px]" placeholder="DL Number" value={dlNumber}
              onChange={(e) => setDlNumber(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleSearch()} />
            <select className="select-dark text-[10px] w-16 min-h-[36px]" value={state} onChange={(e) => setState(e.target.value)}>
              <option value="">State</option>
              {US_STATES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
            <button type="button" onClick={handleSearch} disabled={loading} className="toolbar-btn toolbar-btn-primary text-[9px] px-2">
              {loading ? '...' : 'Go'}
            </button>
          </div>
        </div>
      )}

      <div className="flex-1 flex overflow-hidden">
        {/* Results List */}
        <div className={`${isMobile ? (selected ? 'hidden' : 'w-full') : 'w-1/3'} border-r border-rmpg-700/50 overflow-auto`}>
          {results.length === 0 && !loading && (
            <div className="flex flex-col items-center justify-center h-full text-rmpg-500 text-[10px] p-4 gap-4">
              <div className="text-center">
                <CreditCard className="w-8 h-8 mx-auto mb-2 text-rmpg-600" />
                <p>Search by name, DL number, or state</p>
                <p className="text-[9px] text-rmpg-600 mt-1">Searches local records + MicroBilt API</p>
              </div>
              {/* DL OCR Scanner */}
              <div className="border border-[#1e2d40] rounded-sm p-3 bg-[#0d1520] space-y-2 w-full max-w-xs">
                <div className="flex items-center gap-2">
                  <CreditCard size={14} className="text-[#d4a017]" />
                  <span className="text-[10px] font-bold text-[#c0ccdd] uppercase tracking-wider">Scan Driver's License</span>
                </div>
                <p className="text-[10px] text-[#556677]">Upload a photo of a driver's license to auto-extract all fields and create a person record.</p>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={ocrLoading}
                    className="flex items-center gap-2 px-3 py-2 bg-[#1a5a9e] hover:bg-[#1e6ab8] disabled:opacity-40 rounded-sm text-[11px] font-bold text-white transition-colors"
                  >
                    {ocrLoading ? <Loader2 size={14} className="animate-spin" /> : <Camera size={14} />}
                    {ocrLoading ? 'Scanning...' : 'Upload DL Photo'}
                  </button>
                  <span className="text-[9px] text-[#556677]">JPG, PNG, or camera capture</span>
                </div>
              </div>
            </div>
          )}
          {loading && (
            <div className="flex items-center justify-center h-full text-rmpg-400 text-[10px]">
              <div className="text-center">
                <Search className="w-6 h-6 mx-auto mb-2 animate-pulse text-brand-400" />
                <p>Searching...</p>
              </div>
            </div>
          )}
          {!loading && results.map((r, idx) => (
            <button type="button"
              key={`${r.dl_number}-${r.dl_state}-${idx}`}
              onClick={() => setSelected(r)}
              className={`w-full text-left px-3 py-2 border-b border-rmpg-800/30 transition-all duration-150 ${
                selected?.dl_number === r.dl_number && selected?.dl_state === r.dl_state ? 'bg-brand-900/20 border-l-2 border-l-brand-500' : 'hover:bg-rmpg-800/20 border-l-2 border-l-transparent'
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold text-white">
                  {r.last_name}, {r.first_name} {r.middle_name || ''}
                </span>
                <ChevronRight className="w-3 h-3 text-rmpg-500" />
              </div>
              <div className="flex items-center gap-3 mt-0.5 text-[9px] text-rmpg-400">
                <span>DL: {r.dl_number || '—'}</span>
                <span>{r.dl_state || ''}</span>
                {r.date_of_birth && <span>DOB: {r.date_of_birth}</span>}
              </div>
              <div className="flex items-center gap-1.5 mt-1">
                {statusBadge(r.dl_status || '')}
                {sourceBadge(r.source || source)}
              </div>
            </button>
          ))}
          {!loading && results.length > 0 && (
            <div className="text-center text-[9px] text-rmpg-500 py-2 border-t border-rmpg-800/30 font-mono tabular-nums">
              {results.length} result{results.length !== 1 ? 's' : ''} — Source: {source}
            </div>
          )}
        </div>

        {/* Detail Panel */}
        <div className={`${isMobile ? (selected ? 'w-full' : 'hidden') : 'flex-1'} overflow-auto`}>
          {selected ? (
            <div className={`${isMobile ? 'p-3 space-y-3' : 'p-4 space-y-4'}`}>
              {/* Mobile back button */}
              {isMobile && (
                <button type="button" onClick={() => setSelected(null)}
                  className="text-rmpg-400 hover:text-white text-[10px] font-bold uppercase tracking-wider flex items-center gap-1">
                  <ChevronRight className="w-3 h-3 rotate-180" /> Back to Results
                </button>
              )}

              {/* DL Card */}
              <div className="panel-surface p-4">
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <h2 className={`${isMobile ? 'text-base' : 'text-lg'} font-black text-white`}>
                      {selected.last_name}, {selected.first_name} {selected.middle_name || ''} {selected.suffix || ''}
                    </h2>
                    <div className="flex items-center gap-2 mt-1">
                      {statusBadge(selected.dl_status || '')}
                      {sourceBadge(selected.source || source)}
                    </div>
                  </div>
                  <div className="text-right">
                    <span className="text-[9px] text-rmpg-500 uppercase font-bold">DL Number</span>
                    <p className="text-sm font-mono text-brand-400 font-bold">{selected.dl_number || '—'}</p>
                    <p className="text-[9px] text-rmpg-400">{selected.dl_state || ''}</p>
                  </div>
                </div>

                {/* License Status Alert */}
                {(() => {
                  const isExpired = selected.dl_expiration && new Date(selected.dl_expiration) < new Date();
                  const isSuspended = selected.dl_status && ['SUSPENDED', 'REVOKED', 'CANCELLED', 'DISQUALIFIED'].includes(selected.dl_status.toUpperCase());
                  if (isExpired || isSuspended) {
                    return (
                      <div className={`mt-3 px-4 py-2.5 border-2 flex items-center gap-2 ${
                        isSuspended ? 'bg-red-900/30 border-red-600 text-red-400' : 'bg-amber-900/30 border-amber-600 text-amber-400'
                      }`}>
                        <Shield className="w-5 h-5 flex-shrink-0" />
                        <span className="text-sm font-black uppercase tracking-wider animate-pulse">
                          {isSuspended ? `LICENSE ${selected.dl_status?.toUpperCase()}` : 'LICENSE EXPIRED'}
                        </span>
                        {isExpired && !isSuspended && (
                          <span className="text-xs font-mono ml-auto">Expired: {formatDate(selected.dl_expiration)}</span>
                        )}
                      </div>
                    );
                  }
                  return null;
                })()}

                {/* DL Information */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-3 p-3 bg-rmpg-800/20 border border-rmpg-700/30">
                  <div>
                    <span className="field-label">Class</span>
                    <p className="text-[11px] font-bold text-white">{selected.dl_class || '—'}</p>
                  </div>
                  <div>
                    <span className="field-label">Status</span>
                    <p className="text-[11px] font-bold text-white">{selected.dl_status || '—'}</p>
                  </div>
                  <div>
                    <span className="field-label">Expiration</span>
                    <p className="text-[11px] font-bold text-white">{formatDate(selected.dl_expiration)}</p>
                  </div>
                  <div>
                    <span className="field-label">Issue Date</span>
                    <p className="text-[11px] font-bold text-white">{formatDate(selected.dl_issue_date)}</p>
                  </div>
                  {selected.dl_restrictions && (
                    <div className="col-span-2">
                      <span className="field-label">Restrictions</span>
                      <p className="text-[11px] font-bold text-white">{selected.dl_restrictions}</p>
                    </div>
                  )}
                  {selected.dl_endorsements && (
                    <div className="col-span-2">
                      <span className="field-label">Endorsements</span>
                      <p className="text-[11px] font-bold text-white">{selected.dl_endorsements}</p>
                    </div>
                  )}
                </div>
              </div>

              {/* Subject Information */}
              <div className="panel-surface p-4">
                <h3 className="text-[10px] font-bold text-rmpg-200 uppercase tracking-wider mb-3 flex items-center gap-1.5">
                  <User className="w-3 h-3" /> Subject Information
                </h3>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <div>
                    <span className="field-label">Date of Birth</span>
                    <p className="text-[11px] font-bold text-white flex items-center gap-1">
                      <Calendar className="w-3 h-3 text-rmpg-400" /> {formatDate(selected.date_of_birth)}
                    </p>
                  </div>
                  <div>
                    <span className="field-label">Gender</span>
                    <p className="text-[11px] font-bold text-white">{selected.gender || '—'}</p>
                  </div>
                  <div>
                    <span className="field-label">Height</span>
                    <p className="text-[11px] font-bold text-white">{selected.height || '—'}</p>
                  </div>
                  <div>
                    <span className="field-label">Weight</span>
                    <p className="text-[11px] font-bold text-white">{selected.weight || '—'}</p>
                  </div>
                  <div>
                    <span className="field-label">Eye Color</span>
                    <p className="text-[11px] font-bold text-white">{selected.eye_color || '—'}</p>
                  </div>
                  <div>
                    <span className="field-label">Hair Color</span>
                    <p className="text-[11px] font-bold text-white">{selected.hair_color || '—'}</p>
                  </div>
                  <div>
                    <span className="field-label">Race</span>
                    <p className="text-[11px] font-bold text-white">{selected.race || '—'}</p>
                  </div>
                  {selected.fetched_at && (
                    <div>
                      <span className="field-label">Last Updated</span>
                      <p className="text-[11px] font-bold text-rmpg-300">{formatDate(selected.fetched_at)}</p>
                    </div>
                  )}
                </div>
              </div>

              {/* Addresses */}
              {selected.addresses && selected.addresses.length > 0 && (
                <div className="panel-surface p-4">
                  <h3 className="text-[10px] font-bold text-rmpg-200 uppercase tracking-wider mb-3 flex items-center gap-1.5">
                    <MapPin className="w-3 h-3" /> Addresses — {selected.addresses.length}
                  </h3>
                  <div className="space-y-2">
                    {selected.addresses.map((addr, i) => (
                      <div key={i} className="p-2 bg-rmpg-800/20 border border-rmpg-700/30">
                        <p className="text-[11px] text-white font-bold">{addr.address || '—'}</p>
                        {addr.address2 && <p className="text-[10px] text-rmpg-300">{addr.address2}</p>}
                        <p className="text-[10px] text-rmpg-300">
                          {[addr.city, addr.state, addr.postal_code].filter(Boolean).join(', ')}
                          {addr.country && addr.country !== 'US' ? ` ${addr.country}` : ''}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="flex items-center justify-center h-full text-rmpg-500 text-[10px]">
              <div className="text-center">
                <Shield className="w-10 h-10 mx-auto mb-2 text-rmpg-600" />
                <p>Select a record to view DL details</p>
              </div>
            </div>
          )}
        </div>
      </div>

      <ManualDlEntryModal
        isOpen={showManualEntry}
        onClose={() => setShowManualEntry(false)}
        onSubmit={handleManualSubmit}
        isSubmitting={isManualSubmitting}
      />

      {/* DL Verification Result Panel */}
      {verifyResult && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
          <div className="bg-[#141e2b] border border-[#1e2d40] rounded-sm max-w-lg w-full max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between px-4 py-3 border-b border-[#1e2d40] bg-[#0d1520]">
              <div className="flex items-center gap-2">
                <ShieldCheck size={14} className={verifyResult.verified ? 'text-green-400' : 'text-amber-400'} />
                <span className="text-[12px] font-bold text-white uppercase tracking-wider">
                  DL Verification {verifyResult.verified ? '- VERIFIED' : '- NOT VERIFIED'}
                </span>
              </div>
              <button type="button" onClick={() => setVerifyResult(null)} className="text-[#556677] hover:text-white">
                <X size={16} />
              </button>
            </div>
            <div className="p-4 space-y-1">
              {verifyResult.verified && (
                <div className="mb-3 px-3 py-2 bg-green-900/30 border border-green-700/50 text-green-400 text-[11px] font-bold flex items-center gap-2">
                  <ShieldCheck size={14} /> License verified successfully
                </div>
              )}
              {!verifyResult.verified && (
                <div className="mb-3 px-3 py-2 bg-amber-900/30 border border-amber-700/50 text-amber-400 text-[11px] font-bold flex items-center gap-2">
                  <AlertTriangle size={14} /> Could not verify this license
                </div>
              )}
              {([
                ['DL Number', verifyResult.dl_number],
                ['Name', verifyResult.name],
                ['Father Name', verifyResult.father_name],
                ['Date of Birth', verifyResult.date_of_birth],
                ['Address', verifyResult.address],
                ['DL Class', verifyResult.dl_class],
                ['DL Status', verifyResult.dl_status],
                ['Validity', verifyResult.dl_validity],
                ['Issue Date', verifyResult.dl_issue_date],
                ['Expiry', verifyResult.dl_expiry],
                ['State', verifyResult.dl_state],
                ['Blood Group', verifyResult.blood_group],
              ] as [string, string][]).filter(([_, val]) => val).map(([label, val]) => (
                <div key={label} className="flex items-center gap-2 text-[11px] py-0.5">
                  <span className="text-[#556677] w-28 flex-shrink-0 font-mono uppercase text-[9px]">{label}</span>
                  <span className="text-white font-mono">{val}</span>
                </div>
              ))}
              {verifyResult.photo_url && (
                <div className="mt-2">
                  <span className="text-[9px] text-[#556677] uppercase font-mono">Photo</span>
                  <img src={verifyResult.photo_url} alt="DL Photo" className="mt-1 w-24 h-auto border border-[#1e2d40] rounded-sm" />
                </div>
              )}
            </div>
            <div className="flex items-center gap-2 px-4 py-3 border-t border-[#1e2d40] bg-[#0d1520]">
              {verifyResult.verified && (
                <button
                  type="button"
                  onClick={handleCreatePersonFromVerify}
                  className="flex items-center gap-2 px-4 py-2 bg-green-600 hover:bg-green-500 rounded-sm text-[11px] font-bold text-white transition-colors"
                >
                  <Plus size={14} />
                  Create Person Record
                </button>
              )}
              <button
                type="button"
                onClick={() => setVerifyResult(null)}
                className="px-4 py-2 bg-[#1a2636] hover:bg-[#1e2d40] border border-[#1e2d40] rounded-sm text-[11px] text-[#8899aa] hover:text-white transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* OCR Preview Modal */}
      {showOcrPreview && ocrResult && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
          <div className="bg-[#141e2b] border border-[#1e2d40] rounded-sm max-w-lg w-full max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between px-4 py-3 border-b border-[#1e2d40] bg-[#0d1520]">
              <div className="flex items-center gap-2">
                <CreditCard size={14} className="text-[#d4a017]" />
                <span className="text-[12px] font-bold text-white uppercase tracking-wider">DL OCR Results</span>
              </div>
              <button type="button" onClick={() => setShowOcrPreview(false)} className="text-[#556677] hover:text-white">
                <X size={16} />
              </button>
            </div>
            <div className="p-4 space-y-3">
              <div className="text-[9px] font-bold text-[#8899aa] uppercase tracking-wider mb-2">Extracted Information — Review Before Saving</div>
              {([
                ['First Name', ocrResult.first_name],
                ['Middle Name', ocrResult.middle_name],
                ['Last Name', ocrResult.last_name],
                ['Date of Birth', ocrResult.date_of_birth],
                ['Gender', ocrResult.gender],
                ['Height', ocrResult.height],
                ['Weight', ocrResult.weight],
                ['Eye Color', ocrResult.eye_color],
                ['Hair Color', ocrResult.hair_color],
                ['Address', ocrResult.address],
                ['City', ocrResult.city],
                ['State', ocrResult.state],
                ['ZIP', ocrResult.zip],
                ['DL Number', ocrResult.dl_number],
                ['DL State', ocrResult.dl_state],
                ['DL Class', ocrResult.dl_class],
                ['DL Expiry', ocrResult.dl_expiry],
                ['DL Issue Date', ocrResult.dl_issue_date],
                ['Restrictions', ocrResult.dl_restrictions],
                ['Endorsements', ocrResult.dl_endorsements],
              ] as [string, string][]).filter(([_, val]) => val).map(([label, val]) => (
                <div key={label} className="flex items-center gap-2 text-[11px]">
                  <span className="text-[#556677] w-28 flex-shrink-0 font-mono uppercase text-[9px]">{label}</span>
                  <span className="text-white font-mono">{val}</span>
                </div>
              ))}
              {Object.entries(ocrResult).filter(([k, v]) => v && !['first_name','middle_name','last_name','date_of_birth','gender','height','weight','eye_color','hair_color','address','city','state','zip','dl_number','dl_state','dl_class','dl_expiry','dl_issue_date','dl_restrictions','dl_endorsements','full_name','source','raw_ocr'].includes(k)).length > 0 && (
                <div className="border-t border-[#1e2d40] pt-2 mt-2">
                  <div className="text-[8px] text-[#556677] uppercase tracking-wider mb-1">Additional Fields</div>
                  {Object.entries(ocrResult).filter(([k, v]) => v && !['first_name','middle_name','last_name','date_of_birth','gender','height','weight','eye_color','hair_color','address','city','state','zip','dl_number','dl_state','dl_class','dl_expiry','dl_issue_date','dl_restrictions','dl_endorsements','full_name','source','raw_ocr'].includes(k)).map(([k, v]) => (
                    <div key={k} className="flex items-center gap-2 text-[10px]">
                      <span className="text-[#556677] w-28 flex-shrink-0 font-mono uppercase text-[8px]">{k}</span>
                      <span className="text-[#8899aa] font-mono">{String(v)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="flex items-center gap-2 px-4 py-3 border-t border-[#1e2d40] bg-[#0d1520]">
              <button
                type="button"
                onClick={handleCreatePersonFromOcr}
                className="flex items-center gap-2 px-4 py-2 bg-green-600 hover:bg-green-500 rounded-sm text-[11px] font-bold text-white transition-colors"
              >
                <Plus size={14} />
                Create Person Record
              </button>
              <button
                type="button"
                onClick={() => setShowOcrPreview(false)}
                className="px-4 py-2 bg-[#1a2636] hover:bg-[#1e2d40] border border-[#1e2d40] rounded-sm text-[11px] text-[#8899aa] hover:text-white transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
