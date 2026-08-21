// ============================================================
// RMPG Flex — IncidentTypeChart
// ============================================================
// Collapsible bar chart of incident types from
// GET /api/dispatch/analytics/incident-types?days=7.
// Uses plain SVG — no external chart library.
// Max 8 bars (top 8 by count). Max width 400px.
// ============================================================

import React, { useEffect, useState, useCallback } from 'react';
import { ChevronDown, ChevronUp, BarChart2 } from 'lucide-react';
import { apiFetch } from '../../hooks/useApi';

interface IncidentTypeRow {
  incident_type: string;
  type?: string;
  count: number;
}

const BAR_COLOR = 'var(--accent-silver-400, #8fa3b8)';
const BAR_ACTIVE_COLOR = 'var(--accent-gold-300, #d9bd72)';
const CHART_HEIGHT = 80;
const MAX_BARS = 8;
const DAYS = 7;

export default function IncidentTypeChart() {
  const [open, setOpen] = useState(true);
  const [rows, setRows] = useState<IncidentTypeRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hovered, setHovered] = useState<number | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    apiFetch<IncidentTypeRow[]>(`/dispatch/analytics/incident-types?days=${DAYS}`)
      .then((data) => {
        const sorted = (Array.isArray(data) ? data : [])
          .slice()
          .sort((a, b) => b.count - a.count)
          .slice(0, MAX_BARS)
          .map((r) => ({ ...r, incident_type: r.incident_type ?? r.type ?? 'Unknown' }));
        setRows(sorted);
      })
      .catch((e: any) => setError(e?.message ?? 'Failed to load'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const maxCount = rows.reduce((m, r) => Math.max(m, r.count), 1);
  const barW = rows.length > 0 ? Math.floor(380 / rows.length) - 4 : 40;

  return (
    <section
      className="bg-surface-base border border-border-default"
      style={{ maxWidth: 400 }}
    >
      {/* Header */}
      <button
        type="button"
        className="w-full flex items-center justify-between px-3 py-2 text-left"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label="Toggle incident type chart"
      >
        <span className="flex items-center gap-1.5 text-[color:var(--panel-header-color)] text-[10px] font-bold tracking-widest uppercase">
          <BarChart2 size={12} />
          Incident Types · Last {DAYS} Days
        </span>
        {open ? <ChevronUp size={12} className="text-rmpg-500" /> : <ChevronDown size={12} className="text-rmpg-500" />}
      </button>

      {open && (
        <div className="px-3 pb-3">
          {loading && (
            <div className="h-[80px] flex items-center justify-center text-rmpg-500 text-[10px] animate-pulse">
              Loading…
            </div>
          )}
          {error && (
            <div className="text-[10px] text-amber-400 py-2">{error}</div>
          )}
          {!loading && !error && rows.length === 0 && (
            <div className="text-rmpg-500 text-[10px] py-2 italic">No data</div>
          )}
          {!loading && !error && rows.length > 0 && (
            <>
              {/* SVG bar chart */}
              <svg
                width="100%"
                viewBox={`0 0 380 ${CHART_HEIGHT + 24}`}
                aria-label="Incident type bar chart"
                style={{ overflow: 'visible' }}
              >
                {rows.map((row, i) => {
                  const barHeight = Math.max(4, Math.round((row.count / maxCount) * CHART_HEIGHT));
                  const x = i * (barW + 4) + 2;
                  const y = CHART_HEIGHT - barHeight;
                  const isHovered = hovered === i;
                  return (
                    <g key={row.incident_type}>
                      <rect
                        x={x}
                        y={y}
                        width={barW}
                        height={barHeight}
                        fill={isHovered ? BAR_ACTIVE_COLOR : BAR_COLOR}
                        rx={2}
                        ry={2}
                        onMouseEnter={() => setHovered(i)}
                        onMouseLeave={() => setHovered(null)}
                        style={{ cursor: 'default', transition: 'fill 0.15s' }}
                      />
                      {isHovered && (
                        <text
                          x={x + barW / 2}
                          y={Math.max(10, y - 4)}
                          textAnchor="middle"
                          fontSize={9}
                          fill="var(--text-primary, #f0f4f9)"
                        >
                          {row.count}
                        </text>
                      )}
                    </g>
                  );
                })}
                {/* X-axis labels */}
                {rows.map((row, i) => {
                  const x = i * (barW + 4) + 2 + barW / 2;
                  const label = row.incident_type.length > 6
                    ? row.incident_type.slice(0, 6) + '…'
                    : row.incident_type;
                  return (
                    <text
                      key={`lbl-${row.incident_type}`}
                      x={x}
                      y={CHART_HEIGHT + 14}
                      textAnchor="middle"
                      fontSize={8}
                      fill="var(--text-secondary, #8fa3b8)"
                    >
                      <title>{row.incident_type}</title>
                      {label}
                    </text>
                  );
                })}
              </svg>
              {/* Legend row */}
              <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5">
                {rows.map((row) => (
                  <span key={row.incident_type} className="text-[9px] text-rmpg-400">
                    <span className="font-semibold text-rmpg-200">{row.count}</span>
                    {' '}{row.incident_type}
                  </span>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </section>
  );
}
