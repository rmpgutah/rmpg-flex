// ============================================================
// RMPG Flex — Browser IndexedDB Storage Layer
// Mirrors desktop/localDb.js schema using the `idb` package.
// Provides the same data access patterns for offline operation
// in any modern browser.
// ============================================================

import { openDB, IDBPDatabase, DBSchema } from 'idb';

// ─── Database Version & Name ─────────────────────────────────

const DB_NAME = 'rmpg-flex-offline';
const DB_VERSION = 1;

// ─── Schema Type Definitions ─────────────────────────────────

interface User {
  id: number;
  username: string;
  password_hash: string;
  first_name: string | null;
  last_name: string | null;
  full_name: string;
  email: string | null;
  role: string;
  badge_number: string | null;
  phone: string | null;
  status: string;
  avatar_url: string | null;
  created_at: string | null;
  updated_at: string | null;
}

interface Client {
  id: number;
  name: string;
  contact_name: string | null;
  contact_phone: string | null;
  contact_email: string | null;
  address: string | null;
  status: string;
  sla_response_minutes: number;
  created_at: string | null;
  updated_at: string | null;
}

interface Property {
  id: number;
  client_id: number;
  name: string;
  address: string;
  latitude: number | null;
  longitude: number | null;
  property_type: string | null;
  gate_code: string | null;
  alarm_code: string | null;
  post_orders: string | null;
  hazard_notes: string | null;
  is_active: number;
  created_at: string | null;
  updated_at: string | null;
}

interface CallForService {
  id: number;
  local_id: string | null;
  server_id: number | null;
  call_number: string | null;
  incident_type: string;
  priority: string;
  status: string;
  caller_name: string | null;
  caller_phone: string | null;
  location_address: string;
  property_id: number | null;
  client_id: number | null;
  latitude: number | null;
  longitude: number | null;
  description: string | null;
  notes: string;
  source: string;
  assigned_unit_ids: string;
  dispatcher_id: number | null;
  created_at: string;
  updated_at: string | null;
  dispatched_at: string | null;
  enroute_at: string | null;
  onscene_at: string | null;
  cleared_at: string | null;
  closed_at: string | null;
  disposition: string | null;
  is_dirty: number;
  synced_at: string | null;
}

interface Unit {
  id: number;
  call_sign: string;
  officer_id: number | null;
  officer_name: string | null;
  status: string;
  latitude: number | null;
  longitude: number | null;
  current_call_id: number | null;
  last_status_change: string | null;
  capabilities: string;
  is_dirty: number;
  synced_at: string | null;
}

interface Incident {
  id: number;
  local_id: string | null;
  server_id: number | null;
  incident_number: string | null;
  call_id: number | null;
  incident_type: string;
  priority: string;
  status: string;
  location_address: string | null;
  property_id: number | null;
  narrative: string | null;
  officer_id: number;
  supervisor_id: number | null;
  created_at: string;
  updated_at: string;
  is_dirty: number;
  synced_at: string | null;
}

interface TimeEntry {
  id: number;
  local_id: string | null;
  server_id: number | null;
  officer_id: number;
  schedule_id: number | null;
  clock_in: string;
  clock_out: string | null;
  clock_in_latitude: number | null;
  clock_in_longitude: number | null;
  clock_out_latitude: number | null;
  clock_out_longitude: number | null;
  total_hours: number | null;
  break_minutes: number;
  status: string;
  is_dirty: number;
  synced_at: string | null;
}

interface Person {
  id: number;
  first_name: string;
  last_name: string;
  dob: string | null;
  gender: string | null;
  race: string | null;
  address: string | null;
  phone: string | null;
  dl_number: string | null;
  dl_state: string | null;
  flags: string;
  notes: string | null;
  created_at: string | null;
  updated_at: string | null;
}

interface VehicleRecord {
  id: number;
  plate_number: string | null;
  state: string | null;
  make: string | null;
  model: string | null;
  year: number | null;
  color: string | null;
  vin: string | null;
  owner_person_id: number | null;
  flags: string;
  stolen_status: string | null;
  created_at: string | null;
  updated_at: string | null;
}

interface GpsBreadcrumb {
  id?: number; // autoIncrement
  unit_id: number | null;
  officer_id: number;
  call_sign: string | null;
  latitude: number;
  longitude: number;
  accuracy: number | null;
  heading: number | null;
  speed: number | null;
  unit_status: string | null;
  recorded_at: string;
  is_synced: number;
}

interface SyncQueueItem {
  id?: number; // autoIncrement
  method: string;
  endpoint: string;
  body: string | null;
  local_id: string | null;
  table_name: string | null;
  created_at: string;
  attempts: number;
  last_attempt_at: string | null;
  status: string;
  server_response: string | null;
  error: string | null;
}

interface PinSession {
  id?: number; // autoIncrement
  user_id: number;
  authorized_at: string;
  expires_at: string;
  is_active: number;
  created_at: string;
}

interface PinAttempt {
  id?: number; // autoIncrement
  user_id: number;
  success: number;
  attempted_at: string;
}

interface SyncMetadata {
  table_name: string;
  last_pull_at: string | null;
  last_push_at: string | null;
  row_count: number;
}

interface LocalConfig {
  key: string;
  value: string;
  updated_at: string;
}

// ─── DBSchema for idb type safety ───────────────────────────

interface RmpgOfflineDB extends DBSchema {
  users: { key: number; value: User; indexes: { 'by-username': string } };
  clients: { key: number; value: Client };
  properties: { key: number; value: Property; indexes: { 'by-client': number } };
  calls_for_service: {
    key: number;
    value: CallForService;
    indexes: {
      'by-local-id': string;
      'by-status': string;
      'by-dirty': number;
      'by-created': string;
    };
  };
  units: { key: number; value: Unit; indexes: { 'by-call-sign': string; 'by-dirty': number } };
  incidents: {
    key: number;
    value: Incident;
    indexes: {
      'by-local-id': string;
      'by-status': string;
      'by-dirty': number;
      'by-created': string;
    };
  };
  time_entries: {
    key: number;
    value: TimeEntry;
    indexes: { 'by-local-id': string; 'by-officer': number; 'by-dirty': number };
  };
  persons: {
    key: number;
    value: Person;
    indexes: { 'by-last-name': string };
  };
  vehicles_records: {
    key: number;
    value: VehicleRecord;
    indexes: { 'by-plate': string };
  };
  gps_breadcrumbs: {
    key: number;
    value: GpsBreadcrumb;
    indexes: { 'by-synced': number; 'by-recorded': string };
  };
  sync_queue: {
    key: number;
    value: SyncQueueItem;
    indexes: { 'by-status': string; 'by-created': string };
  };
  pin_sessions: {
    key: number;
    value: PinSession;
    indexes: { 'by-user-active': [number, number] };
  };
  pin_attempts: {
    key: number;
    value: PinAttempt;
    indexes: { 'by-user-time': [number, string] };
  };
  sync_metadata: { key: string; value: SyncMetadata };
  local_config: { key: string; value: LocalConfig };
}

// ─── Module State ────────────────────────────────────────────

let db: IDBPDatabase<RmpgOfflineDB> | null = null;
let autoIncrementCounters: Record<string, number> = {};

// ─── Public API ──────────────────────────────────────────────

export async function initOfflineDb(): Promise<IDBPDatabase<RmpgOfflineDB>> {
  if (db) return db;

  db = await openDB<RmpgOfflineDB>(DB_NAME, DB_VERSION, {
    upgrade(database) {
      // ── Mirror Tables (10) ──────────────────────────────
      const usersStore = database.createObjectStore('users', { keyPath: 'id' });
      usersStore.createIndex('by-username', 'username', { unique: true });

      database.createObjectStore('clients', { keyPath: 'id' });

      const propsStore = database.createObjectStore('properties', { keyPath: 'id' });
      propsStore.createIndex('by-client', 'client_id');

      const cfsStore = database.createObjectStore('calls_for_service', {
        keyPath: 'id',
        autoIncrement: true,
      });
      cfsStore.createIndex('by-local-id', 'local_id');
      cfsStore.createIndex('by-status', 'status');
      cfsStore.createIndex('by-dirty', 'is_dirty');
      cfsStore.createIndex('by-created', 'created_at');

      const unitsStore = database.createObjectStore('units', { keyPath: 'id' });
      unitsStore.createIndex('by-call-sign', 'call_sign', { unique: true });
      unitsStore.createIndex('by-dirty', 'is_dirty');

      const incStore = database.createObjectStore('incidents', {
        keyPath: 'id',
        autoIncrement: true,
      });
      incStore.createIndex('by-local-id', 'local_id');
      incStore.createIndex('by-status', 'status');
      incStore.createIndex('by-dirty', 'is_dirty');
      incStore.createIndex('by-created', 'created_at');

      const timeStore = database.createObjectStore('time_entries', {
        keyPath: 'id',
        autoIncrement: true,
      });
      timeStore.createIndex('by-local-id', 'local_id');
      timeStore.createIndex('by-officer', 'officer_id');
      timeStore.createIndex('by-dirty', 'is_dirty');

      const personsStore = database.createObjectStore('persons', { keyPath: 'id' });
      personsStore.createIndex('by-last-name', 'last_name');

      const vehiclesStore = database.createObjectStore('vehicles_records', { keyPath: 'id' });
      vehiclesStore.createIndex('by-plate', 'plate_number');

      const gpsStore = database.createObjectStore('gps_breadcrumbs', {
        keyPath: 'id',
        autoIncrement: true,
      });
      gpsStore.createIndex('by-synced', 'is_synced');
      gpsStore.createIndex('by-recorded', 'recorded_at');

      // ── Local Tables (5) ────────────────────────────────
      const queueStore = database.createObjectStore('sync_queue', {
        keyPath: 'id',
        autoIncrement: true,
      });
      queueStore.createIndex('by-status', 'status');
      queueStore.createIndex('by-created', 'created_at');

      const pinSessionStore = database.createObjectStore('pin_sessions', {
        keyPath: 'id',
        autoIncrement: true,
      });
      pinSessionStore.createIndex('by-user-active', ['user_id', 'is_active']);

      const pinAttemptStore = database.createObjectStore('pin_attempts', {
        keyPath: 'id',
        autoIncrement: true,
      });
      pinAttemptStore.createIndex('by-user-time', ['user_id', 'attempted_at']);

      database.createObjectStore('sync_metadata', { keyPath: 'table_name' });
      database.createObjectStore('local_config', { keyPath: 'key' });
    },
  });

  return db;
}

export function getOfflineDb(): IDBPDatabase<RmpgOfflineDB> {
  if (!db) throw new Error('Offline DB not initialized. Call initOfflineDb() first.');
  return db;
}

export function isOfflineDbReady(): boolean {
  return db !== null;
}

// ─── Upsert (INSERT OR REPLACE) ─────────────────────────────

// Concrete union of all store names (avoids keyof widening to string)
type StoreName =
  | 'users' | 'clients' | 'properties' | 'calls_for_service' | 'units'
  | 'incidents' | 'time_entries' | 'persons' | 'vehicles_records'
  | 'gps_breadcrumbs' | 'sync_queue' | 'pin_sessions' | 'pin_attempts'
  | 'sync_metadata' | 'local_config';

export async function upsertRow(tableName: StoreName, row: any): Promise<void> {
  const database = getOfflineDb();
  await database.put(tableName, row);
}

// ─── Full Replace (reference tables) ─────────────────────────

export async function replaceTable(tableName: StoreName, rows: any[]): Promise<void> {
  const database = getOfflineDb();
  const tx = database.transaction(tableName, 'readwrite');
  await tx.store.clear();
  for (const row of rows) {
    await tx.store.put(row);
  }
  await tx.done;
  await updateSyncMeta(tableName, rows.length);
}

// ─── Delta Sync (operational tables) ─────────────────────────
// Only updates rows that are NOT dirty locally (local writes win)

export async function deltaSync(tableName: StoreName, rows: any[]): Promise<void> {
  const database = getOfflineDb();
  const tx = database.transaction(tableName, 'readwrite');

  for (const row of rows) {
    const existing = await tx.store.get(row.id);
    if (!existing || !(existing as any).is_dirty) {
      await tx.store.put({
        ...row,
        is_dirty: 0,
        synced_at: new Date().toISOString(),
      });
    }
  }

  await tx.done;

  // Update sync metadata
  const count = await database.count(tableName);
  await updateSyncMeta(tableName, count);
}

// ─── Sync Metadata ──────────────────────────────────────────

async function updateSyncMeta(tableName: string, rowCount: number): Promise<void> {
  const database = getOfflineDb();
  await database.put('sync_metadata', {
    table_name: tableName,
    last_pull_at: new Date().toISOString(),
    last_push_at: null,
    row_count: rowCount,
  });
}

export async function getSyncMeta(tableName: string): Promise<SyncMetadata> {
  const database = getOfflineDb();
  const meta = await database.get('sync_metadata', tableName);
  return meta || {
    table_name: tableName,
    last_pull_at: null,
    last_push_at: null,
    row_count: 0,
  };
}

// ─── Local Config (key-value store) ─────────────────────────

export async function getConfig(key: string): Promise<string | null> {
  const database = getOfflineDb();
  const row = await database.get('local_config', key);
  return row ? row.value : null;
}

export async function setConfig(key: string, value: string): Promise<void> {
  const database = getOfflineDb();
  await database.put('local_config', {
    key,
    value,
    updated_at: new Date().toISOString(),
  });
}

// ─── Sync Queue ─────────────────────────────────────────────

export async function enqueue(
  method: string,
  endpoint: string,
  body: any,
  localId: string | null,
  tableName: string | null
): Promise<void> {
  const database = getOfflineDb();
  await database.add('sync_queue', {
    method,
    endpoint,
    body: body ? JSON.stringify(body) : null,
    local_id: localId,
    table_name: tableName,
    created_at: new Date().toISOString(),
    attempts: 0,
    last_attempt_at: null,
    status: 'pending',
    server_response: null,
    error: null,
  } as any);
}

export async function getPendingQueue(limit: number = 50): Promise<SyncQueueItem[]> {
  const database = getOfflineDb();
  const all = await database.getAllFromIndex('sync_queue', 'by-status', 'pending');
  // Sort by created_at ascending, limit
  return all
    .sort((a, b) => (a.created_at || '').localeCompare(b.created_at || ''))
    .slice(0, limit);
}

export async function markQueueItem(
  id: number,
  status: string,
  serverResponse: string | null,
  error: string | null
): Promise<void> {
  const database = getOfflineDb();
  const item = await database.get('sync_queue', id);
  if (!item) return;

  await database.put('sync_queue', {
    ...item,
    status,
    server_response: serverResponse,
    error,
    attempts: (item.attempts || 0) + 1,
    last_attempt_at: new Date().toISOString(),
  });
}

export async function getQueueDepth(): Promise<number> {
  const database = getOfflineDb();
  const pending = await database.getAllFromIndex('sync_queue', 'by-status', 'pending');
  return pending.length;
}

// ─── Convenience Getters ────────────────────────────────────

export async function getAll(tableName: StoreName): Promise<any[]> {
  const database = getOfflineDb();
  return database.getAll(tableName);
}

export async function getById(tableName: StoreName, id: number | string): Promise<any | undefined> {
  const database = getOfflineDb();
  return database.get(tableName, id as any);
}

export async function getByIndex(tableName: StoreName, indexName: string, value: any): Promise<any[]> {
  const database = getOfflineDb();
  const tx = database.transaction(tableName, 'readonly');
  const store = tx.objectStore(tableName);
  const idx = (store as any).index(indexName);
  return idx.getAll(value);
}

export async function countStore(tableName: StoreName): Promise<number> {
  const database = getOfflineDb();
  return database.count(tableName);
}

// ─── Type Exports ────────────────────────────────────────────

export type {
  User,
  Client,
  Property,
  CallForService,
  Unit,
  Incident,
  TimeEntry,
  Person,
  VehicleRecord,
  GpsBreadcrumb,
  SyncQueueItem,
  PinSession,
  PinAttempt,
  SyncMetadata,
  LocalConfig,
  RmpgOfflineDB,
  StoreName,
};
