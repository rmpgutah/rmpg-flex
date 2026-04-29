# RMPG PDF Engine

A company-owned PDF rendering facade for the RMPG Flex CAD/RMS. Every PDF
view in the app — editor, thumbnails, document previews — goes through this
engine instead of importing a third-party library directly.

## Architecture

```
┌─────────────────────────────────────────────┐
│ Editor / Viewer / Thumbnails / Preview UI   │
└──────────────────────┬──────────────────────┘
                       │  open(bytes) → RmpgPdfDocument
                       ▼
┌─────────────────────────────────────────────┐
│ Dispatcher (index.ts)                        │
│  1. Try native backend                       │
│  2. On BackendUnsupportedError → PDF.js      │
│  3. Record outcome in diagnostics            │
└──────────────────────┬──────────────────────┘
            ┌──────────┴──────────┐
            ▼                     ▼
   ┌────────────────┐   ┌────────────────┐
   │ Native backend │   │ PDF.js backend │
   │ (100% ours)    │   │ (Mozilla,      │
   │                │   │  Apache 2.0,   │
   │  parser/lexer  │   │  vendored as a │
   │  contentStream │   │  swappable     │
   │  renderer      │   │  engine)       │
   └────────────────┘   └────────────────┘
```

## Native backend coverage (initial)

The native renderer handles the constrained subset of PDFs that RMPG Flex
itself generates via jsPDF — daily activity reports, citation copies,
incident summaries, etc. Specifically:

- **File structure**: classic `xref` table + standalone `/Catalog` + `/Pages` tree
- **Streams**: uncompressed or `FlateDecode`-compressed via `DecompressionStream`
- **Fonts**: Standard 14 only (Helvetica, Times, Courier, Symbol, ZapfDingbats)
- **Color**: `DeviceRGB` and `DeviceGray` solid fills/strokes
- **Operators**: `q Q cm w m l c v y h re S s f F f* B B* b b* n RG rg G g BT ET Tf Tj TJ ' " Td TD Tm T* Tc Tw Tz TL Tr Ts`

## What forces a fallback to PDF.js

Anything outside the list above — and these specific cases trigger
`BackendUnsupportedError` early in `open()` so we don't waste work:

- Encrypted documents (presence of `/Encrypt` in trailer)
- Cross-reference streams (PDF 1.5+ `/Type /XRef`)
- Object streams (`/Type /ObjStm`)
- Embedded Type1/TrueType/CFF fonts beyond Standard 14
- Images (`Do`, inline `BI/EI`)
- Patterns, shadings, transparency groups
- Compression filters other than `FlateDecode`

## Diagnostics

Each `open()` records the document and chosen backend in
`diagnostics.ts`. The Admin → System tab can render a panel like:

> **PDF Engine** · Native: 8 docs · PDF.js fallback: 5 · last fallback: "Operator not implemented in native renderer: Do"

This tells us where to invest in expanding native coverage. As the native
backend grows, fallbacks should drop toward zero.

## Roadmap

| Priority | Feature | Complexity |
|----------|---------|------------|
| High | Image support (`Do` with `XObject` images, FlateDecode + DCTDecode) | Medium |
| High | Native text-content extraction for selection layer | Medium |
| Medium | Cross-reference streams + object streams | Medium |
| Medium | TrueType/CFF subset fonts | High |
| Medium | Standard color spaces (`CalRGB`, `Indexed`) | Medium |
| Low | Annotation rendering (we already render our own annotation layer separately) | — |
| Low | Encryption (we have qpdf server-side for that) | — |

## Why we keep PDF.js as the fallback

PDF.js (Mozilla, Apache 2.0) is the reference open-source PDF reader.
Building a complete renderer is multi-person-year work; using PDF.js for
the long tail while we own the common path is the honest tradeoff.

The Apache 2.0 license explicitly permits this kind of integration with
attribution — the editor footer credits both PDF.js and pdf-lib, and this
README explains the role of each.

## Adding a new operator to the native renderer

1. Implement the case in `native/contentStream.ts`
2. If it requires new state, extend `GState` and update `defaultState()`
3. Test against a PDF that uses the operator — the editor's diagnostic
   panel should show it rendering via `native` instead of `pdfjs fallback`
4. If a fallback was being triggered for that operator before, the
   message should disappear from diagnostics
