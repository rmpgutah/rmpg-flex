// ============================================================
// RMPG Flex — Officer Activity Detail Tab
// ============================================================

import { Activity } from 'lucide-react';
import { ACTION_COLORS } from '../utils/personnelConstants';
import { parseTimestamp } from '../../../utils/dateUtils';

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
  if (action.startsWith('call')) return 'border-l-2 border-l-gray-500';
  return 'border-l-2 border-l-rmpg-600';
}

function formatTimestamp(dateStr: string): string {
  if (!dateStr) return '-';
  return parseTimestamp(dateStr).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

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
        <div className="panel-beveled p-10 text-center bg-surface-base" role="status">
          <div className="w-14 h-14 mx-auto mb-3 rounded-full border border-rmpg-700 flex items-center justify-center bg-surface-sunken">
            <Activity className="w-7 h-7 text-rmpg-600" />
          </div>
          <p className="text-sm text-rmpg-400 font-medium">No recent activity</p>
          <p className="text-[10px] text-rmpg-600 mt-1">Activity will appear here as actions are performed</p>
        </div>
      )}
    </div>
  );
}
