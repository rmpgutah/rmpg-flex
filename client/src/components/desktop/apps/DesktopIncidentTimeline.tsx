import React, { useState, useEffect, useCallback } from 'react';
import { Clock, Search, Printer, FileText, Users, AlertCircle, Image, CheckCircle, StickyNote } from 'lucide-react';
import { apiFetch } from '../../../hooks/useApi';
import { parseTimestamp, formatDateTime } from '../../../utils/dateUtils';
import { timelineToCsv, downloadTextFile } from '../../../utils/rmsListExport';
import { copyToClipboard } from '../../../utils/contextMenuActions';

interface CallInfo {
  id: number;
  call_number?: string;
  incident_number?: string;
  nature?: string;
  status?: string;
  location_address?: string;
  created_at?: string;
  cleared_at?: string;
  notes?: string;
}

interface TimelineEvent {
  id?: number;
  type: string;
  timestamp: string;
  label: string;
  detail?: string;
}

type EventType = 'created' | 'unit_assigned' | 'status_change' | 'note_added' | 'photo_attached' | 'cleared' | 'other';

function eventColor(type: string): string {
  switch (type) {
    case 'created': return 'var(--sev-ok)';
    case 'cleared': return 'var(--sev-ok)';
    case 'unit_assigned': return 'var(--accent-silver-400)';
    case 'status_change': return 'var(--accent-gold-300)';
    case 'photo_attached': return 'var(--sev-warn)';
    case 'note_added': return 'var(--text-secondary)';
    default: return 'var(--border-default)';
  }
}

function EventIcon({ type }: { type: string }) {
  const props = { size: 12, style: { flexShrink: 0 } };
  switch (type as EventType) {
    case 'created': return <FileText {...props} />;
    case 'unit_assigned': return <Users {...props} />;
    case 'status_change': return <AlertCircle {...props} />;
    case 'note_added': return <StickyNote {...props} />;
    case 'photo_attached': return <Image {...props} />;
    case 'cleared': return <CheckCircle {...props} />;
    default: return <Clock {...props} />;
  }
}

function buildTimelineFromCall(call: CallInfo): TimelineEvent[] {
  const events: TimelineEvent[] = [];
  if (call.created_at) {
    events.push({ type: 'created', timestamp: call.created_at, label: 'Call Created', detail: call.nature ?? call.location_address });
  }
  if (call.cleared_at) {
    events.push({ type: 'cleared', timestamp: call.cleared_at, label: 'Call Cleared', detail: call.status });
  }
  if (call.notes) {
    events.push({ type: 'note_added', timestamp: call.created_at ?? new Date().toISOString(), label: 'Note', detail: call.notes });
  }
  return events.sort((a, b) => parseTimestamp(a.timestamp).getTime() - parseTimestamp(b.timestamp).getTime());
}

interface Props {
  callId?: string;
  onClose?: () => void;
}

export default function DesktopIncidentTimeline({ callId: propCallId, onClose: _onClose }: Props) {
  const [callIdInput, setCallIdInput] = useState(propCallId ?? '');
  const [activeCallId, setActiveCallId] = useState(propCallId ?? '');
  const [call, setCall] = useState<CallInfo | null>(null);
  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [typeFilter, setTypeFilter] = useState('ALL');

  const load = useCallback(async (id: string) => {
    if (!id.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const callData = await apiFetch<CallInfo>(`/dispatch/calls/${id}`);
      setCall(callData);
      // Prefer the audit-trail endpoint — it returns the full chronological
      // event log (status changes, notes, unit assignments, merges, etc.)
      // rather than the limited /updates endpoint.
      let evts: TimelineEvent[] = [];
      try {
        const trail = await apiFetch<{ events: Array<{ id: number; action: string; details: string | null; user_name: string | null; created_at: string }> }>(
          `/dispatch/calls/${id}/audit-trail`,
        );
        if (Array.isArray(trail?.events) && trail.events.length > 0) {
          evts = trail.events.map((e) => ({
            id: e.id,
            type: e.action,
            timestamp: e.created_at,
            label: e.action.replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase()),
            detail: e.user_name ?? undefined,
          }));
        }
      } catch {
        // Fall back to building from call data
        evts = buildTimelineFromCall(callData);
      }
      if (evts.length === 0) evts = buildTimelineFromCall(callData);
      setEvents(evts);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load call');
      setCall(null);
      setEvents([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (propCallId) void load(propCallId);
  }, [propCallId, load]);

  const handleSearch = () => {
    setActiveCallId(callIdInput.trim());
    void load(callIdInput.trim());
  };

  const callLabel = call?.call_number ?? call?.incident_number ?? activeCallId;
  const types = Array.from(new Set(events.map((e) => e.type)));
  const visibleEvents = typeFilter === 'ALL' ? events : events.filter((e) => e.type === typeFilter);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--surface-base)' }}>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px',
        background: 'var(--surface-raised)', borderBottom: '1px solid var(--border-default)', flexShrink: 0,
      }}>
        <Clock size={13} style={{ color: 'var(--accent-silver-400)' }} />
        <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-primary)', flex: 1 }}>
          Incident Timeline{callLabel ? ` — Call #${callLabel}` : ''}
        </span>
        <button
          type="button"
          onClick={() => window.print()}
          title="Print timeline"
          style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, padding: '3px 10px', borderRadius: 2, border: '1px solid var(--border-default)', cursor: 'pointer', background: 'none', color: 'var(--text-primary)' }}
        >
          <Printer size={10} /> Print
        </button>
        <button
          type="button"
          disabled={visibleEvents.length === 0}
          onClick={() => downloadTextFile('incident-timeline.csv', timelineToCsv(visibleEvents))}
          style={{ fontSize: 10, padding: '3px 10px', borderRadius: 2, border: '1px solid var(--border-default)', cursor: 'pointer', background: 'none', color: 'var(--text-primary)' }}
        >CSV</button>
      </div>

      {/* Search input if no prop callId */}
      {!propCallId && (
        <div style={{ display: 'flex', gap: 8, padding: '8px 12px', borderBottom: '1px solid var(--border-default)', background: 'var(--surface-base)', flexShrink: 0 }}>
          <input
            type="text"
            placeholder="Enter Call ID…"
            value={callIdInput}
            onChange={e => setCallIdInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleSearch()}
            style={{ flex: 1, fontSize: 11, padding: '4px 8px', background: 'var(--surface-sunken)', border: '1px solid var(--border-default)', color: 'var(--text-primary)', borderRadius: 2, outline: 'none' }}
          />
          <button
            type="button"
            onClick={handleSearch}
            disabled={loading || !callIdInput.trim()}
            style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, padding: '4px 12px', borderRadius: 2, border: '1px solid var(--accent-silver-400)', cursor: 'pointer', background: 'none', color: 'var(--text-primary)', fontWeight: 700 }}
          >
            <Search size={11} /> Load
          </button>
        </div>
      )}

      {/* Call info bar */}
      {call && (
        <div style={{ padding: '5px 12px', background: 'var(--surface-sunken)', borderBottom: '1px solid var(--border-default)', fontSize: 10, color: 'var(--text-secondary)', display: 'flex', gap: 16, flexShrink: 0 }}>
          {call.nature && <span><strong style={{ color: 'var(--field-label-color)' }}>Nature:</strong> {call.nature}</span>}
          {call.location_address && <span><strong style={{ color: 'var(--field-label-color)' }}>Location:</strong> {call.location_address}</span>}
          {call.status && <span><strong style={{ color: 'var(--field-label-color)' }}>Status:</strong> {call.status}</span>}
        </div>
      )}

      {/* Timeline body */}
      <div style={{ flex: 1, overflow: 'auto', padding: '16px 20px' }}>
        {loading && <p style={{ textAlign: 'center', fontSize: 11, color: 'var(--text-secondary)' }}>Loading…</p>}
        {error && (
          <p style={{ textAlign: 'center', fontSize: 11, color: 'var(--sev-critical)' }}>
            {error}{' '}
            <button type="button" onClick={() => void load(activeCallId || callIdInput)} style={{ fontSize: 10, border: '1px solid var(--border-default)', background: 'none', color: 'var(--text-primary)', cursor: 'pointer' }}>Retry</button>
          </p>
        )}
        {!loading && !error && events.length === 0 && activeCallId && (
          <p style={{ textAlign: 'center', fontSize: 11, color: 'var(--text-secondary)' }}>No events found for this call</p>
        )}
        {!loading && !error && !activeCallId && !propCallId && (
          <p style={{ textAlign: 'center', fontSize: 11, color: 'var(--text-secondary)', marginTop: 40 }}>Enter a call ID above to view its timeline</p>
        )}
        {events.length > 0 && (
          <div style={{ display: 'flex', gap: 8, padding: '6px 12px', borderBottom: '1px solid var(--border-default)' }}>
            <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} aria-label="Filter timeline events" style={{ fontSize: 10, padding: '3px 6px', background: 'var(--surface-sunken)', color: 'var(--text-primary)', border: '1px solid var(--border-default)' }}>
              <option value="ALL">All event types</option>
              {types.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
        )}
        {events.length > 0 && visibleEvents.length === 0 && (
          <p style={{ textAlign: 'center', fontSize: 11, color: 'var(--text-secondary)' }}>No events match this type filter.</p>
        )}
        {visibleEvents.map((evt, i) => (
          <div key={evt.id ?? i} style={{ display: 'flex', gap: 14, marginBottom: 16 }}>
            {/* Left: dot + line */}
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flexShrink: 0, width: 20 }}>
              <div style={{
                width: 12, height: 12, borderRadius: '50%', marginTop: 1,
                background: eventColor(evt.type),
                boxShadow: `0 0 0 3px rgba(0 0 0 / 0.2)`,
                flexShrink: 0,
              }} />
              {i < visibleEvents.length - 1 && (
                <div style={{ flex: 1, width: 2, background: 'var(--border-default)', marginTop: 3 }} />
              )}
            </div>
            {/* Right: content */}
            <div style={{ flex: 1, paddingBottom: i < events.length - 1 ? 0 : 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                <span style={{ color: eventColor(evt.type) }}><EventIcon type={evt.type} /></span>
                <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-primary)' }}>{evt.label}</span>
                <span style={{ fontSize: 9, color: 'var(--text-secondary)', marginLeft: 'auto' }}>
                  {formatDateTime(evt.timestamp)}
                </span>
                <button type="button" onClick={() => void copyToClipboard(evt.timestamp)} style={{ fontSize: 9, border: '1px solid var(--border-default)', background: 'none', color: 'var(--text-secondary)', cursor: 'pointer' }}>Copy</button>
              </div>
              {evt.detail && (
                <p style={{ fontSize: 10, color: 'var(--text-secondary)', margin: 0, lineHeight: 1.5 }}>{evt.detail}</p>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
