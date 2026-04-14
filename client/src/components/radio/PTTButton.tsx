import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Mic, MicOff, Volume2 } from 'lucide-react';

type PTTState = 'idle' | 'tx' | 'rx';

const LS_VOL_KEY = 'rmpg-radio-volume';

interface PTTButtonProps {
  onStateChange?: (state: PTTState) => void;
}

export default function PTTButton({ onStateChange }: PTTButtonProps) {
  const [state, setState] = useState<PTTState>('idle');
  const [muted, setMuted] = useState(false);
  const [monitor, setMonitor] = useState(false);
  const [vKeyEnabled, setVKeyEnabled] = useState(true);
  const [volume, setVolume] = useState(() => {
    try {
      const stored = localStorage.getItem(LS_VOL_KEY);
      return stored ? Number(stored) : 75;
    } catch {
      return 75;
    }
  });

  const stateRef = useRef<PTTState>('idle');
  const isMouseDownRef = useRef(false);

  // Persist volume
  useEffect(() => {
    try { localStorage.setItem(LS_VOL_KEY, String(volume)); } catch { /* ignore */ }
  }, [volume]);

  // Notify parent of state changes
  useEffect(() => {
    onStateChange?.(state);
  }, [state, onStateChange]);

  const startTx = useCallback(() => {
    if (stateRef.current !== 'idle') return;
    stateRef.current = 'tx';
    setState('tx');
  }, []);

  const stopTx = useCallback(() => {
    if (stateRef.current !== 'tx') return;
    stateRef.current = 'idle';
    setState('idle');
  }, []);

  // V key binding
  useEffect(() => {
    if (!vKeyEnabled) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.repeat) return;
      if (e.key !== 'v' && e.key !== 'V') return;
      const tag = (e.target as HTMLElement)?.tagName?.toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select' || (e.target as HTMLElement)?.isContentEditable) return;
      e.preventDefault();
      startTx();
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key !== 'v' && e.key !== 'V') return;
      stopTx();
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [vKeyEnabled, startTx, stopTx]);

  // Listen for incoming radio transmissions to set RX state
  // (In production, this would subscribe to WS radio_transmission messages)
  // For now, RX state is available for future integration

  // PTT face styles by state
  const faceStyle: React.CSSProperties =
    state === 'tx'
      ? {
          background: '#991b1b',
          borderTop: '1px solid #b91c1c',
          borderLeft: '1px solid #b91c1c',
          borderBottom: '2px solid #450a0a',
          borderRight: '2px solid #450a0a',
          boxShadow: '0 0 12px rgba(220, 38, 38, 0.4), inset 0 1px 3px rgba(0,0,0,0.3)',
        }
      : state === 'rx'
        ? {
            background: '#166534',
            borderTop: '1px solid #22c55e',
            borderLeft: '1px solid #22c55e',
            borderBottom: '2px solid #052e16',
            borderRight: '2px solid #052e16',
            boxShadow: '0 0 12px rgba(34, 197, 94, 0.4), inset 0 1px 3px rgba(0,0,0,0.3)',
          }
        : {
            background: '#2a2a2a',
            borderTop: '1px solid #444444',
            borderLeft: '1px solid #444444',
            borderBottom: '2px solid #111111',
            borderRight: '2px solid #111111',
            boxShadow: 'none',
          };

  const ledColor =
    state === 'tx' ? '#d4a017' : state === 'rx' ? '#22c55e' : '#555555';

  const stateLabel = state === 'tx' ? 'TRANSMIT' : state === 'rx' ? 'RECEIVE' : 'STANDBY';

  return (
    <div className="border border-[#222222] rounded-[2px] p-2 bg-[#0d0d0d]">
      <div className="text-[9px] font-semibold text-[#888888] uppercase tracking-[0.5px] mb-1.5">
        PUSH-TO-TALK
      </div>

      <div className="flex items-stretch gap-2">
        {/* PTT Button */}
        <div className="flex-1 flex flex-col items-center">
          <button
            onMouseDown={() => { isMouseDownRef.current = true; startTx(); }}
            onMouseUp={() => { isMouseDownRef.current = false; stopTx(); }}
            onMouseLeave={() => { if (isMouseDownRef.current) { isMouseDownRef.current = false; stopTx(); } }}
            className="w-full rounded-[2px] py-4 cursor-pointer select-none transition-all duration-50"
            style={faceStyle}
            title={`Push to Talk${vKeyEnabled ? ' (or hold V)' : ''}`}
          >
            <div className="flex flex-col items-center gap-1.5">
              {/* Center LED */}
              <div
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  background: ledColor,
                  boxShadow: `0 0 6px ${ledColor}`,
                  transition: 'all 50ms',
                }}
              />
              {/* Icon */}
              {state === 'tx' ? (
                <Mic className="w-5 h-5 text-[#d4a017]" />
              ) : muted ? (
                <MicOff className="w-5 h-5 text-[#555555]" />
              ) : (
                <Mic className="w-5 h-5 text-[#888888]" />
              )}
              {/* State label */}
              <span
                className="text-[9px] font-bold uppercase tracking-wide"
                style={{
                  color: state === 'tx' ? '#d4a017' : state === 'rx' ? '#22c55e' : '#666666',
                }}
              >
                {stateLabel}
              </span>
            </div>
          </button>
        </div>

        {/* Volume slider (vertical) */}
        <div className="flex flex-col items-center gap-1 w-8">
          <Volume2 className="w-3 h-3 text-[#666666] shrink-0" />
          <div className="flex-1 flex items-center justify-center relative" style={{ minHeight: 60 }}>
            <input
              type="range"
              min={0}
              max={100}
              value={volume}
              onChange={(e) => setVolume(Number(e.target.value))}
              className="radio-volume-slider"
              style={{
                width: 60,
                transform: 'rotate(-90deg)',
                transformOrigin: 'center center',
                accentColor: '#d4a017',
              }}
              title={`Volume: ${volume}%`}
            />
          </div>
          <span className="text-[8px] font-mono text-[#666666] tabular-nums">{volume}</span>
        </div>
      </div>

      {/* Mode buttons */}
      <div className="flex gap-1 mt-2">
        {[
          { label: 'MUTE', active: muted, onClick: () => setMuted((p) => !p) },
          { label: 'MON', active: monitor, onClick: () => setMonitor((p) => !p) },
          { label: 'V KEY', active: vKeyEnabled, onClick: () => setVKeyEnabled((p) => !p) },
        ].map((btn) => (
          <button
            key={btn.label}
            onClick={btn.onClick}
            className="flex-1 text-[8px] font-bold uppercase tracking-wide py-1 px-1 rounded-[2px] transition-all duration-150 border"
            style={{
              background: btn.active ? '#d4a017' : '#111111',
              color: btn.active ? '#000000' : '#666666',
              borderColor: btn.active ? '#d4a017' : '#333333',
            }}
          >
            {btn.label}
          </button>
        ))}
      </div>
    </div>
  );
}
