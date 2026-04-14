import { useEffect, useRef, useState } from 'react';
import type {
  FormSchema, SchemaSection, FieldSpec, LabeledField,
  CheckboxField, NarrativeField, TableField, SignatureField,
} from '../utils/pdf/v2/engine/types';
import { renderPdfV2 } from '../utils/pdf/v2';
import { CommitDropdown } from './CommitDropdown';

export type CommitKind = 'download' | 'attach' | 'email' | 'print';

interface Props<T> {
  open: boolean;
  schema: FormSchema<T>;
  initialData: T;
  onClose: () => void;
  onCommit: (data: T, action: CommitKind) => void;
  allowedActions?: CommitKind[];
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
  allowedActions = ['download', 'print'],
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

  const handleCommit = (action: CommitKind) => {
    if (action === 'download' && blobUrl) {
      downloadBlob(blobUrl, `${schema.meta.formNumber}_${new Date().toISOString().split('T')[0]}.pdf`);
      onCommit(data, action);
      return;
    }
    if (action === 'print' && blobUrl) {
      printBlob(blobUrl);
      onCommit(data, action);
      return;
    }
    // attach/email or no-blob fallbacks: delegate to parent
    onCommit(data, action);
  };

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
            <CommitDropdown allowedActions={allowedActions} onSelect={handleCommit} />
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
  switch (field.kind) {
    case 'labeled':   return <LabeledEditor field={field} data={data} onChange={onChange} />;
    case 'checkbox':  return <CheckboxEditor field={field} data={data} onChange={onChange} />;
    case 'narrative': return <NarrativeEditor field={field} data={data} onChange={onChange} />;
    case 'table':     return <TableEditor field={field} data={data} onChange={onChange} />;
    case 'signature': return <SignaturePlaceholder field={field} />;
    case 'spacer':    return null;
  }
}

function LabeledEditor<T extends Record<string, any>>({
  field, data, onChange,
}: { field: LabeledField<T>; data: T; onChange: (d: T) => void }) {
  const value = String(field.accessor(data) ?? '');
  const disabled = field.editable === false;
  return (
    <label className="block mb-2 text-xs">
      <span className="block text-gray-400 uppercase mb-1">
        {field.label}
        {disabled && field.readOnlyReason && (
          <span className="ml-1 text-amber-500/70" title={field.readOnlyReason}>ⓘ</span>
        )}
      </span>
      <input
        aria-label={field.label}
        className="w-full bg-[#0d1520] text-white border border-[#2e2e2e] p-1 disabled:opacity-50"
        value={value}
        disabled={disabled}
        onChange={(e) => {
          if (!field.path) return;
          onChange(setPath(data, field.path, e.target.value));
        }}
      />
    </label>
  );
}

function CheckboxEditor<T extends Record<string, any>>({
  field, data, onChange,
}: { field: CheckboxField<T>; data: T; onChange: (d: T) => void }) {
  const checked = Boolean(field.accessor(data));
  const disabled = field.editable === false;
  return (
    <label className="flex items-center gap-2 mb-2 text-xs">
      <input
        type="checkbox"
        aria-label={field.label}
        checked={checked}
        disabled={disabled}
        onChange={(e) => {
          if (!field.path) return;
          onChange(setPath(data, field.path, e.target.checked));
        }}
      />
      <span className="text-gray-300">
        {field.label}
        {disabled && field.readOnlyReason && (
          <span className="ml-1 text-amber-500/70" title={field.readOnlyReason}>ⓘ</span>
        )}
      </span>
    </label>
  );
}

function NarrativeEditor<T extends Record<string, any>>({
  field, data, onChange,
}: { field: NarrativeField<T>; data: T; onChange: (d: T) => void }) {
  const value = String(field.accessor(data) ?? '');
  const disabled = field.editable === false;
  return (
    <label className="block mb-2 text-xs">
      <span className="block text-gray-400 uppercase mb-1">
        {field.label}
        {disabled && field.readOnlyReason && (
          <span className="ml-1 text-amber-500/70" title={field.readOnlyReason}>ⓘ</span>
        )}
      </span>
      <textarea
        aria-label={field.label}
        rows={4}
        className="w-full bg-[#0d1520] text-white border border-[#2e2e2e] p-1 disabled:opacity-50"
        value={value}
        disabled={disabled}
        onChange={(e) => {
          if (!field.path) return;
          onChange(setPath(data, field.path, e.target.value));
        }}
      />
    </label>
  );
}

function TableEditor<T extends Record<string, any>>({
  field, data, onChange,
}: { field: TableField<T>; data: T; onChange: (d: T) => void }) {
  const rows = field.accessor(data) ?? [];
  const disabled = field.editable === false;

  const updateCell = (rowIdx: number, key: string, value: string) => {
    if (!field.path) return;
    const newRows = rows.map((r, i) => (i === rowIdx ? { ...r, [key]: value } : r));
    onChange(setPath(data, field.path, newRows));
  };
  const addRow = () => {
    if (!field.path) return;
    const empty: Record<string, unknown> = {};
    for (const c of field.columns) empty[c.key] = '';
    onChange(setPath(data, field.path, [...rows, empty]));
  };
  const removeRow = (rowIdx: number) => {
    if (!field.path) return;
    const newRows = rows.filter((_, i) => i !== rowIdx);
    onChange(setPath(data, field.path, newRows));
  };

  return (
    <div className="mb-3 text-xs">
      <div className="flex items-center justify-between mb-1">
        <span className="text-gray-400 uppercase">
          {field.label}
          {disabled && field.readOnlyReason && (
            <span className="ml-1 text-amber-500/70" title={field.readOnlyReason}>ⓘ</span>
          )}
        </span>
        {!disabled && (
          <button
            type="button"
            onClick={addRow}
            className="text-[#d4a017] hover:underline"
            aria-label={`Add row to ${field.label}`}
          >
            + Add row
          </button>
        )}
      </div>
      <table className="w-full border-collapse">
        <thead>
          <tr className="text-gray-500 uppercase text-[10px]">
            {field.columns.map((c) => (
              <th key={c.key} className="text-left border-b border-[#222] py-1">{c.header}</th>
            ))}
            {!disabled && <th className="w-6"></th>}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr>
              <td colSpan={field.columns.length + 1} className="text-gray-500 italic py-1">
                No rows
              </td>
            </tr>
          )}
          {rows.map((row, i) => (
            <tr key={i}>
              {field.columns.map((c) => (
                <td key={c.key} className="py-1 pr-1">
                  <input
                    aria-label={`${field.label} row ${i + 1} ${c.header}`}
                    value={String((row as Record<string, unknown>)[c.key] ?? '')}
                    disabled={disabled}
                    onChange={(e) => updateCell(i, c.key, e.target.value)}
                    className="w-full bg-[#0d1520] text-white border border-[#2e2e2e] p-1 disabled:opacity-50"
                  />
                </td>
              ))}
              {!disabled && (
                <td className="py-1">
                  <button
                    type="button"
                    onClick={() => removeRow(i)}
                    className="text-red-400 hover:text-red-200"
                    aria-label={`Remove row ${i + 1} from ${field.label}`}
                  >
                    ×
                  </button>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SignaturePlaceholder<T>({ field }: { field: SignatureField<T> }) {
  return (
    <div className="block mb-2 text-xs">
      <span className="block text-gray-400 uppercase mb-1">{field.label}</span>
      <div className="w-full bg-[#0d1520] border border-dashed border-[#2e2e2e] p-2 text-gray-500 italic">
        Signature editor coming soon
      </div>
    </div>
  );
}

/** Save the PDF blob to the user's computer as a file download. */
export function downloadBlob(blobUrl: string, filename: string): void {
  const a = document.createElement('a');
  a.href = blobUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/** Open a hidden iframe pointing at the PDF blob and trigger print on its contentWindow. */
export function printBlob(blobUrl: string): void {
  // If an iframe from a previous print is still in the DOM, clean it up.
  document.querySelectorAll('iframe[data-pdf-print]').forEach((el) => el.remove());

  const iframe = document.createElement('iframe');
  iframe.setAttribute('data-pdf-print', 'true');
  iframe.style.position = 'fixed';
  iframe.style.right = '0';
  iframe.style.bottom = '0';
  iframe.style.width = '0';
  iframe.style.height = '0';
  iframe.style.border = '0';
  iframe.src = blobUrl;
  iframe.onload = () => {
    try {
      iframe.contentWindow?.focus();
      iframe.contentWindow?.print();
    } catch (err) {
      console.error('[pdf-v2] print failed', err);
    }
  };
  document.body.appendChild(iframe);
}
