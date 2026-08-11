import React, { useState, useEffect } from 'react';
import { Battery, Wifi, HardDrive, Cpu, RefreshCw, CheckCircle, AlertCircle, XCircle } from 'lucide-react';
import { apiFetch } from '../hooks/useApi';

interface HealthCheck { name: string; status: 'ok' | 'degraded' | 'error'; latencyMs?: number; }
interface BatteryInfo { level: number; charging: boolean; }

function useBattery(): BatteryInfo | null {
  const [info, setInfo] = useState<BatteryInfo | null>(null);
  useEffect(() => {
    async function getBat() {
      try {
        type BatApi = { level: number; charging: boolean; addEventListener: (e: string, cb: () => void) => void };
        const bat = await (navigator as unknown as { getBattery?: () => Promise<BatApi> }).getBattery?.();
        if (bat) {
          setInfo({ level: Math.round(bat.level * 100), charging: bat.charging });
          bat.addEventListener('levelchange', () => setInfo({ level: Math.round(bat.level * 100), charging: bat.charging }));
          bat.addEventListener('chargingchange', () => setInfo({ level: Math.round(bat.level * 100), charging: bat.charging }));
        }
      } catch { /* no battery API */ }
    }
    getBat();
  }, []);
  return info;
}

function StatusIcon({ status }: { status: 'ok' | 'degraded' | 'error' }) {
  if (status === 'ok') return <CheckCircle className="w-3.5 h-3.5" style={{ color: 'var(--sev-ok, #22c55e)' }} />;
  if (status === 'degraded') return <AlertCircle className="w-3.5 h-3.5" style={{ color: 'var(--sev-warn, #f59e0b)' }} />;
  return <XCircle className="w-3.5 h-3.5" style={{ color: 'var(--sev-critical, #ef4444)' }} />;
}

export default function DeviceHealthPage() {
  const battery = useBattery();
  const [online, setOnline] = useState(navigator.onLine);
  const [checks, setChecks] = useState<HealthCheck[]>([]);
  const [loading, setLoading] = useState(false);
  const [score, setScore] = useState<number | null>(null);

  useEffect(() => {
    const on = () => setOnline(true); const off = () => setOnline(false);
    window.addEventListener('online', on); window.addEventListener('offline', off);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); };
  }, []);

  async function runCheck() {
    setLoading(true);
    try {
      const res = await apiFetch<{ services: { name: string; status: string; latencyMs?: number }[] }>('/health');
      const mapped: HealthCheck[] = (res?.services ?? []).map(s => ({
        name: s.name,
        status: s.status === 'ok' ? 'ok' : s.status === 'degraded' ? 'degraded' : 'error',
        latencyMs: s.latencyMs,
      }));
      setChecks(mapped);
      const ok = mapped.filter(c => c.status === 'ok').length;
      setScore(mapped.length > 0 ? Math.round((ok / mapped.length) * 100) : null);
    } catch { setChecks([{ name: 'API', status: 'error' }]); setScore(0); }
    finally { setLoading(false); }
  }

  useEffect(() => { runCheck(); }, []);

  const battColor = !battery ? 'var(--text-secondary)' : battery.level < 20 ? 'var(--sev-critical, #ef4444)' : battery.level < 40 ? 'var(--sev-warn, #f59e0b)' : 'var(--sev-ok, #22c55e)';

  return (
    <div style={{ background: 'var(--surface-base)', minHeight: '100vh', padding: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <Cpu className="w-4 h-4" style={{ color: 'var(--brand-400)' }} />
        <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--field-label-color)', letterSpacing: '0.08em', flexGrow: 1 }}>DEVICE HEALTH</div>
        {score !== null && <span style={{ fontSize: 12, fontWeight: 700, color: score >= 80 ? 'var(--sev-ok, #22c55e)' : score >= 50 ? 'var(--sev-warn, #f59e0b)' : 'var(--sev-critical, #ef4444)' }}>{score}%</span>}
      </div>
      <div style={{ background: 'var(--surface-raised)', border: '1px solid var(--border-subtle)', borderRadius: 2, padding: 10, marginBottom: 8 }}>
        <div style={{ fontSize: 9, fontWeight: 600, color: 'var(--field-label-color)', marginBottom: 8 }}>HARDWARE</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><Battery className="w-3.5 h-3.5" style={{ color: battColor }} /><span style={{ fontSize: 10, color: 'var(--text-primary)', flexGrow: 1 }}>Battery</span><span style={{ fontSize: 10, color: battColor }}>{battery ? `${battery.level}%${battery.charging ? ' ⚡' : ''}` : 'Unknown'}</span></div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><Wifi className="w-3.5 h-3.5" style={{ color: online ? 'var(--sev-ok, #22c55e)' : 'var(--sev-critical, #ef4444)' }} /><span style={{ fontSize: 10, color: 'var(--text-primary)', flexGrow: 1 }}>Network</span><span style={{ fontSize: 10, color: online ? 'var(--sev-ok, #22c55e)' : 'var(--sev-critical, #ef4444)' }}>{online ? 'Connected' : 'Offline'}</span></div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><HardDrive className="w-3.5 h-3.5" style={{ color: 'var(--text-secondary)' }} /><span style={{ fontSize: 10, color: 'var(--text-primary)', flexGrow: 1 }}>Storage</span><span style={{ fontSize: 10, color: 'var(--text-secondary)' }}>OK</span></div>
        </div>
      </div>
      <div style={{ background: 'var(--surface-raised)', border: '1px solid var(--border-subtle)', borderRadius: 2, padding: 10, marginBottom: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}>
          <div style={{ fontSize: 9, fontWeight: 600, color: 'var(--field-label-color)', flexGrow: 1 }}>API SERVICES</div>
          <button type="button" onClick={runCheck} disabled={loading} style={{ background: 'none', border: 'none', cursor: 'pointer' }}>
            <RefreshCw className={`w-3 h-3${loading ? ' animate-spin' : ''}`} style={{ color: 'var(--brand-400)' }} />
          </button>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {checks.map(c => (
            <div key={c.name} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <StatusIcon status={c.status} />
              <span style={{ fontSize: 10, color: 'var(--text-primary)', flexGrow: 1 }}>{c.name}</span>
              {c.latencyMs !== undefined && <span style={{ fontSize: 9, color: 'var(--text-secondary)' }}>{c.latencyMs}ms</span>}
              <span style={{ fontSize: 9, color: c.status === 'ok' ? 'var(--sev-ok, #22c55e)' : c.status === 'degraded' ? 'var(--sev-warn, #f59e0b)' : 'var(--sev-critical, #ef4444)' }}>{c.status}</span>
            </div>
          ))}
          {checks.length === 0 && !loading && <div style={{ fontSize: 9, color: 'var(--text-secondary)' }}>No data</div>}
        </div>
      </div>
      <div style={{ fontSize: 9, color: 'var(--text-secondary)' }}>FlexOS · Rocky Mountain Protective Group</div>
    </div>
  );
}
