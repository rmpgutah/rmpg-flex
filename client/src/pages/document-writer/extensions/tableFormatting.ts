// Table formatting attributes — spacing & sizing controls for the Document
// Writer's tables, plus the cell-shading attribute the toolbar already tried
// to set (setCellAttribute('backgroundColor', …) was a no-op because the
// default TableCell/TableHeader never registered that attribute).
//
// Same mechanism as BlockStyle (customBlocks.ts): each attribute renders ONE
// CSS fragment and TipTap's mergeAttributes concatenates them into the node's
// inline `style`, so everything round-trips through save/load HTML with no
// helper data-* attributes.
//
// Table-level attributes are set as CSS custom properties on the <table>; they
// INHERIT down to every <td>/<th>, and writer.css reads them:
//   td,th { padding: var(--rmpg-cell-py,4px) var(--rmpg-cell-px,8px);
//           border-width: var(--rmpg-tbl-border,1px);
//           height: var(--rmpg-row-h,auto); }
// Cell-level attributes (shading, vertical align) render directly on the cell.

import { Extension } from '@tiptap/core';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    tableFormatting: {
      /** Merge style attributes onto the table wrapping the current selection. */
      setTableStyle: (attrs: Record<string, string | null>) => ReturnType;
    };
  }
}

/** One node attribute backed by a single CSS declaration (custom prop or normal
 *  property). parseHTML reads it back off the element's inline style. */
function cssAttr(attrName: string, cssName: string) {
  return {
    default: null as string | null,
    parseHTML: (el: HTMLElement) => {
      const v = el.style.getPropertyValue(cssName);
      return v ? v.trim() : null;
    },
    renderHTML: (attrs: Record<string, any>) => {
      const v = attrs[attrName];
      return v ? { style: `${cssName}: ${v}` } : {};
    },
  };
}

export const TableFormatting = Extension.create({
  name: 'tableFormatting',

  addGlobalAttributes() {
    return [
      {
        types: ['table'],
        attributes: {
          // Spacing — side-to-side (horizontal cell padding) and top-to-bottom
          // (vertical cell padding). CSS custom props inherit to all cells.
          cellPadX: cssAttr('cellPadX', '--rmpg-cell-px'),
          cellPadY: cssAttr('cellPadY', '--rmpg-cell-py'),
          // Sizing — bottom-to-top (row height via cell min-height) and the
          // overall table width (side-to-side sizing).
          rowHeight: cssAttr('rowHeight', '--rmpg-row-h'),
          tableWidth: cssAttr('tableWidth', 'width'),
          // Border weight for the whole grid (0 = borderless).
          tableBorder: cssAttr('tableBorder', '--rmpg-tbl-border'),
        },
      },
      {
        types: ['tableCell', 'tableHeader'],
        attributes: {
          // Registering backgroundColor here is what makes the existing
          // setCellAttribute('backgroundColor', …) control actually work.
          backgroundColor: cssAttr('backgroundColor', 'background-color'),
          cellVerticalAlign: cssAttr('cellVerticalAlign', 'vertical-align'),
        },
      },
    ];
  },

  addCommands() {
    return {
      setTableStyle:
        (attrs) =>
        ({ state, dispatch }) => {
          const { $from } = state.selection;
          // Walk up to the wrapping table node and merge the attributes onto it.
          for (let d = $from.depth; d > 0; d--) {
            const node = $from.node(d);
            if (node.type.name === 'table') {
              if (dispatch) {
                const pos = $from.before(d);
                const next = { ...node.attrs };
                for (const [k, v] of Object.entries(attrs)) {
                  if (v == null) delete next[k];
                  else next[k] = v;
                }
                dispatch(state.tr.setNodeMarkup(pos, undefined, next));
              }
              return true;
            }
          }
          return false;
        },
    };
  },
});

export default TableFormatting;
