import { useState } from 'react';
import { Lock, LockOpen, MessageSquare, RotateCw, Trash2 } from 'lucide-react';
import { Annotation, AnnotationReply, BatesConfig, DocumentMeta, PageNumbersConfig, WatermarkConfig, StampLabel, StickyCategory, STICKY_CATEGORIES } from '../types';
import { safeDateTimeStr } from '../../../utils/dateUtils';

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
const inputCls = 'w-full bg-surface-sunken border border-border-default text-xs text-rmpg-100 px-2 py-1 rounded-sm focus:outline-none focus:border-[#d4a017]';

export default function PropertiesPanel(p: Props) {
  return (
    <div className="bg-surface-base border border-border-default rounded-[2px] w-[260px] flex-shrink-0 p-3 space-y-4 overflow-y-auto">
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
        <div className="text-[10px] text-rmpg-300">Type: <span className="text-rmpg-100 font-mono">{ann.type}</span></div>
        <button type="button" onClick={() => onChange({ ...ann, locked: !ann.locked })}
          title={ann.locked ? 'Unlock annotation' : 'Lock annotation (blocks move/resize/delete)'}
          className={`inline-flex items-center gap-1 px-1.5 py-0.5 text-[9px] rounded-sm border ${ann.locked ? 'bg-[#d4a017]/20 text-[#d4a017] border-[#d4a017]' : 'border-border-default text-rmpg-400 hover:text-rmpg-100'}`}>
          {ann.locked ? <Lock className="w-3 h-3" /> : <LockOpen className="w-3 h-3" />}
          {ann.locked ? 'Locked' : 'Lock'}
        </button>
      </div>
      <div className="text-[10px] text-rmpg-300">Page: <span className="text-rmpg-100 font-mono">{ann.page}</span></div>
      {ann.type === 'text' && (
        <>
          <label htmlFor="ff-propertiespanel-0" className={labelCls}>Text</label>
          <textarea id="ff-propertiespanel-0" value={ann.text} onChange={e => onChange({ ...ann, text: e.target.value })} rows={3} className={inputCls} />
          <div className="flex gap-1">
            <div className="flex-1">
              <label htmlFor="ff-propertiespanel-1" className={labelCls}>Font size</label>
              <input id="ff-propertiespanel-1" type="number" min={6} max={96} value={ann.fontSize} onChange={e => onChange({ ...ann, fontSize: Math.max(6, parseInt(e.target.value, 10) || 14) })} className={inputCls} />
            </div>
            <div className="flex-1">
              <label htmlFor="ff-propertiespanel-font" className={labelCls}>Font</label>
              <select id="ff-propertiespanel-font" value={ann.fontFamily ?? 'helvetica'} onChange={e => onChange({ ...ann, fontFamily: e.target.value as 'helvetica' | 'times' | 'courier' })} className={inputCls}>
                <option value="helvetica">Helvetica</option>
                <option value="times">Times</option>
                <option value="courier">Courier</option>
              </select>
            </div>
          </div>
          <div className="flex gap-1">
            <button type="button" onClick={() => onChange({ ...ann, fontSize: Math.max(6, ann.fontSize - 2) })} className="px-2 py-1 text-xs rounded-sm border border-border-default text-rmpg-400 hover:text-rmpg-100" title="Decrease font size">A−</button>
            <button type="button" onClick={() => onChange({ ...ann, fontSize: Math.min(96, ann.fontSize + 2) })} className="px-2 py-1 text-xs rounded-sm border border-border-default text-rmpg-400 hover:text-rmpg-100" title="Increase font size">A+</button>
            <button type="button" onClick={() => onChange({ ...ann, bold: !ann.bold })} className={`flex-1 px-2 py-1 text-xs rounded-sm border font-bold ${ann.bold ? 'bg-[#d4a017]/20 text-[#d4a017] border-[#d4a017]' : 'border-border-default text-rmpg-400'}`}>B</button>
            <button type="button" onClick={() => onChange({ ...ann, italic: !ann.italic })} className={`flex-1 px-2 py-1 text-xs rounded-sm border italic ${ann.italic ? 'bg-[#d4a017]/20 text-[#d4a017] border-[#d4a017]' : 'border-border-default text-rmpg-400'}`}>I</button>
          </div>
        </>
      )}
      {ann.type === 'text' && (
        <>
          <label htmlFor="ff-propertiespanel-url" className={labelCls}>Hyperlink (optional)</label>
          <input id="ff-propertiespanel-url" value={ann.url ?? ''} onChange={e => onChange({ ...ann, url: e.target.value || undefined })}
            placeholder="https://…  ·  mailto:…  ·  #page=3" className={inputCls} />
          <div className="text-[9px] text-rmpg-600">Makes the text a clickable link in the saved interactive PDF.</div>
        </>
      )}
      {(ann.type === 'text' || ann.type === 'highlight') && (
        <label htmlFor="ff-propertiespanel-border" className="flex items-center gap-2 text-[10px] text-rmpg-300 pt-1">
          <input id="ff-propertiespanel-border" type="checkbox" checked={ann.showBorder ?? false} onChange={e => onChange({ ...ann, showBorder: e.target.checked })} />
          Show border around box
        </label>
      )}
      {ann.type === 'sticky' && (
        <StickyCategoryPicker ann={ann} onChange={onChange} />
      )}
      {ann.type === 'redact' && (
        <RedactOptions ann={ann} onChange={onChange} />
      )}
      {(ann.type === 'sticky' || ann.type === 'text') && (
        <RepliesEditor ann={ann} onChange={onChange} />
      )}
      {ann.type === 'stamp' && (
        <>
          <label htmlFor="ff-propertiespanel-2" className={labelCls}>Stamp</label>
          <select id="ff-propertiespanel-2" value={ann.label} onChange={e => onChange({ ...ann, label: e.target.value })} className={inputCls}>
            {STAMPS.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </>
      )}
      {supportsColor && (
        <>
          <label htmlFor="ff-propertiespanel-3" className={labelCls}>Stroke color</label>
          <input id="ff-propertiespanel-3" type="color" value={ann.color ?? '#0a0a0a'} onChange={e => onChange({ ...ann, color: e.target.value })} className="w-full h-7 bg-transparent border border-border-default rounded-sm cursor-pointer" />
          <div className="flex flex-wrap gap-1 pt-1">
            {COLOR_PRESETS.map(c => (
              <button key={c} type="button" onClick={() => onChange({ ...ann, color: c })}
                aria-label={`Use color ${c}`} title={c}
                className={`w-5 h-5 rounded-sm border ${(ann.color ?? '#0a0a0a').toLowerCase() === c ? 'border-[#d4a017]' : 'border-border-subtle'}`}
                style={{ background: c }} />
            ))}
          </div>
        </>
      )}
      {(ann.type === 'rect' || ann.type === 'ellipse' || ann.type === 'line' || ann.type === 'pen' || ann.type === 'polygon' || ann.type === 'cloud' || ann.type === 'check' || ann.type === 'cross') && (
        <>
          <label htmlFor="ff-propertiespanel-4" className={labelCls}>Stroke width</label>
          <input id="ff-propertiespanel-4" type="number" min={1} max={20} value={ann.strokeWidth ?? 1.5} onChange={e => onChange({ ...ann, strokeWidth: Math.max(1, parseFloat(e.target.value) || 1) })} className={inputCls} />
        </>
      )}
      {(ann.type === 'rect' || ann.type === 'ellipse' || ann.type === 'line') && (
        <>
          <label htmlFor="ff-propertiespanel-8" className={labelCls}>Line style</label>
          <div className="flex gap-1">
            {(['solid', 'dashed', 'dotted'] as const).map(s => (
              <button key={s} type="button" onClick={() => onChange({ ...ann, strokeStyle: s })}
                className={`flex-1 px-2 py-1 text-[10px] capitalize rounded-sm border ${(ann.strokeStyle ?? 'solid') === s ? 'bg-[#d4a017]/20 text-[#d4a017] border-[#d4a017]' : 'border-border-default text-rmpg-400'}`}>
                {s}
              </button>
            ))}
          </div>
        </>
      )}
      {(ann.type === 'formText' || ann.type === 'formCheck') && (
        <>
          <label htmlFor="ff-propertiespanel-ff0" className={labelCls}>Field name</label>
          <input id="ff-propertiespanel-ff0" value={ann.fieldName} onChange={e => onChange({ ...ann, fieldName: e.target.value })} placeholder="field_name" className={inputCls} />
          {ann.type === 'formText' ? (
            <>
              <label htmlFor="ff-propertiespanel-ff1" className={labelCls}>Default value</label>
              <input id="ff-propertiespanel-ff1" value={ann.defaultValue ?? ''} onChange={e => onChange({ ...ann, defaultValue: e.target.value })} placeholder="(empty)" className={inputCls} />
            </>
          ) : (
            <label htmlFor="ff-propertiespanel-ff2" className="flex items-center gap-2 text-[10px] text-rmpg-300 pt-1">
              <input id="ff-propertiespanel-ff2" type="checkbox" checked={ann.defaultChecked ?? false} onChange={e => onChange({ ...ann, defaultChecked: e.target.checked })} />
              Checked by default
            </label>
          )}
          <div className="text-[9px] text-rmpg-600">Saved as an interactive AcroForm widget — use "Save interactive PDF".</div>
        </>
      )}
      {supportsRotation(ann) && (
        <>
          <label htmlFor="ff-propertiespanel-rot" className={labelCls}>Rotation {Math.round(ann.rotation ?? 0)}°</label>
          <div className="flex items-center gap-1">
            <input id="ff-propertiespanel-rot" type="range" min={-180} max={180} step={1} value={ann.rotation ?? 0}
              onChange={e => onChange({ ...ann, rotation: parseInt(e.target.value, 10) })} className="flex-1 accent-[#d4a017]" />
            <button type="button" onClick={() => onChange({ ...ann, rotation: snap90(ann.rotation ?? 0) })}
              title="Rotate 90° clockwise" aria-label="Rotate 90 degrees clockwise"
              className="p-1 rounded-sm border border-border-default text-rmpg-400 hover:text-rmpg-100"><RotateCw className="w-3 h-3" /></button>
            <button type="button" onClick={() => onChange({ ...ann, rotation: 0 })}
              className="px-1.5 py-1 text-[9px] rounded-sm border border-border-default text-rmpg-400 hover:text-rmpg-100" title="Reset rotation">0°</button>
          </div>
        </>
      )}
      <label htmlFor="ff-propertiespanel-5" className={labelCls}>Opacity</label>
      <input id="ff-propertiespanel-5" type="range" min={0.1} max={1} step={0.05} value={ann.opacity ?? 1} onChange={e => onChange({ ...ann, opacity: parseFloat(e.target.value) })} className="w-full accent-[#d4a017]" />
      <button type="button" onClick={onDelete} className="w-full px-2 py-1 text-xs text-red-300 border border-red-900/40 hover:bg-red-900/20 rounded-sm">Delete annotation</button>
    </div>
  );
}

/** Box-like annotations support a visual rotation. Free-path geometry (pen,
 *  polygon, line) is excluded — rotating those would fight the path coords. */
function supportsRotation(ann: Annotation): boolean {
  return ann.type === 'text' || ann.type === 'stamp' || ann.type === 'image'
    || ann.type === 'signature' || ann.type === 'rect' || ann.type === 'ellipse'
    || ann.type === 'sticky' || ann.type === 'redact' || ann.type === 'highlight';
}

/** Add 90° clockwise, normalised into the (-180, 180] range used by the slider. */
function snap90(deg: number): number {
  let r = (Math.round(deg / 90) * 90 + 90) % 360;
  if (r > 180) r -= 360;
  if (r <= -180) r += 360;
  return r;
}

/** Sticky-note category picker. Sets the category + its paper/ink colors so the
 *  note immediately reflects the category palette. */
function StickyCategoryPicker({ ann, onChange }: { ann: Annotation; onChange: (a: Annotation) => void }) {
  if (ann.type !== 'sticky') return null;
  const current = ann.category ?? 'general';
  return (
    <div className="pt-1">
      <label htmlFor="ff-propertiespanel-7" className={labelCls}>Category</label>
      <div className="grid grid-cols-3 gap-1">
        {(Object.keys(STICKY_CATEGORIES) as StickyCategory[]).map(key => {
          const meta = STICKY_CATEGORIES[key];
          const active = current === key;
          return (
            <button key={key} type="button"
              onClick={() => onChange({ ...ann, category: key, fillColor: meta.paper, color: meta.ink })}
              title={meta.label}
              className={`px-1 py-1 text-[9px] rounded-sm border inline-flex items-center gap-1 ${active ? 'border-[#d4a017] text-rmpg-100' : 'border-border-default text-rmpg-400 hover:text-rmpg-100'}`}>
              <span className="w-2.5 h-2.5 rounded-sm border border-border-subtle flex-shrink-0" style={{ background: meta.paper }} />
              <span className="truncate">{meta.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** Redaction bar options — black bar vs white-out + an optional exemption /
 *  reason label printed over the bar. */
function RedactOptions({ ann, onChange }: { ann: Annotation; onChange: (a: Annotation) => void }) {
  if (ann.type !== 'redact') return null;
  const style = ann.redactStyle ?? 'black';
  return (
    <div className="pt-1 space-y-1.5">
      <label htmlFor="ff-propertiespanel-reply" className={labelCls}>Bar style</label>
      <div className="flex gap-1">
        <button type="button" onClick={() => onChange({ ...ann, redactStyle: 'black' })}
          className={`flex-1 px-2 py-1 text-[10px] rounded-sm border ${style === 'black' ? 'bg-[#d4a017]/20 text-[#d4a017] border-[#d4a017]' : 'border-border-default text-rmpg-400'}`}>Black bar</button>
        <button type="button" onClick={() => onChange({ ...ann, redactStyle: 'white' })}
          className={`flex-1 px-2 py-1 text-[10px] rounded-sm border ${style === 'white' ? 'bg-[#d4a017]/20 text-[#d4a017] border-[#d4a017]' : 'border-border-default text-rmpg-400'}`}>White-out</button>
      </div>
      <label htmlFor="ff-propertiespanel-redactreason" className={labelCls}>Reason / exemption (optional)</label>
      <input id="ff-propertiespanel-redactreason" value={ann.reason ?? ''} onChange={e => onChange({ ...ann, reason: e.target.value || undefined })}
        placeholder="e.g. (b)(6) · GRAMA 63G-2-302" className={inputCls} />
      <div className="text-[9px] text-rmpg-600">Printed centered over the bar in the saved PDF.</div>
    </div>
  );
}

/** Threaded reply editor for sticky-note / text annotations. Replies carry an
 *  author + timestamp and flow through to exports + the annotation report. */
function RepliesEditor({ ann, onChange }: { ann: Annotation; onChange: (a: Annotation) => void }) {
  const [text, setText] = useState('');
  const replies = ann.replies ?? [];
  const addReply = () => {
    const t = text.trim();
    if (!t) return;
    const reply: AnnotationReply = {
      id: Math.random().toString(36).slice(2, 10),
      author: ann.authorName ?? 'me',
      text: t,
      createdAt: new Date().toISOString(),
    };
    onChange({ ...ann, replies: [...replies, reply] });
    setText('');
  };
  const removeReply = (id: string) => onChange({ ...ann, replies: replies.filter(r => r.id !== id) });
  return (
    <div className="pt-1">
      <div className="text-[9px] uppercase tracking-wider text-rmpg-500 mb-1 inline-flex items-center gap-1">
        <MessageSquare className="w-3 h-3" /> Discussion ({replies.length})
      </div>
      <div className="space-y-1 mb-1.5 max-h-40 overflow-y-auto">
        {replies.length === 0 && <div className="text-[9px] text-rmpg-600 italic">No replies yet.</div>}
        {replies.map(r => (
          <div key={r.id} className="border border-border-default rounded-sm px-1.5 py-1 bg-surface-sunken">
            <div className="flex items-center justify-between">
              <span className="text-[9px] text-[#d4a017] font-semibold">{r.author}</span>
              <button type="button" onClick={() => removeReply(r.id)} aria-label="Delete reply" title="Delete reply"
                className="text-rmpg-500 hover:text-red-400"><Trash2 className="w-3 h-3" /></button>
            </div>
            <div className="text-[10px] text-rmpg-200 break-words">{r.text}</div>
            <div className="text-[8px] text-rmpg-600">{safeDateTimeStr(r.createdAt)}</div>
          </div>
        ))}
      </div>
      <div className="flex gap-1">
        <input id="ff-propertiespanel-reply" value={text} onChange={e => setText(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addReply(); } }}
          placeholder="Reply…" className={inputCls} />
        <button type="button" onClick={addReply} disabled={!text.trim()}
          className="px-2 py-1 text-[10px] rounded-sm border border-border-default text-rmpg-300 hover:text-rmpg-100 disabled:opacity-30">Post</button>
      </div>
    </div>
  );
}

function BatesEditor({ bates, onChange }: { bates: BatesConfig | null; onChange: (b: BatesConfig | null) => void }) {
  const enabled = !!bates;
  const cfg: BatesConfig = bates ?? { prefix: 'RMPG-2026-', startNumber: 1, padding: 5, position: 'br', fontSize: 9 };
  return (
    <>
      <label htmlFor="ff-propertiespanel-6" className="flex items-center gap-2 text-[10px] text-rmpg-300">
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
      <label htmlFor="ff-propertiespanel-11" className="flex items-center gap-2 text-[10px] text-rmpg-300">
        <input id="ff-propertiespanel-11" type="checkbox" checked={enabled} onChange={e => onChange(e.target.checked ? cfg : null)} />
        Enable watermark
      </label>
      {enabled && wm && (
        <div className="space-y-1.5 pl-1 mt-1">
          <input id="ff-propertiespanel-12" value={wm.text} onChange={e => onChange({ ...wm, text: e.target.value })} placeholder="Watermark text" className={inputCls} />
          <label htmlFor="ff-propertiespanel-pn3" className={labelCls}>Placement</label>
          <div className="flex gap-1">
            <button type="button" onClick={() => onChange({ ...wm, mode: 'diagonal' })} className={`flex-1 px-2 py-1 text-[10px] rounded-sm border ${(wm.mode ?? 'diagonal') === 'diagonal' ? 'bg-[#d4a017]/20 text-[#d4a017] border-[#d4a017]' : 'border-border-default text-rmpg-400'}`}>Diagonal</button>
            <button type="button" onClick={() => onChange({ ...wm, mode: 'tiled' })} className={`flex-1 px-2 py-1 text-[10px] rounded-sm border ${wm.mode === 'tiled' ? 'bg-[#d4a017]/20 text-[#d4a017] border-[#d4a017]' : 'border-border-default text-rmpg-400'}`}>Tiled</button>
          </div>
          <label htmlFor="ff-propertiespanel-13" className={labelCls}>Opacity</label>
          <input id="ff-propertiespanel-13" type="range" min={0.05} max={0.5} step={0.05} value={wm.opacity} onChange={e => onChange({ ...wm, opacity: parseFloat(e.target.value) })} className="w-full accent-[#d4a017]" />
          <label htmlFor="ff-propertiespanel-14" className={labelCls}>Size {wm.fontSize}pt</label>
          <input id="ff-propertiespanel-14" type="range" min={24} max={160} value={wm.fontSize} onChange={e => onChange({ ...wm, fontSize: parseInt(e.target.value, 10) })} className="w-full accent-[#d4a017]" />
          <label htmlFor="ff-propertiespanel-15" className={labelCls}>Rotation {wm.rotation}°</label>
          <input id="ff-propertiespanel-15" type="range" min={-90} max={90} value={wm.rotation} onChange={e => onChange({ ...wm, rotation: parseInt(e.target.value, 10) })} className="w-full accent-[#d4a017]" />
          <label htmlFor="ff-propertiespanel-pn2" className={labelCls}>Image watermark (optional)</label>
          {wm.imageData ? (
            <div className="flex items-center gap-1">
              <img src={wm.imageData} alt="watermark" className="h-8 w-8 object-contain bg-white/5 border border-border-default rounded-sm" />
              <button type="button" onClick={() => onChange({ ...wm, imageData: undefined })} className="text-[10px] text-red-300 hover:text-red-200">Remove</button>
            </div>
          ) : (
            <label htmlFor="ff-propertiespanel-pn1" className="block text-[10px] text-rmpg-400 border border-border-default rounded-sm px-2 py-1 cursor-pointer hover:text-rmpg-100 text-center">
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
      <label htmlFor="ff-propertiespanel-pn0" className="flex items-center gap-2 text-[10px] text-rmpg-300">
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
          <label htmlFor="ff-propertiespanel-pn4" className={labelCls}>Number style ({'{n}'})</label>
          <select id="ff-propertiespanel-pn4" value={cfg.style ?? 'decimal'} onChange={e => onChange({ ...cfg, style: e.target.value as PageNumbersConfig['style'] })} className={inputCls}>
            <option value="decimal">1, 2, 3</option>
            <option value="roman">i, ii, iii</option>
            <option value="Roman">I, II, III</option>
            <option value="alpha">a, b, c</option>
            <option value="Alpha">A, B, C</option>
          </select>
          <div className="text-[9px] text-rmpg-600">Tokens: {'{n}'} = page number, {'{total}'} = count, {'{label}'} = custom page label.</div>
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
