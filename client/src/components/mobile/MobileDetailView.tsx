// ============================================================
// RMPG Flex — Mobile Detail View
// Full-screen overlay that slides in from the right, replacing
// the desktop split-panel right side on mobile devices.
// Retro CAD header with back navigation and action menu.
// ============================================================

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { ArrowLeft, MoreVertical, X } from 'lucide-react';

// ─── Types ────────────────────────────────────────────────────
interface ActionItem {
  label: string;
  icon?: React.ElementType;
  onClick: () => void;
  danger?: boolean;
}

interface MobileDetailViewProps {
  /** Whether the detail view is open */
  open: boolean;
  /** Called to close the detail view (e.g., back button, swipe) */
  onClose: () => void;
  /** Title shown in the header bar */
  title: string;
  /** Optional subtitle below title */
  subtitle?: string;
  /** Optional actions in the overflow menu (⋮) */
  actions?: ActionItem[];
  /** The detail content */
  children: React.ReactNode;
  /** Optional footer content (e.g., action buttons) */
  footer?: React.ReactNode;
}

// ─── Swipe-back threshold ────────────────────────────────────
const SWIPE_THRESHOLD = 80; // px from left edge to trigger close

// ─── Component ───────────────────────────────────────────────
export default function MobileDetailView({
  open,
  onClose,
  title,
  subtitle,
  actions,
  children,
  footer,
}: MobileDetailViewProps) {
  const [visible, setVisible] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  // Swipe-back state
  const touchStartX = useRef(0);
  const touchStartY = useRef(0);
  const [swipeX, setSwipeX] = useState(0);
  const [isSwiping, setIsSwiping] = useState(false);

  // ── Open/close animation ───────────────────────────────────
  useEffect(() => {
    if (open) {
      // Mount then animate in
      requestAnimationFrame(() => {
        requestAnimationFrame(() => setVisible(true));
      });
      // Lock body scroll
      document.body.style.overflow = 'hidden';
    } else {
      setVisible(false);
      setMenuOpen(false);
      // Restore scroll after transition
      const timer = setTimeout(() => {
        document.body.style.overflow = '';
      }, 300);
      return () => clearTimeout(timer);
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [open]);

  // ── Swipe-back gesture ─────────────────────────────────────
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    const x = e.touches[0].clientX;
    // Only activate if touch starts within 30px of left edge
    if (x <= 30) {
      touchStartX.current = x;
      touchStartY.current = e.touches[0].clientY;
      setIsSwiping(true);
    }
  }, []);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (!isSwiping) return;
    const dx = e.touches[0].clientX - touchStartX.current;
    const dy = Math.abs(e.touches[0].clientY - touchStartY.current);

    // If vertical movement dominates, cancel swipe
    if (dy > dx && dx < 20) {
      setIsSwiping(false);
      setSwipeX(0);
      return;
    }

    if (dx > 0) {
      setSwipeX(dx);
    }
  }, [isSwiping]);

  const handleTouchEnd = useCallback(() => {
    if (!isSwiping) return;
    if (swipeX >= SWIPE_THRESHOLD) {
      onClose();
    }
    setSwipeX(0);
    setIsSwiping(false);
  }, [isSwiping, swipeX, onClose]);

  // ── Hardware back button (Android) ─────────────────────────
  useEffect(() => {
    if (!open) return;
    const handlePopState = () => {
      onClose();
    };
    // Push a dummy state so back button pops it
    window.history.pushState({ mobileDetail: true }, '');
    window.addEventListener('popstate', handlePopState);
    return () => {
      window.removeEventListener('popstate', handlePopState);
    };
  }, [open, onClose]);

  if (!open && !visible) return null;

  const translateX = isSwiping ? swipeX : visible ? 0 : window.innerWidth;

  return (
    <div
      className="fixed inset-0 z-50"
      style={{
        // Dim backdrop based on swipe distance
        background: `rgba(0,0,0,${0.5 * (1 - swipeX / (window.innerWidth || 1))})`,
        transition: isSwiping ? 'none' : 'background 0.3s ease',
        pointerEvents: open ? 'auto' : 'none',
      }}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
    >
      <div
        className="absolute inset-0 flex flex-col"
        style={{
          background: '#0d1520',
          transform: `translateX(${translateX}px)`,
          transition: isSwiping ? 'none' : 'transform 0.3s cubic-bezier(0.32,0.72,0,1)',
          willChange: 'transform',
        }}
      >
        {/* ── Header ──────────────────────────────────────── */}
        <div
          className="flex items-center justify-between flex-shrink-0 relative"
          style={{
            height: 48,
            paddingLeft: 4,
            paddingRight: 8,
            background: 'linear-gradient(180deg, #162236 0%, #141e2b 100%)',
            borderBottom: '1px solid #1e3048',
          }}
        >
          {/* Crimson accent */}
          <div
            className="absolute top-0 left-0 right-0 h-[2px]"
            style={{
              background: 'linear-gradient(90deg, #0f3460, #1a5a9e, #0f3460)',
              zIndex: 1,
            }}
          />

          {/* Back button + title */}
          <div className="flex items-center gap-1 min-w-0 flex-1">
            <button
              onClick={onClose}
              className="flex items-center justify-center w-10 h-10"
              style={{ color: '#c0d0e0' }}
              aria-label="Go back"
            >
              <ArrowLeft style={{ width: 20, height: 20 }} />
            </button>

            <div className="min-w-0 flex-1">
              <div className="text-[12px] font-mono font-bold tracking-wider text-rmpg-200 truncate">
                {title.toUpperCase()}
              </div>
              {subtitle && (
                <div className="text-[10px] font-mono text-rmpg-400 truncate">
                  {subtitle}
                </div>
              )}
            </div>
          </div>

          {/* Actions overflow (⋮) */}
          {actions && actions.length > 0 && (
            <div className="relative">
              <button
                onClick={() => setMenuOpen((v) => !v)}
                className="flex items-center justify-center w-10 h-10"
                style={{ color: '#c0d0e0' }}
                aria-label="More actions"
              >
                <MoreVertical style={{ width: 20, height: 20 }} />
              </button>

              {/* Dropdown menu */}
              {menuOpen && (
                <>
                  {/* Tap-away overlay */}
                  <div
                    className="fixed inset-0 z-40"
                    onClick={() => setMenuOpen(false)}
                  />
                  <div
                    className="absolute right-0 top-full mt-1 z-50 py-1 min-w-[180px]"
                    style={{
                      background: '#222',
                      border: '1px solid #2a3e58',
                      boxShadow: '0 8px 24px rgba(0,0,0,0.6)',
                    }}
                  >
                    {actions.map((action, i) => {
                      const Icon = action.icon;
                      return (
                        <button
                          key={i}
                          onClick={() => {
                            setMenuOpen(false);
                            action.onClick();
                          }}
                          className="flex items-center gap-2 w-full px-4 py-3 text-left text-sm font-mono hover:bg-rmpg-700 transition-colors"
                          style={{
                            color: action.danger ? '#ef4444' : '#c0d0e0',
                            minHeight: 44,
                          }}
                        >
                          {Icon && <Icon style={{ width: 16, height: 16 }} />}
                          {action.label}
                        </button>
                      );
                    })}
                  </div>
                </>
              )}
            </div>
          )}
        </div>

        {/* ── Scrollable Content ──────────────────────────── */}
        <div
          className="flex-1 overflow-y-auto overflow-x-hidden"
          style={{ WebkitOverflowScrolling: 'touch' }}
        >
          {children}
        </div>

        {/* ── Optional Footer ─────────────────────────────── */}
        {footer && (
          <div
            className="flex-shrink-0"
            style={{
              borderTop: '1px solid #1e3048',
              background: '#141e2b',
              paddingBottom: 'env(safe-area-inset-bottom)',
            }}
          >
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
