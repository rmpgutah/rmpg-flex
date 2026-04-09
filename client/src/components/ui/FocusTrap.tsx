// ═══════════════════════════════════════════════════════════════
// Feature 20: Modal Focus Trap
// Traps keyboard focus inside modals for accessibility
// ═══════════════════════════════════════════════════════════════
import React, { useRef, useEffect, useCallback } from 'react';

interface FocusTrapProps {
  children: React.ReactNode;
  active?: boolean;
  restoreFocusOnDeactivate?: boolean;
}

const FOCUSABLE_SELECTOR = [
  'a[href]', 'button:not([disabled])', 'textarea:not([disabled])',
  'input:not([disabled])', 'select:not([disabled])', '[tabindex]:not([tabindex="-1"])',
].join(', ');

export default function FocusTrap({ children, active = true, restoreFocusOnDeactivate = true }: FocusTrapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!active) return;
    previousFocusRef.current = document.activeElement as HTMLElement;

    // Focus first focusable element
    const container = containerRef.current;
    if (container) {
      const firstFocusable = container.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
      if (firstFocusable) {
        requestAnimationFrame(() => firstFocusable.focus());
      }
    }

    return () => {
      if (restoreFocusOnDeactivate && previousFocusRef.current) {
        previousFocusRef.current.focus();
      }
    };
  }, [active, restoreFocusOnDeactivate]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (!active || e.key !== 'Tab') return;

    const container = containerRef.current;
    if (!container) return;

    const focusableElements = Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
    if (focusableElements.length === 0) return;

    const first = focusableElements[0];
    const last = focusableElements[focusableElements.length - 1];

    if (e.shiftKey) {
      if (document.activeElement === first) {
        e.preventDefault();
        last.focus();
      }
    } else {
      if (document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  }, [active]);

  return (
    <div ref={containerRef} onKeyDown={handleKeyDown}>
      {children}
    </div>
  );
}
