import { useCallback, useEffect, useRef, useState } from 'react';
import { multiCopyPdfV2BlobUrl } from '../utils/pdf/v2';
import { citationSchema } from '../utils/pdf/v2/forms/citation';
import { CITATION_INSTRUCTIONS } from '../utils/pdf/v2/forms/citationInstructions';
import { utahMasterBlobUrl } from '../utils/pdf/v2/utahMasterRenderer';
import { isUtahMasterEnabled } from '../utils/citationFeatureFlag';

export type PreviewMode = 'modal' | 'side' | 'full';

export function useCitationPreview(form: any, mode: PreviewMode) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [isRendering, setIsRendering] = useState(false);
  const lastUrl = useRef<string | null>(null);

  const render = useCallback(async () => {
    setIsRendering(true);
    try {
      // PR 1: Behind workspace flag. Both schemas read from the same
      // `form` shape — CitationUtahData is a superset of CitationData,
      // and any fields the master form expects but the legacy form
      // doesn't have just render blank. Safe to swap.
      const url = isUtahMasterEnabled()
        ? await utahMasterBlobUrl(form)
        : await multiCopyPdfV2BlobUrl(citationSchema, form, CITATION_INSTRUCTIONS);
      if (lastUrl.current) URL.revokeObjectURL(lastUrl.current);
      lastUrl.current = url;
      setBlobUrl(url);
    } finally {
      setIsRendering(false);
    }
  }, [form]);

  // Side mode = auto refresh on form change with 500ms debounce.
  useEffect(() => {
    if (mode !== 'side') return;
    const id = setTimeout(() => { void render(); }, 500);
    return () => clearTimeout(id);
  }, [mode, render]);

  // Revoke URL on unmount.
  useEffect(() => () => { if (lastUrl.current) URL.revokeObjectURL(lastUrl.current); }, []);

  return { blobUrl, refresh: render, isRendering };
}
