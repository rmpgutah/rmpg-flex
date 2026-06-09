import { Lock, LockOpen } from 'lucide-react';
import { Annotation, BatesConfig, DocumentMeta, PageNumbersConfig, WatermarkConfig, StampLabel } from '../types';

const STAMPS: StampLabel[] = ['CONFIDENTIAL', 'EVIDENCE', 'COPY', 'ORIGINAL', 'DRAFT', 'APPROVED', 'VOID', 'FILED', 'RECEIVED'];

// Quick-pick color presets surfaced in the properties panel (Spillman palette —
// neutral grays + gold + muted red/green, no bright blue).
const COLOR_PRESETS = ['#0a0a0a', '#555555', '#999999', '#d4a017', '#8a1c1c', '#1c5a2e'];

interface Props {
  annotation: Annotation | null;
  onChange: (a: Annotation) => void;
  onDelete: () => void;
  bates: BatesConfig | null;
  onBatesChange: (b: BatesConfig | null) => void;
  watermark: WatermarkConfig | null;
  onWatermarkChange: (w: WatermarkConfig | null) => void;
  pageNumbers?: PageNumbersConfig | null;
  onPageNumbersChange?: (p: PageNumbersConfig | null) => void;
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

      {p.onPageNumbersChange && (
        <Section title="Page Numbers">
          <PageNumbersEditor cfg={p.pageNumbers ?? null} onChange={p.onPageNumbersChange} />
        </Section>
      )}

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
  const supportsColor = ann.type === 'rect' || ann.type === 'ellipse' || ann.type === 'line' || ann.type === 'pen'
    || ann.type === 'text' || ann.type === 'stamp' || ann.type === 'polygon' || ann.type === 'cloud'
    || ann.type === 'check' || ann.type === 'cross';
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="text-[10px] text-rmpg-300">Type: <span className="text-white font-mono">{ann.type}</span></div>
        <button type="button" onClick={() => onChange({ ...ann, locked: !ann.locked })}
          title={ann.locked ? 'Unlock annotation' : 'Lock annotation (blocks move/resize/delete)'}
          className={`inline-flex items-center gap-1 px-1.5 py-0.5 text-[9px] rounded-sm border ${ann.locked ? 'bg-[#d4a017]/20 text-[#d4a017] border-[#d4a017]' : 'border-[#222] text-rmpg-400 hover:text-white'}`}>
          {ann.locked ? <Lock className="w-3 h-3" /> : <LockOpen className="w-3 h-3" />}
          {ann.locked ? 'Locked' : 'Lock'}
        </button>
      </div>
      <div className="text-[10px] text-rmpg-300">Page: <span className="text-white font-mono">{ann.page}</span></div>
      {ann.type === 'text' && (
        <>
          <label className={labelCls}>Text</label>
          <textarea id="ff-propertiespanel-0" value={ann.text} onChange={e => onChange({ ...ann, text: e.target.value })} rows={3} className={inputCls} />
          <div className="flex gap-1">
            <div className="flex-1">
              <label className={labelCls}>Font size</label>
              <input id="ff-propertiespanel-1" type="number" min={6} max={96} value={ann.fontSize} onChange={e => onChange({ ...ann, fontSize: Math.max(6, parseInt(e.target.value, 10) || 14) })} className={inputCls} />
            </div>
            <div className="flex-1">
              <label className={labelCls}>Font</label>
              <select id="ff-propertiespanel-font" value={ann.fontFamily ?? 'helvetica'} onChange={e => onChange({ ...ann, fontFamily: e.target.value as 'helvetica' | 'times' | 'courier' })} className={inputCls}>
                <option value="helvetica">Helvetica</option>
                <option value="times">Times</option>
                <option value="courier">Courier</option>
              </select>
            </div>
          </div>
          <div className="flex gap-1">
            <button type="button" onClick={() => onChange({ ...ann, fontSize: Math.max(6, ann.fontSize - 2) })} className="px-2 py-1 text-xs rounded-sm border border-[#222] text-rmpg-400 hover:text-white" title="Decrease font size">A−</button>
            <button type="button" onClick={() => onChange({ ...ann, fontSize: Math.min(96, ann.fontSize + 2) })} className="px-2 py-1 text-xs rounded-sm border border-[#222] text-rmpg-400 hover:text-white" title="Increase font size">A+</button>
            <button type="button" onClick={() => onChange({ ...ann, bold: !ann.bold })} className={`flex-1 px-2 py-1 text-xs rounded-sm border font-bold ${ann.bold ? 'bg-[#d4a017]/20 text-[#d4a017] border-[#d4a017]' : 'border-[#222] text-rmpg-400'}`}>B</button>
            <button type="button" onClick={() => onChange({ ...ann, italic: !ann.italic })} className={`flex-1 px-2 py-1 text-xs rounded-sm border italic ${ann.italic ? 'bg-[#d4a017]/20 text-[#d4a017] border-[#d4a017]' : 'border-[#222] text-rmpg-400'}`}>I</button>
          </div>
        </>
      )}
      {ann.type === 'stamp' && (
        <>
          <label className={labelCls}>Stamp</label>
          <select id="ff-propertiespanel-2" value={ann.label} onChange={e => onChange({ ...ann, label: e.target.value })} className={inputCls}>
            {STAMPS.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </>
      )}
      {supportsColor && (
        <>
          <label className={labelCls}>Stroke color</label>
          <input id="ff-propertiespanel-3" type="color" value={ann.color ?? '#0a0a0a'} onChange={e => onChange({ ...ann, color: e.target.value })} className="w-full h-7 bg-transparent border border-[#222] rounded-sm cursor-pointer" />
          <div className="flex flex-wrap gap-1 pt-1">
            {COLOR_PRESETS.map(c => (
              <button key={c} type="button" onClick={() => onChange({ ...ann, color: c })}
                aria-label={`Use color ${c}`} title={c}
                className={`w-5 h-5 rounded-sm border ${(ann.color ?? '#0a0a0a').toLowerCase() === c ? 'border-[#d4a017]' : 'border-[#333]'}`}
                style={{ background: c }} />
            ))}
          </div>
        </>
      )}
      {(ann.type === 'rect' || ann.type === 'ellipse' || ann.type === 'line' || ann.type === 'pen' || ann.type === 'polygon' || ann.type === 'cloud' || ann.type === 'check' || ann.type === 'cross') && (
        <>
          <label className={labelCls}>Stroke width</label>
          <input id="ff-propertiespanel-4" type="number" min={1} max={20} value={ann.strokeWidth ?? 1.5} onChange={e => onChange({ ...ann, strokeWidth: Math.max(1, parseFloat(e.target.value) || 1) })} className={inputCls} />
        </>
      )}
      <label className={labelCls}>Opacity</label>
      <input id="ff-propertiespanel-5" type="range" min={0.1} max={1} step={0.05} value={ann.opacity ?? 1} onChange={e => onChange({ ...ann, opacity: parseFloat(e.target.value) })} className="w-full accent-[#d4a017]" />
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
        <input id="ff-propertiespanel-6" type="checkbox" checked={enabled} onChange={e => onChange(e.target.checked ? cfg : null)} />
        Enable Bates numbering
      </label>
      {enabled && bates && (
        <div className="space-y-1.5 pl-1 mt-1">
          <input id="ff-propertiespanel-7" value={bates.prefix} onChange={e => onChange({ ...bates, prefix: e.target.value })} placeholder="Prefix" className={inputCls} />
          <div className="flex gap-1">
            <input id="ff-propertiespanel-8" type="number" min={1} value={bates.startNumber} onChange={e => onChange({ ...bates, startNumber: parseInt(e.target.value, 10) || 1 })} placeholder="Start" className={inputCls} />
            <input id="ff-propertiespanel-9" type="number" min={1} max={10} value={bates.padding} onChange={e => onChange({ ...bates, padding: parseInt(e.target.value, 10) || 5 })} placeholder="Pad" className={inputCls} />
          </div>
          <select id="ff-propertiespanel-10" value={bates.position} onChange={e => onChange({ ...bates, position: e.target.value as BatesConfig['position'] })} className={inputCls}>
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
        <input id="ff-propertiespanel-11" type="checkbox" checked={enabled} onChange={e => onChange(e.target.checked ? cfg : null)} />
        Enable watermark
      </label>
      {enabled && wm && (
        <div className="space-y-1.5 pl-1 mt-1">
          <input id="ff-propertiespanel-12" value={wm.text} onChange={e => onChange({ ...wm, text: e.target.value })} placeholder="Watermark text" className={inputCls} />
          <label className={labelCls}>Placement</label>
          <div className="flex gap-1">
            <button type="button" onClick={() => onChange({ ...wm, mode: 'diagonal' })} className={`flex-1 px-2 py-1 text-[10px] rounded-sm border ${(wm.mode ?? 'diagonal') === 'diagonal' ? 'bg-[#d4a017]/20 text-[#d4a017] border-[#d4a017]' : 'border-[#222] text-rmpg-400'}`}>Diagonal</button>
            <button type="button" onClick={() => onChange({ ...wm, mode: 'tiled' })} className={`flex-1 px-2 py-1 text-[10px] rounded-sm border ${wm.mode === 'tiled' ? 'bg-[#d4a017]/20 text-[#d4a017] border-[#d4a017]' : 'border-[#222] text-rmpg-400'}`}>Tiled</button>
          </div>
          <label className={labelCls}>Opacity</label>
          <input id="ff-propertiespanel-13" type="range" min={0.05} max={0.5} step={0.05} value={wm.opacity} onChange={e => onChange({ ...wm, opacity: parseFloat(e.target.value) })} className="w-full accent-[#d4a017]" />
          <label className={labelCls}>Size {wm.fontSize}pt</label>
          <input id="ff-propertiespanel-14" type="range" min={24} max={160} value={wm.fontSize} onChange={e => onChange({ ...wm, fontSize: parseInt(e.target.value, 10) })} className="w-full accent-[#d4a017]" />
          <label className={labelCls}>Rotation {wm.rotation}°</label>
          <input id="ff-propertiespanel-15" type="range" min={-90} max={90} value={wm.rotation} onChange={e => onChange({ ...wm, rotation: parseInt(e.target.value, 10) })} className="w-full accent-[#d4a017]" />
          <label className={labelCls}>Image watermark (optional)</label>
          {wm.imageData ? (
            <div className="flex items-center gap-1">
              <img src={wm.imageData} alt="watermark" className="h-8 w-8 object-contain bg-white/5 border border-[#222] rounded-sm" />
              <button type="button" onClick={() => onChange({ ...wm, imageData: undefined })} className="text-[10px] text-red-300 hover:text-red-200">Remove</button>
            </div>
          ) : (
            <label className="block text-[10px] text-rmpg-400 border border-[#222] rounded-sm px-2 py-1 cursor-pointer hover:text-white text-center">
              Choose image…
              <input type="file" accept="image/png,image/jpeg" className="hidden" onChange={e => {
                const f = e.target.files?.[0]; e.target.value = '';
                if (!f) return;
                const r = new FileReader();
                r.onload = () => onChange({ ...wm, imageData: r.result as string });
                r.readAsDataURL(f);
              }} />
            </label>
          )}
        </div>
      )}
    </>
  );
}

function PageNumbersEditor({ cfg, onChange }: { cfg: PageNumbersConfig | null; onChange: (p: PageNumbersConfig | null) => void }) {
  const enabled = !!cfg;
  const current: PageNumbersConfig = cfg ?? { position: 'bc', fontSize: 9, format: 'Page {n} of {total}' };
  return (
    <>
      <label className="flex items-center gap-2 text-[10px] text-rmpg-300">
        <input id="ff-propertiespanel-pn0" type="checkbox" checked={enabled} onChange={e => onChange(e.target.checked ? current : null)} />
        Stamp “Page N of M” footer
      </label>
      {enabled && cfg && (
        <div className="space-y-1.5 pl-1 mt-1">
          <input id="ff-propertiespanel-pn1" value={cfg.format} onChange={e => onChange({ ...cfg, format: e.target.value })} placeholder="Page {n} of {total}" className={inputCls} />
          <div className="flex gap-1">
            <select id="ff-propertiespanel-pn2" value={cfg.position} onChange={e => onChange({ ...cfg, position: e.target.value as PageNumbersConfig['position'] })} className={inputCls}>
              <option value="bl">Bottom-left</option>
              <option value="bc">Bottom-center</option>
              <option value="br">Bottom-right</option>
            </select>
            <input id="ff-propertiespanel-pn3" type="number" min={6} max={24} value={cfg.fontSize} onChange={e => onChange({ ...cfg, fontSize: parseInt(e.target.value, 10) || 9 })} placeholder="Size" className={inputCls} />
          </div>
          <div className="text-[9px] text-rmpg-600">Tokens: {'{n}'} = page number, {'{total}'} = page count.</div>
        </div>
      )}
    </>
  );
}

function MetadataEditor({ meta, onChange }: { meta: DocumentMeta; onChange: (m: DocumentMeta) => void }) {
  return (
    <div className="space-y-1.5">
      <input id="ff-propertiespanel-16" value={meta.title ?? ''} onChange={e => onChange({ ...meta, title: e.target.value })} placeholder="Title" className={inputCls} />
      <input id="ff-propertiespanel-17" value={meta.author ?? ''} onChange={e => onChange({ ...meta, author: e.target.value })} placeholder="Author" className={inputCls} />
      <input id="ff-propertiespanel-18" value={meta.subject ?? ''} onChange={e => onChange({ ...meta, subject: e.target.value })} placeholder="Subject" className={inputCls} />
      <input id="ff-propertiespanel-19" value={meta.keywords ?? ''} onChange={e => onChange({ ...meta, keywords: e.target.value })} placeholder="Keywords (comma-separated)" className={inputCls} />
    </div>
  );
}
