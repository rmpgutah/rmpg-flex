#!/bin/bash
# Serve Scheduler Upgrade — Post-Deploy Verification

set -e

API_BASE="${1:-https://api.rmpgutah.us}"
JWT="${2:-$RMPG_JWT}"

if [ -z "$JWT" ]; then
  echo "❌ Missing JWT token. Set \$RMPG_JWT or pass as second argument."
  exit 1
fi

echo "🔍 Post-Deploy Verification — Serve Scheduler Upgrade"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# 1. Check schema tables
echo ""
echo "1️⃣  Checking D1 schema..."
wrangler d1 execute rmpg-flex --remote --command \
  "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('serve_attempt_schedules', 'cron_sweep_metrics');" \
  2>&1 | grep -q '"name".*"serve_attempt_schedules"' && echo "   ✓ serve_attempt_schedules exists" || echo "   ❌ serve_attempt_schedules missing"

# 2. Check health endpoint
echo ""
echo "2️⃣  Checking worker health..."
HEALTH=$(curl -s "$API_BASE/api/health" | jq -r '.status // empty')
[ "$HEALTH" = "running" ] && echo "   ✓ Worker is running" || echo "   ❌ Worker health check failed"

# 3. Test auto-replan route exists (404 expected, not 500)
echo ""
echo "3️⃣  Testing auto-replan endpoint..."
REPLAN_STATUS=$(curl -s -w "%{http_code}" -o /dev/null -X POST \
  "$API_BASE/api/serve-intake/schedule/999/replan-on-failure" \
  -H "Authorization: Bearer $JWT" \
  -H "Content-Type: application/json" \
  -d '{"attempt_at": "2026-06-27T14:00:00Z", "result": "no_answer"}')
if [ "$REPLAN_STATUS" = "404" ]; then
  echo "   ✓ Route registered (404 on invalid queue — expected)"
elif [ "$REPLAN_STATUS" = "401" ]; then
  echo "   ⚠️  Route registered but JWT validation may be needed"
elif [ "$REPLAN_STATUS" = "500" ]; then
  echo "   ❌ Route returned 500 — check worker logs"
else
  echo "   ℹ️  Route status: $REPLAN_STATUS"
fi

# 4. Check cron metrics table
echo ""
echo "4️⃣  Checking cron metrics (wait for first sweep)..."
SWEEP_COUNT=$(wrangler d1 execute rmpg-flex --remote --command \
  "SELECT COUNT(*) as cnt FROM cron_sweep_metrics;" 2>&1 | grep '"cnt"' | head -1 | grep -oE '[0-9]+' || echo "0")
if [ "$SWEEP_COUNT" -gt 0 ]; then
  echo "   ✓ Cron metrics: $SWEEP_COUNT sweep(s) recorded"
else
  echo "   ℹ️  No sweeps yet (wait 1-2 minutes for per-minute cron tick)"
fi

# 5. Check serve_attempt_schedules population
echo ""
echo "5️⃣  Checking serve_attempt_schedules population..."
ATTEMPT_COUNT=$(wrangler d1 execute rmpg-flex --remote --command \
  "SELECT COUNT(*) as cnt FROM serve_attempt_schedules LIMIT 1;" 2>&1 | grep '"cnt"' | head -1 | grep -oE '[0-9]+' || echo "0")
if [ "$ATTEMPT_COUNT" -gt 0 ]; then
  echo "   ✓ Attempt schedules: $ATTEMPT_COUNT window(s) scheduled"
else
  echo "   ℹ️  No attempts yet (will populate when schedules are generated)"
fi

# 6. Check Dockerfile DHI upgrade
echo ""
echo "6️⃣  Verifying Dockerfile DHI upgrade..."
if grep -q "dhi.io/node" ./Dockerfile; then
  DHI_TAG=$(grep "FROM dhi.io" ./Dockerfile | sed 's/.*dhi.io/dhi.io/' | cut -d' ' -f1)
  echo "   ✓ DHI image: $DHI_TAG"
else
  echo "   ❌ Dockerfile not using DHI"
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✅ Post-deploy verification complete"
echo ""
echo "Next: Monitor worker logs for [serve-schedule] and [schema-init] messages"
