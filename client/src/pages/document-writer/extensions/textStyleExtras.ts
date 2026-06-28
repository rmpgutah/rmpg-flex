// Custom TipTap text-style attributes — no extra npm packages, just global
// attributes hung off the built-in `textStyle` mark (the standard TipTap pattern
// for inline CSS marks). Each adds a `style:` property on render and a matching
// `set*`/`unset*` command for the toolbar. Powers toolbar features:
// font size, letter spacing, text shadow, text opacity, font weight, small caps,
// all/none text-transform.

import { Extension } from '@tiptap/core';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    textStyleExtras: {
      setFontSize: (size: string) => ReturnType;
      unsetFontSize: () => ReturnType;
      setLetterSpacing: (value: string) => ReturnType;
      unsetLetterSpacing: () => ReturnType;
      setTextShadow: (value: string) => ReturnType;
      unsetTextShadow: () => ReturnType;
      setTextOpacity: (value: string) => ReturnType;
      unsetTextOpacity: () => ReturnType;
      setFontWeight: (value: string) => ReturnType;
      unsetFontWeight: () => ReturnType;
      setSmallCaps: (on: boolean) => ReturnType;
      setTextTransform: (value: string | null) => ReturnType;
    };
  }
}

/** Build a `{ default, parseHTML, renderHTML }` attribute spec for one CSS prop. */
function styleAttr(cssProp: string, cssName: string) {
  return {
    default: null as string | null,
    parseHTML: (element: HTMLElement) => (element.style as any)[cssProp] || null,
    renderHTML: (attributes: Record<string, any>) => {
      const v = attributes[cssProp];
      return v ? { style: `${cssName}: ${v}` } : {};
    },
  };
}

export const TextStyleExtras = Extension.create({
  name: 'textStyleExtras',

  addGlobalAttributes() {
    return [
      {
        types: ['textStyle'],
        attributes: {
          fontSize: styleAttr('fontSize', 'font-size'),
          letterSpacing: styleAttr('letterSpacing', 'letter-spacing'),
          textShadow: styleAttr('textShadow', 'text-shadow'),
          opacity: styleAttr('opacity', 'opacity'),
          fontWeight: styleAttr('fontWeight', 'font-weight'),
          fontVariant: styleAttr('fontVariant', 'font-variant'),
          textTransform: styleAttr('textTransform', 'text-transform'),
        },
      },
    ];
  },

  addCommands() {
    const set = (key: string, value: string | null) =>
      ({ chain }: any) =>
        chain().setMark('textStyle', { [key]: value }).run();
    return {
      setFontSize: (size) => set('fontSize', size),
      unsetFontSize: () => set('fontSize', null),
      setLetterSpacing: (value) => set('letterSpacing', value),
      unsetLetterSpacing: () => set('letterSpacing', null),
      setTextShadow: (value) => set('textShadow', value),
      unsetTextShadow: () => set('textShadow', null),
      setTextOpacity: (value) => set('opacity', value),
      unsetTextOpacity: () => set('opacity', null),
      setFontWeight: (value) => set('fontWeight', value),
      unsetFontWeight: () => set('fontWeight', null),
      setSmallCaps: (on) => set('fontVariant', on ? 'small-caps' : null),
      setTextTransform: (value) => set('textTransform', value),
    };
  },
});

export default TextStyleExtras;
