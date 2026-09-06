import React, { useState, useEffect, useCallback } from 'react';

interface NetworkInterface {
  name: string;
  address?: string;
  mac?: string;
  family?: string;
  internal?: boolean;
}

interface VpnState {
  checked: boolean;
  inElectron: boolean;
  connected: boolean;
  interfaceName: string | null;
  assignedIp: string | null;
}

const VPN_NAMES_RE = /tun|tap|vpn|wg|utun|ppp/i;

function detectVpn(ifaces: NetworkInterface[]): { connected: boolean; interfaceName: string | null; assignedIp: string | null } {
  const match = ifaces.find(
    i => !i.internal && VPN_NAMES_RE.test(i.name) && i.family === 'IPv4'
  );
  if (!match) return { connected: false, interfaceName: null, assignedIp: null };
  return { connected: true, interfaceName: match.name, assignedIp: match.address ?? null };
}

export default function DesktopVpnStatusWidget() {
  const [state, setState] = useState<VpnState>({
    checked: false,
    inElectron: false,
    connected: false,
    interfaceName: null,
    assignedIp: null,
  });

  const refresh = useCallback(async () => {
    const el = (window as any).electron;
    if (!el?.getNetworkInterfaces) {
      setState({ checked: true, inElectron: false, connected: false, interfaceName: null, assignedIp: null });
      return;
    }
    try {
      const ifaces = await el.getNetworkInterfaces();
      const result = detectVpn(ifaces);
      setState({ checked: true, inElectron: true, ...result });
    } catch {
      setState({ checked: true, inElectron: true, connected: false, interfaceName: null, assignedIp: null });
    }
  }, []);

  useEffect(() => {
    refresh();
    const iv = setInterval(refresh, 60_000);
    return () => clearInterval(iv);
  }, [refresh]);

  const statusColor = !state.checked
    ? 'var(--text-muted)'
    : !state.inElectron
    ? 'var(--text-muted)'
    : state.connected
    ? 'var(--sev-ok)'
    : 'var(--sev-warn)';

  return (
    <div
      style={{
        background: 'var(--surface-raised)',
        border: '1px solid var(--border-default)',
        borderRadius: 2,
        padding: '10px 14px',
        width: 200,
        minHeight: 100,
      }}
    >
      <div className="text-[10px] font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--text-secondary)' }}>
        VPN Status
      </div>

      {!state.checked ? (
        <div className="text-[11px]" style={{ color: 'var(--text-muted)' }}>Checking…</div>
      ) : !state.inElectron ? (
        <div className="text-[11px]" style={{ color: 'var(--text-muted)' }}>VPN status requires desktop app</div>
      ) : (
        <div className="flex flex-col gap-[4px]">
          <div className="text-[11px] font-semibold" style={{ color: statusColor }}>
            {state.connected ? `VPN Connected` : 'No VPN Detected'}
          </div>
          {state.connected && state.interfaceName && (
            <div className="text-[10px]" style={{ color: 'var(--text-secondary)' }}>
              Interface: <span className="font-mono">{state.interfaceName}</span>
            </div>
          )}
          {state.connected && state.assignedIp && (
            <div className="text-[10px]" style={{ color: 'var(--text-secondary)' }}>
              IP: <span className="font-mono">{state.assignedIp}</span>
            </div>
          )}
        </div>
      )}

      <button
        onClick={refresh}
        style={{
          marginTop: 8,
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
  );
}
