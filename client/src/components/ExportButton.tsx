// ============================================================
// RMPG Flex — Export Button (Toolbar Dropdown)
// Toolbar button with dropdown for CSV export and print view
// ============================================================

import React, { useState, useRef, useEffect } from 'react';
import { Download, Printer, ChevronDown } from 'lucide-react';

interface ExportButtonProps {
  exportUrl: string;        // e.g. '/dispatch/calls/export?format=csv'
  exportFilename: string;   // e.g. 'calls_export.csv'
  onPrint?: () => void;     // optional print handler, defaults to window.print()
}

export default function ExportButton({
  exportUrl,
  exportFilename,
  onPrint,
}: ExportButtonProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  // Close dropdown on click outside
  useEffect(() => {
    if (!isOpen) return;

    function handleClickOutside(e: MouseEvent) {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node) &&
        buttonRef.current &&
        !buttonRef.current.contains(e.target as Node)
      ) {
        setIsOpen(false);
      }
    }

    function handleEscape(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setIsOpen(false);
      }
    }

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [isOpen]);

  async function handleExportCSV() {
    setIsExporting(true);
    setIsOpen(false);

    try {
      const token = localStorage.getItem('rmpg_token');
      const headers: Record<string, string> = {};
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }

      const url = exportUrl.startsWith('/api') ? exportUrl : `/api${exportUrl}`;
      const res = await fetch(url, { headers });

      if (!res.ok) {
        throw new Error(`Export failed with status ${res.status}`);
      }

      const blob = await res.blob();
      const blobUrl = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = blobUrl;
      link.setAttribute('download', exportFilename);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(blobUrl);
    } catch (err) {
      console.error('[ExportButton] CSV export failed:', err);
    } finally {
      setIsExporting(false);
    }
  }

  function handlePrint() {
    setIsOpen(false);
    if (onPrint) {
      onPrint();
    } else {
      window.print();
    }
  }

  return (
    <div className="relative" style={{ display: 'inline-block' }}>
      {/* Trigger button */}
      <button
        ref={buttonRef}
        type="button"
        className="toolbar-btn"
        onClick={() => setIsOpen((prev) => !prev)}
        disabled={isExporting}
        title="Export options"
      >
        <Download className="w-3.5 h-3.5" />
        <span>{isExporting ? 'Exporting...' : 'Export'}</span>
        <ChevronDown
          className="w-3 h-3 ml-0.5 transition-transform"
          style={{ transform: isOpen ? 'rotate(180deg)' : 'rotate(0deg)' }}
        />
      </button>

      {/* Dropdown menu */}
      {isOpen && (
        <div
          ref={dropdownRef}
          className="absolute z-50 mt-1"
          style={{
            top: '100%',
            right: 0,
            minWidth: '160px',
            background: '#252525',
            border: '1px solid #484848',
            borderRadius: 0,
            boxShadow: '0 4px 12px rgba(0, 0, 0, 0.5)',
          }}
        >
          {/* Export CSV */}
          <button
            type="button"
            onClick={handleExportCSV}
            className="w-full flex items-center gap-2 px-3 py-2 text-left transition-colors"
            style={{
              fontSize: '11px',
              color: '#d4d4d4',
              background: 'transparent',
              border: 'none',
              borderRadius: 0,
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLElement).style.background = '#383838';
              (e.currentTarget as HTMLElement).style.color = '#ffffff';
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLElement).style.background = 'transparent';
              (e.currentTarget as HTMLElement).style.color = '#d4d4d4';
            }}
          >
            <Download className="w-3.5 h-3.5 flex-shrink-0" />
            <span className="font-bold uppercase tracking-wider" style={{ fontSize: '10px' }}>
              Export CSV
            </span>
          </button>

          {/* Divider */}
          <div style={{ height: '1px', background: '#484848', margin: '0 8px' }} />

          {/* Print View */}
          <button
            type="button"
            onClick={handlePrint}
            className="w-full flex items-center gap-2 px-3 py-2 text-left transition-colors"
            style={{
              fontSize: '11px',
              color: '#d4d4d4',
              background: 'transparent',
              border: 'none',
              borderRadius: 0,
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLElement).style.background = '#383838';
              (e.currentTarget as HTMLElement).style.color = '#ffffff';
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLElement).style.background = 'transparent';
              (e.currentTarget as HTMLElement).style.color = '#d4d4d4';
            }}
          >
            <Printer className="w-3.5 h-3.5 flex-shrink-0" />
            <span className="font-bold uppercase tracking-wider" style={{ fontSize: '10px' }}>
              Print View
            </span>
          </button>
        </div>
      )}
    </div>
  );
}
