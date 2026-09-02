// ============================================================
// IncidentPicker — search + select an existing incident
// ============================================================
// Inline search box + recent-incidents list. Used as a "where
// does this go?" step in the document-intake flow when the kind
// being saved requires attachment to an existing incident
// (witness_statement, info_form/supplemental_report).
//
// Search semantics:
//   - Empty search → 25 most-recent incidents
//   - Non-empty → simple substring match against incident_number,
//     type, location, narrative_summary client-side. The list
//     endpoint returns up to 1000 with status filter; for an
//     intake-clerk surface that's plenty without paging.
// Future: hook this up to /api/records/universal-search if
// operators want broader matching.

import { useEffect, useMemo, useState } from 'react';
import { Search, FileText } from 'lucide-react';
import { apiFetch } from '../hooks/useApi';
import { humanizeType, humanizeStatus } from '../utils/statusLabels';
import { coded } from '../utils/searchText';

export interface IncidentSummary {
  id: number;
  incident_number: string;
  type?: string;
  status?: string;
  location?: string;
  narrative_summary?: string | null;
  created_at?: string;
  officer_name?: string;
}

interface Props {
  selectedId: number | null;
  onSelect: (incident: IncidentSummary) => void;
  /** Limit visible candidates so the list stays scannable. */
  visibleLimit?: number;
}

export default function IncidentPicker({ selectedId, onSelect, visibleLimit = 12 }: Props) {
  const [query, setQuery] = useState('');
  const [incidents, setIncidents] = useState<IncidentSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retryTick, setRetryTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    apiFetch<any>('/incidents?archived=false')
      .then((res) => {
        if (cancelled) return;
        // /incidents returns either { data, pagination } or a bare array
        // depending on response wrapper.
        const list: IncidentSummary[] = Array.isArray(res) ? res : (res?.data ?? []);
        setIncidents(list);
        setError(null);
      })
      .catch((err: any) => {
        if (!cancelled) setError(err?.message || 'Failed to load incidents');
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [retryTick]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return incidents.slice(0, visibleLimit);
    return incidents
      .filter((i) =>
        i.incident_number?.toLowerCase().includes(q) ||
        coded(i.type, humanizeType).includes(q) ||
        i.location?.toLowerCase().includes(q) ||
        (i.narrative_summary ?? '').toLowerCase().includes(q),
      )
      .slice(0, visibleLimit);
  }, [query, incidents, visibleLimit]);

  return (
    <div className="bg-surface-base border border-border-default panel-beveled" style={{ borderRadius: 2 }}>
      <div className="px-3 py-2 border-b border-border-default flex items-center justify-between gap-2">
        <span className="text-[10px] uppercase font-semibold text-fg-muted">
          Attach To Incident <span className="text-[color:var(--sev-critical)]">*</span>
        </span>
        <span className="text-[9px] text-fg-muted">
          {loading ? 'loading…' : `${filtered.length} of ${incidents.length}`}
        </span>
      </div>
      <div className="px-3 py-2 border-b border-border-default">
        <div className="relative">
          <Search className="w-3.5 h-3.5 absolute left-2 top-1/2 -translate-y-1/2 text-fg-muted" />
          <input id="ff-incidentpicker-0"
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by incident #, type, location, narrative…"
            aria-label="Search incidents"
            className="w-full bg-surface-sunken border border-border-default pl-7 pr-2 py-1.5 text-[11px] text-rmpg-100"
            style={{ borderRadius: 2 }}
          />
        </div>
      </div>
      <div className="max-h-[280px] overflow-y-auto scrollbar-dark">
        {error && (
          <div className="px-3 py-3 text-[11px] text-[color:var(--sev-critical)] space-y-2" role="alert">
            <div>{error}</div>
            <button type="button" className="toolbar-btn" onClick={() => setRetryTick((n) => n + 1)}>Retry</button>
          </div>
        )}
        {!error && !loading && filtered.length === 0 && (
          <div className="px-3 py-3 text-[11px] text-fg-muted">
            No matching incidents. {query ? 'Try a different search.' : ''}
          </div>
        )}
        {filtered.map((i) => {
          const selected = selectedId === i.id;
          return (
            <button
              key={i.id}
              type="button"
              onClick={() => onSelect(i)}
              className={`w-full text-left px-3 py-2 border-b border-border-default hover:bg-surface-raised flex items-start gap-2 ${selected ? 'bg-surface-deep' : ''}`}
              style={{
                borderLeft: selected ? "2px solid var(--field-label-color)" : '2px solid transparent',
              }}
            >
              <FileText className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" style={{ color: selected ? "var(--field-label-color)" : "var(--text-muted)" }} />
              <div className="flex-1 min-w-0">
                <div className="text-[11px] font-mono font-semibold text-[color:var(--field-label-color)]">
                  {i.incident_number}
                </div>
                <div className="text-[10px] text-rmpg-300 mt-0.5">
                  {i.type || 'Unknown type'}
                  {i.status && <span className="ml-2 text-fg-muted">[{humanizeStatus(i.status, 'incident')}]</span>}
                  {i.officer_name && <span className="ml-2 text-fg-muted">· {i.officer_name}</span>}
                </div>
                {i.location && (
                  <div className="text-[10px] text-fg-muted mt-0.5 truncate">{i.location}</div>
                )}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
