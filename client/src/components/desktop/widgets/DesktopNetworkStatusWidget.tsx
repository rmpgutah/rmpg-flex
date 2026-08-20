import React, { useState, useEffect, useCallback } from 'react';

interface NetworkState {
  apiOk: boolean | null;
  internetOk: boolean | null;
  latencyMs: number | null;
  checkedAt: Date | null;
}

function StatusDot({ ok }: { ok: boolean | null }) {
  const color = ok === null ? 'var(--text-muted)' : ok ? 'var(--sev-ok)' : 'var(--sev-critical)';
  return (
    <span
      style={{
        display: 'inline-block',
        width: 7,
        height: 7,
        borderRadius: '50%',
        background: color,
        marginRight: 5,
        flexShrink: 0,
      }}
    />
  );
}

export default function DesktopNetworkStatusWidget() {
  const [net, setNet] = useState<NetworkState>({
    apiOk: null,
    internetOk: null,
    latencyMs: null,
    checkedAt: null,
  });

  const check = useCallback(async () => {
    // API check + latency
    let apiOk = false;
    let latencyMs: number | null = null;
    try {
      const apiBase = (window as { VITE_API_BASE?: string }).VITE_API_BASE
        ?? (import.meta as { env?: { VITE_API_BASE?: string } }).env?.VITE_API_BASE
        ?? 'https://api.rmpgutah.us';
      const start = performance.now();
      const res = await fetch(`${apiBase}/api/health`, { signal: AbortSignal.timeout(8000) });
      latencyMs = Math.round(performance.now() - start);
      apiOk = res.ok;
    } catch {
      apiOk = false;
    }

    // Internet check (no-cors, just need a response)
    let internetOk = false;
    try {
      await fetch('https://www.cloudflare.com/cdn-cgi/trace', {
        mode: 'no-cors',
        cache: 'no-store',
        signal: AbortSignal.timeout(6000),
      });
      internetOk = true;
    } catch {
      internetOk = false;
    }

    setNet({ apiOk, internetOk, latencyMs, checkedAt: new Date() });
  }, []);

  useEffect(() => {
    check();
    const iv = setInterval(check, 30_000);
    return () => clearInterval(iv);
  }, [check]);

  function fmtTime(d: Date): string {
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }

  return (
    <div
      style={{
        background: 'var(--surface-raised)',
        border: '1px solid var(--border-default)',
        borderRadius: 2,
        padding: '10px 14px',
        width: 200,
        minHeight: 110,
      }}
    >
      <div className="text-[10px] font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--text-secondary)' }}>
        Network Status
      </div>

      <div className="flex flex-col gap-[5px]">
        <div className="flex items-center text-[11px]" style={{ color: 'var(--text-primary)' }}>
          <StatusDot ok={net.apiOk} />
          <span>{net.apiOk === null ? 'Checking API…' : net.apiOk ? 'API Connected' : 'API Unreachable'}</span>
        </div>
        <div className="flex items-center text-[11px]" style={{ color: 'var(--text-primary)' }}>
          <StatusDot ok={net.internetOk} />
          <span>{net.internetOk === null ? 'Checking internet…' : net.internetOk ? 'Internet OK' : 'No Internet'}</span>
        </div>

        {net.latencyMs !== null && (
          <div className="text-[10px] mt-1" style={{ color: 'var(--text-secondary)' }}>
            Latency: <span className="font-mono" style={{ color: net.latencyMs < 300 ? 'var(--sev-ok)' : net.latencyMs < 800 ? 'var(--sev-warn)' : 'var(--sev-critical)' }}>{net.latencyMs} ms</span>
          </div>
        )}
        {net.checkedAt && (
          <div className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
            Checked {fmtTime(net.checkedAt)}
          </div>
        )}
      </div>
    </div>
  );
}
