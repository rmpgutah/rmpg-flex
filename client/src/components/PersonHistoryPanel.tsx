import React, { useState, useEffect } from 'react';
import {
  Shield,
  FileText,
  Radio,
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Loader2,
  Scale,
  AlertOctagon,
  FileWarning,
} from 'lucide-react';
import { apiFetch } from '../hooks/useApi';
import { toDisplayLabel } from '../utils/formatters';
import StatusBadge from './StatusBadge';

// ── Types ──────────────────────────────────────────

interface WarrantRecord {
  id: number;
  warrant_number: string | null;
  type: string;
  status: string;
  charge_description: string;
  offense_level: string | null;
  statute_citation: string | null;
  date_issued: string | null;
  expires_at: string | null;
}

interface IncidentRecord {
  id: number;
  incident_number: string | null;
  incident_type: string;
  status: string;
  priority: string | null;
  description: string | null;
  created_at: string | null;
  role: string;
}

interface CallRecord {
  id: number;
  call_number: string | null;
  incident_type: string;
  priority: string | null;
  status: string;
  location: string | null;
  created_at: string | null;
}

interface CitationRecord {
  id: number;
  citation_number: string;
  type: string;
  status: string;
  statute_citation: string | null;
  violation_description: string | null;
  offense_level: string | null;
  fine_amount: number | null;
  violation_date: string | null;
  violation_time: string | null;
  location: string | null;
  issuing_officer_name: string | null;
  court_date: string | null;
  court_name: string | null;
}

interface SystemHistorySummary {
  total_warrants: number;
  active_warrants: number;
  total_incidents: number;
  total_calls: number;
  total_citations: number;
  active_citations: number;
}

interface SystemHistoryResponse {
  warrants: WarrantRecord[];
  incidents: IncidentRecord[];
  calls: CallRecord[];
  citations: CitationRecord[];
  bolo_active: boolean;
  summary: SystemHistorySummary;
}

interface PersonHistoryPanelProps {
  personId: string;
  personName: string;
  isExpanded?: boolean;
}

// ── Helpers ────────────────────────────────────────

function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return '--';
  try {
    return new Date(dateStr).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return dateStr;
  }
}

function formatRole(role: string): string {
  return (role || '').replace(/_/g, ' ').toUpperCase();
}

function formatType(type: string): string {
  return (type || '').replace(/_/g, ' ');
}

const OFFENSE_LEVEL_CLASSES: Record<string, string> = {
  felony: 'bg-red-900/60 text-red-300 border-red-700/50',
  misdemeanor: 'bg-amber-900/50 text-amber-400 border-amber-700/50',
  infraction: 'bg-rmpg-700/50 text-rmpg-300 border-rmpg-600/50',
  civil: 'bg-brand-900/50 text-brand-400 border-brand-700/50',
};

const WARRANT_STATUS_CLASSES: Record<string, string> = {
  active: 'bg-red-900/60 text-red-300 border-red-600/60',
  served: 'bg-green-900/50 text-green-400 border-green-700/50',
  recalled: 'bg-rmpg-700/50 text-rmpg-300 border-rmpg-600/50',
  expired: 'bg-rmpg-700/50 text-rmpg-400 border-rmpg-600/50',
  quashed: 'bg-rmpg-700/50 text-rmpg-400 border-rmpg-600/50',
};

const CITATION_STATUS_CLASSES: Record<string, string> = {
  issued: 'bg-blue-900/60 text-blue-300 border-blue-600/60',
  paid: 'bg-green-900/50 text-green-400 border-green-700/50',
  contested: 'bg-amber-900/50 text-amber-300 border-amber-700/50',
  dismissed: 'bg-rmpg-700/50 text-rmpg-300 border-rmpg-600/50',
  warrant_issued: 'bg-red-900/60 text-red-300 border-red-600/60',
  voided: 'bg-rmpg-700/50 text-rmpg-400 border-rmpg-600/50 line-through',
};

const CITATION_TYPE_CLASSES: Record<string, string> = {
  traffic: 'bg-orange-900/40 text-orange-300 border-orange-700/50',
  criminal: 'bg-red-900/50 text-red-300 border-red-700/50',
  parking: 'bg-amber-900/40 text-amber-300 border-amber-700/50',
  warning: 'bg-blue-900/40 text-blue-300 border-blue-700/50',
};

// ── Component ──────────────────────────────────────

export default function PersonHistoryPanel({
  personId,
  personName,
  isExpanded: initialExpanded = true,
}: PersonHistoryPanelProps) {
  const [expanded, setExpanded] = useState(initialExpanded);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<SystemHistoryResponse | null>(null);

  // Section collapse states
  const [warrantsOpen, setWarrantsOpen] = useState(true);
  const [citationsOpen, setCitationsOpen] = useState(true);
  const [incidentsOpen, setIncidentsOpen] = useState(true);
  const [callsOpen, setCallsOpen] = useState(true);

  useEffect(() => {
    if (!personId) return;
    setLoading(true);
    setError(null);
    apiFetch<SystemHistoryResponse>(`/records/persons/${personId}/system-history`)
      .then((result) => {
        setData(result);
        // Auto-expand warrants section if there are active warrants
        if (result.summary.active_warrants > 0) setWarrantsOpen(true);
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : 'Failed to load system history');
        setData(null);
      })
      .finally(() => setLoading(false));
  }, [personId]);

  // ── Summary Badges ─────────────────────────────

  const renderSummary = () => {
    if (!data) return null;
    const { summary, bolo_active } = data;
    return (
      <div className="flex flex-wrap items-center gap-2">
        {/* Warrants badge */}
        <span
          className={`inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-bold uppercase border panel-beveled ${
            summary.active_warrants > 0
              ? 'bg-red-900/60 text-red-300 border-red-600/60'
              : 'bg-rmpg-700/50 text-rmpg-300 border-rmpg-600/50'
          }`}
        >
          <Scale className="w-3 h-3" />
          {summary.total_warrants} Warrant{summary.total_warrants !== 1 ? 's' : ''}
          {summary.active_warrants > 0 && (
            <span className="text-red-400 ml-0.5">({summary.active_warrants} Active)</span>
          )}
        </span>

        {/* Citations badge */}
        {summary.total_citations > 0 && (
          <span
            className={`inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-bold uppercase border panel-beveled ${
              summary.active_citations > 0
                ? 'bg-amber-900/50 text-amber-300 border-amber-600/60'
                : 'bg-rmpg-700/50 text-rmpg-300 border-rmpg-600/50'
            }`}
          >
            <FileWarning className="w-3 h-3" />
            {summary.total_citations} Citation{summary.total_citations !== 1 ? 's' : ''}
            {summary.active_citations > 0 && (
              <span className="text-amber-400 ml-0.5">({summary.active_citations} Active)</span>
            )}
          </span>
        )}

        {/* Incidents badge */}
        <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-bold uppercase border panel-beveled bg-brand-900/40 text-brand-300 border-brand-700/50">
          <FileText className="w-3 h-3" />
          {summary.total_incidents} Incident{summary.total_incidents !== 1 ? 's' : ''}
        </span>

        {/* Calls badge */}
        <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-bold uppercase border panel-beveled bg-purple-900/40 text-purple-300 border-purple-700/50">
          <Radio className="w-3 h-3" />
          {summary.total_calls} Call{summary.total_calls !== 1 ? 's' : ''}
        </span>

        {/* BOLO badge */}
        {bolo_active && (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-black uppercase border panel-beveled bg-red-900/70 text-red-300 border-red-500/70 animate-pulse">
            <AlertOctagon className="w-3 h-3" />
            BOLO ACTIVE
          </span>
        )}
      </div>
    );
  };

  // ── Section Header Helper ──────────────────────

  const SectionToggle = ({
    icon: Icon,
    label,
    count,
    isOpen,
    onToggle,
    critical,
  }: {
    icon: React.ElementType;
    label: string;
    count: number;
    isOpen: boolean;
    onToggle: () => void;
    critical?: boolean;
  }) => (
    <button
      onClick={onToggle}
      className={`w-full flex items-center gap-1.5 text-left py-1 group ${
        critical ? 'text-red-400' : 'text-rmpg-400'
      }`}
    >
      {isOpen ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
      <Icon className="w-3 h-3" />
      <span className="text-[10px] uppercase font-bold tracking-wider">
        {label} ({count})
      </span>
    </button>
  );

  // ── Warrants Section ───────────────────────────

  const renderWarrants = () => {
    if (!data) return null;
    const { warrants } = data;
    return (
      <div className="space-y-1">
        <SectionToggle
          icon={Scale}
          label="Warrants"
          count={warrants.length}
          isOpen={warrantsOpen}
          onToggle={() => setWarrantsOpen(!warrantsOpen)}
          critical={data.summary.active_warrants > 0}
        />
        {warrantsOpen && (
          warrants.length > 0 ? (
            <div className="space-y-1 ml-1">
              {warrants.map((w) => (
                <div
                  key={w.id}
                  className={`flex flex-col gap-0.5 px-2 py-1.5 border text-xs ${
                    w.status === 'active'
                      ? 'bg-red-950/40 border-red-800/60'
                      : 'bg-surface-raised border-rmpg-700'
                  }`}
                >
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-white font-mono font-bold text-[11px]">
                      {w.warrant_number || `W-${w.id}`}
                    </span>
                    <span
                      className={`inline-flex items-center px-1.5 py-0.5 text-[9px] font-bold uppercase border panel-beveled ${
                        WARRANT_STATUS_CLASSES[w.status] || 'bg-rmpg-700 text-rmpg-300 border-rmpg-600'
                      }`}
                    >
                      {toDisplayLabel(w.status)}
                    </span>
                    <span className="px-1 py-0.5 text-[9px] uppercase font-bold bg-rmpg-700/50 text-rmpg-300 border border-rmpg-600/50">
                      {toDisplayLabel(w.type)}
                    </span>
                    {w.offense_level && (
                      <span
                        className={`inline-flex items-center px-1.5 py-0.5 text-[9px] font-bold uppercase border panel-beveled ${
                          OFFENSE_LEVEL_CLASSES[w.offense_level] || 'bg-rmpg-700 text-rmpg-300 border-rmpg-600'
                        }`}
                      >
                        {toDisplayLabel(w.offense_level)}
                      </span>
                    )}
                    <span className="text-rmpg-400 ml-auto text-[10px]">{formatDate(w.date_issued)}</span>
                  </div>
                  <div className="text-rmpg-200 text-[11px]">{w.charge_description}</div>
                  {w.statute_citation && (
                    <div className="text-rmpg-500 text-[10px] font-mono">{w.statute_citation}</div>
                  )}
                  {w.expires_at && (
                    <div className="text-rmpg-500 text-[10px]">Expires: {formatDate(w.expires_at)}</div>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <p className="text-[11px] text-rmpg-500 ml-5">No warrants on file</p>
          )
        )}
      </div>
    );
  };

  // ── Citations Section ─────────────────────────

  const renderCitations = () => {
    if (!data) return null;
    const { citations } = data;
    if (citations.length === 0) return null;
    return (
      <div className="space-y-1">
        <SectionToggle
          icon={FileWarning}
          label="Citations / Summons"
          count={citations.length}
          isOpen={citationsOpen}
          onToggle={() => setCitationsOpen(!citationsOpen)}
          critical={data.summary.active_citations > 0}
        />
        {citationsOpen && (
          <div className="space-y-1 ml-1">
            {citations.map((c) => (
              <div
                key={c.id}
                className={`flex flex-col gap-0.5 px-2 py-1.5 border text-xs ${
                  c.status === 'issued' || c.status === 'contested' || c.status === 'warrant_issued'
                    ? 'bg-amber-950/20 border-amber-800/40'
                    : 'bg-surface-raised border-rmpg-700'
                }`}
              >
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-white font-mono font-bold text-[11px]">{c.citation_number}</span>
                  <span
                    className={`inline-flex items-center px-1.5 py-0.5 text-[9px] font-bold uppercase border panel-beveled ${
                      CITATION_STATUS_CLASSES[c.status] || 'bg-rmpg-700 text-rmpg-300 border-rmpg-600'
                    }`}
                  >
                    {c.status.replace(/_/g, ' ')}
                  </span>
                  <span
                    className={`inline-flex items-center px-1 py-0.5 text-[9px] uppercase font-bold border panel-beveled ${
                      CITATION_TYPE_CLASSES[c.type] || 'bg-rmpg-700/50 text-rmpg-300 border-rmpg-600/50'
                    }`}
                  >
                    {toDisplayLabel(c.type)}
                  </span>
                  {c.offense_level && (
                    <span
                      className={`inline-flex items-center px-1.5 py-0.5 text-[9px] font-bold uppercase border panel-beveled ${
                        OFFENSE_LEVEL_CLASSES[c.offense_level] || 'bg-rmpg-700 text-rmpg-300 border-rmpg-600'
                      }`}
                    >
                      {toDisplayLabel(c.offense_level)}
                    </span>
                  )}
                  {c.fine_amount != null && c.fine_amount > 0 && (
                    <span className="text-green-400 font-bold text-[10px]">
                      ${c.fine_amount.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                    </span>
                  )}
                  <span className="text-rmpg-400 ml-auto text-[10px]">{formatDate(c.violation_date)}</span>
                </div>
                {c.violation_description && (
                  <div className="text-rmpg-200 text-[11px]">{c.violation_description}</div>
                )}
                <div className="flex items-center gap-3 text-[10px] text-rmpg-500">
                  {c.statute_citation && <span className="font-mono">{c.statute_citation}</span>}
                  {c.location && <span className="truncate max-w-[200px]">{c.location}</span>}
                  {c.court_date && <span>Court: {formatDate(c.court_date)}</span>}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  };

  // ── Incidents Section ──────────────────────────

  const renderIncidents = () => {
    if (!data) return null;
    const { incidents } = data;
    return (
      <div className="space-y-1">
        <SectionToggle
          icon={FileText}
          label="Incident History"
          count={incidents.length}
          isOpen={incidentsOpen}
          onToggle={() => setIncidentsOpen(!incidentsOpen)}
        />
        {incidentsOpen && (
          incidents.length > 0 ? (
            <div className="space-y-1 ml-1">
              {incidents.map((inc) => (
                <div
                  key={inc.id}
                  className="flex items-center gap-2 text-xs px-2 py-1.5 bg-surface-raised border border-rmpg-700 flex-wrap"
                >
                  <span className="text-white font-mono font-bold">{inc.incident_number || `I-${inc.id}`}</span>
                  <span className="px-1 py-0.5 bg-brand-900/40 text-brand-300 text-[10px] uppercase font-bold">
                    {formatRole(inc.role)}
                  </span>
                  <span className="text-rmpg-300">{formatType(inc.incident_type)}</span>
                  <StatusBadge status={inc.status} type="incident_status" size="sm" />
                  <span className="text-rmpg-400 ml-auto text-[10px]">{formatDate(inc.created_at)}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-[11px] text-rmpg-500 ml-5">No incidents linked</p>
          )
        )}
      </div>
    );
  };

  // ── Calls Section ──────────────────────────────

  const renderCalls = () => {
    if (!data) return null;
    const { calls } = data;
    return (
      <div className="space-y-1">
        <SectionToggle
          icon={Radio}
          label="Dispatch Calls"
          count={calls.length}
          isOpen={callsOpen}
          onToggle={() => setCallsOpen(!callsOpen)}
        />
        {callsOpen && (
          calls.length > 0 ? (
            <div className="space-y-1 ml-1">
              {calls.map((c) => (
                <div
                  key={c.id}
                  className="flex items-center gap-2 text-xs px-2 py-1.5 bg-surface-raised border border-rmpg-700 flex-wrap"
                >
                  <span className="text-white font-mono font-bold">{c.call_number || `C-${c.id}`}</span>
                  <span className="text-rmpg-300">{formatType(c.incident_type)}</span>
                  {c.priority && <StatusBadge status={c.priority} type="priority" size="sm" />}
                  <StatusBadge status={c.status} type="call_status" size="sm" />
                  {c.location && (
                    <span className="text-rmpg-500 text-[10px] truncate max-w-[180px]" title={c.location}>
                      {c.location}
                    </span>
                  )}
                  <span className="text-rmpg-400 ml-auto text-[10px]">{formatDate(c.created_at)}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-[11px] text-rmpg-500 ml-5">No dispatch calls linked</p>
          )
        )}
      </div>
    );
  };

  // ── BOLO Banner ────────────────────────────────

  const renderBolo = () => {
    if (!data?.bolo_active) return null;
    return (
      <div className="flex items-center gap-2 px-3 py-2 bg-red-950/50 border border-red-700/60 text-red-300">
        <AlertOctagon className="w-4 h-4 flex-shrink-0" />
        <div>
          <span className="text-[11px] font-black uppercase tracking-wide">BOLO Active</span>
          <span className="text-[10px] text-red-400/80 ml-2">
            Be On the Lookout flag is set for {personName}
          </span>
        </div>
      </div>
    );
  };

  // ── Main Render ────────────────────────────────

  return (
    <div className="panel-beveled bg-surface-base overflow-hidden">
      {/* Panel Header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between p-3 hover:bg-rmpg-700/20 transition-colors"
      >
        <h3 className="text-[10px] text-rmpg-400 uppercase font-bold tracking-wider flex items-center gap-1.5">
          {expanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
          <Shield className="w-3 h-3" />
          System History
        </h3>
        {!loading && data && !expanded && renderSummary()}
      </button>

      {expanded && (
        <div className="px-3 pb-3 space-y-3">
          {/* Loading */}
          {loading && (
            <div className="flex items-center gap-2 py-2">
              <Loader2 className="w-3 h-3 animate-spin text-brand-400" />
              <span className="text-[11px] text-rmpg-400">Loading system history...</span>
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="flex items-center gap-2 px-2 py-1.5 bg-red-950/30 border border-red-800/40 text-xs text-red-400">
              <AlertTriangle className="w-3 h-3 flex-shrink-0" />
              {error}
            </div>
          )}

          {/* Content */}
          {data && !loading && (
            <>
              {/* Summary badges */}
              <div className="pb-2 border-b border-rmpg-700/50">{renderSummary()}</div>

              {/* BOLO Alert */}
              {renderBolo()}

              {/* Warrants */}
              {renderWarrants()}

              {/* Citations */}
              {renderCitations()}

              {/* Incidents */}
              {renderIncidents()}

              {/* Calls */}
              {renderCalls()}
            </>
          )}
        </div>
      )}
    </div>
  );
}
