import { Download } from 'lucide-react';

interface MapV2GpxExportButtonProps {
  /** Number of trails currently fetched — used to enable/disable + label */
  trailCount: number;
  onExport: () => void;
}

/**
 * GPX export button for the breadcrumb trails currently rendered.
 * Right-side floating chrome above the legend button. Disabled when
 * no trails are loaded; otherwise emits the GPX file via
 * utils/breadcrumbAnalysis.downloadGpx.
 */
export default function MapV2GpxExportButton({ trailCount, onExport }: MapV2GpxExportButtonProps) {
  const disabled = trailCount === 0;
  return (
    <button
      type="button"
      onClick={() => { if (!disabled) onExport(); }}
      disabled={disabled}
      title={disabled ? 'No breadcrumbs loaded' : `Download ${trailCount} trail(s) as GPX`}
      aria-label="Export breadcrumbs as GPX"
      className={
        'absolute right-2 z-20 p-1.5 bg-[#141414] border border-[#222222] hover:bg-[#1a1a1a] ' +
        (disabled ? 'text-[#444] cursor-not-allowed' : 'text-[#9ca3af]')
      }
      style={{ bottom: 162 }}
    >
      <Download className="w-4 h-4" aria-hidden="true" />
    </button>
  );
}
