import React, { useState, useEffect, useCallback } from 'react';
import {
  Navigation, Key, Eye, EyeOff, Loader2, CheckCircle2, XCircle,
  Trash2, Zap, AlertTriangle, ToggleLeft, ToggleRight, Link2, Unlink,
  Radio, Clock, Truck, Search, Camera, History, RefreshCw, Video,
  HardDrive, Download, Play, X as XIcon, ChevronRight,
} from 'lucide-react';
import { apiFetch } from '../../hooks/useApi';
import { safeTimeStr, safeDateTimeStr, parseTimestamp } from '../../utils/dateUtils';
import { useContextMenu, type ContextMenuItem } from '../../context/ContextMenuContext';
import { useMenuActions } from '../../utils/contextMenuActions';
import { toDisplayLabel } from '../../utils/formatters';

interface Props {
  LoadingSpinner: React.FC;
  error: string | null;
  setError: (e: string | null) => void;
}

interface CameraOnlineState {
  cpg_device_id: string;
  cpg_display_name: string | null;
  ignition_state: string | null;
  last_synced_at: string | null;
  camera_offline: boolean;
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
  any_camera_offline?: boolean;
  cameras?: CameraOnlineState[];
}

interface TripClip {
  streamUrl: string;
  from_ts: number;
  to_ts: number;
}

interface FullDriveTrip {
  id: number; trip_number: number; label: string;
  from_ts: number; to_ts: number; footage_request_id: number | null;
  chunk_count: number; chunks_done: number; chunks_missing: number; status: string;
}

interface FullDriveJob {
  id: number; device_id: string; from_ts: number; to_ts: number; status: string;
  trip_count: number; clips_requested: number; clips_ready: number;
  created_at: string; trips: FullDriveTrip[];
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
  unit_id: number | null;
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


export default function AdminClearPathGpsTab({ LoadingSpinner, error, setError }: Props) {
  // Status
  const [status, setStatus] = useState<CpgStatus | null>(null);
  const [loading, setLoading] = useState(true);

  // Credentials (ClearPath refresh token from a logged-in session)
  const [refreshToken, setRefreshToken] = useState('');
  const [userId, setUserId] = useState('');
  const [accountId, setAccountId] = useState('');
  const [showSecret, setShowSecret] = useState(false);
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
  const [actionResult, setActionResult] = useState<string | null>(null);

  // Full-drive download
  const [showFullDrive, setShowFullDrive] = useState(false);
  const [fullDriveDeviceId, setFullDriveDeviceId] = useState('');
  const [fullDriveHours, setFullDriveHours] = useState(8);
  const [fullDriveRunning, setFullDriveRunning] = useState(false);
  const [fullDriveError, setFullDriveError] = useState<string | null>(null);
  const [activeJobId, setActiveJobId] = useState<number | null>(null);
  const [jobStatus, setJobStatus] = useState<FullDriveJob | null>(null);
  const [tickNow, setTickNow] = useState(Date.now());

  // ── Right-click context menu ──
  const { openMenu } = useContextMenu();
  const cm = useMenuActions();

  // ── Fetch status ──
  const fetchStatus = useCallback(async () => {
    try {
      const data = await apiFetch<CpgStatus>('/clearpathgps/status');
      setStatus(data);
      setPollInterval(data.poll_interval_seconds || 30);
    } catch (err) {
    } finally {
      setLoading(false);
    }
  }, []);

  // ── Fetch mappings ──
  const fetchMappings = useCallback(async () => {
    try {
      const data = await apiFetch<{ mappings: CpgMapping[] }>('/clearpathgps/mappings');
      setMappings(data.mappings || []);
    } catch { /* silently skip */ }
  }, []);

  // ── Fetch units ──
  const fetchUnits = useCallback(async () => {
    try {
      const data = await apiFetch<DispatchUnit[]>('/dispatch/units');
      setUnits(Array.isArray(data) ? data : []);
    } catch { /* silently skip */ }
  }, []);

  // ── Fetch settings ──
  const fetchSettings = useCallback(async () => {
    try {
      const data = await apiFetch<{ history_backfill: boolean }>('/clearpathgps/settings');
      setHistoryBackfill(!!data?.history_backfill);
    } catch { /* silently skip */ }
  }, []);

  // ── Fetch dashcam events ──
  const fetchDashcamEvents = useCallback(async () => {
    setLoadingDashcam(true);
    try {
      const data = await apiFetch<{ events: DashcamEvent[]; total: number }>('/clearpathgps/dashcam-events?limit=50');
      setDashcamEvents(data.events || []);
      setDashcamTotal(data.total || 0);
    } catch { /* silently skip */ }
    finally { setLoadingDashcam(false); }
  }, []);

  // ── Fetch media sync status ──
  const fetchMediaStatus = useCallback(async () => {
    try {
      const data = await apiFetch<MediaSyncStatus>('/clearpathgps/media-status');
      setMediaStatus(data);
      setMediaSyncEnabled(data.media_sync_enabled);
      setMediaPollInterval(data.media_poll_interval_seconds || 300);
    } catch { /* silently skip */ }
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
    if (!refreshToken.trim()) return;
    setSaving(true);
    setTestResult(null);
    try {
      await apiFetch('/clearpathgps/credentials', {
        method: 'PUT',
        body: JSON.stringify({ refresh_token: refreshToken.trim(), user_id: String(userId).trim(), account_id: String(accountId).trim() }),
      });
      setRefreshToken('');
      setUserId('');
      setAccountId('');
      setShowSecret(false);
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
          setTestResult({ success: false, error: 'No accounts found for these API credentials' });
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

  // ── Assign a unit to an existing (unlinked) mapping ──
  const handleBindUnit = async (m: CpgMapping, unitId: number) => {
    try {
      // POST replaces the mapping row server-side (DELETE + INSERT → new id); the UI
      // re-fetches so the list stays consistent. /relink keys on cpg_device_id, not
      // the mapping id, so relink remains valid across the replacement.
      await apiFetch('/clearpathgps/mappings', {
        method: 'POST',
        body: JSON.stringify({
          cpg_device_id: m.cpg_device_id,
          cpg_display_name: m.cpg_display_name,
          cpg_serial_number: m.cpg_serial_number,
          unit_id: unitId,
        }),
      });
      await fetchMappings();
    } catch (e) { setError('Failed to assign unit.'); }
  };

  // ── Backfill past events for a newly-linked mapping ──
  const handleRelinkPast = async (mappingId: number) => {
    try {
      const r = await apiFetch<{ relinked_events: number }>(`/clearpathgps/mappings/${mappingId}/relink`, { method: 'POST' });
      setActionResult(`Linked ${r.relinked_events} past event(s) to the unit.`);
    } catch (e) { setError('Relink failed.'); }
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
  // The Worker fires the sync via waitUntil and returns { started: true }
  // immediately — video downloads can take 90 s+, so we don't block on them.
  // Refresh stats 5 s after the response to catch the first completed clips.
  const handleSyncNow = async () => {
    setSyncing(true);
    setError(null);
    try {
      await apiFetch<{ started: boolean }>('/clearpathgps/media-sync-now', { method: 'POST' });
      setError(null);
      // Sync runs in background — poll stats after a delay
      setTimeout(() => { fetchMediaStatus().catch(() => {}); setSyncing(false); }, 30_000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Media sync failed');
      setSyncing(false);
    }
    setSyncing(false);
  };

  // ── Auto-map dashcam devices ──
  const handleAutoMap = async () => {
    setSyncing(true);
    setActionResult(null);
    try {
      const result = await apiFetch<{ success: boolean; mapped: number; candidates: number; error?: string }>('/clearpathgps/auto-map-devices', { method: 'POST' });
      if (result.error) {
        setError(result.error);
      } else {
        setError(null);
        setActionResult(`Auto-mapped ${result.mapped} of ${result.candidates} dashcam device(s).`);
      }
      await fetchStatus();
      await fetchMappings();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Auto-map devices failed');
    } finally {
      setSyncing(false);
    }
  };

  // ── Enable dashcam ALPR media sync ──
  const handleEnableMedia = async () => {
    setSyncing(true);
    setActionResult(null);
    try {
      const result = await apiFetch<{ success: boolean; media_sync_enabled: boolean; mapped: number; candidates: number; error?: string }>('/clearpathgps/enable-media', { method: 'POST' });
      if (result.error) {
        setError(result.error);
      } else {
        setError(null);
        setActionResult('Dashcam ALPR media sync enabled.');
      }
      await fetchStatus();
      await fetchMediaStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Enable dashcam ALPR failed');
    } finally {
      setSyncing(false);
    }
  };

  // ── Run ALPR still-scan now ──
  const handleScanAlprNow = async () => {
    setSyncing(true);
    setActionResult(null);
    try {
      const result = await apiFetch<{ scanned: number; captured: number; note?: string; error?: string }>('/clearpathgps/scan-alpr-now', { method: 'POST' });
      if (result.error) {
        setError(result.error);
      } else {
        setError(null);
        setActionResult(`Scanned ${result.scanned}, captured ${result.captured}.${result.note ? ' ' + result.note : ''}`);
        await fetchMediaStatus();
        await fetchStatus();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'ALPR scan failed');
    } finally {
      setSyncing(false);
    }
  };

  // ── Trigger full-drive trip job ──
  const handleFullDrive = async () => {
    setFullDriveRunning(true);
    setFullDriveError(null);
    setActiveJobId(null);
    setJobStatus(null);
    try {
      const body: Record<string, unknown> = { hours_back: fullDriveHours };
      if (fullDriveDeviceId) body.device_id = fullDriveDeviceId;
      const r = await apiFetch<{ started: boolean; job_id?: number; trip_count?: number; error?: string }>(
        '/clearpathgps/full-drive', { method: 'POST', body: JSON.stringify(body) });
      if (r.error || !r.started) {
        setFullDriveError(r.error ?? 'Failed to start');
      } else if (r.job_id) {
        setActiveJobId(r.job_id);
      }
    } catch (err) {
      setFullDriveError(err instanceof Error ? err.message : 'Full-drive request failed');
    } finally {
      setFullDriveRunning(false);
    }
  };

  // ── Poll active job status ──
  const pollJobStatus = useCallback(async (jobId: number) => {
    try {
      const j = await apiFetch<FullDriveJob>(`/clearpathgps/full-drive/jobs/${jobId}`);
      setJobStatus(j);
    } catch { /* non-fatal */ }
  }, []);

  useEffect(() => {
    if (!activeJobId || jobStatus?.status === 'done') return;
    pollJobStatus(activeJobId);
    const t = setInterval(() => pollJobStatus(activeJobId), 10_000);
    return () => clearInterval(t);
  }, [activeJobId, jobStatus?.status, pollJobStatus]);

  // 1-second tick so ETA countdown animates without re-polling the API.
  useEffect(() => {
    if (!activeJobId || jobStatus?.status === 'done') return;
    const t = setInterval(() => setTickNow(Date.now()), 1_000);
    return () => clearInterval(t);
  }, [activeJobId, jobStatus?.status]);

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.min(Math.floor(Math.log(bytes) / Math.log(k)), sizes.length - 1);
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
  };

  // ── Context-menu builders (one per record list) ──
  const buildMappingMenu = (mapping: CpgMapping): ContextMenuItem[] => [
    cm.copy('Copy device ID', mapping.cpg_device_id, <Truck size={12} />),
    ...(mapping.call_sign ? [cm.copy('Copy call sign', mapping.call_sign)] : []),
    ...(mapping.license_plate ? [cm.copy('Copy plate', mapping.license_plate)] : []),
    ...(mapping.vehicle_vin ? [cm.copy('Copy VIN', mapping.vehicle_vin)] : []),
    cm.copyId(mapping.id, 'Copy mapping ID'),
    cm.separator(),
    cm.action('Remove mapping', () => handleRemoveMapping(mapping.id), { icon: <Unlink size={12} />, danger: true }),
  ];

  const buildDeviceMenu = (device: CpgDevice): ContextMenuItem[] => {
    const devId = device.deviceId || device.gtsDeviceId;
    const hasCoords = Number.isFinite(device.lastValidLatitude) && Number.isFinite(device.lastValidLongitude);
    return [
      cm.copy('Copy device ID', devId, <Truck size={12} />),
      ...(device.displayName ? [cm.copy('Copy name', device.displayName)] : []),
      ...(device.serialNumber ? [cm.copy('Copy serial number', device.serialNumber)] : []),
      ...(device.licensePlate ? [cm.copy('Copy plate', device.licensePlate)] : []),
      ...(device.vehicleID ? [cm.copy('Copy VIN', device.vehicleID)] : []),
      ...(hasCoords ? [
        cm.separator(),
        cm.copyCoords(device.lastValidLatitude, device.lastValidLongitude),
        cm.openExternal('Locate on Google Maps', `https://maps.google.com/?q=${device.lastValidLatitude},${device.lastValidLongitude}`, <Navigation size={12} />),
      ] : []),
    ];
  };

  const buildDashcamMenu = (evt: DashcamEvent): ContextMenuItem[] => {
    const hasCoords = evt.latitude != null && evt.longitude != null;
    return [
      cm.copy('Copy event type', evt.event_type, <Camera size={12} />),
      ...(evt.call_sign ? [cm.copy('Copy call sign', evt.call_sign)] : []),
      ...(evt.address ? [cm.copy('Copy address', evt.address)] : []),
      ...(hasCoords ? [cm.copyCoords(evt.latitude, evt.longitude)] : []),
      cm.copyId(evt.id, 'Copy event ID'),
      ...(hasCoords ? [
        cm.separator(),
        cm.openExternal('Locate on Google Maps', `https://maps.google.com/?q=${evt.latitude},${evt.longitude}`, <Navigation size={12} />),
      ] : []),
    ];
  };

  // Set document title
  useEffect(() => { document.title = 'Admin - GPS \u2014 RMPG Flex'; }, []);

  // Units that are not already mapped (exclude null unit_id from the blocked set)
  const mappedUnitIds = new Set(mappings.map(m => m.unit_id).filter((id): id is number => id != null));
  const availableUnits = (Array.isArray(units) ? units : []).filter(u => !mappedUnitIds.has(u.id));

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

      {/* Camera offline banner — surfaces why on-demand video requests are
          sitting at "Waiting for Camera…" upstream. Dashcam can only deliver
          mp4s when the LTE modem is awake (ignition on). While the vehicle is
          parked the cron poller intentionally pauses these chunks instead of
          burning their attempt counter, so they fulfill the next time the
          vehicle drives. (Auto-uploaded events — FCW, hard brake, lane
          departure — are NOT affected; the camera pushes those in real time.) */}
      {status?.configured && status.any_camera_offline && (status.cameras?.length ?? 0) > 0 && (
        <div className="panel-beveled p-3 bg-amber-950/30 border-l-2 border-amber-500/70 space-y-2">
          <div className="flex items-center gap-2 text-[11px] font-bold text-amber-300 uppercase tracking-wider">
            <AlertTriangle className="w-4 h-4 text-amber-400" />
            Camera offline — pending video requests are paused
          </div>
          <div className="text-[10px] text-amber-200/80 leading-snug">
            ClearPath only delivers on-demand clips when the dashcam is online
            (vehicle ignition on, LTE modem awake). Queued requests stay in
            "Waiting for Camera…" upstream and will resume automatically the
            next time the vehicle drives. Auto-events (FCW, hard brake, lane
            departure) are unaffected — those upload in real time.
          </div>
          <div className="text-[10px] text-amber-200/90 space-y-0.5">
            {(status.cameras ?? []).filter((c) => c.camera_offline).map((c) => (
              <div key={c.cpg_device_id} className="flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
                <span className="font-medium">{c.cpg_display_name || c.cpg_device_id}</span>
                <span className="text-amber-200/60">
                  · ignition {c.ignition_state || 'unknown'}
                  {c.last_synced_at ? ` · last GPS ${safeTimeStr(c.last_synced_at)}` : ''}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ═══ Section 1: Credentials ═══ */}
      <form onSubmit={(e) => e.preventDefault()} autoComplete="off">
      <div className="panel-beveled bg-surface-base p-3 space-y-3">
        <div className="flex items-center gap-2 text-[10px] font-bold text-rmpg-300 uppercase tracking-wider">
          <Key className="w-3.5 h-3.5" />
          API Credentials
        </div>

        {/* Refresh Token */}
        <div className="space-y-1.5">
          <label htmlFor="ff-adminclearpathgpstab-0" className="text-[10px] text-rmpg-400">Refresh Token</label>
          <div className="relative">
            <input id="ff-adminclearpathgpstab-0"
              type={showSecret ? 'text' : 'password'}
              value={refreshToken}
              onChange={(e) => setRefreshToken(e.target.value)}
              placeholder={status?.configured ? 'Enter new Refresh Token to replace...' : 'ClearPath session refresh token...'}
              autoComplete="new-password"
              spellCheck={false}
              className="w-full bg-surface-sunken border border-rmpg-600 text-rmpg-200 text-xs px-2.5 py-1.5 pr-8 rounded-sm focus:border-brand-500 focus:outline-none font-mono"
            />
            <button type="button"
              onClick={() => setShowSecret(!showSecret)}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-rmpg-500 hover:text-rmpg-300"
            >
              {showSecret ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
            </button>
          </div>
        </div>

        {/* User ID */}
        <div className="space-y-1.5">
          <label htmlFor="ff-adminclearpathgpstab-1" className="text-[10px] text-rmpg-400">User ID <span className="text-rmpg-600">(optional)</span></label>
          <input id="ff-adminclearpathgpstab-1"
            type="text"
            value={userId}
            onChange={(e) => setUserId(e.target.value)}
            placeholder={status?.configured ? 'Enter new User ID to replace...' : 'ClearPath userIdCp (e.g. 47647)...'}
            className="w-full bg-surface-sunken border border-rmpg-600 text-rmpg-200 text-xs px-2.5 py-1.5 rounded-sm focus:border-brand-500 focus:outline-none font-mono"
          />
        </div>

        {/* Account ID (optional — derived server-side; for display/scoping) */}
        <div className="space-y-1.5">
          <label htmlFor="ff-adminclearpathgpstab-2" className="text-[10px] text-rmpg-400">Account ID <span className="text-rmpg-600">(optional)</span></label>
          <input id="ff-adminclearpathgpstab-2"
            type="text"
            value={accountId}
            onChange={(e) => setAccountId(e.target.value)}
            placeholder={status?.configured ? 'Enter new Account ID to replace...' : 'GPS-Insight account id (e.g. 3637)...'}
            className="w-full bg-surface-sunken border border-rmpg-600 text-rmpg-200 text-xs px-2.5 py-1.5 rounded-sm focus:border-brand-500 focus:outline-none font-mono"
          />
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-2">
          <button type="button"
            onClick={handleSaveCredentials}
            disabled={saving || !refreshToken.trim()}
            className="toolbar-btn text-[10px] flex items-center gap-1 px-3 py-1.5 bg-brand-600 hover:bg-brand-500 text-rmpg-100 disabled:opacity-50"
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
      </form>

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
              <select id="ff-adminclearpathgpstab-3"
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
                  Last: {safeTimeStr(status.last_sync)}
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
                    onContextMenu={(e) => openMenu(e, buildMappingMenu(m))}
                    className="px-2 py-1.5 bg-surface-sunken rounded-sm text-[11px]"
                  >
                    <div className="flex items-center gap-2">
                      <Truck className="w-3 h-3 text-brand-400 shrink-0" />
                      <span className="text-rmpg-200 font-medium">{m.cpg_display_name || m.cpg_device_id}</span>
                      <span className="text-rmpg-600">→</span>
                      {m.unit_id == null ? (
                        <>
                          <span className="text-[9px] px-1.5 py-0.5 rounded-sm bg-amber-500/20 text-amber-300 border border-amber-500/40 whitespace-nowrap">
                            Not linked to a unit
                          </span>
                          <select
                            defaultValue=""
                            onChange={(e) => {
                              if (e.target.value) {
                                handleBindUnit(m, parseInt(e.target.value, 10));
                                e.target.value = '';
                              }
                            }}
                            className="bg-surface-sunken border border-rmpg-600 text-rmpg-200 text-[10px] px-2 py-1 rounded-sm focus:border-brand-500 focus:outline-none"
                          >
                            <option value="">Assign unit…</option>
                            {availableUnits.map(u => (
                              <option key={u.id} value={u.id}>
                                {u.call_sign} {u.officer_name ? `(${u.officer_name})` : ''}
                              </option>
                            ))}
                          </select>
                        </>
                      ) : (
                        <>
                          <span className="text-brand-400 font-mono font-medium">{m.call_sign || `Unit #${m.unit_id}`}</span>
                          {m.officer_name && <span className="text-rmpg-500 text-[10px]">({m.officer_name})</span>}
                          <button
                            type="button"
                            onClick={() => handleRelinkPast(m.id)}
                            className="text-[9px] px-1.5 py-0.5 rounded-sm bg-surface-sunken border border-rmpg-600 text-rmpg-400 hover:text-rmpg-200 hover:border-rmpg-500 transition-colors whitespace-nowrap"
                            title="Backfill past events to this unit"
                          >
                            Link past events
                          </button>
                        </>
                      )}
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
                          {safeTimeStr(m.last_synced_at)}
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
                      onContextMenu={(e) => openMenu(e, buildDeviceMenu(device))}
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
                        <select id="ff-adminclearpathgpstab-4"
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
                  ? 'text-rmpg-400 bg-surface-overlay/30 border-border-subtle/40'
                  : 'text-rmpg-300 bg-surface-sunken border-rmpg-600';
                return (
                  <div
                    key={evt.id}
                    onContextMenu={(e) => openMenu(e, buildDashcamMenu(evt))}
                    className="flex items-center gap-2 px-2 py-1.5 bg-surface-sunken rounded-sm text-[11px]"
                  >
                    <Camera className="w-3 h-3 text-rmpg-400 shrink-0" />
                    <span className={`px-1.5 py-0.5 rounded-sm text-[9px] font-mono uppercase border ${typeColor}`}>
                      {toDisplayLabel(evt.event_type).toUpperCase()}
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
                      {safeDateTimeStr(evt.event_timestamp)}
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
              className="flex items-center gap-1 text-[10px] text-rmpg-300 hover:text-rmpg-100 transition-colors"
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
              <select id="ff-adminclearpathgpstab-5"
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

            {/* Auto-map devices button */}
            <button type="button"
              onClick={handleAutoMap}
              disabled={syncing || !status?.enabled}
              className="inline-flex items-center gap-1 px-2 py-1 text-[10px] font-bold uppercase tracking-wide
                         bg-purple-900/50 hover:bg-purple-800/60 border border-purple-700/50 text-purple-300
                         disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {syncing ? (
                <Loader2 className="w-3 h-3 animate-spin" role="status" aria-label="Loading" />
              ) : (
                <Link2 className="w-3 h-3" />
              )}
              Auto-map devices
            </button>

            {/* Enable dashcam ALPR button */}
            <button type="button"
              onClick={handleEnableMedia}
              disabled={syncing || !status?.enabled}
              className="inline-flex items-center gap-1 px-2 py-1 text-[10px] font-bold uppercase tracking-wide
                         bg-purple-900/50 hover:bg-purple-800/60 border border-purple-700/50 text-purple-300
                         disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {syncing ? (
                <Loader2 className="w-3 h-3 animate-spin" role="status" aria-label="Loading" />
              ) : (
                <Camera className="w-3 h-3" />
              )}
              Enable dashcam ALPR
            </button>

            {/* Scan ALPR now button */}
            <button type="button"
              onClick={handleScanAlprNow}
              disabled={syncing || !status?.enabled}
              className="inline-flex items-center gap-1 px-2 py-1 text-[10px] font-bold uppercase tracking-wide
                         bg-purple-900/50 hover:bg-purple-800/60 border border-purple-700/50 text-purple-300
                         disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {syncing ? (
                <Loader2 className="w-3 h-3 animate-spin" role="status" aria-label="Loading" />
              ) : (
                <Zap className="w-3 h-3" />
              )}
              Scan ALPR now
            </button>

            {/* Full-drive download toggle */}
            <button type="button"
              onClick={() => { setShowFullDrive(!showFullDrive); setFullDriveError(null); }}
              disabled={!status?.enabled}
              className="inline-flex items-center gap-1 px-2 py-1 text-[10px] font-bold uppercase tracking-wide
                         bg-purple-900/50 hover:bg-purple-800/60 border border-purple-700/50 text-purple-300
                         disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              <Video className="w-3 h-3" />
              Full Drive
            </button>
          </div>

          {/* Full-drive panel */}
          {showFullDrive && (
            <div className="border border-purple-700/30 bg-purple-950/20 p-3 space-y-3">
              <div className="text-[10px] text-purple-300 font-bold uppercase tracking-wider flex items-center gap-1.5">
                <Video className="w-3 h-3" /> Full Drive — Smart Trip Recorder
              </div>
              <p className="text-[10px] text-rmpg-500 leading-relaxed">
                Requests continuous 40-second footage chunks for the selected window. GPS gaps
                (engine off, stops &gt;15 min) are automatically excluded — each driving segment
                becomes its own labeled trip video.
              </p>

              {/* Controls */}
              {!activeJobId && (
                <div className="flex items-center gap-2 flex-wrap">
                  {mappings.length > 1 && (
                    <select value={fullDriveDeviceId} onChange={(e) => setFullDriveDeviceId(e.target.value)}
                      className="select-dark text-[10px] py-0.5 px-1.5">
                      <option value="">First active device</option>
                      {mappings.map((m) => (
                        <option key={m.cpg_device_id} value={m.cpg_device_id}>
                          {m.cpg_display_name || m.cpg_device_id}{m.call_sign ? ` (${m.call_sign})` : ''}
                        </option>
                      ))}
                    </select>
                  )}
                  <select value={fullDriveHours} onChange={(e) => setFullDriveHours(Number(e.target.value))}
                    className="select-dark text-[10px] py-0.5 px-1.5">
                    <option value={2}>Last 2 hours</option>
                    <option value={4}>Last 4 hours</option>
                    <option value={8}>Last 8 hours (shift)</option>
                    <option value={12}>Last 12 hours</option>
                    <option value={24}>Last 24 hours</option>
                    <option value={72}>Last 3 days</option>
                  </select>
                  <button type="button" onClick={handleFullDrive}
                    disabled={fullDriveRunning || !status?.enabled}
                    className="inline-flex items-center gap-1 px-3 py-1 text-[10px] font-bold uppercase tracking-wide
                               bg-purple-700/60 hover:bg-purple-600/60 border border-purple-500/50 text-purple-200
                               disabled:opacity-50 disabled:cursor-not-allowed transition-colors">
                    {fullDriveRunning
                      ? <Loader2 className="w-3 h-3 animate-spin" role="status" aria-label="Loading" />
                      : <Download className="w-3 h-3" />}
                    {fullDriveRunning ? 'Detecting trips...' : 'Start Full Drive'}
                  </button>
                </div>
              )}
              {fullDriveError && <p className="text-[10px] text-red-400">{fullDriveError}</p>}

              {/* Job progress */}
              {jobStatus && (() => {
                const totalPct = jobStatus.clips_requested > 0
                  ? Math.round((jobStatus.clips_ready / jobStatus.clips_requested) * 100)
                  : 0;
                const elapsed = tickNow - Date.parse(jobStatus.created_at);
                const rate = elapsed > 0 && jobStatus.clips_ready > 0
                  ? jobStatus.clips_ready / elapsed
                  : 0;
                const remaining = jobStatus.clips_requested - jobStatus.clips_ready;
                const etaStr = (() => {
                  if (jobStatus.status === 'done') return 'Complete';
                  if (!rate || remaining <= 0) return 'Calculating…';
                  const s = Math.round((remaining / rate) / 1000);
                  if (s < 60) return `~${s}s remaining`;
                  const m = Math.floor(s / 60);
                  const rs = s % 60;
                  return rs > 0 ? `~${m}m ${rs}s remaining` : `~${m}m remaining`;
                })();
                return (
                <div className="space-y-2">
                  {/* Total progress header */}
                  <div className="border border-purple-600/30 bg-purple-900/20 p-2 space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] text-purple-200 font-bold uppercase tracking-wider">
                        {jobStatus.trip_count} Trip{jobStatus.trip_count !== 1 ? 's' : ''} · Total Download
                      </span>
                      <button aria-label="Close" type="button"
                        onClick={() => { setActiveJobId(null); setJobStatus(null); }}
                        className="text-rmpg-500 hover:text-rmpg-300 transition-colors">
                        <XIcon className="w-3 h-3" />
                      </button>
                    </div>
                    <div className="h-2.5 bg-surface-sunken rounded-full overflow-hidden">
                      <div className="h-full bg-purple-500 transition-all duration-1000"
                        style={{ width: `${totalPct}%` }} />
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-bold text-purple-300">{totalPct}%</span>
                      <span className="text-[10px] text-rmpg-400">
                        {jobStatus.clips_ready} / {jobStatus.clips_requested} clips
                      </span>
                      <span className={`text-[10px] font-bold ${jobStatus.status === 'done' ? 'text-green-400' : 'text-yellow-400'}`}>
                        {etaStr}
                      </span>
                    </div>
                  </div>

                  {/* Trip cards */}
                  {jobStatus.trips.map((trip) => {
                    const settled = trip.chunks_done + trip.chunks_missing;
                    const pct = trip.chunk_count > 0 ? Math.round((settled / trip.chunk_count) * 100) : 0;
                    const ready = trip.status === 'done' || trip.status === 'partial';
                    const durationMin = Math.round((trip.to_ts - trip.from_ts) / 60_000);
                    const tripRemaining = trip.chunk_count - settled;
                    const tripEta = (() => {
                      if (ready || !rate || tripRemaining <= 0) return null;
                      const s = Math.round((tripRemaining / rate) / 1000);
                      return s < 60 ? `~${s}s` : `~${Math.ceil(s / 60)}m`;
                    })();
                    return (
                      <div key={trip.id} className="border border-purple-700/20 bg-purple-950/30 p-2 space-y-1">
                        <div className="flex items-center justify-between gap-2">
                          <div className="min-w-0">
                            <p className="text-[10px] font-bold text-purple-200 truncate">{trip.label}</p>
                            <p className="text-[9px] text-rmpg-500">
                              {durationMin > 0 ? `${durationMin} min · ` : ''}
                              {trip.chunks_done}/{trip.chunk_count} clips
                              {trip.chunks_missing > 0 ? ` · ${trip.chunks_missing} gaps` : ''}
                              {tripEta ? <span className="text-yellow-500 ml-1">· {tripEta}</span> : null}
                              {ready ? <span className="text-green-400 ml-1">· Ready</span> : null}
                            </p>
                          </div>
                          <div className="flex items-center gap-1.5 shrink-0">
                            <span className="text-[9px] font-bold text-purple-400 w-7 text-right">{pct}%</span>
                            {ready && trip.footage_request_id && (
                              <a href={`/flexcam/${trip.footage_request_id}`} target="_blank" rel="noreferrer"
                                className="inline-flex items-center gap-1 px-2 py-0.5 text-[9px] font-bold uppercase
                                           bg-green-800/60 hover:bg-green-700/60 border border-green-600/40 text-green-300
                                           transition-colors">
                                <Play className="w-2.5 h-2.5" /> Play
                              </a>
                            )}
                          </div>
                        </div>
                        <div className="h-1 bg-surface-sunken rounded-full overflow-hidden">
                          <div
                            className={`h-full transition-all duration-1000 ${ready ? 'bg-green-500' : 'bg-purple-500'}`}
                            style={{ width: `${pct}%` }} />
                        </div>
                      </div>
                    );
                  })}

                  <button type="button" onClick={() => { setActiveJobId(null); setJobStatus(null); }}
                    className="text-[10px] text-purple-400 hover:text-purple-300 underline transition-colors">
                    Start another full drive
                  </button>
                </div>
                );
              })()}

            </div>
          )}

          {actionResult && (
            <p className="mt-1 text-[10px] text-green-400">{actionResult}</p>
          )}

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
                    ? parseTimestamp(mediaStatus.last_media_sync).toLocaleTimeString('en-US', { timeZone: 'America/Denver' })
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
                        ? `Synced ${parseTimestamp(dev.last_media_synced_at).toLocaleString('en-US', { timeZone: 'America/Denver' })}`
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
            Connect by pasting a ClearPath session <strong>refresh token</strong> (from a logged-in portal session)
            above; it's exchanged server-side for short-lived access tokens. Hardware GPS positions will replace
            browser geolocation for mapped units.
          </div>
        </div>
      )}
    </div>
  );
}
