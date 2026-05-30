// RecordingsTab — user-saved/bookmarked transmissions.
// Bookmarks are per-user (server enforces user_id scoping).
import { useEffect, useState } from 'react';
import { Bookmark, Trash2 } from 'lucide-react';
import { apiFetch } from '../../../hooks/useApi';
import { SectionHeader } from '../components';
import { AudioPlayButton } from './LiveTab';
import type { RadioRecording } from '../types';

export default function RecordingsTab() {
  const [recordings, setRecordings] = useState<RadioRecording[]>([]);
  const [loading, setLoading] = useState(true);

  const load = () => {
    setLoading(true);
    apiFetch<RadioRecording[]>('/radio/recordings')
      .then(setRecordings)
      .catch((err) => console.error('[radio] recordings', err))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const remove = async (id: number) => {
    if (!confirm('Delete this recording bookmark?')) return;
    try {
      await apiFetch(`/radio/recordings/${id}`, { method: 'DELETE' });
      setRecordings((r) => r.filter((x) => x.id !== id));
    } catch (err) { console.error('[radio] delete recording', err); }
  };

  return (
    <div className="h-full flex flex-col">
      <SectionHeader
        icon={<Bookmark className="w-3 h-3" style={{ color: 'var(--rt-accent)' }} />}
        label={`SAVED RECORDINGS — ${recordings.length}`}
      />
      <div className="flex-1 min-h-0 overflow-auto">
        {loading ? (
          <div className="p-6 text-[10px] font-mono" style={{ color: 'var(--rt-muted)' }}>Loading…</div>
        ) : recordings.length === 0 ? (
          <div className="p-6 text-[10px] font-mono text-center" style={{ color: 'var(--rt-muted)' }}>
            No bookmarks yet. Save a transmission from the LIVE tab to bookmark it here.
          </div>
        ) : (
          <ul className="divide-y" style={{ borderColor: 'var(--rt-border)' }}>
            {recordings.map((r) => {
              const time = (() => {
                try { return new Date(r.transmitted_at).toLocaleString('en-US', { hour12: false }); }
                catch { return r.transmitted_at; }
              })();
              return (
                <li key={r.id} className="px-3 py-2 text-[10px] font-mono flex items-start gap-2 hover:bg-black/30"
                  style={{ borderLeft: r.color ? `3px solid ${r.color}` : '3px solid transparent' }}>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      {r.label && <span className="font-bold" style={{ color: 'var(--rt-accent)' }}>{r.label}</span>}
                      <span style={{ color: 'var(--rt-muted)' }}>{r.channel_name || '—'}</span>
                      <span className="tabular-nums" style={{ color: 'var(--rt-muted)' }}>{time}</span>
                      <span className="tabular-nums" style={{ color: 'var(--rt-muted)' }}>{r.duration_seconds.toFixed(1)}s</span>
                    </div>
                    {r.transcript && <div className="mt-0.5" style={{ color: 'var(--rt-text)' }}>{r.transcript}</div>}
                    {r.notes && <div className="mt-0.5 italic" style={{ color: 'var(--rt-muted)' }}>{r.notes}</div>}
                  </div>
                  <AudioPlayButton transmissionId={r.transmission_id} />
                  <button type="button" onClick={() => remove(r.id)}
                    aria-label="Delete bookmark"
                    className="opacity-60 hover:opacity-100"
                    style={{ color: '#ef4444' }}>
                    <Trash2 className="w-3 h-3" />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
