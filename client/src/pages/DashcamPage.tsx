import { useState, useEffect, useCallback } from 'react';
import { apiFetch } from '../hooks/useApi';
import PanelTitleBar from '../components/PanelTitleBar';
import { Camera, MapPin, AlertTriangle, Radio, RefreshCw, Activity, Power, PowerOff, Search, Monitor, Smartphone } from 'lucide-react';
import IconButton from '../components/IconButton';
import { parseTimestamp } from '../utils/dateUtils';

const SEVERITY_COLORS: Record<string, string> = {
  critical: 'text-red-400',
  warning: 'text-amber-400',
  info: 'text-blue-400',
};

const EVENT_ICONS: Record<string, string> = {
  sos: '🚨', panic: '🚨', impact: '💥', accident: '💥',
  hard_brake: '⚠️', speeding: '⚠️', tamper: '🔧',
  low_battery: '🔋', geofence: '📍', ignition: '🔑',
};

export default function DashcamPage() {
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

  const fetchStatus = useCallback(async () => {
    try {
      const data = await apiFetch<any>('/howen/status');
      setStatus(data);
    } catch { }
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
    } catch { }
  }, []);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      fetchStatus(),
      fetchDevices(1, ''),
      fetchEvents(),
    ]).finally(() => setLoading(false));

    const iv = setInterval(() => {
      fetchStatus();
      fetchDevices(page, search);
      fetchEvents();
    }, 15000);
    return () => clearInterval(iv);
  }, []);

  const loadDeviceDetail = async (id: number) => {
    try {
      const data = await apiFetch<any>(`/howen/devices/${id}`);
      setDeviceDetail(data);
      setSelectedDevice(data);
    } catch (err: any) {
      setError('Failed to load device details');
    }
  };

  const toggleReceiver = async () => {
    try {
      await apiFetch('/howen/enable', {
        method: 'POST',
        body: JSON.stringify({ enabled: !status?.enabled }),
      });
      await fetchStatus();
    } catch (err: any) {
      setError('Failed to toggle receiver');
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

  if (loading && !devices.length) {
    return (
      <div className="p-4">
        <PanelTitleBar title="DASHCAM SYSTEM" icon={Camera} />
        <div className="flex items-center justify-center h-64 text-text-muted">Loading...</div>
      </div>
    );
  }

  return (
    <div className="p-4 space-y-4">
      <PanelTitleBar title="HOWEN / VIZTRACK DASHCAM SYSTEM" icon={Camera} />

      {error && (
        <div className="bg-red-900/20 border border-red-800 text-red-400 px-4 py-2 text-sm">
          {error}
          <button className="float-right" onClick={() => setError('')}>✕</button>
        </div>
      )}

      {status && (
        <div className="grid grid-cols-4 gap-3">
          <div className="bg-surface-raised border border-[#222] p-3">
            <div className="text-xs text-text-muted flex items-center gap-1">
              <Radio className="w-3 h-3" /> RECEIVER
            </div>
            <div className="text-lg font-semibold mt-1 flex items-center gap-2">
              <span className={status.enabled ? 'text-green-400' : 'text-red-400'}>
                {status.enabled ? 'LISTENING' : 'STOPPED'}
              </span>
              <IconButton onClick={toggleReceiver} aria-label={status.enabled ? 'Stop receiver' : 'Start receiver'}>
                {status.enabled ? <PowerOff className="w-3 h-3" /> : <Power className="w-3 h-3" />}
              </IconButton>
            </div>
            <div className="text-xs text-text-muted mt-1">Port {status.port}</div>
          </div>
          <div className="bg-surface-raised border border-[#222] p-3">
            <div className="text-xs text-text-muted flex items-center gap-1">
              <Monitor className="w-3 h-3" /> DEVICES
            </div>
            <div className="text-lg font-semibold mt-1 text-[#d4a017]">{status.deviceCount}</div>
            <div className="text-xs text-text-muted mt-1">{devices.filter(d => d.is_active).length} active</div>
          </div>
          <div className="bg-surface-raised border border-[#222] p-3">
            <div className="text-xs text-text-muted flex items-center gap-1">
              <MapPin className="w-3 h-3" /> PROTOCOL
            </div>
            <div className="text-sm font-semibold mt-1 text-[#d4a017]">H-protocol</div>
            <div className="text-xs text-text-muted mt-1">{status.models?.join(', ')}</div>
          </div>
          <div className="bg-surface-raised border border-[#222] p-3">
            <div className="text-xs text-text-muted flex items-center gap-1">
              <Activity className="w-3 h-3" /> UPTIME
            </div>
            <div className="text-lg font-semibold mt-1 text-[#d4a017]">
              {status.uptime > 0 ? `${Math.floor(status.uptime / 60)}m` : '—'}
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-3 gap-4" style={{ minHeight: '400px' }}>
        <div className="col-span-2 space-y-3">
          <div className="bg-surface-raised border border-[#222]">
            <div className="flex items-center justify-between px-3 py-2 border-b border-[#222]">
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold tracking-wider text-text-muted">
                  {tab === 'devices' ? 'DEVICES' : 'EVENTS'}
                </span>
                <div className="flex items-center gap-1 ml-2">
                  <button
                    className={`px-2 py-0.5 text-xs ${tab === 'devices' ? 'bg-[#d4a017] text-black' : 'bg-[#1a1a1a] text-text-muted'}`}
                    onClick={() => setTab('devices')}
                  >
                    Devices
                  </button>
                  <button
                    className={`px-2 py-0.5 text-xs ${tab === 'events' ? 'bg-[#d4a017] text-black' : 'bg-[#1a1a1a] text-text-muted'}`}
                    onClick={() => setTab('events')}
                  >
                    Events
                  </button>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {tab === 'devices' && (
                  <div className="flex items-center gap-1 bg-[#0a0a0a] border border-[#222] px-2 py-0.5">
                    <Search className="w-3 h-3 text-text-muted" />
                    <input
                      className="bg-transparent border-none outline-none text-xs text-text-default w-32"
                      placeholder="Search devices..."
                      value={search}
                      onChange={e => { setSearch(e.target.value); fetchDevices(1, e.target.value); }}
                    />
                  </div>
                )}
                <IconButton onClick={() => { fetchDevices(page, search); fetchEvents(); }} aria-label="Refresh">
                  <RefreshCw className="w-3 h-3" />
                </IconButton>
              </div>
            </div>

            {tab === 'devices' && (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-text-muted font-semibold tracking-wider border-b border-[#222]">
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
                        className={`border-b border-[#1a1a1a] cursor-pointer hover:bg-[#1a1a1a] ${selectedDevice?.id === d.id ? 'bg-[#1a1a1a]' : ''}`}
                        onClick={() => loadDeviceDetail(d.id)}
                      >
                        <td className="px-3 py-1.5 font-mono text-[#d4a017]">{d.device_id}</td>
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
                      <tr><td colSpan={6} className="text-center py-8 text-text-muted">No devices registered</td></tr>
                    )}
                  </tbody>
                </table>
                {total > 50 && (
                  <div className="flex items-center justify-between px-3 py-2 border-t border-[#222] text-xs text-text-muted">
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
                    <tr className="text-text-muted font-semibold tracking-wider border-b border-[#222]">
                      <th className="text-left px-3 py-1.5">Time</th>
                      <th className="text-left px-3 py-1.5">Device</th>
                      <th className="text-left px-3 py-1.5">Event</th>
                      <th className="text-left px-3 py-1.5">Severity</th>
                      <th className="text-right px-3 py-1.5">Location</th>
                    </tr>
                  </thead>
                  <tbody>
                    {events.map((e: any) => (
                      <tr key={e.id} className="border-b border-[#1a1a1a]">
                        <td className="px-3 py-1.5 font-mono text-text-muted">{e.event_at}</td>
                        <td className="px-3 py-1.5">
                          <span className="text-[#d4a017]">{e.device_id}</span>
                          {e.device_label && <span className="text-text-muted ml-1">({e.device_label})</span>}
                        </td>
                        <td className="px-3 py-1.5">
                          {EVENT_ICONS[e.event_type] && <span className="mr-1">{EVENT_ICONS[e.event_type]}</span>}
                          {e.event_type}
                        </td>
                        <td className={`px-3 py-1.5 ${SEVERITY_COLORS[e.severity] || 'text-text-muted'}`}>
                          {e.severity}
                        </td>
                        <td className="px-3 py-1.5 text-right text-text-muted">
                          {e.latitude ? `${e.latitude.toFixed(4)}, ${e.longitude.toFixed(4)}` : '—'}
                        </td>
                      </tr>
                    ))}
                    {events.length === 0 && (
                      <tr><td colSpan={5} className="text-center py-8 text-text-muted">No events recorded</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        <div className="space-y-3">
          {selectedDevice && deviceDetail ? (
            <div className="bg-surface-raised border border-[#222]">
              <div className="px-3 py-2 border-b border-[#222] flex items-center justify-between">
                <span className="text-xs font-semibold tracking-wider text-[#d4a017]">{deviceDetail.device_id}</span>
                <div className="flex items-center gap-1">
                  <IconButton onClick={() => loadDeviceDetail(selectedDevice.id)} aria-label="Refresh detail">
                    <RefreshCw className="w-3 h-3" />
                  </IconButton>
                  <IconButton onClick={() => setSelectedDevice(null)} aria-label="Close detail">
                    <span>✕</span>
                  </IconButton>
                </div>
              </div>
              <div className="p-3 space-y-2 text-xs">
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <span className="text-text-muted">Label</span>
                    <input
                      className="w-full bg-[#0a0a0a] border border-[#222] px-2 py-0.5 text-text-default mt-0.5"
                      value={deviceDetail.label || ''}
                      onChange={e => setDeviceDetail({ ...deviceDetail, label: e.target.value })}
                      onBlur={() => updateDevice(deviceDetail.id, { label: deviceDetail.label })}
                    />
                  </div>
                  <div>
                    <span className="text-text-muted">Unit ID</span>
                    <input
                      className="w-full bg-[#0a0a0a] border border-[#222] px-2 py-0.5 text-text-default mt-0.5"
                      type="number"
                      value={deviceDetail.unit_id || ''}
                      onChange={e => setDeviceDetail({ ...deviceDetail, unit_id: parseInt(e.target.value) || null })}
                      onBlur={() => updateDevice(deviceDetail.id, { unit_id: deviceDetail.unit_id })}
                    />
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

                <div className="border-t border-[#222] pt-2">
                  <div className="text-text-muted mb-1">Last Position</div>
                  {deviceDetail.last_lat ? (
                    <div className="text-text-default">
                      {deviceDetail.last_lat.toFixed(6)}, {deviceDetail.last_lon.toFixed(6)}
                      <span className="text-text-muted ml-2">
                        {deviceDetail.last_speed ? `${deviceDetail.last_speed.toFixed(1)} mph` : ''}
                      </span>
                      <div className="text-text-muted text-[10px] mt-0.5">{deviceDetail.last_gps_at}</div>
                    </div>
                  ) : (
                    <div className="text-text-muted">No GPS data yet</div>
                  )}
                </div>

                <div className="border-t border-[#222] pt-2">
                  <div className="text-text-muted mb-1">
                    Recent Events ({deviceDetail.recent_events?.length || 0})
                  </div>
                  {(deviceDetail.recent_events || []).slice(0, 5).map((ev: any) => (
                    <div key={ev.id} className="flex items-center gap-2 py-0.5 border-b border-[#111] last:border-0">
                      <span className={`w-1.5 h-1.5 rounded-full ${ev.severity === 'critical' ? 'bg-red-400' : ev.severity === 'warning' ? 'bg-amber-400' : 'bg-blue-400'}`} />
                      <span className="text-text-muted w-16">{ev.event_type}</span>
                      <span className="text-text-muted text-[10px]">{ev.event_at}</span>
                    </div>
                  ))}
                  {(!deviceDetail.recent_events || deviceDetail.recent_events.length === 0) && (
                    <div className="text-text-muted text-[10px]">No events</div>
                  )}
                </div>

                <div className="border-t border-[#222] pt-2">
                  <div className="text-text-muted">
                    GPS points (24h): <span className="text-text-default">{deviceDetail.gps_count_24h || 0}</span>
                  </div>
                  <div className="text-text-muted">
                    Last connection: <span className="text-text-default">{deviceDetail.last_connection_at || '—'}</span>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="bg-surface-raised border border-[#222] p-6 flex flex-col items-center justify-center text-text-muted">
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

          <div className="bg-surface-raised border border-[#222] p-3">
            <div className="text-xs font-semibold tracking-wider text-text-muted mb-2">QUICK TIPS</div>
            <ul className="text-[10px] text-text-muted space-y-1">
              <li>• Devices auto-register on first TCP connection</li>
              <li>• Configure server IP via Howen iTool app → Network → Center</li>
              <li>• Use H-protocol on port 33000 (default) or 22129/47670</li>
              <li>• Set device ID (Dev ID) for unit-to-dashcam mapping</li>
              <li>• Events poll every 15s — enable receiver for live data</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
