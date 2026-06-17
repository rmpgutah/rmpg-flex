// Interaction audio recorder (Intel Wave 3b). Records a full contact
// from inside the app, chunk-streaming to R2 so a crash/reload loses at
// most the last 5 seconds. Playback concatenates the stored chunks.
import { useEffect, useState } from 'react';
import { Mic, Square } from 'lucide-react';
import { apiFetch } from '../hooks/useApi';
import PanelTitleBar from '../components/PanelTitleBar';
import { useInteractionRecorder } from '../hooks/useInteractionRecorder';

interface Recording {
  id: number; started_at: string; duration_sec: number; chunk_count: number;
  status: string; location_text: string | null; notes: string | null;
}

const fmt = (s: number) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;

export default function InteractionRecorderPage() {
  const rec = useInteractionRecorder();
  const [list, setList] = useState<Recording[]>([]);
  const [location, setLocation] = useState('');
  const [notes, setNotes] = useState('');
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [playing, setPlaying] = useState<number | null>(null);

  const load = () => apiFetch<Recording[]>('/intel/recordings?limit=25').then((r) => setList(Array.isArray(r) ? r : [])).catch(() => setList([]));
  useEffect(() => { load(); }, []);
  useEffect(() => {
    navigator.geolocation?.getCurrentPosition(
      (p) => setCoords({ lat: p.coords.latitude, lng: p.coords.longitude }),
      () => { /* optional */ }, { enableHighAccuracy: true, timeout: 5000 },
    );
  }, []);
  useEffect(() => { if (!rec.recording && rec.recordingId) load(); }, [rec.recording, rec.recordingId]);

  const onStop = async () => { await rec.stop(); setLocation(''); setNotes(''); setTimeout(load, 500); };

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

  return (
    <div className="p-4 space-y-4 max-w-xl mx-auto">
      <PanelTitleBar title="INTERACTION RECORDER" icon={Mic} />

      <div className="border border-border-default text-[10px] text-[#888888] px-3 py-1">
        Records while this screen is open; each 5s is saved instantly so a crash loses almost nothing.
        For capture with the app fully closed, use the native app (coming).
      </div>

      {rec.orphan && !rec.recording && (
        <div className="bg-surface-base border border-[#d4a017] px-3 py-2 text-[11px] flex items-center justify-between">
          <span className="text-[#d4a017]">A previous recording (#{rec.orphan}) didn't finalize.</span>
          <button onClick={rec.finalizeOrphan} className="text-[9px] text-[#d4a017] border border-border-default px-2 py-[1px]">FINALIZE</button>
        </div>
      )}
      {rec.error && <div className="bg-red-950 border border-red-600 text-red-300 text-[11px] px-3 py-2">{rec.error}</div>}

      <div className="bg-surface-base border border-border-default p-4 flex flex-col items-center gap-3">
        {rec.recording ? (
          <>
            <div className="text-3xl font-mono text-red-400 tabular-nums flex items-center gap-2">
              <span className="w-3 h-3 rounded-full bg-red-500 animate-pulse" /> {fmt(rec.elapsed)}
            </div>
            <div className="text-[10px] text-[#888888]">{rec.chunksSent} chunk(s) saved</div>
            <button onClick={onStop} className="flex items-center gap-2 px-6 py-2 border border-red-600 text-red-400 hover:bg-surface-raised">
              <Square className="w-4 h-4" /> STOP
            </button>
          </>
        ) : (
          <>
            <input value={location} onChange={(e) => setLocation(e.target.value)}
              placeholder={coords ? 'GPS captured — add detail' : 'Location (optional)'}
              className="w-full bg-surface-overlay border border-border-default px-2 py-1 text-[11px] text-rmpg-200 focus:border-[#d4a017] outline-none" />
            <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Notes (optional)"
              className="w-full bg-surface-overlay border border-border-default px-2 py-1 text-[11px] text-rmpg-200 focus:border-[#d4a017] outline-none" />
            <button
              onClick={() => rec.start({ location: location.trim() || undefined, notes: notes.trim() || undefined, lat: coords?.lat, lng: coords?.lng })}
              className="flex items-center gap-2 px-8 py-3 border border-[#d4a017] text-[#d4a017] text-sm font-semibold hover:bg-surface-raised">
              <Mic className="w-5 h-5" /> START RECORDING
            </button>
          </>
        )}
      </div>

      <div className="bg-surface-base border border-border-default">
        <div className="px-2 py-[3px] text-[9px] font-semibold text-[#d4a017] border-b border-border-default">RECORDINGS</div>
        {list.length === 0 && <div className="p-2 text-[11px] text-[#888888]">None yet.</div>}
        {list.map((r) => (
          <div key={r.id} className="px-2 py-[2px] text-[11px] flex items-center gap-2 border-b border-border-default last:border-b-0">
            <span className="text-rmpg-200 w-32 shrink-0">{String(r.started_at).slice(5, 16)}</span>
            <span className="text-[#888888] min-w-0 flex-1 truncate">{r.location_text || r.notes || ''}</span>
            <span className="text-[#888888]">{fmt(r.duration_sec || 0)}</span>
            <button onClick={() => play(r)} disabled={!r.chunk_count || playing === r.id}
              className="text-[9px] text-[#d4a017] border border-border-default px-2 py-[1px] disabled:opacity-40">
              {playing === r.id ? 'PLAYING…' : 'PLAY'}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
