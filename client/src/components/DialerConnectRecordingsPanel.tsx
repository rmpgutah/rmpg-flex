import { useCallback, useEffect, useRef, useState } from 'react';
import { Download, FileText, PhoneCall, Printer, RefreshCw, Search } from 'lucide-react';
import PanelTitleBar from './PanelTitleBar';
import IconButton from './IconButton';
import { apiFetch, apiFetchBlob } from '../hooks/useApi';
import { openDialConnectCallPdf, formatCallDuration } from '../utils/dialConnectCallPdf';
import { parseTimestamp } from '../utils/dateUtils';
import { DIAL_RECORDING_READY_EVENT } from './dialerConnect';

export interface DialConnectRecordingSummary {
  id: number;
  recording_sid: string;
  call_sid: string | null;
  from_number: string | null;
  to_number: string | null;
  direction: string | null;
  started_at: string | null;
  ended_at: string | null;
  duration_seconds: number | null;
  dispatcher_name: string | null;
  has_audio: boolean;
  has_transcript: boolean;
  ingested_at: string | null;
}

interface DialConnectRecordingDetail extends DialConnectRecordingSummary {
  transcript: string | null;
  segments: { start?: number; end?: number; speaker?: string; text: string }[] | null;
  audio_content_type: string | null;
}

function fmtMt(input: string | null): string {
  if (!input) return '—';
  try {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Denver',
      month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit', hour12: false,
    }).format(parseTimestamp(input));
  } catch {
    return input;
  }
}

function exporterName(): string | undefined {
  try {
    const raw = localStorage.getItem('rmpg_user');
    if (!raw) return undefined;
    const u = JSON.parse(raw) as { full_name?: string; name?: string; username?: string };
    return u.full_name || u.name || u.username || undefined;
  } catch {
    return undefined;
  }
}

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

export default function DialerConnectRecordingsPanel() {
  const [rows, setRows] = useState<DialConnectRecordingSummary[]>([]);
  const [q, setQ] = useState('');
  const qRef = useRef(q);
  qRef.current = q;
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<number | null>(null);

  const load = useCallback(async (search?: string) => {
    const term = (search ?? qRef.current).trim();
    setLoading(true);
    setError(null);
    try {
      const qs = term ? `?q=${encodeURIComponent(term)}` : '';
      const data = await apiFetch<DialConnectRecordingSummary[]>(`/dial-connect-recordings${qs}`);
      setRows(Array.isArray(data) ? data : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load recordings');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load('');
    const onReady = () => { void load(); };
    window.addEventListener(DIAL_RECORDING_READY_EVENT, onReady);
    const tick = setInterval(() => { void load(); }, 30_000);
    return () => {
      window.removeEventListener(DIAL_RECORDING_READY_EVENT, onReady);
      clearInterval(tick);
    };
  }, [load]);

  const printPdf = async (row: DialConnectRecordingSummary) => {
    setBusyId(row.id);
    try {
      const detail = await apiFetch<DialConnectRecordingDetail>(`/dial-connect-recordings/${row.id}`);
      openDialConnectCallPdf({
        recordingSid: detail.recording_sid,
        callSid: detail.call_sid,
        fromNumber: detail.from_number,
        toNumber: detail.to_number,
        direction: detail.direction,
        startedAt: detail.started_at,
        endedAt: detail.ended_at,
        durationSeconds: detail.duration_seconds,
        dispatcherName: detail.dispatcher_name,
        transcript: detail.transcript,
        segments: detail.segments,
        hasAudio: detail.has_audio,
        exportedBy: exporterName(),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to build transcript PDF');
    } finally {
      setBusyId(null);
    }
  };

  const downloadAudio = async (row: DialConnectRecordingSummary) => {
    if (!row.has_audio) return;
    setBusyId(row.id);
    try {
      const blob = await apiFetchBlob(`/dial-connect-recordings/${row.id}/audio`);
      const ext = blob.type.includes('wav') ? 'wav' : blob.type.includes('webm') ? 'webm' : 'mp3';
      triggerDownload(blob, `dial-connect-${row.recording_sid}.${ext}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to download recording');
    } finally {
      setBusyId(null);
    }
  };

  const downloadTranscript = async (row: DialConnectRecordingSummary) => {
    if (!row.has_transcript) return;
    setBusyId(row.id);
    try {
      const detail = await apiFetch<DialConnectRecordingDetail>(`/dial-connect-recordings/${row.id}`);
      const blob = new Blob([detail.transcript || ''], { type: 'text/plain;charset=utf-8' });
      triggerDownload(blob, `dial-connect-${row.recording_sid}-transcript.txt`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to download transcription');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <aside
      data-testid="dialer-connect-recordings"
      className="w-full md:w-[380px] flex-shrink-0 flex flex-col min-h-0 border border-border-subtle bg-surface-raised"
      style={{ maxHeight: '100%' }}
    >
      <PanelTitleBar title="CALL RECORDINGS" icon={PhoneCall}>
        <IconButton
          aria-label="Refresh recordings"
          className="p-1 hover:bg-surface-sunken"
          onClick={() => void load()}
        >
          <RefreshCw className="w-3.5 h-3.5" />
        </IconButton>
      </PanelTitleBar>
      <form
        className="flex items-center gap-1 px-2 py-1.5 border-b border-border-subtle"
        onSubmit={(e) => { e.preventDefault(); void load(); }}
      >
        <Search className="w-3.5 h-3.5 text-rmpg-300 flex-shrink-0" />
        <input
          aria-label="Search recordings"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Number, call SID…"
          className="w-full bg-transparent text-[11px] text-rmpg-100 outline-none"
        />
      </form>
      {error && (
        <p className="px-2 py-1 text-[11px] text-[color:var(--sev-critical)]" role="alert">{error}</p>
      )}
      <div className="flex-1 overflow-y-auto min-h-0">
        {loading && rows.length === 0 && (
          <p className="px-3 py-4 text-[11px] text-rmpg-300">Loading recordings…</p>
        )}
        {!loading && rows.length === 0 && (
          <p className="px-3 py-4 text-[11px] text-rmpg-300">
            No Dial Connect recordings in Flex yet. Completed calls with a recording
            and transcription are stored here for download and print.
          </p>
        )}
        <ul className="divide-y divide-border-subtle">
          {rows.map((row) => (
            <li key={row.id} className="px-2 py-[6px]">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-[11px] font-semibold text-rmpg-100 truncate">
                    {row.from_number || 'Unknown'} → {row.to_number || '—'}
                  </p>
                  <p className="text-[10px] text-rmpg-300">
                    {fmtMt(row.started_at)} · {formatCallDuration(row.duration_seconds)}
                    {row.direction ? ` · ${row.direction}` : ''}
                  </p>
                </div>
                <div className="flex items-center gap-0.5 flex-shrink-0">
                  <IconButton
                    aria-label="Print transcript PDF"
                    className="p-1 hover:bg-surface-sunken disabled:opacity-40"
                    disabled={busyId === row.id}
                    onClick={() => void printPdf(row)}
                  >
                    <Printer className="w-3.5 h-3.5" />
                  </IconButton>
                  <IconButton
                    aria-label="Download transcription"
                    className="p-1 hover:bg-surface-sunken disabled:opacity-40"
                    disabled={!row.has_transcript || busyId === row.id}
                    onClick={() => void downloadTranscript(row)}
                  >
                    <FileText className="w-3.5 h-3.5" />
                  </IconButton>
                  <IconButton
                    aria-label="Download recording"
                    className="p-1 hover:bg-surface-sunken disabled:opacity-40"
                    disabled={!row.has_audio || busyId === row.id}
                    onClick={() => void downloadAudio(row)}
                  >
                    <Download className="w-3.5 h-3.5" />
                  </IconButton>
                </div>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </aside>
  );
}
