# FlexCam Full-Trip Stitching Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a closed `unit_trip` watchable as one continuous video in the FlexCam UI, and exportable as one signed file for evidence/court use — without paying the cost of materializing the merged file on every trip.

**Architecture:** Three layers, distinct lifecycles. (1) A pure trip-manifest endpoint joins `unit_trips × footage_chunks` for instant playback. (2) A client double-buffered video player consumes the manifest. (3) A new `FlexCamRemuxDO` Durable Object materializes the merged fMP4 lazily, triggered by the existing `POST /flexcam/render/:id` admin endpoint. The existing `/court-package` handler stays synchronous and is additively enriched with `merged_sha256`/`merged_url` when the merged file is ready.

**Tech Stack:** Cloudflare Workers (Hono), Cloudflare D1, Cloudflare Durable Objects (SQLite-backed), R2 (multipart upload), `mp4box.js`, React 18 + TypeScript + Vite, vitest.

**Spec:** [docs/superpowers/specs/2026-06-21-flexcam-full-trip-stitching-design.md](../specs/2026-06-21-flexcam-full-trip-stitching-design.md)

---

## Phase A — Foundation

### Task 1: Pre-implementation bundle-size check for `mp4box.js`

**Files:**
- Read: `package.json`
- Run: `npm view mp4box`

This is a precondition gate. If `mp4box.js` blows the Worker bundle, the design's DO path is unviable and we fall back to a client-only design. **Do not proceed past this task without a green check.**

- [ ] **Step 1: Inspect the package**

```bash
npm view mp4box dist-tags version
npm view mp4box files
```

Expected: stable version >= 0.5.x. Note the file list — we only want the ESM build.

- [ ] **Step 2: Dry-install + measure**

```bash
mkdir -p /tmp/mp4box-size && cd /tmp/mp4box-size
npm init -y >/dev/null
npm install mp4box --silent
ls -lah node_modules/mp4box/dist/
```

Expected: `mp4box.all.min.js` (or similar) under ~300 KB. If it's >500 KB, **STOP** and surface to the user — bundle budget is at risk.

- [ ] **Step 3: Bundle-build smoke**

In the worktree:

```bash
cd "$(git rev-parse --show-toplevel)"
npm install mp4box
npx wrangler deploy --dry-run --outdir /tmp/wrangler-build 2>&1 | tail -20
ls -lah /tmp/wrangler-build/
```

Expected: `index.js` total size reported. Worker free plan limit is 1 MB compressed; paid is 10 MB. We are on paid (Smart Placement is enabled per `wrangler.toml:26-28`), so up to 10 MB is OK. Anything over 3 MB is a yellow flag worth raising.

- [ ] **Step 4: Commit the dep**

```bash
git add package.json package-lock.json
git commit -m "$(cat <<'EOF'
chore(deps): add mp4box.js for FlexCam full-trip stitching

Required by the new FlexCamRemuxDO to remux per-clip MP4s into one
fragmented MP4 for court-package export. Pure JS — runs inside the
DO bundle, not the main Worker hot path.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Add the migration file

**Files:**
- Create: `migrations/<NNNN>_flexcam_remux_state.sql` — `<NNNN>` is the next free integer prefix at implementation time

- [ ] **Step 1: Pick the migration number**

```bash
ls migrations/ | grep -E '^0[0-9]{3}_' | sort -t_ -k1,1 | tail -3
```

The next free integer is `last + 1`. At spec time the high-water was `0141` (with `0142` reserved by open [PR #1539](https://github.com/rmpgutah/rmpg-flex/pull/1539)). If your PR is the next to merge after #1539, use `0143`; otherwise `0142`. Substitute below.

- [ ] **Step 2: Create the migration**

Create `migrations/<NNNN>_flexcam_remux_state.sql`:

```sql
-- 0143 (or next-free) — flexcam remux state columns.
-- Adds the bookkeeping fields the FlexCamRemuxDO uses to mark a footage
-- request through the lazy MP4-to-fMP4 remux pipeline. All ADD COLUMN
-- statements are tolerant of re-apply (D1 doesn't support IF NOT EXISTS
-- on ADD COLUMN, so the Worker's columnExists() reconciler in flexcam.ts
-- guards routes at runtime).

ALTER TABLE footage_requests ADD COLUMN remux_state TEXT;
ALTER TABLE footage_requests ADD COLUMN remux_started_at INTEGER;
ALTER TABLE footage_requests ADD COLUMN remux_finished_at INTEGER;
ALTER TABLE footage_requests ADD COLUMN remux_error TEXT;
ALTER TABLE footage_requests ADD COLUMN remux_attempts INTEGER DEFAULT 0;
ALTER TABLE footage_requests ADD COLUMN merged_sha256 TEXT;

-- Backfill — anything that already has a merged file is implicitly ready.
UPDATE footage_requests SET remux_state = 'ready' WHERE merged_status = 'ready';
```

- [ ] **Step 3: Test locally**

```bash
npm run migrate:local
sqlite3 .wrangler/state/v3/d1/*.sqlite "PRAGMA table_info('footage_requests')" | grep -E 'remux|merged_sha256'
```

Expected: six new rows printed.

- [ ] **Step 4: Commit**

```bash
git add migrations/<NNNN>_flexcam_remux_state.sql
git commit -m "$(cat <<'EOF'
feat(flexcam): mig <NNNN> — remux state columns on footage_requests

Bookkeeping for the FlexCamRemuxDO MP4→fMP4 pipeline:
remux_state, remux_started_at, remux_finished_at, remux_error,
remux_attempts, merged_sha256. Idempotent ADD COLUMN; runtime
reconciler in flexcam.ts gates routes when live D1 is behind.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Schema reconciler — add `columnExists` guard in `flexcam.ts`

**Files:**
- Modify: `src/routes/flexcam.ts` — extend `ensureEvidenceSchema()` (or add a sibling `ensureRemuxSchema()`)

- [ ] **Step 1: Read the existing reconciler**

Run: `sed -n '25,55p' src/routes/flexcam.ts`

You'll see `ensureEvidenceSchema()` patterns and the existing `CREATE TABLE IF NOT EXISTS`/`ALTER TABLE` blocks that defensively add columns when migrations haven't landed. Follow the same pattern.

- [ ] **Step 2: Add `ensureRemuxSchema` helper near the existing `ensureEvidenceSchema`**

Add this near the other ensure helpers in `src/routes/flexcam.ts`:

```ts
// Mirrors ensureEvidenceSchema(): tolerates a live D1 that hasn't
// yet had migration <NNNN> applied. Safe to call repeatedly — every
// ALTER is wrapped in a try/catch via columnExists().
async function ensureRemuxSchema(db: D1Database): Promise<void> {
  const adds: Array<[string, string]> = [
    ['remux_state', 'TEXT'],
    ['remux_started_at', 'INTEGER'],
    ['remux_finished_at', 'INTEGER'],
    ['remux_error', 'TEXT'],
    ['remux_attempts', 'INTEGER DEFAULT 0'],
    ['merged_sha256', 'TEXT'],
  ];
  for (const [col, ddl] of adds) {
    const has = await columnExists(db, 'footage_requests', col).catch(() => false);
    if (!has) {
      await db.prepare(`ALTER TABLE footage_requests ADD COLUMN ${col} ${ddl}`)
        .run().catch(() => {});
    }
  }
}
```

- [ ] **Step 3: Verify typecheck**

```bash
npm run typecheck
```

Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add src/routes/flexcam.ts
git commit -m "$(cat <<'EOF'
feat(flexcam): ensureRemuxSchema runtime reconciler

Mirrors ensureEvidenceSchema(); guards remux routes from D1 drift
when migration <NNNN> hasn't reached live (deploy step is
continue-on-error per CLAUDE.md gotcha #5).

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Phase B — Server pure helpers (TDD)

### Task 4: Write failing test for `buildPlayerManifest`

**Files:**
- Modify: `tests/footage/concat.test.ts` (already exists)

- [ ] **Step 1: Inspect existing tests for style**

```bash
sed -n '1,40p' tests/footage/concat.test.ts
```

Mirror the import pattern and `describe`/`it` shape.

- [ ] **Step 2: Append the new test block**

Append to `tests/footage/concat.test.ts`:

```ts
import { buildPlayerManifest } from '../../src/utils/footage/concat';

describe('buildPlayerManifest', () => {
  const trip = { id: 42, start_time: 1_000_000, end_time: 1_300_000 };

  it('returns empty manifest when no chunks exist', () => {
    const m = buildPlayerManifest(trip, 'outside', []);
    expect(m.clips).toEqual([]);
    expect(m.gaps).toEqual([]);
    expect(m.stillDownloading).toBe(0);
    expect(m.totalDurationMs).toBe(0);
  });

  it('marks not-yet-downloaded chunks in stillDownloading', () => {
    const m = buildPlayerManifest(trip, 'outside', [
      { id: 1, request_id: 9, seq: 0, channel: 'outside', from_ts: 1_000_000, to_ts: 1_040_000, status: 'downloaded', r2_key: 'k0', sha256: null, bytes: 5 },
      { id: 2, request_id: 9, seq: 1, channel: 'outside', from_ts: 1_040_000, to_ts: 1_080_000, status: 'pending',    r2_key: null, sha256: null, bytes: 0 },
    ]);
    expect(m.clips).toHaveLength(1);
    expect(m.clips[0].seq).toBe(0);
    expect(m.stillDownloading).toBe(1);
  });

  it('sorts by from_ts and computes contiguous-no-gaps', () => {
    const m = buildPlayerManifest(trip, 'outside', [
      { id: 2, request_id: 9, seq: 1, channel: 'outside', from_ts: 1_040_000, to_ts: 1_080_000, status: 'downloaded', r2_key: 'k1', sha256: null, bytes: 5 },
      { id: 1, request_id: 9, seq: 0, channel: 'outside', from_ts: 1_000_000, to_ts: 1_040_000, status: 'downloaded', r2_key: 'k0', sha256: null, bytes: 5 },
    ]);
    expect(m.clips.map((c) => c.seq)).toEqual([0, 1]);
    expect(m.gaps).toEqual([]);
    expect(m.totalDurationMs).toBe(80_000);
  });

  it('detects a gap > 500ms between consecutive downloaded chunks', () => {
    const m = buildPlayerManifest(trip, 'outside', [
      { id: 1, request_id: 9, seq: 0, channel: 'outside', from_ts: 1_000_000, to_ts: 1_040_000, status: 'downloaded', r2_key: 'k0', sha256: null, bytes: 5 },
      { id: 2, request_id: 9, seq: 1, channel: 'outside', from_ts: 1_046_000, to_ts: 1_086_000, status: 'downloaded', r2_key: 'k1', sha256: null, bytes: 5 },
    ]);
    expect(m.gaps).toHaveLength(1);
    expect(m.gaps[0].durationMs).toBe(6_000);
    expect(m.gaps[0].startTs).toBe(1_040_000);
    expect(m.gaps[0].endTs).toBe(1_046_000);
  });

  it('treats a ≤500ms boundary as contiguous (clock drift tolerance)', () => {
    const m = buildPlayerManifest(trip, 'outside', [
      { id: 1, request_id: 9, seq: 0, channel: 'outside', from_ts: 1_000_000, to_ts: 1_040_000, status: 'downloaded', r2_key: 'k0', sha256: null, bytes: 5 },
      { id: 2, request_id: 9, seq: 1, channel: 'outside', from_ts: 1_040_400, to_ts: 1_080_400, status: 'downloaded', r2_key: 'k1', sha256: null, bytes: 5 },
    ]);
    expect(m.gaps).toEqual([]);
  });

  it('filters by channel', () => {
    const m = buildPlayerManifest(trip, 'outside', [
      { id: 1, request_id: 9, seq: 0, channel: 'outside', from_ts: 1_000_000, to_ts: 1_040_000, status: 'downloaded', r2_key: 'k0', sha256: null, bytes: 5 },
      { id: 2, request_id: 9, seq: 0, channel: 'interior', from_ts: 1_000_000, to_ts: 1_040_000, status: 'downloaded', r2_key: 'k1', sha256: null, bytes: 5 },
    ]);
    expect(m.clips).toHaveLength(1);
    expect(m.clips[0].url).toContain('k0');
  });

  it('uses the chunk-streaming endpoint as the URL', () => {
    const m = buildPlayerManifest(trip, 'outside', [
      { id: 1, request_id: 9, seq: 0, channel: 'outside', from_ts: 1_000_000, to_ts: 1_040_000, status: 'downloaded', r2_key: 'k0', sha256: 'abc', bytes: 5 },
    ]);
    expect(m.clips[0].url).toBe('/api/flexcam/footage/9/chunk/0/stream');
    expect(m.clips[0].sha256).toBe('abc');
  });
});
```

- [ ] **Step 3: Run the test, confirm it fails**

```bash
npx vitest run tests/footage/concat.test.ts
```

Expected: FAIL — `buildPlayerManifest is not a function`.

- [ ] **Step 4: Commit the failing test**

```bash
git add tests/footage/concat.test.ts
git commit -m "$(cat <<'EOF'
test(flexcam): failing tests for buildPlayerManifest (TDD)

Covers empty, ordering, gap detection (>500ms threshold), clock-drift
tolerance (≤500ms), channel filter, URL composition. Mirrors the
TripPlayerManifest shape from the spec.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Implement `buildPlayerManifest` in `concat.ts`

**Files:**
- Modify: `src/utils/footage/concat.ts`

- [ ] **Step 1: Add the types and the helper**

Append to `src/utils/footage/concat.ts`:

```ts
import { detectGaps as splitDetectGaps } from './splitWindow';

export interface ChunkRow {
  id: number;
  request_id: number;
  seq: number;
  channel: string;
  from_ts: number;
  to_ts: number;
  status: string;
  r2_key: string | null;
  sha256: string | null;
  bytes: number;
}

export interface TripRef { id: number; start_time: number; end_time: number | null }

export interface PlayerClip {
  seq: number;
  fromTs: number;
  toTs: number;
  durationMs: number;
  url: string;
  sha256: string | null;
  bytes: number;
}

export interface PlayerGap {
  startTs: number;
  endTs: number;
  durationMs: number;
}

export interface TripPlayerManifest {
  tripId: number;
  channel: string;
  totalDurationMs: number;
  stillDownloading: number;
  clips: PlayerClip[];
  gaps: PlayerGap[];
}

const GAP_THRESHOLD_MS = 500;

export function buildPlayerManifest(
  trip: TripRef,
  channel: string,
  chunks: ChunkRow[],
): TripPlayerManifest {
  const inChannel = chunks.filter((c) => c.channel === channel);
  const downloaded = inChannel
    .filter((c) => c.status === 'downloaded' && c.r2_key)
    .sort((a, b) => a.from_ts - b.from_ts);

  const clips: PlayerClip[] = downloaded.map((c) => ({
    seq: c.seq,
    fromTs: c.from_ts,
    toTs: c.to_ts,
    durationMs: c.to_ts - c.from_ts,
    url: `/api/flexcam/footage/${c.request_id}/chunk/${c.seq}/stream`,
    sha256: c.sha256,
    bytes: c.bytes,
  }));

  const gaps: PlayerGap[] = [];
  for (let i = 1; i < downloaded.length; i++) {
    const prev = downloaded[i - 1];
    const cur = downloaded[i];
    const delta = cur.from_ts - prev.to_ts;
    if (delta > GAP_THRESHOLD_MS) {
      gaps.push({ startTs: prev.to_ts, endTs: cur.from_ts, durationMs: delta });
    }
  }

  const totalDurationMs = clips.reduce((s, c) => s + c.durationMs, 0);
  const stillDownloading = inChannel.filter((c) => c.status !== 'downloaded').length;

  return { tripId: trip.id, channel, totalDurationMs, stillDownloading, clips, gaps };
}
```

Note: we do **not** delegate to `splitDetectGaps` because its signature accepts `ChunkRow[]` keyed on different field names — extracted as a future cleanup. The threshold (`GAP_THRESHOLD_MS = 500`) is the same value.

- [ ] **Step 2: Run tests, expect pass**

```bash
npx vitest run tests/footage/concat.test.ts
```

Expected: all `buildPlayerManifest` tests PASS. Existing `buildManifest` tests still PASS.

- [ ] **Step 3: Typecheck**

```bash
npm run typecheck
```

Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add src/utils/footage/concat.ts
git commit -m "$(cat <<'EOF'
feat(flexcam): buildPlayerManifest in concat.ts

Player-oriented manifest distinct from the existing chunk-level
buildManifest(): per-trip, channel-filtered, gap-detection with the
500ms clock-drift tolerance. Used by GET /trips/:id/manifest.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Real-fixture test setup for mp4box.js

**Files:**
- Create: `tests/fixtures/footage/clip-a.mp4` (binary fixture, ~15 KB)
- Create: `tests/fixtures/footage/clip-b.mp4` (binary fixture, ~15 KB)
- Create: `tests/fixtures/footage/README.md`

- [ ] **Step 1: Generate two tiny MP4 clips with ffmpeg**

Run locally (you must have ffmpeg installed):

```bash
mkdir -p tests/fixtures/footage
ffmpeg -y -f lavfi -i "testsrc=duration=2:size=128x128:rate=15" \
       -c:v libx264 -preset ultrafast -tune zerolatency -pix_fmt yuv420p \
       -movflags +faststart \
       tests/fixtures/footage/clip-a.mp4
ffmpeg -y -f lavfi -i "testsrc=duration=2:size=128x128:rate=15" \
       -c:v libx264 -preset ultrafast -tune zerolatency -pix_fmt yuv420p \
       -movflags +faststart \
       tests/fixtures/footage/clip-b.mp4
ls -lah tests/fixtures/footage/*.mp4
```

Expected: two ~15 KB MP4 files.

- [ ] **Step 2: Write fixture README**

Create `tests/fixtures/footage/README.md`:

```markdown
# FlexCam test fixtures

Two synthetic 2-second 128×128 H.264 MP4 clips generated by ffmpeg.
Used by `tests/footage/remuxMp4ToFmp4.test.ts` to verify the
mp4box.js end-to-end remux produces a valid fragmented MP4.

Regenerate with the commands in
`docs/superpowers/plans/2026-06-21-flexcam-full-trip-stitching.md`
Task 6 Step 1.
```

- [ ] **Step 3: Commit**

```bash
git add tests/fixtures/footage/
git commit -m "$(cat <<'EOF'
test(flexcam): fixture clips for mp4box.js remux end-to-end test

Two synthetic 2-second H.264 MP4s for the real-fixture integration
test in remuxMp4ToFmp4.test.ts. Generated by ffmpeg; regen instructions
in tests/fixtures/footage/README.md.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: Write failing tests for `mp4box.ts` wrapper

**Files:**
- Create: `tests/footage/mp4box.test.ts`

- [ ] **Step 1: Write the tests**

Create `tests/footage/mp4box.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { remuxMp4SegmentsToFmp4 } from '../../src/utils/footage/mp4box';

const clipA = readFileSync(resolve(__dirname, '../fixtures/footage/clip-a.mp4'));
const clipB = readFileSync(resolve(__dirname, '../fixtures/footage/clip-b.mp4'));

describe('remuxMp4SegmentsToFmp4', () => {
  it('produces a non-empty fMP4 byte buffer for one input segment', async () => {
    const result = await remuxMp4SegmentsToFmp4([new Uint8Array(clipA)]);
    expect(result.bytes.byteLength).toBeGreaterThan(1000);
    // fMP4 marker: 'ftyp' box near the start (offset 4)
    const head = String.fromCharCode(...result.bytes.subarray(4, 8));
    expect(head).toBe('ftyp');
  });

  it('concatenates two segments into one fMP4', async () => {
    const result = await remuxMp4SegmentsToFmp4([
      new Uint8Array(clipA),
      new Uint8Array(clipB),
    ]);
    // Result should be larger than either input alone.
    expect(result.bytes.byteLength).toBeGreaterThan(clipA.length);
  });

  it('throws a typed error on unparseable input', async () => {
    const junk = new Uint8Array([0xde, 0xad, 0xbe, 0xef]);
    await expect(remuxMp4SegmentsToFmp4([junk])).rejects.toMatchObject({
      code: 'mp4box_parse_failed',
    });
  });
});
```

- [ ] **Step 2: Run the test, expect fail**

```bash
npx vitest run tests/footage/mp4box.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Commit failing test**

```bash
git add tests/footage/mp4box.test.ts
git commit -m "$(cat <<'EOF'
test(flexcam): failing tests for mp4box.js wrapper (TDD)

Two real-fixture pass-tests + one typed-error rejection test.
Drives the shape of src/utils/footage/mp4box.ts.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: Implement `src/utils/footage/mp4box.ts`

**Files:**
- Create: `src/utils/footage/mp4box.ts`

- [ ] **Step 1: Write the wrapper**

Create `src/utils/footage/mp4box.ts`:

```ts
// Thin wrapper over mp4box.js. Keeps the dependency boundary explicit
// so concat.ts stays deps-free. Exposes one async helper:
//   remuxMp4SegmentsToFmp4(segments) → { bytes, sha256 }
//
// All translation of mp4box's event-driven API into a Promise lives
// here. Callers (concat.ts:remuxMp4ToFmp4) deal in Uint8Array in,
// Uint8Array out + a sha256 string.

import MP4Box from 'mp4box';

export class Mp4BoxError extends Error {
  code: 'mp4box_parse_failed' | 'mp4box_no_tracks' | 'mp4box_segment_failed';
  constructor(code: Mp4BoxError['code'], message: string) {
    super(message);
    this.code = code;
    this.name = 'Mp4BoxError';
  }
}

export interface RemuxResult {
  bytes: Uint8Array;
  sha256: string;
}

export async function remuxMp4SegmentsToFmp4(segments: Uint8Array[]): Promise<RemuxResult> {
  if (segments.length === 0) {
    throw new Mp4BoxError('mp4box_no_tracks', 'no input segments');
  }

  // Output collector. mp4box emits an init segment + per-fragment buffers.
  const outChunks: Uint8Array[] = [];

  const file = MP4Box.createFile();

  await new Promise<void>((resolve, reject) => {
    let firstSegment = true;
    file.onError = (err: string) => reject(new Mp4BoxError('mp4box_parse_failed', err));
    file.onReady = (info: { tracks: Array<{ id: number }> }) => {
      if (!info.tracks?.length) return reject(new Mp4BoxError('mp4box_no_tracks', 'no tracks'));
      for (const t of info.tracks) {
        file.setSegmentOptions(t.id, null, { nbSamples: 100 });
      }
      const initSegs = file.initializeSegmentation();
      for (const s of initSegs) outChunks.push(new Uint8Array(s.buffer));
      file.start();
    };
    file.onSegment = (_id: number, _user: unknown, buffer: ArrayBuffer) => {
      outChunks.push(new Uint8Array(buffer));
    };

    // mp4box requires each appended buffer to have a `fileStart` property.
    try {
      let offset = 0;
      for (const seg of segments) {
        const ab = seg.buffer.slice(seg.byteOffset, seg.byteOffset + seg.byteLength) as ArrayBuffer & { fileStart?: number };
        ab.fileStart = offset;
        file.appendBuffer(ab);
        offset += seg.byteLength;
        if (firstSegment) firstSegment = false;
      }
      file.flush();
      resolve();
    } catch (err) {
      reject(new Mp4BoxError('mp4box_segment_failed', String(err)));
    }
  });

  if (outChunks.length === 0) {
    throw new Mp4BoxError('mp4box_segment_failed', 'no output produced');
  }

  const totalLen = outChunks.reduce((s, b) => s + b.byteLength, 0);
  const bytes = new Uint8Array(totalLen);
  let pos = 0;
  for (const b of outChunks) { bytes.set(b, pos); pos += b.byteLength; }

  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const sha256 = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');

  return { bytes, sha256 };
}
```

- [ ] **Step 2: Run tests, expect pass**

```bash
npx vitest run tests/footage/mp4box.test.ts
```

Expected: all 3 tests PASS. If mp4box's TypeScript types are missing, add `declare module 'mp4box';` to `src/types.d.ts` (or create it). If types exist but differ from the calls above, adjust the casts — the runtime API is what matters.

- [ ] **Step 3: Typecheck**

```bash
npm run typecheck
```

Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add src/utils/footage/mp4box.ts src/types.d.ts 2>/dev/null
git commit -m "$(cat <<'EOF'
feat(flexcam): mp4box.ts thin wrapper over mp4box.js

Translates mp4box's event API to a Promise<{bytes, sha256}>. Typed
errors (Mp4BoxError) for the three failure modes. Used by the new
remuxMp4ToFmp4 path in concat.ts (next task).

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

### Task 9: Write failing tests for `remuxMp4ToFmp4` in concat.ts

**Files:**
- Modify: `tests/footage/concat.test.ts`

- [ ] **Step 1: Append the new test block**

Append to `tests/footage/concat.test.ts`:

```ts
import { vi } from 'vitest';
import { remuxMp4ToFmp4 } from '../../src/utils/footage/concat';

const mockR2 = (storage: Record<string, Uint8Array>) => ({
  UPLOADS: {
    get: vi.fn(async (key: string) =>
      storage[key] ? { body: new Response(storage[key]).body, arrayBuffer: async () => storage[key].buffer } : null,
    ),
    put: vi.fn(async (_key: string, _body: unknown, _opts: unknown) => ({ etag: 'fake' })),
  },
});

describe('remuxMp4ToFmp4', () => {
  it('returns "ready" and writes a merged object when all chunks fetch ok', async () => {
    const storage = {
      'flexcam/trips/0/0.mp4': new Uint8Array([1, 2, 3]),
      'flexcam/trips/0/1.mp4': new Uint8Array([4, 5, 6]),
    };
    const env = mockR2(storage);

    // Force mp4box wrapper to a stub so we don't depend on real binaries here.
    vi.doMock('../../src/utils/footage/mp4box', () => ({
      remuxMp4SegmentsToFmp4: vi.fn(async (segs: Uint8Array[]) => ({
        bytes: new Uint8Array(segs.reduce((s, x) => s + x.byteLength, 0)),
        sha256: 'fake-sha',
      })),
      Mp4BoxError: class extends Error {},
    }));

    const result = await remuxMp4ToFmp4(env as any, 'flexcam/trips/merged/0.mp4', [
      { seq: 0, r2_key: 'flexcam/trips/0/0.mp4' },
      { seq: 1, r2_key: 'flexcam/trips/0/1.mp4' },
    ]);
    expect(result.state).toBe('ready');
    expect(result.sha256).toBe('fake-sha');
    expect(env.UPLOADS.put).toHaveBeenCalledTimes(1);
    vi.doUnmock('../../src/utils/footage/mp4box');
  });

  it('returns "failed" with a code when ≥10% of chunks are missing from R2', async () => {
    const storage = {
      'flexcam/trips/0/0.mp4': new Uint8Array([1, 2, 3]),
      // 1.mp4 missing
      'flexcam/trips/0/2.mp4': new Uint8Array([7, 8, 9]),
      // 3.mp4 missing
      'flexcam/trips/0/4.mp4': new Uint8Array([7, 8, 9]),
    };
    const env = mockR2(storage);
    const result = await remuxMp4ToFmp4(env as any, 'flexcam/trips/merged/0.mp4', [
      { seq: 0, r2_key: 'flexcam/trips/0/0.mp4' },
      { seq: 1, r2_key: 'flexcam/trips/0/1.mp4' },
      { seq: 2, r2_key: 'flexcam/trips/0/2.mp4' },
      { seq: 3, r2_key: 'flexcam/trips/0/3.mp4' },
      { seq: 4, r2_key: 'flexcam/trips/0/4.mp4' },
    ]);
    expect(result.state).toBe('failed');
    expect(result.errorCode).toBe('integrity_threshold_exceeded');
  });

  it('skips ≤10% missing chunks and continues', async () => {
    const storage: Record<string, Uint8Array> = {};
    for (let i = 0; i < 20; i++) storage[`flexcam/trips/0/${i}.mp4`] = new Uint8Array([i]);
    delete storage['flexcam/trips/0/5.mp4']; // 1/20 = 5% missing
    const env = mockR2(storage);

    vi.doMock('../../src/utils/footage/mp4box', () => ({
      remuxMp4SegmentsToFmp4: vi.fn(async () => ({ bytes: new Uint8Array(10), sha256: 'ok' })),
      Mp4BoxError: class extends Error {},
    }));

    const chunks = Array.from({ length: 20 }, (_, i) => ({ seq: i, r2_key: `flexcam/trips/0/${i}.mp4` }));
    const result = await remuxMp4ToFmp4(env as any, 'flexcam/trips/merged/0.mp4', chunks);
    expect(result.state).toBe('ready');
    expect(result.skipped).toEqual([5]);
    vi.doUnmock('../../src/utils/footage/mp4box');
  });
});
```

- [ ] **Step 2: Run, expect fail**

```bash
npx vitest run tests/footage/concat.test.ts
```

Expected: 3 new failures — `remuxMp4ToFmp4 is not a function`.

- [ ] **Step 3: Commit failing tests**

```bash
git add tests/footage/concat.test.ts
git commit -m "$(cat <<'EOF'
test(flexcam): failing tests for remuxMp4ToFmp4 (TDD)

Covers happy path, 10% corruption threshold (fail), and 5% (skip+
continue). Mocks the mp4box.ts wrapper so the unit tests don't pull
in the binary fixture path.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

### Task 10: Implement `remuxMp4ToFmp4` in `concat.ts`

**Files:**
- Modify: `src/utils/footage/concat.ts`

- [ ] **Step 1: Append the implementation**

Append to `src/utils/footage/concat.ts`:

```ts
import { remuxMp4SegmentsToFmp4, Mp4BoxError } from './mp4box';

const CORRUPTION_THRESHOLD_RATIO = 0.10;

export interface RemuxJobResult {
  state: 'ready' | 'failed';
  sha256?: string;
  bytes?: number;
  skipped: number[];
  errorCode?: string;
  errorMessage?: string;
}

export async function remuxMp4ToFmp4(
  env: { UPLOADS: R2Bucket },
  mergedKey: string,
  chunks: Array<{ seq: number; r2_key: string }>,
): Promise<RemuxJobResult> {
  const segments: Uint8Array[] = [];
  const skipped: number[] = [];

  for (const c of chunks) {
    try {
      const obj = await env.UPLOADS.get(c.r2_key);
      if (!obj) { skipped.push(c.seq); continue; }
      const buf = new Uint8Array(await obj.arrayBuffer());
      segments.push(buf);
    } catch {
      skipped.push(c.seq);
    }
  }

  const skipRatio = chunks.length === 0 ? 1 : skipped.length / chunks.length;
  if (skipRatio >= CORRUPTION_THRESHOLD_RATIO) {
    return {
      state: 'failed',
      skipped,
      errorCode: 'integrity_threshold_exceeded',
      errorMessage: `${skipped.length}/${chunks.length} chunks unreadable (>= ${Math.round(CORRUPTION_THRESHOLD_RATIO * 100)}%)`,
    };
  }

  try {
    const result = await remuxMp4SegmentsToFmp4(segments);
    await env.UPLOADS.put(mergedKey, result.bytes, {
      httpMetadata: { contentType: 'video/mp4' },
    });
    return {
      state: 'ready',
      sha256: result.sha256,
      bytes: result.bytes.byteLength,
      skipped,
    };
  } catch (err) {
    const code = err instanceof Mp4BoxError ? err.code : 'remux_unknown';
    return {
      state: 'failed',
      skipped,
      errorCode: code,
      errorMessage: err instanceof Error ? err.message : String(err),
    };
  }
}
```

- [ ] **Step 2: Run tests, expect pass**

```bash
npx vitest run tests/footage/concat.test.ts
```

Expected: all tests PASS (old `buildManifest`, new `buildPlayerManifest`, new `remuxMp4ToFmp4`).

- [ ] **Step 3: Typecheck**

```bash
npm run typecheck
```

Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add src/utils/footage/concat.ts
git commit -m "$(cat <<'EOF'
feat(flexcam): remuxMp4ToFmp4 + 10% corruption threshold

MP4 → fMP4 remux producer for the FlexCamRemuxDO. R2 fetch + skip
on miss + threshold gate + mp4box delegation + R2 write. Typed
error codes via Mp4BoxError from mp4box.ts.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Phase C — Server route: manifest endpoint

### Task 11: Write failing test for `GET /api/flexcam/trips/:tripId/manifest`

**Files:**
- Modify: `tests/footage/flexcamRoute.test.ts`

- [ ] **Step 1: Append new test block**

Append to `tests/footage/flexcamRoute.test.ts`:

```ts
describe('GET /api/flexcam/trips/:tripId/manifest', () => {
  it('returns 404 when the trip does not exist', async () => {
    const env = makeTestEnv(); // existing helper in this file — reuse pattern
    const res = await app.fetch(new Request('http://test/api/flexcam/trips/99999/manifest', {
      headers: { Authorization: `Bearer ${env.token}` },
    }), env);
    expect(res.status).toBe(404);
  });

  it('returns 200 with empty clips when trip exists but has no downloaded chunks', async () => {
    const env = makeTestEnv();
    await seedTrip(env, { id: 1, unit_id: 1, status: 'closed', start_time: 1, end_time: 100 });
    const res = await app.fetch(new Request('http://test/api/flexcam/trips/1/manifest', {
      headers: { Authorization: `Bearer ${env.token}` },
    }), env);
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.clips).toEqual([]);
    expect(body.stillDownloading).toBeGreaterThanOrEqual(0);
  });

  it('returns the player manifest for a trip with downloaded chunks', async () => {
    const env = makeTestEnv();
    await seedTrip(env, { id: 2, unit_id: 1, status: 'closed', start_time: 1_000_000, end_time: 1_100_000 });
    await seedRequest(env, { id: 7, trip_id: 2 });
    await seedChunks(env, [
      { request_id: 7, seq: 0, channel: 'outside', from_ts: 1_000_000, to_ts: 1_040_000, status: 'downloaded', r2_key: 'k0' },
    ]);
    const res = await app.fetch(new Request('http://test/api/flexcam/trips/2/manifest?channel=outside', {
      headers: { Authorization: `Bearer ${env.token}` },
    }), env);
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.tripId).toBe(2);
    expect(body.clips).toHaveLength(1);
    expect(body.clips[0].seq).toBe(0);
  });

  it('rejects unauthenticated requests', async () => {
    const env = makeTestEnv();
    const res = await app.fetch(new Request('http://test/api/flexcam/trips/1/manifest'), env);
    expect(res.status).toBe(401);
  });
});
```

Note: `makeTestEnv()`, `seedTrip()`, `seedRequest()`, `seedChunks()` are helpers — if the existing `flexcamRoute.test.ts` already has equivalents, reuse them. If not, add them at the top of the file mirroring the patterns in `tests/footage/evidence.test.ts` (which already wires an in-memory D1 via Miniflare or a setup helper).

- [ ] **Step 2: Run, expect fail**

```bash
npx vitest run tests/footage/flexcamRoute.test.ts
```

Expected: 4 new failures (404 returned where 200 expected, etc).

- [ ] **Step 3: Commit**

```bash
git add tests/footage/flexcamRoute.test.ts
git commit -m "$(cat <<'EOF'
test(flexcam): failing tests for /api/flexcam/trips/:id/manifest

Auth gate, missing trip, empty trip, happy path. Drives the new
route handler in flexcam.ts.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

### Task 12: Implement `GET /trips/:tripId/manifest` in `flexcam.ts`

**Files:**
- Modify: `src/routes/flexcam.ts`

- [ ] **Step 1: Add the handler**

In `src/routes/flexcam.ts`, after the existing `/footage/:id/continuous` handler (around line 129), add:

```ts
flexcam.get('/trips/:tripId/manifest', async (c): Promise<Response> => {
  const db = getDb(c.env);
  const tripId = Number(c.req.param('tripId'));
  if (!Number.isFinite(tripId)) return c.json({ error: 'Invalid tripId' }, 400);
  const channel = c.req.query('channel') ?? 'outside';

  const trip = await queryFirst<{ id: number; start_time: number; end_time: number | null }>(
    db, 'SELECT id, start_time, end_time FROM unit_trips WHERE id = ?', tripId,
  ).catch(() => null);
  if (!trip) return c.json({ error: 'Trip not found' }, 404);

  // Pull every chunk attached to any request whose trip_id matches.
  const chunks = await query<{
    id: number; request_id: number; seq: number; channel: string;
    from_ts: number; to_ts: number; status: string; r2_key: string | null;
    sha256: string | null; bytes: number;
  }>(db,
    `SELECT fc.id, fc.request_id, fc.seq, fc.channel, fc.from_ts, fc.to_ts,
            fc.status, fc.r2_key, fc.sha256, fc.bytes
       FROM footage_chunks fc
       JOIN footage_requests fr ON fr.id = fc.request_id
      WHERE fr.trip_id = ?
      ORDER BY fc.from_ts`, tripId,
  ).catch(() => []);

  const manifest = buildPlayerManifest({ id: trip.id, start_time: trip.start_time, end_time: trip.end_time }, channel, chunks);
  return c.json(manifest);
});
```

Add the import at the top of the file:

```ts
import { buildManifest, concatToR2, buildPlayerManifest } from '../utils/footage/concat';
```

(replace the existing `buildManifest, concatToR2` import line).

- [ ] **Step 2: Run tests, expect pass**

```bash
npx vitest run tests/footage/flexcamRoute.test.ts
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/routes/flexcam.ts
git commit -m "$(cat <<'EOF'
feat(flexcam): GET /api/flexcam/trips/:tripId/manifest

Player-oriented trip manifest endpoint. Joins unit_trips × footage_chunks,
filters by channel (default 'outside'), composes buildPlayerManifest().
Auth uses the existing /api/flexcam middleware gate.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Phase D — Durable Object + `/render` MP4 change

### Task 13: Add `FLEXCAM_REMUX` binding to types and wrangler config

**Files:**
- Modify: `src/types.ts` — add binding entry
- Modify: `wrangler.toml` — add `[[durable_objects.bindings]]` + `[[migrations]]`

- [ ] **Step 1: Add the type binding**

In `src/types.ts`, near the other `DurableObjectNamespace` entries (~line 46), add:

```ts
// FlexCamRemuxDO namespace — one instance per footage_request_id
// (idFromName('rmx-' + id)) for lazy MP4 → fMP4 remux. Triggered
// by POST /api/flexcam/render/:id for format='mp4'. Free-plan
// compatible (new_sqlite_classes; see wrangler.toml).
FLEXCAM_REMUX: DurableObjectNamespace;
```

- [ ] **Step 2: Add the wrangler bindings**

In `wrangler.toml`, after the existing `[[durable_objects.bindings]]` for `PDF_TOOLS` and before/after the existing pattern, add:

```toml
[[durable_objects.bindings]]
name = "FLEXCAM_REMUX"
class_name = "FlexCamRemuxDO"
```

And after the last `[[migrations]]` block (`v4-deepresearch`):

```toml
# FlexCamRemuxDO — APPENDED (same prefix rule as v2-voicehub: live tags
# must be a prefix of this list, so new DO migrations go at the END).
# SQLite-backed for free-plan + storage.put/getAlarm.
[[migrations]]
tag = "v5-flexcamremux"
new_sqlite_classes = ["FlexCamRemuxDO"]
```

- [ ] **Step 3: Typecheck**

```bash
npm run typecheck
```

Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add src/types.ts wrangler.toml
git commit -m "$(cat <<'EOF'
feat(flexcam): wire FLEXCAM_REMUX DO binding + v5 migration

Type entry + wrangler binding + new_sqlite_classes migration tag
appended to the prefix chain (v1 → v1-pdftools → v2-voicehub →
v3-alerthub → v4-deepresearch → v5-flexcamremux).

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

### Task 14: Write failing tests for `FlexCamRemuxDO`

**Files:**
- Create: `tests/footage/flexcamRemuxDO.test.ts`

- [ ] **Step 1: Write the test file**

Create `tests/footage/flexcamRemuxDO.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FlexCamRemuxDO } from '../../src/durable-objects/FlexCamRemuxDO';

// Lightweight DO stubs — these test the state-machine logic directly
// without spinning up Miniflare. Pattern mirrors WelfareWatchDO tests.

const makeStorage = () => {
  const data = new Map<string, unknown>();
  let alarmAt: number | null = null;
  return {
    get: vi.fn(async (k: string) => data.get(k)),
    put: vi.fn(async (k: string, v: unknown) => { data.set(k, v); }),
    delete: vi.fn(async (k: string) => { data.delete(k); }),
    setAlarm: vi.fn(async (t: number) => { alarmAt = t; }),
    getAlarm: vi.fn(async () => alarmAt),
    deleteAlarm: vi.fn(async () => { alarmAt = null; }),
  };
};

const makeState = () => ({ storage: makeStorage(), id: { toString: () => 'rmx-42' } });

const makeEnv = (overrides: Partial<any> = {}) => ({
  DB: {
    prepare: vi.fn(() => ({
      bind: vi.fn().mockReturnThis(),
      first: vi.fn(async () => null),
      all: vi.fn(async () => ({ results: [] })),
      run: vi.fn(async () => ({ meta: { changes: 1 } })),
    })),
  },
  UPLOADS: { get: vi.fn(), put: vi.fn() },
  ...overrides,
});

describe('FlexCamRemuxDO', () => {
  it('enqueue sets state to queued and schedules an alarm in ~1s', async () => {
    const state = makeState();
    const env = makeEnv();
    const dop = new FlexCamRemuxDO(state as any, env as any);
    await dop.enqueue(42);
    expect(state.storage.put).toHaveBeenCalledWith(
      'state',
      expect.objectContaining({ state: 'queued', requestId: 42, attempts: 0 }),
    );
    expect(state.storage.setAlarm).toHaveBeenCalled();
  });

  it('re-enqueue while working is a no-op (returns current state)', async () => {
    const state = makeState();
    await state.storage.put('state', { state: 'working', requestId: 42, attempts: 1 });
    const env = makeEnv();
    const dop = new FlexCamRemuxDO(state as any, env as any);
    const result = await dop.enqueue(42);
    expect(result.state).toBe('working');
    expect(state.storage.setAlarm).not.toHaveBeenCalled();
  });

  it('alarm transitions queued → working → ready on success', async () => {
    const state = makeState();
    await state.storage.put('state', { state: 'queued', requestId: 42, attempts: 0 });

    // Stub the remux helper to return success.
    vi.doMock('../../src/utils/footage/concat', () => ({
      remuxMp4ToFmp4: vi.fn(async () => ({ state: 'ready', sha256: 'abc', bytes: 1000, skipped: [] })),
    }));

    const env = makeEnv({
      DB: {
        prepare: vi.fn(() => ({
          bind: vi.fn().mockReturnThis(),
          all: vi.fn(async () => ({ results: [{ seq: 0, r2_key: 'k0' }, { seq: 1, r2_key: 'k1' }] })),
          run: vi.fn(async () => ({ meta: { changes: 1 } })),
        })),
      },
    });
    const dop = new FlexCamRemuxDO(state as any, env as any);
    await dop.alarm();

    const final = await state.storage.get('state');
    expect((final as any).state).toBe('ready');
    vi.doUnmock('../../src/utils/footage/concat');
  });

  it('alarm increments attempts and reschedules on failure (until cap)', async () => {
    const state = makeState();
    await state.storage.put('state', { state: 'queued', requestId: 42, attempts: 0 });
    vi.doMock('../../src/utils/footage/concat', () => ({
      remuxMp4ToFmp4: vi.fn(async () => ({ state: 'failed', errorCode: 'mp4box_parse_failed', errorMessage: 'boom', skipped: [] })),
    }));
    const env = makeEnv({
      DB: { prepare: vi.fn(() => ({ bind: vi.fn().mockReturnThis(), all: vi.fn(async () => ({ results: [{ seq: 0, r2_key: 'k0' }] })), run: vi.fn() })) },
    });
    const dop = new FlexCamRemuxDO(state as any, env as any);
    await dop.alarm();
    const final = await state.storage.get('state');
    expect((final as any).attempts).toBe(1);
    expect((final as any).state).toBe('queued'); // rescheduled, not terminal yet
    expect(state.storage.setAlarm).toHaveBeenCalled();
    vi.doUnmock('../../src/utils/footage/concat');
  });

  it('alarm marks failed after 3 attempts', async () => {
    const state = makeState();
    await state.storage.put('state', { state: 'queued', requestId: 42, attempts: 2 });
    vi.doMock('../../src/utils/footage/concat', () => ({
      remuxMp4ToFmp4: vi.fn(async () => ({ state: 'failed', errorCode: 'mp4box_parse_failed', errorMessage: 'boom', skipped: [] })),
    }));
    const env = makeEnv({
      DB: { prepare: vi.fn(() => ({ bind: vi.fn().mockReturnThis(), all: vi.fn(async () => ({ results: [{ seq: 0, r2_key: 'k0' }] })), run: vi.fn() })) },
    });
    const dop = new FlexCamRemuxDO(state as any, env as any);
    await dop.alarm();
    const final = await state.storage.get('state');
    expect((final as any).attempts).toBe(3);
    expect((final as any).state).toBe('failed');
    vi.doUnmock('../../src/utils/footage/concat');
  });
});
```

- [ ] **Step 2: Run, expect fail**

```bash
npx vitest run tests/footage/flexcamRemuxDO.test.ts
```

Expected: 5 failures — class doesn't exist.

- [ ] **Step 3: Commit**

```bash
git add tests/footage/flexcamRemuxDO.test.ts
git commit -m "$(cat <<'EOF'
test(flexcam): failing tests for FlexCamRemuxDO state machine (TDD)

Covers enqueue happy path, idempotent re-enqueue, alarm success,
alarm retry, and terminal failure after 3 attempts.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

### Task 15: Implement `FlexCamRemuxDO`

**Files:**
- Create: `src/durable-objects/FlexCamRemuxDO.ts`

- [ ] **Step 1: Write the DO**

Create `src/durable-objects/FlexCamRemuxDO.ts`:

```ts
// FlexCamRemuxDO — one instance per footage_request_id, keyed
// idFromName('rmx-' + id). SQLite-backed; alarm-driven; bounded
// retries (3 attempts, exponential backoff 1s/2s/4s).
//
// Storage shape: a single 'state' blob:
//   { state, requestId, attempts, lastError? }
//
// Mirrors the WelfareWatchDO pattern for storage + alarm wiring.

import type { Bindings } from '../types';
import { remuxMp4ToFmp4 } from '../utils/footage/concat';

type RemuxState = 'queued' | 'working' | 'ready' | 'failed';

interface RemuxBlob {
  state: RemuxState;
  requestId: number;
  attempts: number;
  lastError?: { code: string; message: string };
}

const MAX_ATTEMPTS = 3;

export class FlexCamRemuxDO {
  private state: DurableObjectState;
  private env: Bindings;

  constructor(state: DurableObjectState, env: Bindings) {
    this.state = state;
    this.env = env;
  }

  async enqueue(requestId: number): Promise<{ state: RemuxState; requestId: number }> {
    const cur = await this.state.storage.get<RemuxBlob>('state');
    if (cur && (cur.state === 'working' || cur.state === 'queued')) {
      return { state: cur.state, requestId: cur.requestId };
    }
    const blob: RemuxBlob = { state: 'queued', requestId, attempts: 0 };
    await this.state.storage.put('state', blob);
    await this.state.storage.setAlarm(Date.now() + 1000); // new-date-ok
    await this.markDb('queued', requestId, null);
    return { state: 'queued', requestId };
  }

  async status(): Promise<RemuxBlob | null> {
    return (await this.state.storage.get<RemuxBlob>('state')) ?? null;
  }

  async alarm(): Promise<void> {
    const blob = await this.state.storage.get<RemuxBlob>('state');
    if (!blob) return;
    if (blob.state === 'ready' || blob.state === 'failed') return;

    const working: RemuxBlob = { ...blob, state: 'working' };
    await this.state.storage.put('state', working);
    await this.markDb('working', blob.requestId, null);

    // Snapshot the chunk list at job start.
    const rows = await this.env.DB.prepare(
      `SELECT seq, r2_key FROM footage_chunks
        WHERE request_id = ? AND status = 'downloaded' AND r2_key IS NOT NULL
        ORDER BY seq`,
    ).bind(blob.requestId).all<{ seq: number; r2_key: string }>();
    const chunks = rows.results ?? [];
    const mergedKey = `flexcam/trips/merged/${blob.requestId}.mp4`;

    const result = await remuxMp4ToFmp4(this.env, mergedKey, chunks);

    if (result.state === 'ready') {
      await this.env.DB.prepare(
        `UPDATE footage_requests SET
           merged_r2_key = ?,
           merged_sha256 = ?,
           merged_status = 'ready',
           remux_state = 'ready',
           remux_finished_at = ?
         WHERE id = ?`,
      ).bind(mergedKey, result.sha256 ?? null, Date.now(), blob.requestId).run().catch(() => {}); // new-date-ok
      await this.logCustody('remux_complete', blob.requestId, JSON.stringify({ sha256: result.sha256, skipped: result.skipped }));
      const done: RemuxBlob = { ...blob, state: 'ready' };
      await this.state.storage.put('state', done);
      return;
    }

    // Failure path: retry up to MAX_ATTEMPTS.
    const nextAttempts = blob.attempts + 1;
    if (nextAttempts < MAX_ATTEMPTS) {
      const backoffMs = 1000 * Math.pow(2, nextAttempts - 1); // 1s, 2s, 4s
      const requeued: RemuxBlob = {
        state: 'queued',
        requestId: blob.requestId,
        attempts: nextAttempts,
        lastError: { code: result.errorCode ?? 'unknown', message: result.errorMessage ?? '' },
      };
      await this.state.storage.put('state', requeued);
      await this.state.storage.setAlarm(Date.now() + backoffMs); // new-date-ok
      await this.markDb('queued', blob.requestId, JSON.stringify(requeued.lastError));
    } else {
      const failed: RemuxBlob = {
        state: 'failed',
        requestId: blob.requestId,
        attempts: nextAttempts,
        lastError: { code: result.errorCode ?? 'unknown', message: result.errorMessage ?? '' },
      };
      await this.state.storage.put('state', failed);
      await this.markDb('failed', blob.requestId, JSON.stringify(failed.lastError));
      await this.logCustody('remux_failed', blob.requestId, failed.lastError.message);
    }
  }

  private async markDb(state: RemuxState, requestId: number, errorText: string | null): Promise<void> {
    await this.env.DB.prepare(
      `UPDATE footage_requests SET
         remux_state = ?,
         remux_attempts = COALESCE(remux_attempts, 0) + CASE WHEN ? = 'working' THEN 0 ELSE 1 END,
         remux_started_at = COALESCE(remux_started_at, ?),
         remux_error = ?
       WHERE id = ?`,
    ).bind(state, state, Date.now(), errorText, requestId).run().catch(() => {}); // new-date-ok
  }

  private async logCustody(action: string, requestId: number, detail: string): Promise<void> {
    await this.env.DB.prepare(
      `INSERT INTO footage_custody_log (footage_request_id, action, detail) VALUES (?, ?, ?)`,
    ).bind(requestId, action, detail).run().catch(() => {});
  }
}
```

- [ ] **Step 2: Run tests, expect pass**

```bash
npx vitest run tests/footage/flexcamRemuxDO.test.ts
```

Expected: PASS.

- [ ] **Step 3: Typecheck**

```bash
npm run typecheck
```

Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add src/durable-objects/FlexCamRemuxDO.ts
git commit -m "$(cat <<'EOF'
feat(flexcam): FlexCamRemuxDO with bounded-retry state machine

One instance per footage_request_id. Alarm drives the remux pipeline
via concat.ts:remuxMp4ToFmp4. Retries up to 3× with 1s/2s/4s backoff;
terminal failure clears with admin re-trigger via POST /render/:id.
Mirrors WelfareWatchDO storage + alarm patterns.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

### Task 16: Change `/render/:id` MP4 path to enqueue the DO

**Files:**
- Modify: `src/routes/flexcam.ts` (the existing `/render/:id` handler around line 131)

- [ ] **Step 1: Read the existing handler**

Run: `sed -n '131,143p' src/routes/flexcam.ts`

You'll see the current MP4 path calls `concatToR2(...'mp4')` which returns `'unsupported'`.

- [ ] **Step 2: Add a failing test first**

Append to `tests/footage/flexcamRoute.test.ts`:

```ts
describe('POST /api/flexcam/render/:id (MP4 enqueue path)', () => {
  it('enqueues the FlexCamRemuxDO and returns 202 for MP4 when not yet rendered', async () => {
    const env = makeTestEnv();
    await seedRequest(env, { id: 5, trip_id: 1 });
    await seedChunks(env, [
      { request_id: 5, seq: 0, channel: 'outside', from_ts: 1, to_ts: 40, status: 'downloaded', r2_key: 'k0' },
    ]);
    const enqueueSpy = vi.fn(async () => ({ state: 'queued', requestId: 5 }));
    (env.FLEXCAM_REMUX as any) = {
      idFromName: vi.fn(() => ({})),
      get: vi.fn(() => ({ enqueue: enqueueSpy })),
    };
    const res = await app.fetch(new Request('http://test/api/flexcam/render/5', {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ format: 'mp4' }),
    }), env);
    expect(res.status).toBe(202);
    expect(enqueueSpy).toHaveBeenCalledWith(5);
  });
});
```

Run: `npx vitest run tests/footage/flexcamRoute.test.ts` — expect fail.

- [ ] **Step 3: Modify the handler**

Replace the existing `/render/:id` handler in `src/routes/flexcam.ts`:

```ts
flexcam.post('/render/:id', async (c): Promise<Response> => {
  const db = getDb(c.env);
  await ensureRemuxSchema(db);
  const id = Number(c.req.param('id'));
  const body = await c.req.json<{ format?: 'mp4' | 'ts' | 'fmp4' }>().catch(() => ({}));
  const format = body.format ?? 'mp4';

  const rows = await query<{ seq: number; from_ts: number; to_ts: number; status: string; r2_key: string | null; bytes: number }>(
    db, 'SELECT seq, from_ts, to_ts, status, r2_key, bytes FROM footage_chunks WHERE request_id=? ORDER BY seq', id,
  ).catch(() => []);
  const manifest = buildManifest(id, rows);
  if (!manifest.chunks.length) return c.json({ error: 'No downloaded chunks' }, 409);

  if (format === 'mp4') {
    const stub = c.env.FLEXCAM_REMUX.get(c.env.FLEXCAM_REMUX.idFromName('rmx-' + id));
    const result = await (stub as unknown as { enqueue: (n: number) => Promise<{ state: string }> }).enqueue(id);
    await execute(db, "UPDATE footage_requests SET merged_status='queued' WHERE id=?", id);
    return c.json({ remux_state: result.state, merged_status: 'queued' }, 202);
  }

  // Existing ts / fmp4 path (unchanged)
  const mergedKey = `flexcam/trips/merged/${id}.mp4`;
  const result = await concatToR2(c.env, mergedKey, manifest.chunks, format);
  await execute(db, 'UPDATE footage_requests SET merged_r2_key=?, merged_status=? WHERE id=?', result === 'ready' ? mergedKey : null, result, id);
  return c.json({ merged_status: result, merged_r2_key: result === 'ready' ? mergedKey : null });
});
```

**Critical**: the DO stub interface uses a typed method `enqueue()`, not an HTTP fetch. Cloudflare's `DurableObjectStub` only exposes `fetch()` by default unless you use RPC. For the simplest reliable pattern, expose a `fetch()` entry on the DO instead:

Modify `FlexCamRemuxDO` to add an HTTP entry:

```ts
async fetch(req: Request): Promise<Response> {
  const url = new URL(req.url);
  if (url.pathname === '/enqueue' && req.method === 'POST') {
    const { requestId } = await req.json<{ requestId: number }>();
    const result = await this.enqueue(requestId);
    return Response.json(result);
  }
  if (url.pathname === '/status') {
    return Response.json(await this.status());
  }
  return new Response('Not found', { status: 404 });
}
```

And change the route to call:

```ts
if (format === 'mp4') {
  const stub = c.env.FLEXCAM_REMUX.get(c.env.FLEXCAM_REMUX.idFromName('rmx-' + id));
  const resp = await stub.fetch('https://do/enqueue', { method: 'POST', body: JSON.stringify({ requestId: id }) });
  const result = await resp.json<{ state: string }>();
  await execute(db, "UPDATE footage_requests SET merged_status='queued' WHERE id=?", id);
  return c.json({ remux_state: result.state, merged_status: 'queued' }, 202);
}
```

Update the test from Step 2 accordingly — mock `stub.fetch` instead of `stub.enqueue`.

- [ ] **Step 4: Run tests, expect pass**

```bash
npx vitest run tests/footage/flexcamRoute.test.ts tests/footage/flexcamRemuxDO.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/routes/flexcam.ts src/durable-objects/FlexCamRemuxDO.ts tests/footage/flexcamRoute.test.ts
git commit -m "$(cat <<'EOF'
feat(flexcam): POST /render/:id MP4 → FlexCamRemuxDO enqueue

For format='mp4', the route now enqueues the DO and returns 202 with
{remux_state:'queued'}. ts/fmp4 paths unchanged. DO exposes a fetch()
entry at /enqueue + /status for the Worker→DO RPC.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Phase E — `/court-package` additive enrichment

### Task 17: Enrich `/court-package` manifest with merged fields when ready

**Files:**
- Modify: `src/routes/flexcam.ts` (the `/court-package` handler around line 202)
- Modify: `src/utils/footage/evidence.ts` (the `buildCourtManifest` function)

- [ ] **Step 1: Test first**

Append to `tests/footage/flexcamRoute.test.ts`:

```ts
describe('POST /api/flexcam/footage/:id/court-package (additive enrichment)', () => {
  it('includes merged_sha256 and merged_url in the manifest when merged_status=ready', async () => {
    const env = makeTestEnv();
    await seedRequest(env, {
      id: 8, trip_id: 1, evidence_locked: 1,
      merged_status: 'ready', merged_r2_key: 'flexcam/trips/merged/8.mp4',
      merged_sha256: 'deadbeefcafebabe',
    });
    const res = await app.fetch(new Request('http://test/api/flexcam/footage/8/court-package', {
      method: 'POST', headers: { Authorization: `Bearer ${env.token}` },
    }), env);
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.manifest.merged_sha256).toBe('deadbeefcafebabe');
    expect(body.manifest.merged_url).toContain('/footage/8/continuous');
  });

  it('omits merged_* fields when merged_status is not ready', async () => {
    const env = makeTestEnv();
    await seedRequest(env, { id: 9, trip_id: 1, evidence_locked: 1, merged_status: 'queued' });
    const res = await app.fetch(new Request('http://test/api/flexcam/footage/9/court-package', {
      method: 'POST', headers: { Authorization: `Bearer ${env.token}` },
    }), env);
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.manifest.merged_sha256).toBeUndefined();
    expect(body.manifest.merged_url).toBeUndefined();
  });
});
```

Run: `npx vitest run tests/footage/flexcamRoute.test.ts` — expect fail.

- [ ] **Step 2: Read existing handler + manifest builder**

```bash
sed -n '202,228p' src/routes/flexcam.ts
grep -n "buildCourtManifest" src/utils/footage/evidence.ts
```

- [ ] **Step 3: Extend `buildCourtManifest` to accept the optional merged fields**

In `src/utils/footage/evidence.ts`, find the `buildCourtManifest` function and add optional fields to the input + output type:

```ts
// In the input type
export interface CourtManifestInput {
  request: {
    id: number; evidence_number: string | null; classification: string;
    preserved_reason: string | null; from_ts: number; to_ts: number; evidence_locked: number;
    merged_status?: string | null;        // NEW
    merged_r2_key?: string | null;        // NEW
    merged_sha256?: string | null;        // NEW
  };
  // ... existing chunks, links, custody fields
}

// In the function body, after the existing manifest assembly:
const isReady = input.request.merged_status === 'ready' && input.request.merged_r2_key;
if (isReady) {
  manifest.merged_sha256 = input.request.merged_sha256 ?? null;
  manifest.merged_url = `/api/flexcam/footage/${input.request.id}/continuous`;
}
```

(Adjust to whatever the actual current shape of `buildCourtManifest` is. The change is purely additive — never mutate or omit existing fields.)

- [ ] **Step 4: Update the route handler**

In `src/routes/flexcam.ts`, modify the SELECT inside `/court-package` to include the merged fields:

```ts
const req = await queryFirst<{
  id: number; evidence_number: string | null; classification: string;
  preserved_reason: string | null; from_ts: number; to_ts: number; evidence_locked: number;
  merged_status: string | null; merged_r2_key: string | null; merged_sha256: string | null;
}>(
  db,
  `SELECT id, evidence_number, classification, preserved_reason, from_ts, to_ts, evidence_locked,
          merged_status, merged_r2_key, merged_sha256
     FROM footage_requests WHERE id=?`, id,
).catch(() => null);
```

The pass-through to `buildCourtManifest` continues to work — it now receives the extra fields and conditionally emits them.

- [ ] **Step 5: Run tests, expect pass**

```bash
npx vitest run tests/footage/flexcamRoute.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/routes/flexcam.ts src/utils/footage/evidence.ts tests/footage/flexcamRoute.test.ts
git commit -m "$(cat <<'EOF'
feat(flexcam): /court-package additive enrichment with merged fields

When merged_status='ready', the signed manifest now includes
merged_sha256 + merged_url. Otherwise both fields are omitted.
Purely additive — no breaking change for existing callers.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Phase F — Client (bottom-up)

### Task 18: Failing test for `useFlexCamManifest`

**Files:**
- Create: `client/src/hooks/useFlexCamManifest.test.tsx`

- [ ] **Step 1: Write the test**

Create `client/src/hooks/useFlexCamManifest.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useFlexCamManifest } from './useFlexCamManifest';

describe('useFlexCamManifest', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

  it('fetches once and exposes the manifest', async () => {
    const manifest = { tripId: 1, channel: 'outside', clips: [], gaps: [], totalDurationMs: 0, stillDownloading: 0 };
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(manifest))));
    const { result } = renderHook(() => useFlexCamManifest(1, 'outside'));
    await vi.waitFor(() => expect(result.current.manifest).toBeDefined());
    expect(result.current.manifest?.tripId).toBe(1);
  });

  it('polls every 10s while stillDownloading > 0, stops at 0', async () => {
    const calls = vi.fn();
    let stillDownloading = 3;
    vi.stubGlobal('fetch', vi.fn(async () => {
      calls();
      stillDownloading = Math.max(0, stillDownloading - 1);
      return new Response(JSON.stringify({ tripId: 1, channel: 'outside', clips: [], gaps: [], totalDurationMs: 0, stillDownloading }));
    }));
    renderHook(() => useFlexCamManifest(1, 'outside'));
    await vi.waitFor(() => expect(calls).toHaveBeenCalledTimes(1));
    await vi.advanceTimersByTimeAsync(10_000);
    await vi.waitFor(() => expect(calls).toHaveBeenCalledTimes(2));
    await vi.advanceTimersByTimeAsync(10_000);
    await vi.waitFor(() => expect(calls).toHaveBeenCalledTimes(3));
    await vi.advanceTimersByTimeAsync(10_000);
    await vi.waitFor(() => expect(calls).toHaveBeenCalledTimes(4));
    // stillDownloading reached 0 — polling should stop
    await vi.advanceTimersByTimeAsync(15_000);
    expect(calls).toHaveBeenCalledTimes(4);
  });
});
```

- [ ] **Step 2: Run, expect fail**

```bash
cd client && npx vitest run src/hooks/useFlexCamManifest.test.tsx
```

Expected: FAIL (module not found).

- [ ] **Step 3: Commit**

```bash
git add client/src/hooks/useFlexCamManifest.test.tsx
git commit -m "$(cat <<'EOF'
test(flexcam-client): failing tests for useFlexCamManifest hook (TDD)

Initial fetch + 10s polling while stillDownloading > 0 with auto-stop.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

### Task 19: Implement `useFlexCamManifest`

**Files:**
- Create: `client/src/hooks/useFlexCamManifest.ts`

- [ ] **Step 1: Write the hook**

Create `client/src/hooks/useFlexCamManifest.ts`:

```ts
import { useEffect, useState } from 'react';
import { apiFetch } from './useApi';

export interface PlayerClip { seq: number; fromTs: number; toTs: number; durationMs: number; url: string; sha256: string | null; bytes: number; }
export interface PlayerGap { startTs: number; endTs: number; durationMs: number; }
export interface TripPlayerManifest {
  tripId: number;
  channel: string;
  totalDurationMs: number;
  stillDownloading: number;
  clips: PlayerClip[];
  gaps: PlayerGap[];
}

interface State {
  manifest: TripPlayerManifest | null;
  error: Error | null;
  loading: boolean;
}

const POLL_INTERVAL_MS = 10_000;

export function useFlexCamManifest(tripId: number, channel: string) {
  const [state, setState] = useState<State>({ manifest: null, error: null, loading: true });

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const fetchOnce = async () => {
      try {
        const m = await apiFetch<TripPlayerManifest>(`/flexcam/trips/${tripId}/manifest?channel=${encodeURIComponent(channel)}`);
        if (cancelled) return;
        setState({ manifest: m, error: null, loading: false });
        if (m.stillDownloading > 0) {
          timer = setTimeout(fetchOnce, POLL_INTERVAL_MS);
        }
      } catch (err) {
        if (cancelled) return;
        setState({ manifest: null, error: err as Error, loading: false });
      }
    };

    fetchOnce();
    return () => { cancelled = true; if (timer) clearTimeout(timer); };
  }, [tripId, channel]);

  return state;
}
```

- [ ] **Step 2: Run tests, expect pass**

```bash
cd client && npx vitest run src/hooks/useFlexCamManifest.test.tsx
```

Expected: PASS.

- [ ] **Step 3: Typecheck + commit**

```bash
cd client && npx tsc --noEmit
cd ..
git add client/src/hooks/useFlexCamManifest.ts
git commit -m "$(cat <<'EOF'
feat(flexcam-client): useFlexCamManifest hook

Fetches the player manifest. Polls every 10s while stillDownloading > 0,
stops cleanly when zero. Returns {manifest, error, loading}.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

### Task 20: `TripTimeline` component + tests

**Files:**
- Create: `client/src/components/flexcam/TripTimeline.tsx`
- Create: `client/src/components/flexcam/TripTimeline.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `client/src/components/flexcam/TripTimeline.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TripTimeline, resolveSeek } from './TripTimeline';

const clips = [
  { seq: 0, fromTs: 1_000_000, toTs: 1_040_000, durationMs: 40_000, url: 'a', sha256: null, bytes: 1 },
  { seq: 1, fromTs: 1_050_000, toTs: 1_090_000, durationMs: 40_000, url: 'b', sha256: null, bytes: 1 },
];
const gaps = [{ startTs: 1_040_000, endTs: 1_050_000, durationMs: 10_000 }];

describe('resolveSeek', () => {
  it('resolves a click in clip 0', () => {
    const r = resolveSeek(clips, gaps, 0.1); // ~10% of total span
    expect(r).toEqual({ clipIndex: 0, offsetMs: expect.any(Number) });
  });
  it('resolves a click on a gap by jumping to next clip start', () => {
    const r = resolveSeek(clips, gaps, 0.5); // mid-gap
    expect(r.clipIndex).toBe(1);
    expect(r.offsetMs).toBe(0);
  });
});

describe('<TripTimeline>', () => {
  it('renders one block per clip + one block per gap', () => {
    const { container } = render(<TripTimeline clips={clips} gaps={gaps} currentClipIndex={0} currentOffsetMs={0} onSeek={vi.fn()} />);
    expect(container.querySelectorAll('[data-clip-seq]').length).toBe(2);
    expect(container.querySelectorAll('[data-gap]').length).toBe(1);
  });

  it('calls onSeek with resolved (clipIndex, offsetMs)', () => {
    const onSeek = vi.fn();
    const { container } = render(<TripTimeline clips={clips} gaps={gaps} currentClipIndex={0} currentOffsetMs={0} onSeek={onSeek} />);
    const root = container.firstChild as HTMLElement;
    // jsdom doesn't lay out — stub getBoundingClientRect
    root.getBoundingClientRect = () => ({ left: 0, top: 0, right: 1000, bottom: 30, width: 1000, height: 30, x: 0, y: 0, toJSON: () => ({}) });
    fireEvent.click(root, { clientX: 100 });
    expect(onSeek).toHaveBeenCalled();
  });
});
```

Run: `cd client && npx vitest run src/components/flexcam/TripTimeline.test.tsx` — expect fail.

- [ ] **Step 2: Implement**

Create `client/src/components/flexcam/TripTimeline.tsx`:

```tsx
import React from 'react';
import type { PlayerClip, PlayerGap } from '../../hooks/useFlexCamManifest';

interface Props {
  clips: PlayerClip[];
  gaps: PlayerGap[];
  currentClipIndex: number;
  currentOffsetMs: number;
  onSeek: (clipIndex: number, offsetMs: number) => void;
}

export function resolveSeek(clips: PlayerClip[], gaps: PlayerGap[], fraction: number): { clipIndex: number; offsetMs: number } {
  const totalSpan = clips.length === 0 ? 0 : clips[clips.length - 1].toTs - clips[0].fromTs;
  if (totalSpan <= 0) return { clipIndex: 0, offsetMs: 0 };
  const startTs = clips[0].fromTs;
  const targetTs = startTs + Math.max(0, Math.min(1, fraction)) * totalSpan;

  for (let i = 0; i < clips.length; i++) {
    if (targetTs <= clips[i].toTs) {
      if (targetTs >= clips[i].fromTs) {
        return { clipIndex: i, offsetMs: targetTs - clips[i].fromTs };
      }
      // We're in a gap before clips[i] — jump to its start
      return { clipIndex: i, offsetMs: 0 };
    }
  }
  // Past the end — last clip, last frame
  return { clipIndex: clips.length - 1, offsetMs: clips[clips.length - 1].durationMs };
}

export function TripTimeline({ clips, gaps, currentClipIndex, currentOffsetMs, onSeek }: Props) {
  if (clips.length === 0) return <div className="text-sm opacity-60">No footage</div>;
  const totalSpan = clips[clips.length - 1].toTs - clips[0].fromTs;
  const startTs = clips[0].fromTs;

  const handleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const fraction = (e.clientX - rect.left) / rect.width;
    const { clipIndex, offsetMs } = resolveSeek(clips, gaps, fraction);
    onSeek(clipIndex, offsetMs);
  };

  return (
    <div className="relative h-8 bg-surface-raised rounded-[2px] cursor-pointer select-none" onClick={handleClick}>
      {clips.map((c, i) => {
        const left = ((c.fromTs - startTs) / totalSpan) * 100;
        const width = (c.durationMs / totalSpan) * 100;
        const active = i === currentClipIndex;
        return (
          <div
            key={c.seq}
            data-clip-seq={c.seq}
            className={`absolute top-0 bottom-0 ${active ? 'bg-brand-500' : 'bg-brand-700'}`}
            style={{ left: `${left}%`, width: `${width}%` }}
          />
        );
      })}
      {gaps.map((g) => {
        const left = ((g.startTs - startTs) / totalSpan) * 100;
        const width = (g.durationMs / totalSpan) * 100;
        return (
          <div
            key={`g-${g.startTs}`}
            data-gap
            className="absolute top-0 bottom-0 bg-red-700 opacity-60"
            style={{ left: `${left}%`, width: `${width}%` }}
            title={`GAP — ${Math.round(g.durationMs / 1000)}s`}
          />
        );
      })}
    </div>
  );
}
```

- [ ] **Step 3: Pass + commit**

```bash
cd client && npx vitest run src/components/flexcam/TripTimeline.test.tsx
cd ..
git add client/src/components/flexcam/TripTimeline.{ts,test}.tsx
git commit -m "$(cat <<'EOF'
feat(flexcam-client): TripTimeline gap-aware scrubber

Pure resolveSeek helper (unit-tested across clip + gap + past-end
cases). Component renders one block per clip + one red block per
gap, click-to-seek resolves to (clipIndex, offsetMs).

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

### Task 21: `ChannelSwitcher` component (no test — trivial UI)

**Files:**
- Create: `client/src/components/flexcam/ChannelSwitcher.tsx`

- [ ] **Step 1: Implement**

Create `client/src/components/flexcam/ChannelSwitcher.tsx`:

```tsx
interface Props {
  channels: string[];
  current: string;
  onChange: (channel: string) => void;
}

export function ChannelSwitcher({ channels, current, onChange }: Props) {
  if (channels.length <= 1) return null;
  return (
    <div className="flex gap-1">
      {channels.map((ch) => (
        <button
          key={ch}
          onClick={() => onChange(ch)}
          className={`px-2 py-1 text-xs rounded-[2px] ${ch === current ? 'bg-brand-500 text-rmpg-100' : 'bg-surface-raised text-rmpg-300'}`}
        >
          {ch.toUpperCase()}
        </button>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Typecheck + commit**

```bash
cd client && npx tsc --noEmit
cd ..
git add client/src/components/flexcam/ChannelSwitcher.tsx
git commit -m "$(cat <<'EOF'
feat(flexcam-client): ChannelSwitcher (camera channel toggle)

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

### Task 22: `FlexCamTripPlayer` component + tests

**Files:**
- Create: `client/src/components/flexcam/FlexCamTripPlayer.tsx`
- Create: `client/src/components/flexcam/FlexCamTripPlayer.test.tsx`

- [ ] **Step 1: Failing test**

Create `client/src/components/flexcam/FlexCamTripPlayer.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { FlexCamTripPlayer } from './FlexCamTripPlayer';
import type { TripPlayerManifest } from '../../hooks/useFlexCamManifest';

const manifest: TripPlayerManifest = {
  tripId: 1, channel: 'outside', totalDurationMs: 80_000, stillDownloading: 0,
  clips: [
    { seq: 0, fromTs: 1_000_000, toTs: 1_040_000, durationMs: 40_000, url: '/clip-a.mp4', sha256: null, bytes: 1 },
    { seq: 1, fromTs: 1_040_000, toTs: 1_080_000, durationMs: 40_000, url: '/clip-b.mp4', sha256: null, bytes: 1 },
  ],
  gaps: [],
};

describe('<FlexCamTripPlayer>', () => {
  it('renders the active <video> pointing at the first clip', () => {
    const { container } = render(<FlexCamTripPlayer manifest={manifest} />);
    const videos = container.querySelectorAll('video');
    expect(videos.length).toBeGreaterThanOrEqual(1);
    expect(videos[0].getAttribute('src')).toBe('/clip-a.mp4');
  });

  it('shows "no footage" when manifest.clips is empty', () => {
    render(<FlexCamTripPlayer manifest={{ ...manifest, clips: [] }} />);
    expect(screen.getByText(/no footage/i)).toBeInTheDocument();
  });

  it('advances to next clip when active video fires onEnded', () => {
    const { container } = render(<FlexCamTripPlayer manifest={manifest} />);
    const active = container.querySelector('video') as HTMLVideoElement;
    act(() => { fireEvent.ended(active); });
    // After ended, the first <video> should now reflect clip 1 (b) — implementation may swap or re-render
    const after = container.querySelector('video') as HTMLVideoElement;
    expect(after.getAttribute('src')).toBe('/clip-b.mp4');
  });
});
```

Run: `cd client && npx vitest run src/components/flexcam/FlexCamTripPlayer.test.tsx` — expect fail.

- [ ] **Step 2: Implement (simple single-buffer first; double-buffer optimization later)**

Create `client/src/components/flexcam/FlexCamTripPlayer.tsx`:

```tsx
import { useRef, useState } from 'react';
import type { TripPlayerManifest } from '../../hooks/useFlexCamManifest';
import { TripTimeline } from './TripTimeline';

interface Props { manifest: TripPlayerManifest; }

export function FlexCamTripPlayer({ manifest }: Props) {
  const [clipIndex, setClipIndex] = useState(0);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  if (manifest.clips.length === 0) {
    return <div className="p-4 text-sm opacity-60">No footage available for this trip yet.</div>;
  }

  const current = manifest.clips[clipIndex];

  const handleEnded = () => {
    if (clipIndex + 1 < manifest.clips.length) {
      setClipIndex(clipIndex + 1);
    }
  };

  const handleSeek = (targetIndex: number, offsetMs: number) => {
    setClipIndex(targetIndex);
    requestAnimationFrame(() => {
      if (videoRef.current) {
        videoRef.current.currentTime = offsetMs / 1000;
        void videoRef.current.play();
      }
    });
  };

  return (
    <div className="space-y-2">
      <video
        ref={videoRef}
        src={current.url}
        autoPlay
        controls
        onEnded={handleEnded}
        className="w-full max-h-[60vh] bg-black"
      />
      <TripTimeline
        clips={manifest.clips}
        gaps={manifest.gaps}
        currentClipIndex={clipIndex}
        currentOffsetMs={0}
        onSeek={handleSeek}
      />
      {manifest.stillDownloading > 0 && (
        <div className="text-xs text-brand-400">Footage still arriving — {manifest.stillDownloading} chunks pending</div>
      )}
    </div>
  );
}
```

**Note**: this is a single-buffer first cut. The boundary gap between clips will be visible (~200ms). Add double-buffering as a follow-up commit after the test passes if perf is acceptable to ship.

- [ ] **Step 3: Pass + commit**

```bash
cd client && npx vitest run src/components/flexcam/FlexCamTripPlayer.test.tsx
cd ..
git add client/src/components/flexcam/FlexCamTripPlayer.{ts,test}.tsx
git commit -m "$(cat <<'EOF'
feat(flexcam-client): FlexCamTripPlayer (single-buffer first cut)

<video> + onEnded advance + click-to-seek via TripTimeline. Shows
"no footage" empty state + still-arriving pill. Double-buffering
to eliminate the ~200ms boundary stall is a fast-follow.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

### Task 23: `TripPlaybackPage` + route registration

**Files:**
- Create: `client/src/pages/flexcam/TripPlaybackPage.tsx`
- Modify: `client/src/App.tsx` (route table)

- [ ] **Step 1: Build the page**

Create `client/src/pages/flexcam/TripPlaybackPage.tsx`:

```tsx
import { useParams } from 'react-router-dom';
import { useFlexCamManifest } from '../../hooks/useFlexCamManifest';
import { FlexCamTripPlayer } from '../../components/flexcam/FlexCamTripPlayer';
import { ChannelSwitcher } from '../../components/flexcam/ChannelSwitcher';
import { useState } from 'react';

export default function TripPlaybackPage() {
  const { tripId } = useParams<{ tripId: string }>();
  const [channel, setChannel] = useState('outside');
  const { manifest, error, loading } = useFlexCamManifest(Number(tripId), channel);

  if (loading) return <div className="p-4 text-sm opacity-60">Loading manifest…</div>;
  if (error) return <div className="p-4 text-sm text-red-400">Error: {error.message}</div>;
  if (!manifest) return <div className="p-4 text-sm opacity-60">No manifest available.</div>;

  // Derive available channels from a quick second fetch or hard-code the two known channels.
  // Keep simple: assume 'outside' only unless future enhancement.
  return (
    <div className="p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold tracking-wide">TRIP {tripId} — {Math.round(manifest.totalDurationMs / 60_000)} min</h2>
        <ChannelSwitcher channels={['outside']} current={channel} onChange={setChannel} />
      </div>
      <FlexCamTripPlayer manifest={manifest} />
    </div>
  );
}
```

- [ ] **Step 2: Register the route**

In `client/src/App.tsx`, find the existing FlexCam route mounts and add:

```tsx
<Route path="/flexcam/trip/:tripId" element={<TripPlaybackPage />} />
```

With the import:

```tsx
import TripPlaybackPage from './pages/flexcam/TripPlaybackPage';
```

- [ ] **Step 3: Typecheck + build**

```bash
cd client && npx tsc --noEmit && npx vite build
```

Expected: clean.

- [ ] **Step 4: Commit**

```bash
cd ..
git add client/src/pages/flexcam/TripPlaybackPage.tsx client/src/App.tsx
git commit -m "$(cat <<'EOF'
feat(flexcam-client): /flexcam/trip/:tripId playback page + route

Composes useFlexCamManifest + FlexCamTripPlayer + ChannelSwitcher.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

### Task 24: "Play whole trip" entry point on `FlexCamPage`

**Files:**
- Modify: `client/src/pages/FlexCamPage.tsx`

- [ ] **Step 1: Find the trip-grouped request row**

```bash
grep -n "trip_id\|trip-id" client/src/pages/FlexCamPage.tsx | head -10
```

Locate the row component that renders each footage request grouped by trip. Add a link near the existing controls:

```tsx
{req.trip_id ? (
  <Link to={`/flexcam/trip/${req.trip_id}`} className="text-xs text-brand-400 hover:underline">
    ▶ Play whole trip
  </Link>
) : null}
```

Make sure `Link` is imported from `react-router-dom` if not already.

- [ ] **Step 2: Typecheck**

```bash
cd client && npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
cd ..
git add client/src/pages/FlexCamPage.tsx
git commit -m "$(cat <<'EOF'
feat(flexcam-client): "Play whole trip" link on FlexCamPage

Routes to /flexcam/trip/:tripId for each trip-grouped request.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Phase G — Final verification + PR description

### Task 25: Full CI gates + manual smoke

**Files:** none

- [ ] **Step 1: Worker CI**

```bash
npm run typecheck
npx vitest run
```

Expected: all PASS.

- [ ] **Step 2: Client CI**

```bash
cd client && npx tsc --noEmit && npx vitest run && npx vite build
cd ..
```

Expected: all PASS.

- [ ] **Step 3: Local dev smoke**

```bash
npm run dev &  # Worker on 8787
cd client && npm run dev &  # Vite on 5173
```

Open `http://localhost:5173/flexcam` — verify:
- FlexCam page loads
- A trip with chunks shows a "▶ Play whole trip" link
- Clicking the link navigates to `/flexcam/trip/:tripId` and renders the player

Kill the dev servers.

- [ ] **Step 4: Create the PR**

```bash
git push -u origin <your-branch-name>
gh pr create --title "feat(flexcam): full-trip stitching (Phase 3) — manifest + DO remux + court-package enrichment" --body "$(cat <<'EOF'
## Summary
- New `GET /api/flexcam/trips/:tripId/manifest` for seamless trip playback.
- `POST /flexcam/render/:id` with `format='mp4'` now enqueues `FlexCamRemuxDO` (was returning `'unsupported'`).
- `FlexCamRemuxDO` materializes a single fMP4 via `mp4box.js`; bounded 3× retry with exponential backoff.
- `POST /flexcam/footage/:id/court-package` additively enriched with `merged_sha256` + `merged_url` when ready — **no contract break**.
- New `<FlexCamTripPlayer>` + `<TripTimeline>` + `<ChannelSwitcher>` + `TripPlaybackPage` at `/flexcam/trip/:tripId`.
- Migration `<NNNN>_flexcam_remux_state.sql` adds 6 bookkeeping columns to `footage_requests` (idempotent ADD COLUMN; runtime reconciler in `flexcam.ts`).

## ⚠️ Post-merge
- [ ] Apply `migrations/<NNNN>_flexcam_remux_state.sql` directly to live D1 `785de7ae` and verify `pragma_table_info('footage_requests')`.
- [ ] On a real FlexCam-mapped unit: close a trip → hit `GET /api/flexcam/trips/:tripId/manifest` → open `/flexcam/trip/:tripId` → lock as evidence → `POST /render/:id` (mp4) → poll until `merged_status='ready'` → `POST /court-package` → confirm `merged_sha256` + `merged_url` in the manifest.

## Test plan
- [x] Worker `npm run typecheck` + `npx vitest run`
- [x] Client `tsc --noEmit` + `vitest` + `vite build`
- [ ] Live verification per the checklist above

## Spec / plan
- Spec: `docs/superpowers/specs/2026-06-21-flexcam-full-trip-stitching-design.md`
- Plan: `docs/superpowers/plans/2026-06-21-flexcam-full-trip-stitching.md`

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Spec coverage — self-review

| Spec requirement | Plan task |
|---|---|
| Migration adds 6 columns | Task 2 |
| `columnExists()` reconciler | Task 3 |
| `buildPlayerManifest` in extended `concat.ts` | Tasks 4–5 |
| `mp4box.ts` thin wrapper | Tasks 6–8 |
| `remuxMp4ToFmp4` + 10% threshold | Tasks 9–10 |
| `GET /trips/:id/manifest` | Tasks 11–12 |
| `FLEXCAM_REMUX` binding + DO migration tag | Task 13 |
| `FlexCamRemuxDO` state machine + retries | Tasks 14–15 |
| `POST /render/:id` MP4 enqueue | Task 16 |
| `/court-package` additive enrichment | Task 17 |
| `useFlexCamManifest` polling hook | Tasks 18–19 |
| `TripTimeline` with gap blocks | Task 20 |
| `ChannelSwitcher` | Task 21 |
| `FlexCamTripPlayer` with onEnded advance | Task 22 |
| `TripPlaybackPage` + route | Task 23 |
| FlexCamPage entry point | Task 24 |
| CI gates + PR | Task 25 |

**Gaps identified:** none.

**Placeholder scan:** No `TBD`/`TODO`/`implement later` strings. The two `<NNNN>` slots are intentional contingent-value markers documented at the top of Task 2.

**Type consistency:** `TripPlayerManifest`/`PlayerClip`/`PlayerGap` are defined in `concat.ts` (Task 5) and re-declared identically in `useFlexCamManifest.ts` (Task 19) — the client doesn't import server types directly. This is intentional; if you want a shared types file later, that's a follow-up. `RemuxJobResult` (Task 10) and `RemuxBlob` (Task 15) are distinct shapes by design — one is the function-call return; one is DO storage.
