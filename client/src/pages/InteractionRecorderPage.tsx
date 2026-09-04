// Interaction audio recorder (Intel Wave 3b). Records a full contact
// from inside the app, chunk-streaming to R2 so a crash/reload loses at
// most the last 5 seconds. Playback concatenates the stored chunks.
import { useEffect, useRef, useState } from 'react';
import { Mic, Square, Loader2, Radio } from 'lucide-react';
import { useSearchParams } from 'react-router';
import { apiFetch } from '../hooks/useApi';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../components/ToastProvider';
import PanelTitleBar from '../components/PanelTitleBar';
import ConfirmDialog from '../components/ConfirmDialog';
import { useInteractionRecorder } from '../hooks/useInteractionRecorder';
import { parseTimestamp } from '../utils/dateUtils';
import { recordingsToCsv, downloadTextFile } from '../utils/rmsListExport';
import { copyToClipboard } from '../utils/contextMenuActions';

interface Recording {
  id: number; started_at: string; duration_sec: number; chunk_count: number;
  status: string; location_text: string | null; notes: string | null;
}

const fmt = (s: number) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;

const fmtStarted = (started_at: string) => {
  try {
    const d = parseTimestamp(started_at);
    return `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  } catch { return String(started_at).slice(5, 16); }
};

export default function InteractionRecorderPage() {
  const rec = useInteractionRecorder();
  const { user } = useAuth();
  const { addToast } = useToast();
  const [searchParams, setSearchParams] = useSearchParams();

  const [list, setList] = useState<Recording[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [listQuery, setListQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [location, setLocation] = useState('');
  const [notes, setNotes] = useState('');
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [playing, setPlaying] = useState<number | null>(null);
  const [stopConfirmOpen, setStopConfirmOpen] = useState(false);

  const locationInputRef = useRef<HTMLInputElement>(null);

  // Role gates — delete gated to admin/manager.
  const canDelete = user?.role === 'admin' || user?.role === 'manager';

  const load = () => {
    setLoading(true);
    setLoadError(null);
    apiFetch<Recording[]>('/intel/recordings?limit=25')
      .then((r) => setList(Array.isArray(r) ? r : []))
      .catch((err) => {
        setList([]);
        setLoadError(err instanceof Error ? err.message : 'Failed to load recordings');
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  useEffect(() => {
    navigator.geolocation?.getCurrentPosition(
      (p) => setCoords({ lat: p.coords.latitude, lng: p.coords.longitude }),
      () => { /* optional */ }, { enableHighAccuracy: true, timeout: 5000 },
    );
  }, []);

  useEffect(() => { if (!rec.recording && rec.recordingId) load(); }, [rec.recording, rec.recordingId]);

  // ── Deep-link: ?recording_id=<id> scrolls the row into view ──────────────────────────
  const deepLinkRef = useRef(false);
  const recordingIdParam = searchParams.get('recording_id');
  useEffect(() => {
    if (loading || deepLinkRef.current || !recordingIdParam) return;
    deepLinkRef.current = true;
    const id = Number(recordingIdParam);
    if (Number.isFinite(id) && list.some((r) => r.id === id)) {
      const el = document.getElementById(`recording-row-${id}`);
      el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } else if (list.length > 0) {
      addToast(`Recording #${recordingIdParam} not found.`, 'warning');
    } else {
      return; // wait for list to hydrate
    }
    const next = new URLSearchParams(searchParams);
    next.delete('recording_id');
    setSearchParams(next, { replace: true });
  }, [loading, list, recordingIdParam, searchParams, setSearchParams, addToast]);

  const onStopConfirmed = async () => {
    setStopConfirmOpen(false);
    await rec.stop();
    setLocation('');
    setNotes('');
    setTimeout(load, 500);
  };

  const handleStop = () => {
    if (rec.elapsed > 0) {
      setStopConfirmOpen(true);
    } else {
      void onStopConfirmed();
    }
  };

  // ── N shortcut — focus location input (any authenticated user) ────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'n' && e.key !== 'N') return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (!t) return;
      const tag = t.tagName;
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
      if (t.isContentEditable) return;
      if (!user) return;
      if (rec.recording) return;
      e.preventDefault();
      locationInputRef.current?.focus();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [user, rec.recording]);

  // ── Esc cascade: close stop-confirm dialog ────────────────────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (stopConfirmOpen) {
        e.stopPropagation();
        setStopConfirmOpen(false);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [stopConfirmOpen]);

  // Sequential chunk playback: chain the chunk endpoints end-to-end.
  const play = (r: Recording) => {
    if (!r.chunk_count) return;
    setPlaying(r.id);
    let seq = 0;
    const audio = new Audio();
    const next = () => {
      if (seq >= r.chunk_count) { setPlaying(null); return; }
      audio.src = `/api/intel/recordings/${r.id}/chunk/${seq}`;
      seq++;
      audio.play().catch(() => setPlaying(null));
    };
    audio.onended = next;
    audio.onerror = () => setPlaying(null);
    next();
  };

  // Delete recording (admin/manager only).
  const deleteRecording = async (r: Recording) => {
    try {
      await apiFetch(`/intel/recordings/${r.id}`, { method: 'DELETE' });
      setList((prev) => prev.filter((x) => x.id !== r.id));
      addToast(`Recording #${r.id} deleted`, 'success');
    } catch (err) {
      addToast((err as Error)?.message || 'Delete failed', 'error');
    }
  };

  const q = listQuery.trim().toLowerCase();
  const visibleList = list.filter((r) => {
    if (statusFilter !== 'ALL' && r.status !== statusFilter) return false;
    if (!q) return true;
    return String(r.id).includes(q) || (r.location_text || '').toLowerCase().includes(q) || (r.notes || '').toLowerCase().includes(q);
  });
  const statuses = Array.from(new Set(list.map((r) => r.status).filter(Boolean)));

  return (
    <div className="p-4 space-y-4 max-w-xl mx-auto">
      <PanelTitleBar title="INTERACTION RECORDER" icon={Mic} />

      <div className="border border-border-default text-[10px] text-rmpg-400 px-3 py-1">
        Records while this screen is open; each 5s is saved instantly so a crash loses almost nothing.
        For capture with the app fully closed, use the native app (coming).
      </div>

      {rec.orphan && !rec.recording && (
        <div className="bg-surface-base border border-brand-400 px-3 py-2 text-[11px] flex items-center justify-between">
          <span className="text-brand-400">A previous recording (#{rec.orphan}) didn't finalize.</span>
          <button onClick={rec.finalizeOrphan} className="text-[9px] text-brand-400 border border-border-default px-2 py-[1px]">FINALIZE</button>
        </div>
      )}
      {rec.error && <div className="bg-red-950 border border-red-600 text-red-300 text-[11px] px-3 py-2">{rec.error}</div>}

      <div className="bg-surface-base border border-border-default p-4 flex flex-col items-center gap-3">
        {rec.recording ? (
          <>
            <div className="text-3xl font-mono text-red-400 tabular-nums flex items-center gap-2">
              <span className="w-3 h-3 rounded-full bg-red-500 animate-pulse" /> {fmt(rec.elapsed)}
            </div>
            <div className="text-[10px] text-rmpg-400">{rec.chunksSent} chunk(s) saved</div>
            <button onClick={handleStop} className="flex items-center gap-2 px-6 py-2 border border-red-600 text-red-400 hover:bg-surface-raised">
              <Square className="w-4 h-4" /> STOP
            </button>
          </>
        ) : (
          <>
            <input ref={locationInputRef} value={location} onChange={(e) => setLocation(e.target.value)}
              placeholder={coords ? 'GPS captured — add detail' : 'Location (optional)'}
              className="w-full bg-surface-overlay border border-border-default px-2 py-1 text-[11px] text-rmpg-200 focus:border-brand-400 outline-none" />
            <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Notes (optional)"
              className="w-full bg-surface-overlay border border-border-default px-2 py-1 text-[11px] text-rmpg-200 focus:border-brand-400 outline-none" />
            <button
              onClick={() => rec.start({ location: location.trim() || undefined, notes: notes.trim() || undefined, lat: coords?.lat, lng: coords?.lng })}
              className="flex items-center gap-2 px-8 py-3 border border-brand-400 text-brand-400 text-sm font-semibold hover:bg-surface-raised">
              <Mic className="w-5 h-5" /> START RECORDING
            </button>
          </>
        )}
      </div>

      <div className="bg-surface-base border border-border-default">
        <div className="px-2 py-[3px] text-[9px] font-semibold border-b border-border-default flex items-center gap-2 flex-wrap" style={{ color: 'var(--panel-header-color)' }}>
          <span>RECORDINGS</span>
          <input
            value={listQuery}
            onChange={(e) => setListQuery(e.target.value)}
            placeholder="Search location / notes…"
            aria-label="Search recordings"
            className="ml-auto bg-surface-overlay border border-border-default px-2 py-[2px] text-[10px] text-rmpg-200 outline-none"
            style={{ width: 140 }}
          />
          <select aria-label="Filter by status" className="bg-surface-overlay border border-border-default text-[10px] text-rmpg-200" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="ALL">All statuses</option>
            {statuses.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <button type="button" className="text-[9px] border border-border-default px-2 py-[1px]" disabled={visibleList.length === 0} onClick={() => downloadTextFile('recordings.csv', recordingsToCsv(visibleList))}>CSV</button>
        </div>
        {loadError && (
          <div className="px-2 py-2 text-[11px] text-red-300 flex items-center justify-between">
            <span>{loadError}</span>
            <button type="button" className="text-[9px] border border-border-default px-2" onClick={load}>Retry</button>
          </div>
        )}

        {/* Empty states: loading / no-data */}
        {loading && (
          <div className="p-4 flex items-center justify-center gap-2 text-[11px] text-rmpg-400">
            <Loader2 className="w-3 h-3 animate-spin" /> Loading…
          </div>
        )}
        {!loading && list.length === 0 && !loadError && (
          <div className="p-6 flex flex-col items-center gap-2 text-[11px] text-rmpg-400">
            <Radio className="w-6 h-6 opacity-30" />
            <span>No recordings yet. Press <kbd className="border border-border-default px-1">N</kbd> or tap START RECORDING above.</span>
          </div>
        )}
        {!loading && list.length > 0 && visibleList.length === 0 && (
          <div className="p-4 text-center text-[11px] text-rmpg-400">No recordings match the search or status filter.</div>
        )}

        {!loading && visibleList.map((r) => (
          <div key={r.id} id={`recording-row-${r.id}`} className="px-2 py-[2px] text-[11px] flex items-center gap-2 border-b border-border-default last:border-b-0">
            <span className="text-rmpg-200 w-32 shrink-0">{fmtStarted(r.started_at)}</span>
            <span className="text-rmpg-400 min-w-0 flex-1 truncate">{r.location_text || r.notes || ''}</span>
            <span className="text-rmpg-400">{fmt(r.duration_sec || 0)}</span>
            <button type="button" onClick={() => void copyToClipboard(String(r.id))} className="text-[9px] text-rmpg-200 border border-border-default px-2 py-[1px]" aria-label={`Copy recording ${r.id}`}>ID</button>
            <button onClick={() => play(r)} disabled={!r.chunk_count || playing === r.id}
              className="text-[9px] text-brand-400 border border-border-default px-2 py-[1px] disabled:opacity-40">
              {playing === r.id ? 'PLAYING…' : 'PLAY'}
            </button>
            {canDelete && (
              <button
                onClick={() => deleteRecording(r)}
                className="text-[9px] text-red-400 border border-border-default px-2 py-[1px] hover:bg-red-950"
                aria-label={`Delete recording ${r.id}`}
              >
                DEL
              </button>
            )}
          </div>
        ))}
      </div>

      {/* ConfirmDialog — gate stop/discard of in-progress recording */}
      <ConfirmDialog
        isOpen={stopConfirmOpen}
        onClose={() => setStopConfirmOpen(false)}
        onConfirm={() => { void onStopConfirmed(); }}
        title="Stop Recording"
        message="Stop and save the current recording?"
        details={<span>{fmt(rec.elapsed)} recorded · {rec.chunksSent} chunk(s) already saved to R2</span>}
        confirmLabel="Stop & Save"
        confirmVariant="warning"
      />
    </div>
  );
}
