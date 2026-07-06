-- automation_rule_config / automation_execution_log (added in 0155) backed a
-- CRUD UI (src/routes/automation.ts) that was never wired to any executor —
-- rules could be created/toggled but nothing ever read them to evaluate
-- conditions or run actions. The real automation in this app is a set of
-- separate cron sweeps (panicEscalationSweep, serveNudgeSweep,
-- fleetMaintenanceSweep, certExpirationSweep, etc.) that don't touch these
-- tables at all. No client UI, no tests, no other code references either
-- table — confirmed via full-repo grep before this migration was written.
DROP TABLE IF EXISTS automation_execution_log;
DROP TABLE IF EXISTS automation_rule_config;
