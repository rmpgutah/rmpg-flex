import { useEffect, useRef, useId } from 'react';
import { AlertTriangle, Info, X, Loader2 } from 'lucide-react';

interface ConfirmDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message: string;
  /** Optional rendered AFTER `message` — typically the row's identifying
   *  context (record number, name, capture timestamp, linked incident).
   *  Used by destructive flows so the operator sees what they are about
   *  to act on, not just a generic "delete this record?" string. */
  details?: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  confirmVariant?: 'danger' | 'warning' | 'default';
  isLoading?: boolean;
}

export default function ConfirmDialog({
  isOpen,
  onClose,
  onConfirm,
  title,
  message,
  details,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  confirmVariant = 'danger',
  isLoading = false,
}: ConfirmDialogProps) {
  const titleId = useId();
  const descId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);

  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const onConfirmRef = useRef(onConfirm);
  onConfirmRef.current = onConfirm;

  // Body scroll lock — prevent background scrolling when dialog is open
  useEffect(() => {
    if (isOpen) {
      const scrollY = window.scrollY;
      document.body.style.overflow = 'hidden';
      document.body.style.position = 'fixed';
      document.body.style.width = '100%';
      document.body.style.top = `-${scrollY}px`;
    }
    return () => {
      const scrollY = Math.abs(parseInt(document.body.style.top || '0'));
      document.body.style.overflow = '';
      document.body.style.position = '';
      document.body.style.width = '';
      document.body.style.top = '';
      if (scrollY > 0) window.scrollTo(0, scrollY);
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const dialog = dialogRef.current;
    if (!dialog) return;

    // Pick initial focus carefully. For danger variants the safe default
    // is the CANCEL button — that way a user reading the dialog who
    // hits Enter to dismiss the previous interaction confirms cancellation,
    // not destruction. For non-danger variants the confirm button is the
    // expected target. The previous version autofocused whichever
    // element came first in the DOM (the X close button) AND globally
    // bound Enter to onConfirm — so Enter on the X executed the
    // destructive action with no warning. Audit caught this.
    const raf = requestAnimationFrame(() => {
      const selector = confirmVariant === 'danger'
        ? '[data-confirm-cancel="true"]'
        : '[data-confirm-action="true"]';
      const preferred = dialog.querySelector<HTMLElement>(selector);
      if (preferred) { preferred.focus(); return; }
      // Fallback: first focusable (legacy behavior) if data hook didn't render.
      const focusable = dialog.querySelectorAll<HTMLElement>(
        'button:not([disabled]):not([tabindex="-1"]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      );
      if (focusable.length > 0) focusable[0].focus();
    });

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { onCloseRef.current(); return; }
      // Enter is intentionally NOT bound at the dialog level. Native
      // Enter-activates-focused-button is sufficient — Enter on the
      // Cancel button cancels; Enter on the Confirm button confirms.
      // Globally binding Enter caused the previous bug where Enter
      // anywhere in the dialog (including on the X close button) fired
      // the destructive action.
      if (e.key !== 'Tab') return;
      const focusable = dialog.querySelectorAll<HTMLElement>(
        'button:not([disabled]):not([tabindex="-1"]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      );
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey) {
        if (document.activeElement === first) { e.preventDefault(); last?.focus(); }
      } else {
        if (document.activeElement === last) { e.preventDefault(); first?.focus(); }
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener('keydown', handleKeyDown);
    };
    // The eslint-disable + manual deps mirror the first effect — we
    // intentionally re-run only when isOpen or confirmVariant changes so
    // the initial-focus selector picks the correct preferred button.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, confirmVariant]);

  if (!isOpen) return null;

  const confirmClass =
    confirmVariant === 'danger'
      ? 'bg-red-700 hover:bg-red-600 border-red-500 text-rmpg-100'
      : confirmVariant === 'warning'
        ? 'bg-amber-700 hover:bg-amber-600 border-amber-500 text-rmpg-100'
        : 'bg-brand-700 hover:bg-brand-600 border-brand-500 text-rmpg-100';

  const HeaderIcon = confirmVariant === 'default' ? Info : AlertTriangle;
  const iconColor = confirmVariant === 'danger' ? 'text-red-400' : confirmVariant === 'warning' ? 'text-amber-400' : 'text-brand-400';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" role="alertdialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={descId} ref={dialogRef} onClick={onClose} style={{ touchAction: 'manipulation' }}>
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" role="presentation" />
      <div className="relative w-full max-w-md mx-4 bg-surface-base border border-rmpg-600 shadow-md animate-scale-in" onClick={(e) => e.stopPropagation()}>
        <div
          className="flex items-center justify-between px-4 py-2 border-b border-rmpg-600"
          style={{ background: 'linear-gradient(180deg, var(--surface-raised) 0%, var(--surface-base) 100%)' }}
        >
          <div className="flex items-center gap-2">
            <HeaderIcon className={`w-4 h-4 ${iconColor}`} />
            <h2 id={titleId} className="text-xs font-bold text-rmpg-100 uppercase tracking-wider">{title}</h2>
          </div>
          <button type="button" onClick={onClose} className="p-2 sm:p-1 min-w-[44px] min-h-[44px] sm:min-w-0 sm:min-h-0 flex items-center justify-center hover:bg-rmpg-700 text-rmpg-400 hover:text-rmpg-100 transition-colors" style={{ touchAction: 'manipulation' }} aria-label="Close">
            <X className="w-5 h-5 sm:w-4 sm:h-4" />
          </button>
        </div>
        <div className="p-6">
          <p id={descId} className="text-sm text-rmpg-200 leading-relaxed">{message}</p>
          {details && (
            <div className="mt-3 pl-3 border-l-2 border-rmpg-600 text-xs text-rmpg-300 space-y-0.5">
              {details}
            </div>
          )}
          <div className="flex items-center justify-end gap-3 mt-6">
            <button type="button" onClick={onClose} className="toolbar-btn" disabled={isLoading} data-confirm-cancel="true">
              {cancelLabel}
            </button>
            <button
              type="button"
              onClick={onConfirm}
              disabled={isLoading}
              data-confirm-action="true"
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold uppercase tracking-wide border shadow-sm transition-colors ${confirmClass} disabled:opacity-50`}
            >
              {isLoading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              {confirmLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
