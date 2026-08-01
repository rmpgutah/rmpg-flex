import { useEffect, useState } from 'react';
import { apiFetch } from '../../../hooks/useApi';
import PanelTitleBar from '../../../components/PanelTitleBar';
import { Gauge } from 'lucide-react';

interface ScoreResult {
  status: 'scored' | 'insufficient_data';
  score?: number;
  band?: 'excellent' | 'good' | 'needs_attention' | 'at_risk';
  weightedRatePer100Miles?: number;
  confidence?: 'recorded' | 'inferred';
  milesDriven: number;
}

interface RosterEntry {
  officer_id: number;
  officer_name: string | null;
  badge_number: string | null;
  miles_driven: number;
  drive_minutes: number;
  trip_count: number;
  event_count: number;
  events: Record<string, number>;
  cost: { fuel: number; fuel_gallons: number; maintenance: number };
  result: ScoreResult;
  rank?: number;
}

interface GatedRosterResponse {
  ok: false;
  code: string;
  message: string;
  score_version: string;
}

interface NormalRosterResponse {
  ok?: undefined;
  from: string;
  to: string;
  min_exposure_miles: number;
  ranked: RosterEntry[];
  insufficient_data: RosterEntry[];
}

type RosterResponse = GatedRosterResponse | NormalRosterResponse;

// Severity tokens, not brand chrome — risk IS severity semantics here.
const BAND_CLASS: Record<string, string> = {
  excellent: 'text-[color:var(--sev-ok)]',
  good: 'text-[color:var(--sev-ok)]',
  needs_attention: 'text-[color:var(--sev-warn)]',
  at_risk: 'text-[color:var(--sev-critical)]',
};

const BAND_LABEL: Record<string, string> = {
  excellent: 'Excellent',
  good: 'Good',
  needs_attention: 'Needs Attention',
  at_risk: 'At Risk',
};

export default function FleetDriverPerformanceTab() {
  const [data, setData] = useState<RosterResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiFetch<RosterResponse>('/driver-performance/roster')
      .then(setData)
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return <div className="p-4 text-fg-secondary text-xs">Loading driver performance…</div>;
  }

  // Surface the failure. An empty table would read as "nobody had events",
  // which reads as everyone driving well.
  if (error) {
    return (
      <div className="p-4 space-y-3">
        <PanelTitleBar title="DRIVER PERFORMANCE" icon={Gauge} />
        <div className="border border-[color:var(--sev-critical)] p-3 text-xs text-[color:var(--sev-critical)]">
          Could not load driver performance: {error}
        </div>
      </div>
    );
  }

  if (!data) return null;

  // Runtime owner gate: severity weights not yet reviewed, so no score exists
  // to show. Explain why rather than rendering an empty table, which would
  // read as "everyone drove cleanly".
  if (data.ok === false) {
    return (
      <div className="p-4 space-y-3">
        <PanelTitleBar title="DRIVER PERFORMANCE" icon={Gauge} />
        <div className="border border-[color:var(--sev-warn)] p-3 text-xs text-rmpg-100">
          <div className="font-semibold text-[color:var(--sev-warn)] mb-1">Scoring unavailable</div>
          <div>{data.message}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 space-y-4">
      <PanelTitleBar title="DRIVER PERFORMANCE" icon={Gauge} />

      <div className="text-[10px] text-fg-muted">
        {data.from} to {data.to} · scored at or above {data.min_exposure_miles} miles of exposure
      </div>

      <table className="w-full">
        <thead>
          <tr className="text-left text-[9px] font-semibold text-fg-secondary border-b border-rmpg-700">
            <th className="py-[3px] pr-2">#</th>
            <th className="py-[3px] pr-2">Officer</th>
            <th className="py-[3px] pr-2">Badge</th>
            <th className="py-[3px] pr-2">Score</th>
            <th className="py-[3px] pr-2">Band</th>
            <th className="py-[3px] pr-2">Rate / 100 mi</th>
            <th className="py-[3px] pr-2">Miles</th>
            <th className="py-[3px] pr-2">Events</th>
            <th className="py-[3px] pr-2">Attribution</th>
            <th className="py-[3px] pr-2 border-l border-rmpg-700 pl-2">Fuel</th>
            <th className="py-[3px] pr-2">Maint.</th>
          </tr>
        </thead>
        <tbody>
          {data.ranked.map((r) => (
            <tr key={r.officer_id} className="text-[11px] text-rmpg-100 border-b border-rmpg-800">
              <td className="py-[2px] pr-2">{r.rank}</td>
              <td className="py-[2px] pr-2">{r.officer_name ?? '—'}</td>
              <td className="py-[2px] pr-2">{r.badge_number ?? '—'}</td>
              <td className={`py-[2px] pr-2 font-semibold ${BAND_CLASS[r.result.band ?? ''] ?? ''}`}>
                {r.result.score?.toFixed(1)}
              </td>
              <td className={`py-[2px] pr-2 ${BAND_CLASS[r.result.band ?? ''] ?? ''}`}>
                {BAND_LABEL[r.result.band ?? ''] ?? '—'}
              </td>
              {/* The denominator is ALWAYS adjacent to the score. A bare number
                  in a screenshot is how this tool causes harm. */}
              <td className="py-[2px] pr-2">{r.result.weightedRatePer100Miles?.toFixed(2)}</td>
              <td className="py-[2px] pr-2">{r.miles_driven.toFixed(0)}</td>
              <td className="py-[2px] pr-2">{r.event_count}</td>
              <td className="py-[2px] pr-2">
                {r.result.confidence === 'inferred' ? (
                  <span
                    className="text-[color:var(--sev-warn)]"
                    title="Majority of events attributed by assignment history, not recorded at capture. Treat as a lead to investigate, not a finding."
                  >
                    Inferred
                  </span>
                ) : (
                  <span className="text-fg-muted">Recorded</span>
                )}
              </td>
              <td className="py-[2px] pr-2 border-l border-rmpg-700 pl-2">${r.cost.fuel.toFixed(0)}</td>
              <td className="py-[2px] pr-2">${r.cost.maintenance.toFixed(0)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {data.insufficient_data.length > 0 && (
        <div className="space-y-1">
          <div className="text-[9px] font-semibold text-fg-secondary uppercase">
            Insufficient exposure — not scored, not ranked
          </div>
          <div className="text-[10px] text-fg-muted">
            Below {data.min_exposure_miles} miles in this window. Too few miles to
            distinguish driving behavior from chance.
          </div>
          <table className="w-full">
            <tbody>
              {data.insufficient_data.map((r) => (
                <tr key={r.officer_id} className="text-[11px] text-fg-secondary border-b border-rmpg-800">
                  <td className="py-[2px] pr-2">{r.officer_name ?? '—'}</td>
                  <td className="py-[2px] pr-2">{r.badge_number ?? '—'}</td>
                  <td className="py-[2px] pr-2">{r.miles_driven.toFixed(0)} mi</td>
                  <td className="py-[2px] pr-2">{r.event_count} events</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
