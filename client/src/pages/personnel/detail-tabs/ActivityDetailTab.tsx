// ============================================================
// RMPG Flex — Officer Activity Detail Tab
// ============================================================

import React from 'react';
import { Activity } from 'lucide-react';
import { ACTION_COLORS } from '../utils/personnelConstants';

interface ActivityEntry {
  id: string;
  action: string;
  details: string;
  entity_type?: string;
  created_at: string;
  user_name?: string;
}

interface Props {
  activity: ActivityEntry[];
}

function ledClass(action: string): string {
  if (action === 'clock_in' || action === 'user_login') return 'led-dot led-green';
  if (action === 'clock_out' || action === 'user_logout') return 'led-dot led-amber';
  if (action.startsWith('incident')) return 'led-dot led-amber';
  if (action.startsWith('call')) return 'led-dot led-green';
  return 'led-dot led-off';
}

function borderColor(action: string): string {
  if (action === 'clock_in' || action === 'user_login') return 'border-l-2 border-l-green-500';
  if (action === 'clock_out' || action === 'user_logout') return 'border-l-2 border-l-amber-500';
  if (action.startsWith('incident')) return 'border-l-2 border-l-brand-500';
  if (action.startsWith('call')) return 'border-l-2 border-l-blue-500';
  return 'border-l-2 border-l-rmpg-600';
}

function formatTimestamp(dateStr: string): string {
  if (!dateStr) return '-';
  return new Date(dateStr).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

const timeAgo = (date: string) => {
  const ms = Date.now() - new Date(date).getTime();
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
};

export default function ActivityDetailTab({ activity }: Props) {
  return (
    <div className="space-y-4">
      {/* Header */}
      <h3 className="field-label text-brand-400 flex items-center gap-1.5">
        <Activity className="w-3 h-3" />
        Recent Activity
      </h3>

      {/* Timeline */}
      {activity.length > 0 ? (
        <div className="relative">
          {/* Vertical line */}
          <div className="absolute left-3 top-0 bottom-0 w-px bg-rmpg-600" />

          <div className="space-y-0">
            {activity.map((entry) => {
              const actionColor = ACTION_COLORS[entry.action] || ACTION_COLORS.default;

              return (
                <div key={entry.id} className="relative pl-8 pb-4">
                  {/* Timeline dot */}
                  <span
                    className={`absolute left-1.5 top-1.5 ${ledClass(entry.action)}`}
                  />

                  {/* Card */}
                  <div className={`panel-beveled p-2 bg-surface-base ${borderColor(entry.action)}`}>
                    <div className="flex items-center justify-between gap-2 mb-0.5">
                      <span className="panel-inset px-1.5 py-0.5">
                        <span
                          className={`font-mono uppercase text-[10px] font-bold tracking-wider ${actionColor}`}
                        >
                          {entry.action.replace(/_/g, ' ')}
                        </span>
                      </span>
                      <span className="font-mono text-[9px] text-rmpg-500 flex-shrink-0">
                        {formatTimestamp(entry.created_at)}
                      </span>
                    </div>

                    {entry.details && (
                      <p className="text-xs text-rmpg-300">{entry.details}</p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="panel-beveled p-8 text-center bg-surface-base">
          <Activity className="w-8 h-8 text-rmpg-600 mx-auto mb-2" />
          <p className="text-xs text-rmpg-400">No recent activity</p>
        </div>
      )}
    </div>
  );
}
