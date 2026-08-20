import { useState, useEffect, useCallback } from 'react';
import {
  X, Search, Loader2, CheckCircle2,
  ChevronDown, ChevronRight, AlertTriangle,
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
  }, [isOpen, job.id]);

  const runLookup = useCallback(async () => {
    setLoading(true);
    setError(null);
    setNotice(null);
    try {
      // /api/process-server is the same router as /api/serve — neither
      // defines a skip-trace route. The real handler lives at
      // /api/serve-intake/:id/skip-trace, but it only logs the search
      // (serve_skip_traces audit row) — there's no automated third-party
      // vendor lookup wired up yet (still listed as deferred in
      // src/routes/serve.ts's header comment), so it never returns
      // persons/phones/addresses/employment. Log the search instead of
      // pretending a lookup ran, rather than 404ing outright.
      const data = await apiFetch<{ success: boolean; id: number }>(
        `/api/serve-intake/${job.id}/skip-trace`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ search_type: 'manual', search_query: `${searchName} ${searchAddress}`.trim() }),
        },
      );
      if (data?.success) {
        setNotice('Search logged. Automated skip-trace lookup isn’t available yet — use manual research methods and add any found addresses below.');
      } else {
        setError('Skip trace lookup failed');
      }
      onLookupComplete?.();
    } catch (err: any) {
      setError(err?.message || 'Skip trace lookup failed');
    } finally {
      setLoading(false);
    }
  }, [job.id, searchName, searchAddress, onLookupComplete]);

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
              disabled={loading || !searchName.trim()}
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
              Logs a manual search attempt — no automated vendor lookup is wired up yet
            </p>
          </div>

          {/* Error */}
          {error && (
            <div className="flex items-center gap-2 px-3 py-2 text-sm text-red-400 bg-red-900/20 border border-red-800/40 rounded-sm">
              <AlertTriangle size={14} />
              <span>{error}</span>
            </div>
          )}

          {/* Notice (search logged, no automated vendor lookup available) */}
          {notice && (
            <div className="flex items-center gap-2 px-3 py-2 text-sm text-accent-silver-300 bg-accent-silver-400/10 border border-accent-silver-400/30 rounded-sm">
              <CheckCircle2 size={14} />
              <span>{notice}</span>
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
