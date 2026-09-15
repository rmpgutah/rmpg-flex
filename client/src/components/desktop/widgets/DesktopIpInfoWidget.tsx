import React, { useState, useEffect, useCallback } from 'react';

interface NetworkInterface {
  name: string;
  address?: string;
  mac?: string;
  family?: string;
  internal?: boolean;
}

interface IpInfo {
  hostname: string;
  primaryIp: string | null;
  mac: string | null;
  externalIp: string | null;
}

async function resolveIpInfo(): Promise<IpInfo> {
  const el = (window as any).electron;

  // Hostname
  let hostname = window.location.hostname;
  try {
    const info = await el?.getSystemInfo?.();
    if (info?.hostname) hostname = info.hostname;
  } catch { /* ignore */ }

  // Primary IP + MAC from network interfaces
  let primaryIp: string | null = null;
  let mac: string | null = null;
  try {
    const ifaces = await el?.getNetworkInterfaces?.();
    if (ifaces) {
      const active = ifaces.find((i: any) => !i.internal && i.family === 'IPv4' && i.address);
      if (active) {
        primaryIp = active.address ?? null;
        mac = active.mac ?? null;
      }
    }
  } catch { /* ignore */ }

  // External IP via Cloudflare trace (no-cors)
  let externalIp: string | null = null;
  try {
    const res = await fetch('https://www.cloudflare.com/cdn-cgi/trace', {
      mode: 'cors',
      cache: 'no-store',
      signal: AbortSignal.timeout(6000),
    });
    if (res.ok) {
      const text = await res.text();
      const match = /^ip=(.+)$/m.exec(text);
      if (match) externalIp = match[1].trim();
    }
  } catch { /* CORS or network blocked — leave null */ }

  return { hostname, primaryIp, mac, externalIp };
}

export default function DesktopIpInfoWidget() {
  const [info, setInfo] = useState<IpInfo | null>(null);
  const [copied, setCopied] = useState(false);

  const refresh = useCallback(async () => {
    const result = await resolveIpInfo();
    setInfo(result);
  }, []);

  useEffect(() => {
    refresh();
    const iv = setInterval(refresh, 5 * 60 * 1000);
    return () => clearInterval(iv);
  }, [refresh]);

  async function copyIp() {
    if (!info?.primaryIp) return;
    try {
      await navigator.clipboard.writeText(info.primaryIp);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* ignore */ }
  }

  const Row = ({ label, value }: { label: string; value: string | null }) => (
    <div className="flex justify-between gap-2 text-[10px]">
      <span style={{ color: 'var(--text-secondary)', flexShrink: 0 }}>{label}</span>
      <span className="font-mono truncate" style={{ color: 'var(--text-primary)' }} title={value ?? ''}>
        {value ?? '---'}
      </span>
    </div>
  );

  return (
    <div
      style={{
        background: 'var(--surface-raised)',
        border: '1px solid var(--border-default)',
        borderRadius: 2,
        padding: '10px 14px',
        width: 210,
        minHeight: 120,
      }}
    >
      <div className="text-[10px] font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--text-secondary)' }}>
        IP Info
      </div>

      {!info ? (
        <div className="text-[11px]" style={{ color: 'var(--text-muted)' }}>Loading…</div>
      ) : (
        <div className="flex flex-col gap-[4px]">
          <Row label="Hostname" value={info.hostname} />
          <Row label="Primary IP" value={info.primaryIp} />
          <Row label="MAC" value={info.mac} />
          <Row label="External IP" value={info.externalIp} />
        </div>
      )}

      <div className="flex gap-2 mt-2">
        <button
          onClick={copyIp}
          disabled={!info?.primaryIp}
          style={{
            background: 'none',
            border: 'none',
            cursor: info?.primaryIp ? 'pointer' : 'default',
            color: copied ? 'var(--sev-ok)' : 'var(--accent-silver-400)',
            fontSize: 10,
            padding: 0,
          }}
        >
          {copied ? 'Copied!' : 'Copy IP'}
        </button>
        <button
          onClick={refresh}
          style={{
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            color: 'var(--accent-silver-400)',
            fontSize: 10,
            padding: 0,
          }}
        >
          Refresh
        </button>
      </div>
    </div>
  );
}
