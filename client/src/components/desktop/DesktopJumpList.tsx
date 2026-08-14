import React, { useEffect, useRef } from 'react';
import { Pin, PinOff, X, Clock } from 'lucide-react';
import { getRecentApps } from '../../utils/recentApps';
import type { PinnedAction } from '../../data/taskbarPinnedActions';

interface DesktopJumpListProps {
  appKey: string;
  appLabel: string;
  x: number;
  y: number;
  pinnedActions?: PinnedAction[];
  isPinned: boolean;
  isRunning: boolean;
  onPin: () => void;
  onUnpin: () => void;
  onCloseWindow?: () => void;
  onDismiss: () => void;
}

export default function DesktopJumpList({
  appKey, appLabel, x, y, pinnedActions = [], isPinned, isRunning,
  onPin, onUnpin, onCloseWindow, onDismiss,
}: DesktopJumpListProps) {
  const ref = useRef<HTMLDivElement>(null);
  const recents = getRecentApps(appKey);

  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onDismiss();
    }
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [onDismiss]);

  // Clamp so menu stays on screen
  const clampedX = Math.min(x, window.innerWidth - 224);
  const clampedY = Math.min(y, window.innerHeight - 320);

  function Item({ label, onClick, icon }: { label: string; onClick: () => void; icon?: React.ReactNode }) {
    return (
      <button
        className="w-full flex items-center gap-2 px-3 py-1.5 text-[11px] text-text-primary hover:bg-surface-hover transition-colors text-left"
        onClick={() => { onClick(); onDismiss(); }}
      >
        {icon && <span className="text-text-muted w-3.5 flex-shrink-0 flex items-center">{icon}</span>}
        {label}
      </button>
    );
  }

  function SectionLabel({ label }: { label: string }) {
    return (
      <div className="px-3 pt-2 pb-0.5 text-[9px] uppercase tracking-widest" style={{ color: 'var(--field-label-color)' }}>
        {label}
      </div>
    );
  }

  function Divider() {
    return <div className="border-t border-border-subtle my-1" />;
  }

  function handleAction(action: PinnedAction) {
    if (action.event) window.dispatchEvent(new Event(action.event));
    else if (action.route) window.dispatchEvent(new CustomEvent('flexos:navigate', { detail: action.route }));
  }

  return (
    <div
      ref={ref}
      className="fixed z-[9500] bg-surface-raised border border-border-subtle rounded-sm shadow-2xl w-56 py-1 overflow-hidden"
      style={{ left: clampedX, top: clampedY }}
    >
      <div className="px-3 py-2 text-[12px] font-semibold text-text-primary border-b border-border-subtle">
        {appLabel}
      </div>

      {pinnedActions.length > 0 && (
        <>
          <SectionLabel label="Actions" />
          {pinnedActions.map(a => (
            <Item key={a.label} label={a.label} onClick={() => handleAction(a)} />
          ))}
          <Divider />
        </>
      )}

      {recents.length > 0 && (
        <>
          <SectionLabel label="Recent" />
          {recents.map(r => (
            <Item
              key={r.route}
              label={r.label}
              onClick={() => window.dispatchEvent(new CustomEvent('flexos:navigate', { detail: r.route }))}
              icon={<Clock size={11} />}
            />
          ))}
          <Divider />
        </>
      )}

      {isPinned
        ? <Item label="Unpin from taskbar" onClick={onUnpin} icon={<PinOff size={11} />} />
        : <Item label="Pin to taskbar"     onClick={onPin}   icon={<Pin size={11} />} />
      }
      {isRunning && onCloseWindow && (
        <Item label="Close window" onClick={onCloseWindow} icon={<X size={11} />} />
      )}
    </div>
  );
}
