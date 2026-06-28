// Verifies the table spacing/sizing attributes write to inline style and
// round-trip through serialized HTML — and that cell shading (previously a
// no-op) now persists.
import { describe, it, expect, afterEach } from 'vitest';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { Table } from '@tiptap/extension-table';
import TableRow from '@tiptap/extension-table-row';
import TableCell from '@tiptap/extension-table-cell';
import TableHeader from '@tiptap/extension-table-header';
import TableFormatting from '../tableFormatting';

let editor: Editor | null = null;
afterEach(() => { editor?.destroy(); editor = null; });

function mkEditor(): Editor {
  return new Editor({
    extensions: [StarterKit, Table.configure({ resizable: true }), TableRow, TableCell, TableHeader, TableFormatting],
    content: '<p>seed</p>',
  });
}

describe('TableFormatting', () => {
  it('writes table spacing/sizing as inline CSS vars that round-trip', () => {
    editor = mkEditor();
    editor.chain().focus().insertTable({ rows: 2, cols: 2, withHeaderRow: true }).run();
    // Cursor lands inside the table after insert.
    editor.chain().focus().setTableStyle({
      cellPadX: '14px', cellPadY: '10px', rowHeight: '32px', tableWidth: '75%', tableBorder: '2px',
    }).run();

    const html = editor.getHTML();
    expect(html).toContain('--rmpg-cell-px: 14px');
    expect(html).toContain('--rmpg-cell-py: 10px');
    expect(html).toContain('--rmpg-row-h: 32px');
    expect(html).toContain('width: 75%');
    expect(html).toContain('--rmpg-tbl-border: 2px');

    // Round-trip: reload the serialized HTML into a fresh editor; attrs survive.
    const e2 = new Editor({
      extensions: [StarterKit, Table.configure({ resizable: true }), TableRow, TableCell, TableHeader, TableFormatting],
      content: html,
    });
    const html2 = e2.getHTML();
    e2.destroy();
    expect(html2).toContain('--rmpg-cell-px: 14px');
    expect(html2).toContain('width: 75%');
  });

  it('persists cell shading + vertical align (shading was a no-op before)', () => {
    editor = mkEditor();
    editor.chain().focus().insertTable({ rows: 2, cols: 2, withHeaderRow: false }).run();
    editor.chain().focus().setCellAttribute('backgroundColor', '#eef').run();
    editor.chain().focus().setCellAttribute('cellVerticalAlign', 'middle').run();
    const html = editor.getHTML();
    // jsdom normalizes the hex to rgb on parse — the point is it PERSISTS
    // (setCellAttribute('backgroundColor') was a no-op before this extension).
    expect(html).toMatch(/background-color: (#eef|rgb\(238, 238, 255\))/);
    expect(html).toContain('vertical-align: middle');
  });
});
