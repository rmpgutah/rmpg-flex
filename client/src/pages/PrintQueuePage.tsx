import React, { useState, useEffect } from 'react';
import { Printer, RefreshCw, X } from 'lucide-react';

interface PrintJob { id: string; name: string; status: string; pages?: number; }

type ElectronAPI = { getPrintJobs?: () => Promise<PrintJob[]>; cancelPrintJob?: (id: string) => Promise<void> };

export default function PrintQueuePage() {
  const [jobs, setJobs] = useState<PrintJob[]>([]);
  const [loading, setLoading] = useState(false);
  const isElectron = !!(window as unknown as { electronAPI?: ElectronAPI }).electronAPI;

  async function loadJobs() {
    setLoading(true);
    try {
      const api = (window as unknown as { electronAPI?: ElectronAPI }).electronAPI;
      const raw = await api?.getPrintJobs?.();
      setJobs(raw ?? []);
    } catch { setJobs([]); }
    finally { setLoading(false); }
  }

  async function cancelJob(id: string) {
    try {
      await (window as unknown as { electronAPI?: ElectronAPI }).electronAPI?.cancelPrintJob?.(id);
      await loadJobs();
    } catch { /* error */ }
  }

  useEffect(() => {
    loadJobs();
    const iv = setInterval(loadJobs, 10000);
    return () => clearInterval(iv);
  }, []);

  return (
    <div style={{ background: 'var(--surface-base)', minHeight: '100vh', padding: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <Printer className="w-4 h-4" style={{ color: 'var(--brand-400)' }} />
        <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--field-label-color)', letterSpacing: '0.08em', flexGrow: 1 }}>PRINT QUEUE</div>
        <button type="button" onClick={loadJobs} disabled={loading} style={{ background: 'none', border: 'none', cursor: 'pointer' }}>
          <RefreshCw className={`w-3 h-3${loading ? ' animate-spin' : ''}`} style={{ color: 'var(--brand-400)' }} />
        </button>
      </div>
      {!isElectron && (
        <div style={{ fontSize: 9, color: 'var(--text-secondary)', marginBottom: 8 }}>Print queue requires the desktop app.</div>
      )}
      {jobs.length === 0 ? (
        <div style={{ fontSize: 9, color: 'var(--text-secondary)' }}>No print jobs</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {jobs.map(j => (
            <div key={j.id} style={{ background: 'var(--surface-raised)', border: '1px solid var(--border-subtle)', borderRadius: 2, padding: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ flexGrow: 1 }}>
                <div style={{ fontSize: 10, color: 'var(--text-primary)' }}>{j.name}</div>
                <div style={{ fontSize: 9, color: 'var(--text-secondary)' }}>{j.status}{j.pages ? ` · ${j.pages} pages` : ''}</div>
              </div>
              <button type="button" onClick={() => cancelJob(j.id)} title="Cancel" style={{ background: 'none', border: 'none', cursor: 'pointer' }}>
                <X className="w-3 h-3" style={{ color: 'var(--sev-critical, #ef4444)' }} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
