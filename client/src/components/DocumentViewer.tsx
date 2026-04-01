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
  // Validate src protocol to prevent javascript:/data: XSS
  const safeSrc = src && /^(https?:|blob:|data:image\/|data:application\/pdf|\/)/i.test(src) ? src : '';

  const [zoom, setZoom] = useState(100);
  const [rotation, setRotation] = useState(0);
  const [isFullscreen, setIsFullscreen] = useState(false);

  // Body scroll lock — prevent background scrolling when viewer is open
  useEffect(() => {
    if (isOpen) {
      const scrollY = window.scrollY;
      document.body.style.overflow = 'hidden';
      document.body.style.position = 'fixed';
      document.body.style.width = '100%';
      document.body.style.top = `-${scrollY}px`;
    }
    return () => {
      const scrollY = Math.abs(parseInt(document.body.style.top || '0'));
      document.body.style.overflow = '';
      document.body.style.position = '';
      document.body.style.width = '';
      document.body.style.top = '';
      if (scrollY > 0) window.scrollTo(0, scrollY);
    };
  }, [isOpen]);

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
    a.href = safeSrc;
    a.download = title || 'document';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }, [safeSrc, title]);

  const handlePrint = useCallback(() => {
    if (detectedType === 'pdf') {
      const iframe = document.querySelector('#doc-viewer-iframe') as HTMLIFrameElement;
      if (iframe?.contentWindow) {
        iframe.contentWindow.print();
      }
    } else {
      const printWindow = window.open('', '_blank');
      if (printWindow) {
        const body = printWindow.document.body;
        body.style.cssText = 'margin:0;display:flex;justify-content:center;align-items:center;min-height:100dvh;background:#000;';
        const img = printWindow.document.createElement('img');
        img.src = safeSrc;
        img.style.cssText = 'max-width:100%;max-height:100dvh;';
        body.appendChild(img);
        printWindow.document.close();
        img.onload = () => printWindow.print();
      }
    }
  }, [safeSrc, detectedType]);

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
    <div className="fixed inset-0 z-[9998] flex flex-col bg-black/95" role="dialog" aria-modal="true" style={{ touchAction: 'manipulation' }}>
      {/* Toolbar — z-index above iframe to ensure clicks register */}
      <div className="flex items-center justify-between px-4 py-2 bg-surface-base border-b border-rmpg-600 flex-shrink-0 relative z-10">
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
          <button type="button"
            onClick={() => setZoom((z) => Math.max(25, z - 25))}
            className="toolbar-btn"
            style={{ fontSize: '9px' }}
            title="Zoom out"
          >
            <ZoomOut style={{ width: 14, height: 14 }} />
          </button>
          <span className="text-[10px] text-rmpg-300 font-mono w-10 text-center">{zoom}%</span>
          <button type="button"
            onClick={() => setZoom((z) => Math.min(400, z + 25))}
            className="toolbar-btn"
            style={{ fontSize: '9px' }}
            title="Zoom in"
          >
            <ZoomIn style={{ width: 14, height: 14 }} />
          </button>
          <button type="button"
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
              <button type="button"
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
          <button type="button"
            onClick={handlePrint}
            className="toolbar-btn"
            style={{ fontSize: '9px' }}
            title="Print"
          >
            <Printer style={{ width: 14, height: 14 }} />
          </button>

          {/* Download */}
          <button type="button"
            onClick={handleDownload}
            className="toolbar-btn"
            style={{ fontSize: '9px' }}
            title="Download"
          >
            <Download style={{ width: 14, height: 14 }} />
          </button>

          {/* Fullscreen toggle */}
          <button type="button"
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

          {/* Close — bright red, always visible, high z-index */}
          <button type="button"
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); onClose(); }}
            className="relative z-20 ml-2 px-3 py-1.5 min-w-[44px] min-h-[44px] flex items-center justify-center gap-1 bg-red-700 hover:bg-red-600 text-white font-bold text-xs rounded-sm cursor-pointer"
            style={{ touchAction: 'manipulation' }}
            title="Close viewer"
            aria-label="Close"
          >
            <X className="w-4 h-4" /> Close
          </button>
        </div>
      </div>

      {/* Content Area */}
      <div className="flex-1 overflow-auto flex items-center justify-center p-4">
        {detectedType === 'pdf' ? (
          <iframe
            id="doc-viewer-iframe"
            src={safeSrc}
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
            src={safeSrc}
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
