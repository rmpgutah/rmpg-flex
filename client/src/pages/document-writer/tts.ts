// Read-aloud (text-to-speech) for the Document Writer using the browser
// SpeechSynthesis API. No npm dependency. A tiny controller wraps play/stop and
// notifies a listener when speaking state changes so the toolbar button can
// reflect it. Reads the current selection if there is one, else the whole doc.

import type { Editor } from '@tiptap/react';

export function ttsSupported(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window;
}

/** Plain text of the current selection, or the whole document if nothing is
 *  selected. Collapses runs of whitespace so the synthesizer doesn't pause oddly. */
export function textToRead(editor: Editor): string {
  const { from, to } = editor.state.selection;
  const raw = from !== to
    ? editor.state.doc.textBetween(from, to, '\n', ' ')
    : editor.state.doc.textContent;
  return raw.replace(/\s+\n/g, '\n').replace(/[ \t]{2,}/g, ' ').trim();
}

export class ReadAloud {
  private onChange: (speaking: boolean) => void;
  private utterance: SpeechSynthesisUtterance | null = null;

  constructor(onChange: (speaking: boolean) => void) {
    this.onChange = onChange;
  }

  get speaking(): boolean {
    return ttsSupported() && window.speechSynthesis.speaking;
  }

  /** Start reading `text`. Cancels anything already in progress. */
  speak(text: string): void {
    if (!ttsSupported() || !text) return;
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 1;
    u.pitch = 1;
    u.onend = () => { this.utterance = null; this.onChange(false); };
    u.onerror = () => { this.utterance = null; this.onChange(false); };
    this.utterance = u;
    window.speechSynthesis.speak(u);
    this.onChange(true);
  }

  stop(): void {
    if (!ttsSupported()) return;
    window.speechSynthesis.cancel();
    this.utterance = null;
    this.onChange(false);
  }
}
