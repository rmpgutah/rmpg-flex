interface SignalMeterProps {
  latencyMs: number;
  signalBars: number;
  throughputUp: number;
  throughputDown: number;
  packetLoss: number;
  dbm: number;
}

const TOTAL_BARS = 12;

function barColor(index: number): string {
  if (index < 6) return 'var(--sev-ok)';      // green — signal OK
  if (index < 9) return 'var(--sev-warn)';    // amber — marginal signal
  return 'var(--sev-critical)';               // red — weak/poor signal
}

export default function SignalMeter({
  latencyMs,
  signalBars,
  throughputUp,
  throughputDown,
  packetLoss,
  dbm,
}: SignalMeterProps) {
  return (
    <div className="border border-border-default rounded-[2px] p-2 bg-surface-base">
      <div className="text-[9px] font-semibold text-fg-muted uppercase tracking-[0.5px] mb-1.5">
        SIGNAL STRENGTH
      </div>

      {/* S-meter bar visualization */}
      <div className="flex items-end gap-[1px] mb-1.5" style={{ height: 16 }}>
        {Array.from({ length: TOTAL_BARS }, (_, i) => {
          const isActive = i < signalBars;
          const color = barColor(i);
          return (
            <div
              key={i}
              style={{
                width: 3,
                height: 12,
                borderRadius: 1,
                background: isActive ? color : 'var(--surface-raised)',
                boxShadow: isActive ? `0 0 2px ${color}` : 'none',
                transition: 'background 0.2s, box-shadow 0.2s',
              }}
            />
          );
        })}
        {/* dBm readout next to bars */}
        <span className="ml-2 font-mono text-[10px] font-bold text-fg-muted self-center">
          {dbm} dBm
        </span>
      </div>

      {/* Numeric stats */}
      <div className="grid grid-cols-2 gap-x-3 gap-y-0.5">
        <div className="font-mono text-[8px] text-fg-muted">
          Latency: <span className="text-fg-muted">{latencyMs}ms</span>
        </div>
        <div className="font-mono text-[8px] text-fg-muted">
          Loss: <span className="text-fg-muted">{packetLoss}%</span>
        </div>
        <div className="font-mono text-[8px] text-fg-muted">
          TX: <span className="text-fg-muted">{throughputUp} B/s</span>
        </div>
        <div className="font-mono text-[8px] text-fg-muted">
          RX: <span className="text-fg-muted">{throughputDown} B/s</span>
        </div>
      </div>
    </div>
  );
}
