import React, { useState, useEffect, useCallback } from 'react';
import {
  Car, Key, CheckCircle2, XCircle, AlertTriangle, Database, Users,
  Loader2, Search, Eye, EyeOff, Trash2, Zap, Globe, Building2,
  ChevronLeft, ChevronRight, Clock, FileText, Truck, Shield, Fingerprint, MapPin,
} from 'lucide-react';
import { apiFetch } from '../../hooks/useApi';
import {
  formatNhtsaVinResponse, formatFmcsaCarrierResponse,
  formatCriminalRecordsResponse, formatOpenCorporatesResponse,
  formatEnformionPersonResponse, formatEnformionPhoneResponse,
  formatUgrcBusinessResponse, formatUgrcAddressResponse,
} from '../../utils/ncicFormatter';
import type {
  NhtsaFullReport, FmcsaCarrier, CriminalSearchResult, OCSearchResult,
  EnformionSearchResult, EnformionPhoneSearchResult,
  UgrcBusinessSearchResult, UgrcAddressSearchResult,
} from '../../utils/ncicFormatter';

interface Props {
  LoadingSpinner: React.FC;
  error: string | null;
  setError: (e: string | null) => void;
}

interface SourceStatus {
  name: string;
  status: string;
  credentials_required: boolean;
  credentials_configured?: boolean;
  capabilities: string[];
  total_queries: number;
  total_hits: number;
}

interface MvrOverviewStatus {
  sources: {
    nhtsa: SourceStatus;
    fmcsa: SourceStatus;
    criminal: SourceStatus;
    opencorporates: SourceStatus;
    enformion: SourceStatus;
  };
  total_queries: number;
  last_query_at: string | null;
}

interface UtahMvrStatus {
  configured: boolean;
  total_queries: number;
  total_hits: number;
  last_query_at: string | null;
}

interface AuditEntry {
  id: number;
  source: string;
  query_type: string;
  query_input: string;
  queried_by: number;
  queried_by_name: string;
  hit: number;
  error_msg: string | null;
  queried_at: string;
}

// ── Search category definitions ──
type QueryCategory =
  | 'all' | 'business' | 'individual' | 'vehicle' | 'residential'
  | 'criminal' | 'court' | 'mvr';

const CATEGORIES: { value: QueryCategory; label: string; placeholder: string; forceUpper: boolean }[] = [
  { value: 'all',         label: 'All Sources',  placeholder: 'Search across all configured databases...', forceUpper: false },
  { value: 'business',    label: 'Business',     placeholder: 'Company name (e.g. Acme Corp)...', forceUpper: false },
  { value: 'individual',  label: 'Individual',   placeholder: 'Person name (e.g. John Doe)...', forceUpper: false },
  { value: 'vehicle',     label: 'Vehicle',      placeholder: 'Enter 17-char VIN...', forceUpper: true },
  { value: 'residential', label: 'Residential',  placeholder: 'Address (e.g. 123 Main St, Salt Lake City, UT)...', forceUpper: false },
  { value: 'criminal',    label: 'Criminal',     placeholder: 'Person name for criminal records...', forceUpper: false },
  { value: 'court',       label: 'Court',        placeholder: 'Person name for court records...', forceUpper: false },
  { value: 'mvr',         label: 'MVR',          placeholder: 'DOT# or carrier name...', forceUpper: true },
];

export default function AdminUtahMvrTab({ LoadingSpinner, error, setError }: Props) {
  const [loading, setLoading] = useState(true);
  const [mvrStatus, setMvrStatus] = useState<MvrOverviewStatus | null>(null);
  const [utahStatus, setUtahStatus] = useState<UtahMvrStatus | null>(null);

  // ── Credential states ──
  const [utahUser, setUtahUser] = useState('');
  const [utahPass, setUtahPass] = useState('');
  const [showUtahPass, setShowUtahPass] = useState(false);
  const [savingUtah, setSavingUtah] = useState(false);
  const [testingUtah, setTestingUtah] = useState(false);
  const [utahTestResult, setUtahTestResult] = useState<{ success: boolean; message?: string; error?: string } | null>(null);

  const [fmcsaKey, setFmcsaKey] = useState('');
  const [showFmcsaKey, setShowFmcsaKey] = useState(false);
  const [savingFmcsa, setSavingFmcsa] = useState(false);
  const [testingFmcsa, setTestingFmcsa] = useState(false);
  const [fmcsaTestResult, setFmcsaTestResult] = useState<{ success: boolean; message?: string } | null>(null);

  const [criminalKey, setCriminalKey] = useState('');
  const [showCriminalKey, setShowCriminalKey] = useState(false);
  const [savingCriminal, setSavingCriminal] = useState(false);
  const [testingCriminal, setTestingCriminal] = useState(false);
  const [criminalTestResult, setCriminalTestResult] = useState<{ success: boolean; message?: string } | null>(null);

  const [ocToken, setOcToken] = useState('');
  const [showOcToken, setShowOcToken] = useState(false);
  const [savingOc, setSavingOc] = useState(false);
  const [testingOc, setTestingOc] = useState(false);
  const [ocTestResult, setOcTestResult] = useState<{ success: boolean; message?: string } | null>(null);

  const [enformionApiKey, setEnformionApiKey] = useState('');
  const [enformionApName, setEnformionApName] = useState('');
  const [enformionApPassword, setEnformionApPassword] = useState('');
  const [showEnformionPw, setShowEnformionPw] = useState(false);
  const [savingEnformion, setSavingEnformion] = useState(false);
  const [testingEnformion, setTestingEnformion] = useState(false);
  const [enformionTestResult, setEnformionTestResult] = useState<{ success: boolean; message?: string } | null>(null);

  // ── UGRC ──
  const [ugrcApiKey, setUgrcApiKey] = useState('');
  const [savingUgrc, setSavingUgrc] = useState(false);
  const [testingUgrc, setTestingUgrc] = useState(false);
  const [ugrcTestResult, setUgrcTestResult] = useState<{ success: boolean; message?: string } | null>(null);

  // ── Manual query ──
  const [queryCategory, setQueryCategory] = useState<QueryCategory>('all');
  const [queryInput, setQueryInput] = useState('');
  const [querying, setQuerying] = useState(false);
  const [queryResult, setQueryResult] = useState<string | null>(null);

  // ── Audit log ──
  const [auditEntries, setAuditEntries] = useState<AuditEntry[]>([]);
  const [auditPage, setAuditPage] = useState(1);
  const [auditTotal, setAuditTotal] = useState(0);
  const [auditPages, setAuditPages] = useState(0);
  const [loadingAudit, setLoadingAudit] = useState(false);

  // ── Data Fetching ──

  const fetchAll = useCallback(async () => {
    try {
      const [mvr, utah] = await Promise.all([
        apiFetch<MvrOverviewStatus>('/mvr/status').catch(() => null),
        apiFetch<UtahMvrStatus>('/utah-mvr/status').catch(() => null),
      ]);
      setMvrStatus(mvr);
      setUtahStatus(utah);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, []);

  const fetchAudit = useCallback(async () => {
    setLoadingAudit(true);
    try {
      const res = await apiFetch<{ rows: AuditEntry[]; total: number; pages: number }>(
        `/mvr/audit-log?page=${auditPage}&limit=15`
      );
      setAuditEntries(res.rows || []);
      setAuditTotal(res.total || 0);
      setAuditPages(res.pages || 0);
    } catch { /* ignore */ }
    finally { setLoadingAudit(false); }
  }, [auditPage]);

  useEffect(() => { fetchAll(); }, [fetchAll]);
  useEffect(() => { fetchAudit(); }, [fetchAudit]);

  // ── Credential Handlers ──

  const handleSaveUtahCreds = async () => {
    if (!utahUser.trim() || !utahPass.trim()) return;
    setSavingUtah(true);
    try {
      await apiFetch('/utah-mvr/credentials', {
        method: 'PUT',
        body: JSON.stringify({ username: utahUser.trim(), password: utahPass.trim() }),
      });
      setUtahUser(''); setUtahPass(''); setShowUtahPass(false);
      await fetchAll();
    } catch (e: any) { setError(e.message); }
    finally { setSavingUtah(false); }
  };

  const handleTestUtah = async () => {
    setTestingUtah(true); setUtahTestResult(null);
    try {
      const r = await apiFetch<any>('/utah-mvr/test-connection', { method: 'POST' });
      setUtahTestResult(r);
    } catch (e: any) { setUtahTestResult({ success: false, error: e.message }); }
    finally { setTestingUtah(false); }
  };

  const handleClearUtah = async () => {
    try {
      await apiFetch('/utah-mvr/credentials', { method: 'DELETE' });
      setUtahTestResult(null); await fetchAll();
    } catch (e: any) { setError(e.message); }
  };

  const handleSaveFmcsa = async () => {
    if (!fmcsaKey.trim()) return;
    setSavingFmcsa(true);
    try {
      await apiFetch('/mvr/fmcsa/credentials', {
        method: 'PUT',
        body: JSON.stringify({ webkey: fmcsaKey.trim() }),
      });
      setFmcsaKey(''); setShowFmcsaKey(false);
      await fetchAll();
    } catch (e: any) { setError(e.message); }
    finally { setSavingFmcsa(false); }
  };

  const handleTestFmcsa = async () => {
    setTestingFmcsa(true); setFmcsaTestResult(null);
    try {
      const r = await apiFetch<any>('/mvr/fmcsa/test-connection', { method: 'POST' });
      setFmcsaTestResult(r);
    } catch (e: any) { setFmcsaTestResult({ success: false, message: e.message }); }
    finally { setTestingFmcsa(false); }
  };

  const handleClearFmcsa = async () => {
    try {
      await apiFetch('/mvr/fmcsa/credentials', { method: 'DELETE' });
      setFmcsaTestResult(null); await fetchAll();
    } catch (e: any) { setError(e.message); }
  };

  const handleSaveCriminal = async () => {
    if (!criminalKey.trim()) return;
    setSavingCriminal(true);
    try {
      await apiFetch('/mvr/criminal/credentials', {
        method: 'PUT',
        body: JSON.stringify({ apiKey: criminalKey.trim() }),
      });
      setCriminalKey(''); setShowCriminalKey(false);
      await fetchAll();
    } catch (e: any) { setError(e.message); }
    finally { setSavingCriminal(false); }
  };

  const handleTestCriminal = async () => {
    setTestingCriminal(true); setCriminalTestResult(null);
    try {
      const r = await apiFetch<any>('/mvr/criminal/test-connection', { method: 'POST' });
      setCriminalTestResult(r);
    } catch (e: any) { setCriminalTestResult({ success: false, message: e.message }); }
    finally { setTestingCriminal(false); }
  };

  const handleClearCriminal = async () => {
    try {
      await apiFetch('/mvr/criminal/credentials', { method: 'DELETE' });
      setCriminalTestResult(null); await fetchAll();
    } catch (e: any) { setError(e.message); }
  };

  const handleSaveOc = async () => {
    if (!ocToken.trim()) return;
    setSavingOc(true);
    try {
      await apiFetch('/mvr/opencorporates/credentials', {
        method: 'PUT',
        body: JSON.stringify({ apiToken: ocToken.trim() }),
      });
      setOcToken(''); setShowOcToken(false);
      await fetchAll();
    } catch (e: any) { setError(e.message); }
    finally { setSavingOc(false); }
  };

  const handleTestOc = async () => {
    setTestingOc(true); setOcTestResult(null);
    try {
      const r = await apiFetch<any>('/mvr/opencorporates/test-connection', { method: 'POST' });
      setOcTestResult(r);
    } catch (e: any) { setOcTestResult({ success: false, message: e.message }); }
    finally { setTestingOc(false); }
  };

  const handleClearOc = async () => {
    try {
      await apiFetch('/mvr/opencorporates/credentials', { method: 'DELETE' });
      setOcTestResult(null); await fetchAll();
    } catch (e: any) { setError(e.message); }
  };

  const handleSaveEnformion = async () => {
    if (!enformionApiKey.trim() || !enformionApName.trim() || !enformionApPassword.trim()) return;
    setSavingEnformion(true);
    try {
      await apiFetch('/mvr/enformion/credentials', {
        method: 'PUT',
        body: JSON.stringify({ apiKey: enformionApiKey.trim(), apName: enformionApName.trim(), apPassword: enformionApPassword.trim() }),
      });
      setEnformionApiKey(''); setEnformionApName(''); setEnformionApPassword(''); setShowEnformionPw(false);
      await fetchAll();
    } catch (e: any) { setError(e.message); }
    finally { setSavingEnformion(false); }
  };

  const handleTestEnformion = async () => {
    setTestingEnformion(true); setEnformionTestResult(null);
    try {
      const r = await apiFetch<any>('/mvr/enformion/test-connection', { method: 'POST' });
      setEnformionTestResult(r);
    } catch (e: any) { setEnformionTestResult({ success: false, message: e.message }); }
    finally { setTestingEnformion(false); }
  };

  const handleClearEnformion = async () => {
    try {
      await apiFetch('/mvr/enformion/credentials', { method: 'DELETE' });
      setEnformionTestResult(null); await fetchAll();
    } catch (e: any) { setError(e.message); }
  };

  // ── UGRC handlers ──
  const handleSaveUgrc = async () => {
    if (!ugrcApiKey.trim()) return;
    setSavingUgrc(true); setUgrcTestResult(null);
    try {
      await apiFetch('/mvr/ugrc/credentials', {
        method: 'PUT',
        body: JSON.stringify({ apiKey: ugrcApiKey.trim() }),
      });
      setUgrcApiKey(''); await fetchAll();
    } catch (e: any) { setError(e.message); }
    finally { setSavingUgrc(false); }
  };

  const handleTestUgrc = async () => {
    setTestingUgrc(true); setUgrcTestResult(null);
    try {
      const data = await apiFetch<{ success: boolean; message?: string }>('/mvr/ugrc/test-connection', { method: 'POST' });
      setUgrcTestResult(data);
    } catch (e: any) { setUgrcTestResult({ success: false, message: e.message }); }
    finally { setTestingUgrc(false); }
  };

  const handleClearUgrc = async () => {
    try {
      await apiFetch('/mvr/ugrc/credentials', { method: 'DELETE' });
      setUgrcTestResult(null); await fetchAll();
    } catch (e: any) { setError(e.message); }
  };

  // ── Query Handler ──

  const handleQuery = async () => {
    if (!queryInput.trim()) return;
    setQuerying(true); setQueryResult(null);
    const term = queryInput.trim();

    try {
      const results: string[] = [];

      // Business search (OpenCorporates + UGRC SGID)
      if (queryCategory === 'all' || queryCategory === 'business') {
        try {
          const data = await apiFetch<OCSearchResult>(`/mvr/opencorporates/companies/${encodeURIComponent(term)}`);
          if (data.success) results.push(formatOpenCorporatesResponse(data));
          else if (queryCategory === 'business') results.push(`BUSINESS SEARCH ERROR: ${data.error || 'No data returned'}`);
        } catch (e: any) {
          if (queryCategory === 'business') results.push(`BUSINESS SEARCH ERROR: ${e.message}`);
        }
        // UGRC SGID business search (Utah businesses)
        try {
          const ugrcBiz = await apiFetch<UgrcBusinessSearchResult>('/mvr/ugrc/search/business', {
            method: 'POST',
            body: JSON.stringify({ query: term, limit: 25 }),
          });
          if (ugrcBiz.success && ugrcBiz.results.length > 0) {
            results.push(formatUgrcBusinessResponse(ugrcBiz, term));
          }
        } catch { /* non-fatal UGRC business search */ }
      }

      // Vehicle search (NHTSA)
      if (queryCategory === 'all' || queryCategory === 'vehicle') {
        try {
          const data = await apiFetch<any>(`/mvr/nhtsa/report/${encodeURIComponent(term)}`);
          if (data.data) {
            const report: NhtsaFullReport = {
              vehicle: data.data.vehicle || data.data,
              recalls: data.data.recalls || [],
              complaints: data.data.complaints || [],
              recallCount: data.data.recallCount || 0,
              complaintCount: data.data.complaintCount || 0,
              hasParkItRecall: data.data.hasParkItRecall || false,
              hasFireRisk: data.data.hasFireRisk || false,
            };
            results.push(formatNhtsaVinResponse(report));
          } else if (queryCategory === 'vehicle') {
            results.push(data.error || 'NHTSA: No data returned');
          }
        } catch (e: any) {
          if (queryCategory === 'vehicle') results.push(`NHTSA ERROR: ${e.message}`);
        }
      }

      // Criminal search
      if (queryCategory === 'all' || queryCategory === 'criminal') {
        try {
          const data = await apiFetch<CriminalSearchResult>(`/mvr/criminal/search/${encodeURIComponent(term)}`);
          if (data.success) results.push(formatCriminalRecordsResponse(data));
          else if (queryCategory === 'criminal') results.push(`CRIMINAL SEARCH ERROR: ${data.error || 'No data returned'}`);
        } catch (e: any) {
          if (queryCategory === 'criminal') results.push(`CRIMINAL SEARCH ERROR: ${e.message}`);
        }
      }

      // Court records (criminal API, court feed only)
      if (queryCategory === 'court') {
        try {
          const data = await apiFetch<CriminalSearchResult>(`/mvr/criminal/search/${encodeURIComponent(term)}?feeds=court`);
          if (data.success) results.push(formatCriminalRecordsResponse(data));
          else results.push(`COURT SEARCH ERROR: ${data.error || 'No data returned'}`);
        } catch (e: any) {
          results.push(`COURT SEARCH ERROR: ${e.message}`);
        }
      }

      // Individual (Enformion person search + local NCIC)
      if (queryCategory === 'all' || queryCategory === 'individual') {
        // Enformion person search
        try {
          const enData = await apiFetch<EnformionSearchResult>(`/mvr/enformion/person/${encodeURIComponent(term)}`);
          if (enData.success && enData.totalCount > 0) results.push(formatEnformionPersonResponse(enData));
          else if (queryCategory === 'individual' && !enData.success) results.push(`ENFORMION ERROR: ${enData.error || 'No data returned'}`);
        } catch (e: any) {
          if (queryCategory === 'individual') results.push(`ENFORMION ERROR: ${e.message}`);
        }
        // Local NCIC person search
        try {
          const data = await apiFetch<any>(`/records/ncic-query?type=person&query=${encodeURIComponent(term)}`);
          if (data.results && data.results.length > 0) {
            results.push(`*** LOCAL RECORDS — PERSON ***\n${data.results.length} local record(s) found for "${term.toUpperCase()}"`);
          }
        } catch { /* non-fatal local search */ }
      }

      // Residential (Enformion address search + UGRC SGID address)
      if (queryCategory === 'all' || queryCategory === 'residential') {
        // Enformion address search
        try {
          const enData = await apiFetch<EnformionSearchResult>(`/mvr/enformion/address/${encodeURIComponent(term)}`);
          if (enData.success) results.push(formatEnformionPersonResponse(enData));
          else if (queryCategory === 'residential') results.push(`ADDRESS SEARCH ERROR: ${enData.error || 'No data returned'}`);
        } catch (e: any) {
          if (queryCategory === 'residential') results.push(`ADDRESS SEARCH ERROR: ${e.message}`);
        }
        // UGRC SGID address search (1M+ Utah addresses)
        try {
          const ugrcAddr = await apiFetch<UgrcAddressSearchResult>('/mvr/ugrc/search/address', {
            method: 'POST',
            body: JSON.stringify({ query: term, limit: 25 }),
          });
          if (ugrcAddr.success && ugrcAddr.results.length > 0) {
            results.push(formatUgrcAddressResponse(ugrcAddr, term));
          }
        } catch { /* non-fatal UGRC address search */ }
      }

      // MVR (FMCSA carrier)
      if (queryCategory === 'all' || queryCategory === 'mvr') {
        try {
          const data = await apiFetch<any>(`/mvr/fmcsa/carrier/${encodeURIComponent(term)}`);
          if (data.data) {
            results.push(formatFmcsaCarrierResponse(data.data as FmcsaCarrier));
          } else if (queryCategory === 'mvr') {
            results.push(data.error || 'FMCSA: No data returned');
          }
        } catch (e: any) {
          if (queryCategory === 'mvr') results.push(`FMCSA ERROR: ${e.message}`);
        }
      }

      setQueryResult(results.length > 0 ? results.join('\n\n') : 'No results found across any configured source.');
      await fetchAudit();
    } catch (e: any) {
      setQueryResult(`ERROR: ${e.message}`);
    }
    finally { setQuerying(false); }
  };

  if (loading) return <LoadingSpinner />;

  const nhtsaS = mvrStatus?.sources?.nhtsa;
  const fmcsaS = mvrStatus?.sources?.fmcsa;
  const criminalS = mvrStatus?.sources?.criminal;
  const ocS = mvrStatus?.sources?.opencorporates;
  const enformionS = mvrStatus?.sources?.enformion;
  const ugrcS = mvrStatus?.sources?.ugrc;

  // Count active sources
  const activeSources = [
    true,                                         // NHTSA always active
    fmcsaS?.credentials_configured || false,
    criminalS?.credentials_configured || false,
    ocS?.credentials_configured || false,
    enformionS?.credentials_configured || false,
    utahStatus?.configured || false,
    ugrcS?.credentials_configured || false,
  ].filter(Boolean).length;

  const catInfo = CATEGORIES.find(c => c.value === queryCategory)!;

  return (
    <div className="p-4 space-y-4">
      {/* ══════ Header ══════ */}
      <div className="flex items-center gap-3">
        <Database className="w-4 h-4 text-blue-400" />
        <h2 className="text-xs font-bold uppercase tracking-wider text-rmpg-200">
          Records Search — Unified Search Hub
        </h2>
        <span className="ml-auto flex items-center gap-1 text-[10px] text-rmpg-400">
          <span className="w-1.5 h-1.5 rounded-full bg-green-400" />
          {activeSources} / 7 sources active
        </span>
      </div>

      {/* ══════ Data Source Overview ══════ */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-7 gap-2">
        {/* NHTSA */}
        <div className="panel-beveled bg-surface-base p-3">
          <div className="flex items-center gap-2 mb-2">
            <Globe className="w-3.5 h-3.5 text-blue-400" />
            <span className="text-[10px] font-bold text-rmpg-200 uppercase">NHTSA</span>
            <span className="ml-auto flex items-center gap-1 text-[10px] text-green-400">
              <span className="w-1.5 h-1.5 rounded-full bg-green-400" />
              ACTIVE
            </span>
          </div>
          <div className="text-[9px] text-rmpg-500 mb-1">Vehicle — No credentials</div>
          <div className="text-[9px] text-rmpg-400 space-y-0.5">
            <div>• VIN Decode + Recalls</div>
            <div>• Consumer Complaints</div>
          </div>
          <div className="mt-2 pt-2 border-t border-rmpg-700 flex justify-between text-[10px] font-mono">
            <span className="text-rmpg-400">Q: <span className="text-rmpg-200">{nhtsaS?.total_queries || 0}</span></span>
            <span className="text-rmpg-400">H: <span className="text-green-400">{nhtsaS?.total_hits || 0}</span></span>
          </div>
        </div>

        {/* FMCSA */}
        <div className="panel-beveled bg-surface-base p-3">
          <div className="flex items-center gap-2 mb-2">
            <Truck className="w-3.5 h-3.5 text-amber-400" />
            <span className="text-[10px] font-bold text-rmpg-200 uppercase">FMCSA</span>
            <span className={`ml-auto flex items-center gap-1 text-[10px] ${fmcsaS?.credentials_configured ? 'text-green-400' : 'text-rmpg-500'}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${fmcsaS?.credentials_configured ? 'bg-green-400' : 'bg-rmpg-500'}`} />
              {fmcsaS?.credentials_configured ? 'ACTIVE' : 'SETUP'}
            </span>
          </div>
          <div className="text-[9px] text-rmpg-500 mb-1">MVR — Free webkey</div>
          <div className="text-[9px] text-rmpg-400 space-y-0.5">
            <div>• Carrier by DOT#</div>
            <div>• Safety / Authority</div>
          </div>
          <div className="mt-2 pt-2 border-t border-rmpg-700 flex justify-between text-[10px] font-mono">
            <span className="text-rmpg-400">Q: <span className="text-rmpg-200">{fmcsaS?.total_queries || 0}</span></span>
            <span className="text-rmpg-400">H: <span className="text-green-400">{fmcsaS?.total_hits || 0}</span></span>
          </div>
        </div>

        {/* Criminal Checks */}
        <div className="panel-beveled bg-surface-base p-3">
          <div className="flex items-center gap-2 mb-2">
            <Fingerprint className="w-3.5 h-3.5 text-red-400" />
            <span className="text-[10px] font-bold text-rmpg-200 uppercase">Criminal</span>
            <span className={`ml-auto flex items-center gap-1 text-[10px] ${criminalS?.credentials_configured ? 'text-green-400' : 'text-rmpg-500'}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${criminalS?.credentials_configured ? 'bg-green-400' : 'bg-rmpg-500'}`} />
              {criminalS?.credentials_configured ? 'ACTIVE' : 'SETUP'}
            </span>
          </div>
          <div className="text-[9px] text-rmpg-500 mb-1">Criminal — API key</div>
          <div className="text-[9px] text-rmpg-400 space-y-0.5">
            <div>• Sex Offender / DOC</div>
            <div>• Warrants / Court</div>
          </div>
          <div className="mt-2 pt-2 border-t border-rmpg-700 flex justify-between text-[10px] font-mono">
            <span className="text-rmpg-400">Q: <span className="text-rmpg-200">{criminalS?.total_queries || 0}</span></span>
            <span className="text-rmpg-400">H: <span className="text-green-400">{criminalS?.total_hits || 0}</span></span>
          </div>
        </div>

        {/* OpenCorporates */}
        <div className="panel-beveled bg-surface-base p-3">
          <div className="flex items-center gap-2 mb-2">
            <Building2 className="w-3.5 h-3.5 text-cyan-400" />
            <span className="text-[10px] font-bold text-rmpg-200 uppercase">Business</span>
            <span className={`ml-auto flex items-center gap-1 text-[10px] ${ocS?.credentials_configured ? 'text-green-400' : 'text-rmpg-500'}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${ocS?.credentials_configured ? 'bg-green-400' : 'bg-rmpg-500'}`} />
              {ocS?.credentials_configured ? 'ACTIVE' : 'SETUP'}
            </span>
          </div>
          <div className="text-[9px] text-rmpg-500 mb-1">Business — API token</div>
          <div className="text-[9px] text-rmpg-400 space-y-0.5">
            <div>• Company Search</div>
            <div>• Officer / Director</div>
          </div>
          <div className="mt-2 pt-2 border-t border-rmpg-700 flex justify-between text-[10px] font-mono">
            <span className="text-rmpg-400">Q: <span className="text-rmpg-200">{ocS?.total_queries || 0}</span></span>
            <span className="text-rmpg-400">H: <span className="text-green-400">{ocS?.total_hits || 0}</span></span>
          </div>
        </div>

        {/* Enformion */}
        <div className="panel-beveled bg-surface-base p-3">
          <div className="flex items-center gap-2 mb-2">
            <Users className="w-3.5 h-3.5 text-violet-400" />
            <span className="text-[10px] font-bold text-rmpg-200 uppercase">Enformion</span>
            <span className={`ml-auto flex items-center gap-1 text-[10px] ${enformionS?.credentials_configured ? 'text-green-400' : 'text-rmpg-500'}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${enformionS?.credentials_configured ? 'bg-green-400' : 'bg-rmpg-500'}`} />
              {enformionS?.credentials_configured ? 'ACTIVE' : 'SETUP'}
            </span>
          </div>
          <div className="text-[9px] text-rmpg-500 mb-1">Individual — 3 keys</div>
          <div className="text-[9px] text-rmpg-400 space-y-0.5">
            <div>• Person / Phone / Address</div>
            <div>• Public Records (600M+)</div>
          </div>
          <div className="mt-2 pt-2 border-t border-rmpg-700 flex justify-between text-[10px] font-mono">
            <span className="text-rmpg-400">Q: <span className="text-rmpg-200">{enformionS?.total_queries || 0}</span></span>
            <span className="text-rmpg-400">H: <span className="text-green-400">{enformionS?.total_hits || 0}</span></span>
          </div>
        </div>

        {/* Utah DLD */}
        <div className="panel-beveled bg-surface-base p-3">
          <div className="flex items-center gap-2 mb-2">
            <Shield className="w-3.5 h-3.5 text-purple-400" />
            <span className="text-[10px] font-bold text-rmpg-200 uppercase">Utah DLD</span>
            <span className={`ml-auto flex items-center gap-1 text-[10px] ${utahStatus?.configured ? 'text-green-400' : 'text-rmpg-500'}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${utahStatus?.configured ? 'bg-green-400' : 'bg-rmpg-500'}`} />
              {utahStatus?.configured ? 'ACTIVE' : 'SETUP'}
            </span>
          </div>
          <div className="text-[9px] text-rmpg-500 mb-1">State — DLD approval</div>
          <div className="text-[9px] text-rmpg-400 space-y-0.5">
            <div>• Plate / Driver / VIN</div>
            <div>• Registration Status</div>
          </div>
          <div className="mt-2 pt-2 border-t border-rmpg-700 flex justify-between text-[10px] font-mono">
            <span className="text-rmpg-400">Q: <span className="text-rmpg-200">{utahStatus?.total_queries || 0}</span></span>
            <span className="text-rmpg-400">H: <span className="text-green-400">{utahStatus?.total_hits || 0}</span></span>
          </div>
        </div>

        {/* UGRC Geocoding */}
        <div className="panel-beveled bg-surface-base p-3">
          <div className="flex items-center gap-2 mb-2">
            <MapPin className="w-3.5 h-3.5 text-teal-400" />
            <span className="text-[10px] font-bold text-rmpg-200 uppercase">UGRC</span>
            <span className={`ml-auto flex items-center gap-1 text-[10px] ${ugrcS?.credentials_configured ? 'text-green-400' : 'text-rmpg-500'}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${ugrcS?.credentials_configured ? 'bg-green-400' : 'bg-rmpg-500'}`} />
              {ugrcS?.credentials_configured ? 'ACTIVE' : 'SETUP'}
            </span>
          </div>
          <div className="text-[9px] text-rmpg-500 mb-1">Utah SGID — 1 key</div>
          <div className="text-[9px] text-rmpg-400 space-y-0.5">
            <div>• Business / Address / Parcel</div>
            <div>• Geocoding + 1M+ records</div>
          </div>
          <div className="mt-2 pt-2 border-t border-rmpg-700 text-[10px] text-rmpg-500 font-mono">
            Free — No rate limits
          </div>
        </div>
      </div>

      {/* ══════ NCIC Commands Reference ══════ */}
      <div className="panel-beveled bg-surface-base p-3">
        <div className="flex items-center gap-2 mb-2 text-[10px] font-bold text-rmpg-300 uppercase tracking-wider">
          <FileText className="w-3.5 h-3.5" />
          NCIC Terminal Commands
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2 text-[10px]">
          <div className="bg-surface-sunken p-2 rounded-sm">
            <span className="font-mono text-green-400 font-bold">QN &lt;VIN&gt;</span>
            <div className="text-rmpg-500 mt-0.5">NHTSA VIN decode + recalls</div>
          </div>
          <div className="bg-surface-sunken p-2 rounded-sm">
            <span className="font-mono text-amber-400 font-bold">QC &lt;DOT#&gt;</span>
            <div className="text-rmpg-500 mt-0.5">FMCSA carrier safety lookup</div>
          </div>
          <div className="bg-surface-sunken p-2 rounded-sm">
            <span className="font-mono text-red-400 font-bold">QX &lt;name&gt;</span>
            <div className="text-rmpg-500 mt-0.5">Criminal records search</div>
          </div>
          <div className="bg-surface-sunken p-2 rounded-sm">
            <span className="font-mono text-cyan-400 font-bold">QE &lt;company&gt;</span>
            <div className="text-rmpg-500 mt-0.5">Business entity lookup</div>
          </div>
          <div className="bg-surface-sunken p-2 rounded-sm">
            <span className="font-mono text-violet-400 font-bold">QI &lt;name&gt;</span>
            <div className="text-rmpg-500 mt-0.5">Enformion person lookup</div>
          </div>
          <div className="bg-surface-sunken p-2 rounded-sm">
            <span className="font-mono text-violet-400 font-bold">QZ &lt;phone&gt;</span>
            <div className="text-rmpg-500 mt-0.5">Enformion reverse phone</div>
          </div>
          <div className="bg-surface-sunken p-2 rounded-sm">
            <span className="font-mono text-purple-400 font-bold">QR / QD</span>
            <div className="text-rmpg-500 mt-0.5">Utah plate / driver lookup</div>
          </div>
        </div>
      </div>

      {/* ══════ Category Search ══════ */}
      <div className="panel-beveled bg-surface-base p-3 space-y-3">
        <div className="flex items-center gap-2 text-[10px] font-bold text-rmpg-300 uppercase tracking-wider">
          <Search className="w-3.5 h-3.5" />
          Records Search
        </div>
        <div className="flex items-center gap-2">
          <select
            value={queryCategory}
            onChange={e => { setQueryCategory(e.target.value as QueryCategory); setQueryResult(null); }}
            className="bg-surface-sunken border border-rmpg-600 text-rmpg-200 text-[10px] px-2 py-1.5 rounded-sm focus:border-brand-500 focus:outline-none min-w-[130px]"
          >
            {CATEGORIES.map(c => (
              <option key={c.value} value={c.value}>{c.label}</option>
            ))}
          </select>
          <input
            type="text"
            value={queryInput}
            onChange={e => setQueryInput(catInfo.forceUpper ? e.target.value.toUpperCase() : e.target.value)}
            placeholder={catInfo.placeholder}
            className="flex-1 bg-surface-sunken border border-rmpg-600 text-rmpg-200 text-xs px-2.5 py-1.5 rounded-sm focus:border-brand-500 focus:outline-none font-mono"
            onKeyDown={e => { if (e.key === 'Enter') handleQuery(); }}
          />
          <button
            onClick={handleQuery}
            disabled={querying || !queryInput.trim()}
            className="toolbar-btn text-[10px] flex items-center gap-1 px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white disabled:opacity-50"
          >
            {querying ? <Loader2 className="w-3 h-3 animate-spin" /> : <Search className="w-3 h-3" />}
            Search
          </button>
        </div>
        {queryResult && (
          <div className="bg-black border border-rmpg-700 rounded-sm p-3 overflow-auto" style={{ maxHeight: '500px' }}>
            <pre className="text-[10px] font-mono text-green-400 leading-relaxed whitespace-pre-wrap">{queryResult}</pre>
          </div>
        )}
      </div>

      {/* ══════ OpenCorporates API Token ══════ */}
      <div className="panel-beveled bg-surface-base p-3 space-y-3">
        <div className="flex items-center gap-2 text-[10px] font-bold text-rmpg-300 uppercase tracking-wider">
          <Key className="w-3.5 h-3.5 text-cyan-400" />
          OpenCorporates API Token
          {ocS?.credentials_configured && <span className="text-green-400 text-[9px] ml-1">configured</span>}
        </div>
        <div className="text-[9px] text-rmpg-500">
          API token from <span className="font-mono text-blue-400">opencorporates.com</span> — global corporate registry (free tier: 200 req/month)
        </div>
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <input
              type={showOcToken ? 'text' : 'password'}
              value={ocToken}
              onChange={e => setOcToken(e.target.value)}
              placeholder={ocS?.credentials_configured ? 'Enter new token to replace...' : 'OpenCorporates API token...'}
              autoComplete="off"
              className="w-full bg-surface-sunken border border-rmpg-600 text-rmpg-200 text-xs px-2.5 py-1.5 pr-8 rounded-sm focus:border-brand-500 focus:outline-none font-mono"
            />
            <button onClick={() => setShowOcToken(!showOcToken)} className="absolute right-2 top-1/2 -translate-y-1/2 text-rmpg-500 hover:text-rmpg-300">
              {showOcToken ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
            </button>
          </div>
          <button onClick={handleSaveOc} disabled={savingOc || !ocToken.trim()}
            className="toolbar-btn text-[10px] flex items-center gap-1 px-3 py-1.5 bg-brand-600 hover:bg-brand-500 text-white disabled:opacity-50">
            {savingOc ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCircle2 className="w-3 h-3" />} Save
          </button>
          {ocS?.credentials_configured && (
            <>
              <button onClick={handleTestOc} disabled={testingOc}
                className="toolbar-btn text-[10px] flex items-center gap-1 px-3 py-1.5">
                {testingOc ? <Loader2 className="w-3 h-3 animate-spin" /> : <Zap className="w-3 h-3" />} Test
              </button>
              <button onClick={handleClearOc}
                className="toolbar-btn text-[10px] flex items-center gap-1 px-3 py-1.5 text-red-400 hover:text-red-300">
                <Trash2 className="w-3 h-3" /> Clear
              </button>
            </>
          )}
        </div>
        {ocTestResult && (
          <div className={`flex items-center gap-2 text-[10px] px-2 py-1.5 rounded-sm ${
            ocTestResult.success ? 'bg-green-950/30 border border-green-800/40 text-green-400' : 'bg-red-950/30 border border-red-800/40 text-red-400'
          }`}>
            {ocTestResult.success ? <CheckCircle2 className="w-3.5 h-3.5" /> : <XCircle className="w-3.5 h-3.5" />}
            {ocTestResult.message}
          </div>
        )}
      </div>

      {/* ══════ FMCSA Credentials ══════ */}
      <div className="panel-beveled bg-surface-base p-3 space-y-3">
        <div className="flex items-center gap-2 text-[10px] font-bold text-rmpg-300 uppercase tracking-wider">
          <Key className="w-3.5 h-3.5 text-amber-400" />
          FMCSA Webkey
          {fmcsaS?.credentials_configured && <span className="text-green-400 text-[9px] ml-1">configured</span>}
        </div>
        <div className="text-[9px] text-rmpg-500">
          Free webkey from <span className="font-mono text-blue-400">mobile.fmcsa.dot.gov/QCDevsite</span> (Login.gov account required)
        </div>
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <input
              type={showFmcsaKey ? 'text' : 'password'}
              value={fmcsaKey}
              onChange={e => setFmcsaKey(e.target.value)}
              placeholder={fmcsaS?.credentials_configured ? 'Enter new webkey to replace...' : 'FMCSA API webkey...'}
              autoComplete="off"
              className="w-full bg-surface-sunken border border-rmpg-600 text-rmpg-200 text-xs px-2.5 py-1.5 pr-8 rounded-sm focus:border-brand-500 focus:outline-none font-mono"
            />
            <button onClick={() => setShowFmcsaKey(!showFmcsaKey)} className="absolute right-2 top-1/2 -translate-y-1/2 text-rmpg-500 hover:text-rmpg-300">
              {showFmcsaKey ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
            </button>
          </div>
          <button onClick={handleSaveFmcsa} disabled={savingFmcsa || !fmcsaKey.trim()}
            className="toolbar-btn text-[10px] flex items-center gap-1 px-3 py-1.5 bg-brand-600 hover:bg-brand-500 text-white disabled:opacity-50">
            {savingFmcsa ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCircle2 className="w-3 h-3" />} Save
          </button>
          {fmcsaS?.credentials_configured && (
            <>
              <button onClick={handleTestFmcsa} disabled={testingFmcsa}
                className="toolbar-btn text-[10px] flex items-center gap-1 px-3 py-1.5">
                {testingFmcsa ? <Loader2 className="w-3 h-3 animate-spin" /> : <Zap className="w-3 h-3" />} Test
              </button>
              <button onClick={handleClearFmcsa}
                className="toolbar-btn text-[10px] flex items-center gap-1 px-3 py-1.5 text-red-400 hover:text-red-300">
                <Trash2 className="w-3 h-3" /> Clear
              </button>
            </>
          )}
        </div>
        {fmcsaTestResult && (
          <div className={`flex items-center gap-2 text-[10px] px-2 py-1.5 rounded-sm ${
            fmcsaTestResult.success ? 'bg-green-950/30 border border-green-800/40 text-green-400' : 'bg-red-950/30 border border-red-800/40 text-red-400'
          }`}>
            {fmcsaTestResult.success ? <CheckCircle2 className="w-3.5 h-3.5" /> : <XCircle className="w-3.5 h-3.5" />}
            {fmcsaTestResult.message}
          </div>
        )}
      </div>

      {/* ══════ Criminal Checks API Key ══════ */}
      <div className="panel-beveled bg-surface-base p-3 space-y-3">
        <div className="flex items-center gap-2 text-[10px] font-bold text-rmpg-300 uppercase tracking-wider">
          <Key className="w-3.5 h-3.5 text-red-400" />
          Criminal Checks API Key
          {criminalS?.credentials_configured && <span className="text-green-400 text-[9px] ml-1">configured</span>}
        </div>
        <div className="text-[9px] text-rmpg-500">
          API key from <span className="font-mono text-blue-400">completecriminalchecks.com/Developers</span> — searches sex offender, DOC, warrants, court records
        </div>
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <input
              type={showCriminalKey ? 'text' : 'password'}
              value={criminalKey}
              onChange={e => setCriminalKey(e.target.value)}
              placeholder={criminalS?.credentials_configured ? 'Enter new API key to replace...' : 'Criminal Checks API key...'}
              autoComplete="off"
              className="w-full bg-surface-sunken border border-rmpg-600 text-rmpg-200 text-xs px-2.5 py-1.5 pr-8 rounded-sm focus:border-brand-500 focus:outline-none font-mono"
            />
            <button onClick={() => setShowCriminalKey(!showCriminalKey)} className="absolute right-2 top-1/2 -translate-y-1/2 text-rmpg-500 hover:text-rmpg-300">
              {showCriminalKey ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
            </button>
          </div>
          <button onClick={handleSaveCriminal} disabled={savingCriminal || !criminalKey.trim()}
            className="toolbar-btn text-[10px] flex items-center gap-1 px-3 py-1.5 bg-brand-600 hover:bg-brand-500 text-white disabled:opacity-50">
            {savingCriminal ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCircle2 className="w-3 h-3" />} Save
          </button>
          {criminalS?.credentials_configured && (
            <>
              <button onClick={handleTestCriminal} disabled={testingCriminal}
                className="toolbar-btn text-[10px] flex items-center gap-1 px-3 py-1.5">
                {testingCriminal ? <Loader2 className="w-3 h-3 animate-spin" /> : <Zap className="w-3 h-3" />} Test
              </button>
              <button onClick={handleClearCriminal}
                className="toolbar-btn text-[10px] flex items-center gap-1 px-3 py-1.5 text-red-400 hover:text-red-300">
                <Trash2 className="w-3 h-3" /> Clear
              </button>
            </>
          )}
        </div>
        {criminalTestResult && (
          <div className={`flex items-center gap-2 text-[10px] px-2 py-1.5 rounded-sm ${
            criminalTestResult.success ? 'bg-green-950/30 border border-green-800/40 text-green-400' : 'bg-red-950/30 border border-red-800/40 text-red-400'
          }`}>
            {criminalTestResult.success ? <CheckCircle2 className="w-3.5 h-3.5" /> : <XCircle className="w-3.5 h-3.5" />}
            {criminalTestResult.message}
          </div>
        )}
      </div>

      {/* ══════ Enformion Credentials ══════ */}
      <div className="panel-beveled bg-surface-base p-3 space-y-3">
        <div className="flex items-center gap-2 text-[10px] font-bold text-rmpg-300 uppercase tracking-wider">
          <Key className="w-3.5 h-3.5 text-violet-400" />
          Enformion API Credentials
          {enformionS?.credentials_configured && <span className="text-green-400 text-[9px] ml-1">configured</span>}
        </div>
        <div className="text-[9px] text-rmpg-500">
          3-key auth from <span className="font-mono text-blue-400">go.enformion.com/developer-apis</span> — 600M+ public records, 100 searches/mo free tier
        </div>
        <div className="space-y-2">
          <input type="text" value={enformionApiKey} onChange={e => setEnformionApiKey(e.target.value)}
            placeholder={enformionS?.credentials_configured ? 'Enter new API key to replace...' : 'API Key Name...'}
            autoComplete="off"
            className="w-full bg-surface-sunken border border-rmpg-600 text-rmpg-200 text-xs px-2.5 py-1.5 rounded-sm focus:border-brand-500 focus:outline-none font-mono" />
          <input type="text" value={enformionApName} onChange={e => setEnformionApName(e.target.value)}
            placeholder={enformionS?.credentials_configured ? 'Enter new AP name to replace...' : 'Access Profile Key Name...'}
            autoComplete="off"
            className="w-full bg-surface-sunken border border-rmpg-600 text-rmpg-200 text-xs px-2.5 py-1.5 rounded-sm focus:border-brand-500 focus:outline-none font-mono" />
          <div className="relative">
            <input type={showEnformionPw ? 'text' : 'password'} value={enformionApPassword} onChange={e => setEnformionApPassword(e.target.value)}
              placeholder={enformionS?.credentials_configured ? 'Enter new AP password to replace...' : 'Access Profile Key Password...'}
              autoComplete="new-password"
              className="w-full bg-surface-sunken border border-rmpg-600 text-rmpg-200 text-xs px-2.5 py-1.5 pr-8 rounded-sm focus:border-brand-500 focus:outline-none font-mono" />
            <button onClick={() => setShowEnformionPw(!showEnformionPw)} className="absolute right-2 top-1/2 -translate-y-1/2 text-rmpg-500 hover:text-rmpg-300">
              {showEnformionPw ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
            </button>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={handleSaveEnformion} disabled={savingEnformion || !enformionApiKey.trim() || !enformionApName.trim() || !enformionApPassword.trim()}
            className="toolbar-btn text-[10px] flex items-center gap-1 px-3 py-1.5 bg-brand-600 hover:bg-brand-500 text-white disabled:opacity-50">
            {savingEnformion ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCircle2 className="w-3 h-3" />} Save
          </button>
          {enformionS?.credentials_configured && (
            <>
              <button onClick={handleTestEnformion} disabled={testingEnformion}
                className="toolbar-btn text-[10px] flex items-center gap-1 px-3 py-1.5">
                {testingEnformion ? <Loader2 className="w-3 h-3 animate-spin" /> : <Zap className="w-3 h-3" />} Test
              </button>
              <button onClick={handleClearEnformion}
                className="toolbar-btn text-[10px] flex items-center gap-1 px-3 py-1.5 text-red-400 hover:text-red-300">
                <Trash2 className="w-3 h-3" /> Clear
              </button>
            </>
          )}
        </div>
        {enformionTestResult && (
          <div className={`flex items-center gap-2 text-[10px] px-2 py-1.5 rounded-sm ${
            enformionTestResult.success ? 'bg-green-950/30 border border-green-800/40 text-green-400' : 'bg-red-950/30 border border-red-800/40 text-red-400'
          }`}>
            {enformionTestResult.success ? <CheckCircle2 className="w-3.5 h-3.5" /> : <XCircle className="w-3.5 h-3.5" />}
            {enformionTestResult.message}
          </div>
        )}
      </div>

      {/* ══════ Utah DLD Credentials ══════ */}
      <div className="panel-beveled bg-surface-base p-3 space-y-3">
        <div className="flex items-center gap-2 text-[10px] font-bold text-rmpg-300 uppercase tracking-wider">
          <Key className="w-3.5 h-3.5 text-purple-400" />
          Utah DLD Credentials
          {utahStatus?.configured && <span className="text-green-400 text-[9px] ml-1">configured</span>}
        </div>
        <div className="text-[9px] text-rmpg-500">
          Requires DLD approval at <span className="font-mono text-blue-400">secure.utah.gov</span>
        </div>
        <div className="space-y-2">
          <input type="text" value={utahUser} onChange={e => setUtahUser(e.target.value)}
            placeholder={utahStatus?.configured ? 'Enter new username...' : 'Utah.gov username...'}
            autoComplete="off"
            className="w-full bg-surface-sunken border border-rmpg-600 text-rmpg-200 text-xs px-2.5 py-1.5 rounded-sm focus:border-brand-500 focus:outline-none font-mono" />
          <div className="relative">
            <input type={showUtahPass ? 'text' : 'password'} value={utahPass} onChange={e => setUtahPass(e.target.value)}
              placeholder={utahStatus?.configured ? 'Enter new password...' : 'Utah.gov password...'}
              autoComplete="new-password"
              className="w-full bg-surface-sunken border border-rmpg-600 text-rmpg-200 text-xs px-2.5 py-1.5 pr-8 rounded-sm focus:border-brand-500 focus:outline-none font-mono" />
            <button onClick={() => setShowUtahPass(!showUtahPass)} className="absolute right-2 top-1/2 -translate-y-1/2 text-rmpg-500 hover:text-rmpg-300">
              {showUtahPass ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
            </button>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={handleSaveUtahCreds} disabled={savingUtah || !utahUser.trim() || !utahPass.trim()}
            className="toolbar-btn text-[10px] flex items-center gap-1 px-3 py-1.5 bg-brand-600 hover:bg-brand-500 text-white disabled:opacity-50">
            {savingUtah ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCircle2 className="w-3 h-3" />} Save
          </button>
          {utahStatus?.configured && (
            <>
              <button onClick={handleTestUtah} disabled={testingUtah}
                className="toolbar-btn text-[10px] flex items-center gap-1 px-3 py-1.5">
                {testingUtah ? <Loader2 className="w-3 h-3 animate-spin" /> : <Zap className="w-3 h-3" />} Test
              </button>
              <button onClick={handleClearUtah}
                className="toolbar-btn text-[10px] flex items-center gap-1 px-3 py-1.5 text-red-400 hover:text-red-300">
                <Trash2 className="w-3 h-3" /> Clear
              </button>
            </>
          )}
        </div>
        {utahTestResult && (
          <div className={`flex items-center gap-2 text-[10px] px-2 py-1.5 rounded-sm ${
            utahTestResult.success ? 'bg-green-950/30 border border-green-800/40 text-green-400' : 'bg-red-950/30 border border-red-800/40 text-red-400'
          }`}>
            {utahTestResult.success ? <CheckCircle2 className="w-3.5 h-3.5" /> : <XCircle className="w-3.5 h-3.5" />}
            {utahTestResult.success ? (utahTestResult.message || 'Connected') : `Failed: ${utahTestResult.error}`}
          </div>
        )}
      </div>

      {/* ══════ UGRC Geocoding Credentials ══════ */}
      <div className="panel-beveled bg-surface-base p-3 space-y-3">
        <div className="flex items-center gap-2 text-[10px] font-bold text-rmpg-300 uppercase tracking-wider">
          <Key className="w-3.5 h-3.5 text-teal-400" />
          UGRC SGID API Key
          {ugrcS?.credentials_configured && <span className="text-green-400 text-[9px] ml-1">configured</span>}
        </div>
        <div className="text-[9px] text-rmpg-500">
          Utah SGID via <span className="font-mono text-blue-400">api.mapserv.utah.gov</span> — geocoding, 1M+ address points, business locations, parcel/tax data. Results auto-import to Properties.
        </div>
        <div className="space-y-2">
          <input type="text" value={ugrcApiKey} onChange={e => setUgrcApiKey(e.target.value)}
            placeholder={ugrcS?.credentials_configured ? 'Enter new API key to replace...' : 'UGRC API Key (e.g., UGRC-XXXXX)...'}
            autoComplete="off"
            className="w-full bg-surface-sunken border border-rmpg-600 text-rmpg-200 text-xs px-2.5 py-1.5 rounded-sm focus:border-brand-500 focus:outline-none font-mono" />
        </div>
        <div className="flex items-center gap-2">
          <button onClick={handleSaveUgrc} disabled={savingUgrc || !ugrcApiKey.trim()}
            className="toolbar-btn text-[10px] flex items-center gap-1 px-3 py-1.5 bg-brand-600 hover:bg-brand-500 text-white disabled:opacity-50">
            {savingUgrc ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCircle2 className="w-3 h-3" />} Save
          </button>
          {ugrcS?.credentials_configured && (
            <>
              <button onClick={handleTestUgrc} disabled={testingUgrc}
                className="toolbar-btn text-[10px] flex items-center gap-1 px-3 py-1.5">
                {testingUgrc ? <Loader2 className="w-3 h-3 animate-spin" /> : <Zap className="w-3 h-3" />} Test
              </button>
              <button onClick={handleClearUgrc}
                className="toolbar-btn text-[10px] flex items-center gap-1 px-3 py-1.5 text-red-400 hover:text-red-300">
                <Trash2 className="w-3 h-3" /> Clear
              </button>
            </>
          )}
        </div>
        {ugrcTestResult && (
          <div className={`flex items-center gap-2 text-[10px] px-2 py-1.5 rounded-sm ${
            ugrcTestResult.success ? 'bg-green-950/30 border border-green-800/40 text-green-400' : 'bg-red-950/30 border border-red-800/40 text-red-400'
          }`}>
            {ugrcTestResult.success ? <CheckCircle2 className="w-3.5 h-3.5" /> : <XCircle className="w-3.5 h-3.5" />}
            {ugrcTestResult.message}
          </div>
        )}
      </div>

      {/* ══════ Unified Audit Log ══════ */}
      {auditTotal > 0 && (
        <div className="panel-beveled bg-surface-base p-3 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-[10px] font-bold text-rmpg-300 uppercase tracking-wider">
              <Clock className="w-3.5 h-3.5" />
              Records Search Audit Log ({auditTotal})
            </div>
          </div>
          {loadingAudit ? (
            <div className="flex justify-center py-4"><Loader2 className="w-5 h-5 text-brand-400 animate-spin" /></div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-[10px]">
                <thead>
                  <tr className="border-b border-rmpg-700 text-rmpg-400 text-left">
                    <th className="pb-1 pr-2 font-bold">Source</th>
                    <th className="pb-1 pr-2 font-bold">Type</th>
                    <th className="pb-1 pr-2 font-bold">Input</th>
                    <th className="pb-1 pr-2 font-bold">User</th>
                    <th className="pb-1 pr-2 font-bold text-center">Hit</th>
                    <th className="pb-1 font-bold">Time</th>
                  </tr>
                </thead>
                <tbody>
                  {auditEntries.map(e => (
                    <tr key={e.id} className="border-b border-rmpg-800">
                      <td className="py-1 pr-2 font-mono text-blue-400 uppercase">{e.source}</td>
                      <td className="py-1 pr-2 font-mono text-rmpg-300 uppercase">{e.query_type}</td>
                      <td className="py-1 pr-2 font-mono text-rmpg-200 max-w-[120px] truncate">{e.query_input}</td>
                      <td className="py-1 pr-2 text-rmpg-300">{e.queried_by_name}</td>
                      <td className="py-1 pr-2 text-center">
                        {e.hit ? <span className="text-green-400 font-bold">HIT</span> :
                         e.error_msg ? <span className="text-red-400">ERR</span> :
                         <span className="text-rmpg-500">—</span>}
                      </td>
                      <td className="py-1 text-rmpg-500 whitespace-nowrap">{new Date(e.queried_at).toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {auditPages > 1 && (
            <div className="flex items-center justify-between pt-1">
              <span className="text-[10px] text-rmpg-500">Page {auditPage} of {auditPages}</span>
              <div className="flex items-center gap-1">
                <button onClick={() => setAuditPage(p => Math.max(1, p - 1))} disabled={auditPage <= 1}
                  className="toolbar-btn p-1 disabled:opacity-30"><ChevronLeft className="w-3 h-3" /></button>
                <button onClick={() => setAuditPage(p => Math.min(auditPages, p + 1))} disabled={auditPage >= auditPages}
                  className="toolbar-btn p-1 disabled:opacity-30"><ChevronRight className="w-3 h-3" /></button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
