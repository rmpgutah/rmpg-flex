import React, { useState } from 'react';
import {
  Loader2, RefreshCw, AlertTriangle, Clock, Monitor,
  Database, Wifi, Brain, Shield, HardDrive, Heart, Trash2,
} from 'lucide-react';
import { apiFetch } from '../../../hooks/useApi';
import { HealthMetric, CleanupSection } from './AISharedComponents';

interface Props {
  setError: (e: string | null) => void;
}

export default function AIIntelligencePanel({ setError }: Props) {
  // Health state
  const [healthReport, setHealthReport] = useState<any>(null);
  const [healthLoading, setHealthLoading] = useState(false);

  // Cleanup state
  const [cleanupReport, setCleanupReport] = useState<any>(null);
  const [cleanupLoading, setCleanupLoading] = useState(false);
  const [fixingIds, setFixingIds] = useState<Set<string>>(new Set());
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    staleCalls: true, orphanedUnits: true, incompleteRecords: true,
  });

  const checkHealth = async () => {
    setHealthLoading(true);
    try {
      const report = await apiFetch<any>('/ai/health');
      setHealthReport(report);
    } catch (err: any) {
      setError(err?.message || 'Health check failed');
    } finally {
      setHealthLoading(false);
    }
  };

  const scanCleanup = async () => {
    setCleanupLoading(true);
    try {
      const report = await apiFetch<any>('/ai/cleanup/scan');
      setCleanupReport(report);
    } catch (err: any) {
      setError(err?.message || 'Cleanup scan failed');
    } finally {
      setCleanupLoading(false);
    }
  };

  const fixItem = async (type: string, id: number | string, action: string, fixKey: string) => {
    setFixingIds(p => new Set(p).add(fixKey));
    try {
      await apiFetch('/ai/cleanup/fix', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, id, action }),
      });
      const report = await apiFetch<any>('/ai/cleanup/scan');
      setCleanupReport(report);
    } catch (err: any) {
      setError(err?.message || 'Fix failed');
    } finally {
      setFixingIds(p => { const n = new Set(p); n.delete(fixKey); return n; });
    }
  };

  return (
    <div className="space-y-6">
      {/* ── Health Section ── */}
      <section>
        <h3 className="text-xs font-semibold text-white uppercase tracking-wide mb-2 flex items-center gap-2">
          <Heart className="w-3.5 h-3.5 text-brand-400" />
          System Health
          <button
            onClick={checkHealth}
            disabled={healthLoading}
            className="ml-auto flex items-center gap-1.5 px-3 py-1.5 bg-brand-600 hover:bg-brand-500 text-white text-xs font-medium rounded transition-colors disabled:opacity-50"
          >
            {healthLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
            Check Health
          </button>
        </h3>

        <div className="bg-[#0f1218] border border-[#1a1a2e] rounded p-4">
          {healthReport ? (
            <div className="space-y-4">
              {healthReport.aiSummary && (
                <div className="px-3 py-2 bg-[#0a0a12] border border-[#1a1a2e] rounded text-xs text-rmpg-300 leading-relaxed">
                  {healthReport.aiSummary}
                </div>
              )}

              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                <HealthMetric label="Uptime" value={`${healthReport.server?.uptime_hours || 0}h`} status="green" icon={<Clock className="w-3.5 h-3.5" />} />
                <HealthMetric
                  label="Memory (RSS)" value={`${healthReport.server?.memory_rss_mb || 0}MB`}
                  status={(healthReport.server?.memory_rss_mb || 0) > 512 ? 'red' : (healthReport.server?.memory_rss_mb || 0) > 256 ? 'yellow' : 'green'}
                  icon={<Monitor className="w-3.5 h-3.5" />}
                />
                <HealthMetric
                  label="Database" value={`${healthReport.database?.size_mb || 0}MB`}
                  status={healthReport.database?.integrity === 'ok' ? 'green' : 'red'}
                  icon={<Database className="w-3.5 h-3.5" />}
                />
                <HealthMetric label="Connections" value={String(healthReport.websocket?.active_connections || 0)} status="green" icon={<Wifi className="w-3.5 h-3.5" />} />
                <HealthMetric
                  label="AI Provider" value={healthReport.ai?.provider || 'none'}
                  status={healthReport.ai?.available ? 'green' : 'red'}
                  icon={<Brain className="w-3.5 h-3.5" />}
                />
                {healthReport.ssl?.days_remaining !== undefined && (
                  <HealthMetric
                    label="SSL Expires" value={`${healthReport.ssl.days_remaining}d`}
                    status={healthReport.ssl.days_remaining < 14 ? 'red' : healthReport.ssl.days_remaining < 30 ? 'yellow' : 'green'}
                    icon={<Shield className="w-3.5 h-3.5" />}
                  />
                )}
                {healthReport.disk?.available_gb !== undefined && (
                  <HealthMetric
                    label="Disk Free" value={`${healthReport.disk.available_gb}GB`}
                    status={healthReport.disk.available_gb < 2 ? 'red' : healthReport.disk.available_gb < 10 ? 'yellow' : 'green'}
                    icon={<HardDrive className="w-3.5 h-3.5" />}
                  />
                )}
              </div>

              {healthReport.issues?.length > 0 && (
                <div className="space-y-1">
                  <div className="text-[10px] text-rmpg-500 uppercase font-medium">Issues Detected</div>
                  {healthReport.issues.map((issue: string, i: number) => (
                    <div key={i} className="flex items-center gap-2 px-3 py-1.5 bg-red-900/10 border border-red-900/20 rounded text-xs text-red-400">
                      <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                      {issue}
                    </div>
                  ))}
                </div>
              )}

              {healthReport.database?.record_counts && (
                <div className="space-y-1">
                  <div className="text-[10px] text-rmpg-500 uppercase font-medium">Record Counts</div>
                  <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
                    {Object.entries(healthReport.database.record_counts).map(([table, count]) => (
                      <div key={table} className="text-center px-2 py-1.5 bg-[#0a0a12] border border-[#1a1a2e] rounded">
                        <div className="text-xs font-mono text-white">{String(count)}</div>
                        <div className="text-[9px] text-rmpg-600 mt-0.5 truncate">{table.replace(/_/g, ' ')}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="text-[10px] text-rmpg-600 text-right">Last checked: {healthReport.timestamp}</div>
            </div>
          ) : (
            <p className="text-xs text-rmpg-500">Click "Check Health" to run a system health scan.</p>
          )}
        </div>
      </section>

      {/* ── Data Cleanup Section ── */}
      <section>
        <h3 className="text-xs font-semibold text-white uppercase tracking-wide mb-2 flex items-center gap-2">
          <Trash2 className="w-3.5 h-3.5 text-brand-400" />
          Data Cleanup
          <button
            onClick={scanCleanup}
            disabled={cleanupLoading}
            className="ml-auto flex items-center gap-1.5 px-3 py-1.5 bg-brand-600 hover:bg-brand-500 text-white text-xs font-medium rounded transition-colors disabled:opacity-50"
          >
            {cleanupLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
            Scan for Issues
          </button>
        </h3>

        <div className="bg-[#0f1218] border border-[#1a1a2e] rounded p-4">
          {cleanupReport ? (
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <div className={`text-sm font-bold ${cleanupReport.totalIssues > 0 ? 'text-yellow-400' : 'text-green-400'}`}>
                  {cleanupReport.totalIssues} issue{cleanupReport.totalIssues !== 1 ? 's' : ''} found
                </div>
                <div className="text-[10px] text-rmpg-600">Scanned at {cleanupReport.timestamp}</div>
              </div>

              {cleanupReport.aiSummary && (
                <div className="px-3 py-2 bg-[#0a0a12] border border-[#1a1a2e] rounded text-xs text-rmpg-300 leading-relaxed">
                  {cleanupReport.aiSummary}
                </div>
              )}

              {/* Stale Calls */}
              <CleanupSection
                title={`Stale Calls (${cleanupReport.staleCalls?.count || 0})`}
                expanded={expandedSections.staleCalls}
                onToggle={() => setExpandedSections(p => ({ ...p, staleCalls: !p.staleCalls }))}
                empty={!cleanupReport.staleCalls?.count}
              >
                {cleanupReport.staleCalls?.items?.map((item: any) => (
                  <div key={item.call_id} className="flex items-center gap-3 px-3 py-2 bg-[#0a0a12] border border-[#1a1a2e] rounded">
                    <div className="flex-1 min-w-0">
                      <div className="text-xs text-white font-mono">{item.call_number}</div>
                      <div className="text-[10px] text-rmpg-500">
                        {item.incident_type} &mdash; stuck in "{item.status}" for {item.hours_in_status}h
                      </div>
                    </div>
                    <div className="flex gap-1.5 shrink-0">
                      {(['clear', 'close', 'escalate'] as const).map(action => (
                        <button
                          key={action}
                          disabled={fixingIds.has(`call-${item.call_id}`)}
                          onClick={() => fixItem('stale_call', item.call_id, action, `call-${item.call_id}`)}
                          className={`px-2 py-1 text-[10px] font-medium rounded transition-colors disabled:opacity-50 ${
                            action === 'escalate'
                              ? 'bg-yellow-900/20 text-yellow-400 hover:bg-yellow-900/40 border border-yellow-900/30'
                              : action === 'close'
                              ? 'bg-red-900/20 text-red-400 hover:bg-red-900/40 border border-red-900/30'
                              : 'bg-brand-900/20 text-brand-400 hover:bg-brand-900/40 border border-brand-900/30'
                          }`}
                        >
                          {fixingIds.has(`call-${item.call_id}`) ? '...' : action.charAt(0).toUpperCase() + action.slice(1)}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </CleanupSection>

              {/* Orphaned Units */}
              <CleanupSection
                title={`Orphaned Units (${cleanupReport.orphanedUnits?.count || 0})`}
                expanded={expandedSections.orphanedUnits}
                onToggle={() => setExpandedSections(p => ({ ...p, orphanedUnits: !p.orphanedUnits }))}
                empty={!cleanupReport.orphanedUnits?.count}
              >
                {cleanupReport.orphanedUnits?.items?.map((item: any) => (
                  <div key={item.unit_id} className="flex items-center gap-3 px-3 py-2 bg-[#0a0a12] border border-[#1a1a2e] rounded">
                    <div className="flex-1 min-w-0">
                      <div className="text-xs text-white font-mono">{item.call_sign}</div>
                      <div className="text-[10px] text-rmpg-500">Shows "{item.status}" with no active call</div>
                    </div>
                    <button
                      disabled={fixingIds.has(`unit-${item.unit_id}`)}
                      onClick={() => fixItem('orphaned_unit', item.unit_id, 'reset', `unit-${item.unit_id}`)}
                      className="px-2 py-1 text-[10px] font-medium rounded bg-brand-900/20 text-brand-400 hover:bg-brand-900/40 border border-brand-900/30 transition-colors disabled:opacity-50"
                    >
                      {fixingIds.has(`unit-${item.unit_id}`) ? '...' : 'Reset'}
                    </button>
                  </div>
                ))}
              </CleanupSection>

              {/* Incomplete Records */}
              <CleanupSection
                title={`Incomplete Records (${cleanupReport.incompleteRecords?.count || 0})`}
                expanded={expandedSections.incompleteRecords}
                onToggle={() => setExpandedSections(p => ({ ...p, incompleteRecords: !p.incompleteRecords }))}
                empty={!cleanupReport.incompleteRecords?.count}
              >
                {cleanupReport.incompleteRecords?.items?.map((item: any) => (
                  <div key={item.call_id} className="flex items-center gap-3 px-3 py-2 bg-[#0a0a12] border border-[#1a1a2e] rounded">
                    <div className="flex-1 min-w-0">
                      <div className="text-xs text-white font-mono">{item.call_number}</div>
                      <div className="text-[10px] text-rmpg-500">Missing: {item.missing_fields?.join(', ')}</div>
                    </div>
                    <span className="text-[10px] text-yellow-500 shrink-0">Needs review</span>
                  </div>
                ))}
              </CleanupSection>
            </div>
          ) : (
            <p className="text-xs text-rmpg-500">Click "Scan for Issues" to detect stale calls, orphaned units, and incomplete records.</p>
          )}
        </div>
      </section>
    </div>
  );
}
