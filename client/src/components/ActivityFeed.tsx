import React from 'react';
import {
  Phone,
  Radio,
  FileText,
  AlertTriangle,
  MessageSquare,
  Clock,
  LogIn,
  LogOut,
  Shield,
  Info,
} from 'lucide-react';
import type { ActivityLogEntry, ActivityAction } from '../types';

interface ActivityFeedProps {
  entries: ActivityLogEntry[];
  maxHeight?: string;
  showDate?: boolean;
}

const ACTION_CONFIG: Record<ActivityAction, { icon: React.ElementType; color: string }> = {
  call_created: { icon: Phone, color: 'text-brand-400' },
  call_dispatched: { icon: Radio, color: 'text-amber-400' },
  call_enroute: { icon: Radio, color: 'text-brand-400' },
  call_onscene: { icon: Radio, color: 'text-purple-400' },
  call_cleared: { icon: Phone, color: 'text-rmpg-300' },
  call_closed: { icon: Phone, color: 'text-rmpg-400' },
  unit_status_change: { icon: Radio, color: 'text-cyan-400' },
  incident_created: { icon: FileText, color: 'text-brand-400' },
  incident_submitted: { icon: FileText, color: 'text-brand-300' },
  incident_approved: { icon: FileText, color: 'text-green-400' },
  incident_returned: { icon: FileText, color: 'text-red-400' },
  bolo_issued: { icon: AlertTriangle, color: 'text-red-400' },
  bolo_cancelled: { icon: AlertTriangle, color: 'text-rmpg-300' },
  message_sent: { icon: MessageSquare, color: 'text-brand-400' },
  user_login: { icon: LogIn, color: 'text-green-400' },
  user_logout: { icon: LogOut, color: 'text-rmpg-300' },
  clock_in: { icon: Clock, color: 'text-green-400' },
  clock_out: { icon: Clock, color: 'text-amber-400' },
  note_added: { icon: FileText, color: 'text-rmpg-200' },
  system: { icon: Info, color: 'text-rmpg-300' },
};

function formatTime(dateStr: string, showDate: boolean): string {
  const date = new Date(dateStr);
  if (showDate) {
    return date.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });
  }
  return date.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

export default React.memo(function ActivityFeed({
  entries,
  maxHeight = '400px',
  showDate = false,
}: ActivityFeedProps) {
  return (
    <div className="overflow-y-auto" style={{ maxHeight }}>
      {entries.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-rmpg-400">
          <Shield className="w-8 h-8 mb-2 opacity-40" />
          <p className="text-sm">No recent activity</p>
          <p className="text-[9px] text-rmpg-500 mt-1">Events will appear here in real-time</p>
        </div>
      ) : (
        <div className="space-y-0 animate-stagger-in">
          {entries.map((entry, index) => {
            const config = ACTION_CONFIG[entry.action] || ACTION_CONFIG.system;
            const Icon = config.icon;
            const isRecent = index === 0;
            return (
              <div
                key={entry.id}
                className={`flex items-start gap-2 px-2 py-1.5 hover:bg-rmpg-800/50 border-b border-rmpg-700/50 transition-colors group ${isRecent ? 'bg-brand-900/5' : ''}`}
              >
                <div className="relative flex-shrink-0 mt-0.5">
                  <Icon className={`w-3.5 h-3.5 ${config.color}`} />
                  {isRecent && (
                    <span className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 rounded-full bg-green-400 animate-led-pulse" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-rmpg-200 leading-relaxed">
                    {entry.user_name && (
                      <span className="font-semibold text-gray-200">{entry.user_name} </span>
                    )}
                    {entry.description}
                  </p>
                </div>
                <span className="text-[9px] font-mono text-green-400/70 whitespace-nowrap flex-shrink-0 group-hover:text-green-400/90 transition-colors">
                  {formatTime(entry.timestamp, showDate)}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
});
