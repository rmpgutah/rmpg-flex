-- 0207 — evidence: PQ-sealed description columns (post-quantum crypto integration).
-- Added by the 2026-07-24 PQ crypto build. When an officer opts in to
-- post-quantum sealing on the new-evidence modal, the description is sealed
-- client-side (X25519+ML-KEM-768 hybrid KEM -> AES-256-GCM) and stored here
-- as an opaque base64 RMPGSEAL frame. `description` carries the placeholder
-- '[sealed — post-quantum]' in that case. The boot reconciler in
-- src/routes/records.ts (ensureEvidenceSchema) also adds these via ALTER at
-- runtime — this file is for explicit migration tracking.
ALTER TABLE evidence ADD COLUMN pq_sealed_description TEXT;
ALTER TABLE evidence ADD COLUMN pq_seal_aad TEXT;