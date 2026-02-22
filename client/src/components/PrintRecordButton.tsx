// ============================================================
// RMPG Flex — Print Record Button
// Downloads a professional police-style PDF for a single record
// Also supports in-app PDF preview via DocumentViewer modal
// Uses jsPDF generators from recordPdfGenerator.ts
// Auto-fetches entity attachment images when entityType/entityId provided
// ============================================================

import React, { useCallback, useState, useEffect } from 'react';
import { Printer, Eye } from 'lucide-react';
import { downloadRecordPdf, generateRecordPdfBlobUrl, type RecordPdfType } from '../utils/recordPdfGenerator';
import { fetchEntityImages, fetchImageFromUrl } from '../utils/pdfImageHelpers';
import DocumentViewer from './DocumentViewer';

interface PrintRecordButtonProps {
  /** Record type to generate PDF for */
  recordType: RecordPdfType;
  /** Record data to populate the PDF */
  recordData: any;
  /** Identifier for the filename (e.g., call_number, warrant_number) */
  identifier?: string;
  /** Button label (default: 'Print') */
  label?: string;
  /** Additional CSS class for the button */
  className?: string;
  /** Tooltip override */
  title?: string;
  /** Icon-only mode (no label text) */
  iconOnly?: boolean;
  /** Entity type for auto-fetching attachment images (e.g., 'person', 'vehicle') */
  entityType?: string;
  /** Entity ID for auto-fetching attachment images */
  entityId?: string | number;
}

export default function PrintRecordButton({
  recordType,
  recordData,
  identifier,
  label = 'Print',
  className = '',
  title = 'Download PDF report',
  iconOnly = false,
  entityType,
  entityId,
}: PrintRecordButtonProps) {
  const [viewerOpen, setViewerOpen] = useState(false);
  const [pdfBlobUrl, setPdfBlobUrl] = useState('');
  const [loading, setLoading] = useState(false);

  // Clean up blob URL on unmount
  useEffect(() => {
    return () => {
      if (pdfBlobUrl) URL.revokeObjectURL(pdfBlobUrl);
    };
  }, [pdfBlobUrl]);

  /** Merge attachment images into recordData before PDF generation */
  const enrichWithImages = useCallback(async (data: any): Promise<any> => {
    if (!entityType || !entityId) return data;
    try {
      const enriched = { ...data };

      // Fetch entity attachment images
      const images = await fetchEntityImages(entityType, entityId);
      if (images.length > 0) {
        enriched.attachment_images = images;
      }

      // For person records, also fetch ID photo if id_image_url exists
      if (recordType === 'person' && data.id_image_url && !data.id_photo) {
        const idPhoto = await fetchImageFromUrl(data.id_image_url, 'ID Photo');
        if (idPhoto) enriched.id_photo = idPhoto;
      }

      return enriched;
    } catch (err) {
      console.warn('[PrintRecordButton] Image fetch failed, proceeding without images:', err);
      return data;
    }
  }, [entityType, entityId, recordType]);

  const handlePrint = useCallback(async () => {
    if (!recordData) return;
    try {
      setLoading(true);
      const enrichedData = await enrichWithImages(recordData);
      await downloadRecordPdf(recordType, enrichedData, identifier);
    } catch (err) {
      console.error('[PrintRecordButton] PDF generation failed:', err);
    } finally {
      setLoading(false);
    }
  }, [recordType, recordData, identifier, enrichWithImages]);

  const handlePreview = useCallback(async () => {
    if (!recordData) return;
    try {
      setLoading(true);
      // Revoke previous blob URL if one exists
      if (pdfBlobUrl) URL.revokeObjectURL(pdfBlobUrl);
      const enrichedData = await enrichWithImages(recordData);
      const blobUrl = await generateRecordPdfBlobUrl(recordType, enrichedData);
      setPdfBlobUrl(blobUrl);
      setViewerOpen(true);
    } catch (err) {
      console.error('[PrintRecordButton] PDF preview generation failed:', err);
    } finally {
      setLoading(false);
    }
  }, [recordType, recordData, pdfBlobUrl, enrichWithImages]);

  const handleCloseViewer = useCallback(() => {
    setViewerOpen(false);
    if (pdfBlobUrl) {
      URL.revokeObjectURL(pdfBlobUrl);
      setPdfBlobUrl('');
    }
  }, [pdfBlobUrl]);

  // Format a display-friendly record type label
  const recordTypeLabel = recordType.charAt(0).toUpperCase() + recordType.slice(1);

  return (
    <>
      <button
        type="button"
        className={`toolbar-btn ${className}`}
        onClick={handlePreview}
        title="Preview PDF report"
        disabled={loading}
      >
        <Eye style={{ width: 12, height: 12 }} />
        {!iconOnly && <span>{loading ? 'Loading…' : 'Preview'}</span>}
      </button>
      <button
        type="button"
        className={`toolbar-btn ${className}`}
        onClick={handlePrint}
        title={title}
        disabled={loading}
      >
        <Printer style={{ width: 12, height: 12 }} />
        {!iconOnly && <span>{loading ? 'Loading…' : label}</span>}
      </button>
      <DocumentViewer
        isOpen={viewerOpen}
        onClose={handleCloseViewer}
        src={pdfBlobUrl}
        title={`${recordTypeLabel} Record`}
        type="pdf"
      />
    </>
  );
}
