// LiveTab — current channel + scrolling TX feed with filters.
// Polls /api/radio/transmissions every 5s (cheap; the WS will replace
// this later — see TODO at the bottom of the file).
import { useEffect, useMemo, useState } from 'react';
import { Search, Filter, Star, Volume2 } from 'lucide-react';
import { apiFetch } from '../../../hooks/useApi';
import { matchesSearch, COMPARE_DATE } from '../helpers';
import { DATE_RANGES, DURATION_FILTERS } from '../constants';
import { FilterChip, SectionHeader, EmptyConsole, Waveform, Sep } from '../components';
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

  useEffect(() => {
    apiFetch<RadioChannel[]>('/radio/channels').then(setChannels).catch(console.error);
  }, []);

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
        .then((rows) => { if (alive) setTx(rows); })
        .catch((err) => { console.error('[radio] tx fetch', err); });
    };
    fetchTx();
    const t = setInterval(fetchTx, 5000);
    return () => { alive = false; clearInterval(t); };
  }, [selectedChannelId, range, minDur]);

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
      <span className="tabular-nums" style={{ color: 'var(--rt-muted)' }}>{tx.duration_seconds.toFixed(1)}s</span>
    </li>
  );
}
