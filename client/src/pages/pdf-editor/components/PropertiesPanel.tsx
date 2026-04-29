import { Annotation, BatesConfig, DocumentMeta, WatermarkConfig, StampLabel } from '../types';

const STAMPS: StampLabel[] = ['CONFIDENTIAL', 'EVIDENCE', 'COPY', 'ORIGINAL', 'DRAFT', 'APPROVED', 'VOID', 'FILED', 'RECEIVED'];

interface Props {
  annotation: Annotation | null;
  onChange: (a: Annotation) => void;
  onDelete: () => void;
  bates: BatesConfig | null;
  onBatesChange: (b: BatesConfig | null) => void;
  watermark: WatermarkConfig | null;
  onWatermarkChange: (w: WatermarkConfig | null) => void;
  meta: DocumentMeta;
  onMetaChange: (m: DocumentMeta) => void;
}

const labelCls = 'text-[9px] uppercase tracking-wider text-rmpg-500 block mb-0.5';
const inputCls = 'w-full bg-[#0a0a0a] border border-[#222] text-xs text-white px-2 py-1 rounded-sm focus:outline-none focus:border-[#d4a017]';

export default function PropertiesPanel(p: Props) {
  return (
    <div className="bg-[#0d0d0d] border border-[#222222] rounded-[2px] w-[260px] flex-shrink-0 p-3 space-y-4 overflow-y-auto">
      <Section title="Selection">
        {p.annotation ? <AnnotationProps ann={p.annotation} onChange={p.onChange} onDelete={p.onDelete} /> : (
          <div className="text-[10px] text-rmpg-500">Select an annotation to edit its properties.</div>
        )}
      </Section>

      <Section title="Bates Numbering">
        <BatesEditor bates={p.bates} onChange={p.onBatesChange} />
      </Section>

      <Section title="Watermark">
        <WatermarkEditor wm={p.watermark} onChange={p.onWatermarkChange} />
      </Section>

      <Section title="Document Properties">
        <MetadataEditor meta={p.meta} onChange={p.onMetaChange} />
      </Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[9px] uppercase tracking-wider text-[#d4a017] mb-2 font-semibold">{title}</div>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

function AnnotationProps({ ann, onChange, onDelete }: { ann: Annotation; onChange: (a: Annotation) => void; onDelete: () => void }) {
  return (
    <div className="space-y-2">
      <div className="text-[10px] text-rmpg-300">Type: <span className="text-white font-mono">{ann.type}</span></div>
      <div className="text-[10px] text-rmpg-300">Page: <span className="text-white font-mono">{ann.page}</span></div>
      {ann.type === 'text' && (
        <>
          <label className={labelCls}>Text</label>
          <textarea value={ann.text} onChange={e => onChange({ ...ann, text: e.target.value })} rows={3} className={inputCls} />
          <label className={labelCls}>Font size</label>
          <input type="number" min={6} max={96} value={ann.fontSize} onChange={e => onChange({ ...ann, fontSize: Math.max(6, parseInt(e.target.value, 10) || 14) })} className={inputCls} />
          <div className="flex gap-1">
            <button type="button" onClick={() => onChange({ ...ann, bold: !ann.bold })} className={`flex-1 px-2 py-1 text-xs rounded-sm border ${ann.bold ? 'bg-[#d4a017]/20 text-[#d4a017] border-[#d4a017]' : 'border-[#222] text-rmpg-400'}`}>Bold</button>
            <button type="button" onClick={() => onChange({ ...ann, italic: !ann.italic })} className={`flex-1 px-2 py-1 text-xs rounded-sm border ${ann.italic ? 'bg-[#d4a017]/20 text-[#d4a017] border-[#d4a017]' : 'border-[#222] text-rmpg-400'}`}>Italic</button>
          </div>
        </>
      )}
      {ann.type === 'stamp' && (
        <>
          <label className={labelCls}>Stamp</label>
          <select value={ann.label} onChange={e => onChange({ ...ann, label: e.target.value })} className={inputCls}>
            {STAMPS.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </>
      )}
      {(ann.type === 'rect' || ann.type === 'ellipse' || ann.type === 'line' || ann.type === 'pen' || ann.type === 'text' || ann.type === 'stamp') && (
        <>
          <label className={labelCls}>Stroke color</label>
          <input type="color" value={ann.color ?? '#0a0a0a'} onChange={e => onChange({ ...ann, color: e.target.value })} className="w-full h-7 bg-transparent border border-[#222] rounded-sm cursor-pointer" />
        </>
      )}
      {(ann.type === 'rect' || ann.type === 'ellipse' || ann.type === 'line' || ann.type === 'pen') && (
        <>
          <label className={labelCls}>Stroke width</label>
          <input type="number" min={1} max={20} value={ann.strokeWidth ?? 1.5} onChange={e => onChange({ ...ann, strokeWidth: Math.max(1, parseFloat(e.target.value) || 1) })} className={inputCls} />
        </>
      )}
      <label className={labelCls}>Opacity</label>
      <input type="range" min={0.1} max={1} step={0.05} value={ann.opacity ?? 1} onChange={e => onChange({ ...ann, opacity: parseFloat(e.target.value) })} className="w-full accent-[#d4a017]" />
      <button type="button" onClick={onDelete} className="w-full px-2 py-1 text-xs text-red-300 border border-red-900/40 hover:bg-red-900/20 rounded-sm">Delete annotation</button>
    </div>
  );
}

function BatesEditor({ bates, onChange }: { bates: BatesConfig | null; onChange: (b: BatesConfig | null) => void }) {
  const enabled = !!bates;
  const cfg: BatesConfig = bates ?? { prefix: 'RMPG-2026-', startNumber: 1, padding: 5, position: 'br', fontSize: 9 };
  return (
    <>
      <label className="flex items-center gap-2 text-[10px] text-rmpg-300">
        <input type="checkbox" checked={enabled} onChange={e => onChange(e.target.checked ? cfg : null)} />
        Enable Bates numbering
      </label>
      {enabled && bates && (
        <div className="space-y-1.5 pl-1 mt-1">
          <input value={bates.prefix} onChange={e => onChange({ ...bates, prefix: e.target.value })} placeholder="Prefix" className={inputCls} />
          <div className="flex gap-1">
            <input type="number" min={1} value={bates.startNumber} onChange={e => onChange({ ...bates, startNumber: parseInt(e.target.value, 10) || 1 })} placeholder="Start" className={inputCls} />
            <input type="number" min={1} max={10} value={bates.padding} onChange={e => onChange({ ...bates, padding: parseInt(e.target.value, 10) || 5 })} placeholder="Pad" className={inputCls} />
          </div>
          <select value={bates.position} onChange={e => onChange({ ...bates, position: e.target.value as BatesConfig['position'] })} className={inputCls}>
            <option value="tl">Top-left</option>
            <option value="tr">Top-right</option>
            <option value="bl">Bottom-left</option>
            <option value="br">Bottom-right</option>
          </select>
        </div>
      )}
    </>
  );
}

function WatermarkEditor({ wm, onChange }: { wm: WatermarkConfig | null; onChange: (w: WatermarkConfig | null) => void }) {
  const enabled = !!wm;
  const cfg: WatermarkConfig = wm ?? { text: 'CONFIDENTIAL', opacity: 0.18, fontSize: 96, rotation: 45 };
  return (
    <>
      <label className="flex items-center gap-2 text-[10px] text-rmpg-300">
        <input type="checkbox" checked={enabled} onChange={e => onChange(e.target.checked ? cfg : null)} />
        Enable watermark
      </label>
      {enabled && wm && (
        <div className="space-y-1.5 pl-1 mt-1">
          <input value={wm.text} onChange={e => onChange({ ...wm, text: e.target.value })} placeholder="Watermark text" className={inputCls} />
          <label className={labelCls}>Opacity</label>
          <input type="range" min={0.05} max={0.5} step={0.05} value={wm.opacity} onChange={e => onChange({ ...wm, opacity: parseFloat(e.target.value) })} className="w-full accent-[#d4a017]" />
          <label className={labelCls}>Size {wm.fontSize}pt</label>
          <input type="range" min={24} max={160} value={wm.fontSize} onChange={e => onChange({ ...wm, fontSize: parseInt(e.target.value, 10) })} className="w-full accent-[#d4a017]" />
          <label className={labelCls}>Rotation {wm.rotation}°</label>
          <input type="range" min={-90} max={90} value={wm.rotation} onChange={e => onChange({ ...wm, rotation: parseInt(e.target.value, 10) })} className="w-full accent-[#d4a017]" />
        </div>
      )}
    </>
  );
}

function MetadataEditor({ meta, onChange }: { meta: DocumentMeta; onChange: (m: DocumentMeta) => void }) {
  return (
    <div className="space-y-1.5">
      <input value={meta.title ?? ''} onChange={e => onChange({ ...meta, title: e.target.value })} placeholder="Title" className={inputCls} />
      <input value={meta.author ?? ''} onChange={e => onChange({ ...meta, author: e.target.value })} placeholder="Author" className={inputCls} />
      <input value={meta.subject ?? ''} onChange={e => onChange({ ...meta, subject: e.target.value })} placeholder="Subject" className={inputCls} />
      <input value={meta.keywords ?? ''} onChange={e => onChange({ ...meta, keywords: e.target.value })} placeholder="Keywords (comma-separated)" className={inputCls} />
    </div>
  );
}
