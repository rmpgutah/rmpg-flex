import { useEffect, useState } from 'react';
import { apiFetch } from '../../../hooks/useApi';
import PanelTitleBar from '../../../components/PanelTitleBar';
import { toDisplayLabel } from '../../../utils/formatters';
import { Gauge, ArrowLeft } from 'lucide-react';

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

interface GatedResponse {
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

type RosterResponse = GatedResponse | NormalRosterResponse;

interface DailyEntry {
  perf_date: string;
  miles_driven: number;
  score: number | null;
  score_version: string;
  attribution_recorded_pct: number;
  attribution_inferred_pct: number;
}

interface NormalOfficerResponse {
  ok?: undefined;
  from: string;
  to: string;
  min_exposure_miles: number;
  summary: RosterEntry | null;
  daily: DailyEntry[];
}

type OfficerResponse = GatedResponse | NormalOfficerResponse;

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

function RosterRow({
  r,
  variant,
  onOpen,
}: {
  r: RosterEntry;
  variant: 'ranked' | 'insufficient';
  onOpen: (officerId: number) => void;
}) {
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onOpen(r.officer_id);
    }
  };

  if (variant === 'ranked') {
    return (
      <tr
        className="text-[11px] text-rmpg-100 border-b border-rmpg-800 cursor-pointer hover:bg-surface-raised"
        role="button"
        tabIndex={0}
        onClick={() => onOpen(r.officer_id)}
        onKeyDown={handleKeyDown}
      >
        <td className="py-[2px] pr-2">{r.rank}</td>
        <td className="py-[2px] pr-2 underline">{r.officer_name ?? '—'}</td>
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
    );
  }

  return (
    <tr
      className="text-[11px] text-fg-secondary border-b border-rmpg-800 cursor-pointer hover:bg-surface-raised"
      role="button"
      tabIndex={0}
      onClick={() => onOpen(r.officer_id)}
      onKeyDown={handleKeyDown}
    >
      <td className="py-[2px] pr-2 underline">{r.officer_name ?? '—'}</td>
      <td className="py-[2px] pr-2">{r.badge_number ?? '—'}</td>
      <td className="py-[2px] pr-2">{r.miles_driven.toFixed(0)} mi</td>
      <td className="py-[2px] pr-2">{r.event_count} events</td>
    </tr>
  );
}

function OfficerDetail({ officerId, onBack }: { officerId: number; onBack: () => void }) {
  const [data, setData] = useState<OfficerResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    setError(null);
    setData(null);
    apiFetch<OfficerResponse>(`/driver-performance/officer/${officerId}`)
      .then(setData)
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [officerId]);

  const backButton = (
    <button
      type="button"
      onClick={onBack}
      className="flex items-center gap-1 text-[10px] text-fg-secondary hover:text-rmpg-100"
    >
      <ArrowLeft size={12} /> Back to roster
    </button>
  );

  if (loading) {
    return (
      <div className="p-4 space-y-3">
        <PanelTitleBar title="OFFICER DRIVER PERFORMANCE" icon={Gauge} />
        {backButton}
        <div className="text-fg-secondary text-xs">Loading officer detail…</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4 space-y-3">
        <PanelTitleBar title="OFFICER DRIVER PERFORMANCE" icon={Gauge} />
        {backButton}
        <div className="border border-[color:var(--sev-critical)] p-3 text-xs text-[color:var(--sev-critical)]">
          Could not load officer detail: {error}
        </div>
      </div>
    );
  }

  if (!data) return null;

  if (data.ok === false) {
    return (
      <div className="p-4 space-y-3">
        <PanelTitleBar title="OFFICER DRIVER PERFORMANCE" icon={Gauge} />
        {backButton}
        <div className="border border-[color:var(--sev-warn)] p-3 text-xs text-rmpg-100">
          <div className="font-semibold text-[color:var(--sev-warn)] mb-1">Scoring unavailable</div>
          <div>{data.message}</div>
        </div>
      </div>
    );
  }

  const { summary, daily, min_exposure_miles } = data;

  return (
    <div className="p-4 space-y-4">
      <PanelTitleBar title="OFFICER DRIVER PERFORMANCE" icon={Gauge} />
      {backButton}

      <div className="text-[10px] text-fg-muted">
        {data.from} to {data.to}
      </div>

      {!summary ? (
        <div className="border border-rmpg-700 p-3 text-xs text-fg-secondary">
          No data for this officer in this window.
        </div>
      ) : summary.result.status !== 'scored' ? (
        // Below the exposure floor: too few miles to distinguish driving behavior
        // from chance. Same treatment as the daily table's "not scored" and the
        // roster's insufficient-exposure section — never a band, rate, or
        // confidence label, since confidence in an unscored result is meaningless.
        <div className="space-y-1">
          <div className="text-[9px] font-semibold text-fg-secondary uppercase">Summary</div>
          <div className="text-[11px] text-rmpg-100">
            {summary.officer_name ?? '—'} · Badge {summary.badge_number ?? '—'}
          </div>
          <div className="border border-[color:var(--sev-warn)] p-3 text-xs text-rmpg-100">
            <div className="font-semibold text-[color:var(--sev-warn)] mb-1">
              Insufficient exposure — not scored
            </div>
            <div>
              This officer drove {summary.miles_driven.toFixed(0)} miles — below the{' '}
              {min_exposure_miles}-mile floor required to score, so behavior can't be
              distinguished from chance. No score, band, rate, or confidence is shown because
              none was computed.
            </div>
          </div>
        </div>
      ) : (
        <>
          <div className="space-y-1">
            <div className="text-[9px] font-semibold text-fg-secondary uppercase">Summary</div>
            <div className="text-[11px] text-rmpg-100">
              {summary.officer_name ?? '—'} · Badge {summary.badge_number ?? '—'}
            </div>
            <table className="w-full">
              <thead>
                <tr className="text-left text-[9px] font-semibold text-fg-secondary border-b border-rmpg-700">
                  <th className="py-[3px] pr-2">Score</th>
                  <th className="py-[3px] pr-2">Band</th>
                  <th className="py-[3px] pr-2">Rate / 100 mi</th>
                  <th className="py-[3px] pr-2">Miles</th>
                  <th className="py-[3px] pr-2">Trips</th>
                  <th className="py-[3px] pr-2">Events</th>
                  <th className="py-[3px] pr-2">Attribution</th>
                  <th className="py-[3px] pr-2 border-l border-rmpg-700 pl-2">Fuel</th>
                  <th className="py-[3px] pr-2">Fuel Gal.</th>
                  <th className="py-[3px] pr-2">Maint.</th>
                </tr>
              </thead>
              <tbody>
                <tr className="text-[11px] text-rmpg-100 border-b border-rmpg-800">
                  <td className={`py-[2px] pr-2 font-semibold ${BAND_CLASS[summary.result.band ?? ''] ?? ''}`}>
                    {summary.result.score?.toFixed(1)}
                  </td>
                  <td className={`py-[2px] pr-2 ${BAND_CLASS[summary.result.band ?? ''] ?? ''}`}>
                    {BAND_LABEL[summary.result.band ?? ''] ?? '—'}
                  </td>
                  {/* Score never renders without its denominator — miles + rate stay adjacent. */}
                  <td className="py-[2px] pr-2">{summary.result.weightedRatePer100Miles?.toFixed(2)}</td>
                  <td className="py-[2px] pr-2">{summary.miles_driven.toFixed(0)}</td>
                  <td className="py-[2px] pr-2">{summary.trip_count}</td>
                  <td className="py-[2px] pr-2">{summary.event_count}</td>
                  <td className="py-[2px] pr-2">
                    {summary.result.confidence === 'inferred' ? (
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
                  <td className="py-[2px] pr-2 border-l border-rmpg-700 pl-2">${summary.cost.fuel.toFixed(0)}</td>
                  <td className="py-[2px] pr-2">{summary.cost.fuel_gallons.toFixed(1)}</td>
                  <td className="py-[2px] pr-2">${summary.cost.maintenance.toFixed(0)}</td>
                </tr>
              </tbody>
            </table>
          </div>

          <div className="space-y-1">
            <div className="text-[9px] font-semibold text-fg-secondary uppercase">Event breakdown</div>
            <table className="w-full">
              <thead>
                <tr className="text-left text-[9px] font-semibold text-fg-secondary border-b border-rmpg-700">
                  {Object.keys(summary.events).map((k) => (
                    <th key={k} className="py-[3px] pr-2">
                      {toDisplayLabel(k)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <tr className="text-[11px] text-rmpg-100">
                  {Object.entries(summary.events).map(([k, v]) => (
                    <td key={k} className="py-[2px] pr-2">
                      {v}
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>
        </>
      )}

      <div className="space-y-1">
        <div className="text-[9px] font-semibold text-fg-secondary uppercase">Daily trend</div>
        {daily.length === 0 ? (
          <div className="border border-rmpg-700 p-3 text-xs text-fg-secondary">
            No daily records for this officer in this window.
          </div>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="text-left text-[9px] font-semibold text-fg-secondary border-b border-rmpg-700">
                <th className="py-[3px] pr-2">Date</th>
                <th className="py-[3px] pr-2">Miles</th>
                <th className="py-[3px] pr-2">Score</th>
                <th className="py-[3px] pr-2">Attribution (Recorded / Inferred)</th>
              </tr>
            </thead>
            <tbody>
              {daily.map((d) => (
                <tr key={d.perf_date} className="text-[11px] text-rmpg-100 border-b border-rmpg-800">
                  <td className="py-[2px] pr-2">{d.perf_date}</td>
                  <td className="py-[2px] pr-2">{d.miles_driven.toFixed(0)}</td>
                  {/* A null score means the day fell below the exposure floor — render
                      it explicitly. Rendering 0 would assert the officer drove badly;
                      rendering blank is ambiguous. Neither is acceptable. */}
                  <td className="py-[2px] pr-2">
                    {d.score === null ? (
                      <span className="text-fg-muted">not scored</span>
                    ) : (
                      d.score.toFixed(1)
                    )}
                  </td>
                  <td className="py-[2px] pr-2">
                    {d.attribution_recorded_pct.toFixed(0)}% / {d.attribution_inferred_pct.toFixed(0)}%
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

export default function FleetDriverPerformanceTab() {
  const [data, setData] = useState<RosterResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedOfficerId, setSelectedOfficerId] = useState<number | null>(null);

  useEffect(() => {
    apiFetch<RosterResponse>('/driver-performance/roster')
      .then(setData)
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  if (selectedOfficerId !== null) {
    return <OfficerDetail officerId={selectedOfficerId} onBack={() => setSelectedOfficerId(null)} />;
  }

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

  const noRoster = data.ranked.length === 0 && data.insufficient_data.length === 0;

  return (
    <div className="p-4 space-y-4">
      <PanelTitleBar title="DRIVER PERFORMANCE" icon={Gauge} />

      <div className="text-[10px] text-fg-muted">
        {data.from} to {data.to} · scored at or above {data.min_exposure_miles} miles of exposure
      </div>

      {noRoster ? (
        <div className="border border-rmpg-700 p-3 text-xs text-fg-secondary">
          No driving data recorded for any officer in this window. This does not mean
          driving was clean — it means there is nothing to evaluate.
        </div>
      ) : (
        <>
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
              {data.ranked.length === 0 ? (
                <tr>
                  <td colSpan={11} className="py-[4px] text-[11px] text-fg-secondary">
                    No officers met the exposure floor to be ranked in this window.
                  </td>
                </tr>
              ) : (
                data.ranked.map((r) => (
                  <RosterRow key={r.officer_id} r={r} variant="ranked" onOpen={setSelectedOfficerId} />
                ))
              )}
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
                    <RosterRow key={r.officer_id} r={r} variant="insufficient" onOpen={setSelectedOfficerId} />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
