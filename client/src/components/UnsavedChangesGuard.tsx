import { useEffect, useCallback } from 'react';
import { useBlocker } from 'react-router-dom';
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
 * Intercepts both browser close/refresh (beforeunload) and
 * react-router route navigation (useBlocker).
 *
 * Usage:
 *   <UnsavedChangesGuard hasUnsavedChanges={isDirty} />
 */
export default function UnsavedChangesGuard({
  hasUnsavedChanges,
  title = 'Unsaved Changes',
  message = 'You have unsaved changes. Are you sure you want to leave? Your changes will be lost.',
}: UnsavedChangesGuardProps) {
  // ── Browser close / refresh guard ──────────────────────────
  useEffect(() => {
    if (!hasUnsavedChanges) return;

    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      // Modern browsers ignore custom text, but setting returnValue is required
      e.returnValue = '';
    };

    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [hasUnsavedChanges]);

  // ── React Router navigation guard ─────────────────────────
  const blocker = useBlocker(
    useCallback(
      () => hasUnsavedChanges,
      [hasUnsavedChanges],
    ),
  );

  if (blocker.state !== 'blocked') return null;

  return (
    <ConfirmDialog
      isOpen
      title={title}
      message={message}
      confirmLabel="Discard"
      cancelLabel="Stay"
      confirmVariant="warning"
      onConfirm={() => blocker.proceed()}
      onClose={() => blocker.reset()}
    />
  );
}
