// client/src/hooks/useRecordPhotos.ts
// Generic photo/layout gallery for a Business or Property record. Wraps
// /api/business-photos or /api/property-photos (identical shape, see
// src/routes/business/photos.ts + src/routes/property/photos.ts).

import { useCallback, useEffect, useState } from 'react';
import { apiFetch, apiPostForm } from './useApi';

export interface RecordPhoto {
  id: number;
  url: string;
  caption: string | null;
  category: string | null;
  kind: 'photo' | 'layout';
  uploaded_by: number | null;
  uploaded_at: string;
}

export function useRecordPhotos(recordType: 'business' | 'property', recordId: number | string | undefined) {
  const [photos, setPhotos] = useState<RecordPhoto[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const endpointBase = recordType === 'business' ? '/business-photos' : '/property-photos';
  const idField = recordType === 'business' ? 'business_id' : 'property_id';

  const refresh = useCallback(async () => {
    if (recordId == null) return;
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch<RecordPhoto[]>(`${endpointBase}/${recordId}`);
      setPhotos(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load photos');
    } finally {
      setLoading(false);
    }
  }, [endpointBase, recordId]);

  useEffect(() => { refresh(); }, [refresh]);

  const upload = useCallback(async (file: File, kind: 'photo' | 'layout', category?: string, caption?: string) => {
    if (recordId == null) return;
    const form = new FormData();
    form.set('photo', file);
    form.set(idField, String(recordId));
    form.set('kind', kind);
    if (category) form.set('category', category);
    if (caption) form.set('caption', caption);
    await apiPostForm(endpointBase, form);
    await refresh();
  }, [endpointBase, idField, recordId, refresh]);

  const remove = useCallback(async (photoId: number) => {
    await apiFetch(`${endpointBase}/${photoId}`, { method: 'DELETE' });
    await refresh();
  }, [endpointBase, refresh]);

  return { photos, loading, error, upload, remove, refresh };
}
