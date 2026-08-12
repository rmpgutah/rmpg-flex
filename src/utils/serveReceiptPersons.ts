import { getDb, queryFirst, execute } from './db';
import { writePersonExt } from '../routes/records';
import { log } from './logger';

export interface AosPersonData {
  first_name: string;
  last_name: string;
  middle_name?: string | null;
  suffix?: string | null;
  name_prefix?: string | null;
  dob?: string | null;
  gender?: string | null;
  race?: string | null;
  height?: string | null;
  weight?: string | null;
  eye_color?: string | null;
  hair_color?: string | null;
  address?: string | null;
  address2?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
  phone?: string | null;
  email?: string | null;
  dl_number?: string | null;
  dl_state?: string | null;
  dl_class?: string | null;
  dl_expiry?: string | null;
  dl_issue_date?: string | null;
  dl_restrictions?: string | null;
  dl_endorsements?: string | null;
  country?: string | null;
  document_discriminator?: string | null;
  is_real_id?: boolean | null;
  is_organ_donor?: boolean | null;
  is_veteran?: boolean | null;
  under_18_until?: string | null;
  under_21_until?: string | null;
  aamva_version?: number | null;
  issuer_id?: string | null;
  place_of_birth?: string | null;
  non_resident_indicator?: boolean | null;
  limited_duration_doc?: boolean | null;
  card_revision_date?: string | null;
  dl_hazmat_expiry?: string | null;
  card_type?: string | null;
  raw_aamva_elements?: Record<string, string> | null;
}

const boolToInt = (v: unknown): number | null => (v == null ? null : (v ? 1 : 0));

export async function upsertPersonFromAos(
  db: ReturnType<typeof getDb>,
  data: AosPersonData,
): Promise<{ personId: number; created: boolean }> {
  const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);

  // Match order: DL# first, then name+DOB.
  // DL numbers are state-namespaced — the same number can legally exist in
  // two states for two different people. Require state agreement when both
  // sides have it; allow a match when the existing row has no state yet.
  let person: Record<string, unknown> | null = null;
  if (data.dl_number) {
    person = await queryFirst<Record<string, unknown>>(db,
      `SELECT * FROM persons
        WHERE dl_number = ?
          AND (dl_state IS NULL OR dl_state = '' OR ? IS NULL OR dl_state = ?)
        LIMIT 1`,
      data.dl_number, data.dl_state ?? null, data.dl_state ?? null);
  }
  if (!person && data.dob) {
    person = await queryFirst<Record<string, unknown>>(db,
      `SELECT * FROM persons WHERE lower(first_name) = lower(?) AND lower(last_name) = lower(?) AND dob = ? LIMIT 1`,
      data.first_name, data.last_name, data.dob);
  }

  if (person) {
    // FILL-ONLY: COALESCE(existing, new) for most fields.
    // Exception: physical description from govt ID overwrites.
    const fills: string[] = [];
    const overwrites: string[] = [];
    const params: unknown[] = [];

    const fillField = (col: string, val: unknown) => {
      if (val == null) return;
      fills.push(`${col} = COALESCE(NULLIF(${col}, ''), ?)`);
      params.push(val);
    };
    const overwriteField = (col: string, val: unknown) => {
      if (val == null) return;
      overwrites.push(`${col} = ?`);
      params.push(val);
    };

    fillField('first_name', str(data.first_name));
    fillField('middle_name', str(data.middle_name));
    fillField('last_name', str(data.last_name));
    fillField('dob', str(data.dob));
    fillField('address', str(data.address));
    fillField('phone', str(data.phone));
    fillField('email', str(data.email));
    fillField('dl_number', str(data.dl_number));
    fillField('dl_state', str(data.dl_state));
    fillField('dl_class', str(data.dl_class));
    fillField('dl_expiry', str(data.dl_expiry));
    fillField('race', str(data.race));

    // Physical description from govt ID is authoritative — overwrites
    overwriteField('gender', str(data.gender));
    overwriteField('height', str(data.height));
    overwriteField('weight', str(data.weight));
    overwriteField('eye_color', str(data.eye_color));
    overwriteField('hair_color', str(data.hair_color));

    const sets = [...fills, ...overwrites];
    if (sets.length > 0) {
      params.push(person.id);
      await execute(db,
        `UPDATE persons SET ${sets.join(', ')} WHERE id = ?`,
        ...params);
    }

    // Write ext fields
    await writePersonExt(db, Number(person.id), {
      suffix: str(data.suffix),
      name_prefix: str(data.name_prefix),
      dl_restrictions: str(data.dl_restrictions),
      dl_endorsements: str(data.dl_endorsements),
      dl_issue_date: str(data.dl_issue_date),
      country: str(data.country),
      document_discriminator: str(data.document_discriminator),
      is_real_id: boolToInt(data.is_real_id),
      is_organ_donor: boolToInt(data.is_organ_donor),
      is_veteran: boolToInt(data.is_veteran),
      under_18_until: str(data.under_18_until),
      under_21_until: str(data.under_21_until),
      aamva_version: data.aamva_version ?? null,
      issuer_id: str(data.issuer_id),
      address2: str(data.address2),
      place_of_birth: str(data.place_of_birth),
      non_resident_indicator: boolToInt(data.non_resident_indicator),
      limited_duration_doc: boolToInt(data.limited_duration_doc),
      card_revision_date: str(data.card_revision_date),
      dl_hazmat_expiry: str(data.dl_hazmat_expiry),
      card_type: str(data.card_type),
      raw_aamva_elements: data.raw_aamva_elements ?? null,
    });

    return { personId: Number(person.id), created: false };
  }

  // Create new person
  const result = await execute(db, `
    INSERT INTO persons (first_name, middle_name, last_name, dob, gender, race,
      height, weight, eye_color, hair_color, address, city, state, zip, phone, email,
      dl_number, dl_state, dl_class, dl_expiry, is_veteran, flags, notes, created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, datetime('now'))`,
    data.first_name, str(data.middle_name), data.last_name, str(data.dob),
    str(data.gender), str(data.race), str(data.height), str(data.weight),
    str(data.eye_color), str(data.hair_color), str(data.address),
    str(data.city), str(data.state), str(data.zip), str(data.phone), str(data.email),
    str(data.dl_number), str(data.dl_state), str(data.dl_class), str(data.dl_expiry),
    boolToInt(data.is_veteran),
    JSON.stringify(['aos_id_capture']), 'Created from AoS ID capture');
  const newPersonId = Number(result.meta.last_row_id);

  await writePersonExt(db, newPersonId, {
    suffix: str(data.suffix),
    name_prefix: str(data.name_prefix),
    dl_restrictions: str(data.dl_restrictions),
    dl_endorsements: str(data.dl_endorsements),
    dl_issue_date: str(data.dl_issue_date),
    country: str(data.country),
    document_discriminator: str(data.document_discriminator),
    is_real_id: boolToInt(data.is_real_id),
    is_organ_donor: boolToInt(data.is_organ_donor),
    is_veteran: boolToInt(data.is_veteran),
    under_18_until: str(data.under_18_until),
    under_21_until: str(data.under_21_until),
    aamva_version: data.aamva_version ?? null,
    issuer_id: str(data.issuer_id),
    address2: str(data.address2),
    place_of_birth: str(data.place_of_birth),
    non_resident_indicator: boolToInt(data.non_resident_indicator),
    limited_duration_doc: boolToInt(data.limited_duration_doc),
    card_revision_date: str(data.card_revision_date),
    dl_hazmat_expiry: str(data.dl_hazmat_expiry),
    card_type: str(data.card_type),
    raw_aamva_elements: data.raw_aamva_elements ?? null,
  });

  return { personId: newPersonId, created: true };
}

export async function storeIdPhotos(
  env: { UPLOADS?: R2Bucket },
  receiptId: number,
  front: string | null,
  back: string | null,
): Promise<{ frontKey: string | null; backKey: string | null }> {
  if (!env.UPLOADS) {
    log.warn('UPLOADS R2 bucket not bound — ID photos not stored', { receiptId });
    return { frontKey: null, backKey: null };
  }

  const store = async (dataUrl: string, side: string): Promise<string> => {
    const match = dataUrl.match(/^data:image\/(png|jpeg);base64,(.+)$/);
    if (!match) throw new Error(`Invalid ${side} photo data URL`);
    const [, ext, b64] = match;
    const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
    const key = `serve-receipts/${receiptId}/id-${side}.${ext === 'jpeg' ? 'jpg' : 'png'}`;
    await env.UPLOADS!.put(key, bytes, {
      httpMetadata: { contentType: `image/${ext}` },
    });
    return key;
  };

  const frontKey = front ? await store(front, 'front').catch((e) => {
    log.error('Failed to store ID front photo', { receiptId }, e as Error);
    return null;
  }) : null;

  const backKey = back ? await store(back, 'back').catch((e) => {
    log.error('Failed to store ID back photo', { receiptId }, e as Error);
    return null;
  }) : null;

  return { frontKey, backKey };
}

export async function linkReceiptToPerson(
  db: ReturnType<typeof getDb>,
  receiptId: number,
  personId: number,
  role: 'recipient' | 'subject',
  scanMethod: string | null,
  frontKey: string | null,
  backKey: string | null,
): Promise<void> {
  await execute(db,
    `INSERT OR IGNORE INTO serve_receipt_persons
       (receipt_id, person_id, role, id_scan_method, id_front_r2_key, id_back_r2_key)
     VALUES (?, ?, ?, ?, ?, ?)`,
    receiptId, personId, role, scanMethod, frontKey, backKey);
}
