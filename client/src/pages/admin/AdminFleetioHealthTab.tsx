// ============================================================
// RMPG Flex — Admin → Fleet.io Health tab (Fleet.io PR 4b)
// ------------------------------------------------------------
// Operator-facing dashboard for the Fleet.io integration. Consumes
// GET /api/fleetio/health (admin-only). Surfaces:
//   - Secrets configured (FLEETIO_API_KEY / _ACCOUNT_TOKEN / _WEBHOOK_SECRET)
//   - Link count (RMPG ↔ Fleet.io vehicle mappings)
//   - Queue counts by direction × status
//   - Per-resource breakdown
//   - Last inbound webhook timestamp (warn if > 2h during business hours)
//   - Last outbound completion + last failure
//   - Recent 20 events timeline
//   - Unresolved conflicts list with one-click resolution buttons
//
// The conflict-resolution flow POSTs /api/fleetio/conflicts/:id/resolve.
// Picks: local_wins / remote_wins / manual.
//
// Reload button + 30 s auto-refresh so the dashboard reflects the */30
// cron tick within seconds of it firing.
// ============================================================
import { useEffect, useState, useCallback } from 'react';
import { apiFetch } from '../../hooks/useApi';
import { CheckCircle2, XCircle, AlertTriangle, RotateCw, Clock, Upload, Download } from 'lucide-react';
import FleetioConflictBadge from '../../components/FleetioConflictBadge';
import { toDisplayLabel } from '../../utils/formatters';

interface HealthResponse {
  links_total: number;
  secrets_configured: {
    FLEETIO_API_KEY: boolean;
    FLEETIO_ACCOUNT_TOKEN: boolean;
    FLEETIO_WEBHOOK_SECRET: boolean;
  };
  event_counts: { direction: string; status: string; n: number }[];
  attempt_histogram: { attempts: number; n: number }[];
  last_inbound_at: string | null;
  last_outbound_completed_at: string | null;
  last_failure: { created_at: string; error: string | null } | null;
  recent_events: Record<string, unknown>[];
  unresolved_conflicts: Record<string, unknown>[];
  by_resource: { resource: string; status: string; n: number }[];
  error?: string;
}

const ZERO_HEALTH: HealthResponse = {
  links_total: 0,
  secrets_configured: { FLEETIO_API_KEY: false, FLEETIO_ACCOUNT_TOKEN: false, FLEETIO_WEBHOOK_SECRET: false },
  event_counts: [],
  attempt_histogram: [],
  last_inbound_at: null,
  last_outbound_completed_at: null,
  last_failure: null,
  recent_events: [],
  unresolved_conflicts: [],
  by_resource: [],
};

export default function AdminFleetioHealthTab() {
  const [health, setHealth] = useState<HealthResponse>(ZERO_HEALTH);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [resolving, setResolving] = useState<number | null>(null);
  const [seeding, setSeeding] = useState(false);
  const [seedResult, setSeedResult] = useState<string | null>(null);
  const [pulling, setPulling] = useState(false);
  const [pullResult, setPullResult] = useState<string | null>(null);
  const [retrying, setRetrying] = useState<number | null>(null);

  const fetchHealth = useCallback(() => {
    setErr(null);
    apiFetch<HealthResponse>('/fleetio/health')
      .then((r) => { setHealth(r ?? ZERO_HEALTH); setLoading(false); })
      .catch((e) => { setErr(e instanceof Error ? e.message : 'Failed to load'); setLoading(false); });
  }, []);

  useEffect(() => {
    let cancelled = false;
    setErr(null);
    apiFetch<HealthResponse>('/fleetio/health')
      .then((r) => { if (!cancelled) { setHealth(r ?? ZERO_HEALTH); setLoading(false); } })
      .catch((e) => { if (!cancelled) { setErr(e instanceof Error ? e.message : 'Failed to load'); setLoading(false); } });
    const t = setInterval(fetchHealth, 30_000);
    return () => { cancelled = true; clearInterval(t); };
  }, [fetchHealth]);

  const runSeed = () => {
    if (!confirm('Push every fleet_vehicles row without a fleetio_links mapping to Fleet.io? This is idempotent — vehicles already linked are skipped.')) return;
    setSeeding(true);
    setSeedResult(null);
    apiFetch<{ seeded?: number; skipped?: number; errors?: number; message?: string }>(
      '/fleetio/seed',
      { method: 'POST' },
    )
      .then((r) => {
        setSeeding(false);
        const parts: string[] = [];
        if (typeof r?.seeded === 'number') parts.push(`seeded ${r.seeded}`);
        if (typeof r?.skipped === 'number') parts.push(`skipped ${r.skipped}`);
        if (typeof r?.errors === 'number' && r.errors > 0) parts.push(`errors ${r.errors}`);
        setSeedResult(parts.length ? parts.join(' · ') : (r?.message ?? 'OK'));
        fetchHealth();
      })
      .catch((e) => {
        setSeeding(false);
        setSeedResult(`failed: ${e instanceof Error ? e.message : 'unknown'}`);
      });
  };

  const runPull = () => {
    if (!confirm('Pull Fleet.io’s existing vehicle roster into fleet_vehicles? Vehicles matching by VIN/plate/name are linked (not duplicated); vehicles new to RMPG are created.')) return;
    setPulling(true);
    setPullResult(null);
    apiFetch<{ created?: number; linked_existing?: number; already_linked?: number; skipped?: number; conflicts?: number; error?: string }>(
      '/fleetio/pull',
      { method: 'POST' },
    )
      .then((r) => {
        setPulling(false);
        const parts: string[] = [];
        if (typeof r?.created === 'number') parts.push(`created ${r.created}`);
        if (typeof r?.linked_existing === 'number') parts.push(`linked ${r.linked_existing}`);
        if (typeof r?.already_linked === 'number') parts.push(`already linked ${r.already_linked}`);
        if (typeof r?.skipped === 'number' && r.skipped > 0) parts.push(`skipped ${r.skipped}`);
        if (typeof r?.conflicts === 'number' && r.conflicts > 0) parts.push(`⚠ ${r.conflicts} conflict${r.conflicts === 1 ? '' : 's'} — see below`);
        setPullResult(parts.length ? parts.join(' · ') : (r?.error ?? 'OK'));
        fetchHealth();
      })
      .catch((e) => {
        setPulling(false);
        setPullResult(`failed: ${e instanceof Error ? e.message : 'unknown'}`);
      });
  };

  const retryEvent = (id: number) => {
    setRetrying(id);
    apiFetch<{ success: boolean }>(`/fleetio/events/${id}/retry`, { method: 'POST' })
      .then(() => { setRetrying(null); fetchHealth(); })
      .catch((e) => {
        setRetrying(null);
        alert(`Failed to retry: ${e instanceof Error ? e.message : 'unknown error'}`);
      });
  };

  const resolveConflict = (id: number, resolution: 'local_wins' | 'remote_wins' | 'manual') => {
    setResolving(id);
    apiFetch<{ success: boolean }>(`/fleetio/conflicts/${id}/resolve`, {
      method: 'POST',
      body: JSON.stringify({ resolution }),
    })
      .then(() => { setResolving(null); fetchHealth(); })
      .catch((e) => {
        setResolving(null);
        alert(`Failed to resolve: ${e instanceof Error ? e.message : 'unknown error'}`);
      });
  };

  if (loading) return <div className="p-4 text-sm text-rmpg-400">Loading Fleet.io health…</div>;
  if (err) return <div className="p-4 text-sm text-red-400">Error: {err}</div>;

  const eventLookup = (direction: string, status: string) =>
    health.event_counts.find((e) => e.direction === direction && e.status === status)?.n ?? 0;
  const totalOutboundPending = eventLookup('outbound', 'pending');
  const totalOutboundCompleted = eventLookup('outbound', 'completed');
  const totalOutboundFailed = eventLookup('outbound', 'failed');
  const totalInboundCompleted = eventLookup('inbound', 'completed');
  const totalInboundPending = eventLookup('inbound', 'pending');

  return (
    <div className="p-4 space-y-4">
      <header className="flex items-baseline justify-between">
        <div>
          <h2 className="text-base font-semibold text-rmpg-100">Fleet.io Integration Health</h2>
          <p className="text-xs text-rmpg-400 max-w-prose">
            Live view of the Fleet.io sync queue, recent activity, and unresolved conflicts.
            Auto-refreshes every 30 s.
          </p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={runPull}
              disabled={pulling}
              className="inline-flex items-center gap-1 text-xs px-2 py-1 bg-brand-400 text-rmpg-950 rounded-sm hover:brightness-110 disabled:opacity-50"
              aria-label="Pull vehicles from Fleet.io"
              title="Reconcile Fleet.io's existing vehicle roster into fleet_vehicles — matches link, new-to-RMPG vehicles are created"
            >
              <Download className="w-3 h-3" /> {pulling ? 'Pulling…' : 'Pull vehicles'}
            </button>
            <button
              type="button"
              onClick={runSeed}
              disabled={seeding}
              className="inline-flex items-center gap-1 text-xs px-2 py-1 bg-brand-400 text-rmpg-950 rounded-sm hover:brightness-110 disabled:opacity-50"
              aria-label="Seed Fleet.io with all unlinked vehicles"
              title="Push every fleet_vehicles row that lacks a fleetio_links mapping to Fleet.io (idempotent)"
            >
              <Upload className="w-3 h-3" /> {seeding ? 'Seeding…' : 'Seed vehicles'}
            </button>
            <button
              type="button"
              onClick={fetchHealth}
              className="inline-flex items-center gap-1 text-xs px-2 py-1 border border-rmpg-700 rounded-sm hover:bg-rmpg-800"
              aria-label="Reload health snapshot"
            >
              <RotateCw className="w-3 h-3" /> Reload
            </button>
          </div>
          {pullResult ? (
            <span className={`text-[10px] ${pullResult.startsWith('failed') ? 'text-red-400' : pullResult.includes('⚠') ? 'text-amber-400' : 'text-emerald-400'}`}>
              {pullResult}
            </span>
          ) : null}
          {seedResult ? (
            <span className={`text-[10px] ${seedResult.startsWith('failed') ? 'text-red-400' : 'text-emerald-400'}`}>
              {seedResult}
            </span>
          ) : null}
        </div>
      </header>

      {/* Secrets row */}
      <section>
        <h3 className="text-[10px] uppercase tracking-wide text-rmpg-500 mb-1">Worker Secrets</h3>
        <div className="grid grid-cols-3 gap-2">
          <SecretCell label="FLEETIO_API_KEY" set={health.secrets_configured.FLEETIO_API_KEY} />
          <SecretCell label="FLEETIO_ACCOUNT_TOKEN" set={health.secrets_configured.FLEETIO_ACCOUNT_TOKEN} />
          <SecretCell label="FLEETIO_WEBHOOK_SECRET" set={health.secrets_configured.FLEETIO_WEBHOOK_SECRET} />
        </div>
        {(!health.secrets_configured.FLEETIO_API_KEY ||
          !health.secrets_configured.FLEETIO_ACCOUNT_TOKEN ||
          !health.secrets_configured.FLEETIO_WEBHOOK_SECRET) && (
          <div className="mt-2 text-[10px] text-amber-400">
            ⚠ Integration is in setup mode — see the
            <a className="underline ml-1" href="https://github.com/rmpgutah/rmpg-flex/blob/main/docs/superpowers/runbooks/fleetio-integration-setup.md" target="_blank" rel="noopener">setup runbook</a>
            {' '}for the wrangler secret-put commands.
          </div>
        )}
      </section>

      {/* Queue counts */}
      <section>
        <h3 className="text-[10px] uppercase tracking-wide text-rmpg-500 mb-1">Queue</h3>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
          <KpiCell label="Links" value={health.links_total} />
          <KpiCell label="Outbound pending" value={totalOutboundPending} tone={totalOutboundPending > 50 ? 'warn' : 'normal'} />
          <KpiCell label="Outbound completed" value={totalOutboundCompleted} tone="ok" />
          <KpiCell label="Outbound failed" value={totalOutboundFailed} tone={totalOutboundFailed > 0 ? 'err' : 'normal'} />
          <KpiCell label="Inbound completed" value={totalInboundCompleted} tone="ok" />
          <KpiCell label="Inbound pending" value={totalInboundPending} tone={totalInboundPending > 10 ? 'warn' : 'normal'} />
        </div>
      </section>

      {/* Last activity */}
      <section className="grid grid-cols-1 lg:grid-cols-3 gap-2">
        <TimestampCell label="Last inbound webhook" iso={health.last_inbound_at} />
        <TimestampCell label="Last outbound completed" iso={health.last_outbound_completed_at} />
        <div className="rounded-sm border border-rmpg-700 bg-surface-raised p-2">
          <div className="text-[9px] uppercase tracking-wide text-rmpg-500">Last failure</div>
          {health.last_failure ? (
            <>
              <div className="text-[10px] text-red-400">{health.last_failure.created_at}</div>
              <div className="text-[10px] text-red-300 mt-0.5 break-all line-clamp-2" title={health.last_failure.error ?? ''}>
                {health.last_failure.error ?? '(no message)'}
              </div>
            </>
          ) : (
            <div className="text-[10px] text-emerald-400 mt-1">No failures.</div>
          )}
        </div>
      </section>

      {/* Per-resource breakdown */}
      {health.by_resource.length > 0 && (
        <section>
          <h3 className="text-[10px] uppercase tracking-wide text-rmpg-500 mb-1">Per-resource breakdown</h3>
          <table className="w-full text-[11px]">
            <thead>
              <tr className="text-left text-rmpg-400 border-b border-rmpg-700">
                <th className="py-1 pr-2">Resource</th>
                <th className="py-1 px-2">Status</th>
                <th className="py-1 pl-2 text-right">Count</th>
              </tr>
            </thead>
            <tbody>
              {health.by_resource.map((r, i) => (
                <tr key={`${r.resource}-${r.status}-${i}`} className="border-b border-rmpg-800/40">
                  <td className="py-1 pr-2 text-rmpg-100">{toDisplayLabel(r.resource)}</td>
                  <td className="py-1 px-2"><StatusBadge status={r.status} /></td>
                  <td className="py-1 pl-2 text-right text-rmpg-100">{r.n.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {/* Recent events */}
      {health.recent_events.length > 0 && (
        <section>
          <h3 className="text-[10px] uppercase tracking-wide text-rmpg-500 mb-1">
            Recent events (last {health.recent_events.length})
          </h3>
          <table className="w-full text-[10px]">
            <thead>
              <tr className="text-left text-rmpg-400 border-b border-rmpg-700">
                <th className="py-1 pr-2">When</th>
                <th className="py-1 px-2">Direction</th>
                <th className="py-1 px-2">Resource</th>
                <th className="py-1 px-2">Action</th>
                <th className="py-1 px-2">Status</th>
                <th className="py-1 px-2 text-right">Attempts</th>
                <th className="py-1 pl-2">Error</th>
                <th className="py-1 pl-2" />
              </tr>
            </thead>
            <tbody>
              {health.recent_events.map((e) => (
                <tr key={e.id as number} className="border-b border-rmpg-800/40 align-top">
                  <td className="py-1 pr-2 font-mono text-rmpg-300">{relTime(e.created_at as string)}</td>
                  <td className="py-1 px-2 text-rmpg-100">{toDisplayLabel(e.direction as string)}</td>
                  <td className="py-1 px-2 text-rmpg-100">{toDisplayLabel(e.resource as string)}</td>
                  <td className="py-1 px-2 text-rmpg-100">{toDisplayLabel(e.action as string)}</td>
                  <td className="py-1 px-2"><StatusBadge status={e.status as string} /></td>
                  <td className="py-1 px-2 text-right text-rmpg-300">{e.attempts as number}</td>
                  <td className="py-1 pl-2 text-red-300 max-w-[280px] truncate" title={(e.error as string) ?? ''}>
                    {(e.error as string) ?? ''}
                  </td>
                  <td className="py-1 pl-2 text-right whitespace-nowrap">
                    {e.status === 'failed' && e.direction === 'outbound' && (
                      // A PERMANENT failure is Fleet.io rejecting the data itself, so
                      // retrying it is guaranteed to fail (the API returns 409). Offer
                      // the real remedy instead of a button that re-arms the loop.
                      isPermanentError(e.error as string | null) ? (
                        <span
                          className="text-[9px] text-amber-400"
                          title="Fleet.io rejected this data. Correct the source record in RMPG — saving it queues a fresh event."
                        >
                          Fix source record
                        </span>
                      ) : (
                        <button
                          type="button"
                          disabled={retrying === (e.id as number)}
                          onClick={() => retryEvent(e.id as number)}
                          className="text-[9px] px-1.5 py-0.5 border border-rmpg-700 rounded-sm hover:bg-rmpg-800 disabled:opacity-50"
                          aria-label="Retry failed event"
                        >
                          {retrying === (e.id as number) ? 'Retrying…' : 'Retry'}
                        </button>
                      )
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {/* Unresolved conflicts */}
      <section>
        <h3 className="text-[10px] uppercase tracking-wide text-rmpg-500 mb-1">
          Unresolved conflicts ({health.unresolved_conflicts.length})
        </h3>
        {health.unresolved_conflicts.length === 0 ? (
          <div className="text-[10px] text-emerald-400 px-2 py-1 border border-emerald-500/40 rounded-sm bg-emerald-500/10">
            <CheckCircle2 className="w-3 h-3 inline mr-1" /> No conflicts pending resolution.
          </div>
        ) : (
          <table className="w-full text-[10px]">
            <thead>
              <tr className="text-left text-rmpg-400 border-b border-rmpg-700">
                <th className="py-1 pr-2">When</th>
                <th className="py-1 px-2">Resource</th>
                <th className="py-1 px-2">Row</th>
                <th className="py-1 px-2">Conflict</th>
                <th className="py-1 pl-2 text-right">Resolve</th>
              </tr>
            </thead>
            <tbody>
              {health.unresolved_conflicts.map((c) => (
                <tr key={c.id as number} className="border-b border-rmpg-800/40 align-top">
                  <td className="py-1 pr-2 font-mono text-rmpg-300">{relTime(c.created_at as string)}</td>
                  <td className="py-1 px-2 text-rmpg-100">{toDisplayLabel(c.rmpg_table as string)}</td>
                  <td className="py-1 px-2 text-rmpg-100">#{c.rmpg_id as number}</td>
                  <td className="py-1 px-2">
                    <FleetioConflictBadge
                      conflict={{
                        id: c.id as number,
                        field: c.field as string,
                        local_value: c.local_value as string | null,
                        remote_value: c.remote_value as string | null,
                      }}
                      onResolved={fetchHealth}
                    />
                  </td>
                  <td className="py-1 pl-2 text-right whitespace-nowrap">
                    <button
                      type="button"
                      disabled={resolving === (c.id as number)}
                      onClick={() => resolveConflict(c.id as number, 'local_wins')}
                      className="text-[9px] px-1.5 py-0.5 mx-0.5 border border-rmpg-700 rounded-sm hover:bg-rmpg-800 disabled:opacity-50"
                    >
                      Keep local
                    </button>
                    <button
                      type="button"
                      disabled={resolving === (c.id as number)}
                      onClick={() => resolveConflict(c.id as number, 'remote_wins')}
                      className="text-[9px] px-1.5 py-0.5 mx-0.5 border border-rmpg-700 rounded-sm hover:bg-rmpg-800 disabled:opacity-50"
                    >
                      Use remote
                    </button>
                    <button
                      type="button"
                      disabled={resolving === (c.id as number)}
                      onClick={() => resolveConflict(c.id as number, 'manual')}
                      className="text-[9px] px-1.5 py-0.5 mx-0.5 border border-rmpg-700 rounded-sm hover:bg-rmpg-800 disabled:opacity-50"
                    >
                      Mark manual
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}

// ─── helpers ──────────────────────────────────────────────

function SecretCell({ label, set }: { label: string; set: boolean }) {
  const Icon = set ? CheckCircle2 : XCircle;
  return (
    <div className={`rounded-sm border px-3 py-2 ${set ? 'border-emerald-500/40 bg-emerald-500/5' : 'border-amber-500/40 bg-amber-500/5'}`}>
      <div className="flex items-center justify-between">
        <span className="font-mono text-[10px] text-rmpg-300">{label}</span>
        <Icon className={`w-3.5 h-3.5 ${set ? 'text-emerald-400' : 'text-amber-400'}`} />
      </div>
      <div className={`text-[9px] mt-0.5 ${set ? 'text-emerald-300' : 'text-amber-300'}`}>
        {set ? 'configured' : 'not set'}
      </div>
    </div>
  );
}

function KpiCell({ label, value, tone = 'normal' }: { label: string; value: number; tone?: 'normal' | 'ok' | 'warn' | 'err' }) {
  const color =
    tone === 'ok' ? 'text-emerald-400' :
    tone === 'warn' ? 'text-amber-400' :
    tone === 'err' ? 'text-red-400' :
    'text-rmpg-100';
  return (
    <div className="rounded-sm border border-rmpg-700 bg-surface-raised px-3 py-2">
      <div className="text-[9px] uppercase tracking-wide text-rmpg-500">{label}</div>
      <div className={`text-base font-semibold mt-0.5 ${color}`}>{value.toLocaleString()}</div>
    </div>
  );
}

function TimestampCell({ label, iso }: { label: string; iso: string | null }) {
  const stale = iso ? (Date.now() - new Date(iso + 'Z').getTime() > 2 * 60 * 60 * 1000) : false;
  return (
    <div className="rounded-sm border border-rmpg-700 bg-surface-raised p-2">
      <div className="text-[9px] uppercase tracking-wide text-rmpg-500">{label}</div>
      {iso ? (
        <>
          <div className={`text-[10px] font-mono ${stale ? 'text-amber-400' : 'text-rmpg-100'}`}>
            <Clock className="w-2.5 h-2.5 inline mr-1" /> {iso}
          </div>
          <div className={`text-[9px] mt-0.5 ${stale ? 'text-amber-400' : 'text-rmpg-400'}`}>
            {stale ? `⚠ ${relTime(iso)} ago (>2h)` : `${relTime(iso)} ago`}
          </div>
        </>
      ) : (
        <div className="text-[10px] text-rmpg-400 mt-1">No data yet.</div>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const tone =
    status === 'completed' ? 'bg-emerald-500/15 text-emerald-300' :
    status === 'pending' ? 'bg-amber-500/15 text-amber-300' :
    status === 'failed' ? 'bg-red-500/15 text-red-300' :
    status === 'processing' ? 'bg-blue-500/15 text-blue-300' :
    'bg-rmpg-700/40 text-rmpg-300';
  return (
    <span className={`px-1.5 py-0.5 rounded-sm text-[9px] uppercase tracking-wide ${tone}`}>
      {status}
    </span>
  );
}

/**
 * Mirrors `PERMANENT_ERROR_PREFIX` in src/utils/fleetio/sync.ts — the marker the
 * sync engine stamps onto `fleetio_events.error` when Fleet.io returned a 4xx,
 * i.e. rejected the payload itself rather than failing transiently. Kept as a
 * literal because the Worker and the SPA share no build; the prefix is asserted
 * on both sides so a rename can't silently un-hide the Retry button.
 */
export const PERMANENT_ERROR_PREFIX = 'PERMANENT: ';

export function isPermanentError(error: string | null | undefined): boolean {
  return typeof error === 'string' && error.startsWith(PERMANENT_ERROR_PREFIX);
}

/** Coarse human delta: "Just now", "5m", "2h", "3d". Pure for tests. */
export function relTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  // SQLite datetime('now') returns "YYYY-MM-DD HH:MM:SS" without timezone;
  // treat as UTC. Z forces JS to parse as UTC.
  const t = new Date(iso.includes('T') ? iso : iso + 'Z').getTime();
  if (!Number.isFinite(t)) return '—';
  const diff = Math.max(0, Date.now() - t);
  if (diff < 60_000) return 'just now';
  if (diff < 60 * 60_000) return `${Math.floor(diff / 60_000)}m`;
  if (diff < 24 * 60 * 60_000) return `${Math.floor(diff / (60 * 60_000))}h`;
  return `${Math.floor(diff / (24 * 60 * 60_000))}d`;
}
