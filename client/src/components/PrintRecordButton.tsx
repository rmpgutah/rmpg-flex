// ============================================================
// RMPG Flex — Print Record Button
// Downloads a professional police-style PDF for a single record
// Also supports in-app PDF preview via DocumentViewer modal
// Uses jsPDF generators from recordPdfGenerator.ts
// Auto-fetches entity attachment images when entityType/entityId provided
// Includes "Sign & Export" flow for in-app digital signing
// ============================================================

import React, { useCallback, useState, useEffect } from 'react';
import { Printer, Eye, PenLine } from 'lucide-react';
import { downloadRecordPdf, generateRecordPdfBlobUrl, type RecordPdfType } from '../utils/recordPdfGenerator';
import { fetchEntityImages, fetchImageFromUrl } from '../utils/pdfImageHelpers';
import { apiFetch } from '../hooks/useApi';
import { useAuth } from '../context/AuthContext';
import DocumentViewer from './DocumentViewer';
import SignaturePad from './SignaturePad';

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
  const { user } = useAuth();
  const [viewerOpen, setViewerOpen] = useState(false);
  const [pdfBlobUrl, setPdfBlobUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [signModalOpen, setSignModalOpen] = useState(false);
  const [savedSignature, setSavedSignature] = useState<string | null>(null);
  const [signatureChecked, setSignatureChecked] = useState(false);

  // Escape key to close sign modal
  useEffect(() => {
    if (!signModalOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSignModalOpen(false);
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [signModalOpen]);

  // Clean up blob URL on unmount
  useEffect(() => {
    return () => {
      if (pdfBlobUrl) URL.revokeObjectURL(pdfBlobUrl);
    };
  }, [pdfBlobUrl]);

  // Pre-fetch user's saved signature on mount
  useEffect(() => {
    if (!signatureChecked) {
      apiFetch<{ signature: string | null }>('/auth/signature')
        .then(data => { setSavedSignature(data?.signature || null); setSignatureChecked(true); })
        .catch(() => setSignatureChecked(true));
    }
  }, [signatureChecked]);

  /** Merge attachment images and system history into recordData before PDF generation */
  const enrichWithImages = useCallback(async (data: any, signatureOverride?: string | null): Promise<any> => {
    const enriched = { ...data };

    // Fetch entity attachment images
    if (entityType && entityId) {
      try {
        const images = await fetchEntityImages(entityType, entityId);
        if (images.length > 0) {
          enriched.attachment_images = images;
        }

        // For person records, also fetch ID photo if id_image_url exists
        if (recordType === 'person' && data.id_image_url && !data.id_photo) {
          const idPhoto = await fetchImageFromUrl(data.id_image_url, 'ID Photo');
          if (idPhoto) enriched.id_photo = idPhoto;
        }
      } catch (err) {
        console.warn('[PrintRecordButton] Image fetch failed, proceeding without images:', err);
      }
    }

    // For person records, fetch system history (warrants, incidents, citations, calls)
    if (recordType === 'person' && data.id) {
      try {
        const history = await apiFetch<{
          warrants: any[];
          incidents: any[];
          calls: any[];
          citations: any[];
          bolo_active: boolean;
        }>(`/records/persons/${data.id}/system-history`);
        if (history) {
          enriched.warrants = history.warrants || [];
          enriched.incidents = history.incidents || [];
          enriched.calls = history.calls || [];
          enriched.citations = history.citations || [];
          enriched.bolo_active = history.bolo_active || false;
        }
      } catch (err) {
        console.warn('[PrintRecordButton] System history fetch failed, proceeding without history:', err);
      }

      // Also fetch criminal history records (arrests, convictions, charges, bookings, etc.)
      try {
        const criminal = await apiFetch<any[]>(`/records/persons/${data.id}/criminal-history`);
        if (criminal && criminal.length > 0) {
          enriched.criminal_records = criminal;
        }
      } catch (err) {
        console.warn('[PrintRecordButton] Criminal history fetch failed, proceeding without:', err);
      }
    }

    // For call records, fetch GPS breadcrumb trail
    if (recordType === 'call' && data.id) {
      try {
        const trail = await apiFetch<{
          points: any[];
          stats: { total_points: number; total_distance_miles: number; duration_minutes: number; avg_speed_mph: number; max_speed_mph: number; source_breakdown?: Record<string, number> };
        }>(`/dispatch/gps/call-trail/${data.id}`);
        if (trail?.points?.length > 0) {
          enriched.breadcrumb_trail = trail;
        }
      } catch (err) {
        console.warn('[PrintRecordButton] Breadcrumb trail fetch failed, proceeding without GPS data:', err);
      }
    }

    // Use override signature (from sign modal) or fetch saved one
    if (signatureOverride) {
      enriched._officerSignature = signatureOverride;
    } else {
      try {
        const sigRes = await apiFetch<{ signature: string | null }>('/auth/signature');
        if (sigRes?.signature) {
          enriched._officerSignature = sigRes.signature;
        }
      } catch {
        // Signature fetch failed — PDFs will render with empty sig lines
      }
    }

    // Auto-fill reporting officer info from logged-in user
    if (user) {
      enriched.officer_name = enriched.officer_name || user.full_name || `${user.last_name}, ${user.first_name}`;
      enriched.badge_number = enriched.badge_number || user.badge_number || '';
    }

    return enriched;
  }, [entityType, entityId, recordType, user]);

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

  /** Sign & Export: if user has no saved signature, show the sign pad; otherwise generate with saved sig */
  const handleSignAndExport = useCallback(async () => {
    if (!recordData) return;
    if (savedSignature) {
      // Already have a signature — generate immediately
      try {
        setLoading(true);
        const enrichedData = await enrichWithImages(recordData, savedSignature);
        await downloadRecordPdf(recordType, enrichedData, identifier);
      } catch (err) {
        console.error('[PrintRecordButton] Signed PDF generation failed:', err);
      } finally {
        setLoading(false);
      }
    } else {
      // No saved signature — open the sign pad modal
      setSignModalOpen(true);
    }
  }, [recordData, savedSignature, enrichWithImages, recordType, identifier]);

  /** Called when user signs in the quick-sign modal */
  const handleQuickSign = useCallback(async (dataUrl: string | null) => {
    setSignModalOpen(false);
    if (!dataUrl || !recordData) return;

    // Save signature to user profile for future use
    try {
      await apiFetch('/auth/signature', {
        method: 'PUT',
        body: JSON.stringify({ signature: dataUrl }),
      });
      setSavedSignature(dataUrl);
    } catch { /* continue even if save fails */ }

    // Generate the PDF with the fresh signature
    try {
      setLoading(true);
      const enrichedData = await enrichWithImages(recordData, dataUrl);
      await downloadRecordPdf(recordType, enrichedData, identifier);
    } catch (err) {
      console.error('[PrintRecordButton] Signed PDF generation failed:', err);
    } finally {
      setLoading(false);
    }
  }, [recordData, enrichWithImages, recordType, identifier]);

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
      <button
        type="button"
        className={`toolbar-btn toolbar-btn-primary ${className}`}
        onClick={handleSignAndExport}
        title="Sign and download PDF report"
        disabled={loading}
      >
        <PenLine style={{ width: 12, height: 12 }} />
        {!iconOnly && <span>{loading ? 'Signing…' : 'Sign & Export'}</span>}
      </button>
      <DocumentViewer
        isOpen={viewerOpen}
        onClose={handleCloseViewer}
        src={pdfBlobUrl}
        title={`${recordTypeLabel} Record`}
        type="pdf"
      />

      {/* Quick-sign modal */}
      {signModalOpen && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-sm animate-fade-in" role="dialog" aria-modal="true">
          <div className="bg-surface-base border border-rmpg-600 shadow-2xl p-6 max-w-lg w-full mx-4">
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
              Cancel — export without signature
            </button>
          </div>
        </div>
      )}
    </>
  );
}
