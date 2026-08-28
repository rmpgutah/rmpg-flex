import { useEffect, useRef, useState, type ReactNode, type RefObject, type PointerEvent } from 'react';
import { ChevronLeft, ChevronRight, Loader2, AlertTriangle } from 'lucide-react';
import { apiFetchBlob } from '../../hooks/useApi';
import {
  isImageMime,
  isPdfBytes,
  openPdf,
  renderPdfPageToBlob,
} from '../../utils/tesseractPdfRaster';
import type { PDFDocumentProxy } from 'pdfjs-dist';

export interface TrainingViewerSize {
  naturalWidth: number;
  naturalHeight: number;
  pageCount: number;
}

interface Props {
  documentId: number;
  fileType: string | null;
  fileName: string;
  page: number;
  onPageChange: (page: number) => void;
  onSize: (size: TrainingViewerSize) => void;
  imgRef: RefObject<HTMLImageElement | null>;
  children?: ReactNode;
  onPointerDown?: (e: PointerEvent<HTMLDivElement>) => void;
  onPointerMove?: (e: PointerEvent<HTMLDivElement>) => void;
  onPointerUp?: (e: PointerEvent<HTMLDivElement>) => void;
  cursorClass?: string;
}

export default function TrainingDocumentViewer({
  documentId,
  fileType,
  fileName,
  page,
  onPageChange,
  onSize,
  imgRef,
  children,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  cursorClass = '',
}: Props) {
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState<string | null>(null);
  const [src, setSrc] = useState<string | null>(null);
  const [pageCount, setPageCount] = useState(1);
  const [pdfEpoch, setPdfEpoch] = useState(0);
  const objectUrlRef = useRef<string | null>(null);
  const pdfRef = useRef<PDFDocumentProxy | null>(null);

  useEffect(() => {
    let cancelled = false;
    setStatus('loading');
    setError(null);
    setSrc(null);
    pdfRef.current = null;
    setPdfEpoch(0);

    (async () => {
      try {
        const blob = await apiFetchBlob(`/tesseract-training/documents/${documentId}/image`);
        if (cancelled) return;
        const buf = new Uint8Array(await blob.arrayBuffer());
        const mime = blob.type || fileType || '';
        if (isPdfBytes(buf, mime)) {
          const pdf = await openPdf(buf);
          if (cancelled) { void (pdf as { destroy?: () => Promise<unknown> }).destroy?.(); return; }
          pdfRef.current = pdf;
          setPageCount(pdf.numPages);
          setPdfEpoch((n) => n + 1);
        } else if (isImageMime(mime) || isImageMime(fileType)) {
          setPageCount(1);
          const url = URL.createObjectURL(new Blob([buf], { type: mime || 'image/png' }));
          objectUrlRef.current = url;
          setSrc(url);
          setStatus('ready');
        } else {
          // Unknown binary — still try as image so a mislabelled JPEG can render.
          setPageCount(1);
          const url = URL.createObjectURL(new Blob([buf], { type: mime || 'application/octet-stream' }));
          objectUrlRef.current = url;
          setSrc(url);
          setStatus('ready');
        }
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Failed to load document');
        setStatus('error');
      }
    })();

    return () => {
      cancelled = true;
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
        objectUrlRef.current = null;
      }
      void (pdfRef.current as { destroy?: () => Promise<unknown> } | null)?.destroy?.();
      pdfRef.current = null;
    };
    // Reset when the document identity changes, not when page/fileType flicker.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [documentId]);

  useEffect(() => {
    const pdf = pdfRef.current;
    if (!pdf) return;
    let cancelled = false;
    setStatus('loading');
    (async () => {
      try {
        const { blob, width, height } = await renderPdfPageToBlob(pdf, page);
        if (cancelled) return;
        if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
        const url = URL.createObjectURL(blob);
        objectUrlRef.current = url;
        setSrc(url);
        onSize({ naturalWidth: width, naturalHeight: height, pageCount: pdf.numPages });
        setStatus('ready');
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Failed to render PDF page');
        setStatus('error');
      }
    })();
    return () => { cancelled = true; };
  }, [documentId, page, pdfEpoch, onSize]);

  const handleImgLoad = () => {
    const img = imgRef.current;
    if (!img) return;
    if (!pdfRef.current) {
      onSize({
        naturalWidth: img.naturalWidth,
        naturalHeight: img.naturalHeight,
        pageCount: 1,
      });
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[10px] text-fg-secondary truncate" title={fileName}>{fileName}</p>
        {pageCount > 1 && (
          <div className="flex items-center gap-1 flex-none">
            <button
              type="button"
              onClick={() => onPageChange(Math.max(1, page - 1))}
              disabled={page <= 1}
              className="px-1.5 py-0.5 border border-border-default text-fg-secondary disabled:opacity-30 hover:text-rmpg-100"
              aria-label="Previous page"
            >
              <ChevronLeft size={12} />
            </button>
            <span className="text-[10px] text-fg-muted tabular-nums">
              Page {page} / {pageCount}
            </span>
            <button
              type="button"
              onClick={() => onPageChange(Math.min(pageCount, page + 1))}
              disabled={page >= pageCount}
              className="px-1.5 py-0.5 border border-border-default text-fg-secondary disabled:opacity-30 hover:text-rmpg-100"
              aria-label="Next page"
            >
              <ChevronRight size={12} />
            </button>
          </div>
        )}
      </div>

      {status === 'loading' && (
        <div className="flex items-center gap-2 text-[10px] text-fg-muted py-8 justify-center border border-border-default bg-surface-base">
          <Loader2 size={12} className="animate-spin" /> Loading document…
        </div>
      )}
      {status === 'error' && (
        <div className="flex items-center gap-2 text-[10px] text-amber-400 py-6 px-3 border border-border-default bg-surface-base">
          <AlertTriangle size={12} /> {error || 'Could not display this file.'}
        </div>
      )}
      {src && (
        <div
          className={`relative inline-block select-none max-w-full ${cursorClass}`}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerLeave={onPointerUp}
        >
          <img
            ref={imgRef}
            src={src}
            alt={fileName}
            draggable={false}
            onLoad={handleImgLoad}
            className="max-w-full border border-border-default rounded-sm block bg-white"
          />
          {children}
        </div>
      )}
    </div>
  );
}
