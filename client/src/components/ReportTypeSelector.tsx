// ============================================================
// RMPG Flex — Report Type Selector
// Dropdown/modal for choosing which PDF template to export
// Supports Download, Preview, and Sign & Export modes
// ============================================================

import { useState, useRef, useEffect } from 'react';
import { FileDown, ChevronDown, Eye, PenLine, Smartphone } from 'lucide-react';
import {
  type PdfReportType,
  PDF_REPORT_LABELS,
  getDefaultReportType,
} from '../utils/caseNumbers';
import { apiFetch } from '../hooks/useApi';
import SignaturePad from './SignaturePad';

interface ReportTypeSelectorProps {
  incidentType: string;
  onSelect: (reportType: PdfReportType) => void;
  onPreview?: (reportType: PdfReportType) => void;
  /** Called with (reportType, signatureDataUrl) when user signs and exports */
  onSignAndExport?: (reportType: PdfReportType, signature: string) => void;
  /** Mobile thermal print (Brother PJ-700, +6mm top offset). Direct
   *  download — bypasses preview, since the PDF is queued straight
   *  to the in-vehicle printer driver. */
  onMobilePrint?: (reportType: PdfReportType) => void;
  className?: string;
}

const REPORT_TYPES = Object.entries(PDF_REPORT_LABELS) as [PdfReportType, string][];

export default function ReportTypeSelector({ incidentType, onSelect, onPreview, onSignAndExport, onMobilePrint, className = '' }: ReportTypeSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [signModalOpen, setSignModalOpen] = useState(false);
  const [savedSignature, setSavedSignature] = useState<string | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const defaultType = getDefaultReportType(incidentType);

  // Pre-fetch user's saved signature
  useEffect(() => {
    apiFetch<{ signature: string | null }>('/auth/signature')
      .then(data => setSavedSignature(data?.signature || null))
      .catch(() => {});
  }, []);

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

  const handleSignAndExport = () => {
    if (!onSignAndExport) return;
    if (savedSignature) {
      // Already have a saved signature — export immediately
      onSignAndExport(defaultType, savedSignature);
    } else {
      // Show sign modal
      setSignModalOpen(true);
    }
  };

  const handleQuickSign = async (dataUrl: string | null) => {
    setSignModalOpen(false);
    if (!dataUrl || !onSignAndExport) return;

    // Save signature to profile for future use
    try {
      await apiFetch('/auth/signature', {
        method: 'PUT',
        body: JSON.stringify({ signature: dataUrl }),
      });
      setSavedSignature(dataUrl);
    } catch { /* continue even if save fails */ }

    onSignAndExport(defaultType, dataUrl);
  };

  return (
    <>
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

        {/* Sign & Export button */}
        {onSignAndExport && (
          <button
            type="button"
            onClick={handleSignAndExport}
            className="toolbar-btn toolbar-btn-primary"
            title="Sign and export PDF"
          >
            <PenLine className="w-3.5 h-3.5" />
            Sign & Export
          </button>
        )}

        {/* Main export button (Office Print / desk laser) */}
        <button
          type="button"
          onClick={handleQuickExport}
          className="toolbar-btn toolbar-btn-primary"
          title={`Export as ${PDF_REPORT_LABELS[defaultType]} (office laser)`}
        >
          <FileDown className="w-3.5 h-3.5" />
          Office Print
        </button>

        {/* Mobile Print (Brother PJ-700 in-vehicle thermal) */}
        {onMobilePrint && (
          <button
            type="button"
            onClick={() => onMobilePrint(defaultType)}
            className="toolbar-btn"
            title="Print on in-vehicle Brother PJ thermal printer (+6mm top offset)"
          >
            <Smartphone className="w-3.5 h-3.5" />
            Mobile Print
          </button>
        )}

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
                    className="ml-2 p-1 hover:bg-rmpg-600 rounded-sm text-rmpg-400 hover:text-rmpg-200"
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

      {/* Quick-sign modal */}
      {signModalOpen && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-sm animate-fade-in" role="dialog" aria-modal="true">
          <div className="bg-surface-base border border-rmpg-600 shadow-md p-6 max-w-lg w-full mx-4">
            <h3 className="text-sm font-bold text-rmpg-100 mb-1">Sign Document</h3>
            <p className="text-[10px] text-rmpg-400 mb-4">
              Draw your signature below. It will be embedded in the PDF and saved to your profile for future reports.
            </p>
            <SignaturePad
              value={null}
              onChange={handleQuickSign}
              label="Your Signature"
              width={440}
              height={140}
              compact={false}
            />
            <button
              type="button"
              onClick={() => setSignModalOpen(false)}
              className="mt-3 text-xs text-rmpg-400 hover:text-rmpg-200 transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </>
  );
}
