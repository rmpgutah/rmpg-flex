import React, { useState, useEffect, useCallback } from 'react';
import {
  X, Search, Loader2, CheckCircle2, MapPin, Phone, Briefcase,
  ChevronDown, ChevronRight, AlertTriangle, User, Plus,
} from 'lucide-react';
import { apiFetch } from '../../hooks/useApi';
import type { ServeJob, ServeSkipAddress, ServeSkipTrace } from '../../types';

// ─── Types ──────────────────────────────────────────────────────────────

interface ServeSkipTracePanelProps {
  isOpen: boolean;
  onClose: () => void;
  job: ServeJob;
  onAddToRoute: (address: ServeSkipAddress) => void;
  onLookupComplete?: () => void;
}

interface SkipTraceResult {
  success: boolean;
  addresses: ServeSkipAddress[];
  resultCount: number;
  persons?: SkipTracePerson[];
  phones?: SkipTracePhone[];
  employment?: SkipTraceEmployment[];
}

interface SkipTracePerson {
  name: string;
  age?: number;
  aliases?: string[];
}

interface SkipTracePhone {
  number: string;
  type?: string;
  carrier?: string;
}

interface SkipTraceEmployment {
  employer: string;
  title?: string;
  address?: string;
}

// ─── Address Type Badge ─────────────────────────────────────────────────

function AddressTypeBadge({ type }: { type: string }) {
  const lower = type.toLowerCase();
  let cls = 'bg-rmpg-800/40 text-rmpg-400 border-rmpg-700/50';
  if (lower === 'current') cls = 'bg-green-900/40 text-green-400 border-green-700/50';
  else if (lower === 'previous') cls = 'bg-yellow-900/40 text-yellow-400 border-yellow-700/50';

  return (
    <span className={`text-[10px] px-1.5 py-0.5 rounded-sm border ${cls}`}>
      {type}
    </span>
  );
}

// ─── Address Match Check ────────────────────────────────────────────────

function normalizeAddr(s: string | null): string {
  if (!s) return '';
  return s.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function addressMatchesJob(addr: ServeSkipAddress, job: ServeJob): boolean {
  const jobAddr = normalizeAddr(job.recipient_address);
  const jobCity = normalizeAddr(job.recipient_city);
  const jobZip = normalizeAddr(job.recipient_zip);
  const skipAddr = normalizeAddr(addr.address);
  const skipCity = normalizeAddr(addr.city);
  const skipZip = normalizeAddr(addr.zip);

  if (!jobAddr) return false;
  return (skipAddr.includes(jobAddr) || jobAddr.includes(skipAddr))
    && (skipCity === jobCity || skipZip === jobZip);
}

// ─── Sort addresses: Current first, then Previous, then Historical ──────

function sortAddresses(addrs: ServeSkipAddress[]): ServeSkipAddress[] {
  const typeOrder: Record<string, number> = { current: 0, previous: 1 };
  return [...addrs].sort((a, b) => {
    const oa = typeOrder[a.type.toLowerCase()] ?? 2;
    const ob = typeOrder[b.type.toLowerCase()] ?? 2;
    if (oa !== ob) return oa - ob;
    // Within same type, most recent first
    if (a.last_seen && b.last_seen) return b.last_seen.localeCompare(a.last_seen);
    if (a.last_seen) return -1;
    if (b.last_seen) return 1;
    return 0;
  });
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
  const [result, setResult] = useState<SkipTraceResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);

  // Reset state when panel opens or job changes
  useEffect(() => {
    if (!isOpen) return;
    setSearchName(job.recipient_name || '');
    setSearchAddress(
      [job.recipient_address, job.recipient_city, job.recipient_state, job.recipient_zip]
        .filter(Boolean).join(', ')
    );
    setResult(null);
    setError(null);
    setHistoryOpen(false);
  }, [isOpen, job.id]);

  const runLookup = useCallback(async () => {
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const data = await apiFetch<SkipTraceResult>(
        `/api/process-server/${job.id}/skip-trace`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: searchName, address: searchAddress }),
        },
      );
      setResult(data);
      onLookupComplete?.();
    } catch (err: any) {
      setError(err?.message || 'Skip trace lookup failed');
    } finally {
      setLoading(false);
    }
  }, [job.id, searchName, searchAddress, onLookupComplete]);

  if (!isOpen) return null;

  const sortedAddresses = result?.addresses ? sortAddresses(result.addresses) : [];
  const priorTraces = job.skipTraces || [];

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-50 bg-black/40 transition-opacity"
        onClick={onClose}
      />

      {/* Panel */}
      <div
        className="fixed top-0 right-0 z-50 h-full w-full sm:w-[400px] bg-[#141e2b] border-l border-[#1e3048] panel-beveled shadow-2xl flex flex-col animate-slide-in-right"
        style={{ animation: 'slideInRight 0.2s ease-out' }}
      >
        {/* ─── Header ─────────────────────────────────────────── */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-[#1e3048]">
          <div className="flex items-center gap-2">
            <Search size={16} className="text-blue-400" />
            <h2 className="text-sm font-semibold text-white">Skip Trace Lookup</h2>
          </div>
          <button type="button"
            onClick={onClose}
            className="p-1 text-rmpg-500 hover:text-white transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        {/* ─── Scrollable Body ────────────────────────────────── */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {/* Search Section */}
          <div className="space-y-3">
            <div>
              <label className="block text-[11px] text-rmpg-400 mb-1">Name</label>
              <input
                type="text"
                value={searchName}
                onChange={e => setSearchName(e.target.value)}
                className="w-full px-3 py-2 text-sm bg-[#0d1520] border border-[#1e3048] rounded-sm text-white placeholder-rmpg-600 focus:border-blue-500 focus:outline-none"
                placeholder="Recipient name"
              />
            </div>
            <div>
              <label className="block text-[11px] text-rmpg-400 mb-1">Address</label>
              <input
                type="text"
                value={searchAddress}
                onChange={e => setSearchAddress(e.target.value)}
                className="w-full px-3 py-2 text-sm bg-[#0d1520] border border-[#1e3048] rounded-sm text-white placeholder-rmpg-600 focus:border-blue-500 focus:outline-none"
                placeholder="Last known address"
              />
            </div>
            <button type="button"
              onClick={runLookup}
              disabled={loading || !searchName.trim()}
              className="w-full flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium bg-blue-600 hover:bg-blue-700 disabled:bg-rmpg-700 disabled:text-rmpg-500 text-white rounded-sm transition-colors"
            >
              {loading ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <Search size={14} />
              )}
              {loading ? 'Running Lookup...' : 'Run Lookup'}
            </button>
            <p className="text-[10px] text-rmpg-500 text-center">
              Skip trace lookups may incur charges
            </p>
          </div>

          {/* Error */}
          {error && (
            <div className="flex items-center gap-2 px-3 py-2 text-sm text-red-400 bg-red-900/20 border border-red-800/40 rounded-sm">
              <AlertTriangle size={14} />
              <span>{error}</span>
            </div>
          )}

          {/* Results */}
          {result && (
            <div className="space-y-4">
              {/* Result Count Badge */}
              <div className="flex items-center gap-2">
                <span className="text-[11px] px-2 py-0.5 rounded-sm bg-blue-900/40 text-blue-400 border border-blue-700/50">
                  {result.resultCount} person(s) found
                </span>
              </div>

              {/* No Results */}
              {result.resultCount === 0 && (
                <div className="text-center py-6 space-y-2">
                  <User size={32} className="text-rmpg-600 mx-auto" />
                  <p className="text-sm text-rmpg-400">No Results Found</p>
                  <p className="text-[11px] text-rmpg-500">
                    Try an alternate name or spelling
                  </p>
                </div>
              )}

              {/* Person Match Cards */}
              {result.persons && result.persons.length > 0 && (
                <div className="space-y-2">
                  {result.persons.map((person, i) => (
                    <div
                      key={i}
                      className="px-3 py-2 bg-[#0d1520] border border-[#1e3048] rounded-sm"
                    >
                      <div className="flex items-center gap-2">
                        <User size={14} className="text-rmpg-400" />
                        <span className="text-sm text-white font-medium">{person.name}</span>
                        {person.age && (
                          <span className="text-[10px] text-rmpg-500">Age {person.age}</span>
                        )}
                      </div>
                      {person.aliases && person.aliases.length > 0 && (
                        <p className="text-[10px] text-rmpg-500 mt-1 ml-5">
                          AKA: {person.aliases.join(', ')}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* Addresses */}
              {sortedAddresses.length > 0 && (
                <div className="space-y-1">
                  <h3 className="text-[11px] text-rmpg-400 font-semibold uppercase tracking-wider flex items-center gap-1">
                    <MapPin size={12} /> Addresses
                  </h3>
                  <div className="space-y-1.5">
                    {sortedAddresses.map((addr, i) => {
                      const matches = addressMatchesJob(addr, job);
                      return (
                        <div
                          key={i}
                          className={`px-3 py-2 bg-[#0d1520] border rounded-sm text-sm ${
                            matches
                              ? 'border-green-700/50 bg-green-900/10'
                              : 'border-[#1e3048]'
                          }`}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-1.5 flex-wrap">
                                {matches && (
                                  <CheckCircle2 size={12} className="text-green-400 shrink-0" />
                                )}
                                <span className="text-white text-xs break-words">
                                  {addr.address}, {addr.city}, {addr.state} {addr.zip}
                                </span>
                              </div>
                              <div className="flex items-center gap-2 mt-1">
                                <AddressTypeBadge type={addr.type} />
                                {addr.last_seen && (
                                  <span className="text-[10px] text-rmpg-500">
                                    Last seen {addr.last_seen}
                                  </span>
                                )}
                              </div>
                            </div>
                            <button type="button"
                              onClick={() => onAddToRoute(addr)}
                              className="shrink-0 flex items-center gap-1 px-2 py-1 text-[10px] font-medium bg-blue-600/20 hover:bg-blue-600/40 text-blue-400 border border-blue-700/40 rounded-sm transition-colors"
                              title="Add to Route"
                            >
                              <Plus size={10} />
                              Route
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Phone Numbers */}
              {result.phones && result.phones.length > 0 && (
                <div className="space-y-1">
                  <h3 className="text-[11px] text-rmpg-400 font-semibold uppercase tracking-wider flex items-center gap-1">
                    <Phone size={12} /> Phone Numbers
                  </h3>
                  <div className="space-y-1">
                    {result.phones.map((ph, i) => (
                      <div
                        key={i}
                        className="px-3 py-1.5 bg-[#0d1520] border border-[#1e3048] rounded-sm flex items-center justify-between"
                      >
                        <span className="text-xs text-white font-mono">{ph.number}</span>
                        <div className="flex items-center gap-2">
                          {ph.type && (
                            <span className="text-[10px] text-rmpg-500">{ph.type}</span>
                          )}
                          {ph.carrier && (
                            <span className="text-[10px] text-rmpg-600">{ph.carrier}</span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Employment */}
              {result.employment && result.employment.length > 0 && (
                <div className="space-y-1">
                  <h3 className="text-[11px] text-rmpg-400 font-semibold uppercase tracking-wider flex items-center gap-1">
                    <Briefcase size={12} /> Employment
                  </h3>
                  <div className="space-y-1">
                    {result.employment.map((emp, i) => (
                      <div
                        key={i}
                        className="px-3 py-1.5 bg-[#0d1520] border border-[#1e3048] rounded-sm"
                      >
                        <p className="text-xs text-white">{emp.employer}</p>
                        {emp.title && (
                          <p className="text-[10px] text-rmpg-500">{emp.title}</p>
                        )}
                        {emp.address && (
                          <p className="text-[10px] text-rmpg-600">{emp.address}</p>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Previous Lookups Accordion */}
          {priorTraces.length > 0 && (
            <div className="border border-[#1e3048] rounded-sm overflow-hidden">
              <button type="button"
                onClick={() => setHistoryOpen(v => !v)}
                className="w-full flex items-center justify-between px-3 py-2 text-[11px] text-rmpg-400 hover:text-rmpg-300 bg-[#0d1520] transition-colors"
              >
                <span className="font-semibold uppercase tracking-wider">
                  Previous Lookups ({priorTraces.length})
                </span>
                {historyOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
              </button>
              {historyOpen && (
                <div className="border-t border-[#1e3048] divide-y divide-[#1e3048]">
                  {priorTraces.map((trace: ServeSkipTrace) => (
                    <div key={trace.id} className="px-3 py-2 text-[11px]">
                      <div className="flex items-center justify-between">
                        <span className="text-rmpg-300">
                          {new Date(trace.created_at).toLocaleDateString()}
                        </span>
                        <span className="text-rmpg-500">{trace.search_type}</span>
                      </div>
                      <p className="text-rmpg-500 mt-0.5">
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
