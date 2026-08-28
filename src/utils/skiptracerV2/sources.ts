import { execute, queryFirst } from '../db';

export interface SourceDefinition {
  name: string;
  displayName: string;
  category: 'people' | 'court' | 'property' | 'business' | 'registry' | 'osint';
  costPerLookup: number;
  configKey: string | null;
  envKey?: string;
}

export const SKIPTRACER_V2_SOURCES: SourceDefinition[] = [
  { name: 'local_rms', displayName: 'Local RMS', category: 'people', costPerLookup: 0, configKey: null },
  { name: 'microbilt_cache', displayName: 'MicroBilt Cache', category: 'people', costPerLookup: 0, configKey: null },
  { name: 'rapidapi_skiptrace', displayName: 'RapidAPI Skip Trace', category: 'people', costPerLookup: 0.05, configKey: 'skiptracer_rapidapi_key' },
  { name: 'nsopw', displayName: 'NSOPW Registry', category: 'registry', costPerLookup: 0, configKey: null },
  { name: 'sl_assessor', displayName: 'SL County Assessor', category: 'property', costPerLookup: 0, configKey: null },
  { name: 'open_sanctions', displayName: 'OpenSanctions', category: 'registry', costPerLookup: 0, configKey: null },
  { name: 'fbi_wanted', displayName: 'FBI Most Wanted', category: 'registry', costPerLookup: 0, configKey: null },
  { name: 'bop_inmates', displayName: 'BOP Inmate Locator', category: 'registry', costPerLookup: 0, configKey: null },
  { name: 'usps', displayName: 'USPS Web Tools', category: 'property', costPerLookup: 0, configKey: null, envKey: 'USPS_USER_ID' },
  { name: 'open_corporates', displayName: 'OpenCorporates', category: 'business', costPerLookup: 0, configKey: null, envKey: 'OPENCORPORATES_API_KEY' },
  { name: 'numverify', displayName: 'Numverify', category: 'osint', costPerLookup: 0, configKey: null, envKey: 'NUMVERIFY_API_KEY' },
  { name: 'census_geocoder', displayName: 'Census Geocoder', category: 'property', costPerLookup: 0, configKey: null },
  { name: 'ofac_sdn', displayName: 'OFAC SDN', category: 'registry', costPerLookup: 0, configKey: null },
];

async function getConfigValue(db: D1Database, key: string): Promise<string | null> {
  const row = await queryFirst<{ config_value: string }>(db,
    'SELECT config_value FROM system_config WHERE config_key = ? AND is_active = 1 LIMIT 1', key);
  return row?.config_value ?? null;
}

export async function listSourceInfo(
  db: D1Database,
  env: Record<string, unknown>,
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
    let configured = true;
    if (src.configKey) {
      configured = Boolean((await getConfigValue(db, src.configKey))?.trim());
    } else if (src.envKey) {
      configured = Boolean(String(env[src.envKey] ?? '').trim());
    }
    const enabledRaw = await getConfigValue(db, `skiptracer_v2_source_${src.name}_enabled`);
    const enabled = enabledRaw !== '0' && enabledRaw !== 'false';
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
