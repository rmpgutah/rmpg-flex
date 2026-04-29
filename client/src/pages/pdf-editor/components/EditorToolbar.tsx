import { Upload, Save, FilePlus, Combine, FileText, Settings2, Undo2, Redo2, ZoomIn, ZoomOut, Maximize2, Stamp, FolderUp, Lock, LockOpen } from 'lucide-react';
import IconButton from '../../../components/IconButton';

interface Props {
  fileName: string;
  hasDocument: boolean;
  canUndo: boolean;
  canRedo: boolean;
  zoom: number;
  onOpen: () => void;
  onMerge: () => void;
  onSave: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onZoomReset: () => void;
  onMetadata: () => void;
  onBates: () => void;
  onWatermark: () => void;
  onSaveToDocuments?: () => void;
  onEncrypt?: () => void;
  encryptionActive?: boolean;
  onClearEncryption?: () => void;
  saving: boolean;
}

export default function EditorToolbar(p: Props) {
  const btn = 'p-1.5 rounded-sm text-rmpg-300 hover:text-white hover:bg-rmpg-700/60 transition-colors disabled:opacity-30 disabled:hover:bg-transparent';
  return (
    <div className="flex items-center gap-1 bg-[#141414] border border-[#222222] rounded-[2px] px-2 py-1.5 flex-shrink-0">
      <IconButton onClick={p.onOpen} aria-label="Open PDF" title="Open PDF" className={btn}><Upload className="w-4 h-4" /></IconButton>
      <IconButton onClick={p.onMerge} aria-label="Merge PDFs" title="Merge multiple PDFs into one" className={btn}><Combine className="w-4 h-4" /></IconButton>
      <span className="text-xs text-rmpg-400 truncate max-w-[260px] px-2" title={p.fileName}>{p.fileName || 'No document open'}</span>

      <div className="w-px h-5 bg-[#222222] mx-1" />

      <IconButton onClick={p.onUndo} aria-label="Undo" title="Undo (Ctrl+Z)" className={btn} disabled={!p.canUndo}><Undo2 className="w-4 h-4" /></IconButton>
      <IconButton onClick={p.onRedo} aria-label="Redo" title="Redo (Ctrl+Y)" className={btn} disabled={!p.canRedo}><Redo2 className="w-4 h-4" /></IconButton>

      <div className="w-px h-5 bg-[#222222] mx-1" />

      <IconButton onClick={p.onZoomOut} aria-label="Zoom out" title="Zoom out" className={btn} disabled={!p.hasDocument}><ZoomOut className="w-4 h-4" /></IconButton>
      <button type="button" onClick={p.onZoomReset} disabled={!p.hasDocument}
        className="px-2 py-1 text-[10px] text-rmpg-300 hover:text-white hover:bg-rmpg-700/60 rounded-sm disabled:opacity-30 min-w-[48px]"
        title="Reset zoom"
      >{Math.round(p.zoom * 100)}%</button>
      <IconButton onClick={p.onZoomIn} aria-label="Zoom in" title="Zoom in" className={btn} disabled={!p.hasDocument}><ZoomIn className="w-4 h-4" /></IconButton>
      <IconButton onClick={p.onZoomReset} aria-label="Fit width" title="Fit to width" className={btn} disabled={!p.hasDocument}><Maximize2 className="w-4 h-4" /></IconButton>

      <div className="w-px h-5 bg-[#222222] mx-1" />

      <IconButton onClick={p.onBates} aria-label="Bates numbering" title="Bates numbering" className={btn} disabled={!p.hasDocument}><Stamp className="w-4 h-4" /></IconButton>
      <IconButton onClick={p.onWatermark} aria-label="Watermark" title="Watermark" className={btn} disabled={!p.hasDocument}><FileText className="w-4 h-4" /></IconButton>
      <IconButton onClick={p.onMetadata} aria-label="Document properties" title="Document properties" className={btn} disabled={!p.hasDocument}><Settings2 className="w-4 h-4" /></IconButton>
      {p.onEncrypt && (
        <IconButton
          onClick={p.encryptionActive ? p.onClearEncryption ?? p.onEncrypt : p.onEncrypt}
          aria-label={p.encryptionActive ? 'Encryption configured (click to clear)' : 'Encrypt PDF on next save'}
          title={p.encryptionActive ? 'Encryption configured — click to clear' : 'Encrypt PDF on next save'}
          className={`p-1.5 rounded-sm transition-colors ${p.encryptionActive ? 'bg-[#d4a017]/20 text-[#d4a017]' : 'text-rmpg-300 hover:text-white hover:bg-rmpg-700/60'}`}
          disabled={!p.hasDocument}
        >
          {p.encryptionActive ? <Lock className="w-4 h-4" /> : <LockOpen className="w-4 h-4" />}
        </IconButton>
      )}

      <div className="flex-1" />

      {p.onSaveToDocuments && (
        <button type="button" onClick={p.onSaveToDocuments} disabled={!p.hasDocument || p.saving} className="btn-secondary inline-flex items-center gap-1 disabled:opacity-50" title="Save edited PDF as a new file in Documents">
          <FolderUp className="w-3.5 h-3.5" />
          Save to Documents
        </button>
      )}
      <button type="button" onClick={p.onSave} disabled={!p.hasDocument || p.saving} className="btn-primary inline-flex items-center gap-1 disabled:opacity-50">
        {p.saving ? <FilePlus className="w-3.5 h-3.5 animate-pulse" /> : <Save className="w-3.5 h-3.5" />}
        {p.saving ? 'Building…' : 'Download copy'}
      </button>
    </div>
  );
}
