// ============================================================
// RMPG Flex — Detached Window Layout
// Minimal wrapper for secondary browser windows (no sidebar)
// ============================================================

import React, { type ReactNode } from 'react';
import { Printer, X } from 'lucide-react';

interface DetachedLayoutProps {
  title: string;
  subtitle?: string;
  children: ReactNode;
  actions?: ReactNode;
}

export default function DetachedLayout({ title, subtitle, children, actions }: DetachedLayoutProps) {
  return (
    <div className="min-h-screen bg-surface-deep text-white flex flex-col">
      {/* Header — Panel title bar style */}
      <header className="sticky top-0 z-50 print:hidden">
        <div className="panel-title-bar flex items-center gap-2">
          <div className="w-2 h-2 bg-brand-600 flex-shrink-0" />
          <span>{title.toUpperCase()}</span>
          {subtitle && <span className="text-[9px] text-rmpg-400 font-normal ml-1">— {subtitle}</span>}
          <div className="ml-auto flex items-center gap-1">
            {actions}
            <button
              onClick={() => window.print()}
              className="toolbar-btn"
              title="Print"
            >
              <Printer className="w-3 h-3" />
              Print
            </button>
            <div className="toolbar-separator" />
            <button
              onClick={() => window.close()}
              className="toolbar-btn hover:!bg-red-900/40"
              title="Close Window"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </header>

      {/* Content */}
      <main className="p-6 panel-inset flex-1">
        {children}
      </main>

      {/* Mini status bar */}
      <footer className="status-bar print:hidden">
        <div className="status-bar-section">
          <span className="led-dot led-green" />
          <span>RMPG FLEX</span>
        </div>
        <div className="status-bar-section border-r-0 ml-auto">
          <span>{title.toUpperCase()}</span>
        </div>
      </footer>

      {/* Print Styles */}
      <style>{`
        @media print {
          body { background: white !important; color: black !important; }
          .print\\:hidden { display: none !important; }
          main { padding: 0 !important; }
        }
      `}</style>
    </div>
  );
}
