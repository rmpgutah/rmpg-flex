import { Clock } from 'lucide-react';
import { parseTimestamp } from '../utils/dateUtils';
import type { TimelineEntry } from '../types';

interface CallTimelineProps {
  entries: TimelineEntry[];
  className?: string;
}

/**
 * Map each action string to an LED color class from the existing
 * led-dot system defined in index.css.  The CSS classes provide
 * the correct box-shadow glow effect.
 */
const ACTION_LED_CLASS: Record<string, string> = {
  // Call lifecycle — chronological order
  call_created: 'led-green',
  dispatched: 'led-gray',
  unit_dispatched: 'led-gray',
  unit_assigned: 'led-gray',
  enroute: 'led-amber',
  onscene: 'led-amber',
  cleared: 'led-green',
  closed: 'led-green',
  call_archived: 'led-off',
  call_unarchived: 'led-green',

  // Notes + evidence
  note_added: 'led-off',
  photo_attached: 'led-off',
  document_attached: 'led-off',

  // Priority / escalation
  priority_changed: 'led-amber',
  call_escalated: 'led-red',
  call_merged: 'led-purple',

  // Redispatch / service
  call_redispatched: 'led-gray',
  call_created_from_redispatch: 'led-gray',
  call_undo_redispatch: 'led-green',

  // Incident linkage
  incident_created: 'led-purple',
  merge_call: 'led-purple',

  // AI / auto
  ai_analysis: 'led-purple',
  ai_suggested_units: 'led-purple',

  // Retention / admin
  call_deleted: 'led-off',
  status_change: 'led-gray',
};

function getLedClass(action: string): string {
  return ACTION_LED_CLASS[action] ?? 'led-off';
}

function formatTimestamp(dateStr: string): string {
  if (!dateStr) return '--:--:--';
  const date = parseTimestamp(dateStr);
  if (isNaN(date.getTime())) return '--:--:--';
  return date.toLocaleTimeString('en-US', {
    timeZone: 'America/Denver',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

export default function CallTimeline({ entries, className = '' }: CallTimelineProps) {
  if (entries.length === 0) {
    return (
      <div className={`flex flex-col items-center justify-center py-10 text-rmpg-400 ${className}`}>
        <Clock className="w-6 h-6 mb-2" />
        <p className="text-xs font-mono">No activity recorded</p>
      </div>
    );
  }

  return (
    <div className={`relative ${className}`}>
      {/* Vertical timeline line */}
      <div
        className="absolute top-0 bottom-0"
        style={{
          left: '3.5px',
          width: '1px',
          background: 'var(--border-default)',
        }}
      />

      <div className="flex flex-col">
        {entries.map((entry) => (
          <div key={entry.id} className="relative flex items-start gap-3 py-1.5">
            {/* LED dot on the timeline line */}
            <span
              className={`led-dot ${getLedClass(entry.action)} relative z-10`}
              style={{ marginTop: '3px' }}
            />

            {/* Content */}
            <div className="min-w-0 flex-1">
              <span className="font-mono text-[9px] text-green-400/70 leading-none">
                {formatTimestamp(entry.timestamp)}
              </span>
              <p className="text-[11px] text-rmpg-200 leading-snug mt-0.5">
                {entry.description}
              </p>
              {entry.user_name && (
                <p className="font-mono text-[9px] text-rmpg-400 mt-0.5 leading-none">
                  {entry.user_name}
                  {entry.badge_number && (
                    <span className="text-fg-muted ml-1">#{entry.badge_number}</span>
                  )}
                </p>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
