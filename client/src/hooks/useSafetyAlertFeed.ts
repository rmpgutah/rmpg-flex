import { useMemo } from 'react';
import { usePanicAlerts } from './usePanicAlerts';
import { useWelfareAlerts } from './useWelfareAlerts';
import { usePremiseAlertsList } from './usePremiseAlertsList';

export interface SafetyAlertItem {
  id: string;
  type: 'panic' | 'welfare' | 'premise';
  severity: 'critical' | 'warning' | 'info';
  label: string;
  detail?: string;
  timestamp?: string;
}

const SEVERITY_RANK: Record<SafetyAlertItem['severity'], number> = { critical: 0, warning: 1, info: 2 };
const TYPE_RANK: Record<SafetyAlertItem['type'], number> = { panic: 0, welfare: 1, premise: 2 };

export interface UseSafetyAlertFeedResult {
  items: SafetyAlertItem[];
  count: number;
  loading: boolean;
}

export function useSafetyAlertFeed(): UseSafetyAlertFeedResult {
  const panic = usePanicAlerts();
  const welfare = useWelfareAlerts();
  const premise = usePremiseAlertsList();

  const items = useMemo<SafetyAlertItem[]>(() => {
    const panicItems: SafetyAlertItem[] = panic.alerts.map(a => ({
      id: `panic-${a.id}`,
      type: 'panic',
      severity: 'critical',
      label: a.user_name ? `Panic — ${a.user_name}` : 'Panic alert',
      detail: a.call_sign ?? undefined,
      timestamp: a.created_at,
    }));
    const welfareItems: SafetyAlertItem[] = welfare.alerts.map(a => ({
      id: `welfare-${a.user_id}`,
      type: 'welfare',
      severity: a.status === 'emergency' ? 'critical' : 'warning',
      label: a.officer_name ? `Welfare — ${a.officer_name}` : 'Welfare check overdue',
      detail: a.call_sign ?? undefined,
    }));
    const premiseItems: SafetyAlertItem[] = premise.alerts.map(a => ({
      id: `premise-${a.id}`,
      type: 'premise',
      severity: (a.alert_level as SafetyAlertItem['severity']) ?? 'info',
      label: a.title,
      detail: a.address,
    }));

    return [...panicItems, ...welfareItems, ...premiseItems].sort((a, b) => {
      const typeDiff = TYPE_RANK[a.type] - TYPE_RANK[b.type];
      if (typeDiff !== 0) return typeDiff;
      return SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
    });
  }, [panic.alerts, welfare.alerts, premise.alerts]);

  return {
    items,
    count: items.length,
    loading: panic.loading || welfare.loading || premise.loading,
  };
}
