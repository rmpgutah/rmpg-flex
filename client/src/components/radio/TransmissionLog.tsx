import { useState, useEffect, useCallback, useImperativeHandle, forwardRef } from 'react';
import { useWebSocket } from '../../context/WebSocketContext';

export interface LogEntry {
  id: number;
  time: string;
  source: string;
  text: string;
  type: 'dispatch' | 'unit' | 'emergency' | 'system';
}

export interface TransmissionLogHandle {
  addLogEntry: (entry: Omit<LogEntry, 'id' | 'time'>) => void;
}

const MAX_ENTRIES = 100;
let nextId = 1;

function formatTime(): string {
  const d = new Date();
  return d.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

const TYPE_COLORS: Record<LogEntry['type'], string> = {
  dispatch: '#d4a017',
  unit: '#cccccc',
  emergency: '#dc2626',
  system: '#f59e0b',
};

const TransmissionLog = forwardRef<TransmissionLogHandle>(function TransmissionLog(_props, ref) {
  const { subscribe } = useWebSocket();
  const [entries, setEntries] = useState<LogEntry[]>([]);

  const addEntry = useCallback((partial: Omit<LogEntry, 'id' | 'time'>) => {
    const entry: LogEntry = {
      ...partial,
      id: nextId++,
      time: formatTime(),
    };
    setEntries((prev) => [entry, ...prev].slice(0, MAX_ENTRIES));
  }, []);

  // Expose addLogEntry to parent via ref
  useImperativeHandle(ref, () => ({
    addLogEntry: addEntry,
  }), [addEntry]);

  // Subscribe to relevant WS messages
  useEffect(() => {
    const unsubs: Array<() => void> = [];

    // Legacy event retained for compat with any future emitter.
    unsubs.push(subscribe('radio_transmission', (msg) => {
      const data = (msg.data || msg.payload) as { source?: string; text?: string } | undefined;
      addEntry({
        source: data?.source || 'UNKNOWN',
        text: data?.text || 'Transmission received',
        type: 'unit',
      });
    }));

    // Actual live radio traffic — emitted by server/websocket.ts when a
    // unit un-keys. We only log on transmit_end so we have the final
    // transcript + duration; transmit_start alone has neither.
    unsubs.push(subscribe('radio_transmit_end', (msg) => {
      const data = (msg.data || msg.payload) as {
        userId?: number;
        username?: string;
        fullName?: string;
        transcript?: string;
        duration?: number;
        hasAudio?: boolean;
      } | undefined;
      if (!data?.userId) return;
      const who = data.fullName || data.username || `UNIT ${data.userId}`;
      const dur = data.duration ? ` · ${data.duration}s` : '';
      const rec = data.hasAudio ? ' · REC' : '';
      addEntry({
        source: who.toUpperCase().slice(0, 10),
        text: (data.transcript || 'Voice transmission') + dur + rec,
        type: 'unit',
      });
    }));

    unsubs.push(subscribe('radio_check_ack', (msg) => {
      const data = (msg.data || msg.payload) as { unitId?: string; callSign?: string } | undefined;
      addEntry({
        source: 'SYSTEM',
        text: `Radio check ACK from ${data?.callSign || data?.unitId || 'unit'}`,
        type: 'system',
      });
    }));

    unsubs.push(subscribe('panic_alert', (msg) => {
      const data = (msg.data || msg.payload) as { source?: string; callSign?: string } | undefined;
      addEntry({
        source: data?.callSign || data?.source || 'ALERT',
        text: 'PANIC ALERT ACTIVATED',
        type: 'emergency',
      });
    }));

    unsubs.push(subscribe('emergency_talkgroup_active', () => {
      addEntry({
        source: 'SYSTEM',
        text: 'Emergency talkgroup override activated',
        type: 'emergency',
      });
    }));

    unsubs.push(subscribe('emergency_talkgroup_ended', () => {
      addEntry({
        source: 'SYSTEM',
        text: 'Emergency talkgroup override ended',
        type: 'system',
      });
    }));

    return () => unsubs.forEach((u) => u());
  }, [subscribe, addEntry]);

  return (
    <div className="border border-[#222222] rounded-[2px] p-2 bg-[#0d0d0d]">
      <div className="text-[9px] font-semibold text-[#888888] uppercase tracking-[0.5px] mb-1.5">
        TX LOG
      </div>

      <div
        className="overflow-y-auto scrollbar-dark space-y-0"
        style={{ maxHeight: 140 }}
      >
        {entries.length === 0 ? (
          <div className="text-[9px] text-[#555555] italic py-1">No transmissions</div>
        ) : (
          entries.map((entry) => (
            <div
              key={entry.id}
              className="flex items-start gap-1.5 py-px"
              style={{ fontFamily: 'monospace' }}
            >
              <span className="text-[10px] text-[#555555] tabular-nums shrink-0 whitespace-nowrap">
                {entry.time}
              </span>
              <span
                className="text-[10px] font-bold shrink-0 whitespace-nowrap"
                style={{ color: TYPE_COLORS[entry.type], maxWidth: 70 }}
              >
                [{entry.source}]
              </span>
              <span
                className="text-[10px] truncate"
                style={{ color: TYPE_COLORS[entry.type] }}
              >
                {entry.text}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
});

export default TransmissionLog;
