/**
 * AI System Health Monitor
 *
 * Checks database integrity, server metrics, WebSocket connections,
 * AI provider status, SSL cert expiry, and disk space.
 */

import fs from 'fs';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { fileURLToPath } from 'url';
import { getDb } from '../models/database';
import { localNow } from './timeUtils';
import aiManager from './aiManager';
import { getConnectedClientCount } from './websocket';

const execFileAsync = promisify(execFile);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SystemHealthReport {
  timestamp: string;
  database: {
    size_mb: number;
    integrity: string;
    record_counts: Record<string, number>;
  };
  server: {
    uptime_hours: number;
    memory_mb: number;
    memory_rss_mb: number;
    cpu_percent?: number;
  };
  websocket: {
    active_connections: number;
  };
  ai: {
    provider: string;
    available: boolean;
  };
  ssl: {
    expires_at?: string;
    days_remaining?: number;
  };
  disk?: {
    available_gb?: number;
  };
  issues: string[];
}

// ---------------------------------------------------------------------------
// Health Check
// ---------------------------------------------------------------------------

export async function checkSystemHealth(): Promise<SystemHealthReport> {
  const issues: string[] = [];

  // ── Database ──
  let dbSizeMb = 0;
  let integrity = 'unknown';
  const recordCounts: Record<string, number> = {};

  try {
    const db = getDb();

    // Database file size
    const DATA_DIR = process.env.RMPG_DATA_DIR || path.resolve(__dirname, '../../data');
    const dbPath = path.join(DATA_DIR, 'rmpg-flex.db');
    try {
      const stat = fs.statSync(dbPath);
      dbSizeMb = Math.round((stat.size / (1024 * 1024)) * 100) / 100;
      if (dbSizeMb > 500) issues.push(`Database is large: ${dbSizeMb}MB`);
    } catch {
      // DB file might not exist in dev
    }

    // Integrity check
    try {
      const result = db.prepare('PRAGMA integrity_check').get() as any;
      integrity = result?.integrity_check || 'ok';
      if (integrity !== 'ok') issues.push(`Database integrity issue: ${integrity}`);
    } catch (err: any) {
      integrity = `error: ${err?.message}`;
      issues.push('Database integrity check failed');
    }

    // Record counts for key tables
    const tables = [
      'calls_for_service', 'incidents', 'units', 'users',
      'persons', 'vehicles', 'warrants', 'citations', 'activity_log',
    ];
    for (const table of tables) {
      try {
        const row = db.prepare(`SELECT COUNT(*) AS cnt FROM ${table}`).get() as any;
        recordCounts[table] = row?.cnt || 0;
      } catch {
        // Table might not exist
      }
    }
  } catch (err: any) {
    issues.push(`Database access error: ${err?.message}`);
  }

  // ── Server metrics ──
  const uptimeHours = Math.round((process.uptime() / 3600) * 100) / 100;
  const mem = process.memoryUsage();
  const memoryMb = Math.round(mem.heapUsed / (1024 * 1024));
  const memoryRssMb = Math.round(mem.rss / (1024 * 1024));

  if (memoryRssMb > 512) issues.push(`High memory usage: ${memoryRssMb}MB RSS`);

  // ── WebSocket ──
  let activeConnections = 0;
  try {
    activeConnections = getConnectedClientCount();
  } catch {
    // WebSocket not initialized yet
  }

  // ── AI Provider ──
  const aiStatus = aiManager.getStatus();
  if (!aiStatus.available) issues.push('No AI provider available');

  // ── SSL cert expiry ──
  let sslExpiresAt: string | undefined;
  let sslDaysRemaining: number | undefined;

  const certPaths = [
    path.resolve(__dirname, '../../certs/fullchain.pem'),
    '/etc/letsencrypt/live/rmpgutah.us/fullchain.pem',
  ];

  for (const certPath of certPaths) {
    try {
      if (fs.existsSync(certPath)) {
        const stat = fs.statSync(certPath);
        // Estimate expiry: Let's Encrypt certs are 90 days from modification
        const mtime = new Date(stat.mtime);
        const expiryDate = new Date(mtime.getTime() + 90 * 24 * 60 * 60 * 1000);
        sslExpiresAt = expiryDate.toISOString().slice(0, 10);
        sslDaysRemaining = Math.round((expiryDate.getTime() - Date.now()) / (24 * 60 * 60 * 1000));
        if (sslDaysRemaining < 14) issues.push(`SSL cert expires in ${sslDaysRemaining} days`);
        break;
      }
    } catch {
      // Can't read cert
    }
  }

  // ── Disk space (best-effort, macOS/Linux only) ──
  let availableGb: number | undefined;
  try {
    const { stdout } = await execFileAsync('df', ['-k', '/'], { timeout: 3000 });
    const lines = stdout.trim().split('\n');
    if (lines.length >= 2) {
      const parts = lines[1].trim().split(/\s+/);
      // df output: Filesystem 1K-blocks Used Available Use% Mounted
      const availKb = parseInt(parts[3], 10);
      if (!isNaN(availKb)) {
        availableGb = Math.round((availKb / (1024 * 1024)) * 100) / 100;
        if (availableGb < 2) issues.push(`Low disk space: ${availableGb}GB available`);
      }
    }
  } catch {
    // Not critical
  }

  return {
    timestamp: localNow(),
    database: { size_mb: dbSizeMb, integrity, record_counts: recordCounts },
    server: { uptime_hours: uptimeHours, memory_mb: memoryMb, memory_rss_mb: memoryRssMb },
    websocket: { active_connections: activeConnections },
    ai: { provider: aiStatus.provider, available: aiStatus.available },
    ssl: { expires_at: sslExpiresAt, days_remaining: sslDaysRemaining },
    disk: availableGb !== undefined ? { available_gb: availableGb } : undefined,
    issues,
  };
}

// ---------------------------------------------------------------------------
// AI-Generated Health Summary
// ---------------------------------------------------------------------------

export async function getHealthSummary(): Promise<string> {
  const report = await checkSystemHealth();

  const metrics = [
    `Server uptime: ${report.server.uptime_hours}h`,
    `Memory: ${report.server.memory_rss_mb}MB RSS`,
    `Database: ${report.database.size_mb}MB, integrity: ${report.database.integrity}`,
    `WebSocket connections: ${report.websocket.active_connections}`,
    `AI provider: ${report.ai.provider} (${report.ai.available ? 'online' : 'offline'})`,
    report.ssl.days_remaining !== undefined ? `SSL expires in ${report.ssl.days_remaining} days` : null,
    report.disk?.available_gb !== undefined ? `Disk: ${report.disk.available_gb}GB free` : null,
    `Issues: ${report.issues.length > 0 ? report.issues.join('; ') : 'none'}`,
  ].filter(Boolean).join('. ');

  try {
    const summary = await aiManager.chat(
      'You are a system administrator assistant for a police CAD/RMS application. Provide a brief, clear health summary.',
      `Generate a 2-3 sentence health summary for this system:\n${metrics}`,
      { temperature: 0.3, maxTokens: 200 },
    );
    if (summary) return summary;
  } catch {
    // Fallback to simple summary
  }

  // Fallback non-AI summary
  if (report.issues.length === 0) {
    return `System healthy. Uptime ${report.server.uptime_hours}h, ${report.server.memory_rss_mb}MB memory, ${report.websocket.active_connections} active connections.`;
  }
  return `${report.issues.length} issue(s) detected: ${report.issues.join('; ')}. Uptime ${report.server.uptime_hours}h, ${report.server.memory_rss_mb}MB memory.`;
}
