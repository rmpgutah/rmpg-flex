import { useState, useEffect, useCallback, useRef } from 'react';
import { useSearchParams } from 'react-router';
import { apiFetch } from '../hooks/useApi';
import { formatEnumValue } from '../utils/formatters';
import PanelTitleBar from '../components/PanelTitleBar';
import ConfirmDialog from '../components/ConfirmDialog';
import { Camera, MapPin, Radio, RefreshCw, Activity, Search, Monitor } from 'lucide-react';
import IconButton from '../components/IconButton';
import UnitPicker from '../components/UnitPicker';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../components/ToastProvider';
import { parseTimestamp } from '../utils/dateUtils';
import { dashcamListToCsv, downloadTextFile } from '../utils/rmsListExport';
import { useSlashFocus } from '../hooks/useSlashFocus';

const SEVERITY_COLORS: Record<string, string> = {
  critical: 'text-red-400',
  warning: 'text-amber-400',
  info: 'text-rmpg-400',
};

const EVENT_ICONS: Record<string, string> = {
  sos: '🚨', panic: '🚨', impact: '💥', accident: '💥',
  hard_brake: '⚠️', speeding: '⚠️', tamper: '🔧',
  low_battery: '🔋', geofence: '📍', ignition: '🔑',
};

export default function DashcamPage() {
  const { addToast } = useToast();
  const { user } = useAuth();
  const canManage = ['admin', 'manager', 'supervisor'].includes(user?.role || '');
  const canEdit = canManage;

  const [searchParams] = useSearchParams();

  const [status, setStatus] = useState<any>(null);
  const [devices, setDevices] = useState<any[]>([]);
  const [events, setEvents] = useState<any[]>([]);
  const [selectedDevice, setSelectedDevice] = useState<any>(null);
  const [deviceDetail, setDeviceDetail] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [tab, setTab] = useState<'devices' | 'events'>('devices');

  // ConfirmDialog state for device deactivation (admin/manager only)
  const [deactivateTarget, setDeactivateTarget] = useState<any>(null);

  const pageRef = useRef(page);
  const searchRef = useRef(search);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const deepLinkRef = useRef(false);
  useSlashFocus(searchInputRef);
  useEffect(() => { pageRef.current = page; }, [page]);
  useEffect(() => { searchRef.current = search; }, [search]);

  const fetchStatus = useCallback(async () => {
    try {
      const data = await apiFetch<any>('/howen/status');
      setStatus(data);
    } catch (err) { console.warn('[DashcamPage] fetchStatus failed:', err); }
  }, []);

  const fetchDevices = useCallback(async (p: number, s: string) => {
    try {
      const params = new URLSearchParams({ page: String(p), limit: '50' });
      if (s) params.set('search', s);
      const data = await apiFetch<any>(`/howen/devices?${params}`);
      setDevices(data.devices || []);
      setTotal(data.total || 0);
      setPage(data.page || 1);
    } catch (err: any) {
      setError('Failed to fetch devices');
    }
  }, []);

  const fetchEvents = useCallback(async () => {
    try {
      const data = await apiFetch<any>('/howen/events?limit=20');
      setEvents(data.events || []);
    } catch (err) { console.warn('[DashcamPage] fetchEvents failed:', err); }
  }, []);

  const doRefresh = useCallback(() => {
    fetchStatus();
    fetchDevices(pageRef.current, searchRef.current);
    fetchEvents();
  }, [fetchStatus, fetchDevices, fetchEvents]);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      fetchStatus(),
      fetchDevices(1, ''),
      fetchEvents(),
    ]).finally(() => setLoading(false));

    const iv = setInterval(doRefresh, 15000);
    return () => clearInterval(iv);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Deep-link: ?device_id=<numeric howen_devices.id>
  // Navigating from the fleet page or a notification lands the operator
  // directly on the right device with the detail panel open.
  useEffect(() => {
    const target = searchParams.get('device_id');
    if (!target || loading) return;
    const numeric = parseInt(target, 10);
    if (isNaN(numeric)) return;
    // Try in-page list first; fall back to direct fetch when paged out.
    const hit = devices.find((d) => d.id === numeric);
    if (hit) {
      loadDeviceDetail(numeric);
    } else if (!loading) {
      loadDeviceDetail(numeric).catch(() =>
        addToast(`Device ${target} not found`, 'warning'),
      );
    }
  // Run once after initial load completes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading]);

  // N shortcut — triggers refresh.
  // Esc cascade — closes detail panel first, then deactivate confirm.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && selectedDevice) {
        setSelectedDevice(null);
        setDeviceDetail(null);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [selectedDevice]);

  const loadDeviceDetail = async (id: number) => {
    try {
      const data = await apiFetch<any>(`/howen/devices/${id}`);
      setDeviceDetail(data);
      setSelectedDevice(data);
    } catch (err: any) {
      setError('Failed to load device details');
    }
  };

  const updateDevice = async (id: number, updates: any) => {
    try {
      await apiFetch(`/howen/devices/${id}`, {
        method: 'PUT',
        body: JSON.stringify(updates),
      });
      await fetchDevices(page, search);
      if (selectedDevice?.id === id) {
        await loadDeviceDetail(id);
      }
    } catch (err: any) {
      setError('Failed to update device');
    }
  };

  const confirmDeactivate = async () => {
    if (!deactivateTarget) return;
    await updateDevice(deactivateTarget.id, { is_active: false });
    addToast(`Device ${deactivateTarget.device_id} deactivated`, 'info');
    setDeactivateTarget(null);
    if (selectedDevice?.id === deactivateTarget.id) {
      setSelectedDevice(null);
      setDeviceDetail(null);
    }
  };

  if (loading && !devices.length) {
    return (
      <div className="p-4">
        <PanelTitleBar title="DASHCAM SYSTEM" icon={Camera} />
        <div className="flex items-center justify-center h-64 text-text-muted">
          <div className="text-center space-y-2">
            <Camera className="w-8 h-8 mx-auto opacity-30 animate-pulse" />
            <div className="text-xs">Loading dashcam system…</div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 space-y-4">
      <PanelTitleBar title="HOWEN / VIZTRACK DASHCAM SYSTEM" icon={Camera}>
        <button
          type="button"
          className="toolbar-btn"
          disabled={devices.length === 0}
          onClick={() => downloadTextFile('dashcam-devices.csv', dashcamListToCsv(devices.map((d: { id?: number; model?: string; device_id?: string; last_gps_at?: string }) => ({
            id: d.id ?? 0,
            classification: d.model ?? '',
            source: d.device_id ?? '',
            recorded_at: d.last_gps_at ?? '',
            case_number: '',
          }))))}
        >CSV</button>
      </PanelTitleBar>

      <ConfirmDialog
        isOpen={!!deactivateTarget}
        onClose={() => setDeactivateTarget(null)}
        onConfirm={confirmDeactivate}
        title="Deactivate Device"
        message="Are you sure you want to deactivate this dashcam device?"
        details={deactivateTarget && (
          <>
            <div>Device ID: <span className="text-text-default font-mono">{deactivateTarget.device_id}</span></div>
            {deactivateTarget.label && <div>Label: {deactivateTarget.label}</div>}
          </>
        )}
        confirmLabel="Deactivate"
        confirmVariant="warning"
      />

      {error && (
        <div className="bg-red-900/20 border border-red-800 text-red-400 px-4 py-2 text-sm flex items-center justify-between">
          <span>{error}</span>
          <button type="button" className="toolbar-btn" onClick={() => { setError(''); void fetchDevices(page, search); }}>Retry</button>
        </div>
      )}

      {status && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="bg-surface-raised border border-border-default p-3">
            <div className="text-xs text-text-muted flex items-center gap-1">
              <Radio className="w-3 h-3" /> RECEIVER
            </div>
            {/* The Howen receiver is managed server-side (port 33000 TCP).
                Online count is inferred from last_connection_at — no
                enable/disable API exists, so the toggle was removed. */}
            <div className="text-lg font-semibold mt-1">
              <span className={(status.online_devices ?? status.online ?? 0) > 0 ? 'text-green-400' : 'text-red-400'}>
                {(status.online_devices ?? status.online ?? 0) > 0 ? 'ONLINE' : 'IDLE'}
              </span>
            </div>
            <div className="text-xs text-text-muted mt-1">Port 33000 H-protocol</div>
          </div>
          <div className="bg-surface-raised border border-border-default p-3">
            <div className="text-xs text-text-muted flex items-center gap-1">
              <Monitor className="w-3 h-3" /> DEVICES
            </div>
            <div className="text-lg font-semibold mt-1 text-brand-400">
              {status.total_devices ?? status.total ?? 0}
            </div>
            <div className="text-xs text-text-muted mt-1">
              {status.active_devices ?? devices.filter(d => d.is_active).length} active
            </div>
          </div>
          <div className="bg-surface-raised border border-border-default p-3">
            <div className="text-xs text-text-muted flex items-center gap-1">
              <MapPin className="w-3 h-3" /> ONLINE NOW
            </div>
            <div className="text-sm font-semibold mt-1 text-brand-400">
              {status.online_devices ?? status.online ?? 0}
            </div>
            <div className="text-xs text-text-muted mt-1">last 15 min</div>
          </div>
          <div className="bg-surface-raised border border-border-default p-3">
            <div className="text-xs text-text-muted flex items-center gap-1">
              <Activity className="w-3 h-3" /> PROTOCOL
            </div>
            <div className="text-lg font-semibold mt-1 text-brand-400">
              HERO-ME40
            </div>
            <div className="text-xs text-text-muted mt-1">H-protocol</div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-3 gap-4" style={{ minHeight: '400px' }}>
        <div className="col-span-2 space-y-3">
          <div className="bg-surface-raised border border-border-default">
            <div className="flex items-center justify-between px-3 py-2 border-b border-border-default">
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold tracking-wider text-text-muted">
                  {tab === 'devices' ? 'DEVICES' : 'EVENTS'}
                </span>
                <div className="flex items-center gap-1 ml-2">
                  <button
                    className={`px-2 py-0.5 text-xs ${tab === 'devices' ? 'bg-brand-gold-500 text-black' : 'bg-surface-raised text-text-muted'}`}
                    onClick={() => setTab('devices')}
                  >
                    Devices
                  </button>
                  <button
                    className={`px-2 py-0.5 text-xs ${tab === 'events' ? 'bg-brand-gold-500 text-black' : 'bg-surface-raised text-text-muted'}`}
                    onClick={() => setTab('events')}
                  >
                    Events
                  </button>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {tab === 'devices' && (
                  <div className="flex items-center gap-1 bg-surface-sunken border border-border-default px-2 py-0.5">
                    <Search className="w-3 h-3 text-text-muted" />
                    <input id="ff-dashcampage-0"
                      ref={searchInputRef}
                      className="bg-transparent border-none outline-none text-xs text-text-default w-32"
                      placeholder="Search devices… (/)"
                      aria-label="Search dashcam devices"
                      value={search}
                      onChange={e => { setSearch(e.target.value); fetchDevices(1, e.target.value); }}
                    />
                  </div>
                )}
                <IconButton onClick={doRefresh} aria-label="Refresh">
                  <RefreshCw className="w-3 h-3" />
                </IconButton>
              </div>
            </div>

            {tab === 'devices' && (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-text-muted font-semibold tracking-wider border-b border-border-default">
                      <th className="text-left px-3 py-1.5">Device ID</th>
                      <th className="text-left px-3 py-1.5">Label</th>
                      <th className="text-left px-3 py-1.5">Unit</th>
                      <th className="text-left px-3 py-1.5">Model</th>
                      <th className="text-right px-3 py-1.5">Last GPS</th>
                      <th className="text-center px-3 py-1.5">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {devices.map((d: any) => (
                      <tr
                        key={d.id}
                        className={`border-b border-border-default cursor-pointer hover:bg-surface-raised ${selectedDevice?.id === d.id ? 'bg-surface-raised' : ''}`}
                        onClick={() => loadDeviceDetail(d.id)}
                      >
                        <td className="px-3 py-1.5 font-mono text-brand-400">{d.device_id}</td>
                        <td className="px-3 py-1.5">{d.label || '—'}</td>
                        <td className="px-3 py-1.5">{d.call_sign || d.unit_id || '—'}</td>
                        <td className="px-3 py-1.5 text-text-muted">{d.model || d.fw_version || '—'}</td>
                        <td className="px-3 py-1.5 text-right text-text-muted">
                          {d.last_gps_at ? (
                            <span className="flex items-center gap-1 justify-end">
                              <MapPin className="w-3 h-3" />
                              {d.last_lat?.toFixed(4)}, {d.last_lon?.toFixed(4)}
                            </span>
                          ) : '—'}
                        </td>
                        <td className="px-3 py-1.5 text-center">
                          <span className={`inline-block w-2 h-2 rounded-full ${d.last_connection_at && Date.now() - parseTimestamp(d.last_connection_at).getTime() < 300000 ? 'bg-green-400 shadow-green' : d.is_active ? 'bg-amber-400' : 'bg-red-400'}`} />
                        </td>
                      </tr>
                    ))}
                    {devices.length === 0 && (
                      <tr>
                        <td colSpan={6} className="text-center py-8 text-text-muted">
                          {search.trim()
                            ? <>No devices match &ldquo;{search}&rdquo;</>
                            : 'No Howen devices registered — devices auto-register on first TCP connection'}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
                {total > 50 && (
                  <div className="flex items-center justify-between px-3 py-2 border-t border-border-default text-xs text-text-muted">
                    <span>{total} total devices</span>
                    <div className="flex gap-2">
                      <button disabled={page <= 1} onClick={() => fetchDevices(page - 1, search)} className="disabled:opacity-30">Prev</button>
                      <span>Page {page}</span>
                      <button disabled={page * 50 >= total} onClick={() => fetchDevices(page + 1, search)} className="disabled:opacity-30">Next</button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {tab === 'events' && (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-text-muted font-semibold tracking-wider border-b border-border-default">
                      <th className="text-left px-3 py-1.5">Time</th>
                      <th className="text-left px-3 py-1.5">Device</th>
                      <th className="text-left px-3 py-1.5">Event</th>
                      <th className="text-left px-3 py-1.5">Severity</th>
                      <th className="text-right px-3 py-1.5">Location</th>
                    </tr>
                  </thead>
                  <tbody>
                      {events.map((e: any) => (
                        <tr key={e.id} className="border-b border-border-default">
                          <td className="px-3 py-1.5 font-mono text-text-muted">
                            {parseTimestamp(e.event_at).toLocaleString('en-US', { timeZone: 'America/Denver' })}
                          </td>
                          <td className="px-3 py-1.5">
                            <span className="text-brand-400">{e.device_id}</span>
                            {e.device_label && <span className="text-text-muted ml-1">({e.device_label})</span>}
                          </td>
                          <td className="px-3 py-1.5">
                            {EVENT_ICONS[e.event_type] && <span className="mr-1">{EVENT_ICONS[e.event_type]}</span>}
                            {formatEnumValue(e.event_type)}
                          </td>
                          <td className={`px-3 py-1.5 ${SEVERITY_COLORS[e.severity] || 'text-text-muted'}`}>
                            {formatEnumValue(e.severity)}
                          </td>
                          <td className="px-3 py-1.5 text-right text-text-muted">
                            {e.latitude ? `${e.latitude.toFixed(4)}, ${e.longitude.toFixed(4)}` : '—'}
                          </td>
                        </tr>
                      ))}
                      {events.length === 0 && (
                        <tr>
                          <td colSpan={5} className="text-center py-8 text-text-muted">
                            No events recorded — events appear here when dashcam devices report them
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
              </div>
            )}
          </div>
        </div>

        <div className="space-y-3">
          {selectedDevice && deviceDetail ? (
            <div className="bg-surface-raised border border-border-default">
              <div className="px-3 py-2 border-b border-border-default flex items-center justify-between">
                <span className="text-xs font-semibold tracking-wider text-brand-400">{deviceDetail.device_id}</span>
                <div className="flex items-center gap-1">
                  <IconButton onClick={() => loadDeviceDetail(selectedDevice.id)} aria-label="Refresh detail">
                    <RefreshCw className="w-3 h-3" />
                  </IconButton>
                  <IconButton onClick={() => { setSelectedDevice(null); setDeviceDetail(null); }} aria-label="Close detail">
                    <span>✕</span>
                  </IconButton>
                </div>
              </div>
              <div className="p-3 space-y-2 text-xs">
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <span className="text-text-muted">Label</span>
                    {canEdit ? (
                      <input id="ff-dashcampage-1"
                        className="w-full bg-surface-sunken border border-border-default px-2 py-0.5 text-text-default mt-0.5"
                        value={deviceDetail.label || ''}
                        onChange={e => setDeviceDetail({ ...deviceDetail, label: e.target.value })}
                        onBlur={() => updateDevice(deviceDetail.id, { label: deviceDetail.label })}
                      />
                    ) : (
                      <div className="text-text-default mt-0.5">{deviceDetail.label || '—'}</div>
                    )}
                  </div>
                  <div>
                    <span className="text-text-muted">Assigned Unit</span>
                    {canEdit ? (
                      <div className="mt-0.5">
                        <UnitPicker
                          id="ff-dashcampage-2"
                          value={deviceDetail.unit_id || null}
                          onChange={(id) => {
                            setDeviceDetail({ ...deviceDetail, unit_id: id });
                            // The original input fired on blur; the picker has
                            // no blur (it's a button), so persist immediately on
                            // selection. Setting to null also detaches the unit.
                            updateDevice(deviceDetail.id, { unit_id: id });
                          }}
                          placeholder="Search by call sign, officer, vehicle…"
                        />
                      </div>
                    ) : (
                      <div className="text-text-default mt-0.5">{deviceDetail.call_sign || deviceDetail.unit_id || '—'}</div>
                    )}
                  </div>
                  <div>
                    <span className="text-text-muted">IMEI</span>
                    <div className="text-text-default mt-0.5 font-mono">{deviceDetail.imei || '—'}</div>
                  </div>
                  <div>
                    <span className="text-text-muted">ICCID</span>
                    <div className="text-text-default mt-0.5 font-mono">{deviceDetail.iccid || '—'}</div>
                  </div>
                  <div>
                    <span className="text-text-muted">Firmware</span>
                    <div className="text-text-default mt-0.5">{deviceDetail.fw_version || '—'}</div>
                  </div>
                  <div>
                    <span className="text-text-muted">Model</span>
                    <div className="text-text-default mt-0.5">{deviceDetail.model || '—'}</div>
                  </div>
                </div>

                <div className="border-t border-border-default pt-2">
                  <div className="text-text-muted mb-1">Last Position</div>
                  {deviceDetail.last_lat ? (
                    <div className="text-text-default">
                      {deviceDetail.last_lat.toFixed(6)}, {deviceDetail.last_lon.toFixed(6)}
                      <span className="text-text-muted ml-2">
                        {deviceDetail.last_speed ? `${deviceDetail.last_speed.toFixed(1)} mph` : ''}
                      </span>
                      <div className="text-text-muted text-[10px] mt-0.5">
                        {deviceDetail.last_gps_at
                          ? parseTimestamp(deviceDetail.last_gps_at).toLocaleString('en-US', { timeZone: 'America/Denver' })
                          : '—'}
                      </div>
                    </div>
                  ) : (
                    <div className="text-text-muted">No GPS data yet</div>
                  )}
                </div>

                <div className="border-t border-border-default pt-2">
                  <div className="text-text-muted mb-1">
                    Recent Events ({deviceDetail.recent_events?.length || 0})
                  </div>
                  {(deviceDetail.recent_events || []).slice(0, 5).map((ev: any) => (
                    <div key={ev.id} className="flex items-center gap-2 py-0.5 border-b border-border-subtle last:border-0">
                      <span className={`w-1.5 h-1.5 rounded-full ${ev.severity === 'critical' ? 'bg-red-400' : ev.severity === 'warning' ? 'bg-amber-400' : 'bg-rmpg-400'}`} />
                      <span className="text-text-muted w-16">{formatEnumValue(ev.event_type)}</span>
                      <span className="text-text-muted text-[10px]">
                        {ev.event_at ? parseTimestamp(ev.event_at).toLocaleString() : '—'}
                      </span>
                    </div>
                  ))}
                  {(!deviceDetail.recent_events || deviceDetail.recent_events.length === 0) && (
                    <div className="text-text-muted text-[10px]">No events for this device</div>
                  )}
                </div>

                <div className="border-t border-border-default pt-2">
                  <div className="text-text-muted">
                    GPS points (24h): <span className="text-text-default">{deviceDetail.gps_count_24h || 0}</span>
                  </div>
                  <div className="text-text-muted">
                    Last connection:{' '}
                    <span className="text-text-default">
                      {deviceDetail.last_connection_at
                        ? parseTimestamp(deviceDetail.last_connection_at).toLocaleString('en-US', { timeZone: 'America/Denver' })
                        : '—'}
                    </span>
                  </div>
                </div>

                {canManage && deviceDetail.is_active && (
                  <div className="border-t border-border-default pt-2">
                    <button
                      className="text-xs text-amber-400 hover:text-amber-300 underline"
                      onClick={() => setDeactivateTarget(deviceDetail)}
                    >
                      Deactivate device
                    </button>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="bg-surface-raised border border-border-default p-6 flex flex-col items-center justify-center text-text-muted">
              <Camera className="w-8 h-8 mb-2 opacity-30" />
              <div className="text-xs text-center">
                <p className="font-semibold text-text-default mb-1">Howen / VizTrack Dashcam System</p>
                <p>Select a device to view details</p>
                <p className="mt-3 text-[10px] text-text-muted">
                  HERO-ME40-02 &bull; H-protocol &bull; Port 33000
                </p>
              </div>
            </div>
          )}

          <div className="bg-surface-raised border border-border-default p-3">
            <div className="text-xs font-semibold tracking-wider text-text-muted mb-2">QUICK TIPS</div>
            <ul className="text-[10px] text-text-muted space-y-1">
              <li>• Devices auto-register on first TCP connection</li>
              <li>• Configure server IP via Howen iTool app → Network → Center</li>
              <li>• Use H-protocol on port 33000 (default) or 22129/47670</li>
              <li>• Set device ID (Dev ID) for unit-to-dashcam mapping</li>
              <li>• Events poll every 15s — enable receiver for live data</li>
              <li>• Press <kbd className="px-1 bg-surface-sunken border border-border-default">N</kbd> to refresh</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
