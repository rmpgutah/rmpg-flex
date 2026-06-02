// ═══════════════════════════════════════════════════════════════
// Reusable context-menu item builders
// ───────────────────────────────────────────────────────────────
// useMenuActions() returns pre-bound builders (clipboard + toast +
// router already wired) so a page can assemble a right-click menu in
// a few lines instead of re-implementing copy/navigate/toast each time:
//
//   const m = useMenuActions();
//   openMenu(e, [
//     m.go('Open record', `/persons/${p.id}`, <Eye size={12} />),
//     m.copy('Copy name', p.name),
//     m.separator(),
//     m.copyId(p.id),
//   ]);
// ═══════════════════════════════════════════════════════════════
import React, { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Copy, Hash, ExternalLink, MapPin } from 'lucide-react';
import { useToast } from '../components/ToastProvider';
import type { ContextMenuItem } from '../context/ContextMenuContext';

/** Clipboard write with a non-HTTPS / older-browser fallback. */
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      return true;
    } catch {
      return false;
    }
  }
}

/** A separator item — handy as `m.separator()` while composing arrays. */
export const separator = (): ContextMenuItem => ({ separator: true });
/** A non-interactive section header. */
export const header = (label: string): ContextMenuItem => ({ header: true, label });

export interface MenuActions {
  /** Copy an arbitrary string and toast confirmation. */
  copy: (label: string, value: string | number | null | undefined, icon?: React.ReactNode) => ContextMenuItem;
  /** Copy an identifier ("Copy ID"). Disabled when empty. */
  copyId: (value: string | number | null | undefined, label?: string) => ContextMenuItem;
  /** Copy "lat, lng" to 6dp. Disabled when coords missing. */
  copyCoords: (lat: number | null | undefined, lng: number | null | undefined) => ContextMenuItem;
  /** Navigate within the SPA (react-router). */
  go: (label: string, path: string, icon?: React.ReactNode) => ContextMenuItem;
  /** Open a URL in a new tab. */
  openExternal: (label: string, url: string, icon?: React.ReactNode) => ContextMenuItem;
  /** Run an arbitrary callback as a menu item. */
  action: (
    label: string,
    onClick: () => void,
    opts?: { icon?: React.ReactNode; danger?: boolean; disabled?: boolean; hint?: string; keepOpen?: boolean },
  ) => ContextMenuItem;
  separator: () => ContextMenuItem;
  header: (label: string) => ContextMenuItem;
}

/**
 * Pre-bound context-menu item builders for the current page.
 * Wires clipboard feedback (toast) and router navigation once.
 */
export function useMenuActions(): MenuActions {
  const { addToast } = useToast();
  const navigate = useNavigate();

  const isEmpty = (v: unknown) =>
    v === null || v === undefined || v === '' ||
    (typeof v === 'string' && /^(none|n\/a|null|undefined)$/i.test(v.trim()));

  const copy = useCallback<MenuActions['copy']>((label, value, icon) => ({
    label,
    icon: icon ?? <Copy size={12} />,
    disabled: isEmpty(value),
    onClick: async () => {
      const ok = await copyToClipboard(String(value));
      addToast(ok ? `${label.replace(/^copy\s*/i, '') || 'Value'} copied`.trim() : 'Copy failed', ok ? 'success' : 'error');
    },
  }), [addToast]);

  const copyId = useCallback<MenuActions['copyId']>((value, label = 'Copy ID') => ({
    label,
    icon: <Hash size={12} />,
    disabled: isEmpty(value),
    onClick: async () => {
      const ok = await copyToClipboard(String(value));
      addToast(ok ? 'ID copied' : 'Copy failed', ok ? 'success' : 'error');
    },
  }), [addToast]);

  const copyCoords = useCallback<MenuActions['copyCoords']>((lat, lng) => {
    const hasCoords = typeof lat === 'number' && typeof lng === 'number' && !Number.isNaN(lat) && !Number.isNaN(lng);
    return {
      label: 'Copy coordinates',
      icon: <MapPin size={12} />,
      disabled: !hasCoords,
      onClick: async () => {
        const ok = await copyToClipboard(`${lat!.toFixed(6)}, ${lng!.toFixed(6)}`);
        addToast(ok ? 'Coordinates copied' : 'Copy failed', ok ? 'success' : 'error');
      },
    };
  }, [addToast]);

  const go = useCallback<MenuActions['go']>((label, path, icon) => ({
    label,
    icon,
    onClick: () => navigate(path),
  }), [navigate]);

  const openExternal = useCallback<MenuActions['openExternal']>((label, url, icon) => ({
    label,
    icon: icon ?? <ExternalLink size={12} />,
    onClick: () => window.open(url, '_blank', 'noopener,noreferrer'),
  }), []);

  const action = useCallback<MenuActions['action']>((label, onClick, opts) => ({
    label,
    onClick,
    icon: opts?.icon,
    danger: opts?.danger,
    disabled: opts?.disabled,
    hint: opts?.hint,
    keepOpen: opts?.keepOpen,
  }), []);

  return { copy, copyId, copyCoords, go, openExternal, action, separator, header };
}
