import { useEffect, useState } from 'react';
import { WifiOff } from 'lucide-react';
import {
  getQueuedOperations,
  removeOperation,
  useOfflineQueue,
  type QueuedOperation,
  MAX_RETRIES,
} from '../../hooks/useOfflineQueue';
import PanelTitleBar from '../../components/PanelTitleBar';

const FALLBACK_URL_KEY = 'rmpg_fallback_api_url';

export default function OfflineQueueTab() {
  const [ops, setOps] = useState<QueuedOperation[]>([]);
  const [fallbackUrl, setFallbackUrl] = useState(() => localStorage.getItem(FALLBACK_URL_KEY) ?? '');
  const [fallbackInput, setFallbackInput] = useState(() => localStorage.getItem(FALLBACK_URL_KEY) ?? '');
  const { drain } = useOfflineQueue();

  async function load() {
    setOps(await getQueuedOperations());
  }

  useEffect(() => { void load(); }, []);

  async function handleDiscard(id: string) {
    await removeOperation(id);
    void load();
  }

  function handleSaveFallbackUrl() {
    const trimmed = fallbackInput.trim();
    if (trimmed) {
      localStorage.setItem(FALLBACK_URL_KEY, trimmed);
    } else {
      localStorage.removeItem(FALLBACK_URL_KEY);
    }
    setFallbackUrl(trimmed);
  }

  async function handleDrain() {
    await drain();
    void load();
  }

  // Show fallback as active if there is a saved URL (the apiFetch layer activates it after threshold failures)
  const activeFallback = fallbackUrl || null;
  const pending = ops.filter(op => op.retries < MAX_RETRIES);
  const failed = ops.filter(op => op.retries >= MAX_RETRIES);

  return (
    <div className="p-4 space-y-4">
      <PanelTitleBar title="OFFLINE QUEUE" icon={WifiOff} />

      {/* Status row */}
      <div className="flex items-center gap-2 text-[11px]" style={{ color: 'var(--text-secondary)' }}>
        <span className="font-semibold" style={{ color: 'var(--text-primary)' }}>API Status:</span>
        {activeFallback ? (
          <span style={{ color: 'var(--sev-warn)' }}>Fallback active ({activeFallback})</span>
        ) : (
          <span style={{ color: 'var(--sev-ok)' }}>Primary online</span>
        )}
      </div>

      {/* Pending operations */}
      <div className="flex items-center gap-3 text-[11px]">
        <span style={{ color: 'var(--text-secondary)' }}>
          {pending.length} operation{pending.length !== 1 ? 's' : ''} pending sync
        </span>
        {pending.length > 0 && (
          <button
            onClick={() => { void handleDrain(); }}
            className="px-2 py-[2px] rounded text-[9px] font-semibold bg-surface-raised hover:bg-surface-hover"
            style={{ color: 'var(--text-primary)', border: '1px solid var(--border-subtle)' }}
          >
            Drain Now
          </button>
        )}
      </div>

      {/* Failed operations table */}
      {failed.length > 0 && (
        <div className="space-y-1">
          <p className="text-[9px] font-semibold" style={{ color: 'var(--sev-critical)' }}>
            STUCK OPERATIONS — {MAX_RETRIES}+ retries, require manual discard
          </p>
          <table className="w-full text-[11px]">
            <thead>
              <tr className="text-left text-[9px] font-semibold" style={{ color: 'var(--text-secondary)' }}>
                <th className="py-[3px] pr-3">Method</th>
                <th className="py-[3px] pr-3">Path</th>
                <th className="py-[3px] pr-3">Queued</th>
                <th className="py-[3px] pr-3">Retries</th>
                <th className="py-[3px]">Action</th>
              </tr>
            </thead>
            <tbody>
              {failed.map(op => (
                <tr key={op.id} style={{ color: 'var(--sev-critical)' }}>
                  <td className="py-[2px] pr-3 font-mono">{op.method}</td>
                  <td className="py-[2px] pr-3 font-mono truncate max-w-[220px]">{op.path}</td>
                  <td className="py-[2px] pr-3">{new Date(op.timestamp).toLocaleTimeString()}</td>
                  <td className="py-[2px] pr-3">{op.retries}</td>
                  <td className="py-[2px]">
                    <button
                      onClick={() => { void handleDiscard(op.id); }}
                      className="hover:underline text-[9px]"
                      style={{ color: 'var(--sev-critical)' }}
                      aria-label={`Discard queued ${op.method} ${op.path}`}
                    >
                      Discard
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {ops.length === 0 && (
        <p className="text-[11px]" style={{ color: 'var(--text-secondary)' }}>
          No queued operations — all data synced.
        </p>
      )}

      {/* Fallback URL config */}
      <div className="space-y-1 pt-2 border-t" style={{ borderColor: 'var(--border-subtle)' }}>
        <p className="text-[9px] font-semibold" style={{ color: 'var(--field-label-color)' }}>
          FALLBACK URL (Toughbook / secondary endpoint)
        </p>
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={fallbackInput}
            onChange={e => setFallbackInput(e.target.value)}
            placeholder="http://192.168.1.x:8787"
            className="flex-1 px-2 py-[3px] text-[11px] rounded bg-surface-raised"
            style={{
              color: 'var(--text-primary)',
              border: '1px solid var(--border-subtle)',
              outline: 'none',
            }}
          />
          <button
            onClick={handleSaveFallbackUrl}
            className="px-2 py-[2px] rounded text-[9px] font-semibold bg-surface-raised hover:bg-surface-hover"
            style={{ color: 'var(--text-primary)', border: '1px solid var(--border-subtle)' }}
          >
            Save
          </button>
        </div>
        {fallbackUrl && (
          <p className="text-[9px]" style={{ color: 'var(--text-secondary)' }}>
            Saved: {fallbackUrl}
          </p>
        )}
      </div>
    </div>
  );
}
