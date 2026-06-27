## Serve Scheduler Fix, Advance, Upgrade — Deployment Checklist

### ✅ Completed Tasks

#### Fix (Schema Guards + Concurrency Safety)
- [x] Added timezone validation guards in `serveAttemptScheduler.ts` (DST edge cases)
- [x] Added schema drift detection (format validation before parsing)
- [x] Implemented stale slot collision guards in `serveScheduleEdit.ts`
- [x] Added try-catch error propagation for schema mismatches

#### Advance (Auto-Replan + Monitoring)
- [x] Created `serveReplan.ts` route: `POST /api/serve-intake/schedule/:queueId/replan-on-failure`
- [x] Integrated incremental slot append via `appendAttemptSlot()` (non-destructive)
- [x] Implemented auto-replan with urgency tier recalculation
- [x] Created `cronMetrics.ts` for sweep execution monitoring
- [x] Added `recordCronSweep()` + `getCronSweepSummary()` for dashboard
- [x] Registered route in `routesConfig.ts`

#### Upgrade (DHI + Migration)
- [x] Updated `Dockerfile` to use `dhi.io/node:22-alpine-dev`
- [x] Created migration `0157-serve-attempt-schedules.sql`
- [x] Added `serve_attempt_schedules` table (queue_id FK, attempt windows, notify_at)
- [x] Added `cron_sweep_metrics` table (sweep monitoring)
- [x] Created `serveScheduleSchema.ts` with idempotent schema guards
- [x] Injected schema initialization into per-minute cron handler
- [x] Migration applied to remote D1 database

### 📋 Files Modified/Created

#### New Files
- `src/routes/serveReplan.ts` — Auto-replan route handler
- `src/utils/serveScheduleSchema.ts` — Schema initialization + guards
- `src/utils/cronMetrics.ts` — Cron sweep monitoring
- `migrations/0157-serve-attempt-schedules.sql` — DDL + indexes

#### Modified Files
- `src/utils/serveAttemptScheduler.ts` — Added timezone validation + error handling
- `src/utils/serveScheduleEdit.ts` — Rewritten with concurrency guards
- `src/routesConfig.ts` — Added `serveReplan` import + route registration
- `src/index.ts` — Injected schema init into per-minute cron
- `Dockerfile` — Upgraded to DHI node image

### 🚀 Deployment Steps

1. **Verify D1 migration** (already applied):
   ```bash
   wrangler d1 execute rmpg-flex --remote --command "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('serve_attempt_schedules', 'cron_sweep_metrics');"
   ```

2. **Deploy Worker**:
   ```bash
   wrangler deploy
   ```

3. **Monitor first per-minute cron tick**:
   - Watch logs: `[schema-init] setup...`
   - Verify: `[serve-schedule] ... reminder(s) dispatched` (when due)

4. **Test auto-replan endpoint** (POST /api/serve-intake/schedule/:queueId/replan-on-failure):
   ```bash
   curl -X POST https://api.rmpgutah.us/api/serve-intake/schedule/123/replan-on-failure \
     -H "Authorization: Bearer $JWT" \
     -H "Content-Type: application/json" \
     -d '{"attempt_at": "2026-06-27T14:30:00Z", "result": "no_answer"}'
   ```

5. **Check admin dashboard** for cron sweep metrics (cron_sweep_metrics table populated)

### 🔍 Key Implementation Details

- **Timezone Handling**: America/Denver local time stored as "YYYY-MM-DDTHH:MM" (lexicographically sortable)
- **Auto-Replan**: Incremental slot append (not destructive full-schedule replace)
- **Concurrency**: Optimistic concurrency check via `If-Unmodified-Since` header
- **Migration Safety**: Schema checks before every sweep; graceful no-op if table missing
- **Monitoring**: Per-sweep metrics for ops visibility + anomaly detection

### 📊 Database Schema

**serve_attempt_schedules** (new):
- queue_id (FK to serve_queue, ON DELETE CASCADE)
- attempt_number, scheduled_date, window_start, window_end
- notify_at (sortable datetime), notified, dismissed
- auto_replan_source (self-FK)

**cron_sweep_metrics** (new):
- sweep_name, last_run_at, duration_ms
- items_processed, items_alerted, error

### 🛡️ Safety Guarantees

1. **Idempotent schema init**: CREATE TABLE IF NOT EXISTS on every per-minute cron
2. **Timezone safety**: DST transitions handled via Intl.DateTimeFormat round-trip validation
3. **Stale read protection**: Optimistic concurrency on schedule edits
4. **Error isolation**: Per-sweep catch blocks prevent cascade failures
5. **Graceful degradation**: Missing tables skip sweep (no alerting crash)

### 📈 Next Steps (Phase 2)

- Admin dashboard tile: Cron sweep execution metrics + SLA tracking
- Serve intake UI: Calendar view of scheduled attempt windows
- Dispatcher notifications: Auto-replan → broadcast alert with new window
- Analytics: Attempt success rate by result code (no_answer vs refused vs moved)
