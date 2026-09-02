// Real, wired Document Writer features. Each function takes the TipTap editor
// and performs a concrete insertion / mutation. No stubs.
import type { Editor } from '@tiptap/core';
import QRCode from 'qrcode';
import { apiFetch } from '../../../hooks/useApi';

export type EditorRef = Editor | null;

/** Insert raw HTML at the current selection (content is built locally by us). */
function insertHtml(editor: EditorRef, html: string) {
  if (!editor) return;
  editor.chain().focus().insertContent(html).run();
}

// ────────── Date / time inserters (8) ──────────
export const insertDate = (editor: EditorRef) => insertHtml(editor, new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }));
export const insertTime = (editor: EditorRef) => insertHtml(editor, new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }));
export const insertDateTime = (editor: EditorRef) => insertHtml(editor, new Date().toLocaleString());
export const insertISO = (editor: EditorRef) => insertHtml(editor, new Date().toISOString());
export const insertMilitary = (editor: EditorRef) => {
  const d = new Date();
  insertHtml(editor, `${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')} hrs ${d.toLocaleDateString()}`);
};
export const insertWeekday = (editor: EditorRef) => insertHtml(editor, new Date().toLocaleDateString('en-US', { weekday: 'long' }));
export const insertEpoch = (editor: EditorRef) => insertHtml(editor, String(Math.floor(Date.now() / 1000)));
export const insertCaseDate = (editor: EditorRef) => insertHtml(editor, new Date().toISOString().slice(0, 10).replace(/-/g, ''));

// ────────── Signature ──────────
export function insertSignatureFromFile(editor: EditorRef, file: File): Promise<void> {
  if (!editor) return Promise.resolve();
  return new Promise((resolve) => {
    const r = new FileReader();
    r.onload = () => {
      editor.chain().focus().setImage({ src: r.result as string }).run();
      resolve();
    };
    r.readAsDataURL(file);
  });
}

// ────────── QR code linkback ──────────
export async function insertQRCode(editor: EditorRef, text: string, size = 120): Promise<void> {
  if (!editor) return;
  try {
    const dataUrl = await QRCode.toDataURL(text, { width: size, margin: 1 });
    editor.chain().focus().setImage({ src: dataUrl }).run();
  } catch (err) {
    console.error('[features] QR generation failed', err);
  }
}

// ────────── Redaction ──────────
export function redactSelection(editor: EditorRef) {
  if (!editor) return;
  const { from, to } = editor.state.selection;
  if (from === to) return;
  const text = editor.state.doc.textBetween(from, to);
  const block = `█`.repeat(Math.max(3, Math.min(60, text.length)));
  editor.chain().focus().deleteRange({ from, to }).insertContent(
    `<span style="background:#000;color:#000;font-family:'Arial, sans-serif';border-radius:2px;padding:0 2px;" title="[REDACTED]">${block}</span>`,
  ).run();
}

// ────────── Chain of custody table ──────────
export function insertChainOfCustody(editor: EditorRef) {
  const rows = Array(6).fill(0).map(() =>
    `<tr><td style="border:1px solid #333;padding:4px;height:22px;">&nbsp;</td><td style="border:1px solid #333;padding:4px;">&nbsp;</td><td style="border:1px solid #333;padding:4px;">&nbsp;</td><td style="border:1px solid #333;padding:4px;">&nbsp;</td></tr>`,
  ).join('');
  insertHtml(editor,
    `<h3 style="font-size:13px;border-bottom:1px solid #333;">CHAIN OF CUSTODY</h3>` +
    `<table style="width:100%;border-collapse:collapse;font-size:11px;margin-bottom:12px;">` +
    `<tr style="background:#f0f0f0;"><th style="border:1px solid #333;padding:4px;">Date/Time</th><th style="border:1px solid #333;padding:4px;">Released By</th><th style="border:1px solid #333;padding:4px;">Received By</th><th style="border:1px solid #333;padding:4px;">Purpose</th></tr>${rows}</table>`,
  );
}

// ────────── Bates stamp ──────────
const BATES_KEY = 'rmpg_writer_bates_counter';
export function insertBates(editor: EditorRef, prefix = 'RMPG') {
  const cur = Number(localStorage.getItem(BATES_KEY) || '1');
  localStorage.setItem(BATES_KEY, String(cur + 1));
  const stamp = `${prefix}-${String(cur).padStart(6, '0')}`;
  insertHtml(editor, `<span style="font-family:'Arial, sans-serif';font-size:9px;color:#888;border:1px solid #888;padding:1px 4px;">${stamp}</span>`);
}
export function resetBates() { localStorage.setItem(BATES_KEY, '1'); }
export function currentBates(): number { return Number(localStorage.getItem(BATES_KEY) || '1'); }

// ────────── Footnote ──────────
let footnoteCounter = 0;
export function insertFootnote(editor: EditorRef, text: string) {
  if (!editor) return;
  footnoteCounter++;
  const n = footnoteCounter;
  insertHtml(editor, `<sup id="fnref-${n}" style="color:#d4a017;">[${n}]</sup>`);
  editor.commands.focus('end');
  insertHtml(editor, `<p id="fn-${n}" style="font-size:10px;border-top:1px dashed #888;padding-top:4px;color:#555;">[${n}] ${text}</p>`);
}

// ────────── Table of contents (parses our own editor HTML via DOMParser) ──────────
export function buildTOC(editor: EditorRef) {
  if (!editor) return;
  const html = editor.getHTML();
  const parsed = new DOMParser().parseFromString(html, 'text/html');
  const heads = Array.from(parsed.querySelectorAll('h1, h2, h3'));
  if (heads.length === 0) {
    insertHtml(editor, `<p><em>No headings found — add some H1/H2/H3 first.</em></p>`);
    return;
  }
  const lines = heads.map(h => {
    const level = Number(h.tagName.slice(1));
    const indent = (level - 1) * 16;
    const t = (h.textContent || '').trim().replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c] || c));
    return `<div style="margin-left:${indent}px;font-size:11px;line-height:1.6;">${t} <span style="color:#888;">.....</span></div>`;
  }).join('');
  insertHtml(editor, `<div style="border:1px solid #333;padding:8px;margin:8px 0;"><strong>TABLE OF CONTENTS</strong>${lines}</div>`);
}

// ────────── Readability score ──────────
export interface Readability {
  words: number;
  sentences: number;
  syllables: number;
  fleschKincaid: number;
  flesch: number;
  grade: string;
}
function countSyllables(word: string): number {
  word = word.toLowerCase().replace(/[^a-z]/g, '');
  if (!word) return 0;
  if (word.length <= 3) return 1;
  word = word.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, '').replace(/^y/, '');
  const m = word.match(/[aeiouy]{1,2}/g);
  return Math.max(1, m ? m.length : 1);
}
export function readability(text: string): Readability {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 0);
  const syllables = words.reduce((sum, w) => sum + countSyllables(w), 0);
  const w = Math.max(1, words.length), s = Math.max(1, sentences.length);
  const fk = 0.39 * (w / s) + 11.8 * (syllables / w) - 15.59;
  const fle = 206.835 - 1.015 * (w / s) - 84.6 * (syllables / w);
  const grade = fk < 6 ? 'easy' : fk < 9 ? 'plain English' : fk < 13 ? 'high school' : fk < 17 ? 'college' : 'specialist';
  return { words: w, sentences: s, syllables, fleschKincaid: Number(fk.toFixed(1)), flesch: Number(fle.toFixed(1)), grade };
}

// ────────── Save as user template ──────────
const USER_TPL_KEY = 'rmpg_writer_user_templates';
export interface UserTemplate { id: string; name: string; html: string; createdAt: string; }
export function listUserTemplates(): UserTemplate[] {
  try { return JSON.parse(localStorage.getItem(USER_TPL_KEY) || '[]'); } catch { return []; }
}
export function saveUserTemplate(name: string, html: string): UserTemplate {
  const all = listUserTemplates();
  const t: UserTemplate = { id: `user-${Date.now()}`, name, html, createdAt: new Date().toISOString() };
  all.unshift(t);
  localStorage.setItem(USER_TPL_KEY, JSON.stringify(all.slice(0, 50)));
  return t;
}
export function deleteUserTemplate(id: string) {
  const next = listUserTemplates().filter(t => t.id !== id);
  localStorage.setItem(USER_TPL_KEY, JSON.stringify(next));
}

// ────────── Statute lookup (live from /api/statutes) ──────────
export interface StatuteHit { code: string; title?: string; text?: string; }
export async function searchStatutes(q: string): Promise<StatuteHit[]> {
  if (!q.trim()) return [];
  try {
    const data = await apiFetch<{ data?: StatuteHit[]; results?: StatuteHit[] } | StatuteHit[]>(`/statutes?q=${encodeURIComponent(q)}&limit=12`);
    if (Array.isArray(data)) return data;
    return data.data || data.results || [];
  } catch { return []; }
}
export function insertStatute(editor: EditorRef, hit: StatuteHit) {
  const title = hit.title ? ` — ${hit.title}` : '';
  insertHtml(editor, `<span style="background:#f7f3e8;border-left:3px solid #d4a017;padding:2px 6px;font-size:11px;display:inline-block;"><strong>Utah Code §${hit.code}</strong>${title}</span>`);
}

// ────────── Person mail-merge ──────────
export interface PersonHit { person_id?: number; id?: number; full_name?: string; first_name?: string; last_name?: string; dob?: string; address?: string; phone?: string; }
export async function searchPersons(q: string): Promise<PersonHit[]> {
  if (!q.trim()) return [];
  try {
    const data = await apiFetch<{ persons?: PersonHit[] } | PersonHit[]>(`/records/persons/search?q=${encodeURIComponent(q)}`);
    if (Array.isArray(data)) return data;
    return data.persons || [];
  } catch { return []; }
}
export function insertPersonBlock(editor: EditorRef, p: PersonHit) {
  const name = p.full_name || [p.first_name, p.last_name].filter(Boolean).join(' ') || 'Unknown';
  insertHtml(editor,
    `<table style="border-collapse:collapse;font-size:11px;margin:6px 0;">` +
    `<tr><td style="border:1px solid #333;padding:4px;background:#f0f0f0;"><strong>Name</strong></td><td style="border:1px solid #333;padding:4px;">${name}</td></tr>` +
    `<tr><td style="border:1px solid #333;padding:4px;background:#f0f0f0;"><strong>DOB</strong></td><td style="border:1px solid #333;padding:4px;">${p.dob || ''}</td></tr>` +
    `<tr><td style="border:1px solid #333;padding:4px;background:#f0f0f0;"><strong>Address</strong></td><td style="border:1px solid #333;padding:4px;">${p.address || ''}</td></tr>` +
    `<tr><td style="border:1px solid #333;padding:4px;background:#f0f0f0;"><strong>Phone</strong></td><td style="border:1px solid #333;padding:4px;">${p.phone || ''}</td></tr>` +
    `</table>`,
  );
}

// ────────── Call/CFS mail-merge ──────────
export interface CallHit { call_id?: number; call_number?: string; call_type?: string; address?: string; received_at?: string; status?: string; }
export async function searchCalls(q: string): Promise<CallHit[]> {
  if (!q.trim()) return [];
  try {
    const data = await apiFetch<{ calls?: CallHit[] } | CallHit[]>(`/dispatch/calls?q=${encodeURIComponent(q)}&limit=10`);
    if (Array.isArray(data)) return data;
    return data.calls || [];
  } catch { return []; }
}
export function insertCallBlock(editor: EditorRef, c: CallHit) {
  insertHtml(editor,
    `<table style="border-collapse:collapse;font-size:11px;margin:6px 0;">` +
    `<tr><td style="border:1px solid #333;padding:4px;background:#f0f0f0;"><strong>Call #</strong></td><td style="border:1px solid #333;padding:4px;">${c.call_number || ''}</td></tr>` +
    `<tr><td style="border:1px solid #333;padding:4px;background:#f0f0f0;"><strong>Type</strong></td><td style="border:1px solid #333;padding:4px;">${c.call_type || ''}</td></tr>` +
    `<tr><td style="border:1px solid #333;padding:4px;background:#f0f0f0;"><strong>Address</strong></td><td style="border:1px solid #333;padding:4px;">${c.address || ''}</td></tr>` +
    `<tr><td style="border:1px solid #333;padding:4px;background:#f0f0f0;"><strong>Received</strong></td><td style="border:1px solid #333;padding:4px;">${c.received_at || ''}</td></tr>` +
    `<tr><td style="border:1px solid #333;padding:4px;background:#f0f0f0;"><strong>Status</strong></td><td style="border:1px solid #333;padding:4px;">${c.status || ''}</td></tr>` +
    `</table>`,
  );
}

// ────────── Voice dictation (Web Speech API) ──────────
export interface DictationSession { stop: () => void; }
export function startDictation(editor: EditorRef, onError?: (msg: string) => void): DictationSession | null {
  type SRCtor = new () => SpeechRecognition;
  const win = window as unknown as { SpeechRecognition?: SRCtor; webkitSpeechRecognition?: SRCtor };
  const SR = win.SpeechRecognition || win.webkitSpeechRecognition;
  if (!SR) { onError?.('Speech recognition not available in this browser (Chrome/Edge only).'); return null; }
  const rec = new SR();
  rec.continuous = true;
  rec.interimResults = false;
  rec.lang = 'en-US';
  rec.onresult = (e: SpeechRecognitionEvent) => {
    for (let i = e.resultIndex; i < e.results.length; i++) {
      if (e.results[i].isFinal) {
        insertHtml(editor, e.results[i][0].transcript + ' ');
      }
    }
  };
  rec.onerror = (e: SpeechRecognitionErrorEvent) => onError?.(`Dictation error: ${e.error}`);
  rec.start();
  return { stop: () => rec.stop() };
}
