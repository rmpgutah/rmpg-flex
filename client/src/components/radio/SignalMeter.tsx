import React from 'react';

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
  if (index < 6) return '#22c55e';  // green
  if (index < 9) return '#d4a017';  // amber
  return '#dc2626';                  // red
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
    <div className="border border-[#222222] rounded-[2px] p-2 bg-[#0d0d0d]">
      <div className="text-[9px] font-semibold text-[#888888] uppercase tracking-[0.5px] mb-1.5">
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
                background: isActive ? color : '#1a1a1a',
                boxShadow: isActive ? `0 0 2px ${color}` : 'none',
                transition: 'background 0.2s, box-shadow 0.2s',
              }}
            />
          );
        })}
        {/* dBm readout next to bars */}
        <span className="ml-2 font-mono text-[10px] font-bold text-[#888888] self-center">
          {dbm} dBm
        </span>
      </div>

      {/* Numeric stats */}
      <div className="grid grid-cols-2 gap-x-3 gap-y-0.5">
        <div className="font-mono text-[8px] text-[#666666]">
          Latency: <span className="text-[#888888]">{latencyMs}ms</span>
        </div>
        <div className="font-mono text-[8px] text-[#666666]">
          Loss: <span className="text-[#888888]">{packetLoss}%</span>
        </div>
        <div className="font-mono text-[8px] text-[#666666]">
          TX: <span className="text-[#888888]">{throughputUp} B/s</span>
        </div>
        <div className="font-mono text-[8px] text-[#666666]">
          RX: <span className="text-[#888888]">{throughputDown} B/s</span>
        </div>
      </div>
    </div>
  );
}
