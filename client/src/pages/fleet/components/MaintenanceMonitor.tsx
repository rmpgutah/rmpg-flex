// ============================================================
// RMPG Flex — Fleet: Maintenance Monitor Panel
// Consolidated fleet-wide maintenance alerts with severity tiers,
// countdown timers, and category-based grouping.
// ============================================================

import React, { useState, useEffect, useCallback } from 'react';
import {
  AlertTriangle, Wrench, Shield, Calendar, Gauge, ChevronDown, ChevronUp,
  RefreshCw, Loader2, CheckCircle, AlertOctagon, Clock, Car,
} from 'lucide-react';
import { apiFetch } from '../../../hooks/useApi';

// ── Types ────────────────────────────────────────────────

interface MaintenanceAlert {
  id: string;
  vehicle_id: string;
  vehicle_number: string;
  vehicle_label: string;
  assigned_unit: string | null;
  category: 'service' | 'registration' | 'insurance' | 'maintenance_item' | 'mileage';
  severity: 'critical' | 'urgent' | 'warning';
  title: string;
  message: string;
  due_date?: string;
  days_until?: number;
  maintenance_type?: string;
  due_mileage?: number;
  current_mileage?: number;
  miles_remaining?: number;
}

interface AlertSummary {
  total_alerts: number;
  critical: number;
  urgent: number;
  warning: number;
  by_category: Record<string, number>;
  fleet_size: number;
  vehicles_needing_attention: number;
}

interface MaintenanceAlertData {
  summary: AlertSummary;
  alerts: MaintenanceAlert[];
}

// ── Category config ──────────────────────────────────────

const CATEGORY_CONFIG: Record<string, { icon: React.ElementType; label: string; color: string }> = {
  service: { icon: Wrench, label: 'Service', color: 'text-amber-400' },
  registration: { icon: Calendar, label: 'Registration', color: 'text-red-400' },
  insurance: { icon: Shield, label: 'Insurance', color: 'text-red-400' },
  maintenance_item: { icon: Wrench, label: 'Maintenance', color: 'text-blue-400' },
  mileage: { icon: Gauge, label: 'Mileage', color: 'text-cyan-400' },
};

const SEVERITY_CONFIG: Record<string, { bg: string; border: string; text: string; led: string; label: string }> = {
  critical: { bg: 'bg-red-950/30', border: 'border-red-700/40', text: 'text-red-400', led: 'led-red', label: 'CRITICAL' },
  urgent: { bg: 'bg-amber-950/20', border: 'border-amber-700/30', text: 'text-amber-400', led: 'led-amber', label: 'URGENT' },
  warning: { bg: 'bg-blue-950/15', border: 'border-blue-700/20', text: 'text-blue-400', led: 'led-blue', label: 'NOTICE' },
};

// ── Component ────────────────────────────────────────────

interface Props {
  onSelectVehicle?: (vehicleId: string | number) => void;
}

export default function MaintenanceMonitor({ onSelectVehicle }: Props) {
  const [data, setData] = useState<MaintenanceAlertData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [expandedCategory, setExpandedCategory] = useState<string | null>(null);

  const fetchAlerts = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    else setRefreshing(true);
    try {
      const result = await apiFetch<MaintenanceAlertData>('/fleet/maintenance-alerts');
      setData(result);
      setError(null);
    } catch (err: any) {
      setError(err?.message || 'Failed to load maintenance alerts');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { fetchAlerts(); }, [fetchAlerts]);

  // Auto-refresh every 5 minutes
  useEffect(() => {
    const timer = setInterval(() => fetchAlerts(true), 300000);
    return () => clearInterval(timer);
  }, [fetchAlerts]);

  if (loading) {
    return (
      <div className="panel-beveled border border-rmpg-600 m-3 p-4 flex items-center justify-center gap-2">
        <Loader2 className="w-4 h-4 text-brand-400 animate-spin" />
        <span className="text-[11px] text-rmpg-400">Loading maintenance alerts...</span>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="panel-beveled border border-rmpg-600 m-3 p-3">
        <div className="flex items-center gap-2 text-amber-400">
          <AlertTriangle className="w-4 h-4" />
          <span className="text-[11px]">{error || 'Failed to load alerts'}</span>
          <button onClick={() => fetchAlerts()} className="ml-auto toolbar-btn text-[9px]">Retry</button>
        </div>
      </div>
    );
  }

  const { summary, alerts } = data;

  // Group alerts by severity
  const criticalAlerts = alerts.filter(a => a.severity === 'critical');
  const urgentAlerts = alerts.filter(a => a.severity === 'urgent');
  const warningAlerts = alerts.filter(a => a.severity === 'warning');

  // Group by category for toggling
  const categories = Object.keys(summary.by_category);

  return (
    <div className="m-3 space-y-2">
      {/* ── Monitor Header ── */}
      <div
        className={`panel-beveled border p-2.5 cursor-pointer transition-all ${
          summary.critical > 0 ? 'border-red-700/40 bg-red-950/20' :
          summary.urgent > 0 ? 'border-amber-700/30 bg-amber-950/10' :
          summary.total_alerts > 0 ? 'border-blue-700/20 bg-blue-950/10' :
          'border-green-700/20 bg-green-950/10'
        }`}
        onClick={() => setCollapsed(!collapsed)}
      >
        <div className="flex items-center gap-2">
          {summary.total_alerts > 0 ? (
            <AlertOctagon className={`w-4 h-4 ${summary.critical > 0 ? 'text-red-400' : summary.urgent > 0 ? 'text-amber-400' : 'text-blue-400'}`} />
          ) : (
            <CheckCircle className="w-4 h-4 text-green-400" />
          )}
          <span className="text-[11px] font-bold text-rmpg-200 uppercase tracking-wider flex-1">
            Maintenance Monitor
          </span>

          {/* Summary badges */}
          {summary.critical > 0 && (
            <span className="flex items-center gap-1 px-1.5 py-0.5 bg-red-900/40 border border-red-700/30 text-[9px] text-red-400 font-bold font-mono">
              <span className="led-dot led-red" /> {summary.critical} CRITICAL
            </span>
          )}
          {summary.urgent > 0 && (
            <span className="flex items-center gap-1 px-1.5 py-0.5 bg-amber-900/30 border border-amber-700/30 text-[9px] text-amber-400 font-bold font-mono">
              {summary.urgent} URGENT
            </span>
          )}
          {summary.warning > 0 && (
            <span className="flex items-center gap-1 px-1.5 py-0.5 bg-blue-900/20 border border-blue-700/20 text-[9px] text-blue-400 font-mono">
              {summary.warning} NOTICE
            </span>
          )}
          {summary.total_alerts === 0 && (
            <span className="text-[9px] text-green-400 font-semibold">ALL CLEAR</span>
          )}

          <button
            onClick={(e) => { e.stopPropagation(); fetchAlerts(true); }}
            className={`toolbar-btn p-1 ${refreshing ? 'opacity-50' : ''}`}
            disabled={refreshing}
            title="Refresh alerts"
          >
            <RefreshCw className={`w-3 h-3 ${refreshing ? 'animate-spin' : ''}`} />
          </button>

          {collapsed ? <ChevronDown className="w-3 h-3 text-rmpg-400" /> : <ChevronUp className="w-3 h-3 text-rmpg-400" />}
        </div>

        {/* Compact stats row */}
        {!collapsed && summary.total_alerts > 0 && (
          <div className="flex items-center gap-3 mt-2 text-[9px] font-mono text-rmpg-400">
            <span><Car className="w-3 h-3 inline mr-0.5" />{summary.vehicles_needing_attention}/{summary.fleet_size} vehicles</span>
            {categories.map(cat => {
              const cfg = CATEGORY_CONFIG[cat] || CATEGORY_CONFIG.service;
              const Icon = cfg.icon;
              return (
                <span key={cat} className={cfg.color}>
                  <Icon className="w-3 h-3 inline mr-0.5" />{summary.by_category[cat]} {cfg.label.toLowerCase()}
                </span>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Alert List ── */}
      {!collapsed && summary.total_alerts > 0 && (
        <div className="space-y-1.5">
          {/* Critical alerts — always expanded */}
          {criticalAlerts.length > 0 && (
            <AlertGroup
              severity="critical"
              alerts={criticalAlerts}
              onSelectVehicle={onSelectVehicle}
              defaultExpanded
            />
          )}

          {/* Urgent alerts */}
          {urgentAlerts.length > 0 && (
            <AlertGroup
              severity="urgent"
              alerts={urgentAlerts}
              onSelectVehicle={onSelectVehicle}
              defaultExpanded={criticalAlerts.length === 0}
            />
          )}

          {/* Warning alerts */}
          {warningAlerts.length > 0 && (
            <AlertGroup
              severity="warning"
              alerts={warningAlerts}
              onSelectVehicle={onSelectVehicle}
              defaultExpanded={criticalAlerts.length === 0 && urgentAlerts.length === 0}
            />
          )}
        </div>
      )}

      {/* All clear */}
      {!collapsed && summary.total_alerts === 0 && (
        <div className="panel-beveled border border-green-700/20 bg-green-950/10 p-4 text-center">
          <CheckCircle className="w-6 h-6 text-green-400 mx-auto mb-1" />
          <div className="text-[11px] text-green-400 font-semibold">Fleet Maintenance Status: All Clear</div>
          <div className="text-[9px] text-rmpg-500 mt-0.5">
            No overdue service, expiring registrations, or insurance alerts across {summary.fleet_size} vehicles
          </div>
        </div>
      )}
    </div>
  );
}

// ── Alert Group (collapsible by severity) ────────────────

function AlertGroup({ severity, alerts, onSelectVehicle, defaultExpanded = false }: {
  severity: string;
  alerts: MaintenanceAlert[];
  onSelectVehicle?: (vehicleId: string | number) => void;
  defaultExpanded?: boolean;
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const cfg = SEVERITY_CONFIG[severity] || SEVERITY_CONFIG.warning;

  return (
    <div className={`panel-beveled border ${cfg.border} ${cfg.bg} overflow-hidden`}>
      <div
        className="flex items-center gap-2 px-3 py-1.5 cursor-pointer hover:brightness-110 transition"
        onClick={() => setExpanded(!expanded)}
      >
        <span className={`led-dot ${cfg.led}`} />
        <span className={`text-[10px] font-bold uppercase tracking-wider ${cfg.text}`}>
          {cfg.label} ({alerts.length})
        </span>
        <div className="flex-1" />
        {expanded ? <ChevronUp className="w-3 h-3 text-rmpg-400" /> : <ChevronDown className="w-3 h-3 text-rmpg-400" />}
      </div>

      {expanded && (
        <div className="border-t border-rmpg-700/30 divide-y divide-rmpg-700/20">
          {alerts.map((alert) => (
            <AlertItem key={alert.id} alert={alert} onSelect={onSelectVehicle} />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Single Alert Item ────────────────────────────────────

function AlertItem({ alert, onSelect }: {
  alert: MaintenanceAlert;
  onSelect?: (vehicleId: string | number) => void;
}) {
  const catCfg = CATEGORY_CONFIG[alert.category] || CATEGORY_CONFIG.service;
  const CatIcon = catCfg.icon;

  return (
    <div
      className={`flex items-center gap-2 px-3 py-2 hover:brightness-110 transition ${
        onSelect ? 'cursor-pointer' : ''
      }`}
      onClick={() => onSelect?.(alert.vehicle_id)}
    >
      <CatIcon className={`w-3.5 h-3.5 flex-shrink-0 ${catCfg.color}`} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-rmpg-200 font-semibold truncate">{alert.vehicle_label}</span>
          {alert.assigned_unit && (
            <span className="text-[8px] text-amber-400 font-mono bg-amber-900/20 px-1 py-0.5 rounded">
              {alert.assigned_unit}
            </span>
          )}
          <span className={`text-[9px] font-bold ${catCfg.color}`}>
            {alert.title}
          </span>
        </div>
        <div className="text-[9px] text-rmpg-500 mt-0.5">{alert.message}</div>
      </div>

      {/* Countdown / indicator */}
      {alert.days_until !== undefined && (
        <div className="flex-shrink-0 text-right">
          <div className={`text-[11px] font-mono font-bold ${
            alert.days_until < 0 ? 'text-red-400' :
            alert.days_until <= 3 ? 'text-amber-400' :
            'text-blue-400'
          }`}>
            {alert.days_until < 0
              ? `${Math.abs(alert.days_until)}d ago`
              : alert.days_until === 0 ? 'TODAY'
              : `${alert.days_until}d`}
          </div>
          {alert.due_date && (
            <div className="text-[8px] text-rmpg-600 font-mono">
              {new Date(alert.due_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
            </div>
          )}
        </div>
      )}

      {/* Mileage indicator */}
      {alert.miles_remaining !== undefined && (
        <div className="flex-shrink-0 text-right">
          <div className={`text-[11px] font-mono font-bold ${
            alert.miles_remaining <= 0 ? 'text-red-400' : 'text-amber-400'
          }`}>
            {alert.miles_remaining <= 0
              ? `+${Math.abs(alert.miles_remaining).toLocaleString()} mi`
              : `${alert.miles_remaining.toLocaleString()} mi`}
          </div>
          <div className="text-[8px] text-rmpg-600 font-mono">remaining</div>
        </div>
      )}
    </div>
  );
}
