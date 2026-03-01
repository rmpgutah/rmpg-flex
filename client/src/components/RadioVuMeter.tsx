// ============================================================
// RMPG Flex — Radio VU Meter
//
// 8-bar level meter that reads from a Web Audio API AnalyserNode.
// Green (1-4) → Yellow (5-6) → Red (7-8).
// Updates at ~30fps via requestAnimationFrame.
// ============================================================

import React, { useEffect, useRef, useState } from 'react';

interface RadioVuMeterProps {
  analyser: AnalyserNode | null;
  barCount?: number;
  height?: number;
}

const BAR_COLORS = [
  '#33ff33', '#33ff33', '#33ff33', '#33ff33', // Green
  '#d4a017', '#d4a017',                         // Yellow
  '#bc1010', '#bc1010',                          // Red
];

export default function RadioVuMeter({
  analyser,
  barCount = 8,
  height = 16,
}: RadioVuMeterProps) {
  const [levels, setLevels] = useState<number[]>(() => new Array(barCount).fill(0));
  const rafRef = useRef<number>(0);
  const dataRef = useRef<Uint8Array | null>(null);

  useEffect(() => {
    if (!analyser) return;

    dataRef.current = new Uint8Array(analyser.frequencyBinCount);
    let running = true;

    const tick = () => {
      if (!running || !dataRef.current) return;

      analyser.getByteFrequencyData(dataRef.current);

      // Average the frequency bins to get a single level value (0-255)
      const data = dataRef.current;
      let sum = 0;
      // Focus on voice-range bins (roughly 300Hz - 3000Hz)
      const binCount = data.length;
      const startBin = Math.floor(binCount * 0.05);  // ~300Hz
      const endBin = Math.floor(binCount * 0.5);      // ~3kHz
      for (let i = startBin; i < endBin; i++) {
        sum += data[i];
      }
      const avg = sum / (endBin - startBin);

      // Map 0-255 → 0-barCount with some headroom
      const normalized = Math.min(1, avg / 180); // 180 gives good visual range
      const activeBars = Math.round(normalized * barCount);

      setLevels(prev => {
        // Only update if changed (prevent unnecessary re-renders)
        let changed = false;
        const next = new Array(barCount);
        for (let i = 0; i < barCount; i++) {
          // Target: 1 if active, 0 if not
          const target = i < activeBars ? 1 : 0;
          // Smooth decay (bars drop slower than they rise)
          if (target >= prev[i]) {
            next[i] = target;
          } else {
            next[i] = Math.max(0, prev[i] - 0.15); // Decay rate
          }
          if (next[i] !== prev[i]) changed = true;
        }
        return changed ? next : prev;
      });

      rafRef.current = requestAnimationFrame(tick);
    };

    // Run at ~30fps
    const interval = setInterval(() => {
      rafRef.current = requestAnimationFrame(tick);
    }, 33);

    return () => {
      running = false;
      clearInterval(interval);
      cancelAnimationFrame(rafRef.current);
    };
  }, [analyser, barCount]);

  return (
    <div
      className="flex items-end gap-px"
      style={{ height }}
      title="Audio Level"
    >
      {levels.map((level, i) => (
        <div
          key={i}
          className="flex-1"
          style={{
            height: `${Math.max(10, level * 100)}%`,
            minHeight: 2,
            background: level > 0.1 ? BAR_COLORS[i] || '#33ff33' : '#1a2a1a',
            opacity: level > 0.1 ? 0.6 + level * 0.4 : 0.3,
            transition: 'height 0.05s ease-out, opacity 0.05s ease-out',
          }}
        />
      ))}
    </div>
  );
}
