// ============================================================
// RMPG Flex — Document Viewer Modal
// In-app PDF/Image viewer with zoom, rotate, download, print
// Opens documents in an overlay instead of a secondary tab
// ============================================================

import React, { useState, useCallback, useEffect } from 'react';
import {
  X,
  Download,
  ZoomIn,
  ZoomOut,
  RotateCw,
  Printer,
  FileText,
  Image as ImageIcon,
  Maximize2,
  Minimize2,
} from 'lucide-react';

interface DocumentViewerProps {
  isOpen: boolean;
  onClose: () => void;
  src: string; // URL or data URL
  title?: string;
  type?: 'pdf' | 'image' | 'auto'; // auto-detect from src/mime
}

export default function DocumentViewer({
  isOpen,
  onClose,
  src,
  title = 'Document Viewer',
  type = 'auto',
}: DocumentViewerProps) {
  const [zoom, setZoom] = useState(100);
  const [rotation, setRotation] = useState(0);
  const [isFullscreen, setIsFullscreen] = useState(false);

  // Reset state when opening a new document
  useEffect(() => {
    if (isOpen) {
      setZoom(100);
      setRotation(0);
      setIsFullscreen(false);
    }
  }, [isOpen, src]);

  // Detect type from URL extension or content
  const detectedType =
    type !== 'auto'
      ? type
      : (() => {
          const lower = src.toLowerCase();
          if (lower.endsWith('.pdf') || lower.includes('application/pdf')) return 'pdf' as const;
          if (lower.match(/\.(png|jpg|jpeg|gif|webp|bmp|svg)/) || lower.startsWith('data:image'))
            return 'image' as const;
          // blob: URLs from jsPDF are PDFs
          if (lower.startsWith('blob:')) return 'pdf' as const;
          return 'pdf' as const; // default to PDF
        })();

  const handleDownload = useCallback(() => {
    const a = document.createElement('a');
    a.href = src;
    a.download = title || 'document';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }, [src, title]);

  const handlePrint = useCallback(() => {
    if (detectedType === 'pdf') {
      const iframe = document.querySelector('#doc-viewer-iframe') as HTMLIFrameElement;
      if (iframe?.contentWindow) {
        iframe.contentWindow.print();
      }
    } else {
      const printWindow = window.open('', '_blank');
      if (printWindow) {
        printWindow.document.write(
          `<html><body style="margin:0;display:flex;justify-content:center;align-items:center;min-height:100vh;background:#000;"><img src="${src}" style="max-width:100%;max-height:100vh;" /></body></html>`
        );
        printWindow.document.close();
        printWindow.onload = () => printWindow.print();
      }
    }
  }, [src, detectedType]);

  // Close on Escape
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] flex flex-col bg-black/90" role="dialog" aria-modal="true">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-4 py-2 bg-surface-base border-b border-rmpg-600 flex-shrink-0">
        <div className="flex items-center gap-3">
          {detectedType === 'pdf' ? (
            <FileText className="w-4 h-4 text-red-400" />
          ) : (
            <ImageIcon className="w-4 h-4 text-blue-400" />
          )}
          <span className="text-sm font-bold text-white truncate max-w-[300px]">{title}</span>
          <span className="text-[10px] text-rmpg-400 uppercase font-mono">
            {detectedType.toUpperCase()}
          </span>
        </div>

        <div className="flex items-center gap-1">
          {/* Zoom controls */}
          <button
            onClick={() => setZoom((z) => Math.max(25, z - 25))}
            className="toolbar-btn"
            style={{ fontSize: '9px' }}
            title="Zoom out"
          >
            <ZoomOut style={{ width: 14, height: 14 }} />
          </button>
          <span className="text-[10px] text-rmpg-300 font-mono w-10 text-center">{zoom}%</span>
          <button
            onClick={() => setZoom((z) => Math.min(400, z + 25))}
            className="toolbar-btn"
            style={{ fontSize: '9px' }}
            title="Zoom in"
          >
            <ZoomIn style={{ width: 14, height: 14 }} />
          </button>
          <button
            onClick={() => setZoom(100)}
            className="toolbar-btn"
            style={{ fontSize: '9px' }}
            title="Reset zoom"
          >
            Fit
          </button>

          <span className="toolbar-separator" />

          {/* Rotate (images only) */}
          {detectedType === 'image' && (
            <>
              <button
                onClick={() => setRotation((r) => (r + 90) % 360)}
                className="toolbar-btn"
                style={{ fontSize: '9px' }}
                title="Rotate"
              >
                <RotateCw style={{ width: 14, height: 14 }} />
              </button>
              <span className="toolbar-separator" />
            </>
          )}

          {/* Print */}
          <button
            onClick={handlePrint}
            className="toolbar-btn"
            style={{ fontSize: '9px' }}
            title="Print"
          >
            <Printer style={{ width: 14, height: 14 }} />
          </button>

          {/* Download */}
          <button
            onClick={handleDownload}
            className="toolbar-btn"
            style={{ fontSize: '9px' }}
            title="Download"
          >
            <Download style={{ width: 14, height: 14 }} />
          </button>

          {/* Fullscreen toggle */}
          <button
            onClick={() => setIsFullscreen((f) => !f)}
            className="toolbar-btn"
            style={{ fontSize: '9px' }}
            title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
          >
            {isFullscreen ? (
              <Minimize2 style={{ width: 14, height: 14 }} />
            ) : (
              <Maximize2 style={{ width: 14, height: 14 }} />
            )}
          </button>

          <span className="toolbar-separator" />

          {/* Close */}
          <button
            onClick={onClose}
            className="toolbar-btn"
            style={{ fontSize: '9px' }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = '#174e8a';
              e.currentTarget.style.color = '#ffffff';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = '';
              e.currentTarget.style.color = '';
            }}
            title="Close"
          >
            <X style={{ width: 16, height: 16 }} />
          </button>
        </div>
      </div>

      {/* Content Area */}
      <div className="flex-1 overflow-auto flex items-center justify-center p-4">
        {detectedType === 'pdf' ? (
          <iframe
            id="doc-viewer-iframe"
            src={src}
            className="border border-rmpg-600 bg-white"
            style={{
              width: isFullscreen ? '100%' : `${Math.min(zoom, 100)}%`,
              height: '100%',
              transform: zoom > 100 ? `scale(${zoom / 100})` : undefined,
              transformOrigin: 'top center',
            }}
            title={title}
          />
        ) : (
          <img
            src={src}
            alt={title}
            className="max-w-full max-h-full object-contain select-none"
            style={{
              transform: `scale(${zoom / 100}) rotate(${rotation}deg)`,
              transformOrigin: 'center center',
              transition: 'transform 0.2s ease',
            }}
            draggable={false}
          />
        )}
      </div>

      {/* Status bar */}
      <div className="flex items-center justify-between px-4 py-1 bg-surface-base border-t border-rmpg-600 text-[9px] text-rmpg-500 flex-shrink-0">
        <span>Press Esc to close</span>
        <span>
          {detectedType === 'image'
            ? `Zoom: ${zoom}% \u00B7 Rotation: ${rotation}\u00B0`
            : `Zoom: ${zoom}%`}
        </span>
      </div>
    </div>
  );
}
