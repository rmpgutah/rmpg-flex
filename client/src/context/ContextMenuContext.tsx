// ═══════════════════════════════════════════════════════════════
// Global right-click context-menu system
// ───────────────────────────────────────────────────────────────
// A single menu instance lives at the app root and is opened
// imperatively from anywhere via useContextMenu().openMenu(e, items).
// This mirrors the ToastProvider pattern (createContext + hook +
// createPortal) so there is exactly ONE menu in the DOM regardless of
// how many surfaces wire it in.
//
// Why imperative instead of a <ContextMenu> wrapper component?
//   • Works inside <table> rows (you can't wrap a <tr> in a <div>).
//   • Works on Mapbox marker elements, list items, canvas, anything.
//   • No per-row React subtree / portal — cheap at CAD-scale lists.
// ═══════════════════════════════════════════════════════════════
import React, {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
} from 'react';
import { createPortal } from 'react-dom';
import { ChevronRight } from 'lucide-react';

// ── Public item shape ─────────────────────────────────────────
export interface ContextMenuItem {
  /** Stable key; falls back to index when omitted. */
  key?: string;
  /** Visible label. Omit for separators. */
  label?: React.ReactNode;
  /** Leading icon (lucide element or any node). */
  icon?: React.ReactNode;
  /** Action to run when chosen. Omit for headers/separators/submenus. */
  onClick?: () => void;
  /** Greyed-out, non-interactive. */
  disabled?: boolean;
  /** Renders red — destructive actions (delete, purge). */
  danger?: boolean;
  /** Horizontal divider. All other fields ignored. */
  separator?: boolean;
  /** Non-interactive section label (uppercase, muted). */
  header?: boolean;
  /** Right-aligned hint text (e.g. keyboard shortcut, count). */
  hint?: string;
  /** Nested submenu — opens to the side on hover / ArrowRight. */
  submenu?: ContextMenuItem[];
  /** Keep the menu open after clicking (toggles, multi-select). */
  keepOpen?: boolean;
}

/** Items can be a static array or a thunk (deferred build at click time). */
export type ContextMenuItems = ContextMenuItem[] | (() => ContextMenuItem[]);

interface MenuState {
  x: number;
  y: number;
  items: ContextMenuItem[];
}

interface ContextMenuContextValue {
  /** Open the menu at the event's cursor with the given items. */
  openMenu: (
    e: React.MouseEvent | MouseEvent | { clientX: number; clientY: number },
    items: ContextMenuItems,
  ) => void;
  /** Close any open menu. */
  closeMenu: () => void;
  /** True while a menu is visible. */
  isOpen: boolean;
}

const ContextMenuContext = createContext<ContextMenuContextValue | undefined>(undefined);

// No-op fallback so any component (pages or shared primitives like
// DataTable) can call the hook even when rendered outside the provider
// — e.g. unit tests / storybook that mount a single page bare. In the
// real app the provider is always mounted at the root (App.tsx), so the
// fallback only triggers in those harnesses, where right-click is a
// no-op rather than a crash.
const NOOP_MENU: ContextMenuContextValue = {
  openMenu: () => {},
  closeMenu: () => {},
  isOpen: false,
};

let warnedNoProvider = false;

/**
 * Access the global context menu. Typical usage:
 *   const { openMenu } = useContextMenu();
 *   <tr onContextMenu={(e) => openMenu(e, buildRowMenu(row))} />
 *
 * Falls back to a no-op (with a one-time dev warning) when no provider
 * is mounted, so page-level tests that render a page in isolation don't
 * crash on the right-click wiring.
 */
export const useContextMenu = (): ContextMenuContextValue => {
  const ctx = useContext(ContextMenuContext);
  if (!ctx) {
    const isTest = typeof import.meta !== 'undefined' && (import.meta.env?.MODE === 'test' || !!import.meta.env?.VITEST);
    if (!warnedNoProvider && typeof import.meta !== 'undefined' && import.meta.env?.DEV && !isTest) {
      warnedNoProvider = true;
      // eslint-disable-next-line no-console
      console.warn('useContextMenu used outside a ContextMenuProvider — right-click menus are inert here.');
    }
    return NOOP_MENU;
  }
  return ctx;
};

/** Explicit no-throw accessor (kept for call sites that prefer it). */
export const useContextMenuSafe = (): ContextMenuContextValue =>
  useContext(ContextMenuContext) ?? NOOP_MENU;

// Estimated row height for first-paint clamp; refined after measure.
const EST_ROW_H = 28;
const MENU_MIN_W = 200;

// ── A single menu level (recursive for submenus) ──────────────
interface MenuLevelProps {
  items: ContextMenuItem[];
  /** Close the entire menu (after an action runs). */
  onCloseAll: () => void;
  /** Close just this level and refocus the parent item (ArrowLeft / Esc). */
  onCloseLevel?: () => void;
  autoFocus?: boolean;
}

function MenuLevel({ items, onCloseAll, onCloseLevel, autoFocus }: MenuLevelProps) {
  const listRef = useRef<HTMLDivElement>(null);
  const [openSub, setOpenSub] = useState<number | null>(null);

  // Indices that can receive focus (skip separators/headers/disabled).
  const focusable = items
    .map((it, i) => ((it.separator || it.header || it.disabled) ? -1 : i))
    .filter((i) => i >= 0);

  useEffect(() => {
    if (!autoFocus || focusable.length === 0) return;
    const first = listRef.current?.querySelector<HTMLButtonElement>('[data-cm-item]');
    first?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoFocus]);

  const focusByIndex = (idx: number) => {
    const btn = listRef.current?.querySelector<HTMLButtonElement>(`[data-cm-index="${idx}"]`);
    btn?.focus();
  };

  const moveFocus = (dir: 1 | -1, fromIdx: number) => {
    if (focusable.length === 0) return;
    const pos = focusable.indexOf(fromIdx);
    const next = pos === -1
      ? (dir === 1 ? focusable[0] : focusable[focusable.length - 1])
      : focusable[(pos + dir + focusable.length) % focusable.length];
    focusByIndex(next);
  };

  const select = (item: ContextMenuItem) => {
    if (item.disabled || item.separator || item.header) return;
    if (item.submenu && item.submenu.length) return; // handled by hover/ArrowRight
    item.onClick?.();
    if (!item.keepOpen) onCloseAll();
  };

  return (
    <div
      ref={listRef}
      role="menu"
      className="cm-menu py-1 min-w-[200px] rounded-sm overflow-visible"
      style={{
        background: 'var(--surface-base)',
        border: '1px solid var(--border-default)',
        boxShadow: '0 8px 24px rgba(0 0 0 / 0.6), 0 0 1px rgba(255,255,255,0.05) inset',
        WebkitBackdropFilter: 'blur(8px)',
        backdropFilter: 'blur(8px)',
      }}
      onKeyDown={(e) => {
        const active = document.activeElement as HTMLElement | null;
        const idx = active?.dataset.cmIndex ? parseInt(active.dataset.cmIndex, 10) : -1;
        if (e.key === 'ArrowDown') { e.preventDefault(); moveFocus(1, idx); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); moveFocus(-1, idx); }
        else if (e.key === 'Escape') {
          e.preventDefault(); e.stopPropagation();
          if (onCloseLevel) onCloseLevel(); else onCloseAll();
        } else if (e.key === 'ArrowLeft' && onCloseLevel) {
          e.preventDefault(); e.stopPropagation(); onCloseLevel();
        } else if (e.key === 'ArrowRight') {
          const it = items[idx];
          if (it?.submenu?.length) { e.preventDefault(); setOpenSub(idx); }
        }
      }}
    >
      {items.map((item, i) => {
        const itemKey = item.key ?? `cm-${i}`;
        if (item.separator) {
          return <div key={itemKey} role="separator" className="border-t border-border-default my-1" />;
        }
        if (item.header) {
          return (
            <div
              key={itemKey}
              className="px-3 pt-1.5 pb-1 text-[9px] font-semibold uppercase tracking-wide text-fg-muted select-none"
            >
              {item.label}
            </div>
          );
        }
        const hasSub = !!(item.submenu && item.submenu.length);
        return (
          <div
            key={itemKey}
            className="relative"
            onMouseEnter={() => hasSub && setOpenSub(i)}
            onMouseLeave={() => hasSub && setOpenSub((cur) => (cur === i ? null : cur))}
          >
            <button
              type="button"
              role="menuitem"
              data-cm-item
              data-cm-index={i}
              tabIndex={-1}
              aria-haspopup={hasSub || undefined}
              aria-expanded={hasSub ? openSub === i : undefined}
              disabled={item.disabled}
              onClick={() => (hasSub ? setOpenSub((c) => (c === i ? null : i)) : select(item))}
              className={`
                w-full text-left pl-3 pr-2 py-1.5 text-[11px] flex items-center gap-2
                outline-none transition-colors duration-100
                ${item.disabled
                  ? 'text-fg-muted cursor-not-allowed'
                  : item.danger
                    ? 'text-red-400 hover:bg-red-900/25 focus:bg-red-900/25'
                    : 'text-rmpg-200 hover:bg-rmpg-700 hover:text-rmpg-100 focus:bg-rmpg-700 focus:text-rmpg-100'}
              `}
            >
              {item.icon !== undefined && (
                <span className="w-3.5 h-3.5 flex items-center justify-center shrink-0">{item.icon}</span>
              )}
              <span className="min-w-0 flex-1 truncate">{item.label}</span>
              {item.hint && <span className="text-[9px] text-fg-muted ml-2 shrink-0">{item.hint}</span>}
              {hasSub && <ChevronRight size={12} className="ml-1 shrink-0 text-fg-muted" />}
            </button>
            {hasSub && openSub === i && (
              <Submenu>
                <MenuLevel
                  items={item.submenu!}
                  onCloseAll={onCloseAll}
                  onCloseLevel={() => { setOpenSub(null); focusByIndex(i); }}
                  autoFocus
                />
              </Submenu>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Submenu positioner — flips to the left / shifts up if clipped ──
function Submenu({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [side, setSide] = useState<'right' | 'left'>('right');
  const [shiftY, setShiftY] = useState(0);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    if (r.right > window.innerWidth - 4) setSide('left');
    if (r.bottom > window.innerHeight - 4) {
      setShiftY(-(r.bottom - (window.innerHeight - 4)));
    }
  }, []);

  return (
    <div
      ref={ref}
      className="absolute top-0 z-10"
      style={{
        [side === 'right' ? 'left' : 'right']: '100%',
        marginTop: shiftY,
        [side === 'right' ? 'marginLeft' : 'marginRight']: 2,
      } as React.CSSProperties}
    >
      {children}
    </div>
  );
}

// ── Provider ──────────────────────────────────────────────────
export function ContextMenuProvider({ children }: { children: React.ReactNode }) {
  const [menu, setMenu] = useState<MenuState | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });

  const closeMenu = useCallback(() => setMenu(null), []);

  const openMenu = useCallback<ContextMenuContextValue['openMenu']>((e, items) => {
    if ('preventDefault' in e && typeof e.preventDefault === 'function') {
      e.preventDefault();
      if ('stopPropagation' in e) e.stopPropagation();
    }
    const resolved = typeof items === 'function' ? items() : items;
    if (!resolved || resolved.length === 0) return;
    setMenu({ x: e.clientX, y: e.clientY, items: resolved });
  }, []);

  // First-paint position estimate (clamped to viewport with row estimate).
  useLayoutEffect(() => {
    if (!menu) return;
    const estH = menu.items.length * EST_ROW_H + 12;
    setPos({
      x: Math.min(menu.x, window.innerWidth - MENU_MIN_W - 4),
      y: Math.min(menu.y, Math.max(4, window.innerHeight - estH - 4)),
    });
  }, [menu]);

  // Refine after the menu has measured its real size.
  useLayoutEffect(() => {
    if (!menu) return;
    const el = rootRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    let { x, y } = { x: menu.x, y: menu.y };
    if (x + r.width > window.innerWidth - 4) x = Math.max(4, window.innerWidth - r.width - 4);
    if (y + r.height > window.innerHeight - 4) y = Math.max(4, window.innerHeight - r.height - 4);
    setPos((cur) => (cur.x === x && cur.y === y ? cur : { x, y }));
  }, [menu]);

  // Dismiss handlers — attached only while open.
  useEffect(() => {
    if (!menu) return;
    const onPointerDown = (ev: PointerEvent) => {
      if (rootRef.current?.contains(ev.target as Node)) return; // click inside menu
      closeMenu();
    };
    const onScroll = (ev: Event) => {
      if (rootRef.current?.contains(ev.target as Node)) return; // scrolling inside menu
      closeMenu();
    };
    const onBlur = () => closeMenu();
    // Capture phase so we beat the element's own onContextMenu re-open.
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', closeMenu);
    window.addEventListener('blur', onBlur);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', closeMenu);
      window.removeEventListener('blur', onBlur);
    };
  }, [menu, closeMenu]);

  return (
    <ContextMenuContext.Provider value={{ openMenu, closeMenu, isOpen: !!menu }}>
      {children}
      {menu && createPortal(
        <div
          ref={rootRef}
          className="fixed z-[10000] animate-in"
          style={{ left: pos.x, top: pos.y }}
          // Right-clicking the menu itself shouldn't open the native menu.
          onContextMenu={(e) => e.preventDefault()}
        >
          <MenuLevel items={menu.items} onCloseAll={closeMenu} autoFocus />
        </div>,
        document.body,
      )}
    </ContextMenuContext.Provider>
  );
}
