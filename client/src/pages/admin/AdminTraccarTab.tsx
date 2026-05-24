import React, { useState, useEffect, useCallback } from 'react';
import {
  Navigation, Key, Eye, EyeOff, Loader2, CheckCircle2, XCircle,
  Trash2, Zap, AlertTriangle, ToggleLeft, ToggleRight, Link2, Unlink,
  Radio, Clock, Truck, Camera, History, RefreshCw, Globe,
} from 'lucide-react';
import { apiFetch } from '../../hooks/useApi';
import AdminTraccarHistoricalSection from './AdminTraccarHistoricalSection';

interface Props {
  LoadingSpinner: React.FC;
  error: string | null;
  setError: (e: string | null) => void;
}

interface TraccarStatus {
  configured: boolean;
  enabled: boolean;
  poll_interval_seconds: number;
  active_mappings: number;
  last_sync: string | null;
}

interface TraccarDevice {
  id: number;
  name: string;
  uniqueId: string;
  status: string;
  lastUpdate: string;
  model: string;
  category: string;
  phone: string;
  attributes: Record<string, any>;
}

interface DeviceMapping {
  id: number;
  cpg_device_id: string;     // stores Traccar uniqueId
  cpg_display_name: string | null;
  traccar_device_id: number | null;
  unit_id: number;
  call_sign: string | null;
  unit_status: string | null;
  officer_name: string | null;
  last_synced_at: string | null;
  ignition_state: string | null;
  last_odometer: number | null;
}

interface DispatchUnit {
  id: number;
  call_sign: string;
  status: string;
  officer_name?: string;
}

interface TelemetryEvent {
  id: number;
  cpg_device_id: string;
  unit_id: number | null;
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

export default function AdminTraccarTab({ LoadingSpinner, error, setError }: Props) {
  // Status
  const [status, setStatus] = useState<TraccarStatus | null>(null);
  const [loading, setLoading] = useState(true);

  // Credentials
  const [url, setUrl] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [saving, setSaving] = useState(false);

  // Connection test
  const [testResult, setTestResult] = useState<{ success: boolean; deviceCount?: number; error?: string } | null>(null);
  const [testing, setTesting] = useState(false);

  // Devices & mappings
  const [devices, setDevices] = useState<TraccarDevice[]>([]);
  const [mappings, setMappings] = useState<DeviceMapping[]>([]);
  const [units, setUnits] = useState<DispatchUnit[]>([]);
  const [loadingDevices, setLoadingDevices] = useState(false);

  // Polling interval
  const [pollInterval, setPollInterval] = useState(30);

  // History backfill toggle
  const [historyBackfill, setHistoryBackfill] = useState(true);

  // Telemetry events
  const [events, setEvents] = useState<TelemetryEvent[]>([]);
  const [loadingEvents, setLoadingEvents] = useState(false);
  const [eventsTotal, setEventsTotal] = useState(0);

  // ── Fetch status ──
  const fetchStatus = useCallback(async () => {
    try {
      const data = await apiFetch<TraccarStatus>('/traccar/status');
      setStatus(data);
      setPollInterval(data.poll_interval_seconds || 30);
    } catch (err) {
      console.error('Failed to fetch Traccar status:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  // ── Fetch mappings ──
  const fetchMappings = useCallback(async () => {
    try {
      const data = await apiFetch<{ mappings: DeviceMapping[] }>('/traccar/mappings');
      setMappings(data.mappings || []);
    } catch { /* ignore */ }
  }, []);

  // ── Fetch units ──
  const fetchUnits = useCallback(async () => {
    try {
      const data = await apiFetch<DispatchUnit[]>('/dispatch/units');
      setUnits(Array.isArray(data) ? data : []);
    } catch { /* ignore */ }
  }, []);

  // ── Fetch settings ──
  const fetchSettings = useCallback(async () => {
    try {
      const data = await apiFetch<{ history_backfill: boolean }>('/traccar/settings');
      setHistoryBackfill(data.history_backfill);
    } catch { /* ignore */ }
  }, []);

  // ── Fetch telemetry events ──
  const fetchEvents = useCallback(async () => {
    setLoadingEvents(true);
    try {
      const data = await apiFetch<{ events: TelemetryEvent[]; total: number }>('/traccar/dashcam-events?limit=50');
      setEvents(data.events || []);
      setEventsTotal(data.total || 0);
    } catch { /* ignore */ }
    finally { setLoadingEvents(false); }
  }, []);

  useEffect(() => {
    fetchStatus();
    fetchMappings();
    fetchUnits();
    fetchSettings();
    fetchEvents();
  }, [fetchStatus, fetchMappings, fetchUnits, fetchSettings, fetchEvents]);

  // ── Save credentials ──
  const handleSaveCredentials = async () => {
    if (!url.trim() || !email.trim() || !password.trim()) return;
    setSaving(true);
    setTestResult(null);
    try {
      await apiFetch('/traccar/credentials', {
        method: 'PUT',
        body: JSON.stringify({ url, email, password }),
      });
      setEmail('');
      setPassword('');
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
      await apiFetch('/traccar/credentials', { method: 'DELETE' });
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
      const result = await apiFetch<{ success: boolean; deviceCount: number; error?: string }>('/traccar/test-connection', { method: 'POST' });
      setTestResult(result);
    } catch (err) {
      setTestResult({ success: false, error: err instanceof Error ? err.message : 'Connection test failed' });
    } finally {
      setTesting(false);
    }
  };

  // ── Toggle enabled ──
  const handleToggleEnabled = async () => {
    if (!status) return;
    const newEnabled = !status.enabled;
    try {
      await apiFetch('/traccar/enable', {
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
        await apiFetch('/traccar/enable', {
          method: 'PUT',
          body: JSON.stringify({ enabled: true, poll_interval_seconds: seconds }),
        });
        await fetchStatus();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to update poll interval');
      }
    }
  };

  // ── Fetch devices from Traccar ──
  const handleFetchDevices = async () => {
    setLoadingDevices(true);
    try {
      const data = await apiFetch<{ devices: TraccarDevice[] }>('/traccar/devices');
      setDevices(data.devices || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch devices');
    } finally {
      setLoadingDevices(false);
    }
  };

  // ── Create mapping ──
  const handleCreateMapping = async (device: TraccarDevice, unitId: number) => {
    try {
      await apiFetch('/traccar/mappings', {
        method: 'POST',
        body: JSON.stringify({
          device_unique_id: device.uniqueId,
          device_name: device.name,
          traccar_device_id: device.id,
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
      await apiFetch(`/traccar/mappings/${mappingId}`, { method: 'DELETE' });
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
      await apiFetch('/traccar/settings', {
        method: 'PUT',
        body: JSON.stringify({ history_backfill: newVal }),
      });
    } catch (err) {
      setHistoryBackfill(!newVal); // revert
      setError(err instanceof Error ? err.message : 'Failed to update settings');
    }
  };

  if (loading) return <LoadingSpinner />;

  // Units that are not already mapped
  const mappedUnitIds = new Set(mappings.map(m => m.unit_id));
  const availableUnits = units.filter(u => !mappedUnitIds.has(u.id));

  return (
    <div className="p-4 space-y-4">
      {/* Header */}
      <div className="flex items-center gap-2">
        <Navigation className="w-4 h-4 text-brand-400" />
        <h2 className="text-xs font-bold uppercase tracking-wider text-rmpg-200">Traccar GPS Integration</h2>
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
          Traccar Server Credentials
        </div>

        {/* Server URL */}
        <div className="space-y-1.5">
          <label className="text-[10px] text-rmpg-400">Server URL</label>
          <div className="flex items-center gap-2">
            <Globe className="w-3.5 h-3.5 text-rmpg-500 shrink-0" />
            <input
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://traccar.example.com:8082"
              className="flex-1 bg-surface-sunken border border-rmpg-600 text-rmpg-200 text-xs px-2.5 py-1.5 rounded-sm focus:border-brand-500 focus:outline-none font-mono"
            />
          </div>
        </div>

        {/* Email */}
        <div className="space-y-1.5">
          <label className="text-[10px] text-rmpg-400">Admin Email</label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder={status?.configured ? 'Enter new email to replace...' : 'Traccar admin email...'}
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
              placeholder={status?.configured ? 'Enter new password to replace...' : 'Traccar password...'}
              className="w-full bg-surface-sunken border border-rmpg-600 text-rmpg-200 text-xs px-2.5 py-1.5 pr-8 rounded-sm focus:border-brand-500 focus:outline-none font-mono"
            />
            <button
              onClick={() => setShowPassword(!showPassword)}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-rmpg-500 hover:text-rmpg-300"
            >
              {showPassword ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
            </button>
          </div>
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-2">
          <button
            onClick={handleSaveCredentials}
            disabled={saving || !url.trim() || !/^https?:\/\//i.test(url.trim()) || !email.trim() || !password.trim()}
            className="toolbar-btn text-[10px] flex items-center gap-1 px-3 py-1.5 bg-brand-600 hover:bg-brand-500 text-white disabled:opacity-50"
          >
            {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCircle2 className="w-3 h-3" />}
            Save Credentials
          </button>
          {status?.configured && (
            <>
              <button
                onClick={handleTest}
                disabled={testing}
                className="toolbar-btn text-[10px] flex items-center gap-1 px-3 py-1.5"
              >
                {testing ? <Loader2 className="w-3 h-3 animate-spin" /> : <Zap className="w-3 h-3" />}
                Test Connection
              </button>
              <button
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
      </div>

      {/* ═══ Section 2: Enable/Disable + Poll Interval ═══ */}
      {status?.configured && (
        <div className="panel-beveled bg-surface-base p-3 space-y-3">
          <div className="flex items-center gap-2 text-[10px] font-bold text-rmpg-300 uppercase tracking-wider">
            <Radio className="w-3.5 h-3.5" />
            Polling Control
          </div>

          <div className="flex items-center gap-4">
            <button
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
            <button
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
            <button
              onClick={handleFetchDevices}
              disabled={loadingDevices}
              className="toolbar-btn text-[10px] flex items-center gap-1 px-3 py-1.5"
            >
              {loadingDevices ? <Loader2 className="w-3 h-3 animate-spin" /> : <Truck className="w-3 h-3" />}
              Load Devices
            </button>
          </div>

          {/* Current mappings */}
          {mappings.length > 0 && (
            <div className="space-y-1">
              <div className="text-[9px] text-rmpg-500 uppercase tracking-wider">Active Mappings</div>
              {mappings.map((m) => (
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
                      <span className={`text-[9px] px-1 py-0.5 rounded ${
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
                    <button
                      onClick={() => handleRemoveMapping(m.id)}
                      className="ml-1 text-red-500 hover:text-red-400"
                      title="Remove mapping"
                    >
                      <Unlink className="w-3 h-3" />
                    </button>
                  </div>
                  {m.last_odometer != null && (
                    <div className="flex items-center gap-3 ml-5 mt-0.5 text-[9px] text-rmpg-500">
                      <span>{m.last_odometer.toLocaleString()} mi</span>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Available devices to map */}
          {devices.length > 0 && (
            <div className="space-y-1">
              <div className="text-[9px] text-rmpg-500 uppercase tracking-wider">
                Traccar Devices ({devices.length})
              </div>
              <div className="max-h-64 overflow-y-auto space-y-1">
                {devices.map((device) => {
                  const existingMapping = mappings.find(m => m.cpg_device_id === device.uniqueId);
                  return (
                    <div
                      key={device.id}
                      className="flex items-center gap-2 px-2 py-1.5 bg-surface-sunken rounded-sm text-[11px]"
                    >
                      <Truck className="w-3 h-3 text-rmpg-400 shrink-0" />
                      <div className="flex-1 min-w-0">
                        <div className="text-rmpg-200 font-medium truncate">{device.name}</div>
                        <div className="text-[9px] text-rmpg-500 truncate">
                          ID: {device.uniqueId} · {device.status}
                          {device.model ? ` · ${device.model}` : ''}
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
              Click "Load Devices" to fetch your GPS hardware trackers from Traccar and map them to dispatch units.
            </div>
          )}
        </div>
      )}

      {/* ═══ Section 4: Telemetry Events ═══ */}
      {status?.configured && (
        <div className="panel-beveled bg-surface-base p-3 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-[10px] font-bold text-rmpg-300 uppercase tracking-wider">
              <Camera className="w-3.5 h-3.5" />
              Telemetry Events
              {eventsTotal > 0 && (
                <span className="text-rmpg-500 font-normal">({eventsTotal} total)</span>
              )}
            </div>
            <button
              onClick={fetchEvents}
              disabled={loadingEvents}
              className="toolbar-btn text-[10px] flex items-center gap-1 px-3 py-1.5"
            >
              {loadingEvents ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
              Refresh
            </button>
          </div>

          {events.length > 0 ? (
            <div className="max-h-72 overflow-y-auto space-y-1">
              {events.map((evt) => {
                const typeColor = /impact|collision|panic|sos/i.test(evt.event_type)
                  ? 'text-red-400 bg-red-950/30 border-red-800/40'
                  : /hard_brake|hard_turn|hard_accel|speeding/i.test(evt.event_type)
                  ? 'text-amber-400 bg-amber-950/30 border-amber-800/40'
                  : /ignition|power/i.test(evt.event_type)
                  ? 'text-gray-400 bg-gray-900/30 border-gray-700/40'
                  : 'text-rmpg-300 bg-surface-sunken border-rmpg-600';
                return (
                  <div
                    key={evt.id}
                    className="flex items-center gap-2 px-2 py-1.5 bg-surface-sunken rounded-sm text-[11px]"
                  >
                    <Navigation className="w-3 h-3 text-rmpg-400 shrink-0" />
                    <span className={`px-1.5 py-0.5 rounded text-[9px] font-mono uppercase border ${typeColor}`}>
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
              <Navigation className="w-3.5 h-3.5 text-rmpg-600 shrink-0" />
              No telemetry events recorded yet. Events are captured automatically when the poller detects alarms, hard braking, speeding, or other driving events from Traccar.
            </div>
          )}
        </div>
      )}

      {/* Historical bulk import — preserves all Traccar columns */}
      {status?.configured && <AdminTraccarHistoricalSection />}

      {/* Not configured hint */}
      {!status?.configured && (
        <div className="flex items-center gap-2 text-[10px] text-rmpg-500 bg-surface-sunken p-3 rounded-sm">
          <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0" />
          <div>
            Enter your Traccar server credentials above to connect fleet GPS tracking.
            Hardware GPS positions will replace browser geolocation for mapped units.
          </div>
        </div>
      )}
    </div>
  );
}
