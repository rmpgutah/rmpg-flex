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
          className="px-3 py-2 text-xs uppercase font-bold border border-[#444] hover:border-[#d4a017] hover:text-[#d4a017]"
        >
          {isRendering ? 'Rendering…' : 'Preview'}
        </button>
        {!isMobile && (
          <>
            <button
              type="button"
              onClick={() => onModeChange('side')}
              aria-pressed={mode === 'side'}
              className={`px-3 py-2 text-xs border ${mode === 'side' ? 'border-[#d4a017] text-[#d4a017]' : 'border-[#444] text-[#888]'} hover:border-[#d4a017] hover:text-[#d4a017]`}
            >
              ◫ Side
            </button>
            <button
              type="button"
              onClick={() => onModeChange('full')}
              aria-pressed={mode === 'full'}
              className={`px-3 py-2 text-xs border ${mode === 'full' ? 'border-[#d4a017] text-[#d4a017]' : 'border-[#444] text-[#888]'} hover:border-[#d4a017] hover:text-[#d4a017]`}
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
          className="w-full h-[600px] border border-[#222] bg-white"
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
