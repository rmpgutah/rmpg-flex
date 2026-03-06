import React, { useState, useEffect, useCallback } from 'react';
import {
  Microscope, FolderOpen, Loader2, CheckCircle2, XCircle,
  Trash2, AlertTriangle, ExternalLink, ToggleLeft, ToggleRight,
  Shield, Download, HardDrive, Hash, Database, Activity,
  FileSearch, RefreshCw, Server, Settings, Play, Square,
  Eye, Upload, Clock, FileText, Search, ChevronDown, ChevronRight,
} from 'lucide-react';
import { apiFetch } from '../hooks/useApi';

// ── Types ────────────────────────────────────────────────────

interface IpedStatus {
  configured: boolean;
  installed: boolean;
  installPath: string | null;
  javaHome: string | null;
  webApiUrl: string | null;
  webApiPort: string | null;
  defaultProfile: string;
  photodnaEnabled: boolean;
  autoHashOnUpload: boolean;
  hashSetsPath: string | null;
  totalJobs: number;
  completedJobs: number;
  runningJobs: number;
  failedJobs: number;
  totalHashes: number;
  flaggedHashes: number;
  hashSetCount: number;
}

interface ValidationResult {
  valid: boolean;
  ipedFound: boolean;
  javaFound: boolean;
  ipedVersion: string | null;
  javaVersion: string | null;
  platform: string;
  errors: string[];
}

interface DownloadInfo {
  available: boolean;
  bundles: {
    mac?: { filename: string; version: string; size: number };
    win?: { filename: string; version: string; size: number };
    linux?: { filename: string; version: string; size: number };
  };
  downloadUrl: string;
  githubUrl: string;
}

interface HashSetInfo {
  name: string;
  category: string;
  count: number;
}

interface IpedJob {
  id: number;
  evidence_id: number | null;
  job_type: string;
  status: string;
  profile: string;
  input_path: string;
  output_path: string | null;
  progress_percent: number;
  items_found: number;
  items_processed: number;
  error_message: string | null;
  result_summary: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
}

interface HashResult {
  id: number;
  evidence_id: number;
  file_name: string;
  file_size: number;
  md5: string | null;
  sha256: string | null;
  photodna_hash: string | null;
  phash: string | null;
  flagged: boolean;
  flag_reason: string | null;
  hash_set_match: boolean;
  hash_set_name: string | null;
  created_at: string;
}

const PROFILES = [
  { id: 'forensic', label: 'Forensic (Full)', desc: 'Complete analysis — all parsers, hash computation, file carving' },
  { id: 'csam', label: 'CSAM Detection', desc: 'PhotoDNA + nudity detection + hash set matching' },
  { id: 'triage', label: 'Triage (Fast)', desc: 'Quick scan — metadata extraction, known file filtering' },
  { id: 'fastmode', label: 'Fast Mode', desc: 'File system metadata only — fastest for large media' },
  { id: 'blind', label: 'Blind', desc: 'No file system structure — useful for raw/carved images' },
];

// ── Collapsible Section Component ────────────────────────────

function Section({ title, icon: Icon, defaultOpen = true, badge, children }: {
  title: string;
  icon: React.ElementType;
  defaultOpen?: boolean;
  badge?: React.ReactNode;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="panel-beveled bg-surface-base overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-2 px-3 py-2 hover:bg-rmpg-800/20 transition-colors"
      >
        {open ? <ChevronDown className="w-3 h-3 text-rmpg-500" /> : <ChevronRight className="w-3 h-3 text-rmpg-500" />}
        <Icon className="w-3.5 h-3.5 text-brand-400" />
        <span className="text-[10px] font-bold text-rmpg-300 uppercase tracking-wider">{title}</span>
        {badge}
      </button>
      {open && <div className="px-3 pb-3 space-y-3">{children}</div>}
    </div>
  );
}

// ── Main Forensics Page ──────────────────────────────────────

export default function ForensicsPage() {
  const [status, setStatus] = useState<IpedStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Config form
  const [installPath, setInstallPath] = useState('');
  const [javaHome, setJavaHome] = useState('');
  const [webApiUrl, setWebApiUrl] = useState('');
  const [webApiPort, setWebApiPort] = useState('');
  const [defaultProfile, setDefaultProfile] = useState('forensic');
  const [photoDnaEnabled, setPhotoDnaEnabled] = useState(false);
  const [autoHash, setAutoHash] = useState(false);
  const [hashSetsPath, setHashSetsPath] = useState('');
  const [saving, setSaving] = useState(false);

  // Validation
  const [validating, setValidating] = useState(false);
  const [validationResult, setValidationResult] = useState<ValidationResult | null>(null);

  // API test
  const [testingApi, setTestingApi] = useState(false);
  const [apiTestResult, setApiTestResult] = useState<{ success: boolean; message?: string } | null>(null);

  // Downloads
  const [downloads, setDownloads] = useState<DownloadInfo | null>(null);

  // Hash sets
  const [hashSets, setHashSets] = useState<HashSetInfo[]>([]);

  // Jobs
  const [jobs, setJobs] = useState<IpedJob[]>([]);
  const [loadingJobs, setLoadingJobs] = useState(false);

  // Hash results
  const [hashResults, setHashResults] = useState<HashResult[]>([]);
  const [loadingHashes, setLoadingHashes] = useState(false);

  // Active tab
  const [activeTab, setActiveTab] = useState<'overview' | 'config' | 'jobs' | 'hashes' | 'cases'>('overview');

  // ── Fetchers ─────────────────────────────────────────────

  const fetchStatus = useCallback(async () => {
    try {
      const data = await apiFetch<IpedStatus>('/iped/status');
      setStatus(data);
      if (data.defaultProfile) setDefaultProfile(data.defaultProfile);
      setPhotoDnaEnabled(!!data.photodnaEnabled);
      setAutoHash(!!data.autoHashOnUpload);

      // Auto-validate when configured + installed
      if (data.configured && data.installed) {
        try {
          const result = await apiFetch<ValidationResult>('/iped/validate', { method: 'POST' });
          setValidationResult(result);
        } catch { /* non-critical */ }
      }
    } catch (err) {
      console.error('IPED status fetch failed:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchDownloads = useCallback(async () => {
    try {
      const data = await apiFetch<DownloadInfo>('/iped/download/info');
      setDownloads(data);
    } catch { /* non-critical */ }
  }, []);

  const fetchHashSets = useCallback(async () => {
    try {
      const data = await apiFetch<{ sets: HashSetInfo[] }>('/iped/hash-sets');
      setHashSets(data.sets || []);
    } catch { /* non-critical */ }
  }, []);

  const fetchJobs = useCallback(async () => {
    setLoadingJobs(true);
    try {
      const data = await apiFetch<{ jobs: IpedJob[]; total: number }>('/iped/jobs?limit=50');
      setJobs(data.jobs || []);
    } catch { /* non-critical */ }
    finally { setLoadingJobs(false); }
  }, []);

  const fetchHashResults = useCallback(async () => {
    setLoadingHashes(true);
    try {
      const data = await apiFetch<{ results: HashResult[]; total: number }>('/iped/hash/results?limit=50');
      setHashResults(data.results || []);
    } catch { /* non-critical */ }
    finally { setLoadingHashes(false); }
  }, []);

  useEffect(() => {
    fetchStatus();
    fetchDownloads();
    fetchHashSets();
  }, [fetchStatus, fetchDownloads, fetchHashSets]);

  // Fetch tab-specific data
  useEffect(() => {
    if (activeTab === 'jobs') fetchJobs();
    if (activeTab === 'hashes') fetchHashResults();
  }, [activeTab, fetchJobs, fetchHashResults]);

  // ── Config Handlers ──────────────────────────────────────

  const handleSaveConfig = async () => {
    setSaving(true);
    setValidationResult(null);
    try {
      await apiFetch('/iped/config', {
        method: 'PUT',
        body: JSON.stringify({
          installPath: installPath.trim() || undefined,
          javaHome: javaHome.trim() || undefined,
          webApiUrl: webApiUrl.trim() || undefined,
          webApiPort: webApiPort.trim() || undefined,
          defaultProfile,
          photodnaEnabled: photoDnaEnabled,
          autoHashOnUpload: autoHash,
          hashSetsPath: hashSetsPath.trim() || undefined,
        }),
      });
      setInstallPath('');
      setJavaHome('');
      setWebApiUrl('');
      setWebApiPort('');
      setHashSetsPath('');
      await fetchStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save config');
    } finally {
      setSaving(false);
    }
  };

  const handleClear = async () => {
    try {
      await apiFetch('/iped/config', { method: 'DELETE' });
      setValidationResult(null);
      setApiTestResult(null);
      await fetchStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to clear config');
    }
  };

  const handleValidate = async () => {
    setValidating(true);
    setValidationResult(null);
    try {
      const result = await apiFetch<ValidationResult>('/iped/validate', { method: 'POST' });
      setValidationResult(result);
      await fetchStatus();
    } catch (err) {
      setValidationResult({
        valid: false, ipedFound: false, javaFound: false,
        ipedVersion: null, javaVersion: null, platform: 'unknown',
        errors: [err instanceof Error ? err.message : 'Validation failed'],
      });
    } finally {
      setValidating(false);
    }
  };

  const handleTestApi = async () => {
    setTestingApi(true);
    setApiTestResult(null);
    try {
      const result = await apiFetch<{ success: boolean; message: string }>('/iped/test-api', { method: 'POST' });
      setApiTestResult(result);
    } catch (err) {
      setApiTestResult({ success: false, message: err instanceof Error ? err.message : 'API test failed' });
    } finally {
      setTestingApi(false);
    }
  };

  const handleToggle = async (key: 'photodnaEnabled' | 'autoHashOnUpload', current: boolean, setter: (v: boolean) => void) => {
    const newVal = !current;
    setter(newVal);
    if (status?.configured) {
      try {
        await apiFetch('/iped/config', {
          method: 'PUT',
          body: JSON.stringify({ [key]: newVal }),
        });
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to update setting');
        setter(current);
      }
    }
  };

  const handleProfileChange = async (profile: string) => {
    setDefaultProfile(profile);
    if (status?.configured) {
      try {
        await apiFetch('/iped/config', {
          method: 'PUT',
          body: JSON.stringify({ defaultProfile: profile }),
        });
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to update profile');
      }
    }
  };

  const handleCancelJob = async (jobId: number) => {
    try {
      await apiFetch(`/iped/jobs/${jobId}/cancel`, { method: 'POST' });
      await fetchJobs();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to cancel job');
    }
  };

  // ── Render ───────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="w-6 h-6 animate-spin text-brand-400" />
      </div>
    );
  }

  const isConnected = status?.configured && status?.installed;

  return (
    <div className="h-full flex flex-col overflow-hidden bg-rmpg-950">
      {/* ── Page Header ──────────────────────────────────────── */}
      <div className="shrink-0 px-4 py-3 border-b border-rmpg-800 bg-surface-base">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-md bg-brand-600/20 border border-brand-600/30">
              <Microscope className="w-5 h-5 text-brand-400" />
            </div>
            <div>
              <h1 className="text-sm font-bold text-rmpg-100 flex items-center gap-2">
                IPED Digital Forensics
                {isConnected ? (
                  <span className="flex items-center gap-1 text-green-400 text-[10px] font-normal">
                    <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
                    CONNECTED
                    {validationResult?.ipedVersion && (
                      <span className="text-rmpg-400">v{validationResult.ipedVersion}</span>
                    )}
                  </span>
                ) : status?.configured ? (
                  <span className="flex items-center gap-1 text-amber-400 text-[10px] font-normal">
                    <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
                    PATH NOT FOUND
                  </span>
                ) : (
                  <span className="flex items-center gap-1 text-rmpg-500 text-[10px] font-normal">
                    <span className="w-1.5 h-1.5 rounded-full bg-rmpg-500" />
                    NOT CONFIGURED
                  </span>
                )}
              </h1>
              <p className="text-[10px] text-rmpg-500">
                Evidence processing, hash computation, PhotoDNA, and forensic analysis
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <a
              href="https://github.com/sepinf-inc/IPED"
              target="_blank"
              rel="noopener noreferrer"
              className="toolbar-btn text-[10px] flex items-center gap-1 px-2.5 py-1"
            >
              <ExternalLink className="w-3 h-3" />
              IPED GitHub
            </a>
            <button
              onClick={() => { fetchStatus(); fetchHashSets(); fetchJobs(); fetchHashResults(); }}
              className="toolbar-btn text-[10px] flex items-center gap-1 px-2.5 py-1"
            >
              <RefreshCw className="w-3 h-3" />
              Refresh
            </button>
          </div>
        </div>

        {/* Tab bar */}
        <div className="flex items-center gap-0.5 mt-3 -mb-[1px]">
          {([
            { id: 'overview', label: 'Overview', icon: Activity },
            { id: 'config', label: 'Configuration', icon: Settings },
            { id: 'jobs', label: 'Processing Jobs', icon: Play },
            { id: 'hashes', label: 'Hash Results', icon: Hash },
            { id: 'cases', label: 'Case Browser', icon: FileSearch },
          ] as const).map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-medium rounded-t-sm border-b-2 transition-colors ${
                activeTab === tab.id
                  ? 'text-brand-400 border-brand-500 bg-rmpg-900/50'
                  : 'text-rmpg-500 border-transparent hover:text-rmpg-300 hover:border-rmpg-600'
              }`}
            >
              <tab.icon className="w-3 h-3" />
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Error banner */}
      {error && (
        <div className="shrink-0 px-4 py-2 bg-red-950/30 border-b border-red-800/40 flex items-center justify-between">
          <span className="text-[10px] text-red-400">{error}</span>
          <button onClick={() => setError(null)} className="text-red-400 hover:text-red-300 text-[10px]">dismiss</button>
        </div>
      )}

      {/* ── Content Area ─────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">

        {/* ═══ OVERVIEW TAB ═══ */}
        {activeTab === 'overview' && (
          <>
            {/* Stats grid */}
            <div className="grid grid-cols-6 gap-2">
              {[
                { label: 'Status', value: isConnected ? 'Online' : 'Offline', icon: Shield, color: isConnected ? 'text-green-400' : 'text-rmpg-500' },
                { label: 'Total Jobs', value: status?.totalJobs ?? 0, icon: Database, color: 'text-rmpg-200' },
                { label: 'Completed', value: status?.completedJobs ?? 0, icon: CheckCircle2, color: 'text-green-400' },
                { label: 'Running', value: status?.runningJobs ?? 0, icon: Loader2, color: 'text-blue-400' },
                { label: 'Total Hashes', value: status?.totalHashes ?? 0, icon: Hash, color: 'text-rmpg-200' },
                { label: 'Flagged', value: status?.flaggedHashes ?? 0, icon: AlertTriangle, color: (status?.flaggedHashes ?? 0) > 0 ? 'text-red-400' : 'text-rmpg-500' },
              ].map(stat => (
                <div key={stat.label} className="panel-beveled bg-surface-base p-3 text-center">
                  <stat.icon className={`w-4 h-4 mx-auto mb-1.5 ${stat.color}`} />
                  <div className={`text-lg font-bold ${stat.color}`}>{stat.value}</div>
                  <div className="text-[9px] text-rmpg-500 uppercase mt-0.5">{stat.label}</div>
                </div>
              ))}
            </div>

            {/* Validation info */}
            {validationResult?.valid && (
              <div className="flex items-center gap-2 text-[10px] px-3 py-2 rounded-sm bg-green-950/30 border border-green-800/40 text-green-400">
                <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                IPED v{validationResult.ipedVersion || 'unknown'} validated — Java {validationResult.javaVersion || 'unknown'} — {validationResult.platform}
                {status?.installPath && <span className="text-rmpg-500 ml-2 font-mono">{status.installPath}</span>}
              </div>
            )}

            {/* Running jobs alert */}
            {(status?.runningJobs ?? 0) > 0 && (
              <div className="flex items-center gap-2 text-[10px] px-3 py-2 rounded-sm bg-blue-950/30 border border-blue-800/40 text-blue-400">
                <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
                {status!.runningJobs} processing job(s) currently running
              </div>
            )}

            {/* Flagged alert */}
            {(status?.flaggedHashes ?? 0) > 0 && (
              <div className="flex items-center gap-2 text-[10px] px-3 py-2 rounded-sm bg-red-950/30 border border-red-800/40 text-red-400">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                {status!.flaggedHashes} flagged hash(es) require review
                <button
                  onClick={() => setActiveTab('hashes')}
                  className="ml-auto underline hover:no-underline"
                >
                  View Hashes →
                </button>
              </div>
            )}

            {/* Two-tier info */}
            <div className="grid grid-cols-2 gap-3">
              <div className="panel-beveled bg-surface-base p-3 space-y-2">
                <div className="flex items-center gap-2 text-[10px] font-bold text-rmpg-300 uppercase tracking-wider">
                  <FileSearch className="w-3.5 h-3.5" />
                  Tier 1 — Built-in Hashing
                </div>
                <div className="text-[9px] text-rmpg-500 leading-relaxed">
                  <strong className="text-green-400">Always Available</strong> — MD5, SHA-1, SHA-256, SHA-512 cryptographic hashes
                  + content fingerprint for perceptual similarity. Works on any evidence file immediately — no external software.
                </div>
              </div>
              <div className="panel-beveled bg-surface-base p-3 space-y-2">
                <div className="flex items-center gap-2 text-[10px] font-bold text-rmpg-300 uppercase tracking-wider">
                  <Microscope className="w-3.5 h-3.5" />
                  Tier 2 — IPED Processing
                </div>
                <div className="text-[9px] text-rmpg-500 leading-relaxed">
                  <strong className={isConnected ? 'text-green-400' : 'text-amber-400'}>
                    {isConnected ? 'Available' : 'Requires IPED Installation'}
                  </strong> — PhotoDNA perceptual hashing, full disk image processing, file carving, face recognition, OCR,
                  nudity detection, and advanced forensic analysis.
                </div>
              </div>
            </div>

            {/* Hash sets summary */}
            <Section title="Hash Sets" icon={Hash} badge={
              <span className="ml-1 text-[10px] text-brand-400">({hashSets.length} loaded)</span>
            }>
              {hashSets.length > 0 ? (
                <div className="space-y-0.5 max-h-40 overflow-y-auto">
                  {hashSets.map(hs => (
                    <div key={hs.name} className="flex items-center justify-between px-2 py-1.5 bg-surface-sunken rounded-sm">
                      <div className="flex-1 min-w-0">
                        <div className="text-[10px] font-medium text-rmpg-200">{hs.name}</div>
                        <div className="text-[9px] text-rmpg-500">{hs.category} • {(hs.count || 0).toLocaleString()} entries</div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-[9px] text-rmpg-600 bg-surface-sunken p-2 rounded-sm">
                  No hash sets loaded. Import NSRL, ProjectVIC, or CSV hash sets via Configuration tab.
                </div>
              )}
            </Section>

            {/* Not configured hint */}
            {!status?.configured && (
              <div className="flex items-center gap-2 text-[10px] text-rmpg-500 bg-surface-sunken p-3 rounded-sm">
                <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0" />
                <div>
                  Set the IPED installation path in the{' '}
                  <button onClick={() => setActiveTab('config')} className="text-brand-400 hover:text-brand-300 underline">
                    Configuration
                  </button>{' '}tab to enable Tier 2 forensic processing.
                  Tier 1 hashing (MD5/SHA/content fingerprint) works immediately.
                </div>
              </div>
            )}
          </>
        )}

        {/* ═══ CONFIGURATION TAB ═══ */}
        {activeTab === 'config' && (
          <>
            {/* Installation Paths */}
            <Section title="Installation Paths" icon={FolderOpen}>
              <div className="space-y-1.5">
                <label className="text-[10px] text-rmpg-400">IPED Installation Path</label>
                <input
                  type="text"
                  value={installPath}
                  onChange={(e) => setInstallPath(e.target.value)}
                  placeholder={status?.installPath || '/path/to/IPED (directory containing iped.jar)'}
                  className="w-full bg-surface-sunken border border-rmpg-600 text-rmpg-200 text-xs px-2.5 py-1.5 rounded-sm focus:border-brand-500 focus:outline-none font-mono"
                />
                {status?.installPath && (
                  <div className="text-[9px] text-rmpg-500 font-mono">Current: {status.installPath}</div>
                )}
              </div>

              <div className="space-y-1.5">
                <label className="text-[10px] text-rmpg-400">Java Home <span className="text-rmpg-600">(JDK 11+ required)</span></label>
                <input
                  type="text"
                  value={javaHome}
                  onChange={(e) => setJavaHome(e.target.value)}
                  placeholder={status?.javaHome || '/path/to/jdk'}
                  className="w-full bg-surface-sunken border border-rmpg-600 text-rmpg-200 text-xs px-2.5 py-1.5 rounded-sm focus:border-brand-500 focus:outline-none font-mono"
                />
                {validationResult?.javaVersion && (
                  <div className="text-[9px] text-green-500">Java {validationResult.javaVersion}</div>
                )}
              </div>

              <div className="flex items-center gap-2 flex-wrap">
                <button
                  onClick={handleSaveConfig}
                  disabled={saving}
                  className="toolbar-btn text-[10px] flex items-center gap-1 px-3 py-1.5 bg-brand-600 hover:bg-brand-500 text-white disabled:opacity-50"
                >
                  {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCircle2 className="w-3 h-3" />}
                  Save Config
                </button>
                {status?.configured && (
                  <>
                    <button onClick={handleValidate} disabled={validating}
                      className="toolbar-btn text-[10px] flex items-center gap-1 px-3 py-1.5">
                      {validating ? <Loader2 className="w-3 h-3 animate-spin" /> : <Shield className="w-3 h-3" />}
                      Validate Installation
                    </button>
                    <button onClick={handleClear}
                      className="toolbar-btn text-[10px] flex items-center gap-1 px-3 py-1.5 text-red-400 hover:text-red-300">
                      <Trash2 className="w-3 h-3" />
                      Clear
                    </button>
                  </>
                )}
              </div>

              {validationResult && (
                <div className={`flex items-center gap-2 text-[10px] px-2 py-1.5 rounded-sm ${
                  validationResult.valid
                    ? 'bg-green-950/30 border border-green-800/40 text-green-400'
                    : 'bg-red-950/30 border border-red-800/40 text-red-400'
                }`}>
                  {validationResult.valid ? <CheckCircle2 className="w-3.5 h-3.5" /> : <XCircle className="w-3.5 h-3.5" />}
                  {validationResult.valid
                    ? `IPED v${validationResult.ipedVersion || 'unknown'} validated (Java ${validationResult.javaVersion || 'unknown'}) — ${validationResult.platform}`
                    : `Validation failed: ${validationResult.errors?.join(', ') || 'Unknown error'}`
                  }
                </div>
              )}
            </Section>

            {/* Download Bundles */}
            <Section title="IPED Bundles" icon={Download} defaultOpen={false}>
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-surface-sunken p-2.5 rounded-sm">
                  <div className="text-[10px] font-bold text-rmpg-200 mb-1">macOS Bundle</div>
                  {downloads?.bundles?.mac ? (
                    <>
                      <div className="text-[9px] text-rmpg-400 font-mono mb-1.5">{downloads.bundles.mac.filename}</div>
                      <div className="text-[9px] text-rmpg-500 mb-2">v{downloads.bundles.mac.version} • {(downloads.bundles.mac.size / 1048576).toFixed(0)} MB</div>
                      <a href={`/downloads/${downloads.bundles.mac.filename}`}
                        className="toolbar-btn text-[10px] flex items-center gap-1 px-2.5 py-1 bg-brand-600 hover:bg-brand-500 text-white inline-flex">
                        <Download className="w-3 h-3" />
                        Download
                      </a>
                    </>
                  ) : (
                    <div className="text-[9px] text-rmpg-600">
                      No macOS bundle available. Place <span className="font-mono text-rmpg-400">IPED-x.x.x-mac.zip</span> in server/downloads/
                    </div>
                  )}
                </div>
                <div className="bg-surface-sunken p-2.5 rounded-sm">
                  <div className="text-[10px] font-bold text-rmpg-200 mb-1">Windows Bundle</div>
                  {downloads?.bundles?.win ? (
                    <>
                      <div className="text-[9px] text-rmpg-400 font-mono mb-1.5">{downloads.bundles.win.filename}</div>
                      <div className="text-[9px] text-rmpg-500 mb-2">v{downloads.bundles.win.version} • {(downloads.bundles.win.size / 1048576).toFixed(0)} MB</div>
                      <a href={`/downloads/${downloads.bundles.win.filename}`}
                        className="toolbar-btn text-[10px] flex items-center gap-1 px-2.5 py-1 bg-brand-600 hover:bg-brand-500 text-white inline-flex">
                        <Download className="w-3 h-3" />
                        Download
                      </a>
                    </>
                  ) : (
                    <div className="text-[9px] text-rmpg-600">
                      No Windows bundle available. Place <span className="font-mono text-rmpg-400">IPED-x.x.x-win.zip</span> in server/downloads/
                    </div>
                  )}
                </div>
              </div>
              <div className="text-[9px] text-rmpg-600">
                Bundles include IPED + Liberica JDK 11. Download from{' '}
                <a href="https://github.com/sepinf-inc/IPED/releases" target="_blank" rel="noopener noreferrer"
                  className="text-brand-400 hover:text-brand-300 underline">IPED Releases</a>.
              </div>
            </Section>

            {/* Processing Configuration */}
            <Section title="Processing Configuration" icon={HardDrive}>
              <div className="space-y-1.5">
                <label className="text-[10px] text-rmpg-400">Default Processing Profile</label>
                <div className="space-y-0.5">
                  {PROFILES.map(p => (
                    <button
                      key={p.id}
                      onClick={() => handleProfileChange(p.id)}
                      className="w-full flex items-center gap-2 px-2 py-1.5 rounded-sm text-left transition-colors hover:bg-rmpg-800/30"
                      style={{
                        background: defaultProfile === p.id ? 'rgba(188, 16, 16, 0.08)' : undefined,
                        border: defaultProfile === p.id ? '1px solid rgba(188, 16, 16, 0.25)' : '1px solid transparent',
                      }}
                    >
                      <div className={`w-2 h-2 rounded-full shrink-0 ${defaultProfile === p.id ? 'bg-brand-400' : 'bg-rmpg-700'}`} />
                      <div className="flex-1 min-w-0">
                        <div className={`text-[10px] font-medium ${defaultProfile === p.id ? 'text-rmpg-100' : 'text-rmpg-300'}`}>{p.label}</div>
                        <div className="text-[9px] text-rmpg-500 truncate">{p.desc}</div>
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-1">
                <button onClick={() => handleToggle('photodnaEnabled', photoDnaEnabled, setPhotoDnaEnabled)}
                  className="w-full flex items-center gap-2 px-2 py-1.5 rounded-sm text-left transition-colors hover:bg-rmpg-800/30">
                  {photoDnaEnabled ? <ToggleRight className="w-5 h-5 text-brand-400" /> : <ToggleLeft className="w-5 h-5 text-rmpg-600" />}
                  <div className="flex-1 min-w-0">
                    <div className={`text-[10px] font-medium ${photoDnaEnabled ? 'text-rmpg-100' : 'text-rmpg-300'}`}>PhotoDNA Matching</div>
                    <div className="text-[9px] text-rmpg-500">Requires IPED with PhotoDNA module (law enforcement only — contact iped@pf.gov.br)</div>
                  </div>
                </button>
                <button onClick={() => handleToggle('autoHashOnUpload', autoHash, setAutoHash)}
                  className="w-full flex items-center gap-2 px-2 py-1.5 rounded-sm text-left transition-colors hover:bg-rmpg-800/30">
                  {autoHash ? <ToggleRight className="w-5 h-5 text-brand-400" /> : <ToggleLeft className="w-5 h-5 text-rmpg-600" />}
                  <div className="flex-1 min-w-0">
                    <div className={`text-[10px] font-medium ${autoHash ? 'text-rmpg-100' : 'text-rmpg-300'}`}>Auto-Hash Evidence Uploads</div>
                    <div className="text-[9px] text-rmpg-500">Automatically compute MD5/SHA-256 + content fingerprint when evidence attachments are uploaded</div>
                  </div>
                </button>
              </div>

              <div className="space-y-1.5">
                <label className="text-[10px] text-rmpg-400">IPED Web API <span className="text-rmpg-600">(optional — for case browsing)</span></label>
                <div className="flex gap-2">
                  <input type="text" value={webApiUrl} onChange={(e) => setWebApiUrl(e.target.value)}
                    placeholder={status?.webApiUrl || 'http://localhost'}
                    className="flex-1 bg-surface-sunken border border-rmpg-600 text-rmpg-200 text-xs px-2.5 py-1.5 rounded-sm focus:border-brand-500 focus:outline-none font-mono" />
                  <input type="text" value={webApiPort} onChange={(e) => setWebApiPort(e.target.value)}
                    placeholder={status?.webApiPort || '11111'}
                    className="w-20 bg-surface-sunken border border-rmpg-600 text-rmpg-200 text-xs px-2.5 py-1.5 rounded-sm focus:border-brand-500 focus:outline-none font-mono text-center" />
                </div>
                {status?.configured && (
                  <div className="flex items-center gap-2">
                    <button onClick={handleTestApi} disabled={testingApi}
                      className="toolbar-btn text-[10px] flex items-center gap-1 px-2.5 py-1">
                      {testingApi ? <Loader2 className="w-3 h-3 animate-spin" /> : <Server className="w-3 h-3" />}
                      Test API
                    </button>
                    {apiTestResult && (
                      <span className={`text-[10px] ${apiTestResult.success ? 'text-green-400' : 'text-red-400'}`}>
                        {apiTestResult.message}
                      </span>
                    )}
                  </div>
                )}
              </div>
            </Section>

            {/* Hash Sets Management */}
            <Section title="Hash Sets" icon={Hash} badge={
              <span className="ml-1 text-[10px] text-brand-400">({hashSets.length} loaded)</span>
            }>
              <div className="flex items-center gap-2 mb-2">
                <input type="text" value={hashSetsPath} onChange={(e) => setHashSetsPath(e.target.value)}
                  placeholder="Path to NSRL/CSV hash set file..."
                  className="flex-1 bg-surface-sunken border border-rmpg-600 text-rmpg-200 text-[10px] px-2 py-1 rounded-sm focus:border-brand-500 focus:outline-none font-mono" />
              </div>
              {hashSets.length > 0 ? (
                <div className="space-y-0.5 max-h-40 overflow-y-auto">
                  {hashSets.map(hs => (
                    <div key={hs.name} className="flex items-center justify-between px-2 py-1.5 bg-surface-sunken rounded-sm">
                      <div className="flex-1 min-w-0">
                        <div className="text-[10px] font-medium text-rmpg-200">{hs.name}</div>
                        <div className="text-[9px] text-rmpg-500">{hs.category} • {(hs.count || 0).toLocaleString()} entries</div>
                      </div>
                      <button onClick={async () => {
                        try { await apiFetch(`/iped/hash-sets/${encodeURIComponent(hs.name)}`, { method: 'DELETE' }); await fetchHashSets(); }
                        catch (err) { setError(err instanceof Error ? err.message : 'Failed to remove hash set'); }
                      }} className="text-rmpg-600 hover:text-red-400 shrink-0 ml-2">
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-[9px] text-rmpg-600 bg-surface-sunken p-2 rounded-sm">
                  No hash sets loaded. Import NSRL, ProjectVIC, or CSV hash sets. Supported: CSV with md5/sha1/sha256 columns.
                </div>
              )}
            </Section>
          </>
        )}

        {/* ═══ PROCESSING JOBS TAB ═══ */}
        {activeTab === 'jobs' && (
          <>
            <div className="flex items-center justify-between mb-2">
              <span className="text-[10px] text-rmpg-400">{jobs.length} job(s)</span>
              <button onClick={fetchJobs} disabled={loadingJobs}
                className="toolbar-btn text-[10px] flex items-center gap-1 px-2.5 py-1">
                {loadingJobs ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
                Refresh
              </button>
            </div>
            {jobs.length > 0 ? (
              <div className="space-y-1">
                {jobs.map(job => (
                  <div key={job.id} className="panel-beveled bg-surface-base p-2.5 flex items-center gap-3">
                    <div className={`w-2 h-2 rounded-full shrink-0 ${
                      job.status === 'completed' ? 'bg-green-400' :
                      job.status === 'running' ? 'bg-blue-400 animate-pulse' :
                      job.status === 'failed' ? 'bg-red-400' :
                      job.status === 'cancelled' ? 'bg-amber-400' : 'bg-rmpg-500'
                    }`} />
                    <div className="flex-1 min-w-0">
                      <div className="text-[10px] font-medium text-rmpg-200">
                        Job #{job.id} — {job.job_type.toUpperCase()} ({job.profile})
                      </div>
                      <div className="text-[9px] text-rmpg-500 truncate font-mono">{job.input_path}</div>
                      {job.status === 'running' && (
                        <div className="mt-1 h-1 bg-rmpg-700 rounded-full overflow-hidden">
                          <div className="h-full bg-brand-500 rounded-full transition-all" style={{ width: `${job.progress_percent}%` }} />
                        </div>
                      )}
                    </div>
                    <div className="text-right shrink-0">
                      <div className={`text-[10px] font-bold uppercase ${
                        job.status === 'completed' ? 'text-green-400' :
                        job.status === 'running' ? 'text-blue-400' :
                        job.status === 'failed' ? 'text-red-400' : 'text-rmpg-500'
                      }`}>{job.status}</div>
                      <div className="text-[9px] text-rmpg-500">{job.items_processed}/{job.items_found} items</div>
                    </div>
                    {job.status === 'running' && (
                      <button onClick={() => handleCancelJob(job.id)}
                        className="toolbar-btn text-[10px] flex items-center gap-1 px-2 py-1 text-red-400 hover:text-red-300">
                        <Square className="w-3 h-3" />
                        Cancel
                      </button>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-8 text-rmpg-500">
                <Play className="w-8 h-8 mx-auto mb-2 text-rmpg-600" />
                <div className="text-[10px]">No processing jobs yet</div>
                <div className="text-[9px] text-rmpg-600 mt-1">Jobs are created when evidence is processed through IPED</div>
              </div>
            )}
          </>
        )}

        {/* ═══ HASH RESULTS TAB ═══ */}
        {activeTab === 'hashes' && (
          <>
            <div className="flex items-center justify-between mb-2">
              <span className="text-[10px] text-rmpg-400">{hashResults.length} result(s)</span>
              <button onClick={fetchHashResults} disabled={loadingHashes}
                className="toolbar-btn text-[10px] flex items-center gap-1 px-2.5 py-1">
                {loadingHashes ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
                Refresh
              </button>
            </div>
            {hashResults.length > 0 ? (
              <div className="space-y-1">
                {hashResults.map(hr => (
                  <div key={hr.id} className={`panel-beveled bg-surface-base p-2.5 flex items-center gap-3 ${
                    hr.flagged ? 'border-l-2 border-l-red-500' : ''
                  }`}>
                    <Hash className={`w-3.5 h-3.5 shrink-0 ${hr.flagged ? 'text-red-400' : 'text-rmpg-500'}`} />
                    <div className="flex-1 min-w-0">
                      <div className="text-[10px] font-medium text-rmpg-200 truncate">{hr.file_name}</div>
                      <div className="text-[9px] text-rmpg-500 font-mono truncate">
                        MD5: {hr.md5 || '—'} | SHA-256: {hr.sha256?.substring(0, 16) || '—'}...
                      </div>
                    </div>
                    {hr.flagged && (
                      <span className="text-[9px] bg-red-950/50 border border-red-800/40 text-red-400 px-1.5 py-0.5 rounded-sm font-bold">
                        FLAGGED
                      </span>
                    )}
                    {hr.hash_set_match && (
                      <span className="text-[9px] bg-amber-950/50 border border-amber-800/40 text-amber-400 px-1.5 py-0.5 rounded-sm">
                        {hr.hash_set_name || 'MATCH'}
                      </span>
                    )}
                    <div className="text-[9px] text-rmpg-500 shrink-0">
                      {(hr.file_size / 1024).toFixed(1)} KB
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-8 text-rmpg-500">
                <Hash className="w-8 h-8 mx-auto mb-2 text-rmpg-600" />
                <div className="text-[10px]">No hash results yet</div>
                <div className="text-[9px] text-rmpg-600 mt-1">Hash results appear after computing hashes on evidence files</div>
              </div>
            )}
          </>
        )}

        {/* ═══ CASE BROWSER TAB ═══ */}
        {activeTab === 'cases' && (
          <div className="text-center py-8 text-rmpg-500">
            <FileSearch className="w-8 h-8 mx-auto mb-2 text-rmpg-600" />
            <div className="text-[10px]">IPED Case Browser</div>
            <div className="text-[9px] text-rmpg-600 mt-1">
              {isConnected
                ? 'Configure the IPED Web API URL in the Configuration tab to browse processed cases.'
                : 'IPED must be installed and a Web API connection configured to browse cases.'
              }
            </div>
            {status?.webApiUrl && (
              <div className="text-[9px] text-rmpg-500 mt-2 font-mono">
                API: {status.webApiUrl}:{status.webApiPort}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
