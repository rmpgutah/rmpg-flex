// LiveTab — current channel + scrolling TX feed with filters.
// Polls /api/radio/transmissions every 5s for the log; live voice
// (PTT + playback of others) rides the dedicated voice socket via
// useVoiceChannel → VoiceHubDO. Recorded clips replay from R2.
import type React from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Search, Filter, Star, Volume2, Mic, Radio as RadioIcon, Play, Pause } from 'lucide-react';
import { apiFetch } from '../../../hooks/useApi';
import { matchesSearch, COMPARE_DATE, ls, playBeep, isInQuietHours } from '../helpers';
import { DATE_RANGES, DURATION_FILTERS } from '../constants';
import { FilterChip, SectionHeader, EmptyConsole, Waveform, Sep } from '../components';
import { useVoiceChannel } from '../useVoiceChannel';
import { RadioHazePlayer } from '../../../utils/radioProcessor';
import type { RadioChannel, RadioTransmission } from '../types';

interface Props {
  selectedChannelId: number | null;
  onSelectChannel: (id: number | null) => void;
}

export default function LiveTab({ selectedChannelId, onSelectChannel }: Props) {
  const [channels, setChannels] = useState<RadioChannel[]>([]);
  const [tx, setTx] = useState<RadioTransmission[]>([]);
  const [q, setQ] = useState('');
  const [range, setRange] = useState('all');
  const [minDur, setMinDur] = useState('0');
  const [showFilters, setShowFilters] = useState(false);
  const [favsOnly, setFavsOnly] = useState(false);

  // Highest transmission id seen so far. `null` until the first poll
  // lands so we never beep for the backlog that's already on screen
  // when the tab opens — only for TX that arrive while we're watching.
  const lastSeenIdRef = useRef<number | null>(null);

  useEffect(() => {
    apiFetch<RadioChannel[]>('/radio/channels').then(setChannels).catch(console.error);
  }, []);

  // Reset the new-TX baseline whenever the feed query changes, so
  // switching channel/range doesn't beep for rows that are "new" only
  // because the filter changed (not because a fresh TX came in).
  useEffect(() => { lastSeenIdRef.current = null; }, [selectedChannelId, range, minDur]);

  // Poll the TX feed. 5s is the right cadence for a console that's
  // displayed (faster than this and the LIST jitters during reads).
  // The server-side q filter is coarse (LIKE) — `matchesSearch` below
  // does the real OR/negation parse on the returned set.
  useEffect(() => {
    let alive = true;
    const fetchTx = () => {
      const params = new URLSearchParams();
      if (selectedChannelId != null) params.set('channel_id', String(selectedChannelId));
      if (range !== 'all') params.set('range', range);
      if (minDur !== '0') params.set('min_duration', minDur);
      params.set('limit', '200');
      apiFetch<RadioTransmission[]>(`/radio/transmissions?${params.toString()}`)
        .then((rows) => {
          if (!alive) return;
          setTx(rows);
          notifyOnNewTx(rows);
        })
        .catch((err) => { console.error('[radio] tx fetch', err); });
    };
    fetchTx();
    const t = setInterval(fetchTx, 5000);
    return () => { alive = false; clearInterval(t); };
  }, [selectedChannelId, range, minDur]);

  // Audible alert for transmissions that arrived since the last poll.
  // Gated by the operator's Settings: "Sound on new transmission" plus
  // the quiet-hours window (so the console stays silent overnight).
  function notifyOnNewTx(rows: RadioTransmission[]) {
    const maxId = rows.reduce((m, r) => Math.max(m, r.id), 0);
    const prev = lastSeenIdRef.current;
    lastSeenIdRef.current = maxId;
    if (prev === null || maxId <= prev) return; // first poll, or nothing new

    if (ls.get('radio_sound_enabled') === 'false') return;
    const qs = ls.get('radio_quiet_start') || '';
    const qe = ls.get('radio_quiet_end') || '';
    if (qs && qe && isInQuietHours(qs, qe)) return;

    const sound = ls.get('radio_notif_sound') || 'chime';
    const volume = Number(ls.get('radio_notif_volume') ?? '1') || 1;
    playBeep(sound, volume);
  }

  // Favorites live in localStorage (no server round-trip for taps).
  const favorites = useMemo<Set<string>>(() => {
    try { return new Set(JSON.parse(localStorage.getItem('radio_favorites') || '[]')); } catch { return new Set(); }
  }, []);

  // Filter chain: search (boolean OR/negation) → date range → favorites.
  // Date filtering is also done server-side; redoing it here is cheap
  // and keeps the LIST in sync between the 5s polls.
  const visibleTx = useMemo(() => {
    return tx.filter((t) => {
      if (q && !matchesSearch(`${t.transcript || ''} ${t.unit_label || ''} ${t.tags || ''}`, q)) return false;
      if (!COMPARE_DATE(t, range)) return false;
      if (favsOnly && t.channel_id != null && !favorites.has(String(t.channel_id))) return false;
      return true;
    });
  }, [tx, q, range, favsOnly, favorites]);

  const currentChannel = channels.find((c) => c.id === selectedChannelId) || null;

  // Live voice for the selected channel. A new recorded transmission
  // is prepended immediately (radio_recorded) so the operator doesn't
  // wait for the next 5s poll.
  const voice = useVoiceChannel(selectedChannelId, (txn: RadioTransmission) => {
    if (!txn) return;
    setTx((prev) => [txn, ...prev.filter((t) => t.id !== txn.id)]);
  });

  return (
    <div className="h-full flex flex-col">
      <SectionHeader
        icon={<Volume2 className="w-3 h-3" style={{ color: 'var(--rt-accent)' }} />}
        label={currentChannel ? `LIVE — ${currentChannel.name.toUpperCase()}` : 'LIVE — NO CHANNEL'}
        trailing={
          <div className="flex items-center gap-2">
            <FilterChip onClick={() => setFavsOnly(v => !v)} active={favsOnly} icon={<Star className="w-3 h-3" />}>FAVS</FilterChip>
            <FilterChip onClick={() => setShowFilters(v => !v)} active={showFilters} icon={<Filter className="w-3 h-3" />}>FILTERS</FilterChip>
          </div>
        }
      />

      {/* Search row + channel picker */}
      <div className="flex items-center gap-2 px-3 py-1.5" style={{ borderBottom: '1px solid var(--rt-border)' }}>
        <Search className="w-3 h-3" style={{ color: 'var(--rt-muted)' }} />
        <input
          type="text" value={q} onChange={(e) => setQ(e.target.value)}
          placeholder='search: "10-50" | "code 4" -test'
          className="flex-1 bg-transparent outline-none text-[10px] font-mono"
          style={{ color: 'var(--rt-text)' }}
          aria-label="Search transmissions"
        />
        <Sep />
        <select
          value={selectedChannelId ?? ''}
          onChange={(e) => onSelectChannel(e.target.value ? parseInt(e.target.value, 10) : null)}
          aria-label="Select channel"
          className="bg-transparent text-[10px] font-mono outline-none cursor-pointer"
          style={{ color: 'var(--rt-text)', border: '1px solid var(--rt-border)', padding: '2px 6px' }}>
          <option value="">All channels</option>
          {channels.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>

      {showFilters && (
        <div className="flex items-center gap-1.5 px-3 py-1.5 flex-wrap"
          style={{ borderBottom: '1px solid var(--rt-border)', background: 'var(--rt-panel)' }}>
          <span className="text-[9px] tracking-[0.2em]" style={{ color: 'var(--rt-muted)' }}>RANGE</span>
          {DATE_RANGES.map((r) => (
            <FilterChip key={r.id} onClick={() => setRange(r.id)} active={range === r.id}>{r.label}</FilterChip>
          ))}
          <Sep />
          <span className="text-[9px] tracking-[0.2em]" style={{ color: 'var(--rt-muted)' }}>DUR</span>
          {DURATION_FILTERS.map((d) => (
            <FilterChip key={d.id} onClick={() => setMinDur(d.id)} active={minDur === d.id}>{d.label}</FilterChip>
          ))}
        </div>
      )}

      {/* Push-to-talk bar — live voice for the selected channel */}
      <PttBar channelSelected={selectedChannelId != null} voice={voice} />

      {/* TX list */}
      <div className="flex-1 min-h-0 overflow-auto">
        {visibleTx.length === 0
          ? <EmptyConsole isConnected={true} channels={channels.length} />
          : (
            <ul className="divide-y" style={{ borderColor: 'var(--rt-border)' }}>
              {visibleTx.map((t) => <TxRow key={t.id} tx={t} />)}
            </ul>
          )}
      </div>
    </div>
  );
}

function TxRow({ tx }: { tx: RadioTransmission }) {
  const time = useMemo(() => {
    try { return new Date(tx.transmitted_at).toLocaleTimeString('en-US', { hour12: false }); } catch { return tx.transmitted_at; }
  }, [tx.transmitted_at]);
  const isLive = tx.duration_seconds > 0 && Date.now() - new Date(tx.transmitted_at).getTime() < 10_000;
  return (
    <li className="flex items-start gap-2 px-3 py-1.5 text-[10px] font-mono hover:bg-black/30">
      <span className="tabular-nums" style={{ color: 'var(--rt-muted)', minWidth: 70 }}>{time}</span>
      {isLive ? <Waveform color="var(--rt-tx)" /> : <span style={{ width: 24 }} />}
      <span className="font-bold" style={{ color: 'var(--rt-accent)', minWidth: 80 }}>{tx.unit_label || tx.user_name || '—'}</span>
      <span style={{ color: 'var(--rt-muted)', minWidth: 60 }}>{tx.channel_name || '—'}</span>
      <span className="flex-1" style={{ color: 'var(--rt-text)' }}>{tx.transcript || <em style={{ opacity: 0.5 }}>no transcript</em>}</span>
      {tx.audio_url ? <AudioPlayButton transmissionId={tx.id} /> : <span style={{ width: 16 }} />}
      <span className="tabular-nums" style={{ color: 'var(--rt-muted)' }}>{tx.duration_seconds.toFixed(1)}s</span>
    </li>
  );
}

// Same-origin relative URL so it passes CSP connect-src 'self'; the zone
// proxy forwards /api/radio/* to the rewrite worker. We fetch the clip via
// the Web Audio path (not an <audio> element) so it can't set an
// Authorization header — the JWT rides the ?token= fallback the auth
// middleware accepts (same trick as bodycam video streams).
export function transmissionAudioUrl(transmissionId: number): string {
  const token = localStorage.getItem('rmpg_token') || '';
  return `/api/radio/transmissions/${transmissionId}/audio${token ? `?token=${encodeURIComponent(token)}` : ''}`;
}

// Recorded clips replay through the SAME P25 radio-haze chain as live
// dispatch voice (bandpass + bitcrusher + AGC + receiver hiss), so a
// saved transmission sounds like it did over the air rather than like a
// dry mic file. The native <audio> element can't do Web Audio DSP, so we
// fetch + decode + play through RadioHazePlayer instead.
export function AudioPlayButton({ transmissionId }: { transmissionId: number }) {
  const [playing, setPlaying] = useState(false);
  const playerRef = useRef<RadioHazePlayer | null>(null);

  useEffect(() => () => { try { playerRef.current?.stop(); } catch { /* noop */ } }, []);

  const toggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (playing) {
      playerRef.current?.stop();
      setPlaying(false);
      return;
    }
    const player = playerRef.current ?? (playerRef.current = new RadioHazePlayer());
    setPlaying(true);
    player
      .playUrl(transmissionAudioUrl(transmissionId), () => setPlaying(false))
      .catch((err) => { console.error('[radio] haze playback failed', err); setPlaying(false); });
  };

  return (
    <button type="button" onClick={toggle}
      aria-label={playing ? 'Pause recording' : 'Play recording'}
      className="shrink-0 hover:opacity-80" style={{ color: 'var(--rt-accent)' }}>
      {playing ? <Pause className="w-3 h-3" /> : <Play className="w-3 h-3" />}
    </button>
  );
}

// PttBar — hold-to-talk control + live channel status. Voice is per
// channel, so it's only meaningful once a specific channel is picked.
function PttBar({ channelSelected, voice }: {
  channelSelected: boolean;
  voice: ReturnType<typeof useVoiceChannel>;
}) {
  if (!channelSelected) {
    return (
      <div className="flex items-center gap-2 px-3 py-2 text-[10px] font-mono"
        style={{ borderBottom: '1px solid var(--rt-border)', background: 'var(--rt-panel)', color: 'var(--rt-muted)' }}>
        <RadioIcon className="w-3 h-3" />
        <span>Select a single channel to talk &amp; hear live voice.</span>
      </div>
    );
  }

  const receiving = !!voice.activeSpeaker && !voice.transmitting;
  const dot = voice.transmitting ? 'var(--rt-tx)' : receiving ? '#22c55e' : voice.connected ? 'var(--rt-accent)' : 'var(--rt-muted)';
  const status = !voice.supported ? 'MIC UNSUPPORTED'
    : !voice.connected ? 'CONNECTING…'
    : voice.transmitting ? 'ON AIR'
    : voice.busy ? 'CHANNEL BUSY'
    : receiving ? `RX — ${voice.activeSpeaker!.label.toUpperCase()}`
    : 'IDLE';

  const holdProps = {
    onMouseDown: () => voice.pttDown(),
    onMouseUp: () => voice.pttUp(),
    onMouseLeave: () => voice.pttUp(),
    onTouchStart: (e: React.TouchEvent) => { e.preventDefault(); voice.pttDown(); },
    onTouchEnd: (e: React.TouchEvent) => { e.preventDefault(); voice.pttUp(); },
  };
  const disabled = !voice.supported || !voice.connected || receiving;

  return (
    <div className="flex items-center gap-3 px-3 py-2"
      style={{ borderBottom: '1px solid var(--rt-border)', background: 'var(--rt-panel)' }}>
      <span className="inline-block rounded-full" style={{ width: 8, height: 8, background: dot }} />
      <span className="text-[9px] font-mono tracking-[0.2em] tabular-nums" style={{ color: 'var(--rt-muted)', minWidth: 120 }}>
        {status}
      </span>
      <button type="button" disabled={disabled} {...holdProps}
        aria-label="Push to talk (hold)"
        className="flex items-center gap-2 px-4 py-1.5 text-[10px] font-mono font-bold tracking-wider uppercase select-none"
        style={{
          border: `1px solid ${voice.transmitting ? 'var(--rt-tx)' : 'var(--rt-border)'}`,
          color: voice.transmitting ? '#000' : disabled ? 'var(--rt-muted)' : 'var(--rt-text)',
          background: voice.transmitting ? 'var(--rt-tx)' : 'transparent',
          cursor: disabled ? 'not-allowed' : 'pointer',
          opacity: disabled ? 0.5 : 1,
        }}>
        <Mic className="w-3 h-3" />
        {voice.transmitting ? 'TRANSMITTING' : 'HOLD TO TALK'}
      </button>
      <span className="ml-auto text-[9px] font-mono" style={{ color: 'var(--rt-muted)' }}>
        {voice.members} on channel
      </span>
    </div>
  );
}
