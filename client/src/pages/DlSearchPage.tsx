// ============================================================
// RMPG Flex — Driver's License Scanner + Search Page
// PDF417/OCR scanner with deep records sweep, plus search against
// the department's local DL records store. External DMV providers
// (MicroBilt/RapidAPI) are intentionally not wired — no live
// credentials are provisioned. Split-panel layout.
// ============================================================

import {useState, useCallback, useEffect, useRef} from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { Search, CreditCard, User, MapPin, ChevronRight, Shield, Calendar, Database, Plus, AlertTriangle, Loader2, X, Eye, ScanLine, UserCheck, Upload, History, Camera } from 'lucide-react';
import { apiFetch, apiUploadFilesWithProgress } from '../hooks/useApi';
import { useAuth } from '../context/AuthContext';
import type { ReadoutRow, ScanAlert, LeField } from '../utils/aamvaParser';
import LiveDlScanner from '../components/LiveDlScanner';
import PanelTitleBar from '../components/PanelTitleBar';
import { useIsMobile } from '../hooks/useIsMobile';
import ManualDlEntryModal, { type ManualDlFormData } from '../components/ManualDlEntryModal';
import { useToast } from '../components/ToastProvider';
import { parseTimestamp } from '../utils/dateUtils';
import { useContextMenu, type ContextMenuItem } from '../context/ContextMenuContext';
import { useMenuActions } from '../utils/contextMenuActions';
import ConfirmDialog from '../components/ConfirmDialog';
import { importWithRetry } from '../utils/importWithRetry';

// QR code that opens this scanner page on the officer's phone —
// scans made there relay to this desktop session automatically.
// Thumbnail for a captured ID card image blob (revokes its object URL on unmount).
function ImgThumb({ blob, label }: { blob: Blob; label: string }) {
  const [url, setUrl] = useState('');
  useEffect(() => {
    const u = URL.createObjectURL(blob);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [blob]);
  return (
    <div className="relative flex-shrink-0">
      {url && <img src={url} alt={`ID ${label}`} className="w-16 h-10 object-cover border border-rmpg-700 rounded-sm bg-black" />}
      <span className="absolute bottom-0 inset-x-0 bg-black/70 text-[7px] font-bold text-brand-gold-500 text-center uppercase">{label}</span>
    </div>
  );
}

// QR code that opens this scanner page on the officer's phone —
// scans made there relay to this desktop session automatically.
function PhoneScanQr() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    let cancelled = false;
    importWithRetry(() => import('bwip-js/browser')).then(({ default: bwipjs }) => {
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

const timeAgo = (date: string): string => {
  if (!date) return '—';
  const parsed = parseTimestamp(date).getTime();
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
  const { user } = useAuth();
  const canManageSources = user?.role === 'admin' || user?.role === 'manager';
  const { addToast } = useToast();
  const { openMenu } = useContextMenu();
  const m = useMenuActions();
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [dlNumber, setDlNumber] = useState('');
  const [state, setState] = useState('');
  const [dob, setDob] = useState('');
  const [results, setResults] = useState<DlSubject[]>([]);
  const [hasSearched, setHasSearched] = useState(false);
  const [selected, setSelected] = useState<DlSubject | null>(null);
  const [source, setSource] = useState('');
  const [loading, setLoading] = useState(false);
  const [fetchError, setFetchError] = useState('');
  const [showManualEntry, setShowManualEntry] = useState(false);
  const [isManualSubmitting, setIsManualSubmitting] = useState(false);
  // Ref for the first search field — used by the N shortcut to focus it
  const firstFieldRef = useRef<HTMLInputElement>(null);

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
  // Front + back ID card images captured by the guided scanner — kept so
  // they can be filed under the person record on create/merge.
  const [cardImages, setCardImages] = useState<{ front: Blob | null; back: Blob | null }>({ front: null, back: null });
  const [cardSavedTo, setCardSavedTo] = useState<number | null>(null);

  // Stamp + upload the captured ID card images to a person record.
  const fileCardImagesTo = useCallback(async (personId: number) => {
    const { front, back } = cardImages;
    if ((!front && !back) || cardSavedTo === personId) return;
    try {
      const { stampPhoto, getGeoFix } = await importWithRetry(() => import('../utils/photoStamp'));
      const geo = await getGeoFix();
      const officerLast = (user?.last_name || user?.full_name?.split(' ').slice(-1)[0] || user?.username || '').trim();
      const mk = (blob: Blob, side: 'FRONT' | 'BACK') =>
        stampPhoto(new File([blob], `id-${side.toLowerCase()}-${personId}.jpg`, { type: 'image/jpeg' }), {
          officerLast, badge: user?.badge_number, context: `ID ${side} — PERSONS RECORD`, lat: geo?.lat, lon: geo?.lon,
        });
      const files: File[] = [];
      if (front) files.push(await mk(front, 'FRONT'));
      if (back) files.push(await mk(back, 'BACK'));
      if (!files.length) return;
      await apiUploadFilesWithProgress(files, 'person', personId, () => {});
      setCardSavedTo(personId);
      addToast(`ID card image${files.length > 1 ? 's' : ''} filed to record #${personId}`, 'success');
    } catch {
      addToast('ID card images could not be filed', 'warning');
    }
  }, [cardImages, cardSavedTo, user, addToast]);
  const [scanAlerts, setScanAlerts] = useState<ScanAlert[]>([]);
  const [leFields, setLeFields] = useState<LeField[] | null>(null);
  const [leBlock, setLeBlock] = useState('');
  const [scanEval, setScanEval] = useState<import('../utils/dlFunctions').DlEvaluation | null>(null);
  const [deepSweep, setDeepSweep] = useState<{ sources: any[]; total: number } | null>(null);
  const [deepSweepLoading, setDeepSweepLoading] = useState(false);
  const [courtRecords, setCourtRecords] = useState<any[] | null>(null);
  const [courtLoading, setCourtLoading] = useState(false);
  const [fbiRecords, setFbiRecords] = useState<any[] | null>(null);
  const [fbiLoading, setFbiLoading] = useState(false);
  const [showLiveScanner, setShowLiveScanner] = useState(false);
  const [showScanHistory, setShowScanHistory] = useState(false);
  const [scanHistory, setScanHistory] = useState<any[] | null>(null);
  const [scanHistoryLoading, setScanHistoryLoading] = useState(false);
  const [scanHistoryMine, setScanHistoryMine] = useState(false);

  // ── Data-source config (admin) ──
  const [showSources, setShowSources] = useState(false);
  const [sourcesCfg, setSourcesCfg] = useState<any>(null);
  const [sourcesSaving, setSourcesSaving] = useState(false);
  const [sorUrl, setSorUrl] = useState('');
  const [sorKey, setSorKey] = useState('');
  const [clToken, setClToken] = useState('');
  const [sorImportText, setSorImportText] = useState('');
  const [sorImporting, setSorImporting] = useState(false);
  // Confirm before bulk-importing SOR records (hard-to-undo write op)
  const [confirmSorImport, setConfirmSorImport] = useState(false);

  const loadSources = useCallback(() => {
    apiFetch<any>('/dl-records/sources-config')
      .then(d => { setSourcesCfg(d); setSorUrl(d?.sor_feed_url || ''); setSorKey(''); setClToken(''); })
      .catch(() => addToast('Failed to load data-source config', 'error'));
  }, [addToast]);

  const saveSources = useCallback(async () => {
    setSourcesSaving(true);
    try {
      const body: any = { sor_feed_url: sorUrl };
      if (sorKey) body.sor_feed_key = sorKey;          // only send if entered (don't clobber)
      if (clToken) body.courtlistener_token = clToken;
      await apiFetch('/dl-records/sources-config', { method: 'PUT', body: JSON.stringify(body) });
      addToast('Data-source config saved', 'success');
      loadSources();
    } catch (err) {
      addToast(err instanceof Error ? err instanceof Error ? err.message : 'Unknown error' : 'Save failed', 'error');
    } finally { setSourcesSaving(false); }
  }, [sorUrl, sorKey, clToken, addToast, loadSources]);

  const runSorPoll = useCallback(async () => {
    try {
      const r = await apiFetch<any>('/dl-records/sor/poll', { method: 'POST' });
      addToast(r?.configured ? `SOR poll: ${r.upserted} record(s) loaded` : 'No SOR feed configured', r?.configured ? 'success' : 'warning');
      loadSources();
    } catch (err) { addToast(err instanceof Error ? err instanceof Error ? err.message : 'Unknown error' : 'Poll failed', 'error'); }
  }, [addToast, loadSources]);

  // Bulk-import offender rows the agency lawfully holds — JSON array or CSV
  // (first row = headers). Backend /sor/import dedups on registry_id and
  // tolerantly aliases field names, so loose column names still map.
  const importSor = useCallback(async () => {
    const text = sorImportText.trim();
    if (!text) return;
    let rows: any[] = [];
    try {
      if (text.startsWith('[') || text.startsWith('{')) {
        const parsed = JSON.parse(text);
        rows = Array.isArray(parsed) ? parsed : (parsed.rows ?? parsed.data ?? parsed.offenders ?? []);
      } else {
        // CSV → array of objects keyed by the header row.
        const lines = text.split(/\r?\n/).filter(l => l.trim());
        const headers = lines[0].split(',').map(h => h.trim());
        rows = lines.slice(1).map(line => {
          const cells = line.split(',');
          return Object.fromEntries(headers.map((h, i) => [h, (cells[i] ?? '').trim()]));
        });
      }
    } catch {
      addToast('Could not parse — paste a JSON array or CSV with a header row', 'error');
      return;
    }
    if (!rows.length) { addToast('No rows found to import', 'warning'); return; }
    setSorImporting(true);
    try {
      const r = await apiFetch<any>('/dl-records/sor/import', { method: 'POST', body: JSON.stringify({ rows }) });
      addToast(`Imported ${r?.imported ?? 0} of ${rows.length} offender record(s)`, 'success');
      setSorImportText('');
      loadSources();
    } catch (err) {
      addToast(err instanceof Error ? err instanceof Error ? err.message : 'Unknown error' : 'Import failed', 'error');
    } finally { setSorImporting(false); }
  }, [sorImportText, addToast, loadSources]);

  const loadScanHistory = useCallback((mine: boolean) => {
    setScanHistoryLoading(true);
    apiFetch<{ data: any[] }>(`/dl-records/scan-log?limit=100${mine ? '&mine=1' : ''}`)
      .then(d => setScanHistory(Array.isArray(d?.data) ? d.data : []))
      .catch(() => setScanHistory([]))
      .finally(() => setScanHistoryLoading(false));
  }, []);
  // Recent-scans memory is now USER-SCOPED. Previously the key
  // 'rmpg-dl-recent-scans' was global — two officers sharing a workstation
  // saw each other's last DL scans (names + DL numbers visible). Bumped to
  // a per-user storage key + hydrated by an effect once user.id is known.
  // useState starts empty; the hydration effect runs after auth resolves.
  const recentScansKey = user?.id ? `rmpg-dl-recent-scans:${user.id}` : null;
  const [recentScans, setRecentScans] = useState<any[]>([]);
  useEffect(() => {
    if (!recentScansKey) return;
    try {
      const raw = localStorage.getItem(recentScansKey);
      setRecentScans(raw ? JSON.parse(raw) : []);
    } catch {
      setRecentScans([]);
    }
    // One-time cleanup of the legacy global key — purges any pre-2026-06-22
    // entries left from before this PR. Safe to run on every user switch
    // since the legacy key was never per-user.
    try { localStorage.removeItem('rmpg-dl-recent-scans'); } catch { /* storage unavailable */ }
  }, [recentScansKey]);
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
      // Write to the user-scoped key if available; skip on guest/uninitialized
      // auth rather than fall back to the legacy global key.
      if (recentScansKey) {
        try { localStorage.setItem(recentScansKey, JSON.stringify(next)); } catch { /* storage full */ }
      }
      return next;
    });
  }, [recentScansKey]);

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
        setLeFields(null); setScanEval(null);
        setLeBlock('');
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
  const lookupExistingRecords = useCallback(async (parsed: { last_name?: string; first_name?: string; date_of_birth?: string; dl_number?: string; dl_state?: string }) => {
    setMatchLoading(true);
    setScanMatches(null);
    setDeepSweep(null);
    setCourtRecords(null);
    setFbiRecords(null);

    // FBI Wanted (official public API) — external, fired in parallel.
    if (parsed.last_name && parsed.last_name.length >= 2) {
      setFbiLoading(true);
      const fq = new URLSearchParams({ last: parsed.last_name });
      if (parsed.first_name) fq.set('first', parsed.first_name);
      apiFetch<{ records: any[] }>(`/dl-records/fbi-lookup?${fq}`)
        .then(d => setFbiRecords(Array.isArray(d?.records) ? d.records : []))
        .catch(() => setFbiRecords([]))
        .finally(() => setFbiLoading(false));
    }

    // Open-source federal court records (CourtListener) — external API,
    // fired in parallel so it never blocks the D1 sweep.
    if (parsed.last_name && parsed.last_name.length >= 2) {
      setCourtLoading(true);
      const cq = new URLSearchParams({ last: parsed.last_name });
      if (parsed.first_name) cq.set('first', parsed.first_name);
      apiFetch<{ records: any[] }>(`/dl-records/court-lookup?${cq}`)
        .then(d => setCourtRecords(Array.isArray(d?.records) ? d.records : []))
        .catch(() => setCourtRecords([]))
        .finally(() => setCourtLoading(false));
    }

    // Prefill the search form from the scan for instant re-query.
    if (parsed.last_name) setLastName(parsed.last_name);
    if (parsed.first_name) setFirstName(parsed.first_name);
    if ((parsed as any).dl_number) setDlNumber((parsed as any).dl_number);
    if ((parsed as any).dl_state) setState((parsed as any).dl_state);
    if (parsed.date_of_birth) setDob(parsed.date_of_birth);

    // Deep sweep covers the hard-to-find sources (statewide warrants,
    // bookings, FIs, gang intel, sex-offender registry, watchlist, alias
    // hits, cases, trespass, BOLOs, civil process) that a persons-table
    // match misses. When a person record matches, the sweep also pulls
    // the full subject profile (flags, criminal history, registry alerts,
    // vehicles) keyed on person_id.
    const runDeepSweep = (personId?: number) => {
      if (!parsed.last_name || parsed.last_name.length < 2) return;
      setDeepSweepLoading(true);
      const qs = new URLSearchParams({ last: parsed.last_name });
      if (parsed.first_name) qs.set('first', parsed.first_name);
      if (parsed.date_of_birth) qs.set('dob', parsed.date_of_birth);
      if ((parsed as any).dl_number) qs.set('dl', (parsed as any).dl_number);
      if (personId) qs.set('person_id', String(personId));
      apiFetch<{ sources: any[]; total: number; profile?: any }>(`/dl-records/deep-sweep?${qs}`)
        .then(d => {
          const sweep = d && Array.isArray(d.sources) ? d : { sources: [], total: 0 } as any;
          setDeepSweep(sweep);
          // ── System of record: every scan + its findings is logged ──
          apiFetch('/dl-records/scan-log', {
            method: 'POST',
            body: JSON.stringify({
              scan_method: (parsed as any).scan_method || 'PDF417 BARCODE',
              dl_number: (parsed as any).dl_number || '',
              dl_state: (parsed as any).dl_state || '',
              subject_name: `${parsed.last_name || ''}, ${parsed.first_name || ''}`.replace(/^, |, $/g, ''),
              dob: parsed.date_of_birth || '',
              person_id: personId ?? null,
              // Full subject record so the system-of-record link in dl_records
              // captures every scanned field, not just name/class/expiry.
              first_name: parsed.first_name, last_name: parsed.last_name,
              middle_name: (parsed as any).middle_name || '', suffix: (parsed as any).suffix || '',
              gender: (parsed as any).gender || '', height: (parsed as any).height || '',
              weight: (parsed as any).weight || '',
              eye_color: (parsed as any).eye_color || '', hair_color: (parsed as any).hair_color || '',
              dl_class: (parsed as any).dl_class || '', dl_expiry: (parsed as any).dl_expiry || '',
              dl_issue_date: (parsed as any).dl_issue_date || '',
              dl_restrictions: (parsed as any).dl_restrictions || '',
              dl_endorsements: (parsed as any).dl_endorsements || '',
              address: (parsed as any).address || '', city: (parsed as any).city || '',
              state: (parsed as any).state || '', zip: (parsed as any).zip || '',
              raw_record: JSON.stringify(parsed),
              findings: {
                sweep_total: sweep.total,
                sources: (sweep.sources || []).map((s: any) => ({ key: s.key, count: s.rows.length, danger: !!s.danger })),
                profile_flags: sweep.profile?.person ? {
                  sex_offender: !!sweep.profile.person.is_sex_offender,
                  watchlist: sweep.profile.person.watchlist_match || null,
                  supervision: sweep.profile.person.probation_parole || null,
                } : null,
              },
            }),
          }).catch(() => { /* logging is best-effort, never blocks the scan */ });
        })
        .catch(() => setDeepSweep({ sources: [], total: 0 }))
        .finally(() => setDeepSweepLoading(false));
    };

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
      // Full-detail sweep keyed to the best match (DL-number match first).
      runDeepSweep(matches[0]?.id);
    } catch {
      setScanMatches([]);
      runDeepSweep();
    } finally {
      setMatchLoading(false);
    }
  }, []);

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
    } catch (err) { addToast(err instanceof Error ? err instanceof Error ? err.message : 'Unknown error' : 'Stolen check failed', 'error'); }
  };

  // ── ?dl= / ?dl_number= / ?last= / ?person_id= URL deep-link ──
  // Supports: ?dl=<number>&state=<XX> (legacy short form), ?dl_number=<number>&state=<XX>
  // (canonical form used by scan-history links + NCIC QD popouts),
  // ?last=&first=&dob= (name-based pre-fills), and ?person_id=<id>
  // (navigates directly to the person record in /records).
  // Pre-fills inputs + auto-runs the search; params are stripped after
  // applying so a refresh doesn't loop.
  const [searchParams, setSearchParams] = useSearchParams();
  const fromDeepLinkRef = useRef(false);
  const pendingDeepLinkRef = useRef<{
    dl: string | null; state: string | null;
    last: string | null; first: string | null; dob: string | null;
    person_id: string | null;
  } | null>((() => {
    const dl = searchParams.get('dl_number') || searchParams.get('dl');
    const state = searchParams.get('state');
    const last = searchParams.get('last');
    const first = searchParams.get('first');
    const dob = searchParams.get('dob');
    const person_id = searchParams.get('person_id');
    if (!dl && !last && !first && !dob && !person_id) return null;
    return { dl, state, last, first, dob, person_id };
  })());

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
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Verification failed', 'error');
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
          notes: `Created from DL verification on ${new Date().toLocaleDateString('en-US', { timeZone: 'America/Denver' })}`,
          flags: ['dl_verify_imported'],
        }),
      });
      if (resp?.id) {
        addToast(`Person record #${resp.id} created from verification`, 'success');
      }
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Failed to create person record', 'error');
    }
  }, [verifyResult, addToast]);

  const handleSearch = useCallback(async () => {
    if (!lastName.trim() && !dlNumber.trim()) return;
    setLoading(true);
    setHasSearched(true);
    setSelected(null);
    setFetchError('');
    try {
      // Search the local DL records store (the live, owned data layer).
      // External DMV providers (MicroBilt/RapidAPI) are not configured —
      // results reflect records this department has captured or scanned.
      const term = (dlNumber.trim() || lastName.trim() || firstName.trim());
      const data = await apiFetch<{ data: DlSubject[]; total: number }>(
        `/dl-records?search=${encodeURIComponent(term)}&per_page=200`,
      );
      let rows = Array.isArray(data?.data) ? data.data : [];
      // Client-side refine across the supplied fields.
      const f = firstName.trim().toLowerCase(), l = lastName.trim().toLowerCase(), st = state, d = dob.trim();
      rows = rows.filter(r =>
        (!f || (r.first_name || '').toLowerCase().includes(f)) &&
        (!l || (r.last_name || '').toLowerCase().includes(l)) &&
        (!st || r.dl_state === st) &&
        (!d || String(r.date_of_birth || '').slice(0, 10) === d));
      setResults(rows);
      setSource('LOCAL');
      if (rows.length === 0 && fromDeepLinkRef.current) {
        addToast('No DL records found for the linked query', 'warning');
      }
      fromDeepLinkRef.current = false;
    } catch (err) {
      console.error('DL search error:', err);
      setFetchError(err instanceof Error ? err instanceof Error ? err.message : 'Unknown error' : 'Failed to load data');
      addToast('Failed to search driver\'s license records', 'error');
      setResults([]);
      setSource('ERROR');
      fromDeepLinkRef.current = false;
    } finally {
      setLoading(false);
    }
  }, [firstName, lastName, dlNumber, state, dob, addToast]);

  // Apply pending deep-link once handleSearch is stable. One-shot — clears
  // the ref after first run so subsequent input edits don't get clobbered.
  useEffect(() => {
    const pending = pendingDeepLinkRef.current;
    if (!pending) return;
    pendingDeepLinkRef.current = null;
    // Strip the query so a refresh doesn't re-apply.
    const next = new URLSearchParams(searchParams);
    ['dl', 'dl_number', 'state', 'last', 'first', 'dob', 'person_id'].forEach((k) => next.delete(k));
    setSearchParams(next, { replace: true });
    // ?person_id= — navigate directly to the person record without running a search.
    if (pending.person_id) {
      navigate(`/records?tab=persons&personId=${pending.person_id}`);
      return;
    }
    if (pending.dl) setDlNumber(pending.dl);
    if (pending.state) setState(pending.state);
    if (pending.last) setLastName(pending.last);
    if (pending.first) setFirstName(pending.first);
    if (pending.dob) setDob(pending.dob);
    // Auto-run the search next tick once state has flushed.
    fromDeepLinkRef.current = true;
    setTimeout(() => { handleSearch(); }, 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handleSearch]);

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
      const { parseAamva, looksLikeAamva, describeAamva, assessAamva, formatLawEnforcement, formatLeBlock, describeRestrictions, describeEndorsements, describeClass } = await importWithRetry(() => import('../utils/aamvaParser'));
      if (!looksLikeAamva(rawText)) return false;
      const parsed = parseAamva(rawText);
      setScanReadout(describeAamva(parsed));
      setScanAlerts(assessAamva(parsed));
      setLeFields(formatLawEnforcement(parsed));
      setLeBlock(formatLeBlock(parsed));
      // Derived DL intelligence via the shared dlFunctions library — the same
      // evaluateDl() bridge call the iOS app uses, so phone + desktop produce
      // identical analysis from one parse.
      try {
        const { evaluateDl } = await importWithRetry(() => import('../utils/dlFunctions'));
        setScanEval(evaluateDl(parsed));
      } catch { setScanEval(null); }
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
          // Coded DL fields → plain English for the stored record + preview
          // (raw codes are still preserved in raw_record on the server).
          dl_class: describeClass(parsed.dl_class),
          dl_expiry: parsed.dl_expiry,
          dl_issue_date: parsed.dl_issue_date,
          dl_restrictions: describeRestrictions(parsed.dl_restrictions),
          dl_endorsements: describeEndorsements(parsed.dl_endorsements),
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
      // Pull any existing record for this subject (async — modal shows progress).
      // Pass the normalised record (plain-English coded fields, full field set)
      // so the system-of-record scan-log persists the same shape the phone-relay
      // fallback does — one canonical scan payload, not the raw AAMVA result.
      lookupExistingRecords(resultObj);
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
    setLeFields(null); setScanEval(null);
    setLeBlock('');
    setShowFullReadout(false);
    setUploadedRecord(null);

    // ── Pass 1: PDF417 barcode (back of card) ──
    // The AAMVA barcode is authoritative — every field exactly as the
    // issuing DMV encoded it. Only fall back to OCR (front of card)
    // when no barcode is found in the image.
    try {
      const { decodePdf417 } = await importWithRetry(() => import('../utils/pdf417Decoder'));
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
        addToast(data.error || 'OCR could not read this photo — try the BACK barcode instead', 'warning');
      }
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'DL scan failed', 'error');
    } finally {
      setOcrLoading(false);
    }
  }, [addToast, lookupExistingRecords, isMobile, pushScanToDesktop, processBarcodeText]);

  // One-shot create/link: Person + Vehicle (by plate) + Property (license
  // address) via POST /records/from-dl-scan — dedupes server-side.
  const [linkPlate, setLinkPlate] = useState('');
  const handleCreateLinkedFromOcr = useCallback(async () => {
    if (!ocrResult) return;
    try {
      const resp = await apiFetch<any>('/records/from-dl-scan', {
        method: 'POST',
        body: JSON.stringify({
          scan: ocrResult,
          vehicle: linkPlate.trim() ? { plate_number: linkPlate.trim().toUpperCase() } : undefined,
        }),
      });
      const bits: string[] = [];
      if (resp?.person) bits.push(`Person #${resp.person.id} ${resp.person_created ? 'created' : 'linked (existing)'}`);
      if (resp?.vehicle) bits.push(`Vehicle #${resp.vehicle.id} ${resp.vehicle_created ? 'created' : 'linked'}`);
      if (resp?.property) bits.push(`Property #${resp.property.id} ${resp.property_created ? 'created' : 'linked'}`);
      addToast(bits.length ? bits.join(' · ') : 'No records created', 'success');
      if (resp?.person?.id) setUploadedRecord(resp.person.id);
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Create & link failed', 'error');
    }
  }, [ocrResult, linkPlate, addToast]);

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
          notes: `Created from DL OCR scan on ${new Date().toLocaleDateString('en-US', { timeZone: 'America/Denver' })}`,
          flags: ['dl_ocr_imported'],
        }),
      });

      if (resp?.id) {
        addToast(`Person record #${resp.id} created for ${ocrResult.first_name} ${ocrResult.last_name}`, 'success');
        setUploadedRecord(resp.id);
        // File the captured front + back ID images under the new record.
        fileCardImagesTo(resp.id);
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
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Failed to create person record', 'error');
    }
  }, [ocrResult, addToast, fileCardImagesTo]);

  const sourceBadge = (_src: string) => (
    <span className="text-[8px] font-bold uppercase px-1 py-0.5 bg-surface-sunken/50 text-rmpg-400 border border-border-default/50 inline-flex items-center gap-0.5"><Database className="w-2.5 h-2.5" />LOCAL</span>
  );

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
      return isNaN(dt.getTime()) ? d : dt.toLocaleDateString('en-US', { timeZone: 'America/Denver' });
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
      <input id="ff-dlsearchpage-0" ref={firstFieldRef} className="input-dark text-[10px] w-28 min-h-[36px]" placeholder="Last Name" value={lastName}
        onChange={(e) => setLastName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleSearch()} />
      <input id="ff-dlsearchpage-1" className="input-dark text-[10px] w-28 min-h-[36px]" placeholder="First Name" value={firstName}
        onChange={(e) => setFirstName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleSearch()} />
      <input id="ff-dlsearchpage-2" className="input-dark text-[10px] w-28 min-h-[36px]" placeholder="DL Number" value={dlNumber}
        onChange={(e) => setDlNumber(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleSearch()} />
      <select id="ff-dlsearchpage-3" className="select-dark text-[10px] w-20 min-h-[36px]" value={state} onChange={(e) => setState(e.target.value)}>
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
      <button type="button" onClick={() => { setShowScanHistory(true); loadScanHistory(scanHistoryMine); }} className="toolbar-btn text-[10px]">
        <History className="w-3 h-3" /> History
      </button>
      {canManageSources && (
        <button type="button" onClick={() => { setShowSources(true); loadSources(); }} className="toolbar-btn text-[10px]">
          <Database className="w-3 h-3" /> Sources
        </button>
      )}
    </div>
  );

  // Set document title
  useEffect(() => { document.title = 'DL Search \u2014 RMPG Flex'; }, []);

  // \u2500\u2500 N shortcut \u2014 focus the first search field \u2500\u2500
  // \u2500\u2500 Esc cascade \u2014 clear results \u2192 deselect \u2192 close scanner preview \u2500\u2500
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      // N \u2014 focus search when not already in an input/textarea/select
      if (e.key === 'n' || e.key === 'N') {
        const tag = (e.target as HTMLElement)?.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
        e.preventDefault();
        firstFieldRef.current?.focus();
        return;
      }
      // Esc cascade: scanner modal \u2192 scan history \u2192 sources \u2192 detail panel \u2192 results
      if (e.key === 'Escape') {
        if (showOcrPreview) { e.stopPropagation(); setShowOcrPreview(false); return; }
        if (showScanHistory) { e.stopPropagation(); setShowScanHistory(false); return; }
        if (showSources) { e.stopPropagation(); setShowSources(false); return; }
        if (showManualEntry) { e.stopPropagation(); setShowManualEntry(false); return; }
        if (showLiveScanner) { e.stopPropagation(); setShowLiveScanner(false); return; }
        if (selected) { e.stopPropagation(); setSelected(null); return; }
        if (results.length > 0) {
          e.stopPropagation();
          setResults([]);
          setHasSearched(false);
          setFetchError('');
          setSource('');
          return;
        }
      }
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, [showOcrPreview, showScanHistory, showSources, showManualEntry, showLiveScanner, selected, results.length]);

  return (
    <div className="h-full flex flex-col bg-surface-base text-rmpg-100 overflow-hidden">
      {/* Hidden file input for DL OCR — always in DOM so toolbar button works */}
      <input id="ff-dlsearchpage-5"
        ref={fileInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={e => {
          const file = e.target.files?.[0];
          if (file) {
            // Manual upload: no guided card capture → clear any stale images
            // so a prior scan's front/back can't attach to this subject.
            setCardImages({ front: null, back: null });
            setCardSavedTo(null);
            handleOcrUpload(file);
          }
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
        <div className="flex flex-col gap-1.5 px-3 py-2 flex-shrink-0 bg-surface-deep border-b border-rmpg-700">
          <div className="flex items-center gap-1.5">
            <input id="ff-dlsearchpage-6" className="input-dark text-[10px] flex-1 min-h-[36px]" placeholder="Last Name" value={lastName}
              onChange={(e) => setLastName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleSearch()} />
            <input id="ff-dlsearchpage-7" className="input-dark text-[10px] flex-1 min-h-[36px]" placeholder="First Name" value={firstName}
              onChange={(e) => setFirstName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleSearch()} />
          </div>
          <div className="flex items-center gap-1.5">
            <input id="ff-dlsearchpage-8" className="input-dark text-[10px] flex-1 min-h-[36px]" placeholder="DL Number" value={dlNumber}
              onChange={(e) => setDlNumber(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleSearch()} />
            <select id="ff-dlsearchpage-9" className="select-dark text-[10px] w-20 min-h-[36px]" value={state} onChange={(e) => setState(e.target.value)}>
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
          {results.length === 0 && !loading && hasSearched && (
            <div className="flex flex-col items-center justify-center h-full text-rmpg-500 text-[10px] p-4 gap-3">
              <Search className="w-8 h-8 text-rmpg-600" />
              <p className="font-semibold text-rmpg-400">No records found</p>
              <p className="text-[9px] text-rmpg-600 text-center">No DL records match your search. Try a different name, DL number, or state.</p>
            </div>
          )}
          {results.length === 0 && !loading && !hasSearched && (
            <div className="flex flex-col items-center justify-center h-full text-rmpg-500 text-[10px] p-4 gap-4">
              <div className="text-center">
                <CreditCard className="w-8 h-8 mx-auto mb-2 text-rmpg-600" />
                <p>Search by name, DL number, or state</p>
                <p className="text-[9px] text-rmpg-600 mt-1">Searches the department's local DL records</p>
              </div>
              {/* ── Driver's License Scanner ── */}
              <div className="border border-rmpg-700 rounded-sm bg-surface-sunken w-full max-w-sm">
                <div className="flex items-center gap-2 px-3 py-2 border-b border-border-subtle bg-surface-deep">
                  <ScanLine size={14} className="text-brand-gold-500" />
                  <span className="text-[10px] font-bold text-brand-gold-500 uppercase tracking-widest">Driver's License Scanner</span>
                </div>
                <div className="p-3 space-y-3">
                  <div className="border border-dashed border-rmpg-700 rounded-sm py-5 flex flex-col items-center gap-2 bg-surface-deep">
                    <CreditCard size={28} className="text-rmpg-700" />
                    <button
                      type="button"
                      onClick={() => setShowLiveScanner(true)}
                      disabled={ocrLoading}
                      className="flex items-center gap-2 px-5 py-2.5 bg-brand-gold-500 hover:bg-brand-gold-700 disabled:opacity-40 rounded-sm text-[12px] font-bold text-black transition-colors uppercase tracking-wider"
                    >
                      {ocrLoading ? <Loader2 size={15} className="animate-spin" /> : <ScanLine size={15} />}
                      {ocrLoading ? 'Reading Barcode...' : 'Scan License'}
                    </button>
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={ocrLoading}
                      className="flex items-center gap-1.5 text-[9px] text-rmpg-400 hover:text-rmpg-100"
                    >
                      <Upload size={11} /> or upload a photo
                    </button>
                    <span className="text-[9px] text-rmpg-500">Live camera — reads automatically, no shutter</span>
                  </div>

                  {recentScans.length > 0 && (
                    <div className="border border-border-subtle rounded-sm bg-surface-deep">
                      <div className="px-2 py-1 text-[8px] font-bold text-rmpg-500 uppercase tracking-wider border-b border-border-subtle">Recent Scans</div>
                      <div className="max-h-32 overflow-y-auto">
                        {recentScans.map((s: any) => (
                          <button
                            key={`${s.dl_number}-${s.ts}`}
                            type="button"
                            onClick={() => {
                              if (s.aamva_raw) { processBarcodeText(s.aamva_raw, { silent: true, skipRelay: true }); }
                            }}
                            className="w-full flex items-center justify-between gap-2 px-2 py-1 text-left hover:bg-surface-raised border-b border-border-subtle"
                          >
                            <span className="text-[10px] text-rmpg-300 truncate">{s.name || 'UNKNOWN'}</span>
                            <span className="text-[8px] font-mono text-rmpg-500 flex-shrink-0">{s.dl_state} {s.dl_number} · {new Date(s.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}{/* new-date-ok: s.ts is an epoch-ms number (Date.now()), not a server string */}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                  <div className="space-y-1 text-[9px] text-rmpg-500 leading-relaxed">
                    <p><span className="text-rmpg-300 font-semibold">→ Scan the BACK of the card</span> — the PDF417 barcode gives an exact, DMV-encoded read of every field (full English readout).</p>
                    <p>→ Existing person records are <span className="text-rmpg-300 font-semibold">pulled automatically</span> on a DL-number or name+DOB match.</p>
                    <p>→ No record? <span className="text-rmpg-300 font-semibold">Upload to Records</span> creates the person + DL record in one tap.</p>
                    <p>→ Front-of-card photos fall back to OCR extraction.</p>
                  </div>
                  {!isMobile && (
                    <div className="flex items-center gap-3 border-t border-border-subtle pt-3">
                      {/* theme-ok: QR requires white bg */}
                    <div className="bg-white p-1 rounded-sm flex-shrink-0">
                        <PhoneScanQr />
                      </div>
                      <div className="text-[9px] text-rmpg-500 leading-relaxed">
                        <p className="text-[10px] font-bold text-rmpg-300 uppercase tracking-wider mb-0.5">Use your phone as the scanner</p>
                        <p>Scan this QR with your phone, sign in, and scan the license there — the results <span className="text-rmpg-300 font-semibold">appear on this screen automatically</span> (same login, within seconds).</p>
                      </div>
                    </div>
                  )}
                </div>
              </div>
              {/* DL OCR Scanner */}
              <div className="border border-rmpg-900 rounded-sm p-3 bg-surface-deep space-y-2 w-full max-w-xs">
                <div className="flex items-center gap-2">
                  <CreditCard size={14} className="[color:var(--panel-header-color)]" />
                  <span className="text-[10px] font-bold text-accent-silver-300 uppercase tracking-wider">Scan Driver's License</span>
                </div>
                <p className="text-[10px] text-fg-muted">Upload a photo of a driver's license to auto-extract all fields and create a person record.</p>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={ocrLoading}
                    className="flex items-center gap-2 px-3 py-2 bg-rmpg-600 hover:bg-brand-700 disabled:opacity-40 rounded-sm text-[11px] font-bold text-white transition-colors"
                  >
                    {ocrLoading ? <Loader2 size={14} className="animate-spin" /> : <Camera size={14} />}
                    {ocrLoading ? 'Scanning...' : 'Upload DL Photo'}
                  </button>
                  <span className="text-[9px] text-fg-muted">JPG, PNG, or camera capture</span>
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
                <span className="text-[11px] font-bold text-rmpg-100">
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
                  className="text-rmpg-400 hover:text-rmpg-100 text-[10px] font-bold uppercase tracking-wider flex items-center gap-1">
                  <ChevronRight className="w-3 h-3 rotate-180" /> Back to Results
                </button>
              )}

              {/* DL Card */}
              <div className="panel-surface p-4">
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <h2 className={`${isMobile ? 'text-base' : 'text-lg'} font-black text-rmpg-100`}>
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
                    <p className="text-[11px] font-bold text-rmpg-100">{selected.dl_class || '—'}</p>
                  </div>
                  <div>
                    <span className="field-label">Status</span>
                    <p className="text-[11px] font-bold text-rmpg-100">{selected.dl_status || '—'}</p>
                  </div>
                  <div>
                    <span className="field-label">Expiration</span>
                    <p className="text-[11px] font-bold text-rmpg-100">{formatDate(selected.dl_expiration)}</p>
                  </div>
                  <div>
                    <span className="field-label">Issue Date</span>
                    <p className="text-[11px] font-bold text-rmpg-100">{formatDate(selected.dl_issue_date)}</p>
                  </div>
                  {selected.dl_restrictions && (
                    <div className="col-span-2">
                      <span className="field-label">Restrictions</span>
                      <p className="text-[11px] font-bold text-rmpg-100">{selected.dl_restrictions}</p>
                    </div>
                  )}
                  {selected.dl_endorsements && (
                    <div className="col-span-2">
                      <span className="field-label">Endorsements</span>
                      <p className="text-[11px] font-bold text-rmpg-100">{selected.dl_endorsements}</p>
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
                    <p className="text-[11px] font-bold text-rmpg-100 flex items-center gap-1">
                      <Calendar className="w-3 h-3 text-rmpg-400" /> {formatDate(selected.date_of_birth)}
                    </p>
                  </div>
                  <div>
                    <span className="field-label">Gender</span>
                    <p className="text-[11px] font-bold text-rmpg-100">{selected.gender || '—'}</p>
                  </div>
                  <div>
                    <span className="field-label">Height</span>
                    <p className="text-[11px] font-bold text-rmpg-100">{selected.height || '—'}</p>
                  </div>
                  <div>
                    <span className="field-label">Weight</span>
                    <p className="text-[11px] font-bold text-rmpg-100">{selected.weight || '—'}</p>
                  </div>
                  <div>
                    <span className="field-label">Eye Color</span>
                    <p className="text-[11px] font-bold text-rmpg-100">{selected.eye_color || '—'}</p>
                  </div>
                  <div>
                    <span className="field-label">Hair Color</span>
                    <p className="text-[11px] font-bold text-rmpg-100">{selected.hair_color || '—'}</p>
                  </div>
                  <div>
                    <span className="field-label">Race</span>
                    <p className="text-[11px] font-bold text-rmpg-100">{selected.race || '—'}</p>
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
                        <p className="text-[11px] text-rmpg-100 font-bold">{addr.address || '—'}</p>
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

      {showSources && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
          <div className="bg-surface-raised border border-border-subtle rounded-sm max-w-lg w-full max-h-[88vh] overflow-y-auto">
            <div className="flex items-center justify-between px-4 py-3 border-b border-border-subtle bg-surface-sunken">
              <div className="flex items-center gap-2">
                <Database size={14} className="text-brand-gold-500" />
                <span className="text-[12px] font-bold text-rmpg-100 uppercase tracking-wider">Data Sources</span>
                <span className="text-[8px] text-rmpg-500 uppercase">admin</span>
              </div>
              <button type="button" onClick={() => setShowSources(false)} className="text-rmpg-500 hover:text-rmpg-100"><X size={16} /></button>
            </div>
            <div className="p-4 space-y-4">
              {/* Utah SOR feed */}
              <div className="border border-border-subtle rounded-sm bg-surface-sunken">
                <div className="px-3 py-1.5 border-b border-border-subtle flex items-center justify-between">
                  <span className="text-[10px] font-bold text-rmpg-300 uppercase tracking-wider">Utah Sex Offender Registry Feed</span>
                  <span className="text-[8px] text-rmpg-500">{sourcesCfg?.sor_records ?? 0} records</span>
                </div>
                <div className="p-3 space-y-2">
                  <p className="text-[9px] text-rmpg-500 leading-relaxed">Agency-authorized feed (OffenderWatch LE API / Utah BCI). Leave blank if you don't have one — never scrape the public site.</p>
                  <div>
                    <label className="text-[8px] text-rmpg-500 uppercase font-mono">Feed URL (HTTPS)</label>
                    <input className="input-dark text-[10px] w-full min-h-[32px] mt-0.5" placeholder="https://..." value={sorUrl} onChange={e => setSorUrl(e.target.value)} />
                  </div>
                  <div>
                    <label className="text-[8px] text-rmpg-500 uppercase font-mono">API Key {sourcesCfg?.sor_feed_key_set && <span className="text-[var(--sev-ok-soft)]">· set ({sourcesCfg.sor_feed_key_mask})</span>}</label>
                    <input className="input-dark text-[10px] w-full min-h-[32px] mt-0.5" type="password" placeholder={sourcesCfg?.sor_feed_key_set ? 'leave blank to keep current' : 'bearer token'} value={sorKey} onChange={e => setSorKey(e.target.value)} />
                  </div>
                  {sourcesCfg?.sor_last_run && (
                    <p className="text-[8px] text-rmpg-500">Last poll: {sourcesCfg.sor_last_run.status} · {sourcesCfg.sor_last_run.records_upserted} upserted · {parseTimestamp(sourcesCfg.sor_last_run.ran_at).toLocaleString('en-US', { timeZone: 'America/Denver' })}</p>
                  )}
                  <button type="button" onClick={runSorPoll} className="px-2.5 py-1 bg-surface-raised border border-rmpg-700 rounded-sm text-[9px] font-bold text-rmpg-300 hover:text-rmpg-100">Run poll now</button>

                  {/* Bulk import — for agencies with no live feed: paste the
                      data you lawfully hold (BCI export, OffenderWatch dump). */}
                  <div className="pt-2 mt-1 border-t border-border-subtle space-y-1.5">
                    <label className="text-[8px] text-rmpg-500 uppercase font-mono">Bulk import (JSON array or CSV with header row)</label>
                    <textarea
                      className="input-dark text-[9px] w-full font-mono leading-snug"
                      rows={4}
                      placeholder='[{"last_name":"Doe","first_name":"John","date_of_birth":"1980-01-01","offense":"...","risk_level":"2"}]  — or CSV: last_name,first_name,dob,offense,...'
                      value={sorImportText}
                      onChange={e => setSorImportText(e.target.value)}
                    />
                    <button
                      type="button"
                      onClick={() => setConfirmSorImport(true)}
                      disabled={sorImporting || !sorImportText.trim()}
                      className="px-2.5 py-1 bg-surface-raised border border-rmpg-700 rounded-sm text-[9px] font-bold text-rmpg-300 hover:text-rmpg-100 disabled:opacity-40"
                    >{sorImporting ? 'Importing…' : 'Import records'}</button>
                  </div>
                </div>
              </div>

              {/* CourtListener */}
              <div className="border border-border-subtle rounded-sm bg-surface-sunken">
                <div className="px-3 py-1.5 border-b border-border-subtle flex items-center justify-between">
                  <span className="text-[10px] font-bold text-rmpg-300 uppercase tracking-wider">CourtListener / PACER</span>
                  <span className="text-[8px] text-rmpg-500">{sourcesCfg?.court_cache ?? 0} cached</span>
                </div>
                <div className="p-3 space-y-2">
                  <p className="text-[9px] text-rmpg-500 leading-relaxed">Optional token raises the rate limit — federal court lookups work anonymously without one. Get a free token at courtlistener.com.</p>
                  <div>
                    <label className="text-[8px] text-rmpg-500 uppercase font-mono">API Token {sourcesCfg?.courtlistener_token_set && <span className="text-[var(--sev-ok-soft)]">· set ({sourcesCfg.courtlistener_token_mask})</span>}</label>
                    <input className="input-dark text-[10px] w-full min-h-[32px] mt-0.5" type="password" placeholder={sourcesCfg?.courtlistener_token_set ? 'leave blank to keep current' : 'optional token'} value={clToken} onChange={e => setClToken(e.target.value)} />
                  </div>
                </div>
              </div>

              <p className="text-[8px] text-rmpg-500 leading-relaxed">DMV/MVR (MicroBilt) and RapidAPI DL require a licensed broker contract and are configured separately under Admin → Integrations. Utah UCJIS/BCI requires a credentialed terminal connection.</p>
            </div>
            <div className="flex items-center gap-2 px-4 py-3 border-t border-border-subtle bg-surface-sunken">
              <button type="button" onClick={saveSources} disabled={sourcesSaving} className="flex items-center gap-2 px-4 py-2 bg-brand-gold-500 hover:bg-brand-gold-700 disabled:opacity-40 rounded-sm text-[11px] font-bold text-black">
                {sourcesSaving ? <Loader2 size={13} className="animate-spin" /> : null} Save
              </button>
              <button type="button" onClick={() => setShowSources(false)} className="px-4 py-2 bg-surface-raised hover:bg-surface-overlay border border-border-subtle rounded-sm text-[11px] text-rmpg-400 hover:text-rmpg-100">Close</button>
            </div>
          </div>
        </div>
      )}

      {showScanHistory && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
          <div className="bg-surface-raised border border-border-subtle rounded-sm max-w-2xl w-full max-h-[88vh] flex flex-col">
            <div className="flex items-center justify-between px-4 py-3 border-b border-border-subtle bg-surface-sunken">
              <div className="flex items-center gap-2">
                <History size={14} className="text-brand-gold-500" />
                <span className="text-[12px] font-bold text-rmpg-100 uppercase tracking-wider">Scan History</span>
                <span className="text-[8px] text-rmpg-500 uppercase">audit log</span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => { const n = !scanHistoryMine; setScanHistoryMine(n); loadScanHistory(n); }}
                  className={`px-2 py-1 rounded-sm text-[9px] font-bold border ${scanHistoryMine ? 'bg-brand-gold-500 text-black border-brand-gold-500' : 'bg-surface-raised text-rmpg-300 border-rmpg-700 hover:text-rmpg-100'}`}
                >
                  {scanHistoryMine ? 'My Scans' : 'All Scans'}
                </button>
                <button type="button" onClick={() => setShowScanHistory(false)} className="text-rmpg-500 hover:text-rmpg-100"><X size={16} /></button>
              </div>
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto">
              {scanHistoryLoading ? (
                <div className="flex items-center justify-center py-10 text-[11px] text-rmpg-400 gap-2"><Loader2 size={14} className="animate-spin" /> Loading...</div>
              ) : !scanHistory || scanHistory.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-10 text-[11px] text-rmpg-500 gap-2">
                  <History size={22} className="text-rmpg-700" />
                  No scans logged yet — every ID scan will appear here.
                </div>
              ) : (
                <div className="overflow-x-auto"><table className="w-full text-left">
                  <thead className="sticky top-0 bg-surface-sunken">
                    <tr className="text-[8px] text-rmpg-500 uppercase font-semibold">
                      <th className="px-3 py-[3px]">When</th>
                      <th className="px-3 py-[3px]">Subject</th>
                      <th className="px-3 py-[3px]">License</th>
                      <th className="px-3 py-[3px]">Officer</th>
                      <th className="px-3 py-[3px]">Findings</th>
                    </tr>
                  </thead>
                  <tbody>
                    {scanHistory.map((s) => {
                      const f = s.findings || {};
                      const dangerSrcs = Array.isArray(f.sources) ? f.sources.filter((x: any) => x.danger) : [];
                      const pf = f.profile_flags || {};
                      const flagged = !!(pf.sex_offender || pf.watchlist || pf.supervision) || dangerSrcs.length > 0;
                      return (
                        <tr key={s.id} className={`border-t border-border-subtle text-[10px] ${flagged ? 'bg-red-900/10' : ''}`}>
                          <td className="px-3 py-[3px] text-rmpg-400 whitespace-nowrap">{parseTimestamp(s.scanned_at).toLocaleString('en-US', { timeZone: 'America/Denver', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</td>
                          <td className="px-3 py-[3px] text-rmpg-100">
                            {s.person_id
                              ? <button type="button" className="hover:text-brand-gold-500 hover:underline" onClick={() => { setShowScanHistory(false); navigate(`/records?tab=persons&personId=${s.person_id}`); }}>{s.subject_name || 'unknown'}</button>
                              : (s.subject_name || 'unknown')}
                          </td>
                          <td className="px-3 py-[3px] text-rmpg-400 font-mono">{s.dl_number ? `${s.dl_number} ${s.dl_state || ''}` : '—'}</td>
                          <td className="px-3 py-[3px] text-rmpg-400">{s.officer}</td>
                          <td className="px-3 py-[3px]">
                            {flagged ? (
                              <span className="text-[8px] font-bold uppercase px-1 py-px bg-red-900/50 text-red-300 border border-red-600/70 inline-flex items-center gap-1">
                                <AlertTriangle size={9} /> {[pf.sex_offender && 'SOR', pf.watchlist && 'WATCH', pf.supervision && 'SUPV', ...dangerSrcs.map((x: any) => x.key?.toUpperCase())].filter(Boolean).slice(0, 3).join(' ')}
                              </span>
                            ) : (
                              <span className="text-[8px] text-rmpg-500 uppercase">{typeof f.sweep_total === 'number' ? `${f.sweep_total} hits` : 'clear'}</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table></div>
              )}
            </div>
          </div>
        </div>
      )}

      {showLiveScanner && (
        <LiveDlScanner
          onComplete={async ({ barcodeText, frontImage, backImage }) => {
            // Retain both card images for filing under the person record.
            setCardImages({ front: frontImage, back: backImage });
            setCardSavedTo(null);
            if (barcodeText) {
              const ok = await processBarcodeText(barcodeText);
              if (!ok) addToast('Barcode read but not a driver license payload', 'warning');
            } else if (frontImage || backImage) {
              // Try re-decoding the back image still with the thorough
              // decoder (tryHarder + multi-scale + contrast boost) before
              // falling back to OCR on the front image.
              if (backImage) {
                try {
                  const { decodePdf417 } = await importWithRetry(() => import('../utils/pdf417Decoder'));
                  const decoded = await decodePdf417(new File([backImage], 'id-back.jpg', { type: 'image/jpeg' }));
                  if (decoded && await processBarcodeText(decoded.text)) {
                    setShowLiveScanner(false);
                    return;
                  }
                } catch { /* fall through to OCR */ }
              }
              // Fall back to OCR on the captured front image.
              if (frontImage) {
                await handleOcrUpload(new File([frontImage], 'id-front.jpg', { type: 'image/jpeg' }));
              } else {
                addToast('Captured images — no barcode read; review and upload', 'warning');
              }
            }
            setShowLiveScanner(false);
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

      {/* DL Scanner Results Modal */}
      {showOcrPreview && ocrResult && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
          <div className="bg-surface-raised border border-border-subtle rounded-sm max-w-xl w-full max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between px-4 py-3 border-b border-border-subtle bg-surface-sunken">
              <div className="flex items-center gap-2">
                <ScanLine size={14} className="text-brand-gold-500" />
                <span className="text-[12px] font-bold text-rmpg-100 uppercase tracking-wider">
                  {scanReadout ? 'DL Scanner — PDF417 Read' : 'DL Scanner — OCR Read'}
                </span>
                {scanReadout && (
                  <span className="text-[8px] font-bold uppercase px-1 py-0.5 bg-green-900/50 text-green-400 border border-green-700/50">DMV-Encoded</span>
                )}
              </div>
              <button type="button" onClick={() => setShowOcrPreview(false)} className="text-rmpg-500 hover:text-rmpg-100">
                <X size={16} />
              </button>
            </div>
            <div className="p-4 space-y-3">
              {/* ── Officer-safety + status alerts ── */}
              {(scanMatches?.some((m: any) => m.active_warrants > 0) || scanAlerts.length > 0 || deepSweep?.sources.some((s: any) => s.danger) || (deepSweep as any)?.profile?.person || (fbiRecords && fbiRecords.length > 0)) && (
                <div className="space-y-1">
                  {fbiRecords?.filter((r: any) => r.is_danger).map((r: any, i: number) => (
                    <div key={`fbi-${i}`} className="flex items-center gap-2 px-3 py-2 bg-red-900/40 border border-red-600/70 text-red-300 text-[11px] font-bold uppercase tracking-wide">
                      <AlertTriangle size={14} className="flex-shrink-0 text-red-400" />
                      ⚠ FBI WANTED — {r.title}{r.warning ? ` · ${r.warning}` : ''} (verify identity)
                    </div>
                  ))}
                  {(() => {
                    const p = (deepSweep as any)?.profile?.person;
                    if (!p) return null;
                    const real = (v: any) => { const s = String(v ?? '').trim(); return s && !/^(none|n\/a|na|no|0|\[\]|unknown)$/i.test(s) ? s : ''; };
                    const msgs: string[] = [];
                    if (p.is_sex_offender === 1 || p.is_sex_offender === true || real(p.sor_number)) msgs.push('REGISTERED SEX OFFENDER');
                    if (real(p.watchlist_match)) msgs.push(`WATCHLIST MATCH: ${p.watchlist_match}`);
                    if (real(p.probation_parole)) msgs.push(`ON SUPERVISION: ${p.probation_parole}`);
                    return msgs.map(m => (
                      <div key={m} className="flex items-center gap-2 px-3 py-2 bg-red-900/40 border border-red-600/70 text-red-300 text-[11px] font-bold uppercase tracking-wide">
                        <AlertTriangle size={14} className="flex-shrink-0 text-red-400" /> ⚠ {m} — {p.last_name}, {p.first_name} (#{p.id})
                      </div>
                    ));
                  })()}
                  {deepSweep?.sources.filter((s: any) => s.danger).map((s: any) => (
                    <div key={`ds-${s.key}`} className="flex items-center gap-2 px-3 py-2 bg-red-900/40 border border-red-600/70 text-red-300 text-[11px] font-bold uppercase tracking-wide">
                      <AlertTriangle size={14} className="flex-shrink-0 text-red-400" />
                      ⚠ {s.label.toUpperCase()} HIT — {s.rows.filter((r: any) => r.danger).length || s.rows.length} record{s.rows.length > 1 ? 's' : ''} (see sweep below)
                    </div>
                  ))}
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
                        : 'bg-surface-raised border-rmpg-700 text-rmpg-400'
                      }`}
                    >
                      <AlertTriangle size={12} className="flex-shrink-0" />
                      {a.message}
                    </div>
                  ))}
                </div>
              )}

              {/* ── Captured ID card images ── */}
              {(cardImages.front || cardImages.back) && (
                <div className="border border-border-subtle rounded-sm bg-surface-sunken flex items-center gap-3 p-2">
                  {cardImages.front && <ImgThumb blob={cardImages.front} label="FRONT" />}
                  {cardImages.back && <ImgThumb blob={cardImages.back} label="BACK" />}
                  <span className="text-[9px] text-rmpg-400 leading-snug">
                    ID card image{cardImages.front && cardImages.back ? 's' : ''} captured —
                    {cardSavedTo ? <span className="text-[var(--sev-ok-soft)]"> filed to record #{cardSavedTo}</span> : ' will be filed to the person record on create / pull.'}
                  </span>
                </div>
              )}

              {/* ── Records-system match ── */}
              <div className="border border-border-subtle rounded-sm bg-surface-sunken">
                <div className="px-3 py-1.5 border-b border-border-subtle text-[9px] font-bold text-rmpg-400 uppercase tracking-wider flex items-center gap-1.5">
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
                        className="px-2.5 py-1 bg-green-600 hover:bg-green-500 rounded-sm text-[10px] font-bold text-rmpg-100"
                      >
                        Open Record
                      </button>
                    </div>
                  ) : matchLoading ? (
                    <div className="flex items-center gap-2 text-[10px] text-rmpg-400 px-2 py-1.5">
                      <Loader2 size={12} className="animate-spin" /> Searching records for this subject...
                    </div>
                  ) : scanMatches && scanMatches.length > 0 ? (
                    scanMatches.map((p) => (
                      <div key={p.id} className="flex items-center justify-between gap-2 px-2 py-1.5 bg-surface-raised border border-rmpg-700">
                        <div className="min-w-0">
                          <div className="text-[11px] text-rmpg-100 font-bold truncate">
                            {p.last_name}, {p.first_name} <span className="text-rmpg-500 font-normal">#{p.id}</span>
                          </div>
                          <div className="text-[8px] text-brand-gold-500 font-bold uppercase tracking-wider flex items-center gap-1.5">
                            {p.match_type}{p.dob ? ` · DOB ${String(p.dob).slice(0, 10)}` : ''}
                            {p.active_warrants > 0 && (
                              <span className="px-1 py-px bg-red-900/60 text-red-300 border border-red-600/70 font-bold">{p.active_warrants} ACTIVE WARRANT{p.active_warrants > 1 ? 'S' : ''}</span>
                            )}
                            {p.active_warrants === 0 && p.total_warrants > 0 && (
                              <span className="px-1 py-px bg-surface-raised text-rmpg-400 border border-rmpg-700">{p.total_warrants} prior warrant{p.total_warrants > 1 ? 's' : ''}</span>
                            )}
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={async () => { await fileCardImagesTo(p.id); setShowOcrPreview(false); navigate(`/records?tab=persons&personId=${p.id}`); }}
                          className="flex items-center gap-1.5 px-2.5 py-1.5 bg-brand-gold-500 hover:bg-brand-gold-700 rounded-sm text-[10px] font-bold text-black flex-shrink-0"
                          title="Open the matched record and file the captured ID images to it"
                        >
                          <UserCheck size={12} /> Pull Record
                        </button>
                      </div>
                    ))
                  ) : (
                    <div className="text-[10px] text-rmpg-400 px-2 py-1.5 flex items-center gap-1.5">
                      <AlertTriangle size={11} className="text-amber-500" /> No existing record found — upload below to create one.
                    </div>
                  )}
                </div>
              </div>

              {/* ── Deep records sweep (hard-to-find LE sources) ── */}
              {(deepSweepLoading || (deepSweep && deepSweep.total > 0)) && (
                <div className="border border-border-subtle rounded-sm bg-surface-sunken">
                  <div className="px-3 py-1.5 border-b border-border-subtle text-[9px] font-bold text-rmpg-400 uppercase tracking-wider flex items-center gap-1.5">
                    <Search size={11} /> Deep Records Sweep
                    {deepSweepLoading
                      ? <Loader2 size={10} className="animate-spin" />
                      : <span className="text-brand-gold-500">{deepSweep!.total} hit{deepSweep!.total === 1 ? '' : 's'} across {deepSweep!.sources.length} source{deepSweep!.sources.length === 1 ? '' : 's'}</span>}
                  </div>
                  {deepSweep && deepSweep.sources.map((src: any) => (
                    <div key={src.key} className="border-b border-border-subtle last:border-b-0">
                      <div className={`px-3 py-1 text-[8px] font-bold uppercase tracking-wider flex items-center gap-1.5 ${src.danger ? 'text-red-400' : 'text-rmpg-400'}`}>
                        {src.danger && <AlertTriangle size={10} />}
                        {src.label} ({src.rows.length})
                        {src.key === 'utah_sor' && (
                          <a
                            href="https://www.communitynotification.com/cap_main.php?office=54438"
                            target="_blank" rel="noopener noreferrer"
                            className="ml-auto text-[8px] font-bold text-brand-gold-500 hover:underline normal-case tracking-normal"
                          >Open official registry ↗</a>
                        )}
                      </div>
                      {src.rows.map((row: any) => (
                        <div key={`${src.key}-${row.id}`} className={`px-3 py-1 text-[10px] border-t border-border-subtle flex items-start gap-1.5 ${row.danger ? 'text-red-300 bg-red-900/10' : 'text-rmpg-300'}`}>
                          {row.image && (
                            <img src={row.image} alt="Booking photo" className="w-9 h-11 object-cover border border-rmpg-700 bg-black flex-shrink-0" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                          )}
                          <span className="flex-1 leading-snug">{row.summary}</span>
                          {row.dob_match === true && <span className="text-[7px] font-bold px-1 py-px bg-green-900/50 text-green-400 border border-green-700/50 flex-shrink-0 uppercase">DOB ✓</span>}
                          {row.dob_match === false && <span className="text-[7px] font-bold px-1 py-px bg-surface-raised text-[var(--spm-text-muted)] border border-rmpg-700 flex-shrink-0 uppercase">DOB differs</span>}
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              )}

              {/* ── Subject profile — full detail on a person match ── */}
              {(deepSweep as any)?.profile?.person && (() => {
                const prof = (deepSweep as any).profile;
                const p = prof.person;
                // Live text cols store literal "None"/"N/A"/"0" — sentinel-guard
                // before treating a value as a real flag.
                const real = (v: any) => {
                  const s = String(v ?? '').trim();
                  return s && !/^(none|n\/a|na|no|0|\[\]|unknown)$/i.test(s) ? s : '';
                };
                const chips: Array<{ label: string; danger: boolean }> = [];
                if (p.is_sex_offender === 1 || p.is_sex_offender === true || real(p.sor_number)) chips.push({ label: `SEX OFFENDER${real(p.sor_number) ? ` · SOR# ${p.sor_number}` : ''}`, danger: true });
                if (real(p.watchlist_match)) chips.push({ label: `WATCHLIST: ${p.watchlist_match}`, danger: true });
                if (real(p.gang_affiliation)) chips.push({ label: `GANG: ${p.gang_affiliation}`, danger: true });
                if (real(p.caution_flags)) chips.push({ label: `CAUTION: ${String(p.caution_flags).replace(/[[\]"]/g, '')}`, danger: true });
                if (real(p.probation_parole)) chips.push({ label: `SUPERVISION: ${p.probation_parole}${real(p.probation_parole_officer) ? ` (PO ${p.probation_parole_officer})` : ''}`, danger: true });
                if (real(p.mental_health_flags)) chips.push({ label: `MENTAL HEALTH: ${p.mental_health_flags}`, danger: false });
                if (real(p.substance_abuse)) chips.push({ label: `SUBSTANCE: ${p.substance_abuse}`, danger: false });
                if (real(p.known_associates)) chips.push({ label: `ASSOCIATES: ${String(p.known_associates).slice(0, 80)}`, danger: false });
                if (real(p.aliases) || real(p.alias_nickname)) chips.push({ label: `ALIASES: ${real(p.aliases) || p.alias_nickname}`, danger: false });
                if (real(p.ncic_number)) chips.push({ label: `NCIC# ${p.ncic_number}`, danger: false });
                if (real(p.fbi_number)) chips.push({ label: `FBI# ${p.fbi_number}`, danger: false });
                if (real(p.scars_marks_tattoos) || real(p.tattoo_description)) chips.push({ label: `SMT: ${(real(p.scars_marks_tattoos) || p.tattoo_description).slice(0, 80)}`, danger: false });
                const lists: Array<{ title: string; rows: string[] }> = [
                  { title: `Criminal History (${prof.criminal_history?.length || 0})`, rows: (prof.criminal_history || []).map((h: any) => `${h.offense_date || 'n/d'} — ${h.offense || h.record_type}${h.offense_level ? ` (${h.offense_level})` : ''}${h.disposition ? ` · ${h.disposition}` : ''}${h.agency ? ` · ${h.agency}` : ''}`) },
                  { title: `Registry Alerts (${prof.registry_alerts?.length || 0})`, rows: (prof.registry_alerts || []).map((a: any) => `${a.alert_type || 'alert'} [${a.severity || 'n/a'}] ${a.status || ''} — ${a.description || ''}${a.last_compliance_result ? ` · compliance: ${a.last_compliance_result}` : ''}`) },
                  { title: `Vehicles (${prof.vehicles?.length || 0})`, rows: (prof.vehicles || []).map((v: any) => `${v.plate_number || 'NO PLATE'} ${v.state || ''} — ${[v.year, v.color, v.make, v.model].filter(Boolean).join(' ')}${v.is_stolen ? ' · ⚠ STOLEN' : ''}`) },
                  { title: `Field Interviews (${prof.field_interviews?.length || 0})`, rows: (prof.field_interviews || []).map((f: any) => `${f.fi_number || `FI-${f.id}`} ${f.interview_date || f.date || ''} — ${f.contact_reason || ''} @ ${f.location || 'n/a'}`) },
                  { title: `Citations (${prof.citations?.length || 0})`, rows: (prof.citations || []).map((ct: any) => `#${ct.citation_number || ct.id} ${ct.citation_date || ''} — ${ct.violation_description || ct.violation || ''} · ${ct.status || ''}`) },
                  { title: `Trespass Orders (${prof.trespass_orders?.length || 0})`, rows: (prof.trespass_orders || []).map((t: any) => `${t.order_number || `TO-${t.id}`} ${t.status || ''} — ${t.property_name || t.property_address || ''}`) },
                  { title: `Incident Reports (${prof.incidents?.length || 0})`, rows: (prof.incidents || []).map((inc: any) => { const fl = [inc.weapons_involved && 'WEAPONS', inc.domestic_violence && 'DV', inc.gang_related && 'GANG', inc.dui_related && 'DUI'].filter(Boolean).join('/'); return `${inc.incident_number || `INC-${inc.id}`} ${inc.occurred_date || ''} — ${inc.incident_type || ''} (${inc.role || 'party'}) @ ${inc.location_address || 'n/a'}${fl ? ` · ⚠ ${fl}` : ''} · ${inc.disposition || inc.status || ''}`; }) },
                  { title: `CAD Call History (${prof.calls?.length || 0})`, rows: (prof.calls || []).map((cl: any) => `${cl.call_number || `CFS-${cl.id}`} ${String(cl.created_at || '').slice(0, 10)} — ${cl.call_type || ''} (${cl.role || cl.person_type || 'involved'}) @ ${cl.location_address || 'n/a'} · ${cl.status || ''}`) },
                ].filter(l => l.rows.length > 0);
                if (chips.length === 0 && lists.length === 0) return null;
                return (
                  <div className="border border-border-subtle rounded-sm bg-surface-sunken">
                    <div className="px-3 py-1.5 border-b border-border-subtle text-[9px] font-bold text-brand-gold-500 uppercase tracking-wider flex items-center gap-1.5">
                      <User size={11} /> Subject Profile — Full Detail (#{p.id} {p.last_name}, {p.first_name})
                    </div>
                    {(p.photo_url || p.photo || p.id_image_url) && (
                      <div className="p-2 flex items-start gap-2 border-b border-border-subtle">
                        {[p.photo_url || p.photo, p.id_image_url].filter(Boolean).slice(0, 2).map((src: string, i: number) => (
                          <img key={i} src={src} alt={i === 0 ? 'Subject photo' : 'ID image'} className="w-20 h-24 object-cover border border-rmpg-700 bg-black" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                        ))}
                        <span className="text-[8px] text-rmpg-500 uppercase">Photos on file</span>
                      </div>
                    )}
                    {chips.length > 0 && (
                      <div className="p-2 flex flex-wrap gap-1">
                        {chips.map((ch) => (
                          <span key={ch.label} className={`text-[8px] font-bold uppercase px-1.5 py-0.5 border ${ch.danger ? 'bg-red-900/40 text-red-300 border-red-600/70' : 'bg-surface-raised text-rmpg-300 border-rmpg-700'}`}>
                            {ch.label}
                          </span>
                        ))}
                      </div>
                    )}
                    {lists.map((l) => (
                      <div key={l.title} className="border-t border-border-subtle">
                        <div className="px-3 py-1 text-[8px] font-bold text-rmpg-400 uppercase tracking-wider">{l.title}</div>
                        {l.rows.map((r, i) => (
                          <div key={i} className="px-3 py-[3px] text-[10px] text-rmpg-300 border-t border-border-subtle leading-snug">{r}</div>
                        ))}
                      </div>
                    ))}
                  </div>
                );
              })()}

              {/* ── FBI Wanted (official public API) ── */}
              {(fbiLoading || (fbiRecords && fbiRecords.length > 0)) && (
                <div className="border border-red-700/40 rounded-sm bg-surface-sunken">
                  <div className="px-3 py-1.5 border-b border-border-subtle text-[9px] font-bold uppercase tracking-wider flex items-center gap-1.5 text-red-400">
                    <Shield size={11} /> FBI Wanted
                    {fbiLoading
                      ? <Loader2 size={10} className="animate-spin" />
                      : <span>{fbiRecords!.length} bulletin{fbiRecords!.length === 1 ? '' : 's'}</span>}
                  </div>
                  {fbiRecords && fbiRecords.length > 0 && (
                    <div className="px-3 py-1 text-[8px] text-amber-500 bg-amber-950/30 border-b border-amber-900/40">
                      ⚠ Name match against FBI bulletins — verify identity (DOB/photo) before acting.
                    </div>
                  )}
                  {fbiRecords && fbiRecords.map((r: any, i: number) => (
                    <div key={i} className="px-3 py-1.5 text-[10px] border-t border-border-subtle flex items-start gap-2 bg-red-900/10">
                      {r.image && <img src={r.image} alt="FBI bulletin" className="w-10 h-12 object-cover border border-rmpg-700 bg-black flex-shrink-0" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />}
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="text-rmpg-100 font-bold">{r.title}</span>
                          {r.warning && <span className="text-[7px] font-bold px-1 py-px bg-red-900/60 text-red-300 border border-red-600/70 uppercase">{r.warning}</span>}
                        </div>
                        <div className="text-rmpg-400 mt-0.5">{[r.subjects, r.sex, r.race, r.dob && `DOB ${r.dob}`].filter(Boolean).join(' · ')}</div>
                        {r.caution && <div className="text-[var(--spm-text-muted)] mt-0.5 leading-snug">{r.caution.slice(0, 180)}{r.caution.length > 180 ? '…' : ''}</div>}
                        {r.url && <a href={r.url} target="_blank" rel="noopener noreferrer" className="text-brand-gold-500 hover:underline">FBI bulletin ↗</a>}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* ── Open-source federal court records (CourtListener) ── */}
              {(courtLoading || (courtRecords && courtRecords.length > 0)) && (
                <div className="border border-border-subtle rounded-sm bg-surface-sunken">
                  <div className="px-3 py-1.5 border-b border-border-subtle text-[9px] font-bold text-rmpg-400 uppercase tracking-wider flex items-center gap-1.5">
                    <Database size={11} /> Federal Court Records
                    {courtLoading
                      ? <Loader2 size={10} className="animate-spin" />
                      : <span className="text-brand-gold-500">{courtRecords!.length} case{courtRecords!.length === 1 ? '' : 's'} · CourtListener/PACER</span>}
                  </div>
                  {courtRecords && courtRecords.length > 0 && (
                    <div className="px-3 py-1 text-[8px] text-amber-500 bg-amber-950/30 border-b border-amber-900/40">
                      ⚠ Name match only — verify identity (DOB/identifiers) before relying on these. Not confirmed to be this subject.
                    </div>
                  )}
                  {courtRecords && courtRecords.map((r: any, i: number) => (
                    <div key={i} className={`px-3 py-1 text-[10px] border-t border-border-subtle ${r.is_criminal ? 'bg-red-900/10' : ''}`}>
                      <div className="flex items-center gap-1.5">
                        {r.is_criminal && <span className="text-[7px] font-bold px-1 py-px bg-red-900/50 text-red-300 border border-red-600/70 uppercase">Criminal</span>}
                        <span className="text-rmpg-100 font-medium">{r.case_name}</span>
                      </div>
                      <div className="text-rmpg-400 mt-0.5 flex items-center gap-1.5 flex-wrap">
                        {[r.court, r.docket_number, r.date_filed].filter(Boolean).join(' · ')}
                        {r.url && <a href={r.url} target="_blank" rel="noopener noreferrer" className="text-brand-gold-500 hover:underline">view ↗</a>}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* ── DL Analysis (shared dlFunctions library / iOS bridge) ── */}
              {scanEval && (
                <div className="border border-border-subtle rounded-sm bg-surface-sunken">
                  <div className="px-3 py-1.5 border-b border-border-subtle text-[9px] font-bold text-rmpg-400 uppercase tracking-wider flex items-center gap-1.5">
                    <Shield size={11} /> DL Analysis
                    <span className="text-rmpg-500 normal-case tracking-normal">scan quality {scanEval.quality}%{scanEval.usable ? '' : ' · review'}</span>
                  </div>
                  <div className="p-2 flex flex-wrap gap-1">
                    <span className={`text-[8px] font-bold uppercase px-1.5 py-0.5 border ${scanEval.dlValid ? 'bg-surface-raised text-[var(--sev-ok-soft)] border-rmpg-700' : 'bg-amber-900/30 text-amber-400 border-amber-700/50'}`}>
                      DL# {scanEval.dlValid ? 'valid format' : 'format mismatch'}
                    </span>
                    {scanEval.jurisdictionName && (
                      <span className="text-[8px] font-bold uppercase px-1.5 py-0.5 border bg-surface-raised text-rmpg-300 border-rmpg-700">{scanEval.jurisdictionName} ({scanEval.country})</span>
                    )}
                    {scanEval.age !== null && (
                      <span className="text-[8px] font-bold uppercase px-1.5 py-0.5 border bg-surface-raised text-rmpg-300 border-rmpg-700">Age {scanEval.age} · {scanEval.ageBracket}</span>
                    )}
                    {scanEval.eligibility.minor && <span className="text-[8px] font-bold uppercase px-1.5 py-0.5 border bg-red-900/40 text-red-300 border-red-600/70">MINOR</span>}
                    {!scanEval.eligibility.minor && scanEval.eligibility.under21 && <span className="text-[8px] font-bold uppercase px-1.5 py-0.5 border bg-amber-900/30 text-amber-400 border-amber-700/50">UNDER 21</span>}
                    {scanEval.eligibility.drinking && <span className="text-[8px] font-bold uppercase px-1.5 py-0.5 border bg-surface-raised text-[var(--sev-ok-soft)] border-rmpg-700">21+</span>}
                    <span className={`text-[8px] font-bold uppercase px-1.5 py-0.5 border ${scanEval.expiry === 'expired' ? 'bg-red-900/40 text-red-300 border-red-600/70' : scanEval.expiry === 'expiring' ? 'bg-amber-900/30 text-amber-400 border-amber-700/50' : 'bg-surface-raised text-[var(--sev-ok-soft)] border-rmpg-700'}`}>
                      License {scanEval.expiry}
                    </span>
                    {scanEval.badges.map((b: string) => (
                      <span key={b} className="text-[8px] font-bold uppercase px-1.5 py-0.5 border bg-surface-raised text-rmpg-300 border-rmpg-700">{b}</span>
                    ))}
                  </div>
                  {(scanEval.endorsements.length > 0 || scanEval.restrictions.length > 0) && (
                    <div className="px-3 py-1 border-t border-border-subtle text-[9px] text-rmpg-400 space-y-0.5">
                      {scanEval.endorsements.length > 0 && <div><span className="text-rmpg-500 uppercase">Endorsements:</span> {scanEval.endorsements.join(', ')}</div>}
                      {scanEval.restrictions.length > 0 && <div><span className="text-rmpg-500 uppercase">Restrictions:</span> {scanEval.restrictions.join(', ')}</div>}
                    </div>
                  )}
                  {scanEval.missing.length > 0 && (
                    <div className="px-3 py-1 border-t border-border-subtle text-[9px] text-amber-400">Missing: {scanEval.missing.join(', ')}</div>
                  )}
                </div>
              )}

              {/* ── Law-enforcement format (NCIC/NLETS fielded) ── */}
              {leFields && leFields.length > 0 && (
                <div className="border border-border-subtle rounded-sm bg-surface-deep">
                  <div className="flex items-center justify-between px-3 py-1.5 border-b border-border-subtle">
                    <span className="text-[9px] font-bold text-brand-gold-500 uppercase tracking-wider flex items-center gap-1.5">
                      <Shield size={11} /> Law Enforcement Format — NCIC/NLETS
                    </span>
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => {
                          navigator.clipboard?.writeText(leBlock).then(
                            () => addToast('LE-format block copied', 'success'),
                            () => addToast('Copy failed', 'error'),
                          );
                        }}
                        className="px-2 py-1 bg-surface-raised border border-rmpg-700 rounded-sm text-[9px] font-bold text-rmpg-300 hover:text-rmpg-100"
                      >
                        Copy Block
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          const nam = leFields.find(f => f.tag === 'NAM')?.value || '';
                          setShowOcrPreview(false);
                          navigate(`/ncic?q=${encodeURIComponent(nam.split(' ')[0] || nam)}&type=xref`);
                        }}
                        className="px-2 py-1 bg-brand-gold-500 hover:bg-brand-gold-700 rounded-sm text-[9px] font-bold text-black"
                      >
                        Run NCIC QX
                      </button>
                    </div>
                  </div>
                  <div className="p-2 grid grid-cols-2 gap-x-4 gap-y-px font-mono">
                    {leFields.map((f) => (
                      <div key={f.tag} className="flex items-baseline gap-1.5 text-[10px]" title={f.label}>
                        <span className="text-[var(--sev-ok-soft)] w-9 flex-shrink-0 font-bold">{f.tag}/</span>
                        <span className="text-rmpg-200 break-all">{f.value}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="text-[9px] font-bold text-rmpg-400 uppercase tracking-wider mb-2">Extracted Information — Review Before Saving</div>
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
                  <span className="text-rmpg-500 w-28 flex-shrink-0 font-mono uppercase text-[9px]">{label}</span>
                  <span className="text-rmpg-100 font-mono">{val}</span>
                </div>
              ))}
              {!scanReadout && Object.entries(ocrResult).filter(([k, v]) => v && !['first_name','middle_name','last_name','date_of_birth','gender','height','weight','eye_color','hair_color','address','city','state','zip','dl_number','dl_state','dl_class','dl_expiry','dl_issue_date','dl_restrictions','dl_endorsements','full_name','source','raw_ocr'].includes(k)).length > 0 && (
                <div className="border-t border-border-subtle pt-2 mt-2">
                  <div className="text-[8px] text-rmpg-500 uppercase tracking-wider mb-1">Additional Fields</div>
                  {Object.entries(ocrResult).filter(([k, v]) => v && !['first_name','middle_name','last_name','date_of_birth','gender','height','weight','eye_color','hair_color','address','city','state','zip','dl_number','dl_state','dl_class','dl_expiry','dl_issue_date','dl_restrictions','dl_endorsements','full_name','source','raw_ocr'].includes(k)).map(([k, v]) => (
                    <div key={k} className="flex items-center gap-2 text-[10px]">
                      <span className="text-rmpg-500 w-28 flex-shrink-0 font-mono uppercase text-[8px]">{k}</span>
                      <span className="text-rmpg-400 font-mono">{String(v)}</span>
                    </div>
                  ))}
                </div>
              )}

              {/* ── Full English barcode readout (every AAMVA element) ── */}
              {scanReadout && (
                <div className="border border-border-subtle rounded-sm bg-surface-sunken mt-2">
                  <button
                    type="button"
                    onClick={() => setShowFullReadout(v => !v)}
                    className="w-full flex items-center justify-between px-3 py-1.5 text-[9px] font-bold text-rmpg-400 uppercase tracking-wider hover:text-rmpg-100"
                  >
                    <span className="flex items-center gap-1.5"><ScanLine size={11} /> Full Barcode Readout — {scanReadout.length} fields decoded</span>
                    <ChevronRight size={12} className={`transition-transform ${showFullReadout ? 'rotate-90' : ''}`} />
                  </button>
                  {showFullReadout && (
                    <div className="border-t border-border-subtle max-h-72 overflow-y-auto">
                      <div className="overflow-x-auto"><table className="w-full text-left">
                        <thead>
                          <tr className="text-[8px] text-rmpg-500 uppercase font-semibold">
                            <th className="px-2 py-[3px] w-10">Code</th>
                            <th className="px-2 py-[3px] w-36">Field</th>
                            <th className="px-2 py-[3px]">English</th>
                          </tr>
                        </thead>
                        <tbody>
                          {scanReadout.map((row) => (
                            <tr key={row.code} className="border-t border-border-subtle text-[10px] align-top">
                              <td className="px-2 py-[2px] font-mono text-brand-gold-500 text-[9px]">{row.code}</td>
                              <td className="px-2 py-[2px] text-rmpg-400">{row.label}</td>
                              <td className="px-2 py-[2px] text-rmpg-100">
                                {row.english}
                                {row.english !== row.value && row.value && (
                                  <span className="text-rmpg-500 font-mono text-[8px] ml-1.5">[{row.value}]</span>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table></div>
                    </div>
                  )}
                </div>
              )}
            </div>
            <div className="flex items-center gap-2 px-4 py-3 border-t border-border-subtle bg-surface-sunken">
              {!uploadedRecord && (
                <button
                  type="button"
                  onClick={handleCreatePersonFromOcr}
                  className="flex items-center gap-2 px-4 py-2 bg-green-600 hover:bg-green-500 rounded-sm text-[11px] font-bold text-rmpg-100 transition-colors"
                >
                  <Upload size={14} />
                  {scanMatches && scanMatches.length > 0 ? 'Upload as New Record' : 'Upload to Records'}
                </button>
              )}
              {!uploadedRecord && (
                <>
                  <input
                    type="text"
                    value={linkPlate}
                    onChange={(e) => setLinkPlate(e.target.value)}
                    placeholder="Plate (optional)"
                    className="w-28 px-2 py-2 bg-surface-raised border border-rmpg-700 text-[11px] text-rmpg-100 font-mono uppercase placeholder-rmpg-500"
                  />
                  <button
                    type="button"
                    onClick={handleCreateLinkedFromOcr}
                    className="flex items-center gap-2 px-4 py-2 bg-brand-gold-500 hover:bg-brand-gold-400 rounded-sm text-[11px] font-bold text-black transition-colors"
                  >
                    <Database size={14} />
                    Create &amp; Link Person + Vehicle + Property
                  </button>
                </>
              )}
              <button
                type="button"
                onClick={async () => {
                  try {
                    const { generateSafetySheet } = await importWithRetry(() => import('../utils/dlSafetySheet'));
                    const doc = generateSafetySheet({
                      ocrResult, leFields, scanAlerts, scanMatches, deepSweep, courtRecords, fbiRecords,
                      officerName: undefined,
                    });
                    doc.save(`safety-brief-${(ocrResult?.last_name || 'subject')}-${Date.now()}.pdf`);
                    addToast('Safety sheet generated', 'success');
                  } catch (err) {
                    addToast(err instanceof Error ? err instanceof Error ? err.message : 'Unknown error' : 'Failed to generate safety sheet', 'error');
                  }
                }}
                className="flex items-center gap-2 px-4 py-2 bg-brand-gold-500 hover:bg-brand-gold-700 rounded-sm text-[11px] font-bold text-black transition-colors"
              >
                <Shield size={14} /> Safety Sheet
              </button>
              <button
                type="button"
                onClick={() => setShowOcrPreview(false)}
                className="px-4 py-2 bg-surface-raised hover:bg-surface-overlay border border-border-subtle rounded-sm text-[11px] text-rmpg-400 hover:text-rmpg-100 transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* SOR bulk-import confirmation */}
      <ConfirmDialog
        isOpen={confirmSorImport}
        onClose={() => setConfirmSorImport(false)}
        onConfirm={() => { setConfirmSorImport(false); importSor(); }}
        title="Import SOR Records"
        message="This will bulk-import the pasted offender records into the local DL database. Existing records are deduped by registry_id. This action cannot be easily undone."
        confirmLabel="Import records"
        confirmVariant="warning"
      />
    </div>
  );
}
