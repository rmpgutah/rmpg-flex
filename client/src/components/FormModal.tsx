import React, { useEffect, useRef, useId } from 'react';
import { X, Loader2 } from 'lucide-react';

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
}: FormModalProps) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);

  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

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
      if (e.key === 'Escape') { onCloseRef.current(); return; }
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
    <div className="fixed inset-0 z-50 flex items-center justify-center" role="dialog" aria-modal="true" aria-labelledby={titleId} ref={dialogRef}>
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className={`relative w-full ${maxWidth} mx-4 shadow-2xl animate-fade-in panel-beveled`} style={{ background: '#1a1a1a' }}>
        <div className="panel-title-bar">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2" style={{ background: '#bc1010' }} />
            {Icon && <Icon className="title-icon" />}
            <span id={titleId}>{title}</span>
          </div>
          <div className="ml-auto flex items-center gap-1">
            {/* Decorative window buttons */}
            <button type="button" className="toolbar-btn" style={{ padding: '1px 4px', fontSize: '9px' }} tabIndex={-1}>_</button>
            <button type="button" className="toolbar-btn" style={{ padding: '1px 4px', fontSize: '9px' }} tabIndex={-1}>□</button>
            <button
              onClick={onClose}
              className="toolbar-btn"
              style={{ padding: '1px 4px' }}
              onMouseEnter={(e) => { e.currentTarget.style.background = '#a00e0e'; e.currentTarget.style.color = '#ffffff'; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = ''; e.currentTarget.style.color = ''; }}
            >
              <X style={{ width: 10, height: 10 }} />
            </button>
          </div>
        </div>
        <form onSubmit={onSubmit} className="p-6 space-y-4 max-h-[70vh] overflow-y-auto">
          {children}
          <div className="flex items-center justify-end gap-2 pt-4" style={{ borderTop: '1px solid #303030' }}>
            <button type="button" onClick={onClose} className="toolbar-btn" disabled={isSubmitting}>
              Cancel
            </button>
            <button type="submit" className="toolbar-btn toolbar-btn-primary" disabled={isSubmitting}>
              {isSubmitting && <Loader2 style={{ width: 10, height: 10 }} className="animate-spin" />}
              {submitLabel}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
