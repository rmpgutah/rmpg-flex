// List enhancements (features 90–97): custom bullet/number styles, start number,
// and marker color as attributes on bulletList / orderedList. No new packages.

import { Extension } from '@tiptap/core';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    listStyles: {
      setListStyleType: (value: string) => ReturnType;
      setListMarkerColor: (value: string) => ReturnType;
      setListStart: (start: number) => ReturnType;
    };
  }
}

export const ListStyles = Extension.create({
  name: 'listStyles',

  addGlobalAttributes() {
    return [
      {
        types: ['bulletList', 'orderedList'],
        attributes: {
          listStyleType: {
            default: null,
            parseHTML: (el: HTMLElement) => el.style.listStyleType || null,
            renderHTML: (attrs: Record<string, any>) =>
              attrs.listStyleType ? { style: `list-style-type: ${attrs.listStyleType}` } : {},
          },
          markerColor: {
            default: null,
            parseHTML: (el: HTMLElement) => el.style.color || null,
            renderHTML: (attrs: Record<string, any>) =>
              attrs.markerColor ? { style: `color: ${attrs.markerColor}` } : {},
          },
        },
      },
      {
        types: ['orderedList'],
        attributes: {
          start: {
            default: 1,
            parseHTML: (el: HTMLElement) => Number(el.getAttribute('start')) || 1,
            renderHTML: (attrs: Record<string, any>) => (attrs.start && attrs.start !== 1 ? { start: attrs.start } : {}),
          },
        },
      },
    ];
  },

  addCommands() {
    const updateActiveList = (key: string, value: any) =>
      ({ editor, commands }: any) => {
        const type = editor.isActive('orderedList') ? 'orderedList' : 'bulletList';
        return commands.updateAttributes(type, { [key]: value });
      };
    return {
      setListStyleType: (value) => updateActiveList('listStyleType', value),
      setListMarkerColor: (value) => updateActiveList('markerColor', value),
      setListStart: (start) => ({ commands }: any) => commands.updateAttributes('orderedList', { start }),
    };
  },
});

export default ListStyles;
