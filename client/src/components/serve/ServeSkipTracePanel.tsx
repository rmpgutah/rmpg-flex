import { useState, useEffect, useCallback } from 'react';
import {
  X, Search, Loader2, CheckCircle2,
  ChevronDown, ChevronRight, AlertTriangle, MapPinned, Phone,
} from 'lucide-react';
import { apiFetch } from '../../hooks/useApi';
import type { ServeJob, ServeSkipAddress, ServeSkipTrace } from '../../types';
import { safeDateStr } from '../../utils/dateUtils';
import { formatEnumValue } from '../../utils/formatters';

// ─── Types ──────────────────────────────────────────────────────────────

interface ServeSkipTracePanelProps {
  isOpen: boolean;
  onClose: () => void;
  job: ServeJob;
  onAddToRoute: (address: ServeSkipAddress) => void;
  onLookupComplete?: () => void;
}

interface SkipProfileAddress {
  address?: string;
  street?: string;
  city?: string;
  state?: string;
  zip?: string;
  type?: string;
  source: string;
}

interface SkipProfile {
  id: string;
  fullName?: string;
  firstName?: string;
  lastName?: string;
  addresses?: SkipProfileAddress[];
  phones?: Array<{ number: string; type?: string; source: string }>;
  sources?: string[];
  matchTier?: string;
}

interface SkipSearchResult {
  profiles: SkipProfile[];
  sourcesQueried: string[];
  sourcesResponded: string[];
  sourcesFailed?: Array<{ name: string; error: string }>;
  totalResults: number;
  totalCost: number;
  durationMs?: number;
}

function addressKey(addr: ServeSkipAddress): string {
  return [addr.address, addr.city, addr.state, addr.zip].join('|').toLowerCase();
}

function profilesToServeAddresses(profiles: SkipProfile[]): ServeSkipAddress[] {
  const seen = new Set<string>();
  const out: ServeSkipAddress[] = [];

  for (const profile of profiles) {
    for (const raw of profile.addresses ?? []) {
      const line = (raw.address || raw.street || '').trim();
      const city = raw.city?.trim() || '';
      const state = raw.state?.trim() || '';
      const zip = raw.zip?.trim() || '';
      if (!line && !city) continue;
      const entry: ServeSkipAddress = {
        address: line,
        city,
        state,
        zip,
        type: raw.type || 'current',
        last_seen: null,
      };
      const key = addressKey(entry);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(entry);
    }
  }
  return out;
}

async function fetchSkipTraceSearch(opts: {
  name?: string;
  address?: string;
  city?: string;
  state?: string;
}): Promise<SkipSearchResult> {
  const params = new URLSearchParams();
  params.set('engine', 'all');

  const name = opts.name?.trim();
  const address = opts.address?.trim();
  if (name) {
    params.set('q', name);
    const tokens = name.split(/\s+/).filter(Boolean);
    if (tokens.length >= 2) {
      params.set('firstName', tokens[0]);
      params.set('lastName', tokens[tokens.length - 1]);
    }
  } else if (address) {
    params.set('q', address);
  } else {
    throw new Error('Enter a name or address to search');
  }

  if (opts.city?.trim()) params.set('city', opts.city.trim());
  if (opts.state?.trim()) params.set('state', opts.state.trim());

  return apiFetch<SkipSearchResult>(`/skiptracer-v2/search?${params.toString()}`);
}

// ─── Component ──────────────────────────────────────────────────────────

export default function ServeSkipTracePanel({
  isOpen,
  onClose,
  job,
  onAddToRoute,
  onLookupComplete,
}: ServeSkipTracePanelProps) {
  const [searchName, setSearchName] = useState(job.recipient_name || '');
  const [searchAddress, setSearchAddress] = useState(
    [job.recipient_address, job.recipient_city, job.recipient_state, job.recipient_zip]
      .filter(Boolean).join(', ')
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [results, setResults] = useState<SkipSearchResult | null>(null);
  const [foundAddresses, setFoundAddresses] = useState<ServeSkipAddress[]>([]);

  // Reset state when panel opens or job changes
  useEffect(() => {
    if (!isOpen) return;
    setSearchName(job.recipient_name || '');
    setSearchAddress(
      [job.recipient_address, job.recipient_city, job.recipient_state, job.recipient_zip]
        .filter(Boolean).join(', ')
    );
    setError(null);
    setNotice(null);
    setHistoryOpen(false);
    setResults(null);
    setFoundAddresses([]);
  }, [isOpen, job.id]);

  const runLookup = useCallback(async () => {
    const name = searchName.trim();
    const address = searchAddress.trim();
    if (!name && !address) {
      setError('Enter a name or address to search');
      return;
    }

    setLoading(true);
    setError(null);
    setNotice(null);
    setResults(null);
    setFoundAddresses([]);

    try {
      const outcome = await fetchSkipTraceSearch({
        name: name || undefined,
        address: !name ? address : undefined,
        city: job.recipient_city ?? undefined,
        state: job.recipient_state ?? undefined,
      });

      const profiles = outcome.profiles ?? [];
      const sourcesQueried = new Set(outcome.sourcesQueried ?? []);
      const sourcesResponded = new Set(outcome.sourcesResponded ?? []);
      const sourcesFailed = outcome.sourcesFailed ?? [];
      const totalCost = outcome.totalCost ?? 0;
      const durationMs = outcome.durationMs ?? 0;

      const merged: SkipSearchResult = {
        profiles,
        sourcesQueried: [...sourcesQueried],
        sourcesResponded: [...sourcesResponded],
        sourcesFailed,
        totalResults: profiles.length,
        totalCost,
        durationMs,
      };

      const addresses = profilesToServeAddresses(profiles);
      setResults(merged);
      setFoundAddresses(addresses);

      await apiFetch<{ success: boolean; id: number }>(
        `/serve-intake/${job.id}/skip-trace`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            search_type: 'automated',
            search_query: [name, address].filter(Boolean).join(' | '),
            results_json: merged,
            addresses_found: addresses,
          }),
        },
      );

      const failedPaid = sourcesFailed.filter(f =>
        f.error === 'not_configured' && /rapidapi|vehicle/i.test(f.name),
      );
      if (profiles.length === 0 && addresses.length === 0) {
        if (failedPaid.length > 0) {
          setNotice('No matches found. RapidAPI keys may not be configured — check Admin → Skip Tracer sources.');
        } else {
          setNotice('Search complete — no additional addresses found. Try refining the name or address.');
        }
      } else {
        const sourceLabel = sourcesResponded.size
          ? `${sourcesResponded.size} source(s)`
          : 'local records';
        setNotice(`Found ${addresses.length} address(es) from ${profiles.length} profile(s) via ${sourceLabel}.`);
      }

      onLookupComplete?.();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Skip trace lookup failed';
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, [job.id, job.recipient_city, job.recipient_state, searchName, searchAddress, onLookupComplete]);

  if (!isOpen) return null;

  const priorTraces = job.skipTraces || [];

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-50 bg-black/40 backdrop-blur-[2px] transition-opacity animate-in fade-in duration-200"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Panel */}
      <div
        className="fixed top-0 right-0 z-50 h-full w-full sm:w-[400px] bg-surface-base border-l border-rmpg-700 panel-beveled shadow-md flex flex-col"
        style={{ animation: 'slideInRight 0.2s ease-out' }}
        role="dialog"
        aria-modal="true"
        aria-label="Skip Trace Lookup"
      >
        {/* ─── Header ─────────────────────────────────────────── */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-rmpg-700">
          <div className="flex items-center gap-2">
            <Search size={16} className="text-accent-silver-400" />
            <h2 className="text-sm font-semibold text-rmpg-100 tracking-wide">Skip Trace Lookup</h2>
          </div>
          <button type="button"
            onClick={onClose}
            className="p-1 text-fg-muted hover:text-rmpg-100 transition-colors rounded-[2px] hover:bg-surface-raised focus:outline-none focus:ring-1 focus:ring-[color:var(--accent-silver-400)]/50"
            aria-label="Close skip trace panel"
          >
            <X size={16} />
          </button>
        </div>

        {/* ─── Scrollable Body ────────────────────────────────── */}
        <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-4 scrollbar-dark">
          {/* Search Section */}
          <div className="space-y-3">
            <div>
              <label htmlFor="ff-serveskiptracepanel-0" className="block text-[11px] text-rmpg-400 mb-1">Name</label>
              <input id="ff-serveskiptracepanel-0"
                type="text"
                value={searchName}
                onChange={e => setSearchName(e.target.value)}
                className="w-full px-3 py-2 text-sm bg-surface-sunken border border-rmpg-700 rounded-[2px] text-rmpg-100 placeholder-fg-muted focus:border-[color:var(--accent-silver-400)] focus:outline-none focus:ring-1 focus:ring-[color:var(--accent-silver-400)]/40 transition-colors"
                placeholder="Recipient name"
              />
            </div>
            <div>
              <label htmlFor="ff-serveskiptracepanel-1" className="block text-[11px] text-rmpg-400 mb-1">Address</label>
              <input id="ff-serveskiptracepanel-1"
                type="text"
                value={searchAddress}
                onChange={e => setSearchAddress(e.target.value)}
                className="w-full px-3 py-2 text-sm bg-surface-sunken border border-rmpg-700 rounded-[2px] text-rmpg-100 placeholder-fg-muted focus:border-[color:var(--accent-silver-400)] focus:outline-none focus:ring-1 focus:ring-[color:var(--accent-silver-400)]/40 transition-colors"
                placeholder="Last known address"
              />
            </div>
            <button type="button"
              onClick={runLookup}
              disabled={loading || (!searchName.trim() && !searchAddress.trim())}
              className="w-full flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium bg-[color:var(--accent-silver-500)] hover:bg-[color:var(--accent-silver-500)]/80 disabled:bg-rmpg-700 disabled:text-fg-muted text-rmpg-100 rounded-[2px] transition-all duration-150 focus:outline-none focus:ring-1 focus:ring-[color:var(--accent-silver-400)]/50 hover:shadow-[0_0_8px_rgb(var(--accent-silver-400-rgb)/0.25)]"
            >
              {loading ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <Search size={14} />
              )}
              {loading ? 'Running Lookup...' : 'Run Lookup'}
            </button>
            <p className="text-[10px] text-fg-muted text-center">
              Queries local RMS, RapidAPI skip trace, and open-source enrichment
            </p>
          </div>

          {/* Error */}
          {error && (
            <div className="flex items-center gap-2 px-3 py-2 text-sm text-red-400 bg-red-900/20 border border-red-800/40 rounded-sm">
              <AlertTriangle size={14} />
              <span>{error}</span>
            </div>
          )}

          {/* Status notice */}
          {notice && (
            <div className="flex items-center gap-2 px-3 py-2 text-sm text-accent-silver-300 bg-accent-silver-400/10 border border-accent-silver-400/30 rounded-sm">
              <CheckCircle2 size={14} />
              <span>{notice}</span>
            </div>
          )}

          {/* Results */}
          {results && foundAddresses.length > 0 && (
            <div className="space-y-2">
              <div className="text-[10px] font-bold uppercase tracking-wider text-rmpg-400">
                Addresses Found ({foundAddresses.length})
              </div>
              <div className="space-y-2">
                {foundAddresses.map(addr => (
                  <div
                    key={addressKey(addr)}
                    className="p-2 bg-surface-sunken border border-rmpg-700 rounded-[2px] space-y-1"
                  >
                    <p className="text-sm text-rmpg-100">
                      {[addr.address, addr.city, addr.state, addr.zip].filter(Boolean).join(', ')}
                    </p>
                    <button type="button"
                      onClick={() => onAddToRoute(addr)}
                      className="flex items-center gap-1 text-[10px] font-semibold text-accent-silver-300 hover:text-accent-silver-200 transition-colors"
                    >
                      <MapPinned size={12} />
                      Add to route
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {results && results.profiles.length > 0 && (
            <div className="space-y-2">
              <div className="text-[10px] font-bold uppercase tracking-wider text-rmpg-400">
                Profiles ({results.profiles.length})
              </div>
              {results.profiles.slice(0, 8).map(profile => {
                const name = profile.fullName
                  || [profile.firstName, profile.lastName].filter(Boolean).join(' ')
                  || 'Unknown';
                return (
                  <div
                    key={profile.id}
                    className="p-2 bg-surface-sunken border border-rmpg-700 rounded-[2px] space-y-1"
                  >
                    <p className="text-sm font-medium text-rmpg-100">{name}</p>
                    {(profile.phones?.length ?? 0) > 0 && (
                      <div className="flex items-center gap-1 text-[10px] text-rmpg-400">
                        <Phone size={10} />
                        {profile.phones!.slice(0, 3).map(p => p.number).join(', ')}
                      </div>
                    )}
                    {(profile.sources?.length ?? 0) > 0 && (
                      <p className="text-[9px] text-fg-muted uppercase tracking-wider">
                        {profile.sources!.join(', ')}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* Previous Lookups Accordion */}
          {priorTraces.length > 0 && (
            <div className="border border-rmpg-700 rounded-[2px] overflow-hidden">
              <button type="button"
                onClick={() => setHistoryOpen(v => !v)}
                className="w-full flex items-center justify-between px-3 py-2 text-[11px] text-rmpg-400 hover:text-rmpg-300 bg-surface-sunken transition-all duration-150 hover:bg-surface-base"
                aria-expanded={historyOpen}
              >
                <span className="font-semibold uppercase tracking-wider" style={{ color: 'var(--panel-header-color)' }}>
                  Previous Lookups ({priorTraces.length})
                </span>
                {historyOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
              </button>
              {historyOpen && (
                <div className="border-t border-rmpg-700 divide-y divide-[var(--border-subtle)]">
                  {priorTraces.map((trace: ServeSkipTrace) => (
                    <div key={trace.id} className="px-3 py-2 text-[11px]">
                      <div className="flex items-center justify-between">
                        <span className="text-rmpg-300">
                          {safeDateStr(trace.created_at)}
                        </span>
                        <span className="text-fg-muted">{formatEnumValue(trace.search_type)}</span>
                      </div>
                      <p className="text-fg-muted mt-0.5">
                        {trace.addresses_found?.length || 0} address(es) found
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Slide-in animation keyframes */}
      <style>{`
        @keyframes slideInRight {
          from { transform: translateX(100%); }
          to   { transform: translateX(0); }
        }
      `}</style>
    </>
  );
}
