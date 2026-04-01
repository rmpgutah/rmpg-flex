import React, { useEffect, useCallback, useRef } from 'react';
import { Save, X, Loader2 } from 'lucide-react';

interface FloatingSaveBarProps {
  visible: boolean;
  onSave: () => void;
  onCancel: () => void;
  isSaving?: boolean;
  saveLabel?: string;
  /** Extra buttons to render between save and cancel */
  extraActions?: React.ReactNode;
}

export default function FloatingSaveBar({
  visible,
  onSave,
  onCancel,
  isSaving = false,
  saveLabel = 'Save',
  extraActions,
}: FloatingSaveBarProps) {
  const onSaveRef = useRef(onSave);
  onSaveRef.current = onSave;
  const onCancelRef = useRef(onCancel);
  onCancelRef.current = onCancel;

  // Ctrl+S keyboard shortcut to save, Escape to cancel
  useEffect(() => {
    if (!visible) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        if (!isSaving) onSaveRef.current();
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        if (!isSaving) onCancelRef.current();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [visible, isSaving]);

  if (!visible) return null;

  return (
    <div
      className="fixed left-1/2 -translate-x-1/2 z-[9990] flex items-center gap-2 px-4 py-2 shadow-2xl animate-slide-in-up"
      style={{
        bottom: 'max(2rem, env(safe-area-inset-bottom, 2rem))',
        background: 'linear-gradient(180deg, #1e3048 0%, #141e2b 100%)',
        border: '1px solid #3a5070',
        borderTop: '2px solid #1a5a9e',
        boxShadow: '0 8px 32px rgba(0,0,0,0.6), 0 0 0 1px rgba(26,90,158,0.2)',
      }}
    >
      <div className="flex items-center gap-1.5 mr-2">
        <span className="led-dot led-amber animate-led-blink" />
        <span className="text-[10px] font-bold font-mono uppercase tracking-wider text-amber-400">
          EDITING
        </span>
      </div>

      <button type="button"
        onClick={onSave}
        disabled={isSaving}
        className="toolbar-btn toolbar-btn-primary"
        style={{ padding: '4px 12px' }}
      >
        {isSaving ? (
          <Loader2 style={{ width: 12, height: 12 }} className="animate-spin" />
        ) : (
          <Save style={{ width: 12, height: 12 }} />
        )}
        {saveLabel}
      </button>

      {extraActions}

      <button type="button"
        onClick={onCancel}
        disabled={isSaving}
        className="toolbar-btn"
        style={{ padding: '4px 12px' }}
      >
        <X style={{ width: 12, height: 12 }} />
        Cancel
      </button>
    </div>
  );
}
