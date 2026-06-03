import { useState, useEffect, useCallback } from 'react';
import { parseTimestamp } from '../utils/dateUtils';
import { AlertTriangle, ShieldAlert, Radio, X, Check } from 'lucide-react';
import { apiFetch } from '../hooks/useApi';

interface AnomalyAlert {
  id: number;
  alert_type: string;
  severity: string;
  title: string;
  details: string;
  zone_beat: string | null;
  acknowledged_by: number | null;
  acknowledged_at: string | null;
  created_at: string;
}

const SEVERITY_STYLES: Record<string, { bg: string; border: string; text: string; icon: string }> = {
  critical: { bg: 'rgba(239,68,68,0.12)', border: 'rgba(239,68,68,0.5)', text: '#ef4444', icon: '#ef4444' },
  high: { bg: 'rgba(249,115,22,0.12)', border: 'rgba(249,115,22,0.5)', text: '#f97316', icon: '#f97316' },
  medium: { bg: 'rgba(234,179,8,0.12)', border: 'rgba(234,179,8,0.5)', text: '#eab308', icon: '#eab308' },
};

const ALERT_TYPE_ICONS: Record<string, typeof AlertTriangle> = {
  call_spike: Radio,
  officer_stillness: ShieldAlert,
  crime_series: AlertTriangle,
};

export default function AnomalyAlertBanner() {
  const [alerts, setAlerts] = useState<AnomalyAlert[]>([]);
  const [dismissed, setDismissed] = useState<Set<number>>(new Set());

  const fetchAlerts = useCallback(async () => {
    try {
      const data = await apiFetch<AnomalyAlert[]>('/dispatch/anomaly-alerts?hours=4');
      setAlerts(data.filter(a => !a.acknowledged_at));
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    fetchAlerts();
    const interval = setInterval(fetchAlerts, 30000);
    return () => clearInterval(interval);
  }, [fetchAlerts]);

  const handleAcknowledge = async (alertId: number) => {
    try {
      await apiFetch(`/dispatch/anomaly-alerts/${alertId}/acknowledge`, { method: 'POST' });
      setAlerts(prev => prev.filter(a => a.id !== alertId));
    } catch { /* ignore */ }
  };

  const handleDismiss = (alertId: number) => {
    setDismissed(prev => new Set(prev).add(alertId));
  };

  const visibleAlerts = alerts.filter(a => !dismissed.has(a.id));
  if (visibleAlerts.length === 0) return null;

  return (
    <div className="flex flex-col gap-1 px-2 py-1 bg-surface-sunken border-b border-rmpg-700/50">
      {visibleAlerts.slice(0, 3).map(alert => {
        const style = SEVERITY_STYLES[alert.severity] || SEVERITY_STYLES.medium;
        const Icon = ALERT_TYPE_ICONS[alert.alert_type] || AlertTriangle;
        const elapsed = Math.round((Date.now() - parseTimestamp(alert.created_at).getTime()) / 60000);

        return (
          <div
            key={alert.id}
            className="flex items-center gap-2 px-2 py-1.5 text-xs font-mono"
            style={{ background: style.bg, border: `1px solid ${style.border}` }}
          >
            <Icon style={{ width: 12, height: 12, color: style.icon, flexShrink: 0 }} className={alert.severity === 'critical' ? 'animate-pulse' : ''} />
            <span className="font-bold" style={{ color: style.text }}>{alert.title}</span>
            <span className="text-rmpg-400 truncate flex-1">{alert.details}</span>
            <span className="text-[9px] text-rmpg-500 flex-shrink-0">{elapsed}m ago</span>
            <button
              onClick={() => handleAcknowledge(alert.id)}
              className="flex items-center gap-0.5 px-1.5 py-0.5 text-[9px] font-bold text-green-400 bg-green-900/30 border border-green-700/40 hover:bg-green-900/50"
              title="Acknowledge alert"
            >
              <Check style={{ width: 8, height: 8 }} /> ACK
            </button>
            <button
              onClick={() => handleDismiss(alert.id)}
              className="text-rmpg-500 hover:text-rmpg-300"
              title="Dismiss"
            >
              <X style={{ width: 10, height: 10 }} />
            </button>
          </div>
        );
      })}
      {visibleAlerts.length > 3 && (
        <span className="text-[9px] text-rmpg-500 text-center">+{visibleAlerts.length - 3} more alerts</span>
      )}
    </div>
  );
}
