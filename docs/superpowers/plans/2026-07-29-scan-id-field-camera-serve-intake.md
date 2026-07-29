# Scan ID (PDF417/AAMVA) in FieldCameraPage + ServeIntakePage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Scan ID" entry point to `FieldCameraPage` (mobile field camera) and `ServeIntakePage` (civil-process recipient intake) that reuses the existing `LiveDlScanner` + `aamvaParser.ts` PDF417/AAMVA pipeline already proven in `DlSearchPage.tsx`, instead of manual data entry.

**Architecture:** No new backend endpoints, no schema migration. Both pages open the existing `LiveDlScanner` component full-screen, run the decoded barcode text through `parseAamva()` (same as `DlSearchPage.processBarcodeText`), and route the result to the existing `POST /api/records/from-dl-scan` endpoint (FieldCameraPage — creates/reuses a `persons` row deduped on `dl_number`, tags it to the active call) or into `ServeIntakePage`'s existing `editOverrides` state (ServeIntakePage — prefills the manual recipient form, officer can still edit).

**Tech Stack:** React 18 + TypeScript (client), existing `zxing-wasm`-backed `LiveDlScanner.tsx`/`pdf417Decoder.ts`/`aamvaParser.ts`, existing Hono route `src/routes/records.ts` (`from-dl-scan`), `apiFetch`/`apiPostForm` from `client/src/hooks/useApi.ts`.

## Global Constraints

- No D1 migration in this plan — `persons.dl_number/dl_state/dl_expiry/dl_class` and `persons_ext.dl_restrictions/dl_endorsements/dl_issue_date` already exist (migrations `0001`, `0155`).
- Reuse `LiveDlScanner`, `parseAamva`, `assessAamva`, `describeClass/describeRestrictions/describeEndorsements` verbatim from `client/src/components/LiveDlScanner.tsx` and `client/src/utils/aamvaParser.ts` — do not fork or reimplement barcode decoding.
- Follow the Blue & Silver design tokens (`text-brand-400`, `bg-surface-*`, no hardcoded hex) per CLAUDE.md.
- Radius 2px (no `rounded-lg`), icon buttons need `aria-label`.
- D1 writes are async — always `await`.

---

## File Structure

- **Create:** `client/src/utils/scanIdToRecipient.ts` — pure helper, `aamvaToScanResultObj(parsed: AamvaResult): Record<string,string>` (extracted verbatim from `DlSearchPage.processBarcodeText`'s `resultObj` builder) and `aamvaToServeOverrides(parsed: AamvaResult): Record<string,string>` (maps AAMVA fields → ServeIntakePage's `recipient_*` override keys). Both are pure functions — easy to unit test without mounting either page.
- **Modify:** `client/src/pages/mobile/FieldCameraPage.tsx` — add `idScanMode` state, a third mode-bar toggle, and a scan-complete handler that POSTs to `/records/from-dl-scan`.
- **Modify:** `client/src/pages/ServeIntakePage.tsx` — add a "Scan ID" button above the Recipient override grid that opens `LiveDlScanner` and merges `aamvaToServeOverrides()` output into `editOverrides`.
- **Test:** `client/src/utils/__tests__/scanIdToRecipient.test.ts` — unit tests for both pure mapping functions using a synthetic `AamvaResult`.

---

### Task 1: Extract the AAMVA → record-payload mapping into a shared, tested utility

**Files:**
- Create: `client/src/utils/scanIdToRecipient.ts`
- Test: `client/src/utils/__tests__/scanIdToRecipient.test.ts`

**Interfaces:**
- Consumes: `AamvaResult` type and `describeClass`, `describeRestrictions`, `describeEndorsements` from `client/src/utils/aamvaParser.ts` (already exported — see `client/src/utils/aamvaParser.ts:13-48,426-441`).
- Produces:
  - `aamvaToScanResultObj(parsed: AamvaResult): DlScanResultObj` — used by Task 2 (FieldCameraPage) to build the `scan` payload for `POST /records/from-dl-scan`.
  - `aamvaToServeOverrides(parsed: AamvaResult): Record<string, string>` — used by Task 3 (ServeIntakePage) to merge into `editOverrides`.
  - `export interface DlScanResultObj { first_name: string; middle_name: string; last_name: string; suffix: string; date_of_birth: string; gender: string; height: string; weight: string; eye_color: string; hair_color: string; address: string; city: string; state: string; zip: string; dl_number: string; dl_state: string; dl_class: string; dl_expiry: string; dl_issue_date: string; dl_restrictions: string; dl_endorsements: string; country: string; document_discriminator: string; }`

- [ ] **Step 1: Write the failing test**

Create `client/src/utils/__tests__/scanIdToRecipient.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { aamvaToScanResultObj, aamvaToServeOverrides } from '../scanIdToRecipient';
import type { AamvaResult } from '../aamvaParser';

function makeAamva(overrides: Partial<AamvaResult> = {}): AamvaResult {
  return {
    first_name: 'JANE', middle_name: 'Q', last_name: 'DOE', suffix: '',
    date_of_birth: '1990-05-14', gender: 'Female', height: "5'06\"", weight: '140',
    eye_color: 'Brown', hair_color: 'Black',
    address: '123 MAIN ST', address2: '', city: 'SALT LAKE CITY', state: 'UT', zip: '84101',
    dl_number: 'D1234567', dl_state: 'UT', dl_class: 'D', dl_expiry: '2028-05-14',
    dl_issue_date: '2020-05-14', dl_restrictions: 'B', dl_endorsements: '',
    country: 'USA', document_discriminator: 'ABC123', is_real_id: true,
    is_organ_donor: null, is_veteran: null, under_18_until: '', under_21_until: '',
    aamva_version: 9, issuer_id: '636040', card_type: 'DL', raw_elements: {},
    ...overrides,
  };
}

describe('aamvaToScanResultObj', () => {
  it('maps AAMVA fields to the /records/from-dl-scan payload shape', () => {
    const out = aamvaToScanResultObj(makeAamva());
    expect(out.first_name).toBe('JANE');
    expect(out.last_name).toBe('DOE');
    expect(out.dl_number).toBe('D1234567');
    expect(out.dl_state).toBe('UT');
    expect(out.date_of_birth).toBe('1990-05-14');
    // dl_class/restrictions/endorsements go through the describe* translators
    expect(out.dl_class).toMatch(/Class D/);
  });

  it('leaves restrictions/endorsements empty when not encoded', () => {
    const out = aamvaToScanResultObj(makeAamva({ dl_restrictions: '', dl_endorsements: '' }));
    expect(out.dl_restrictions).toBe('');
    expect(out.dl_endorsements).toBe('');
  });
});

describe('aamvaToServeOverrides', () => {
  it('maps AAMVA fields to ServeIntakePage recipient override keys', () => {
    const out = aamvaToServeOverrides(makeAamva());
    expect(out.recipient_first_name).toBe('JANE');
    expect(out.recipient_last_name).toBe('DOE');
    expect(out.recipient_middle_name).toBe('Q');
    expect(out.recipient_dob).toBe('1990-05-14');
    expect(out.recipient_address).toBe('123 MAIN ST');
    expect(out.recipient_city).toBe('SALT LAKE CITY');
    expect(out.recipient_state).toBe('UT');
    expect(out.recipient_zip).toBe('84101');
  });

  it('omits keys for empty AAMVA fields rather than writing blank strings', () => {
    const out = aamvaToServeOverrides(makeAamva({ middle_name: '' }));
    expect('recipient_middle_name' in out).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd client && npx vitest run src/utils/__tests__/scanIdToRecipient.test.ts`
Expected: FAIL — `Cannot find module '../scanIdToRecipient'`

- [ ] **Step 3: Write the implementation**

Create `client/src/utils/scanIdToRecipient.ts`:

```ts
// ============================================================
// RMPG Flex — AAMVA scan result → downstream payload mappers
// ============================================================
// Two consumers share one AAMVA parse (client/src/utils/aamvaParser.ts):
//   - FieldCameraPage's "Scan ID" mode posts aamvaToScanResultObj() to
//     POST /records/from-dl-scan (creates/reuses a persons record).
//   - ServeIntakePage's "Scan ID" button merges aamvaToServeOverrides()
//     into its editOverrides recipient form state.
// Extracted from DlSearchPage.processBarcodeText's resultObj builder so
// all three call sites stay in sync with one mapping.
// ============================================================

import type { AamvaResult } from './aamvaParser';
import { describeClass, describeRestrictions, describeEndorsements } from './aamvaParser';

export interface DlScanResultObj {
  first_name: string; middle_name: string; last_name: string; suffix: string;
  date_of_birth: string; gender: string; height: string; weight: string;
  eye_color: string; hair_color: string;
  address: string; city: string; state: string; zip: string;
  dl_number: string; dl_state: string; dl_class: string;
  dl_expiry: string; dl_issue_date: string;
  dl_restrictions: string; dl_endorsements: string;
  country: string; document_discriminator: string;
}

/** Build the /records/from-dl-scan `scan` payload from a parsed AAMVA barcode. */
export function aamvaToScanResultObj(parsed: AamvaResult): DlScanResultObj {
  return {
    first_name: parsed.first_name,
    middle_name: parsed.middle_name,
    last_name: parsed.last_name,
    suffix: parsed.suffix,
    date_of_birth: parsed.date_of_birth,
    gender: parsed.gender,
    height: parsed.height,
    weight: parsed.weight,
    eye_color: parsed.eye_color,
    hair_color: parsed.hair_color,
    address: parsed.address,
    city: parsed.city,
    state: parsed.state,
    zip: parsed.zip,
    dl_number: parsed.dl_number,
    dl_state: parsed.dl_state,
    dl_class: describeClass(parsed.dl_class),
    dl_expiry: parsed.dl_expiry,
    dl_issue_date: parsed.dl_issue_date,
    dl_restrictions: describeRestrictions(parsed.dl_restrictions),
    dl_endorsements: describeEndorsements(parsed.dl_endorsements),
    country: parsed.country,
    document_discriminator: parsed.document_discriminator,
  };
}

/**
 * Map a parsed AAMVA barcode to ServeIntakePage's `editOverrides` keys.
 * Only non-empty fields are included so an existing override (or OCR
 * value) isn't blanked out by a field the barcode didn't encode.
 */
export function aamvaToServeOverrides(parsed: AamvaResult): Record<string, string> {
  const out: Record<string, string> = {};
  const set = (key: string, value: string) => { if (value.trim()) out[key] = value; };
  set('recipient_first_name', parsed.first_name);
  set('recipient_last_name', parsed.last_name);
  set('recipient_middle_name', parsed.middle_name);
  set('recipient_dob', parsed.date_of_birth);
  set('recipient_address', parsed.address);
  set('recipient_city', parsed.city);
  set('recipient_state', parsed.state);
  set('recipient_zip', parsed.zip);
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd client && npx vitest run src/utils/__tests__/scanIdToRecipient.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add client/src/utils/scanIdToRecipient.ts client/src/utils/__tests__/scanIdToRecipient.test.ts
git commit -m "feat(scan-id): extract AAMVA scan result mapping into a shared, tested utility"
```

---

### Task 2: Add "Scan ID" mode to FieldCameraPage

**Files:**
- Modify: `client/src/pages/mobile/FieldCameraPage.tsx`

**Interfaces:**
- Consumes: `LiveDlScanner` (`client/src/components/LiveDlScanner.tsx`, props `{ onComplete: (result: IdScanResult) => void; onClose: () => void; onUploadInstead: () => void }`, `IdScanResult { barcodeText: string | null; frontImage: Blob | null; backImage: Blob | null }`), `parseAamva`/`looksLikeAamva`/`assessAamva` from `client/src/utils/aamvaParser.ts`, `aamvaToScanResultObj` from Task 1, `apiFetch`/`apiPostForm` from `client/src/hooks/useApi.ts` (already imported in this file), `useToast` (already imported).
- Produces: no new exports — this is a leaf page component. Internal state `idScanMode: boolean` and `idScanResult: { parsed: AamvaResult; personId: number; personCreated: boolean } | null` are local only.

**Backend contract (already live, no changes):** `POST /api/records/from-dl-scan` body `{ scan: DlScanResultObj, create_property?: boolean }` → `{ personId: number, personCreated: boolean, ... }` per `src/routes/records.ts:362-420`. Requires auth (mounted under `/api/dispatch`-style auth middleware — same as every other FieldCameraPage call, no new auth wiring needed since `apiFetch` already attaches the session).

- [ ] **Step 1: Add the `idScanMode` toggle to the mode bar**

In `client/src/pages/mobile/FieldCameraPage.tsx`, add to the imports (top of file, alongside the existing lucide-react import on line 22):

```tsx
import { ArrowLeft, Camera, Loader2, MapPin, RefreshCw, X, Check, ScanLine, Car, AlertTriangle, Radar, IdCard } from 'lucide-react';
import LiveDlScanner, { type IdScanResult } from '../../components/LiveDlScanner';
import type { AamvaResult, ScanAlert } from '../../utils/aamvaParser';
import { aamvaToScanResultObj } from '../../utils/scanIdToRecipient';
```

Add state near the existing `alprMode`/`scan` state (after line 134):

```tsx
  const [idScanMode, setIdScanMode] = useState(false);
  const [idScanResult, setIdScanResult] = useState<{
    parsed: AamvaResult; alerts: ScanAlert[]; personId: number; personCreated: boolean;
  } | null>(null);
  const [idScanSubmitting, setIdScanSubmitting] = useState(false);
```

Add a third mode-bar button, in the "Mode bar" `<div className="flex items-center gap-2">` block (after the existing "Scan vehicles" button, before "Patrol"):

```tsx
          <button
            type="button"
            onClick={() => setIdScanMode((m) => !m)}
            disabled={patrolRunning}
            className={`flex items-center gap-1.5 px-2 py-1 text-[10px] font-bold uppercase tracking-wider border disabled:opacity-40 ${
              idScanMode ? 'border-brand-400 text-brand-400 bg-surface-sunken' : 'border-border-subtle text-[#888]'
            }`}
            aria-pressed={idScanMode}
          >
            <IdCard className="w-3.5 h-3.5" /> Scan ID {idScanMode ? 'ON' : 'OFF'}
          </button>
```

- [ ] **Step 2: Open `LiveDlScanner` when Scan ID mode is active and the shutter is pressed**

Replace the shutter button's `onClick={capture}` behavior so that when `idScanMode` is on, it opens the scanner overlay instead of the photo-capture flow. Add a new state `const [showScanner, setShowScanner] = useState(false);` next to `idScanMode`, and change the shutter button (around line 654-662) to:

```tsx
            <button
              type="button"
              onClick={idScanMode ? () => setShowScanner(true) : capture}
              disabled={!cameraReady && !idScanMode}
              className="w-[72px] h-[72px] border-4 border-brand-400 bg-surface-raised flex items-center justify-center disabled:opacity-30"
              aria-label={idScanMode ? 'Scan ID barcode' : 'Take photo'}
            >
              {idScanMode ? <IdCard className="w-8 h-8 text-brand-400" /> : <span className="w-12 h-12 bg-brand-400" />}
            </button>
```

- [ ] **Step 3: Render `LiveDlScanner` and handle its `onComplete`**

Add a handler function above the `return` statement:

```tsx
  const handleIdScanComplete = useCallback(async ({ barcodeText }: IdScanResult) => {
    setShowScanner(false);
    if (!barcodeText) { addToast('No barcode read — try again or use manual entry', 'error'); return; }
    try {
      const { parseAamva, looksLikeAamva, assessAamva } = await import('../../utils/aamvaParser');
      if (!looksLikeAamva(barcodeText)) { addToast('Barcode did not decode as a DL/ID', 'error'); return; }
      const parsed = parseAamva(barcodeText);
      const alerts = assessAamva(parsed);
      setIdScanSubmitting(true);
      const scanPayload = aamvaToScanResultObj(parsed);
      const resp = await apiFetch<{ personId: number; personCreated: boolean }>('/records/from-dl-scan', {
        method: 'POST',
        body: JSON.stringify({ scan: { ...scanPayload, aamva_raw: barcodeText } }),
      });
      setIdScanResult({ parsed, alerts, personId: resp.personId, personCreated: resp.personCreated });
      addToast(resp.personCreated ? 'New person record created from scan' : 'Matched existing person record', 'success');
    } catch (err: any) {
      addToast(err?.message || 'Scan failed to parse — try again', 'error');
    } finally {
      setIdScanSubmitting(false);
    }
  }, [addToast]);

  const clearIdScan = useCallback(() => { setIdScanResult(null); }, []);
```

Render the scanner and result overlay just before the closing `</div>` of the outer container (after the existing `<input ref={fileInputRef} .../>` block, still inside the top-level `<div className="fixed inset-0 ...">`):

```tsx
        {showScanner && (
          <LiveDlScanner
            onComplete={handleIdScanComplete}
            onClose={() => setShowScanner(false)}
            onUploadInstead={() => setShowScanner(false)}
          />
        )}
        {idScanResult && (
          <div className="absolute inset-0 z-30 bg-black/92 overflow-y-auto p-3 space-y-2 safe-pt safe-pb safe-px">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold uppercase tracking-wider text-brand-400 flex items-center gap-1">
                <IdCard className="w-4 h-4" /> {idScanResult.parsed.last_name}, {idScanResult.parsed.first_name}
                {idScanResult.personCreated ? ' · NEW RECORD' : ' · LINKED'}
              </span>
              <button type="button" onClick={clearIdScan} className="text-[#888] p-1 min-w-[44px] min-h-[44px] flex items-center justify-center" aria-label="Done">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="text-xs text-rmpg-300 space-y-0.5">
              <div>DOB {idScanResult.parsed.date_of_birth || '—'}</div>
              <div>DL {idScanResult.parsed.dl_number || '—'} ({idScanResult.parsed.dl_state || '—'})</div>
              <div>{idScanResult.parsed.address || '—'}, {idScanResult.parsed.city || '—'} {idScanResult.parsed.state || ''} {idScanResult.parsed.zip || ''}</div>
            </div>
            {idScanResult.alerts.map((a, i) => (
              <div key={`${a.code}-${i}`} className={`flex items-start gap-1.5 border text-xs font-semibold px-2 py-1.5 ${
                a.level === 'danger' ? 'bg-red-950 border-red-600 text-red-300'
                  : a.level === 'warning' ? 'bg-yellow-950/60 border-yellow-700 text-yellow-300'
                  : 'bg-surface-sunken border-border-subtle text-rmpg-300'
              }`}>
                <AlertTriangle className="w-4 h-4 shrink-0 mt-px" />
                <span>{a.message}</span>
              </div>
            ))}
            <button
              type="button" onClick={() => navigate(`/records?tab=persons&personId=${idScanResult.personId}`)}
              className="w-full py-2 text-xs font-bold uppercase tracking-wider border border-brand-400 text-brand-400 mt-1">
              View Person Record
            </button>
            <button
              type="button" onClick={clearIdScan}
              className="w-full py-2 text-xs font-bold uppercase tracking-wider border border-border-subtle text-[#888]">
              Scan Another
            </button>
          </div>
        )}
        {idScanSubmitting && (
          <div className="absolute inset-0 z-30 bg-black/70 flex items-center justify-center">
            <Loader2 className="w-8 h-8 animate-spin text-brand-400" />
          </div>
        )}
```

- [ ] **Step 4: Manual verification in the browser**

Run: `cd client && npm run dev` (Vite dev server), then in a browser navigate to `/field-camera` (grant camera permission), toggle "Scan ID" on, tap the shutter, present a driver's license barcode to the camera (or use a saved test PDF417 image via the scanner's upload fallback), confirm:
- The result overlay shows name/DOB/DL#/address.
- `assessAamva` alerts render if the test license is expired/minor (use a test barcode with a past expiry to confirm the red banner renders).
- "View Person Record" navigates to `/records?tab=persons&personId=<id>`.
- Toggling "Scan ID" off restores normal photo/ALPR capture behavior.

Expected: no console errors; `POST /api/records/from-dl-scan` returns 200 in the Network tab.

- [ ] **Step 5: Run the client test suite and typecheck**

Run: `cd client && npx tsc --noEmit && npx vitest run`
Expected: 0 typecheck errors, all tests pass (no existing FieldCameraPage tests should regress — check `client/src/pages/mobile/__tests__/` if present).

- [ ] **Step 6: Commit**

```bash
git add client/src/pages/mobile/FieldCameraPage.tsx
git commit -m "feat(field-camera): add Scan ID mode using the existing LiveDlScanner/AAMVA pipeline"
```

---

### Task 3: Add "Scan ID" button to ServeIntakePage

**Files:**
- Modify: `client/src/pages/ServeIntakePage.tsx`

**Interfaces:**
- Consumes: `LiveDlScanner`/`IdScanResult` (same as Task 2), `parseAamva`/`looksLikeAamva` from `aamvaParser.ts`, `aamvaToServeOverrides` from Task 1, existing `editOverrides` state (`client/src/pages/ServeIntakePage.tsx:362`, setter `setEditOverrides`), existing `useToast`/`addToast`.
- Produces: no new exports.

- [ ] **Step 1: Add imports and scanner-open state**

At the top of `client/src/pages/ServeIntakePage.tsx`, add:

```tsx
import LiveDlScanner, { type IdScanResult } from '../components/LiveDlScanner';
import { ScanLine } from 'lucide-react'; // add to existing lucide-react import if one exists — check current import line first
import { aamvaToServeOverrides } from '../utils/scanIdToRecipient';
```

Near the existing `editOverrides` state declaration (`client/src/pages/ServeIntakePage.tsx:362`), add:

```tsx
  const [showIdScanner, setShowIdScanner] = useState(false);
```

- [ ] **Step 2: Add the "Scan ID" button above the Recipient field grid**

In the Review panel, immediately before the `<p className="text-[9px] text-rmpg-500 uppercase font-bold tracking-wider mb-1.5">Recipient</p>` line (around `client/src/pages/ServeIntakePage.tsx:1129`), add:

```tsx
            <div className="flex items-center justify-between mb-1.5">
              <p className="text-[9px] text-rmpg-500 uppercase font-bold tracking-wider">Recipient</p>
              <button
                type="button"
                onClick={() => setShowIdScanner(true)}
                className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-brand-400 border border-brand-400 px-2 py-1"
                aria-label="Scan recipient ID barcode"
              >
                <ScanLine className="w-3 h-3" /> Scan ID
              </button>
            </div>
```

(Remove the now-duplicated standalone `<p>...Recipient</p>` line that previously preceded the grid.)

- [ ] **Step 3: Handle scan completion — merge into `editOverrides`**

Add a handler near the other callbacks in the component body:

```tsx
  const handleIdScanComplete = useCallback(async ({ barcodeText }: IdScanResult) => {
    setShowIdScanner(false);
    if (!barcodeText) { addToast('No barcode read — try again or enter manually', 'error'); return; }
    try {
      const { parseAamva, looksLikeAamva } = await import('../utils/aamvaParser');
      if (!looksLikeAamva(barcodeText)) { addToast('Barcode did not decode as a DL/ID', 'error'); return; }
      const parsed = parseAamva(barcodeText);
      setEditOverrides((prev) => ({ ...prev, ...aamvaToServeOverrides(parsed) }));
      addToast('Recipient fields filled from ID scan — review before submitting', 'success');
    } catch (err: any) {
      addToast(err?.message || 'Scan failed to parse — enter manually', 'error');
    }
  }, [addToast]);
```

Render the scanner conditionally near the end of the component's JSX (top-level, outside the Review panel so it overlays full-screen):

```tsx
      {showIdScanner && (
        <LiveDlScanner
          onComplete={handleIdScanComplete}
          onClose={() => setShowIdScanner(false)}
          onUploadInstead={() => setShowIdScanner(false)}
        />
      )}
```

- [ ] **Step 4: Manual verification in the browser**

Run: `cd client && npm run dev`, navigate to the Serve Intake page (`/serve-intake` or wherever it's routed — check `client/src/App.tsx` route table), start a new intake, reach the Review & Edit panel, click "Scan ID", scan a test license, confirm the First Name/Last Name/DOB/Address/City/State/Zip fields populate and remain editable.

Expected: no console errors; fields are editable after the scan (not locked).

- [ ] **Step 5: Run the client test suite and typecheck**

Run: `cd client && npx tsc --noEmit && npx vitest run`
Expected: 0 typecheck errors, all tests pass.

- [ ] **Step 6: Commit**

```bash
git add client/src/pages/ServeIntakePage.tsx
git commit -m "feat(serve-intake): add Scan ID button to prefill recipient fields from a DL barcode"
```

---

### Task 4: Full-suite verification and PR

**Files:** none (verification only)

- [ ] **Step 1: Run the full client suite** (per CLAUDE.md: full suite is the gate, not targeted runs)

Run: `cd client && npx tsc --noEmit && npx vitest run`
Expected: 0 errors, all tests pass.

- [ ] **Step 2: Run the worker suite** (unaffected by this change, but confirms no accidental cross-contamination)

Run: `npm run typecheck && npx vitest run`
Expected: 0 errors, all tests pass (pre-existing baseline is clean per CLAUDE.md's 2026-07-24 re-measurement).

- [ ] **Step 3: Build the client**

Run: `cd client && npx vite build`
Expected: build succeeds.

- [ ] **Step 4: Push and open a PR** (per CLAUDE.md: `main` is protected, PR + passing checks required)

```bash
git push -u origin <branch-name>
gh pr create --title "feat: Scan ID (PDF417/AAMVA) in FieldCameraPage + ServeIntakePage" --body "$(cat <<'EOF'
## Summary
- Adds a "Scan ID" capture mode to FieldCameraPage (mobile) that reuses the existing LiveDlScanner/AAMVA pipeline to create/link a persons record via the existing POST /records/from-dl-scan endpoint.
- Adds a "Scan ID" button to ServeIntakePage that prefills the recipient override fields from the same scan.
- No schema changes — persons.dl_number/dl_state/dl_expiry/dl_class and persons_ext AAMVA overflow fields already existed.

## Test plan
- [ ] Client typecheck + vitest pass
- [ ] Worker typecheck + vitest pass (unaffected, verifying no regression)
- [ ] Client build succeeds
- [ ] Manually scanned a test DL barcode on /field-camera — person record created/linked, alerts rendered
- [ ] Manually scanned a test DL barcode on Serve Intake Review panel — recipient fields prefilled and editable
EOF
)"
```

---

## Self-Review Notes

- **Spec coverage:** Both surfaces from the approved design (FieldCameraPage + ServeIntakePage) are covered by Tasks 2 and 3; the shared mapping logic (Task 1) is tested in isolation per the design's "no new schema, pure UI wiring" scope.
- **No placeholders:** all code blocks are complete; no TBD/TODO.
- **Type consistency:** `DlScanResultObj` (Task 1) is the exact shape both `aamvaToScanResultObj` and the `POST /records/from-dl-scan` body expect (`{ scan: DlScanResultObj }`), matching `src/routes/records.ts:365-370`'s `body.scan` destructuring. `IdScanResult` and `LiveDlScanner` props are used identically to their existing usage in `DlSearchPage.tsx:1525-1526` — same import path, same prop names.
- **Out of scope (confirmed with user):** MRZ passport scanning, BlinkID, CVScanner, facial recognition — not touched by this plan.
