import { execute, queryFirst } from '../db';

export interface SourceDefinition {
  name: string;
  displayName: string;
  category: 'people' | 'court' | 'property' | 'business' | 'registry' | 'osint';
  costPerLookup: number;
  openSource: boolean;
  configKey?: string;
}

/** Skip Tracker 3.5 — local RMS + open-source enrichment + paid RapidAPI + vehicle APIs. */
export const SKIPTRACER_V2_SOURCES: SourceDefinition[] = [
  { name: 'local_rms', displayName: 'Local RMS', category: 'people', costPerLookup: 0, openSource: true },
  { name: 'rapidapi_skiptrace', displayName: 'RapidAPI Skip Trace', category: 'people', costPerLookup: 0.05, openSource: false, configKey: 'skiptracer_rapidapi_key' },
  { name: 'vehicle_enrichment', displayName: 'Vehicle Enrichment (Plate→VIN)', category: 'osint', costPerLookup: 0.05, openSource: false },
  { name: 'vehicle_vin_decoder', displayName: 'VIN Decoder', category: 'osint', costPerLookup: 0.03, openSource: false },
  { name: 'nsopw', displayName: 'NSOPW Registry', category: 'registry', costPerLookup: 0, openSource: true },
  { name: 'sl_assessor', displayName: 'SL County Assessor', category: 'property', costPerLookup: 0, openSource: true },
  { name: 'open_sanctions', displayName: 'OpenSanctions', category: 'registry', costPerLookup: 0, openSource: true },
  { name: 'fbi_wanted', displayName: 'FBI Most Wanted', category: 'registry', costPerLookup: 0, openSource: true },
  { name: 'bop_inmates', displayName: 'BOP Inmate Locator', category: 'registry', costPerLookup: 0, openSource: true },
  { name: 'census_geocoder', displayName: 'Census Geocoder', category: 'property', costPerLookup: 0, openSource: true },
  { name: 'ofac_sdn', displayName: 'OFAC SDN', category: 'registry', costPerLookup: 0, openSource: true },
  { name: 'usps', displayName: 'USPS Address', category: 'property', costPerLookup: 0, openSource: false, configKey: 'usps_user_id' },
  { name: 'open_corporates', displayName: 'OpenCorporates', category: 'business', costPerLookup: 0, openSource: false, configKey: 'opencorporates_api_key' },
  { name: 'numverify', displayName: 'NumVerify', category: 'osint', costPerLookup: 0, openSource: false, configKey: 'numverify_api_key' },
];

async function getConfigValue(db: D1Database, key: string): Promise<string | null> {
  const row = await queryFirst<{ config_value: string }>(db,
    'SELECT config_value FROM system_config WHERE config_key = ? AND is_active = 1 LIMIT 1', key);
  return row?.config_value ?? null;
}

export async function listSourceInfo(
  db: D1Database,
  env?: Record<string, unknown>,
): Promise<Array<{
  name: string;
  displayName: string;
  category: string;
  costPerLookup: number;
  configured: boolean;
  enabled: boolean;
  healthy: boolean;
}>> {
  const out = [];
  for (const src of SKIPTRACER_V2_SOURCES) {
    const enabledRaw = await getConfigValue(db, `skiptracer_v2_source_${src.name}_enabled`);
    const enabled = enabledRaw !== '0' && enabledRaw !== 'false';
    let configured = src.configKey
      ? Boolean((await getConfigValue(db, src.configKey))?.trim())
      : true;

    if (src.name === 'rapidapi_skiptrace' && !configured) {
      configured = Boolean((await getConfigValue(db, 'plate_check_rapidapi_key'))?.trim());
    }
    if (src.name === 'open_sanctions') {
      configured = Boolean(
        (typeof env?.OPENSANCTIONS_API_KEY === 'string' && env.OPENSANCTIONS_API_KEY.trim())
        || (await getConfigValue(db, 'opensanctions_api_key'))?.trim(),
      );
    }
    if (src.name === 'usps') {
      configured = Boolean(
        (typeof env?.USPS_USER_ID === 'string' && env.USPS_USER_ID.trim())
        || (await getConfigValue(db, 'usps_user_id'))?.trim(),
      );
    }
    if (src.name === 'open_corporates') {
      configured = Boolean(
        (typeof env?.OPENCORPORATES_API_KEY === 'string' && env.OPENCORPORATES_API_KEY.trim())
        || (await getConfigValue(db, src.configKey!))?.trim(),
      );
    }
    if (src.name === 'numverify') {
      configured = Boolean(
        (typeof env?.NUMVERIFY_API_KEY === 'string' && env.NUMVERIFY_API_KEY.trim())
        || (await getConfigValue(db, src.configKey!))?.trim(),
      );
    }
    if (src.name === 'vehicle_enrichment') {
      configured = !!(env?.PLATE_TO_VIN_API_KEY || env?.VIN_DECODER_API_KEY || env?.PLATE_DECODER_API_KEY);
    }
    if (src.name === 'vehicle_vin_decoder') {
      configured = !!env?.VIN_DECODER_API_KEY;
    }

    out.push({
      name: src.name,
      displayName: src.displayName,
      category: src.category,
      costPerLookup: src.costPerLookup,
      configured,
      enabled,
      healthy: configured && enabled,
    });
  }
  return out;
}

export async function upsertSourceConfig(
  db: D1Database,
  name: string,
  patch: { enabled?: boolean; apiKey?: string },
): Promise<void> {
  const src = SKIPTRACER_V2_SOURCES.find(s => s.name === name);
  if (!src) throw new Error('unknown source');

  if (patch.enabled !== undefined) {
    const key = `skiptracer_v2_source_${name}_enabled`;
    const value = patch.enabled ? '1' : '0';
    await execute(db, "DELETE FROM system_config WHERE config_key = ? AND category = 'skiptracer_v2'", key);
    await execute(db,
      "INSERT INTO system_config (config_key, config_value, category, is_active) VALUES (?, ?, 'skiptracer_v2', 1)",
      key, value,
    );
  }

  if (patch.apiKey && src.configKey) {
    await execute(db, "DELETE FROM system_config WHERE config_key = ? AND category = 'skiptracer_v2'", src.configKey);
    await execute(db,
      "INSERT INTO system_config (config_key, config_value, category, is_active) VALUES (?, ?, 'skiptracer_v2', 1)",
      src.configKey, patch.apiKey,
    );
  }
}
