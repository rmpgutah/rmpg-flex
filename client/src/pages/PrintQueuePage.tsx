import React, { useState, useEffect, useCallback } from 'react';
import { Printer, RefreshCw, X, Pause, Play, Trash2 } from 'lucide-react';
import { parseTimestamp } from '../utils/dateUtils';
import { filterByQuery, jobsToCsv } from '../utils/queueWorkbench';
import { downloadTextFile } from '../utils/intelHitExport';

interface PrintJob {
  id: string;
  name: string;
  status: 'printing' | 'paused' | 'error' | 'pending';
  pages: number;
  pagesTotal: number;
  printer: string;
  submittedAt: string; // ISO timestamp
  size?: string;
}

interface ElectronPrint {
  getPrintQueue?: () => PrintJob[] | undefined;
  cancelPrintJob?: (id: string) => void;
  pausePrintJob?: (id: string) => void;
  resumePrintJob?: (id: string) => void;
  clearCompletedPrintJobs?: () => void;
  getPrinters?: () => Promise<Array<{ name: string; isDefault: boolean }>>;
}

function getElectron(): ElectronPrint | undefined {
  return (window as unknown as { electron?: ElectronPrint }).electron;
}

function relativeTime(iso: string): string {
  const diffMs = Date.now() - parseTimestamp(iso).getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  return `${diffHr}h ago`;
}

const STATUS_LABEL: Record<PrintJob['status'], string> = {
  printing: 'PRINTING',
  paused: 'PAUSED',
  error: 'ERROR',
  pending: 'PENDING',
};

const STATUS_COLOR: Record<PrintJob['status'], string> = {
  printing: 'var(--brand-400)',
  paused: 'var(--sev-warn)',
  error: 'var(--sev-critical)',
  pending: 'var(--text-secondary)',
};

const STATIC_SAMPLE: PrintJob[] = [];

export default function PrintQueuePage() {
  const electron = getElectron();
  const isElectron = !!electron;

  const [jobs, setJobs] = useState<PrintJob[]>([]);
  const [printers, setPrinters] = useState<string[]>([]);
  const [defaultPrinter, setDefaultPrinter] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date());
  const [jobQuery, setJobQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<PrintJob['status'] | 'all'>('all');

  const loadQueue = useCallback(() => {
    setLoading(true);
    try {
      const raw = electron?.getPrintQueue?.();
      if (raw === undefined) {
        setJobs(STATIC_SAMPLE);
      } else {
        setJobs(raw);
      }
      setLastRefresh(new Date());
    } catch {
      setJobs(STATIC_SAMPLE);
    } finally {
      setLoading(false);
    }
  }, [electron]);

  const loadPrinters = useCallback(async () => {
    // preload exposes `getPrinters` (not `listPrinters`) and it returns a
    // Promise<{name:string,isDefault:boolean}[]> via ipcRenderer.invoke.
    const raw = await electron?.getPrinters?.() ?? [];
    const list = Array.isArray(raw) ? raw.map((p: { name: string }) => p.name) : [];
    setPrinters(list);
    if (list.length > 0 && !defaultPrinter) {
      setDefaultPrinter(list[0]);
    }
  }, [electron, defaultPrinter]);

  useEffect(() => {
    loadQueue();
    loadPrinters();
    const iv = setInterval(loadQueue, 10000);
    return () => clearInterval(iv);
  }, [loadQueue, loadPrinters]);

  function handleCancel(id: string) {
    electron?.cancelPrintJob?.(id);
    setJobs(prev => prev.filter(j => j.id !== id));
  }

  function handlePauseResume(job: PrintJob) {
    if (job.status === 'paused') {
      electron?.resumePrintJob?.(job.id);
      setJobs(prev => prev.map(j => j.id === job.id ? { ...j, status: 'printing' } : j));
    } else {
      electron?.pausePrintJob?.(job.id);
      setJobs(prev => prev.map(j => j.id === job.id ? { ...j, status: 'paused' } : j));
    }
  }

  function handleClearCompleted() {
    electron?.clearCompletedPrintJobs?.();
    setJobs(prev => prev.filter(j => j.status === 'printing' || j.status === 'pending'));
  }

  const printing = jobs.filter(j => j.status === 'printing').length;
  const pending  = jobs.filter(j => j.status === 'pending').length;
  const paused   = jobs.filter(j => j.status === 'paused').length;
  const errors   = jobs.filter(j => j.status === 'error').length;
  const hasCompleted = jobs.some(j => j.status !== 'printing' && j.status !== 'pending');
  const visibleJobs = filterByQuery(
    statusFilter === 'all' ? jobs : jobs.filter((j) => j.status === statusFilter),
    jobQuery,
    (j) => `${j.name} ${j.printer} ${j.status}`,
  );

  const ROW: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
  };

  const LABEL9: React.CSSProperties = {
    fontSize: 9,
    fontWeight: 600,
    letterSpacing: '0.08em',
    textTransform: 'uppercase' as const,
    color: 'var(--field-label-color)',
  };

  const VAL11: React.CSSProperties = {
    fontSize: 11,
    color: 'var(--text-primary)',
  };

  const BTN_ICON: React.CSSProperties = {
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    padding: 2,
    display: 'flex',
    alignItems: 'center',
    borderRadius: 2,
  };

  return (
    <div style={{ background: 'var(--surface-base)', minHeight: '100vh', padding: 16, boxSizing: 'border-box' }}>

      {/* Header */}
      <div style={{ ...ROW, marginBottom: 12 }}>
        <Printer style={{ width: 14, height: 14, color: 'var(--brand-400)', flexShrink: 0 }} />
        <span style={{ ...LABEL9, fontSize: 10, flexGrow: 1 }}>PRINT QUEUE</span>
        <span style={{ fontSize: 9, color: 'var(--text-secondary)' }}>
          {lastRefresh.toLocaleTimeString('en-US', { timeZone: 'America/Denver', hour: '2-digit', minute: '2-digit' })}
        </span>
        <button
          type="button"
          style={BTN_ICON}
          onClick={loadQueue}
          disabled={loading}
          title="Refresh"
        >
          <RefreshCw
            style={{
              width: 12,
              height: 12,
              color: 'var(--brand-400)',
              animation: loading ? 'spin 1s linear infinite' : 'none',
            }}
          />
        </button>
      </div>

      {/* Offline banner */}
      {!isElectron && (
        <div style={{
          background: 'var(--surface-raised)',
          border: '1px solid var(--border-subtle)',
          borderRadius: 2,
          padding: '10px 12px',
          marginBottom: 12,
          display: 'flex',
          alignItems: 'center',
          gap: 8,
        }}>
          <Printer style={{ width: 14, height: 14, color: 'var(--text-secondary)', flexShrink: 0 }} />
          <span style={{ fontSize: 10, color: 'var(--text-secondary)' }}>
            Print management available in the FlexOS desktop app
          </span>
        </div>
      )}

      {/* Printer selector */}
      {isElectron && printers.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          <div style={{ ...LABEL9, marginBottom: 4 }}>PRINTER</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {printers.map(p => (
              <button
                key={p}
                type="button"
                onClick={() => setDefaultPrinter(p)}
                style={{
                  fontSize: 10,
                  padding: '2px 8px',
                  borderRadius: 2,
                  border: '1px solid var(--border-subtle)',
                  cursor: 'pointer',
                  background: p === defaultPrinter ? 'var(--brand-400)' : 'var(--surface-raised)',
                  color: p === defaultPrinter ? 'var(--surface-base)' : 'var(--text-primary)',
                  fontWeight: p === defaultPrinter ? 600 : 400,
                }}
              >
                {p}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Summary row */}
      <div style={{ ...ROW, marginBottom: 12, gap: 16 }}>
        <div style={{ textAlign: 'center' as const }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--brand-400)' }}>{printing}</div>
          <div style={LABEL9}>PRINTING</div>
        </div>
        <div style={{ textAlign: 'center' as const }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-secondary)' }}>{pending}</div>
          <div style={LABEL9}>PENDING</div>
        </div>
        <div style={{ textAlign: 'center' as const }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--sev-warn)' }}>{paused}</div>
          <div style={LABEL9}>PAUSED</div>
        </div>
        <div style={{ textAlign: 'center' as const }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--sev-critical)' }}>{errors}</div>
          <div style={LABEL9}>ERROR</div>
        </div>
        <div style={{ flexGrow: 1 }} />
        <button
          type="button"
          onClick={() => downloadTextFile('print-queue.csv', jobsToCsv(visibleJobs))}
          style={{ fontSize: 9, color: 'var(--text-secondary)', padding: '3px 8px', border: '1px solid var(--border-subtle)', background: 'var(--surface-raised)', borderRadius: 2 }}
        >
          CSV
        </button>
        {hasCompleted && (
          <button
            type="button"
            onClick={handleClearCompleted}
            style={{
              ...BTN_ICON,
              fontSize: 9,
              color: 'var(--text-secondary)',
              gap: 4,
              padding: '3px 8px',
              border: '1px solid var(--border-subtle)',
              background: 'var(--surface-raised)',
            }}
          >
            <Trash2 style={{ width: 10, height: 10 }} />
            CLEAR COMPLETED
          </button>
        )}
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' as const }}>
        <input
          value={jobQuery}
          onChange={(e) => setJobQuery(e.target.value)}
          placeholder="Filter jobs…"
          aria-label="Filter print jobs"
          style={{ flex: 1, minWidth: 140, fontSize: 11, padding: '4px 8px', background: 'var(--surface-sunken)', border: '1px solid var(--border-subtle)', borderRadius: 2, color: 'var(--text-primary)' }}
        />
        {(['all', 'printing', 'pending', 'paused', 'error'] as const).map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setStatusFilter(s)}
            style={{ fontSize: 8, padding: '2px 8px', borderRadius: 2, border: '1px solid var(--border-subtle)', background: statusFilter === s ? 'var(--brand-400)' : 'var(--surface-raised)', color: statusFilter === s ? 'var(--surface-base)' : 'var(--text-secondary)', textTransform: 'uppercase' as const }}
          >
            {s}
          </button>
        ))}
      </div>

      {/* Job list */}
      {jobs.length === 0 ? (
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '40px 16px',
          gap: 8,
          color: 'var(--text-secondary)',
        }}>
          <Printer style={{ width: 28, height: 28, opacity: 0.4 }} />
          <span style={{ fontSize: 10 }}>No print jobs</span>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {visibleJobs.map(job => {
            const progress = job.pagesTotal > 0
              ? Math.round((job.pages / job.pagesTotal) * 100)
              : 0;

            return (
              <div
                key={job.id}
                style={{
                  background: 'var(--surface-raised)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: 2,
                  padding: '8px 10px',
                }}
              >
                {/* Top row */}
                <div style={{ ...ROW, marginBottom: job.status === 'printing' ? 6 : 0 }}>
                  {/* Job info */}
                  <div style={{ flexGrow: 1, minWidth: 0 }}>
                    <div
                      style={{ ...VAL11, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const, cursor: 'pointer' }}
                      title="Copy job name"
                      onClick={() => navigator.clipboard.writeText(job.name).catch(() => undefined)}
                    >
                      {job.name}
                    </div>
                    <div style={{ ...ROW, gap: 6, marginTop: 2 }}>
                      <span style={{ fontSize: 9, color: 'var(--text-secondary)' }}>{job.printer}</span>
                      <span style={{ fontSize: 9, color: 'var(--text-secondary)' }}>·</span>
                      <span style={{ fontSize: 9, color: 'var(--text-secondary)' }}>
                        {job.pages}/{job.pagesTotal} pp
                      </span>
                      {job.size && (
                        <>
                          <span style={{ fontSize: 9, color: 'var(--text-secondary)' }}>·</span>
                          <span style={{ fontSize: 9, color: 'var(--text-secondary)' }}>{job.size}</span>
                        </>
                      )}
                      <span style={{ fontSize: 9, color: 'var(--text-secondary)' }}>·</span>
                      <span style={{ fontSize: 9, color: 'var(--text-secondary)' }}>
                        {relativeTime(job.submittedAt)}
                      </span>
                    </div>
                  </div>

                  {/* Status badge */}
                  <span style={{
                    fontSize: 8,
                    fontWeight: 700,
                    letterSpacing: '0.06em',
                    color: STATUS_COLOR[job.status],
                    border: `1px solid ${STATUS_COLOR[job.status]}`,
                    borderRadius: 2,
                    padding: '1px 5px',
                    flexShrink: 0,
                  }}>
                    {STATUS_LABEL[job.status]}
                  </span>

                  {/* Action buttons */}
                  <div style={{ ...ROW, gap: 2, flexShrink: 0 }}>
                    {(job.status === 'printing' || job.status === 'paused') && (
                      <button
                        type="button"
                        style={BTN_ICON}
                        onClick={() => handlePauseResume(job)}
                        title={job.status === 'paused' ? 'Resume' : 'Pause'}
                      >
                        {job.status === 'paused' ? (
                          <Play style={{ width: 11, height: 11, color: 'var(--sev-ok)' }} />
                        ) : (
                          <Pause style={{ width: 11, height: 11, color: 'var(--sev-warn)' }} />
                        )}
                      </button>
                    )}
                    <button
                      type="button"
                      style={BTN_ICON}
                      onClick={() => handleCancel(job.id)}
                      title="Cancel job"
                    >
                      <X style={{ width: 11, height: 11, color: 'var(--sev-critical)' }} />
                    </button>
                  </div>
                </div>

                {/* Progress bar — printing jobs only */}
                {job.status === 'printing' && job.pagesTotal > 0 && (
                  <div>
                    <div style={{
                      height: 3,
                      background: 'var(--border-subtle)',
                      borderRadius: 2,
                      overflow: 'hidden',
                    }}>
                      <div style={{
                        height: '100%',
                        width: `${progress}%`,
                        background: 'var(--brand-400)',
                        borderRadius: 2,
                        transition: 'width 0.4s ease',
                      }} />
                    </div>
                    <div style={{ fontSize: 8, color: 'var(--text-secondary)', marginTop: 2, textAlign: 'right' as const }}>
                      {progress}%
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Spin keyframes injected inline */}
      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
