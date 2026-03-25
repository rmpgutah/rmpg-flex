import React, { useState, useEffect, useCallback } from 'react';
import {
  Navigation, Key, Eye, EyeOff, Loader2, CheckCircle2, XCircle,
  Trash2, Zap, AlertTriangle, ToggleLeft, ToggleRight, Link2, Unlink,
  Radio, Clock, Truck, Search, Camera, History, RefreshCw, Video,
  HardDrive, Download,
} from 'lucide-react';
import { apiFetch } from '../../hooks/useApi';

interface Props {
  LoadingSpinner: React.FC;
  error: string | null;
  setError: (e: string | null) => void;
}

interface CpgStatus {
  configured: boolean;
  enabled: boolean;
  poll_interval_seconds: number;
  active_mappings: number;
  last_sync: string | null;
  media_sync_enabled?: boolean;
  media_poll_interval_seconds?: number;
  last_media_sync?: string | null;
}

interface MediaSyncStatus {
  media_sync_enabled: boolean;
  media_poll_interval_seconds: number;
  last_media_sync: string | null;
  total_synced_clips: number;
  total_synced_bytes: number;
  sync_errors: number;
  devices: Array<{
    cpg_device_id: string;
    cpg_display_name: string | null;
    last_media_synced_at: string | null;
    media_sync_errors: number | null;
    call_sign: string | null;
  }>;
}

interface CpgDevice {
  deviceId: string;        // ClearPathGPS device identifier (e.g. "cp160817")
  gtsDeviceId?: string;    // Alias (some endpoints use this)
  uniqueId: string;
  serialNumber: string;
  displayName: string;
  lastValidLatitude: number;
  lastValidLongitude: number;
  vehicleMake: string;
  vehicleModel: string;
  licensePlate: string;    // API field name
  vehicleID: string;       // VIN
  driverName: string;
  ignitionState: string;
  description?: string;
  [key: string]: any;
}

interface CpgMapping {
  id: number;
  cpg_device_id: string;
  cpg_display_name: string | null;
  cpg_serial_number: string | null;
  unit_id: number;
  call_sign: string | null;
  unit_status: string | null;
  officer_name: string | null;
  last_synced_at: string | null;
  vehicle_make: string | null;
  vehicle_model: string | null;
  vehicle_vin: string | null;
  license_plate: string | null;
  ignition_state: string | null;
  last_odometer: number | null;
  driver_name: string | null;
}

interface DispatchUnit {
  id: number;
  call_sign: string;
  status: string;
  officer_name?: string;
}

interface DashcamEvent {
  id: number;
  cpg_device_id: string;
  unit_id: number | null;
  dashcam_id: string | null;
  event_type: string;
  event_timestamp: string;
  latitude: number | null;
  longitude: number | null;
  speed_mph: number | null;
  address: string | null;
  status_code: string | null;
  status_code_text: string | null;
  call_sign: string | null;
  officer_name: string | null;
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

export default function AdminClearPathGpsTab({ LoadingSpinner, error, setError }: Props) {
  // Status
  const [status, setStatus] = useState<CpgStatus | null>(null);
  const [loading, setLoading] = useState(true);

  // Credentials
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [accountId, setAccountId] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [saving, setSaving] = useState(false);

  // Connection test
  const [testResult, setTestResult] = useState<{ success: boolean; deviceCount?: number; error?: string } | null>(null);
  const [testing, setTesting] = useState(false);

  // Devices & mappings
  const [devices, setDevices] = useState<CpgDevice[]>([]);
  const [mappings, setMappings] = useState<CpgMapping[]>([]);
  const [units, setUnits] = useState<DispatchUnit[]>([]);
  const [loadingDevices, setLoadingDevices] = useState(false);

  // Account discovery
  const [discoveredAccounts, setDiscoveredAccounts] = useState<{ accountId: string | number; description?: string; accountName?: string }[]>([]);
  const [discovering, setDiscovering] = useState(false);

  // Polling interval
  const [pollInterval, setPollInterval] = useState(30);

  // History backfill toggle
  const [historyBackfill, setHistoryBackfill] = useState(true);

  // Dashcam events
  const [dashcamEvents, setDashcamEvents] = useState<DashcamEvent[]>([]);
  const [loadingDashcam, setLoadingDashcam] = useState(false);
  const [dashcamTotal, setDashcamTotal] = useState(0);

  // Media sync
  const [mediaStatus, setMediaStatus] = useState<MediaSyncStatus | null>(null);
  const [mediaSyncEnabled, setMediaSyncEnabled] = useState(false);
  const [mediaPollInterval, setMediaPollInterval] = useState(300);
  const [syncing, setSyncing] = useState(false);
  const [savingMedia, setSavingMedia] = useState(false);

  // ── Fetch status ──
  const fetchStatus = useCallback(async () => {
    try {
      const data = await apiFetch<CpgStatus>('/clearpathgps/status');
      setStatus(data);
      setPollInterval(data.poll_interval_seconds || 30);
    } catch (err) {
      console.error('Failed to fetch ClearPathGPS status:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  // ── Fetch mappings ──
  const fetchMappings = useCallback(async () => {
    try {
      const data = await apiFetch<{ mappings: CpgMapping[] }>('/clearpathgps/mappings');
      setMappings(data.mappings || []);
    } catch (e) { console.error('Failed to fetch GPS mappings:', e); }
  }, []);

  // ── Fetch units ──
  const fetchUnits = useCallback(async () => {
    try {
      const data = await apiFetch<DispatchUnit[]>('/dispatch/units');
      setUnits(Array.isArray(data) ? data : []);
    } catch (e) { console.error('Failed to fetch units:', e); }
  }, []);

  // ── Fetch settings ──
  const fetchSettings = useCallback(async () => {
    try {
      const data = await apiFetch<{ history_backfill: boolean }>('/clearpathgps/settings');
      setHistoryBackfill(data.history_backfill);
    } catch (e) { console.error('Failed to fetch GPS settings:', e); }
  }, []);

  // ── Fetch dashcam events ──
  const fetchDashcamEvents = useCallback(async () => {
    setLoadingDashcam(true);
    try {
      const data = await apiFetch<{ events: DashcamEvent[]; total: number }>('/clearpathgps/dashcam-events?limit=50');
      setDashcamEvents(data.events || []);
      setDashcamTotal(data.total || 0);
    } catch (e) { console.error('Failed to fetch dashcam events:', e); }
    finally { setLoadingDashcam(false); }
  }, []);

  // ── Fetch media sync status ──
  const fetchMediaStatus = useCallback(async () => {
    try {
      const data = await apiFetch<MediaSyncStatus>('/clearpathgps/media-status');
      setMediaStatus(data);
      setMediaSyncEnabled(data.media_sync_enabled);
      setMediaPollInterval(data.media_poll_interval_seconds || 300);
    } catch (e) { console.error('Failed to fetch media status:', e); }
  }, []);

  useEffect(() => {
    fetchStatus();
    fetchMappings();
    fetchUnits();
    fetchSettings();
    fetchDashcamEvents();
    fetchMediaStatus();
  }, [fetchStatus, fetchMappings, fetchUnits, fetchSettings, fetchDashcamEvents, fetchMediaStatus]);

  // ── Save credentials ──
  const handleSaveCredentials = async () => {
    if (!email.trim() || !password.trim() || !String(accountId).trim()) return;
    setSaving(true);
    setTestResult(null);
    try {
      await apiFetch('/clearpathgps/credentials', {
        method: 'PUT',
        body: JSON.stringify({ email, password, account_id: String(accountId) }),
      });
      setEmail('');
      setPassword('');
      setAccountId('');
      setShowPassword(false);
      await fetchStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save credentials');
    } finally {
      setSaving(false);
    }
  };

  // ── Clear credentials ──
  const handleClear = async () => {
    try {
      await apiFetch('/clearpathgps/credentials', { method: 'DELETE' });
      setTestResult(null);
      setDevices([]);
      setMappings([]);
      await fetchStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to clear credentials');
    }
  };

  // ── Test connection ──
  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const result = await apiFetch<{ success: boolean; deviceCount: number; error?: string }>('/clearpathgps/test-connection', { method: 'POST' });
      setTestResult(result);
    } catch (err) {
      setTestResult({ success: false, error: err instanceof Error ? err.message : 'Connection test failed' });
    } finally {
      setTesting(false);
    }
  };

  // ── Discover accounts ──
  const handleDiscoverAccounts = async () => {
    setDiscovering(true);
    setDiscoveredAccounts([]);
    try {
      const data = await apiFetch<{ accounts: { accountId: string | number; description?: string; accountName?: string }[]; error?: string }>('/clearpathgps/discover-accounts', { method: 'POST' });
      if (data.error) {
        setTestResult({ success: false, error: `Account discovery: ${data.error}` });
      } else {
        const accounts = data.accounts || [];
        setDiscoveredAccounts(accounts);
        if (accounts.length === 0) {
          setTestResult({ success: false, error: 'No accounts found for this email/password' });
        }
      }
    } catch (err) {
      setTestResult({ success: false, error: err instanceof Error ? err.message : 'Account discovery failed' });
    } finally {
      setDiscovering(false);
    }
  };

  // ── Toggle enabled ──
  const handleToggleEnabled = async () => {
    if (!status) return;
    const newEnabled = !status.enabled;
    try {
      await apiFetch('/clearpathgps/enable', {
        method: 'PUT',
        body: JSON.stringify({ enabled: newEnabled, poll_interval_seconds: pollInterval }),
      });
      await fetchStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to toggle integration');
    }
  };

  // ── Update poll interval ──
  const handlePollIntervalChange = async (seconds: number) => {
    setPollInterval(seconds);
    if (status?.enabled) {
      try {
        await apiFetch('/clearpathgps/enable', {
          method: 'PUT',
          body: JSON.stringify({ enabled: true, poll_interval_seconds: seconds }),
        });
        await fetchStatus();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to update poll interval');
      }
    }
  };

  // ── Fetch devices from ClearPathGPS ──
  const handleFetchDevices = async () => {
    setLoadingDevices(true);
    try {
      const data = await apiFetch<{ devices: CpgDevice[] }>('/clearpathgps/devices');
      setDevices(data.devices || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch devices');
    } finally {
      setLoadingDevices(false);
    }
  };

  // ── Create mapping ──
  const handleCreateMapping = async (device: CpgDevice, unitId: number) => {
    try {
      await apiFetch('/clearpathgps/mappings', {
        method: 'POST',
        body: JSON.stringify({
          cpg_device_id: device.deviceId || device.gtsDeviceId,
          cpg_display_name: device.displayName,
          cpg_serial_number: device.serialNumber,
          unit_id: unitId,
        }),
      });
      await fetchMappings();
      await fetchStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create mapping');
    }
  };

  // ── Remove mapping ──
  const handleRemoveMapping = async (mappingId: number) => {
    try {
      await apiFetch(`/clearpathgps/mappings/${mappingId}`, { method: 'DELETE' });
      await fetchMappings();
      await fetchStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to remove mapping');
    }
  };

  // ── Toggle history backfill ──
  const handleToggleBackfill = async () => {
    const newVal = !historyBackfill;
    setHistoryBackfill(newVal);
    try {
      await apiFetch('/clearpathgps/settings', {
        method: 'PUT',
        body: JSON.stringify({ history_backfill: newVal }),
      });
    } catch (err) {
      setHistoryBackfill(!newVal); // revert
      setError(err instanceof Error ? err.message : 'Failed to update settings');
    }
  };

  // ── Toggle media sync ──
  const handleToggleMediaSync = async () => {
    const newVal = !mediaSyncEnabled;
    setSavingMedia(true);
    try {
      await apiFetch('/clearpathgps/media-settings', {
        method: 'PUT',
        body: JSON.stringify({ media_sync_enabled: newVal, media_poll_interval_seconds: mediaPollInterval }),
      });
      setMediaSyncEnabled(newVal);
      await fetchMediaStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to toggle media sync');
    } finally {
      setSavingMedia(false);
    }
  };

  // ── Update media poll interval ──
  const handleMediaPollIntervalChange = async (seconds: number) => {
    setMediaPollInterval(seconds);
    setSavingMedia(true);
    try {
      await apiFetch('/clearpathgps/media-settings', {
        method: 'PUT',
        body: JSON.stringify({ media_sync_enabled: mediaSyncEnabled, media_poll_interval_seconds: seconds }),
      });
      await fetchMediaStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update media poll interval');
    } finally {
      setSavingMedia(false);
    }
  };

  // ── Trigger immediate media sync ──
  const handleSyncNow = async () => {
    setSyncing(true);
    try {
      const result = await apiFetch<{ synced: number; errors: number }>('/clearpathgps/media-sync-now', { method: 'POST' });
      await fetchMediaStatus();
      if (result.synced > 0) {
        setError(null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Media sync failed');
    } finally {
      setSyncing(false);
    }
  };

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.min(Math.floor(Math.log(bytes) / Math.log(k)), sizes.length - 1);
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
  };

  // Set document title
  useEffect(() => { document.title = 'Admin - GPS \u2014 RMPG Flex'; }, []);

  // Units that are not already mapped
  const mappedUnitIds = new Set(mappings.map(m => m.unit_id));
  const availableUnits = units.filter(u => !mappedUnitIds.has(u.id));

  if (loading) return <LoadingSpinner />;


  if (loading) return <LoadingSpinner />;

  return (
    <div className="p-4 space-y-4">
      {/* Header */}
      <div className="flex items-center gap-2">
        <Navigation className="w-4 h-4 text-brand-400" />
        <h2 className="text-xs font-bold uppercase tracking-wider text-rmpg-200">ClearPathGPS Integration</h2>
        {status?.configured && status.enabled && (
          <span className="ml-2 flex items-center gap-1 text-green-400 text-[10px]">
            <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
            ACTIVE
          </span>
        )}
        {status?.configured && !status.enabled && (
          <span className="ml-2 flex items-center gap-1 text-amber-400 text-[10px]">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
            CONFIGURED
          </span>
        )}
        {!status?.configured && (
          <span className="ml-2 flex items-center gap-1 text-rmpg-500 text-[10px]">
            <span className="w-1.5 h-1.5 rounded-full bg-rmpg-500" />
            NOT CONFIGURED
          </span>
        )}
      </div>

      {/* ═══ Section 1: Credentials ═══ */}
      <div className="panel-beveled bg-surface-base p-3 space-y-3">
        <div className="flex items-center gap-2 text-[10px] font-bold text-rmpg-300 uppercase tracking-wider">
          <Key className="w-3.5 h-3.5" />
          API Credentials
        </div>

        {/* Email */}
        <div className="space-y-1.5">
          <label className="text-[10px] text-rmpg-400">Email</label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder={status?.configured ? 'Enter new email to replace...' : 'ClearPathGPS login email...'}
            className="w-full bg-surface-sunken border border-rmpg-600 text-rmpg-200 text-xs px-2.5 py-1.5 rounded-sm focus:border-brand-500 focus:outline-none font-mono"
          />
        </div>

        {/* Password */}
        <div className="space-y-1.5">
          <label className="text-[10px] text-rmpg-400">Password</label>
          <div className="relative">
            <input
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={status?.configured ? 'Enter new password to replace...' : 'ClearPathGPS password...'}
              className="w-full bg-surface-sunken border border-rmpg-600 text-rmpg-200 text-xs px-2.5 py-1.5 pr-8 rounded-sm focus:border-brand-500 focus:outline-none font-mono"
            />
            <button type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-rmpg-500 hover:text-rmpg-300"
            >
              {showPassword ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
            </button>
          </div>
        </div>

        {/* Account ID */}
        <div className="space-y-1.5">
          <label className="text-[10px] text-rmpg-400">Account ID</label>
          <input
            type="text"
            value={accountId}
            onChange={(e) => setAccountId(e.target.value)}
            placeholder={status?.configured ? 'Enter new Account ID to replace...' : 'ClearPathGPS Account ID...'}
            className="w-full bg-surface-sunken border border-rmpg-600 text-rmpg-200 text-xs px-2.5 py-1.5 rounded-sm focus:border-brand-500 focus:outline-none font-mono"
          />
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-2">
          <button type="button"
            onClick={handleSaveCredentials}
            disabled={saving || !email.trim() || !password.trim() || !String(accountId).trim()}
            className="toolbar-btn text-[10px] flex items-center gap-1 px-3 py-1.5 bg-brand-600 hover:bg-brand-500 text-white disabled:opacity-50"
          >
            {saving ? <Loader2 className="w-3 h-3 animate-spin" role="status" aria-label="Loading" /> : <CheckCircle2 className="w-3 h-3" />}
            Save Credentials
          </button>
          {status?.configured && (
            <>
              <button type="button"
                onClick={handleTest}
                disabled={testing}
                className="toolbar-btn text-[10px] flex items-center gap-1 px-3 py-1.5"
              >
                {testing ? <Loader2 className="w-3 h-3 animate-spin" role="status" aria-label="Loading" /> : <Zap className="w-3 h-3" />}
                Test Connection
              </button>
              <button type="button"
                onClick={handleDiscoverAccounts}
                disabled={discovering}
                className="toolbar-btn text-[10px] flex items-center gap-1 px-3 py-1.5"
              >
                {discovering ? <Loader2 className="w-3 h-3 animate-spin" role="status" aria-label="Loading" /> : <Search className="w-3 h-3" />}
                Discover Accounts
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

        {/* Test result */}
        {testResult && (
          <div className={`flex items-center gap-2 text-[10px] px-2 py-1.5 rounded-sm ${
            testResult.success
              ? 'bg-green-950/30 border border-green-800/40 text-green-400'
              : 'bg-red-950/30 border border-red-800/40 text-red-400'
          }`}>
            {testResult.success ? <CheckCircle2 className="w-3.5 h-3.5" /> : <XCircle className="w-3.5 h-3.5" />}
            {testResult.success
              ? `Connected — ${testResult.deviceCount} device(s) found`
              : `Connection failed: ${testResult.error}`
            }
          </div>
        )}

        {/* Discovered accounts */}
        {discoveredAccounts.length > 0 && (
          <div className="space-y-1.5">
            <div className="text-[9px] text-rmpg-500 uppercase tracking-wider">Available Accounts</div>
            {discoveredAccounts.map((acct) => (
              <button type="button"
                key={acct.accountId}
                onClick={() => setAccountId(String(acct.accountId))}
                className="w-full flex items-center gap-2 px-2 py-1.5 bg-surface-sunken hover:bg-brand-900/20 border border-rmpg-600 hover:border-brand-500 rounded-sm text-[11px] transition-colors text-left"
              >
                <Navigation className="w-3 h-3 text-brand-400 shrink-0" />
                <span className="text-rmpg-200 font-mono">{acct.accountId}</span>
                <span className="text-rmpg-400">—</span>
                <span className="text-rmpg-300">{acct.description || acct.accountName || ''}</span>
                <span className="ml-auto text-[9px] text-brand-400">Click to use</span>
              </button>
            ))}
            <div className="text-[9px] text-rmpg-600">
              Click an account above to set it as Account ID, then save credentials and test connection.
            </div>
          </div>
        )}
      </div>

      {/* ═══ Section 2: Enable/Disable + Poll Interval ═══ */}
      {status?.configured && (
        <div className="panel-beveled bg-surface-base p-3 space-y-3">
          <div className="flex items-center gap-2 text-[10px] font-bold text-rmpg-300 uppercase tracking-wider">
            <Radio className="w-3.5 h-3.5" />
            Polling Control
          </div>

          <div className="flex items-center gap-4">
            {/* Toggle */}
            <button type="button"
              onClick={handleToggleEnabled}
              className="flex items-center gap-2 text-[11px]"
            >
              {status.enabled
                ? <ToggleRight className="w-6 h-6 text-green-400" />
                : <ToggleLeft className="w-6 h-6 text-rmpg-600" />
              }
              <span className={status.enabled ? 'text-green-400 font-medium' : 'text-rmpg-400'}>
                {status.enabled ? 'Active' : 'Disabled'}
              </span>
            </button>

            {/* Poll interval */}
            <div className="flex items-center gap-2">
              <Clock className="w-3 h-3 text-rmpg-500" />
              <span className="text-[10px] text-rmpg-400">Poll every:</span>
              <select
                value={pollInterval}
                onChange={(e) => handlePollIntervalChange(parseInt(e.target.value, 10))}
                className="bg-surface-sunken border border-rmpg-600 text-rmpg-200 text-[10px] px-2 py-1 rounded-sm focus:border-brand-500 focus:outline-none"
              >
                <option value={15}>15s</option>
                <option value={30}>30s</option>
                <option value={60}>60s</option>
                <option value={120}>2min</option>
                <option value={300}>5min</option>
              </select>
            </div>

            {/* Stats */}
            <div className="ml-auto flex items-center gap-3 text-[10px] text-rmpg-500">
              <span>{status.active_mappings} mapped</span>
              {status.last_sync && (
                <span className="flex items-center gap-1">
                  <Clock className="w-3 h-3" />
                  Last: {new Date(status.last_sync).toLocaleTimeString()}
                </span>
              )}
            </div>
          </div>

          {/* History backfill toggle */}
          <div className="flex items-center gap-4 pt-2 border-t border-rmpg-700/50">
            <button type="button"
              onClick={handleToggleBackfill}
              className="flex items-center gap-2 text-[11px]"
            >
              {historyBackfill
                ? <ToggleRight className="w-6 h-6 text-green-400" />
                : <ToggleLeft className="w-6 h-6 text-rmpg-600" />
              }
              <History className="w-3 h-3 text-rmpg-400" />
              <span className={historyBackfill ? 'text-green-400 font-medium' : 'text-rmpg-400'}>
                History Backfill
              </span>
            </button>
            <span className="text-[9px] text-rmpg-500">
              {historyBackfill
                ? 'Fetches all GPS points between polls for high-resolution trails'
                : 'Only captures latest position each poll cycle'
              }
            </span>
          </div>
        </div>
      )}

      {/* ═══ Section 3: Device Mappings ═══ */}
      {status?.configured && (
        <div className="panel-beveled bg-surface-base p-3 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-[10px] font-bold text-rmpg-300 uppercase tracking-wider">
              <Link2 className="w-3.5 h-3.5" />
              Device → Unit Mappings
            </div>
            <button type="button"
              onClick={handleFetchDevices}
              disabled={loadingDevices}
              className="toolbar-btn text-[10px] flex items-center gap-1 px-3 py-1.5"
            >
              {loadingDevices ? <Loader2 className="w-3 h-3 animate-spin" role="status" aria-label="Loading" /> : <Truck className="w-3 h-3" />}
              Load Devices
            </button>
          </div>

          {/* Current mappings */}
          {mappings.length > 0 && (
            <div className="space-y-1">
              <div className="text-[9px] text-rmpg-500 uppercase tracking-wider">Active Mappings</div>
              {mappings.map((m) => {
                const vehicleInfo = [m.vehicle_make, m.vehicle_model].filter(Boolean).join(' ');
                return (
                  <div
                    key={m.id}
                    className="px-2 py-1.5 bg-surface-sunken rounded-sm text-[11px]"
                  >
                    <div className="flex items-center gap-2">
                      <Truck className="w-3 h-3 text-brand-400 shrink-0" />
                      <span className="text-rmpg-200 font-medium">{m.cpg_display_name || m.cpg_device_id}</span>
                      <span className="text-rmpg-600">→</span>
                      <span className="text-brand-400 font-mono font-medium">{m.call_sign || `Unit #${m.unit_id}`}</span>
                      {m.officer_name && <span className="text-rmpg-500 text-[10px]">({m.officer_name})</span>}
                      {m.ignition_state && (
                        <span className={`text-[9px] px-1 py-0.5 rounded-sm ${
                          m.ignition_state === 'on' ? 'text-green-400 bg-green-950/30' : 'text-rmpg-500 bg-surface-sunken'
                        }`}>
                          IGN {m.ignition_state.toUpperCase()}
                        </span>
                      )}
                      {m.last_synced_at && (
                        <span className="ml-auto text-[9px] text-rmpg-600 flex items-center gap-1">
                          <Clock className="w-2.5 h-2.5" />
                          {new Date(m.last_synced_at).toLocaleTimeString()}
                        </span>
                      )}
                      <button type="button"
                        onClick={() => handleRemoveMapping(m.id)}
                        className="ml-1 text-red-500 hover:text-red-400"
                        title="Remove mapping"
                      >
                        <Unlink className="w-3 h-3" />
                      </button>
                    </div>
                    {/* Vehicle telemetry row */}
                    {(vehicleInfo || m.license_plate || m.vehicle_vin || m.last_odometer != null) && (
                      <div className="flex items-center gap-3 ml-5 mt-0.5 text-[9px] text-rmpg-500">
                        {vehicleInfo && <span>{vehicleInfo}</span>}
                        {m.license_plate && <span className="font-mono">Plate: {m.license_plate}</span>}
                        {m.vehicle_vin && <span className="font-mono">VIN: {m.vehicle_vin}</span>}
                        {m.last_odometer != null && <span>{m.last_odometer.toLocaleString()} mi</span>}
                        {m.driver_name && <span>Driver: {m.driver_name}</span>}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* Available devices to map */}
          {devices.length > 0 && (
            <div className="space-y-1">
              <div className="text-[9px] text-rmpg-500 uppercase tracking-wider">
                ClearPathGPS Devices ({devices.length})
              </div>
              <div className="max-h-64 overflow-y-auto space-y-1">
                {devices.map((device) => {
                  const devId = device.deviceId || device.gtsDeviceId;
                  const existingMapping = mappings.find(m => m.cpg_device_id === devId);
                  return (
                    <div
                      key={devId}
                      className="flex items-center gap-2 px-2 py-1.5 bg-surface-sunken rounded-sm text-[11px]"
                    >
                      <Truck className="w-3 h-3 text-rmpg-400 shrink-0" />
                      <div className="flex-1 min-w-0">
                        <div className="text-rmpg-200 font-medium truncate">{device.displayName}</div>
                        <div className="text-[9px] text-rmpg-500 truncate">
                          {[device.vehicleMake, device.vehicleModel, device.licensePlate].filter(Boolean).join(' · ') || device.serialNumber || devId}
                        </div>
                      </div>
                      {existingMapping ? (
                        <span className="text-[9px] text-green-500 flex items-center gap-1">
                          <CheckCircle2 className="w-3 h-3" />
                          → {existingMapping.call_sign}
                        </span>
                      ) : (
                        <select
                          defaultValue=""
                          onChange={(e) => {
                            if (e.target.value) {
                              handleCreateMapping(device, parseInt(e.target.value, 10));
                              e.target.value = '';
                            }
                          }}
                          className="bg-surface-sunken border border-rmpg-600 text-rmpg-200 text-[10px] px-2 py-1 rounded-sm focus:border-brand-500 focus:outline-none"
                        >
                          <option value="">Map to unit...</option>
                          {availableUnits.map(u => (
                            <option key={u.id} value={u.id}>
                              {u.call_sign} {u.officer_name ? `(${u.officer_name})` : ''}
                            </option>
                          ))}
                        </select>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {devices.length === 0 && mappings.length === 0 && (
            <div className="flex items-center gap-2 text-[10px] text-rmpg-500 bg-surface-sunken p-2 rounded-sm">
              <AlertTriangle className="w-3.5 h-3.5 text-amber-500 shrink-0" />
              Click "Load Devices" to fetch your ClearPathGPS hardware trackers and map them to dispatch units.
            </div>
          )}
        </div>
      )}

      {/* ═══ Section 4: Dashcam Events ═══ */}
      {status?.configured && (
        <div className="panel-beveled bg-surface-base p-3 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-[10px] font-bold text-rmpg-300 uppercase tracking-wider">
              <Camera className="w-3.5 h-3.5" />
              Dashcam Events
              {dashcamTotal > 0 && (
                <span className="text-rmpg-500 font-normal">({dashcamTotal} total)</span>
              )}
            </div>
            <button type="button"
              onClick={fetchDashcamEvents}
              disabled={loadingDashcam}
              className="toolbar-btn text-[10px] flex items-center gap-1 px-3 py-1.5"
            >
              {loadingDashcam ? <Loader2 className="w-3 h-3 animate-spin" role="status" aria-label="Loading" /> : <RefreshCw className="w-3 h-3" />}
              Refresh
            </button>
          </div>

          {dashcamEvents.length > 0 ? (
            <div className="max-h-72 overflow-y-auto space-y-1">
              {dashcamEvents.map((evt) => {
                const typeColor = /impact|collision|panic|sos/i.test(evt.event_type)
                  ? 'text-red-400 bg-red-950/30 border-red-800/40'
                  : /hard_brake|hard_turn|hard_accel|speeding/i.test(evt.event_type)
                  ? 'text-amber-400 bg-amber-950/30 border-amber-800/40'
                  : /video|camera|recording/i.test(evt.event_type)
                  ? 'text-blue-400 bg-blue-950/30 border-blue-800/40'
                  : 'text-rmpg-300 bg-surface-sunken border-rmpg-600';
                return (
                  <div
                    key={evt.id}
                    className="flex items-center gap-2 px-2 py-1.5 bg-surface-sunken rounded-sm text-[11px]"
                  >
                    <Camera className="w-3 h-3 text-rmpg-400 shrink-0" />
                    <span className={`px-1.5 py-0.5 rounded-sm text-[9px] font-mono uppercase border ${typeColor}`}>
                      {evt.event_type.replace(/_/g, ' ')}
                    </span>
                    {evt.call_sign && (
                      <span className="text-brand-400 font-mono font-medium">{evt.call_sign}</span>
                    )}
                    {evt.speed_mph != null && (
                      <span className="text-rmpg-500 text-[10px]">{Math.round(evt.speed_mph)} mph</span>
                    )}
                    {evt.address && (
                      <span className="text-rmpg-500 text-[10px] truncate max-w-48" title={evt.address}>
                        {evt.address}
                      </span>
                    )}
                    <span className="ml-auto text-[9px] text-rmpg-600 whitespace-nowrap">
                      {new Date(evt.event_timestamp).toLocaleString()}
                    </span>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="flex items-center gap-2 text-[10px] text-rmpg-500 bg-surface-sunken p-2 rounded-sm">
              <Camera className="w-3.5 h-3.5 text-rmpg-600 shrink-0" />
              No dashcam events recorded yet. Events are captured automatically from ClearPathGPS when the poller detects camera triggers, hard braking, impacts, or other driving events.
            </div>
          )}
        </div>
      )}

      {/* ── Section 5: Media Sync ── */}
      {status?.configured && status.enabled && mappings.length > 0 && (
        <div className="panel-beveled p-3 bg-surface-base border-t-2 border-t-purple-500 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Video className="w-3.5 h-3.5 text-purple-400" />
              <h3 className="field-label text-purple-400">Dashcam Video Sync</h3>
              <span className={`w-1.5 h-1.5 rounded-full ${mediaSyncEnabled ? 'bg-purple-400 animate-pulse' : 'bg-rmpg-600'}`} />
            </div>
            <button type="button"
              onClick={handleToggleMediaSync}
              disabled={savingMedia}
              className="flex items-center gap-1 text-[10px] text-rmpg-300 hover:text-white transition-colors"
              title={mediaSyncEnabled ? 'Disable media sync' : 'Enable media sync'}
            >
              {mediaSyncEnabled ? (
                <ToggleRight className="w-5 h-5 text-purple-400" />
              ) : (
                <ToggleLeft className="w-5 h-5 text-rmpg-500" />
              )}
              {mediaSyncEnabled ? 'ON' : 'OFF'}
            </button>
          </div>

          <p className="text-[10px] text-rmpg-500 leading-relaxed">
            Automatically downloads dashcam video clips from ClearPathGPS v3.0 Media API.
            Clips are matched to driving events and stored locally for evidence management.
          </p>

          {/* Controls row */}
          <div className="flex items-center gap-3 flex-wrap">
            {/* Poll interval */}
            <div className="flex items-center gap-1.5">
              <Clock className="w-3 h-3 text-rmpg-500" />
              <span className="text-[10px] text-rmpg-400">Check every:</span>
              <select
                value={mediaPollInterval}
                onChange={e => handleMediaPollIntervalChange(parseInt(e.target.value, 10))}
                disabled={!mediaSyncEnabled || savingMedia}
                className="select-dark text-[10px] py-0.5 px-1.5 w-20"
              >
                <option value={60}>1 min</option>
                <option value={120}>2 min</option>
                <option value={300}>5 min</option>
                <option value={600}>10 min</option>
                <option value={900}>15 min</option>
              </select>
            </div>

            {/* Sync Now button */}
            <button type="button"
              onClick={handleSyncNow}
              disabled={syncing || !status?.enabled}
              className="inline-flex items-center gap-1 px-2 py-1 text-[10px] font-bold uppercase tracking-wide
                         bg-purple-900/50 hover:bg-purple-800/60 border border-purple-700/50 text-purple-300
                         disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {syncing ? (
                <Loader2 className="w-3 h-3 animate-spin" role="status" aria-label="Loading" />
              ) : (
                <Download className="w-3 h-3" />
              )}
              {syncing ? 'Syncing...' : 'Sync Now'}
            </button>
          </div>

          {/* Stats row */}
          {mediaStatus && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <div className="bg-surface-sunken p-2 text-center">
                <p className="text-sm font-bold text-purple-400 font-mono">{mediaStatus.total_synced_clips}</p>
                <p className="field-label">Clips Synced</p>
              </div>
              <div className="bg-surface-sunken p-2 text-center">
                <p className="text-sm font-bold text-rmpg-200 font-mono">{formatBytes(mediaStatus.total_synced_bytes)}</p>
                <p className="field-label">Storage Used</p>
              </div>
              <div className="bg-surface-sunken p-2 text-center">
                <p className="text-sm font-bold text-rmpg-200 font-mono">
                  {mediaStatus.last_media_sync
                    ? new Date(mediaStatus.last_media_sync).toLocaleTimeString()
                    : '—'}
                </p>
                <p className="field-label">Last Sync</p>
              </div>
              <div className="bg-surface-sunken p-2 text-center">
                <p className={`text-sm font-bold font-mono ${mediaStatus.sync_errors > 0 ? 'text-red-400' : 'text-green-400'}`}>
                  {mediaStatus.sync_errors}
                </p>
                <p className="field-label">Errors</p>
              </div>
            </div>
          )}

          {/* Per-device sync status */}
          {mediaStatus && mediaStatus.devices.length > 0 && (
            <div className="space-y-1">
              <p className="field-label text-rmpg-500">Device Sync Status</p>
              {mediaStatus.devices.map(dev => (
                <div
                  key={dev.cpg_device_id}
                  className="flex items-center justify-between bg-surface-sunken px-2 py-1.5 text-[10px]"
                >
                  <div className="flex items-center gap-2">
                    <HardDrive className="w-3 h-3 text-rmpg-500" />
                    <span className="text-rmpg-200 font-mono">{dev.cpg_display_name || dev.cpg_device_id}</span>
                    {dev.call_sign && (
                      <span className="text-brand-400 font-semibold">{dev.call_sign}</span>
                    )}
                  </div>
                  <div className="flex items-center gap-3">
                    {(dev.media_sync_errors || 0) > 0 && (
                      <span className="text-red-400 font-mono">{dev.media_sync_errors} err</span>
                    )}
                    <span className="text-rmpg-500">
                      {dev.last_media_synced_at
                        ? `Synced ${new Date(dev.last_media_synced_at).toLocaleString()}`
                        : 'Never synced'}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Not configured hint */}
      {!status?.configured && (
        <div className="flex items-center gap-2 text-[10px] text-rmpg-500 bg-surface-sunken p-3 rounded-sm">
          <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0" />
          <div>
            Enter your ClearPathGPS API credentials above to connect fleet GPS tracking.
            Hardware GPS positions will replace browser geolocation for mapped units.
          </div>
        </div>
      )}
    </div>
  );
}
