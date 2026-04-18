import { useEffect, useRef, useState } from 'react';
import type {
  FormSchema, SchemaSection, FieldSpec, LabeledField,
  CheckboxField, NarrativeField, TableField, SignatureField,
} from '../utils/pdf/v2/engine/types';
import { renderPdfV2 } from '../utils/pdf/v2';
import { CommitDropdown } from './CommitDropdown';
import { PdfEmailDialog } from './PdfEmailDialog';

export type CommitKind = 'download' | 'attach' | 'email' | 'print';

interface Props<T> {
  open: boolean;
  schema: FormSchema<T>;
  initialData: T;
  onClose: () => void;
  onCommit: (data: T, action: CommitKind) => void;
  allowedActions?: CommitKind[];
  recordType?: 'case' | 'incident' | 'warrant' | 'evidence';
  recordId?: number;
}

/** POST the PDF blob + metadata to /api/pdf-artifacts. Resolves with the inserted artifact's id. */
export async function attachBlobToRecord(
  blob: Blob,
  formType: string,
  formVersion: string,
  recordType: string,
  recordId: number,
  title: string | undefined,
): Promise<{ id: number; sha256: string }> {
  const fd = new FormData();
  fd.append('form_type', formType);
  fd.append('form_version', formVersion);
  fd.append('record_type', recordType);
  fd.append('record_id', String(recordId));
  if (title) fd.append('title', title);
  fd.append('pdf', blob, `${formType}.pdf`);

  let token = '';
  try {
    if (typeof localStorage !== 'undefined' && typeof localStorage.getItem === 'function') {
      token = localStorage.getItem('accessToken') || '';
    }
  } catch {
    /* test environments may not support localStorage */
  }
  const res = await fetch('/api/pdf-artifacts', {
    method: 'POST',
    body: fd,
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) throw new Error(`attach failed: ${res.status}`);
  return res.json();
}

/** POST the PDF blob + email fields to /api/pdf-engine/email. */
export async function emailBlob(
  blob: Blob,
  formType: string,
  to: string[],
  cc: string[],
  subject: string,
  body: string,
): Promise<void> {
  const fd = new FormData();
  fd.append('form_type', formType);
  to.forEach((t) => fd.append('to', t));
  cc.forEach((c) => fd.append('cc', c));
  fd.append('subject', subject);
  fd.append('body', body);
  fd.append('pdf', blob, `${formType}.pdf`);

  let token = '';
  try {
    token = typeof localStorage !== 'undefined' && typeof localStorage.getItem === 'function'
      ? (localStorage.getItem('accessToken') || '')
      : '';
  } catch { /* no-op */ }

  const res = await fetch('/api/pdf-engine/email', {
    method: 'POST',
    body: fd,
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`email failed: ${res.status} ${text}`);
  }
}

// Reject prototype-pollution keys — a path like "__proto__.foo" or
// "constructor.prototype.foo" could otherwise mutate Object.prototype
// (CodeQL js/prototype-pollution-utility #2758).
const FORBIDDEN_PATH_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function setPath<T extends Record<string, any>>(obj: T, path: string, value: unknown): T {
  const keys = path.split('.');
  if (keys.some((k) => FORBIDDEN_PATH_KEYS.has(k))) return obj;
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
  recordType,
  recordId,
}: Props<T>) {
  const [data, setData] = useState<T>(initialData);
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [commitStatus, setCommitStatus] = useState<{ kind: 'ok' | 'err'; message: string } | null>(null);
  const [showEmailDialog, setShowEmailDialog] = useState(false);
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

  const handleCommit = async (action: CommitKind) => {
    try {
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
      if (action === 'attach') {
        if (!blobUrl) {
          setCommitStatus({ kind: 'err', message: 'Preview not ready yet — try again in a moment.' });
          return;
        }
        if (!recordType || recordId == null) {
          setCommitStatus({ kind: 'err', message: 'No record to attach to (recordType/recordId missing).' });
          return;
        }
        setCommitStatus({ kind: 'ok', message: 'Uploading…' });
        // Re-fetch the blob from the URL so we get fresh bytes
        const blob = await fetch(blobUrl).then((r) => r.blob());
        const result = await attachBlobToRecord(
          blob,
          schema.meta.formNumber,
          schema.meta.revision,
          recordType,
          recordId,
          `${schema.meta.title} — ${new Date().toISOString().split('T')[0]}`,
        );
        setCommitStatus({ kind: 'ok', message: `Attached to ${recordType} #${recordId} (id ${result.id}).` });
        onCommit(data, action);
        return;
      }
      if (action === 'email') {
        if (!blobUrl) {
          setCommitStatus({ kind: 'err', message: 'Preview not ready yet — try again in a moment.' });
          return;
        }
        setShowEmailDialog(true);
        return;
      }
      // unhandled: delegate
      onCommit(data, action);
    } catch (err) {
      setCommitStatus({
        kind: 'err',
        message: (err as Error)?.message ?? 'Commit failed',
      });
    }
  };

  const handleEmailSend = async (to: string[], cc: string[], subject: string, body: string) => {
    setShowEmailDialog(false);
    if (!blobUrl) return;
    try {
      setCommitStatus({ kind: 'ok', message: 'Sending…' });
      const blob = await fetch(blobUrl).then((r) => r.blob());
      await emailBlob(blob, schema.meta.formNumber, to, cc, subject, body);
      setCommitStatus({ kind: 'ok', message: `Emailed to ${to.join(', ')}.` });
      onCommit(data, 'email');
    } catch (err) {
      setCommitStatus({ kind: 'err', message: (err as Error)?.message ?? 'email failed' });
    }
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
          <div className="flex flex-col gap-1">
            <div className="text-xs text-amber-400">
              ⚠ Editing will update the source record. Use Cancel to discard.
            </div>
            {commitStatus && (
              <div
                role="status"
                className={`text-xs ${commitStatus.kind === 'ok' ? 'text-emerald-400' : 'text-red-400'}`}
              >
                {commitStatus.message}
              </div>
            )}
          </div>
          <div className="flex gap-2">
            <button onClick={onClose} className="px-3 py-1 bg-gray-700 text-white">Cancel</button>
            <CommitDropdown allowedActions={allowedActions} onSelect={handleCommit} />
          </div>
        </footer>
        {showEmailDialog && (
          <PdfEmailDialog
            defaultSubject={`${schema.meta.title} — ${schema.meta.formNumber}`}
            onCancel={() => setShowEmailDialog(false)}
            onSend={handleEmailSend}
          />
        )}
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
