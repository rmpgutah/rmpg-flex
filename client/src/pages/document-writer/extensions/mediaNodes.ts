// Embedded media nodes (features 80–83): video/iframe embeds and an audio player.
// Implemented as atom block nodes wrapping an <iframe> / <audio>. No new packages.

import { Node, mergeAttributes } from '@tiptap/core';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    mediaNodes: {
      setEmbed: (src: string) => ReturnType;
      setAudio: (src: string) => ReturnType;
    };
  }
}

/** Normalize common share URLs (YouTube/Vimeo) to their embeddable form. */
function toEmbedUrl(url: string): string {
  const yt = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([\w-]+)/);
  if (yt) return `https://www.youtube.com/embed/${yt[1]}`;
  const vimeo = url.match(/vimeo\.com\/(\d+)/);
  if (vimeo) return `https://player.vimeo.com/video/${vimeo[1]}`;
  return url;
}

export const Embed = Node.create({
  name: 'embed',
  group: 'block',
  atom: true,
  draggable: true,
  addAttributes() {
    return { src: { default: '' } };
  },
  parseHTML() {
    return [{ tag: 'div[data-embed] iframe', getAttrs: (el) => ({ src: (el as HTMLElement).getAttribute('src') }) }];
  },
  renderHTML({ HTMLAttributes }) {
    return [
      'div',
      { 'data-embed': 'true', class: 'doc-embed', style: 'position:relative;padding-bottom:56.25%;height:0' },
      ['iframe', mergeAttributes(HTMLAttributes, {
        style: 'position:absolute;top:0;left:0;width:100%;height:100%;border:0',
        allowfullscreen: 'true',
      })],
    ];
  },
  addCommands() {
    return {
      setEmbed: (src: string) => ({ commands }: any) =>
        commands.insertContent({ type: this.name, attrs: { src: toEmbedUrl(src) } }),
    } as any;
  },
});

export const Audio = Node.create({
  name: 'audio',
  group: 'block',
  atom: true,
  draggable: true,
  addAttributes() {
    return { src: { default: '' } };
  },
  parseHTML() {
    return [{ tag: 'audio', getAttrs: (el) => ({ src: (el as HTMLElement).getAttribute('src') }) }];
  },
  renderHTML({ HTMLAttributes }) {
    return ['audio', mergeAttributes(HTMLAttributes, { controls: 'true', class: 'doc-audio', style: 'width:100%' })];
  },
  addCommands() {
    return {
      setAudio: (src: string) => ({ commands }: any) =>
        commands.insertContent({ type: this.name, attrs: { src } }),
    } as any;
  },
});
