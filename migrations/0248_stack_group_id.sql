-- migrations/0248_stack_group_id.sql
-- Groups co-located active calls so officer activity syncs bidirectionally.
-- NULL = solo call. Non-null = UUID shared by all calls at the same address.
-- Lives on ext (1:1 overflow) because calls_for_service is at D1's 100-column cap.

ALTER TABLE calls_for_service_ext ADD COLUMN stack_group_id TEXT;
CREATE INDEX idx_cfs_ext_stack_group
  ON calls_for_service_ext(stack_group_id)
  WHERE stack_group_id IS NOT NULL;
