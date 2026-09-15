import { useEffect, useState, type ReactNode } from 'react';
import { Delete, Disc, ExternalLink, Hash, MicOff, Pause as PauseIcon, PhoneCall, PhoneForwarded, PhoneIncoming, PhoneOff, Users } from 'lucide-react';
import { useSoftphone } from './SoftphoneProvider';
import LinkDialerGate from './LinkDialerGate';
import TransferPicker from './TransferPicker';
import { openDialerWindow } from './dialerWindow';
import { normalizeDialTarget } from '../components/dialerConnect';
import { displayPhone } from '../utils/dialerConnect';

const KEYPAD: ReadonlyArray<{ d: string; sub: string }> = [
  { d: '1', sub: '' }, { d: '2', sub: 'ABC' }, { d: '3', sub: 'DEF' },
  { d: '4', sub: 'GHI' }, { d: '5', sub: 'JKL' }, { d: '6', sub: 'MNO' },
  { d: '7', sub: 'PQRS' }, { d: '8', sub: 'TUV' }, { d: '9', sub: 'WXYZ' },
  { d: '*', sub: '' }, { d: '0', sub: '+' }, { d: '#', sub: '' },
];
const BTN = 'text-[9px] font-semibold uppercase tracking-wide border border-border-subtle py-1.5 px-2 text-rmpg-200 hover:text-rmpg-50 hover:bg-surface-hover hover:border-rmpg-500 flex items-center justify-center gap-1 disabled:opacity-40 disabled:cursor-not-allowed';
type Sev = 'ok' | 'critical' | 'warn';
const sevStyle = (sev: Sev, active = true) =>
  active ? { color: `var(--sev-${sev})`, background: `rgb(var(--sev-${sev}-rgb) / 0.16)`, borderColor: `rgb(var(--sev-${sev}-rgb) / 0.45)` } : undefined;

function Header({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <div className="text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--panel-header-color)' }}>{children}</div>
      {right}
    </div>
  );
}

function useTimer(since: number | null): string {
  const [, tick] = useState(0);
  useEffect(() => {
    if (!since) return;
    const id = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [since]);
  if (!since) return '';
  const s = Math.floor((Date.now() - since) / 1000);
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

const STATUS_LABEL: Record<string, string> = {
  offline: 'Offline', unlinked: 'Not linked', passive: 'Active in another window', registering: 'Registering…',
  ready: 'Ready', incoming: 'Incoming call', in_call: 'In call', call_waiting: 'Call waiting', error: 'Error',
};

export default function SoftphoneCard({ digits, onDigitsChange, dtmfMode, onDtmfModeChange, onToneSent }: {
  digits: string;
  onDigitsChange(d: string): void;
  dtmfMode: boolean;
  onDtmfModeChange(v: boolean): void;
  onToneSent(d: string): void;
}) {
  const s = useSoftphone();
  const [picker, setPicker] = useState<'menu' | 'blind' | 'warm' | null>(null);
  const [blockCallerId, setBlockCallerId] = useState(false);
  const timer = useTimer(s.connectedAt);
  const target = normalizeDialTarget(digits);
  const live = s.status === 'in_call' || s.status === 'call_waiting';
  const ringing = s.status === 'incoming' || s.status === 'call_waiting';
  const canDial = s.status === 'ready' && Boolean(target);

  const pressKey = (d: string) => {
    if (dtmfMode && live) { s.sendDigits(d); onToneSent(d); return; }
    onDigitsChange(digits + d);
  };

  const statusColor = s.status === 'ready' || live ? 'var(--sev-ok)'
    : s.status === 'error' ? 'var(--sev-critical)'
    : ringing ? 'var(--sev-warn)' : 'var(--text-muted)';

  return (
    <section id="dc-keypad" className="bg-surface-raised border border-border-subtle p-3 space-y-2">
      <Header right={(
        <button
          type="button"
          onClick={() => onDtmfModeChange(!dtmfMode)}
          aria-pressed={dtmfMode}
          className={`${BTN} py-0.5`}
          style={sevStyle('warn', dtmfMode)}
          title="Toggle keypad between dialing a number and sending in-call DTMF tones"
        >
          <Hash className="w-3 h-3" /> {dtmfMode ? 'DTMF mode' : 'Dial mode'}
        </button>
      )}>Softphone</Header>

      <div className="flex items-center gap-2 text-[10px] font-mono">
        <span className={`inline-block w-2 h-2 rounded-full ${s.status === 'ready' || live ? 'animate-pulse' : ''}`} style={{ background: statusColor }} />
        <span className="text-rmpg-100">{STATUS_LABEL[s.status] ?? s.status}</span>
        {live && <span className="text-fg-secondary">{displayPhone(s.remoteNumber)} · {timer}</span>}
        {s.status === 'call_waiting' && <span style={{ color: 'var(--sev-warn)' }}>waiting: {displayPhone(s.waitingFrom)}</span>}
        {s.status === 'error' && <button type="button" className="ml-auto uppercase text-[9px] border border-border-subtle px-1.5" onClick={s.retry}>Retry</button>}
        {s.dnd !== null && s.status !== 'unlinked' && (
          <button
            type="button"
            aria-pressed={s.dnd}
            onClick={() => { void s.setDnd(!s.dnd); }}
            className={`${s.status === 'error' ? '' : 'ml-auto '}uppercase text-[9px] border px-1.5 py-0.5`}
            style={s.dnd ? sevStyle('warn') : { borderColor: 'var(--border-subtle)' }}
            title={s.dnd ? 'Do Not Disturb is ON — inbound calls skip you and go to voicemail. Click to go available.' : 'Click to enable Do Not Disturb (inbound calls will skip you)'}
          >
            {s.dnd ? 'DND on' : 'DND off'}
          </button>
        )}
      </div>
      {s.dnd && (
        <div className="text-[10px]" style={{ color: 'var(--sev-warn)' }} role="status">
          Do Not Disturb is on — inbound calls are routed to voicemail until you turn it off.
        </div>
      )}
      {s.error && <div className="text-[10px]" style={{ color: 'var(--sev-critical)' }} role="alert">{s.error}</div>}

      {s.status === 'unlinked' ? <LinkDialerGate /> : (
        <>
          <div className="bg-surface-sunken border border-border-subtle px-3 py-2">
            <div className="text-[9px] uppercase tracking-widest text-fg-muted flex items-center justify-between">
              <span>{dtmfMode ? 'Sending tones' : 'Number'}</span>
              {target && !dtmfMode && <span className="font-mono normal-case tracking-normal">{target}</span>}
            </div>
            <div className="flex items-center gap-2">
              <input
                value={digits}
                onChange={(e) => onDigitsChange(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && canDial) { e.preventDefault(); void s.dial(digits, { blockCallerId }); } }}
                placeholder="Enter number"
                inputMode="tel"
                aria-label="Dial number"
                className="flex-1 min-w-0 bg-transparent border-0 p-0 font-mono text-xl text-rmpg-50 placeholder-fg-muted focus:outline-none"
              />
              <button type="button" aria-label="Backspace" className="p-1 text-fg-secondary hover:text-rmpg-100 disabled:opacity-30" disabled={!digits} onClick={() => onDigitsChange(digits.slice(0, -1))}>
                <Delete className="w-4 h-4" />
              </button>
              <button type="button" aria-label="Clear number" className="text-[9px] uppercase text-fg-muted hover:text-rmpg-100 disabled:opacity-30" disabled={!digits} onClick={() => onDigitsChange('')}>
                Clear
              </button>
            </div>
            {digits && !dtmfMode && <div className="text-[11px] font-mono text-fg-secondary">{displayPhone(target)}</div>}
          </div>

          <div className="grid grid-cols-3 gap-1.5">
            {KEYPAD.map(({ d, sub }) => (
              <button
                key={d}
                type="button"
                aria-label={`Key ${d}`}
                onClick={() => pressKey(d)}
                className="h-11 bg-surface-base border border-border-subtle text-rmpg-50 hover:bg-surface-hover hover:border-rmpg-500 active:bg-surface-overlay flex flex-col items-center justify-center leading-none"
              >
                <span className="font-mono text-base">{d}</span>
                <span className="text-[7px] tracking-[0.2em] text-fg-muted h-2">{sub}</span>
              </button>
            ))}
          </div>

          <div className="grid grid-cols-2 gap-1.5">
            {ringing ? (
              <>
                <button type="button" onClick={s.answer} className={`${BTN} py-2 text-[10px] font-bold`} style={sevStyle('ok')}>
                  <PhoneIncoming className="w-3.5 h-3.5" /> Answer
                </button>
                <button type="button" onClick={s.reject} className={`${BTN} py-2 text-[10px] font-bold`} style={sevStyle('critical')}>
                  <PhoneOff className="w-3.5 h-3.5" /> Reject
                </button>
              </>
            ) : (
              <>
                <button type="button" disabled={!canDial} onClick={() => { void s.dial(digits, { blockCallerId }); }} className={`${BTN} py-2 text-[10px] font-bold`} style={sevStyle('ok', canDial)}>
                  <PhoneCall className="w-3.5 h-3.5" /> Call
                </button>
                <button type="button" disabled={!live} onClick={s.hangup} className={`${BTN} py-2 text-[10px] font-bold`} style={sevStyle('critical', live)}>
                  <PhoneOff className="w-3.5 h-3.5" /> Hang up
                </button>
              </>
            )}
          </div>

          <div className="grid grid-cols-3 gap-1.5">
            <button type="button" disabled={!live} aria-pressed={s.muted} onClick={() => s.setMuted(!s.muted)} className={BTN} style={sevStyle('warn', s.muted)}>
              <MicOff className="w-3 h-3" /> {s.muted ? 'Unmute' : 'Mute'}
            </button>
            <button type="button" disabled={!live} aria-pressed={s.held} onClick={() => { void s.toggleHold(); }} className={BTN} style={sevStyle('warn', s.held)}>
              <PauseIcon className="w-3 h-3" /> {s.held ? 'Resume' : 'Hold'}
            </button>
            <button type="button" disabled={!live} aria-pressed={s.recording} onClick={() => { void s.toggleRecording(); }} className={BTN} style={sevStyle('critical', s.recording)}>
              <Disc className="w-3 h-3" /> {s.recording ? 'Stop rec' : 'Record'}
            </button>
            <button type="button" disabled={!live} onClick={() => setPicker(picker === 'menu' ? null : 'menu')} className={BTN} title="Transfer the live call to another dispatcher">
              <PhoneForwarded className="w-3 h-3" /> Transfer
            </button>
            <button type="button" disabled={!live || !target} onClick={() => { void s.addParty(target); }} className={BTN} title="Add the number entered above to the live call">
              <Users className="w-3 h-3" /> Conference
            </button>
            <button type="button" onClick={() => openDialerWindow()} className={BTN} title="Open the softphone in its own window">
              <ExternalLink className="w-3 h-3" /> Pop out
            </button>
          </div>

          {picker === 'menu' && (
            <div className="flex gap-1.5">
              <button type="button" className={`${BTN} flex-1`} onClick={() => setPicker('blind')}>Blind transfer</button>
              <button type="button" className={`${BTN} flex-1`} onClick={() => setPicker('warm')}>Warm transfer</button>
            </div>
          )}
          {(picker === 'blind' || picker === 'warm') && (
            <TransferPicker
              mode={picker}
              onClose={() => setPicker(null)}
              onPick={(id) => { void (picker === 'blind' ? s.transferBlind(id) : s.transferWarm(id)); setPicker(null); }}
            />
          )}

          <label className="flex items-center gap-1.5 text-[9px] uppercase tracking-wide text-fg-muted">
            <input type="checkbox" checked={blockCallerId} onChange={(e) => setBlockCallerId(e.target.checked)} /> Block caller ID (*67)
          </label>
        </>
      )}
    </section>
  );
}
