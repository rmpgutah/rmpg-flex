import { useEffect, useState } from 'react';
import { History, Database, Play, X, Loader2, CheckCircle2, XCircle, AlertTriangle, RefreshCw, Calendar } from 'lucide-react';
import { apiFetch } from '../../hooks/useApi';

// Historical Bulk Import — drives /api/traccar/historical/* endpoints.
// Pulls every Traccar artifact (devices, positions, events, trips, stops,
// geofences) for a chosen date range into traccar_* tables, preserving
// every original column via the `raw_json` field.

interface Stats {
  devices: number;
  positions: number;
  events: number;
  trips: number;
  stops: number;
  geofences: number;
  earliest: string | null;
  latest: string | null;
}

interface SyncJob {
  id: number;
  kind: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  date_from: string | null;
  date_to: string | null;
  device_filter: string | null;
  devices_synced: number;
  positions_synced: number;
  events_synced: number;
  trips_synced: number;
  stops_synced: number;
  geofences_synced: number;
  error_message: string | null;
  progress_percent: number;
  started_at: string;
  completed_at: string | null;
}

interface SyncedDevice {
  id: number;
  traccar_id: number;
  name: string | null;
  unique_id: string | null;
  vehicle_id: number | null;
  fleet_unit_number: string | null;
  fleet_plate: string | null;
  status: string | null;
  last_update: string | null;
}

const STAT_LABEL: Record<keyof Omit<Stats, 'earliest' | 'latest'>, string> = {
  devices: 'Devices',
  positions: 'Positions',
  events: 'Events',
  trips: 'Trips',
  stops: 'Stops',
  geofences: 'Geofences',
};

function fmtNumber(n: number): string {
  return new Intl.NumberFormat().format(n);
}

function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  try { return new Date(iso).toLocaleString(); } catch { return iso; }
}

export default function AdminTraccarHistoricalSection() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [jobs, setJobs] = useState<SyncJob[]>([]);
  const [syncedDevices, setSyncedDevices] = useState<SyncedDevice[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Date range — defaults to "last 30 days".
  const [from, setFrom] = useState(() => {
    const d = new Date(); d.setDate(d.getDate() - 30); d.setHours(0, 0, 0, 0); return d.toISOString().slice(0, 16);
  });
  const [to, setTo] = useState(() => new Date().toISOString().slice(0, 16));
  const [includePositions, setIncludePositions] = useState(true);
  const [includeEvents, setIncludeEvents] = useState(true);
  const [includeTrips, setIncludeTrips] = useState(true);
  const [includeStops, setIncludeStops] = useState(true);
  const [includeGeofences, setIncludeGeofences] = useState(true);
  const [selectedDeviceIds, setSelectedDeviceIds] = useState<number[]>([]);

  const refresh = async () => {
    try {
      const [s, j, d] = await Promise.all([
        apiFetch<Stats>('/api/traccar/historical/stats').catch(() => null),
        apiFetch<SyncJob[]>('/api/traccar/historical/jobs').catch(() => []),
        apiFetch<SyncedDevice[]>('/api/traccar/historical/devices').catch(() => []),
      ]);
      setStats(s); setJobs(j ?? []); setSyncedDevices(d ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Refresh failed');
    }
  };

  useEffect(() => { refresh(); }, []);

  // Auto-refresh every 4s while a job is running.
  useEffect(() => {
    const hasRunning = jobs.some(j => j.status === 'running' || j.status === 'pending');
    if (!hasRunning) return;
    const t = setInterval(refresh, 4000);
    return () => clearInterval(t);
  }, [jobs]);

  const startSync = async () => {
    setError(null);
    setLoading(true);
    try {
      await apiFetch('/api/traccar/historical/sync', {
        method: 'POST',
        body: JSON.stringify({
          from: new Date(from).toISOString(),
          to: new Date(to).toISOString(),
          deviceIds: selectedDeviceIds.length > 0 ? selectedDeviceIds : undefined,
          include: {
            devices: true,
            positions: includePositions,
            events: includeEvents,
            trips: includeTrips,
            stops: includeStops,
            geofences: includeGeofences,
          },
        }),
      });
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start sync');
    } finally {
      setLoading(false);
    }
  };

  const cancelJob = async (id: number) => {
    try { await apiFetch(`/api/traccar/historical/jobs/${id}/cancel`, { method: 'POST' }); refresh(); }
    catch (err) { setError(err instanceof Error ? err.message : 'Cancel failed'); }
  };

  const toggleDevice = (id: number) => {
    setSelectedDeviceIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  };

  return (
    <div className="space-y-4 mt-6">
      <div className="flex items-center gap-2">
        <History className="w-4 h-4 text-[#d4a017]" />
        <h3 className="text-sm font-semibold text-white uppercase tracking-wider">Historical Bulk Import</h3>
        <button type="button" onClick={refresh} className="ml-auto p-1 text-rmpg-400 hover:text-white" title="Refresh"><RefreshCw className="w-3.5 h-3.5" /></button>
      </div>

      <p className="text-[10px] text-rmpg-500 max-w-3xl">
        Pulls every Traccar artifact (devices, positions, events, trips, stops, geofences) into dedicated <code className="text-[#d4a017]">traccar_*</code> tables for the chosen date range and device filter. Every original column is preserved in <code className="text-[#d4a017]">raw_json</code>. Existing rows are not duplicated — re-running for an overlapping window is safe (idempotent).
      </p>

      {error && (
        <div className="bg-red-900/20 border border-red-700/40 text-red-200 text-[11px] px-3 py-1.5 rounded-sm flex items-start gap-2">
          <AlertTriangle className="w-3.5 h-3.5 mt-0.5" /> <div>{error}</div>
          <button type="button" onClick={() => setError(null)} className="ml-auto text-red-300 hover:text-white">×</button>
        </div>
      )}

      {/* Stats */}
      {stats && (
        <div className="grid grid-cols-3 md:grid-cols-6 gap-2">
          {(Object.keys(STAT_LABEL) as Array<keyof typeof STAT_LABEL>).map(k => (
            <div key={k} className="bg-[#0d0d0d] border border-[#222] rounded-sm p-2">
              <div className="text-[8px] uppercase tracking-wider text-rmpg-500">{STAT_LABEL[k]}</div>
              <div className="text-base text-white font-mono">{fmtNumber(stats[k])}</div>
            </div>
          ))}
        </div>
      )}
      {stats && (
        <div className="text-[10px] text-rmpg-500">
          Earliest position: <span className="text-rmpg-300">{fmtDate(stats.earliest)}</span>
          {' · '}
          Latest position: <span className="text-rmpg-300">{fmtDate(stats.latest)}</span>
        </div>
      )}

      {/* Sync trigger form */}
      <div className="bg-[#0d0d0d] border border-[#222] rounded-sm p-3 space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label className="text-[9px] uppercase tracking-wider text-rmpg-500 block mb-1"><Calendar className="w-3 h-3 inline mr-1" />From</label>
            <input type="datetime-local" value={from} onChange={e => setFrom(e.target.value)} className="w-full bg-[#0a0a0a] border border-[#222] text-xs text-white px-2 py-1.5 rounded-sm focus:outline-none focus:border-[#d4a017]" />
          </div>
          <div>
            <label className="text-[9px] uppercase tracking-wider text-rmpg-500 block mb-1"><Calendar className="w-3 h-3 inline mr-1" />To</label>
            <input type="datetime-local" value={to} onChange={e => setTo(e.target.value)} className="w-full bg-[#0a0a0a] border border-[#222] text-xs text-white px-2 py-1.5 rounded-sm focus:outline-none focus:border-[#d4a017]" />
          </div>
        </div>

        <div>
          <div className="text-[9px] uppercase tracking-wider text-rmpg-500 mb-1">Include</div>
          <div className="flex flex-wrap gap-3 text-[10px] text-rmpg-300">
            {[
              { k: 'positions', label: 'Positions', val: includePositions, set: setIncludePositions },
              { k: 'events', label: 'Events', val: includeEvents, set: setIncludeEvents },
              { k: 'trips', label: 'Trips', val: includeTrips, set: setIncludeTrips },
              { k: 'stops', label: 'Stops', val: includeStops, set: setIncludeStops },
              { k: 'geofences', label: 'Geofences', val: includeGeofences, set: setIncludeGeofences },
            ].map(o => (
              <label key={o.k} className="inline-flex items-center gap-1 cursor-pointer">
                <input type="checkbox" checked={o.val} onChange={e => o.set(e.target.checked)} />{o.label}
              </label>
            ))}
          </div>
        </div>

        {syncedDevices.length > 0 && (
          <div>
            <div className="text-[9px] uppercase tracking-wider text-rmpg-500 mb-1">
              Limit to devices ({selectedDeviceIds.length === 0 ? 'all' : `${selectedDeviceIds.length} selected`})
            </div>
            <div className="flex flex-wrap gap-1 max-h-[120px] overflow-y-auto">
              {syncedDevices.map(d => (
                <button key={d.id} type="button" onClick={() => toggleDevice(d.traccar_id)}
                  className={`px-2 py-0.5 text-[10px] rounded-sm border ${selectedDeviceIds.includes(d.traccar_id) ? 'bg-[#d4a017]/20 border-[#d4a017] text-[#d4a017]' : 'border-[#222] text-rmpg-400 hover:text-white'}`}>
                  {d.name || d.unique_id} {d.fleet_unit_number ? <span className="text-[#d4a017] ml-1">→ {d.fleet_unit_number}</span> : null}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="flex items-center justify-end">
          <button type="button" onClick={startSync} disabled={loading}
            className="btn-primary inline-flex items-center gap-1 disabled:opacity-50">
            {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
            Start historical sync
          </button>
        </div>
      </div>

      {/* Jobs list */}
      <div>
        <div className="flex items-center gap-2 mb-2">
          <Database className="w-3.5 h-3.5 text-rmpg-400" />
          <span className="text-[9px] uppercase tracking-wider text-rmpg-500">Recent jobs</span>
        </div>
        {jobs.length === 0 ? (
          <div className="text-[10px] text-rmpg-500 italic">No historical sync jobs yet.</div>
        ) : (
          <div className="border border-[#222] rounded-sm overflow-hidden">
            <table className="w-full text-[11px]">
              <thead className="bg-[#0d0d0d]">
                <tr className="text-rmpg-500 text-left">
                  <th className="px-2 py-1.5 font-semibold">#</th>
                  <th className="px-2 py-1.5 font-semibold">Status</th>
                  <th className="px-2 py-1.5 font-semibold">Range</th>
                  <th className="px-2 py-1.5 font-semibold">Progress</th>
                  <th className="px-2 py-1.5 font-semibold text-right">Devices</th>
                  <th className="px-2 py-1.5 font-semibold text-right">Positions</th>
                  <th className="px-2 py-1.5 font-semibold text-right">Events</th>
                  <th className="px-2 py-1.5 font-semibold text-right">Trips</th>
                  <th className="px-2 py-1.5 font-semibold text-right">Stops</th>
                  <th className="px-2 py-1.5 font-semibold">Started</th>
                  <th className="px-2 py-1.5"></th>
                </tr>
              </thead>
              <tbody>
                {jobs.map(j => (
                  <tr key={j.id} className="border-t border-[#1a1a1a] hover:bg-[#101010]">
                    <td className="px-2 py-1 font-mono text-rmpg-400">{j.id}</td>
                    <td className="px-2 py-1">
                      {j.status === 'running' && <span className="inline-flex items-center gap-1 text-[#d4a017]"><Loader2 className="w-3 h-3 animate-spin" />running</span>}
                      {j.status === 'completed' && <span className="inline-flex items-center gap-1 text-green-400"><CheckCircle2 className="w-3 h-3" />done</span>}
                      {j.status === 'failed' && <span className="inline-flex items-center gap-1 text-red-400"><XCircle className="w-3 h-3" />failed</span>}
                      {j.status === 'cancelled' && <span className="text-rmpg-500">cancelled</span>}
                      {j.status === 'pending' && <span className="text-rmpg-400">pending</span>}
                    </td>
                    <td className="px-2 py-1 text-rmpg-300">{fmtDate(j.date_from)} → {fmtDate(j.date_to)}</td>
                    <td className="px-2 py-1 text-rmpg-300 font-mono">{j.progress_percent.toFixed(1)}%</td>
                    <td className="px-2 py-1 font-mono text-right text-rmpg-300">{fmtNumber(j.devices_synced)}</td>
                    <td className="px-2 py-1 font-mono text-right text-rmpg-300">{fmtNumber(j.positions_synced)}</td>
                    <td className="px-2 py-1 font-mono text-right text-rmpg-300">{fmtNumber(j.events_synced)}</td>
                    <td className="px-2 py-1 font-mono text-right text-rmpg-300">{fmtNumber(j.trips_synced)}</td>
                    <td className="px-2 py-1 font-mono text-right text-rmpg-300">{fmtNumber(j.stops_synced)}</td>
                    <td className="px-2 py-1 text-rmpg-400">{fmtDate(j.started_at)}</td>
                    <td className="px-2 py-1">
                      {j.status === 'running' && (
                        <button type="button" onClick={() => cancelJob(j.id)} className="text-red-300 hover:text-red-200" title="Cancel"><X className="w-3.5 h-3.5" /></button>
                      )}
                      {j.error_message && <span title={j.error_message} className="text-red-400 text-[9px] truncate inline-block max-w-[120px]">err</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
