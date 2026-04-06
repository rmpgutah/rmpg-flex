// ============================================================
// RMPG Flex — Admin: ClearPathGPS Integration Tab
// Configure ClearPathGPS fleet tracking credentials, test
// connection, trigger sync/scrape, and link vehicles.
// ============================================================

import React, { useState, useEffect } from 'react';
import {
  MapPin, RefreshCw, Loader2, CheckCircle, XCircle,
  Download, Car, Link2, Unlink, AlertTriangle,
} from 'lucide-react';
import { apiFetch } from '../../hooks/useApi';
import { useToast } from '../../components/ToastProvider';

interface Props {
  LoadingSpinner: React.FC;
  error: string | null;
  setError: (e: string | null) => void;
}

interface SyncStatus {
  configured: boolean;
  lastSync: any;
  counts: { vehicles: number; trips: number; locations: number; alerts: number };
}

interface CpgpsVehicle {
  id: number;
  cpgps_id: string;
  vehicle_id: number | null;
  name: string;
  vin: string;
  make: string;
  model: string;
  year: number;
  last_lat: number | null;
  last_lon: number | null;
  last_reported_at: string;
  fleet_vehicle_number?: string;
}

interface FleetVehicle {
  id: number;
  vehicle_number: string;
  make: string;
  model: string;
  year: number;
}

export default function AdminClearPathGpsTab({ LoadingSpinner, error, setError }: Props) {
  const { addToast } = useToast();

  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<SyncStatus | null>(null);
  const [account, setAccount] = useState('');
  const [user, setUser] = useState('');
  const [password, setPassword] = useState('');
  const [baseUrl, setBaseUrl] = useState('https://api.clearpathgps.com:8443');
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [scraping, setScraping] = useState(false);
  const [scrapeProgress, setScrapeProgress] = useState<any>(null);

  // Vehicle linking
  const [cpgpsVehicles, setCpgpsVehicles] = useState<CpgpsVehicle[]>([]);
  const [fleetVehicles, setFleetVehicles] = useState<FleetVehicle[]>([]);
  const [linkingId, setLinkingId] = useState<number | null>(null);

  const fetchStatus = async () => {
    try {
      const s = await apiFetch<SyncStatus>('/clearpathgps/status');
      setStatus(s);
    } catch (err: any) {
      setError(err?.message || 'Failed to load status');
    } finally {
      setLoading(false);
    }
  };

  const fetchVehicles = async () => {
    try {
      const [cpgps, fleet] = await Promise.all([
        apiFetch<CpgpsVehicle[]>('/clearpathgps/vehicles'),
        apiFetch<any>('/fleet'),
      ]);
      setCpgpsVehicles(Array.isArray(cpgps) ? cpgps : []);
      const fv = Array.isArray(fleet) ? fleet : (fleet?.vehicles || []);
      setFleetVehicles(fv);
    } catch { /* empty if not configured */ }
  };

  useEffect(() => {
    fetchStatus();
    fetchVehicles();
  }, []);

  const handleSave = async () => {
    setSaving(true);
    try {
      await apiFetch('/clearpathgps/configure', {
        method: 'POST',
        body: JSON.stringify({ account, user, password, base_url: baseUrl }),
      });
      addToast('ClearPathGPS credentials saved', 'success');
      setAccount(''); setUser(''); setPassword('');
      await fetchStatus();
    } catch (err: any) {
      addToast(err?.message || 'Failed to save', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const body = account && user && password
        ? { account, user, password, base_url: baseUrl }
        : {};
      const r = await apiFetch<{ success: boolean; message: string }>('/clearpathgps/test', {
        method: 'POST', body: JSON.stringify(body),
      });
      setTestResult(r);
    } catch (err: any) {
      setTestResult({ success: false, message: err?.message || 'Connection failed' });
    } finally {
      setTesting(false);
    }
  };

  const handleSync = async () => {
    setSyncing(true);
    try {
      await apiFetch('/clearpathgps/sync', { method: 'POST' });
      addToast('Sync completed', 'success');
      await fetchStatus();
      await fetchVehicles();
    } catch (err: any) {
      addToast(err?.message || 'Sync failed', 'error');
    } finally {
      setSyncing(false);
    }
  };

  const handleScrape = async () => {
    setScraping(true);
    try {
      await apiFetch('/clearpathgps/scrape', { method: 'POST' });
      addToast('Historical scrape started in background', 'info');
      // Poll progress
      const interval = setInterval(async () => {
        try {
          const ps = await apiFetch<any>('/clearpathgps/sync/status');
          setScrapeProgress(ps);
          if (!ps.running) {
            clearInterval(interval);
            setScraping(false);
            setScrapeProgress(null);
            await fetchStatus();
            await fetchVehicles();
            addToast('Historical scrape completed', 'success');
          }
        } catch {
          clearInterval(interval);
          setScraping(false);
        }
      }, 3000);
    } catch (err: any) {
      addToast(err?.message || 'Scrape failed', 'error');
      setScraping(false);
    }
  };

  const handleRemove = async () => {
    if (!confirm('Remove ClearPathGPS credentials?')) return;
    try {
      await apiFetch('/clearpathgps/configure', { method: 'DELETE' });
      addToast('Credentials removed', 'success');
      await fetchStatus();
    } catch (err: any) {
      addToast(err?.message || 'Failed to remove', 'error');
    }
  };

  const handleLink = async (cpgpsId: number, fleetVehicleId: number | null) => {
    setLinkingId(cpgpsId);
    try {
      await apiFetch('/clearpathgps/link-vehicle', {
        method: 'POST',
        body: JSON.stringify({ cpgps_vehicle_id: cpgpsId, fleet_vehicle_id: fleetVehicleId }),
      });
      addToast(fleetVehicleId ? 'Vehicle linked' : 'Vehicle unlinked', 'success');
      await fetchVehicles();
    } catch (err: any) {
      addToast(err?.message || 'Link failed', 'error');
    } finally {
      setLinkingId(null);
    }
  };

  if (loading) return <LoadingSpinner />;

  return (
    <div className="space-y-4 p-4 max-w-3xl">
      {/* Header */}
      <div className="flex items-center gap-2">
        <MapPin className="w-5 h-5 text-brand-400" />
        <h2 className="text-sm font-bold text-rmpg-200 uppercase tracking-wider">ClearPathGPS Integration</h2>
      </div>
      <p className="text-xs text-rmpg-500">
        Connect to ClearPathGPS fleet tracking to sync vehicle locations, trips, and alerts.
      </p>

      {/* Status */}
      {status && (
        <div className="panel-beveled p-3 space-y-2">
          <div className="flex items-center gap-2">
            <div className={`w-2 h-2 rounded-full ${status.configured ? 'bg-green-400' : 'bg-rmpg-600'}`} />
            <span className="text-xs text-rmpg-300 font-semibold">
              {status.configured ? 'Configured' : 'Not Configured'}
            </span>
          </div>
          {status.configured && (
            <div className="grid grid-cols-4 gap-3 mt-2">
              <div className="text-center">
                <div className="text-sm font-bold font-mono text-brand-400">{status.counts.vehicles}</div>
                <div className="text-[8px] text-rmpg-500 uppercase">Vehicles</div>
              </div>
              <div className="text-center">
                <div className="text-sm font-bold font-mono text-blue-400">{status.counts.trips}</div>
                <div className="text-[8px] text-rmpg-500 uppercase">Trips</div>
              </div>
              <div className="text-center">
                <div className="text-sm font-bold font-mono text-green-400">{status.counts.locations}</div>
                <div className="text-[8px] text-rmpg-500 uppercase">Locations</div>
              </div>
              <div className="text-center">
                <div className="text-sm font-bold font-mono text-amber-400">{status.counts.alerts}</div>
                <div className="text-[8px] text-rmpg-500 uppercase">Alerts</div>
              </div>
            </div>
          )}
          {status.lastSync && (
            <div className="text-[10px] text-rmpg-500 mt-1">
              Last sync: {new Date(status.lastSync.started_at).toLocaleString()} — {status.lastSync.status}
              {status.lastSync.records_stored > 0 && ` (${status.lastSync.records_stored} records)`}
            </div>
          )}
        </div>
      )}

      {/* Credentials Form */}
      <div className="panel-beveled p-3 space-y-3">
        <div className="flex items-center gap-2 mb-2">
          <span className="field-label text-brand-400">Credentials</span>
          <div className="flex-1 h-px bg-rmpg-700" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="field-label">Account</label>
            <input type="text" value={account} onChange={e => setAccount(e.target.value)} placeholder="ClearPathGPS account" className="input-dark" />
          </div>
          <div>
            <label className="field-label">User</label>
            <input type="text" value={user} onChange={e => setUser(e.target.value)} placeholder="API user" className="input-dark" />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="field-label">Password</label>
            <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="API password" className="input-dark" />
          </div>
          <div>
            <label className="field-label">Base URL</label>
            <input type="text" value={baseUrl} onChange={e => setBaseUrl(e.target.value)} className="input-dark" />
          </div>
        </div>
        <div className="flex items-center gap-2 pt-1">
          <button onClick={handleSave} disabled={saving || !account || !user || !password}
            className="toolbar-btn-primary text-[10px] px-3 py-1.5 flex items-center gap-1.5">
            {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : null}
            Save Credentials
          </button>
          <button onClick={handleTest} disabled={testing}
            className="toolbar-btn text-[10px] px-3 py-1.5 flex items-center gap-1.5">
            {testing ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
            Test Connection
          </button>
          {status?.configured && (
            <button onClick={handleRemove} className="toolbar-btn text-[10px] px-3 py-1.5 text-red-400 hover:text-red-300">
              Remove
            </button>
          )}
        </div>
        {testResult && (
          <div className={`flex items-center gap-2 p-2 rounded text-xs ${testResult.success ? 'bg-green-900/30 text-green-400' : 'bg-red-900/30 text-red-400'}`}>
            {testResult.success ? <CheckCircle className="w-3.5 h-3.5" /> : <XCircle className="w-3.5 h-3.5" />}
            {testResult.message}
          </div>
        )}
      </div>

      {/* Sync Actions */}
      {status?.configured && (
        <div className="panel-beveled p-3 space-y-3">
          <div className="flex items-center gap-2 mb-2">
            <span className="field-label text-brand-400">Data Sync</span>
            <div className="flex-1 h-px bg-rmpg-700" />
          </div>
          <div className="flex items-center gap-2">
            <button onClick={handleSync} disabled={syncing || scraping}
              className="toolbar-btn text-[10px] px-3 py-1.5 flex items-center gap-1.5">
              {syncing ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
              Quick Sync
            </button>
            <button onClick={handleScrape} disabled={syncing || scraping}
              className="toolbar-btn-primary text-[10px] px-3 py-1.5 flex items-center gap-1.5">
              {scraping ? <Loader2 className="w-3 h-3 animate-spin" /> : <Download className="w-3 h-3" />}
              Full Historical Scrape (24 months)
            </button>
          </div>
          {scraping && scrapeProgress && (
            <div className="p-2 rounded bg-brand-900/20 border border-brand-700/30">
              <div className="text-[10px] text-brand-400 font-mono">
                Stage: {scrapeProgress.progress?.stage || 'starting'}
                {scrapeProgress.progress?.vehicleTotal > 0 && (
                  <> — Vehicle {scrapeProgress.progress.vehicleIndex}/{scrapeProgress.progress.vehicleTotal}</>
                )}
                {scrapeProgress.progress?.chunksTotal > 0 && (
                  <> — Chunk {scrapeProgress.progress.chunksProcessed}/{scrapeProgress.progress.chunksTotal}</>
                )}
              </div>
            </div>
          )}
          <p className="text-[10px] text-rmpg-500">
            Quick Sync fetches latest vehicle data. Full Historical Scrape pulls trips, locations, and alerts
            going back 24 months (may take several minutes).
          </p>
        </div>
      )}

      {/* Vehicle Linking */}
      {cpgpsVehicles.length > 0 && (
        <div className="panel-beveled p-3 space-y-3">
          <div className="flex items-center gap-2 mb-2">
            <span className="field-label text-brand-400">Vehicle Linking</span>
            <div className="flex-1 h-px bg-rmpg-700" />
            <span className="text-[9px] text-rmpg-500">{cpgpsVehicles.length} GPS vehicles</span>
          </div>
          <p className="text-[10px] text-rmpg-500 mb-2">
            Link ClearPathGPS vehicles to your fleet vehicles to see GPS data in the Fleet detail panel.
          </p>
          <div className="space-y-1.5 max-h-64 overflow-y-auto">
            {cpgpsVehicles.map(cv => (
              <div key={cv.id} className="flex items-center gap-2 p-2 rounded bg-rmpg-900/40 hover:bg-rmpg-800/40">
                <Car className="w-3.5 h-3.5 text-rmpg-500 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="text-[11px] text-rmpg-200 font-semibold truncate">{cv.name || cv.cpgps_id}</div>
                  <div className="text-[9px] text-rmpg-500">
                    {[cv.make, cv.model, cv.year].filter(Boolean).join(' ') || 'No vehicle info'}
                    {cv.last_reported_at && <> — Last: {new Date(cv.last_reported_at).toLocaleDateString()}</>}
                  </div>
                </div>
                {cv.fleet_vehicle_number ? (
                  <div className="flex items-center gap-1.5">
                    <Link2 className="w-3 h-3 text-green-400" />
                    <span className="text-[10px] text-green-400 font-mono">{cv.fleet_vehicle_number}</span>
                    <button onClick={() => handleLink(cv.id, null)} disabled={linkingId === cv.id}
                      className="text-rmpg-500 hover:text-red-400 p-0.5">
                      <Unlink className="w-3 h-3" />
                    </button>
                  </div>
                ) : (
                  <select
                    className="select-dark text-[10px] w-36 py-0.5"
                    value=""
                    onChange={e => { if (e.target.value) handleLink(cv.id, parseInt(e.target.value)); }}
                    disabled={linkingId === cv.id}
                  >
                    <option value="">Link to fleet...</option>
                    {fleetVehicles.map(fv => (
                      <option key={fv.id} value={fv.id}>
                        {fv.vehicle_number}{fv.make ? ` — ${fv.make} ${fv.model || ''}` : ''}
                      </option>
                    ))}
                  </select>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
