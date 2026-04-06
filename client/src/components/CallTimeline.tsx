import React from 'react';
import {
  Phone,
  Radio,
  MapPin,
  CheckCircle,
  XCircle,
  FileText,
  User,
  Clock,
  MessageSquare,
  AlertTriangle,
} from 'lucide-react';
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
  call_created: 'led-green',
  dispatched: 'led-blue',
  unit_dispatched: 'led-blue',
  enroute: 'led-amber',
  onscene: 'led-amber',
  cleared: 'led-green',
  closed: 'led-green',
  note_added: 'led-off',
  incident_created: 'led-purple',
  call_archived: 'led-off',
  call_unarchived: 'led-green',
};

function getLedClass(action: string): string {
  return ACTION_LED_CLASS[action] ?? 'led-off';
}

function formatTimestamp(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleTimeString('en-US', {
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
          background: '#2a3e58',
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
                    <span className="text-rmpg-500 ml-1">#{entry.badge_number}</span>
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
