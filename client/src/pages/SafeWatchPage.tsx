// ============================================================
// RMPG Flex — SafeWatch triage queue
// ------------------------------------------------------------
// Backs GET/PATCH /api/safewatch-alerts and POST /:id/promote
// (src/routes/safewatch.ts).
//
// This queue holds UNVERIFIED PUBLIC INPUT pushed in by SafeWatch:
// resident-submitted community reports and aggregated third-party
// feed items. Nothing here is an RMPG record until a supervisor
// promotes it, which is why promotion is behind a confirm step and
// the unverified banner is not dismissible.
//
// Provenance (community vs feed, and which upstream source) is
// surfaced in the ROW, not just the detail panel — a dispatcher has
// to tell a resident tip from an NWS bulletin at a glance.
// ============================================================

import React, { useState, useEffect, useCallback } from 'react';
import { ShieldAlert, Loader2, AlertTriangle, X, MapPin, ArrowUpRight } from 'lucide-react';
import PanelTitleBar from '../components/PanelTitleBar';
import IconButton from '../components/IconButton';
import { apiFetch } from '../hooks/useApi';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../components/ToastProvider';
import { toDisplayLabel } from '../utils/formatters';

interface SafeWatchAlert {
  id: number;
  external_id: string;
  source_kind: 'community' | 'feed';
  source: string;
  alert_type: string | null;
  severity: 'info' | 'advisory' | 'urgent';
  headline: string;
  body: string | null;
  location_text: string | null;
  latitude: number | null;
  longitude: number | null;
  reporter_contact: string | null;
  occurred_at: string | null;
  received_at: string;
  status: 'new' | 'reviewed' | 'promoted' | 'dismissed';
  reviewed_by: number | null;
  reviewed_at: string | null;
  promoted_tip_id: number | null;
}

interface SafeWatchStats {
  new_alerts: number;
  reviewed: number;
  promoted: number;
  dismissed: number;
}

const EMPTY_STATS: SafeWatchStats = { new_alerts: 0, reviewed: 0, promoted: 0, dismissed: 0 };

// Severity hues are CAD-operational, not brand chrome — red/amber keep
// their fixed meaning across every theme variant.
const SEVERITY_COLORS: Record<string, string> = {
  urgent: 'text-[color:var(--sev-critical)]',
  advisory: 'text-[color:var(--sev-warn)]',
  info: 'text-fg-secondary',
};

const STATUS_COLORS: Record<string, string> = {
  new: '[color:var(--panel-header-color)]',
  reviewed: 'text-blue-400',
  promoted: 'text-[color:var(--sev-ok)]',
  dismissed: 'text-fg-muted',
};

const TRIAGE_WRITE_ROLES = ['admin', 'manager', 'supervisor'];

export default function SafeWatchPage() {
  const { user } = useAuth();
  const { addToast } = useToast();
  const canTriage = TRIAGE_WRITE_ROLES.includes(user?.role ?? '');

  const [alerts, setAlerts] = useState<SafeWatchAlert[]>([]);
  const [stats, setStats] = useState<SafeWatchStats>(EMPTY_STATS);
  const [loading, setLoading] = useState(true);
  const [filterStatus, setFilterStatus] = useState('');
  const [filterKind, setFilterKind] = useState('');
  const [selected, setSelected] = useState<SafeWatchAlert | null>(null);
  const [confirmPromote, setConfirmPromote] = useState(false);
  const [busy, setBusy] = useState(false);

  const fetchAlerts = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (filterStatus) params.set('status', filterStatus);
      if (filterKind) params.set('source_kind', filterKind);
      const res = await apiFetch<{ data: SafeWatchAlert[]; stats: SafeWatchStats }>(
        `/safewatch-alerts?${params}`);
      setAlerts(res.data || []);
      setStats(res.stats || EMPTY_STATS);
    } catch {
      // A failed poll must not blank the operator's screen into a crash;
      // the empty state below reads as "nothing to triage right now".
      setAlerts([]);
      setStats(EMPTY_STATS);
    } finally {
      setLoading(false);
    }
  }, [filterStatus, filterKind]);

  useEffect(() => { fetchAlerts(); }, [fetchAlerts]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (confirmPromote) setConfirmPromote(false);
      else if (selected) setSelected(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selected, confirmPromote]);

  const setStatus = async (alert: SafeWatchAlert, status: 'reviewed' | 'dismissed') => {
    setBusy(true);
    try {
      await apiFetch(`/safewatch-alerts/${alert.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      });
      addToast(`Alert marked ${status}`, 'success');
      setSelected(null);
      fetchAlerts();
    } catch {
      addToast('Could not update the alert', 'error');
    } finally {
      setBusy(false);
    }
  };

  const promote = async (alert: SafeWatchAlert) => {
    setBusy(true);
    try {
      const res = await apiFetch<{ tip_id: number; tip_number?: string; created: boolean }>(
        `/safewatch-alerts/${alert.id}/promote`, { method: 'POST' });
      addToast(
        res.created
          ? `Promoted to tip ${res.tip_number ?? res.tip_id}`
          : `Already promoted to tip ${res.tip_number ?? res.tip_id}`,
        'success');
      setConfirmPromote(false);
      setSelected(null);
      fetchAlerts();
    } catch {
      addToast('Could not promote the alert', 'error');
    } finally {
      setBusy(false);
    }
  };

  const tiles: { label: string; value: number; status: string; color: string }[] = [
    { label: 'New', value: stats.new_alerts, status: 'new', color: '[color:var(--panel-header-color)]' },
    { label: 'Reviewed', value: stats.reviewed, status: 'reviewed', color: 'text-blue-400' },
    { label: 'Promoted', value: stats.promoted, status: 'promoted', color: 'text-[color:var(--sev-ok)]' },
    { label: 'Dismissed', value: stats.dismissed, status: 'dismissed', color: 'text-fg-muted' },
  ];

  return (
    <div className="p-4 space-y-4">
      <PanelTitleBar title="SAFEWATCH ALERTS" icon={ShieldAlert} />

      {/* Not dismissible on purpose: every row here is unverified third-party
          content, and that framing has to survive a long shift. */}
      <div className="flex items-start gap-2 bg-surface-raised border border-[color:var(--sev-warn)] rounded-[2px] p-3">
        <AlertTriangle className="w-4 h-4 mt-[1px] shrink-0 text-[color:var(--sev-warn)]" />
        <p className="text-[11px] text-rmpg-100 leading-relaxed">
          <span className="font-semibold">Unverified inbound reports.</span>{' '}
          SafeWatch content is submitted by the public or relayed from third-party feeds.
          It is not an RMPG record and has not been confirmed by a unit. Verify independently
          before dispatching; promote to a tip only once it warrants follow-up.
        </p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {tiles.map(t => (
          <button
            type="button"
            key={t.label}
            onClick={() => setFilterStatus(filterStatus === t.status ? '' : t.status)}
            className={`bg-surface-raised border rounded-[2px] p-3 text-left ${
              filterStatus === t.status ? 'border-accent-silver-600' : 'border-border-default'}`}
          >
            <div className={`text-lg font-bold ${t.color}`}>{t.value}</div>
            <div className="text-[10px] text-fg-muted uppercase tracking-wider">{t.label}</div>
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <select
          value={filterStatus}
          aria-label="Filter by status"
          onChange={e => setFilterStatus(e.target.value)}
          className="bg-surface-sunken border border-border-default rounded-[2px] px-2 py-1.5 text-white text-xs focus:border-accent-silver-600 outline-none"
        >
          <option value="">All Status</option>
          {['new', 'reviewed', 'promoted', 'dismissed'].map(s => (
            <option key={s} value={s}>{toDisplayLabel(s)}</option>
          ))}
        </select>
        <select
          value={filterKind}
          aria-label="Filter by source kind"
          onChange={e => setFilterKind(e.target.value)}
          className="bg-surface-sunken border border-border-default rounded-[2px] px-2 py-1.5 text-white text-xs focus:border-accent-silver-600 outline-none"
        >
          <option value="">All Sources</option>
          <option value="community">Community Report</option>
          <option value="feed">Third-Party Feed</option>
        </select>
      </div>

      <div className="flex gap-4">
        <div className={`bg-surface-raised border border-border-default rounded-[2px] overflow-hidden ${selected ? 'flex-1' : 'w-full'}`}>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border-subtle">
                  {['Received', 'Severity', 'Source', 'Headline', 'Location', 'Status'].map(h => (
                    <th key={h} className="text-left px-3 py-[3px] text-[9px] font-semibold text-fg-muted uppercase tracking-wider">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={6} className="text-center py-8 text-fg-muted">
                    <Loader2 className="w-5 h-5 animate-spin mx-auto" />
                  </td></tr>
                ) : alerts.length === 0 ? (
                  <tr><td colSpan={6} className="text-center py-8 text-fg-muted">No SafeWatch alerts</td></tr>
                ) : alerts.map(a => (
                  <tr
                    key={a.id}
                    onClick={() => { setSelected(a); setConfirmPromote(false); }}
                    className={`border-b border-border-subtle hover:bg-surface-hover cursor-pointer ${
                      selected?.id === a.id ? 'bg-surface-hover' : ''}`}
                  >
                    <td className="px-3 py-[2px] text-fg-secondary whitespace-nowrap">{a.received_at}</td>
                    <td className={`px-3 py-[2px] font-semibold uppercase ${SEVERITY_COLORS[a.severity] || 'text-fg-secondary'}`}>
                      {a.severity}
                    </td>
                    <td className="px-3 py-[2px] text-fg-secondary whitespace-nowrap">
                      {a.source_kind === 'feed' ? `Feed · ${a.source}` : 'Community'}
                    </td>
                    <td className="px-3 py-[2px] text-rmpg-100 max-w-[320px] truncate">{a.headline}</td>
                    <td className="px-3 py-[2px] text-fg-secondary max-w-[160px] truncate">{a.location_text || '—'}</td>
                    <td className={`px-3 py-[2px] font-semibold ${STATUS_COLORS[a.status] || 'text-fg-muted'}`}>
                      {toDisplayLabel(a.status)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {selected && (
          <div
            role="region"
            aria-label="Alert detail"
            className="w-[360px] shrink-0 bg-surface-raised border border-border-default rounded-[2px] p-3 space-y-3"
          >
            <div className="flex items-start justify-between gap-2">
              <h2 className="text-xs font-semibold [color:var(--panel-header-color)] uppercase tracking-wider">
                Alert Detail
              </h2>
              <IconButton aria-label="Close alert detail" onClick={() => setSelected(null)}>
                <X className="w-3.5 h-3.5" />
              </IconButton>
            </div>

            <div>
              <div className="text-[10px] uppercase tracking-wider [color:var(--field-label-color)]">Headline</div>
              <div className="text-xs text-rmpg-100">{selected.headline}</div>
            </div>

            {selected.body && (
              <div>
                <div className="text-[10px] uppercase tracking-wider [color:var(--field-label-color)]">Report</div>
                <p className="text-xs text-rmpg-100 whitespace-pre-wrap leading-relaxed">{selected.body}</p>
              </div>
            )}

            <div className="grid grid-cols-2 gap-2">
              <div>
                <div className="text-[10px] uppercase tracking-wider [color:var(--field-label-color)]">Severity</div>
                <div className={`text-xs font-semibold uppercase ${SEVERITY_COLORS[selected.severity]}`}>{selected.severity}</div>
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-wider [color:var(--field-label-color)]">Type</div>
                <div className="text-xs text-rmpg-100">{selected.alert_type ? toDisplayLabel(selected.alert_type) : '—'}</div>
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-wider [color:var(--field-label-color)]">Source</div>
                <div className="text-xs text-rmpg-100">
                  {selected.source_kind === 'feed' ? `Third-party feed · ${selected.source}` : 'Community report'}
                </div>
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-wider [color:var(--field-label-color)]">Occurred</div>
                <div className="text-xs text-rmpg-100">{selected.occurred_at || '—'}</div>
              </div>
            </div>

            <div>
              <div className="text-[10px] uppercase tracking-wider [color:var(--field-label-color)]">Location</div>
              <div className="text-xs text-rmpg-100 flex items-center gap-1">
                {selected.latitude !== null && selected.longitude !== null && (
                  <MapPin className="w-3 h-3 text-accent-silver-500 shrink-0" />
                )}
                {selected.location_text || '—'}
                {selected.latitude !== null && selected.longitude !== null && (
                  <span className="text-fg-muted font-mono text-[10px]">
                    ({selected.latitude.toFixed(4)}, {selected.longitude.toFixed(4)})
                  </span>
                )}
              </div>
            </div>

            {selected.reporter_contact && (
              <div>
                <div className="text-[10px] uppercase tracking-wider [color:var(--field-label-color)]">Reporter Contact</div>
                <div className="text-xs text-rmpg-100 break-all">{selected.reporter_contact}</div>
              </div>
            )}

            <div>
              <div className="text-[10px] uppercase tracking-wider [color:var(--field-label-color)]">Provenance</div>
              <div className="text-[10px] text-fg-muted font-mono break-all">
                {selected.source}:{selected.external_id}
              </div>
            </div>

            {selected.promoted_tip_id && (
              <div className="text-[11px] text-[color:var(--sev-ok)] flex items-center gap-1">
                <ArrowUpRight className="w-3 h-3" /> Promoted to tip #{selected.promoted_tip_id}
              </div>
            )}

            {canTriage && selected.status !== 'promoted' && (
              <div className="flex flex-wrap gap-2 pt-1 border-t border-border-subtle">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setStatus(selected, 'reviewed')}
                  className="px-2 py-1.5 text-xs border border-border-default rounded-[2px] text-rmpg-100 disabled:opacity-40"
                >
                  Mark Reviewed
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setStatus(selected, 'dismissed')}
                  className="px-2 py-1.5 text-xs border border-border-default rounded-[2px] text-rmpg-100 disabled:opacity-40"
                >
                  Dismiss
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setConfirmPromote(true)}
                  className="px-2 py-1.5 text-xs border border-accent-silver-600 rounded-[2px] text-rmpg-100 disabled:opacity-40"
                >
                  Promote to Tip
                </button>
              </div>
            )}

            {confirmPromote && (
              <div className="border border-[color:var(--sev-warn)] rounded-[2px] p-2 space-y-2">
                <div className="text-[11px] font-semibold text-rmpg-100">Confirm promotion</div>
                <p className="text-[11px] text-fg-secondary leading-relaxed">
                  This creates a public tip record from unverified third-party content.
                  It does not create a call for service.
                </p>
                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => promote(selected)}
                    className="px-2 py-1.5 text-xs border border-accent-silver-600 rounded-[2px] text-rmpg-100 disabled:opacity-40"
                  >
                    Confirm
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => setConfirmPromote(false)}
                    className="px-2 py-1.5 text-xs border border-border-default rounded-[2px] text-fg-muted disabled:opacity-40"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
