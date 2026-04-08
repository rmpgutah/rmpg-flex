// ============================================================
// ServeManager Integration Types
// ============================================================

// ── Integration status ────────────────────────────────

export interface SMIntegrationStatus {
  configured: boolean;
  last_sync: SMSyncLogEntry | null;
  cached_jobs: number;
  cached_attempts: number;
}

export interface SMSyncLogEntry {
  id: number;
  sync_type: 'full' | 'incremental' | 'single_job';
  status: 'running' | 'completed' | 'failed';
  jobs_synced: number;
  attempts_synced: number;
  error_message: string | null;
  started_at: string;
  completed_at: string | null;
}

// ── Cached data (local SQLite shapes) ─────────────────

export interface SMCachedJob {
  id: number;
  sm_job_number: string;
  job_status: string | null;
  service_status: 'Attempted' | 'Non-Service' | 'Served' | null;
  client_job_number: string | null;
  rush: number;
  due_date: string | null;
  service_instructions: string | null;
  recipient_name: string | null;
  recipient_description: string | null;
  client_company_name: string | null;
  client_company_id: number | null;
  process_server_name: string | null;
  employee_process_server_id: number | null;
  court_case_number: string | null;
  court_case_id: number | null;
  attempt_count: number;
  last_attempt_at: string | null;
  addresses_json: string;
  documents_json: string;
  archived_at: string | null;
  sm_created_at: string;
  sm_updated_at: string;
  synced_at: string;
  linked_warrant_id: number | null;
  linked_call_id: number | null;
  notes_local: string | null;
}

export interface SMCachedAttempt {
  id: number;
  job_id: number;
  description: string | null;
  success: number;
  service_status: string | null;
  serve_type: string | null;
  served_at: string | null;
  lat: number | null;
  lng: number | null;
  gps_timestamp: string | null;
  server_name: string | null;
  recipient_name: string | null;
  attachments_json: string;
  sm_created_at: string;
  sm_updated_at: string;
  synced_at: string;
}

// ── Live API response shapes ──────────────────────────

export interface SMRecipient {
  name: string;
  description?: string;
  age?: number;
  ethnicity?: string;
  gender?: string;
  weight?: string;
  height1?: string;
  height2?: string;
  hair?: string;
  eyes?: string;
  relationship?: string;
}

export interface SMAddress {
  type: 'address';
  id: number;
  label: string;
  address1: string;
  address2?: string;
  city: string;
  state: string;
  postal_code: string;
  county?: string;
  lat?: number;
  lng?: number;
  primary: boolean;
  created_at: string;
  updated_at: string;
}

export interface SMDocument {
  type: 'document_to_be_served';
  id: number;
  title: string;
  affidavit?: boolean;
  signed?: boolean;
  received_at?: string;
  created_at: string;
  updated_at: string;
}

export interface SMCompany {
  type: 'company';
  id: number;
  name: string;
}

export interface SMCourtCase {
  type: 'court_case';
  id: number;
  plaintiff: string;
  defendant: string;
  number: string;
  filed_date?: string;
  court_date?: string;
}

export interface SMEmployee {
  id: number;
  first_name: string;
  last_name: string;
  email?: string;
  phone?: string;
  license_number?: string;
}

export interface SMJobLive {
  type: 'job';
  id: number;
  servemanager_job_number: string;
  job_status: string | null;
  service_status: string | null;
  client_job_number?: string;
  rush: boolean;
  due_date?: string;
  service_instructions?: string;
  created_at: string;
  updated_at: string;
  archived_at?: string;
  recipient: SMRecipient;
  addresses: SMAddress[];
  documents_to_be_served: SMDocument[];
  attempts: SMAttemptLive[];
  attempt_count: number;
  last_attempt_served_at?: string;
  client_company?: SMCompany;
  court_case?: SMCourtCase;
  employee_process_server?: SMEmployee;
}

export interface SMAttemptLive {
  type: 'attempt';
  id: number;
  job_id: number;
  description?: string;
  success: boolean;
  service_status: string | null;
  serve_type?: string;
  served_at?: string;
  lat?: number;
  lng?: number;
  gps_timestamp?: string;
  server_name?: string;
  created_at: string;
  updated_at: string;
  attachments: any[];
}

// ── Auto-Poller status ───────────────────────────────

export interface SMPollerStatus {
  enabled: boolean;
  poll_interval: number;
  target_client: string;
  auto_create_calls: boolean;
  last_poll_at: string | null;
}

// ── API response wrappers ─────────────────────────────

export interface SMConnectionTestResult {
  success: boolean;
  account?: { company_name?: string; [key: string]: any };
  error?: string;
}

export interface SMSyncResult {
  success: boolean;
  sync_id: number;
  type: string;
  jobs_synced: number;
  attempts_synced: number;
}

export interface SMPaginatedResponse<T> {
  data: T[];
  pagination?: {
    page: number;
    per_page: number;
    total: number;
    totalPages: number;
  };
  links?: {
    self: string;
    first: string;
    last: string;
    prev: string | null;
    next: string | null;
  };
}
