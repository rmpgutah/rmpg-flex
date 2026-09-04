// Renders the autolinker + manual-link output for a given record
// (CFS call, incident, warrant, person). Drop into any record-detail
// panel — talks to /api/email/links/by-entity/:type/:id.
//
// The endpoint joins email_messages so we get subject/from/date in one
// roundtrip; no second fetch needed per email.

import { useEffect, useState, useCallback } from 'react';
import { Mail, Loader2, RefreshCw } from 'lucide-react';
import CollapsibleSection from './CollapsibleSection';
import { apiFetch } from '../hooks/useApi';
import { parseTimestamp } from '../utils/dateUtils';
import { formatEnumValue } from '../utils/formatters';

type EntityType = 'cfs' | 'call' | 'incident' | 'warrant' | 'person';

interface LinkedEmail {
  id: number;
  email_graph_id: string;
  subject: string | null;
  from_address: string | null;
  from_name: string | null;
  received_at: string | null;
  link_type: string | null;
  source: string;
  entity_ref: string | null;
}

interface Props {
  entityType: EntityType;
  /** Accept string OR number — IncidentsPage uses string ids, others use number. */
  entityId: number | string;
  /** Optional callback to navigate to the EmailPage with a specific message preselected. */
  onOpenEmail?: (graphId: string) => void;
  /** Section title override; defaults to "Linked Emails". */
  title?: string;
  defaultOpen?: boolean;
}

function fmtDate(s: string | null): string {
  if (!s) return '';
  const d = parseTimestamp(s);
  if (Number.isNaN(d.getTime())) return s.slice(0, 16);
  return d.toLocaleString('en-US', { timeZone: 'America/Denver', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export default function LinkedEmailsSection({ entityType, entityId, onOpenEmail, title = 'Linked Emails', defaultOpen = false }: Props) {
  const [links, setLinks] = useState<LinkedEmail[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchLinks = useCallback(async () => {
    if (!entityId) return;
    setLoading(true);
    setError(null);
    try {
      const data = await apiFetch<{ links: LinkedEmail[] }>(`/email/links/by-entity/${entityType}/${encodeURIComponent(String(entityId))}`);
      setLinks(data?.links || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
      setLinks([]);
    } finally {
      setLoading(false);
    }
  }, [entityType, entityId]);

  useEffect(() => { fetchLinks(); }, [fetchLinks]);

  const handleOpen = (graphId: string) => {
    if (onOpenEmail) onOpenEmail(graphId);
    else window.open(`/email?msg=${encodeURIComponent(graphId)}`, '_blank', 'noopener');
  };

  return (
    <CollapsibleSection
      title={title}
      icon={Mail}
      count={links.length}
      defaultOpen={defaultOpen}
      actions={
        <button
          type="button"
          onClick={fetchLinks}
          className="toolbar-btn"
          aria-label="Refresh linked emails"
          title="Refresh"
        >
          {loading ? <Loader2 className="w-3 h-3 animate-spin" role="status" aria-label="Loading" /> : <RefreshCw className="w-3 h-3" />}
        </button>
      }
    >
      {error && (
        <p className="text-[10px] text-red-400 px-1 pb-1">{error}</p>
      )}
      {!error && !loading && links.length === 0 && (
        <p className="text-xs text-fg-muted">No emails linked yet. The cron poller auto-links inbound mail referencing this record.</p>
      )}
      {links.length > 0 && (
        <div className="space-y-1">
          {links.map((l) => (
            <button
              key={l.id}
              type="button"
              onClick={() => handleOpen(l.email_graph_id)}
              className="w-full text-left flex items-start gap-2 px-2 py-1.5 bg-surface-sunken hover:bg-surface-raised border border-rmpg-700 transition-colors group"
            >
              <Mail className="w-3.5 h-3.5 text-brand-400 mt-0.5 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-rmpg-100 font-medium min-w-0 truncate flex-1">
                    {l.subject || '(no subject)'}
                  </span>
                  {l.source === 'autolinker' && (
                    <span className="text-[8px] uppercase font-bold px-1 py-0.5 bg-amber-900/40 text-amber-300 border border-amber-700/40 rounded-sm">
                      auto
                    </span>
                  )}
                  {l.link_type && l.source !== 'autolinker' && (
                    <span className="text-[8px] uppercase font-bold px-1 py-0.5 bg-surface-base text-rmpg-300 border border-rmpg-700 rounded-sm">
                      {formatEnumValue(l.link_type)}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2 text-[10px] text-rmpg-400 mt-0.5">
                  <span className="min-w-0 truncate flex-1">
                    {l.from_name || l.from_address || 'Unknown sender'}
                    {l.from_name && l.from_address && (
                      <span className="text-fg-muted"> &lt;{l.from_address}&gt;</span>
                    )}
                  </span>
                  <span className="text-fg-muted flex-shrink-0">{fmtDate(l.received_at)}</span>
                </div>
              </div>
            </button>
          ))}
        </div>
      )}
    </CollapsibleSection>
  );
}
