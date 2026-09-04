import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router';
import { MapPin, ChevronDown, ChevronRight, Volume2, VolumeX, ExternalLink, RefreshCw } from 'lucide-react';
import PanelTitleBar from '../components/PanelTitleBar';
import { apiFetch } from '../hooks/useApi';
import { parseTimestamp } from '../utils/dateUtils';

interface CallUnit {
  unit_id: number;
  unit_number: string;
  officer_name?: string;
  status?: string;
}

interface ActiveCall {
  id: number;
  call_number: string;
  nature: string;
  address?: string;
  location?: string;
  district?: string;
  area?: string;
  priority: number;
  status: string;
  created_at: string;
  updated_at?: string;
  notes?: string;
  units?: CallUnit[];
  assigned_units?: string;
  call_history?: string;
}

type FilterMode = 'all' | 'critical' | 'unassigned';
type SortMode = 'priority' | 'time';

let _audioCtx: AudioContext | null = null;
function getAudioCtx(): AudioContext | null {
  try {
    if (!_audioCtx || _audioCtx.state === 'closed') {
      _audioCtx = new AudioContext();
    }
    return _audioCtx;
  } catch {
    return null;
  }
}

function playP1Beep(): void {
  try {
    const ctx = getAudioCtx();
    if (!ctx) return;
    if (ctx.state === 'suspended') ctx.resume();
    const oscillator = ctx.createOscillator();
    const gainNode = ctx.createGain();
    oscillator.connect(gainNode);
    gainNode.connect(ctx.destination);
    oscillator.type = 'square';
    oscillator.frequency.setValueAtTime(880, ctx.currentTime);
    oscillator.frequency.setValueAtTime(660, ctx.currentTime + 0.15);
    oscillator.frequency.setValueAtTime(880, ctx.currentTime + 0.30);
    gainNode.gain.setValueAtTime(0.25, ctx.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.55);
    oscillator.start(ctx.currentTime);
    oscillator.stop(ctx.currentTime + 0.55);
  } catch {
    // AudioContext not available
  }
}

function getElapsed(createdAt: string): string {
  const diff = Date.now() - parseTimestamp(createdAt).getTime();
  if (isNaN(diff) || diff < 0) return '—';
  const totalSec = Math.floor(diff / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function getPriorityBorderClass(priority: number): string {
  switch (priority) {
    case 1: return 'border-l-[var(--sev-critical)]';
    case 2: return 'border-l-[var(--sev-warn)]';
    case 3: return 'border-l-[color:var(--brand-400)]';
    default: return 'border-l-[color:var(--text-secondary)]';
  }
}

function getPriorityLabel(priority: number): string {
  switch (priority) {
    case 1: return 'P1';
    case 2: return 'P2';
    case 3: return 'P3';
    default: return 'P4';
  }
}

function getPriorityTextClass(priority: number): string {
  switch (priority) {
    case 1: return 'text-[var(--sev-critical)]';
    case 2: return 'text-[var(--sev-warn)]';
    case 3: return 'text-[color:var(--brand-400)]';
    default: return 'text-[color:var(--text-secondary)]';
  }
}

function getCallAddress(call: ActiveCall): string {
  return call.address || call.location || 'Address unknown';
}

function getCallDistrict(call: ActiveCall): string {
  return call.district || call.area || 'Unassigned District';
}

function isUnassigned(call: ActiveCall): boolean {
  if (call.units && call.units.length > 0) return false;
  if (call.assigned_units && call.assigned_units.trim().length > 0) return false;
  return true;
}

interface CallRowProps {
  call: ActiveCall;
  expanded: boolean;
  onToggle: () => void;
  onOpenMap: () => void;
  now: number;
}

function CallRow({ call, expanded, onToggle, onOpenMap, now: _now }: CallRowProps) {
  const [elapsed, setElapsed] = useState(() => getElapsed(call.created_at));

  useEffect(() => {
    setElapsed(getElapsed(call.created_at));
    const timer = setInterval(() => setElapsed(getElapsed(call.created_at)), 1000);
    return () => clearInterval(timer);
  }, [call.created_at]);

  const units: CallUnit[] = call.units || [];
  const unitDisplay =
    units.length > 0
      ? units.map((u) => u.unit_number).join(', ')
      : call.assigned_units || 'None';

  return (
    <div
      className={`border-l-4 ${getPriorityBorderClass(call.priority)} bg-[color:var(--surface-raised)] rounded-[2px] mb-1 overflow-hidden`}
    >
      {/* Summary row */}
      <div
        className="flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-[color:var(--surface-hover,rgba(255,255,255,0.04))] select-none"
        onClick={onToggle}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onToggle(); }}
        aria-expanded={expanded}
      >
        <span className="shrink-0">
          {expanded
            ? <ChevronDown size={14} className="text-[color:var(--text-secondary)]" />
            : <ChevronRight size={14} className="text-[color:var(--text-secondary)]" />}
        </span>

        <span className={`font-bold text-[10px] w-6 shrink-0 ${getPriorityTextClass(call.priority)}`}>
          {getPriorityLabel(call.priority)}
        </span>

        <span className="font-mono text-[11px] text-[color:var(--text-secondary)] shrink-0 w-20">
          {call.call_number}
        </span>

        <span className="font-semibold text-[11px] text-[color:var(--text-primary)] flex-1 truncate">
          {call.nature}
        </span>

        <span className="text-[11px] text-[color:var(--text-secondary)] flex-1 truncate hidden sm:block">
          {getCallAddress(call)}
        </span>

        <span className="text-[10px] text-[color:var(--text-secondary)] shrink-0 w-28 hidden md:block truncate">
          Units: {unitDisplay}
        </span>

        <span className="text-[10px] text-[color:var(--text-secondary)] shrink-0 w-14 text-right font-mono">
          {elapsed}
        </span>

        <button
          className="shrink-0 ml-1 p-1 rounded-[2px] hover:bg-[color:var(--surface-sunken)] text-[color:var(--text-secondary)] hover:text-[color:var(--text-primary)]"
          onClick={(e) => { e.stopPropagation(); onOpenMap(); }}
          aria-label="Open in Map"
          title="Open in Map"
        >
          <ExternalLink size={12} />
        </button>
      </div>

      {/* Expanded detail */}
      {expanded && (
        <div className="px-4 pb-3 pt-1 border-t border-[color:var(--border-subtle,rgba(255,255,255,0.06))] text-[11px] space-y-2">
          <div className="sm:hidden text-[color:var(--text-secondary)]">
            <span className="font-semibold text-[color:var(--field-label-color)]">Address: </span>
            {getCallAddress(call)}
          </div>

          {units.length > 0 && (
            <div>
              <span className="font-semibold text-[color:var(--field-label-color)]">Assigned Units</span>
              <div className="mt-1 flex flex-wrap gap-2">
                {units.map((u) => (
                  <span
                    key={u.unit_id}
                    className="px-2 py-0.5 bg-[color:var(--surface-sunken)] rounded-[2px] text-[color:var(--text-primary)] text-[10px]"
                  >
                    {u.unit_number}
                    {u.officer_name ? ` — ${u.officer_name}` : ''}
                    {u.status ? ` (${u.status})` : ''}
                  </span>
                ))}
              </div>
            </div>
          )}

          {call.notes && (
            <div>
              <span className="font-semibold text-[color:var(--field-label-color)]">Notes</span>
              <p className="mt-0.5 text-[color:var(--text-secondary)] whitespace-pre-wrap leading-relaxed">
                {call.notes}
              </p>
            </div>
          )}

          {call.call_history && (
            <div>
              <span className="font-semibold text-[color:var(--field-label-color)]">History</span>
              <p className="mt-0.5 text-[color:var(--text-secondary)] whitespace-pre-wrap leading-relaxed">
                {call.call_history}
              </p>
            </div>
          )}

          <div className="pt-1">
            <button
              className="flex items-center gap-1.5 px-3 py-1.5 bg-[color:var(--surface-sunken)] hover:bg-[color:var(--brand-700)] text-[color:var(--text-primary)] rounded-[2px] text-[10px] font-semibold transition-colors"
              onClick={onOpenMap}
            >
              <MapPin size={11} />
              Open in Map
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function LiveCallMapPage() {
  const navigate = useNavigate();
  const [calls, setCalls] = useState<ActiveCall[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [filter, setFilter] = useState<FilterMode>('all');
  const [sort, setSort] = useState<SortMode>('priority');
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [soundEnabled, setSoundEnabled] = useState(false);
  const [now, setNow] = useState(Date.now());

  const knownCallIds = useRef<Set<number>>(new Set());
  const p1Ref = useRef<HTMLDivElement | null>(null);
  const initialized = useRef(false);

  // Tick for elapsed time (coarse)
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(t);
  }, []);

  const fetchCalls = useCallback(async (isManual = false) => {
    if (isManual) setLoading(true);
    try {
      const data = await apiFetch<ActiveCall[]>('/dispatch/calls?active=true');
      const incoming = Array.isArray(data) ? data : [];

      // Detect new P1 calls
      if (initialized.current && soundEnabled) {
        for (const c of incoming) {
          if (c.priority === 1 && !knownCallIds.current.has(c.id)) {
            playP1Beep();
            break; // one beep per batch
          }
        }
      }

      // Update known ids
      const newSet = new Set<number>(incoming.map((c) => c.id));
      knownCallIds.current = newSet;
      initialized.current = true;

      setCalls(incoming);
      setLastUpdated(new Date());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load calls');
    } finally {
      setLoading(false);
    }
  }, [soundEnabled]);

  // Initial + poll
  useEffect(() => {
    fetchCalls();
    const interval = setInterval(() => fetchCalls(), 15000);
    return () => clearInterval(interval);
  }, [fetchCalls]);

  // Auto-scroll to first P1 on new data
  useEffect(() => {
    if (p1Ref.current) {
      p1Ref.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, [calls]);

  const toggleExpanded = useCallback((id: number) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  // Filter
  const filtered = calls.filter((c) => {
    if (filter === 'critical') return c.priority <= 2;
    if (filter === 'unassigned') return isUnassigned(c);
    return true;
  });

  // Sort
  const sorted = [...filtered].sort((a, b) => {
    if (sort === 'priority') {
      if (a.priority !== b.priority) return a.priority - b.priority;
      return parseTimestamp(a.created_at).getTime() - parseTimestamp(b.created_at).getTime();
    }
    // by time (oldest first = longest running)
    return parseTimestamp(a.created_at).getTime() - parseTimestamp(b.created_at).getTime();
  });

  // Group by district
  const districts = new Map<string, ActiveCall[]>();
  for (const call of sorted) {
    const d = getCallDistrict(call);
    if (!districts.has(d)) districts.set(d, []);
    districts.get(d)!.push(call);
  }

  // Stats
  const total = calls.length;
  const p1Count = calls.filter((c) => c.priority === 1).length;
  const p2Count = calls.filter((c) => c.priority === 2).length;

  const firstP1Id = sorted.find((c) => c.priority === 1)?.id ?? null;

  return (
    <div className="flex flex-col h-full bg-[color:var(--surface-base)] text-[color:var(--text-primary)]">
      <PanelTitleBar title="LIVE CALL MAP" icon={MapPin} />

      {/* Top bar */}
      <div className="flex flex-wrap items-center gap-3 px-4 py-2 border-b border-[color:var(--border-subtle,rgba(255,255,255,0.08))] bg-[color:var(--surface-raised)] shrink-0">
        {/* Stats */}
        <div className="flex items-center gap-4 text-[11px]">
          <span>
            <span className="text-[color:var(--text-secondary)]">Total active: </span>
            <span className="font-bold text-[color:var(--text-primary)]">{total}</span>
          </span>
          <span>
            <span className="text-[color:var(--sev-critical)] font-bold">P1: </span>
            <span className="font-bold text-[color:var(--sev-critical)]">{p1Count}</span>
          </span>
          <span>
            <span className="text-[color:var(--sev-warn)] font-bold">P2: </span>
            <span className="font-bold text-[color:var(--sev-warn)]">{p2Count}</span>
          </span>
        </div>

        <div className="flex-1" />

        {/* Filter */}
        <div className="flex items-center gap-1 text-[10px]">
          {(['all', 'critical', 'unassigned'] as FilterMode[]).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-2 py-1 rounded-[2px] font-semibold transition-colors ${
                filter === f
                  ? 'bg-[color:var(--brand-600)] text-[color:var(--text-primary)]'
                  : 'bg-[color:var(--surface-sunken)] text-[color:var(--text-secondary)] hover:text-[color:var(--text-primary)]'
              }`}
            >
              {f === 'all' ? 'All' : f === 'critical' ? 'P1–P2 Critical' : 'Unassigned'}
            </button>
          ))}
        </div>

        {/* Sort */}
        <div className="flex items-center gap-1 text-[10px]">
          <span className="text-[color:var(--text-secondary)]">Sort:</span>
          {(['priority', 'time'] as SortMode[]).map((s) => (
            <button
              key={s}
              onClick={() => setSort(s)}
              className={`px-2 py-1 rounded-[2px] font-semibold transition-colors ${
                sort === s
                  ? 'bg-[color:var(--brand-600)] text-[color:var(--text-primary)]'
                  : 'bg-[color:var(--surface-sunken)] text-[color:var(--text-secondary)] hover:text-[color:var(--text-primary)]'
              }`}
            >
              {s === 'priority' ? 'Priority' : 'Time'}
            </button>
          ))}
        </div>

        {/* Sound toggle */}
        <button
          onClick={() => setSoundEnabled((v) => !v)}
          className={`p-1.5 rounded-[2px] transition-colors ${
            soundEnabled
              ? 'bg-[color:var(--sev-critical)] text-white'
              : 'bg-[color:var(--surface-sunken)] text-[color:var(--text-secondary)] hover:text-[color:var(--text-primary)]'
          }`}
          title={soundEnabled ? 'Sound alerts ON — click to disable' : 'Sound alerts OFF — click to enable'}
          aria-label={soundEnabled ? 'Disable P1 sound alert' : 'Enable P1 sound alert'}
        >
          {soundEnabled ? <Volume2 size={13} /> : <VolumeX size={13} />}
        </button>

        {/* Refresh */}
        <button
          onClick={() => fetchCalls(true)}
          disabled={loading}
          className="p-1.5 rounded-[2px] bg-[color:var(--surface-sunken)] text-[color:var(--text-secondary)] hover:text-[color:var(--text-primary)] disabled:opacity-50 transition-colors"
          aria-label="Refresh calls"
          title="Refresh now"
        >
          <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* Last updated */}
      {lastUpdated && (
        <div className="px-4 py-1 text-[9px] text-[color:var(--text-secondary)] bg-[color:var(--surface-base)] shrink-0 border-b border-[color:var(--border-subtle,rgba(255,255,255,0.04))]">
          Last updated: {lastUpdated.toLocaleTimeString('en-US', { timeZone: 'America/Denver' })} · Auto-refresh every 15s
          {soundEnabled && <span className="ml-2 text-[color:var(--sev-critical)]">· Sound alert active for new P1</span>}
        </div>
      )}

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-4 py-3 min-h-0">
        {error && (
          <div className="mb-3 px-3 py-2 bg-[color:var(--sev-critical)]/10 border border-[color:var(--sev-critical)]/30 rounded-[2px] text-[11px] text-[color:var(--sev-critical)]">
            {error}
          </div>
        )}

        {loading && calls.length === 0 && (
          <div className="text-[11px] text-[color:var(--text-secondary)] py-8 text-center">
            Loading active calls…
          </div>
        )}

        {!loading && sorted.length === 0 && (
          <div className="text-[11px] text-[color:var(--text-secondary)] py-8 text-center">
            {filter === 'all' ? 'No active calls.' : 'No calls match the current filter.'}
          </div>
        )}

        {Array.from(districts.entries()).map(([district, districtCalls]) => (
          <div key={district} className="mb-5">
            <div className="flex items-center gap-2 mb-1.5">
              <span className="text-[10px] font-semibold text-[color:var(--panel-header-color)] uppercase tracking-wider">
                {district}
              </span>
              <span className="text-[9px] text-[color:var(--text-secondary)]">
                ({districtCalls.length} call{districtCalls.length !== 1 ? 's' : ''})
              </span>
              <div className="flex-1 h-px bg-[color:var(--border-subtle,rgba(255,255,255,0.07))]" />
            </div>

            <div>
              {districtCalls.map((call) => (
                <div
                  key={call.id}
                  ref={call.id === firstP1Id ? p1Ref : undefined}
                >
                  <CallRow
                    call={call}
                    expanded={expanded.has(call.id)}
                    onToggle={() => toggleExpanded(call.id)}
                    onOpenMap={() => navigate(`/map?call_id=${call.id}`)}
                    now={now}
                  />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
