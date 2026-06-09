// ============================================================
// useNavHotkeys — keyboard shortcuts for Drive Mode (Toughbook-friendly)
//
// Registers a single window keydown listener mapping single-key presses to
// Drive Mode actions. Suppressed while the user is typing into an input,
// textarea, select, or contenteditable so destination-search typing never
// toggles layers.
//
// Keys:
//   F = fullscreen   C = crime   T = traffic/crash   B = trail
//   A = alerts       / = search  N = north-up        Esc = close
//
// Self-contained: defines its own handler map type + focus guard.
// ============================================================

import { useEffect, useRef } from 'react';

export interface NavHotkeyHandlers {
  fullscreen?: () => void;
  crime?: () => void;
  traffic?: () => void;
  trail?: () => void;
  alerts?: () => void;
  search?: () => void;
  northUp?: () => void;
  close?: () => void;
}

export interface UseNavHotkeysOptions {
  enabled?: boolean;
}

function isTypingTarget(el: EventTarget | null): boolean {
  if (!el || !(el instanceof HTMLElement)) return false;
  const tag = el.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (el.isContentEditable) return true;
  return false;
}

export function useNavHotkeys(
  handlers: NavHotkeyHandlers,
  options: UseNavHotkeysOptions = {},
): void {
  const { enabled = true } = options;
  // Keep latest handlers in a ref so the listener never goes stale and we
  // don't re-bind on every render.
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  useEffect(() => {
    if (!enabled || typeof window === 'undefined') return;

    const onKeyDown = (e: KeyboardEvent) => {
      // Don't hijack typing, and let OS/browser combos through.
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (isTypingTarget(e.target)) return;

      const h = handlersRef.current;
      let fn: (() => void) | undefined;

      if (e.key === 'Escape') {
        fn = h.close;
      } else if (e.key === '/') {
        fn = h.search;
      } else {
        switch (e.key.toLowerCase()) {
          case 'f': fn = h.fullscreen; break;
          case 'c': fn = h.crime; break;
          case 't': fn = h.traffic; break;
          case 'b': fn = h.trail; break;
          case 'a': fn = h.alerts; break;
          case 'n': fn = h.northUp; break;
          default: fn = undefined;
        }
      }

      if (fn) {
        e.preventDefault();
        fn();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [enabled]);
}

export default useNavHotkeys;
