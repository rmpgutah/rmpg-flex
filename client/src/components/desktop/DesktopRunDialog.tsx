import React, { useState, useRef, useEffect } from 'react';
import { Terminal } from 'lucide-react';

const KNOWN_COMMANDS: Record<string, () => void> = {
  calc:             () => window.dispatchEvent(new CustomEvent('flexos:open-app', { detail: 'calc' })),
  calculator:       () => window.dispatchEvent(new CustomEvent('flexos:open-app', { detail: 'calc' })),
  notepad:          () => window.dispatchEvent(new CustomEvent('flexos:open-app', { detail: 'notepad' })),
  taskmgr:          () => window.dispatchEvent(new CustomEvent('flexos:open-app', { detail: 'task-manager' })),
  'task manager':   () => window.dispatchEvent(new CustomEvent('flexos:open-app', { detail: 'task-manager' })),
  settings:         () => window.dispatchEvent(new CustomEvent('flexos:open-app', { detail: 'settings' })),
  timer:            () => window.dispatchEvent(new CustomEvent('flexos:open-app', { detail: 'timer' })),
  stopwatch:        () => window.dispatchEvent(new CustomEvent('flexos:open-app', { detail: 'timer' })),
  converter:        () => window.dispatchEvent(new CustomEvent('flexos:open-app', { detail: 'converter' })),
  'unit converter': () => window.dispatchEvent(new CustomEvent('flexos:open-app', { detail: 'converter' })),
  eventviewer:      () => window.dispatchEvent(new CustomEvent('flexos:open-app', { detail: 'event-viewer' })),
  'event viewer':   () => window.dispatchEvent(new CustomEvent('flexos:open-app', { detail: 'event-viewer' })),
  files:            () => window.dispatchEvent(new CustomEvent('flexos:open-app', { detail: 'file-manager' })),
  'file manager':   () => window.dispatchEvent(new CustomEvent('flexos:open-app', { detail: 'file-manager' })),
  colorpicker:      () => window.dispatchEvent(new CustomEvent('flexos:open-app', { detail: 'color-picker' })),
  'color picker':   () => window.dispatchEvent(new CustomEvent('flexos:open-app', { detail: 'color-picker' })),
  dispatch:             () => window.dispatchEvent(new CustomEvent('flexos:open-app', { detail: 'dispatch' })),
  map:                  () => window.dispatchEvent(new CustomEvent('flexos:open-app', { detail: 'map' })),
  mdt:                  () => window.dispatchEvent(new CustomEvent('flexos:open-app', { detail: 'mdt' })),
  perfmon:              () => window.dispatchEvent(new CustomEvent('flexos:open-app', { detail: 'perfmon' })),
  perf:                 () => window.dispatchEvent(new CustomEvent('flexos:open-app', { detail: 'perfmon' })),
  'performance monitor':() => window.dispatchEvent(new CustomEvent('flexos:open-app', { detail: 'perfmon' })),
  network:              () => window.dispatchEvent(new CustomEvent('flexos:open-app', { detail: 'netdiag' })),
  netdiag:              () => window.dispatchEvent(new CustomEvent('flexos:open-app', { detail: 'netdiag' })),
  'network diagnostics':() => window.dispatchEvent(new CustomEvent('flexos:open-app', { detail: 'netdiag' })),
};

export default function DesktopRunDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [value, setValue] = useState('');
  const [error, setError] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setValue('');
      setError('');
      const t = setTimeout(() => inputRef.current?.focus(), 60);
      return () => clearTimeout(t);
    }
  }, [open]);

  function handleRun() {
    const cmd = value.trim().toLowerCase();
    const action = KNOWN_COMMANDS[cmd];
    if (action) {
      action();
      onClose();
    } else {
      const suggestions = Object.keys(KNOWN_COMMANDS).filter((_, i) => i < 5).join(', ');
      setError(`'${value.trim()}' was not recognized. Try: ${suggestions}…`);
    }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[9000] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-surface-raised border border-border-subtle rounded-sm shadow-2xl w-[400px] p-5 z-10">
        <div className="flex items-center gap-2.5 mb-3">
          <Terminal size={15} className="text-accent-silver-400 flex-shrink-0" />
          <span className="text-[13px] font-semibold" style={{ color: 'var(--panel-header-color)' }}>Run</span>
        </div>
        <p className="text-[11px] text-text-secondary mb-3">
          Type the name of a FlexOS app and press OK to open it.
        </p>
        <input
          ref={inputRef}
          className="w-full bg-surface-sunken border border-border-subtle rounded-sm px-2.5 py-1.5 text-[12px] text-text-primary outline-none focus:border-rmpg-400 mb-2 transition-colors"
          value={value}
          onChange={e => { setValue(e.target.value); setError(''); }}
          onKeyDown={e => {
            if (e.key === 'Enter') handleRun();
            if (e.key === 'Escape') onClose();
          }}
          placeholder="calc, notepad, dispatch, map, mdt…"
        />
        {error && <p className="text-[10px] text-red-400 mb-2 leading-tight">{error}</p>}
        <div className="flex justify-end gap-2 mt-1">
          <button
            className="px-3 py-1.5 text-[11px] bg-surface-base border border-border-subtle rounded-sm hover:bg-surface-hover text-text-secondary transition-colors"
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            className="px-3 py-1.5 text-[11px] bg-rmpg-600 hover:bg-rmpg-500 rounded-sm text-white transition-colors"
            onClick={handleRun}
          >
            OK
          </button>
        </div>
      </div>
    </div>
  );
}
