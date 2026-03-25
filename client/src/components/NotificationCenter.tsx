// ============================================================
// RMPG Flex — Notification Center Dropdown
// Real-time notification bell with WebSocket integration
// ============================================================

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { Bell, Check, Trash2, Radio, Shield, AlertTriangle, Mail, Clock, MapPin, Filter, ChevronDown, ChevronUp, Loader2 } from 'lucide-react';
import { useWebSocket } from '../context/WebSocketContext';
import { apiFetch } from '../hooks/useApi';
import type { Notification, NotificationType } from '../types';

// ============================================================
// Types
// ============================================================

interface NotificationCenterProps {
  className?: string;
}

interface NotificationTypeConfig {
  icon: React.ElementType;
  ledColor: string;
  iconColor: string;
}

// ============================================================
// Notification Type → Icon / LED mapping
// ============================================================

const NOTIFICATION_TYPE_CONFIG: Record<NotificationType, NotificationTypeConfig> = {
  dispatch:          { icon: Radio,          ledColor: 'led-red',   iconColor: 'text-red-400' },
  warrant:           { icon: Shield,         ledColor: 'led-amber', iconColor: 'text-amber-400' },
  bolo:              { icon: AlertTriangle,  ledColor: 'led-red',   iconColor: 'text-red-400' },
  message:           { icon: Mail,           ledColor: 'led-green', iconColor: 'text-blue-400' },
  system:            { icon: Bell,           ledColor: 'led-green', iconColor: 'text-green-400' },
  credential_expiry: { icon: Clock,          ledColor: 'led-amber', iconColor: 'text-amber-400' },
  patrol_missed:     { icon: MapPin,         ledColor: 'led-red',   iconColor: 'text-red-400' },
};

// ============================================================
// Helpers
// ============================================================

function formatTimestamp(dateStr: string): string {
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return 'UNKNOWN';
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  const diffHr = Math.floor(diffMin / 60);

  if (diffMin < 1) return 'JUST NOW';
  if (diffMin < 60) return `${diffMin}m AGO`;
  if (diffHr < 24) return `${diffHr}h AGO`;

  return date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

// ============================================================
// Component
// ============================================================

// Notification type → route mapping for click-to-navigate
const NOTIFICATION_ROUTES: Record<string, string> = {
  dispatch: '/dispatch',
  warrant: '/warrants',
  bolo: '/communications',
  message: '/communications',
  system: '/',
  credential_expiry: '/personnel',
  patrol_missed: '/patrol',
};

export default function NotificationCenter({ className = '' }: NotificationCenterProps) {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [filterType, setFilterType] = useState<string>('all');
  const [showFilter, setShowFilter] = useState(false);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);

  const dropdownRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const { subscribe } = useWebSocket();
  const navigate = useNavigate();

  // ----------------------------------------------------------
  // Fetch unread count on mount
  // ----------------------------------------------------------
  useEffect(() => {
    let cancelled = false;

    async function fetchUnreadCount() {
      try {
        const data = await apiFetch<{ count: number }>('/notifications/unread-count');
        if (!cancelled) {
          setUnreadCount(data.count);
        }
      } catch {
        // Silently fail — status bar still works
      }
    }

    fetchUnreadCount();
    return () => { cancelled = true; };
  }, []);

  // ----------------------------------------------------------
  // Subscribe to real-time notifications via WebSocket
  // ----------------------------------------------------------
  useEffect(() => {
    const unsubscribe = subscribe('notification', (message) => {
      const incoming = message.data as Notification;
      setNotifications((prev) => [incoming, ...prev]);
      if (!incoming.is_read) {
        setUnreadCount((prev) => prev + 1);
      }
    });

    return unsubscribe;
  }, [subscribe]);

  // ----------------------------------------------------------
  // Fetch notifications when dropdown opens (reset to page 1)
  // ----------------------------------------------------------
  const fetchNotifications = useCallback(async (pageNum = 1, append = false) => {
    if (pageNum === 1) setIsLoading(true);
    else setLoadingMore(true);
    try {
      const params = new URLSearchParams({ per_page: '20', page: String(pageNum) });
      const data = await apiFetch<{ data: Notification[]; total?: number; page?: number; per_page?: number }>(`/notifications?${params.toString()}`);
      const items = data.data || [];
      if (append) {
        setNotifications((prev) => [...prev, ...items]);
      } else {
        setNotifications(items);
      }
      setHasMore(items.length >= 20);
      setPage(pageNum);
    } catch {
      // Keep existing notifications on error
    } finally {
      setIsLoading(false);
      setLoadingMore(false);
    }
  }, []);

  useEffect(() => {
    if (isOpen) {
      fetchNotifications(1, false);
    }
  }, [isOpen, fetchNotifications]);

  // Load more handler
  const handleLoadMore = useCallback(() => {
    if (!loadingMore && hasMore) {
      fetchNotifications(page + 1, true);
    }
  }, [loadingMore, hasMore, page, fetchNotifications]);

  // ----------------------------------------------------------
  // Click outside to close
  // ----------------------------------------------------------
  useEffect(() => {
    if (!isOpen) return;

    function handleClickOutside(e: MouseEvent) {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node) &&
        buttonRef.current &&
        !buttonRef.current.contains(e.target as Node)
      ) {
        setIsOpen(false);
      }
    }

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  // ----------------------------------------------------------
  // Escape key to close
  // ----------------------------------------------------------
  useEffect(() => {
    if (!isOpen) return;

    function handleEscape(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setIsOpen(false);
      }
    }

    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [isOpen]);

  // ----------------------------------------------------------
  // Mark all as read
  // ----------------------------------------------------------
  const handleMarkAllRead = useCallback(async () => {
    try {
      await apiFetch<void>('/notifications/mark-all-read', { method: 'POST' });
      setNotifications((prev) => prev.map((n) => ({ ...n, is_read: true })));
      setUnreadCount(0);
    } catch {
      // Silently fail
    }
  }, []);

  // ----------------------------------------------------------
  // Mark individual notification as read
  // ----------------------------------------------------------
  const handleMarkRead = useCallback(async (id: string) => {
    try {
      await apiFetch<void>(`/notifications/${id}/read`, { method: 'PUT' });
      setNotifications((prev) =>
        prev.map((n) => (n.id === id ? { ...n, is_read: true } : n))
      );
      setUnreadCount((prev) => Math.max(0, prev - 1));
    } catch {
      // Silently fail
    }
  }, []);

  // ----------------------------------------------------------
  // Dismiss (delete) individual notification
  // ----------------------------------------------------------
  const handleDismiss = useCallback(async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await apiFetch<void>(`/notifications/${id}`, { method: 'DELETE' });
      setNotifications((prev) => {
        const removed = prev.find((n) => n.id === id);
        if (removed && !removed.is_read) {
          setUnreadCount((c) => Math.max(0, c - 1));
        }
        return prev.filter((n) => n.id !== id);
      });
    } catch {
      // Silently fail
    }
  }, []);

  // ----------------------------------------------------------
  // Click on a notification row — mark read + navigate
  // ----------------------------------------------------------
  const handleNotificationClick = useCallback(
    (notification: Notification) => {
      if (!notification.is_read) {
        handleMarkRead(notification.id);
      }
      // Navigate to the relevant page based on notification type
      const route = NOTIFICATION_ROUTES[notification.type];
      if (route) {
        setIsOpen(false);
        navigate(route);
      }
    },
    [handleMarkRead, navigate]
  );

  // ----------------------------------------------------------
  // Toggle dropdown
  // ----------------------------------------------------------
  const toggleDropdown = useCallback(() => {
    setIsOpen((prev) => !prev);
  }, []);

  // ----------------------------------------------------------
  // Portal positioning — compute dropdown coords from button
  // ----------------------------------------------------------
  const [dropdownPos, setDropdownPos] = useState({ top: 0, left: 0 });

  useEffect(() => {
    if (!isOpen || !buttonRef.current) return;

    function updatePos() {
      const rect = buttonRef.current!.getBoundingClientRect();
      // Right-align dropdown beneath the bell button
      const dropdownWidth = 360;
      let left = rect.right - dropdownWidth;
      // Ensure it doesn't overflow off the left edge
      if (left < 4) left = 4;
      setDropdownPos({ top: rect.bottom + 4, left });
    }

    updatePos();
    window.addEventListener('resize', updatePos);
    window.addEventListener('scroll', updatePos, true);
    return () => {
      window.removeEventListener('resize', updatePos);
      window.removeEventListener('scroll', updatePos, true);
    };
  }, [isOpen]);

  // ----------------------------------------------------------
  // Render
  // ----------------------------------------------------------
  return (
    <div className={`relative ${className}`}>
      {/* Bell Button */}
      <button type="button"
        ref={buttonRef}
        onClick={toggleDropdown}
        className="toolbar-btn relative"
        title="Notifications"
        aria-label={`Notifications${unreadCount > 0 ? ` (${unreadCount} unread)` : ''}`}
        aria-expanded={isOpen}
        aria-haspopup="true"
      >
        <Bell className="w-4 h-4" aria-hidden="true" />
        {unreadCount > 0 && (
          <span
            className="absolute flex items-center justify-center"
            style={{
              top: 0,
              right: 0,
              transform: 'translate(40%, -40%)',
              minWidth: '16px',
              height: '16px',
              padding: '0 4px',
              background: '#1a5a9e',
              color: '#ffffff',
              fontSize: '9px',
              fontWeight: 700,
              lineHeight: 1,
              fontFamily: 'monospace',
            }}
          >
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {/* Dropdown Panel — rendered via portal to escape overflow containers */}
      {isOpen && createPortal(
        <div
          ref={dropdownRef}
          className="fixed z-50 panel-beveled animate-fade-in"
          style={{
            top: dropdownPos.top,
            left: dropdownPos.left,
            width: '360px',
            maxHeight: '400px',
            background: '#141e2b',
            display: 'flex',
            flexDirection: 'column',
            boxShadow: '0 8px 32px rgba(0, 0, 0, 0.6)',
          }}
        >
          {/* Title Bar */}
          <div className="panel-title-bar" style={{ flexShrink: 0 }}>
            <Bell className="title-icon" />
            <span>NOTIFICATIONS</span>
            <div className="ml-auto flex items-center gap-1">
              {/* Type Filter */}
              <div className="relative">
                <button type="button"
                  onClick={() => setShowFilter(!showFilter)}
                  className="toolbar-btn flex items-center gap-1"
                  title="Filter by type"
                  style={{ fontSize: '9px', padding: '2px 6px' }}
                >
                  <Filter className="w-3 h-3" />
                  {filterType !== 'all' && (
                    <span className="text-brand-400 uppercase">{filterType}</span>
                  )}
                </button>
                {showFilter && (
                  <div
                    className="absolute right-0 top-full mt-1 bg-surface-sunken border border-rmpg-600 z-50 shadow-lg"
                    style={{ minWidth: 140 }}
                  >
                    {['all', 'dispatch', 'warrant', 'bolo', 'message', 'system', 'credential_expiry', 'patrol_missed'].map((type) => (
                      <button type="button"
                        key={type}
                        onClick={() => { setFilterType(type); setShowFilter(false); }}
                        className={`block w-full text-left px-3 py-1.5 text-[10px] hover:bg-rmpg-700/50 transition-colors ${
                          filterType === type ? 'text-brand-400 font-bold' : 'text-rmpg-300'
                        }`}
                      >
                        {type === 'all' ? 'All Types' : type.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              {unreadCount > 0 && (
                <button type="button"
                  onClick={handleMarkAllRead}
                  className="toolbar-btn flex items-center gap-1"
                  title="Mark All Read"
                  style={{ fontSize: '9px', padding: '2px 6px' }}
                >
                  <Check className="w-3 h-3" />
                  <span>MARK ALL READ</span>
                </button>
              )}
            </div>
          </div>

          {/* 58: Notification list with dark scrollbar styling */}
          <div
            className="scrollbar-dark"
            style={{
              overflowY: 'auto',
              flex: 1,
            }}
          >
            {/* 59: Loading state with spinner icon */}
            {isLoading && notifications.length === 0 && (
              <div
                className="flex items-center justify-center gap-2 text-rmpg-400"
                style={{ padding: '32px 0', fontSize: '10px' }}
              >
                <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
                Loading notifications...
              </div>
            )}

            {/* 60: Empty notification state with softer icon and description */}
            {!isLoading && notifications.length === 0 && (
              <div
                className="flex flex-col items-center justify-center text-rmpg-400"
                style={{ padding: '32px 0' }}
              >
                <Bell className="w-6 h-6 mb-2 opacity-30" aria-hidden="true" />
                <span style={{ fontSize: '10px' }}>No notifications</span>
                <span className="text-rmpg-500" style={{ fontSize: '9px', marginTop: '2px' }}>You're all caught up</span>
              </div>
            )}

            {notifications
              .filter((n) => filterType === 'all' || n.type === filterType)
              .map((notification) => {
              const config =
                NOTIFICATION_TYPE_CONFIG[notification.type] || NOTIFICATION_TYPE_CONFIG.system;
              const Icon = config.icon;
              const route = NOTIFICATION_ROUTES[notification.type];

              return (
                <div
                  key={notification.id}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleNotificationClick(notification); } }}
                  onClick={() => handleNotificationClick(notification)}
                  className="group flex items-start gap-2 border-b border-rmpg-700/50 cursor-pointer transition-colors hover:bg-rmpg-800/60"
                  style={{
                    padding: '6px 8px',
                    background: notification.is_read ? '#141e2b' : '#1a2636',
                  }}
                  title={route ? `Click to go to ${notification.type.replace(/_/g, ' ')}` : undefined}
                >
                  {/* Type Icon + LED */}
                  <div className="flex-shrink-0 flex items-center gap-1" style={{ marginTop: '2px' }}>
                    <span className={`led-dot ${config.ledColor}`} />
                    <Icon className={`w-3.5 h-3.5 ${config.iconColor}`} />
                  </div>

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <div
                      className="text-rmpg-100 truncate"
                      style={{
                        fontSize: '10px',
                        fontWeight: 700,
                        lineHeight: '14px',
                      }}
                    >
                      {notification.title}
                    </div>
                    {notification.body && (
                      <div
                        className="text-rmpg-300 truncate"
                        style={{
                          fontSize: '9px',
                          lineHeight: '12px',
                          marginTop: '1px',
                        }}
                      >
                        {notification.body}
                      </div>
                    )}
                    <div
                      className="flex items-center gap-2"
                      style={{ marginTop: '2px' }}
                    >
                      <span
                        className="text-green-400"
                        style={{
                          fontSize: '9px',
                          fontFamily: 'monospace',
                          lineHeight: '12px',
                          opacity: 0.7,
                        }}
                      >
                        {formatTimestamp(notification.created_at)}
                      </span>
                      <span
                        className="text-rmpg-500 uppercase"
                        style={{ fontSize: '8px', fontWeight: 700, letterSpacing: '0.5px' }}
                      >
                        {notification.type.replace(/_/g, ' ')}
                      </span>
                    </div>
                  </div>

                  {/* Dismiss Button */}
                  {/* 61: Dismiss button visible on hover of parent row; 62: Red hover feedback */}
                  <button type="button"
                    onClick={(e) => handleDismiss(notification.id, e)}
                    className="toolbar-btn flex-shrink-0 opacity-0 group-hover:opacity-60 hover:!opacity-100 transition-all"
                    style={{
                      padding: '2px',
                      marginTop: '2px',
                    }}
                    title="Dismiss"
                    aria-label={`Dismiss notification: ${notification.title}`}
                  >
                    <Trash2 className="w-3 h-3 text-rmpg-400 hover:text-red-400 transition-colors" />
                  </button>
                </div>
              );
            })}

            {/* Load More */}
            {hasMore && notifications.length > 0 && (
              <button type="button"
                onClick={handleLoadMore}
                disabled={loadingMore}
                className="w-full py-2 text-center text-[10px] text-brand-400 hover:bg-rmpg-700/30 transition-colors font-bold uppercase tracking-wider"
              >
                {loadingMore ? 'Loading...' : 'Load Older Notifications'}
              </button>
            )}
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
