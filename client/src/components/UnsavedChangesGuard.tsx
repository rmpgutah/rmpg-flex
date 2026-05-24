import { useEffect, useState, useCallback } from 'react';
import ConfirmDialog from './ConfirmDialog';

interface UnsavedChangesGuardProps {
  /** Whether there are unsaved changes to protect. */
  hasUnsavedChanges: boolean;
  /** Optional custom dialog title. */
  title?: string;
  /** Optional custom dialog message. */
  message?: string;
}

/**
 * Warns users before navigating away when there are unsaved changes.
 * Uses beforeunload for browser close/refresh and a history-based
 * navigation guard for SPA route changes (does not require a data router).
 *
 * Usage:
 *   <UnsavedChangesGuard hasUnsavedChanges={isDirty} />
 */
export default function UnsavedChangesGuard({
  hasUnsavedChanges,
  title = 'Unsaved Changes',
  message = 'You have unsaved changes. Are you sure you want to leave? Your changes will be lost.',
}: UnsavedChangesGuardProps) {
  const [showDialog, setShowDialog] = useState(false);
  const [pendingNav, setPendingNav] = useState<(() => void) | null>(null);

  // ── Browser close / refresh guard ──────────────────────────
  useEffect(() => {
    if (!hasUnsavedChanges) return;

    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };

    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [hasUnsavedChanges]);

  // ── SPA navigation guard (history-based, no data router needed) ──
  useEffect(() => {
    if (!hasUnsavedChanges) return;

    const handleClick = (e: MouseEvent) => {
      const link = (e.target as HTMLElement).closest('a');
      if (!link || !link.href) return;
      if (link.target === '_blank' || link.href.startsWith('mailto:') || link.href.startsWith('tel:')) return;
      const currentOrigin = window.location.origin;
      if (!link.href.startsWith(currentOrigin)) return;
      if (link.href === window.location.href) return;

      e.preventDefault();
      setPendingNav(() => () => { window.location.href = link.href; });
      setShowDialog(true);
    };

    document.addEventListener('click', handleClick, true);
    return () => document.removeEventListener('click', handleClick, true);
  }, [hasUnsavedChanges]);

  const handleDiscard = useCallback(() => {
    setShowDialog(false);
    if (pendingNav) pendingNav();
    setPendingNav(null);
  }, [pendingNav]);

  const handleStay = useCallback(() => {
    setShowDialog(false);
    setPendingNav(null);
  }, []);

  if (!showDialog) return null;

  return (
    <ConfirmDialog
      isOpen
      title={title}
      message={message}
      confirmLabel="Discard"
      cancelLabel="Stay"
      confirmVariant="warning"
      onConfirm={handleDiscard}
      onClose={handleStay}
    />
  );
}
