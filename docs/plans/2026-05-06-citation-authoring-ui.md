# Citation Authoring UI Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a multi-violation citation authoring surface — typeahead statute picker, live PDF preview (tri-mode), reusable Combobox primitive — on top of the v2 multiCopy PDF engine.

**Architecture:** Extract authoring out of `CitationsPage.tsx` into a new `<CitationAuthor>` component. Three new shared components: `<Combobox>` (generic typeahead), `<ViolationStack>` (1..N violation cards with running total), `<CitationPdfPreview>` (modal/side/full mode wrapper). Server `POST /citations` and `PUT /citations/:id` extended to accept optional `violations[]` and persist them atomically. Backward compatible: omitting `violations` keeps current single-violation flat-field behavior.

**Tech Stack:** TypeScript · React 18 · jsPDF (existing v2 engine) · Vitest unit tests · supertest server integration tests · existing `apiFetch` + `useApi` plumbing.

**Design doc:** [docs/plans/2026-05-06-citation-authoring-ui-design.md](./2026-05-06-citation-authoring-ui-design.md) — read first if context unclear.

**Branch:** Continue on `claude/heuristic-rosalind-d8edcc`. Commit after each task.

**Pre-flight gate:** PR #418 (citation 3-copy PDF polish) should already be merged so production reflects the visual fixes the preview relies on. If not merged, this plan still works against the local branch; the production smoke step (Task 14) waits until both PRs land.

---

## Task 1: `<Combobox>` primitive — sync `options[]` path

**Why first:** Every later task depends on it (statute picker, vehicle_state, district, status filter). Ship the sync path first; async fetcher comes in Task 2.

**Files:**
- Create: `client/src/components/Combobox.tsx`
- Create: `client/src/components/__tests__/Combobox.test.tsx`

**Step 1: Write failing tests**

```typescript
// client/src/components/__tests__/Combobox.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Combobox } from '../Combobox';

type State = { code: string; name: string };
const STATES: State[] = [
  { code: 'UT', name: 'Utah' },
  { code: 'CA', name: 'California' },
  { code: 'NV', name: 'Nevada' },
];

const baseProps = {
  options: STATES,
  getLabel: (s: State) => s.name,
  getKey: (s: State) => s.code,
};

describe('Combobox (sync)', () => {
  it('renders the current value label in the input', () => {
    render(<Combobox {...baseProps} value={STATES[0]} onChange={() => {}} />);
    expect(screen.getByDisplayValue('Utah')).toBeInTheDocument();
  });

  it('opens dropdown and filters by typed query (case-insensitive)', () => {
    render(<Combobox {...baseProps} value={null} onChange={() => {}} />);
    const input = screen.getByRole('combobox');
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'ne' } });
    expect(screen.getByText('Nevada')).toBeInTheDocument();
    expect(screen.queryByText('Utah')).not.toBeInTheDocument();
  });

  it('calls onChange with selected option on click', () => {
    const onChange = vi.fn();
    render(<Combobox {...baseProps} value={null} onChange={onChange} />);
    fireEvent.focus(screen.getByRole('combobox'));
    fireEvent.click(screen.getByText('California'));
    expect(onChange).toHaveBeenCalledWith(STATES[1]);
  });

  it('clears value when user empties the input and blurs', () => {
    const onChange = vi.fn();
    render(<Combobox {...baseProps} value={STATES[0]} onChange={onChange} />);
    const input = screen.getByRole('combobox') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '' } });
    fireEvent.blur(input);
    expect(onChange).toHaveBeenCalledWith(null);
  });
});
```

**Step 2: Run, expect FAIL (module not found)**

```bash
cd client && npx vitest run src/components/__tests__/Combobox.test.tsx
```

**Step 3: Implement minimum Combobox**

```typescript
// client/src/components/Combobox.tsx
import { useEffect, useId, useMemo, useRef, useState } from 'react';

export interface ComboboxProps<T> {
  value: T | null;
  onChange: (v: T | null) => void;
  options?: T[];                    // sync path; async fetcher added in Task 2
  getLabel: (item: T) => string;
  getKey: (item: T) => string | number;
  renderOption?: (item: T) => React.ReactNode;
  placeholder?: string;
  disabled?: boolean;
  error?: string;
}

export function Combobox<T>(props: ComboboxProps<T>) {
  const {
    value, onChange, options = [], getLabel, getKey,
    renderOption = getLabel, placeholder, disabled, error,
  } = props;
  const [query, setQuery] = useState(value ? getLabel(value) : '');
  const [open, setOpen] = useState(false);
  const inputId = useId();
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => { setQuery(value ? getLabel(value) : ''); }, [value, getLabel]);

  // Tap-outside-to-close
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const filtered = useMemo(() => {
    if (!query.trim()) return options;
    const q = query.trim().toLowerCase();
    return options.filter((o) => getLabel(o).toLowerCase().includes(q));
  }, [options, query, getLabel]);

  const handleBlur = () => {
    // Empty input -> clear value
    if (!query.trim() && value !== null) onChange(null);
  };

  return (
    <div ref={containerRef} className="relative">
      <input
        id={inputId}
        role="combobox"
        aria-expanded={open}
        aria-controls={`${inputId}-listbox`}
        value={query}
        onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onBlur={handleBlur}
        placeholder={placeholder}
        disabled={disabled}
        className="input-dark w-full py-2 text-xs min-h-[44px]"
      />
      {open && filtered.length > 0 && (
        <ul
          id={`${inputId}-listbox`}
          role="listbox"
          className="absolute z-50 mt-1 w-full max-h-60 overflow-auto border border-[#222] bg-[#0a0a0a] shadow-lg"
        >
          {filtered.map((opt) => (
            <li
              key={getKey(opt)}
              role="option"
              aria-selected={value !== null && getKey(opt) === getKey(value)}
              onMouseDown={(e) => {
                e.preventDefault();        // keep input focus; prevent blur clearing
                onChange(opt);
                setQuery(getLabel(opt));
                setOpen(false);
              }}
              className="px-3 py-2 text-xs text-white hover:bg-[#1a1a1a] cursor-pointer"
            >
              {renderOption(opt)}
            </li>
          ))}
        </ul>
      )}
      {error && <p className="mt-1 text-[10px] text-red-400">{error}</p>}
    </div>
  );
}
```

**Step 4: Run, verify 4/4 pass**

```bash
cd client && npx vitest run src/components/__tests__/Combobox.test.tsx
```

**Step 5: Commit**

```bash
git add client/src/components/Combobox.tsx client/src/components/__tests__/Combobox.test.tsx
git commit -m "feat(combobox): sync-options typeahead with filter + click select + clear-on-blur"
```

---

## Task 2: `<Combobox>` async fetcher path + keyboard nav

**Files:**
- Modify: `client/src/components/Combobox.tsx`
- Modify: `client/src/components/__tests__/Combobox.test.tsx`

**Step 1: Add failing tests for async + keyboard**

Append to the existing test file:

```typescript
import { waitFor } from '@testing-library/react';

describe('Combobox (async fetcher)', () => {
  it('calls fetcher with debounced query and renders results', async () => {
    const fetcher = vi.fn(async (q: string) => STATES.filter((s) => s.name.toLowerCase().includes(q.toLowerCase())));
    render(<Combobox value={null} onChange={() => {}} fetcher={fetcher} getLabel={(s: State) => s.name} getKey={(s) => s.code} minQueryLength={2} />);
    const input = screen.getByRole('combobox');
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'utah' } });
    await waitFor(() => expect(fetcher).toHaveBeenCalledWith('utah'));
    await waitFor(() => expect(screen.getByText('Utah')).toBeInTheDocument());
  });

  it('does not call fetcher when query shorter than minQueryLength', async () => {
    const fetcher = vi.fn(async () => []);
    render(<Combobox value={null} onChange={() => {}} fetcher={fetcher} getLabel={(s: State) => s.name} getKey={(s) => s.code} minQueryLength={3} />);
    fireEvent.focus(screen.getByRole('combobox'));
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'ut' } });
    await new Promise((r) => setTimeout(r, 350));
    expect(fetcher).not.toHaveBeenCalled();
  });
});

describe('Combobox (keyboard nav)', () => {
  it('ArrowDown moves highlight, Enter selects', () => {
    const onChange = vi.fn();
    render(<Combobox {...baseProps} value={null} onChange={onChange} />);
    const input = screen.getByRole('combobox');
    fireEvent.focus(input);
    fireEvent.keyDown(input, { key: 'ArrowDown' });   // highlight Utah
    fireEvent.keyDown(input, { key: 'ArrowDown' });   // highlight California
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onChange).toHaveBeenCalledWith(STATES[1]);
  });

  it('Escape closes the dropdown', () => {
    render(<Combobox {...baseProps} value={null} onChange={() => {}} />);
    const input = screen.getByRole('combobox');
    fireEvent.focus(input);
    expect(screen.getByRole('listbox')).toBeInTheDocument();
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });
});
```

**Step 2: Run, expect 4 new tests FAIL**

```bash
cd client && npx vitest run src/components/__tests__/Combobox.test.tsx
```

**Step 3: Extend Combobox**

Add to `ComboboxProps<T>`:
```typescript
  fetcher?: (query: string) => Promise<T[]>;
  minQueryLength?: number;     // default: 0 (sync) / 2 (async)
```

Inside the component:
```typescript
  const [asyncResults, setAsyncResults] = useState<T[]>([]);
  const [highlight, setHighlight] = useState(-1);
  const fetchTimer = useRef<ReturnType<typeof setTimeout>>();

  const effectiveMin = props.minQueryLength ?? (props.fetcher ? 2 : 0);

  useEffect(() => {
    if (!props.fetcher) return;
    if (query.length < effectiveMin) { setAsyncResults([]); return; }
    if (fetchTimer.current) clearTimeout(fetchTimer.current);
    fetchTimer.current = setTimeout(async () => {
      try {
        const rows = await props.fetcher!(query);
        setAsyncResults(rows);
      } catch {
        setAsyncResults([]);
      }
    }, 250);
  }, [query, props.fetcher, effectiveMin]);

  const filtered = props.fetcher
    ? asyncResults
    : (query.trim()
        ? options.filter((o) => getLabel(o).toLowerCase().includes(query.toLowerCase().trim()))
        : options);

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setOpen(true);
      setHighlight((h) => Math.min(filtered.length - 1, h + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlight((h) => Math.max(-1, h - 1));
    } else if (e.key === 'Enter') {
      if (highlight >= 0 && filtered[highlight]) {
        e.preventDefault();
        onChange(filtered[highlight]);
        setQuery(getLabel(filtered[highlight]));
        setOpen(false);
        setHighlight(-1);
      }
    } else if (e.key === 'Escape') {
      setOpen(false);
      setHighlight(-1);
    }
  };
```

Wire `onKeyDown` on the input. Add `aria-activedescendant` + `aria-selected={i===highlight}` on `<li>`. Reset `highlight` to `-1` whenever `filtered` changes (in a useEffect on filtered.length).

**Step 4: Run, all 8 tests pass**

```bash
cd client && npx vitest run src/components/__tests__/Combobox.test.tsx
cd client && npx tsc --noEmit
```

**Step 5: Commit**

```bash
git add client/src/components/Combobox.tsx client/src/components/__tests__/Combobox.test.tsx
git commit -m "feat(combobox): async fetcher (debounced 250ms) + keyboard nav (Arrow/Enter/Escape)"
```

---

## Task 3: `ViolationDraft` type + helpers

**Why:** Small data layer first so `<ViolationStack>` has shapes to import.

**Files:**
- Create: `client/src/components/violationStackHelpers.ts`
- Create: `client/src/components/__tests__/violationStackHelpers.test.ts`

**Step 1: Write failing tests**

```typescript
// client/src/components/__tests__/violationStackHelpers.test.ts
import { describe, it, expect } from 'vitest';
import { newDraft, totalFineOf, type ViolationDraft } from '../violationStackHelpers';

describe('newDraft', () => {
  it('returns a fresh draft with unique id and zeros/empties', () => {
    const a = newDraft();
    const b = newDraft();
    expect(a.id).not.toBe(b.id);
    expect(a.statute_citation).toBe('');
    expect(a.fine_amount).toBe(0);
    expect(a.offense_level).toBe('Infraction');
  });
});

describe('totalFineOf', () => {
  it('sums fine_amount across drafts, treating non-finite as 0', () => {
    const drafts: ViolationDraft[] = [
      { id: '1', statute_citation: 'a', description: '', offense_level: 'Infraction', fine_amount: 100 },
      { id: '2', statute_citation: 'b', description: '', offense_level: 'Infraction', fine_amount: 50.5 },
      { id: '3', statute_citation: 'c', description: '', offense_level: 'Infraction', fine_amount: NaN },
    ];
    expect(totalFineOf(drafts)).toBe(150.5);
  });
});
```

**Step 2: Run, expect FAIL**

**Step 3: Implement**

```typescript
// client/src/components/violationStackHelpers.ts
export type OffenseLevel = 'Infraction' | 'Misdemeanor' | 'Felony';

export interface ViolationDraft {
  id: string;
  statute_id?: number;
  statute_citation: string;
  description: string;
  offense_level: OffenseLevel;
  fine_amount: number;
}

let nextSerial = 0;
export function newDraft(): ViolationDraft {
  // Client-side stable id. crypto.randomUUID is fine in modern browsers;
  // fall back to a serial + timestamp for jsdom/older runtimes.
  const id = typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `v-${++nextSerial}-${Date.now()}`;
  return { id, statute_citation: '', description: '', offense_level: 'Infraction', fine_amount: 0 };
}

export function totalFineOf(drafts: ViolationDraft[]): number {
  return drafts.reduce(
    (sum, v) => sum + (Number.isFinite(v.fine_amount) ? v.fine_amount : 0),
    0,
  );
}
```

**Step 4: Run, 2/2 pass + tsc clean**

**Step 5: Commit**

```bash
git add client/src/components/violationStackHelpers.ts client/src/components/__tests__/violationStackHelpers.test.ts
git commit -m "feat(citations): ViolationDraft + newDraft + totalFineOf helpers"
```

---

## Task 4: `<ViolationStack>` component (add / remove / edit / total)

**Files:**
- Create: `client/src/components/ViolationStack.tsx`
- Create: `client/src/components/__tests__/ViolationStack.test.tsx`

**Step 1: Write failing tests**

```typescript
// client/src/components/__tests__/ViolationStack.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ViolationStack } from '../ViolationStack';
import { newDraft } from '../violationStackHelpers';

describe('ViolationStack', () => {
  it('renders one card per draft', () => {
    const drafts = [newDraft(), newDraft()];
    render(<ViolationStack value={drafts} onChange={() => {}} />);
    expect(screen.getAllByText(/Violation \d/)).toHaveLength(2);
  });

  it('"+ Add Violation" appends a new empty card', () => {
    const onChange = vi.fn();
    const drafts = [newDraft()];
    render(<ViolationStack value={drafts} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: /Add Violation/i }));
    expect(onChange).toHaveBeenCalledTimes(1);
    const next = onChange.mock.calls[0][0];
    expect(next).toHaveLength(2);
    expect(next[1].statute_citation).toBe('');
  });

  it('"Remove" deletes the targeted card', () => {
    const onChange = vi.fn();
    const drafts = [newDraft(), newDraft()];
    render(<ViolationStack value={drafts} onChange={onChange} />);
    const removeButtons = screen.getAllByRole('button', { name: /Remove/i });
    fireEvent.click(removeButtons[0]);
    expect(onChange).toHaveBeenCalledWith([drafts[1]]);
  });

  it('renders running total of fine amounts', () => {
    const drafts = [
      { ...newDraft(), fine_amount: 175 },
      { ...newDraft(), fine_amount: 50 },
    ];
    render(<ViolationStack value={drafts} onChange={() => {}} />);
    expect(screen.getByText(/\$225\.00/)).toBeInTheDocument();
  });

  it('typing in description input fires onChange with patched draft', () => {
    const onChange = vi.fn();
    const drafts = [newDraft()];
    render(<ViolationStack value={drafts} onChange={onChange} />);
    const input = screen.getByPlaceholderText(/description/i);
    fireEvent.change(input, { target: { value: 'Speeding' } });
    expect(onChange.mock.calls[0][0][0].description).toBe('Speeding');
  });
});
```

**Step 2: Run, expect FAIL**

**Step 3: Implement**

```typescript
// client/src/components/ViolationStack.tsx
import { totalFineOf, newDraft, type ViolationDraft, type OffenseLevel } from './violationStackHelpers';

interface Props {
  value: ViolationDraft[];
  onChange: (next: ViolationDraft[]) => void;
}

const LEVELS: OffenseLevel[] = ['Infraction', 'Misdemeanor', 'Felony'];

export function ViolationStack({ value, onChange }: Props) {
  const patch = (id: string, partial: Partial<ViolationDraft>) =>
    onChange(value.map((v) => (v.id === id ? { ...v, ...partial } : v)));

  return (
    <div className="space-y-3">
      {value.map((v, i) => (
        <div key={v.id} className="border border-[#222] p-3 bg-[#0a0a0a]">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] uppercase font-bold text-[#d4a017]">Violation {i + 1}</span>
            <button
              type="button"
              onClick={() => onChange(value.filter((x) => x.id !== v.id))}
              className="text-[10px] text-red-400 hover:text-red-300"
            >
              × Remove
            </button>
          </div>
          <input
            type="text"
            placeholder="Statute / Code (e.g. UCA 41-6a-601)"
            value={v.statute_citation}
            onChange={(e) => patch(v.id, { statute_citation: e.target.value })}
            className="input-dark w-full py-2 text-xs mb-2 min-h-[44px]"
          />
          <input
            type="text"
            placeholder="Violation description"
            value={v.description}
            onChange={(e) => patch(v.id, { description: e.target.value })}
            className="input-dark w-full py-2 text-xs mb-2 min-h-[44px]"
          />
          <div className="grid grid-cols-2 gap-2">
            <select
              value={v.offense_level}
              onChange={(e) => patch(v.id, { offense_level: e.target.value as OffenseLevel })}
              className="input-dark py-2 text-xs min-h-[44px]"
            >
              {LEVELS.map((l) => <option key={l} value={l}>{l}</option>)}
            </select>
            <input
              type="number"
              step="0.01"
              placeholder="Fine"
              value={v.fine_amount}
              onChange={(e) => patch(v.id, { fine_amount: Number(e.target.value) || 0 })}
              className="input-dark py-2 text-xs min-h-[44px]"
            />
          </div>
        </div>
      ))}
      <button
        type="button"
        onClick={() => onChange([...value, newDraft()])}
        className="w-full py-2 text-xs border border-dashed border-[#444] text-[#888] hover:text-[#d4a017] hover:border-[#d4a017]"
      >
        + Add Violation
      </button>
      <div className="flex justify-between border-t border-[#222] pt-2">
        <span className="text-[10px] uppercase font-bold">Total Fine</span>
        <span className="text-xs font-bold text-[#d4a017]">${totalFineOf(value).toFixed(2)}</span>
      </div>
    </div>
  );
}
```

Statute combobox auto-fill from `/citations/statutes/lookup` lands in Task 6 — for now this uses plain text input for statute_citation.

**Step 4: Run, 5/5 pass + tsc clean**

**Step 5: Commit**

```bash
git add client/src/components/ViolationStack.tsx client/src/components/__tests__/ViolationStack.test.tsx
git commit -m "feat(citations): ViolationStack card list with add/remove/edit/total"
```

---

## Task 5: Server — accept `violations[]` in POST + PUT

**Files:**
- Modify: `server/src/routes/citations.ts:260` (POST `/`)
- Modify: `server/src/routes/citations.ts:441` (PUT `/:id`)
- Create: `server/tests/integration/citations-violations.test.ts`

**Step 1: Write failing integration tests**

```typescript
// server/tests/integration/citations-violations.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { setupTestDataDir, teardownTestDataDir, createTestAdmin } from '../helpers/testDb';

let app: any;
let token: string;
let testDir: string;

beforeAll(async () => {
  testDir = setupTestDataDir();
  const { initDatabase } = await import('../../src/models/database');
  const db = initDatabase();
  const admin = createTestAdmin(db);
  const { createTestApp } = await import('../helpers/testApp');
  app = await createTestApp();
  const r = await request(app).post('/api/auth/login').send({ username: admin.username, password: admin.password });
  token = r.body.token;
});
afterAll(() => teardownTestDataDir(testDir));

const auth = (req: request.Test) => req.set('Authorization', `Bearer ${token}`);

describe('POST /api/citations with violations[]', () => {
  it('creates citation + violations atomically', async () => {
    const res = await auth(request(app).post('/api/citations').send({
      type: 'traffic',
      person_name: 'Test Subject',
      violation_date: '2026-05-06',
      violations: [
        { statute_citation: 'UCA 41-6a-601', description: 'Speeding', offense_level: 'Infraction', fine_amount: 175 },
        { statute_citation: 'UCA 41-6a-92', description: 'Failure to signal', offense_level: 'Infraction', fine_amount: 50 },
      ],
    }));
    expect(res.status).toBe(201);
    expect(res.body.id).toBeDefined();
    const { getDb } = await import('../../src/models/database');
    const rows = getDb().prepare('SELECT * FROM citation_violations WHERE citation_id = ?').all(res.body.id);
    expect(rows).toHaveLength(2);
  });

  it('omitting violations preserves single-violation back-compat', async () => {
    const res = await auth(request(app).post('/api/citations').send({
      type: 'traffic', person_name: 'Test', statute_citation: 'UCA 1-1-1', fine_amount: 100,
    }));
    expect(res.status).toBe(201);
    const { getDb } = await import('../../src/models/database');
    const rows = getDb().prepare('SELECT * FROM citation_violations WHERE citation_id = ?').all(res.body.id);
    expect(rows).toHaveLength(0);   // back-compat: flat fields, no rows
  });
});

describe('PUT /api/citations/:id with violations[]', () => {
  it('replaces all violations (delete + insert in transaction)', async () => {
    const created = await auth(request(app).post('/api/citations').send({
      type: 'traffic', person_name: 'PUT-Test',
      violations: [{ statute_citation: 'A', description: 'a', offense_level: 'Infraction', fine_amount: 10 }],
    }));
    const id = created.body.id;

    const updated = await auth(request(app).put(`/api/citations/${id}`).send({
      violations: [
        { statute_citation: 'B', description: 'b', offense_level: 'Misdemeanor', fine_amount: 200 },
        { statute_citation: 'C', description: 'c', offense_level: 'Infraction', fine_amount: 50 },
      ],
    }));
    expect(updated.status).toBe(200);
    const { getDb } = await import('../../src/models/database');
    const rows = getDb().prepare('SELECT statute_citation, fine_amount FROM citation_violations WHERE citation_id = ? ORDER BY id').all(id);
    expect(rows).toEqual([
      { statute_citation: 'B', fine_amount: 200 },
      { statute_citation: 'C', fine_amount: 50 },
    ]);
  });
});
```

**Step 2: Run, expect FAIL**

```bash
cd server && npx vitest run tests/integration/citations-violations.test.ts
```

**Step 3: Implement server changes**

In `server/src/routes/citations.ts`, inside the POST `/` handler (after the existing INSERT), add violations insertion BEFORE the `res.json(...)` final response. Wrap citation INSERT + violations INSERTs in a `db.transaction`. In the PUT `/:id` handler, accept `violations?: CitationViolationInput[]`; if present, after the citation row UPDATE add:

```typescript
db.prepare('DELETE FROM citation_violations WHERE citation_id = ?').run(id);
for (const v of req.body.violations) {
  db.prepare(`INSERT INTO citation_violations
    (citation_id, statute_id, statute_citation, violation_description, offense_level, fine_amount)
    VALUES (?, ?, ?, ?, ?, ?)`).run(
    id, v.statute_id ?? null, v.statute_citation, v.description, v.offense_level, v.fine_amount,
  );
}
```

Both POST and PUT entire body wrapped in `db.transaction(() => { ... })()`.

**Step 4: Run, verify 3/3 pass**

```bash
cd server && npx vitest run tests/integration/citations-violations.test.ts
cd server && npx tsc --noEmit
```

**Step 5: Commit**

```bash
git add server/src/routes/citations.ts server/tests/integration/citations-violations.test.ts
git commit -m "feat(citations): POST + PUT accept violations[] (atomic transaction; PUT replaces)"
```

---

## Task 6: Statute Combobox auto-fill helper

**Why before ViolationStack integration:** isolate the "fill empty fields only" rule in a pure function with its own tests.

**Files:**
- Create: `client/src/components/statuteAutofill.ts`
- Create: `client/src/components/__tests__/statuteAutofill.test.ts`

**Step 1: Write tests**

```typescript
// client/src/components/__tests__/statuteAutofill.test.ts
import { describe, it, expect } from 'vitest';
import { applyStatuteAutofill, type StatuteRow } from '../statuteAutofill';
import { newDraft } from '../violationStackHelpers';

const STATUTE: StatuteRow = {
  id: 1, citation_code: 'UCA 41-6a-601', title: 'Speed Limits',
  offense_level: 'Infraction', default_fine: 175, description: 'Speed limit violation',
};

describe('applyStatuteAutofill', () => {
  it('fills empty description, level, fine from statute', () => {
    const draft = newDraft();
    const out = applyStatuteAutofill(draft, STATUTE);
    expect(out.statute_id).toBe(1);
    expect(out.statute_citation).toBe('UCA 41-6a-601');
    expect(out.description).toBe('Speed limit violation');
    expect(out.offense_level).toBe('Infraction');
    expect(out.fine_amount).toBe(175);
  });

  it('keeps officer-edited description (non-empty)', () => {
    const draft = { ...newDraft(), description: 'Custom note' };
    const out = applyStatuteAutofill(draft, STATUTE);
    expect(out.description).toBe('Custom note');
  });

  it('keeps officer-edited fine (non-zero)', () => {
    const draft = { ...newDraft(), fine_amount: 50 };
    const out = applyStatuteAutofill(draft, STATUTE);
    expect(out.fine_amount).toBe(50);
  });
});
```

**Step 2: Run, expect FAIL**

**Step 3: Implement**

```typescript
// client/src/components/statuteAutofill.ts
import type { ViolationDraft, OffenseLevel } from './violationStackHelpers';

export interface StatuteRow {
  id: number;
  citation_code: string;
  title: string;
  offense_level: string;
  default_fine: number;
  description: string;
}

const LEVELS: OffenseLevel[] = ['Infraction', 'Misdemeanor', 'Felony'];

function normalizeLevel(s: string): OffenseLevel {
  const t = s.toLowerCase();
  if (t.startsWith('fel')) return 'Felony';
  if (t.startsWith('mis')) return 'Misdemeanor';
  return 'Infraction';
}

export function applyStatuteAutofill(draft: ViolationDraft, statute: StatuteRow): ViolationDraft {
  return {
    ...draft,
    statute_id: statute.id,
    statute_citation: statute.citation_code,
    description: draft.description?.trim() ? draft.description : (statute.description ?? statute.title),
    offense_level: draft.offense_level !== 'Infraction' || draft.statute_id !== undefined
      ? draft.offense_level     // user already chose a non-default level OR has a statute already
      : normalizeLevel(statute.offense_level),
    fine_amount: draft.fine_amount > 0 ? draft.fine_amount : statute.default_fine,
  };
}
```

Note: the offense_level rule is the subtle one — "Infraction" is also the default for a fresh draft, so we can't distinguish "officer chose Infraction" from "default Infraction". Tie-breaker: if the draft already has a `statute_id`, treat current level as officer-chosen. For first-time fill, normalize from statute. Document this in the JSDoc.

**Step 4: Run, 3/3 pass**

**Step 5: Commit**

```bash
git add client/src/components/statuteAutofill.ts client/src/components/__tests__/statuteAutofill.test.ts
git commit -m "feat(citations): statute auto-fill rule — only populate empty/untouched fields"
```

---

## Task 7: Wire `<Combobox>` + statute auto-fill into `<ViolationStack>`

**Files:**
- Modify: `client/src/components/ViolationStack.tsx`
- Modify: `client/src/components/__tests__/ViolationStack.test.tsx`

**Step 1: Add a test**

```typescript
import { applyStatuteAutofill } from '../statuteAutofill';   // existing import already
// inside the describe block:
it('selecting a statute applies auto-fill via applyStatuteAutofill', async () => {
  const fetcher = vi.fn(async () => [
    { id: 7, citation_code: 'UCA X', title: 'Test', offense_level: 'Misdemeanor', default_fine: 500, description: 'Test desc' },
  ]);
  const onChange = vi.fn();
  render(<ViolationStack value={[newDraft()]} onChange={onChange} statuteFetcher={fetcher} />);
  const input = screen.getByPlaceholderText(/Statute/i);
  fireEvent.focus(input);
  fireEvent.change(input, { target: { value: 'test' } });
  await waitFor(() => expect(fetcher).toHaveBeenCalledWith('test'));
  fireEvent.mouseDown(await screen.findByText(/UCA X/));
  expect(onChange).toHaveBeenCalled();
  const out = onChange.mock.calls.at(-1)![0][0];
  expect(out.statute_id).toBe(7);
  expect(out.fine_amount).toBe(500);
  expect(out.offense_level).toBe('Misdemeanor');
});
```

**Step 2: Modify `ViolationStack` to accept optional `statuteFetcher`**

```typescript
interface Props {
  value: ViolationDraft[];
  onChange: (next: ViolationDraft[]) => void;
  statuteFetcher?: (q: string) => Promise<StatuteRow[]>;
}
```

Replace the statute text input with `<Combobox<StatuteRow> fetcher={statuteFetcher} ... />` when fetcher is provided; fall back to plain `<input>` otherwise (keeps existing tests green).

On combobox `onChange(statute)`, patch the draft via `applyStatuteAutofill`.

**Step 3: Run all violation-stack tests + the new one — 6/6 pass**

**Step 4: Commit**

```bash
git add client/src/components/ViolationStack.tsx client/src/components/__tests__/ViolationStack.test.tsx
git commit -m "feat(citations): wire statute Combobox + auto-fill into ViolationStack"
```

---

## Task 8: `useCitationPreview` hook

**Files:**
- Create: `client/src/hooks/useCitationPreview.ts`
- Create: `client/src/hooks/__tests__/useCitationPreview.test.ts`

**Step 1: Write failing test**

```typescript
import { renderHook, act, waitFor } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { useCitationPreview } from '../useCitationPreview';

vi.mock('../../utils/pdf/v2', () => ({
  multiCopyPdfV2BlobUrl: vi.fn(async () => 'blob:fake'),
}));

describe('useCitationPreview', () => {
  it('returns null blobUrl until refresh() called (modal mode)', async () => {
    const { result } = renderHook(() => useCitationPreview({}, 'modal'));
    expect(result.current.blobUrl).toBeNull();
    await act(async () => { await result.current.refresh(); });
    expect(result.current.blobUrl).toBe('blob:fake');
  });

  it('auto-refreshes in side mode after form changes (debounced)', async () => {
    const { multiCopyPdfV2BlobUrl } = await import('../../utils/pdf/v2');
    const { result, rerender } = renderHook(({ f }) => useCitationPreview(f, 'side'), {
      initialProps: { f: { citation_number: 'A' } as any },
    });
    await waitFor(() => expect(multiCopyPdfV2BlobUrl).toHaveBeenCalledTimes(1));
    rerender({ f: { citation_number: 'B' } as any });
    await new Promise((r) => setTimeout(r, 600));
    await waitFor(() => expect(multiCopyPdfV2BlobUrl).toHaveBeenCalledTimes(2));
  });
});
```

**Step 2: Run, expect FAIL**

**Step 3: Implement**

```typescript
// client/src/hooks/useCitationPreview.ts
import { useCallback, useEffect, useRef, useState } from 'react';
import { multiCopyPdfV2BlobUrl } from '../utils/pdf/v2';
import { citationSchema } from '../utils/pdf/v2/forms/citation';
import { CITATION_INSTRUCTIONS } from '../utils/pdf/v2/forms/citationInstructions';

export type PreviewMode = 'modal' | 'side' | 'full';

export function useCitationPreview(form: any, mode: PreviewMode) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [isRendering, setIsRendering] = useState(false);
  const lastUrl = useRef<string | null>(null);

  const render = useCallback(async () => {
    setIsRendering(true);
    try {
      const url = await multiCopyPdfV2BlobUrl(citationSchema, form, CITATION_INSTRUCTIONS);
      if (lastUrl.current) URL.revokeObjectURL(lastUrl.current);
      lastUrl.current = url;
      setBlobUrl(url);
    } finally {
      setIsRendering(false);
    }
  }, [form]);

  // Side mode = auto refresh on form change with 500ms debounce.
  useEffect(() => {
    if (mode !== 'side') return;
    const id = setTimeout(() => { void render(); }, 500);
    return () => clearTimeout(id);
  }, [mode, render]);

  // Revoke URL on unmount.
  useEffect(() => () => { if (lastUrl.current) URL.revokeObjectURL(lastUrl.current); }, []);

  return { blobUrl, refresh: render, isRendering };
}
```

**Step 4: Run, 2/2 pass + tsc clean**

**Step 5: Commit**

```bash
git add client/src/hooks/useCitationPreview.ts client/src/hooks/__tests__/useCitationPreview.test.ts
git commit -m "feat(citations): useCitationPreview hook (modal/side/full modes, debounced)"
```

---

## Task 9: `<CitationPdfPreview>` tri-mode wrapper

**Files:**
- Create: `client/src/components/CitationPdfPreview.tsx`
- Create: `client/src/components/__tests__/CitationPdfPreview.test.tsx`

**Step 1: Write failing tests**

```typescript
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CitationPdfPreview } from '../CitationPdfPreview';

vi.mock('../../hooks/useCitationPreview', () => ({
  useCitationPreview: vi.fn(() => ({ blobUrl: 'blob:fake', refresh: vi.fn(), isRendering: false })),
}));

describe('CitationPdfPreview', () => {
  it('renders nothing visible in modal mode until Preview button clicked', () => {
    render(<CitationPdfPreview form={{}} mode="modal" onModeChange={() => {}} />);
    expect(screen.queryByTitle(/Citation preview/i)).not.toBeInTheDocument();
  });

  it('Preview button opens modal iframe', () => {
    render(<CitationPdfPreview form={{}} mode="modal" onModeChange={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /Preview/i }));
    expect(screen.getByTitle(/Citation preview/i)).toBeInTheDocument();
  });

  it('side mode renders iframe inline (always visible)', () => {
    render(<CitationPdfPreview form={{}} mode="side" onModeChange={() => {}} />);
    expect(screen.getByTitle(/Citation preview/i)).toBeInTheDocument();
  });

  it('mode toggle buttons call onModeChange', () => {
    const onModeChange = vi.fn();
    render(<CitationPdfPreview form={{}} mode="modal" onModeChange={onModeChange} />);
    fireEvent.click(screen.getByRole('button', { name: /Side/i }));
    expect(onModeChange).toHaveBeenCalledWith('side');
  });
});
```

**Step 2: Run, expect FAIL**

**Step 3: Implement** (~80 lines)

`CitationPdfPreview` accepts `{ form, mode, onModeChange }`. Renders a toolbar `[Preview ▾][◫ Side][⛶ Full]` (buttons highlighted when active). For `'modal'`: hidden by default; "Preview" button opens a fixed overlay `<div>` with `<iframe src={blobUrl} title="Citation preview">`. For `'side'`: renders the iframe inline at a fixed right-pane width. For `'full'`: renders the iframe full-width when the parent is in "full" view (parent handles the form-hide). Mobile detection via `useIsMobile()` hook (exists in codebase); when mobile, ignores `mode` prop and forces modal-on-button behavior, and hides the Side/Full buttons. Sample fragment:

```tsx
const { blobUrl, refresh } = useCitationPreview(form, mode);
const [modalOpen, setModalOpen] = useState(false);
const isMobile = useIsMobile();
const effectiveMode: PreviewMode = isMobile ? 'modal' : mode;

return (
  <div className="flex flex-col gap-2">
    <div className="flex gap-1">
      <button onClick={async () => { await refresh(); setModalOpen(true); }}>Preview</button>
      {!isMobile && (
        <>
          <button onClick={() => onModeChange('side')} aria-pressed={mode==='side'}>◫ Side</button>
          <button onClick={() => onModeChange('full')} aria-pressed={mode==='full'}>⛶ Full</button>
        </>
      )}
    </div>
    {effectiveMode === 'side' && blobUrl && (
      <iframe src={blobUrl} title="Citation preview" className="w-full h-[600px] border border-[#222]" />
    )}
    {modalOpen && blobUrl && (
      <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4" onClick={() => setModalOpen(false)}>
        <iframe src={blobUrl} title="Citation preview" className="w-full h-full max-w-4xl bg-white" onClick={(e) => e.stopPropagation()} />
      </div>
    )}
  </div>
);
```

**Step 4: Run, 4/4 pass + tsc clean**

**Step 5: Commit**

```bash
git add client/src/components/CitationPdfPreview.tsx client/src/components/__tests__/CitationPdfPreview.test.tsx
git commit -m "feat(citations): CitationPdfPreview tri-mode wrapper (modal/side, mobile-forced)"
```

---

## Task 10: `localStorage` persistence for preview mode

**Files:**
- Modify: `client/src/components/CitationPdfPreview.tsx` (or a parent that owns the mode state)
- Add a tiny hook: `client/src/hooks/usePersistedPreviewMode.ts`

**Step 1: Test**

```typescript
import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, beforeEach } from 'vitest';
import { usePersistedPreviewMode } from '../usePersistedPreviewMode';

beforeEach(() => localStorage.clear());

describe('usePersistedPreviewMode', () => {
  it('defaults to "modal"', () => {
    const { result } = renderHook(() => usePersistedPreviewMode());
    expect(result.current[0]).toBe('modal');
  });
  it('persists mode to localStorage and rehydrates', () => {
    const { result } = renderHook(() => usePersistedPreviewMode());
    act(() => result.current[1]('side'));
    expect(localStorage.getItem('rmpg.citation.preview_mode')).toBe('side');
    const { result: r2 } = renderHook(() => usePersistedPreviewMode());
    expect(r2.current[0]).toBe('side');
  });
});
```

**Step 2: Implement**

```typescript
// client/src/hooks/usePersistedPreviewMode.ts
import { useCallback, useState } from 'react';
import type { PreviewMode } from './useCitationPreview';

const KEY = 'rmpg.citation.preview_mode';
const VALID: PreviewMode[] = ['modal', 'side', 'full'];

export function usePersistedPreviewMode(): [PreviewMode, (m: PreviewMode) => void] {
  const [mode, setModeState] = useState<PreviewMode>(() => {
    const v = localStorage.getItem(KEY);
    return (v && (VALID as string[]).includes(v) ? v : 'modal') as PreviewMode;
  });
  const setMode = useCallback((m: PreviewMode) => {
    localStorage.setItem(KEY, m);
    setModeState(m);
  }, []);
  return [mode, setMode];
}
```

**Step 3: Run + commit**

```bash
git add client/src/hooks/usePersistedPreviewMode.ts client/src/hooks/__tests__/usePersistedPreviewMode.test.ts
git commit -m "feat(citations): persist preview mode preference to localStorage"
```

---

## Task 11: `formToData(formState)` — translate CitationsPage form → CitationData

**Why:** the v2 PDF engine takes `CitationData` (with `violations[]` etc.). The CitationsPage form state has slightly different field names (e.g. `form.fine_amount` is a single value but in multi-violation mode the fines live on each violation). Pure function with tests.

**Files:**
- Create: `client/src/components/citationFormAdapter.ts`
- Create: `client/src/components/__tests__/citationFormAdapter.test.ts`

**Step 1: Test (3 cases)**

```typescript
import { describe, it, expect } from 'vitest';
import { formToData } from '../citationFormAdapter';
import { newDraft } from '../violationStackHelpers';

describe('formToData', () => {
  it('maps flat form fields to CitationData when violations is empty', () => {
    const data = formToData({ citation_number: 'C-1', type: 'traffic', statute_citation: 'X', fine_amount: 100 } as any, []);
    expect(data.citation_number).toBe('C-1');
    expect(data.statute_citation).toBe('X');
    expect(data.violations).toBeUndefined();
  });
  it('includes violations array when present', () => {
    const v = [{ ...newDraft(), statute_citation: 'A', fine_amount: 25, description: 'a' }];
    const data = formToData({ citation_number: 'C-2' } as any, v);
    expect(data.violations).toHaveLength(1);
    expect(data.violations![0].statute_citation).toBe('A');
  });
  it('strips client-only id from violations', () => {
    const v = [{ id: 'client-uuid', statute_citation: 'A', description: '', offense_level: 'Infraction' as const, fine_amount: 0 }];
    const data = formToData({} as any, v);
    expect((data.violations![0] as any).id).toBeUndefined();
  });
});
```

**Step 2: Implement**

```typescript
// client/src/components/citationFormAdapter.ts
import type { CitationData, CitationViolation } from '../utils/pdf/v2/forms/citation';
import type { ViolationDraft } from './violationStackHelpers';

export function formToData(form: Partial<CitationData>, violations: ViolationDraft[]): CitationData {
  const data: CitationData = { ...form };
  if (violations.length > 0) {
    data.violations = violations.map<CitationViolation>((v) => ({
      statute_citation: v.statute_citation,
      description: v.description,
      offense_level: v.offense_level,
      fine_amount: v.fine_amount,
    }));
  }
  return data;
}
```

**Step 3: Run, 3/3 pass**

**Step 4: Commit**

```bash
git add client/src/components/citationFormAdapter.ts client/src/components/__tests__/citationFormAdapter.test.ts
git commit -m "feat(citations): formToData adapter — strips client ids, conditionally adds violations[]"
```

---

## Task 12: Extract `<CitationAuthor>` from `CitationsPage.tsx`

**Why:** the destination component. Now that all pieces exist, wire them.

**Files:**
- Create: `client/src/components/CitationAuthor.tsx`
- Modify: `client/src/pages/CitationsPage.tsx` (replace inline create/edit JSX with `<CitationAuthor>`)

**Step 1: Identify current create/edit JSX**

Read `CitationsPage.tsx` to find the JSX block conditional on `mode === 'create' || mode === 'edit'`. Move that block — verbatim, including form state hooks — into `CitationAuthor.tsx`. Keep the page-level `mode` state in `CitationsPage` for routing; pass `mode`, `initialData`, `onSaved`, `onCancel` as props to `<CitationAuthor>`.

**Step 2: Build `CitationAuthor.tsx`**

Wires together:
- Existing form state (lifted from CitationsPage)
- `<ViolationStack>` with `statuteFetcher={(q) => apiFetch('/citations/statutes/lookup?q=' + encodeURIComponent(q)).then((r: any) => r.data ?? [])}`
- `<CitationPdfPreview>` + `usePersistedPreviewMode()` for the toolbar
- Save handler that posts `{ ...formState, violations: formToData(formState, violations).violations }` to POST or PUT

**Step 3: Update `CitationsPage.tsx`**

Replace inline create/edit JSX with `<CitationAuthor mode={mode} ... />`. List view stays as-is.

**Step 4: Run client suite — no regressions**

```bash
cd client && npx vitest run
cd client && npx tsc --noEmit
```

**Step 5: Commit**

```bash
git add client/src/components/CitationAuthor.tsx client/src/pages/CitationsPage.tsx
git commit -m "refactor(citations): extract authoring into CitationAuthor component"
```

---

## Task 13: Replace native dropdowns in `CitationsPage.tsx` with `<Combobox>`

**Files:**
- Modify: `client/src/pages/CitationsPage.tsx`

For each native `<select>` in CitationsPage (filterType, filterStatus, payment_method, status field, vehicle_state, district selectors), replace with `<Combobox<T>>` using the existing options array. Keep the same `value` + `onChange` wire-up. Pages list and filter behavior unchanged — purely a dropdown polish.

**Step 1: Type-check after each replacement**

```bash
cd client && npx tsc --noEmit
```

**Step 2: Smoke the page manually** (`npm run dev`, navigate to `/citations`, verify all dropdowns open and select).

**Step 3: Commit**

```bash
git add client/src/pages/CitationsPage.tsx
git commit -m "refactor(citations): swap native <select> for <Combobox> across the page"
```

---

## Task 14: Production smoke + bump SW

**Step 1: Bump `CACHE_NAME` in `client/public/sw.js`** by +1.

**Step 2: Push branch + open PR.**

**Step 3: Merge to main → wait for deploy webhook → verify:**

```bash
ssh root@194.113.64.90 "tail -f /var/log/rmpg-deploy.log"
curl -sf https://rmpgutah.us/api/health | python3 -m json.tool
```

**Step 4: In-app smoke:**
- Hard-reload Electron (per Gotcha #14)
- Citations → New Citation
- Add subject + a 2-violation stack
- Open Preview → confirm 3-page PDF reflects both violations with running total $X
- Save → list view shows the new citation
- Click View on the new citation → confirm both violations render

**Step 5: Send operator notice** (one line): "Citations can now hold multiple violations. Use + Add Violation when issuing. Print shows running total."

---

## Out of scope (tracked, NOT in this plan)

- Signature pad capture for officer + violator at issuance
- Body-cam video attachment per citation
- Court-date auto-suggest based on offense level + jurisdiction
- Payment plan authoring UI (separate; lives under collections module)
- Multi-tenant agency override (uses RMPG defaults today)
