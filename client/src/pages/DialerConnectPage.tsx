import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import {
  Phone, PhoneCall, PhoneIncoming, PhoneOutgoing, PhoneMissed, Voicemail,
  History, Search, Star, Printer, Download, Play, Pause, RefreshCw,
  Plus, Trash2, Copy, Archive, CheckCheck, UserPlus, Link2, FileDown, MicOff, PhoneOff,
  Delete, PhoneForwarded, Users, Disc, Pause as PauseIcon, ExternalLink, ShieldCheck, CloudOff,
  ChevronUp, ChevronDown, Hash,
} from 'lucide-react';
import PanelTitleBar from '../components/PanelTitleBar';
import { apiFetch, apiFetchBlob, apiPostForm } from '../hooks/useApi';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../components/ToastProvider';
import { usePersistedTab } from '../hooks/usePersistedState';
import { openDialerWindow, postToDialer, normalizeDialTarget, DIALER_PLACE_CALL_EVENT, DIALER_CHROME_EVENT } from '../components/DialerPanel';
import { DIALER_HOST_ID } from '../components/dialerConnect';
import {
  DIALER_FUNCTIONS, VOICEMAIL_FUNCTIONS, CALL_HISTORY_FUNCTIONS,
  DISPOSITIONS, PRESENCE_STATUSES, displayPhone, formatDuration, audioFilename,
  counterpartyNumber, clusterCounterparties,
} from '../utils/dialerConnect';
import { downloadDialerCallRecordPdf, openDialerCallRecordPdf } from '../utils/dialerCallRecordPdf';
import type { DialerRecordForPdf } from '../utils/dialerCallRecordPdf';
import { toDisplayLabel } from '../utils/formatters';
import { safeDateTimeStr } from '../utils/dateUtils';
import { copyToClipboard } from '../utils/clipboard';

type TabId = 'dialer' | 'voicemail' | 'history';

interface DialerCall {
  id: number;
  call_sid?: string | null;
  direction: string;
  from_number?: string | null;
  to_number?: string | null;
  from_name?: string | null;
  to_name?: string | null;
  agent_name?: string | null;
  status: string;
  started_at?: string | null;
  ended_at?: string | null;
  duration_seconds?: number | null;
  disposition?: string | null;
  notes?: string | null;
  tags?: string | null;
  starred?: number;
  call_id?: number | null;
  transcript?: string | null;
  transcript_status?: string | null;
  recording_r2_key?: string | null;
  recording_source_url?: string | null;
  callback_at?: string | null;
}

interface VoicemailRow {
  id: number;
  call_sid?: string | null;
  from_number?: string | null;
  from_name?: string | null;
  to_number?: string | null;
  mailbox?: string | null;
  duration_seconds?: number | null;
  transcript?: string | null;
  transcript_status?: string | null;
  urgency: string;
  is_read: number;
  starred: number;
  archived: number;
  assigned_name?: string | null;
  notes?: string | null;
  received_at?: string | null;
  recording_r2_key?: string | null;
  recording_source_url?: string | null;
  call_id?: number | null;
}

interface SpeedDial { id: number; label: string; number: string }
interface Presence { user_id: number; status: string; message?: string | null; name?: string | null }
interface LookupHit { id: number; first_name?: string | null; last_name?: string | null; phone?: string | null }

function counterparty(c: DialerCall): string {
  return counterpartyNumber(c);
}

function callToPdf(c: DialerCall): DialerRecordForPdf {
  return { ...c, kind: 'call' };
}
function vmToPdf(v: VoicemailRow): DialerRecordForPdf {
  return { ...v, kind: 'voicemail', started_at: v.received_at };
}

function hasAudio(row: { recording_r2_key?: string | null; recording_source_url?: string | null }): boolean {
  return Boolean(row.recording_r2_key || row.recording_source_url);
}

async function downloadAudio(kind: 'call' | 'voicemail', id: number): Promise<void> {
  let blob: Blob;
  try {
    blob = await apiFetchBlob(`/dialer-connect/${kind === 'call' ? 'calls' : 'voicemails'}/${id}/audio`);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Failed to download audio.';
    console.error('downloadAudio failed:', err);
    throw new Error(msg);
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = audioFilename(kind, id);
  a.click();
  URL.revokeObjectURL(url);
}

async function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function parseTags(raw: string | null | undefined): string {
  if (!raw) return '';
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) return parsed.map(String).join(', ');
  } catch { /* stored as comma list */ }
  return raw;
}

export default function DialerConnectPage() {
  const { user } = useAuth();
  const { addToast } = useToast();
  const exportedBy = user?.full_name || user?.username || '';
  const [tab, setTab] = usePersistedTab<TabId>('rmpg_dialer_connect_tab', 'dialer', ['dialer', 'voicemail', 'history']);
  const [liveOpen, setLiveOpen] = useState(true);
  const [dockCollapsed, setDockCollapsed] = useState(false);
  const [vmUnread, setVmUnread] = useState(0);
  const dockVisible = liveOpen && !dockCollapsed;

  useEffect(() => {
    document.title = 'Dialer Connect — RMPG Flex';
  }, []);

  useEffect(() => {
    const onChrome = (event: Event) => {
      const detail = (event as CustomEvent<{ minimized?: boolean; poppedOut?: boolean }>).detail;
      setLiveOpen(!detail?.minimized && !detail?.poppedOut);
    };
    window.addEventListener(DIALER_CHROME_EVENT, onChrome);
    return () => window.removeEventListener(DIALER_CHROME_EVENT, onChrome);
  }, []);

  useEffect(() => {
    apiFetch<{ data: { unread?: number } }>('/dialer-connect/voicemails/summary')
      .then((r) => setVmUnread(Number(r.data?.unread || 0)))
      .catch(() => {});
  }, [tab]);

  return (
    <div className="h-full flex flex-col bg-surface-base">
      <PanelTitleBar title="DIAL CONNECT" icon={PhoneCall} statusLed="var(--sev-ok)">
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setDockCollapsed((v) => !v)}
            aria-label={dockVisible ? 'Hide live dialer' : 'Show live dialer'}
            aria-pressed={!dockCollapsed}
            title={liveOpen ? (dockVisible ? 'Hide the live Dial Connect dock' : 'Show the live Dial Connect dock') : 'Dial Connect is popped out or minimized'}
            className="px-2 py-1 text-[10px] font-semibold tracking-wide flex items-center gap-1 border border-border-subtle text-fg-secondary hover:text-rmpg-100 hover:border-rmpg-500 mr-1"
          >
            {dockVisible ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
            LIVE
          </button>
          {([
            ['dialer', 'Dialer', Phone, null as number | null],
            ['voicemail', 'Voicemail', Voicemail, vmUnread],
            ['history', 'Call History', History, null],
          ] as const).map(([id, label, Icon, badge]) => (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              aria-pressed={tab === id}
              className={`px-2.5 py-1 text-[10px] font-semibold tracking-wide flex items-center gap-1.5 border ${
                tab === id
                  ? 'bg-surface-overlay text-rmpg-50 border-accent-silver-500/60'
                  : 'text-fg-secondary border-transparent hover:text-rmpg-100 hover:border-border-subtle'
              }`}
            >
              <Icon className="w-3 h-3" /> {label}
              {badge ? (
                <span className="min-w-[1.1rem] px-1 text-[8px] font-mono font-bold" style={{ background: 'var(--sev-warn)', color: 'var(--text-on-warn)' }}>{badge}</span>
              ) : null}
            </button>
          ))}
        </div>
      </PanelTitleBar>
      <div
        id={DIALER_HOST_ID}
        data-testid="dialer-connect-host"
        className="relative w-full shrink-0 overflow-hidden transition-[height,min-height] duration-300 ease-out"
        style={dockVisible
          ? { height: 'min(42vh, 680px)', minHeight: 240 }
          : { height: 0, minHeight: 0 }}
      />
      <div className="flex-1 min-h-0 overflow-hidden">
        {tab === 'dialer' && <DialerTab exportedBy={exportedBy} addToast={addToast} />}
        {tab === 'voicemail' && <VoicemailTab exportedBy={exportedBy} addToast={addToast} />}
        {tab === 'history' && <HistoryTab exportedBy={exportedBy} addToast={addToast} />}
      </div>
    </div>
  );
}

function FunctionStrip({
  items,
  onPick,
}: {
  items: readonly { id: string; label: string }[];
  onPick?: (id: string) => void;
}) {
  return (
    <div className="px-3 py-1.5 border-b border-rmpg-800 flex flex-wrap gap-1 shrink-0">
      {items.map((f) => (
        <button
          key={f.id}
          type="button"
          onClick={() => onPick?.(f.id)}
          className="text-[8px] font-mono uppercase tracking-wide px-1.5 py-0.5 border border-border-subtle text-fg-secondary hover:text-rmpg-100 hover:border-rmpg-500"
        >
          {f.label}
        </button>
      ))}
    </div>
  );
}

function ErrorBar({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="border-b border-red-700/40 bg-red-900/20 text-red-400 text-[11px] px-3 py-1.5 flex items-center justify-between" role="alert">
      <span>{message}</span>
      <button type="button" className="text-[10px] uppercase border border-red-700/50 px-2 py-0.5" onClick={onRetry}>Retry</button>
    </div>
  );
}

type AddToast = (message: string, type: 'success' | 'error' | 'warning' | 'info') => void;

/** Gold section header — the ONLY place gold appears (routed via --panel-header-color). */
function SectionHeader({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <div className="text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--panel-header-color)' }}>{children}</div>
      {right}
    </div>
  );
}

function Card({ id, children, className = '' }: { id?: string; children: ReactNode; className?: string }) {
  return (
    <section id={id} className={`bg-surface-raised border border-border-subtle p-3 space-y-2 ${className}`}>
      {children}
    </section>
  );
}

const FIELD = 'w-full bg-surface-sunken border border-border-subtle px-2 py-1 text-[11px] text-rmpg-100 placeholder-fg-muted focus:outline-none focus:border-accent-silver-500/70';
const BTN = 'text-[9px] font-semibold uppercase tracking-wide border border-border-subtle py-1.5 px-2 text-rmpg-200 hover:text-rmpg-50 hover:bg-surface-hover hover:border-rmpg-500 flex items-center justify-center gap-1 disabled:opacity-40 disabled:cursor-not-allowed';

type Sev = 'ok' | 'critical' | 'warn';
function sevStyle(sev: Sev, active = true) {
  if (!active) return undefined;
  return {
    color: `var(--sev-${sev})`,
    background: `rgb(var(--sev-${sev}-rgb) / 0.16)`,
    borderColor: `rgb(var(--sev-${sev}-rgb) / 0.45)`,
  };
}

/** Whether a recording has been COPIED into RMPG Flex (encrypted R2) or is still only a remote link. */
function ArchiveChip({ row }: { row: { recording_r2_key?: string | null; recording_source_url?: string | null } }) {
  if (row.recording_r2_key) {
    return (
      <span className="inline-flex items-center gap-0.5 text-[8px] font-bold uppercase tracking-wide text-accent-silver-400" title="Recording copied into RMPG Flex encrypted storage">
        <ShieldCheck className="w-2.5 h-2.5" /> Archived
      </span>
    );
  }
  if (row.recording_source_url) {
    return (
      <span className="inline-flex items-center gap-0.5 text-[8px] font-bold uppercase tracking-wide text-fg-muted" title="Recording still only on dialer.rmpgutah.us — copy to RMPG Flex is pending">
        <CloudOff className="w-2.5 h-2.5" /> Copy pending
      </span>
    );
  }
  return null;
}

const KEYPAD: ReadonlyArray<{ d: string; sub: string }> = [
  { d: '1', sub: '' }, { d: '2', sub: 'ABC' }, { d: '3', sub: 'DEF' },
  { d: '4', sub: 'GHI' }, { d: '5', sub: 'JKL' }, { d: '6', sub: 'MNO' },
  { d: '7', sub: 'PQRS' }, { d: '8', sub: 'TUV' }, { d: '9', sub: 'WXYZ' },
  { d: '*', sub: '' }, { d: '0', sub: '+' }, { d: '#', sub: '' },
];

function DialerTab({ exportedBy, addToast }: { exportedBy: string; addToast: AddToast }) {
  const navigate = useNavigate();
  const [digits, setDigits] = useState('');
  const [presence, setPresence] = useState('available');
  const [presenceMsg, setPresenceMsg] = useState('');
  const [agents, setAgents] = useState<Presence[]>([]);
  const [speed, setSpeed] = useState<SpeedDial[]>([]);
  const [newLabel, setNewLabel] = useState('');
  const [newNum, setNewNum] = useState('');
  const [lookup, setLookup] = useState<LookupHit[] | null>(null);
  const [cfsId, setCfsId] = useState('');
  const [notes, setNotes] = useState('');
  const [disposition, setDisposition] = useState('completed');
  const [callbackAt, setCallbackAt] = useState('');
  const [dtmfMode, setDtmfMode] = useState(false);
  const [dtmfLog, setDtmfLog] = useState('');
  const [muted, setMuted] = useState(false);
  const [held, setHeld] = useState(false);
  const [recording, setRecording] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setLoadError(null);
      const [sd, pr] = await Promise.all([
        apiFetch<{ data: SpeedDial[] }>('/dialer-connect/speed-dials'),
        apiFetch<{ data: Presence[] }>('/dialer-connect/presence'),
      ]);
      setSpeed(sd.data || []);
      setAgents(pr.data || []);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Failed to load Dial Connect');
    }
  }, []);
  useEffect(() => { load().catch(() => {}); }, [load]);

  const target = normalizeDialTarget(digits);

  const place = (raw: string) => {
    const to = normalizeDialTarget(raw);
    if (!to) { addToast('Enter a valid number', 'error'); return; }
    window.dispatchEvent(new CustomEvent(DIALER_PLACE_CALL_EVENT, { detail: { to } }));
    addToast(`Dialing ${displayPhone(to)}`, 'success');
  };

  const send = (payload: Record<string, unknown>) => postToDialer({ source: 'rmpg-flex', ...payload });

  const pressKey = (d: string) => {
    if (dtmfMode) {
      send({ type: 'dtmf', digit: d });
      setDtmfLog((p) => p + d);
    } else {
      setDigits((p) => p + d);
    }
  };

  const lookupNumber = async (raw: string) => {
    const to = normalizeDialTarget(raw);
    if (!to) { addToast('Enter a number to look up', 'warning'); return; }
    const res = await apiFetch<{ data: LookupHit[] }>(`/dialer-connect/lookup?number=${encodeURIComponent(to)}`);
    setLookup(res.data || []);
  };

  const saveSpeed = async () => {
    if (!newLabel.trim() || !normalizeDialTarget(newNum)) { addToast('Label and a valid number are required', 'warning'); return; }
    await apiFetch('/dialer-connect/speed-dials', {
      method: 'POST', body: JSON.stringify({ label: newLabel.trim(), number: normalizeDialTarget(newNum) }),
    });
    setNewLabel(''); setNewNum('');
    await load();
  };

  const logCall = async () => {
    try {
      const created = await apiFetch<{ data: DialerCall }>('/dialer-connect/calls', {
        method: 'POST',
        body: JSON.stringify({ direction: 'outbound', to: target, status: 'completed' }),
      });
      if (!created.data?.id) throw new Error('Call was not created');
      const patched = await apiFetch<{ data: DialerCall }>(`/dialer-connect/calls/${created.data.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          callback_at: callbackAt || undefined,
          notes, disposition,
          call_id: cfsId ? Number(cfsId) : undefined,
        }),
      });
      addToast('Call logged', 'success');
      openDialerCallRecordPdf({ record: callToPdf(patched.data || created.data), exportedBy });
    } catch (e) {
      addToast(e instanceof Error ? e.message : 'Failed to log call', 'error');
    }
  };

  const jump = (id: string) => {
    const map: Record<string, string> = {
      keypad: 'dc-keypad', dtmf: 'dc-keypad', hold: 'dc-keypad', transfer: 'dc-keypad',
      conference: 'dc-keypad', record: 'dc-keypad', hangup: 'dc-keypad',
      speed_dial: 'dc-speed', lookup: 'dc-speed',
      link_cfs: 'dc-notes', disposition: 'dc-notes', callback: 'dc-notes',
      presence: 'dc-presence',
    };
    document.getElementById(map[id] || 'dc-keypad')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const presenceDot = (status: string) =>
    status === 'available' ? 'var(--sev-ok)' : status === 'dnd' || status === 'offline' ? 'var(--sev-critical)' : 'var(--sev-warn)';

  return (
    <div className="h-full overflow-y-auto scrollbar-dark">
      <FunctionStrip items={DIALER_FUNCTIONS} onPick={jump} />
      {loadError && <ErrorBar message={loadError} onRetry={() => { void load(); }} />}
      <div className="p-3 grid grid-cols-1 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)_minmax(0,1fr)] gap-3 items-start">

        {/* ---------------- SOFTPHONE ---------------- */}
        <Card id="dc-keypad">
          <SectionHeader
            right={(
              <button
                type="button"
                onClick={() => setDtmfMode((v) => !v)}
                aria-pressed={dtmfMode}
                className={`${BTN} py-0.5`}
                style={sevStyle('warn', dtmfMode)}
                title="Toggle keypad between dialing a number and sending in-call DTMF tones"
              >
                <Hash className="w-3 h-3" /> {dtmfMode ? 'DTMF mode' : 'Dial mode'}
              </button>
            )}
          >Softphone</SectionHeader>

          <div className="bg-surface-sunken border border-border-subtle px-3 py-2">
            <div className="text-[9px] uppercase tracking-widest text-fg-muted flex items-center justify-between">
              <span>{dtmfMode ? 'Sending tones' : 'Number'}</span>
              {target && !dtmfMode && <span className="font-mono normal-case tracking-normal">{target}</span>}
            </div>
            <div className="flex items-center gap-2">
              <input
                value={digits}
                onChange={(e) => setDigits(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); place(digits); } }}
                placeholder="Enter number"
                inputMode="tel"
                className="flex-1 min-w-0 bg-transparent border-0 p-0 font-mono text-xl text-rmpg-50 placeholder-fg-muted focus:outline-none"
                aria-label="Dial number"
              />
              <button type="button" aria-label="Backspace" className="p-1 text-fg-secondary hover:text-rmpg-100 disabled:opacity-30" disabled={!digits} onClick={() => setDigits((p) => p.slice(0, -1))}>
                <Delete className="w-4 h-4" />
              </button>
              <button type="button" aria-label="Clear number" className="text-[9px] uppercase text-fg-muted hover:text-rmpg-100 disabled:opacity-30" disabled={!digits} onClick={() => setDigits('')}>
                Clear
              </button>
            </div>
            {digits && !dtmfMode && (
              <div className="text-[11px] font-mono text-fg-secondary">{displayPhone(target)}</div>
            )}
          </div>

          <div className="grid grid-cols-3 gap-1.5">
            {KEYPAD.map(({ d, sub }) => (
              <button
                key={d}
                type="button"
                aria-label={`Key ${d}`}
                className="h-11 bg-surface-base border border-border-subtle text-rmpg-50 hover:bg-surface-hover hover:border-rmpg-500 active:bg-surface-overlay flex flex-col items-center justify-center leading-none"
                onClick={() => pressKey(d)}
              >
                <span className="font-mono text-base">{d}</span>
                <span className="text-[7px] tracking-[0.2em] text-fg-muted h-2">{sub}</span>
              </button>
            ))}
          </div>

          <div className="grid grid-cols-2 gap-1.5">
            <button type="button" onClick={() => place(digits)} className={`${BTN} py-2 text-[10px] font-bold`} style={sevStyle('ok')}>
              <PhoneCall className="w-3.5 h-3.5" /> Call
            </button>
            <button type="button" onClick={() => { send({ type: 'hangup' }); setMuted(false); setHeld(false); setRecording(false); }} className={`${BTN} py-2 text-[10px] font-bold`} style={sevStyle('critical')}>
              <PhoneOff className="w-3.5 h-3.5" /> Hang up
            </button>
          </div>

          <div className="grid grid-cols-3 gap-1.5">
            <button type="button" aria-pressed={muted} onClick={() => { send({ type: muted ? 'unmute' : 'mute' }); setMuted((v) => !v); }} className={BTN} style={sevStyle('warn', muted)}>
              <MicOff className="w-3 h-3" /> {muted ? 'Unmute' : 'Mute'}
            </button>
            <button type="button" aria-pressed={held} onClick={() => { send({ type: held ? 'resume' : 'hold' }); setHeld((v) => !v); }} className={BTN} style={sevStyle('warn', held)}>
              <PauseIcon className="w-3 h-3" /> {held ? 'Resume' : 'Hold'}
            </button>
            <button type="button" aria-pressed={recording} onClick={() => { send({ type: 'recording', action: recording ? 'stop' : 'start' }); setRecording((v) => !v); }} className={BTN} style={sevStyle('critical', recording)}>
              <Disc className="w-3 h-3" /> {recording ? 'Stop rec' : 'Record'}
            </button>
            <button type="button" disabled={!target} onClick={() => send({ type: 'transfer', to: target })} className={BTN} title="Transfer the live call to the number entered above">
              <PhoneForwarded className="w-3 h-3" /> Transfer
            </button>
            <button type="button" disabled={!target} onClick={() => send({ type: 'conference', to: target })} className={BTN} title="Add the number entered above to the live call">
              <Users className="w-3 h-3" /> Conference
            </button>
            <button type="button" onClick={() => openDialerWindow()} className={BTN} title="Open Dial Connect in its own window">
              <ExternalLink className="w-3 h-3" /> Pop out
            </button>
          </div>

          <div className="flex items-center justify-between text-[10px] font-mono text-fg-muted pt-1 border-t border-border-subtle">
            <span>Tones sent: <span className="text-fg-secondary">{dtmfLog || '—'}</span></span>
            {dtmfLog && <button type="button" className="uppercase text-[9px] hover:text-rmpg-100" onClick={() => setDtmfLog('')}>Clear</button>}
          </div>
        </Card>

        {/* ---------------- DIRECTORY ---------------- */}
        <div className="space-y-3">
          <Card id="dc-speed">
            <SectionHeader right={<span className="text-[9px] font-mono text-fg-muted">{speed.length}</span>}>Speed dial</SectionHeader>
            <div className="divide-y divide-border-subtle max-h-56 overflow-y-auto scrollbar-dark -mx-1">
              {speed.map((s) => (
                <div key={s.id} className="flex items-center gap-1 px-1 py-1 group hover:bg-surface-hover">
                  <button type="button" className="flex-1 min-w-0 text-left" onClick={() => place(s.number)} title={`Call ${s.label}`}>
                    <div className="text-[11px] text-rmpg-100 truncate">{s.label}</div>
                    <div className="text-[10px] font-mono text-fg-secondary">{displayPhone(s.number)}</div>
                  </button>
                  <button type="button" aria-label={`Call ${s.label}`} className="p-1 text-fg-secondary hover:text-[color:var(--sev-ok)]" onClick={() => place(s.number)}><Phone className="w-3 h-3" /></button>
                  <button type="button" aria-label={`Copy ${s.label}`} className="p-1 text-fg-secondary hover:text-rmpg-100" onClick={() => copyToClipboard(s.number).then((ok) => addToast(ok ? 'Copied' : 'Copy failed', ok ? 'success' : 'error'))}><Copy className="w-3 h-3" /></button>
                  <button type="button" aria-label={`Delete ${s.label}`} className="p-1 text-fg-secondary hover:text-[color:var(--sev-critical)]" onClick={() => apiFetch(`/dialer-connect/speed-dials/${s.id}`, { method: 'DELETE' }).then(load).catch(() => addToast('Delete failed', 'error'))}><Trash2 className="w-3 h-3" /></button>
                </div>
              ))}
              {speed.length === 0 && <div className="text-[10px] text-fg-muted px-1 py-2">No saved numbers yet — add one below.</div>}
            </div>
            <div className="grid grid-cols-[1fr_1fr_auto] gap-1">
              <input value={newLabel} onChange={(e) => setNewLabel(e.target.value)} placeholder="Label" aria-label="Speed dial label" className={FIELD} />
              <input value={newNum} onChange={(e) => setNewNum(e.target.value)} placeholder="Number" aria-label="Speed dial number" inputMode="tel" className={FIELD} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); saveSpeed().catch((err) => addToast(String(err), 'error')); } }} />
              <button type="button" onClick={() => saveSpeed().catch((e) => addToast(String(e), 'error'))} className={BTN} aria-label="Add speed dial"><Plus className="w-3 h-3" /></button>
            </div>
          </Card>

          <Card>
            <SectionHeader>Caller lookup</SectionHeader>
            <div className="flex gap-1">
              <div className={`${FIELD} font-mono flex-1 truncate ${target ? '' : 'text-fg-muted'}`}>{target ? displayPhone(target) : 'Enter a number on the keypad'}</div>
              <button type="button" className={BTN} disabled={!target} onClick={() => lookupNumber(digits).catch((e) => addToast(e instanceof Error ? e.message : 'Lookup failed', 'error'))}>
                <Search className="w-3 h-3" /> RMS
              </button>
            </div>
            {lookup && lookup.length === 0 && <div className="text-[10px] text-fg-muted">No RMS person match for this number.</div>}
            {lookup && lookup.length > 0 && (
              <div className="divide-y divide-border-subtle -mx-1">
                {lookup.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    className="w-full text-left px-1 py-1 hover:bg-surface-hover"
                    onClick={() => navigate(`/records?tab=persons&personId=${p.id}`)}
                  >
                    <div className="text-[11px] text-rmpg-100">{p.first_name} {p.last_name}</div>
                    <div className="text-[10px] font-mono text-fg-secondary">{displayPhone(p.phone)} · open person record</div>
                  </button>
                ))}
              </div>
            )}
          </Card>
        </div>

        {/* ---------------- WRAP-UP + PRESENCE ---------------- */}
        <div className="space-y-3">
          <Card id="dc-notes">
            <SectionHeader>Call wrap-up</SectionHeader>
            <div className="grid grid-cols-2 gap-1.5">
              <label className="space-y-0.5">
                <span className="text-[9px] uppercase tracking-wide" style={{ color: 'var(--field-label-color)' }}>Link CFS</span>
                <input value={cfsId} onChange={(e) => setCfsId(e.target.value.replace(/\D/g, ''))} placeholder="CFS id" inputMode="numeric" className={FIELD} />
              </label>
              <label className="space-y-0.5">
                <span className="text-[9px] uppercase tracking-wide" style={{ color: 'var(--field-label-color)' }}>Disposition</span>
                <select value={disposition} onChange={(e) => setDisposition(e.target.value)} className={FIELD}>
                  {DISPOSITIONS.map((d) => <option key={d} value={d}>{toDisplayLabel(d)}</option>)}
                </select>
              </label>
            </div>
            <label className="block space-y-0.5">
              <span className="text-[9px] uppercase tracking-wide" style={{ color: 'var(--field-label-color)' }}>Callback</span>
              <input type="datetime-local" value={callbackAt} onChange={(e) => setCallbackAt(e.target.value)} className={FIELD} />
            </label>
            <label className="block space-y-0.5">
              <span className="text-[9px] uppercase tracking-wide" style={{ color: 'var(--field-label-color)' }}>Notes</span>
              <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} placeholder="Call notes" className={`${FIELD} resize-y`} />
            </label>
            <button type="button" className={`${BTN} w-full`} disabled={!target} title={target ? 'Archive this call in RMPG Flex and open the printable record' : 'Enter the number first'} onClick={() => { void logCall(); }}>
              <Printer className="w-3 h-3" /> Log + print form
            </button>
          </Card>

          <Card id="dc-presence">
            <SectionHeader right={<span className="text-[9px] font-mono text-fg-muted">{agents.length} on shift</span>}>Agent presence</SectionHeader>
            <div className="grid grid-cols-[auto_1fr_auto] gap-1.5">
              <select value={presence} onChange={(e) => setPresence(e.target.value)} aria-label="My presence" className={`${FIELD} w-auto`}>
                {PRESENCE_STATUSES.map((s) => <option key={s} value={s}>{toDisplayLabel(s)}</option>)}
              </select>
              <input value={presenceMsg} onChange={(e) => setPresenceMsg(e.target.value)} placeholder="Status message" className={FIELD} />
              <button
                type="button"
                className={BTN}
                onClick={() => apiFetch('/dialer-connect/presence', { method: 'PUT', body: JSON.stringify({ status: presence, message: presenceMsg }) }).then(() => { addToast('Presence updated', 'success'); return load(); }).catch(() => addToast('Failed to update presence', 'error'))}
              >Set</button>
            </div>
            <div className="divide-y divide-border-subtle -mx-1">
              {agents.map((a) => (
                <div key={a.user_id} className="flex items-start gap-2 px-1 py-1 text-[11px] text-rmpg-200">
                  <span className="mt-1 w-1.5 h-1.5 shrink-0" style={{ background: presenceDot(a.status) }} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate">{a.name || `User ${a.user_id}`} <span className="text-fg-muted">· {toDisplayLabel(a.status)}</span></div>
                    {a.message && <div className="text-[10px] text-fg-muted truncate">{a.message}</div>}
                  </div>
                </div>
              ))}
              {agents.length === 0 && <div className="text-[10px] text-fg-muted px-1 py-2">No agents have set presence.</div>}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}

function VoicemailTab({ exportedBy, addToast }: { exportedBy: string; addToast: AddToast }) {
  const navigate = useNavigate();
  const [rows, setRows] = useState<VoicemailRow[]>([]);
  const [q, setQ] = useState('');
  const [unread, setUnread] = useState(false);
  const [starred, setStarred] = useState(false);
  const [archived, setArchived] = useState(false);
  const [urgency, setUrgency] = useState('');
  const [playing, setPlaying] = useState<number | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [expanded, setExpanded] = useState<number | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setLoadError(null);
      const params = new URLSearchParams();
      if (q) params.set('q', q);
      if (unread) params.set('unread', '1');
      if (starred) params.set('starred', '1');
      if (archived) params.set('archived', '1');
      if (urgency) params.set('urgency', urgency);
      const res = await apiFetch<{ data: VoicemailRow[] }>(`/dialer-connect/voicemails?${params}`);
      setRows(res.data || []);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Failed to load voicemail');
    }
  }, [q, unread, starred, archived, urgency]);
  useEffect(() => { load().catch(() => {}); }, [load]);

  const patch = async (id: number, body: Record<string, unknown>) => {
    await apiFetch(`/dialer-connect/voicemails/${id}`, { method: 'PATCH', body: JSON.stringify(body) });
    await load();
  };

  const play = async (id: number) => {
    if (playing === id) {
      audioRef.current?.pause();
      setPlaying(null);
      return;
    }
    const blob = await apiFetchBlob(`/dialer-connect/voicemails/${id}/audio`);
    const url = URL.createObjectURL(blob);
    if (!audioRef.current) audioRef.current = new Audio();
    audioRef.current.src = url;
    await audioRef.current.play();
    setPlaying(id);
    await patch(id, { is_read: true });
  };

  return (
    <div className="h-full flex flex-col">
      <FunctionStrip items={VOICEMAIL_FUNCTIONS} />
      {loadError && <ErrorBar message={loadError} onRetry={() => { void load(); }} />}
      <div className="px-3 py-1.5 border-b border-rmpg-800 flex flex-wrap gap-1.5 items-center shrink-0">
        <Search className="w-3 h-3 text-fg-muted" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search transcript / number" aria-label="Search transcripts or numbers" className="bg-surface-sunken border border-border-subtle px-1.5 py-0.5 text-[11px] text-rmpg-100 w-48" />
        <label className="text-[10px] text-fg-secondary flex items-center gap-1"><input type="checkbox" checked={unread} onChange={(e) => setUnread(e.target.checked)} /> Unheard</label>
        <label className="text-[10px] text-fg-secondary flex items-center gap-1"><input type="checkbox" checked={starred} onChange={(e) => setStarred(e.target.checked)} /> Starred</label>
        <label className="text-[10px] text-fg-secondary flex items-center gap-1"><input type="checkbox" checked={archived} onChange={(e) => setArchived(e.target.checked)} /> Archive</label>
        <select value={urgency} onChange={(e) => setUrgency(e.target.value)} className="bg-surface-sunken border border-border-subtle text-[10px] text-rmpg-100 px-1 py-0.5">
          <option value="">Any urgency</option>
          <option value="normal">Normal</option>
          <option value="urgent">Urgent</option>
          <option value="emergency">Emergency</option>
        </select>
        <button
          type="button"
          className="text-[9px] uppercase border border-border-subtle px-1.5 py-0.5 text-fg-secondary"
          onClick={() => {
            apiFetchBlob(`/dialer-connect/voicemails/export.csv?archived=${archived ? '1' : '0'}`)
              .then((blob) => saveBlob(blob, 'dialer-voicemail.csv'))
              .catch((e) => addToast(e instanceof Error ? e.message : 'Export failed', 'error'));
          }}
        >CSV</button>
        <button type="button" onClick={() => load()} className="ml-auto text-fg-secondary" aria-label="Refresh voicemail"><RefreshCw className="w-3.5 h-3.5" /></button>
        <button
          type="button"
          className="text-[9px] uppercase border border-border-subtle px-1.5 py-0.5 text-fg-secondary flex items-center gap-1"
          onClick={() => {
            if (selected.size === 0) { addToast('Select voicemails first', 'warning'); return; }
            apiFetch('/dialer-connect/voicemails/bulk-heard', { method: 'POST', body: JSON.stringify({ ids: [...selected] }) })
              .then(() => { setSelected(new Set()); return load(); })
              .then(() => addToast('Marked heard', 'success'))
              .catch((e) => addToast(e instanceof Error ? e.message : 'Bulk update failed', 'error'));
          }}
        ><CheckCheck className="w-3 h-3" /> Bulk heard</button>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto scrollbar-dark p-2 space-y-1">
        {rows.length === 0 && !loadError && <div className="text-[11px] text-fg-muted text-center py-8">No voicemail in this filter.</div>}
        {rows.map((v) => (
          <div key={v.id} className="bg-surface-raised/40 border border-rmpg-800 px-2 py-1.5 space-y-1">
            <div className="flex items-center gap-1.5">
              <input type="checkbox" checked={selected.has(v.id)} onChange={(e) => {
                setSelected((prev) => {
                  const n = new Set(prev);
                  if (e.target.checked) n.add(v.id); else n.delete(v.id);
                  return n;
                });
              }} />
              <span className={`w-1.5 h-1.5 rounded-full ${v.is_read ? 'bg-rmpg-600' : ''}`} style={v.is_read ? undefined : { background: 'var(--sev-warn)' }} />
              <span className="text-[11px] font-mono text-rmpg-100">{displayPhone(v.from_number)}</span>
              <span className="text-[10px] text-fg-secondary truncate flex-1">{v.from_name || 'Unknown'}</span>
              <span className="text-[8px] font-bold uppercase" style={{ color: v.urgency === 'emergency' ? 'var(--sev-critical)' : v.urgency === 'urgent' ? 'var(--sev-warn)' : undefined }}>{v.urgency}</span>
              <ArchiveChip row={v} />
              <span className="text-[9px] font-mono text-fg-muted">{formatDuration(v.duration_seconds)}</span>
              <span className="text-[9px] font-mono text-fg-muted">{safeDateTimeStr(v.received_at)}</span>
            </div>
            {v.transcript && (
              <button type="button" className={`text-left text-[10px] text-fg-secondary pl-5 ${expanded === v.id ? '' : 'line-clamp-2'}`} onClick={() => setExpanded(expanded === v.id ? null : v.id)}>
                {v.transcript}
              </button>
            )}
            {v.notes && <div className="text-[10px] text-fg-muted pl-5">Note: {v.notes}</div>}
            <div className="flex flex-wrap gap-1 pl-5">
              <IconAction
                label="Play"
                onClick={() => {
                  if (!hasAudio(v)) { addToast('No recording for this voicemail', 'error'); return; }
                  play(v.id).catch((e) => addToast(String(e), 'error'));
                }}
              >
                {playing === v.id ? <Pause className="w-3 h-3" /> : <Play className={`w-3 h-3 ${hasAudio(v) ? '' : 'opacity-40'}`} />}
              </IconAction>
              <IconAction
                label="Download recording"
                onClick={() => {
                  if (!hasAudio(v)) { addToast('No recording for this voicemail', 'error'); return; }
                  downloadAudio('voicemail', v.id).catch((e) => addToast(String(e), 'error'));
                }}
              ><Download className="w-3 h-3" /></IconAction>
              <IconAction label="Print transcript PDF" onClick={() => openDialerCallRecordPdf({ record: vmToPdf(v), exportedBy })}><Printer className="w-3 h-3" /></IconAction>
              <IconAction label="Download PDF" onClick={() => downloadDialerCallRecordPdf({ record: vmToPdf(v), exportedBy })}><FileDown className="w-3 h-3" /></IconAction>
              <IconAction label="Copy transcript" onClick={() => copyToClipboard(v.transcript || '').then((ok) => addToast(ok ? 'Copied transcript' : 'Nothing to copy', ok ? 'success' : 'warning')).catch(() => addToast('Copy failed', 'error'))}><Copy className="w-3 h-3" /></IconAction>
              <IconAction label={v.starred ? 'Unstar' : 'Star'} onClick={() => patch(v.id, { starred: !v.starred }).catch((e) => addToast(e instanceof Error ? e.message : 'Update failed', 'error'))}><Star className={`w-3 h-3 ${v.starred ? 'text-brand-400' : ''}`} /></IconAction>
              <IconAction label="Mark heard" onClick={() => patch(v.id, { is_read: !v.is_read }).catch((e) => addToast(e instanceof Error ? e.message : 'Update failed', 'error'))}><CheckCheck className="w-3 h-3" /></IconAction>
              <IconAction label="Return call" onClick={() => { window.dispatchEvent(new CustomEvent(DIALER_PLACE_CALL_EVENT, { detail: { to: normalizeDialTarget(v.from_number || '') } })); addToast('Returning call', 'success'); }}><Phone className="w-3 h-3" /></IconAction>
              <IconAction label="Archive" onClick={() => patch(v.id, { archived: !v.archived }).catch((e) => addToast(e instanceof Error ? e.message : 'Update failed', 'error'))}><Archive className="w-3 h-3" /></IconAction>
              <IconAction label="Assign to me" onClick={() => patch(v.id, { assigned_name: exportedBy }).catch((e) => addToast(e instanceof Error ? e.message : 'Update failed', 'error'))}><UserPlus className="w-3 h-3" /></IconAction>
              {v.call_id ? (
                <IconAction label="Open CFS" onClick={() => navigate(`/dispatch?call_id=${v.call_id}`)}><Link2 className="w-3 h-3" /></IconAction>
              ) : null}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function HistoryTab({ exportedBy, addToast }: { exportedBy: string; addToast: AddToast }) {
  const navigate = useNavigate();
  const [rows, setRows] = useState<DialerCall[]>([]);
  const [q, setQ] = useState('');
  const [direction, setDirection] = useState('all');
  const [missed, setMissed] = useState(false);
  const [starredOnly, setStarredOnly] = useState(false);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [summary, setSummary] = useState<{ total?: number; inbound?: number; outbound?: number; missed?: number; recorded?: number; avg_duration?: number | null } | null>(null);
  const [playing, setPlaying] = useState<number | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [uploadId, setUploadId] = useState<number | null>(null);
  const [expanded, setExpanded] = useState<number | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState<Record<number, string>>({});
  const [tagDraft, setTagDraft] = useState<Record<number, string>>({});

  const listParams = useCallback(() => {
    const params = new URLSearchParams();
    if (q) params.set('q', q);
    if (direction !== 'all') params.set('direction', direction);
    if (missed) params.set('missed', '1');
    if (starredOnly) params.set('starred', '1');
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    return params;
  }, [q, direction, missed, starredOnly, from, to]);

  const load = useCallback(async () => {
    try {
      setLoadError(null);
      const params = listParams();
      const sumParams = new URLSearchParams();
      if (from) sumParams.set('from', from);
      if (to) sumParams.set('to', to);
      const [list, sum] = await Promise.all([
        apiFetch<{ data: DialerCall[] }>(`/dialer-connect/calls?${params}`),
        apiFetch<{ data: typeof summary }>(`/dialer-connect/calls/summary?${sumParams}`),
      ]);
      setRows(list.data || []);
      setSummary(sum.data);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Failed to load call history');
    }
  }, [listParams, from, to]);
  useEffect(() => { load().catch(() => {}); }, [load]);

  const play = async (id: number) => {
    if (playing === id) { audioRef.current?.pause(); setPlaying(null); return; }
    const blob = await apiFetchBlob(`/dialer-connect/calls/${id}/audio`);
    const url = URL.createObjectURL(blob);
    if (!audioRef.current) audioRef.current = new Audio();
    audioRef.current.src = url;
    await audioRef.current.play();
    setPlaying(id);
  };

  const exportCsv = async () => {
    const blob = await apiFetchBlob(`/dialer-connect/calls/export.csv?${listParams()}`);
    saveBlob(blob, 'dialer-call-history.csv');
  };

  const clusters = useMemo(() => clusterCounterparties(rows), [rows]);

  return (
    <div className="h-full flex flex-col">
      <FunctionStrip items={CALL_HISTORY_FUNCTIONS} />
      {loadError && <ErrorBar message={loadError} onRetry={() => { void load(); }} />}
      <div className="px-3 py-1.5 border-b border-rmpg-800 flex flex-wrap gap-1.5 items-center shrink-0">
        <Search className="w-3 h-3 text-fg-muted" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Number, name, transcript" className="bg-surface-sunken border border-border-subtle px-1.5 py-0.5 text-[11px] text-rmpg-100 w-48" />
        <select value={direction} onChange={(e) => setDirection(e.target.value)} className="bg-surface-sunken border border-border-subtle text-[10px] text-rmpg-100 px-1 py-0.5">
          <option value="all">All directions</option>
          <option value="inbound">Inbound</option>
          <option value="outbound">Outbound</option>
          <option value="internal">Internal</option>
        </select>
        <label className="text-[10px] text-fg-secondary flex items-center gap-1"><input type="checkbox" checked={missed} onChange={(e) => setMissed(e.target.checked)} /> Missed</label>
        <label className="text-[10px] text-fg-secondary flex items-center gap-1"><input type="checkbox" checked={starredOnly} onChange={(e) => setStarredOnly(e.target.checked)} /> Starred</label>
        <input type="date" aria-label="From date" value={from} onChange={(e) => setFrom(e.target.value)} className="bg-surface-sunken border border-border-subtle text-[10px] text-rmpg-100 px-1 py-0.5" />
        <input type="date" aria-label="To date" value={to} onChange={(e) => setTo(e.target.value)} className="bg-surface-sunken border border-border-subtle text-[10px] text-rmpg-100 px-1 py-0.5" />
        <button type="button" onClick={() => exportCsv().catch((e) => addToast(String(e), 'error'))} className="text-[9px] uppercase border border-border-subtle px-1.5 py-0.5 text-fg-secondary">CSV</button>
        <button type="button" onClick={() => { void load(); }} className="ml-auto text-fg-secondary" aria-label="Refresh history"><RefreshCw className="w-3.5 h-3.5" /></button>
      </div>
      {summary && (
        <div className="px-3 py-1 border-b border-rmpg-800 flex gap-3 text-[9px] font-mono text-fg-secondary shrink-0">
          <span>{summary.total ?? 0} calls</span>
          <span>in {summary.inbound ?? 0}</span>
          <span>out {summary.outbound ?? 0}</span>
          <span>missed {summary.missed ?? 0}</span>
          <span>recorded {summary.recorded ?? 0}</span>
          <span>avg {formatDuration(summary.avg_duration)}</span>
          {clusters[0] && (
            <button type="button" className="ml-auto hover:text-rmpg-200" onClick={() => setQ(clusters[0][0])}>
              dup {displayPhone(clusters[0][0])} ×{clusters[0][1]}
            </button>
          )}
        </div>
      )}
      <input
        ref={fileRef}
        type="file"
        accept="audio/*"
        className="hidden"
        onChange={async (e) => {
          const file = e.target.files?.[0];
          if (!file || uploadId == null) return;
          try {
            const fd = new FormData();
            fd.append('audio', file);
            await apiPostForm(`/dialer-connect/calls/${uploadId}/recording`, fd);
            addToast('Recording attached', 'success');
            setUploadId(null);
            e.target.value = '';
            await load();
          } catch (err) {
            addToast(err instanceof Error ? err.message : 'Upload failed', 'error');
          }
        }}
      />
      <div className="flex-1 min-h-0 overflow-y-auto scrollbar-dark p-2 space-y-1">
        {rows.length === 0 && !loadError && <div className="text-[11px] text-fg-muted text-center py-8">No Dial Connect calls in this filter.</div>}
        {rows.map((c) => (
          <div key={c.id} className="bg-surface-raised/40 border border-rmpg-800 px-2 py-1.5">
            <div className="flex items-center gap-1.5">
              {c.direction === 'inbound' ? <PhoneIncoming className="w-3 h-3 text-fg-secondary" /> : c.direction === 'outbound' ? <PhoneOutgoing className="w-3 h-3 text-fg-secondary" /> : <PhoneMissed className="w-3 h-3 text-fg-secondary" />}
              <span className="text-[11px] font-mono text-rmpg-100">{displayPhone(counterparty(c))}</span>
              <span className="text-[10px] text-fg-secondary truncate flex-1">{c.from_name || c.to_name || c.agent_name || ''}</span>
              <span className="text-[8px] font-bold uppercase" style={{ color: ['missed', 'failed', 'busy'].includes(c.status) ? 'var(--sev-warn)' : undefined }}>{c.status}</span>
              <ArchiveChip row={c} />
              <span className="text-[9px] font-mono text-fg-muted">{formatDuration(c.duration_seconds)}</span>
              <span className="text-[9px] font-mono text-fg-muted">{safeDateTimeStr(c.started_at)}</span>
            </div>
            {c.transcript && (
              <button type="button" className={`text-left text-[10px] text-fg-secondary pl-5 mt-0.5 ${expanded === c.id ? '' : 'line-clamp-2'}`} onClick={() => setExpanded(expanded === c.id ? null : c.id)}>
                {c.transcript}
              </button>
            )}
            {expanded === c.id && (
              <div className="pl-5 mt-1 flex flex-wrap gap-1">
                <input
                  value={noteDraft[c.id] ?? c.notes ?? ''}
                  onChange={(e) => setNoteDraft((p) => ({ ...p, [c.id]: e.target.value }))}
                  placeholder="Notes"
                  className="flex-1 min-w-[12rem] bg-surface-sunken border border-border-subtle px-1.5 py-0.5 text-[10px] text-rmpg-100"
                />
                <input
                  value={tagDraft[c.id] ?? parseTags(c.tags)}
                  onChange={(e) => setTagDraft((p) => ({ ...p, [c.id]: e.target.value }))}
                  placeholder="Tags"
                  className="w-36 bg-surface-sunken border border-border-subtle px-1.5 py-0.5 text-[10px] text-rmpg-100"
                />
                <button
                  type="button"
                  className="text-[9px] uppercase border border-border-subtle px-1.5 text-fg-secondary"
                  onClick={() => apiFetch(`/dialer-connect/calls/${c.id}`, {
                    method: 'PATCH',
                    body: JSON.stringify({
                      notes: noteDraft[c.id] ?? c.notes,
                      tags: tagDraft[c.id] ?? parseTags(c.tags),
                    }),
                  }).then(() => { addToast('Saved notes', 'success'); return load(); }).catch((e) => addToast(e instanceof Error ? e.message : 'Save failed', 'error'))}
                >Save</button>
              </div>
            )}
            <div className="flex flex-wrap gap-1 pl-5 mt-1">
              <IconAction
                label="Play recording"
                onClick={() => {
                  if (!hasAudio(c)) { addToast('No recording for this call', 'error'); return; }
                  play(c.id).catch((e) => addToast(String(e), 'error'));
                }}
              >
                {playing === c.id ? <Pause className="w-3 h-3" /> : <Play className={`w-3 h-3 ${hasAudio(c) ? '' : 'opacity-40'}`} />}
              </IconAction>
              <IconAction
                label="Download recording"
                onClick={() => {
                  if (!hasAudio(c)) { addToast('No recording for this call', 'error'); return; }
                  downloadAudio('call', c.id).catch((e) => addToast(String(e), 'error'));
                }}
              ><Download className="w-3 h-3" /></IconAction>
              <IconAction label="Print transcript PDF" onClick={() => openDialerCallRecordPdf({ record: callToPdf(c), exportedBy })}><Printer className="w-3 h-3" /></IconAction>
              <IconAction label="Download PDF" onClick={() => downloadDialerCallRecordPdf({ record: callToPdf(c), exportedBy })}><FileDown className="w-3 h-3" /></IconAction>
              <IconAction label="Copy transcript" onClick={() => copyToClipboard(c.transcript || counterparty(c)).then((ok) => addToast(ok ? 'Copied' : 'Copy failed', ok ? 'success' : 'error')).catch(() => addToast('Copy failed', 'error'))}><Copy className="w-3 h-3" /></IconAction>
              <IconAction label="Redial" onClick={() => window.dispatchEvent(new CustomEvent(DIALER_PLACE_CALL_EVENT, { detail: { to: normalizeDialTarget(counterparty(c)) } }))}><PhoneCall className="w-3 h-3" /></IconAction>
              <IconAction label="Star" onClick={() => apiFetch(`/dialer-connect/calls/${c.id}`, { method: 'PATCH', body: JSON.stringify({ starred: !c.starred }) }).then(load).catch(() => addToast('Failed to update star', 'error'))}><Star className={`w-3 h-3 ${c.starred ? 'text-brand-400' : ''}`} /></IconAction>
              <IconAction label="Attach recording" onClick={() => { setUploadId(c.id); fileRef.current?.click(); }}><Link2 className="w-3 h-3" /></IconAction>
              {c.call_id ? (
                <IconAction label="Open CFS" onClick={() => navigate(`/dispatch?call_id=${c.call_id}`)}><PhoneIncoming className="w-3 h-3" /></IconAction>
              ) : null}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function IconAction({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" title={label} aria-label={label} onClick={onClick} className="p-0.5 text-fg-secondary hover:text-rmpg-100">
      {children}
    </button>
  );
}
