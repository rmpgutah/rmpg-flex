// ============================================================
// RMPG Flex CAD/RMS - TypeScript Type Definitions
// ============================================================

// --- Auth & Users ---

export type UserRole = 'admin' | 'manager' | 'supervisor' | 'officer' | 'dispatcher' | 'contract_manager';

export interface User {
  id: string;
  username: string;
  email: string;
  first_name: string;
  last_name: string;
  middle_name?: string;
  full_name?: string;
  role: UserRole;
  badge_number?: string;
  phone?: string;
  rank?: string;
  department?: string;
  address?: string;
  city?: string;
  state?: string;
  zip?: string;
  date_of_birth?: string;
  hire_date?: string;
  termination_date?: string;
  shift_preference?: string;
  dl_number?: string;
  dl_state?: string;
  dl_expiry?: string;
  blood_type?: string;
  allergies?: string;
  uniform_size?: string;
  emergency_contact_name?: string;
  emergency_contact_phone?: string;
  emergency_contact_relationship?: string;
  employee_id?: string;
  certifications?: string;
  notes?: string;
  profile_image?: string;
  last_password_change?: string;
  must_change_password?: boolean;
  login_count?: number;
  /** Unit call sign from the units table (e.g. "D-101") */
  unit_call_sign?: string;
  totp_enabled?: boolean;
  requires_2fa_setup?: boolean;
  /** PNG base64 data URL of officer's digital signature */
  digital_signature?: string | null;
  /** Server returns status='active'|'inactive'|'terminated' */
  status?: string;
  is_active: boolean;
  last_login?: string;
  created_at: string;
  updated_at: string;
  // Security fields (camelCase aliases returned by security dashboard)
  totpEnabled?: boolean;
  totpSetupRequired?: boolean;
  passwordExpiresAt?: string;
  passwordExpiringSoon?: boolean;
  forcePasswordChange?: boolean;
  passwordChangedAt?: string;
}

// --- Security Types ---

export interface TrustedDevice {
  id: number;
  device_name: string;
  ip_address: string;
  trusted_until: string;
  last_used_at: string;
  created_at: string;
}

export interface LoginHistoryEntry {
  id: number;
  ip_address: string;
  user_agent: string;
  device_fingerprint: string;
  success: number;
  failure_reason: string | null;
  created_at: string;
}

export interface SecurityNotification {
  id: number;
  event_type: string;
  title: string;
  details: string | null;
  ip_address: string | null;
  device_info: string | null;
  is_read: number;
  created_at: string;
}

export interface SecurityStatus {
  totpEnabled: boolean;
  totpSetupRequired: boolean;
  backupCodesRemaining: number;
  activeSessions: number;
  trustedDevices: number;
  passwordExpiresAt: string | null;
  passwordExpiringSoon: boolean;
  passwordExpired: boolean;
  passwordChangedAt: string | null;
  forcePasswordChange: boolean;
  unreadSecurityNotifications: number;
}

// --- Clients & Properties ---

export interface Client {
  id: string;
  name: string;
  client_code?: string;
  industry?: string;
  website?: string;
  contact_name: string;
  contact_email: string;
  contact_phone: string;
  address: string;
  billing_email?: string;
  billing_address?: string;
  tax_id?: string;
  payment_method?: string;
  billing_cycle?: string;
  billing_day?: number;
  contract_start?: string;
  contract_end?: string;
  contract_type?: string;
  contract_value?: number;
  payment_terms?: string;
  auto_renew?: boolean;
  sla_response_minutes?: number;
  discount_percent?: number;
  late_fee_percent?: number;
  total_invoiced?: number;
  total_paid?: number;
  outstanding_balance?: number;
  rate_per_hour?: number;
  rate_per_incident?: number;
  rate_per_cfs?: number;
  incident_count?: number;
  last_incident_date?: string;
  account_manager?: string;
  priority_client?: boolean;
  client_since?: string;
  is_active: boolean;
  notes?: string;
  created_at: string;
  updated_at: string;
}

export interface Property {
  id: string;
  client_id: string;
  client_name?: string;
  name: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  latitude?: number;
  longitude?: number;
  property_type?: string;
  gate_code?: string;
  alarm_code?: string;
  emergency_contact?: string;
  post_orders?: string;
  hazard_notes?: string;
  access_instructions?: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

// --- CAD / Dispatch ---

export type CallPriority = 'P1' | 'P2' | 'P3' | 'P4';

export type CallStatus =
  | 'pending'
  | 'dispatched'
  | 'enroute'
  | 'onscene'
  | 'cleared'
  | 'closed'
  | 'cancelled'
  | 'archived'
  | 'on_hold';

import type { IncidentType as _IncidentType } from '../utils/caseNumbers';
export type IncidentType = _IncidentType;

export type CallSource =
  | 'phone'
  | 'radio'
  | 'walk_in'
  | 'alarm'
  | 'patrol'
  | 'online'
  | 'dispatch'
  | 'panic'
  | 'other';

export interface CallNote {
  id: string;
  author: string;
  text: string;
  timestamp: string;
}

export interface CallForService {
  id: string;
  call_number: string;
  incident_type: IncidentType;
  priority: CallPriority;
  status: CallStatus;
  caller_name?: string;
  caller_phone?: string;
  caller_relationship?: string;
  caller_address?: string;
  location: string;
  latitude?: number | null;
  longitude?: number | null;
  property_id?: string;
  property_name?: string;
  client_id?: string;
  client_name?: string;
  description: string;
  source: CallSource;
  assigned_units: string[];
  notes: CallNote[];
  disposition?: string;
  // Location details
  cross_street?: string;
  location_building?: string;
  location_floor?: string;
  location_room?: string;
  zone_beat?: string;
  section_id?: string;
  zone_id?: string;
  beat_id?: string;
  // Dispatch district data (from geofence auto-fill)
  dispatch_code?: string;
  section_name?: string;
  zone_name?: string;
  beat_name?: string;
  beat_descriptor?: string;
  // Case linkage
  case_id?: number;
  case_number?: string;
  // Contract ID (PSO Client Request)
  contract_id?: string;
  // Subject/threat info
  weapons_involved?: string;
  injuries_reported?: boolean;
  num_subjects?: number;
  num_victims?: number;
  subject_description?: string;
  vehicle_description?: string;
  direction_of_travel?: string;
  // Scene details
  scene_safety?: string;
  weather_conditions?: string;
  lighting_conditions?: string;
  // Flags
  alcohol_involved?: boolean;
  drugs_involved?: boolean;
  domestic_violence?: boolean;
  supervisor_notified?: boolean;
  le_notified?: boolean;
  le_agency?: string;
  le_case_number?: string;
  // Additional operational flags
  mental_health_crisis?: boolean;
  juvenile_involved?: boolean;
  felony_in_progress?: boolean;
  officer_safety_caution?: boolean;
  k9_requested?: boolean;
  ems_requested?: boolean;
  fire_requested?: boolean;
  hazmat?: boolean;
  gang_related?: boolean;
  evidence_collected?: boolean;
  body_camera_active?: boolean;
  photos_taken?: boolean;
  trespass_issued?: boolean;
  vehicle_pursuit?: boolean;
  foot_pursuit?: boolean;
  // PSO Client Request fields
  pso_requestor_name?: string;
  pso_requestor_phone?: string;
  pso_requestor_email?: string;
  pso_service_type?: string;
  pso_billing_code?: string;
  pso_authorization?: string;
  pso_attempt_number?: number;
  // Process Service fields
  process_service_type?: string;
  process_served_to?: string;
  process_served_address?: string;
  process_attempts?: number;
  process_served_at?: string;
  process_service_result?: string;
  // Damage
  damage_estimate?: number;
  damage_description?: string;
  // Resolution
  action_taken?: string;
  responding_officer?: string;
  secondary_type?: string;
  contact_method?: string;
  // Mileage
  starting_mileage?: number;
  ending_mileage?: number;
  responding_vehicle_id?: string;
  // Timestamps
  created_at: string;
  dispatched_at?: string;
  enroute_at?: string;
  onscene_at?: string;
  cleared_at?: string;
  closed_at?: string;
  archived_at?: string;
  previous_status?: CallStatus;
  created_by: string;
  updated_at: string;
}

// --- Units ---

export type UnitStatus =
  | 'available'
  | 'dispatched'
  | 'enroute'
  | 'onscene'
  | 'busy'
  | 'off_duty';

export interface Unit {
  id: string;
  call_sign: string;
  officer_id: string;
  officer_name: string;
  badge_number?: string;
  status: UnitStatus;
  current_call_id?: string;
  current_call_number?: string;
  location?: string;
  latitude?: number;
  longitude?: number;
  vehicle?: string;
  last_status_change: string;
  created_at: string;
  updated_at: string;
}

// --- Incidents / Reports ---

export type IncidentStatus =
  | 'draft'
  | 'submitted'
  | 'under_review'
  | 'approved'
  | 'returned';

export interface Incident {
  id: string;
  incident_number: string;
  call_id?: string;
  call_number?: string;
  type: IncidentType;
  priority: CallPriority;
  status: IncidentStatus;
  title: string;
  location: string;
  narrative: string;
  officer_id: string;
  officer_name: string;
  reviewer_id?: string;
  reviewer_name?: string;
  review_notes?: string;
  persons_involved: string[];
  vehicles_involved: string[];
  evidence_ids: string[];
  media_urls: string[];
  occurred_at: string;
  submitted_at?: string;
  approved_at?: string;
  client_id?: string;
  client_name?: string;
  created_at: string;
  updated_at: string;
}

// --- Records ---

export interface Person {
  id: string;
  first_name: string;
  last_name: string;
  middle_name?: string;
  alias_nickname?: string;
  date_of_birth?: string;
  gender?: string;
  race?: string;
  height?: string;
  height_feet?: number | null;
  height_inches?: number | null;
  weight?: string;
  build?: string;
  complexion?: string;
  hair_color?: string;
  eye_color?: string;
  scars_marks_tattoos?: string;
  clothing_description?: string;
  address?: string;
  city?: string;
  state?: string;
  zip?: string;
  phone?: string;
  email?: string;
  dl_number?: string;
  dl_state?: string;
  dl_expiry?: string;
  dl_class?: string;
  ssn_last4?: string;
  ssn_full?: string;
  id_image_url?: string;
  id_type?: string;
  id_number?: string;
  id_state?: string;
  id_expiry?: string;
  employer?: string;
  occupation?: string;
  emergency_contact_name?: string;
  emergency_contact_phone?: string;
  gang_affiliation?: string;
  is_sex_offender?: boolean;
  is_veteran?: boolean;
  language?: string;
  place_of_birth?: string;
  citizenship?: string;
  marital_status?: string;
  hair_length?: string;
  hair_style?: string;
  facial_hair?: string;
  glasses?: string;
  shoe_size?: string;
  blood_type?: string;
  phone_secondary?: string;
  social_media?: string;
  probation_parole?: string;
  probation_parole_officer?: string;
  known_associates?: string;
  emergency_contact_relationship?: string;
  caution_flags?: string;
  flags: string[];
  notes?: string;
  incident_ids: string[];
  created_at: string;
  updated_at: string;
}

export interface Vehicle {
  id: string;
  license_plate: string;
  plate_state: string;
  make: string;
  model: string;
  year: number;
  color: string;
  secondary_color?: string;
  body_style?: string;
  doors?: number;
  vin?: string;
  owner_name?: string;
  owner_id?: string;
  insurance_company?: string;
  insurance_policy?: string;
  registration_expiry?: string;
  damage_description?: string;
  distinguishing_features?: string;
  trim?: string;
  engine_type?: string;
  fuel_type?: string;
  transmission?: string;
  drive_type?: string;
  tow_status?: string;
  tow_company?: string;
  tow_date?: string;
  plate_type?: string;
  commercial_vehicle?: boolean;
  hazmat?: boolean;
  odometer?: string;
  owner_address?: string;
  owner_phone?: string;
  lien_holder?: string;
  stolen_status?: string;
  stolen_date?: string;
  recovery_date?: string;
  flags: string[];
  notes?: string;
  incident_ids: string[];
  created_at: string;
  updated_at: string;
}

export interface Evidence {
  id: string;
  evidence_number: string;
  incident_id?: string;
  incident_number?: string;
  type: string;
  description: string;
  location_found: string;
  collected_by: string;
  collected_at: string;
  storage_location: string;
  chain_of_custody: CustodyEntry[];
  status: 'in_storage' | 'checked_out' | 'released' | 'destroyed';
  collected_date?: string;
  packaging_type?: string;
  dimensions?: string;
  weight?: string;
  photo_taken?: boolean;
  lab_submitted?: boolean;
  lab_case_number?: string;
  lab_name?: string;
  disposal_method?: string;
  disposal_date?: string;
  disposal_authorized_by?: string;
  serial_number?: string;
  brand?: string;
  model?: string;
  estimated_value?: number;
  category?: string;
  notes?: string;
  created_at: string;
  updated_at: string;
}

export interface CustodyEntry {
  id: string;
  action: 'collected' | 'transferred' | 'checked_out' | 'returned' | 'released' | 'destroyed';
  from_person?: string;
  to_person: string;
  reason: string;
  timestamp: string;
}

export type RecordEntityType = 'person' | 'vehicle' | 'property' | 'evidence' | 'case' | 'incident';

export interface RecordLink {
  id: string;
  source_type: RecordEntityType;
  source_id: string;
  target_type: RecordEntityType;
  target_id: string;
  relationship: string;
  notes?: string;
  created_by: string;
  created_by_name?: string;
  created_at: string;
  target_label?: string;
}

// --- Connection Analysis Graph Types ---

export interface GraphNode {
  id: string;
  type: RecordEntityType;
  entityId: number;
  label: string;
  metadata: Record<string, any>;
  depth: number;
}

export interface GraphEdge {
  source: string;
  target: string;
  relationship: string;
  sourceTable: string;
}

export interface ConnectionGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

// --- Email Types ---

export interface EmailMessage {
  id: string;
  conversationId?: string;
  subject: string;
  fromAddress: string;
  fromName: string;
  toAddresses: { email: string; name?: string }[];
  ccAddresses: { email: string; name?: string }[];
  bodyPreview: string;
  bodyHtml?: string;
  hasAttachments: boolean;
  isRead: boolean;
  isFlagged: boolean;
  importance: string;
  receivedAt: string;
  sentAt?: string;
}

export interface EmailFolder {
  id: string;
  displayName: string;
  parentFolderId?: string;
  totalItemCount: number;
  unreadItemCount: number;
  childFolderCount?: number;
}

export interface EmailAttachment {
  id: string;
  name: string;
  contentType: string;
  size: number;
  isInline: boolean;
  contentId?: string;
}

export interface EmailComposeData {
  to: string;
  cc?: string;
  subject: string;
  body: string;
}

// --- BOLOs ---

export type BOLOStatus = 'active' | 'expired' | 'cancelled' | 'resolved';
export type BOLOType = 'person' | 'vehicle' | 'property' | 'other';

export interface BOLO {
  id: string;
  bolo_number: string;
  type: BOLOType;
  status: BOLOStatus;
  title: string;
  description: string;
  priority: CallPriority;
  subject_name?: string;
  subject_description?: string;
  vehicle_description?: string;
  last_known_location?: string;
  photo_url?: string;
  issued_by: string;
  issued_at: string;
  expires_at?: string;
  resolved_at?: string;
  created_at: string;
  updated_at: string;
}

// --- Communications ---

export type MessagePriority = 'normal' | 'urgent' | 'emergency';

export interface Message {
  id: string;
  from_user_id: string;
  from_user_name: string;
  to_user_id?: string;
  to_user_name?: string;
  to_group?: string;
  subject: string;
  body: string;
  priority: MessagePriority;
  is_read: boolean;
  is_broadcast: boolean;
  parent_id?: string;
  thread_id?: string;
  created_at: string;
}

// --- Personnel / Scheduling ---

export interface Schedule {
  id: string;
  officer_id: string;
  officer_name: string;
  shift_start: string;
  shift_end: string;
  property_id?: string;
  property_name?: string;
  position: string;
  notes?: string;
  status: 'scheduled' | 'confirmed' | 'completed' | 'cancelled' | 'no_show';
  created_at: string;
  updated_at: string;
}

export interface TimeEntry {
  id: string;
  officer_id: string;
  officer_name: string;
  clock_in: string;
  clock_out?: string;
  scheduled_start?: string;
  scheduled_end?: string;
  break_start?: string;
  break_minutes: number;
  total_hours?: number;
  status: 'clocked_in' | 'clocked_out' | 'on_break' | 'edited';
  notes?: string;
  created_at: string;
  updated_at: string;
}

export interface Credential {
  id: string;
  officer_id: string;
  officer_name: string;
  type: string;
  credential_number: string;
  issuing_authority: string;
  issued_date: string;
  expiry_date: string;
  status: 'valid' | 'expiring_soon' | 'expired' | 'revoked';
  notes?: string;
  created_at: string;
  updated_at: string;
}

// --- Training & Qualifications ---

export type TrainingStatus = 'completed' | 'in_progress' | 'scheduled' | 'overdue' | 'expired';
export type TrainingCategory = 'firearms' | 'defensive_tactics' | 'first_aid' | 'legal' | 'communication' | 'driving' | 'technology' | 'leadership' | 'compliance' | 'other';

export interface TrainingRecord {
  id: string;
  officer_id: string;
  officer_name: string;
  course_name: string;
  category: TrainingCategory;
  provider: string;
  completed_date?: string;
  expiry_date?: string;
  score?: number;
  hours: number;
  certificate_number?: string;
  status: TrainingStatus;
  notes?: string;
  created_at: string;
  updated_at: string;
}

export interface TrainingRequirement {
  id: string;
  course_name: string;
  category: TrainingCategory;
  required_for_roles: string[];
  renewal_period_months: number;
  minimum_hours: number;
  is_mandatory: boolean;
  description?: string;
  created_at: string;
}

// --- Body Camera ---

export type CameraStatus = 'available' | 'assigned' | 'maintenance' | 'retired' | 'lost';
export type VideoClassification = 'routine' | 'evidence' | 'flagged' | 'restricted';
export type VideoRetention = 'active' | 'archived' | 'pending_deletion';

export interface BodyCamera {
  id: number;
  officer_id: number;
  camera_id: string;
  make: string;
  model: string;
  firmware_version: string;
  storage_capacity_gb: number;
  status: CameraStatus;
  condition: string;
  assigned_at: string;
  returned_at: string;
  notes: string;
  created_by: string;
  created_at: string;
  updated_at: string;
  officer_name?: string;
}

export interface BodyCamVideo {
  id: number;
  camera_id: number;
  officer_id: number;
  title: string;
  file_path: string;
  file_size: number;
  duration_seconds: number;
  mime_type: string;
  recorded_at: string;
  case_number: string;
  classification: VideoClassification;
  retention_status: VideoRetention;
  notes: string;
  uploaded_by: string;
  created_at: string;
  updated_at: string;
  overlay_status?: string;
  officer_name?: string;
  camera_serial?: string;
}

// --- Dash Cam Videos ---

export interface DashCamVideo {
  id: number;
  vehicle_id?: number;
  vehicle_number?: string;
  vehicle_make?: string;
  vehicle_model?: string;
  vehicle_year?: number;
  unit_call_sign?: string;
  title: string;
  file_path: string;
  file_size: number;
  duration_seconds?: number;
  mime_type?: string;
  recorded_at?: string;
  case_number?: string;
  classification: VideoClassification;
  speed_mph?: number;
  latitude?: number;
  longitude?: number;
  address?: string;
  overlay_status?: string;
  overlay_error?: string;
  notes?: string;
  source?: string;              // 'upload' | 'clearpathgps'
  uploaded_by?: string;
  created_at: string;
  updated_at: string;
  // ClearPathGPS media sync fields
  cpg_device_id?: string;
  cpg_channel?: string;         // "outside" | "inside"
  cpg_event_type?: string;
  cpg_thumbnail_url?: string;
  linked_dashcam_event_id?: number;
  /** JSON string of GPS track: [{latitude,longitude,speed,altitude,timestamp},...] */
  cpg_gps_track?: string;
}

// --- Equipment ---

export type EquipmentType = 'radio' | 'body_camera' | 'firearm' | 'taser' | 'baton' | 'handcuffs' | 'vest' | 'badge' | 'id_card' | 'keys' | 'flashlight' | 'vehicle_key' | 'laptop' | 'phone' | 'other';

export type EquipmentCondition = 'new' | 'good' | 'fair' | 'poor' | 'damaged' | 'lost';

export type EquipmentStatus = 'issued' | 'returned' | 'lost' | 'damaged' | 'retired' | 'maintenance';

export interface OfficerEquipment {
  id: string;
  officer_id: string;
  officer_name?: string;
  equipment_type: EquipmentType;
  make?: string;
  model?: string;
  serial_number?: string;
  asset_tag?: string;
  condition: EquipmentCondition;
  status: EquipmentStatus;
  issued_date?: string;
  returned_date?: string;
  notes?: string;
  created_by?: string;
  created_at: string;
  updated_at: string;
}

// --- Deployment ---

export type DeploymentStatus = 'active' | 'completed' | 'scheduled' | 'cancelled';

export interface Deployment {
  id: string;
  officer_id: string;
  officer_name: string;
  property_id: string;
  property_name: string;
  client_name?: string;
  position: string;
  start_date: string;
  end_date?: string;
  status: DeploymentStatus;
  hours_per_week?: number;
  notes?: string;
  created_at: string;
  updated_at: string;
}

export interface CoverageGap {
  property_id: string;
  property_name: string;
  required_officers: number;
  assigned_officers: number;
  gap: number;
  shift_type: string;
}

// --- Personnel Analytics ---

export interface PersonnelAnalytics {
  hours_trend: Array<{ month: string; total_hours: number; avg_hours_per_officer: number; overtime_hours: number }>;
  attendance_patterns: Array<{ day_of_week: string; avg_clock_in_count: number; avg_hours: number }>;
  credential_compliance: {
    total_credentials: number;
    valid: number;
    expiring_soon: number;
    expired: number;
    compliance_rate: number;
  };
  overtime_tracking: Array<{ officer_name: string; officer_id: string; total_hours: number; overtime_hours: number; regular_hours: number }>;
  department_breakdown: Array<{ department: string; count: number; on_duty: number; avg_tenure_years: number }>;
  role_distribution: Array<{ role: string; count: number; color: string }>;
  training_compliance: {
    total_required: number;
    completed: number;
    overdue: number;
    completion_rate: number;
  };
  headcount_summary: {
    total_personnel: number;
    active: number;
    on_duty: number;
    clocked_in: number;
    avg_tenure_years: number;
    new_hires_30d: number;
    terminations_30d: number;
  };
}

// --- Patrol ---

export interface PatrolCheckpoint {
  id: string;
  property_id: string;
  property_name: string;
  name: string;
  description: string;
  qr_code: string;
  latitude?: number;
  longitude?: number;
  scan_required_interval_minutes: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface PatrolScan {
  id: string;
  checkpoint_id: string;
  checkpoint_name: string;
  officer_id: string;
  officer_name: string;
  scanned_at: string;
  latitude?: number;
  longitude?: number;
  notes?: string;
  status: 'on_time' | 'late' | 'missed';
}

// --- Incident Linking ---

export type PersonRole = 'suspect' | 'victim' | 'witness' | 'reporting_party' | 'involved' | 'other';
export type VehicleRole = 'suspect_vehicle' | 'victim_vehicle' | 'witness_vehicle' | 'involved' | 'evidence' | 'other';

export interface IncidentPerson {
  id: string;
  incident_id: string;
  person_id: string;
  role: PersonRole;
  notes?: string;
  added_by: string;
  added_by_name?: string;
  created_at: string;
  // Joined person fields
  first_name: string;
  last_name: string;
  dob?: string;
  phone?: string;
  flags?: string;
}

export interface IncidentVehicle {
  id: string;
  incident_id: string;
  vehicle_id: string;
  role: VehicleRole;
  notes?: string;
  added_by: string;
  added_by_name?: string;
  created_at: string;
  // Joined vehicle fields
  plate_number?: string;
  state?: string;
  make?: string;
  model?: string;
  year?: number;
  color?: string;
  vin?: string;
  owner_first_name?: string;
  owner_last_name?: string;
}

export interface IncidentDetail extends Omit<Incident, 'persons_involved' | 'vehicles_involved' | 'evidence_ids'> {
  linked_persons: IncidentPerson[];
  linked_vehicles: IncidentVehicle[];
  evidence: Evidence[];
  activity: ActivityLogEntry[];
  property_name?: string;
  badge_number?: string;
  supervisor_name?: string;
  call_type?: string;
}

// --- Warrants ---

export type WarrantType = 'arrest' | 'search' | 'bench' | 'civil' | 'other';
export type WarrantStatus = 'active' | 'served' | 'recalled' | 'expired' | 'quashed';
export type OffenseLevel = 'felony' | 'misdemeanor' | 'infraction' | 'civil';

export interface Warrant {
  id: string;
  warrant_number: string;
  type: WarrantType;
  status: WarrantStatus;
  subject_person_id?: string;
  subject_first_name?: string;
  subject_last_name?: string;
  issuing_court?: string;
  issuing_judge?: string;
  charge_description: string;
  bail_amount?: number;
  offense_level?: OffenseLevel;
  entered_by: string;
  entered_by_name?: string;
  served_by?: string;
  served_by_name?: string;
  served_at?: string;
  served_location?: string;
  expires_at?: string;
  notes?: string;
  created_at: string;
  updated_at: string;
}

// --- Notifications ---

export type NotificationType = 'bolo' | 'warrant' | 'dispatch' | 'system' | 'message' | 'credential_expiry' | 'patrol_missed';
export type NotificationPriority = 'normal' | 'high' | 'critical';

export interface Notification {
  id: string;
  user_id: string;
  type: NotificationType;
  title: string;
  body?: string;
  entity_type?: string;
  entity_id?: string;
  priority: NotificationPriority;
  is_read: boolean;
  created_at: string;
}

// --- Call Templates ---

export interface CallTemplate {
  id: string;
  name: string;
  incident_type: string;
  priority: CallPriority;
  description_template?: string;
  default_notes?: string;
  source: string;
  is_active: boolean;
  sort_order: number;
  created_by?: string;
  created_at: string;
}

// --- Supplemental Reports ---

export type SupplementalReportType = 'supplemental' | 'follow_up' | 'witness_statement' | 'forensic' | 'supervisor_review';
export type SupplementalReportStatus = 'draft' | 'submitted' | 'approved';

export interface SupplementalReport {
  id: string;
  report_number: string;
  incident_id: string;
  author_id: string;
  author_name?: string;
  report_type: SupplementalReportType;
  subject: string;
  narrative: string;
  status: SupplementalReportStatus;
  approved_by?: string;
  approved_by_name?: string;
  approved_at?: string;
  created_at: string;
  updated_at: string;
}

// --- Fleet ---

export type FleetVehicleStatus = 'in_service' | 'out_of_service' | 'maintenance' | 'retired';
export type MaintenanceType = 'oil_change' | 'tire_rotation' | 'brake_service' | 'inspection' | 'repair' | 'other';

export interface FleetVehicle {
  id: string;
  vehicle_number: string;
  make?: string;
  model?: string;
  year?: number;
  color?: string;
  vin?: string;
  plate_number?: string;
  plate_state?: string;
  status: FleetVehicleStatus;
  assigned_unit_id?: string;
  assigned_unit_call_sign?: string;
  current_mileage?: number;
  last_service_date?: string;
  next_service_due?: string;
  insurance_expiry?: string;
  registration_expiry?: string;
  equipment: string[];
  notes?: string;
  created_at: string;
  updated_at: string;
}

export interface FleetMaintenance {
  id: string;
  vehicle_id: string;
  vehicle_number?: string;
  type: MaintenanceType;
  description: string;
  mileage_at_service?: number;
  cost?: number;
  vendor?: string;
  performed_by?: string;
  performed_at: string;
  next_due_date?: string;
  next_due_mileage?: number;
  created_at: string;
}

// --- Fleet Fuel ---

export type FuelType = 'regular' | 'premium' | 'diesel';

export interface FleetFuelLog {
  id: string;
  vehicle_id: string;
  fuel_date: string;
  gallons: number;
  cost_per_gallon?: number;
  total_cost?: number;
  odometer_reading?: number;
  fuel_type: FuelType;
  station?: string;
  notes?: string;
  created_by?: string;
  created_at: string;
}

export interface FleetFuelSummary {
  total_gallons: number;
  total_cost: number;
  avg_mpg: number | null;
  avg_cost_per_gallon: number;
  log_count: number;
}

// --- Fleet Inspections ---

export type InspectionType = 'pre_trip' | 'post_trip' | 'monthly' | 'annual';
export type InspectionResult = 'pass' | 'fail' | 'needs_attention';
export type InspectionItemStatus = 'pass' | 'fail' | 'needs_attention' | 'na';

export interface InspectionItem {
  category: string;
  item: string;
  status: InspectionItemStatus;
  notes?: string;
}

export interface FleetInspection {
  id: string;
  vehicle_id: string;
  inspection_type: InspectionType;
  inspector_name: string;
  inspection_date: string;
  overall_result: InspectionResult;
  mileage?: number;
  items: InspectionItem[];
  notes?: string;
  created_by?: string;
  created_at: string;
}

// --- Fleet Assignments ---

export interface FleetAssignment {
  id: string;
  vehicle_id: string;
  unit_id?: string;
  unit_call_sign?: string;
  officer_name?: string;
  assigned_at: string;
  unassigned_at?: string;
  notes?: string;
  created_at: string;
}

// --- Fleet Personnel ---

export interface FleetPersonnelData {
  officer: User | null;
  unit: Unit | null;
  credentials: Credential[];
  todaySchedule: Array<{
    id: string;
    shift_date: string;
    start_time: string;
    end_time: string;
    property_name?: string;
    status: string;
  }>;
  activeTimeEntry: {
    id: string;
    clock_in: string;
    clock_out?: string;
    total_hours?: number;
    status: string;
  } | null;
  notes: FleetPersonnelNote[];
}

export interface FleetPersonnelNote {
  id: string;
  vehicle_id: string;
  officer_id?: string;
  officer_name?: string;
  note: string;
  created_by: string;
  created_by_name?: string;
  created_at: string;
}

// --- Fleet Analytics ---

export interface FleetAnalytics {
  maintenance_cost_trend: Array<{ month: string; total_cost: number; count: number }>;
  mileage_distribution: Array<{ range: string; count: number }>;
  status_breakdown: Array<{ status: string; count: number; color: string }>;
  fuel_economy_trend: Array<{ month: string; avg_mpg: number | null; total_gallons: number; total_cost: number }>;
  fleet_summary: {
    total_vehicles: number;
    avg_mileage: number;
    total_maintenance_cost: number;
    total_fuel_cost: number;
    vehicles_needing_service: number;
    inspections_failing: number;
  };
}

// --- Record Alerts ---

export type AlertType = 'warrant' | 'bolo' | 'flag';

export interface RecordAlert {
  type: AlertType;
  priority: 'high' | 'critical';
  title: string;
  description: string;
  entity_type?: string;
  entity_id?: string;
}

// --- Call Timeline ---

export interface TimelineEntry {
  id: string;
  timestamp: string;
  action: string;
  description: string;
  user_name?: string;
  badge_number?: string;
  icon?: string;
}

// --- Activity Log ---

export type ActivityAction =
  | 'call_created'
  | 'call_dispatched'
  | 'call_enroute'
  | 'call_onscene'
  | 'call_cleared'
  | 'call_closed'
  | 'unit_status_change'
  | 'incident_created'
  | 'incident_submitted'
  | 'incident_approved'
  | 'incident_returned'
  | 'bolo_issued'
  | 'bolo_cancelled'
  | 'message_sent'
  | 'user_login'
  | 'user_logout'
  | 'clock_in'
  | 'clock_out'
  | 'note_added'
  | 'system';

export interface ActivityLogEntry {
  id: string;
  action: ActivityAction;
  description: string;
  user_id?: string;
  user_name?: string;
  entity_type?: string;
  entity_id?: string;
  metadata?: Record<string, unknown>;
  timestamp: string;
}

// --- Dashboard ---

export interface DashboardStats {
  active_calls: number;
  calls_by_priority: { P1: number; P2: number; P3: number; P4: number };
  units_available: number;
  units_total: number;
  open_incidents: number;
  avg_response_time_minutes: number;
  calls_today: number;
  incidents_today: number;
  active_bolos: number;
  officers_on_duty: number;
  calls_by_hour: { hour: number; count: number }[];
}

// --- API Response ---

export interface ApiResponse<T> {
  data: T;
  message?: string;
  total?: number;
  page?: number;
  per_page?: number;
}

export interface ApiError {
  message: string;
  status: number;
  errors?: Record<string, string[]>;
}

// --- WebSocket ---

export type WSMessageType =
  | 'connected'
  | 'authenticated'
  | 'auth_error'
  | 'pong'
  | 'call_update'
  | 'unit_update'
  | 'bolo_alert'
  | 'message'
  | 'activity'
  | 'dispatch_alert'
  | 'system_alert'
  | 'notification'
  | 'panic_alert'
  | 'panic_audio'
  | 'panic_audio_response'
  | 'dispatch_update'
  // Live sync — auto-broadcast on data mutations
  | 'data_changed'
  | 'record_update'
  | 'personnel_update'
  | 'fleet_update'
  | 'incident_update'
  | 'citation_update'
  | 'patrol_update'
  | 'admin_update'
  // Radio — PTT two-way radio
  | 'radio_audio'
  | 'radio_transmit_start'
  | 'radio_transmit_end'
  | 'radio_channel_join'
  | 'radio_channel_leave'
  | 'radio_channel_state'
  // Private calls — full-duplex 1:1 voice
  | 'private_call_request'
  | 'private_call_ringing'
  | 'private_call_incoming'
  | 'private_call_accept'
  | 'private_call_decline'
  | 'private_call_declined'
  | 'private_call_connected'
  | 'private_call_end'
  | 'private_call_ended'
  | 'private_call_audio'
  | 'private_call_error'
  // Presence
  | 'presence_update'
  // Email
  | 'email:new_messages';

export interface WSMessage {
  type: WSMessageType;
  payload?: unknown;
  data?: unknown;
  timestamp?: string;
  targetUserId?: number;
  channel?: string;
  [key: string]: unknown;
}

// Live sync event payload from the liveBroadcast middleware
export interface LiveSyncEvent {
  action: 'post' | 'put' | 'patch' | 'delete';
  module: string;
  entity: string;
  path: string;
  id: string | number | null;
  user: { id: number; username: string } | null;
  timestamp: string;
}

// Presence data
export interface PresenceUser {
  userId: number;
  username: string;
  role: string;
}

export interface PresenceUpdate {
  users: PresenceUser[];
  count: number;
}

// --- Invoices ---

export type InvoiceStatus = 'draft' | 'sent' | 'paid' | 'partial' | 'overdue' | 'void' | 'cancelled';
export type LineItemType = 'contract_base' | 'service_hours' | 'incident_response' | 'dispatch_call' | 'citation' | 'custom' | 'late_fee' | 'discount';
export type PaymentMethod = 'check' | 'ach' | 'wire' | 'credit_card' | 'cash' | 'other';

export interface Invoice {
  id: string;
  invoice_number: string;
  client_id: string;
  client_name?: string;
  status: InvoiceStatus;
  period_start: string;
  period_end: string;
  issue_date?: string;
  due_date?: string;
  paid_date?: string;
  subtotal: number;
  discount_amount: number;
  tax_amount: number;
  late_fee_amount: number;
  total: number;
  amount_paid: number;
  balance_due: number;
  payment_terms?: string;
  billing_email?: string;
  billing_address?: string;
  notes?: string;
  internal_notes?: string;
  created_by: string;
  created_by_name?: string;
  sent_at?: string;
  voided_at?: string;
  voided_by?: string;
  created_at: string;
  updated_at: string;
  line_item_count?: number;
  payment_count?: number;
}

export interface InvoiceLineItem {
  id: string;
  invoice_id: string;
  line_type: LineItemType;
  description: string;
  quantity: number;
  unit_price: number;
  amount: number;
  linked_entity_type?: string;
  linked_entity_id?: string;
  sort_order: number;
  created_at: string;
}

export interface Payment {
  id: string;
  invoice_id: string;
  amount: number;
  payment_date: string;
  payment_method?: PaymentMethod;
  reference_number?: string;
  notes?: string;
  recorded_by: string;
  recorded_by_name?: string;
  created_at: string;
}

export interface InvoiceDetail extends Invoice {
  line_items: InvoiceLineItem[];
  payments: Payment[];
}

export interface InvoiceStats {
  total_invoices: number;
  total_outstanding: number;
  total_collected: number;
  overdue_count: number;
  draft_count: number;
  by_status: Record<string, number>;
}

// --- System Health ---

export interface SystemHealthMetrics {
  server: {
    uptime: number;
    memory: {
      rss: number;
      heapUsed: number;
      heapTotal: number;
      external: number;
    };
    nodeVersion: string;
  };
  database: {
    sizeBytes: number;
    tables: Record<string, number>;
  };
  operations: {
    activeSessions: number;
    activeUnits: number;
    pendingCalls: number;
    connectedClients: number;
  };
  loginStats: {
    successful24h: number;
    failed24h: number;
  };
  recentErrors: Array<{
    id: string;
    action: string;
    details: string;
    created_at: string;
  }>;
}

// --- System Announcements ---

export type AnnouncementType = 'info' | 'warning' | 'maintenance' | 'update' | 'policy';
export type AnnouncementPriority = 'normal' | 'high' | 'critical';

export interface SystemAnnouncement {
  id: string;
  title: string;
  body: string;
  type: AnnouncementType;
  priority: AnnouncementPriority;
  target_roles: string[];
  is_active: boolean;
  starts_at?: string;
  expires_at?: string;
  created_by: number;
  created_by_name?: string;
  created_at: string;
  updated_at: string;
}

// --- Data Retention ---

export interface RetentionPolicy {
  id: string;
  entity_type: string;
  retention_days: number;
  auto_archive: boolean;
  auto_delete: boolean;
  last_run_at?: string;
  records_affected: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface RetentionPreview {
  entity_type: string;
  retention_days: number;
  records_to_archive: number;
  records_to_delete: number;
}

// --- Departments ---

export interface Department {
  id: string;
  name: string;
  code?: string;
  description?: string;
  parent_id?: number;
  parent_name?: string;
  manager_id?: number;
  manager_name?: string;
  is_active: boolean;
  user_count?: number;
  created_at: string;
  updated_at: string;
}

// --- Notification Rules ---

export type NotificationTrigger =
  | 'call_created_p1'
  | 'call_created_p2'
  | 'warrant_created'
  | 'warrant_served'
  | 'credential_expiring'
  | 'unit_panic'
  | 'shift_unattended'
  | 'invoice_overdue'
  | 'incident_submitted'
  | 'bolo_created'
  | 'login_failed_threshold'
  | 'training_expiring'
  | 'vehicle_maintenance_due';

export interface NotificationRule {
  id: string;
  name: string;
  description?: string;
  trigger_event: NotificationTrigger;
  conditions: Record<string, any>;
  target_roles: string[];
  target_user_ids: number[];
  notification_type: 'in_app' | 'email' | 'both';
  is_active: boolean;
  created_by: number;
  created_by_name?: string;
  created_at: string;
  updated_at: string;
}

// ── Field Interview (FI) Cards ──────────────────────────

export type FIContactReason = 'suspicious_activity' | 'traffic_stop' | 'trespass' | 'welfare_check' | 'investigation' | 'other';
export type FIContactType = 'field' | 'traffic' | 'foot' | 'phone';
export type FIActionTaken = 'warned' | 'cited' | 'arrested' | 'released' | 'referred' | 'none';

export interface FieldInterview {
  id: number;
  fi_number: string;
  person_id?: number;
  subject_first_name?: string;
  subject_last_name?: string;
  subject_dob?: string;
  subject_gender?: string;
  subject_race?: string;
  subject_height?: string;
  subject_weight?: string;
  subject_hair?: string;
  subject_eye?: string;
  subject_clothing?: string;
  subject_description?: string;
  location: string;
  latitude?: number;
  longitude?: number;
  property_id?: number;
  contact_reason: FIContactReason;
  contact_type: FIContactType;
  action_taken: FIActionTaken;
  narrative?: string;
  vehicle_plate?: string;
  vehicle_description?: string;
  vehicle_id?: number;
  associated_call_id?: string;
  associated_incident_id?: string;
  officer_id: number;
  officer_name?: string;
  officer_display_name?: string;
  linked_person_first?: string;
  linked_person_last?: string;
  status: 'active' | 'archived';
  created_at: string;
  archived_at?: string;
}

// ── Trespass / Exclusion Orders ─────────────────────────

export type TrespassOrderType = 'trespass_warning' | 'exclusion_order' | 'ban' | 'no_contact';
export type TrespassOrderStatus = 'active' | 'served' | 'expired' | 'lifted' | 'violated';

export interface TrespassOrder {
  id: number;
  order_number: string;
  person_id?: number;
  subject_first_name: string;
  subject_last_name: string;
  subject_dob?: string;
  subject_description?: string;
  property_id?: number;
  property_name?: string;
  location: string;
  order_type: TrespassOrderType;
  status: TrespassOrderStatus;
  reason?: string;
  conditions?: string;
  duration_days?: number;
  effective_date?: string;
  expiration_date?: string;
  served_at?: string;
  served_by?: number;
  served_by_name?: string;
  originating_call_id?: string;
  originating_incident_id?: string;
  issued_by: number;
  issued_by_name?: string;
  issued_by_display?: string;
  authorized_by?: string;
  linked_person_first?: string;
  linked_person_last?: string;
  linked_property_name?: string;
  notes?: string;
  archived_at?: string;
  created_at: string;
  updated_at: string;
}

// --- Evidence Property Room ---

export type EvidenceAction = 'check_in' | 'check_out' | 'transfer' | 'lab_submit' | 'release' | 'dispose';

export interface EvidenceChainEntry {
  action: EvidenceAction;
  timestamp: string;
  user_id: number;
  user_name: string;
  from_location?: string;
  to_location?: string;
  notes?: string;
}

// --- Case Management ---

export type CaseStatus = 'open' | 'assigned' | 'active' | 'suspended' | 'closed_cleared' | 'closed_unfounded' | 'closed_exception';
export type CaseType = 'general' | 'theft' | 'assault' | 'fraud' | 'narcotics' | 'missing_person' | 'other';
export type CasePriority = 'low' | 'normal' | 'high' | 'critical';
export type CaseNoteType = 'general' | 'lead' | 'interview' | 'evidence' | 'followup';

export interface SolvabilityFactors {
  witness_available?: boolean;
  physical_evidence?: boolean;
  suspect_named?: boolean;
  suspect_described?: boolean;
  suspect_vehicle?: boolean;
  video_available?: boolean;
  traceable_property?: boolean;
  significant_modus?: boolean;
}

export interface Case {
  id: number;
  case_number: string;
  title: string;
  case_type: CaseType;
  status: CaseStatus;
  priority: CasePriority;
  lead_investigator_id?: number;
  lead_investigator_name?: string;
  assigned_officers: string; // JSON array
  assigned_at?: string;
  solvability_score: number;
  solvability_factors: string; // JSON
  linked_incidents: string;
  linked_citations: string;
  linked_evidence: string;
  linked_persons: string;
  linked_field_interviews: string;
  summary?: string;
  narrative?: string;
  disposition?: string;
  disposition_date?: string;
  opened_date: string;
  due_date?: string;
  closed_date?: string;
  created_by: number;
  created_at: string;
  updated_at: string;
  archived_at?: string;
}

export interface CaseNote {
  id: number;
  case_id: number;
  author_id: number;
  author_name?: string;
  note_type: CaseNoteType;
  content: string;
  is_pinned: boolean;
  created_at: string;
}

// --- Code Enforcement ---

export type ViolationType = 'noise' | 'property_maintenance' | 'zoning' | 'signage' | 'health' | 'fire' | 'nuisance' | 'other';
export type ViolationStatus = 'open' | 'notice_sent' | 'reinspection' | 'resolved' | 'referred' | 'voided';
export type ViolationSeverity = 'minor' | 'moderate' | 'major' | 'critical';

export interface CodeViolation {
  id: number;
  violation_number: string;
  violation_type: ViolationType;
  status: ViolationStatus;
  location: string;
  property_id?: number;
  latitude?: number;
  longitude?: number;
  person_id?: number;
  violator_name?: string;
  violator_contact?: string;
  description: string;
  code_section?: string;
  severity: ViolationSeverity;
  compliance_deadline?: string;
  resolved_date?: string;
  resolution_notes?: string;
  fine_amount: number;
  reporting_officer_id: number;
  reporting_officer_name?: string;
  created_at: string;
  updated_at: string;
}

export type TowStatus = 'ordered' | 'dispatched' | 'in_progress' | 'completed' | 'released' | 'cancelled';
export type TowReason = 'parking_violation' | 'abandoned' | 'evidence' | 'accident' | 'stolen_recovery' | 'private_property' | 'other';

export interface VehicleTow {
  id: number;
  tow_number: string;
  status: TowStatus;
  vehicle_plate?: string;
  vehicle_state?: string;
  vehicle_vin?: string;
  vehicle_year?: string;
  vehicle_make?: string;
  vehicle_model?: string;
  vehicle_color?: string;
  vehicle_id?: number;
  tow_from: string;
  tow_to?: string;
  latitude?: number;
  longitude?: number;
  tow_reason: TowReason;
  authorization?: string;
  tow_company?: string;
  tow_driver?: string;
  tow_company_phone?: string;
  call_id?: string;
  citation_id?: number;
  incident_id?: number;
  ordered_at: string;
  dispatched_at?: string;
  completed_at?: string;
  released_at?: string;
  released_to?: string;
  tow_fee: number;
  storage_fee_daily: number;
  officer_id: number;
  officer_name?: string;
  notes?: string;
  created_at: string;
  updated_at: string;
}

// --- Court & Legal Tracker ---

export type CourtEventType = 'arraignment' | 'hearing' | 'trial' | 'sentencing' | 'motion' | 'subpoena' | 'continuance' | 'disposition';
export type CourtEventStatus = 'scheduled' | 'continued' | 'completed' | 'cancelled' | 'missed';
export type CourtOutcome = 'guilty' | 'not_guilty' | 'dismissed' | 'plea_deal' | 'deferred' | 'continued' | 'warrant_issued';

export interface CourtEvent {
  id: number;
  event_number: string;
  event_type: CourtEventType;
  status: CourtEventStatus;
  event_date: string;
  event_time?: string;
  court_name?: string;
  courtroom?: string;
  judge_name?: string;
  court_case_number?: string;
  citation_id?: number;
  incident_id?: number;
  case_id?: number;
  defendant_person_id?: number;
  defendant_name?: string;
  prosecutor?: string;
  defense_attorney?: string;
  officers_required: string; // JSON array
  outcome?: CourtOutcome;
  sentence?: string;
  fine_amount?: number;
  notes?: string;
  created_by: number;
  created_at: string;
  updated_at: string;
}

// --- Daily Activity Reports ---

export type DARStatus = 'draft' | 'submitted' | 'approved' | 'returned' | 'archived';

export interface DailyActivityReport {
  id: number;
  dar_number: string;
  status: DARStatus;
  officer_id: number;
  officer_name?: string;
  shift_date: string;
  shift_start?: string;
  shift_end?: string;
  property_id?: number;
  property_name?: string;
  post_assignment?: string;
  calls_handled: string; // JSON
  incidents_created: string; // JSON
  citations_issued: string; // JSON
  patrols_completed: string; // JSON
  activities_narrative?: string;
  notable_events?: string;
  equipment_issues?: string;
  safety_concerns?: string;
  recommendations?: string;
  reviewed_by?: number;
  reviewed_by_name?: string;
  reviewed_at?: string;
  review_notes?: string;
  created_at: string;
  updated_at: string;
  submitted_at?: string;
}

// --- Known Offender Registry ---

export type OffenderAlertType = 'ban_zone' | 'watch_list' | 'sex_offender' | 'gang_member' | 'probation' | 'parole' | 'mental_health' | 'violent_history' | 'warrant_flag';
export type AlertSeverity = 'info' | 'caution' | 'warning' | 'danger';
export type OffenderAlertStatus = 'active' | 'expired' | 'cleared';

export interface OffenderAlert {
  id: number;
  person_id: number;
  person_name?: string; // joined from persons
  dob?: string; // joined from persons
  is_sex_offender?: boolean; // joined from persons
  gang_affiliation?: string; // joined from persons
  alert_type: OffenderAlertType;
  status: OffenderAlertStatus;
  description: string;
  severity: AlertSeverity;
  restricted_properties: string; // JSON
  restricted_zones: string; // JSON
  restriction_radius_ft?: number;
  effective_date: string;
  expiration_date?: string;
  source_incident_id?: number;
  source_citation_id?: number;
  source_case_id?: number;
  created_by: number;
  notes?: string;
  created_at: string;
  updated_at: string;
}

// --- Registry Lookup (SOR) ---

export type SORTier = 1 | 2 | 3;
export type SORStatus = 'compliant' | 'non_compliant' | 'absconded' | 'incarcerated' | 'removed';
export type SORRiskLevel = 'low' | 'moderate' | 'high' | 'svp';

export interface SORAddress {
  type: 'home' | 'work' | 'school' | 'temporary';
  street: string;
  city: string;
  state: string;
  zip: string;
  lat?: number;
  lng?: number;
  verified_date?: string;
}

export interface SOROffense {
  statute: string;
  description: string;
  date: string;
  victim_age?: string;
  court?: string;
  case_number?: string;
}

export interface SORVehicle {
  year?: string;
  make: string;
  model: string;
  color?: string;
  plate?: string;
  state?: string;
}

export interface SexOffenderRecord {
  id: number;
  person_id?: number;
  registry_id?: string;
  first_name: string;
  last_name: string;
  middle_name?: string;
  aliases?: string;
  dob?: string;
  gender?: string;
  race?: string;
  height?: string;
  weight?: string;
  hair_color?: string;
  eye_color?: string;
  scars_marks_tattoos?: string;
  photo_url?: string;
  tier: SORTier;
  risk_level?: SORRiskLevel;
  registration_status: SORStatus;
  registration_date?: string;
  expiration_date?: string;
  last_verification?: string;
  next_verification_due?: string;
  registration_jurisdiction?: string;
  offenses: string;
  conviction_state?: string;
  addresses: string;
  vehicles: string;
  employer?: string;
  employer_address?: string;
  school?: string;
  school_address?: string;
  restrictions?: string;
  conditions: string;
  supervising_officer?: string;
  source: string;
  notes?: string;
  created_by?: number;
  created_at: string;
  updated_at: string;
}

// --- Company Documents (Policies, SOPs, Training Manuals) ---

export type CompanyDocCategory = 'general' | 'policy' | 'procedure' | 'sop' | 'training_manual' | 'form' | 'reference';

export interface CompanyDocument {
  id: number;
  title: string;
  description?: string;
  category: CompanyDocCategory;
  file_id?: string;
  content_type: 'file' | 'link';
  external_url?: string;
  is_required_reading: number;
  published: number;
  sort_order: number;
  created_by: number;
  updated_by?: number;
  creator_name?: string;
  created_at: string;
  updated_at: string;
  file_name?: string;
  file_size?: number;
  mime_type?: string;
}

// --- Dash Camera (ClearPathGPS) ---

export interface DashcamEvent {
  id: number | string;
  device_id?: string;
  device_name?: string;
  officer_id?: string;
  officer_name?: string;
  call_sign?: string;
  event_type: string;
  event_timestamp: string;
  speed_mph?: number;
  latitude?: number;
  longitude?: number;
  address?: string;
  video_available: boolean;
  video_url?: string;
  created_at?: string;
}

// ─── CRM Types ─────────────────────────────────────────
export interface CrmTask {
  id: number | string;
  client_id?: number | string;
  client_name?: string;
  property_id?: number | string;
  property_name?: string;
  title: string;
  description?: string;
  task_type: 'follow_up' | 'site_visit' | 'contract_renewal' | 'billing' | 'other';
  priority: 'low' | 'normal' | 'high' | 'urgent';
  status: 'pending' | 'in_progress' | 'completed' | 'cancelled';
  due_date?: string;
  assigned_to?: string;
  assigned_to_name?: string;
  completed_at?: string;
  completed_by?: string;
  notes?: string;
  created_by?: string;
  created_by_name?: string;
  created_at: string;
  updated_at: string;
}

export interface CrmActivity {
  id: number | string;
  client_id: number | string;
  client_name?: string;
  activity_type: 'note' | 'call' | 'email' | 'meeting' | 'invoice' | 'contract_change' | 'site_visit';
  subject?: string;
  details?: string;
  created_by?: string;
  created_by_name?: string;
  created_at: string;
}

export interface CrmDashboardStats {
  active_clients: number;
  total_clients: number;
  outstanding_revenue: number;
  overdue_invoices: number;
  pending_tasks: number;
  expiring_contracts: number;
  total_invoiced_mtd: number;
  total_paid_mtd: number;
}

// ─── CRM Leads & Pipeline ────────────────────────────

export type LeadSource = 'utah_biz' | 'construction_permit' | 'commercial_re' | 'liquor_license' | 'manual';
export type PipelineStage = 'new' | 'contacted' | 'qualified' | 'proposal' | 'negotiation' | 'won' | 'lost' | 'dismissed';
export type ProposalStage = 'draft' | 'sent' | 'viewed' | 'accepted' | 'rejected' | 'expired';

export interface CrmLead {
  id: number | string;
  source: LeadSource;
  source_id?: string;
  source_url?: string;
  business_name: string;
  industry?: string;
  sic_code?: string;
  business_type?: string;
  contact_name?: string;
  contact_email?: string;
  contact_phone?: string;
  contact_title?: string;
  address?: string;
  city?: string;
  state?: string;
  zip?: string;
  latitude?: number;
  longitude?: number;
  estimated_value?: number;
  permit_number?: string;
  registration_date?: string;
  license_number?: string;
  project_type?: string;
  property_size?: string;
  pipeline_stage: PipelineStage;
  lead_score: number;
  assigned_to?: number;
  assigned_to_name?: string;
  client_id?: number;
  proposal_id?: number;
  notes?: string;
  lost_reason?: string;
  next_follow_up?: string;
  created_at: string;
  updated_at: string;
}

export interface CrmLeadActivity {
  id: number | string;
  lead_id: number | string;
  activity_type: string;
  subject?: string;
  details?: string;
  old_value?: string;
  new_value?: string;
  created_by?: number;
  created_by_name?: string;
  created_at: string;
}

export interface CrmProposal {
  id: number | string;
  proposal_number: string;
  lead_id?: number;
  client_id?: number;
  client_name?: string;
  lead_name?: string;
  title: string;
  template_type?: string;
  description?: string;
  scope_of_work?: string;
  terms?: string;
  monthly_value: number;
  total_value: number;
  billing_frequency: string;
  valid_until?: string;
  proposed_start?: string;
  proposed_end?: string;
  contract_length_months?: number;
  stage: ProposalStage;
  sent_at?: string;
  viewed_at?: string;
  accepted_at?: string;
  rejected_at?: string;
  rejection_reason?: string;
  created_by?: number;
  assigned_to?: number;
  notes?: string;
  pdf_path?: string;
  created_at: string;
  updated_at: string;
}

export interface CrmProposalTemplate {
  id: number | string;
  name: string;
  template_type: string;
  description?: string;
  default_scope?: string;
  default_terms?: string;
  default_monthly_value?: number;
  default_billing_frequency?: string;
  default_contract_months?: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface LeadScrapeSource {
  id: number;
  source_key: string;
  display_name: string;
  base_url?: string;
  is_enabled: boolean;
  poll_interval_seconds: number;
  last_poll_at?: string;
  last_success_at?: string;
  consecutive_failures: number;
  total_leads_imported: number;
}

export interface PipelineSummary {
  stage: PipelineStage;
  count: number;
  total_value: number;
}

export interface CpgDeviceMapping {
  id: number | string;
  cpg_device_id?: string;
  cpg_display_name?: string;
  cpg_serial_number?: string;
  officer_id?: string;
  officer_name?: string;
  call_sign?: string;
  vehicle_id?: string;
  is_active: boolean;
  last_synced_at?: string;
  created_at?: string;
  updated_at?: string;
}
