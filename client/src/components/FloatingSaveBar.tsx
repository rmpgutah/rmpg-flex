import React from 'react';
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
  if (!visible) return null;

  return (
    <div
      className="fixed bottom-8 left-1/2 -translate-x-1/2 z-[9990] flex items-center gap-2 px-4 py-2 shadow-2xl animate-slide-in-up"
      style={{
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
