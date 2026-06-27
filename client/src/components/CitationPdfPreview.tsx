import { useState } from 'react';
import { useCitationPreview, type PreviewMode } from '../hooks/useCitationPreview';
import { useIsMobile } from '../hooks/useIsMobile';

interface Props {
  form: any;
  mode: PreviewMode;
  onModeChange: (m: PreviewMode) => void;
}

export function CitationPdfPreview({ form, mode, onModeChange }: Props) {
  const isMobile = useIsMobile();
  const effectiveMode: PreviewMode = isMobile ? 'modal' : mode;
  const { blobUrl, refresh, isRendering } = useCitationPreview(form, effectiveMode);
  const [modalOpen, setModalOpen] = useState(false);

  const openModal = () => {
    setModalOpen(true);
    void refresh();
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-1">
        <button
          type="button"
          onClick={openModal}
          disabled={isRendering}
          className="px-3 py-2 text-xs uppercase font-bold border border-rmpg-600 hover:border-[var(--brand-gold)] hover:text-[var(--brand-gold)]"
        >
          {isRendering ? 'Rendering…' : 'Preview'}
        </button>
        {!isMobile && (
          <>
            <button
              type="button"
              onClick={() => onModeChange('side')}
              aria-pressed={mode === 'side'}
              className={`px-3 py-2 text-xs border ${mode === 'side' ? 'border-[var(--brand-gold)] text-[var(--brand-gold)]' : 'border-rmpg-600 text-[var(--spm-text-muted)]'} hover:border-[var(--brand-gold)] hover:text-[var(--brand-gold)]`}
            >
              ◫ Side
            </button>
            <button
              type="button"
              onClick={() => onModeChange('full')}
              aria-pressed={mode === 'full'}
              className={`px-3 py-2 text-xs border ${mode === 'full' ? 'border-[var(--brand-gold)] text-[var(--brand-gold)]' : 'border-rmpg-600 text-[var(--spm-text-muted)]'} hover:border-[var(--brand-gold)] hover:text-[var(--brand-gold)]`}
            >
              ⛶ Full
            </button>
          </>
        )}
      </div>

      {effectiveMode === 'side' && blobUrl && (
        <iframe
          src={blobUrl}
          title="Citation preview"
          className="w-full h-[600px] border border-border-default bg-white"
        />
      )}

      {modalOpen && blobUrl && (
        <div
          className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4"
          onClick={() => setModalOpen(false)}
        >
          <iframe
            src={blobUrl}
            title="Citation preview"
            className="w-full h-full max-w-4xl bg-white"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </div>
  );
}
