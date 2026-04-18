// ═══════════════════════════════════════════════════════════════
// Budget Variance PDF — single-page report for a given budget.
//
// Uses the `/fleet/fuel/budgets/summary` response shape — everything
// needed is already on the client by the time the "Print Variance
// Report" button is reachable.
//
// Layout (portrait letter, 1 page):
//   Header             — "Fuel Budget Variance" + budget scope label
//   Budget details     — period, amount, threshold, effective range
//   Actual vs Budget   — bar visualization with threshold marker
//   Key figures        — spend, forecast, variance %, daily rate
//   Status conclusion  — on-track / watch / warning / over with color
//   Footer             — generated timestamp + sign-off line
// ═══════════════════════════════════════════════════════════════

import jsPDF from 'jspdf';
import type { FleetFuelBudgetSummary } from '../../../types';

interface Args {
  summary: FleetFuelBudgetSummary;
  /** Human-readable scope label: e.g. "#47 — 2022 Explorer" or "Fleet-wide". */
  scopeLabel: string;
}

export function generateFleetBudgetVariancePdf({ summary, scopeLabel }: Args): void {
  if (!summary.has_budget || !summary.budget || !summary.period || !summary.spend) {
    throw new Error('No active budget to report on');
  }

  const doc = new jsPDF({ unit: 'pt', format: 'letter' });
  const marginX = 54;
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  let y = 54;

  const { budget, period, spend, status } = summary;
  const overage = spend.pct_of_budget > 100 ? spend.pct_of_budget - 100 : 0;
  const fmtCurrency = (n: number) =>
    `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  // Status colour — matches the on-screen BudgetCard palette.
  const statusColors: Record<string, [number, number, number]> = {
    on_track: [34, 197, 94],
    watch:    [234, 179, 8],
    warning:  [245, 158, 11],
    over:     [239, 68, 68],
  };
  const [sr, sg, sb] = statusColors[status || 'on_track'] || [100, 100, 100];

  // ── Header ────────────────────────────────────────────────
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18);
  doc.text('FUEL BUDGET VARIANCE', marginX, y);
  y += 22;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(11);
  doc.text(`Scope:  ${scopeLabel}`, marginX, y); y += 14;
  // ASCII " to " instead of "→" — the Unicode arrow renders as garbled
  // multi-byte glyphs ("â '") under jsPDF's default cp1252 encoding.
  doc.text(`Period: ${budget.period_type.charAt(0).toUpperCase() + budget.period_type.slice(1)} (${period.start} to ${period.end})`, marginX, y); y += 14;
  doc.text(`Generated: ${new Date().toLocaleString()}`, marginX, y); y += 22;

  doc.setDrawColor(180);
  doc.line(marginX, y, pageW - marginX, y);
  y += 20;

  // ── Budget details ────────────────────────────────────────
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.text('BUDGET', marginX, y); y += 16;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(11);
  const cells: [string, string][] = [
    ['Budget Amount',    fmtCurrency(budget.budget_amount)],
    ['Alert Threshold',  `${budget.alert_threshold_pct.toFixed(0)}%`],
    ['Effective From',   budget.effective_from],
    ['Effective To',     budget.effective_to || '(open-ended)'],
  ];
  const colW = (pageW - marginX * 2) / 2;
  for (let i = 0; i < cells.length; i++) {
    const col = i % 2;
    const row = Math.floor(i / 2);
    const x = marginX + col * colW;
    const rowY = y + row * 16;
    doc.setFont('helvetica', 'bold');
    doc.text(cells[i][0] + ':', x, rowY);
    doc.setFont('helvetica', 'normal');
    doc.text(cells[i][1], x + 110, rowY);
  }
  y += Math.ceil(cells.length / 2) * 16 + 14;

  // ── Visualization: progress bar ───────────────────────────
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.text('ACTUAL vs. BUDGET', marginX, y); y += 16;

  const barX = marginX;
  const barY = y;
  const barW = pageW - marginX * 2;
  const barH = 24;
  doc.setDrawColor(120);
  doc.setLineWidth(0.75);
  doc.rect(barX, barY, barW, barH);

  // Filled portion (clamped 0..100%, extra goes in a red overflow bar)
  const inBudgetPct = Math.max(0, Math.min(100, spend.pct_of_budget));
  const fillW = (inBudgetPct / 100) * barW;
  doc.setFillColor(sr, sg, sb);
  doc.rect(barX, barY, fillW, barH, 'F');

  // Threshold line marker
  const thresholdX = barX + (Math.min(100, budget.alert_threshold_pct) / 100) * barW;
  doc.setDrawColor(234, 179, 8);
  doc.setLineWidth(1.2);
  doc.line(thresholdX, barY - 3, thresholdX, barY + barH + 3);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(180, 140, 0);
  doc.text(`Threshold ${budget.alert_threshold_pct.toFixed(0)}%`, thresholdX, barY - 6, { align: 'center' });
  doc.setTextColor(0);

  // Bar end labels
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.text('$0', barX, barY + barH + 12);
  doc.text(fmtCurrency(budget.budget_amount), barX + barW, barY + barH + 12, { align: 'right' });
  y += barH + 20;

  // ── Key figures ──────────────────────────────────────────
  y += 10;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.text('KEY FIGURES', marginX, y); y += 16;

  const figures: [string, string][] = [
    ['Actual Spend (to date)', fmtCurrency(spend.actual)],
    ['Percent of Budget',      `${spend.pct_of_budget.toFixed(1)}%${overage > 0 ? `  (${overage.toFixed(1)}% over)` : ''}`],
    ['Daily Burn Rate',        `${fmtCurrency(spend.daily_rate)} / day`],
    ['Projected End-of-Period', fmtCurrency(spend.forecast)],
    ['Forecast Variance',      `${spend.variance_pct >= 0 ? '+' : ''}${spend.variance_pct.toFixed(1)}% vs. budget`],
    ['Days Elapsed',           `${period.days_elapsed} of ${period.days_total}`],
    ['Days Remaining',         `${period.days_remaining}`],
  ];
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(11);
  for (const [k, v] of figures) {
    doc.setFont('helvetica', 'bold');
    doc.text(k + ':', marginX, y);
    doc.setFont('helvetica', 'normal');
    doc.text(v, marginX + 180, y);
    y += 16;
  }
  y += 8;

  // ── Status banner ─────────────────────────────────────────
  doc.setFillColor(sr, sg, sb);
  doc.rect(marginX, y, pageW - marginX * 2, 28, 'F');
  doc.setTextColor(255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  const statusLabel = ({
    on_track: 'ON TRACK',
    watch:    'WATCH — TRENDING ABOVE BUDGET',
    warning:  'WARNING — ALERT THRESHOLD REACHED',
    over:     'OVER BUDGET',
  } as Record<string, string>)[status || 'on_track'] || 'UNKNOWN';
  doc.text(statusLabel, marginX + 10, y + 18);
  doc.setTextColor(0);
  y += 40;

  if (budget.notes) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.text('Budget Notes:', marginX, y); y += 14;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    const wrapped = doc.splitTextToSize(budget.notes, pageW - marginX * 2);
    doc.text(wrapped, marginX, y);
    y += wrapped.length * 12 + 8;
  }

  // ── Sign-off line ─────────────────────────────────────────
  y = pageH - 90;
  doc.setDrawColor(140);
  doc.setLineWidth(0.5);
  doc.line(marginX, y, marginX + 240, y);
  doc.line(marginX + 300, y, pageW - marginX, y);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(100);
  doc.text('Reviewed by (signature)', marginX, y + 12);
  doc.text('Date', marginX + 300, y + 12);
  doc.setTextColor(0);

  const scopePart = budget.vehicle_id ? `vehicle-${budget.vehicle_id}` : 'fleet';
  const filename = `budget-variance-${scopePart}-${new Date().toISOString().slice(0, 10)}.pdf`;
  doc.save(filename);
}
