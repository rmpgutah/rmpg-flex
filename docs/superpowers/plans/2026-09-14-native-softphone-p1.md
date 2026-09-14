# Native Softphone (P1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** RMPG Flex hosts the Twilio Voice client itself so the native Dialer Connect page places/answers/controls calls without the Dial Connect iframe, with every button wired to its real action and the call archive + PDFs unchanged.

**Architecture:** A `SoftphoneProvider` in the Flex SPA owns one `@twilio/voice-sdk` Device registered as `dispatcher_<users.dialer_oidc_sub>`. Tokens, presence, control calls (hold/transfer/conference/recording/duress) and the SSE event stream go through a new `rmpg-flex-api` router `/api/dialer/*`, which forwards server-to-server to dispatch-app (`rmpgutah.us/dialer/api/*`) with a shared service key and explicit dispatcher id. dispatch-app gains a `resolveActor()` seam (session OR service key) and a recording start/stop route; everything else there is untouched.

**Tech Stack:** Hono + D1 (Worker, Miniflare tests), React 18 + Vite + vitest/jsdom (client), `@twilio/voice-sdk` ^2.18, Next 16 / OpenNext + vitest (dispatch-app).

## Global Constraints

- dispatch-app lives at `/Users/rmpgutah/Call Center/dispatch-app` (Worker `dialer`, Cloudflare routes `rmpgutah.us/dialer` + `rmpgutah.us/dialer/*`). Deploy is manual: `npm run deploy` there. Every browser-side URL in dispatch-app goes through `apiUrl()` from `@/lib/apiUrl`.
- Twilio identity format is exactly `dispatcher_<dispatch-app User.id>`; `users.dialer_oidc_sub` in Flex D1 holds that User.id.
- Control routes take the CALLER's CallSid: `call.customParameters.get('CallerCallSid') ?? call.parameters.CallSid`.
- Worker error contract: `409 {code:'dialer_unlinked'}`, `503 {code:'dialer_unreachable'}`, `403 {code:'dialer_forbidden', details}`, unset secret → `200 {ok:false, code:'not_configured'}`. Never a bare 5xx.
- Kill-switch: `localStorage.rmpg_dialer_iframe === '1'` mounts the legacy `DialerPanel` iframe instead of the native softphone.
- Colors only via theme tokens / CSS variables (never hex); radius 2 px; icon-only buttons need `aria-label`.
- Archive payloads posted to `POST /api/dialer-connect/events` keep the exact shapes `DialerPanel.tsx` posts today (`type: 'call_status' | 'recording_ready' | 'voicemail' | 'transcript_ready'`).
- Flex gates: `npm run typecheck`, `npx vitest run`, `npm run test:worker`, `cd client && npx tsc --noEmit && npx vitest run`. All were green at plan time; any red is yours.
- dispatch-app gates: `npx tsc --noEmit`, `npx vitest run` (19 pre-existing failures in `sms-send`, `voice-webhooks`, `ivr-select`, `unit-panel`, `sms-settings`; compare against base, never add to them).
- Never run two vitest suites concurrently (flaky 5 s timeouts). Commit with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.

---

## File map

**dispatch-app** (`/Users/rmpgutah/Call Center/dispatch-app`, branch `feat/flex-service-actor` off `origin/main`)
- Create `src/lib/actor.ts` — `resolveActor(request)`: session user OR service-key + dispatcher-id header.
- Create `tests/actor.test.ts`.
- Modify `src/app/api/voice/token/route.ts`, `presence/route.ts`, `presence/heartbeat/route.ts`, `hold/route.ts`, `transfer/route.ts`, `conference/add/route.ts`, `conference/add-dispatcher/route.ts`, `duress/route.ts`, `src/app/api/stream/route.ts` — swap `auth()` for `resolveActor(request)`.
- Modify `src/lib/twilio-rest.ts` — add `calls(sid).recordings.{create,update}`.
- Create `src/app/api/voice/recording/control/route.ts` + `tests/recording-control.test.ts`.

**rmpg-flex Worker** (`src/`)
- Modify `src/types.ts` — `DIAL_CONNECT_API_BASE?`, `DIAL_CONNECT_SERVICE_KEY?`.
- Modify `wrangler.toml` — `DIAL_CONNECT_API_BASE` var.
- Create `src/routes/dialerVoice.ts` — `/api/dialer/*` proxy.
- Modify `src/routesConfig.ts` — mount.
- Create `test-workers/dialerVoice.test.ts`.

**rmpg-flex client** (`client/src/dialer/` new)
- `types.ts`, `mockDevice.ts`, `softphoneMachine.ts` (+ `softphoneMachine.test.ts`)
- `dialerFlags.ts` (kill-switch), `dialerApi.ts` (typed calls to `/api/dialer/*`)
- `SoftphoneProvider.tsx` (+ `SoftphoneProvider.test.tsx`), `useDialerStream.ts`
- `SoftphoneCard.tsx` (+ test), `TransferPicker.tsx`, `LinkDialerGate.tsx`
- `IncomingCallToast.tsx`, `DuressBanner.tsx`, `DialerMount.tsx` (+ test)
- Modify `client/src/components/Layout.tsx` (mount), `client/src/pages/DialerConnectPage.tsx` (Softphone card → `SoftphoneCard`, wrap-up prefill), `client/package.json` (`@twilio/voice-sdk`), `CLAUDE.md`.

---

### Task 1: dispatch-app — `resolveActor()` (session or service key)

**Files:**
- Create: `/Users/rmpgutah/Call Center/dispatch-app/src/lib/actor.ts`
- Test: `/Users/rmpgutah/Call Center/dispatch-app/tests/actor.test.ts`

**Interfaces:**
- Produces: `export type Actor = { id: string; name: string; role: string }`; `export async function resolveActor(request: Request): Promise<Actor | null>`; header names `SERVICE_KEY_HEADER = "x-rmpg-service-key"`, `DISPATCHER_ID_HEADER = "x-rmpg-dispatcher-id"`; env `RMPG_FLEX_SERVICE_KEY`.

- [ ] **Step 1: Branch off current main**

```bash
cd "/Users/rmpgutah/Call Center/dispatch-app" && git fetch origin main && git checkout -b feat/flex-service-actor origin/main
```

- [ ] **Step 2: Write the failing test**

```ts
// tests/actor.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { db } from "@/lib/db";
import { generateId } from "@/lib/generate-id";

const sessionMock = vi.fn();
vi.mock("@/auth", () => ({ auth: (...args: unknown[]) => sessionMock(...args) }));

function req(headers: Record<string, string> = {}) {
  return new Request("https://rmpgutah.us/dialer/api/voice/token", { method: "POST", headers });
}

describe("resolveActor", () => {
  let userId: string;
  beforeEach(async () => {
    process.env.RMPG_FLEX_SERVICE_KEY = "test-service-key";
    userId = generateId();
    await db.insertInto("User").values({
      id: userId, name: "Actor Test", email: `actor-${Date.now()}@example.com`,
      passwordHash: "x", role: "dispatcher", active: true,
    }).execute();
    sessionMock.mockResolvedValue(null);
  });
  afterEach(async () => {
    await db.deleteFrom("User").where("id", "=", userId).execute();
    delete process.env.RMPG_FLEX_SERVICE_KEY;
  });

  it("returns the session user when a NextAuth session exists", async () => {
    sessionMock.mockResolvedValue({ user: { id: "sess-1", name: "Sess", role: "admin" } });
    const { resolveActor } = await import("@/lib/actor");
    expect(await resolveActor(req())).toEqual({ id: "sess-1", name: "Sess", role: "admin" });
  });

  it("returns the header dispatcher when the service key matches", async () => {
    const { resolveActor } = await import("@/lib/actor");
    const actor = await resolveActor(req({ "x-rmpg-service-key": "test-service-key", "x-rmpg-dispatcher-id": userId }));
    expect(actor).toEqual({ id: userId, name: "Actor Test", role: "dispatcher" });
  });

  it("rejects a wrong service key", async () => {
    const { resolveActor } = await import("@/lib/actor");
    expect(await resolveActor(req({ "x-rmpg-service-key": "nope", "x-rmpg-dispatcher-id": userId }))).toBeNull();
  });

  it("rejects an inactive or unknown dispatcher even with a valid key", async () => {
    await db.updateTable("User").set({ active: false }).where("id", "=", userId).execute();
    const { resolveActor } = await import("@/lib/actor");
    expect(await resolveActor(req({ "x-rmpg-service-key": "test-service-key", "x-rmpg-dispatcher-id": userId }))).toBeNull();
    expect(await resolveActor(req({ "x-rmpg-service-key": "test-service-key", "x-rmpg-dispatcher-id": "missing" }))).toBeNull();
  });

  it("rejects the service path entirely when RMPG_FLEX_SERVICE_KEY is unset", async () => {
    delete process.env.RMPG_FLEX_SERVICE_KEY;
    const { resolveActor } = await import("@/lib/actor");
    expect(await resolveActor(req({ "x-rmpg-service-key": "", "x-rmpg-dispatcher-id": userId }))).toBeNull();
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `cd "/Users/rmpgutah/Call Center/dispatch-app" && npx vitest run tests/actor.test.ts`
Expected: FAIL — `Cannot find module '@/lib/actor'`.

- [ ] **Step 4: Implement**

```ts
// src/lib/actor.ts
import { auth } from "@/auth";
import { db } from "@/lib/db";

export type Actor = { id: string; name: string; role: string };

export const SERVICE_KEY_HEADER = "x-rmpg-service-key";
export const DISPATCHER_ID_HEADER = "x-rmpg-dispatcher-id";

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// Session first (browser), then the RMPG Flex service path: a shared key plus
// an explicit dispatcher id, so the Flex Worker can act for a linked dispatcher
// without holding a NextAuth cookie. Only active dispatcher/admin users qualify.
export async function resolveActor(request: Request): Promise<Actor | null> {
  const session = await auth();
  if (session?.user) {
    const u = session.user as { id: string; name?: string | null; role?: string };
    return { id: u.id, name: u.name ?? "", role: u.role ?? "dispatcher" };
  }

  const expected = process.env.RMPG_FLEX_SERVICE_KEY;
  const presented = request.headers.get(SERVICE_KEY_HEADER);
  const dispatcherId = request.headers.get(DISPATCHER_ID_HEADER);
  if (!expected || !presented || !dispatcherId) return null;
  if (!timingSafeEqual(presented, expected)) return null;

  const user = await db
    .selectFrom("User")
    .select(["id", "name", "role", "active"])
    .where("id", "=", dispatcherId)
    .executeTakeFirst();
  if (!user || !user.active || (user.role !== "dispatcher" && user.role !== "admin")) return null;
  return { id: user.id, name: user.name, role: user.role };
}
```

- [ ] **Step 5: Run the test**

Run: `npx vitest run tests/actor.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 6: Commit**

```bash
git add src/lib/actor.ts tests/actor.test.ts
git commit -m "feat(auth): resolveActor — session or RMPG Flex service key + dispatcher id

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: dispatch-app — control routes accept the service actor

**Files:**
- Modify: `src/app/api/voice/token/route.ts`, `src/app/api/voice/presence/route.ts`, `src/app/api/voice/presence/heartbeat/route.ts`, `src/app/api/voice/hold/route.ts`, `src/app/api/voice/transfer/route.ts`, `src/app/api/voice/conference/add/route.ts`, `src/app/api/voice/conference/add-dispatcher/route.ts`, `src/app/api/voice/duress/route.ts`, `src/app/api/stream/route.ts`
- Test: `tests/voice-token-service.test.ts`

**Interfaces:**
- Consumes: `resolveActor(request)` from Task 1.
- Produces: `POST /api/voice/token` accepts the service headers and returns `{ token, identity: "dispatcher_<id>", userId, expiresAt }` (`expiresAt` = ISO string, new field).

- [ ] **Step 1: Write the failing test**

```ts
// tests/voice-token-service.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { db } from "@/lib/db";
import { generateId } from "@/lib/generate-id";

const sessionMock = vi.fn();
vi.mock("@/auth", () => ({ auth: (...args: unknown[]) => sessionMock(...args) }));
vi.mock("@/lib/twilio-client", () => ({
  isTwilioConfigured: () => true,
  hasRealTwimlAppSid: () => false,
  getTwilioClient: () => ({}),
}));

describe("POST /api/voice/token via service key", () => {
  let userId: string;
  beforeEach(async () => {
    process.env.RMPG_FLEX_SERVICE_KEY = "svc";
    process.env.TWILIO_ACCOUNT_SID = "AC00000000000000000000000000000000";
    process.env.TWILIO_API_KEY = "SK00000000000000000000000000000000";
    process.env.TWILIO_API_SECRET = "secret";
    sessionMock.mockResolvedValue(null);
    userId = generateId();
    await db.insertInto("User").values({
      id: userId, name: "Svc", email: `svc-${Date.now()}@example.com`, passwordHash: "x", role: "dispatcher", active: true,
    }).execute();
  });
  afterEach(async () => { await db.deleteFrom("User").where("id", "=", userId).execute(); });

  it("mints a token for the header dispatcher", async () => {
    const { POST } = await import("@/app/api/voice/token/route");
    const res = await POST(new Request("https://rmpgutah.us/dialer/api/voice/token", {
      method: "POST", headers: { "x-rmpg-service-key": "svc", "x-rmpg-dispatcher-id": userId },
    }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.identity).toBe(`dispatcher_${userId}`);
    expect(body.userId).toBe(userId);
    expect(typeof body.token).toBe("string");
    expect(new Date(body.expiresAt).getTime()).toBeGreaterThan(Date.now());
  });

  it("still 401s with no session and no key", async () => {
    const { POST } = await import("@/app/api/voice/token/route");
    const res = await POST(new Request("https://rmpgutah.us/dialer/api/voice/token", { method: "POST" }));
    expect(res.status).toBe(401);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/voice-token-service.test.ts`
Expected: FAIL — first test gets 401 (route still calls `auth()` only) and `POST()` takes no argument.

- [ ] **Step 3: Rewrite the token route**

```ts
// src/app/api/voice/token/route.ts
import { NextResponse } from "next/server";
import { resolveActor } from "@/lib/actor";
import { hasRealTwimlAppSid, isTwilioConfigured } from "@/lib/twilio-client";
import { createTwilioAccessToken } from "@/lib/twilio-jwt";

const TOKEN_TTL_SECONDS = 3600;

export async function POST(request: Request) {
  const actor = await resolveActor(request);
  if (!actor) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (!isTwilioConfigured()) {
    return NextResponse.json({ error: "Telephony not configured" }, { status: 503 });
  }

  const identity = `dispatcher_${actor.id}`;
  const token = await createTwilioAccessToken({
    accountSid: process.env.TWILIO_ACCOUNT_SID!,
    apiKey: process.env.TWILIO_API_KEY!,
    apiSecret: process.env.TWILIO_API_SECRET!,
    identity,
    ttl: TOKEN_TTL_SECONDS,
    // Only set outgoingApplicationSid when it's a real SID -- a placeholder
    // isn't valid Twilio SID syntax and Twilio rejects the whole registration.
    ...(hasRealTwimlAppSid() ? { twimlAppSid: process.env.TWILIO_TWIML_APP_SID } : {}),
  });

  const expiresAt = new Date(Date.now() + TOKEN_TTL_SECONDS * 1000).toISOString();
  return NextResponse.json({ token, identity, userId: actor.id, expiresAt });
}
```

- [ ] **Step 4: Apply the same swap to the other eight routes**

In each file below replace the two auth lines. Before (pattern used by all of them):

```ts
import { auth } from "@/auth";
...
export async function POST(request: Request) {   // or GET()
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const userId = (session.user as { id: string }).id;   // where present
```

After:

```ts
import { resolveActor } from "@/lib/actor";
...
export async function POST(request: Request) {   // add `request: Request` to GET() signatures too
  const actor = await resolveActor(request);
  if (!actor) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const userId = actor.id;
```

Files and the local names to preserve:
- `presence/route.ts` (`GET`): `currentUserId = actor.id`.
- `presence/heartbeat/route.ts` (`POST`): `userId = actor.id`.
- `hold/route.ts`, `transfer/route.ts`, `conference/add/route.ts`, `conference/add-dispatcher/route.ts`: only the guard changes (they don't read the user id) — for `add-dispatcher`/`transfer`, where the existing code reads the current dispatcher id from the session for the self-transfer check, use `actor.id`.
- `duress/route.ts` (`POST`): `dispatcherName = actor.name || "A dispatcher"`; log line uses `actor.id`.
- `src/app/api/stream/route.ts` (`GET(request)`): `if (!actor) return new Response("Unauthorized", { status: 401 });`.

Remove each file's now-unused `import { auth } from "@/auth";`.

- [ ] **Step 5: Typecheck + tests**

Run: `npx tsc --noEmit && npx vitest run tests/voice-token-service.test.ts tests/voice-hold.test.ts tests/conference-add-dispatcher.test.ts tests/voice-hold-alarm.test.ts`
Expected: tsc clean; new test PASS; the three existing tests keep exactly their pre-existing results (they mock `@/auth`, which `resolveActor` still calls first).

- [ ] **Step 6: Commit**

```bash
git add src/app/api/voice src/app/api/stream tests/voice-token-service.test.ts
git commit -m "feat(voice): control routes + stream accept the RMPG Flex service actor; token returns expiresAt

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: dispatch-app — recording start/stop control + deploy

**Files:**
- Modify: `src/lib/twilio-rest.ts` (inside `calls(callSid)` object)
- Create: `src/app/api/voice/recording/control/route.ts`
- Test: `tests/recording-control.test.ts`

**Interfaces:**
- Produces: `POST /api/voice/recording/control` body `{ callSid: string; action: "start" | "stop" }` → `200 { status: "recording" | "stopped", recordingSid?: string }`, `400` unknown call / bad body, `401`, `503`.
- `getTwilioClient().calls(sid).recordings.create(data)` → `{ sid: string }`; `.recordings.update(recordingSid, data)`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/recording-control.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { db } from "@/lib/db";
import { generateId } from "@/lib/generate-id";

const sessionMock = vi.fn();
vi.mock("@/auth", () => ({ auth: (...args: unknown[]) => sessionMock(...args) }));
const recCreate = vi.fn();
const recUpdate = vi.fn();
vi.mock("@/lib/twilio-client", () => ({
  isTwilioConfigured: () => true,
  hasRealTwimlAppSid: () => false,
  getTwilioClient: () => ({ calls: () => ({ recordings: { create: recCreate, update: recUpdate } }) }),
}));

async function control(body: unknown) {
  const { POST } = await import("@/app/api/voice/recording/control/route");
  return POST(new Request("https://rmpgutah.us/dialer/api/voice/recording/control", {
    method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" },
  }));
}

describe("POST /api/voice/recording/control", () => {
  let userId: string;
  const callSid = `CArec${Date.now()}`;
  beforeEach(async () => {
    sessionMock.mockResolvedValue({ user: { id: "u1", name: "Rec", role: "dispatcher" } });
    recCreate.mockReset().mockResolvedValue({ sid: "RE123" });
    recUpdate.mockReset().mockResolvedValue({ sid: "RE123", status: "stopped" });
    userId = generateId();
    await db.insertInto("User").values({ id: userId, name: "Rec", email: `rec-${Date.now()}@example.com`, passwordHash: "x", role: "dispatcher", active: true }).execute();
    await db.insertInto("CallLog").values({ id: generateId(), twilioCallSid: callSid, callerNumber: "+18015551212", direction: "inbound", status: "in_progress", handledById: userId }).execute();
  });
  afterEach(async () => {
    await db.deleteFrom("CallLog").where("twilioCallSid", "=", callSid).execute();
    await db.deleteFrom("User").where("id", "=", userId).execute();
  });

  it("starts a dual-channel recording on the caller leg with the status callback", async () => {
    const res = await control({ callSid, action: "start" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "recording", recordingSid: "RE123" });
    expect(recCreate).toHaveBeenCalledWith(expect.objectContaining({
      recordingChannels: "dual",
      recordingStatusCallback: "https://rmpgutah.us/dialer/api/voice/recording",
    }));
  });

  it("stops the current recording", async () => {
    const res = await control({ callSid, action: "stop" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "stopped" });
    expect(recUpdate).toHaveBeenCalledWith("Twilio.CURRENT", { status: "stopped" });
  });

  it("400s for an unknown call or bad body", async () => {
    expect((await control({ callSid: "CAnope", action: "start" })).status).toBe(400);
    expect((await control({ callSid, action: "pause" })).status).toBe(400);
  });

  it("401s without an actor", async () => {
    sessionMock.mockResolvedValue(null);
    expect((await control({ callSid, action: "start" })).status).toBe(401);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/recording-control.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Add `recordings` to the REST client**

In `src/lib/twilio-rest.ts`, replace the `calls:` entry of the returned object:

```ts
    calls: Object.assign(
      (callSid: string) => ({
        update: (data: Record<string, unknown>) =>
          post(`${base}/Calls/${callSid}.json`, accountSid, authToken, data),
        // Call Recordings API: start recording an in-progress call leg, and
        // stop it via the `Twilio.CURRENT` alias. Recording the CALLER's leg
        // captures both directions of the conversation.
        recordings: {
          create: (data: Record<string, unknown>) =>
            post<{ sid: string }>(`${base}/Calls/${callSid}/Recordings.json`, accountSid, authToken, data),
          update: (recordingSid: string, data: Record<string, unknown>) =>
            post<{ sid: string; status: string }>(
              `${base}/Calls/${callSid}/Recordings/${recordingSid}.json`,
              accountSid,
              authToken,
              data
            ),
        },
      }),
      {
        create: (data: Record<string, unknown>) =>
          post(`${base}/Calls.json`, accountSid, authToken, data),
      }
    ),
```

- [ ] **Step 4: Create the route**

```ts
// src/app/api/voice/recording/control/route.ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { resolveActor } from "@/lib/actor";
import { db } from "@/lib/db";
import { getDispatchBaseUrl } from "@/lib/dispatch-base-url";
import { getTwilioClient, isTwilioConfigured } from "@/lib/twilio-client";

const schema = z.object({
  callSid: z.string().min(1),
  action: z.enum(["start", "stop"]),
});

export async function POST(request: Request) {
  const actor = await resolveActor(request);
  if (!actor) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isTwilioConfigured()) return NextResponse.json({ error: "Telephony not configured" }, { status: 503 });

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const callLog = await db
    .selectFrom("CallLog")
    .select(["id", "twilioCallSid"])
    .where("twilioCallSid", "=", parsed.data.callSid)
    .executeTakeFirst();
  if (!callLog) return NextResponse.json({ error: "Unknown call" }, { status: 400 });

  const recordings = getTwilioClient().calls(parsed.data.callSid).recordings;
  if (parsed.data.action === "start") {
    // Completed recordings flow into the existing webhook, so archive,
    // transcript and the Flex `recording_ready` event work unchanged.
    const rec = await recordings.create({
      recordingChannels: "dual",
      recordingStatusCallback: `${getDispatchBaseUrl(request)}/api/voice/recording`,
      recordingStatusCallbackEvent: "completed",
    });
    return NextResponse.json({ status: "recording", recordingSid: rec.sid });
  }
  await recordings.update("Twilio.CURRENT", { status: "stopped" });
  return NextResponse.json({ status: "stopped" });
}
```

- [ ] **Step 5: Run tests + typecheck**

Run: `npx tsc --noEmit && npx vitest run tests/recording-control.test.ts tests/actor.test.ts tests/voice-token-service.test.ts`
Expected: all PASS.

- [ ] **Step 6: Commit, push, PR**

```bash
git add src/lib/twilio-rest.ts src/app/api/voice/recording/control/route.ts tests/recording-control.test.ts
git commit -m "feat(voice): recording start/stop control route (Call Recordings API)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
git push -u origin feat/flex-service-actor
gh pr create -R rmpgutah/dispatch-app --base main --head feat/flex-service-actor --title "feat: RMPG Flex service actor + recording control (native softphone P1)" --body "Adds resolveActor() (session or X-RMPG-Service-Key + X-RMPG-Dispatcher-Id), applies it to token/presence/hold/transfer/conference/duress/stream, adds POST /api/voice/recording/control. Backend half of the RMPG Flex native softphone.

🤖 Generated with [Claude Code](https://claude.com/claude-code)"
```

- [ ] **Step 7: Secret + deploy (production)**

```bash
KEY=$(openssl rand -base64 32); echo "$KEY" > /tmp/dial-connect-service-key.txt   # reused in Task 4 step 7
printf '%s' "$KEY" | env -u CF_API_TOKEN -u CLOUDFLARE_API_TOKEN npx wrangler secret put RMPG_FLEX_SERVICE_KEY --name dialer
env -u CF_API_TOKEN -u CLOUDFLARE_API_TOKEN npm run deploy 2>&1 | grep -E "Current Version ID|error"
curl -s -o /dev/null -w '%{http_code}\n' -X POST https://rmpgutah.us/dialer/api/voice/recording/control   # expect 401
```

---

### Task 4: Flex Worker — `/api/dialer` token + presence proxy

**Files:**
- Modify: `src/types.ts` (Bindings), `wrangler.toml` (vars), `src/routesConfig.ts`
- Create: `src/routes/dialerVoice.ts`
- Test: `test-workers/dialerVoice.test.ts`

**Interfaces:**
- Produces: router `dialerVoice` (default export) mounted at `/api/dialer`; helpers `resolveDispatcherSub(db, userId)`, `upstream(c, init)`; `POST /token` → `{ token, identity, expiresAt }`; `POST /presence/heartbeat` → `{ ok: true }`; `GET /presence` → upstream JSON array.
- Bindings: `DIAL_CONNECT_API_BASE?: string` (default `https://rmpgutah.us/dialer`), `DIAL_CONNECT_SERVICE_KEY?: string`.

- [ ] **Step 1: Write the failing test**

```ts
// test-workers/dialerVoice.test.ts
import { env } from 'cloudflare:test';
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { Hono } from 'hono';
import { execute } from '../src/utils/db';
import dialerVoice from '../src/routes/dialerVoice';

type User = { id: number; role: string; username: string; full_name: string };
function makeApp(user: User) {
  const app = new Hono<{ Bindings: Record<string, unknown>; Variables: { user: User; userId: number } }>();
  app.use('*', async (c, next) => { c.set('user', user); c.set('userId', user.id); await next(); });
  app.onError((err, c) => c.json({ error: err instanceof Error ? err.message : String(err) }, 500));
  app.route('/api/dialer', dialerVoice);
  return app;
}
const db = () => (env as unknown as { DB: D1Database }).DB;
const E = () => ({ ...(env as unknown as Record<string, unknown>), DIAL_CONNECT_SERVICE_KEY: 'svc-key', DIAL_CONNECT_API_BASE: 'https://dialer.test' });
const linked: User = { id: 41, role: 'dispatcher', username: 'linked', full_name: 'Linked User' };
const unlinked: User = { id: 42, role: 'dispatcher', username: 'nolink', full_name: 'No Link' };

beforeAll(async () => {
  await execute(db(), `CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, username TEXT, role TEXT, status TEXT, dialer_oidc_sub TEXT)`);
  await execute(db(), `INSERT OR REPLACE INTO users (id, username, role, status, dialer_oidc_sub) VALUES (41, 'linked', 'dispatcher', 'active', 'cuid_abc')`);
  await execute(db(), `INSERT OR REPLACE INTO users (id, username, role, status, dialer_oidc_sub) VALUES (42, 'nolink', 'dispatcher', 'active', NULL)`);
});
afterEach(() => vi.unstubAllGlobals());

describe('POST /api/dialer/token', () => {
  it('forwards to dispatch-app with the service headers and dispatcher identity', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ token: 'jwt', identity: 'dispatcher_cuid_abc', userId: 'cuid_abc', expiresAt: '2030-01-01T00:00:00.000Z' }), { status: 200, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);
    const res = await makeApp(linked).request('/api/dialer/token', { method: 'POST' }, E());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ token: 'jwt', identity: 'dispatcher_cuid_abc', expiresAt: '2030-01-01T00:00:00.000Z' });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://dialer.test/api/voice/token');
    const h = new Headers(init.headers);
    expect(h.get('x-rmpg-service-key')).toBe('svc-key');
    expect(h.get('x-rmpg-dispatcher-id')).toBe('cuid_abc');
  });

  it('returns 409 dialer_unlinked when the user has no dialer_oidc_sub', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const res = await makeApp(unlinked).request('/api/dialer/token', { method: 'POST' }, E());
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'Your account is not linked to Dial Connect', code: 'dialer_unlinked' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns 503 dialer_unreachable when upstream fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('boom', { status: 500 })));
    const res = await makeApp(linked).request('/api/dialer/token', { method: 'POST' }, E());
    expect(res.status).toBe(503);
    expect((await res.json()).code).toBe('dialer_unreachable');
  });

  it('returns 403 dialer_forbidden when upstream rejects the service actor', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 })));
    const res = await makeApp(linked).request('/api/dialer/token', { method: 'POST' }, E());
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe('dialer_forbidden');
  });

  it('reports not_configured (200) when the service key is unset', async () => {
    const res = await makeApp(linked).request('/api/dialer/token', { method: 'POST' }, { ...(env as unknown as Record<string, unknown>), DIAL_CONNECT_SERVICE_KEY: undefined });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: false, code: 'not_configured' });
  });
});

describe('presence', () => {
  it('POST /presence/heartbeat forwards and returns ok', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const res = await makeApp(linked).request('/api/dialer/presence/heartbeat', { method: 'POST' }, E());
    expect(res.status).toBe(200);
    expect((fetchMock.mock.calls[0] as unknown as [string])[0]).toBe('https://dialer.test/api/voice/presence/heartbeat');
  });
  it('GET /presence passes the upstream list through', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify([{ id: 'x', name: 'Other', agency: 'all', dnd: false }]), { status: 200 })));
    const res = await makeApp(linked).request('/api/dialer/presence', {}, E());
    expect(await res.json()).toEqual([{ id: 'x', name: 'Other', agency: 'all', dnd: false }]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run --config vitest.workers.config.mts test-workers/dialerVoice.test.ts`
Expected: FAIL — cannot resolve `../src/routes/dialerVoice`.

- [ ] **Step 3: Add bindings + var**

`src/types.ts`, inside `Bindings` after `TURNSTILE_SECRET_KEY?: string;`:

```ts
  // Dial Connect (dispatch-app Worker `dialer`) server-to-server proxy for the
  // native softphone (src/routes/dialerVoice.ts). Base is a plain var; the key
  // is `wrangler secret put DIAL_CONNECT_SERVICE_KEY` and must equal
  // RMPG_FLEX_SERVICE_KEY on the `dialer` Worker. Unset key → not_configured.
  DIAL_CONNECT_API_BASE?: string;
  DIAL_CONNECT_SERVICE_KEY?: string;
```

`wrangler.toml`, right after the `DIAL_CONNECT_WEBHOOK_URL` line:

```toml
# Dial Connect API base for the native softphone proxy (src/routes/dialerVoice.ts).
# Secret: `npx wrangler secret put DIAL_CONNECT_SERVICE_KEY` (same value as
# RMPG_FLEX_SERVICE_KEY on the `dialer` Worker).
DIAL_CONNECT_API_BASE = "https://rmpgutah.us/dialer"
```

- [ ] **Step 4: Create the router**

```ts
// src/routes/dialerVoice.ts
// Native softphone proxy: RMPG Flex hosts the Twilio Voice client; tokens,
// presence, call controls and the event stream are forwarded server-to-server
// to dispatch-app (Worker `dialer`) as the linked dispatcher.
import { Hono } from 'hono';
import type { Context } from 'hono';
import { z } from 'zod';
import type { Env } from '../types';
import { getDb, queryFirst, ensureDialerOidcColumns } from '../utils/db';
import { requireRole } from '../middleware/auth';
import { log } from '../utils/logger';

const DEFAULT_BASE = 'https://rmpgutah.us/dialer';
const UPSTREAM_TIMEOUT_MS = 8_000;

const dialerVoice = new Hono<Env>();
dialerVoice.use('*', requireRole('admin', 'manager', 'supervisor', 'officer', 'dispatcher'));

export async function resolveDispatcherSub(db: D1Database, userId: number): Promise<string | null> {
  await ensureDialerOidcColumns(db);
  const row = await queryFirst<{ dialer_oidc_sub: string | null }>(
    db, 'SELECT dialer_oidc_sub FROM users WHERE id = ?', userId,
  );
  return row?.dialer_oidc_sub || null;
}

type Ctx = Context<Env>;

function unlinked(c: Ctx) {
  return c.json({ error: 'Your account is not linked to Dial Connect', code: 'dialer_unlinked' }, 409);
}

// Forwards to dispatch-app. Returns the upstream Response on 2xx/4xx (caller
// decides), or a Flex error Response for unreachable/forbidden.
export async function upstream(
  c: Ctx,
  sub: string,
  path: string,
  init: { method: 'GET' | 'POST' | 'PUT'; body?: unknown; stream?: boolean } = { method: 'GET' },
): Promise<Response> {
  const base = (c.env.DIAL_CONNECT_API_BASE || DEFAULT_BASE).replace(/\/$/, '');
  const headers: Record<string, string> = {
    'x-rmpg-service-key': c.env.DIAL_CONNECT_SERVICE_KEY || '',
    'x-rmpg-dispatcher-id': sub,
    accept: init.stream ? 'text/event-stream' : 'application/json',
  };
  if (init.body !== undefined) headers['content-type'] = 'application/json';
  const controller = new AbortController();
  const timer = init.stream ? null : setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(`${base}${path}`, {
      method: init.method,
      headers,
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: init.stream ? undefined : controller.signal,
    });
  } catch (err) {
    log.error('[dialer] upstream fetch failed', { path }, err as Error);
    return c.json({ error: 'Dial Connect is unreachable', code: 'dialer_unreachable' }, 503);
  } finally {
    if (timer) clearTimeout(timer);
  }
  if (res.status === 401 || res.status === 403) {
    const details = await res.text().catch(() => '');
    return c.json({ error: 'Dial Connect rejected this dispatcher', code: 'dialer_forbidden', details }, 403);
  }
  if (res.status >= 500) {
    log.error('[dialer] upstream error', { path, status: res.status });
    return c.json({ error: 'Dial Connect is unreachable', code: 'dialer_unreachable' }, 503);
  }
  return res;
}

async function withSub(c: Ctx): Promise<{ sub: string } | { res: Response }> {
  if (!c.env.DIAL_CONNECT_SERVICE_KEY) return { res: c.json({ ok: false, code: 'not_configured' }, 200) };
  const sub = await resolveDispatcherSub(getDb(c.env), c.get('userId'));
  if (!sub) return { res: unlinked(c) };
  return { sub };
}

// Re-emit an upstream JSON body with the same status (2xx/4xx pass-through).
async function relay(c: Ctx, res: Response): Promise<Response> {
  const text = await res.text();
  return new Response(text, { status: res.status, headers: { 'content-type': res.headers.get('content-type') || 'application/json' } });
}

dialerVoice.post('/token', async (c) => {
  const r = await withSub(c);
  if ('res' in r) return r.res;
  const res = await upstream(c, r.sub, '/api/voice/token', { method: 'POST' });
  if (!res.ok) return relay(c, res);
  const body = await res.json() as { token: string; identity: string; expiresAt?: string };
  return c.json({ token: body.token, identity: body.identity, expiresAt: body.expiresAt ?? new Date(Date.now() + 3600_000).toISOString() });
});

dialerVoice.post('/presence/heartbeat', async (c) => {
  const r = await withSub(c);
  if ('res' in r) return r.res;
  const res = await upstream(c, r.sub, '/api/voice/presence/heartbeat', { method: 'POST' });
  if (!res.ok) return relay(c, res);
  return c.json({ ok: true });
});

dialerVoice.get('/presence', async (c) => {
  const r = await withSub(c);
  if ('res' in r) return r.res;
  return relay(c, await upstream(c, r.sub, '/api/voice/presence'));
});

export { z };
export default dialerVoice;
```

(`export { z }` is a placeholder-free convenience so Task 5 can import zod from the same module; remove it in Task 5 when the schemas are added there.)

- [ ] **Step 5: Mount**

`src/routesConfig.ts`: add the import next to the dialerConnect import and the entry directly after the `/api/dialer-connect` entry:

```ts
import dialerVoice from './routes/dialerVoice';
...
  { prefix: '/api/dialer', router: dialerVoice, auth: 'required',
    note: 'Native softphone: Twilio token, presence, call controls and SSE proxied server-to-server to Dial Connect (dispatch-app) as the linked dispatcher (users.dialer_oidc_sub).' },
```

Check `/api/dialer-connect` is matched before `/api/dialer` only matters for Hono prefix routing: since both are distinct prefixes (`/api/dialer-connect` vs `/api/dialer/...`), order is irrelevant — but keep `/api/dialer` AFTER `/api/dialer-connect` for readability.

- [ ] **Step 6: Run tests + typecheck**

Run: `npm run typecheck && npx vitest run --config vitest.workers.config.mts test-workers/dialerVoice.test.ts`
Expected: tsc clean; 7 tests PASS.

- [ ] **Step 7: Set the Flex secret (same value as Task 3 step 7)**

```bash
cd "/Users/rmpgutah/RMPG Flex/.claude/worktrees/fix-dialer-3570ce" && cat /tmp/dial-connect-service-key.txt | tr -d '\n' | env -u CF_API_TOKEN -u CLOUDFLARE_API_TOKEN npx wrangler secret put DIAL_CONNECT_SERVICE_KEY --name rmpg-flex-api
```

- [ ] **Step 8: Commit**

```bash
git add src/types.ts wrangler.toml src/routes/dialerVoice.ts src/routesConfig.ts test-workers/dialerVoice.test.ts
git commit -m "feat(dialer): /api/dialer token + presence proxy to Dial Connect as the linked dispatcher

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: Flex Worker — call controls + SSE passthrough

**Files:**
- Modify: `src/routes/dialerVoice.ts`
- Test: `test-workers/dialerVoice.test.ts` (append)

**Interfaces:**
- Produces: `POST /voice/hold {callSid, hold}`, `POST /voice/transfer {callSid, targetDispatcherId}`, `POST /voice/conference/add-dispatcher {callSid, targetDispatcherId}`, `POST /voice/conference/add {callSid, phoneNumber}`, `POST /voice/recording {callSid, action}`, `POST /voice/duress {}`, `GET /stream` (SSE).

- [ ] **Step 1: Append failing tests**

```ts
// append to test-workers/dialerVoice.test.ts
describe('call controls', () => {
  it('forwards hold with a validated body', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ status: 'held' }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const res = await makeApp(linked).request('/api/dialer/voice/hold', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ callSid: 'CA1', hold: true }),
    }, E());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'held' });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://dialer.test/api/voice/hold');
    expect(JSON.parse(String(init.body))).toEqual({ callSid: 'CA1', hold: true });
  });

  it('rejects an invalid body before calling upstream', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const res = await makeApp(linked).request('/api/dialer/voice/recording', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ callSid: 'CA1', action: 'pause' }),
    }, E());
    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('normalizes the conference phone number to E.164', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ status: 'added' }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await makeApp(linked).request('/api/dialer/voice/conference/add', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ callSid: 'CA1', phoneNumber: '(801) 555-1212' }),
    }, E());
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual({ callSid: 'CA1', phoneNumber: '+18015551212' });
  });

  it('passes upstream 4xx through unchanged', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'No active conference for this call' }), { status: 400 })));
    const res = await makeApp(linked).request('/api/dialer/voice/transfer', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ callSid: 'CA1', targetDispatcherId: 'cuid_other' }),
    }, E());
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('No active conference for this call');
  });
});

describe('GET /api/dialer/stream', () => {
  it('returns the upstream event stream body untouched', async () => {
    const body = ': connected\n\ndata: {"type":"call_status"}\n\n';
    vi.stubGlobal('fetch', vi.fn(async () => new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } })));
    const res = await makeApp(linked).request('/api/dialer/stream', {}, E());
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    expect(res.headers.get('cache-control')).toBe('no-cache');
    expect(await res.text()).toBe(body);
  });
});
```

- [ ] **Step 2: Run to verify the new tests fail**

Run: `npx vitest run --config vitest.workers.config.mts test-workers/dialerVoice.test.ts`
Expected: the 5 new tests FAIL with 404s.

- [ ] **Step 3: Implement**

In `src/routes/dialerVoice.ts` delete the `export { z };` line and add below the `/presence` route:

```ts
const e164 = (raw: string): string => {
  const trimmed = raw.trim();
  if (trimmed.startsWith('+')) return trimmed.replace(/[^\d+]/g, '');
  const digits = trimmed.replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  if (digits.length === 10) return `+1${digits}`;
  return digits ? `+${digits}` : '';
};

const callSid = z.string().min(1).max(64);
const holdSchema = z.object({ callSid, hold: z.boolean() });
const dispatcherTargetSchema = z.object({ callSid, targetDispatcherId: z.string().min(1).max(64) });
const addPartySchema = z.object({ callSid, phoneNumber: z.string().min(7).max(32).transform(e164).refine((v) => /^\+\d{8,15}$/.test(v), 'phoneNumber must be a dialable number') });
const recordingSchema = z.object({ callSid, action: z.enum(['start', 'stop']) });

function control<S extends z.ZodTypeAny>(path: string, upstreamPath: string, schema: S) {
  dialerVoice.post(path, async (c) => {
    const r = await withSub(c);
    if ('res' in r) return r.res;
    const parsed = schema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'Invalid request', details: parsed.error.flatten() }, 400);
    return relay(c, await upstream(c, r.sub, upstreamPath, { method: 'POST', body: parsed.data }));
  });
}

control('/voice/hold', '/api/voice/hold', holdSchema);
control('/voice/transfer', '/api/voice/transfer', dispatcherTargetSchema);
control('/voice/conference/add-dispatcher', '/api/voice/conference/add-dispatcher', dispatcherTargetSchema);
control('/voice/conference/add', '/api/voice/conference/add', addPartySchema);
control('/voice/recording', '/api/voice/recording/control', recordingSchema);

dialerVoice.post('/voice/duress', async (c) => {
  const r = await withSub(c);
  if ('res' in r) return r.res;
  return relay(c, await upstream(c, r.sub, '/api/voice/duress', { method: 'POST', body: {} }));
});

// SSE passthrough: hand the upstream body straight back so Cloudflare streams
// it; no timeout on this one (it's long-lived by design).
dialerVoice.get('/stream', async (c) => {
  const r = await withSub(c);
  if ('res' in r) return r.res;
  const res = await upstream(c, r.sub, '/api/stream', { method: 'GET', stream: true });
  if (!res.ok) return relay(c, res);
  return new Response(res.body, {
    status: 200,
    headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' },
  });
});
```

- [ ] **Step 4: Run tests + typecheck**

Run: `npm run typecheck && npx vitest run --config vitest.workers.config.mts test-workers/dialerVoice.test.ts`
Expected: tsc clean; 12 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/routes/dialerVoice.ts test-workers/dialerVoice.test.ts
git commit -m "feat(dialer): proxy hold/transfer/conference/recording/duress controls and the SSE stream

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: Client — softphone state machine, types, mock device

**Files:**
- Modify: `client/package.json` (add `@twilio/voice-sdk`)
- Create: `client/src/dialer/types.ts`, `client/src/dialer/mockDevice.ts`, `client/src/dialer/softphoneMachine.ts`
- Test: `client/src/dialer/softphoneMachine.test.ts`

**Interfaces:**
- Produces:
  - `SoftphoneStatus = 'offline' | 'unlinked' | 'passive' | 'registering' | 'ready' | 'incoming' | 'in_call' | 'call_waiting' | 'error'`
  - `SoftphoneSnapshot = { status; error: string | null; callSid: string | null; remoteNumber: string | null; direction: 'inbound' | 'outbound' | null; connectedAt: number | null; muted: boolean; held: boolean; recording: boolean; waitingFrom: string | null }`
  - `SoftphoneEvent` union and `reduce(snapshot, event): SoftphoneSnapshot`, `INITIAL: SoftphoneSnapshot`.
  - `SoftphoneCall`, `SoftphoneDevice` structural interfaces; `DeviceFactory = (token: string) => SoftphoneDevice`.
  - `MockDevice` with `simulateIncoming(from: string): MockCall`, `MockCall` records `accept/reject/disconnect/mute/sendDigits` calls.

- [ ] **Step 1: Install the SDK**

```bash
cd "/Users/rmpgutah/RMPG Flex/.claude/worktrees/fix-dialer-3570ce/client" && npm install @twilio/voice-sdk@^2.18.3 --legacy-peer-deps
```

- [ ] **Step 2: Write the failing test**

```ts
// client/src/dialer/softphoneMachine.test.ts
import { describe, test, expect } from 'vitest';
import { INITIAL, reduce, type SoftphoneSnapshot } from './softphoneMachine';

const at = (s: SoftphoneSnapshot, ...events: Parameters<typeof reduce>[1][]) => events.reduce(reduce, s);

describe('softphone reducer', () => {
  test('registers and becomes ready', () => {
    const s = at(INITIAL, { type: 'REGISTERING' }, { type: 'REGISTERED' });
    expect(s.status).toBe('ready');
    expect(s.error).toBeNull();
  });

  test('inbound call: incoming → in_call with caller number and sid', () => {
    const s = at(INITIAL, { type: 'REGISTERED' }, { type: 'INCOMING', from: '+18015551212', callSid: 'CA1' }, { type: 'ACCEPTED', callSid: 'CA1', connectedAt: 1000 });
    expect(s).toMatchObject({ status: 'in_call', remoteNumber: '+18015551212', callSid: 'CA1', direction: 'inbound', connectedAt: 1000 });
  });

  test('outbound call: dialing → in_call; disconnect resets call fields but stays ready', () => {
    const dialing = at(INITIAL, { type: 'REGISTERED' }, { type: 'DIALING', to: '+18015551212' });
    expect(dialing).toMatchObject({ status: 'in_call', direction: 'outbound', remoteNumber: '+18015551212', connectedAt: null });
    const live = reduce(dialing, { type: 'ACCEPTED', callSid: 'CA9', connectedAt: 5 });
    const held = reduce(reduce(live, { type: 'MUTED', muted: true }), { type: 'HELD', held: true });
    expect(held).toMatchObject({ muted: true, held: true, callSid: 'CA9' });
    const done = reduce(held, { type: 'DISCONNECTED' });
    expect(done).toMatchObject({ status: 'ready', callSid: null, remoteNumber: null, muted: false, held: false, recording: false, connectedAt: null });
  });

  test('a second incoming call while in_call becomes call_waiting and cancel restores in_call', () => {
    const live = at(INITIAL, { type: 'REGISTERED' }, { type: 'DIALING', to: '+1' }, { type: 'ACCEPTED', callSid: 'CA1', connectedAt: 1 });
    const waiting = reduce(live, { type: 'INCOMING', from: '+2', callSid: 'CA2' });
    expect(waiting).toMatchObject({ status: 'call_waiting', waitingFrom: '+2', callSid: 'CA1' });
    expect(reduce(waiting, { type: 'WAITING_CANCELLED' })).toMatchObject({ status: 'in_call', waitingFrom: null });
  });

  test('errors carry the message; unlinked and passive are terminal until reset', () => {
    expect(reduce(INITIAL, { type: 'ERROR', message: 'AccessTokenInvalid' })).toMatchObject({ status: 'error', error: 'AccessTokenInvalid' });
    expect(reduce(INITIAL, { type: 'UNLINKED' }).status).toBe('unlinked');
    expect(reduce(reduce(INITIAL, { type: 'REGISTERED' }), { type: 'PASSIVE' }).status).toBe('passive');
    expect(reduce(reduce(INITIAL, { type: 'ERROR', message: 'x' }), { type: 'RESET' })).toEqual(INITIAL);
  });
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `cd client && npx vitest run src/dialer/softphoneMachine.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Create types + reducer + mock**

```ts
// client/src/dialer/types.ts
// Structural subset of @twilio/voice-sdk Device/Call that the provider uses,
// so MockDevice can stand in for tests without casts on the mock path.
export interface SoftphoneCall {
  parameters: { CallSid?: string; From?: string; To?: string };
  customParameters: Map<string, string>;
  on(event: string, listener: (...args: any[]) => void): unknown;
  accept(): void;
  reject(): void;
  disconnect(): void;
  mute(shouldMute: boolean): void;
  isMuted(): boolean;
  sendDigits(digits: string): void;
  removeAllListeners(event?: string): unknown;
}

export interface SoftphoneDevice {
  on(event: string, listener: (...args: any[]) => void): unknown;
  destroy(): void;
  register(): Promise<void>;
  updateToken(token: string): void;
  connect(opts: { params: Record<string, string> }): Promise<SoftphoneCall>;
}

export type DeviceFactory = (token: string) => SoftphoneDevice;

/** Caller's CallSid (matches dispatch-app CallLog.twilioCallSid), not this leg's. */
export function controlCallSid(call: SoftphoneCall | null): string | null {
  if (!call) return null;
  return call.customParameters.get('CallerCallSid') ?? call.parameters.CallSid ?? null;
}
```

```ts
// client/src/dialer/softphoneMachine.ts
export type SoftphoneStatus =
  | 'offline' | 'unlinked' | 'passive' | 'registering' | 'ready'
  | 'incoming' | 'in_call' | 'call_waiting' | 'error';

export interface SoftphoneSnapshot {
  status: SoftphoneStatus;
  error: string | null;
  callSid: string | null;
  remoteNumber: string | null;
  direction: 'inbound' | 'outbound' | null;
  connectedAt: number | null;
  muted: boolean;
  held: boolean;
  recording: boolean;
  waitingFrom: string | null;
}

export type SoftphoneEvent =
  | { type: 'REGISTERING' }
  | { type: 'REGISTERED' }
  | { type: 'UNLINKED' }
  | { type: 'PASSIVE' }
  | { type: 'ERROR'; message: string }
  | { type: 'INCOMING'; from: string; callSid: string | null }
  | { type: 'DIALING'; to: string }
  | { type: 'ACCEPTED'; callSid: string | null; connectedAt: number }
  | { type: 'MUTED'; muted: boolean }
  | { type: 'HELD'; held: boolean }
  | { type: 'RECORDING'; recording: boolean }
  | { type: 'WAITING_CANCELLED' }
  | { type: 'DISCONNECTED' }
  | { type: 'RESET' };

export const INITIAL: SoftphoneSnapshot = {
  status: 'offline', error: null, callSid: null, remoteNumber: null, direction: null,
  connectedAt: null, muted: false, held: false, recording: false, waitingFrom: null,
};

const CLEARED_CALL = { callSid: null, remoteNumber: null, direction: null, connectedAt: null, muted: false, held: false, recording: false, waitingFrom: null } as const;

export function reduce(s: SoftphoneSnapshot, e: SoftphoneEvent): SoftphoneSnapshot {
  switch (e.type) {
    case 'REGISTERING': return { ...s, status: 'registering', error: null };
    case 'REGISTERED': return { ...s, status: 'ready', error: null };
    case 'UNLINKED': return { ...INITIAL, status: 'unlinked' };
    case 'PASSIVE': return { ...INITIAL, status: 'passive' };
    case 'ERROR': return { ...s, status: 'error', error: e.message };
    case 'INCOMING':
      if (s.status === 'in_call' || s.status === 'call_waiting') return { ...s, status: 'call_waiting', waitingFrom: e.from };
      return { ...s, status: 'incoming', remoteNumber: e.from, callSid: e.callSid, direction: 'inbound' };
    case 'DIALING': return { ...s, ...CLEARED_CALL, status: 'in_call', remoteNumber: e.to, direction: 'outbound' };
    case 'ACCEPTED': return { ...s, status: 'in_call', callSid: e.callSid ?? s.callSid, connectedAt: e.connectedAt, waitingFrom: null };
    case 'MUTED': return { ...s, muted: e.muted };
    case 'HELD': return { ...s, held: e.held };
    case 'RECORDING': return { ...s, recording: e.recording };
    case 'WAITING_CANCELLED': return { ...s, status: 'in_call', waitingFrom: null };
    case 'DISCONNECTED': return { ...s, ...CLEARED_CALL, status: s.status === 'unlinked' || s.status === 'passive' || s.status === 'offline' ? s.status : 'ready' };
    case 'RESET': return INITIAL;
  }
}
```

```ts
// client/src/dialer/mockDevice.ts
import type { SoftphoneCall, SoftphoneDevice } from './types';

type Listener = (...args: any[]) => void;
class Emitter {
  private listeners = new Map<string, Listener[]>();
  on(event: string, l: Listener) { this.listeners.set(event, [...(this.listeners.get(event) ?? []), l]); return this; }
  emit(event: string, ...args: any[]) { for (const l of this.listeners.get(event) ?? []) l(...args); }
  removeAllListeners(event?: string) { if (event) this.listeners.delete(event); else this.listeners.clear(); return this; }
}

export class MockCall extends Emitter implements SoftphoneCall {
  parameters: { CallSid?: string; From?: string; To?: string };
  customParameters = new Map<string, string>();
  accepted = false; rejected = false; disconnected = false; muted = false; digits = '';
  constructor(params: { CallSid?: string; From?: string; To?: string }, custom: Record<string, string> = {}) {
    super();
    this.parameters = params;
    for (const [k, v] of Object.entries(custom)) this.customParameters.set(k, v);
  }
  accept() { this.accepted = true; this.emit('accept', this); }
  reject() { this.rejected = true; this.emit('reject'); }
  disconnect() { this.disconnected = true; this.emit('disconnect', this); }
  mute(m: boolean) { this.muted = m; this.emit('mute', m, this); }
  isMuted() { return this.muted; }
  sendDigits(d: string) { this.digits += d; }
}

export class MockDevice extends Emitter implements SoftphoneDevice {
  token: string;
  destroyed = false;
  registered = false;
  connectParams: Record<string, string> | null = null;
  lastCall: MockCall | null = null;
  constructor(token: string) { super(); this.token = token; }
  async register() { this.registered = true; this.emit('registered'); }
  updateToken(token: string) { this.token = token; }
  destroy() { this.destroyed = true; this.emit('destroyed'); }
  async connect(opts: { params: Record<string, string> }) {
    this.connectParams = opts.params;
    this.lastCall = new MockCall({ CallSid: 'CAoutbound', To: opts.params.To });
    return this.lastCall;
  }
  simulateIncoming(from: string, callerCallSid = 'CAcaller'): MockCall {
    const call = new MockCall({ CallSid: 'CAleg', From: from }, { CallerCallSid: callerCallSid });
    this.lastCall = call;
    this.emit('incoming', call);
    return call;
  }
}
```

- [ ] **Step 5: Run the test**

Run: `npx vitest run src/dialer/softphoneMachine.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 6: Commit**

```bash
cd "/Users/rmpgutah/RMPG Flex/.claude/worktrees/fix-dialer-3570ce"
git add client/package.json client/package-lock.json client/src/dialer/types.ts client/src/dialer/softphoneMachine.ts client/src/dialer/softphoneMachine.test.ts client/src/dialer/mockDevice.ts
git commit -m "feat(dialer): softphone state machine, device interfaces and mock device; add @twilio/voice-sdk

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: Client — `SoftphoneProvider` + `useSoftphone()`

**Files:**
- Create: `client/src/dialer/dialerFlags.ts`, `client/src/dialer/dialerApi.ts`, `client/src/dialer/SoftphoneProvider.tsx`
- Test: `client/src/dialer/SoftphoneProvider.test.tsx`

**Interfaces:**
- `isIframeDialerForced(): boolean` (localStorage `rmpg_dialer_iframe === '1'`), `IFRAME_DIALER_FLAG_KEY = 'rmpg_dialer_iframe'`.
- `dialerApi`: `fetchToken(): Promise<{ token; identity; expiresAt }>`, `heartbeat()`, `hold(callSid, hold)`, `transfer(callSid, targetDispatcherId)`, `addDispatcher(callSid, targetDispatcherId)`, `addParty(callSid, phoneNumber)`, `recording(callSid, action)`, `duress()`, `listPresence(): Promise<PresencePeer[]>` with `PresencePeer = { id: string; name: string; agency: string; dnd: boolean }`. All use `apiFetch`. Errors from `apiFetch` carry `.code` / `.status`.
- `SoftphoneProvider` props: `{ children; createDevice?: DeviceFactory; enabled?: boolean; role?: 'leader' | 'follower' }`. Context value `SoftphoneContextValue = SoftphoneSnapshot & { identity: string | null; dial(to: string, opts?: { blockCallerId?: boolean }): Promise<void>; answer(); reject(); hangup(); setMuted(m: boolean); toggleHold(): Promise<void>; sendDigits(d: string); transferBlind(targetDispatcherId: string): Promise<void>; transferWarm(targetDispatcherId: string): Promise<void>; addParty(phoneNumber: string): Promise<void>; toggleRecording(): Promise<void>; duress(): Promise<void>; retry(): void }`.
- `useSoftphone(): SoftphoneContextValue` (throws outside provider). `DIALER_PLACE_CALL_EVENT` from `DialerPanel` still triggers `dial()`.

- [ ] **Step 1: Write the failing test**

```tsx
// client/src/dialer/SoftphoneProvider.test.tsx
import { describe, test, expect, vi, beforeEach } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import { SoftphoneProvider, useSoftphone } from './SoftphoneProvider';
import { MockDevice } from './mockDevice';

const apiFetch = vi.fn();
vi.mock('../hooks/useApi', () => ({ apiFetch: (...a: unknown[]) => apiFetch(...a) }));

let device: MockDevice | null = null;
const createDevice = (token: string) => { device = new MockDevice(token); return device; };

function Probe() {
  const s = useSoftphone();
  return (
    <div>
      <span data-testid="status">{s.status}</span>
      <span data-testid="remote">{s.remoteNumber ?? ''}</span>
      <span data-testid="error">{s.error ?? ''}</span>
      <button onClick={() => s.dial('8015551212')}>dial</button>
      <button onClick={() => s.answer()}>answer</button>
      <button onClick={() => s.hangup()}>hangup</button>
      <button onClick={() => { void s.toggleHold(); }}>hold</button>
    </div>
  );
}
const renderProbe = () => render(<SoftphoneProvider createDevice={createDevice}><Probe /></SoftphoneProvider>);

beforeEach(() => {
  device = null;
  localStorage.clear();
  apiFetch.mockReset();
  apiFetch.mockImplementation(async (path: string) => {
    if (path === '/dialer/token') return { token: 'tok', identity: 'dispatcher_abc', expiresAt: new Date(Date.now() + 3600_000).toISOString() };
    if (path === '/dialer/presence/heartbeat') return { ok: true };
    if (path === '/dialer/voice/hold') return { status: 'held' };
    if (path === '/dialer-connect/events') return { ok: true };
    return {};
  });
});

describe('SoftphoneProvider', () => {
  test('fetches a token, registers the device and becomes ready', async () => {
    renderProbe();
    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('ready'));
    expect(device?.token).toBe('tok');
    expect(apiFetch).toHaveBeenCalledWith('/dialer/token', expect.objectContaining({ method: 'POST' }));
  });

  test('shows unlinked when the Worker returns dialer_unlinked', async () => {
    apiFetch.mockImplementation(async (path: string) => {
      if (path === '/dialer/token') { const e = Object.assign(new Error('not linked'), { status: 409, code: 'dialer_unlinked' }); throw e; }
      return {};
    });
    renderProbe();
    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('unlinked'));
    expect(device).toBeNull();
  });

  test('dials via Device.connect with To/DispatcherId and archives on disconnect', async () => {
    renderProbe();
    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('ready'));
    await act(async () => { screen.getByText('dial').click(); });
    expect(device!.connectParams).toEqual({ To: '+18015551212', DispatcherId: 'abc', CallerIdBlocked: 'false' });
    expect(screen.getByTestId('status').textContent).toBe('in_call');
    await act(async () => { device!.lastCall!.accept(); device!.lastCall!.disconnect(); });
    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('ready'));
    expect(apiFetch).toHaveBeenCalledWith('/dialer-connect/events', expect.objectContaining({
      method: 'POST', body: expect.stringContaining('"type":"call_status"'),
    }));
    const body = JSON.parse((apiFetch.mock.calls.find((c) => c[0] === '/dialer-connect/events')![1] as RequestInit).body as string);
    expect(body).toMatchObject({ type: 'call_status', status: 'completed', to: '+18015551212', callSid: 'CAoutbound' });
  });

  test('incoming call → incoming; answer → in_call; hold posts the caller CallSid', async () => {
    renderProbe();
    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('ready'));
    await act(async () => { device!.simulateIncoming('+18015550000', 'CAcaller1'); });
    expect(screen.getByTestId('status').textContent).toBe('incoming');
    expect(screen.getByTestId('remote').textContent).toBe('+18015550000');
    await act(async () => { screen.getByText('answer').click(); });
    expect(device!.lastCall!.accepted).toBe(true);
    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('in_call'));
    await act(async () => { screen.getByText('hold').click(); });
    await waitFor(() => expect(apiFetch).toHaveBeenCalledWith('/dialer/voice/hold', expect.objectContaining({ body: JSON.stringify({ callSid: 'CAcaller1', hold: true }) })));
  });

  test('does nothing when the iframe kill-switch is set', async () => {
    localStorage.setItem('rmpg_dialer_iframe', '1');
    renderProbe();
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.getByTestId('status').textContent).toBe('passive');
    expect(apiFetch).not.toHaveBeenCalledWith('/dialer/token', expect.anything());
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/dialer/SoftphoneProvider.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Create flags + api**

```ts
// client/src/dialer/dialerFlags.ts
export const IFRAME_DIALER_FLAG_KEY = 'rmpg_dialer_iframe';

/** Kill-switch: '1' restores the legacy Dial Connect iframe (no deploy needed). */
export function isIframeDialerForced(): boolean {
  if (typeof window === 'undefined') return false;
  try { return localStorage.getItem(IFRAME_DIALER_FLAG_KEY) === '1'; } catch { return false; }
}
```

```ts
// client/src/dialer/dialerApi.ts
import { apiFetch } from '../hooks/useApi';

export interface TokenResponse { token: string; identity: string; expiresAt: string }
export interface PresencePeer { id: string; name: string; agency: string; dnd: boolean }
export type DialerApiError = Error & { status?: number; code?: string };

const post = <T,>(path: string, body?: unknown) =>
  apiFetch<T>(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) });

export const dialerApi = {
  fetchToken: () => post<TokenResponse | { ok: false; code: 'not_configured' }>('/dialer/token'),
  heartbeat: () => post<{ ok: true }>('/dialer/presence/heartbeat'),
  listPresence: () => apiFetch<PresencePeer[]>('/dialer/presence'),
  hold: (callSid: string, hold: boolean) => post<{ status: string }>('/dialer/voice/hold', { callSid, hold }),
  transfer: (callSid: string, targetDispatcherId: string) => post<{ status: string }>('/dialer/voice/transfer', { callSid, targetDispatcherId }),
  addDispatcher: (callSid: string, targetDispatcherId: string) => post<{ status: string }>('/dialer/voice/conference/add-dispatcher', { callSid, targetDispatcherId }),
  addParty: (callSid: string, phoneNumber: string) => post<{ status: string }>('/dialer/voice/conference/add', { callSid, phoneNumber }),
  recording: (callSid: string, action: 'start' | 'stop') => post<{ status: string }>('/dialer/voice/recording', { callSid, action }),
  duress: () => post<{ ok?: boolean }>('/dialer/voice/duress', {}),
  archive: (payload: Record<string, unknown>) => post<unknown>('/dialer-connect/events', payload).catch(() => undefined),
};
```

- [ ] **Step 4: Create the provider**

```tsx
// client/src/dialer/SoftphoneProvider.tsx
import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef, type ReactNode } from 'react';
import { normalizeDialTarget, DIALER_PLACE_CALL_EVENT } from '../components/DialerPanel';
import { dialerApi, type DialerApiError } from './dialerApi';
import { isIframeDialerForced } from './dialerFlags';
import { INITIAL, reduce, type SoftphoneSnapshot } from './softphoneMachine';
import { controlCallSid, type DeviceFactory, type SoftphoneCall, type SoftphoneDevice } from './types';

const HEARTBEAT_MS = 30_000;
const TOKEN_REFRESH_LEAD_MS = 5 * 60_000;

export interface SoftphoneContextValue extends SoftphoneSnapshot {
  identity: string | null;
  dial(to: string, opts?: { blockCallerId?: boolean }): Promise<void>;
  answer(): void;
  reject(): void;
  hangup(): void;
  setMuted(muted: boolean): void;
  toggleHold(): Promise<void>;
  sendDigits(digits: string): void;
  transferBlind(targetDispatcherId: string): Promise<void>;
  transferWarm(targetDispatcherId: string): Promise<void>;
  addParty(phoneNumber: string): Promise<void>;
  toggleRecording(): Promise<void>;
  duress(): Promise<void>;
  retry(): void;
}

const Ctx = createContext<SoftphoneContextValue | null>(null);

async function realDeviceFactory(token: string): Promise<SoftphoneDevice> {
  const { Device } = await import('@twilio/voice-sdk');
  return new Device(token, { logLevel: 'error' }) as unknown as SoftphoneDevice;
}

export function SoftphoneProvider({ children, createDevice, enabled = true }: { children: ReactNode; createDevice?: DeviceFactory; enabled?: boolean }) {
  const [snap, dispatch] = useReducer(reduce, INITIAL);
  const deviceRef = useRef<SoftphoneDevice | null>(null);
  const activeCallRef = useRef<SoftphoneCall | null>(null);
  const waitingCallRef = useRef<SoftphoneCall | null>(null);
  const identityRef = useRef<string | null>(null);
  const expiresAtRef = useRef<number>(0);
  const refreshPendingRef = useRef(false);
  const startedAtRef = useRef<number>(0);
  const [, force] = useReducer((n: number) => n + 1, 0);

  const dispatcherId = () => identityRef.current?.replace(/^dispatcher_/, '') ?? '';

  const archive = useCallback((call: SoftphoneCall | null, status: string) => {
    if (!call) return;
    const callSid = call.parameters.CallSid ?? controlCallSid(call) ?? undefined;
    const from = call.parameters.From, to = call.parameters.To;
    const durationSeconds = startedAtRef.current ? Math.round((Date.now() - startedAtRef.current) / 1000) : undefined;
    void dialerApi.archive({ type: 'call_status', callSid, status, from, to, durationSeconds });
  }, []);

  const attachCall = useCallback((call: SoftphoneCall, direction: 'inbound' | 'outbound') => {
    activeCallRef.current = call;
    call.on('accept', () => {
      startedAtRef.current = Date.now();
      dispatch({ type: 'ACCEPTED', callSid: controlCallSid(call), connectedAt: startedAtRef.current });
    });
    call.on('mute', (muted: boolean) => dispatch({ type: 'MUTED', muted }));
    // Status is decided when the call ENDS: a call that was ever connected is
    // 'completed'; otherwise it's the fallback (missed for inbound, failed for
    // errors, completed for an outbound leg Twilio ended before 'accept').
    const end = (fallback: string) => () => {
      if (activeCallRef.current !== call) return;
      archive(call, startedAtRef.current ? 'completed' : fallback);
      activeCallRef.current = null;
      startedAtRef.current = 0;
      call.removeAllListeners();
      dispatch({ type: 'DISCONNECTED' });
      if (refreshPendingRef.current) { refreshPendingRef.current = false; void refreshToken(); }
    };
    call.on('disconnect', end(direction === 'outbound' ? 'completed' : 'missed'));
    call.on('cancel', end('missed'));
    call.on('reject', end('missed'));
    call.on('error', (err: Error) => { dispatch({ type: 'ERROR', message: err.message }); end('failed')(); });
  }, [archive]); // eslint-disable-line react-hooks/exhaustive-deps

  const refreshToken = useCallback(async () => {
    const res = await dialerApi.fetchToken();
    if ('ok' in res && res.ok === false) throw Object.assign(new Error('Dial Connect not configured'), { code: 'not_configured' });
    identityRef.current = res.identity;
    expiresAtRef.current = Date.parse(res.expiresAt);
    deviceRef.current?.updateToken(res.token);
    return res.token;
  }, []);

  const register = useCallback(async () => {
    if (!enabled || isIframeDialerForced()) { dispatch({ type: 'PASSIVE' }); return; }
    dispatch({ type: 'REGISTERING' });
    let token: string;
    try {
      token = await refreshToken();
    } catch (err) {
      const e = err as DialerApiError;
      if (e.code === 'dialer_unlinked') { dispatch({ type: 'UNLINKED' }); return; }
      dispatch({ type: 'ERROR', message: e.code === 'not_configured' ? 'Dial Connect is not configured' : e.message || 'Could not reach Dial Connect' });
      return;
    }
    const device = createDevice ? createDevice(token) : await realDeviceFactory(token);
    deviceRef.current = device;
    device.on('registered', () => dispatch({ type: 'REGISTERED' }));
    device.on('error', (err: Error) => dispatch({ type: 'ERROR', message: err.message }));
    device.on('incoming', (call: SoftphoneCall) => {
      const from = call.parameters.From ?? call.customParameters.get('To') ?? 'unknown';
      if (activeCallRef.current) {
        waitingCallRef.current = call;
        call.on('cancel', () => { waitingCallRef.current = null; dispatch({ type: 'WAITING_CANCELLED' }); });
        dispatch({ type: 'INCOMING', from, callSid: controlCallSid(call) });
        return;
      }
      attachCall(call, 'inbound');
      dispatch({ type: 'INCOMING', from, callSid: controlCallSid(call) });
    });
    try { await device.register(); } catch (err) { dispatch({ type: 'ERROR', message: (err as Error).message }); }
  }, [enabled, createDevice, refreshToken, attachCall]);

  useEffect(() => {
    void register();
    return () => { deviceRef.current?.destroy(); deviceRef.current = null; };
  }, [register]);

  // Presence heartbeat + proactive token refresh (deferred while a call is live).
  useEffect(() => {
    const id = setInterval(() => {
      if (!deviceRef.current) return;
      void dialerApi.heartbeat().catch(() => undefined);
      if (expiresAtRef.current && Date.now() > expiresAtRef.current - TOKEN_REFRESH_LEAD_MS) {
        if (activeCallRef.current) refreshPendingRef.current = true;
        else void refreshToken().catch(() => undefined);
      }
    }, HEARTBEAT_MS);
    return () => clearInterval(id);
  }, [refreshToken]);

  const dial = useCallback(async (raw: string, opts?: { blockCallerId?: boolean }) => {
    const device = deviceRef.current;
    const to = normalizeDialTarget(raw);
    if (!device || !to || activeCallRef.current) return;
    dispatch({ type: 'DIALING', to });
    const call = await device.connect({ params: { To: to, DispatcherId: dispatcherId(), CallerIdBlocked: opts?.blockCallerId ? 'true' : 'false' } });
    call.parameters.To = call.parameters.To ?? to;
    attachCall(call, 'outbound');
  }, [attachCall]);

  useEffect(() => {
    const onPlace = (event: Event) => {
      const to = (event as CustomEvent<{ to?: string }>).detail?.to;
      if (typeof to === 'string') void dial(to);
    };
    window.addEventListener(DIALER_PLACE_CALL_EVENT, onPlace);
    return () => window.removeEventListener(DIALER_PLACE_CALL_EVENT, onPlace);
  }, [dial]);

  const withSid = useCallback(async (fn: (sid: string) => Promise<unknown>) => {
    const sid = controlCallSid(activeCallRef.current);
    if (!sid) return;
    try { await fn(sid); } catch (err) { dispatch({ type: 'ERROR', message: (err as Error).message }); }
  }, []);

  const value = useMemo<SoftphoneContextValue>(() => ({
    ...snap,
    identity: identityRef.current,
    dial,
    answer: () => {
      const waiting = waitingCallRef.current;
      if (waiting && activeCallRef.current) { activeCallRef.current.disconnect(); waitingCallRef.current = null; attachCall(waiting, 'inbound'); waiting.accept(); return; }
      activeCallRef.current?.accept();
    },
    reject: () => { (waitingCallRef.current ?? activeCallRef.current)?.reject(); },
    hangup: () => activeCallRef.current?.disconnect(),
    setMuted: (m) => activeCallRef.current?.mute(m),
    sendDigits: (d) => activeCallRef.current?.sendDigits(d),
    toggleHold: () => withSid(async (sid) => { await dialerApi.hold(sid, !snap.held); dispatch({ type: 'HELD', held: !snap.held }); }),
    transferBlind: (target) => withSid((sid) => dialerApi.transfer(sid, target)),
    transferWarm: (target) => withSid((sid) => dialerApi.addDispatcher(sid, target)),
    addParty: (phone) => withSid((sid) => dialerApi.addParty(sid, phone)),
    toggleRecording: () => withSid(async (sid) => { await dialerApi.recording(sid, snap.recording ? 'stop' : 'start'); dispatch({ type: 'RECORDING', recording: !snap.recording }); }),
    duress: async () => { try { await dialerApi.duress(); } catch (err) { dispatch({ type: 'ERROR', message: (err as Error).message }); } },
    retry: () => { deviceRef.current?.destroy(); deviceRef.current = null; dispatch({ type: 'RESET' }); force(); void register(); },
  }), [snap, dial, withSid, attachCall, register]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSoftphone(): SoftphoneContextValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useSoftphone must be used inside <SoftphoneProvider>');
  return v;
}
```

- [ ] **Step 5: Run the test**

Run: `npx vitest run src/dialer/SoftphoneProvider.test.tsx src/dialer/softphoneMachine.test.ts`
Expected: PASS (10 tests). If the "archives on disconnect" test reports `status: 'missed'`, the `accept` handler ran after `disconnect` in the mock — the test calls `accept()` first, so `startedAtRef` is set; verify `end()` reads it before clearing.

- [ ] **Step 6: Commit**

```bash
git add client/src/dialer/dialerFlags.ts client/src/dialer/dialerApi.ts client/src/dialer/SoftphoneProvider.tsx client/src/dialer/SoftphoneProvider.test.tsx
git commit -m "feat(dialer): SoftphoneProvider — Twilio Device lifecycle, token refresh, heartbeat, controls, archive events

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8: Client — event stream, global toasts, `DialerMount` kill-switch

**Files:**
- Create: `client/src/dialer/useDialerStream.ts`, `client/src/dialer/IncomingCallToast.tsx`, `client/src/dialer/DuressBanner.tsx`, `client/src/dialer/DialerMount.tsx`
- Modify: `client/src/components/Layout.tsx:1898-1905`
- Test: `client/src/dialer/DialerMount.test.tsx`

**Interfaces:**
- `useDialerStream(onEvent: (e: DialerStreamEvent) => void)`; `DialerStreamEvent = { type: 'call_status'; callSid: string; status: string } | { type: 'duress_alert'; dispatcherName: string; timestamp?: string } | { type: string; [k: string]: unknown }`.
- `DialerMount` renders `<DialerPanel/>` (legacy) when `isIframeDialerForced()`, else `<SoftphoneProvider><IncomingCallToast/><DuressBanner/>{children}</SoftphoneProvider>`.

- [ ] **Step 1: Write the failing test**

```tsx
// client/src/dialer/DialerMount.test.tsx
import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import DialerMount from './DialerMount';

vi.mock('../components/DialerPanel', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('../components/DialerPanel');
  return { ...actual, default: () => <div data-testid="legacy-iframe-panel" /> };
});
vi.mock('../hooks/useApi', () => ({ apiFetch: vi.fn(async () => { const e = Object.assign(new Error('x'), { status: 409, code: 'dialer_unlinked' }); throw e; }) }));

beforeEach(() => localStorage.clear());

describe('DialerMount', () => {
  test('mounts the legacy iframe panel when rmpg_dialer_iframe=1', () => {
    localStorage.setItem('rmpg_dialer_iframe', '1');
    render(<MemoryRouter><DialerMount><span>page</span></DialerMount></MemoryRouter>);
    expect(screen.getByTestId('legacy-iframe-panel')).toBeInTheDocument();
    expect(screen.getByText('page')).toBeInTheDocument();
  });

  test('mounts the native softphone provider by default (no iframe)', async () => {
    render(<MemoryRouter><DialerMount><span>page</span></DialerMount></MemoryRouter>);
    expect(screen.queryByTestId('legacy-iframe-panel')).not.toBeInTheDocument();
    expect(screen.getByText('page')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/dialer/DialerMount.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// client/src/dialer/useDialerStream.ts
import { useEffect, useRef } from 'react';
import { getApiBase } from '../hooks/useApi';

export type DialerStreamEvent =
  | { type: 'call_status'; callSid: string; status: string }
  | { type: 'duress_alert'; dispatcherName: string; timestamp?: string }
  | { type: string; [k: string]: unknown };

const BACKOFF_MS = [1_000, 2_000, 5_000, 10_000, 30_000];

/** One SSE connection to /api/dialer/stream with reconnect backoff. */
export function useDialerStream(onEvent: (e: DialerStreamEvent) => void, enabled = true) {
  const handler = useRef(onEvent);
  handler.current = onEvent;
  useEffect(() => {
    if (!enabled || typeof EventSource === 'undefined') return;
    let source: EventSource | null = null;
    let attempt = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let closed = false;
    const open = () => {
      source = new EventSource(`${getApiBase()}/api/dialer/stream`, { withCredentials: true });
      source.onopen = () => { attempt = 0; };
      source.onmessage = (ev) => {
        try { handler.current(JSON.parse(ev.data) as DialerStreamEvent); } catch { /* keepalive / non-JSON */ }
      };
      source.onerror = () => {
        source?.close();
        if (closed) return;
        timer = setTimeout(open, BACKOFF_MS[Math.min(attempt++, BACKOFF_MS.length - 1)]);
      };
    };
    open();
    return () => { closed = true; source?.close(); if (timer) clearTimeout(timer); };
  }, [enabled]);
}
```

If `getApiBase` does not exist in `useApi.ts`, add next to `apiFetch`:

```ts
/** Absolute API origin (no trailing slash) for non-fetch consumers such as EventSource. */
export function getApiBase(): string {
  return maybeRedirectToCfWorker('/api').replace(/\/api$/, '');
}
```

```tsx
// client/src/dialer/IncomingCallToast.tsx
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { PhoneCall, X } from 'lucide-react';
import { useSoftphone } from './SoftphoneProvider';
import { DIALER_CONNECT_PATH } from '../components/dialerConnect';
import { displayPhone } from '../utils/dialerConnect';

export default function IncomingCallToast() {
  const s = useSoftphone();
  const navigate = useNavigate();
  const [dismissed, setDismissed] = useState<string | null>(null);
  const ringing = s.status === 'incoming' || s.status === 'call_waiting';
  const from = s.status === 'call_waiting' ? s.waitingFrom : s.remoteNumber;
  useEffect(() => { if (!ringing) setDismissed(null); }, [ringing]);
  if (!ringing || dismissed === from) return null;
  return (
    <div className="fixed bottom-4 left-4 z-[9998] flex items-center gap-2 px-3 py-2 border shadow-lg text-[11px] font-semibold uppercase tracking-wide max-w-[320px] bg-surface-raised text-rmpg-50"
      style={{ borderColor: 'var(--sev-ok)' }} role="status">
      <PhoneCall className="w-3.5 h-3.5 flex-shrink-0" />
      <button type="button" className="truncate text-left" onClick={() => navigate(DIALER_CONNECT_PATH)}>
        Inbound call from {displayPhone(from)}
      </button>
      <button type="button" aria-label="Answer" className="ml-1 px-2 py-0.5 border" style={{ color: 'var(--sev-ok)', borderColor: 'var(--sev-ok)' }} onClick={() => { s.answer(); navigate(DIALER_CONNECT_PATH); }}>Answer</button>
      <button type="button" aria-label="Dismiss notification" className="ml-auto opacity-70 hover:opacity-100" onClick={() => setDismissed(from)}><X className="w-3 h-3" /></button>
    </div>
  );
}
```

```tsx
// client/src/dialer/DuressBanner.tsx
import { useState } from 'react';
import { AlertTriangle, X } from 'lucide-react';
import { useDialerStream } from './useDialerStream';
import { useSoftphone } from './SoftphoneProvider';

export default function DuressBanner() {
  const s = useSoftphone();
  const [alert, setAlert] = useState<{ name: string; at: string } | null>(null);
  useDialerStream((e) => {
    if (e.type === 'duress_alert') setAlert({ name: String((e as { dispatcherName?: string }).dispatcherName ?? 'A dispatcher'), at: new Date().toLocaleTimeString() });
  }, s.status !== 'passive' && s.status !== 'unlinked' && s.status !== 'offline');
  if (!alert) return null;
  return (
    <div className="fixed top-0 inset-x-0 z-[9999] flex items-center gap-2 px-3 py-2 text-[12px] font-bold uppercase tracking-wide"
      style={{ background: 'var(--sev-critical)', color: 'var(--text-primary)' }} role="alert">
      <AlertTriangle className="w-4 h-4" /> Duress alert: {alert.name} · {alert.at}
      <button type="button" aria-label="Dismiss duress alert" className="ml-auto" onClick={() => setAlert(null)}><X className="w-4 h-4" /></button>
    </div>
  );
}
```

```tsx
// client/src/dialer/DialerMount.tsx
import React, { type ReactNode } from 'react';
import { lazyRetry } from '../utils/importWithRetry';
import { isIframeDialerForced } from './dialerFlags';
import { SoftphoneProvider } from './SoftphoneProvider';
import IncomingCallToast from './IncomingCallToast';
import DuressBanner from './DuressBanner';

const DialerPanel = lazyRetry(() => import('../components/DialerPanel'));

/** Native softphone by default; `rmpg_dialer_iframe=1` restores the legacy iframe. */
export default function DialerMount({ children }: { children: ReactNode }) {
  if (isIframeDialerForced()) {
    return (
      <>
        {children}
        <React.Suspense fallback={null}><DialerPanel /></React.Suspense>
      </>
    );
  }
  return (
    <SoftphoneProvider>
      {children}
      <IncomingCallToast />
      <DuressBanner />
    </SoftphoneProvider>
  );
}
```

`client/src/components/Layout.tsx`: remove the `const DialerPanel = lazyRetry(...)` line (line 118) and the `<React.Suspense fallback={null}><DialerPanel /></React.Suspense>` block (≈1898-1905), add `import DialerMount from '../dialer/DialerMount';`, and wrap the outermost returned element of `Layout`'s JSX: replace `return (\n    <div` with `return (\n    <DialerMount>\n    <div` and the matching closing `</div>\n  );` with `</div>\n    </DialerMount>\n  );`. (Search for the `{/* Dialer — always-on /dialer iframe` comment to locate the block.)

- [ ] **Step 4: Run tests + typecheck**

Run: `npx tsc --noEmit && npx vitest run src/dialer src/components/Layout.test.tsx src/pages/DialerConnectPage.test.tsx`
Expected: tsc clean; DialerMount 2 tests PASS; existing Layout/DialerConnectPage tests PASS (they mock `useApi`; the provider goes to `error`/`unlinked` silently).

- [ ] **Step 5: Commit**

```bash
git add client/src/dialer client/src/components/Layout.tsx client/src/hooks/useApi.ts
git commit -m "feat(dialer): native softphone mount with iframe kill-switch, incoming-call toast, duress banner, SSE stream hook

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 9: Client — `SoftphoneCard`, `LinkDialerGate`, `TransferPicker`; wire into `DialerConnectPage`

**Files:**
- Create: `client/src/dialer/SoftphoneCard.tsx`, `client/src/dialer/LinkDialerGate.tsx`, `client/src/dialer/TransferPicker.tsx`
- Modify: `client/src/pages/DialerConnectPage.tsx` (DialerTab: replace the Softphone `<Card id="dc-keypad">` block at lines 421-514; wrap-up prefill; `jump` targets)
- Test: `client/src/dialer/SoftphoneCard.test.tsx`, update `client/src/pages/DialerConnectPage.test.tsx`

**Interfaces:**
- `SoftphoneCard` props: `{ digits: string; onDigitsChange(d: string): void; dtmfMode: boolean; onDtmfModeChange(v: boolean): void; onToneSent(d: string): void }` — keeps number entry state in the page so Caller lookup / wrap-up keep reading `digits`.
- `TransferPicker` props: `{ mode: 'blind' | 'warm'; onPick(targetDispatcherId: string): void; onClose(): void }` — lists `dialerApi.listPresence()`.
- `LinkDialerGate` props: none; links to `/api/oidc/dialer/login?returnTo=/dialer-connect` via `getApiBase()`.

- [ ] **Step 1: Write the failing test**

```tsx
// client/src/dialer/SoftphoneCard.test.tsx
import { useState } from 'react';
import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, act, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { SoftphoneProvider } from './SoftphoneProvider';
import SoftphoneCard from './SoftphoneCard';
import { MockDevice } from './mockDevice';

const apiFetch = vi.fn();
vi.mock('../hooks/useApi', () => ({ apiFetch: (...a: unknown[]) => apiFetch(...a), getApiBase: () => 'http://api.test' }));

let device: MockDevice | null = null;
function Host() {
  const [digits, setDigits] = useState('');
  const [dtmf, setDtmf] = useState(false);
  return <SoftphoneCard digits={digits} onDigitsChange={setDigits} dtmfMode={dtmf} onDtmfModeChange={setDtmf} onToneSent={() => {}} />;
}
const renderCard = () => render(
  <MemoryRouter>
    <SoftphoneProvider createDevice={(t) => { device = new MockDevice(t); return device; }}><Host /></SoftphoneProvider>
  </MemoryRouter>,
);

beforeEach(() => {
  device = null; localStorage.clear(); apiFetch.mockReset();
  apiFetch.mockImplementation(async (path: string) => {
    if (path === '/dialer/token') return { token: 'tok', identity: 'dispatcher_abc', expiresAt: new Date(Date.now() + 3600_000).toISOString() };
    if (path === '/dialer/presence') return [{ id: 'peer1', name: 'Pat Peer', agency: 'all', dnd: false }];
    return { status: 'ok' };
  });
});

describe('SoftphoneCard', () => {
  test('keypad builds the number and Call connects the device', async () => {
    const user = userEvent.setup();
    renderCard();
    await waitFor(() => expect(screen.getByText(/ready/i)).toBeInTheDocument());
    for (const k of ['8', '0', '1', '5', '5', '5', '1', '2', '1', '2']) await user.click(screen.getByRole('button', { name: `Key ${k}` }));
    await user.click(screen.getByRole('button', { name: /^call$/i }));
    expect(device!.connectParams?.To).toBe('+18015551212');
    expect(screen.getByRole('button', { name: /hang up/i })).toBeEnabled();
  });

  test('incoming shows Answer/Reject; Answer accepts; Mute/Hold/Record/DTMF act on the live call', async () => {
    const user = userEvent.setup();
    renderCard();
    await waitFor(() => expect(screen.getByText(/ready/i)).toBeInTheDocument());
    await act(async () => { device!.simulateIncoming('+18015550000', 'CAcaller1'); });
    expect(screen.getByRole('button', { name: /reject/i })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /^answer$/i }));
    expect(device!.lastCall!.accepted).toBe(true);
    await user.click(screen.getByRole('button', { name: /^mute$/i }));
    expect(device!.lastCall!.muted).toBe(true);
    await user.click(screen.getByRole('button', { name: /^hold$/i }));
    await waitFor(() => expect(apiFetch).toHaveBeenCalledWith('/dialer/voice/hold', expect.objectContaining({ body: JSON.stringify({ callSid: 'CAcaller1', hold: true }) })));
    await user.click(screen.getByRole('button', { name: /^record$/i }));
    await waitFor(() => expect(apiFetch).toHaveBeenCalledWith('/dialer/voice/recording', expect.objectContaining({ body: JSON.stringify({ callSid: 'CAcaller1', action: 'start' }) })));
    await user.click(screen.getByRole('button', { name: /dtmf mode|dial mode/i }));
    await user.click(screen.getByRole('button', { name: 'Key 5' }));
    expect(device!.lastCall!.digits).toBe('5');
  });

  test('warm transfer picks a peer and posts add-dispatcher', async () => {
    const user = userEvent.setup();
    renderCard();
    await waitFor(() => expect(screen.getByText(/ready/i)).toBeInTheDocument());
    await act(async () => { device!.simulateIncoming('+18015550000', 'CAcaller1'); });
    await user.click(screen.getByRole('button', { name: /^answer$/i }));
    await user.click(screen.getByRole('button', { name: /^transfer$/i }));
    await user.click(await screen.findByRole('button', { name: /warm/i }));
    await user.click(await screen.findByRole('button', { name: /pat peer/i }));
    await waitFor(() => expect(apiFetch).toHaveBeenCalledWith('/dialer/voice/conference/add-dispatcher', expect.objectContaining({ body: JSON.stringify({ callSid: 'CAcaller1', targetDispatcherId: 'peer1' }) })));
  });

  test('unlinked shows the Link Dial Connect gate instead of the keypad', async () => {
    apiFetch.mockImplementation(async (path: string) => { if (path === '/dialer/token') throw Object.assign(new Error('x'), { status: 409, code: 'dialer_unlinked' }); return {}; });
    renderCard();
    expect(await screen.findByRole('link', { name: /sign in with dialer/i })).toHaveAttribute('href', 'http://api.test/api/oidc/dialer/login?returnTo=%2Fdialer-connect');
    expect(screen.queryByRole('button', { name: 'Key 1' })).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/dialer/SoftphoneCard.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Create the components**

```tsx
// client/src/dialer/LinkDialerGate.tsx
import { Link2 } from 'lucide-react';
import { getApiBase } from '../hooks/useApi';

export default function LinkDialerGate() {
  const href = `${getApiBase()}/api/oidc/dialer/login?returnTo=${encodeURIComponent('/dialer-connect')}`;
  return (
    <div className="bg-surface-sunken border border-border-subtle p-4 space-y-3 text-[11px] text-rmpg-100" role="status">
      <div className="text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--panel-header-color)' }}>Link Dial Connect</div>
      <p className="text-fg-secondary">
        Calls ring the Dial Connect dispatcher account tied to your Flex login. Your account is not linked yet —
        sign in with your Dial Connect e-mail once and this softphone will register automatically.
      </p>
      <a href={href} className="inline-flex items-center gap-1.5 px-3 py-1.5 border border-accent-silver-500/60 text-rmpg-50 hover:bg-surface-hover text-[10px] font-semibold uppercase tracking-wide">
        <Link2 className="w-3 h-3" /> Sign in with Dialer
      </a>
    </div>
  );
}
```

```tsx
// client/src/dialer/TransferPicker.tsx
import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { dialerApi, type PresencePeer } from './dialerApi';

export default function TransferPicker({ mode, onPick, onClose }: { mode: 'blind' | 'warm'; onPick(targetDispatcherId: string): void; onClose(): void }) {
  const [peers, setPeers] = useState<PresencePeer[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { dialerApi.listPresence().then(setPeers).catch((e) => setError(e instanceof Error ? e.message : 'Could not load dispatchers')); }, []);
  return (
    <div className="bg-surface-sunken border border-border-subtle p-2 space-y-1" role="dialog" aria-label={`${mode} transfer`}>
      <div className="flex items-center justify-between text-[9px] uppercase tracking-widest text-fg-muted">
        <span>{mode === 'warm' ? 'Warm transfer — announce, then hang up' : 'Blind transfer — caller moves immediately'}</span>
        <button type="button" aria-label="Close transfer picker" onClick={onClose}><X className="w-3 h-3" /></button>
      </div>
      {error && <div className="text-[10px]" style={{ color: 'var(--sev-critical)' }}>{error}</div>}
      {peers && peers.length === 0 && <div className="text-[10px] text-fg-muted">No other dispatchers are online.</div>}
      {peers?.map((p) => (
        <button key={p.id} type="button" disabled={p.dnd} onClick={() => onPick(p.id)}
          className="w-full text-left px-2 py-1 text-[11px] text-rmpg-100 hover:bg-surface-hover disabled:opacity-40 flex items-center justify-between">
          <span>{p.name}</span><span className="text-[9px] text-fg-muted">{p.dnd ? 'DND' : p.agency}</span>
        </button>
      ))}
    </div>
  );
}
```

```tsx
// client/src/dialer/SoftphoneCard.tsx
import { useEffect, useState, type ReactNode } from 'react';
import { Delete, Disc, ExternalLink, Hash, MicOff, Pause as PauseIcon, PhoneCall, PhoneForwarded, PhoneIncoming, PhoneOff, Users } from 'lucide-react';
import { useSoftphone } from './SoftphoneProvider';
import LinkDialerGate from './LinkDialerGate';
import TransferPicker from './TransferPicker';
import { normalizeDialTarget, openDialerWindow } from '../components/DialerPanel';
import { displayPhone } from '../utils/dialerConnect';

const KEYPAD: ReadonlyArray<{ d: string; sub: string }> = [
  { d: '1', sub: '' }, { d: '2', sub: 'ABC' }, { d: '3', sub: 'DEF' },
  { d: '4', sub: 'GHI' }, { d: '5', sub: 'JKL' }, { d: '6', sub: 'MNO' },
  { d: '7', sub: 'PQRS' }, { d: '8', sub: 'TUV' }, { d: '9', sub: 'WXYZ' },
  { d: '*', sub: '' }, { d: '0', sub: '+' }, { d: '#', sub: '' },
];
const BTN = 'text-[9px] font-semibold uppercase tracking-wide border border-border-subtle py-1.5 px-2 text-rmpg-200 hover:text-rmpg-50 hover:bg-surface-hover hover:border-rmpg-500 flex items-center justify-center gap-1 disabled:opacity-40 disabled:cursor-not-allowed';
type Sev = 'ok' | 'critical' | 'warn';
const sevStyle = (sev: Sev, active = true) => active ? { color: `var(--sev-${sev})`, background: `rgb(var(--sev-${sev}-rgb) / 0.16)`, borderColor: `rgb(var(--sev-${sev}-rgb) / 0.45)` } : undefined;

function Header({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <div className="text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--panel-header-color)' }}>{children}</div>
      {right}
    </div>
  );
}

function useTimer(since: number | null): string {
  const [, tick] = useState(0);
  useEffect(() => { if (!since) return; const id = setInterval(() => tick((n) => n + 1), 1000); return () => clearInterval(id); }, [since]);
  if (!since) return '';
  const s = Math.floor((Date.now() - since) / 1000);
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

const STATUS_LABEL: Record<string, string> = {
  offline: 'Offline', unlinked: 'Not linked', passive: 'Active in another window', registering: 'Registering…',
  ready: 'Ready', incoming: 'Incoming call', in_call: 'In call', call_waiting: 'Call waiting', error: 'Error',
};

export default function SoftphoneCard({ digits, onDigitsChange, dtmfMode, onDtmfModeChange, onToneSent }: {
  digits: string; onDigitsChange(d: string): void; dtmfMode: boolean; onDtmfModeChange(v: boolean): void; onToneSent(d: string): void;
}) {
  const s = useSoftphone();
  const [picker, setPicker] = useState<'menu' | 'blind' | 'warm' | 'party' | null>(null);
  const [blockCallerId, setBlockCallerId] = useState(false);
  const timer = useTimer(s.connectedAt);
  const target = normalizeDialTarget(digits);
  const live = s.status === 'in_call' || s.status === 'call_waiting';
  const ringing = s.status === 'incoming' || s.status === 'call_waiting';
  const canDial = s.status === 'ready' && Boolean(target);

  const pressKey = (d: string) => {
    if (dtmfMode && live) { s.sendDigits(d); onToneSent(d); return; }
    onDigitsChange(digits + d);
  };

  const statusColor = s.status === 'ready' || live ? 'var(--sev-ok)' : s.status === 'error' ? 'var(--sev-critical)' : ringing ? 'var(--sev-warn)' : 'var(--text-muted)';

  return (
    <section id="dc-keypad" className="bg-surface-raised border border-border-subtle p-3 space-y-2">
      <Header right={(
        <button type="button" onClick={() => onDtmfModeChange(!dtmfMode)} aria-pressed={dtmfMode} className={`${BTN} py-0.5`} style={sevStyle('warn', dtmfMode)}
          title="Toggle keypad between dialing a number and sending in-call DTMF tones">
          <Hash className="w-3 h-3" /> {dtmfMode ? 'DTMF mode' : 'Dial mode'}
        </button>
      )}>Softphone</Header>

      <div className="flex items-center gap-2 text-[10px] font-mono">
        <span className={`inline-block w-2 h-2 rounded-full ${s.status === 'ready' || live ? 'animate-pulse' : ''}`} style={{ background: statusColor }} />
        <span className="text-rmpg-100">{STATUS_LABEL[s.status] ?? s.status}</span>
        {live && <span className="text-fg-secondary">{displayPhone(s.remoteNumber)} · {timer}</span>}
        {s.status === 'call_waiting' && <span style={{ color: 'var(--sev-warn)' }}>waiting: {displayPhone(s.waitingFrom)}</span>}
        {(s.status === 'error') && <button type="button" className="ml-auto uppercase text-[9px] border border-border-subtle px-1.5" onClick={s.retry}>Retry</button>}
      </div>
      {s.error && <div className="text-[10px]" style={{ color: 'var(--sev-critical)' }} role="alert">{s.error}</div>}

      {s.status === 'unlinked' ? <LinkDialerGate /> : (
        <>
          <div className="bg-surface-sunken border border-border-subtle px-3 py-2">
            <div className="text-[9px] uppercase tracking-widest text-fg-muted flex items-center justify-between">
              <span>{dtmfMode ? 'Sending tones' : 'Number'}</span>
              {target && !dtmfMode && <span className="font-mono normal-case tracking-normal">{target}</span>}
            </div>
            <div className="flex items-center gap-2">
              <input value={digits} onChange={(e) => onDigitsChange(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && canDial) { e.preventDefault(); void s.dial(digits, { blockCallerId }); } }}
                placeholder="Enter number" inputMode="tel" aria-label="Dial number"
                className="flex-1 min-w-0 bg-transparent border-0 p-0 font-mono text-xl text-rmpg-50 placeholder-fg-muted focus:outline-none" />
              <button type="button" aria-label="Backspace" className="p-1 text-fg-secondary hover:text-rmpg-100 disabled:opacity-30" disabled={!digits} onClick={() => onDigitsChange(digits.slice(0, -1))}><Delete className="w-4 h-4" /></button>
              <button type="button" aria-label="Clear number" className="text-[9px] uppercase text-fg-muted hover:text-rmpg-100 disabled:opacity-30" disabled={!digits} onClick={() => onDigitsChange('')}>Clear</button>
            </div>
            {digits && !dtmfMode && <div className="text-[11px] font-mono text-fg-secondary">{displayPhone(target)}</div>}
          </div>

          <div className="grid grid-cols-3 gap-1.5">
            {KEYPAD.map(({ d, sub }) => (
              <button key={d} type="button" aria-label={`Key ${d}`} onClick={() => pressKey(d)}
                className="h-11 bg-surface-base border border-border-subtle text-rmpg-50 hover:bg-surface-hover hover:border-rmpg-500 active:bg-surface-overlay flex flex-col items-center justify-center leading-none">
                <span className="font-mono text-base">{d}</span>
                <span className="text-[7px] tracking-[0.2em] text-fg-muted h-2">{sub}</span>
              </button>
            ))}
          </div>

          <div className="grid grid-cols-2 gap-1.5">
            {ringing ? (
              <>
                <button type="button" onClick={s.answer} className={`${BTN} py-2 text-[10px] font-bold`} style={sevStyle('ok')}><PhoneIncoming className="w-3.5 h-3.5" /> Answer</button>
                <button type="button" onClick={s.reject} className={`${BTN} py-2 text-[10px] font-bold`} style={sevStyle('critical')}><PhoneOff className="w-3.5 h-3.5" /> Reject</button>
              </>
            ) : (
              <>
                <button type="button" disabled={!canDial} onClick={() => { void s.dial(digits, { blockCallerId }); }} className={`${BTN} py-2 text-[10px] font-bold`} style={sevStyle('ok', canDial)}><PhoneCall className="w-3.5 h-3.5" /> Call</button>
                <button type="button" disabled={!live} onClick={s.hangup} className={`${BTN} py-2 text-[10px] font-bold`} style={sevStyle('critical', live)}><PhoneOff className="w-3.5 h-3.5" /> Hang up</button>
              </>
            )}
          </div>

          <div className="grid grid-cols-3 gap-1.5">
            <button type="button" disabled={!live} aria-pressed={s.muted} onClick={() => s.setMuted(!s.muted)} className={BTN} style={sevStyle('warn', s.muted)}><MicOff className="w-3 h-3" /> {s.muted ? 'Unmute' : 'Mute'}</button>
            <button type="button" disabled={!live} aria-pressed={s.held} onClick={() => { void s.toggleHold(); }} className={BTN} style={sevStyle('warn', s.held)}><PauseIcon className="w-3 h-3" /> {s.held ? 'Resume' : 'Hold'}</button>
            <button type="button" disabled={!live} aria-pressed={s.recording} onClick={() => { void s.toggleRecording(); }} className={BTN} style={sevStyle('critical', s.recording)}><Disc className="w-3 h-3" /> {s.recording ? 'Stop rec' : 'Record'}</button>
            <button type="button" disabled={!live} onClick={() => setPicker(picker === 'menu' ? null : 'menu')} className={BTN} title="Transfer the live call to another dispatcher"><PhoneForwarded className="w-3 h-3" /> Transfer</button>
            <button type="button" disabled={!live || !target} onClick={() => { void s.addParty(target); }} className={BTN} title="Add the number entered above to the live call"><Users className="w-3 h-3" /> Conference</button>
            <button type="button" onClick={() => openDialerWindow()} className={BTN} title="Open the softphone in its own window"><ExternalLink className="w-3 h-3" /> Pop out</button>
          </div>

          {picker === 'menu' && (
            <div className="flex gap-1.5">
              <button type="button" className={`${BTN} flex-1`} onClick={() => setPicker('blind')}>Blind transfer</button>
              <button type="button" className={`${BTN} flex-1`} onClick={() => setPicker('warm')}>Warm transfer</button>
            </div>
          )}
          {(picker === 'blind' || picker === 'warm') && (
            <TransferPicker mode={picker} onClose={() => setPicker(null)}
              onPick={(id) => { void (picker === 'blind' ? s.transferBlind(id) : s.transferWarm(id)); setPicker(null); }} />
          )}

          <label className="flex items-center gap-1.5 text-[9px] uppercase tracking-wide text-fg-muted">
            <input type="checkbox" checked={blockCallerId} onChange={(e) => setBlockCallerId(e.target.checked)} /> Block caller ID (*67)
          </label>
        </>
      )}
    </section>
  );
}
```

- [ ] **Step 4: Wire into `DialerConnectPage.tsx`**

In `DialerTab`:
1. Add `import SoftphoneCard from '../dialer/SoftphoneCard';` and `import { useSoftphone } from '../dialer/SoftphoneProvider';`.
2. Delete the `muted`, `held`, `recording` state lines (323-325) and the whole `<Card id="dc-keypad"> … </Card>` block (lines 421-514). In its place render:

```tsx
        <SoftphoneCard
          digits={digits}
          onDigitsChange={setDigits}
          dtmfMode={dtmfMode}
          onDtmfModeChange={setDtmfMode}
          onToneSent={(d) => setDtmfLog((p) => p + d)}
        />
```

3. Replace `place` so the Call path is the provider (keep the toast):

```tsx
  const softphone = useSoftphone();
  const place = (raw: string) => {
    const to = normalizeDialTarget(raw);
    if (!to) { addToast('Enter a valid number', 'error'); return; }
    void softphone.dial(to);
    addToast(`Dialing ${displayPhone(to)}`, 'success');
  };
```

and delete the `send` helper and `pressKey` (the card owns them). Remove the now-unused imports (`postToDialer`, `Delete`, `PhoneForwarded`, `Users`, `Disc`, `PauseIcon`, `ExternalLink`, `MicOff`, `PhoneOff`, `Hash`, `KEYPAD`, `sevStyle` if unused elsewhere — keep `Card`, `SectionHeader`, `BTN`, `FIELD`).

4. Wrap-up prefill: in `logCall`, replace the POST body with

```tsx
        body: JSON.stringify({
          direction: softphone.direction ?? 'outbound',
          to: softphone.remoteNumber ?? target,
          call_sid: softphone.callSid ?? undefined,
          duration_seconds: softphone.connectedAt ? Math.round((Date.now() - softphone.connectedAt) / 1000) : undefined,
          status: 'completed',
        }),
```

and change the Log button's `disabled={!target}` to `disabled={!target && !softphone.remoteNumber}`.

5. `jump` map: `hold`, `transfer`, `conference`, `record`, `hangup`, `dtmf`, `keypad` already point at `dc-keypad` (the card keeps that id) — no change.

6. Also keep the dock: `DialerConnectPage` still renders the `DIALER_HOST_ID` host and the `LIVE` toggle; with the native path there is no iframe to dock, so in `DialerConnectPage` render the LIVE button and host only when `isIframeDialerForced()`:

```tsx
import { isIframeDialerForced } from '../dialer/dialerFlags';
...
  const iframeMode = isIframeDialerForced();
  const dockVisible = iframeMode && liveOpen && !dockCollapsed;
```

and wrap the `LIVE` `<button>` in `{iframeMode && ( … )}`.

7. Update `DialerConnectPage.test.tsx`: add `vi.mock('../dialer/SoftphoneProvider', () => ({ useSoftphone: () => ({ status: 'ready', dial: vi.fn(), remoteNumber: null, callSid: null, direction: null, connectedAt: null }) }));` and `vi.mock('../dialer/SoftphoneCard', () => ({ default: () => <section id="dc-keypad"><button aria-label="Dial number">stub</button></section> }));`. Change the first test to assert the host is absent by default and present when `localStorage.setItem('rmpg_dialer_iframe','1')`; change the LIVE-toggle test to set that flag first. Drop the keypad-dial/DTMF test from this file (it now lives in `SoftphoneCard.test.tsx`).

- [ ] **Step 5: Run tests + typecheck**

Run: `npx tsc --noEmit && npx vitest run src/dialer src/pages/DialerConnectPage.test.tsx`
Expected: tsc clean; all PASS.

- [ ] **Step 6: Commit**

```bash
git add client/src/dialer client/src/pages/DialerConnectPage.tsx client/src/pages/DialerConnectPage.test.tsx
git commit -m "feat(dialer): native SoftphoneCard with every control wired, Link Dial Connect gate, warm/blind transfer picker; wrap-up prefills from the live call

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 10: Client — pop-out leader election (one Twilio client per dispatcher)

**Files:**
- Create: `client/src/dialer/leaderElection.ts`, `client/src/dialer/leaderElection.test.ts`
- Modify: `client/src/dialer/SoftphoneProvider.tsx` (use it), `client/src/components/DialerPanel.tsx:114-123` (`openDialerWindow` → `/dialer-connect?popout=1` when native)

**Interfaces:**
- `createLeaderElection(opts: { isPopout: boolean; onBecomeFollower(): void; onBecomeLeader(): void }): { close(): void }` over `BroadcastChannel('rmpg-dialer')` with messages `{ type: 'claim'; id: string } | { type: 'release'; id: string }`.

- [ ] **Step 1: Write the failing test**

```ts
// client/src/dialer/leaderElection.test.ts
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { createLeaderElection } from './leaderElection';

class FakeChannel {
  static all: FakeChannel[] = [];
  onmessage: ((ev: MessageEvent) => void) | null = null;
  constructor(public name: string) { FakeChannel.all.push(this); }
  postMessage(data: unknown) { for (const c of FakeChannel.all) if (c !== this) c.onmessage?.({ data } as MessageEvent); }
  close() { FakeChannel.all = FakeChannel.all.filter((c) => c !== this); }
}
beforeEach(() => { FakeChannel.all = []; vi.stubGlobal('BroadcastChannel', FakeChannel); });
afterEach(() => vi.unstubAllGlobals());

describe('leader election', () => {
  test('a pop-out claims leadership and the opener becomes a follower; release hands it back', () => {
    const openerFollower = vi.fn(); const openerLeader = vi.fn();
    const opener = createLeaderElection({ isPopout: false, onBecomeFollower: openerFollower, onBecomeLeader: openerLeader });
    const popout = createLeaderElection({ isPopout: true, onBecomeFollower: vi.fn(), onBecomeLeader: vi.fn() });
    expect(openerFollower).toHaveBeenCalledTimes(1);
    popout.close();
    expect(openerLeader).toHaveBeenCalledTimes(1);
    opener.close();
  });

  test('a plain tab does not demote other plain tabs', () => {
    const f1 = vi.fn(); const f2 = vi.fn();
    const a = createLeaderElection({ isPopout: false, onBecomeFollower: f1, onBecomeLeader: vi.fn() });
    const b = createLeaderElection({ isPopout: false, onBecomeFollower: f2, onBecomeLeader: vi.fn() });
    expect(f1).not.toHaveBeenCalled(); expect(f2).not.toHaveBeenCalled();
    a.close(); b.close();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/dialer/leaderElection.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// client/src/dialer/leaderElection.ts
// A popped-out softphone window must be the ONLY registered Twilio client for
// the dispatcher (two registrations ring twice / steal each other's calls).
// The pop-out claims leadership on open; every other window destroys its
// Device and goes passive until the pop-out releases.
const CHANNEL = 'rmpg-dialer';
type Msg = { type: 'claim'; id: string } | { type: 'release'; id: string };

export function createLeaderElection(opts: { isPopout: boolean; onBecomeFollower(): void; onBecomeLeader(): void }): { close(): void } {
  if (typeof BroadcastChannel === 'undefined') return { close() {} };
  const id = Math.random().toString(36).slice(2);
  const ch = new BroadcastChannel(CHANNEL);
  let demotedBy: string | null = null;
  ch.onmessage = (ev: MessageEvent<Msg>) => {
    const m = ev.data;
    if (m.type === 'claim' && !opts.isPopout) { demotedBy = m.id; opts.onBecomeFollower(); }
    if (m.type === 'release' && demotedBy === m.id) { demotedBy = null; opts.onBecomeLeader(); }
  };
  if (opts.isPopout) ch.postMessage({ type: 'claim', id } satisfies Msg);
  const release = () => { if (opts.isPopout) ch.postMessage({ type: 'release', id } satisfies Msg); };
  if (opts.isPopout && typeof window !== 'undefined') window.addEventListener('pagehide', release);
  return { close() { release(); if (typeof window !== 'undefined') window.removeEventListener('pagehide', release); ch.close(); } };
}

export function isPopoutWindow(): boolean {
  if (typeof window === 'undefined') return false;
  return new URLSearchParams(window.location.search).get('popout') === '1';
}
```

In `SoftphoneProvider.tsx` add `import { createLeaderElection, isPopoutWindow } from './leaderElection';` and this effect after the register effect:

```tsx
  useEffect(() => {
    const election = createLeaderElection({
      isPopout: isPopoutWindow(),
      onBecomeFollower: () => { deviceRef.current?.destroy(); deviceRef.current = null; dispatch({ type: 'PASSIVE' }); },
      onBecomeLeader: () => { dispatch({ type: 'RESET' }); void register(); },
    });
    return () => election.close();
  }, [register]);
```

In `DialerPanel.tsx` `openDialerWindow()` change the URL so the native pop-out is used unless the iframe is forced:

```ts
import { isIframeDialerForced } from '../dialer/dialerFlags';
...
  const url = isIframeDialerForced() ? DIALER_APP_URL : `${window.location.origin}/dialer-connect?popout=1`;
  dialerWindow = window.open(url, DIALER_WINDOW_NAME);
```

- [ ] **Step 4: Run tests + typecheck**

Run: `npx tsc --noEmit && npx vitest run src/dialer src/components/DialerPanel.test.tsx`
Expected: tsc clean; all PASS (DialerPanel tests that assert `window.open(DIALER_APP_URL, …)` must set `localStorage.setItem('rmpg_dialer_iframe','1')` first — update them).

- [ ] **Step 5: Commit**

```bash
git add client/src/dialer/leaderElection.ts client/src/dialer/leaderElection.test.ts client/src/dialer/SoftphoneProvider.tsx client/src/components/DialerPanel.tsx client/src/components/DialerPanel.test.tsx
git commit -m "feat(dialer): pop-out leader election so one Twilio client is registered per dispatcher

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 11: Docs, full gates, PR

**Files:**
- Modify: `CLAUDE.md` (Dial Connect section), `client/public/sw.js` (changelog comment only)

- [ ] **Step 1: CLAUDE.md — add under "### Dial Connect (Twilio dialer …)" invariants**

```markdown
- **Native softphone (P1, 2026-09-14).** RMPG Flex hosts the Twilio Voice client
  (`client/src/dialer/SoftphoneProvider.tsx`); tokens/presence/controls/SSE go
  through `src/routes/dialerVoice.ts` (`/api/dialer/*`) to dispatch-app as the
  linked dispatcher (`users.dialer_oidc_sub` → identity `dispatcher_<id>`).
  Secrets: `DIAL_CONNECT_SERVICE_KEY` (rmpg-flex-api) == `RMPG_FLEX_SERVICE_KEY`
  (Worker `dialer`). Unlinked users see the "Link Dial Connect" gate — the SSO
  callback links by e-mail on first sign-in. **Kill-switch:**
  `localStorage.rmpg_dialer_iframe = '1'` restores the legacy iframe (`DialerPanel`)
  per browser with no deploy; `DialerPanel` is deleted in P6.
- **dispatch-app has no CI.** A merged PR there changes nothing until someone runs
  `npm run deploy` in `~/Call Center/dispatch-app`. Every browser URL there must go
  through `apiUrl()` (basePath `/dialer`).
```

`client/public/sw.js`: add one line under the latest `// vNNN:` comment: `// v+1: native softphone (client/src/dialer) — no cache-shape change.`

- [ ] **Step 2: Run every gate serially**

```bash
cd "/Users/rmpgutah/RMPG Flex/.claude/worktrees/fix-dialer-3570ce"
npm run typecheck && npx vitest run && npm run test:worker && (cd client && npx tsc --noEmit && npx vitest run && npx vite build 2>&1 | tail -3)
```
Expected: all green; build succeeds.

- [ ] **Step 3: Commit + push + PR**

```bash
git add CLAUDE.md client/public/sw.js
git commit -m "docs(dialer): native softphone invariants, service-key pairing, iframe kill-switch

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
git push -u origin claude/fix-dialer-3570ce
gh pr create -R rmpgutah/rmpg-flex --base main --head claude/fix-dialer-3570ce --title "feat(dialer): native softphone (Dial Connect port P1) + dock default" --body "$(cat <<'EOF'
## Summary
- RMPG Flex now hosts the Twilio Voice client: keypad, answer/reject, hang up, mute, hold/resume, DTMF, blind + warm transfer, conference add, recording start/stop, duress, presence — every Dialer Connect button performs its real action (spec: docs/superpowers/specs/2026-09-14-native-softphone-p1-design.md).
- New Worker router `/api/dialer/*` proxies token/presence/controls/SSE server-to-server to dispatch-app as the linked dispatcher (`users.dialer_oidc_sub`); requires dispatch-app PR "RMPG Flex service actor + recording control" deployed and `DIAL_CONNECT_SERVICE_KEY` set.
- Unlinked users get a "Link Dial Connect" gate; `rmpg_dialer_iframe=1` restores the legacy iframe per browser.
- Dial Connect page opens on the native UI (dock collapsed by default).
- Call archive (`dialer_calls`) and PDF output unchanged.

## Test plan
- [x] Worker: test-workers/dialerVoice.test.ts (token linked/unlinked/unreachable/forbidden/not_configured, controls, SSE)
- [x] Client: softphoneMachine, SoftphoneProvider, SoftphoneCard, DialerMount, leaderElection tests
- [ ] Live: outbound + inbound ring-group call in Flex; hold/resume; blind + warm transfer; conference; recording shows Archived; pop-out; duress banner

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 4: Live acceptance (after both deploys)**

1. In the CAD, open Dialer Connect → expect "Not linked" + gate → click "Sign in with Dialer" → return → status "Ready".
2. Dial your cell → phone rings, answer → timer runs → Hold (hold tone on phone) → Resume → Hang up → Call History shows the row with the number and duration.
3. Call the Twilio number from your cell → Incoming toast → Answer → Record → Stop rec → Hang up → row shows `Archived` after the cron tick.
4. Set `localStorage.rmpg_dialer_iframe='1'`, reload → legacy iframe returns; remove flag → native returns.
