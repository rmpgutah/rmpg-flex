import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Image, Search, X, ChevronLeft, ChevronRight, Download, MapPin } from 'lucide-react';
import { apiFetch, authedImageUrl } from '../../../hooks/useApi';
import { formatDate, formatDateTime } from '../../../utils/dateUtils';
import { copyToClipboard } from '../../../utils/clipboard';
import { fieldPhotosToCsv, downloadTextFile } from '../../../utils/rmsListExport';

interface FieldPhoto {
  id: number;
  filename?: string;
  original_filename?: string;
  created_at?: string;
  uploaded_at?: string;
  officer_name?: string;
  officer?: string;
  latitude?: number;
  longitude?: number;
  url?: string;
  r2_key?: string;
  signed_url?: string;
  thumbnail_url?: string;
}

interface Props {
  callId?: string;
  onClose?: () => void;
}

export default function DesktopEvidencePhotoViewer({ callId: propCallId, onClose: _onClose }: Props) {
  const [callIdInput, setCallIdInput] = useState(propCallId ?? '');
  const [activeCallId, setActiveCallId] = useState(propCallId ?? '');
  const [photos, setPhotos] = useState<FieldPhoto[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lightboxIdx, setLightboxIdx] = useState<number | null>(null);
  const [nameQ, setNameQ] = useState('');
  const overlayRef = useRef<HTMLDivElement>(null);

  const resolvePhotoUrl = useCallback(async (photo: FieldPhoto): Promise<string> => {
    if (photo.signed_url) return photo.signed_url;
    if (photo.url) return authedImageUrl(photo.url);
    if (photo.r2_key) return authedImageUrl(`/api/field-photos/file/${photo.r2_key}`);
    return '';
  }, []);

  const load = useCallback(async (id: string) => {
    if (!id.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const data = await apiFetch<FieldPhoto[] | { results?: FieldPhoto[] }>(`/field-photos?call_id=${encodeURIComponent(id)}&limit=50`);
      const list = Array.isArray(data) ? data : (data.results ?? []);
      setPhotos(list);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load photos');
      setPhotos([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (propCallId) void load(propCallId);
  }, [propCallId, load]);

  // Keyboard navigation for lightbox
  useEffect(() => {
    if (lightboxIdx === null) return;
    const visCount = nameQ.trim()
      ? photos.filter((p) => (p.original_filename ?? p.filename ?? `photo-${p.id}`).toLowerCase().includes(nameQ.trim().toLowerCase())).length
      : photos.length;
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setLightboxIdx(null);
      if (e.key === 'ArrowLeft') setLightboxIdx(i => i !== null ? Math.max(0, i - 1) : null);
      if (e.key === 'ArrowRight') setLightboxIdx(i => i !== null ? Math.min(visCount - 1, i + 1) : null);
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [lightboxIdx, photos, nameQ]);

  const handleSearch = () => {
    setActiveCallId(callIdInput.trim());
    void load(callIdInput.trim());
  };

  const photoFilename = (p: FieldPhoto) => p.original_filename ?? p.filename ?? `photo-${p.id}`;
  const photoDate = (p: FieldPhoto) => p.created_at ?? p.uploaded_at;
  const visiblePhotos = nameQ.trim()
    ? photos.filter((p) => photoFilename(p).toLowerCase().includes(nameQ.trim().toLowerCase()))
    : photos;

  const currentPhoto = lightboxIdx !== null ? visiblePhotos[lightboxIdx] : null;
  const [currentUrl, setCurrentUrl] = useState<string>('');

  useEffect(() => {
    if (currentPhoto) {
      resolvePhotoUrl(currentPhoto).then(setCurrentUrl).catch(() => setCurrentUrl(''));
    }
  }, [currentPhoto, resolvePhotoUrl]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--surface-base)' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', background: 'var(--surface-raised)', borderBottom: '1px solid var(--border-default)', flexShrink: 0 }}>
        <Image size={13} style={{ color: 'var(--accent-silver-400)' }} />
        <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-primary)', flex: 1 }}>
          Evidence Photo Viewer{activeCallId ? ` — Call #${activeCallId}` : ''}
        </span>
      </div>

      {/* Search input if no prop callId */}
      {!propCallId && (
        <div style={{ display: 'flex', gap: 8, padding: '8px 12px', borderBottom: '1px solid var(--border-default)', background: 'var(--surface-base)', flexShrink: 0 }}>
          <input
            type="text"
            placeholder="Enter Call ID…"
            value={callIdInput}
            onChange={e => setCallIdInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleSearch()}
            style={{ flex: 1, fontSize: 11, padding: '4px 8px', background: 'var(--surface-sunken)', border: '1px solid var(--border-default)', color: 'var(--text-primary)', borderRadius: 2, outline: 'none' }}
          />
          <button
            type="button"
            onClick={handleSearch}
            disabled={loading || !callIdInput.trim()}
            style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, padding: '4px 12px', borderRadius: 2, border: '1px solid var(--accent-silver-400)', cursor: 'pointer', background: 'none', color: 'var(--text-primary)', fontWeight: 700 }}
          >
            <Search size={11} /> Load
          </button>
          <input
            type="search"
            value={nameQ}
            onChange={(e) => setNameQ(e.target.value)}
            placeholder="Filter filename…"
            aria-label="Filter photos by filename"
            style={{ width: 140, fontSize: 11, padding: '4px 8px', background: 'var(--surface-sunken)', border: '1px solid var(--border-default)', color: 'var(--text-primary)' }}
          />
          <button
            type="button"
            disabled={photos.length === 0}
            onClick={() => downloadTextFile('field-photos.csv', fieldPhotosToCsv(photos))}
            style={{ fontSize: 11, padding: '4px 10px', border: '1px solid var(--border-default)', background: 'none', color: 'var(--text-primary)', cursor: 'pointer' }}
          >CSV</button>
        </div>
      )}

      {/* Photo grid */}
      <div style={{ flex: 1, overflow: 'auto', padding: 12 }}>
        {loading && <p style={{ textAlign: 'center', marginTop: 40, fontSize: 11, color: 'var(--text-secondary)' }}>Loading…</p>}
        {error && (
          <p style={{ textAlign: 'center', marginTop: 40, fontSize: 11, color: 'var(--sev-critical)' }}>
            {error}{' '}
            <button type="button" onClick={() => void load(activeCallId || callIdInput)} style={{ fontSize: 10, marginLeft: 8, border: '1px solid var(--border-default)', background: 'none', color: 'var(--text-primary)', cursor: 'pointer' }}>Retry</button>
          </p>
        )}
        {!loading && !error && photos.length === 0 && activeCallId && (
          <p style={{ textAlign: 'center', marginTop: 40, fontSize: 11, color: 'var(--text-secondary)' }}>No photos attached to this call</p>
        )}
        {!loading && !error && photos.length > 0 && visiblePhotos.length === 0 && (
          <p style={{ textAlign: 'center', marginTop: 40, fontSize: 11, color: 'var(--text-secondary)' }}>No photos match the filename filter</p>
        )}
        {!loading && !activeCallId && !propCallId && (
          <p style={{ textAlign: 'center', marginTop: 60, fontSize: 11, color: 'var(--text-secondary)' }}>Enter a call ID to view its evidence photos</p>
        )}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
          {visiblePhotos.map((p, i) => (
            <div
              key={p.id}
              onClick={() => setLightboxIdx(i)}
              style={{ cursor: 'pointer', border: '1px solid var(--border-default)', borderRadius: 2, overflow: 'hidden', background: 'var(--surface-raised)' }}
            >
              <PhotoThumb photo={p} resolveUrl={resolvePhotoUrl} />
              <div style={{ padding: '4px 6px' }}>
                <div style={{ fontSize: 9, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{photoFilename(p)}</div>
                <button type="button" onClick={(e) => { e.stopPropagation(); void copyToClipboard(photoFilename(p)); }} style={{ fontSize: 8, border: '1px solid var(--border-default)', background: 'none', color: 'var(--text-secondary)', cursor: 'pointer' }}>Copy name</button>
                {photoDate(p) && <div style={{ fontSize: 8, color: 'var(--text-secondary)' }}>{formatDate(photoDate(p))}</div>}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Lightbox */}
      {lightboxIdx !== null && currentPhoto && (
        <div
          ref={overlayRef}
          onClick={e => { if (e.target === overlayRef.current) setLightboxIdx(null); }}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0 0 0 / 0.88)', zIndex: 30000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
        >
          {/* Close */}
          <button
            aria-label="Close photo viewer"
            onClick={() => setLightboxIdx(null)}
            style={{ position: 'absolute', top: 12, right: 12, background: 'none', border: 'none', cursor: 'pointer', color: '#fff' }}
          ><X size={22} /></button>

          {/* Prev */}
          {lightboxIdx > 0 && (
            <button
              aria-label="Previous photo"
              onClick={() => setLightboxIdx(i => i !== null ? i - 1 : null)}
              style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', background: 'rgba(0 0 0 / 0.5)', border: '1px solid rgba(255,255,255,0.2)', borderRadius: 2, cursor: 'pointer', color: '#fff', padding: 8 }}
            ><ChevronLeft size={20} /></button>
          )}

          {/* Next */}
          {lightboxIdx < photos.length - 1 && (
            <button
              aria-label="Next photo"
              onClick={() => setLightboxIdx(i => i !== null ? i + 1 : null)}
              style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', background: 'rgba(0 0 0 / 0.5)', border: '1px solid rgba(255,255,255,0.2)', borderRadius: 2, cursor: 'pointer', color: '#fff', padding: 8 }}
            ><ChevronRight size={20} /></button>
          )}

          {/* Main image */}
          <img
            src={currentUrl}
            alt={photoFilename(currentPhoto)}
            style={{ maxWidth: '72vw', maxHeight: '80vh', objectFit: 'contain', borderRadius: 2 }}
          />

          {/* Metadata sidebar */}
          <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, padding: '12px 20px', background: 'rgba(0 0 0 / 0.7)', display: 'flex', gap: 20, alignItems: 'center', flexWrap: 'wrap' }}>
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#fff' }}>{photoFilename(currentPhoto)}</div>
              {photoDate(currentPhoto) && <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.6)' }}>{formatDateTime(photoDate(currentPhoto))}</div>}
            </div>
            {(currentPhoto.officer_name ?? currentPhoto.officer) && (
              <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.7)' }}>
                Officer: {currentPhoto.officer_name ?? currentPhoto.officer}
              </div>
            )}
            {currentPhoto.latitude && currentPhoto.longitude && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, color: 'rgba(255,255,255,0.7)' }}>
                <MapPin size={10} />
                {currentPhoto.latitude.toFixed(5)}, {currentPhoto.longitude.toFixed(5)}
              </div>
            )}
            <div style={{ marginLeft: 'auto' }}>
              <button
                type="button"
                onClick={() => currentUrl && window.open(currentUrl, '_blank')}
                style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 10, padding: '4px 12px', borderRadius: 2, border: '1px solid rgba(255,255,255,0.3)', cursor: 'pointer', background: 'rgba(255,255,255,0.1)', color: '#fff' }}
              >
                <Download size={10} /> Download
              </button>
            </div>
            <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)' }}>
              {lightboxIdx + 1} / {photos.length}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function PhotoThumb({ photo, resolveUrl }: { photo: FieldPhoto; resolveUrl: (p: FieldPhoto) => Promise<string> }) {
  const [src, setSrc] = useState<string>('');
  useEffect(() => {
    resolveUrl(photo).then(setSrc).catch(() => setSrc(''));
  }, [photo, resolveUrl]);

  return (
    <div style={{ height: 110, background: 'var(--surface-sunken)', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
      {src ? (
        <img src={src} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
      ) : (
        <Image size={24} style={{ color: 'var(--border-default)' }} />
      )}
    </div>
  );
}
