// System diagnostics aggregator
import os from 'os';
import {
  getMetricsSnapshot,
  getMemoryUsage,
  getServerTiming,
  getErrorRates,
} from './metricsCollector';
import { checkDbHealth } from './dbHealth';
import { getCircuitBreakerStates } from './circuitBreaker';
import { getTaskHealthReport } from './schedulerHealth';
import { getDeprecatedEndpoints } from './deprecationWarning';

export interface SystemDiagnostics {
  timestamp: string;
  system: {
    hostname: string;
    platform: string;
    arch: string;
    nodeVersion: string;
    cpus: number;
    totalMemoryMb: number;
    freeMemoryMb: number;
    loadAverage: number[];
    uptimeSeconds: number;
  };
  server: {
    uptimeSeconds: number;
    startedAt: string;
    memory: Record<string, number>;
  };
  database: ReturnType<typeof checkDbHealth>;
  metrics: ReturnType<typeof getMetricsSnapshot>;
  circuitBreakers: Record<string, any>;
  scheduledTasks: ReturnType<typeof getTaskHealthReport>;
  errorRates: Record<string, any>;
  deprecatedEndpoints: ReturnType<typeof getDeprecatedEndpoints>;
}

/** Collect comprehensive system diagnostics */
export function collectDiagnostics(): SystemDiagnostics {
  const serverTiming = getServerTiming();

  return {
    timestamp: new Date().toISOString(),
    system: {
      hostname: os.hostname(),
      platform: os.platform(),
      arch: os.arch(),
      nodeVersion: process.version,
      cpus: os.cpus().length,
      totalMemoryMb: Math.round(os.totalmem() / 1024 / 1024),
      freeMemoryMb: Math.round(os.freemem() / 1024 / 1024),
      loadAverage: os.loadavg(),
      uptimeSeconds: Math.round(os.uptime()),
    },
    server: {
      uptimeSeconds: serverTiming.uptimeSeconds,
      startedAt: serverTiming.startedAt,
      memory: getMemoryUsage(),
    },
    database: checkDbHealth(),
    metrics: getMetricsSnapshot(),
    circuitBreakers: getCircuitBreakerStates(),
    scheduledTasks: getTaskHealthReport(),
    errorRates: getErrorRates(),
    deprecatedEndpoints: getDeprecatedEndpoints(),
  };
}
