-- 0071_units_emergency_overlay.sql
-- Spillman Flex parity: an officer Emergency (Panic) activation puts the
-- unit into a distinct EMERGENCY state on the Status Monitor. The live
-- units.status CHECK is a fixed enum (available/dispatched/enroute/onscene/
-- busy/off_duty/out_of_service) that we don't rebuild on live D1, so the
-- emergency is modeled as an OVERLAY flag on top of the existing status —
-- the unit keeps its normal status (usually 'dispatched' on the panic call)
-- and `emergency_active` drives the flashing red board/map treatment.
--
-- Cleared on every terminal panic transition (acknowledge does NOT clear —
-- the unit stays in emergency until resolve/cancel/false_alarm, matching
-- Spillman where ack silences the alarm but the unit remains emergent).
--
-- Applied directly to live D1 (785de7ae) 2026-06-02; this file documents it.
-- D1 has no `IF NOT EXISTS` for ADD COLUMN — re-apply will error harmlessly
-- (the deploy migration step is continue-on-error; Worker boot reconciles).

ALTER TABLE units ADD COLUMN emergency_active INTEGER DEFAULT 0;
ALTER TABLE units ADD COLUMN emergency_call_id INTEGER;
ALTER TABLE units ADD COLUMN emergency_since TEXT;
