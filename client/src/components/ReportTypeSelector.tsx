// ============================================================
// RMPG Flex — Report Type Selector
// Dropdown/modal for choosing which PDF template to export
// Supports both Download and Preview modes
// ============================================================

import React, { useState, useRef, useEffect } from 'react';
import { FileDown, ChevronDown, Eye } from 'lucide-react';
import {
  type PdfReportType,
  PDF_REPORT_LABELS,
  getDefaultReportType,
} from '../utils/caseNumbers';

interface ReportTypeSelectorProps {
  incidentType: string;
  onSelect: (reportType: PdfReportType) => void;
  onPreview?: (reportType: PdfReportType) => void;
  className?: string;
}

const REPORT_TYPES = Object.entries(PDF_REPORT_LABELS) as [PdfReportType, string][];

export default function ReportTypeSelector({ incidentType, onSelect, onPreview, className = '' }: ReportTypeSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const defaultType = getDefaultReportType(incidentType);

  // Close dropdown on outside click
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    }
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isOpen]);

  const handleQuickExport = () => {
    onSelect(defaultType);
  };

  const handleQuickPreview = () => {
    if (onPreview) onPreview(defaultType);
  };

  return (
    <div className={`relative inline-flex ${className}`} ref={dropdownRef}>
      {/* Preview button */}
      {onPreview && (
        <button
          type="button"
          onClick={handleQuickPreview}
          className="toolbar-btn"
          title={`Preview ${PDF_REPORT_LABELS[defaultType]}`}
        >
          <Eye className="w-3.5 h-3.5" />
          Preview
        </button>
      )}

      {/* Main button — uses default report type */}
      <button
        type="button"
        onClick={handleQuickExport}
        className="toolbar-btn toolbar-btn-primary"
        title={`Export as ${PDF_REPORT_LABELS[defaultType]}`}
      >
        <FileDown className="w-3.5 h-3.5" />
        Export PDF
      </button>

      {/* Dropdown arrow for other report types */}
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="toolbar-btn toolbar-btn-primary"
        style={{ paddingLeft: '4px', paddingRight: '4px', borderLeft: '1px solid rgba(255,255,255,0.15)' }}
        title="Choose report type"
      >
        <ChevronDown className="w-3 h-3" />
      </button>

      {/* Dropdown menu */}
      {isOpen && (
        <div className="absolute top-full right-0 mt-1 z-50 min-w-[280px] bg-surface-base border border-rmpg-600 shadow-xl animate-fade-in">
          <div className="px-3 py-2 border-b border-rmpg-700">
            <p className="text-[10px] text-rmpg-400 uppercase font-bold tracking-wider">Select Report Template</p>
          </div>
          {REPORT_TYPES.map(([type, label]) => (
            <div
              key={type}
              className={`flex items-center justify-between px-3 py-2 text-xs transition-colors hover:bg-rmpg-700/50 ${
                type === defaultType
                  ? 'text-brand-400 font-semibold'
                  : 'text-rmpg-200'
              }`}
            >
              <button
                type="button"
                onClick={() => {
                  onSelect(type);
                  setIsOpen(false);
                }}
                className="flex-1 text-left flex items-center gap-1"
              >
                <FileDown className="w-3 h-3 opacity-50" />
                <span>{label}</span>
                {type === defaultType && (
                  <span className="text-[10px] text-brand-500 ml-1">(Default)</span>
                )}
              </button>
              {onPreview && (
                <button
                  type="button"
                  onClick={() => {
                    onPreview(type);
                    setIsOpen(false);
                  }}
                  className="ml-2 p-1 hover:bg-rmpg-600 rounded text-rmpg-400 hover:text-rmpg-200"
                  title={`Preview ${label}`}
                >
                  <Eye className="w-3 h-3" />
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
