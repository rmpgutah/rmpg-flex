# Dispatch Notes — Formatting Fix + Upgrades + Re-editable Entries (Phase 1)

**Date:** 2026-06-12
**Status:** Design approved (sequencing: phased — this is Phase 1 of 2)
**Scope:** Dispatch call notes only. No DB migration. One small Worker auth change. One client PR.

> This is **Phase 1**. Phase 2 (a unified Word/Pages-style **document subsystem** — named,
> reopenable documents attachable to calls/incidents) is deliberately out of scope here and
> will get its own spec. Phase 1 builds the formatting foundation Phase 2 reuses.

---

## 1. Problem

Dispatch call notes support `**bold**`, `*italic*`, `__underline__` inline markers. Three problems:

1. **Formatting vanishes when printing / generating a PDF.** Bold/italic/underline render
   correctly in the browser note list but come out as plain text in the call/incident PDF.
2. **Strikeout doesn't exist** anywhere (no toolbar button, no browser rendering, no PDF rendering).
   The user lists it as a "function that fails" — it is in fact unimplemented.
3. **No list support** — bullets and numbered/outline lists are not available in notes.

Additionally, the user wants notes to behave more like a document: a saved note should be
**reopenable in the full formatting editor and re-editable after save by its author**, not
just by admins through a plain (toolbar-less) edit box.

## 2. Confirmed root cause of the print bug

In [`addFormattedText`](../../../client/src/utils/pdfGenerator.ts) (line ~1689) the first line sanitizes the input:

```ts
const text = sanitizePdfText(rawText);   // pdfGenerator.ts:1691
```

[`sanitizePdfText`](../../../client/src/utils/pdfGenerator.ts) **unconditionally strips every emphasis marker** (lines ~280-288):

```ts
.replace(/\*\*/g, '')        // removes ALL bold markers
.replace(/__/g, '')          // removes ALL underline markers
.replace(/\*(?=\w)/g, '')    // removes italic markers (asterisk before a word char)
.replace(/(?<=\w)\*/g, '')   // removes italic markers (asterisk after a word char)
```

By the time the rendering regex (`segRegex`, line ~1781) runs, **no markers remain to match**, so
the bold/italic/underline drawing block (lines ~1790-1803) is dead code. The browser path
([`renderFormattedText`](../../../client/src/pages/dispatch/DispatchPage.tsx), line ~1708) parses markers
directly without sanitizing, which is why formatting shows on screen but not in print.

These strip rules were each added as defensive "safety nets" for *unmatched* markers leaking from
serve-intake imports (dated comments at lines 269-288). Each was locally correct but globally
defeated the matched-marker rendering the same function depends on.

The notes-string assembly is **not** at fault: [`IncidentsPage.tsx:1287`](../../../client/src/pages/IncidentsPage.tsx)
joins notes as `` `[ts] author: ${text}` `` with `\n`, preserving markers verbatim. The renderer is the only bug.

`addFormattedText` is a **shared renderer**: it feeds dispatch `call_notes` (line ~3241) and call
`narrative` (line ~3283), and `addNarrativeSection` wraps it for ~15 other report types. Fixing the
order-of-operations restores rich text in **every** PDF at once.

## 3. Goals / Non-goals

**Goals**
- Bold / italic / underline render correctly in PDFs (fix the order-of-operations bug).
- Add **strikeout** end to end (editor + browser + PDF).
- Add **bullet** lists (`- `) and **ordered** lists with **outline / dotted-decimal numbering**
  (`1`, `1.1`, `1.1.1`) end to end. Nesting depth = indentation; numbering is computed at render time.
- A saved note can be **reopened in the full formatting editor and re-edited & re-saved by its
  author** (and by admins/managers, as today).
- Keep all three consumers (editor, browser renderer, PDF renderer) in sync via a single shared
  grammar module.

**Non-goals (Phase 1)**
- No WYSIWYG editor, no TipTap, no contentEditable. Notes stay plain-text markdown-marker strings.
- No DB migration. No change to the notes storage format or the notes JSON-array shape (beyond an
  additive `author_username` field on newly-created note objects — same JSON, no schema change).
- No new document model (that's Phase 2).
- No highlight/color, checkbox/task lists, tables, or images in notes.
- **Author deletion** of notes is *not* enabled — only author *editing*. Deletion stays
  admin/manager-only (notes are evidentiary; edits leave an `edited_at`/`edited_by` audit trail,
  deletes do not).

## 4. The marker grammar (shared contract)

All three consumers import one module so the grammar can't drift.

**Inline marks** (within a line, may nest plain text between them):
| Mark | Markers | Browser | PDF |
|------|---------|---------|-----|
| Bold | `**text**` | `font-bold` span | Courier `bold` |
| Italic | `*text*` (single asterisk) | `italic` span | Courier `bolditalic` (existing behavior) |
| Underline | `__text__` | `underline` span | manual underline line (existing) |
| Strike | `~~text~~` *(new)* | `line-through` span | manual strike line through text center |

**Block / line-level** (classified at the start of each hard line):
- **Bullet:** `^(\s*)-\s+(.*)$` → bullet item. (Hyphen, *not* `*`, to avoid colliding with italic `*`.)
- **Ordered:** `^(\s*)\d+\.\s+(.*)$` → ordered item. The typed digit is ignored; the displayed
  number is computed (outline numbering, §5).
- **Plain:** anything else.
- **Indent unit:** **2 spaces = 1 level**; `depth = floor(leadingSpaces / 2)` (matches the Doc Writer
  exporter convention).

## 5. Outline numbering algorithm

Walk the classified lines top-to-bottom maintaining `counters: number[]` (index = depth):

- **Ordered item at depth `d`:** truncate `counters` to length `d+1`, then
  `counters[d] = (counters[d] ?? 0) + 1`. Displayed number =
  `counters.slice(0, d+1).filter(v => v > 0).join('.')`.
  (Pure nesting from depth 0 yields `1`, `1.1`, `1.1.1`; odd starts degrade gracefully — no `0.` artifacts.)
- **Bullet item at depth `d`:** render the bullet glyph; does **not** change `counters` (so an ordered
  list resumes its sequence after an interleaved bullet).
- **Plain line at depth 0:** reset `counters = []`. This ends a list and, because each note is joined
  as a depth-0 `[ts] author: …` line in the PDF, prevents numbering from bleeding across notes.
- **Plain line at depth > 0:** treated as wrapped continuation; `counters` unchanged.

**Bullet glyph:** browser uses `•`. PDF font is Latin-1/Courier (cannot render `•`; `sanitizePdfText`
maps `U+2022 → '*'`), so the **PDF draws a small filled circle** via `doc.circle(x, y, r, 'F')` —
font-independent. Ordered numbers (`"1.1"`) are ASCII and render directly.

## 6. Components & changes

### 6a. New shared grammar module — `client/src/utils/noteFormatting.ts`
Pure, dependency-free, unit-tested. Exports:
- `INLINE_MARK_REGEX` and `tokenizeInline(line): InlineToken[]` where
  `InlineToken = { text: string; bold?: boolean; italic?: boolean; underline?: boolean; strike?: boolean }`.
- `classifyLine(line): { kind: 'bullet'|'ordered'|'plain'; depth: number; content: string }`.
- `computeListLines(text): RenderLine[]` — splits text into lines, classifies each, computes outline
  numbers, returns `{ kind, depth, marker, content }[]` (marker = `'•'` | `'1.1'` | `''`).
- `stripStrayMarkers(s): string` — removes residual/unmatched `**`/`__`/`*`/`~~` from a plain text run.
- `INDENT_UNIT = 2`.

### 6b. Fix the print bug — `client/src/utils/pdfGenerator.ts`
- Add an options arg: `sanitizePdfText(text, opts?: { preserveMarkers?: boolean })`. When
  `preserveMarkers` is true, **skip** the four marker-stripping replaces (lines ~280, 281, 287, 288)
  and the paired `_(…)_` replace (286). All other cleanup (HTML entities, backslash escapes, Unicode
  normalization, `toUpperCase()`) still runs. Default `false` preserves existing callers' behavior.
- `addFormattedText` calls `sanitizePdfText(rawText, { preserveMarkers: true })`.
- Preserve the serve-intake "unmatched marker" safety net by stripping markers **only on plain
  segments** right before drawing them: apply `stripStrayMarkers()` to the `plain` slices
  (lines ~1786-1788 and ~1806-1809). Matched pairs are consumed by `segRegex` first, so anything left
  in a plain run is provably unmatched.
- `addNarrativeSection` (line ~1825) currently pre-sanitizes at line ~1833 then calls `addFormattedText`
  (double sanitize → strips markers before delegating). Switch its internal sanitize to
  `{ preserveMarkers: true }` (used for height measurement / the no-marker fast path) so markers reach
  `addFormattedText` intact.

### 6c. Strikeout — end to end
- **Editor:** add an `S` toolbar button (`wrapNoteSelection('~~')`) and `Ctrl/Cmd+Shift+S`.
- **Browser** `renderFormattedText`: add `~~(.+?)~~` → `<span className="line-through">`.
- **PDF** `addFormattedText`: add `~~` to `segRegex`; render the text in `normal` font and draw a
  strike line through the vertical center (`doc.line` at ≈ `y - lineH*0.3`), mirroring the existing
  underline technique at line ~1801. Also extend the marker-walking length logic (lines ~1752-1766)
  and `stripMarkers` (line ~1716) to account for `~~`.

### 6d. Bullets + ordered/outline lists — end to end
- **Browser** `renderFormattedText` becomes **block-aware**: use `computeListLines(text)` to render an
  outer block (`<div>`) of indented rows. Each row: a gutter showing the bullet `•` or computed number
  (`1.1`), padded-left by `depth × indentUnit`, then the row content rendered with the inline tokenizer.
  Plain lines render as plain paragraphs. The note display moves from a `<span>`
  ([DispatchPage.tsx:5747](../../../client/src/pages/dispatch/DispatchPage.tsx)) to a block container.
- **PDF** `addFormattedText`: per hard line, `classifyLine`; for list items, indent `x` by
  `depth × INDENT_MM` plus a gutter, draw the bullet circle or the outline number string in the gutter,
  then render the inline-formatted remainder at the indented x. Maintain the `counters` stack across the
  section (it survives page breaks — it's a local accumulator). Wrapped continuation lines of a list
  item align to the content x (hanging indent).

### 6e. Editor UX — `client/src/pages/dispatch/DispatchPage.tsx`
Extract the note input into a small reusable **`NoteComposer`** piece (toolbar + textarea + key
handling), used by **both** the "add" box and the inline "edit" box so editing gets the same tools.
New file: `client/src/pages/dispatch/components/NoteComposer.tsx`. Props:
`{ value, onChange, onSubmit, submitLabel, autoFocus? }`.

Behaviors:
- Toolbar buttons: **B**, **I**, **U**, **S** (inline marks) + **• Bullet** and **1. Number** (prefix the
  current line(s) with `- ` / `1. `).
- **Tab / Shift+Tab** in the textarea indents/outdents the current line by `INDENT_UNIT` spaces (event
  intercepted with `preventDefault` so focus is retained).
- **Enter** on a list line auto-continues the list at the same indent (insert `- ` / `N. `). **Enter on
  an empty list item** ends the list (removes the marker, outdents). **Submit stays `Shift+Enter`** (unchanged).
- `maxLength` raised from 2000 to accommodate multi-line lists (e.g. 4000); confirm against any
  server-side length guard.

### 6f. Re-editable note entries — author edit
**Client** ([DispatchPage.tsx:5748](../../../client/src/pages/dispatch/DispatchPage.tsx)):
- Show the **Edit** button when the current user is admin/manager **OR** owns the note. Ownership =
  `note.author_username === currentUser.username` (new notes), with a fallback to display-name match
  for legacy notes that predate `author_username`.
- The **Delete** button stays admin/manager-only (see Non-goals rationale).
- Edit mode uses `NoteComposer` (full toolbar + list/Tab/Enter behaviors), pre-loaded with the note's
  raw marker text, so formatting "reopens" intact.

**Worker** ([src/routes/dispatch/extensions.ts](../../../src/routes/dispatch/extensions.ts)):
- **Note create** (POST `/:id/notes` and the inline add path): stamp `author_username: user?.username`
  onto the note object alongside the existing display `author`. Additive field; no schema change.
- **PUT `/:id/notes/:noteId`**: relax the gate from `requireRole(...ADMIN_ROLES)` to the same role set
  that may create notes (`WRITE_ROLES`). Inside the handler, allow the edit if the user is
  admin/manager **OR** `note.author_username === user.username`; otherwise return **403**. Continue to
  set `edited_at`/`edited_by`.
- **DELETE `/:id/notes/:noteId`**: unchanged — stays `ADMIN_ROLES`.

### 6g. Service worker
Bump `CACHE_NAME` in `client/public/sw.js` (required on every client change per project convention).

## 7. Data flow (unchanged contract)

```
textarea (NoteComposer) ──markers/list text──▶ POST /:id/notes {text, author}
   server stamps author_username ──▶ calls_for_service.notes (JSON array, plain strings)
Display:  note.text ──renderFormattedText(block-aware)──▶ React rows
PDF:      notes joined "[ts] author: text"\n ──addFormattedText──▶ jsPDF
Edit:     pick note ──raw text──▶ NoteComposer ──PUT /:id/notes/:noteId──▶ re-saved
```

Storage format, the notes JSON array, and the PDF data contract are unchanged.

## 8. Files

| File | Change |
|------|--------|
| `client/src/utils/noteFormatting.ts` | **new** — shared grammar module |
| `client/src/utils/noteFormatting.test.ts` | **new** — vitest unit tests |
| `client/src/utils/pdfGenerator.ts` | sanitize ordering fix; `~~` strike; list/outline rendering; `addNarrativeSection` sanitize fix |
| `client/src/pages/dispatch/DispatchPage.tsx` | block-aware `renderFormattedText`; use `NoteComposer` for add + edit; author-edit gate |
| `client/src/pages/dispatch/components/NoteComposer.tsx` | **new** — toolbar + textarea + Tab/Enter/shortcut behaviors |
| `src/routes/dispatch/extensions.ts` | stamp `author_username` on create; relax PUT gate to author-or-admin |
| `client/public/sw.js` | bump `CACHE_NAME` |

No migration. No `wrangler.toml`/binding change.

## 9. Testing

- **Unit (vitest, `noteFormatting.test.ts`):** inline tokenizer (incl. strikeout, adjacent/nested marks,
  unmatched markers via `stripStrayMarkers`); `classifyLine` depth detection; `computeListLines`
  outline numbering for pure-ordered nesting (`1`/`1.1`/`1.1.1`), mixed bullet+ordered, reset on
  depth-0 plain line, and graceful odd-start cases.
- **PDF render:** generate a sample call/incident PDF containing a note with every mark + a nested
  outline list; verify visually with `pdftoppm` (canvas/jsPDF draw calls aren't jsdom-testable —
  project memory documents this limit).
- **Browser:** manual check in the dispatch call detail — add a formatted+listed note, confirm it
  renders, reopen it in edit mode (formatting intact), re-save as author.
- **Auth:** confirm an officer can edit their own note (200) but not another user's (403); admin can
  edit any; delete remains admin-only.
- **Regression:** existing narratives/reports that used `**bold**` etc. now show formatting in PDF;
  serve-intake notes with *unmatched* `**` still render clean (no stray markers).

## 10. Risks

- **Shared renderer blast radius.** The sanitize fix changes every PDF using `addFormattedText` /
  `addNarrativeSection`. Mitigated by `preserveMarkers` being opt-in and the unmatched-marker net
  preserved at the plain-segment level; covered by the regression check.
- **Marker/bullet collision.** Using `-` (not `*`) for bullets avoids the italic-`*` ambiguity.
- **Author identity.** Ownership keys on `author_username` (authenticated), not the spoofable display
  `author`; legacy notes without it fall back to admin-or-display-name. Documented, acceptable for Phase 1.
- **`renderFormattedText` block change.** Moving from inline `<span>` to a block container could affect
  surrounding layout; verify the note row styling (`leading-relaxed`, edited badge) still reads correctly.

## 11. Out of scope → Phase 2 (separate spec)

A unified **document subsystem**: a `documents` model (title, rich body, owner, timestamps, revision
tracking, optional `call_id`/`incident_id` link) with full create → save → close → reopen → edit
lifecycle, surfaced both as a per-call narrative panel and a standalone, attachable document library.
Reuses Phase 1's grammar + renderer. Requires storage + migration + save/load API + open/save UI, and
a decision on lightweight-markdown vs. Doc Writer/TipTap as the document body format.
