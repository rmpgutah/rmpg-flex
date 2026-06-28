// Smoke-tests every Wave-5 action: each must run against a real editor
// without throwing and (for inserts) change the document. Also asserts the
// registry grew by 100 and the new palette groups are present.
import { describe, it, expect, afterEach } from 'vitest';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { Table } from '@tiptap/extension-table';
import TableRow from '@tiptap/extension-table-row';
import TableCell from '@tiptap/extension-table-cell';
import TableHeader from '@tiptap/extension-table-header';
import TextAlign from '@tiptap/extension-text-align';
import { TextStyle } from '@tiptap/extension-text-style';
import Color from '@tiptap/extension-color';
import Highlight from '@tiptap/extension-highlight';
import { WAVE5_ACTIONS } from '../docActions3';
import { ACTION_REGISTRY, ACTION_GROUPS } from '../docActions2';

let editor: Editor | null = null;
afterEach(() => { editor?.destroy(); editor = null; });

function mk(): Editor {
  return new Editor({
    extensions: [
      StarterKit, Table.configure({ resizable: true }), TableRow, TableCell, TableHeader,
      TextAlign.configure({ types: ['heading', 'paragraph'] }),
      TextStyle, Color, Highlight.configure({ multicolor: true }),
    ],
    content: '<p>Alpha bravo charlie.</p>',
  });
}

describe('Wave-5 actions', () => {
  it('adds exactly 100 actions and the new groups', () => {
    expect(WAVE5_ACTIONS).toHaveLength(100);
    // Every action surfaces in the registry the palette renders.
    for (const a of WAVE5_ACTIONS) {
      expect(ACTION_REGISTRY).toContainEqual(a);
    }
    for (const g of ['Insert', 'Format', 'Police', 'Legal', 'Utility']) {
      expect(ACTION_GROUPS).toContain(g);
    }
    // Names are unique across the whole registry.
    const names = ACTION_REGISTRY.map((a) => `${a.group}/${a.name}`);
    expect(new Set(names).size).toBe(names.length);
  });

  it('runs every action without throwing', () => {
    for (const a of WAVE5_ACTIONS) {
      editor = mk();
      // Select the seed word so wrap/format actions have a target.
      editor.commands.setTextSelection({ from: 1, to: 6 });
      expect(() => a.fn(editor!), `action threw: ${a.name}`).not.toThrow();
      editor.destroy(); editor = null;
    }
  });

  it('insert-type actions actually change the document', () => {
    // Sample one insert from each group; the doc HTML must grow.
    const samples = ['Right arrow →', 'Field interview (FI) card', 'Certificate of service', 'Insert agency name', 'Approval block'];
    for (const name of samples) {
      const a = WAVE5_ACTIONS.find((x) => x.name === name)!;
      editor = mk();
      const before = editor.getHTML();
      a.fn(editor);
      const after = editor.getHTML();
      expect(after.length, `no change from: ${name}`).toBeGreaterThan(before.length);
      editor.destroy(); editor = null;
    }
  });
});
