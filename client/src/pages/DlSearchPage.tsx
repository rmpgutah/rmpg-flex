// ============================================================
// RMPG Flex — Driver's License Search Page
// Standalone DL search against structured local records +
// live MicroBilt API. Split-panel layout with search form,
// results list, and detailed DL record view.
// ============================================================

import {useState, useCallback, useEffect, useRef} from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, CreditCard, User, MapPin, ChevronRight, Shield, ShieldCheck, Calendar, Database, Wifi, Plus, AlertTriangle, Camera, Loader2, X, Eye, ScanLine, UserCheck, Upload } from 'lucide-react';
import { apiFetch } from '../hooks/useApi';
import type { ReadoutRow, ScanAlert } from '../utils/aamvaParser';
import LiveDlScanner from '../components/LiveDlScanner';
import PanelTitleBar from '../components/PanelTitleBar';
import { useIsMobile } from '../hooks/useIsMobile';
import ManualDlEntryModal, { type ManualDlFormData } from '../components/ManualDlEntryModal';
import { useToast } from '../components/ToastProvider';
import { parseTimestamp } from '../utils/dateUtils';
import { useContextMenu, type ContextMenuItem } from '../context/ContextMenuContext';
import { useMenuActions } from '../utils/contextMenuActions';

// QR code that opens this scanner page on the officer's phone —
// scans made there relay to this desktop session automatically.
function PhoneScanQr() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    let cancelled = false;
    import('bwip-js/browser').then(({ default: bwipjs }) => {
      if (cancelled || !canvasRef.current) return;
      try {
        bwipjs.toCanvas(canvasRef.current, {
          bcid: 'qrcode',
          text: `${window.location.origin}/dl-search`,
          scale: 2,
          backgroundcolor: 'FFFFFF',
          paddingwidth: 4,
          paddingheight: 4,
        });
      } catch { /* QR render is decorative — page works without it */ }
    }).catch(() => { /* ignore */ });
    return () => { cancelled = true; };
  }, []);
  return <canvas ref={canvasRef} className="w-20 h-20" aria-label="QR code to open the DL scanner on your phone" />;
}

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

export default function DlSearchPage() {
  const isMobile = useIsMobile();
  const { addToast } = useToast();
  const { openMenu } = useContextMenu();
  const m = useMenuActions();
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

  // ── DL Scanner (PDF417 barcode-first, OCR fallback) ──
  const navigate = useNavigate();
  const [ocrLoading, setOcrLoading] = useState(false);
  const [ocrResult, setOcrResult] = useState<any>(null);
  const [showOcrPreview, setShowOcrPreview] = useState(false);
  const [scanReadout, setScanReadout] = useState<ReadoutRow[] | null>(null);
  const [showFullReadout, setShowFullReadout] = useState(false);
  const [scanMatches, setScanMatches] = useState<any[] | null>(null);
  const [matchLoading, setMatchLoading] = useState(false);
  const [uploadedRecord, setUploadedRecord] = useState<number | null>(null);
  const [scanAlerts, setScanAlerts] = useState<ScanAlert[]>([]);
  const [showLiveScanner, setShowLiveScanner] = useState(false);
  const [recentScans, setRecentScans] = useState<any[]>(() => {
    try { return JSON.parse(localStorage.getItem('rmpg-dl-recent-scans') || '[]'); } catch { return []; }
  });
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Always-fresh handle for the shared barcode pipeline — the relay-poll
  // effect runs on a stable interval and must not capture a stale closure.
  const processBarcodeTextRef = useRef<((raw: string, opts?: { silent?: boolean; skipRelay?: boolean }) => Promise<boolean>) | null>(null);

  const rememberScan = useCallback((entry: { name: string; dl_number: string; dl_state: string; aamva_raw?: string; payload: Record<string, unknown> }) => {
    setRecentScans(prev => {
      const next = [
        { ...entry, ts: Date.now() },
        ...prev.filter((s: any) => !(s.dl_number === entry.dl_number && s.dl_state === entry.dl_state)),
      ].slice(0, 10);
      try { localStorage.setItem('rmpg-dl-recent-scans', JSON.stringify(next)); } catch { /* storage full */ }
      return next;
    });
  }, []);

  // ── Phone → desktop relay ──
  // Phone: push every successful scan to the relay so the officer's
  // logged-in desktop session populates immediately.
  const pushScanToDesktop = useCallback(async (payload: Record<string, unknown>) => {
    try {
      await apiFetch('/dl-records/scan-relay', { method: 'POST', body: JSON.stringify({ payload }) });
      addToast('Scan sent to your desktop session', 'success');
    } catch {
      // Relay is best-effort — the phone still shows the scan locally.
    }
  }, [addToast]);

  // Desktop: poll for scans pushed from this user's phone while the
  // scanner page is open. D1-backed, so a phone push is visible on the
  // very next tick (~4s worst case).
  useEffect(() => {
    if (isMobile) return;
    let stopped = false;
    const tick = async () => {
      try {
        const data = await apiFetch<{ payload: any }>('/dl-records/scan-relay/poll');
        if (stopped || !data?.payload) return;
        const { aamva_raw, ...fields } = data.payload;
        addToast(`DL scan received from phone — ${fields.first_name || ''} ${fields.last_name || ''}`.trim(), 'success');
        if (aamva_raw && processBarcodeTextRef.current && await processBarcodeTextRef.current(aamva_raw, { silent: true, skipRelay: true })) {
          return; // full pipeline ran (readout, alerts, lookup, history)
        }
        setScanReadout(null);
        setScanAlerts([]);
        setUploadedRecord(null);
        setShowFullReadout(false);
        setOcrResult(fields);
        setShowOcrPreview(true);
        lookupExistingRecords(fields);
      } catch { /* quiet — retry next tick */ }
    };
    const iv = setInterval(tick, 4000);
    return () => { stopped = true; clearInterval(iv); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isMobile]);

  // After a scan, look the subject up in the records system —
  // exact DL-number match first, then name + DOB.
  const lookupExistingRecords = useCallback(async (parsed: { last_name?: string; first_name?: string; date_of_birth?: string; dl_number?: string }) => {
    setMatchLoading(true);
    setScanMatches(null);
    try {
      const matches: any[] = [];
      const seen = new Set<number>();
      if (parsed.last_name) {
        const rows = await apiFetch<any[]>(`/records/persons/search?q=${encodeURIComponent(parsed.last_name)}`).catch(() => []);
        for (const p of Array.isArray(rows) ? rows : []) {
          let matchType = '';
          if (parsed.dl_number && p.dl_number && String(p.dl_number).replace(/\W/g, '').toUpperCase() === parsed.dl_number.replace(/\W/g, '').toUpperCase()) {
            matchType = 'DL NUMBER MATCH';
          } else if (
            parsed.first_name && p.first_name &&
            String(p.first_name).toUpperCase() === parsed.first_name.toUpperCase() &&
            parsed.date_of_birth && p.dob && String(p.dob).slice(0, 10) === parsed.date_of_birth
          ) {
            matchType = 'NAME + DOB MATCH';
          }
          if (matchType && p.id && !seen.has(p.id)) {
            seen.add(p.id);
            matches.push({ ...p, match_type: matchType });
          }
        }
      }
      // DL-number matches first
      matches.sort((a, b) => (a.match_type === 'DL NUMBER MATCH' ? -1 : 0) - (b.match_type === 'DL NUMBER MATCH' ? -1 : 0));

      // Officer safety: check matched persons for active warrants.
      await Promise.all(matches.slice(0, 4).map(async (m) => {
        try {
          const hist = await apiFetch<any>(`/records/persons/${m.id}/system-history`);
          m.active_warrants = hist?.summary?.active_warrants ?? (Array.isArray(hist?.warrants) ? hist.warrants.filter((w: any) => w.status === 'active').length : 0);
          m.total_warrants = hist?.summary?.total_warrants ?? (Array.isArray(hist?.warrants) ? hist.warrants.length : 0);
        } catch { /* history unavailable — show match without warrant info */ }
      }));
      setScanMatches(matches);
    } catch {
      setScanMatches([]);
    } finally {
      setMatchLoading(false);
    }
  }, []);

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

  // Shared barcode pipeline — used by photo upload, the live camera
  // scanner, recent-scan replay, and phone-relay receipt.
  const processBarcodeText = useCallback(async (rawText: string, opts?: { silent?: boolean; skipRelay?: boolean }): Promise<boolean> => {
    try {
      const { parseAamva, looksLikeAamva, describeAamva, assessAamva } = await import('../utils/aamvaParser');
      if (!looksLikeAamva(rawText)) return false;
      const parsed = parseAamva(rawText);
      setScanReadout(describeAamva(parsed));
      setScanAlerts(assessAamva(parsed));
      const resultObj = {
          first_name: parsed.first_name,
          middle_name: parsed.middle_name,
          last_name: parsed.last_name,
          suffix: parsed.suffix,
          date_of_birth: parsed.date_of_birth,
          gender: parsed.gender,
          height: parsed.height,
          weight: parsed.weight,
          eye_color: parsed.eye_color,
          hair_color: parsed.hair_color,
          address: parsed.address,
          city: parsed.city,
          state: parsed.state,
          zip: parsed.zip,
          dl_number: parsed.dl_number,
          dl_state: parsed.dl_state,
          dl_class: parsed.dl_class,
          dl_expiry: parsed.dl_expiry,
          dl_issue_date: parsed.dl_issue_date,
          dl_restrictions: parsed.dl_restrictions,
          dl_endorsements: parsed.dl_endorsements,
          country: parsed.country,
          document_discriminator: parsed.document_discriminator,
          real_id: parsed.is_real_id === null ? '' : parsed.is_real_id ? 'YES' : 'NO',
          organ_donor: parsed.is_organ_donor === null ? '' : parsed.is_organ_donor ? 'YES' : 'NO',
          veteran: parsed.is_veteran === null ? '' : parsed.is_veteran ? 'YES' : 'NO',
          scan_method: 'PDF417 BARCODE',
        };
      setUploadedRecord(null);
      setShowFullReadout(false);
      setOcrResult(resultObj);
      setShowOcrPreview(true);
      if (!opts?.silent) addToast('PDF417 barcode read — all DMV-encoded fields extracted', 'success');
      // Pull any existing record for this subject (async — modal shows progress)
      lookupExistingRecords(parsed);
      // Phone as scanning device: mirror the scan to the desktop session
      if (isMobile && !opts?.skipRelay) pushScanToDesktop({ ...resultObj, aamva_raw: rawText });
      rememberScan({
        name: `${parsed.last_name}, ${parsed.first_name}`.replace(/^, |, $/g, ''),
        dl_number: parsed.dl_number, dl_state: parsed.dl_state,
        aamva_raw: rawText, payload: resultObj,
      });
      return true;
    } catch (err) {
      console.warn('[DL Scan] AAMVA parse failed:', err);
      return false;
    }
  }, [addToast, isMobile, lookupExistingRecords, pushScanToDesktop, rememberScan]);
  processBarcodeTextRef.current = processBarcodeText;

  const handleOcrUpload = useCallback(async (file: File) => {
    setOcrLoading(true);
    setOcrResult(null);
    setScanReadout(null);
    setScanMatches(null);
    setScanAlerts([]);
    setShowFullReadout(false);
    setUploadedRecord(null);

    // ── Pass 1: PDF417 barcode (back of card) ──
    // The AAMVA barcode is authoritative — every field exactly as the
    // issuing DMV encoded it. Only fall back to OCR (front of card)
    // when no barcode is found in the image.
    try {
      const { decodePdf417 } = await import('../utils/pdf417Decoder');
      const decoded = await decodePdf417(file);
      if (decoded && await processBarcodeText(decoded.text)) {
        setOcrLoading(false);
        return;
      }
    } catch (err) {
      // Barcode path is best-effort; OCR fallback below.
      console.warn('[DL Scan] PDF417 decode failed, falling back to OCR:', err);
    }

    // ── Pass 2: OCR fallback (front of card) ──
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
        lookupExistingRecords(data.parsed);
        if (isMobile) pushScanToDesktop(data.parsed);
      } else {
        addToast('OCR returned no data', 'warning');
      }
    } catch (err: any) {
      addToast(err.message || 'DL scan failed', 'error');
    } finally {
      setOcrLoading(false);
    }
  }, [addToast, lookupExistingRecords, isMobile, pushScanToDesktop, processBarcodeText]);

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
        setUploadedRecord(resp.id);
        // Also save as DL record
        try {
          await apiFetch('/dl-records', {
            method: 'POST',
            body: JSON.stringify({
              ...ocrResult,
              source: ocrResult.scan_method === 'PDF417 BARCODE' ? 'DL_BARCODE_SCAN' : 'DL_OCR_SCAN',
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
    return <span className="text-[8px] font-bold uppercase px-1 py-0.5 bg-gray-900/50 text-gray-400 border border-gray-700/50 inline-flex items-center gap-0.5"><Database className="w-2.5 h-2.5" />LOCAL</span>;
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
      const dt = parseTimestamp(d);
      return isNaN(dt.getTime()) ? d : dt.toLocaleDateString();
    } catch { return d; }
  };

  // ── Right-click context menu (result rows) ──
  const buildDlMenu = (r: DlSubject): ContextMenuItem[] => {
    const fullName = `${r.last_name || ''}, ${r.first_name || ''} ${r.middle_name || ''}`.trim().replace(/^,\s*/, '');
    return [
      m.action('View DL details', () => setSelected(r), { icon: <Eye size={12} /> }),
      m.separator(),
      m.copy('Copy name', fullName),
      m.copy('Copy DL number', r.dl_number, <CreditCard size={12} />),
      m.copyId(r.id),
    ];
  };

  // Desktop search bar
  const searchControls = (
    <div className="flex items-center gap-1.5 flex-wrap">
      <input id="ff-dlsearchpage-0" className="input-dark text-[10px] w-28 min-h-[36px]" placeholder="Last Name" value={lastName}
        onChange={(e) => setLastName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleSearch()} />
      <input id="ff-dlsearchpage-1" className="input-dark text-[10px] w-28 min-h-[36px]" placeholder="First Name" value={firstName}
        onChange={(e) => setFirstName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleSearch()} />
      <input id="ff-dlsearchpage-2" className="input-dark text-[10px] w-28 min-h-[36px]" placeholder="DL Number" value={dlNumber}
        onChange={(e) => setDlNumber(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleSearch()} />
      <select id="ff-dlsearchpage-3" className="select-dark text-[10px] w-16 min-h-[36px]" value={state} onChange={(e) => setState(e.target.value)}>
        <option value="">State</option>
        {US_STATES.map(s => <option key={s} value={s}>{s}</option>)}
      </select>
      <input id="ff-dlsearchpage-4" className="input-dark text-[10px] w-28 min-h-[36px]" type="date" placeholder="DOB" value={dob}
        onChange={(e) => setDob(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleSearch()} />
      <button type="button" onClick={handleSearch} disabled={loading} className="toolbar-btn toolbar-btn-primary text-[10px]">
        {loading ? 'Searching...' : 'Search'}
      </button>
      <button type="button" onClick={() => setShowManualEntry(true)} className="toolbar-btn text-[10px]">
        <Plus className="w-3 h-3" /> Manual Entry
      </button>
      <button type="button" onClick={() => setShowLiveScanner(true)} disabled={ocrLoading} className="toolbar-btn text-[10px]">
        {ocrLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <ScanLine className="w-3 h-3" />}
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
      <input id="ff-dlsearchpage-5"
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
        <div className="flex flex-col gap-1.5 px-3 py-2 flex-shrink-0" style={{ background: '#050505', borderBottom: '1px solid #2b2b2b' }}>
          <div className="flex items-center gap-1.5">
            <input id="ff-dlsearchpage-6" className="input-dark text-[10px] flex-1 min-h-[36px]" placeholder="Last Name" value={lastName}
              onChange={(e) => setLastName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleSearch()} />
            <input id="ff-dlsearchpage-7" className="input-dark text-[10px] flex-1 min-h-[36px]" placeholder="First Name" value={firstName}
              onChange={(e) => setFirstName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleSearch()} />
          </div>
          <div className="flex items-center gap-1.5">
            <input id="ff-dlsearchpage-8" className="input-dark text-[10px] flex-1 min-h-[36px]" placeholder="DL Number" value={dlNumber}
              onChange={(e) => setDlNumber(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleSearch()} />
            <select id="ff-dlsearchpage-9" className="select-dark text-[10px] w-16 min-h-[36px]" value={state} onChange={(e) => setState(e.target.value)}>
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
              {/* ── Driver's License Scanner ── */}
              <div className="border border-[#2e2e2e] rounded-sm bg-[#0c0c0c] w-full max-w-sm">
                <div className="flex items-center gap-2 px-3 py-2 border-b border-[#1a1a1a] bg-[#050505]">
                  <ScanLine size={14} className="text-[#d4a017]" />
                  <span className="text-[10px] font-bold text-[#d4a017] uppercase tracking-widest">Driver's License Scanner</span>
                </div>
                <div className="p-3 space-y-3">
                  <div className="border border-dashed border-[#2e2e2e] rounded-sm py-5 flex flex-col items-center gap-2 bg-[#080808]">
                    <CreditCard size={28} className="text-[#333333]" />
                    <button
                      type="button"
                      onClick={() => setShowLiveScanner(true)}
                      disabled={ocrLoading}
                      className="flex items-center gap-2 px-5 py-2.5 bg-[#d4a017] hover:bg-[#b88a12] disabled:opacity-40 rounded-sm text-[12px] font-bold text-black transition-colors uppercase tracking-wider"
                    >
                      {ocrLoading ? <Loader2 size={15} className="animate-spin" /> : <ScanLine size={15} />}
                      {ocrLoading ? 'Reading Barcode...' : 'Scan License'}
                    </button>
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={ocrLoading}
                      className="flex items-center gap-1.5 text-[9px] text-[#8899aa] hover:text-white"
                    >
                      <Upload size={11} /> or upload a photo
                    </button>
                    <span className="text-[9px] text-[#556677]">Live camera — reads automatically, no shutter</span>
                  </div>

                  {recentScans.length > 0 && (
                    <div className="border border-[#1a1a1a] rounded-sm bg-[#080808]">
                      <div className="px-2 py-1 text-[8px] font-bold text-[#556677] uppercase tracking-wider border-b border-[#141414]">Recent Scans</div>
                      <div className="max-h-32 overflow-y-auto">
                        {recentScans.map((s: any) => (
                          <button
                            key={`${s.dl_number}-${s.ts}`}
                            type="button"
                            onClick={() => {
                              if (s.aamva_raw) { processBarcodeText(s.aamva_raw, { silent: true, skipRelay: true }); }
                            }}
                            className="w-full flex items-center justify-between gap-2 px-2 py-1 text-left hover:bg-[#141414] border-b border-[#101010]"
                          >
                            <span className="text-[10px] text-[#c0ccdd] truncate">{s.name || 'UNKNOWN'}</span>
                            <span className="text-[8px] font-mono text-[#556677] flex-shrink-0">{s.dl_state} {s.dl_number} · {new Date(s.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                  <div className="space-y-1 text-[9px] text-[#556677] leading-relaxed">
                    <p><span className="text-[#c0ccdd] font-semibold">→ Scan the BACK of the card</span> — the PDF417 barcode gives an exact, DMV-encoded read of every field (full English readout).</p>
                    <p>→ Existing person records are <span className="text-[#c0ccdd] font-semibold">pulled automatically</span> on a DL-number or name+DOB match.</p>
                    <p>→ No record? <span className="text-[#c0ccdd] font-semibold">Upload to Records</span> creates the person + DL record in one tap.</p>
                    <p>→ Front-of-card photos fall back to OCR extraction.</p>
                  </div>
                  {!isMobile && (
                    <div className="flex items-center gap-3 border-t border-[#1a1a1a] pt-3">
                      <div className="bg-white p-1 rounded-sm flex-shrink-0">
                        <PhoneScanQr />
                      </div>
                      <div className="text-[9px] text-[#556677] leading-relaxed">
                        <p className="text-[10px] font-bold text-[#c0ccdd] uppercase tracking-wider mb-0.5">Use your phone as the scanner</p>
                        <p>Scan this QR with your phone, sign in, and scan the license there — the results <span className="text-[#c0ccdd] font-semibold">appear on this screen automatically</span> (same login, within seconds).</p>
                      </div>
                    </div>
                  )}
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
              onContextMenu={(e) => openMenu(e, buildDlMenu(r))}
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
                  const isExpired = selected.dl_expiration && parseTimestamp(selected.dl_expiration) < new Date();
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

      {showLiveScanner && (
        <LiveDlScanner
          onDecoded={async (text) => {
            setShowLiveScanner(false);
            const ok = await processBarcodeText(text);
            if (!ok) addToast('Barcode read but not a driver license payload', 'warning');
          }}
          onClose={() => setShowLiveScanner(false)}
          onUploadInstead={() => { setShowLiveScanner(false); fileInputRef.current?.click(); }}
        />
      )}

      <ManualDlEntryModal
        isOpen={showManualEntry}
        onClose={() => setShowManualEntry(false)}
        onSubmit={handleManualSubmit}
        isSubmitting={isManualSubmitting}
      />

      {/* DL Verification Result Panel */}
      {verifyResult && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
          <div className="bg-[#141414] border border-[#1a1a1a] rounded-sm max-w-lg w-full max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between px-4 py-3 border-b border-[#1a1a1a] bg-[#0c0c0c]">
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
                  <img src={verifyResult.photo_url} alt="DL Photo" className="mt-1 w-24 h-auto border border-[#1a1a1a] rounded-sm" />
                </div>
              )}
            </div>
            <div className="flex items-center gap-2 px-4 py-3 border-t border-[#1a1a1a] bg-[#0c0c0c]">
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
                className="px-4 py-2 bg-[#181818] hover:bg-[#1a1a1a] border border-[#1a1a1a] rounded-sm text-[11px] text-[#8899aa] hover:text-white transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* DL Scanner Results Modal */}
      {showOcrPreview && ocrResult && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
          <div className="bg-[#141414] border border-[#1a1a1a] rounded-sm max-w-xl w-full max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between px-4 py-3 border-b border-[#1a1a1a] bg-[#0c0c0c]">
              <div className="flex items-center gap-2">
                <ScanLine size={14} className="text-[#d4a017]" />
                <span className="text-[12px] font-bold text-white uppercase tracking-wider">
                  {scanReadout ? 'DL Scanner — PDF417 Read' : 'DL Scanner — OCR Read'}
                </span>
                {scanReadout && (
                  <span className="text-[8px] font-bold uppercase px-1 py-0.5 bg-green-900/50 text-green-400 border border-green-700/50">DMV-Encoded</span>
                )}
              </div>
              <button type="button" onClick={() => setShowOcrPreview(false)} className="text-[#556677] hover:text-white">
                <X size={16} />
              </button>
            </div>
            <div className="p-4 space-y-3">
              {/* ── Officer-safety + status alerts ── */}
              {(scanMatches?.some((m: any) => m.active_warrants > 0) || scanAlerts.length > 0) && (
                <div className="space-y-1">
                  {scanMatches?.filter((m: any) => m.active_warrants > 0).map((m: any) => (
                    <div key={`w-${m.id}`} className="flex items-center gap-2 px-3 py-2 bg-red-900/40 border border-red-600/70 text-red-300 text-[11px] font-bold uppercase tracking-wide">
                      <AlertTriangle size={14} className="flex-shrink-0 text-red-400" />
                      ⚠ ACTIVE WARRANT{m.active_warrants > 1 ? `S (${m.active_warrants})` : ''} — {m.last_name}, {m.first_name} (#{m.id})
                    </div>
                  ))}
                  {scanAlerts.map((a) => (
                    <div
                      key={a.code}
                      className={`flex items-center gap-2 px-3 py-1.5 border text-[10px] font-bold uppercase tracking-wide ${
                        a.level === 'danger' ? 'bg-red-900/30 border-red-700/50 text-red-400'
                        : a.level === 'warning' ? 'bg-amber-900/30 border-amber-700/50 text-amber-400'
                        : 'bg-[#141414] border-[#2e2e2e] text-[#8899aa]'
                      }`}
                    >
                      <AlertTriangle size={12} className="flex-shrink-0" />
                      {a.message}
                    </div>
                  ))}
                </div>
              )}

              {/* ── Records-system match ── */}
              <div className="border border-[#1a1a1a] rounded-sm bg-[#0c0c0c]">
                <div className="px-3 py-1.5 border-b border-[#1a1a1a] text-[9px] font-bold text-[#8899aa] uppercase tracking-wider flex items-center gap-1.5">
                  <Database size={11} /> Records System
                </div>
                <div className="p-2 space-y-1.5">
                  {uploadedRecord ? (
                    <div className="flex items-center justify-between gap-2 px-2 py-1.5 bg-green-900/20 border border-green-700/40">
                      <span className="text-[10px] text-green-400 font-bold flex items-center gap-1.5">
                        <UserCheck size={12} /> Uploaded — Person record #{uploadedRecord} created
                      </span>
                      <button
                        type="button"
                        onClick={() => { setShowOcrPreview(false); navigate(`/records?tab=persons&personId=${uploadedRecord}`); }}
                        className="px-2.5 py-1 bg-green-600 hover:bg-green-500 rounded-sm text-[10px] font-bold text-white"
                      >
                        Open Record
                      </button>
                    </div>
                  ) : matchLoading ? (
                    <div className="flex items-center gap-2 text-[10px] text-[#8899aa] px-2 py-1.5">
                      <Loader2 size={12} className="animate-spin" /> Searching records for this subject...
                    </div>
                  ) : scanMatches && scanMatches.length > 0 ? (
                    scanMatches.map((p) => (
                      <div key={p.id} className="flex items-center justify-between gap-2 px-2 py-1.5 bg-[#141414] border border-[#222222]">
                        <div className="min-w-0">
                          <div className="text-[11px] text-white font-bold truncate">
                            {p.last_name}, {p.first_name} <span className="text-[#556677] font-normal">#{p.id}</span>
                          </div>
                          <div className="text-[8px] text-[#d4a017] font-bold uppercase tracking-wider flex items-center gap-1.5">
                            {p.match_type}{p.dob ? ` · DOB ${String(p.dob).slice(0, 10)}` : ''}
                            {p.active_warrants > 0 && (
                              <span className="px-1 py-px bg-red-900/60 text-red-300 border border-red-600/70 font-bold">{p.active_warrants} ACTIVE WARRANT{p.active_warrants > 1 ? 'S' : ''}</span>
                            )}
                            {p.active_warrants === 0 && p.total_warrants > 0 && (
                              <span className="px-1 py-px bg-[#141414] text-[#8899aa] border border-[#2e2e2e]">{p.total_warrants} prior warrant{p.total_warrants > 1 ? 's' : ''}</span>
                            )}
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => { setShowOcrPreview(false); navigate(`/records?tab=persons&personId=${p.id}`); }}
                          className="flex items-center gap-1.5 px-2.5 py-1.5 bg-[#d4a017] hover:bg-[#b88a12] rounded-sm text-[10px] font-bold text-black flex-shrink-0"
                        >
                          <UserCheck size={12} /> Pull Record
                        </button>
                      </div>
                    ))
                  ) : (
                    <div className="text-[10px] text-[#8899aa] px-2 py-1.5 flex items-center gap-1.5">
                      <AlertTriangle size={11} className="text-amber-500" /> No existing record found — upload below to create one.
                    </div>
                  )}
                </div>
              </div>

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
              {!scanReadout && Object.entries(ocrResult).filter(([k, v]) => v && !['first_name','middle_name','last_name','date_of_birth','gender','height','weight','eye_color','hair_color','address','city','state','zip','dl_number','dl_state','dl_class','dl_expiry','dl_issue_date','dl_restrictions','dl_endorsements','full_name','source','raw_ocr'].includes(k)).length > 0 && (
                <div className="border-t border-[#1a1a1a] pt-2 mt-2">
                  <div className="text-[8px] text-[#556677] uppercase tracking-wider mb-1">Additional Fields</div>
                  {Object.entries(ocrResult).filter(([k, v]) => v && !['first_name','middle_name','last_name','date_of_birth','gender','height','weight','eye_color','hair_color','address','city','state','zip','dl_number','dl_state','dl_class','dl_expiry','dl_issue_date','dl_restrictions','dl_endorsements','full_name','source','raw_ocr'].includes(k)).map(([k, v]) => (
                    <div key={k} className="flex items-center gap-2 text-[10px]">
                      <span className="text-[#556677] w-28 flex-shrink-0 font-mono uppercase text-[8px]">{k}</span>
                      <span className="text-[#8899aa] font-mono">{String(v)}</span>
                    </div>
                  ))}
                </div>
              )}

              {/* ── Full English barcode readout (every AAMVA element) ── */}
              {scanReadout && (
                <div className="border border-[#1a1a1a] rounded-sm bg-[#0c0c0c] mt-2">
                  <button
                    type="button"
                    onClick={() => setShowFullReadout(v => !v)}
                    className="w-full flex items-center justify-between px-3 py-1.5 text-[9px] font-bold text-[#8899aa] uppercase tracking-wider hover:text-white"
                  >
                    <span className="flex items-center gap-1.5"><ScanLine size={11} /> Full Barcode Readout — {scanReadout.length} fields decoded</span>
                    <ChevronRight size={12} className={`transition-transform ${showFullReadout ? 'rotate-90' : ''}`} />
                  </button>
                  {showFullReadout && (
                    <div className="border-t border-[#1a1a1a] max-h-72 overflow-y-auto">
                      <table className="w-full text-left">
                        <thead>
                          <tr className="text-[8px] text-[#556677] uppercase font-semibold">
                            <th className="px-2 py-[3px] w-10">Code</th>
                            <th className="px-2 py-[3px] w-36">Field</th>
                            <th className="px-2 py-[3px]">English</th>
                          </tr>
                        </thead>
                        <tbody>
                          {scanReadout.map((row) => (
                            <tr key={row.code} className="border-t border-[#141414] text-[10px] align-top">
                              <td className="px-2 py-[2px] font-mono text-[#d4a017] text-[9px]">{row.code}</td>
                              <td className="px-2 py-[2px] text-[#8899aa]">{row.label}</td>
                              <td className="px-2 py-[2px] text-white">
                                {row.english}
                                {row.english !== row.value && row.value && (
                                  <span className="text-[#556677] font-mono text-[8px] ml-1.5">[{row.value}]</span>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}
            </div>
            <div className="flex items-center gap-2 px-4 py-3 border-t border-[#1a1a1a] bg-[#0c0c0c]">
              {!uploadedRecord && (
                <button
                  type="button"
                  onClick={handleCreatePersonFromOcr}
                  className="flex items-center gap-2 px-4 py-2 bg-green-600 hover:bg-green-500 rounded-sm text-[11px] font-bold text-white transition-colors"
                >
                  <Upload size={14} />
                  {scanMatches && scanMatches.length > 0 ? 'Upload as New Record' : 'Upload to Records'}
                </button>
              )}
              <button
                type="button"
                onClick={() => setShowOcrPreview(false)}
                className="px-4 py-2 bg-[#181818] hover:bg-[#1a1a1a] border border-[#1a1a1a] rounded-sm text-[11px] text-[#8899aa] hover:text-white transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
