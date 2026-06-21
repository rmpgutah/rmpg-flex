# Fleet.io Integration — Operator Setup Runbook

**Audience**: RMPG operator (Christopher Zamora). Anyone provisioning the
Fleet.io integration for the first time on a fresh Cloudflare Worker
deployment.

**Prerequisites you should have already**: a Fleet.io account with admin
access (https://secure.fleetio.com), shell access on a machine where
`wrangler` is logged in to the same Cloudflare account that owns the
`rmpg-flex-api` Worker.

**Status check first** — confirm you are on a Worker bundle that has all
nine Fleet.io PRs landed. Run:

```bash
curl -sf https://api.rmpgutah.us/api/health
```

You should see `{"status":"ok", "db":{"connected":true, ...}}`. If you get
the WAF challenge HTML, that's still fine for this runbook — every step
below is operator-side, not API-side.

---

## Why this runbook exists

The Fleet.io integration ships fully "off". The Worker accepts queued
outbound events from RMPG write paths (vehicle update, fuel create, work
order *, inspection submit) but does NOT dispatch them anywhere until
three secrets are provisioned. The webhook receiver returns
`503 FLEETIO_WEBHOOK_SECRET_UNSET` until you provision its secret.

This is intentional — "fail-closed" prevents the integration from running
half-configured, e.g., webhook-only (Fleet.io thinks it's two-way synced
but RMPG can't push back) or outbound-only (RMPG pushes but never sees
Fleet.io-originated changes).

After this runbook, everything is live: outbound events drain every 30
minutes (or wait for the next cron tick — `*/30 * * * *` UTC), inbound
webhooks queue + apply within ~100 ms of arrival.

---

## Step 1 — Mint the Fleet.io API credentials

Two of the three secrets come from Fleet.io's admin UI.

### 1a. Get the API key

1. Sign in to https://secure.fleetio.com.
2. Click your name (top-right) → **Account Settings** → **API Keys** tab.
3. Click **Generate New Key**.
4. Label it something like `rmpg-flex-prod` so future-you knows what it's
   for. Set scope to all permissions Fleet.io requires (read + write on
   vehicles, fuel entries, work orders, inspections). The integration
   reads vehicles + writes fuel/WO/inspection events.
5. **Copy the key immediately.** Fleet.io shows it once. If you close the
   dialog without copying, regenerate.

### 1b. Get the account token

1. From the same **Account Settings** page, switch to the **General** tab.
2. Find the **Account Token** field. Copy it.
3. Unlike the API key, the account token is stable across sessions — you
   can re-copy it any time. But it IS account-scoped, so if RMPG ever
   manages multiple Fleet.io accounts in parallel, you need one token per
   account.

### 1c. Generate the webhook shared secret

This is RMPG-side. Fleet.io's webhook UI does **not** sign request
bodies — it instead lets you pick an `Authorization` HTTP header value
(any string), then echoes that value back as the `Authorization` header
on every webhook POST. RMPG then verifies the inbound header equals
the configured secret (constant-time compare).

Generate a strong random value:

```bash
openssl rand -hex 32
```

That's a 64-char hex string. Copy it. You'll paste it into both
`wrangler secret put` and Fleet.io's webhook configuration form.

> **Important**: do NOT reuse any other secret already in use in this
> Worker (e.g., `JWT_SECRET`). The webhook secret is purpose-bound to
> Fleet.io and should be rotatable independently.

---

## Step 2 — Provision the three Cloudflare Worker secrets

From the repo root (anywhere a `wrangler.toml` is present):

```bash
wrangler secret put FLEETIO_API_KEY
# (paste the API key from step 1a, then press Enter)

wrangler secret put FLEETIO_ACCOUNT_TOKEN
# (paste the account token from step 1b, then press Enter)

wrangler secret put FLEETIO_WEBHOOK_SECRET
# (paste the 64-char hex from step 1c, then press Enter)
```

After each command, `wrangler` confirms the secret was uploaded. **Restart
nothing manually** — Cloudflare propagates secrets to all colos within
~60 seconds with no Worker redeploy needed.

### Verify the secrets are set without revealing them

```bash
wrangler secret list
```

You should see all three by name (values are never returned). If one is
missing, repeat the `put` for it.

---

## Step 3 — Verify the webhook receiver opens

This step proves the webhook secret took effect AND the route is mounted.

From the Cloudflare dashboard → Workers → `rmpg-flex-api` → **Logs (real-time)**,
OR via CLI:

```bash
npx wrangler tail rmpg-flex-api --format pretty
```

Leave the tail running. In another terminal:

```bash
# This request fakes a webhook with a bogus Authorization header — expect 401, not 503.
# (Before secret was set, this returned 503 FLEETIO_WEBHOOK_SECRET_UNSET.)
curl -s -X POST https://api.rmpgutah.us/api/fleetio/webhook \
  -H 'Authorization: not-the-real-secret' \
  -d '{}' \
  -w "\nHTTP %{http_code}\n"
```

**Expected**: `HTTP 401` with body `{"error":"invalid authorization"}`. The
tail also shows `[fleetio-webhook] audit_log INSERT` for the bad-auth
attempt (the route logs probe traffic to `audit_log` as
`FLEETIO_WEBHOOK_BAD_AUTH`).

If you instead see `HTTP 503` with `FLEETIO_WEBHOOK_SECRET_UNSET`, the
secret didn't take. Run `wrangler secret list` again and re-put the
missing one.

---

## Step 4 — Configure Fleet.io's webhook destination

This is the inbound side — Fleet.io pushes events to RMPG.

1. Sign in to https://secure.fleetio.com.
2. **Account Settings** → **Webhooks** (left nav under "Integrations").
3. Click **Add Webhook**.
4. Fill in (this matches Fleet.io's actual form fields verbatim — they
   don't sign request bodies; they echo an `Authorization` header instead):
   - **URL** *(required)*: `https://api.rmpgutah.us/api/fleetio/webhook`
   - **Authorization HTTP Header** *(optional in their UI, REQUIRED for our
     receiver)*: paste the same 64-char hex you generated in step 1c.
     You may prefix with `Bearer ` if you like; the receiver tolerates
     both `<hex>` and `Bearer <hex>` interchangeably.
   - **Description**: `RMPG Flex sync` (free text — not validated)
   - **Enabled**: leave checked.
   - **All Events** vs **Select Events**: pick **Select Events** and
     subscribe to at least these (anything else is silently ignored as
     `unsupported event_type`):
     - `vehicle.create`
     - `vehicle.update`
     - `vehicle.delete`
     - `fuel_entry.create`
     - `fuel_entry.update`
     - `fuel_entry.delete`
     - (Future: `work_order.*`, `inspection_submission.*` — PR 5/6 emit
       outbound for these and inbound apply is wired and ready.)
5. Click **Save**.

Fleet.io typically sends a test event immediately. Watch the tail:

```
GET https://api.rmpgutah.us/api/fleetio/webhook - Ok @ <timestamp>
  (log) <-- POST /api/fleetio/webhook
  (log) --> POST /api/fleetio/webhook 200 NNms
```

Then query D1 to confirm the event landed in `fleetio_events`:

```bash
npx wrangler d1 execute rmpg-flex --remote --command \
  "SELECT direction, event_id, resource, action, status, created_at
   FROM fleetio_events
   ORDER BY id DESC
   LIMIT 5"
```

You should see at least one row with `direction='inbound'` and `status='completed'`
(the test event applied successfully) or `'pending'` (queued, drained on next cron).

---

## Step 5 — Verify outbound drain

This step proves the reconciliation cron picks up RMPG-originated events.

### Trigger one outbound event

In a logged-in browser session:

```
PUT https://api.rmpgutah.us/api/fleet/<existing_vehicle_id>
Body: { "vehicle_name": "Patrol 12 (Fleet.io setup test)" }
```

(The simplest way: open `/fleet` in a browser, click an existing vehicle,
"Edit", change the vehicle name, Save.)

### Inspect the queue

```bash
npx wrangler d1 execute rmpg-flex --remote --command \
  "SELECT id, direction, event_id, resource, action, status, attempts,
          created_at, processed_at, error
   FROM fleetio_events
   WHERE direction='outbound' AND resource='vehicle'
   ORDER BY id DESC LIMIT 5"
```

Right after the edit, you should see a fresh row with `status='pending'`,
`attempts=0`, `processed_at=NULL`.

### Wait for the cron to drain it

The cron runs every 30 minutes on the hour (`*/30 * * * *` UTC). You can:

1. **Wait** up to 30 minutes. Re-run the SELECT above. The row should
   become `status='completed'`, `processed_at` populated.

2. **Force-run** the cron from the Cloudflare dashboard → Workers →
   `rmpg-flex-api` → **Triggers** → **Cron Triggers** → find
   `*/30 * * * *` → click **Run now**. Then re-run the SELECT.

If after the cron tick the row is still `pending`, check the `error`
column. The most common cause:

| Error pattern | Meaning | Fix |
|---|---|---|
| `FLEETIO_API_KEY is unset` | One of the secrets didn't actually persist | `wrangler secret list`, re-put if missing |
| `429 rate limit hit; retry after Ns` | Fleet.io throttled us — expected during heavy first sync | Wait. Cron picks back up next tick. |
| `Unsupported outbound (resource/action)` | Adapter doesn't have a method for that resource yet (work_order today, until PR 5b) | Will drain when PR 5b lands. |
| `Vehicle not found` (Fleet.io HTTP 404) | The RMPG vehicle isn't linked to a Fleet.io vehicle yet | Use `/api/fleetio/seed` (admin) to push every unlinked vehicle into Fleet.io. |

### Confirm Fleet.io received the update

Sign back into Fleet.io → Vehicles → find the vehicle you edited → confirm
the new vehicle name is there. If yes: the integration is end-to-end working.

---

## Step 6 — Seed initial vehicles (one-time)

If this is a fresh integration (RMPG has vehicles but Fleet.io is empty), run
the seed once:

```bash
curl -s -X POST https://api.rmpgutah.us/api/fleetio/seed \
  -H "Authorization: Bearer <your_admin_jwt>" \
  -w "\nHTTP %{http_code}\n"
```

This pushes every `fleet_vehicles` row that lacks a `fleetio_links` entry into
Fleet.io as a new vehicle, then writes the `fleetio_links` row with the
Fleet.io ID returned. After this, the per-row PUT path drives ongoing sync.

The seed is idempotent — re-running skips already-linked rows.

---

## Troubleshooting

### "Webhook returns 401 'invalid authorization' on every Fleet.io request"

The string you pasted into Fleet.io's **Authorization HTTP Header** field
doesn't match `FLEETIO_WEBHOOK_SECRET`. Generate a fresh
`openssl rand -hex 32`, paste the same value into both places. The
receiver tolerates an optional `Bearer ` or `Token ` prefix on either
side, so `Bearer <hex>` in Fleet.io + bare `<hex>` in wrangler is fine.

### "Reconciliation cron seems to run but nothing changes"

Check the cron log: `wrangler tail rmpg-flex-api --format pretty` during
the `:00` or `:30` minute mark. Look for `[fleetio-reconcile]` lines. If
you see `FLEETIO secrets unset; skipping drain.`, secrets aren't set.

If you see `attempted=0 completed=0 failed=0` repeatedly, the queue is
already drained — that's healthy.

### "Outbound events stuck at attempts=7, status='failed'"

The integration gave up after 7 backoff attempts (1s, 4s, 16s, 60s, 5m,
30m, 2h). Inspect the `error` column to see what's wrong. After fixing
root cause, re-trigger from the dashboard:

```bash
npx wrangler d1 execute rmpg-flex --remote --command \
  "UPDATE fleetio_events
   SET status='pending', attempts=0, error=NULL, processed_at=NULL
   WHERE id IN (<failed event ids>)"
```

Then wait for the next cron tick or force-run it.

### "Conflicts table is filling up"

Open `/admin/fleetio-health` (will land in PR 4b — until then, query D1
directly):

```bash
npx wrangler d1 execute rmpg-flex --remote --command \
  "SELECT rmpg_table, field, COUNT(*) AS n
   FROM fleetio_conflicts
   WHERE resolved_at IS NULL
   GROUP BY rmpg_table, field
   ORDER BY n DESC"
```

`local_wins` conflicts are normal — they mean Fleet.io sent an update for
an RMPG-owned field (`vehicle_name`, `status`, etc.) and the sync engine
correctly didn't overwrite. `unresolved` conflicts mean both sides edited
a `shared` field within 60 seconds of each other; the operator needs to
pick a winner. Until PR 4b ships the conflict-resolution UI, resolve
manually:

```bash
npx wrangler d1 execute rmpg-flex --remote --command \
  "UPDATE fleetio_conflicts
   SET resolution='remote_wins', resolved_at=datetime('now')
   WHERE id=<conflict_id>"
```

### "I need to rotate one of the secrets"

`wrangler secret put` overwrites. For the webhook secret, also update
the **Authorization HTTP Header** value on Fleet.io's webhook config to
match. The cron's adapter calls read fresh config on every invocation,
so rotation takes effect on the next cron tick (or webhook receive).

### "I need to deprovision the integration"

Three steps:

```bash
wrangler secret delete FLEETIO_API_KEY
wrangler secret delete FLEETIO_ACCOUNT_TOKEN
wrangler secret delete FLEETIO_WEBHOOK_SECRET
```

After that:
- Webhook returns 503 (no door open without secret).
- Cron silently no-ops (no API calls without API key).
- Queued events accumulate as `pending` forever (or you can mark them
  `cancelled` manually — `UPDATE fleetio_events SET status='cancelled'
  WHERE status='pending'`).

You can also disable the Fleet.io-side webhook (Account Settings →
Webhooks → Disable) so Fleet.io stops trying to push to a 503 endpoint.

---

## Quick reference card

| Concern | Where to look |
|---|---|
| Worker logs | `wrangler tail rmpg-flex-api --format pretty` |
| Cron status | Cloudflare dashboard → Workers → rmpg-flex-api → Triggers |
| Outbound queue | `SELECT … FROM fleetio_events WHERE direction='outbound'` |
| Inbound queue | `SELECT … FROM fleetio_events WHERE direction='inbound'` |
| Conflicts | `SELECT … FROM fleetio_conflicts WHERE resolved_at IS NULL` |
| RMPG↔FI links | `SELECT … FROM fleetio_links` |
| Sync state cursors | `SELECT … FROM fleetio_sync_state` |
| Webhook URL | `https://api.rmpgutah.us/api/fleetio/webhook` |
| Cron schedule | `*/30 * * * *` UTC (every 30 min on :00 and :30) |
| Backoff schedule | 1s, 4s, 16s, 60s, 5m, 30m, 2h (7 attempts → `failed`) |
| Conflict window | 60 s for `shared` fields |

---

## Reference

- Integration design spec: [`2026-06-21-fleetio-integration-design.md`](../specs/2026-06-21-fleetio-integration-design.md)
- Schema diff: [`2026-06-21-fleetio-schema-diff.md`](../specs/2026-06-21-fleetio-schema-diff.md)
- Fleet.io API docs: https://developer.fleetio.com
- Cloudflare Workers secrets: https://developers.cloudflare.com/workers/configuration/secrets/
