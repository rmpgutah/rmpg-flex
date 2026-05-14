import { useState, useEffect, useRef, useCallback } from 'react';
import { useWebSocket } from '../context/WebSocketContext';

export interface RadioCheckResult {
  unitId: string;
  callSign: string;
  sentAt: number;
  latencyMs: number | null;
  batteryPct: number | null;
  gpsAccuracy: number | null;
  status: 'pending' | 'ok' | 'no_response';
}

const TIMEOUT_MS = 10_000;

export function useRadioCheck() {
  const { send, subscribe } = useWebSocket();
  const [results, setResults] = useState<RadioCheckResult[]>([]);
  const pendingRef = useRef<Map<string, { sentAt: number; timer: ReturnType<typeof setTimeout> }>>(new Map());

  // Subscribe to radio_check_ack messages
  useEffect(() => {
    const unsub = subscribe('radio_check_ack', (msg) => {
      const data = (msg.data || msg.payload) as {
        unitId?: string;
        batteryPct?: number;
        gpsAccuracy?: number;
      } | undefined;
      if (!data?.unitId) return;

      const pending = pendingRef.current.get(data.unitId);
      if (!pending) return;

      // Clear timeout
      clearTimeout(pending.timer);
      pendingRef.current.delete(data.unitId);

      const latencyMs = Date.now() - pending.sentAt;

      setResults((prev) => prev.map((r) =>
        r.unitId === data.unitId && r.status === 'pending'
          ? {
              ...r,
              latencyMs,
              batteryPct: data.batteryPct ?? null,
              gpsAccuracy: data.gpsAccuracy ?? null,
              status: 'ok' as const,
            }
          : r,
      ));
    });

    return unsub;
  }, [subscribe]);

  // Cleanup all pending timers on unmount
  useEffect(() => {
    return () => {
      pendingRef.current.forEach((p) => clearTimeout(p.timer));
      pendingRef.current.clear();
    };
  }, []);

  const sendRadioCheck = useCallback((unitId: string, callSign: string) => {
    const sentAt = Date.now();

    // Add pending result
    const newResult: RadioCheckResult = {
      unitId,
      callSign,
      sentAt,
      latencyMs: null,
      batteryPct: null,
      gpsAccuracy: null,
      status: 'pending',
    };

    setResults((prev) => [newResult, ...prev].slice(0, 50));

    // Send WebSocket message
    send({
      type: 'radio_check',
      data: { unitId, sentAt },
    });

    // Set timeout for no response
    const timer = setTimeout(() => {
      pendingRef.current.delete(unitId);
      setResults((prev) => prev.map((r) =>
        r.unitId === unitId && r.sentAt === sentAt && r.status === 'pending'
          ? { ...r, status: 'no_response' as const }
          : r,
      ));
    }, TIMEOUT_MS);

    pendingRef.current.set(unitId, { sentAt, timer });
  }, [send]);

  return { sendRadioCheck, results };
}
