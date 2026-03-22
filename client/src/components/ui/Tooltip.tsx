// ═══════════════════════════════════════════════════════════════
// Feature 24: Reusable Tooltip Component
// Shows on hover with configurable position
// ═══════════════════════════════════════════════════════════════
import React, { useState, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';

type TooltipPosition = 'top' | 'bottom' | 'left' | 'right';

interface TooltipProps {
  content: React.ReactNode;
  children: React.ReactNode;
  position?: TooltipPosition;
  delay?: number;
  className?: string;
}

export default function Tooltip({ content, children, position = 'top', delay = 300, className = '' }: TooltipProps) {
  const [visible, setVisible] = useState(false);
  const [coords, setCoords] = useState({ x: 0, y: 0 });
  const triggerRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout>>();

  const show = useCallback(() => {
    timerRef.current = setTimeout(() => {
      if (!triggerRef.current) return;
      const rect = triggerRef.current.getBoundingClientRect();
      let x = 0, y = 0;

      switch (position) {
        case 'top':
          x = rect.left + rect.width / 2;
          y = rect.top - 6;
          break;
        case 'bottom':
          x = rect.left + rect.width / 2;
          y = rect.bottom + 6;
          break;
        case 'left':
          x = rect.left - 6;
          y = rect.top + rect.height / 2;
          break;
        case 'right':
          x = rect.right + 6;
          y = rect.top + rect.height / 2;
          break;
      }

      setCoords({ x, y });
      setVisible(true);
    }, delay);
  }, [delay, position]);

  const hide = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setVisible(false);
  }, []);

  const positionStyles: Record<TooltipPosition, React.CSSProperties> = {
    top: { left: coords.x, top: coords.y, transform: 'translate(-50%, -100%)' },
    bottom: { left: coords.x, top: coords.y, transform: 'translate(-50%, 0)' },
    left: { left: coords.x, top: coords.y, transform: 'translate(-100%, -50%)' },
    right: { left: coords.x, top: coords.y, transform: 'translate(0, -50%)' },
  };

  return (
    <>
      <div
        ref={triggerRef}
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
        className="inline-flex"
      >
        {children}
      </div>
      {visible && createPortal(
        <div
          className={`fixed z-[9999] pointer-events-none px-2 py-1 text-[10px] font-medium text-rmpg-100 bg-surface-base border border-[#2a3e58] shadow-lg max-w-xs ${className}`}
          style={positionStyles[position]}
        >
          {content}
        </div>,
        document.body
      )}
    </>
  );
}
