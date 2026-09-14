import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { ensureDeliveryExtColumns, columnExists } from '../src/utils/db';

describe('ensureDeliveryExtColumns', () => {
  beforeEach(async () => {
    await env.DB.prepare(`CREATE TABLE IF NOT EXISTS calls_for_service (id INTEGER PRIMARY KEY)`).run();
    await env.DB.prepare(`CREATE TABLE IF NOT EXISTS calls_for_service_ext (id INTEGER PRIMARY KEY)`).run();
  });

  it('adds all nine delivery_* columns', async () => {
    await ensureDeliveryExtColumns(env.DB);

    for (const col of [
      'delivery_slot_id', 'delivery_case_number', 'delivery_scheduled_date',
      'delivery_time_window', 'delivery_contact_name', 'delivery_contact_phone',
      'delivery_contact_email', 'delivery_subject_name', 'delivery_status',
    ]) {
      expect(await columnExists(env.DB, 'calls_for_service_ext', col)).toBe(true);
    }
  });

  it('enforces uniqueness on delivery_slot_id but allows multiple NULLs', async () => {
    await ensureDeliveryExtColumns(env.DB);
    await env.DB.prepare(`INSERT INTO calls_for_service_ext (id, delivery_slot_id) VALUES (1, 100)`).run();
    await env.DB.prepare(`INSERT INTO calls_for_service_ext (id, delivery_slot_id) VALUES (2, NULL)`).run();
    await env.DB.prepare(`INSERT INTO calls_for_service_ext (id, delivery_slot_id) VALUES (3, NULL)`).run();

    await expect(
      env.DB.prepare(`INSERT INTO calls_for_service_ext (id, delivery_slot_id) VALUES (4, 100)`).run(),
    ).rejects.toThrow();
  });

  it('is idempotent when called twice', async () => {
    await ensureDeliveryExtColumns(env.DB);
    await ensureDeliveryExtColumns(env.DB);
    expect(await columnExists(env.DB, 'calls_for_service_ext', 'delivery_slot_id')).toBe(true);
  });
});
