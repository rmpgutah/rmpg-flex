import { useEffect, useRef, useState } from 'react';
import type { FormSchema, SchemaSection, FieldSpec, LabeledField } from '../utils/pdf/v2/engine/types';
import { renderPdfV2 } from '../utils/pdf/v2';

export type CommitKind = 'download' | 'attach' | 'email' | 'print';

interface Props<T> {
  open: boolean;
  schema: FormSchema<T>;
  initialData: T;
  onClose: () => void;
  onCommit: (data: T, action: CommitKind) => void;
}

function setPath<T extends Record<string, any>>(obj: T, path: string, value: unknown): T {
  const keys = path.split('.');
  const copy: any = Array.isArray(obj) ? [...obj] : { ...obj };
  let cursor: any = copy;
  for (let i = 0; i < keys.length - 1; i++) {
    cursor[keys[i]] = { ...(cursor[keys[i]] ?? {}) };
    cursor = cursor[keys[i]];
  }
  cursor[keys[keys.length - 1]] = value;
  return copy as T;
}

export function PdfReviewModal<T extends Record<string, any>>({
  open, schema, initialData, onClose, onCommit,
}: Props<T>) {
  const [data, setData] = useState<T>(initialData);
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const blobUrlRef = useRef<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const timer = setTimeout(async () => {
      try {
        const doc = await renderPdfV2(schema, data);
        const blob = doc.output('blob') as Blob;
        const url = URL.createObjectURL(blob);
        const prev = blobUrlRef.current;
        blobUrlRef.current = url;
        setBlobUrl(url);
        if (prev) URL.revokeObjectURL(prev);
      } catch (err) {
        console.error('[pdf-v2] preview render failed', err);
      }
    }, 400);
    return () => clearTimeout(timer);
  }, [data, schema, open]);

  useEffect(() => {
    return () => {
      if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current);
    };
  }, []);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center">
      <div className="bg-[#141e2b] border border-[#2e2e2e] w-[95vw] h-[90vh] flex flex-col">
        <header className="flex justify-between items-center px-4 py-2 border-b border-[#222]">
          <h2 className="text-[#d4a017] font-bold">
            {schema.meta.title} — Form {schema.meta.formNumber}
          </h2>
          <button onClick={onClose} className="text-gray-400" aria-label="Close">✕</button>
        </header>
        <div className="flex-1 grid grid-cols-2 overflow-hidden">
          <div className="overflow-y-auto p-4 border-r border-[#222]">
            {schema.sections.map((s, i) => {
              if (typeof s === 'function') return null;
              if (s.visibleIf && !s.visibleIf(data)) return null;
              return <EditorSection key={i} section={s} data={data} onChange={setData} />;
            })}
          </div>
          <div className="overflow-y-auto p-4">
            {blobUrl
              ? <iframe title="pdf-preview" src={blobUrl} className="w-full h-full border-0" />
              : <div className="text-gray-400 italic">Rendering preview…</div>}
          </div>
        </div>
        <footer className="flex justify-between items-center px-4 py-2 border-t border-[#222]">
          <div className="text-xs text-amber-400">
            ⚠ Editing will update the source record. Use Cancel to discard.
          </div>
          <div className="flex gap-2">
            <button onClick={onClose} className="px-3 py-1 bg-gray-700 text-white">Cancel</button>
            <button
              onClick={() => onCommit(data, 'download')}
              className="px-3 py-1 bg-[#d4a017] text-black font-bold"
            >
              Commit: Download
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}

function EditorSection<T extends Record<string, any>>({
  section, data, onChange,
}: { section: SchemaSection<T>; data: T; onChange: (d: T) => void }) {
  return (
    <section className="mb-4">
      <h3 className="text-[#d4a017] font-bold text-sm mb-2">{section.title}</h3>
      {section.fields.map((f, i) => (
        <EditorField key={i} field={f} data={data} onChange={onChange} />
      ))}
    </section>
  );
}

function EditorField<T extends Record<string, any>>({
  field, data, onChange,
}: { field: FieldSpec<T>; data: T; onChange: (d: T) => void }) {
  if (field.kind !== 'labeled') return null;
  const labeled = field as LabeledField<T>;
  const value = String(labeled.accessor(data) ?? '');
  return (
    <label className="block mb-2 text-xs">
      <span className="block text-gray-400 uppercase mb-1">{labeled.label}</span>
      <input
        aria-label={labeled.label}
        className="w-full bg-[#0d1520] text-white border border-[#2e2e2e] p-1"
        value={value}
        disabled={labeled.editable === false}
        onChange={(e) => {
          if (!labeled.path) return;
          onChange(setPath(data, labeled.path, e.target.value));
        }}
      />
    </label>
  );
}
