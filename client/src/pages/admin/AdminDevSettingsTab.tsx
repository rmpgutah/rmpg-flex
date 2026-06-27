import { useEffect, useRef, useState } from 'react';
import { useFeatureFlags, type FeatureFlags } from '../../context/FeatureFlagsContext';
import { apiFetch } from '../../hooks/useApi';
import { getLog, clearLog, type LogEntry } from '../../utils/apiLogger';

interface Props { role: string; }

const FLAG_LABELS: Record<keyof FeatureFlags, string> = {
  draw: 'Draw Geofence',
  annotations: 'Annotations',
  gps_replay: 'GPS Replay',
  nav_overlay: 'Nav Overlay',
  buildings_3d: '3D Buildings',
  buffer_rings: 'Buffer Rings',
  ruler: 'Ruler',
  minimap: 'Minimap',
  dev_diagnostics: 'Dev Diagnostics',
};

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(true);
  return (
    <div className="border border-surface-raised rounded">
      <button
        onClick={() => setOpen(p => !p)}
        className="w-full text-left px-3 py-2 text-brand-400 font-bold text-[10px] uppercase tracking-wider flex justify-between"
      >
        {title}
        <span className="text-rmpg-400">{open ? '▲' : '▼'}</span>
      </button>
      {open && <div className="px-3 pb-3 space-y-2">{children}</div>}
    </div>
  );
}

export default function AdminDevSettingsTab({ role }: Props) {
  const flags = useFeatureFlags();
  const [localFlags, setLocalFlags] = useState<FeatureFlags>({ ...flags });
  const [saving, setSaving] = useState(false);
  const [apiLog, setApiLog] = useState<LogEntry[]>([]);
  const [logFilter, setLogFilter] = useState('');
  const [simUnit, setSimUnit] = useState('');
  const [simLat, setSimLat] = useState('');
  const [simLng, setSimLng] = useState('');
  const [simMsg, setSimMsg] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => { setLocalFlags({ ...flags }); }, [flags]);

  const updateFlag = (key: keyof FeatureFlags, val: boolean) => {
    const updated = { ...localFlags, [key]: val };
    setLocalFlags(updated);
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      setSaving(true);
      try {
        await apiFetch('/admin/dev/feature-flags', {
          method: 'PUT',
          body: JSON.stringify(updated),
        });
      } catch { /* ignore — context will re-sync on next poll */ } finally { setSaving(false); }
    }, 300);
  };

  const refreshLog = () => setApiLog(getLog(logFilter || undefined));
  useEffect(() => {
    const id = setInterval(refreshLog, 1000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [logFilter]);

  const seedCall = async (type: string) => {
    try {
      await apiFetch('/admin/dev/mock/call', { method: 'POST', body: JSON.stringify({ type }) });
      setSimMsg(`Test call created (${type})`);
    } catch { setSimMsg('Failed'); }
    setTimeout(() => setSimMsg(null), 3000);
  };

  const injectGps = async () => {
    if (!simUnit || !simLat || !simLng) { setSimMsg('Unit ID + lat + lng required'); return; }
    try {
      await apiFetch('/admin/dev/mock/gps', {
        method: 'POST',
        body: JSON.stringify({ unit_id: Number(simUnit), lat: Number(simLat), lng: Number(simLng) }),
      });
      setSimMsg('GPS injected');
    } catch { setSimMsg('Failed'); }
    setTimeout(() => setSimMsg(null), 3000);
  };

  const clearTests = async () => {
    await apiFetch('/admin/dev/mock/calls', { method: 'DELETE' });
    setSimMsg('Test data cleared');
    setTimeout(() => setSimMsg(null), 3000);
  };

  if (role !== 'admin') return null;

  return (
    <div className="space-y-3 text-xs">
      <div className="text-rmpg-400 text-[10px] flex items-center gap-2">
        <span>Map tool toggles + simulation controls</span>
        {saving && <span className="text-brand-400">saving…</span>}
      </div>

      <Section title="Feature Flags">
        {(Object.keys(FLAG_LABELS) as (keyof FeatureFlags)[]).map(key => (
          <label key={key} className="flex justify-between items-center cursor-pointer">
            <span className="text-rmpg-200">{FLAG_LABELS[key]}</span>
            <div className="flex items-center gap-2">
              <span className={`text-[10px] ${localFlags[key] ? 'text-green-400' : 'text-red-400'}`}>
                {localFlags[key] ? 'ON' : 'OFF'}
              </span>
              <input
                type="checkbox"
                aria-label={FLAG_LABELS[key]}
                checked={localFlags[key]}
                onChange={e => updateFlag(key, e.target.checked)}
                className="accent-brand-500"
              />
            </div>
          </label>
        ))}
      </Section>

      <Section title="API Log">
        <div className="flex gap-2 mb-2">
          <input
            value={logFilter}
            onChange={e => { setLogFilter(e.target.value); refreshLog(); }}
            placeholder="Filter by path prefix…"
            className="flex-1 bg-surface-base border border-surface-raised text-rmpg-200 rounded px-2 py-0.5 text-[10px]"
          />
          <button
            onClick={() => { clearLog(); setApiLog([]); }}
            className="bg-surface-raised text-rmpg-300 px-2 py-0.5 rounded text-[10px]"
          >
            Clear
          </button>
        </div>
        <div className="max-h-40 overflow-y-auto space-y-0.5">
          {apiLog.length === 0 && (
            <div className="text-rmpg-400 text-[10px]">No API calls logged yet</div>
          )}
          {apiLog.map((entry, i) => (
            <div key={i} className="flex gap-2 text-[10px] font-mono">
              <span className="text-rmpg-400 shrink-0">{entry.method}</span>
              <span className={`shrink-0 ${
                entry.status >= 500 ? 'text-red-400' : entry.status >= 400 ? 'text-yellow-400' : 'text-green-400'
              }`}>{entry.status}</span>
              <span className="text-rmpg-300 truncate flex-1">{entry.path}</span>
              <span className="text-rmpg-400 shrink-0">{entry.latencyMs}ms</span>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Simulation Controls">
        {simMsg && <div className="text-brand-400 text-[10px] mb-1">{simMsg}</div>}
        <div className="space-y-1">
          <div className="text-rmpg-400 text-[10px] font-semibold">Seed Test Call</div>
          <div className="flex gap-1">
            {['TRAFFIC STOP', 'WELFARE CHECK', 'DISTURBANCE'].map(t => (
              <button
                key={t}
                onClick={() => seedCall(t)}
                className="text-[9px] bg-surface-raised text-rmpg-200 px-2 py-1 rounded hover:bg-brand-500 hover:text-black"
              >
                {t}
              </button>
            ))}
          </div>
        </div>
        <div className="space-y-1 border-t border-surface-raised pt-2">
          <div className="text-rmpg-400 text-[10px] font-semibold">Fake GPS Position</div>
          <div className="flex gap-1">
            <input
              value={simUnit}
              onChange={e => setSimUnit(e.target.value)}
              placeholder="Unit ID"
              className="w-16 bg-surface-base border border-surface-raised text-rmpg-200 rounded px-1 py-0.5 text-[10px]"
            />
            <input
              value={simLat}
              onChange={e => setSimLat(e.target.value)}
              placeholder="Lat"
              className="flex-1 bg-surface-base border border-surface-raised text-rmpg-200 rounded px-1 py-0.5 text-[10px]"
            />
            <input
              value={simLng}
              onChange={e => setSimLng(e.target.value)}
              placeholder="Lng"
              className="flex-1 bg-surface-base border border-surface-raised text-rmpg-200 rounded px-1 py-0.5 text-[10px]"
            />
            <button
              onClick={injectGps}
              className="bg-brand-500 text-black font-bold px-2 py-0.5 rounded text-[10px]"
            >
              Inject
            </button>
          </div>
        </div>
        <button
          onClick={clearTests}
          className="mt-1 w-full bg-surface-raised text-red-400 py-1 rounded text-[10px] border border-red-900"
        >
          Clear All Test Data
        </button>
      </Section>
    </div>
  );
}
