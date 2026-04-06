// ============================================================
// RMPG Flex — Keyboard Shortcuts Help Modal
// Global shortcut reference triggered by "?" key
// ============================================================

import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X, Keyboard } from 'lucide-react';

interface ShortcutGroup {
  title: string;
  shortcuts: { keys: string[]; description: string }[];
}

const SHORTCUT_GROUPS: ShortcutGroup[] = [
  {
    title: 'Global',
    shortcuts: [
      { keys: ['Ctrl', 'K'], description: 'Open global search' },
      { keys: ['?'], description: 'Show keyboard shortcuts' },
      { keys: ['Esc'], description: 'Close modal / panel' },
    ],
  },
  {
    title: 'Page Navigation',
    shortcuts: [
      { keys: ['F1'], description: 'Dashboard' },
      { keys: ['F2'], description: 'Dispatch' },
      { keys: ['F3'], description: 'Map' },
      { keys: ['F4'], description: 'MDT' },
      { keys: ['F5'], description: 'NCIC' },
      { keys: ['F6'], description: 'Records' },
      { keys: ['F7'], description: 'Enforcement' },
      { keys: ['F8'], description: 'Personnel' },
      { keys: ['F9'], description: 'Comms' },
      { keys: ['F10'], description: 'Reports' },
      { keys: ['F11'], description: 'Audit' },
      { keys: ['F12'], description: 'Admin' },
    ],
  },
  {
    title: 'Dispatch',
    shortcuts: [
      { keys: ['N'], description: 'New call for service' },
      { keys: ['R'], description: 'Refresh call queue' },
      { keys: ['J'], description: 'Next call in queue' },
      { keys: ['K'], description: 'Previous call in queue' },
      { keys: ['D'], description: 'Dispatch selected call' },
      { keys: ['E'], description: 'Set unit enroute' },
      { keys: ['O'], description: 'Set unit on scene' },
      { keys: ['C'], description: 'Clear selected call' },
      { keys: ['1'], description: 'Filter: All calls' },
      { keys: ['2'], description: 'Filter: Pending' },
      { keys: ['3'], description: 'Filter: Active' },
      { keys: ['4'], description: 'Filter: Cleared' },
    ],
  },
  {
    title: 'Incidents',
    shortcuts: [
      { keys: ['N'], description: 'New incident report' },
      { keys: ['E'], description: 'Edit selected incident' },
      { keys: ['Esc'], description: 'Close detail panel' },
    ],
  },
];

export const KeyboardShortcuts: React.FC = () => {
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Only trigger on "?" (Shift+/) when not in an input
      if (
        e.key === '?' &&
        !e.ctrlKey &&
        !e.metaKey &&
        !e.altKey &&
        !(e.target instanceof HTMLInputElement) &&
        !(e.target instanceof HTMLTextAreaElement) &&
        !(e.target instanceof HTMLSelectElement)
      ) {
        e.preventDefault();
        setIsOpen((prev) => !prev);
      }
      if (e.key === 'Escape' && isOpen) {
        setIsOpen(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen]);

  if (!isOpen) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[9999] flex items-start justify-center pt-[15vh] bg-black/70 backdrop-blur-sm"
      onClick={() => setIsOpen(false)}
    >
      <div
        className="bg-surface-base border border-rmpg-600 shadow-2xl w-full max-w-2xl max-h-[65vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-rmpg-600">
          <div className="flex items-center gap-2">
            <Keyboard className="w-4 h-4 text-brand-400" />
            <h2 className="text-sm font-bold text-white uppercase tracking-wider">Keyboard Shortcuts</h2>
          </div>
          <button
            onClick={() => setIsOpen(false)}
            className="p-1 hover:bg-rmpg-700 text-rmpg-300 hover:text-white transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {SHORTCUT_GROUPS.map((group) => (
              <div key={group.title}>
                <h3 className="section-header-bordered">
                  {group.title}
                </h3>
                <div className="space-y-2">
                  {group.shortcuts.map((shortcut, i) => (
                    <div key={i} className="flex items-center justify-between text-sm">
                      <span className="text-rmpg-200">{shortcut.description}</span>
                      <div className="flex items-center gap-1">
                        {shortcut.keys.map((key, ki) => (
                          <React.Fragment key={ki}>
                            {ki > 0 && <span className="text-rmpg-500 text-xs">+</span>}
                            <kbd
                              className="px-2 py-0.5 text-xs font-mono font-bold bg-surface-sunken text-rmpg-200 border border-rmpg-600"
                              style={{ minWidth: '24px', textAlign: 'center' }}
                            >
                              {key}
                            </kbd>
                          </React.Fragment>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Footer */}
        <div className="px-4 py-2 border-t border-rmpg-600 text-center">
          <span className="text-micro text-rmpg-500">
            Press <kbd className="px-1 py-0.5 text-micro font-mono bg-surface-sunken text-rmpg-300 border border-rmpg-600">?</kbd> to toggle this panel
          </span>
        </div>
      </div>
    </div>,
    document.body
  );
};
