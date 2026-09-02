import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import {
  Phone, PhoneCall, PhoneIncoming, PhoneOutgoing, PhoneMissed, Voicemail,
  History, Search, Star, Printer, Download, Play, Pause, RefreshCw,
  Plus, Trash2, Copy, Archive, CheckCheck, UserPlus, Link2, FileDown, MicOff, PhoneOff,
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
  return c.direction === 'outbound' ? (c.to_number || '') : (c.from_number || '');
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

async function downloadAudio(kind: 'call' | 'voicemail', id: number) {
  const blob = await apiFetchBlob(`/dialer-connect/${kind === 'call' ? 'calls' : 'voicemails'}/${id}/audio`);
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
  const [vmUnread, setVmUnread] = useState(0);

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
          {([
            ['dialer', 'Dialer', Phone, null as number | null],
            ['voicemail', 'Voicemail', Voicemail, vmUnread],
            ['history', 'Call History', History, null],
          ] as const).map(([id, label, Icon, badge]) => (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              className="px-2.5 py-1 text-[10px] font-semibold tracking-wide flex items-center gap-1.5 rounded-full"
              style={{
                color: tab === id ? 'var(--text-primary)' : 'var(--text-secondary)',
                background: tab === id ? 'color-mix(in srgb, var(--surface-overlay) 80%, transparent)' : 'transparent',
                boxShadow: tab === id ? 'inset 0 0 0 1px color-mix(in srgb, var(--accent-silver-500) 45%, transparent)' : undefined,
              }}
            >
              <Icon className="w-3 h-3" /> {label}
              {badge ? (
                <span className="min-w-[1.1rem] px-1 text-[8px] font-mono rounded-full" style={{ background: 'var(--sev-warn)', color: '#111' }}>{badge}</span>
              ) : null}
            </button>
          ))}
        </div>
      </PanelTitleBar>
      <div
        id={DIALER_HOST_ID}
        data-testid="dialer-connect-host"
        className="relative w-full shrink-0 overflow-hidden transition-[height,min-height] duration-300 ease-out"
        style={liveOpen
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
          className="text-[8px] font-mono uppercase tracking-wide px-1.5 py-0.5 border border-border-subtle text-rmpg-400 hover:text-rmpg-100 hover:border-rmpg-500"
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

function DialerTab({ exportedBy, addToast }: { exportedBy: string; addToast: AddToast }) {
  const navigate = useNavigate();
  const [digits, setDigits] = useState('');
  const [presence, setPresence] = useState('available');
  const [presenceMsg, setPresenceMsg] = useState('');
  const [agents, setAgents] = useState<Presence[]>([]);
  const [speed, setSpeed] = useState<SpeedDial[]>([]);
  const [newLabel, setNewLabel] = useState('');
  const [newNum, setNewNum] = useState('');
  const [lookup, setLookup] = useState<LookupHit[]>([]);
  const [cfsId, setCfsId] = useState('');
  const [notes, setNotes] = useState('');
  const [disposition, setDisposition] = useState('completed');
  const [callbackAt, setCallbackAt] = useState('');
  const [dtmfLog, setDtmfLog] = useState('');
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

  const place = (raw: string) => {
    const to = normalizeDialTarget(raw);
    if (!to) { addToast('Enter a valid number', 'error'); return; }
    window.dispatchEvent(new CustomEvent(DIALER_PLACE_CALL_EVENT, { detail: { to } }));
    addToast(`Dialing ${displayPhone(to)}`, 'success');
  };

  const lookupNumber = async (raw: string) => {
    const to = normalizeDialTarget(raw);
    if (!to) return;
    const res = await apiFetch<{ data: LookupHit[] }>(`/dialer-connect/lookup?number=${encodeURIComponent(to)}`);
    setLookup(res.data || []);
    if (!(res.data || []).length) addToast('No RMS person match', 'info');
  };

  const saveSpeed = async () => {
    await apiFetch('/dialer-connect/speed-dials', {
      method: 'POST', body: JSON.stringify({ label: newLabel, number: newNum }),
    });
    setNewLabel(''); setNewNum('');
    await load();
  };

  const pad = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '*', '0', '#'];

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

  return (
    <div className="h-full overflow-y-auto scrollbar-dark">
      <FunctionStrip items={DIALER_FUNCTIONS} onPick={jump} />
      {loadError && <ErrorBar message={loadError} onRetry={() => { void load(); }} />}
      <div className="p-3 grid grid-cols-1 lg:grid-cols-3 gap-3">
        <div id="dc-keypad" className="bg-surface-raised border border-border-subtle p-3 space-y-2">
          <div className="text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--panel-header-color)' }}>Keypad</div>
          <input
            value={digits}
            onChange={(e) => setDigits(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); place(digits); } }}
            className="w-full bg-surface-sunken border border-border-subtle px-2 py-1.5 font-mono text-rmpg-100 text-sm"
            aria-label="Dial number"
          />
          <div className="grid grid-cols-3 gap-1">
            {pad.map((d) => (
              <button
                key={d}
                type="button"
                className="py-2 bg-surface-base border border-border-subtle text-rmpg-100 font-mono text-sm hover:bg-surface-raised"
                onClick={() => setDigits((p) => p + d)}
              >{d}</button>
            ))}
          </div>
          <div className="flex gap-1">
            <button type="button" onClick={() => place(digits)} className="flex-1 py-1.5 text-[10px] font-bold uppercase border text-[color:var(--sev-ok)]" style={{ background: 'color-mix(in srgb, var(--sev-ok) 20%, transparent)', borderColor: 'color-mix(in srgb, var(--sev-ok) 40%, transparent)' }}>Call</button>
            <button type="button" onClick={() => setDigits((p) => p.slice(0, -1))} className="px-2 text-[10px] border border-border-subtle text-rmpg-400">⌫</button>
            <button type="button" onClick={() => openDialerWindow()} className="px-2 text-[10px] border border-border-subtle text-rmpg-300">Open</button>
          </div>
          <div className="grid grid-cols-2 gap-1">
            <button type="button" className="text-[9px] uppercase border border-border-subtle py-1 text-rmpg-300 flex items-center justify-center gap-1" onClick={() => postToDialer({ source: 'rmpg-flex', type: 'hangup' })}>
              <PhoneOff className="w-3 h-3" /> Hang up
            </button>
            <button type="button" className="text-[9px] uppercase border border-border-subtle py-1 text-rmpg-300 flex items-center justify-center gap-1" onClick={() => postToDialer({ source: 'rmpg-flex', type: 'mute' })}>
              <MicOff className="w-3 h-3" /> Mute
            </button>
          </div>
          <div className="text-[10px] font-bold uppercase tracking-widest pt-2" style={{ color: 'var(--panel-header-color)' }}>In-call DTMF</div>
          <div className="flex flex-wrap gap-1">
            {pad.map((d) => (
              <button
                key={`dtmf-${d}`}
                type="button"
                className="w-7 h-7 text-[10px] font-mono border border-border-subtle text-rmpg-200"
                onClick={() => {
                  postToDialer({ source: 'rmpg-flex', type: 'dtmf', digit: d });
                  setDtmfLog((p) => p + d);
                }}
              >{d}</button>
            ))}
          </div>
          <div className="text-[10px] font-mono text-rmpg-500">Sent: {dtmfLog || '—'}</div>
          <div className="grid grid-cols-2 gap-1 pt-1">
            <button type="button" className="text-[9px] uppercase border border-border-subtle py-1 text-rmpg-300" onClick={() => postToDialer({ source: 'rmpg-flex', type: 'hold' })}>Hold</button>
            <button type="button" className="text-[9px] uppercase border border-border-subtle py-1 text-rmpg-300" onClick={() => postToDialer({ source: 'rmpg-flex', type: 'resume' })}>Resume</button>
            <button type="button" className="text-[9px] uppercase border border-border-subtle py-1 text-rmpg-300" onClick={() => postToDialer({ source: 'rmpg-flex', type: 'transfer', to: normalizeDialTarget(digits) })}>Transfer</button>
            <button type="button" className="text-[9px] uppercase border border-border-subtle py-1 text-rmpg-300" onClick={() => postToDialer({ source: 'rmpg-flex', type: 'conference', to: normalizeDialTarget(digits) })}>Conference</button>
            <button type="button" className="text-[9px] uppercase border border-border-subtle py-1 text-rmpg-300" onClick={() => postToDialer({ source: 'rmpg-flex', type: 'recording', action: 'start' })}>Start rec</button>
            <button type="button" className="text-[9px] uppercase border border-border-subtle py-1 text-rmpg-300" onClick={() => postToDialer({ source: 'rmpg-flex', type: 'recording', action: 'stop' })}>Stop rec</button>
          </div>
        </div>

        <div id="dc-speed" className="bg-surface-raised border border-border-subtle p-3 space-y-2">
          <div className="text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--panel-header-color)' }}>Speed dial</div>
          <div className="space-y-1 max-h-40 overflow-y-auto">
            {speed.map((s) => (
              <div key={s.id} className="flex items-center gap-1 text-[11px]">
                <button type="button" className="flex-1 text-left text-rmpg-100 truncate" onClick={() => place(s.number)}>
                  {s.label} <span className="text-rmpg-500 font-mono">{displayPhone(s.number)}</span>
                </button>
                <button type="button" aria-label={`Copy ${s.label}`} onClick={() => copyToClipboard(s.number).then((ok) => addToast(ok ? 'Copied' : 'Copy failed', ok ? 'success' : 'error'))}>
                  <Copy className="w-3 h-3 text-rmpg-500" />
                </button>
                <button type="button" aria-label={`Delete ${s.label}`} onClick={() => apiFetch(`/dialer-connect/speed-dials/${s.id}`, { method: 'DELETE' }).then(load)}>
                  <Trash2 className="w-3 h-3 text-rmpg-500" />
                </button>
              </div>
            ))}
            {speed.length === 0 && <div className="text-[10px] text-rmpg-500">No saved numbers.</div>}
          </div>
          <div className="flex gap-1">
            <input value={newLabel} onChange={(e) => setNewLabel(e.target.value)} placeholder="Label" className="flex-1 bg-surface-sunken border border-border-subtle px-1.5 py-1 text-[11px] text-rmpg-100" />
            <input value={newNum} onChange={(e) => setNewNum(e.target.value)} placeholder="Number" className="flex-1 bg-surface-sunken border border-border-subtle px-1.5 py-1 text-[11px] text-rmpg-100" />
            <button type="button" onClick={() => saveSpeed().catch((e) => addToast(String(e), 'error'))} className="px-2 border border-border-subtle" aria-label="Add speed dial"><Plus className="w-3 h-3" /></button>
          </div>
          <div className="text-[10px] font-bold uppercase tracking-widest pt-2" style={{ color: 'var(--panel-header-color)' }}>Caller lookup</div>
          <button type="button" className="text-[10px] uppercase border border-border-subtle px-2 py-1 text-rmpg-300" onClick={() => lookupNumber(digits).catch(() => {})}>Lookup current number</button>
          {lookup.map((p) => (
            <button
              key={p.id}
              type="button"
              className="block text-left text-[11px] text-rmpg-200 hover:text-rmpg-50"
              onClick={() => navigate(`/records?tab=persons&personId=${p.id}`)}
            >
              {p.first_name} {p.last_name} <span className="font-mono text-rmpg-500">{displayPhone(p.phone)}</span>
            </button>
          ))}
          <div id="dc-notes" className="text-[10px] font-bold uppercase tracking-widest pt-2" style={{ color: 'var(--panel-header-color)' }}>Link CFS / notes</div>
          <input value={cfsId} onChange={(e) => setCfsId(e.target.value)} placeholder="CFS id" className="w-full bg-surface-sunken border border-border-subtle px-1.5 py-1 text-[11px] text-rmpg-100" />
          <select value={disposition} onChange={(e) => setDisposition(e.target.value)} className="w-full bg-surface-sunken border border-border-subtle px-1.5 py-1 text-[11px] text-rmpg-100">
            {DISPOSITIONS.map((d) => <option key={d} value={d}>{toDisplayLabel(d)}</option>)}
          </select>
          <input type="datetime-local" value={callbackAt} onChange={(e) => setCallbackAt(e.target.value)} className="w-full bg-surface-sunken border border-border-subtle px-1.5 py-1 text-[11px] text-rmpg-100" />
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} placeholder="Call notes" className="w-full bg-surface-sunken border border-border-subtle px-1.5 py-1 text-[11px] text-rmpg-100" />
          <button
            type="button"
            className="text-[10px] uppercase border border-border-subtle px-2 py-1 text-rmpg-300"
            onClick={async () => {
              const to = normalizeDialTarget(digits);
              const created = await apiFetch<{ data: DialerCall }>('/dialer-connect/calls', {
                method: 'POST',
                body: JSON.stringify({
                  direction: 'outbound', to: to, status: 'completed',
                }),
              });
              if (created.data?.id) {
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
              }
            }}
          >Log + print form</button>
        </div>

        <div id="dc-presence" className="bg-surface-raised border border-border-subtle p-3 space-y-2">
          <div className="text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--panel-header-color)' }}>Agent presence</div>
          <select value={presence} onChange={(e) => setPresence(e.target.value)} className="w-full bg-surface-sunken border border-border-subtle px-1.5 py-1 text-[11px] text-rmpg-100">
            {PRESENCE_STATUSES.map((s) => <option key={s} value={s}>{toDisplayLabel(s)}</option>)}
          </select>
          <input value={presenceMsg} onChange={(e) => setPresenceMsg(e.target.value)} placeholder="Status message" className="w-full bg-surface-sunken border border-border-subtle px-1.5 py-1 text-[11px] text-rmpg-100" />
          <button
            type="button"
            className="text-[10px] uppercase border border-border-subtle px-2 py-1 text-rmpg-300"
            onClick={() => apiFetch('/dialer-connect/presence', { method: 'PUT', body: JSON.stringify({ status: presence, message: presenceMsg }) }).then(() => { addToast('Presence updated', 'success'); load(); })}
          >Set presence</button>
          <div className="space-y-1 pt-2">
            {agents.map((a) => (
              <div key={a.user_id} className="flex items-center gap-2 text-[11px] text-rmpg-200">
                <span className="w-1.5 h-1.5 rounded-full" style={{ background: a.status === 'available' ? 'var(--sev-ok)' : a.status === 'dnd' ? 'var(--sev-critical)' : 'var(--sev-warn)' }} />
                <span className="truncate">{a.name || `User ${a.user_id}`} · {toDisplayLabel(a.status)}</span>
              </div>
            ))}
            {agents.map((a) => a.message ? (
              <div key={`${a.user_id}-msg`} className="pl-3.5 text-[10px] text-rmpg-500">{a.message}</div>
            ) : null)}
          </div>
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
        <Search className="w-3 h-3 text-rmpg-500" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search transcript / number" aria-label="Search transcripts or numbers" className="bg-surface-sunken border border-border-subtle px-1.5 py-0.5 text-[11px] text-rmpg-100 w-48" />
        <label className="text-[10px] text-rmpg-400 flex items-center gap-1"><input type="checkbox" checked={unread} onChange={(e) => setUnread(e.target.checked)} /> Unheard</label>
        <label className="text-[10px] text-rmpg-400 flex items-center gap-1"><input type="checkbox" checked={starred} onChange={(e) => setStarred(e.target.checked)} /> Starred</label>
        <label className="text-[10px] text-rmpg-400 flex items-center gap-1"><input type="checkbox" checked={archived} onChange={(e) => setArchived(e.target.checked)} /> Archive</label>
        <select value={urgency} onChange={(e) => setUrgency(e.target.value)} className="bg-surface-sunken border border-border-subtle text-[10px] text-rmpg-100 px-1 py-0.5">
          <option value="">Any urgency</option>
          <option value="normal">Normal</option>
          <option value="urgent">Urgent</option>
          <option value="emergency">Emergency</option>
        </select>
        <button
          type="button"
          className="text-[9px] uppercase border border-border-subtle px-1.5 py-0.5 text-rmpg-300"
          onClick={async () => {
            const blob = await apiFetchBlob(`/dialer-connect/voicemails/export.csv?archived=${archived ? '1' : '0'}`);
            saveBlob(blob, 'dialer-voicemail.csv');
          }}
        >CSV</button>
        <button type="button" onClick={() => load()} className="ml-auto text-rmpg-400" aria-label="Refresh voicemail"><RefreshCw className="w-3.5 h-3.5" /></button>
        <button
          type="button"
          className="text-[9px] uppercase border border-border-subtle px-1.5 py-0.5 text-rmpg-300 flex items-center gap-1"
          onClick={async () => {
            if (selected.size === 0) { addToast('Select voicemails first', 'warning'); return; }
            await apiFetch('/dialer-connect/voicemails/bulk-heard', { method: 'POST', body: JSON.stringify({ ids: [...selected] }) });
            setSelected(new Set());
            await load();
            addToast('Marked heard', 'success');
          }}
        ><CheckCheck className="w-3 h-3" /> Bulk heard</button>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto scrollbar-dark p-2 space-y-1">
        {rows.length === 0 && !loadError && <div className="text-[11px] text-rmpg-500 text-center py-8">No voicemail in this filter.</div>}
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
              <span className="text-[10px] text-rmpg-400 truncate flex-1">{v.from_name || 'Unknown'}</span>
              <span className="text-[8px] font-bold uppercase text-rmpg-400">{v.urgency}</span>
              <span className="text-[9px] font-mono text-rmpg-500">{formatDuration(v.duration_seconds)}</span>
              <span className="text-[9px] font-mono text-rmpg-600">{safeDateTimeStr(v.received_at)}</span>
            </div>
            {v.transcript && (
              <button type="button" className={`text-left text-[10px] text-rmpg-300 pl-5 ${expanded === v.id ? '' : 'line-clamp-2'}`} onClick={() => setExpanded(expanded === v.id ? null : v.id)}>
                {v.transcript}
              </button>
            )}
            {v.notes && <div className="text-[10px] text-rmpg-500 pl-5">Note: {v.notes}</div>}
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
              <IconAction label="Copy transcript" onClick={() => copyToClipboard(v.transcript || '').then((ok) => addToast(ok ? 'Copied transcript' : 'Nothing to copy', ok ? 'success' : 'warning'))}><Copy className="w-3 h-3" /></IconAction>
              <IconAction label={v.starred ? 'Unstar' : 'Star'} onClick={() => patch(v.id, { starred: !v.starred })}><Star className={`w-3 h-3 ${v.starred ? 'text-brand-400' : ''}`} /></IconAction>
              <IconAction label="Mark heard" onClick={() => patch(v.id, { is_read: !v.is_read })}><CheckCheck className="w-3 h-3" /></IconAction>
              <IconAction label="Return call" onClick={() => { window.dispatchEvent(new CustomEvent(DIALER_PLACE_CALL_EVENT, { detail: { to: normalizeDialTarget(v.from_number || '') } })); addToast('Returning call', 'success'); }}><Phone className="w-3 h-3" /></IconAction>
              <IconAction label="Archive" onClick={() => patch(v.id, { archived: !v.archived })}><Archive className="w-3 h-3" /></IconAction>
              <IconAction label="Assign to me" onClick={() => patch(v.id, { assigned_name: exportedBy })}><UserPlus className="w-3 h-3" /></IconAction>
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

  const clusters = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of rows) {
      const key = (r.direction === 'outbound' ? r.to_number : r.from_number) || 'unknown';
      map.set(key, (map.get(key) || 0) + 1);
    }
    return [...map.entries()].filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1]).slice(0, 5);
  }, [rows]);

  return (
    <div className="h-full flex flex-col">
      <FunctionStrip items={CALL_HISTORY_FUNCTIONS} />
      {loadError && <ErrorBar message={loadError} onRetry={() => { void load(); }} />}
      <div className="px-3 py-1.5 border-b border-rmpg-800 flex flex-wrap gap-1.5 items-center shrink-0">
        <Search className="w-3 h-3 text-rmpg-500" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Number, name, transcript" className="bg-surface-sunken border border-border-subtle px-1.5 py-0.5 text-[11px] text-rmpg-100 w-48" />
        <select value={direction} onChange={(e) => setDirection(e.target.value)} className="bg-surface-sunken border border-border-subtle text-[10px] text-rmpg-100 px-1 py-0.5">
          <option value="all">All directions</option>
          <option value="inbound">Inbound</option>
          <option value="outbound">Outbound</option>
          <option value="internal">Internal</option>
        </select>
        <label className="text-[10px] text-rmpg-400 flex items-center gap-1"><input type="checkbox" checked={missed} onChange={(e) => setMissed(e.target.checked)} /> Missed</label>
        <label className="text-[10px] text-rmpg-400 flex items-center gap-1"><input type="checkbox" checked={starredOnly} onChange={(e) => setStarredOnly(e.target.checked)} /> Starred</label>
        <input type="date" aria-label="From date" value={from} onChange={(e) => setFrom(e.target.value)} className="bg-surface-sunken border border-border-subtle text-[10px] text-rmpg-100 px-1 py-0.5" />
        <input type="date" aria-label="To date" value={to} onChange={(e) => setTo(e.target.value)} className="bg-surface-sunken border border-border-subtle text-[10px] text-rmpg-100 px-1 py-0.5" />
        <button type="button" onClick={() => exportCsv().catch((e) => addToast(String(e), 'error'))} className="text-[9px] uppercase border border-border-subtle px-1.5 py-0.5 text-rmpg-300">CSV</button>
        <button type="button" onClick={() => load()} className="ml-auto text-rmpg-400" aria-label="Refresh history"><RefreshCw className="w-3.5 h-3.5" /></button>
      </div>
      {summary && (
        <div className="px-3 py-1 border-b border-rmpg-800 flex gap-3 text-[9px] font-mono text-rmpg-400 shrink-0">
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
          const fd = new FormData();
          fd.append('audio', file);
          await apiPostForm(`/dialer-connect/calls/${uploadId}/recording`, fd);
          addToast('Recording attached', 'success');
          setUploadId(null);
          e.target.value = '';
          await load();
        }}
      />
      <div className="flex-1 min-h-0 overflow-y-auto scrollbar-dark p-2 space-y-1">
        {rows.length === 0 && !loadError && <div className="text-[11px] text-rmpg-500 text-center py-8">No Dial Connect calls in this filter.</div>}
        {rows.map((c) => (
          <div key={c.id} className="bg-surface-raised/40 border border-rmpg-800 px-2 py-1.5">
            <div className="flex items-center gap-1.5">
              {c.direction === 'inbound' ? <PhoneIncoming className="w-3 h-3 text-rmpg-400" /> : c.direction === 'outbound' ? <PhoneOutgoing className="w-3 h-3 text-rmpg-400" /> : <PhoneMissed className="w-3 h-3 text-rmpg-400" />}
              <span className="text-[11px] font-mono text-rmpg-100">{displayPhone(counterparty(c))}</span>
              <span className="text-[10px] text-rmpg-400 truncate flex-1">{c.from_name || c.to_name || c.agent_name || ''}</span>
              <span className="text-[8px] font-bold uppercase text-rmpg-400">{c.status}</span>
              <span className="text-[9px] font-mono text-rmpg-500">{formatDuration(c.duration_seconds)}</span>
              <span className="text-[9px] font-mono text-rmpg-600">{safeDateTimeStr(c.started_at)}</span>
            </div>
            {c.transcript && (
              <button type="button" className={`text-left text-[10px] text-rmpg-300 pl-5 mt-0.5 ${expanded === c.id ? '' : 'line-clamp-2'}`} onClick={() => setExpanded(expanded === c.id ? null : c.id)}>
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
                  className="text-[9px] uppercase border border-border-subtle px-1.5 text-rmpg-300"
                  onClick={() => apiFetch(`/dialer-connect/calls/${c.id}`, {
                    method: 'PATCH',
                    body: JSON.stringify({
                      notes: noteDraft[c.id] ?? c.notes,
                      tags: tagDraft[c.id] ?? parseTags(c.tags),
                    }),
                  }).then(() => { addToast('Saved notes', 'success'); load(); })}
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
              <IconAction label="Copy transcript" onClick={() => copyToClipboard(c.transcript || counterparty(c)).then((ok) => addToast(ok ? 'Copied' : 'Copy failed', ok ? 'success' : 'error'))}><Copy className="w-3 h-3" /></IconAction>
              <IconAction label="Redial" onClick={() => window.dispatchEvent(new CustomEvent(DIALER_PLACE_CALL_EVENT, { detail: { to: normalizeDialTarget(counterparty(c)) } }))}><PhoneCall className="w-3 h-3" /></IconAction>
              <IconAction label="Star" onClick={() => apiFetch(`/dialer-connect/calls/${c.id}`, { method: 'PATCH', body: JSON.stringify({ starred: !c.starred }) }).then(load)}><Star className={`w-3 h-3 ${c.starred ? 'text-brand-400' : ''}`} /></IconAction>
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
    <button type="button" title={label} aria-label={label} onClick={onClick} className="p-0.5 text-rmpg-400 hover:text-rmpg-100">
      {children}
    </button>
  );
}
