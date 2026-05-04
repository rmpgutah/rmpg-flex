import React, { useState, useEffect, useCallback } from 'react';
import {
  Microscope,
  FolderOpen,
  Loader2,
  CheckCircle2,
  XCircle,
  Trash2,
  AlertTriangle,
  ExternalLink,
  ToggleLeft,
  ToggleRight,
  Shield,
  Download,
  HardDrive,
  Hash,
  Database,
  Activity,
  FileSearch,
  RefreshCw,
  Server,
} from 'lucide-react';
import { apiFetch } from '../../hooks/useApi';

interface Props {
  LoadingSpinner: React.FC;
  error: string | null;
  setError: (e: string | null) => void;
}

interface IpedStatus {
  configured: boolean;
  installed: boolean;
  installPath: string | null;
  javaHome: string | null;
  javaVersion?: string;
  webApiUrl: string | null;
  webApiPort: string | null;
  defaultProfile: string;
  photodnaEnabled: boolean;
  autoHashOnUpload: boolean;
  hashSetsPath: string | null;
  // Usage stats merged in from /iped/status
  totalJobs: number;
  completedJobs: number;
  runningJobs: number;
  failedJobs: number;
  totalHashes: number;
  flaggedHashes: number;
  hashSetCount: number;
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

const PROFILES = [
  { id: 'forensic', label: 'Forensic (Full)', desc: 'Complete analysis — all parsers, hash computation, file carving' },
  { id: 'csam', label: 'CSAM Detection', desc: 'PhotoDNA + nudity detection + hash set matching — optimized for CSAM investigations' },
  { id: 'triage', label: 'Triage (Fast)', desc: 'Quick scan — metadata extraction, known file filtering, hash computation' },
  { id: 'fastmode', label: 'Fast Mode', desc: 'Processes only file system metadata — fastest option for large media' },
  { id: 'blind', label: 'Blind', desc: 'Processes data without file system structure — useful for raw/carved images' },
];

export default function AdminIPEDTab({ LoadingSpinner, error, setError }: Props) {
  // Status
  const [status, setStatus] = useState<IpedStatus | null>(null);
  const [loading, setLoading] = useState(true);

  // Config inputs
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
  const [validationResult, setValidationResult] = useState<{
    valid: boolean; ipedFound: boolean; javaFound: boolean;
    ipedVersion: string | null; javaVersion: string | null;
    platform: string; errors: string[];
  } | null>(null);

  // API test
  const [testingApi, setTestingApi] = useState(false);
  const [apiTestResult, setApiTestResult] = useState<{ success: boolean; message?: string; details?: any } | null>(null);

  // Downloads
  const [downloads, setDownloads] = useState<DownloadInfo | null>(null);

  // Hash sets
  const [hashSets, setHashSets] = useState<HashSetInfo[]>([]);

  // Fetch status + auto-validate when configured
  const fetchStatus = useCallback(async () => {
    try {
      const data = await apiFetch<IpedStatus>('/iped/status');
      setStatus(data);
      if (data.defaultProfile) setDefaultProfile(data.defaultProfile);
      setPhotoDnaEnabled(!!data.photodnaEnabled);
      setAutoHash(!!data.autoHashOnUpload);

      // Auto-validate on load when configured + installed to get version info
      if (data.configured && data.installed && !validationResult) {
        try {
          const result = await apiFetch<{
            valid: boolean; ipedFound: boolean; javaFound: boolean;
            ipedVersion: string | null; javaVersion: string | null;
            platform: string; errors: string[];
          }>('/iped/validate', { method: 'POST' });
          setValidationResult(result);
        } catch { /* non-critical — badge still works without it */ }
      }
    } catch (err) {
      console.error('Failed to fetch IPED status:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  // Fetch downloads info
  const fetchDownloads = useCallback(async () => {
    try {
      const data = await apiFetch<DownloadInfo>('/iped/download/info');
      setDownloads(data);
    } catch { /* non-critical */ }
  }, []);

  // Fetch hash sets
  const fetchHashSets = useCallback(async () => {
    try {
      const data = await apiFetch<{ sets: HashSetInfo[] }>('/iped/hash-sets');
      setHashSets(data.sets || []);
    } catch { /* non-critical */ }
  }, []);

  useEffect(() => {
    fetchStatus();
    fetchDownloads();
    fetchHashSets();
  }, [fetchStatus, fetchDownloads, fetchHashSets]);

  // Save config
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
      setError(err instanceof Error ? err.message : 'Failed to save IPED config');
    } finally {
      setSaving(false);
    }
  };

  // Clear config
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

  // Validate installation
  const handleValidate = async () => {
    setValidating(true);
    setValidationResult(null);
    try {
      const result = await apiFetch<{
        valid: boolean; ipedFound: boolean; javaFound: boolean;
        ipedVersion: string | null; javaVersion: string | null;
        platform: string; errors: string[];
      }>('/iped/validate', { method: 'POST' });
      setValidationResult(result);
      // Refresh status after validation
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

  // Test Web API
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

  // Toggle settings
  const handleTogglePhotoDna = async () => {
    const newVal = !photoDnaEnabled;
    setPhotoDnaEnabled(newVal);
    if (status?.configured) {
      try {
        await apiFetch('/iped/config', {
          method: 'PUT',
          body: JSON.stringify({ photodnaEnabled: newVal }),
        });
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to update setting');
        setPhotoDnaEnabled(!newVal);
      }
    }
  };

  const handleToggleAutoHash = async () => {
    const newVal = !autoHash;
    setAutoHash(newVal);
    if (status?.configured) {
      try {
        await apiFetch('/iped/config', {
          method: 'PUT',
          body: JSON.stringify({ autoHashOnUpload: newVal }),
        });
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to update setting');
        setAutoHash(!newVal);
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

  // Remove hash set
  const handleRemoveHashSet = async (name: string) => {
    try {
      await apiFetch(`/iped/hash-sets/${encodeURIComponent(name)}`, { method: 'DELETE' });
      await fetchHashSets();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to remove hash set');
    }
  };

  // Set document title
  useEffect(() => { document.title = 'Admin - IPED \u2014 RMPG Flex'; }, []);

  if (loading) return <LoadingSpinner />;

  return (
    <div className="p-4 space-y-4">
      {/* Header */}
      <div className="flex items-center gap-2">
        <Microscope className="w-4 h-4 text-brand-400" />
        <h2 className="text-xs font-bold uppercase tracking-wider text-rmpg-200">IPED Digital Forensics</h2>
        {status?.configured ? (
          status.installed ? (
            <span className="ml-2 flex items-center gap-1 text-green-400 text-[10px]">
              <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
              CONNECTED
              {validationResult?.ipedVersion && (
                <span className="text-rmpg-400 ml-1">v{validationResult.ipedVersion}</span>
              )}
            </span>
          ) : (
            <span className="ml-2 flex items-center gap-1 text-amber-400 text-[10px]">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
              CONFIGURED (PATH NOT FOUND)
            </span>
          )
        ) : (
          <span className="ml-2 flex items-center gap-1 text-rmpg-500 text-[10px]">
            <span className="w-1.5 h-1.5 rounded-full bg-rmpg-500" />
            NOT CONFIGURED
          </span>
        )}
        <a
          href="https://github.com/sepinf-inc/IPED"
          target="_blank"
          rel="noopener noreferrer"
          className="ml-auto flex items-center gap-1 text-[10px] text-brand-400 hover:text-brand-300"
        >
          <ExternalLink className="w-3 h-3" />
          IPED GitHub
        </a>
      </div>

      {/* ═══ Section 1: Installation ═══ */}
      <div className="panel-beveled bg-surface-base p-3 space-y-3">
        <div className="flex items-center gap-2 text-[10px] font-bold text-rmpg-300 uppercase tracking-wider">
          <FolderOpen className="w-3.5 h-3.5" />
          Installation Paths
        </div>

        {/* IPED Install Path */}
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

        {/* Java Home */}
        <div className="space-y-1.5">
          <label className="text-[10px] text-rmpg-400">Java Home <span className="text-rmpg-600">(JDK 11+ required)</span></label>
          <input
            type="text"
            value={javaHome}
            onChange={(e) => setJavaHome(e.target.value)}
            placeholder={status?.javaHome || '/path/to/jdk (or leave blank for system default)'}
            className="w-full bg-surface-sunken border border-rmpg-600 text-rmpg-200 text-xs px-2.5 py-1.5 rounded-sm focus:border-brand-500 focus:outline-none font-mono"
          />
          {status?.javaVersion && (
            <div className="text-[9px] text-green-500">Detected: Java {status.javaVersion}</div>
          )}
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-2 flex-wrap">
          <button type="button"
            onClick={handleSaveConfig}
            disabled={saving}
            className="toolbar-btn text-[10px] flex items-center gap-1 px-3 py-1.5 bg-brand-600 hover:bg-brand-500 text-white disabled:opacity-50"
          >
            {saving ? <Loader2 className="w-3 h-3 animate-spin" role="status" aria-label="Loading" /> : <CheckCircle2 className="w-3 h-3" />}
            Save Config
          </button>
          {status?.configured && (
            <>
              <button type="button"
                onClick={handleValidate}
                disabled={validating}
                className="toolbar-btn text-[10px] flex items-center gap-1 px-3 py-1.5"
              >
                {validating ? <Loader2 className="w-3 h-3 animate-spin" role="status" aria-label="Loading" /> : <Shield className="w-3 h-3" />}
                Validate Installation
              </button>
              <button type="button"
                onClick={handleClear}
                className="toolbar-btn text-[10px] flex items-center gap-1 px-3 py-1.5 text-red-400 hover:text-red-300"
              >
                <Trash2 className="w-3 h-3" />
                Clear
              </button>
            </>
          )}
        </div>

        {/* Validation result */}
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
      </div>

      {/* ═══ Section 2: Download IPED Bundles ═══ */}
      <div className="panel-beveled bg-surface-base p-3 space-y-3">
        <div className="flex items-center gap-2 text-[10px] font-bold text-rmpg-300 uppercase tracking-wider">
          <Download className="w-3.5 h-3.5" />
          IPED Bundles
        </div>

        <div className="grid grid-cols-2 gap-3">
          {/* macOS */}
          <div className="bg-surface-sunken p-2.5 rounded-sm">
            <div className="text-[10px] font-bold text-rmpg-200 mb-1">macOS Bundle</div>
            {downloads?.bundles?.mac ? (
              <>
                <div className="text-[9px] text-rmpg-400 font-mono mb-1.5">{downloads.bundles.mac.filename}</div>
                <div className="text-[9px] text-rmpg-500 mb-2">v{downloads.bundles.mac.version} • {(downloads.bundles.mac.size / 1048576).toFixed(0)} MB</div>
                <a
                  href={`/downloads/${downloads.bundles.mac.filename}`}
                  className="toolbar-btn text-[10px] flex items-center gap-1 px-2.5 py-1 bg-brand-600 hover:bg-brand-500 text-white inline-flex"
                >
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

          {/* Windows */}
          <div className="bg-surface-sunken p-2.5 rounded-sm">
            <div className="text-[10px] font-bold text-rmpg-200 mb-1">Windows Bundle</div>
            {downloads?.bundles?.win ? (
              <>
                <div className="text-[9px] text-rmpg-400 font-mono mb-1.5">{downloads.bundles.win.filename}</div>
                <div className="text-[9px] text-rmpg-500 mb-2">v{downloads.bundles.win.version} • {(downloads.bundles.win.size / 1048576).toFixed(0)} MB</div>
                <a
                  href={`/downloads/${downloads.bundles.win.filename}`}
                  className="toolbar-btn text-[10px] flex items-center gap-1 px-2.5 py-1 bg-brand-600 hover:bg-brand-500 text-white inline-flex"
                >
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
          <a
            href="https://github.com/sepinf-inc/IPED/releases"
            target="_blank"
            rel="noopener noreferrer"
            className="text-brand-400 hover:text-brand-300 underline"
          >
            IPED Releases
          </a>{' '}and package with bundled JDK.
        </div>
      </div>

      {/* ═══ Section 3: Configuration ═══ */}
      <div className="panel-beveled bg-surface-base p-3 space-y-3">
        <div className="flex items-center gap-2 text-[10px] font-bold text-rmpg-300 uppercase tracking-wider">
          <HardDrive className="w-3.5 h-3.5" />
          Processing Configuration
        </div>

        {/* Default Profile */}
        <div className="space-y-1.5">
          <label className="text-[10px] text-rmpg-400">Default Processing Profile</label>
          <div className="space-y-0.5">
            {PROFILES.map(p => (
              <button type="button"
                key={p.id}
                onClick={() => handleProfileChange(p.id)}
                className="w-full flex items-center gap-2 px-2 py-1.5 rounded-sm text-left transition-colors hover:bg-rmpg-800/30"
                style={{
                  background: defaultProfile === p.id ? 'rgba(136, 136, 136, 0.12)' : undefined,
                  border: defaultProfile === p.id ? '1px solid rgba(136, 136, 136, 0.3)' : '1px solid transparent',
                }}
              >
                <div className={`w-2 h-2 rounded-full shrink-0 ${defaultProfile === p.id ? 'bg-brand-400' : 'bg-rmpg-700'}`} />
                <div className="flex-1 min-w-0">
                  <div className={`text-[10px] font-medium ${defaultProfile === p.id ? 'text-rmpg-100' : 'text-rmpg-300'}`}>
                    {p.label}
                  </div>
                  <div className="text-[9px] text-rmpg-500 truncate">{p.desc}</div>
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Toggle settings */}
        <div className="space-y-1">
          <button type="button"
            onClick={handleTogglePhotoDna}
            className="w-full flex items-center gap-2 px-2 py-1.5 rounded-sm text-left transition-colors hover:bg-rmpg-800/30"
          >
            {photoDnaEnabled ? <ToggleRight className="w-5 h-5 text-brand-400" /> : <ToggleLeft className="w-5 h-5 text-rmpg-600" />}
            <div className="flex-1 min-w-0">
              <div className={`text-[10px] font-medium ${photoDnaEnabled ? 'text-rmpg-100' : 'text-rmpg-300'}`}>
                PhotoDNA Matching
              </div>
              <div className="text-[9px] text-rmpg-500">Requires IPED with PhotoDNA module (law enforcement only — contact iped@pf.gov.br)</div>
            </div>
          </button>

          <button type="button"
            onClick={handleToggleAutoHash}
            className="w-full flex items-center gap-2 px-2 py-1.5 rounded-sm text-left transition-colors hover:bg-rmpg-800/30"
          >
            {autoHash ? <ToggleRight className="w-5 h-5 text-brand-400" /> : <ToggleLeft className="w-5 h-5 text-rmpg-600" />}
            <div className="flex-1 min-w-0">
              <div className={`text-[10px] font-medium ${autoHash ? 'text-rmpg-100' : 'text-rmpg-300'}`}>
                Auto-Hash Evidence Uploads
              </div>
              <div className="text-[9px] text-rmpg-500">Automatically compute MD5/SHA-256 + content fingerprint when evidence attachments are uploaded</div>
            </div>
          </button>
        </div>

        {/* Web API Config */}
        <div className="space-y-1.5">
          <label className="text-[10px] text-rmpg-400">IPED Web API <span className="text-rmpg-600">(optional — for case browsing)</span></label>
          <div className="flex gap-2">
            <input
              type="text"
              value={webApiUrl}
              onChange={(e) => setWebApiUrl(e.target.value)}
              placeholder={status?.webApiUrl || 'http://localhost'}
              className="flex-1 bg-surface-sunken border border-rmpg-600 text-rmpg-200 text-xs px-2.5 py-1.5 rounded-sm focus:border-brand-500 focus:outline-none font-mono"
            />
            <input
              type="text"
              value={webApiPort}
              onChange={(e) => setWebApiPort(e.target.value)}
              placeholder="8080"
              className="w-20 bg-surface-sunken border border-rmpg-600 text-rmpg-200 text-xs px-2.5 py-1.5 rounded-sm focus:border-brand-500 focus:outline-none font-mono text-center"
            />
          </div>
          {status?.configured && (
            <div className="flex items-center gap-2">
              <button type="button"
                onClick={handleTestApi}
                disabled={testingApi}
                className="toolbar-btn text-[10px] flex items-center gap-1 px-2.5 py-1"
              >
                {testingApi ? <Loader2 className="w-3 h-3 animate-spin" role="status" aria-label="Loading" /> : <Server className="w-3 h-3" />}
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
      </div>

      {/* ═══ Section 4: Hash Sets ═══ */}
      <div className="panel-beveled bg-surface-base p-3 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-[10px] font-bold text-rmpg-300 uppercase tracking-wider">
            <Hash className="w-3.5 h-3.5" />
            Hash Sets
            <span className="ml-1 text-brand-400">({hashSets.length} loaded)</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="space-y-1">
              <input
                type="text"
                value={hashSetsPath}
                onChange={(e) => setHashSetsPath(e.target.value)}
                placeholder="Path to NSRL/CSV hash set file..."
                className="bg-surface-sunken border border-rmpg-600 text-rmpg-200 text-[10px] px-2 py-1 rounded-sm w-56 focus:border-brand-500 focus:outline-none font-mono"
              />
            </div>
          </div>
        </div>

        {hashSets.length > 0 ? (
          <div className="space-y-0.5 max-h-40 overflow-y-auto">
            {hashSets.map(hs => (
              <div key={hs.name} className="flex items-center justify-between px-2 py-1.5 bg-surface-sunken rounded-sm">
                <div className="flex-1 min-w-0">
                  <div className="text-[10px] font-medium text-rmpg-200">{hs.name}</div>
                  <div className="text-[9px] text-rmpg-500">{hs.category} • {(hs.count || 0).toLocaleString()} entries</div>
                </div>
                <button type="button"
                  onClick={() => handleRemoveHashSet(hs.name)}
                  className="text-rmpg-600 hover:text-red-400 shrink-0 ml-2"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-[9px] text-rmpg-600 bg-surface-sunken p-2 rounded-sm">
            No hash sets loaded. Import NSRL, ProjectVIC, or CSV hash sets to enable known-file matching.
            Supported formats: CSV with md5/sha1/sha256 columns.
          </div>
        )}
      </div>

      {/* ═══ Section 5: Processing Dashboard ═══ */}
      {status?.configured && (
        <div className="panel-beveled bg-surface-base p-3 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-[10px] font-bold text-rmpg-300 uppercase tracking-wider">
              <Activity className="w-3.5 h-3.5" />
              Processing Dashboard
            </div>
            <button type="button"
              onClick={() => { fetchStatus(); fetchHashSets(); }}
              className="toolbar-btn text-[10px] flex items-center gap-1 px-2 py-1"
            >
              <RefreshCw className="w-3 h-3" />
              Refresh
            </button>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {[
              { label: 'Total Jobs', value: status.totalJobs, icon: Database },
              { label: 'Completed', value: status.completedJobs, icon: CheckCircle2 },
              { label: 'Total Hashes', value: status.totalHashes, icon: Hash },
              { label: 'Flagged', value: status.flaggedHashes, icon: AlertTriangle },
            ].map(stat => (
              <div key={stat.label} className="bg-surface-sunken p-2 rounded-sm text-center">
                <stat.icon className="w-3 h-3 mx-auto mb-1 text-rmpg-400" />
                <div className="text-sm font-bold text-rmpg-100">{stat.value}</div>
                <div className="text-[9px] text-rmpg-500 uppercase">{stat.label}</div>
              </div>
            ))}
          </div>

          {status.runningJobs > 0 && (
            <div className="flex items-center gap-2 text-[10px] px-2 py-1.5 rounded-sm bg-gray-950/30 border border-gray-800/40 text-gray-400">
              <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" role="status" aria-label="Loading" />
              {status.runningJobs} job(s) currently running
            </div>
          )}

          {status.flaggedHashes > 0 && (
            <div className="flex items-center gap-2 text-[10px] px-2 py-1.5 rounded-sm bg-red-950/30 border border-red-800/40 text-red-400">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
              {status.flaggedHashes} flagged hash(es) require review
            </div>
          )}
        </div>
      )}

      {/* ═══ Built-in Hashing Note ═══ */}
      <div className="panel-beveled bg-surface-base p-3 space-y-2">
        <div className="flex items-center gap-2 text-[10px] font-bold text-rmpg-300 uppercase tracking-wider">
          <FileSearch className="w-3.5 h-3.5" />
          Built-in Hashing (No IPED Required)
        </div>
        <div className="text-[9px] text-rmpg-500 leading-relaxed">
          <strong className="text-rmpg-300">Tier 1 — Always Available:</strong> MD5, SHA-1, SHA-256, SHA-512 cryptographic hashes + content fingerprint for perceptual
          similarity. Works on any evidence file immediately — no external software needed.
        </div>
        <div className="text-[9px] text-rmpg-500 leading-relaxed">
          <strong className="text-rmpg-300">Tier 2 — Requires IPED:</strong> PhotoDNA perceptual hashing, full disk image processing, file carving,
          face recognition, OCR, nudity detection, and advanced forensic analysis. Configure IPED installation above to enable.
        </div>
      </div>

      {/* Not configured hint */}
      {!status?.configured && (
        <div className="flex items-center gap-2 text-[10px] text-rmpg-500 bg-surface-sunken p-3 rounded-sm">
          <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0" />
          <div>
            Set the IPED installation path above to enable Tier 2 forensic processing.
            Download IPED from{' '}
            <a
              href="https://github.com/sepinf-inc/IPED/releases"
              target="_blank"
              rel="noopener noreferrer"
              className="text-brand-400 hover:text-brand-300 underline"
            >
              GitHub Releases
            </a>.
            Tier 1 hashing (MD5/SHA/content fingerprint) works immediately without IPED.
          </div>
        </div>
      )}
    </div>
  );
}
