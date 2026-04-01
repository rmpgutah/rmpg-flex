// ============================================================
// RMPG Flex — Resizable Split Panel
// Draggable divider with persistent ratios and collapsible panels
// Mobile: switches to tab-based layout for phone screens
// ============================================================

import React, { useState, useRef, useCallback, useEffect } from 'react';
import { useIsMobile } from '../hooks/useIsMobile';

interface SplitPanelProps {
  left: React.ReactNode;
  right: React.ReactNode;
  direction?: 'horizontal' | 'vertical';
  initialRatio?: number;         // 0-1, default 0.4
  minLeftPx?: number;            // default 250
  minRightPx?: number;           // default 300
  rightVisible?: boolean;        // controls slide-in/out
  persistKey?: string;           // localStorage key for saved ratio
  dividerClassName?: string;
  className?: string;
  /** Label for left panel tab on mobile (default: "List") */
  leftLabel?: string;
  /** Label for right panel tab on mobile (default: "Detail") */
  rightLabel?: string;
}

export default function SplitPanel({
  left,
  right,
  direction = 'horizontal',
  initialRatio = 0.4,
  minLeftPx = 250,
  minRightPx = 300,
  rightVisible = true,
  persistKey,
  dividerClassName = '',
  className = '',
  leftLabel = 'List',
  rightLabel = 'Detail',
}: SplitPanelProps) {
  const isMobile = useIsMobile();
  const [mobileTab, setMobileTab] = useState<'left' | 'right'>('left');

  // Load persisted ratio or use initial
  const [ratio, setRatio] = useState(() => {
    if (persistKey) {
      try {
        const stored = localStorage.getItem(`rmpg-split-${persistKey}`);
        if (stored) {
          const parsed = parseFloat(stored);
          if (!isNaN(parsed) && parsed > 0 && parsed < 1) return parsed;
        }
      } catch { /* silent */ }
    }
    return initialRatio;
  });

  const [isDragging, setIsDragging] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Persist ratio changes
  useEffect(() => {
    if (persistKey) {
      try {
        localStorage.setItem(`rmpg-split-${persistKey}`, String(ratio));
      } catch { /* silent */ }
    }
  }, [ratio, persistKey]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (!containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const isHorizontal = direction === 'horizontal';
      const totalSize = isHorizontal ? rect.width : rect.height;
      const mousePos = isHorizontal ? e.clientX - rect.left : e.clientY - rect.top;

      // Clamp ratio based on min widths
      const minRatio = minLeftPx / totalSize;
      const maxRatio = 1 - (minRightPx / totalSize);
      const newRatio = Math.max(minRatio, Math.min(maxRatio, mousePos / totalSize));
      setRatio(newRatio);
    };

    const handleMouseUp = () => {
      setIsDragging(false);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    // Prevent text selection while dragging
    document.body.style.userSelect = 'none';
    document.body.style.cursor = direction === 'horizontal' ? 'col-resize' : 'row-resize';

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
    };
  }, [isDragging, direction, minLeftPx, minRightPx]);

  const isHorizontal = direction === 'horizontal';

  // ============================================================
  // MOBILE LAYOUT — Tab-based switching between panels
  // ============================================================
  if (isMobile) {
    return (
      <div className={`flex flex-col h-full ${className}`}>
        {/* Tab bar */}
        {rightVisible && (
          <div
            className="flex flex-shrink-0"
            style={{
              background: 'linear-gradient(180deg, #1e3048 0%, #1a2636 100%)',
              borderBottom: '1px solid #141e2b',
            }}
          >
            <button type="button"
              onClick={() => setMobileTab('left')}
              className="flex-1 py-2.5 text-xs font-bold uppercase tracking-wider text-center transition-colors"
              style={{
                background: mobileTab === 'left' ? 'rgba(26, 90, 158, 0.2)' : 'transparent',
                color: mobileTab === 'left' ? '#fff' : '#7a8a9a',
                borderBottom: mobileTab === 'left' ? '2px solid #1a5a9e' : '2px solid transparent',
              }}
            >
              {leftLabel}
            </button>
            <button type="button"
              onClick={() => setMobileTab('right')}
              className="flex-1 py-2.5 text-xs font-bold uppercase tracking-wider text-center transition-colors"
              style={{
                background: mobileTab === 'right' ? 'rgba(26, 90, 158, 0.2)' : 'transparent',
                color: mobileTab === 'right' ? '#fff' : '#7a8a9a',
                borderBottom: mobileTab === 'right' ? '2px solid #1a5a9e' : '2px solid transparent',
              }}
            >
              {rightLabel}
            </button>
          </div>
        )}

        {/* Active panel content */}
        <div className="flex-1 overflow-hidden min-h-0">
          {(!rightVisible || mobileTab === 'left') && (
            <div className="h-full overflow-auto">{left}</div>
          )}
          {rightVisible && mobileTab === 'right' && (
            <div className="h-full overflow-auto">{right}</div>
          )}
        </div>
      </div>
    );
  }

  // ============================================================
  // DESKTOP LAYOUT — Side-by-side with draggable divider
  // ============================================================
  return (
    <div
      ref={containerRef}
      className={`flex ${isHorizontal ? 'flex-row' : 'flex-col'} h-full ${className}`}
    >
      {/* Left / Top Panel */}
      <div
        className="overflow-hidden"
        style={{
          [isHorizontal ? 'width' : 'height']: rightVisible ? `${ratio * 100}%` : '100%',
          transition: isDragging ? 'none' : 'width 0.2s ease, height 0.2s ease',
          flexShrink: 0,
        }}
      >
        {left}
      </div>

      {/* Draggable Divider */}
      {rightVisible && (
        <div
          role="separator"
          aria-orientation={isHorizontal ? 'vertical' : 'horizontal'}
          className={`flex-shrink-0 ${dividerClassName}`}
          style={{
            [isHorizontal ? 'width' : 'height']: '4px',
            cursor: isHorizontal ? 'col-resize' : 'row-resize',
            background: isDragging ? '#1a5a9e' : 'linear-gradient(90deg, #162236, #2a3e58, #162236)',
            borderTop: '1px solid #3a5070',
            borderBottom: '1px solid #141e2b',
            transition: isDragging ? 'none' : 'background 0.15s ease',
          }}
          onMouseDown={handleMouseDown}
          onTouchStart={(e) => { e.preventDefault(); handleMouseDown(e.touches[0] as any); }}
          onMouseEnter={(e) => {
            if (!isDragging) (e.currentTarget as HTMLElement).style.background = 'linear-gradient(90deg, #2a3e58, #3a5070, #2a3e58)';
          }}
          onMouseLeave={(e) => {
            if (!isDragging) (e.currentTarget as HTMLElement).style.background = 'linear-gradient(90deg, #162236, #2a3e58, #162236)';
          }}
        />
      )}

      {/* Right / Bottom Panel */}
      {rightVisible && (
        <div
          className="overflow-hidden flex-1 min-w-0 min-h-0"
          style={{
            transition: isDragging ? 'none' : 'opacity 0.2s ease',
          }}
        >
          {right}
        </div>
      )}
    </div>
  );
}
