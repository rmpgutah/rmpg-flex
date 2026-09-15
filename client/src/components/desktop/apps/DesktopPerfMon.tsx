import React, { useState, useEffect, useRef, useCallback } from 'react';
import { X, Download } from 'lucide-react';
import { useDraggablePosition } from '../../../hooks/useDraggablePosition';

interface DesktopPerfMonProps {
  onClose: () => void;
}

const W = 700;
const H = 500;
const CHART_W = 280;
const CHART_H = 80;
const LIVE_POINTS = 60;
const HISTORY_POINTS = 300;
const INTERVAL_MS = 2000;

type TabId = 'live' | 'history';

interface MetricPoint {
  cpu: number;
  ram: number;
  net: number;
  disk: number;
  ts: number;
}

function Sparkline({ data, color, maxVal = 100 }: { data: number[]; color: string; maxVal?: number }) {
  const pts = data.length;
  if (pts < 2) return <polyline points="" stroke={color} fill="none" strokeWidth={1.5} />;

  const xs = data.map((_, i) => (i / (pts - 1)) * CHART_W);
  const ys = data.map(v => CHART_H - (Math.min(v, maxVal) / maxVal) * (CHART_H - 4) - 2);

  const linePoints = xs.map((x, i) => `${x},${ys[i]}`).join(' ');
  const fillPoints = [
    `0,${CHART_H}`,
    ...xs.map((x, i) => `${x},${ys[i]}`),
    `${CHART_W},${CHART_H}`,
  ].join(' ');

  return (
    <g>
      <polygon points={fillPoints} fill={color} fillOpacity={0.15} />
      <polyline points={linePoints} stroke={color} fill="none" strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
    </g>
  );
}

function MetricCard({ label, value, unit, data, color, note }: {
  label: string;
  value: number;
  unit: string;
  data: number[];
  color: string;
  note?: string;
}) {
  return (
    <div style={{ border: '1px solid var(--border-subtle)', borderRadius: 2, padding: 8, background: 'var(--surface-sunken)' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 4, marginBottom: 4 }}>
        <span style={{ fontSize: 22, fontWeight: 700, color: 'var(--text-primary)', fontVariantNumeric: 'tabular-nums' }}>
          {value.toFixed(0)}
        </span>
        <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{unit}</span>
      </div>
      <svg width={CHART_W} height={CHART_H} style={{ display: 'block', borderRadius: 2 }}>
        <rect width={CHART_W} height={CHART_H} fill="var(--surface-overlay)" />
        <Sparkline data={data} color={color} />
      </svg>
      <div style={{ fontSize: 10, color: 'var(--text-secondary)', marginTop: 4 }}>{label}</div>
      {note && <div style={{ fontSize: 9, color: 'var(--text-muted)', marginTop: 2 }}>{note}</div>}
    </div>
  );
}

const hasElectron = () => typeof window !== 'undefined' && !!(window as any).electron?.isElectron;

export default function DesktopPerfMon({ onClose }: DesktopPerfMonProps) {
  const [pos, setPos] = useState({
    x: Math.max(0, (window.innerWidth - W) / 2),
    y: Math.max(0, (window.innerHeight - H) / 4),
  });
  const { onPointerDown } = useDraggablePosition(pos.x, pos.y, (x, y) => setPos({ x, y }));
  const [tab, setTab] = useState<TabId>('live');

  const historyRef = useRef<MetricPoint[]>([]);
  const [live, setLive] = useState<MetricPoint[]>([]);
  const [history, setHistory] = useState<MetricPoint[]>([]);

  const poll = useCallback(async () => {
    const el = (window as any).electron;
    let cpu = 0;
    let ram = 0;
    if (hasElectron()) {
      try {
        const [cpuRes, sysInfo] = await Promise.all([
          el.getCpuUsage?.() as Promise<number | null>,
          el.getSystemInfo?.() as Promise<{ usedMemMb: number; totalMemMb: number } | null>,
        ]);
        cpu = cpuRes ?? 0;
        if (sysInfo) ram = (sysInfo.usedMemMb / sysInfo.totalMemMb) * 100;
      } catch { /* offline-tolerant */ }
    }
    const point: MetricPoint = { cpu, ram, net: 0, disk: 0, ts: Date.now() };

    historyRef.current = [...historyRef.current, point].slice(-HISTORY_POINTS);
    setLive(historyRef.current.slice(-LIVE_POINTS));
    setHistory([...historyRef.current]);
  }, []);

  useEffect(() => {
    poll();
    const id = setInterval(poll, INTERVAL_MS);
    return () => clearInterval(id);
  }, [poll]);

  function exportCsv() {
    const rows = ['timestamp,cpu,ram,net,disk'];
    for (const p of historyRef.current) {
      rows.push(`${new Date(p.ts).toISOString()},${p.cpu.toFixed(1)},${p.ram.toFixed(1)},${p.net.toFixed(1)},${p.disk.toFixed(1)}`); // new-date-ok epoch number from Date.now()
    }
    const blob = new Blob([rows.join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `flexos-perf-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const currentCpu = live[live.length - 1]?.cpu ?? 0;
  const currentRam = live[live.length - 1]?.ram ?? 0;

  const cpuColor = 'var(--sev-ok)';
  const ramColor = 'var(--sev-warn)';
  const netColor = 'var(--accent-silver-400)';
  const diskColor = 'var(--sev-critical)';

  const displayData = tab === 'live' ? live : history;

  return (
    <div
      style={{
        position: 'fixed',
        left: pos.x,
        top: pos.y,
        width: W,
        height: H,
        background: 'var(--surface-raised)',
        border: '1px solid var(--border-default)',
        borderRadius: 2,
        boxShadow: '0 8px 32px rgba(0 0 0 / 0.45)',
        zIndex: 20200,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      {/* Title bar */}
      <div
        onPointerDown={onPointerDown}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 8px',
          height: 30,
          background: 'var(--surface-overlay)',
          borderBottom: '1px solid var(--border-subtle)',
          cursor: 'move',
          userSelect: 'none',
          flexShrink: 0,
        }}
      >
        <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--panel-header-color)' }}>Performance Monitor</span>
        <button type="button" aria-label="Close Performance Monitor" onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 2 }}>
          <X size={12} style={{ color: 'var(--text-secondary)' }} />
        </button>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', borderBottom: '1px solid var(--border-subtle)', flexShrink: 0 }}>
        {(['live', 'history'] as TabId[]).map(t => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            style={{
              padding: '5px 14px',
              fontSize: 11,
              background: tab === t ? 'var(--surface-raised)' : 'transparent',
              borderRight: '1px solid var(--border-subtle)',
              borderBottom: tab === t ? '2px solid var(--accent-silver-400)' : '2px solid transparent',
              color: tab === t ? 'var(--text-primary)' : 'var(--text-secondary)',
              cursor: 'pointer',
            }}
          >
            {t === 'live' ? 'Live' : 'History (10 min)'}
          </button>
        ))}
        {tab === 'history' && (
          <button
            type="button"
            onClick={exportCsv}
            style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, padding: '0 10px', color: 'var(--text-primary)', background: 'none', border: 'none', cursor: 'pointer' }}
          >
            <Download size={10} /> Export CSV
          </button>
        )}
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflowY: 'auto', padding: 12 }}>
        {!hasElectron() && (
          <div style={{ marginBottom: 10, padding: '6px 10px', background: 'rgba(var(--sev-warn-rgb,245 158 11)/0.12)', border: '1px solid var(--sev-warn)', borderRadius: 2, fontSize: 11, color: 'var(--sev-warn)' }}>
            Full metrics require the desktop app. Showing zero-filled charts.
          </div>
        )}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <MetricCard
            label="CPU Usage"
            value={currentCpu}
            unit="%"
            data={displayData.map(p => p.cpu)}
            color={cpuColor}
          />
          <MetricCard
            label="RAM Usage"
            value={currentRam}
            unit="%"
            data={displayData.map(p => p.ram)}
            color={ramColor}
          />
          <MetricCard
            label="Network (Rx)"
            value={0}
            unit="KB/s"
            data={displayData.map(p => p.net)}
            color={netColor}
            note={hasElectron() ? undefined : 'Requires desktop app'}
          />
          <MetricCard
            label="Disk Activity"
            value={0}
            unit="%"
            data={displayData.map(p => p.disk)}
            color={diskColor}
            note={hasElectron() ? undefined : 'Requires desktop app'}
          />
        </div>
        <div style={{ marginTop: 8, fontSize: 10, color: 'var(--text-muted)' }}>
          Refreshes every 2 seconds · {displayData.length} data point{displayData.length !== 1 ? 's' : ''} shown
        </div>
      </div>
    </div>
  );
}
