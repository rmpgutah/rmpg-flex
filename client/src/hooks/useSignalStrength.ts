import { useState, useEffect, useRef } from 'react';
import { useWebSocket } from '../context/WebSocketContext';

const PING_INTERVAL_MS = 2000;
const ROLLING_WINDOW = 10;

interface SignalStats {
  latencyMs: number;
  signalBars: number;
  throughputUp: number;
  throughputDown: number;
  packetLoss: number;
  dbm: number;
}

function latencyToBars(ms: number): number {
  if (ms < 30) return 12;
  if (ms < 50) return 10;
  if (ms < 100) return 8;
  if (ms < 200) return 6;
  if (ms < 400) return 4;
  if (ms < 800) return 2;
  return 1;
}

function latencyToDbm(ms: number): number {
  // Simulate dBm: -40 (excellent) to -110 (no signal)
  // Map 0ms -> -40dBm, 1000ms -> -110dBm
  const clamped = Math.min(Math.max(ms, 0), 1000);
  return Math.round(-40 - (clamped / 1000) * 70);
}

export function useSignalStrength(): SignalStats {
  const { isConnected, send, subscribe } = useWebSocket();
  const [stats, setStats] = useState<SignalStats>({
    latencyMs: 0,
    signalBars: 0,
    throughputUp: 0,
    throughputDown: 0,
    packetLoss: 0,
    dbm: -110,
  });

  const latencySamplesRef = useRef<number[]>([]);
  const pendingPingRef = useRef<number | null>(null);
  const totalPingsRef = useRef(0);
  const missedPingsRef = useRef(0);
  const bytesUpRef = useRef(0);
  const bytesDownRef = useRef(0);

  // Listen for pong responses to measure latency
  useEffect(() => {
    const unsub = subscribe('pong' as any, () => {
      if (pendingPingRef.current !== null) {
        const latency = performance.now() - pendingPingRef.current;
        pendingPingRef.current = null;

        // Track bytes (approximate: pong message ~20 bytes)
        bytesDownRef.current += 20;

        // Add to rolling window
        const samples = latencySamplesRef.current;
        samples.push(latency);
        if (samples.length > ROLLING_WINDOW) {
          samples.shift();
        }
      }
    });

    return unsub;
  }, [subscribe]);

  // Periodic ping + stats update
  useEffect(() => {
    if (!isConnected) {
      setStats({
        latencyMs: 0,
        signalBars: 0,
        throughputUp: 0,
        throughputDown: 0,
        packetLoss: 0,
        dbm: -110,
      });
      latencySamplesRef.current = [];
      pendingPingRef.current = null;
      totalPingsRef.current = 0;
      missedPingsRef.current = 0;
      bytesUpRef.current = 0;
      bytesDownRef.current = 0;
      return;
    }

    const interval = setInterval(() => {
      // Check for missed pong from previous ping
      if (pendingPingRef.current !== null) {
        missedPingsRef.current++;
        pendingPingRef.current = null;
      }

      // Send ping
      totalPingsRef.current++;
      pendingPingRef.current = performance.now();
      send({ type: 'ping' as any });
      bytesUpRef.current += 20; // approximate ping size

      // Calculate stats
      const samples = latencySamplesRef.current;
      const avgLatency = samples.length > 0
        ? samples.reduce((a, b) => a + b, 0) / samples.length
        : 0;

      const packetLoss = totalPingsRef.current > 0
        ? missedPingsRef.current / totalPingsRef.current
        : 0;

      // Throughput (bytes per 2-second window -> bytes/s)
      const throughputUp = bytesUpRef.current / (PING_INTERVAL_MS / 1000);
      const throughputDown = bytesDownRef.current / (PING_INTERVAL_MS / 1000);

      // Reset byte counters for next window
      bytesUpRef.current = 0;
      bytesDownRef.current = 0;

      setStats({
        latencyMs: Math.round(avgLatency),
        signalBars: latencyToBars(avgLatency),
        throughputUp: Math.round(throughputUp),
        throughputDown: Math.round(throughputDown),
        packetLoss: Math.round(packetLoss * 100),
        dbm: latencyToDbm(avgLatency),
      });
    }, PING_INTERVAL_MS);

    return () => clearInterval(interval);
  }, [isConnected, send]);

  return stats;
}
