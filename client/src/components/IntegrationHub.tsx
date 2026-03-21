// ============================================================
// RMPG Flex — Integration Hub Dashboard Widget
// Shows live status of all configured integrations
// ============================================================

import React, { useState, useEffect, useCallback } from 'react';
import {
  MapPin,
  Briefcase,
  Shield,
  Microscope,
  Wifi,
  WifiOff,
  RefreshCw,
  Loader2,
  ArrowRight,
  Settings,
} from 'lucide-react';
import type { IntegrationStatus } from '../types';
import PanelTitleBar from './PanelTitleBar';
import { apiFetch } from '../hooks/useApi';
import { useAuth } from '../context/AuthContext';

// ─── Icon & Health Mappings ──────────────────────────────

const ICONS: Record<string, React.ElementType> = {
  clearpathgps: MapPin,
  servemanager: Briefcase,
  microbilt: Shield,
  iped: Microscope,
};

const HEALTH_LED: Record<string, string> = {
  healthy: 'led-green',
  degraded: 'led-amber animate-led-pulse',
  error: 'led-red animate-led-blink',
  unconfigured: '',
};

const HEALTH_LABEL: Record<string, { text: string; color: string }> = {
  healthy: { text: 'ONLINE', color: '#22c55e' },
  degraded: { text: 'DEGRADED', color: '#f59e0b' },
  error: { text: 'ERROR', color: '#ef4444' },
  unconfigured: { text: 'NOT CONFIGURED', color: '#6b7280' },
};

// ─── Helpers ─────────────────────────────────────────────

function formatStats(stats: Record<string, number>): string {
  return Object.entries(stats)
    .map(([key, val]) => `${val.toLocaleString()} ${key.replace(/_/g, ' ')}`)
    .join(' · ');
}

function relativeTime(iso: string | null): string {
  if (!iso) return 'Never';
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60000) return 'Just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return `${Math.floor(diff / 86400000)}d ago`;
}

// ─── Props ───────────────────────────────────────────────

interface IntegrationHubProps {
  onSetupClick?: (integrationId: string) => void;
}

// ─── Component ───────────────────────────────────────────

export default function IntegrationHub({ onSetupClick }: IntegrationHubProps) {
  const { user } = useAuth();
  const [integrations, setIntegrations] = useState<IntegrationStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const fetchStatus = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const data = await apiFetch<{ integrations: IntegrationStatus[] }>('/integrations/status');
      setIntegrations(data.integrations ?? []);
      setError(false);
    } catch {
      if (!silent) setError(true);
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStatus();
    const interval = setInterval(() => fetchStatus(true), 60_000);
    return () => clearInterval(interval);
  }, [fetchStatus]);

  // Only render for admin/manager roles
  if (!user || (user.role !== 'admin' && user.role !== 'manager')) return null;

  // Silently fail — dashboard shouldn't break
  if (error && integrations.length === 0) return null;

  const refresh = () => fetchStatus();

  return (
    <div className="panel-beveled bg-surface-base">
      <PanelTitleBar title="INTEGRATION HUB" icon={Wifi}>
        <button className="toolbar-btn flex items-center gap-1" onClick={refresh}>
          <RefreshCw style={{ width: 10, height: 10 }} className={loading ? 'animate-spin' : ''} />
          <span className="text-[9px]">Refresh</span>
        </button>
      </PanelTitleBar>
      <div className="p-3">
        {/* Loading skeleton */}
        {loading && integrations.length === 0 ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="panel-beveled bg-surface-sunken p-3 space-y-2 animate-pulse">
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-rmpg-700" />
                  <div className="h-3 w-24 bg-rmpg-700 rounded-sm" />
                </div>
                <div className="h-2 w-32 bg-rmpg-700 rounded-sm" />
                <div className="h-2 w-20 bg-rmpg-700 rounded-sm" />
                <div className="h-[2px] w-full bg-rmpg-700 rounded-sm" />
              </div>
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {integrations.map((intg) => {
              const Icon = ICONS[intg.id] ?? Wifi;
              const healthLabel = HEALTH_LABEL[intg.health] ?? HEALTH_LABEL.unconfigured;
              const healthLed = HEALTH_LED[intg.health] ?? '';

              return (
                <div key={intg.id} className="panel-beveled bg-surface-sunken p-3 space-y-2">
                  {/* Header: LED + name + badge */}
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      {intg.health !== 'unconfigured' && <span className={`led-dot ${healthLed}`} />}
                      <Icon className="w-3.5 h-3.5 text-rmpg-400" />
                      <span className="text-[11px] text-white font-semibold">{intg.name}</span>
                    </div>
                    <span
                      className="text-[8px] font-bold uppercase tracking-wide"
                      style={{ color: healthLabel.color }}
                    >
                      {healthLabel.text}
                    </span>
                  </div>

                  {/* Stats or "Not configured" message */}
                  {intg.configured ? (
                    <>
                      <p className="text-[9px] text-rmpg-400 font-mono">{formatStats(intg.stats)}</p>
                      <div className="flex items-center justify-between text-[9px] text-rmpg-500">
                        <span>Last sync: {relativeTime(intg.lastSync)}</span>
                        {intg.lastError && (
                          <span className="text-red-400 truncate max-w-[120px]" title={intg.lastError}>
                            ⚠ {intg.lastError}
                          </span>
                        )}
                      </div>

                      {/* Uptime bar */}
                      {intg.uptimePercent !== null && (
                        <div className="space-y-0.5">
                          <div className="flex items-center justify-between text-[8px]">
                            <span className="text-rmpg-600 uppercase">24h Uptime</span>
                            <span
                              className="font-mono"
                              style={{
                                color:
                                  intg.uptimePercent >= 90
                                    ? '#22c55e'
                                    : intg.uptimePercent >= 70
                                      ? '#f59e0b'
                                      : '#ef4444',
                              }}
                            >
                              {intg.uptimePercent}%
                            </span>
                          </div>
                          <div className="h-[2px] bg-rmpg-700 rounded-sm overflow-hidden">
                            <div
                              className="h-full transition-all duration-500"
                              style={{
                                width: `${intg.uptimePercent}%`,
                                backgroundColor:
                                  intg.uptimePercent >= 90
                                    ? '#22c55e'
                                    : intg.uptimePercent >= 70
                                      ? '#f59e0b'
                                      : '#ef4444',
                              }}
                            />
                          </div>
                        </div>
                      )}

                      {/* Configure link */}
                      <button
                        className="toolbar-btn text-[8px] w-full flex items-center justify-center gap-1"
                        style={{ padding: '2px 6px' }}
                        onClick={() => onSetupClick?.(intg.id)}
                      >
                        <Settings className="w-3 h-3" /> Configure
                      </button>
                    </>
                  ) : (
                    <>
                      <p className="text-[9px] text-rmpg-500">{intg.description}</p>
                      <button
                        className="toolbar-btn toolbar-btn-primary text-[8px] w-full flex items-center justify-center gap-1"
                        style={{ padding: '3px 8px' }}
                        onClick={() => onSetupClick?.(intg.id)}
                      >
                        <ArrowRight className="w-3 h-3" /> Setup Integration
                      </button>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
