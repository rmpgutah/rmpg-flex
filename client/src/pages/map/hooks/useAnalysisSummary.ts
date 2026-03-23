import { useState, useEffect, useCallback, useRef } from 'react';
import { apiFetch } from '../../../hooks/useApi';

export interface OverlapZone {
  latitude: number;
  longitude: number;
  safetyRisk: 'high' | 'moderate';
  predictionScore: number;
  totalFlagged: number;
}

export interface RepeatInRisk {
  address: string;
  callCount: number;
  nearestZoneRisk: 'high' | 'moderate';
}

export interface AnalysisSummary {
  overlapZones: { count: number; locations: OverlapZone[] };
  repeatInRiskZones: { count: number; addresses: RepeatInRisk[] };
  enforcement: { total30d: number; inPredictedAreas: number; effectivenessRate: number };
  shiftTrend: { currentShift: string; currentPeriodCalls: number; previousPeriodCalls: number; changePercent: number };
  metrics: {
    totalSafetyZones: number;
    highRiskZones: number;
    activePredictions: number;
    activeGeofences: number;
    totalEnforcement30d: number;
    repeatAddressCount: number;
  };
}

export interface UseAnalysisSummaryReturn {
  data: AnalysisSummary | null;
  loading: boolean;
  refresh: () => void;
}

const REFRESH_INTERVAL = 5 * 60 * 1000; // 5 minutes

export function useAnalysisSummary(enabled: boolean): UseAnalysisSummaryReturn {
  const [data, setData] = useState<AnalysisSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const mountedRef = useRef(true);

  const fetchSummary = useCallback(async () => {
    if (!mountedRef.current) return;
    setLoading(true);
    try {
      const json = await apiFetch<AnalysisSummary>('/dispatch/analysis/summary');
      if (mountedRef.current) {
        setData(json || null);
      }
    } catch (err) {
      console.error('[useAnalysisSummary] Failed to fetch analysis summary', err);
    } finally {
      if (mountedRef.current) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;

    if (enabled) {
      fetchSummary();
      intervalRef.current = setInterval(fetchSummary, REFRESH_INTERVAL);
    } else {
      setData(null);
      setLoading(false);
    }

    return () => {
      mountedRef.current = false;
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [enabled, fetchSummary]);

  return { data, loading, refresh: fetchSummary };
}
