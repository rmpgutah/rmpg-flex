import React, { useEffect, useRef, useId, useState, useCallback } from 'react';
import { X, Loader2, AlertTriangle } from 'lucide-react';
import { useUnsavedChanges } from '../hooks/useUnsavedChanges';

interface FormModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (e: React.FormEvent) => void;
  title: string;
  icon?: React.ElementType;
  submitLabel?: string;
  isSubmitting?: boolean;
  maxWidth?: string;
  children: React.ReactNode;
  /** When true, closing the modal triggers a "Discard changes?" confirmation. */
  isDirty?: boolean;
}

export default function FormModal({
  isOpen,
  onClose,
  onSubmit,
  title,
  icon: Icon,
  submitLabel = 'Save',
  isSubmitting = false,
  maxWidth = 'max-w-2xl',
  children,
  isDirty = false,
}: FormModalProps) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const [showDiscardConfirm, setShowDiscardConfirm] = useState(false);

  // Browser-level "are you sure?" on page unload / refresh when form has unsaved data
  useUnsavedChanges(isOpen && isDirty);

  // Guarded close: intercept close attempts when form is dirty
  const guardedClose = useCallback(() => {
    if (isDirty) {
      setShowDiscardConfirm(true);
    } else {
      onClose();
    }
  }, [isDirty, onClose]);

  const handleConfirmDiscard = useCallback(() => {
    setShowDiscardConfirm(false);
    onClose();
  }, [onClose]);

  const handleCancelDiscard = useCallback(() => {
    setShowDiscardConfirm(false);
  }, []);

  // Keep guardedClose ref current for the Escape handler
  const guardedCloseRef = useRef(guardedClose);
  guardedCloseRef.current = guardedClose;

  // Reset discard dialog when modal closes
  useEffect(() => {
    if (!isOpen) setShowDiscardConfirm(false);
  }, [isOpen]);

  // Focus trap: keep focus within the modal — only run on open/close transitions
  useEffect(() => {
    if (!isOpen) return;
    const dialog = dialogRef.current;
    if (!dialog) return;

    // Small delay to let React finish rendering children before querying focusable elements
    const raf = requestAnimationFrame(() => {
      const focusable = dialog.querySelectorAll<HTMLElement>(
        'button:not([disabled]):not([tabindex="-1"]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      );
      if (focusable.length > 0) focusable[0].focus();
    });

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { guardedCloseRef.current(); return; }
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
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" role="dialog" aria-modal="true" aria-labelledby={titleId} ref={dialogRef} onClick={guardedClose} style={{ touchAction: 'manipulation' }}>
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" role="presentation" />
      <div className={`relative w-full ${maxWidth} mx-4 shadow-2xl animate-scale-in panel-beveled`} style={{ background: '#141e2b' }} onClick={(e) => e.stopPropagation()}>
        <div className="panel-title-bar">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2" style={{ background: '#1a5a9e' }} />
            {Icon && <Icon className="title-icon" />}
            <span id={titleId}>{title}</span>
            {isDirty && (
              <span className="text-[8px] text-amber-400 font-bold uppercase tracking-wider ml-1">UNSAVED</span>
            )}
          </div>
          <div className="ml-auto flex items-center gap-1">
            {/* Decorative window buttons */}
            <button type="button" className="toolbar-btn" style={{ padding: '1px 4px', fontSize: '9px' }} tabIndex={-1}>_</button>
            <button type="button" className="toolbar-btn" style={{ padding: '1px 4px', fontSize: '9px' }} tabIndex={-1}>□</button>
            <button type="button"
              onClick={guardedClose}
              className="toolbar-btn min-w-[44px] min-h-[44px] sm:min-w-0 sm:min-h-0 flex items-center justify-center"
              style={{ padding: '1px 4px', touchAction: 'manipulation' }}
              onMouseEnter={(e) => { e.currentTarget.style.background = '#164d87'; e.currentTarget.style.color = '#ffffff'; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = ''; e.currentTarget.style.color = ''; }}
              aria-label="Close"
            >
              <X className="w-4 h-4 sm:w-2.5 sm:h-2.5" />
            </button>
          </div>
        </div>
        <form onSubmit={onSubmit} noValidate className="p-6 space-y-4 max-h-[70vh] overflow-y-auto">
          {children}
          <div className="flex items-center justify-end gap-3 pt-4 mt-2" style={{ borderTop: '1px solid #1e3048' }}>
            <button type="button" onClick={guardedClose} className="toolbar-btn" disabled={isSubmitting} style={{ padding: '4px 12px' }}>
              Cancel
            </button>
            <button type="submit" className="toolbar-btn toolbar-btn-primary" disabled={isSubmitting} style={{ padding: '4px 12px' }}>
              {isSubmitting && <Loader2 style={{ width: 10, height: 10 }} className="animate-spin" />}
              {submitLabel}
            </button>
          </div>
        </form>
      </div>

      {/* ── Discard Confirmation Overlay ──────────────────── */}
      {showDiscardConfirm && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center" onClick={handleCancelDiscard} style={{ touchAction: 'manipulation' }}>
          <div className="absolute inset-0 bg-black/50" role="presentation" />
          <div className="relative w-full max-w-sm mx-4 bg-surface-base border border-rmpg-600 shadow-2xl animate-scale-in" onClick={(e) => e.stopPropagation()}>
            <div
              className="flex items-center justify-between px-4 py-2 border-b border-rmpg-600"
              style={{ background: 'linear-gradient(180deg, #1a2636 0%, #141e2b 100%)' }}
            >
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-400" />
                <h2 className="text-xs font-bold text-white uppercase tracking-wider">Unsaved Changes</h2>
              </div>
            </div>
            <div className="p-5">
              <p className="text-sm text-rmpg-200 leading-relaxed">
                You have unsaved changes. Are you sure you want to close this form? All entered data will be lost.
              </p>
              <div className="flex items-center justify-end gap-3 mt-5">
                <button
                  type="button"
                  onClick={handleCancelDiscard}
                  className="toolbar-btn"
                >
                  Keep Editing
                </button>
                <button
                  type="button"
                  onClick={handleConfirmDiscard}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold uppercase tracking-wide border shadow-sm bg-red-700 hover:bg-red-600 border-red-500 text-white transition-colors"
                >
                  Discard Changes
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
