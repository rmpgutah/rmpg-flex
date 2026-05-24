import React, { useState } from 'react';
import { X, Siren, Check, ChevronDown, ChevronRight, Trash2, Clock, ShieldCheck } from 'lucide-react';

const ALERT_TYPE_COLORS: Record<string, string> = {
  officer_down: '#ef4444',
  active_shooter: '#ef4444',
  hostage: '#ef4444',
  shots_fired: '#f59e0b',
  armed_subject: '#f59e0b',
  bomb_threat: '#f59e0b',
  barricaded: '#f59e0b',
  pursuit: '#888888',
  hazmat: '#888888',
  missing_officer: '#a855f7',
};

const ALERT_TYPE_LABELS: Record<string, string> = {
  shots_fired: 'Shots Fired',
  officer_down: 'Officer Down',
  pursuit: 'Pursuit',
  hazmat: 'HAZMAT',
  armed_subject: 'Armed Subject',
  barricaded: 'Barricaded Subject',
  hostage: 'Hostage',
  bomb_threat: 'Bomb Threat',
  active_shooter: 'Active Shooter',
  missing_officer: 'Missing Officer',
};

interface Alert {
  id: string;
  type: string;
  lat: number;
  lng: number;
  details: string;
  radius: number;
  timestamp: string;
  acknowledged: boolean;
  expired: boolean;
}

interface AlertSystemPanelProps {
  activeAlerts: Alert[];
  alertHistory: Alert[];
  onAcknowledge: (alertId: string) => void;
  onClear: (alertId: string) => void;
  onClearAll: () => void;
  onClose: () => void;
}

function formatTimestamp(ts: string): string {
  try {
    const d = new Date(ts.includes('T') ? ts : ts + 'T00:00:00');
    return d.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });
  } catch {
    return ts;
  }
}

function relativeTime(ts: string): string {
  try {
    const diff = Date.now() - new Date(ts).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return `${Math.floor(hrs / 24)}d ago`;
  } catch {
    return '';
  }
}

export default function AlertSystemPanel({
  activeAlerts,
  alertHistory,
  onAcknowledge,
  onClear,
  onClearAll,
  onClose,
}: AlertSystemPanelProps) {
  const [historyExpanded, setHistoryExpanded] = useState(false);

  return (
    <div
      className="panel-beveled rounded-sm flex flex-col transition-all duration-200 ease-out shadow-lg"
      style={{
        maxWidth: 300,
        width: 300,
        backgroundColor: '#0a0a0a',
        borderColor: 'var(--rmpg-700, #373737)',
      }}
      role="complementary"
      aria-label="Alert system panel"
    >
      {/* Header */}
      <div className="flex items-center justify-between px-2.5 py-1.5 border-b border-rmpg-700">
        <div className="flex items-center gap-1.5">
          <Siren size={12} className="text-red-500" />
          <span className="text-[10px] uppercase tracking-widest font-semibold text-rmpg-300">
            Alert System
          </span>
          {/* #37: Active alert count badge with border */}
          {activeAlerts.length > 0 && (
            <span
              className="text-[9px] font-mono font-bold px-1.5 py-0.5 rounded-sm tabular-nums"
              style={{ backgroundColor: '#ef444425', color: '#ef4444', border: '1px solid #ef444440' }}
            >
              {activeAlerts.length}
            </span>
          )}
        </div>
        <button type="button"
          onClick={onClose}
          className="text-rmpg-400 hover:text-white hover:bg-[#181818] transition-all duration-150 active:scale-[0.97] p-0.5 rounded-sm"
          title="Close"
          aria-label="Close alert system panel"
        >
          <X size={12} />
        </button>
      </div>

      {/* Active Alerts */}
      <div className="px-2.5 py-1.5">
        <div className="text-[10px] uppercase tracking-widest text-rmpg-400 mb-1.5">
          Active Alerts
        </div>

        {activeAlerts.length === 0 ? (
          <div className="flex flex-col items-center gap-1.5 text-center py-4 opacity-60">
            <ShieldCheck size={18} className="text-green-500/50" />
            <span className="text-[9px] font-mono text-rmpg-400">No active alerts</span>
          </div>
        ) : (
          <div className="space-y-1.5 max-h-[240px] overflow-y-auto pr-0.5 scrollbar-thin scrollbar-thumb-[#2b2b2b] scrollbar-track-transparent">
            {activeAlerts.map((alert) => {
              const color = ALERT_TYPE_COLORS[alert.type] || '#666666';
              const label = ALERT_TYPE_LABELS[alert.type] || alert.type;

              return (
                <div
                  key={alert.id}
                  className={`rounded-sm hover:bg-[#181818]/50 transition-colors duration-100 ${!alert.acknowledged ? 'animate-pulse' : ''}`}
                  style={{
                    backgroundColor: '#050505',
                    borderLeft: `3px solid ${color}`,
                  }}
                >
                  <div className="px-2 py-1.5">
                    <div className="flex items-center justify-between mb-0.5">
                      <div className="flex items-center gap-1.5">
                        {!alert.acknowledged && (
                          <span className="led-dot led-red" />
                        )}
                        <span
                          className="text-[9px] font-mono font-semibold uppercase"
                          style={{ color }}
                        >
                          {label}
                        </span>
                      </div>
                      <span className="text-[8px] font-mono text-rmpg-400" title={formatTimestamp(alert.timestamp)}>
                        {relativeTime(alert.timestamp)}
                      </span>
                    </div>

                    {alert.details && (
                      <div className="text-[9px] font-mono text-rmpg-300 mb-1.5 leading-tight">
                        {alert.details}
                      </div>
                    )}

                    <div className="flex items-center gap-1">
                      {!alert.acknowledged && (
                        <button type="button"
                          onClick={() => onAcknowledge(alert.id)}
                          className="flex items-center gap-0.5 px-1.5 py-0.5 rounded-sm text-[8px] font-mono uppercase tracking-wider transition-all duration-150 active:scale-[0.97]"
                          style={{
                            backgroundColor: '#88888833',
                            color: '#aaaaaa',
                            border: '1px solid #88888855',
                          }}
                          title="Acknowledge"
                          aria-label={`Acknowledge ${label} alert`}
                        >
                          <Check size={8} />
                          ACK
                        </button>
                      )}
                      <button type="button"
                        onClick={() => onClear(alert.id)}
                        className="flex items-center gap-0.5 px-1.5 py-0.5 rounded-sm text-[8px] font-mono uppercase tracking-wider transition-all duration-150 active:scale-[0.97] hover:bg-red-900/30"
                        style={{
                          backgroundColor: '#ef444422',
                          color: '#f87171',
                          border: '1px solid #ef444433',
                        }}
                        title="Clear"
                        aria-label={`Clear ${label} alert`}
                      >
                        <Trash2 size={8} />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Alert History */}
      <div className="px-2.5 py-1.5 border-t border-rmpg-700">
        <button type="button"
          onClick={() => setHistoryExpanded(!historyExpanded)}
          className="flex items-center gap-1 w-full text-left transition-all duration-150 active:scale-[0.97] hover:bg-[#181818]/50 rounded-sm px-1 py-0.5"
          aria-label={historyExpanded ? 'Collapse alert history' : 'Expand alert history'}
        >
          {historyExpanded ? (
            <ChevronDown size={10} className="text-rmpg-400" />
          ) : (
            <ChevronRight size={10} className="text-rmpg-400" />
          )}
          <span className="text-[10px] uppercase tracking-widest text-rmpg-400">
            Alert History
          </span>
          {alertHistory.length > 0 && (
            <span className="text-[8px] font-mono text-rmpg-400 ml-auto">
              {alertHistory.length}
            </span>
          )}
        </button>

        {historyExpanded && (
          <div className="mt-1.5 space-y-1 max-h-[160px] overflow-y-auto pr-0.5 scrollbar-thin scrollbar-thumb-[#2b2b2b] scrollbar-track-transparent">
            {alertHistory.length === 0 ? (
              <div className="text-[9px] font-mono text-rmpg-400 text-center py-2 opacity-60">
                No alert history
              </div>
            ) : (
              alertHistory.map((alert) => {
                const color = ALERT_TYPE_COLORS[alert.type] || '#666666';
                const label = ALERT_TYPE_LABELS[alert.type] || alert.type;

                return (
                  <div
                    key={alert.id}
                    className="flex items-center gap-1.5 px-1.5 py-1 rounded-sm opacity-60"
                    style={{ backgroundColor: '#050505' }}
                  >
                    <Clock size={8} className="text-rmpg-400 flex-shrink-0" />
                    <span
                      className="text-[8px] font-mono uppercase"
                      style={{ color }}
                    >
                      {label}
                    </span>
                    <span className="text-[8px] font-mono text-rmpg-400 ml-auto flex-shrink-0">
                      {formatTimestamp(alert.timestamp)}
                    </span>
                  </div>
                );
              })
            )}
          </div>
        )}
      </div>

      {/* Clear All */}
      {(activeAlerts.length > 0 || alertHistory.length > 0) && (
        <div className="px-2.5 py-1.5 border-t border-rmpg-700">
          <button type="button"
            onClick={onClearAll}
            className="flex items-center justify-center gap-1 w-full px-2 py-1 rounded-sm text-[9px] font-mono uppercase tracking-wider transition-all duration-150 active:scale-[0.97] hover:bg-red-900/30"
            style={{
              backgroundColor: '#ef444418',
              color: '#f87171',
              border: '1px solid #ef444428',
            }}
            aria-label="Clear all alerts"
          >
            <Trash2 size={9} />
            Clear All
          </button>
        </div>
      )}
    </div>
  );
}
