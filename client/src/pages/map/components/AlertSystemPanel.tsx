import React, { useState } from 'react';
import { X, Siren, Check, ChevronDown, ChevronRight, Trash2, Clock } from 'lucide-react';

const ALERT_TYPE_COLORS: Record<string, string> = {
  officer_down: '#ef4444',
  active_shooter: '#ef4444',
  hostage: '#ef4444',
  shots_fired: '#f59e0b',
  armed_subject: '#f59e0b',
  bomb_threat: '#f59e0b',
  barricaded: '#f59e0b',
  pursuit: '#3b82f6',
  hazmat: '#3b82f6',
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
    const d = new Date(ts);
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
      className="panel-beveled rounded-sm flex flex-col"
      style={{
        maxWidth: 300,
        width: 300,
        backgroundColor: '#141e2b',
        borderColor: 'var(--rmpg-700, #2a3a4e)',
      }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-2.5 py-1.5 border-b border-rmpg-700">
        <div className="flex items-center gap-1.5">
          <Siren size={12} className="text-red-500" />
          <span className="text-[10px] uppercase tracking-widest font-semibold text-rmpg-300">
            Alert System
          </span>
          {activeAlerts.length > 0 && (
            <span
              className="text-[9px] font-mono px-1 rounded-sm"
              style={{ backgroundColor: '#ef444433', color: '#ef4444' }}
            >
              {activeAlerts.length}
            </span>
          )}
        </div>
        <button
          onClick={onClose}
          className="text-rmpg-400 hover:text-white transition-colors p-0.5"
          title="Close"
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
          <div className="text-[9px] font-mono text-rmpg-400 text-center py-3 opacity-60">
            No active alerts
          </div>
        ) : (
          <div className="space-y-1.5 max-h-[240px] overflow-y-auto pr-0.5">
            {activeAlerts.map((alert) => {
              const color = ALERT_TYPE_COLORS[alert.type] || '#6b7280';
              const label = ALERT_TYPE_LABELS[alert.type] || alert.type;

              return (
                <div
                  key={alert.id}
                  className="rounded-sm"
                  style={{
                    backgroundColor: '#0d1520',
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
                      <span className="text-[8px] font-mono text-rmpg-400">
                        {formatTimestamp(alert.timestamp)}
                      </span>
                    </div>

                    {alert.details && (
                      <div className="text-[9px] font-mono text-rmpg-300 mb-1.5 leading-tight">
                        {alert.details}
                      </div>
                    )}

                    <div className="flex items-center gap-1">
                      {!alert.acknowledged && (
                        <button
                          onClick={() => onAcknowledge(alert.id)}
                          className="flex items-center gap-0.5 px-1.5 py-0.5 rounded-sm text-[8px] font-mono uppercase tracking-wider transition-colors"
                          style={{
                            backgroundColor: '#1a5a9e33',
                            color: '#60a5fa',
                            border: '1px solid #1a5a9e55',
                          }}
                          title="Acknowledge"
                        >
                          <Check size={8} />
                          ACK
                        </button>
                      )}
                      <button
                        onClick={() => onClear(alert.id)}
                        className="flex items-center gap-0.5 px-1.5 py-0.5 rounded-sm text-[8px] font-mono uppercase tracking-wider transition-colors"
                        style={{
                          backgroundColor: '#ef444422',
                          color: '#f87171',
                          border: '1px solid #ef444433',
                        }}
                        title="Clear"
                      >
                        <X size={8} />
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
        <button
          onClick={() => setHistoryExpanded(!historyExpanded)}
          className="flex items-center gap-1 w-full text-left"
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
          <div className="mt-1.5 space-y-1 max-h-[160px] overflow-y-auto pr-0.5">
            {alertHistory.length === 0 ? (
              <div className="text-[9px] font-mono text-rmpg-400 text-center py-2 opacity-60">
                No alert history
              </div>
            ) : (
              alertHistory.map((alert) => {
                const color = ALERT_TYPE_COLORS[alert.type] || '#6b7280';
                const label = ALERT_TYPE_LABELS[alert.type] || alert.type;

                return (
                  <div
                    key={alert.id}
                    className="flex items-center gap-1.5 px-1.5 py-1 rounded-sm opacity-60"
                    style={{ backgroundColor: '#0d1520' }}
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
          <button
            onClick={onClearAll}
            className="flex items-center justify-center gap-1 w-full px-2 py-1 rounded-sm text-[9px] font-mono uppercase tracking-wider transition-colors"
            style={{
              backgroundColor: '#ef444418',
              color: '#f87171',
              border: '1px solid #ef444428',
            }}
          >
            <Trash2 size={9} />
            Clear All
          </button>
        </div>
      )}
    </div>
  );
}
