import React, { useState, useEffect, useCallback } from 'react';
import { apiFetch } from '../hooks/useApi';
import { Search, Link, Unlink, Clock, Network, ShieldAlert, ChevronRight, Loader2, X, AlertTriangle } from 'lucide-react';
import IconButton from './IconButton';
import PanelTitleBar from './PanelTitleBar';

type ViewMode = 'timeline' | 'connections' | 'intelligence';

interface Props {
  caseId: number;
  caseNumber: string;
}

interface TimelineEvent {
  id: number;
  event_type: string;
  summary: string;
  metadata: string | null;
  created_by: number | null;
  created_at: string;
}

interface LinkedEntity {
  id: number;
  source_type: string;
  source_id: number;
  target_type: string;
  target_id: number;
  link_category: string;
  notes: string | null;
  created_at: string;
}

const VIEW_OPTIONS: { key: ViewMode; label: string; icon: React.ReactNode }[] = [
  { key: 'timeline', label: 'Timeline', icon: <Clock className="w-3.5 h-3.5" /> },
  { key: 'connections', label: 'Connections', icon: <Network className="w-3.5 h-3.5" /> },
  { key: 'intelligence', label: 'Intelligence', icon: <ShieldAlert className="w-3.5 h-3.5" /> },
];

const EVENT_TYPE_COLORS: Record<string, string> = {
  link_created: 'text-blue-400',
  link_removed: 'text-red-400',
  note_added: 'text-green-400',
  status_changed: 'text-amber-400',
  assigned: 'text-purple-400',
};

const ENTITY_TYPE_LABELS: Record<string, string> = {
  case: 'Case', person: 'Person', vehicle: 'Vehicle', incident: 'Incident',
  call: 'Call', warrant: 'Warrant', property: 'Property', evidence: 'Evidence',
};

function TimelineView({ caseId }: { caseId: number }) {
  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiFetch<TimelineEvent[]>(`/api/cases/${caseId}/timeline`)
      .then(setEvents)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [caseId]);

  if (loading) return <div className="flex items-center justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-rmpg-400" /></div>;

  if (events.length === 0) return <div className="text-rmpg-500 text-xs py-8 text-center">No timeline events recorded yet.</div>;

  return (
    <div className="space-y-1">
      {events.map((ev) => (
        <div key={ev.id} className="flex gap-2 py-1.5 border-b border-border-default last:border-0">
          <span className={`text-[10px] font-mono whitespace-nowrap mt-0.5 ${EVENT_TYPE_COLORS[ev.event_type] || 'text-rmpg-400'}`}>
            ●
          </span>
          <div className="flex-1 min-w-0">
            <div className="text-[11px] text-rmpg-200 truncate">{ev.summary}</div>
            <div className="text-[9px] text-rmpg-500 font-mono">{ev.created_at}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

function ConnectionsView({ caseId }: { caseId: number }) {
  const [links, setLinks] = useState<LinkedEntity[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiFetch<{ data: LinkedEntity[] }>(`/api/investigation/links/case/${caseId}`)
      .then((res) => setLinks(res.data || []))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [caseId]);

  if (loading) return <div className="flex items-center justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-rmpg-400" /></div>;

  if (links.length === 0) return <div className="text-rmpg-500 text-xs py-8 text-center">No linked entities found.</div>;

  return (
    <div className="space-y-1">
      {links.map((link) => {
        const isTarget = link.target_type === 'case' && link.target_id === caseId;
        const remoteType = isTarget ? link.source_type : link.target_type;
        const remoteId = isTarget ? link.source_id : link.target_id;
        return (
          <div key={link.id} className="flex items-center gap-2 py-1.5 border-b border-border-default last:border-0">
            <Link className="w-3 h-3 text-rmpg-400 shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="text-[11px] text-rmpg-200 truncate">
                {ENTITY_TYPE_LABELS[remoteType] || remoteType} #{remoteId}
              </div>
              <div className="text-[9px] text-rmpg-500">{link.link_category}</div>
            </div>
            <ChevronRight className="w-3 h-3 text-rmpg-600 shrink-0" />
          </div>
        );
      })}
    </div>
  );
}

function IntelligenceView({ caseId, caseNumber }: Props) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<{ cases: any[]; persons: any[] } | null>(null);
  const [searching, setSearching] = useState(false);

  const handleSearch = useCallback(async () => {
    if (!query.trim()) return;
    setSearching(true);
    try {
      const res = await apiFetch<{ data: { cases: any[]; persons: any[] } }>(
        `/api/investigation/search?q=${encodeURIComponent(query)}&limit=10`
      );
      setResults(res.data);
    } catch (e) {
      console.error(e);
    } finally {
      setSearching(false);
    }
  }, [query]);

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <div className="flex-1 relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-rmpg-500" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
            placeholder="Cross-reference search..."
            className="w-full bg-surface-sunken border border-border-default rounded pl-7 pr-2 py-1.5 text-[11px] text-rmpg-200 placeholder-rmpg-600 focus:outline-none focus:border-brand-500"
          />
        </div>
        <button onClick={handleSearch} disabled={searching}
          className="px-2.5 py-1.5 bg-brand-600 text-white text-[10px] font-semibold rounded hover:bg-brand-500 disabled:opacity-50">
          {searching ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Search'}
        </button>
      </div>

      {results && (
        <div className="space-y-2">
          {results.cases.length > 0 && (
            <div>
              <div className="text-[9px] font-semibold text-rmpg-400 uppercase mb-1">Cases ({results.cases.length})</div>
              {results.cases.map((c: any) => (
                <div key={c.id} className="text-[11px] text-rmpg-200 py-0.5 truncate">{c.case_number} — {c.title}</div>
              ))}
            </div>
          )}
          {results.persons.length > 0 && (
            <div>
              <div className="text-[9px] font-semibold text-rmpg-400 uppercase mb-1">Persons ({results.persons.length})</div>
              {results.persons.map((p: any) => (
                <div key={p.id} className="text-[11px] text-rmpg-200 py-0.5 truncate">{p.first_name} {p.last_name}</div>
              ))}
            </div>
          )}
          {results.cases.length === 0 && results.persons.length === 0 && (
            <div className="text-rmpg-500 text-xs py-4 text-center">No results found.</div>
          )}
        </div>
      )}
    </div>
  );
}

export function InvestigationTab({ caseId, caseNumber }: Props) {
  const [viewMode, setViewMode] = useState<ViewMode>('timeline');

  return (
    <div className="space-y-3">
      <PanelTitleBar title={`Case Intelligence — ${caseNumber}`} icon={ShieldAlert} />

      <div className="flex gap-1 border-b border-border-default">
        {VIEW_OPTIONS.map((opt) => (
          <button key={opt.key} onClick={() => setViewMode(opt.key)}
            className={`flex items-center gap-1.5 px-3 py-2 text-[10px] font-semibold uppercase transition-colors
              ${viewMode === opt.key
                ? 'text-brand-400 border-b-2 border-brand-500'
                : 'text-rmpg-500 hover:text-rmpg-300 border-b-2 border-transparent'}`}>
            {opt.icon}
            {opt.label}
          </button>
        ))}
      </div>

      <div className="min-h-[120px]">
        {viewMode === 'timeline' && <TimelineView caseId={caseId} />}
        {viewMode === 'connections' && <ConnectionsView caseId={caseId} />}
        {viewMode === 'intelligence' && <IntelligenceView caseId={caseId} caseNumber={caseNumber} />}
      </div>
    </div>
  );
}
