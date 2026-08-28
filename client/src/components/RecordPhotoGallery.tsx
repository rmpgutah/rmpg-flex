// client/src/components/RecordPhotoGallery.tsx
// Thumbnail gallery + upload for a Business/Property record's photos and
// layout (floor-plan/site-plan) images. Tokens-only — no hex.

import { useRef, useState } from 'react';
import { useRecordPhotos, type RecordPhoto } from '../hooks/useRecordPhotos';
import { authedImageUrl } from '../hooks/useApi';

interface Props {
  recordType: 'business' | 'property';
  recordId: number | string | undefined;
}

const BUSINESS_CATEGORIES = ['storefront', 'interior', 'exterior', 'parking', 'other'];
const PROPERTY_CATEGORIES = ['exterior', 'interior', 'access', 'hazard', 'other'];

function Thumbnail({ photo, onDelete }: { photo: RecordPhoto; onDelete: (id: number) => void }) {
  return (
    <div className="relative w-20 h-20 border border-surface-raised">
      <img src={authedImageUrl(photo.url)} alt={photo.caption ?? photo.kind} className="w-full h-full object-cover" />
      <button
        type="button"
        aria-label={`Delete ${photo.kind}`}
        onClick={() => onDelete(photo.id)}
        className="absolute top-0 right-0 bg-surface-base text-text-secondary px-1 text-[10px] hover:text-red-400">
        ✕
      </button>
      {photo.kind === 'layout' && (
        <div className="absolute bottom-0 left-0 right-0 bg-surface-base/80 text-[9px] text-text-secondary text-center">
          layout
        </div>
      )}
    </div>
  );
}

export function RecordPhotoGallery({ recordType, recordId }: Props) {
  const { photos, loading, error, upload, remove } = useRecordPhotos(recordType, recordId);
  const [category, setCategory] = useState('');
  const photoInputRef = useRef<HTMLInputElement>(null);
  const layoutInputRef = useRef<HTMLInputElement>(null);
  const categories = recordType === 'business' ? BUSINESS_CATEGORIES : PROPERTY_CATEGORIES;

  if (recordId == null) {
    return <div className="text-xs text-fg-muted">Save the record before adding photos.</div>;
  }

  const photoRows = photos.filter((p) => p.kind === 'photo');
  const layoutRows = photos.filter((p) => p.kind === 'layout');

  const handleUpload = async (file: File | undefined, kind: 'photo' | 'layout') => {
    if (!file) return;
    await upload(file, kind, kind === 'photo' ? (category || categories[categories.length - 1]) : undefined);
  };

  return (
    <div className="text-xs">
      {error && <div className="text-red-400 mb-1">{error}</div>}
      <div className="mb-2">
        <div className="text-text-secondary font-semibold mb-1">Photos</div>
        <div className="flex flex-wrap gap-1 mb-1">
          {photoRows.map((p) => <Thumbnail key={p.id} photo={p} onDelete={remove} />)}
        </div>
        <select
          className="bg-surface-raised text-rmpg-200 border border-surface-raised p-1 mr-1"
          value={category}
          onChange={(e) => setCategory(e.target.value)}>
          <option value="">Category…</option>
          {categories.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <button
          type="button"
          disabled={loading}
          onClick={() => photoInputRef.current?.click()}
          className="px-2 py-1 bg-brand-500 text-rmpg-900 disabled:opacity-50">
          Upload Photo
        </button>
        <input
          ref={photoInputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className="hidden"
          onChange={(e) => handleUpload(e.target.files?.[0], 'photo')}
        />
      </div>
      <div>
        <div className="text-text-secondary font-semibold mb-1">Layout / Floor Plan</div>
        <div className="flex flex-wrap gap-1 mb-1">
          {layoutRows.map((p) => <Thumbnail key={p.id} photo={p} onDelete={remove} />)}
        </div>
        <button
          type="button"
          disabled={loading}
          onClick={() => layoutInputRef.current?.click()}
          className="px-2 py-1 bg-surface-raised text-rmpg-200 border border-surface-raised disabled:opacity-50">
          Upload Layout
        </button>
        <input
          ref={layoutInputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className="hidden"
          onChange={(e) => handleUpload(e.target.files?.[0], 'layout')}
        />
      </div>
    </div>
  );
}

export default RecordPhotoGallery;
