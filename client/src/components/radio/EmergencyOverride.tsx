import { useState, useEffect, useRef, useCallback } from 'react';
import { AlertTriangle } from 'lucide-react';
import { useWebSocket } from '../../context/WebSocketContext';

const LS_KEY = 'rmpg-emergency-talkgroup-active';
const HOLD_DURATION_MS = 2000;

interface EmergencyOverrideProps {
  onActivate?: () => void;
  onDeactivate?: () => void;
}

export default function EmergencyOverride({ onActivate, onDeactivate }: EmergencyOverrideProps) {
  const { send, subscribe } = useWebSocket();

  const [isActive, setIsActive] = useState(() => {
    try { return localStorage.getItem(LS_KEY) === 'true'; } catch { return false; }
  });

  const [holdProgress, setHoldProgress] = useState(0);
  const holdStartRef = useRef<number | null>(null);
  const rafRef = useRef<number | null>(null);
  const activatedRef = useRef(false);

  // Persist active state
  useEffect(() => {
    try { localStorage.setItem(LS_KEY, String(isActive)); } catch { /* ignore */ }
  }, [isActive]);

  // Subscribe to emergency WS events
  useEffect(() => {
    const unsub1 = subscribe('emergency_talkgroup_active', () => {
      setIsActive(true);
    });
    const unsub2 = subscribe('emergency_talkgroup_ended', () => {
      setIsActive(false);
    });
    return () => { unsub1(); unsub2(); };
  }, [subscribe]);

  const startHold = useCallback(() => {
    if (isActive) return; // Already active
    holdStartRef.current = Date.now();
    activatedRef.current = false;

    const animate = () => {
      if (holdStartRef.current === null) return;
      const elapsed = Date.now() - holdStartRef.current;
      const pct = Math.min(elapsed / HOLD_DURATION_MS, 1);
      setHoldProgress(pct);

      if (pct >= 1 && !activatedRef.current) {
        activatedRef.current = true;
        setIsActive(true);
        send({
          type: 'emergency_talkgroup_active',
          data: { activatedBy: 'current_user' },
        });
        onActivate?.();
        holdStartRef.current = null;
        setHoldProgress(0);
        return;
      }

      rafRef.current = requestAnimationFrame(animate);
    };

    rafRef.current = requestAnimationFrame(animate);
  }, [isActive, send, onActivate]);

  const endHold = useCallback(() => {
    holdStartRef.current = null;
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    setHoldProgress(0);
  }, []);

  const endEmergency = useCallback(() => {
    setIsActive(false);
    send({ type: 'emergency_talkgroup_ended', data: {} });
    onDeactivate?.();
  }, [send, onDeactivate]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  return (
    <div
      className="rounded-[2px] p-2"
      style={{
        background: '#0d0d0d',
        border: isActive ? '2px solid #dc2626' : '1px solid #222222',
      }}
    >
      <div className="text-[9px] font-semibold text-[#888888] uppercase tracking-[0.5px] mb-1.5">
        EMERGENCY
      </div>

      {isActive ? (
        <>
          {/* Active banner */}
          <div
            className="flex items-center justify-center gap-1.5 py-1.5 px-2 mb-2 rounded-[2px]"
            style={{
              background: 'repeating-linear-gradient(45deg, #991b1b, #991b1b 8px, #7f1d1d 8px, #7f1d1d 16px)',
            }}
          >
            <AlertTriangle className="w-3.5 h-3.5 text-[#fbbf24] shrink-0" />
            <span className="text-[10px] font-bold text-[#fbbf24] uppercase tracking-wide">
              EMERGENCY OVERRIDE ACTIVE
            </span>
          </div>

          <button
            onClick={endEmergency}
            className="w-full py-1.5 rounded-[2px] text-[9px] font-bold uppercase tracking-wide transition-colors border"
            style={{
              background: '#111111',
              color: '#dc2626',
              borderColor: '#dc2626',
            }}
          >
            END EMERGENCY
          </button>
        </>
      ) : (
        <>
          {/* Emergency activation button */}
          <div className="relative">
            <button
              onMouseDown={startHold}
              onMouseUp={endHold}
              onMouseLeave={endHold}
              onTouchStart={startHold}
              onTouchEnd={endHold}
              className="w-full py-3 rounded-[2px] cursor-pointer select-none relative overflow-hidden"
              style={{
                background: 'repeating-linear-gradient(45deg, #991b1b, #991b1b 8px, #7f1d1d 8px, #7f1d1d 16px)',
                boxShadow: 'inset 0 2px 4px rgba(0,0,0,0.5)',
                border: '1px solid #450a0a',
              }}
              title="Hold 2 seconds to activate Emergency Override"
            >
              {/* Hold progress bar */}
              {holdProgress > 0 && (
                <div
                  className="absolute left-0 bottom-0 h-1"
                  style={{
                    width: `${holdProgress * 100}%`,
                    background: '#fbbf24',
                    transition: 'width 50ms linear',
                  }}
                />
              )}
              <div className="flex flex-col items-center gap-1">
                <AlertTriangle className="w-5 h-5 text-[#fbbf24]" />
                <span className="text-[9px] font-bold text-[#fbbf24] uppercase tracking-wide">
                  HOLD TO ACTIVATE
                </span>
              </div>
            </button>
          </div>
          <div className="text-[8px] text-[#555555] text-center mt-1 italic">
            Hold for 2 seconds
          </div>
        </>
      )}
    </div>
  );
}
