import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router';
import { ArrowLeft, FileText, Download, Folder, FolderOpen, RefreshCw, Calendar } from 'lucide-react';
import { apiFetch, apiFetchBlob } from '../../hooks/useApi';
import { useToast } from '../../components/ToastProvider';
import { useAuth } from '../../context/AuthContext';
import PanelTitleBar from '../../components/PanelTitleBar';
import IconButton from '../../components/IconButton';
import ConfirmDialog from '../../components/ConfirmDialog';
import { downloadTextFile, reportCatalogToCsv } from '../../utils/rmsListExport';

// ============================================================
// RMPG Flex — Fleet Daily Reports Archive
// ------------------------------------------------------------
// Browses the server-generated daily patrol PDFs, grouped by
// month → day. Generated nightly at 00:05 America/Denver by
// src/utils/dailyReport/nightly.ts, served from /api/reports/daily-reports.
// Admins can also manually regenerate a specific day.
// ============================================================

interface DayReport {
  filename: string;
  date: string;          // YYYY-MM-DD
  size: number;          // bytes
  generated_at: string;  // ISO string
}

interface MonthGroup {
  month: string;         // YYYY-MM
  days: DayReport[];
}

// Months look nicer as "April 2026" than "2026-04".
const formatMonthLabel = (ym: string): string => {
  const [y, m] = ym.split('-').map(Number);
  if (!y || !m) return ym;
  return new Date(y, m - 1, 1).toLocaleDateString('en-US', { timeZone: 'America/Denver', month: 'long', year: 'numeric' }); // new-date-ok
};

const formatDayLabel = (ymd: string): string => {
  const [y, m, d] = ymd.split('-').map(Number);
  if (!y || !m || !d) return ymd;
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { timeZone: 'America/Denver', weekday: 'short', month: 'short', day: 'numeric' }); // new-date-ok
};

const formatSize = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
};

export default function FleetReportsPage() {
  const navigate = useNavigate();
  const { addToast } = useToast();
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';

  const [months, setMonths] = useState<MonthGroup[]>([]);
  const [totalReports, setTotalReports] = useState<number>(0);
  const [loading, setLoading] = useState(true);
  const [expandedMonths, setExpandedMonths] = useState<Set<string>>(new Set());
  const [regenerating, setRegenerating] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [regenDate, setRegenDate] = useState<string | null>(null);

  const loadReports = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const data = await apiFetch<{ months: MonthGroup[]; total_reports: number }>('/reports/daily-reports/by-month');
      setMonths(data.months || []);
      setTotalReports(data.total_reports || 0);
      // Auto-expand the most recent month on first load for immediate usefulness.
      if (data.months?.[0]) {
        setExpandedMonths(prev => (prev.size === 0 ? new Set([data.months[0].month]) : prev));
      }
    } catch (err: any) {
      const msg = err?.message || 'Failed to load daily reports';
      setLoadError(msg);
      addToast(msg, 'error');
    } finally {
      setLoading(false);
    }
  }, [addToast]);

  useEffect(() => { loadReports(); }, [loadReports]);

  const toggleMonth = (month: string) => {
    setExpandedMonths(prev => {
      const next = new Set(prev);
      if (next.has(month)) next.delete(month); else next.add(month);
      return next;
    });
  };

  // Opening the PDF inline (new tab) is the standard expectation.
  // The browser handles Content-Disposition: inline, Acrobat/Preview render it.
  // We can't put the bearer token in a plain <a href>, so we fetch the PDF as
  // a blob through the authenticated apiFetchBlob helper, turn it into an
  // object URL, and open that in a new tab. URL is revoked after 60s so the
  // browser has time to load it before GC.
  const openReport = (filename: string) => {
    apiFetchBlob(`/reports/daily-reports/${encodeURIComponent(filename)}`)
      .then(blob => {
        const url = URL.createObjectURL(blob);
        window.open(url, '_blank');
        setTimeout(() => URL.revokeObjectURL(url), 60_000);
      })
      .catch(err => addToast(err?.message || 'Failed to open report', 'error'));
  };

  const regenerate = async (dateStr: string) => {
    if (!isAdmin) return;
    setRegenerating(dateStr);
    try {
      const res = await apiFetch<{ ok: boolean; filename?: string; message?: string }>('/reports/daily-reports/generate', {
        method: 'POST',
        body: JSON.stringify({ date: dateStr }),
      });
      if (res.ok) {
        addToast(`Regenerated ${res.filename}`, 'success');
        await loadReports();
      } else {
        addToast(res.message || 'No data for that date', 'warning');
      }
    } catch (err: any) {
      addToast(err?.message || 'Regeneration failed', 'error');
    } finally {
      setRegenerating(null);
    }
  };

  return (
    <div className="flex flex-col h-full bg-surface-base text-rmpg-100">
      <PanelTitleBar title="FLEET DAILY REPORTS" icon={Calendar}>
        <span className="text-[11px] text-fg-muted">{totalReports} reports archived</span>
        <button
          type="button"
          className="toolbar-btn"
          disabled={months.length === 0}
          onClick={() => downloadTextFile('fleet-daily-reports.csv', reportCatalogToCsv(
            months.flatMap((m) => m.days.map((d) => ({ id: d.filename, name: d.date, category: m.month }))),
          ))}
        >CSV</button>
        <IconButton onClick={loadReports} aria-label="Refresh reports list" className="p-1 hover:bg-surface-sunken">
          <RefreshCw className="w-4 h-4" />
        </IconButton>
        <IconButton onClick={() => navigate('/fleet')} aria-label="Back to Fleet" className="p-1 hover:bg-surface-sunken">
          <ArrowLeft className="w-4 h-4" />
        </IconButton>
      </PanelTitleBar>

      <div className="flex-1 overflow-auto p-4">
        {!loading && loadError && months.length > 0 && (
          <div className="p-3 text-xs text-[color:var(--sev-critical)] flex items-center justify-between mb-2" role="alert">
            <span>{loadError}</span>
            <button type="button" className="toolbar-btn" onClick={() => { void loadReports(); }}>Retry</button>
          </div>
        )}
        {loading && months.length === 0 && (
          <div className="text-center text-fg-muted py-8">Loading reports…</div>
        )}

        {!loading && loadError && months.length === 0 && (
          <div className="text-center py-8 space-y-2" role="alert">
            <div className="text-[color:var(--sev-critical)] text-sm">{loadError}</div>
            <button type="button" className="toolbar-btn" onClick={() => { void loadReports(); }}>Retry</button>
          </div>
        )}

        {!loading && !loadError && months.length === 0 && (
          <div className="text-center text-fg-muted py-8">
            <FileText className="w-12 h-12 mx-auto mb-3 opacity-40" />
            <div>No daily reports yet.</div>
            <div className="text-[11px] mt-1">Reports generate automatically at 00:05 MT each night.</div>
          </div>
        )}

        <div className="space-y-2 max-w-3xl mx-auto">
          {months.map(({ month, days }) => {
            const expanded = expandedMonths.has(month);
            return (
              <div key={month} className="border border-[color:var(--border-subtle)] bg-surface-raised" style={{ borderRadius: 2 }}>
                <button
                  type="button"
                  onClick={() => toggleMonth(month)}
                  className="w-full flex items-center justify-between px-3 py-2 hover:bg-surface-base text-left"
                >
                  <div className="flex items-center gap-2">
                    {expanded ? <FolderOpen className="w-4 h-4 text-accent-silver-400" /> : <Folder className="w-4 h-4 text-accent-silver-400" />}
                    <span className="font-semibold text-sm">{formatMonthLabel(month)}</span>
                  </div>
                  <span className="text-[11px] text-fg-muted">{days.length} {days.length === 1 ? 'day' : 'days'}</span>
                </button>

                {expanded && (
                  <div className="border-t border-[color:var(--border-subtle)]">
                    {days.map(d => (
                      <div
                        key={d.filename}
                        className="flex items-center justify-between px-3 py-[6px] border-b border-[color:var(--border-subtle)] last:border-b-0 hover:bg-surface-sunken"
                      >
                        <div className="flex items-center gap-2 flex-1 min-w-0">
                          <FileText className="w-4 h-4 text-fg-muted flex-shrink-0" />
                          <div className="flex-1 min-w-0">
                            <div className="text-[12px] font-medium truncate">{formatDayLabel(d.date)}</div>
                            <div className="text-[10px] text-fg-secondary font-mono truncate">
                              {d.date} · {formatSize(d.size)}
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-1">
                          <IconButton
                            onClick={() => openReport(d.filename)}
                            aria-label={`Open report for ${d.date}`}
                            className="p-1 hover:bg-surface-sunken"
                            title="Open PDF"
                          >
                            <Download className="w-4 h-4 text-accent-silver-400" />
                          </IconButton>
                          {isAdmin && (
                            <IconButton
                              onClick={() => setRegenDate(d.date)}
                              aria-label={`Regenerate report for ${d.date}`}
                              className="p-1 hover:bg-surface-sunken disabled:opacity-40"
                              title="Regenerate (admin)"
                              disabled={regenerating === d.date}
                            >
                              <RefreshCw className={`w-4 h-4 ${regenerating === d.date ? 'animate-spin' : ''}`} />
                            </IconButton>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <ConfirmDialog
        isOpen={regenDate != null}
        onClose={() => setRegenDate(null)}
        onConfirm={() => {
          const dateStr = regenDate;
          setRegenDate(null);
          if (dateStr) void regenerate(dateStr);
        }}
        title="Regenerate daily report"
        message={regenDate ? `Regenerate the daily report for ${regenDate}? This overwrites the existing PDF.` : ''}
        confirmLabel="Regenerate"
        confirmVariant="warning"
      />
    </div>
  );
}
