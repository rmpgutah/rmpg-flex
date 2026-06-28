// Block-level document features as TipTap node attributes + nodes — no extra
// npm packages. BlockStyle hangs CSS attributes off paragraph/heading/blockquote
// (line height, paragraph spacing before/after, first-line & hanging indent,
// paragraph border + shading, keep-with-next / widow-orphan via break-inside,
// text direction, vertical align, drop cap). PageBreak / SectionBreak are atom
// nodes that render a print page break.

import { Extension, Node } from '@tiptap/core';

const BLOCK_TYPES = ['paragraph', 'heading', 'blockquote'];

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    blockStyle: {
      /** Merge style attributes onto every textblock in the selection. */
      setBlockStyle: (attrs: Record<string, string | null | boolean>) => ReturnType;
    };
    pageBreaks: {
      setPageBreak: () => ReturnType;
      setSectionBreak: () => ReturnType;
    };
  }
}

/** One block attribute backed by a single CSS declaration. Each renderHTML emits
 *  only its own `style:` fragment — TipTap's mergeAttributes concatenates them
 *  into one style string, and parseHTML reads the value straight back off the
 *  element's inline style (so it round-trips through save/load HTML with no
 *  helper data-* attributes). */
function attrNamed(attrName: string, domStyleProp: string, cssName: string) {
  return {
    default: null as string | null,
    parseHTML: (el: HTMLElement) => (el.style as any)[domStyleProp] || null,
    renderHTML: (attrs: Record<string, any>) => {
      const v = attrs[attrName];
      return v ? { style: `${cssName}: ${v}` } : {};
    },
  };
}

export const BlockStyle = Extension.create({
  name: 'blockStyle',

  addGlobalAttributes() {
    return [
      {
        types: BLOCK_TYPES,
        attributes: {
          lineHeight: attrNamed('lineHeight', 'lineHeight', 'line-height'),
          spaceBefore: attrNamed('spaceBefore', 'marginTop', 'margin-top'),
          spaceAfter: attrNamed('spaceAfter', 'marginBottom', 'margin-bottom'),
          firstLineIndent: attrNamed('firstLineIndent', 'textIndent', 'text-indent'),
          paragraphBorder: attrNamed('paragraphBorder', 'border', 'border'),
          paragraphShading: attrNamed('paragraphShading', 'backgroundColor', 'background-color'),
          breakControl: attrNamed('breakControl', 'breakInside', 'break-inside'),
          textDirection: attrNamed('textDirection', 'direction', 'direction'),
          verticalAlign: attrNamed('verticalAlign', 'verticalAlign', 'vertical-align'),
          // Hanging indent = positive padding-left + matching negative text-indent.
          hangingIndent: {
            default: null,
            parseHTML: (el: HTMLElement) => el.style.paddingLeft || null,
            renderHTML: (attrs: Record<string, any>) =>
              attrs.hangingIndent ? { style: `padding-left: ${attrs.hangingIndent}; text-indent: -${attrs.hangingIndent}` } : {},
          },
          // Drop cap is a class toggle, not a style prop.
          dropCap: {
            default: null,
            parseHTML: (el: HTMLElement) => (el.classList.contains('drop-cap') ? 'true' : null),
            renderHTML: (attrs: Record<string, any>) => (attrs.dropCap ? { class: 'drop-cap' } : {}),
          },
        },
      },
    ];
  },

  addCommands() {
    return {
      setBlockStyle:
        (attrs) =>
        ({ tr, state, dispatch }) => {
          const { from, to } = state.selection;
          let applied = false;
          state.doc.nodesBetween(from, to, (node, pos) => {
            if (node.isTextblock && BLOCK_TYPES.includes(node.type.name)) {
              applied = true;
              if (dispatch) tr.setNodeMarkup(pos, undefined, { ...node.attrs, ...attrs });
            }
          });
          return applied;
        },
    };
  },
});

export const PageBreak = Node.create({
  name: 'pageBreak',
  group: 'block',
  atom: true,
  selectable: true,
  parseHTML() {
    return [{ tag: 'div[data-page-break]' }];
  },
  renderHTML() {
    return ['div', { 'data-page-break': 'true', class: 'doc-page-break' }];
  },
  addCommands() {
    return {
      setPageBreak:
        () =>
        ({ commands }: any) =>
          commands.insertContent({ type: this.name }),
    } as any;
  },
});

export const SectionBreak = Node.create({
  name: 'sectionBreak',
  group: 'block',
  atom: true,
  selectable: true,
  parseHTML() {
    return [{ tag: 'div[data-section-break]' }];
  },
  renderHTML() {
    return ['div', { 'data-section-break': 'true', class: 'doc-section-break' }];
  },
  addCommands() {
    return {
      setSectionBreak:
        () =>
        ({ commands }: any) =>
          commands.insertContent({ type: this.name }),
    } as any;
  },
});

export default BlockStyle;
