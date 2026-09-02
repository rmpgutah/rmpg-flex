import React, { useState, useEffect, useCallback, useRef, useId, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import {
  Plus, Send, Navigation, MapPin, Clock, Phone, User, MessageSquare, Radio, Eye,
  CheckCircle, XCircle, AlertTriangle, Loader2, FileText, FileSignature, ChevronDown, ChevronLeft, ChevronRight, Link,
  Archive, RotateCcw, Edit3, Trash2, Save, X, PlusCircle, Shield, Thermometer,
  Undo2, Pencil, Search, Building2, Terminal, Briefcase, Copy, Printer, Layers, Hash, Wrench, Route, Activity, ScanSearch,
} from 'lucide-react';
import { openClearedSummaryPdf, todayMtWindow, filterClearedInWindow } from '../../utils/clearedSummaryPdf';
import type { CallForService, Unit, CallStatus } from '../../types';
import { callPosture } from '../../utils/callThreat';
import { applyFillBlanks, autofillFromClient, type ClientRecord } from '../../utils/clientAutofill';
import { BADGE_TONES } from '../../components/records/recordVisuals';
import CallCard from '../../components/CallCard';
import { SpillmanCadBoard } from './spillman';
import ZsbBadge from '../../components/ZsbBadge';
import DuplicateCandidatesModal, { DuplicateCandidate } from '../../components/DuplicateCandidatesModal';
import UnitStatusBoard from '../../components/UnitStatusBoard';
import DispositionPrompt from '../../components/DispositionPrompt';
import { dispositionGroupsForIncident, DEFAULT_DISPOSITION_CODES, PROCESS_SERVICE_INCIDENT_TYPES } from '../../constants/dispositionCodes';
import { zoneLeaf, beatLeaf, sectionPrefix } from '../../utils/dispatchCodeParts';
import DispatchMiniMap from '../../components/DispatchMiniMap';
import MapboxMiniMap from '../../components/MapboxMiniMap';
import { getResolvedEngine, detectMapEngine, type MapEngine } from '../../utils/mapProvider';
import BoloAlertBanner from '../../components/BoloAlertBanner';
import StatusBadge from '../../components/StatusBadge';
import NewCallModal from '../../components/NewCallModal';
import AddressAutocomplete, { type ParsedAddress } from '../../components/AddressAutocomplete';
import PanelTitleBar from '../../components/PanelTitleBar';
import LiveClock from '../../components/LiveClock';
import ExportButton from '../../components/ExportButton';
import TabBar from '../../components/TabBar';
import { apiFetch } from '../../hooks/useApi';
import { useLiveSync } from '../../hooks/useLiveSync';
import { usePersistedTab } from '../../hooks/usePersistedState';
import { useUnsavedChanges } from '../../hooks/useUnsavedChanges';
import { formatIncidentType, INCIDENT_TYPE_CATEGORIES, type IncidentType } from '../../utils/caseNumbers';
import { formatEnumValue, formatPhoneInput, toDisplayLabel } from '../../utils/formatters';
import { ORGANIZATION } from '../../constants/organizationConstants';
import ConfirmDialog from '../../components/ConfirmDialog';
import RmpgLogo from '../../components/RmpgLogo';
import PrintButton from '../../components/PrintButton';
import PrintRecordButton from '../../components/PrintRecordButton';
import ToolbarOverflow from '../../components/ToolbarOverflow';
import { useToast } from '../../components/ToastProvider';
import { useWebSocket } from '../../context/WebSocketContext';
import WarningTags from '../../components/WarningTags';
import WarrantBadge from '../../components/WarrantBadge';
import type { WarningTag } from '../../components/WarningTags';
import FloatingSaveBar from '../../components/FloatingSaveBar';
import { Combobox } from '../../components/Combobox';
import DispatchAnalyticsStrip from '../../components/dispatch/DispatchAnalyticsStrip';
import IncidentTypeChart from '../../components/dispatch/IncidentTypeChart';
import CadCommandLine from '../../components/CadCommandLine';
import NcicQueryPanel from '../../components/NcicQueryPanel';
import UnitRecommendationPanel from '../../components/UnitRecommendationPanel';
import RecommendedUnitsInline from '../../components/RecommendedUnitsInline';
import type { CommandAction } from '../../utils/cadCommandParser';
import { getTimerState, isActiveStatus } from '../../utils/dispatchTimers';
import { playTone } from '../../utils/dispatchTones';
import { announceTarget } from '../../utils/voiceChannel';
import { useIsMobile } from '../../hooks/useIsMobile';
import MobileCardList from '../../components/mobile/MobileCardList';
import MobileDetailView from '../../components/mobile/MobileDetailView';
import { mapDbCall, mergeCallUpdate, mapDbUnit } from './utils/dispatchMappers';
import { applyCallPdfAutofill } from './utils/callPdfAutofill';
import { openNoticeOfCommunication } from './utils/psoNoticeAutofill';
import {
  formatTime, formatElapsed, formatActivityDetails, callMatchesSearch, deriveCallWarnings,
  formatServiceType, formatDocumentType, formatCallDuration, computeCallDuration,
  computeResponseTime, computeOnSceneTime, formatResponseTimeShort, formatOrdinal,
  computeResolvedDeadline, computeActiveDeadline, parsePsoServiceWindows, type FilterTab,
} from './utils/dispatchFormatters';
import {
  SERVICE_TYPE_LABELS, DOCUMENT_TYPE_OPTIONS, SERVICE_TYPE_GROUPS,
  TERMINAL_STATUSES, COMPLETED_STATUSES, INACTIVE_STATUSES, ACTIVE_FIELD_STATUSES,
  POST_DISPATCH_STATUSES, RESOLVED_STATUSES, FINISHED_STATUSES, ACTIONABLE_STATUSES,
  OPEN_STATUSES, REMOVED_STATUSES,
} from './utils/dispatchConstants';
import { useDispatchUnitActions } from './hooks/useDispatchUnitActions';
import { useDispatchCallActions } from './hooks/useDispatchCallActions';
import { useDispatchNotesActions } from './hooks/useDispatchNotesActions';
import { useDispatchMultiUnitActions } from './hooks/useDispatchMultiUnitActions';
import {
  announceCallAlerts, announcePanicAlert, announceNewCall, announceDispatchEvent,
  announceEscalation, announceCallUpdate, speakDispatcherResponse, announceUnitAssignment,
  announceCallArchived, announceTime, announceAllClear, announceAcknowledgment,
  announceStatusChange, announceReturnVisit, announceServeComplete,
  announceCallStack, announceShiftSummary, announceCourtDeadline,
  announceDirectedNote, announceLocalAction, announceSpeedAdvisory,
} from '../../utils/voiceAlerts';
import { useAuth } from '../../context/AuthContext';
import { useOptimizationV2 } from '../../hooks/useOptimizationV2';
import type { V2Route } from '../../utils/mapboxOptimizationV2';
import { renderFormattedText } from '../../utils/renderFormatted';
import NoteComposer from './components/NoteComposer';
import CallDocumentsPanel from './components/CallDocumentsPanel';
import AssignmentProposalModal from './components/AssignmentProposalModal';
import { useDispatchOptimization } from './hooks/useDispatchOptimization';
import OptimizationV2StatusBadge from '../../components/OptimizationV2StatusBadge';
import { useDistrictOptions } from '../../hooks/useDistrictLookup';
import { useAddressAutofill } from '../../hooks/useAddressAutofill';
import { useLinkOptions } from '../../hooks/useLinkOptions';
import { useUserPreferences } from '../../context/UserPreferencesContext';
import QuickPsoModal from '../../components/QuickPsoModal';
import {
  WEATHER_OPTIONS, LIGHTING_OPTIONS, WEAPONS_OPTIONS, LE_AGENCY_OPTIONS,
  SCENE_SAFETY_OPTIONS, DIRECTION_OPTIONS,
} from '../../utils/callOptions';
import PersonFormModal, { type PersonFormData } from '../../components/PersonFormModal';
import VehicleFormModal, { type VehicleFormData } from '../../components/VehicleFormModal';
import AIDispatchSidebar from '../../components/dispatch/AIDispatchSidebar';
import DispatchCodeQuickPanel from '../../components/dispatch/DispatchCodeQuickPanel';
import CallFilterBar, { type QuickFilter } from '../../components/dispatch/CallFilterBar';
import ShiftStatsBar from '../../components/dispatch/ShiftStatsBar';
import ActivityFeed from '../../components/dispatch/ActivityFeed';
import { useDispatchCodes } from '../../hooks/useDispatchCodes';
import NarrativeAssist from '../../components/dispatch/NarrativeAssist';
import PsoWorkloadPanel from '../../components/dispatch/PsoWorkloadPanel';
import PlateScanModal from '../../components/PlateScanModal';
import FileAttachments from '../../components/FileAttachments';
import { safeDateTimeStr, parseTimestamp, toDatetimeLocalValue, mtDatetimeLocalToUtc } from '../../utils/dateUtils';
import { withAlpha } from '../../utils/withAlpha';
import {
  humanizePriority, formatDispositionCode, getStatusTooltip, formatPhoneDisplay,
  formatAddressDisplay, timeAgo, humanizeStatus,
} from '../../utils/statusLabels';

const INCIDENT_TYPE_OPTIONS = Object.values(INCIDENT_TYPE_CATEGORIES).flat();


const PRIORITY_ORDER: Record<string, number> = { P1: 0, P2: 1, P3: 2, P4: 3 };
const SEARCH_DEBOUNCE_MS = 300;
const MAX_SEARCH_RESULTS = 10;
const FETCH_TIMEOUT_MS = 15000;
const DEDUP_CLEANUP_MS = 5000;
const ALARM_CHECK_INTERVAL_MS = 5000;

const MOBILE_ACTION_BTN_STYLE: React.CSSProperties = { minHeight: 48, minWidth: 80, touchAction: 'manipulation' };
const RECENT_IDS_CAP = 500;

const WORKFLOW_PIPELINE = [
  { status: 'pending',    label: 'Pending',    short: 'PEND' },
  { status: 'dispatched', label: 'Dispatched', short: 'DISP' },
  { status: 'enroute',    label: 'En Route',   short: 'ER'   },
  { status: 'onscene',    label: 'On Scene',   short: 'OS'   },
  { status: 'cleared',    label: 'Cleared',    short: 'CLR'  },
  { status: 'closed',     label: 'Closed',     short: 'CLSD' },
] as const;

const PIPELINE_TERMINAL_STATUSES = new Set(['cancelled', 'archived', 'duplicate', 'on_hold']);

const WORKFLOW_NEXT_STATUS: Record<string, string> = {
  pending: 'dispatched', dispatched: 'enroute', enroute: 'onscene',
  onscene: 'cleared', cleared: 'closed',
};

const TIMESTAMP_PREV_CHAIN: Record<string, string[]> = {
  dispatched_at: ['created_at'],
  enroute_at: ['dispatched_at', 'created_at'],
  onscene_at: ['enroute_at', 'dispatched_at', 'created_at'],
  cleared_at: ['onscene_at', 'enroute_at', 'dispatched_at', 'created_at'],
  closed_at: ['cleared_at', 'onscene_at', 'enroute_at', 'dispatched_at', 'created_at'],
};

const QUICK_FLAGS = [
  { field: 'alcohol_involved', label: 'Alcohol', onBg: 'color-mix(in srgb, var(--sev-warn) 19%, transparent)', onBorder: 'color-mix(in srgb, var(--sev-warn) 31%, transparent)', onText: 'var(--sev-warn-soft)' },
  { field: 'drugs_involved', label: 'Drugs', onBg: 'color-mix(in srgb, var(--sev-critical) 19%, transparent)', onBorder: 'color-mix(in srgb, var(--sev-critical) 31%, transparent)', onText: 'var(--sev-critical)' },
  { field: 'domestic_violence', label: 'DV', onBg: 'color-mix(in srgb, var(--sev-critical) 19%, transparent)', onBorder: 'color-mix(in srgb, var(--sev-critical) 31%, transparent)', onText: 'var(--sev-critical)' },
  { field: 'injuries_reported', label: 'Injuries', onBg: 'color-mix(in srgb, var(--sev-critical) 19%, transparent)', onBorder: 'color-mix(in srgb, var(--sev-critical) 31%, transparent)', onText: 'var(--sev-critical)' },
  { field: 'supervisor_notified', label: 'Supervisor', onBg: 'color-mix(in srgb, var(--spm-text-muted) 19%, transparent)', onBorder: 'color-mix(in srgb, var(--spm-text-muted) 31%, transparent)', onText: 'var(--spm-text)' },
  { field: 'le_notified', label: 'LE Notified', onBg: 'color-mix(in srgb, var(--spm-text-muted) 19%, transparent)', onBorder: 'color-mix(in srgb, var(--spm-text-muted) 31%, transparent)', onText: 'var(--spm-text)' },
  { field: 'mental_health_crisis', label: 'Mental Health', onBg: 'color-mix(in srgb, var(--sev-special) 19%, transparent)', onBorder: 'color-mix(in srgb, var(--sev-special) 31%, transparent)', onText: 'var(--sev-special-soft)' },
  { field: 'juvenile_involved', label: 'Juvenile', onBg: 'color-mix(in srgb, var(--sev-high) 19%, transparent)', onBorder: 'color-mix(in srgb, var(--sev-high) 31%, transparent)', onText: 'var(--sev-high)' },
  { field: 'felony_in_progress', label: 'Felony', onBg: 'color-mix(in srgb, var(--sev-critical) 19%, transparent)', onBorder: 'color-mix(in srgb, var(--sev-critical) 31%, transparent)', onText: 'var(--sev-critical)' },
  { field: 'officer_safety_caution', label: 'Officer Safety', onBg: 'color-mix(in srgb, var(--sev-critical) 19%, transparent)', onBorder: 'color-mix(in srgb, var(--sev-critical) 31%, transparent)', onText: 'var(--sev-critical)' },
  { field: 'gang_related', label: 'Gang', onBg: 'color-mix(in srgb, var(--sev-critical) 19%, transparent)', onBorder: 'color-mix(in srgb, var(--sev-critical) 31%, transparent)', onText: 'var(--sev-critical)' },
  { field: 'body_camera_active', label: 'Body Cam', onBg: 'color-mix(in srgb, var(--sev-ok) 19%, transparent)', onBorder: 'color-mix(in srgb, var(--sev-ok) 31%, transparent)', onText: 'var(--sev-ok)' },
  { field: 'k9_requested', label: 'K9', onBg: 'color-mix(in srgb, var(--spm-text-muted) 19%, transparent)', onBorder: 'color-mix(in srgb, var(--spm-text-muted) 31%, transparent)', onText: 'var(--sev-ok)' },
  { field: 'ems_requested', label: 'EMS', onBg: 'color-mix(in srgb, var(--sev-critical) 19%, transparent)', onBorder: 'color-mix(in srgb, var(--sev-critical) 31%, transparent)', onText: 'var(--sev-critical)' },
  { field: 'fire_requested', label: 'Fire', onBg: 'color-mix(in srgb, var(--sev-high) 19%, transparent)', onBorder: 'color-mix(in srgb, var(--sev-high) 31%, transparent)', onText: 'var(--sev-high)' },
  { field: 'hazmat', label: 'HazMat', onBg: 'color-mix(in srgb, var(--sev-caution) 19%, transparent)', onBorder: 'color-mix(in srgb, var(--sev-caution) 31%, transparent)', onText: 'var(--sev-warn-soft)' },
  { field: 'evidence_collected', label: 'Evidence', onBg: 'color-mix(in srgb, var(--sev-ok) 19%, transparent)', onBorder: 'color-mix(in srgb, var(--sev-ok) 31%, transparent)', onText: 'var(--sev-ok-soft)' },
  { field: 'photos_taken', label: 'Photos', onBg: 'color-mix(in srgb, var(--spm-text-muted) 19%, transparent)', onBorder: 'color-mix(in srgb, var(--spm-text-muted) 31%, transparent)', onText: 'var(--spm-text)' },
  { field: 'trespass_issued', label: 'Trespass', onBg: 'color-mix(in srgb, var(--sev-warn) 19%, transparent)', onBorder: 'color-mix(in srgb, var(--sev-warn) 31%, transparent)', onText: 'var(--sev-warn-soft)' },
  { field: 'vehicle_pursuit', label: 'Vehicle Pursuit', onBg: 'color-mix(in srgb, var(--sev-critical) 19%, transparent)', onBorder: 'color-mix(in srgb, var(--sev-critical) 31%, transparent)', onText: 'var(--sev-critical)' },
  { field: 'foot_pursuit', label: 'Foot Pursuit', onBg: 'color-mix(in srgb, var(--sev-critical) 19%, transparent)', onBorder: 'color-mix(in srgb, var(--sev-critical) 31%, transparent)', onText: 'var(--sev-critical)' },
] as const;

const KEYBOARD_SHORTCUT_GROUPS = [
  { group: 'Selected Call', items: [
    ['F3 / D', 'Dispatch (pending)'], ['F5 / E', 'En route'], ['F6 / O', 'On scene'],
    ['F7 / ⇧C', 'Clear + disposition'], ['F9 / H', 'Hold / resume'], ['F4', 'Edit call'],
  ] },
  { group: 'Create / Panels', items: [
    ['F2 / N', 'New call'], ['F10 / P', 'Quick PSO request'], ['F8', 'Focus CAD command line'],
    ['F12', 'Toggle NCIC panel'], ['R', 'Refresh'],
  ] },
  { group: 'Navigate / Filter', items: [
    ['↑ / k', 'Previous call'], ['↓ / j', 'Next call'], ['1–6', 'Filter tabs'],
    ['Esc', 'Close modals'], ['?', 'This help'],
  ] },
] as const;

const SERVICE_WINDOW_SLOTS = [
  { key: 'early_morning', label: '6AM – 9AM' },
  { key: 'daytime', label: '9AM – 6PM' },
  { key: 'evening', label: '6PM – 9PM' },
  { key: 'weekend', label: 'Weekend' },
] as const;

const MOVING_STATUSES = new Set<string>(['available', 'dispatched', 'enroute', 'onscene', 'busy']);
const PRIORITY_LEVELS = ['P1', 'P2', 'P3', 'P4'];
const STATUS_SORT_ORDER: Record<string, number> = { dispatched: 0, enroute: 1, onscene: 2, pending: 3, on_hold: 4, cleared: 5, closed: 6, cancelled: 7 };
const SORT_CYCLE: Record<string, 'priority' | 'time' | 'status' | 'geo'> = { priority: 'time', time: 'status', status: 'geo', geo: 'priority' };
const SORT_LABELS: Record<string, string> = { priority: 'PRI', time: 'NEW', status: 'STA', geo: 'GEO' };
const SORT_TITLES: Record<string, string> = { priority: 'priority', time: 'newest', status: 'status', geo: 'district' };
const ATTEMPT_NUMBERS = Array.from({ length: 10 }, (_, i) => i + 1);
const SOURCE_OPTIONS = [
  { value: 'phone', label: 'Phone' }, { value: 'radio', label: 'Radio' }, { value: 'walk_in', label: 'Walk-In' },
  { value: 'alarm', label: 'Alarm' }, { value: 'patrol', label: 'Patrol' }, { value: 'online', label: 'Online' },
  { value: 'dispatch', label: 'Dispatch' }, { value: 'other', label: 'Other' },
] as const;
const PRIORITY_OPTIONS = [
  { value: 'P1', label: 'P1 - Emergency' }, { value: 'P2', label: 'P2 - Urgent' },
  { value: 'P3', label: 'P3 - Routine' }, { value: 'P4', label: 'P4 - Scheduled' },
] as const;
const SERVE_PRIORITY_OPTIONS = ['normal', 'rush', 'urgent'] as const;
const MODAL_BACKDROP_STYLE: React.CSSProperties = { background: 'rgba(0 0 0 / 0.65)', WebkitBackdropFilter: 'blur(4px)', backdropFilter: 'blur(4px)' };
const MODAL_PANEL_STYLE: React.CSSProperties = { border: '1px solid var(--spm-border)', boxShadow: '0 12px 40px rgba(0 0 0 / 0.5), 0 0 1px rgba(255,255,255,0.05) inset' };
const DETAIL_TAB_LABELS: Record<string, string> = { info: 'Info', persons: 'Persons / Vehicles', timeline: 'Timeline', notes: 'Notes', documents: 'Documents', attachments: 'Files', flags: 'Flags', audit: 'Audit' };
const FILTER_TAB_CONFIG = [
  { id: 'queue', label: 'Queue' }, { id: 'pending', label: 'Pending' },
  { id: 'active', label: 'Active' }, { id: 'hold', label: 'Hold' },
  { id: 'serve', label: 'Serve' }, { id: 'cleared', label: 'Cleared' },
] as const;
const TIMELINE_FIELDS = [
  { label: 'Created', field: 'created_at', color: 'var(--spm-text-muted)' },
  { label: 'Dispatched', field: 'dispatched_at', color: 'var(--sev-warn)' },
  { label: 'Enroute', field: 'enroute_at', color: 'var(--spm-text-muted)' },
  { label: 'On Scene', field: 'onscene_at', color: 'var(--sev-special)' },
  { label: 'Cleared', field: 'cleared_at', color: 'var(--sev-ok)' },
  { label: 'Closed', field: 'closed_at', color: 'var(--spm-text-muted)' },
] as const;
const TIMELINE_FIELDS_DESKTOP = [
  ...TIMELINE_FIELDS,
  { label: 'Archived', field: 'archived_at', color: 'var(--spm-text-muted)' },
] as const;
const UNIT_STATUS_BASE_OPTIONS = [
  { value: 'available', label: 'Available' },
  { value: 'off_duty', label: 'Off Duty' },
  { value: 'busy', label: 'Busy' },
] as const;
const UNIT_STATUS_EDIT_OPTIONS = [
  { value: 'dispatched', label: 'Dispatched' },
  { value: 'enroute', label: 'En Route' },
  { value: 'onscene', label: 'On Scene' },
] as const;
const STATUS_BAR_STYLE: React.CSSProperties = { background: 'var(--surface-deep)', borderColor: 'var(--surface-raised)', fontFamily: 'Arial, sans-serif' };
const SCROLL_CONTAIN_STYLE: React.CSSProperties = { overscrollBehavior: 'contain', WebkitOverflowScrolling: 'touch' } as React.CSSProperties;

const PROCESS_SERVICE_RESULT_GROUPS = [
  { label: 'Successful Service', options: [
    { value: 'served', text: 'Personal Service' },
    { value: 'substitute_service', text: 'Substitute Service' },
    { value: 'abode_service', text: 'Abode / Dwelling Service' },
    { value: 'posted', text: 'Posted (Nail & Mail)' },
    { value: 'left_with', text: 'Left With (Co-Resident / Co-Worker)' },
    { value: 'left_at_door', text: 'Left at Door (Conspicuous Place)' },
    { value: 'served_agent', text: 'Served on Agent / Registered Agent' },
    { value: 'served_attorney', text: 'Served on Attorney of Record' },
    { value: 'served_corporate', text: 'Served on Corporate Officer' },
    { value: 'served_manager', text: 'Served on Manager / Supervisor' },
    { value: 'served_secretary_of_state', text: 'Served via Secretary of State' },
    { value: 'acknowledged', text: 'Acknowledged / Accepted Service' },
    { value: 'certified_mail', text: 'Certified Mail (Return Receipt)' },
  ] },
  { label: 'Unsuccessful — Attempt Made', options: [
    { value: 'no_answer', text: 'No Answer / Not Home' },
    { value: 'no_contact', text: 'No Contact Made' },
    { value: 'refused', text: 'Refused Service' },
    { value: 'evasion', text: 'Evasion / Avoiding Service' },
    { value: 'gate_locked', text: 'Gated / Locked — No Access' },
    { value: 'aggressive_animal', text: 'Aggressive Animal / Dog' },
    { value: 'unsafe_conditions', text: 'Unsafe Conditions' },
    { value: 'wrong_person', text: 'Wrong Person at Address' },
    { value: 'not_recognized', text: 'Subject Not Recognized at Location' },
  ] },
  { label: 'Unsuccessful — Cannot Serve', options: [
    { value: 'unable_to_locate', text: 'Unable to Locate' },
    { value: 'bad_address', text: 'Bad / Invalid Address' },
    { value: 'address_vacant', text: 'Address Vacant / Abandoned' },
    { value: 'address_commercial', text: 'Address is Commercial (Need Residential)' },
    { value: 'moved', text: 'Subject Moved' },
    { value: 'moved_out_of_state', text: 'Subject Moved Out of State' },
    { value: 'deceased', text: 'Subject Deceased' },
    { value: 'incarcerated', text: 'Subject Incarcerated' },
    { value: 'military', text: 'Subject on Active Military Duty' },
    { value: 'non_est', text: 'Non Est Inventus (Not Found)' },
    { value: 'due_diligence_exhausted', text: 'Due Diligence Exhausted' },
  ] },
  { label: 'Administrative', options: [
    { value: 'unable_to_serve', text: 'Unable to Serve (General)' },
    { value: 'returned_to_attorney', text: 'Returned to Attorney' },
    { value: 'returned_to_court', text: 'Returned to Court' },
    { value: 'returned_to_client', text: 'Returned to Client' },
    { value: 'expired', text: 'Documents Expired' },
    { value: 'recalled', text: 'Service Recalled / Cancelled' },
    { value: 'duplicate', text: 'Duplicate / Already Served' },
    { value: 'insufficient_info', text: 'Insufficient Information' },
    { value: 'jurisdiction_issue', text: 'Jurisdiction Issue' },
    { value: 'referred_out', text: 'Referred to Another Server' },
    { value: 'other', text: 'Other' },
  ] },
] as const;

function buildCallEditBody(
  ed: Record<string, any>,
  selectedFor: { location?: string | null; latitude?: number | null; longitude?: number | null } | null,
): Record<string, any> {
  const sameLoc = ed.location === selectedFor?.location;
  return {
    incident_type: ed.incident_type,
    priority: ed.priority,
    client_id: ed.client_id || null,
    property_id: ed.property_id || null,
    caller_name: ed.caller_name,
    caller_phone: ed.caller_phone,
    caller_relationship: ed.caller_relationship,
    caller_address: ed.caller_address,
    location_address: ed.location,
    latitude: (!sameLoc && ed.latitude === selectedFor?.latitude) ? null : (ed.latitude ?? null),
    longitude: (!sameLoc && ed.longitude === selectedFor?.longitude) ? null : (ed.longitude ?? null),
    description: ed.description,
    source: ed.source,
    disposition: ed.disposition,
    cross_street: ed.cross_street,
    location_building: ed.location_building,
    location_floor: ed.location_floor,
    location_room: ed.location_room,
    zone_beat: ed.zone_beat,
    sector_id: ed.sector_id,
    zone_id: ed.zone_id,
    beat_id: ed.beat_id,
    dispatch_code: ed.dispatch_code,
    weapons_involved: ed.weapons_involved,
    injuries_reported: ed.injuries_reported,
    num_subjects: ed.num_subjects ? Number(ed.num_subjects) : null,
    num_victims: ed.num_victims ? Number(ed.num_victims) : null,
    subject_description: ed.subject_description,
    vehicle_description: ed.vehicle_description,
    direction_of_travel: ed.direction_of_travel,
    scene_safety: ed.scene_safety,
    weather_conditions: ed.weather_conditions,
    lighting_conditions: ed.lighting_conditions,
    alcohol_involved: ed.alcohol_involved,
    drugs_involved: ed.drugs_involved,
    domestic_violence: ed.domestic_violence,
    supervisor_notified: ed.supervisor_notified,
    le_notified: ed.le_notified,
    le_agency: ed.le_agency,
    le_case_number: ed.le_case_number,
    damage_estimate: ed.damage_estimate !== '' && ed.damage_estimate != null ? Number(ed.damage_estimate) : null,
    damage_description: ed.damage_description,
    action_taken: ed.action_taken,
    responding_officer: ed.responding_officer,
    starting_mileage: ed.starting_mileage ? Number(ed.starting_mileage) : null,
    ending_mileage: ed.ending_mileage ? Number(ed.ending_mileage) : null,
    pso_requestor_name: ed.pso_requestor_name || null,
    pso_requestor_phone: ed.pso_requestor_phone || null,
    pso_requestor_email: ed.pso_requestor_email || null,
    pso_service_type: ed.pso_service_type || null,
    pso_billing_code: ed.pso_billing_code || null,
    pso_authorization: ed.pso_authorization || null,
    contract_id: ed.contract_id || null,
    process_service_type: ed.process_service_type || null,
    process_served_to: ed.process_served_to || null,
    process_served_address: ed.process_served_address || null,
    process_attempts: ed.process_attempts ? Number(ed.process_attempts) : 0,
    process_served_at: ed.process_served_at || null,
    process_service_result: ed.process_service_result || null,
    court_name: ed.court_name || null,
    case_number: ed.case_number || null,
  };
}

export default function DispatchPage() {
  const { user } = useAuth();
  const isAdminOrManager = user?.role === 'admin' || user?.role === 'manager';
  // A note is editable by its author (server-stamped author_username) or any admin/manager.
  const canEditNote = useCallback((note: { author_username?: string | null }) =>
    isAdminOrManager || (!!note.author_username && note.author_username === user?.username),
  [isAdminOrManager, user?.username]);
  const isGodMode = user?.role === 'admin'; // Admin God Mode — unrestricted access
  const isSupervisorPlus = ['admin', 'manager', 'supervisor'].includes(user?.role ?? '');
  const unitModalTitleId = useId();
  const navigate = useNavigate();
  const { addToast } = useToast();
  const { subscribe } = useWebSocket();
  const isMobile = useIsMobile();

  // Generate + open the PSO "Notice of Communication" for a failed client-request
  // attempt that is being re-dispatched. Autofills from the failed call; the
  // re-dispatch call number + next window ride along when known.
  const openPsoNotice = useCallback(async (
    failedCall: CallForService,
    extra?: { redispatchCallNumber?: string; nextWindow?: string },
  ) => {
    try {
      const officerName = user
        ? (`${user.first_name || ''} ${user.last_name || ''}`.trim() || user.username)
        : 'RMPG Dispatch';
      await openNoticeOfCommunication(failedCall, {
        officerName,
        officerBadge: (user as any)?.badge_number || '',
        // RMPG Dispatch direct line. Centralized in organizationConstants.ts.
        // When multiple tenants exist, migrate this to a Worker settings row.
        dispatchPhone: ORGANIZATION.phone,
        redispatchCallNumber: extra?.redispatchCallNumber,
        nextWindow: extra?.nextWindow,
      });
    } catch (err: any) {
      addToast(`Notice of Communication failed: ${err?.message || 'Unknown error'}`, 'error');
    }
  }, [user, addToast]);
  const { prefs: userPrefs, reload: reloadPrefs } = useUserPreferences();
  const { districts, sections, sectionLabels, getSectionCode, getArea, zoneLabels, zonesForSection, beatsForZone, beatsForSection, districtForSectionBeat, getBeatLabel } = useDistrictOptions();
  const { resolve: resolveAddress } = useAddressAutofill();
  const dispatchCodes = useDispatchCodes();
  const signalLookup = useMemo(() => dispatchCodes.lookup, [dispatchCodes.lookup]);
  const knownSignalCodes = useMemo(() => new Set(dispatchCodes.codes.map(c => c.code)), [dispatchCodes.codes]);
  const dispatchOptimization = useOptimizationV2();
  const [showAssignmentOverlay, setShowAssignmentOverlay] = useState(false);
  const dispatchOpt = useDispatchOptimization();
  const [calls, setCalls] = useState<CallForService[]>([]);
  // Mirror `calls` into a ref so the mount-only WebSocket effect (deps exclude
  // `calls` to avoid re-subscribing on every list change) can read current
  // state — e.g. priority-escalation detection in the call_updated handler.
  const callsRef = useRef<CallForService[]>([]);
  useEffect(() => { callsRef.current = calls; }, [calls]);
  const recentlyCreatedIdsRef = useRef<Set<string | number>>(new Set());
  const rememberRecentId = useCallback((id: string | number) => {
    const set = recentlyCreatedIdsRef.current;
    set.add(id);
    if (set.size > RECENT_IDS_CAP) {
      const overflow = set.size - RECENT_IDS_CAP;
      let dropped = 0;
      for (const v of set) {
        if (dropped >= overflow) break;
        set.delete(v); dropped++;
      }
    }
  }, []);
  const [units, setUnits] = useState<Unit[]>([]);
  const refreshUnits = useCallback(async () => {
    const unitsRes = await apiFetch<any[]>('/dispatch/units');
    setUnits((Array.isArray(unitsRes) ? unitsRes : []).map(mapDbUnit));
  }, []);
  // Mirror `units` into a ref so the mount-only adaptive GPS-poll effect (deps
  // exclude `units` to avoid re-arming the interval on every position tick) can
  // read current on-duty state.
  const unitsRef = useRef<Unit[]>([]);
  useEffect(() => { unitsRef.current = units; }, [units]);

  // Destructure the stable submit ref so this callback only changes when units/calls
  // change — not every render (dispatchOptimization as a whole was a new object every
  // render before useOptimizationV2 memoized its return value, which caused this
  // useCallback to be recreated on every render).
  const handleOptimizeAssignments = useCallback(async () => {
    const availableUnits = units.filter((u) => ['available', 'on_scene', 'onscene'].includes(u.status));
    const availableUnitIds = availableUnits.map((u) => Number(u.id));
    const openCalls = calls.filter((c) => ['active', 'dispatched', 'pending'].includes(c.status));
    const openCallIds = openCalls.map((c) => Number(c.id));
    if (!availableUnitIds.length || !openCallIds.length) return;

    // Build context maps for the rich proposal builder
    const callDetails = new Map(openCalls.map((c) => [
      Number(c.id),
      {
        incidentNumber: c.call_number || String(c.id),
        address: c.location || '',
        priority: c.priority || 'P3',
      },
    ]));
    const callAssignments = new Map(openCalls.map((c) => [
      Number(c.id),
      Array.isArray(c.assigned_units) ? c.assigned_units : [],
    ]));
    const unitsBySign = new Map(availableUnits.map((u) => [u.call_sign, Number(u.id)]));

    // Drive both: legacy simple overlay (kept for compat) + new proposal modal
    await dispatchOptimization.submit({
      job_type: 'multi_unit_dispatch',
      call_ids: openCallIds,
      unit_ids: availableUnitIds,
    });
    await dispatchOpt.startOptimization(openCallIds, availableUnitIds);
  }, [units, calls, dispatchOptimization.submit, dispatchOpt]);

  useEffect(() => {
    if (dispatchOptimization.status === 'complete') setShowAssignmentOverlay(true);
  }, [dispatchOptimization.status]);
  const [selectedCall, setSelectedCall] = useState<CallForService | null>(null);
  const [filterTab, setFilterTab] = usePersistedTab('rmpg_dispatch_tab', 'queue' as FilterTab, ['queue', 'pending', 'active', 'hold', 'serve', 'cleared', 'archived'] as const);
  // Spillman CAD console view (P1 structural replica). Persisted; defaults ON
  // per program decision "replaces default look" — '0' opts back to classic.
  const [cadBoardView, setCadBoardView] = useState<boolean>(
    () => { try { return localStorage.getItem('rmpg_dispatch_cad_board') !== '0'; } catch { return true; } },
  );
  const toggleCadBoardView = () => {
    setCadBoardView((v) => {
      try { localStorage.setItem('rmpg_dispatch_cad_board', v ? '0' : '1'); } catch { /* private mode */ }
      return !v;
    });
  };
  const [showNewCallModal, setShowNewCallModal] = useState(false);
  const [showPlateScanModal, setShowPlateScanModal] = useState(false);
  const [showQuickPsoModal, setShowQuickPsoModal] = useState(false);
  const [reportingIssue, setReportingIssue] = useState(false);

  // Generic confirm host. Six call-action buttons used to open a native
  // window.confirm(), which BLOCKS the main thread until the operator answers
  // — Chrome then bills the whole wait to the click handler and logs
  // "[Violation] 'click' handler took 1683ms" (observed live 2026-07-27). That
  // number was human reaction time, not slow code, but the blocking dialog is
  // also unthemed and unstyleable, so these now route through ConfirmDialog.
  // Each action keeps its OWN body verbatim in `run` — the three return-visit
  // handlers look alike but are NOT interchangeable (two prepend a new call
  // with [mapped, ...prev], the third replaces in place with prev.map), so
  // they are deliberately not consolidated.
  const [pendingConfirm, setPendingConfirm] = useState<{
    title: string;
    message: string;
    confirmLabel: string;
    run: () => Promise<void>;
  } | null>(null);
  const [confirmRunning, setConfirmRunning] = useState(false);

  const runPendingConfirm = useCallback(async () => {
    if (!pendingConfirm) return;
    setConfirmRunning(true);
    try {
      await pendingConfirm.run();
    } finally {
      // Always tear the dialog down, even if the action threw — every `run`
      // body reports its own failure via addToast, so leaving the modal open
      // would strand the operator behind a dialog with no error shown in it.
      setConfirmRunning(false);
      setPendingConfirm(null);
    }
  }, [pendingConfirm]);
  // Status-bar clock is rendered via the self-ticking <LiveClock/> component
  // (bottom bar, below). It owns its own 1s interval so the per-second tick no
  // longer re-renders this entire 6,300-line page — only the clock span.
  const [searchQuery, setSearchQuery] = useState('');
  const [priorityFilter, setPriorityFilter] = useState<string | null>(null);
  const [typeFilter, setTypeFilter] = useState<string | null>(null);
  const [signalFilter, setSignalFilter] = useState<'signaled' | 'unsignaled' | null>(null);
  const [onSceneElapsed, setOnSceneElapsed] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isDetailLoading, setIsDetailLoading] = useState(false);
  // Quick Dispatch templates
  const [templates, setTemplates] = useState<any[]>([]);
  const [showTemplateDropdown, setShowTemplateDropdown] = useState(false);
  const [templateInitialData, setTemplateInitialData] = useState<Record<string, any> | undefined>(undefined);
  // Quick Template Dialog — minimal address-only dispatch
  const [quickTemplateData, setQuickTemplateData] = useState<{ name: string; incident_type: string; priority: string; description: string; source: string } | null>(null);
  const [quickTemplateAddress, setQuickTemplateAddress] = useState('');
  const [quickTemplateCoords, setQuickTemplateCoords] = useState<{ lat: number | null; lng: number | null }>({ lat: null, lng: null });
  const [quickTemplateSubmitting, setQuickTemplateSubmitting] = useState(false);
  const quickTemplateInputRef = useRef<HTMLInputElement>(null);
  // Linked incidents for the selected call
  const [linkedIncidents, setLinkedIncidents] = useState<any[]>([]);
  // Warning tags / caution alerts for selected call
  const [callWarnings, setCallWarnings] = useState<WarningTag[]>([]);
  // NCIC Query Panel
  const [showNcicPanel, setShowNcicPanel] = useState(false);
  const [detailTab, setDetailTab] = useState<'info' | 'persons' | 'timeline' | 'notes' | 'documents' | 'flags' | 'attachments' | 'audit'>('info');
  const [auditTrail, setAuditTrail] = useState<any[]>([]);
  const [auditTrailLoading, setAuditTrailLoading] = useState(false);
  // Detail-tab bar overflows horizontally on narrower panels (scrolls instead
  // of wrapping — see 2026-08-08's #3307). Audit sits last, so it can scroll
  // fully out of view with no visual cue that it exists. detailTabBarRef +
  // detailTabRefs back a "scroll the active tab into view" effect below, and
  // canScrollTabs backs the fade/arrow affordance that makes the scroll itself
  // discoverable — clicking a tab that's already invisible was the bug.
  const detailTabBarRef = useRef<HTMLDivElement>(null);
  const detailTabRefs = useRef<Partial<Record<string, HTMLButtonElement>>>({});
  const [canScrollTabsLeft, setCanScrollTabsLeft] = useState(false);
  const [canScrollTabsRight, setCanScrollTabsRight] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; call: CallForService } | null>(null);
  const [ncicInitialQuery, setNcicInitialQuery] = useState<{ type: 'person' | 'vehicle' | 'warrant'; query: string } | null>(null);
  // Timeline / activity log entries for selected call
  const [activityEntries, setActivityEntries] = useState<any[]>([]);
  // Timeline editing (admin/manager only)
  const [editingTimestamp, setEditingTimestamp] = useState<string | null>(null);
  // Editing state
  const [isEditing, setIsEditing] = useState(false);
  const [editData, setEditData] = useState<Record<string, any>>({});
  const [isSaving, setIsSaving] = useState(false);
  // Records connection search (person/vehicle lookup in edit mode)
  const [personSearchResults, setPersonSearchResults] = useState<any[]>([]);
  const [vehicleSearchResults, setVehicleSearchResults] = useState<any[]>([]);
  const [showPersonDropdown, setShowPersonDropdown] = useState(false);
  const [showVehicleDropdown, setShowVehicleDropdown] = useState(false);
  const [showBusinessDropdown, setShowBusinessDropdown] = useState(false);
  const [businessQuery, setBusinessQuery] = useState('');
  const [businessSearchResults, setBusinessSearchResults] = useState<any[]>([]);
  const personSearchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const vehicleSearchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const businessSearchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const personAbortRef = useRef<AbortController | null>(null);
  const vehicleAbortRef = useRef<AbortController | null>(null);
  const businessAbortRef = useRef<AbortController | null>(null);
  const personDropdownRef = useRef<HTMLDivElement>(null);
  const vehicleDropdownRef = useRef<HTMLDivElement>(null);
  const businessDropdownRef = useRef<HTMLDivElement>(null);
  const [showCreatePersonModal, setShowCreatePersonModal] = useState(false);
  const [showCreateVehicleModal, setShowCreateVehicleModal] = useState(false);
  const [isCreatingRecord, setIsCreatingRecord] = useState(false);
  const [serveLink, setServeLink] = useState<any>(null);
  const [sendingToServe, setSendingToServe] = useState(false);
  const [serveRouteJobs, setServeRouteJobs] = useState<any[]>([]);
  const [serveRouteOrder, setServeRouteOrder] = useState<number[] | null>(null);
  // Map of call_id → serve_queue sort_order for route-based sorting
  const [serveRouteSortMap, setServeRouteSortMap] = useState<Record<string, number>>({});
  // AI Dispatch analysis state
  const [aiAnalyses, setAiAnalyses] = useState<Record<string, any>>({});
  const [showAiSidebar, setShowAiSidebar] = useState(false);
  const [showCodePanel, setShowCodePanel] = useState(false);
  const [showActivityFeed, setShowActivityFeed] = useState(false);
  const [quickFilter, setQuickFilter] = useState<QuickFilter>('all');
  const [duplicateWarning, setDuplicateWarning] = useState<{ message: string; callNumber?: string; callId?: string } | null>(null);

  // Queue sort mode. Persisted via two layers:
  //   1. localStorage (fast first-render hint — used while the /user/preferences
  //      fetch is in flight, and on cold-start before any prefs hydrate).
  //   2. /api/user/preferences — `dispatch_sort` is in PREF_COLUMNS (see
  //      src/routes/stubs.ts) so server-side is the source of truth across
  //      devices. The reconcile effect below replaces localStorage with the
  //      server value once prefs load, so a different workstation's saved
  //      sort wins over this device's stale localStorage.
  const [localSort, setLocalSort] = useState<string>(() => localStorage.getItem('rmpg_dispatch_sort') || '');
  useEffect(() => {
    const serverSort = (userPrefs as any)?.dispatch_sort;
    if (typeof serverSort === 'string' && serverSort && serverSort !== localSort) {
      setLocalSort(serverSort);
      try { localStorage.setItem('rmpg_dispatch_sort', serverSort); } catch { /* storage unavailable */ }
    }
  }, [userPrefs, localSort]);

  // ── Feature 1: Call priority sound alerts ──
  // The "Mute" toolbar button is meant to silence ALL dispatch audio — tone
  // chimes (gated below via soundAlertsMutedRef) AND spoken voice alerts
  // (gated separately, in voiceAlerts.ts, by the 'rmpg-sound' localStorage
  // key). Those used to be two independent keys that never synced, so
  // muting here silenced only the chimes while announceNewCall/etc. kept
  // talking. Keep both keys in lockstep from this one control.
  const [soundAlertsMuted, setSoundAlertsMuted] = useState(() => localStorage.getItem('rmpg_sound_alerts_muted') === 'true');
  const soundAlertsMutedRef = useRef(soundAlertsMuted);
  useEffect(() => { soundAlertsMutedRef.current = soundAlertsMuted; }, [soundAlertsMuted]);
  useEffect(() => {
    // Reconcile the two keys once on mount in case they'd drifted from
    // before this fix (e.g. a prior session muted only one of them).
    localStorage.setItem('rmpg-sound', String(!soundAlertsMuted));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const toggleSoundAlerts = useCallback(() => {
    setSoundAlertsMuted(prev => {
      const next = !prev;
      localStorage.setItem('rmpg_sound_alerts_muted', String(next));
      localStorage.setItem('rmpg-sound', String(!next));
      return next;
    });
  }, []);

  // ── Feature 5: Shift handoff notes ──
  const [showHandoffNotes, setShowHandoffNotes] = useState(false);
  const [handoffNotes, setHandoffNotes] = useState('');
  const [handoffMeta, setHandoffMeta] = useState<{ updated_by?: string; updated_at?: string }>({});
  const [savingHandoff, setSavingHandoff] = useState(false);

  const fetchHandoffNotes = useCallback(async () => {
    try {
      const data = await apiFetch<any>('/dispatch/shift-handoff');
      setHandoffNotes(data?.text || '');
      setHandoffMeta({ updated_by: data?.updated_by, updated_at: data?.updated_at });
    } catch {
      console.error('[Dispatch] Failed to fetch handoff notes');
    }
  }, []);

  const saveHandoffNotes = useCallback(async () => {
    setSavingHandoff(true);
    try {
      await apiFetch('/dispatch/shift-handoff', { method: 'PUT', body: JSON.stringify({ text: handoffNotes }) });
      addToast('Handoff notes saved', 'success');
    } catch { addToast('Failed to save handoff notes', 'error'); }
    finally { setSavingHandoff(false); }
  }, [handoffNotes, addToast]);

  const handleApplyCode = useCallback(async (code: string) => {
    if (!selectedCall) {
      addToast('Select a call first to apply code', 'warning');
      return;
    }
    try {
      await apiFetch(`/dispatch/calls/${selectedCall.id}`, {
        method: 'PUT',
        body: JSON.stringify({ incident_type: code }),
      });
      const updated: CallForService = { ...selectedCall!, incident_type: (code as unknown) as IncidentType };
      setSelectedCall(updated);
      setCalls(prev => prev.map(c => c.id === selectedCall.id ? updated : c));
      const desc = signalLookup(code);
      const label = desc ? `${code} (${desc.description})` : code;
      addToast(`Signal set to ${label}`, 'success');
    } catch {
      addToast('Failed to apply code', 'error');
    }
  }, [selectedCall, addToast, signalLookup]);

  // Clean up search timers and abort controllers on unmount
  useEffect(() => {
    return () => {
      if (personSearchTimerRef.current) clearTimeout(personSearchTimerRef.current);
      if (vehicleSearchTimerRef.current) clearTimeout(vehicleSearchTimerRef.current);
      if (businessSearchTimerRef.current) clearTimeout(businessSearchTimerRef.current);
      if (personAbortRef.current) personAbortRef.current.abort();
      if (vehicleAbortRef.current) vehicleAbortRef.current.abort();
      if (businessAbortRef.current) businessAbortRef.current.abort();
    };
  }, []);

  // Close person/vehicle/business dropdowns on outside click
  useEffect(() => {
    if (!showPersonDropdown && !showVehicleDropdown && !showBusinessDropdown) return;
    const handler = (e: MouseEvent) => {
      if (showPersonDropdown && personDropdownRef.current && !personDropdownRef.current.contains(e.target as Node)) setShowPersonDropdown(false);
      if (showVehicleDropdown && vehicleDropdownRef.current && !vehicleDropdownRef.current.contains(e.target as Node)) setShowVehicleDropdown(false);
      if (showBusinessDropdown && businessDropdownRef.current && !businessDropdownRef.current.contains(e.target as Node)) setShowBusinessDropdown(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showPersonDropdown, showVehicleDropdown, showBusinessDropdown]);

  const searchPersons = useCallback((query: string) => {
    if (personSearchTimerRef.current) clearTimeout(personSearchTimerRef.current);
    if (personAbortRef.current) personAbortRef.current.abort();
    if (query.length < 2) { setPersonSearchResults([]); setShowPersonDropdown(false); return; }
    personSearchTimerRef.current = setTimeout(async () => {
      try {
        const controller = new AbortController();
        personAbortRef.current = controller;
        const results = await apiFetch<any[]>(`/records/persons/search?q=${encodeURIComponent(query)}`, { signal: controller.signal });
        setPersonSearchResults(Array.isArray(results) ? results.slice(0, MAX_SEARCH_RESULTS) : []);
        setShowPersonDropdown(true);
      } catch (e: any) {
        if (e?.name !== 'AbortError') setPersonSearchResults([]);
      }
    }, SEARCH_DEBOUNCE_MS);
  }, []);

  const searchVehicles = useCallback((query: string) => {
    if (vehicleSearchTimerRef.current) clearTimeout(vehicleSearchTimerRef.current);
    if (vehicleAbortRef.current) vehicleAbortRef.current.abort();
    if (query.length < 2) { setVehicleSearchResults([]); setShowVehicleDropdown(false); return; }
    vehicleSearchTimerRef.current = setTimeout(async () => {
      try {
        const controller = new AbortController();
        vehicleAbortRef.current = controller;
        const results = await apiFetch<any[]>(`/records/vehicles/search?q=${encodeURIComponent(query)}`, { signal: controller.signal });
        setVehicleSearchResults(Array.isArray(results) ? results.slice(0, MAX_SEARCH_RESULTS) : []);
        setShowVehicleDropdown(true);
      } catch (e: any) {
        if (e?.name !== 'AbortError') setVehicleSearchResults([]);
      }
    }, SEARCH_DEBOUNCE_MS);
  }, []);
  // ── Linked Persons / Vehicles on call ──
  const [callPersons, setCallPersons] = useState<any[]>([]);
  const [callVehicles, setCallVehicles] = useState<any[]>([]);
  // ── BOLOs linked to the selected call ──
  const [callBolos, setCallBolos] = useState<any[]>([]);
  const [bolosLoading, setBolosLoading] = useState(false);
  const [showBoloSearch, setShowBoloSearch] = useState(false);
  const [boloSearchQ, setBoloSearchQ] = useState('');
  const [boloSearchResults, setBoloSearchResults] = useState<any[]>([]);
  const [linkPersonRole, setLinkPersonRole] = useState('involved');
  const [linkVehicleRole, setLinkVehicleRole] = useState('involved');
  const [callBusinesses, setCallBusinesses] = useState<any[]>([]);
  const [linkBusinessRole, setLinkBusinessRole] = useState('involved');
  const { options: linkOptions } = useLinkOptions();

  // ── Inline involved persons / vehicles (ad-hoc, no FK to records tables) ──
  const [involvedPersons, setInvolvedPersons] = useState<any[]>([]);
  const [involvedVehicles, setInvolvedVehicles] = useState<any[]>([]);
  const [callNarrative, setCallNarrative] = useState<string>('');
  const [narrativeSaving, setNarrativeSaving] = useState(false);
  const [showAddInvPerson, setShowAddInvPerson] = useState(false);
  const [showAddInvVehicle, setShowAddInvVehicle] = useState(false);
  const [newInvPerson, setNewInvPerson] = useState({ name: '', dob: '', id_number: '', role: 'witness' });
  const [newInvVehicle, setNewInvVehicle] = useState({ plate: '', make: '', model: '', color: '', role: 'involved' });

  const fetchCallPersons = useCallback(async (callId: string | number) => {
    try {
      const data = await apiFetch<any[]>(`/dispatch/calls/${callId}/persons`);
      setCallPersons(Array.isArray(data) ? data : []);
    } catch (err: any) {
      setCallPersons([]);
      addToast(err?.message || 'Failed to load linked persons', 'error');
    }
  }, [addToast]);

  const fetchCallVehicles = useCallback(async (callId: string | number) => {
    try {
      const data = await apiFetch<any[]>(`/dispatch/calls/${callId}/vehicles`);
      setCallVehicles(Array.isArray(data) ? data : []);
    } catch (err: any) {
      setCallVehicles([]);
      addToast(err?.message || 'Failed to load linked vehicles', 'error');
    }
  }, [addToast]);

  const linkPersonToCall = useCallback(async (callId: string | number, personId: string | number, role: string) => {
    try {
      await apiFetch(`/dispatch/calls/${callId}/persons`, {
        method: 'POST', body: JSON.stringify({ person_id: personId, role }),
      });
      fetchCallPersons(callId);
    } catch (err: any) {
      console.error('Link person error:', err);
      addToast(err?.message || 'Failed to link person', 'error');
    }
  }, [fetchCallPersons, addToast]);

  const unlinkPersonFromCall = useCallback(async (callId: string | number, linkId: string | number) => {
    try {
      await apiFetch(`/dispatch/calls/${callId}/persons/${linkId}`, { method: 'DELETE' });
      setCallPersons(prev => prev.filter(p => p.id !== linkId));
    } catch (err: any) {
      console.error('Unlink person error:', err);
      addToast(err?.message || 'Failed to unlink person', 'error');
      fetchCallPersons(callId);
    }
  }, [addToast, fetchCallPersons]);

  const linkVehicleToCall = useCallback(async (callId: string | number, vehicleId: string | number, role: string) => {
    try {
      await apiFetch(`/dispatch/calls/${callId}/vehicles`, {
        method: 'POST', body: JSON.stringify({ vehicle_id: vehicleId, role }),
      });
      fetchCallVehicles(callId);
    } catch (err: any) {
      console.error('Link vehicle error:', err);
      addToast(err?.message || 'Failed to link vehicle', 'error');
    }
  }, [fetchCallVehicles, addToast]);

  const unlinkVehicleFromCall = useCallback(async (callId: string | number, linkId: string | number) => {
    try {
      await apiFetch(`/dispatch/calls/${callId}/vehicles/${linkId}`, { method: 'DELETE' });
      setCallVehicles(prev => prev.filter(v => v.id !== linkId));
    } catch (err: any) {
      console.error('Unlink vehicle error:', err);
      addToast(err?.message || 'Failed to unlink vehicle', 'error');
      fetchCallVehicles(callId);
    }
  }, [addToast, fetchCallVehicles]);

  const fetchCallBusinesses = useCallback(async (callId: string | number) => {
    try {
      const data = await apiFetch<any[]>(`/dispatch/calls/${callId}/businesses`);
      setCallBusinesses(Array.isArray(data) ? data : []);
    } catch (err: any) {
      setCallBusinesses([]);
      addToast(err?.message || 'Failed to load linked businesses', 'error');
    }
  }, [addToast]);

  const fetchInvolvedPersons = useCallback(async (callId: string | number) => {
    try {
      const data = await apiFetch<any[]>(`/dispatch/calls/${callId}/involved-persons`);
      setInvolvedPersons(Array.isArray(data) ? data : []);
    } catch { setInvolvedPersons([]); }
  }, []);

  const fetchInvolvedVehicles = useCallback(async (callId: string | number) => {
    try {
      const data = await apiFetch<any[]>(`/dispatch/calls/${callId}/involved-vehicles`);
      setInvolvedVehicles(Array.isArray(data) ? data : []);
    } catch { setInvolvedVehicles([]); }
  }, []);

  const fetchCallNarrative = useCallback(async (callId: string | number) => {
    try {
      const data = await apiFetch<{ narrative: string | null }>(`/dispatch/calls/${callId}/narrative`);
      setCallNarrative(data?.narrative ?? '');
    } catch { setCallNarrative(''); }
  }, []);

  const searchBusinesses = useCallback((query: string) => {
    setBusinessQuery(query);
    if (businessSearchTimerRef.current) clearTimeout(businessSearchTimerRef.current);
    if (businessAbortRef.current) businessAbortRef.current.abort();
    if (query.trim().length < 2) { setBusinessSearchResults([]); setShowBusinessDropdown(false); return; }
    businessSearchTimerRef.current = setTimeout(async () => {
      try {
        const controller = new AbortController();
        businessAbortRef.current = controller;
        const results = await apiFetch<any[]>(`/dispatch/business-search?q=${encodeURIComponent(query)}`, { signal: controller.signal });
        setBusinessSearchResults(Array.isArray(results) ? results.slice(0, MAX_SEARCH_RESULTS) : []);
        setShowBusinessDropdown(true);
      } catch (e: any) {
        if (e?.name !== 'AbortError') setBusinessSearchResults([]);
      }
    }, SEARCH_DEBOUNCE_MS);
  }, []);

  const linkBusinessToCall = useCallback(async (callId: string | number, businessId: string | number, role: string) => {
    try {
      await apiFetch(`/dispatch/calls/${callId}/businesses`, {
        method: 'POST', body: JSON.stringify({ business_id: businessId, role }),
      });
      fetchCallBusinesses(callId);
    } catch (err: any) {
      console.error('Link business error:', err);
      addToast(err?.message || 'Failed to link business', 'error');
    }
  }, [fetchCallBusinesses, addToast]);

  const quickAddBusiness = useCallback(async (callId: string | number, name: string, role: string) => {
    try {
      await apiFetch(`/dispatch/calls/${callId}/businesses/quick-add`, {
        method: 'POST', body: JSON.stringify({ name, role }),
      });
      fetchCallBusinesses(callId);
      setBusinessQuery(''); setBusinessSearchResults([]); setShowBusinessDropdown(false);
    } catch (err: any) {
      console.error('Quick-add business error:', err);
      addToast(err?.message || 'Failed to add business', 'error');
    }
  }, [fetchCallBusinesses, addToast]);

  const unlinkBusinessFromCall = useCallback(async (callId: string | number, linkId: string | number) => {
    try {
      await apiFetch(`/dispatch/calls/${callId}/businesses/${linkId}`, { method: 'DELETE' });
      setCallBusinesses(prev => prev.filter(b => b.id !== linkId));
    } catch (err: any) {
      console.error('Unlink business error:', err);
      addToast(err?.message || 'Failed to unlink business', 'error');
      fetchCallBusinesses(callId);
    }
  }, [addToast, fetchCallBusinesses]);

  // Create-from-dispatch: uses the fused /quick-add endpoints so the server
  // runs duplicate detection BEFORE creating a new persons / vehicles_records
  // row. Stops MNI fragmentation from "John Doe DOB:1985" being re-created on
  // every CFS. On 409 DUPLICATE_CANDIDATES the picker modal opens and the
  // dispatcher either links the existing record (merge_into_id) or overrides
  // with force_create:true. Form data is held in state so the resolution
  // re-call sends the same fields the dispatcher originally typed.
  const [personDupState, setPersonDupState] = useState<{ data: PersonFormData; candidates: DuplicateCandidate[] } | null>(null);
  const [vehicleDupState, setVehicleDupState] = useState<{ data: VehicleFormData; candidates: DuplicateCandidate[] } | null>(null);

  const submitPersonQuickAdd = useCallback(async (
    data: PersonFormData,
    opts?: { merge_into_id?: number; force_create?: boolean },
  ) => {
    if (!selectedCall) return;
    setIsCreatingRecord(true);
    try {
      const result = await apiFetch<any>(`/dispatch/calls/${selectedCall.id}/persons/quick-add`, {
        method: 'POST',
        body: JSON.stringify({ ...data, role: linkPersonRole, ...(opts || {}) }),
      });
      const desc = `${data.last_name || ''}, ${data.first_name || ''}`.trim().replace(/^,\s*/, '').replace(/,\s*$/, '') + (data.dob ? ` DOB:${data.dob}` : '');
      setEditData(prev => ({ ...prev, subject_description: desc }));
      setShowCreatePersonModal(false);
      setPersonDupState(null);
      fetchCallPersons(selectedCall.id);
      addToast(result?.created ? 'Person created and linked' : 'Existing person linked', 'success');
    } catch (err: any) {
      if (err?.code === 'DUPLICATE_CANDIDATES' && Array.isArray(err?.payload?.candidates)) {
        setPersonDupState({ data, candidates: err.payload.candidates });
      } else {
        addToast(err?.message || 'Failed to create person', 'error');
      }
    } finally {
      setIsCreatingRecord(false);
    }
  }, [selectedCall, linkPersonRole, addToast, fetchCallPersons]);

  const handleCreatePersonFromDispatch = useCallback(
    (data: PersonFormData) => submitPersonQuickAdd(data),
    [submitPersonQuickAdd],
  );

  const submitVehicleQuickAdd = useCallback(async (
    data: VehicleFormData,
    opts?: { merge_into_id?: number; force_create?: boolean },
  ) => {
    if (!selectedCall) return;
    setIsCreatingRecord(true);
    try {
      const result = await apiFetch<any>(`/dispatch/calls/${selectedCall.id}/vehicles/quick-add`, {
        method: 'POST',
        body: JSON.stringify({ ...data, role: linkVehicleRole, ...(opts || {}) }),
      });
      const desc = [data.color, data.year, data.make, data.model].filter(Boolean).join(' ') + (data.plate_number ? ` PLT:${data.plate_number}` : '') + (data.state ? `/${data.state}` : '');
      setEditData(prev => ({ ...prev, vehicle_description: desc }));
      setShowCreateVehicleModal(false);
      setVehicleDupState(null);
      fetchCallVehicles(selectedCall.id);
      addToast(result?.created ? 'Vehicle created and linked' : 'Existing vehicle linked', 'success');
    } catch (err: any) {
      if (err?.code === 'DUPLICATE_CANDIDATES' && Array.isArray(err?.payload?.candidates)) {
        setVehicleDupState({ data, candidates: err.payload.candidates });
      } else {
        addToast(err?.message || 'Failed to create vehicle', 'error');
      }
    } finally {
      setIsCreatingRecord(false);
    }
  }, [selectedCall, linkVehicleRole, addToast, fetchCallVehicles]);

  const handleCreateVehicleFromDispatch = useCallback(
    (data: VehicleFormData) => submitVehicleQuickAdd(data),
    [submitVehicleQuickAdd],
  );

  // Navigation guard — warn when editing unsaved changes
  useUnsavedChanges(isEditing);

  // ── Refs for unmount auto-save (avoids stale closures in cleanup) ──
  const callDetailRef = useRef<HTMLDivElement>(null);
  const isEditingRef = useRef(isEditing);
  const editDataRef = useRef(editData);
  const selectedCallRef = useRef(selectedCall);
  useEffect(() => { isEditingRef.current = isEditing; }, [isEditing]);
  useEffect(() => { editDataRef.current = editData; }, [editData]);
  useEffect(() => { selectedCallRef.current = selectedCall; }, [selectedCall]);

  // Close context menu on any click
  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    window.addEventListener('click', close);
    return () => window.removeEventListener('click', close);
  }, [contextMenu]);

  // Fetch linked persons/vehicles when a call is selected.
  // `selectedCall?.id` can be the LITERAL STRING "undefined" when the call
  // is hydrated from stale state — it passes `?.id &&` truthiness but blows
  // up server-side as /dispatch/calls/undefined/persons → 500. See prod
  // console 2026-05-27 ~10:10 UTC.
  useEffect(() => {
    const cid = selectedCall?.id;
    if (cid && cid !== ('undefined' as any) && cid !== ('null' as any) && cid !== '') {
      fetchCallPersons(cid);
      fetchCallVehicles(cid);
      fetchCallBusinesses(cid);
      fetchInvolvedPersons(cid);
      fetchInvolvedVehicles(cid);
      fetchCallNarrative(cid);
      // Fetch linked BOLOs for the selected call
      setBolosLoading(true);
      apiFetch<any[]>(`/dispatch/calls/${cid}/bolos`)
        .then((data) => setCallBolos(Array.isArray(data) ? data : []))
        .catch(() => setCallBolos([]))
        .finally(() => setBolosLoading(false));
    } else {
      setCallPersons([]);
      setCallVehicles([]);
      setCallBusinesses([]);
      setInvolvedPersons([]);
      setInvolvedVehicles([]);
      setCallNarrative('');
      setCallBolos([]);
      setShowBoloSearch(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCall?.id, fetchCallPersons, fetchCallVehicles, fetchCallBusinesses, fetchInvolvedPersons, fetchInvolvedVehicles, fetchCallNarrative]);

  // Auto-save unsaved call edits on component unmount (SPA navigation).
  // Shares the body assembly with the click-Save path via buildCallEditBody
  // so PSO / process_service / contract_id / dispatch_code edits don't
  // silently vanish here (previous bug — those fields were missing from
  // the unmount body and only the in-page Save preserved them).
  useEffect(() => {
    return () => {
      if (!isEditingRef.current || !selectedCallRef.current) return;
      const token = localStorage.getItem('rmpg_token');
      const ed = editDataRef.current;
      const body = buildCallEditBody(ed, selectedCallRef.current);
      try {
        fetch(`/api/dispatch/calls/${selectedCallRef.current.id}`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            'X-Requested-With': 'XMLHttpRequest',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify(body),
          keepalive: true,
        });
      } catch { /* best-effort */ }
    };
  }, []);

  const templateDropdownRef = useRef<HTMLDivElement>(null);
  // Unit attach dropdown
  const [showAttachUnitDropdown, setShowAttachUnitDropdown] = useState(false);
  const attachUnitDropdownRef = useRef<HTMLDivElement>(null);
  // Unit-management state + handlers (extracted to keep this component below the
  // 6,000-line ceiling). The hook owns: create/edit/delete-unit modal state and
  // the 5 unit API handlers (save, delete, assign, drag-assign, unassign).
  const {
    showCreateUnitModal, setShowCreateUnitModal,
    editingUnit, setEditingUnit,
    newUnitCallSign, setNewUnitCallSign,
    newUnitOfficerId, setNewUnitOfficerId,
    newUnitStatus, setNewUnitStatus,
    unitCreating,
    deletingUnit, setDeletingUnit,
    unitDeleting,
    openEditUnit,
    handleSaveUnit, handleDisposeUnit,
    handleAssignUnit, handleDragAssignUnit, handleUnassignUnit,
    handleDragUnassignUnit,
  } = useDispatchUnitActions({
    selectedCall, setSelectedCall,
    units, setCalls, setUnits, refreshUnits,
    onAssignSuccess: () => setShowAttachUnitDropdown(false),
  });
  const [officers, setOfficers] = useState<{ id: string; full_name: string; badge_number?: string }[]>([]);
  // Disposition codes from admin config
  const [dispositionCodes, setDispositionCodes] = useState<{code: string; description: string; color?: string}[]>([]);
  // Map engine detection (ensure minimap knows whether to use Mapbox or MapLibre)
  const [mapEngine, setMapEngine] = useState<MapEngine | null>(getResolvedEngine);
  useEffect(() => { detectMapEngine().then(setMapEngine); }, []);
  // Mini-map visibility toggle
  const [showMiniMap, setShowMiniMap] = useState(true);
  // Route info from mini-map (for inline ETA display)
  const [routeInfo, setRouteInfo] = useState<{ unitCallSign: string; callNumber: string; eta: string; distance: string } | null>(null);
  // Per-unit ETA for enroute units (keyed by unitId string)
  const [unitEtas, setUnitEtas] = useState<Record<string, number>>({});
  // Clients list for client selector
  const [clientsList, setClientsList] = useState<{ id: string; name: string; contact_name: string; contact_phone: string; address: string }[]>([]);
  // Properties list for property selector (non-archived)
  const [propertiesList, setPropertiesList] = useState<{ id: string; name: string }[]>([]);

  // ── Unit ETA fetch for enroute units (every 30s) ──────────────────────────
  // Read units through a ref: the effect deliberately doesn't re-run on the
  // units poll (deps below), so a closure over `units` froze the snapshot from
  // when the call was selected — a unit going enroute AFTER selection never
  // matched the filter and its ETA badge never appeared.
  const unitsRefForEta = useRef(units);
  unitsRefForEta.current = units;
  useEffect(() => {
    if (!selectedCall?.id) { setUnitEtas({}); return; }
    const callId = selectedCall.id;
    let cancelled = false;

    const fetchEtas = async () => {
      const enrouteUnits = (selectedCall.assigned_units || []).filter((uid: string) => {
        const u = unitsRefForEta.current.find((u) => String(u.id) === String(uid));
        return u?.status === 'enroute';
      });
      if (!enrouteUnits.length) { if (!cancelled) setUnitEtas({}); return; }
      const etaMap: Record<string, number> = {};
      await Promise.allSettled(
        enrouteUnits.map(async (uid: string) => {
          try {
            const data = await apiFetch<{ eta_seconds?: number; eta_minutes?: number }>(`/dispatch/units/${uid}/eta?call_id=${callId}`);
            const mins = data?.eta_minutes ?? (data?.eta_seconds != null ? Math.ceil(data.eta_seconds / 60) : null);
            if (mins != null && !cancelled) etaMap[String(uid)] = mins;
          } catch { /* best-effort */ }
        }),
      );
      if (!cancelled) setUnitEtas(etaMap);
    };

    void fetchEtas();
    const iv = setInterval(() => { void fetchEtas(); }, 30_000);
    return () => { cancelled = true; clearInterval(iv); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCall?.id, selectedCall?.assigned_units, selectedCall?.status]);

  // Close template dropdown on outside click
  useEffect(() => {
    if (!showTemplateDropdown) return;
    const handler = (e: MouseEvent) => {
      if (templateDropdownRef.current && !templateDropdownRef.current.contains(e.target as Node)) {
        setShowTemplateDropdown(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showTemplateDropdown]);

  // Close attach-unit dropdown on outside click
  useEffect(() => {
    if (!showAttachUnitDropdown) return;
    const handler = (e: MouseEvent) => {
      if (attachUnitDropdownRef.current && !attachUnitDropdownRef.current.contains(e.target as Node)) {
        setShowAttachUnitDropdown(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showAttachUnitDropdown]);

  // Intel-screening hit indicator for the CAD board (GET /dispatch/calls/hits
  // — call IDs with a hit worth a glance: stolen/watchlisted vehicle, a
  // linked person with an active warrant/watchlist entry, or an NSOPW
  // registry match). Fetched independently of the main calls/units load,
  // best-effort — a failure here just means the CAD board shows no hit
  // badges this cycle, it must never break the load.
  const [hitCallIds, setHitCallIds] = useState<Set<string>>(new Set());

  // Fetch calls and units on mount
  const fetchData = useCallback(async (options?: { silent?: boolean; signal?: AbortSignal }) => {
    const controller = options?.signal ? undefined : new AbortController();
    const signal = options?.signal || controller!.signal;
    const timeout = controller ? setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS) : undefined;
    apiFetch<{ call_ids: number[] }>('/dispatch/calls/hits', { signal })
      .then((res) => setHitCallIds(new Set((res?.call_ids || []).map(String))))
      .catch(() => { /* best-effort — badges just don't show this cycle */ });
    try {
      const [callsRes, unitsRes] = await Promise.all([
        apiFetch<any>('/dispatch/calls?limit=200', { signal }),
        apiFetch<any[]>('/dispatch/units', { signal }),
      ]);
      const callsRaw = Array.isArray(callsRes?.data) ? callsRes.data : Array.isArray(callsRes) ? callsRes : [];
      const mappedCalls = callsRaw.map(mapDbCall);
      const mappedUnits = (Array.isArray(unitsRes) ? unitsRes : []).map(mapDbUnit);
      setCalls(mappedCalls);
      setUnits(mappedUnits);
      // Merge list-level fields into selectedCall rather than replacing —
      // the list endpoint omits ext-table fields (PSO, process service,
      // subject details) due to the D1 100-column cap.
      setSelectedCall((prev) => {
        if (!prev) return mappedCalls[0] || null;
        const found = callsRaw.find((r: any) => String(r.id) === prev.id);
        if (found) return mergeCallUpdate(prev, found);
        // Call not in the active list — it may be archived, cleared, or
        // transiently missing. Keep current selection; never auto-substitute
        // a different call which would flash the detail panel and lose the
        // user's context (especially mid-edit or while viewing an archived call).
        return prev;
      });
    } catch (err: any) {
      if (err?.name === 'AbortError') {
        if (!options?.silent) addToast('Dispatch data request timed out — retrying may help', 'error');
        return;
      }
      if (!options?.silent) {
        console.error('Failed to load dispatch data:', err);
        addToast('Failed to load dispatch data — check connection', 'error');
      }
    } finally {
      if (timeout) clearTimeout(timeout);
      if (!options?.silent) setIsLoading(false);
    }
  }, [addToast]);

  // Load archived calls when the Archive tab is activated
  const [archivedCalls, setArchivedCalls] = useState<CallForService[]>([]);
  const [archivedLoaded, setArchivedLoaded] = useState(false);

  const fetchArchivedCalls = useCallback(async () => {
    try {
      const res = await apiFetch<any>('/dispatch/calls?archived=true&limit=500');
      const archivedRaw = Array.isArray(res?.data) ? res.data : Array.isArray(res) ? res : [];
      const mapped = archivedRaw.map(mapDbCall);
      setArchivedCalls(mapped);
      setArchivedLoaded(true);
    } catch (err) {
      console.error('Failed to load archived calls:', err);
      addToast('Failed to load archived calls', 'error');
    }
  }, [addToast]);

  useEffect(() => {
    fetchData();
    // Fetch quick dispatch templates
    apiFetch<any[]>('/admin/call-templates')
      .then((data) => setTemplates((data || []).filter((t: any) => t.is_active !== 0)))
      .catch(() => { /* silent — template dropdown just stays empty */ });
    // Fetch disposition codes from admin config
    apiFetch('/admin/config').then((cfg: any) => {
      const disps = (cfg.dispositions || [])
        .filter((d: any) => d.is_active)
        .map((d: any) => {
          try { return JSON.parse(d.config_value); } catch { return null; }
        })
        .filter(Boolean);
      setDispositionCodes(disps);
    }).catch((err) => { console.warn('[DispatchPage] fetch disposition codes failed:', err); });
    // Fetch clients list for client selector
    apiFetch<any[]>('/admin/clients')
      .then((data) => setClientsList((Array.isArray(data) ? data : []).filter((c: any) => c.status === 'active').map((c: any) => ({ id: String(c.id), name: c.name, contact_name: c.contact_name || '', contact_phone: c.contact_phone || '', address: c.address || '' }))))
      .catch((err) => { console.warn('[DispatchPage] fetch clients list failed:', err); });
    // Fetch properties list (non-archived) for property selector
    apiFetch<any[]>('/records/properties')
      .then((data) => setPropertiesList((Array.isArray(data) ? data : []).map((p: any) => ({ id: String(p.id), name: p.name }))))
      .catch((err) => { console.warn('[DispatchPage] fetch properties list failed:', err); });
  }, [fetchData]);

  // ── Deep-link auto-select: /dispatch?call_id=<id> ──
  // Honors the call_id URL param (used by Dashboard "Calls Near Me" deep-links,
  // among others). Auto-selects the target call once the calls list hydrates,
  // switching to the right filter tab if its status doesn't fit the default
  // 'queue' tab (e.g. an already-cleared call lands the user on the Cleared
  // tab so they actually see the row in the left rail). Falls through to the
  // archived list and triggers its lazy fetch if the call isn't in the
  // active set. Runs at most once per page load (pendingDeepLinkRef gates it),
  // so manually clicking a different call after the auto-select never gets
  // reverted on the next /calls poll.
  const [searchParams, setSearchParams] = useSearchParams();
  // Keep a ref to the current searchParams so the deep-link effect can read
  // it without listing it as a dependency. useSearchParams() returns a NEW
  // URLSearchParams object every render (React Router guarantees only value
  // equality, not referential equality), so including searchParams in the
  // effect dep array caused the effect to re-run on every render — not just
  // when the URL actually changed. The ref avoids that while still letting
  // the effect see the latest URL when it runs.
  const searchParamsRef = useRef(searchParams);
  useEffect(() => { searchParamsRef.current = searchParams; });
  const pendingDeepLinkRef = useRef<string | null>(
    searchParams.get('call_id') || searchParams.get('callId') || null,
  );
  useEffect(() => {
    const targetId = pendingDeepLinkRef.current;
    if (!targetId) return;
    const tryFind = (list: CallForService[]) => list.find((c) => String(c.id) === String(targetId));
    const fromActive = tryFind(calls);
    const stripDeepLink = () => {
      const next = new URLSearchParams(searchParamsRef.current);
      next.delete('call_id'); next.delete('callId');
      setSearchParams(next, { replace: true });
    };
    if (fromActive) {
      setSelectedCall(fromActive);
      // Map status → tab so the call is visible in the left rail.
      const statusToTab: Record<string, FilterTab> = {
        pending: 'pending', dispatched: 'active', enroute: 'active',
        onscene: 'active', active: 'active', hold: 'hold',
        cleared: 'cleared', closed: 'cleared', archived: 'archived',
      };
      const desiredTab = statusToTab[String(fromActive.status)] ?? 'queue';
      setFilterTab(desiredTab);
      pendingDeepLinkRef.current = null;
      // Strip the query so a refresh doesn't re-select after the user
      // navigates away from this call.
      stripDeepLink();
      return;
    }
    // Not in active list — try archived. Trigger its load if it hasn't yet.
    if (!archivedLoaded) {
      fetchArchivedCalls();
      return; // wait for the next effect run
    }
    const fromArchive = tryFind(archivedCalls);
    if (fromArchive) {
      setSelectedCall(fromArchive);
      setFilterTab('archived');
      pendingDeepLinkRef.current = null;
      stripDeepLink();
      return;
    }
    // Both lists hydrated, no match — surface once + give up.
    addToast(`Call ${targetId} not found`, 'warning');
    pendingDeepLinkRef.current = null;
    stripDeepLink();
  }, [calls, archivedCalls, archivedLoaded, fetchArchivedCalls, setFilterTab, setSearchParams, addToast]);

  // Open NewCallModal on mount if ?newCall=1 is present (used by Tools menu, Records, etc.)
  useEffect(() => {
    if (searchParams.get('newCall') === '1') {
      setShowNewCallModal(true);
      const next = new URLSearchParams(searchParams);
      next.delete('newCall');
      setSearchParams(next, { replace: true });
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Live sync — auto-refresh when any device modifies dispatch data (silent to avoid unmounting UI).
  // Each refresh refetches the active call list + units, so on a busy shift a
  // burst of status changes from many units would otherwise fire a full refetch
  // per event over cellular. A 1.5s debounce coalesces those bursts into a single
  // refetch (the acting officer's own UI already updates optimistically; this
  // path only mirrors *other* devices' changes, where ~1s latency is invisible).
  const silentRefresh = useCallback(() => fetchData({ silent: true }), [fetchData]);
  useLiveSync('dispatch', silentRefresh, { debounceMs: 1500 });

  // Near-live unit positions on the status board without a WebSocket push.
  // The dispatch socket (/api/ws) and the bare POST /api/dispatch/gps both run
  // on the LEGACY worker while broadcastAll() is per-isolate, so a push from the
  // rewrite worker can't reach these clients (see project-dispatch-ws memory).
  // But units.latitude/longitude IS freshened by the GPS POST, so a light
  // units-only poll keeps the board's GPS column current. Adaptive on purpose:
  // only fetch when a unit is on duty (position can change) — a parked fleet
  // adds no load and rides the WS/action-driven updates. Mirrors MapPage.
  const refreshUnitsLive = useCallback(async () => {
    try {
      const unitsRes = await apiFetch<any[]>('/dispatch/units');
      setUnits((Array.isArray(unitsRes) ? unitsRes : []).map(mapDbUnit));
    } catch { /* silent — transient poll miss; the next tick retries */ }
  }, []);

  // Skip background polls when the tab is hidden or the device is offline.
  const pollEligible = useCallback(() =>
    (typeof document === 'undefined' || document.visibilityState === 'visible') &&
    (typeof navigator === 'undefined' || navigator.onLine !== false), []);

  useEffect(() => {
    const LIVE_UNIT_POLL_MS = 5000; // aligned with the ~5s client GPS batch interval (useGpsTracking.ts)
    const iv = setInterval(() => {
      if (!pollEligible()) return;
      if (unitsRef.current.some((u) => MOVING_STATUSES.has(u.status))) refreshUnitsLive();
    }, LIVE_UNIT_POLL_MS);
    return () => clearInterval(iv);
  }, [refreshUnitsLive, pollEligible]);

  // Cross-device call/queue sync. The 'dispatch_update' WS net (useLiveSync above)
  // is best-effort only — /api/ws is on the legacy worker but call mutations are
  // served by the rewrite worker, so another dispatcher's new/edited call usually
  // never reaches this client over the socket. Without a periodic refetch the
  // queue would silently drift until a manual reload — unacceptable for a CAD.
  // A 20s silent fetchData() guarantees convergence; it preserves in-progress
  // edits (fetchData's setSelectedCall guards isEditingRef) and is skipped when
  // the tab is hidden/offline.
  useEffect(() => {
    const CROSS_DEVICE_SYNC_MS = 20000;
    const iv = setInterval(() => { if (pollEligible()) silentRefresh(); }, CROSS_DEVICE_SYNC_MS);
    return () => clearInterval(iv);
  }, [silentRefresh, pollEligible]);

  // Call-lifecycle state + handlers (extracted to keep this component below the
  // 6,500-line ceiling). The hook owns: 6 transient state items (delete/disposition/
  // mileage prompts, isGenerating, isBulkArchiving) and the 14 call-mutation
  // handlers (status transitions, hold/resume/revert, clear-with-disposition,
  // archive/unarchive/bulk-archive, delete, priority, LE-notify, gen-incident).
  const {
    deleteCallTarget, setDeleteCallTarget,
    isDeletingCall,
    dispositionPromptCallId, setDispositionPromptCallId,
    isGenerating,
    isBulkArchiving,
    handleStatusChange,
    handleHoldCall, handleResumeCall, handleRevertStatus,
    handleClearWithDisposition, handleConfirmClear,
    handleArchive, handleUnarchive, handleBulkArchive,
    handleDeleteAnyCall,
    handlePriorityChange, handleLeNotify, handleGenerateIncident,
  } = useDispatchCallActions({
    selectedCall, setSelectedCall, setCalls, setArchivedCalls,
    setUnits, refreshUnits, setArchivedLoaded, refetchAll: silentRefresh,
  });

  // Notes + timeline state + handlers (extracted alongside the unit/call
  // hooks). Owns 9 state items (note input + inline-edit, timeline input
  // + inline-edit, broadcast composer) and 8 handlers.
  const {
    newNote, setNewNote,
    editingNoteId, setEditingNoteId,
    editingNoteText, setEditingNoteText,
    newTimelineText, setNewTimelineText,
    showAddTimeline, setShowAddTimeline,
    editingTimelineId, setEditingTimelineId,
    editTimelineText, setEditTimelineText,
    broadcastNoteText, setBroadcastNoteText,
    isBroadcasting,
    handleAddNote, handleEditNote, handleDeleteNote,
    handleQuickNote, handleBroadcastNote,
    handleAddTimeline, handleEditTimeline, handleDeleteTimeline,
  } = useDispatchNotesActions({
    selectedCall, setSelectedCall, calls, setCalls, setActivityEntries,
  });

  // Multi-unit dispatch state + handlers (closest-unit lookup, auto-assign,
  // multi-unit dispatch, call transfer). Cleanest cluster yet — every handler
  // takes callId as an explicit param so the hook signature stays narrow.
  const {
    multiSelectUnits, setMultiSelectUnits,
    handleSuggestClosestUnit,
    handleAutoAssign,
    handleMultiUnitDispatch,
    handleTransferCall,
  } = useDispatchMultiUnitActions({ setCalls, setSelectedCall, setUnits, refreshUnits });

  // ── WebSocket: real-time dispatch updates & panic auto-dispatch ──
  useEffect(() => {
    // Listen for new calls (including panic-auto-created calls)
    const unsubDispatch = subscribe('dispatch_update', (msg: any) => {
      try {
      const data = msg.data || msg;
      if (data.action === 'call_created' && data.call) {
        const mapped = mapDbCall(data.call);
        // Synchronous dedup: if this call was just added from POST response, skip
        if (recentlyCreatedIdsRef.current.has(mapped.id)) {
          recentlyCreatedIdsRef.current.delete(mapped.id);
          // Still handle panic auto-select below, but don't add duplicate
        } else {
          setCalls((prev) => {
            if (prev.some((c) => c.id === mapped.id)) return prev;
            return [mapped, ...prev];
          });
        }
        // Feature 1: Priority-based sound alerts (unless muted)
        if (!soundAlertsMutedRef.current) {
          if (mapped.priority === 'P1') playTone('alarm');
          else if (mapped.priority === 'P2') playTone('warning');
          else playTone('info');
        }
        // Voice alerts: announce new call with details + safety flags
        announceNewCall(mapped);
        announceCallAlerts(mapped);

        // If it's a panic call, auto-select it so the dispatch card opens immediately
        if (data.call.source === 'panic') {
          setSelectedCall(mapped);
          addToast('PANIC — Officer Assist call auto-created', 'error', 10000);
          announcePanicAlert();
        }
      } else if (data.action === 'call_updated' && data.call) {
        const mapped = mapDbCall(data.call);
        const prevCall = callsRef.current.find((c: any) => c.id === mapped.id);
        if (prevCall && prevCall.priority !== mapped.priority) {
          if (PRIORITY_LEVELS.indexOf(mapped.priority) < PRIORITY_LEVELS.indexOf(prevCall.priority)) {
            announceEscalation(mapped.call_number, prevCall.priority, mapped.priority);
          }
        }
        setCalls((prev) => prev.map((c) => (c.id === mapped.id ? mergeCallUpdate(c, data.call) : c)));
        setSelectedCall((prev) => (prev?.id === mapped.id ? mergeCallUpdate(prev, data.call) : prev));
        // Voice alert: announce update if notes were added
        if (data.update_type === 'note_added') {
          // Check for @mentions in the note text
          const noteText = data.note_text || '';
          const mentionMatch = noteText.match(/@(\w+)/);
          if (mentionMatch) {
            announceDirectedNote(mentionMatch[0], mapped.call_number, noteText, data.author);
          } else {
            announceCallUpdate(mapped.call_number, 'New note added', data.author);
          }
        }
      } else if (data.action === 'call_status_changed' && data.call) {
        const mapped = mapDbCall(data.call);
        setCalls((prev) => prev.map((c) => (c.id === mapped.id ? mergeCallUpdate(c, data.call) : c)));
        setSelectedCall((prev) => (prev?.id === mapped.id ? mergeCallUpdate(prev, data.call) : prev));
        // Voice alert: announce dispatch event when call dispatched
        if (mapped.status === 'dispatched') {
          announceDispatchEvent(mapped);
        }
        // Voice alert: announce archival with summary
        if (mapped.status === 'archived') {
          const responseMin = mapped.created_at && mapped.onscene_at
            ? Math.floor((parseTimestamp(mapped.onscene_at).getTime() - parseTimestamp(mapped.created_at).getTime()) / 60000)
            : undefined;
          announceCallArchived(mapped.call_number, mapped.disposition, responseMin);
        }
        // Voice alert: announce status changes (on scene, cleared, etc.)
        if (['onscene', 'enroute', 'cleared'].includes(mapped.status) && mapped.assigned_units?.length > 0) {
          announceStatusChange({
            call_sign: mapped.assigned_units[0],
            call_number: mapped.call_number,
            location: mapped.location,
            disposition: mapped.disposition,
            assigned_units: mapped.assigned_units,
          }, mapped.status);
        }
      } else if (data.action === 'call_deleted') {
        // Server broadcasts this on undo-redispatch (the child call is deleted).
        // mapDbCall stringifies ids, so compare as strings. Drop it from the
        // queue and clear the detail pane if it was open.
        const deletedId = data.call_id ?? data.call?.id;
        if (deletedId != null) {
          setCalls((prev) => prev.filter((c) => String(c.id) !== String(deletedId)));
          setSelectedCall((prev) => (prev && String(prev.id) === String(deletedId) ? null : prev));
        }
      } else if (data.action === 'units_dispatched' || data.action === 'unit_assigned' || data.action === 'unit_unassigned') {
        // Voice alert: announce unit assignment
        if (data.action === 'unit_assigned' && data.unit_call_sign && data.call_number) {
          announceUnitAssignment(data.unit_call_sign, data.call_number);
        }
        // Voice alert: announce multi-unit dispatch (2+ units assigned at once)
        if (data.action === 'units_dispatched' && data.unit_call_signs?.length >= 2 && data.call_number) {
          const unitList = data.unit_call_signs.join(' and ');
          announceCallUpdate(data.call_number, `Multiple units dispatched: ${unitList}`);
        }
        // Refresh the full list to keep unit assignments in sync
        fetchData({ silent: true });
      } else if (data.action === 'ai_analysis' && data.call_id && data.analysis) {
        setAiAnalyses(prev => ({ ...prev, [data.call_id]: data.analysis }));
        setShowAiSidebar(true);
      }
      } catch (err) {
        console.error('[Dispatch] Error processing WS dispatch_update:', err);
        // Fallback: full refresh to recover from malformed data
        fetchData({ silent: true });
      }
    });

    // Listen for unit updates (status changes, GPS position pushes, etc.).
    // The live Worker broadcasts ALL unit events under the 'dispatch_update'
    // channel with an action discriminator — there is no 'unit_update' channel,
    // so this handler was previously dead (the roster never updated live).
    // subscribersRef is a Map<type, Set<handler>>, so this coexists with the
    // call handler above; each ignores the other's actions.
    const unsubUnit = subscribe('dispatch_update', (msg: any) => {
      const data = msg.data || msg;
      if (data.action === 'unit_status_changed' && data.unit) {
        setUnits((prev) => prev.map((u) => (String(u.id) === String(data.unit.id) ? { ...u, ...data.unit, id: String(data.unit.id) } : u)));
      } else if (data.action === 'unit_position_update' && data.unit) {
        // Update unit position from GPS broadcast. (speed_mph is intentionally
        // NOT stored on the unit — no board UI reads it, and the 7s units poll
        // round-trips through mapDbUnit which doesn't carry it, so writing it
        // here only created a field that flickered in and out.)
        setUnits((prev) => prev.map((u) => (String(u.id) === String(data.unit.id)
          ? { ...u, latitude: data.unit.latitude, longitude: data.unit.longitude }
          : u)));
      } else if (data.action === 'unit_updated' && data.unit) {
        setUnits((prev) => prev.map((u) => (String(u.id) === String(data.unit.id) ? { ...u, ...data.unit, id: String(data.unit.id) } : u)));
      } else if (data.action === 'unit_created' && data.unit) {
        setUnits((prev) => {
          if (prev.some((u) => String(u.id) === String(data.unit.id))) return prev;
          return [...prev, mapDbUnit(data.unit)];
        });
      } else if (data.action === 'unit_deleted' && data.unit_id) {
        setUnits((prev) => prev.filter((u) => String(u.id) !== String(data.unit_id)));
      }
    });

    // Live unit GPS glide. gps.ts fans every breadcrumb batch out as a FLAT
    // 'unit_position' frame ({ unit_id, latitude, longitude, ... }) via AlertHubDO
    // — NOT a 'dispatch_update'/'unit_position_update' action (that branch above
    // never fired). Without this, the board's unit lat/lng only refreshed on the
    // ~7s units poll while the map glided live. Mirrors MapPage's handler.
    const unsubPos = subscribe('unit_position', (msg: any) => {
      const data = msg.data || msg;
      const uid = data.unit_id ?? data.unit?.id;
      if (uid == null) return;
      const lat = data.latitude ?? data.lat ?? data.unit?.latitude;
      const lng = data.longitude ?? data.lng ?? data.unit?.longitude;
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
      setUnits((prev) => prev.map((u) => (String(u.id) === String(uid)
        ? { ...u, latitude: lat, longitude: lng }
        : u)));
    });

    // Listen for panic alerts — play alarm tone + voice alert, switch to active tab
    const unsubPanic = subscribe('panic_alert', (msg: any) => {
      const data = msg.data || msg;
      setFilterTab('active');
      announcePanicAlert(data.user_name || data.userName);
    });

    // Listen for serve queue events — update gold serve status panel in real time
    const unsubServeCreated = subscribe('serve:created', (msg: any) => {
      const data = msg.data || msg;
      if (data?.call_id && selectedCallRef.current?.id === data.call_id) {
        setServeLink(data);
      }
      // Voice alert: announce return visit scheduled
      if (data?.call_number && data?.attempt_number && data.attempt_number > 1) {
        announceReturnVisit(data.call_number, data.attempt_number, data.next_window);
      }
    });
    const unsubServeAttempt = subscribe('serve:attempt', (msg: any) => {
      const data = msg.data || msg;
      if (data?.call_id && selectedCallRef.current?.id === data.call_id) {
        // Refresh serve link to get updated attempt count + status
        const callId = selectedCallRef.current!.id;
        apiFetch(`/dispatch/calls/${callId}/serve-link`).then((res: any) => {
          if (res) setServeLink(res);
        }).catch((err: any) => {
          // Audit caught: silent .catch here left serve-queue panel stale
          // after a serve attempt → dispatcher could re-dispatch the same
          // officer to the same call thinking it was still pending.
          addToast(err?.message || 'Serve link out of sync — refresh the call', 'error');
        });
      }
      // Voice alert: announce serve completion
      if (data?.result && data?.served_to && data?.call_number) {
        announceServeComplete(
          data.served_to,
          data.address || '',
          data.document_type || '',
          data.attempt_number || 1,
          data.result,
        );
      }
    });

    // Listen for warrant alerts on linked persons
    const unsubWarrant = subscribe('call:warrant_alert', (msg: any) => {
      const data = msg.data || msg;
      addToast(`⚠️ WARRANT ALERT: ${data.personName} — ${data.warrantCount} active warrant(s) on call`, 'error');
      // Refresh data so warrant badges appear immediately
      fetchData({ silent: true });
    });

    const unsubSpeed = subscribe('speed:alert', (msg: any) => {
      const data = msg.data || msg;
      if (data?.unit && data?.speed_mph) {
        const severity = data.severity === 'critical' ? 'error' : 'warning';
        addToast(`🚨 ${data.label || 'SPEED ALERT'}: Unit ${data.unit} at ${data.speed_mph} mph${data.current_call_number ? ` on ${data.current_call_number}` : ''}`, severity);
        announceSpeedAdvisory(data.unit, data.speed_mph);
      }
    });

    // Geofence entry/exit alert — mirrors the panic_alert handler above.
    const unsubGeofence = subscribe('geofence_alert', (msg: any) => {
      const data = msg.data || msg;
      const verb = data.event_type === 'enter' ? 'entered' : 'exited';
      addToast(`${data.call_sign ?? `Unit ${data.unit_id}`} ${verb} ${data.zone_name ?? 'geofence zone'}`, 'info');
    });

    // Smart automation rule fired — server (Task 5/6) or officer client
    // (POST /api/automation-rules/firings/client) both call emitAlert which
    // fans out here.  Severity mirrors the spec: notify_* → 'warning',
    // trigger_welfare_check / change_unit_status → 'error'.
    const unsubAutomation = subscribe('automation_alert', (msg: any) => {
      const data = msg.data || msg;
      const actionType: string = data.action_type ?? '';
      const source: string = data.source === 'officer' ? 'Officer' : 'System';
      const label = toDisplayLabel(actionType) || actionType;

      const isCritical =
        actionType === 'trigger_welfare_check' ||
        actionType === 'change_unit_status';
      const severity = isCritical ? 'error' : 'warning';

      // Build a compact details string from available context fields.
      const parts: string[] = [];
      if (data.trigger_lat != null && data.trigger_lng != null) {
        parts.push(
          `${Number(data.trigger_lat).toFixed(4)}, ${Number(data.trigger_lng).toFixed(4)}`,
        );
      }
      const ctx = data.context ?? {};
      if (ctx.speed != null) parts.push(`${ctx.speed} mph`);
      if (ctx.call_id != null) parts.push(`Call #${ctx.call_id}`);
      if (ctx.geofence_name) parts.push(ctx.geofence_name);

      const detail = parts.length > 0 ? ` — ${parts.join(' | ')}` : '';
      addToast(`[Auto / ${source}] ${label}${detail}`, severity, 8000);
    });

    // [F5] Serve terminal alerts — fired by serve.ts logAttempt on served/failed.
    const unsubServeTerminal = subscribe('dispatch_update', (msg: any) => {
      const data = msg.data || msg;
      if (data.action === 'serve_failed') {
        const who = data.recipient_name ? ` for ${data.recipient_name}` : '';
        const ref = data.case_number ? ` (${data.case_number})` : '';
        addToast(`Serve failed${who}${ref} — ${data.attempt_count} attempt(s)`, 'warning', 8000);
      } else if (data.action === 'serve_completed') {
        const who = data.recipient_name ? ` — ${data.recipient_name}` : '';
        addToast(`Serve completed${who}`, 'success', 6000);
        // If the linked CFS call is selected, update its status in-place.
        if (data.call_id) {
          setCalls((prev) => prev.map((c) => c.id === data.call_id ? { ...c, status: 'cleared' as const } : c));
          setSelectedCall((prev) => (prev && prev.id === data.call_id) ? ({ ...prev, status: 'cleared' as CallForService['status'] }) : prev);
        }
      } else if (data.action === 'unit_status_changed' && data.officer_id && data.status) {
        // [F3] PSO officer unit status update keyed by officer_id (not unit id).
        setUnits((prev) => prev.map((u) =>
          String(u.officer_id) === String(data.officer_id) ? { ...u, status: data.status } : u
        ));
      }
    });

    return () => { unsubDispatch(); unsubUnit(); unsubPos(); unsubPanic(); unsubServeCreated(); unsubServeAttempt(); unsubWarrant(); unsubSpeed(); unsubGeofence(); unsubAutomation(); unsubServeTerminal(); };
  }, [subscribe, fetchData, addToast, setFilterTab]);

  // On-scene live timer — updates every second when the selected call has onscene_at and is not cleared
  useEffect(() => {
    if (!selectedCall?.onscene_at || TERMINAL_STATUSES.has(selectedCall.status)) {
      setOnSceneElapsed('');
      return;
    }
    const update = () => {
      const diff = Date.now() - parseTimestamp(selectedCall.onscene_at).getTime();
      if (diff < 0) { setOnSceneElapsed(''); return; }
      const totalSec = Math.floor(diff / 1000);
      const h = Math.floor(totalSec / 3600);
      const m = Math.floor((totalSec % 3600) / 60);
      const s = totalSec % 60;
      setOnSceneElapsed(h > 0 ? `${h}h ${m}m ${s}s` : `${m}m ${s}s`);
    };
    update();
    const iv = setInterval(update, 1000);
    return () => clearInterval(iv);
  }, [selectedCall?.id, selectedCall?.onscene_at, selectedCall?.status]);

  // When switching to the archived tab, fetch archived calls if not loaded
  useEffect(() => {
    if (filterTab === 'archived' && !archivedLoaded) {
      fetchArchivedCalls();
    }
  }, [filterTab, archivedLoaded, fetchArchivedCalls]);

  // (Template fetch consolidated into the main init useEffect above — line 296)

  // Fetch all active personnel for unit assignment dropdown (any role)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await apiFetch<any>('/personnel?status=active');
        if (cancelled) return;
        const list = Array.isArray(res) ? res : res?.data ?? [];
        setOfficers(list.map((u: any) => ({
          id: String(u.id),
          full_name: u.full_name || `${u.first_name || ''} ${u.last_name || ''}`.trim() || u.username,
          badge_number: u.badge_number,
        })));
      } catch {
        // Silently ignore — personnel list is optional
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Lazy-fetch audit trail only when the Audit tab opens for this call
  useEffect(() => {
    if (!selectedCall || detailTab !== 'audit') return;
    let cancelled = false;
    setAuditTrailLoading(true);
    apiFetch<any>(`/dispatch/calls/${selectedCall.id}/audit-trail`)
      .then(res => { if (!cancelled) setAuditTrail(Array.isArray(res?.events) ? res.events : []); })
      .catch(() => { if (!cancelled) setAuditTrail([]); })
      .finally(() => { if (!cancelled) setAuditTrailLoading(false); });
    return () => { cancelled = true; };
  }, [selectedCall?.id, detailTab]);

  // Keep the active detail tab scrolled into view — clicking Timeline/Audit
  // is not enough to prove they work if the tab itself can scroll out of
  // sight with no indication it's still there (2026-08-09 report: Audit read
  // as "not loading" because users couldn't find/click it, not because the
  // data was broken).
  useEffect(() => {
    detailTabRefs.current[detailTab]?.scrollIntoView({ behavior: 'smooth', inline: 'nearest', block: 'nearest' });
  }, [detailTab]);

  // Recompute the scroll-affordance arrows whenever the tab bar's scroll
  // position or size changes, so the fade/arrows never lie about whether
  // there's more to scroll to.
  useEffect(() => {
    const el = detailTabBarRef.current;
    if (!el) return;
    const update = () => {
      setCanScrollTabsLeft(el.scrollLeft > 1);
      setCanScrollTabsRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 1);
    };
    update();
    el.addEventListener('scroll', update, { passive: true });
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => { el.removeEventListener('scroll', update); ro.disconnect(); };
  }, [selectedCall?.id]);

  // Fetch linked incidents and activity when a call is selected.
  // Same string-"undefined" guard as the persons/vehicles effect above —
  // see prod console 2026-05-27 ~10:10 UTC for the symptom.
  useEffect(() => {
    const cid = selectedCall?.id;
    const invalid = !selectedCall || !cid || cid === ('undefined' as any) || cid === ('null' as any) || cid === '';
    if (invalid) { setLinkedIncidents([]); setActivityEntries([]); setCallWarnings([]); setServeLink(null); setAuditTrail([]); return; }
    let cancelled = false;
    setIsEditing(false);
    setShowAttachUnitDropdown(false);
    setNewNote('');
    setNewTimelineText('');
    setShowAddTimeline(false);
    setIsDetailLoading(true);
    (async () => {
      try {
        const res = await apiFetch<any>(`/dispatch/calls/${selectedCall.id}`);
        if (cancelled) return;
        // CRITICAL FIX: Merge full call data (PSO/process fields from ext table)
        // into selectedCall. The list endpoint doesn't include these fields due
        // to the D1 100-column cap, so the detail panel was showing "No PSO
        // details entered yet" even when data existed.
        const fullCall = mapDbCall(res);
        setSelectedCall(fullCall);
        const incidents = res?.related_incidents ?? res?.incidents ?? [];
        setLinkedIncidents(Array.isArray(incidents) ? incidents : []);
        const activity = res?.activity ?? [];
        setActivityEntries(Array.isArray(activity) ? activity : []);
      } catch (err: any) {
        // Audit caught (2026-06-21): silent failure here showed the operator
        // the LIST-version of selectedCall (no _ext columns), so PSO fields
        // read "No PSO details entered" even when they existed on disk. The
        // operator could re-enter and double-write. Surface the failure now.
        if (!cancelled) {
          setLinkedIncidents([]);
          // Keep existing activityEntries on a failed re-fetch — a stale log is
          // safer for an officer than a blank one (503/offline wipe caused the
          // "NO ACTIVITY RECORDED" bug after transient network failures).
          addToast(err?.message || 'Could not load full call details — showing partial data', 'error');
        }
      }
      try {
        const warnings = await apiFetch<WarningTag[]>(`/dispatch/calls/${selectedCall.id}/warnings`);
        if (!cancelled) setCallWarnings(Array.isArray(warnings) ? warnings.filter((w: any) => typeof w?.label === 'string') : []);
      } catch { if (!cancelled) setCallWarnings([]); }
      // Fetch AI analysis if not already cached from a WebSocket event
      if (!aiAnalyses[selectedCall.id]) {
        apiFetch<any>('/ai/analyze', {
          method: 'POST',
          body: JSON.stringify({ callId: selectedCall.id }),
        }).then(data => {
          if (!cancelled && data && (data.safetyBriefing || data.suggestedFlags || data.severityOverride)) {
            setAiAnalyses(prev => ({ ...prev, [selectedCall.id]: data }));
          }
        }).catch(() => {});
      }
      // Fetch serve queue link for PSO calls
      if (PROCESS_SERVICE_INCIDENT_TYPES.has(selectedCall.incident_type)) {
        try {
          const serveData = await apiFetch(`/dispatch/calls/${selectedCall.id}/serve-link`);
          if (!cancelled) setServeLink(serveData);
        } catch { if (!cancelled) setServeLink(null); }
        // Fetch serve route data for mini map overlay
        try {
          const routeData = await apiFetch<{ jobs: any[]; routes: any[] }>('/process-server/active-routes');
          if (!cancelled && routeData?.jobs) {
            // Filter to jobs assigned to the same officer as this call
            const callOfficerId = selectedCall.assigned_units?.length ? parseInt(String(selectedCall.assigned_units[0]), 10) : null;
            const officerJobs = callOfficerId ? routeData.jobs.filter((j: any) => j.officer_id === callOfficerId) : routeData.jobs;
            setServeRouteJobs(officerJobs);
            // Get route order
            const route = callOfficerId ? routeData.routes.find((r: any) => r.officer_id === callOfficerId) : routeData.routes[0];
            if (route?.optimized_order_json) {
              try { setServeRouteOrder(JSON.parse(route.optimized_order_json)); } catch { setServeRouteOrder(null); }
            } else {
              setServeRouteOrder(null);
            }
          }
        } catch { if (!cancelled) { setServeRouteJobs([]); setServeRouteOrder(null); } }
      } else {
        if (!cancelled) { setServeLink(null); setServeRouteJobs([]); setServeRouteOrder(null); }
      }
      if (!cancelled) setIsDetailLoading(false);
    })();
    return () => { cancelled = true; };
  }, [selectedCall?.id]);

  // Process-service calls ALWAYS get the PS/## library, regardless of
  // whether admin has configured custom general-disposition codes — the
  // admin-config list (system_config disposition_code rows, e.g. "Report
  // Taken", "GOA") is general-purpose and doesn't apply to a process-server
  // job (per dispositionGroupsForIncident's own contract). Previously the
  // admin list unconditionally won whenever non-empty, which in production
  // (it's populated) meant PSO calls never showed PS/## codes at all.
  // For everything else, prefer the admin-config list when present, else
  // fall back to the built-in general groups. Kept GROUPED (not flatMap'd)
  // so DispositionPrompt can render <optgroup> sections instead of one
  // giant flat list — with 51 PS/## codes across 10 categories, a flat
  // list was unusable.
  const effectiveDispositionCodes = useMemo(() => {
    if (PROCESS_SERVICE_INCIDENT_TYPES.has(selectedCall?.incident_type || '')) {
      return dispositionGroupsForIncident(selectedCall?.incident_type);
    }
    if (dispositionCodes.length > 0) return dispositionCodes;
    return dispositionGroupsForIncident(selectedCall?.incident_type);
  }, [dispositionCodes, selectedCall?.incident_type]);

  // Populate serveRouteSortMap when the serve tab is active so filtered
  // calls sort by optimized route order instead of falling through to
  // priority-then-time.
  useEffect(() => {
    if (filterTab !== 'serve') return;
    let cancelled = false;
    apiFetch<{ jobs: any[]; routes: any[] }>('/process-server/active-routes')
      .then(data => {
        if (cancelled || !data?.jobs) return;
        const map: Record<string, number> = {};
        data.jobs.forEach((j: any) => {
          if (j.call_id != null && j.sort_order != null) {
            map[String(j.call_id)] = j.sort_order;
          }
        });
        setServeRouteSortMap(map);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [filterTab, calls.length]);

  // Filter calls (defined before keyboard shortcuts so it's available)
  // Active calls (non-archived) are in `calls`, archived calls are in `archivedCalls`
  // Effective queue sort mode (server pref → local fallback → default). Hoisted
  // to component scope so both the sort memo and the render (GEO dividers) share it.
  const sortMode = userPrefs?.dispatch_sort || localSort || 'priority';

  const filteredCalls = useMemo(() => (filterTab === 'archived' ? archivedCalls : calls).filter((call) => {
    switch (filterTab) {
      case 'queue': return !COMPLETED_STATUSES.has(call.status);
      case 'pending': return call.status === 'pending';
      case 'active': return ACTIVE_FIELD_STATUSES.has(call.status);
      case 'hold': return call.status === 'on_hold';
      case 'serve': return PROCESS_SERVICE_INCIDENT_TYPES.has(call.incident_type);
      case 'cleared': return COMPLETED_STATUSES.has(call.status);
      case 'archived': return true;
      default: return true;
    }
  }).filter((call) => callMatchesSearch(call, searchQuery)).filter((call) => {
    if (priorityFilter && call.priority !== priorityFilter) return false;
    return true;
  }).filter((call) => {
    if (typeFilter && call.incident_type !== typeFilter) return false;
    return true;
  }).filter((call) => {
    if (signalFilter === 'signaled' && !knownSignalCodes.has(call.incident_type)) return false;
    if (signalFilter === 'unsignaled' && knownSignalCodes.has(call.incident_type)) return false;
    return true;
  }).filter((call) => {
    // Quick filter bar — client-side status/priority chips
    if (quickFilter === 'all') return true;
    if (quickFilter === 'P1') return call.priority === 'P1';
    if (quickFilter === 'P2') return call.priority === 'P2';
    if (quickFilter === 'pending') return call.status === 'pending';
    if (quickFilter === 'dispatched') return call.status === 'dispatched';
    if (quickFilter === 'onscene') return call.status === 'onscene';
    if (quickFilter === 'mybeat') return !!(user as any)?.beat_id && String(call.beat_id ?? '') === String((user as any).beat_id);
    return true;
  }).sort((a, b) => {
    // Archive tab: sort by call number ascending (001, 002, 003...)
    if (filterTab === 'archived') {
      return (a.call_number || '').localeCompare(b.call_number || '', undefined, { numeric: true });
    }
    // Serve tab: sort by route order (sort_order from serve_queue)
    if (filterTab === 'serve') {
      const aOrder = serveRouteSortMap[a.id] ?? 9999;
      const bOrder = serveRouteSortMap[b.id] ?? 9999;
      if (aOrder !== bOrder) return aOrder - bOrder;
      // Fallback: priority then time for unordered serve calls
      const pDiff = (PRIORITY_ORDER[a.priority] ?? 3) - (PRIORITY_ORDER[b.priority] ?? 3);
      if (pDiff !== 0) return pDiff;
      return parseTimestamp(b.created_at).getTime() - parseTimestamp(a.created_at).getTime();
    }
    // Pinned calls float to the top regardless of sort mode
    const aPin = a.pinned ? 1 : 0;
    const bPin = b.pinned ? 1 : 0;
    if (aPin !== bPin) return bPin - aPin;
    // User-selectable sort for active tabs
    if (sortMode === 'time') {
      return parseTimestamp(b.created_at).getTime() - parseTimestamp(a.created_at).getTime();
    }
    if (sortMode === 'status') {
      const sDiff = (STATUS_SORT_ORDER[a.status] ?? 5) - (STATUS_SORT_ORDER[b.status] ?? 5);
      if (sDiff !== 0) return sDiff;
      return parseTimestamp(b.created_at).getTime() - parseTimestamp(a.created_at).getTime();
    }
    if (sortMode === 'geo') {
      // Group the queue by district: section → zone → beat (natural/numeric
      // order), so a dispatcher can work calls geographically. Calls with no
      // geography sink to the bottom; priority then breaks ties within a beat.
      const geoKey = (c: typeof a) => [c.sector_name || '￿', c.zone_id || '￿', c.beat_id || '￿'].join('|');
      const gDiff = geoKey(a).localeCompare(geoKey(b), undefined, { numeric: true });
      if (gDiff !== 0) return gDiff;
      const pDiffGeo = (PRIORITY_ORDER[a.priority] ?? 3) - (PRIORITY_ORDER[b.priority] ?? 3);
      if (pDiffGeo !== 0) return pDiffGeo;
      return parseTimestamp(b.created_at).getTime() - parseTimestamp(a.created_at).getTime();
    }
    // Default: priority then newest first
    const pDiff = (PRIORITY_ORDER[a.priority] ?? 3) - (PRIORITY_ORDER[b.priority] ?? 3);
    if (pDiff !== 0) return pDiff;
    return parseTimestamp(b.created_at).getTime() - parseTimestamp(a.created_at).getTime();
  }), [calls, archivedCalls, filterTab, searchQuery, priorityFilter, typeFilter, signalFilter, knownSignalCodes, userPrefs?.dispatch_sort, localSort, serveRouteSortMap, quickFilter, (user as any)?.beat_id]);

  // The "Search calls" box lives in the shared toolbar above both the CAD
  // board and the classic list, but was only ever wired into filteredCalls
  // (the classic-list pipeline) — typing into it did nothing while the CAD
  // board was showing. Same callMatchesSearch predicate as filteredCalls
  // above, minus the tab/priority/type/signal/sort stages the CAD board
  // doesn't expose.
  const cadBoardCalls = useMemo(
    () => calls.filter((call) => callMatchesSearch(call, searchQuery)),
    [calls, searchQuery],
  );

  // Shortcut cheat-sheet overlay (toggled with "?").
  const [showShortcutHelp, setShowShortcutHelp] = useState(false);

  // Keyboard shortcuts for dispatch power users — Spillman Flex F-key style
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't trigger shortcuts when typing in inputs
      const target = e.target as HTMLElement;
      const isInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT';

      // ── F-KEY HOTKEYS (always active, even in inputs) ─────
      // These mirror Spillman Flex keyboard shortcuts
      if (e.key === 'F2') {
        e.preventDefault();
        setShowNewCallModal(true);
        return;
      }
      if (e.key === 'F3' && selectedCall && selectedCall.status === 'pending') {
        e.preventDefault();
        handleStatusChangeRef.current(selectedCall.id, 'dispatched');
        return;
      }
      if (e.key === 'F4' && selectedCall) {
        e.preventDefault();
        // Toggle edit mode on selected call. Must go through the proper
        // start/cancel handlers — the previous `setIsEditing(prev => !prev)`
        // bypassed the fresh refetch + editData hydration, so F4 entering
        // edit mode on a fresh selection showed empty form fields.
        if (isEditingRef.current) {
          cancelEditingRef.current();
        } else {
          startEditingRef.current();
        }
        return;
      }
      if (e.key === 'F5') {
        e.preventDefault();
        if (selectedCall && selectedCall.status === 'dispatched') {
          handleStatusChangeRef.current(selectedCall.id, 'enroute');
        } else {
          fetchData(); // Refresh if no enroute action available
        }
        return;
      }
      if (e.key === 'F6' && selectedCall && selectedCall.status === 'enroute') {
        e.preventDefault();
        handleStatusChangeRef.current(selectedCall.id, 'onscene');
        return;
      }
      if (e.key === 'F7' && selectedCall && ACTIVE_FIELD_STATUSES.has(selectedCall.status)) {
        e.preventDefault();
        handleClearWithDispositionRef.current(selectedCall.id);
        return;
      }
      // Shift+C is handled below the input guard — see comment near `if (isInput) return`.
      // Putting it here would fire on capital C in a note/narrative textarea.
      if (e.key === 'F8') {
        e.preventDefault();
        // Focus CAD command line
        const cadInput = document.querySelector('[data-cad-input]') as HTMLInputElement;
        if (cadInput) cadInput.focus();
        return;
      }
      if (e.key === 'F9' && selectedCall && ACTIONABLE_STATUSES.has(selectedCall.status)) {
        e.preventDefault();
        handleHoldCallRef.current(selectedCall.id);
        return;
      }
      if (e.key === 'F10') {
        e.preventDefault();
        setShowQuickPsoModal(true);
        return;
      }
      if (e.key === 'F12') {
        e.preventDefault();
        // Toggle NCIC panel
        setShowNcicPanel(prev => !prev);
        return;
      }

      // Don't process letter keys when typing in inputs
      if (isInput) return;

      // ? — toggle the keyboard-shortcut cheat sheet.
      if (e.key === '?') {
        e.preventDefault();
        setShowShortcutHelp((prev) => !prev);
        return;
      }

      // Shift+C — quick clear on selected call (mirrors F7, faster muscle
      // memory). MUST sit below the input guard above; otherwise typing a
      // capital C in a note/narrative textarea pops the disposition modal.
      if (e.shiftKey && (e.key === 'C' || e.key === 'c') && selectedCall && ACTIVE_FIELD_STATUSES.has(selectedCall.status)) {
        e.preventDefault();
        handleClearWithDispositionRef.current(selectedCall.id);
        return;
      }

      // N - New call
      if (e.key === 'n' || e.key === 'N') {
        e.preventDefault();
        setShowNewCallModal(true);
        return;
      }

      // P - Quick PSO Client Request
      if (e.key === 'p' || e.key === 'P') {
        e.preventDefault();
        setShowQuickPsoModal(true);
        return;
      }

      // R - Refresh
      if (e.key === 'r' || e.key === 'R') {
        e.preventDefault();
        fetchData();
        return;
      }

      // 1-7: Filter tabs (standard LE lifecycle order)
      if (e.key === '1') { setFilterTab('queue'); return; }
      if (e.key === '2') { setFilterTab('pending'); return; }
      if (e.key === '3') { setFilterTab('active'); return; }
      if (e.key === '4') { setFilterTab('hold'); return; }
      if (e.key === '5') { setFilterTab('serve'); return; }
      if (e.key === '6') { setFilterTab('cleared'); return; }
      if (e.key === '7') { setFilterTab('archived'); return; }

      // Arrow keys: navigate call list
      if (e.key === 'ArrowDown' || e.key === 'j') {
        e.preventDefault();
        const currentIndex = filteredCalls.findIndex(c => c.id === selectedCall?.id);
        const nextIndex = Math.min(currentIndex + 1, filteredCalls.length - 1);
        if (filteredCalls[nextIndex]) setSelectedCall(filteredCalls[nextIndex]);
        return;
      }
      if (e.key === 'ArrowUp' || e.key === 'k') {
        e.preventDefault();
        const currentIndex = filteredCalls.findIndex(c => c.id === selectedCall?.id);
        const prevIndex = Math.max(currentIndex - 1, 0);
        if (filteredCalls[prevIndex]) setSelectedCall(filteredCalls[prevIndex]);
        return;
      }

      // D - Dispatch selected call
      if ((e.key === 'd' || e.key === 'D') && selectedCall && selectedCall.status === 'pending') {
        e.preventDefault();
        handleStatusChangeRef.current(selectedCall.id, 'dispatched');
        return;
      }

      // E - Enroute
      if ((e.key === 'e' || e.key === 'E') && selectedCall && selectedCall.status === 'dispatched') {
        e.preventDefault();
        handleStatusChangeRef.current(selectedCall.id, 'enroute');
        return;
      }

      // O - On scene
      if ((e.key === 'o' || e.key === 'O') && selectedCall && selectedCall.status === 'enroute') {
        e.preventDefault();
        handleStatusChangeRef.current(selectedCall.id, 'onscene');
        return;
      }

      // C - Clear call (opens disposition prompt)
      if ((e.key === 'c' || e.key === 'C') && selectedCall && ACTIVE_FIELD_STATUSES.has(selectedCall.status)) {
        e.preventDefault();
        handleClearWithDispositionRef.current(selectedCall.id);
        return;
      }

      // H - Hold call
      if ((e.key === 'h' || e.key === 'H') && selectedCall && ACTIONABLE_STATUSES.has(selectedCall.status)) {
        e.preventDefault();
        handleHoldCallRef.current(selectedCall.id);
        return;
      }

      // Escape - close any open modal / panel / inline prompt.
      // Keep this list in sync with new modals — UX-inconsistent if some
      // modals close on Esc and others don't.
      if (e.key === 'Escape') {
        setShowNewCallModal(false);
        setShowQuickPsoModal(false);
        setShowNcicPanel(false);
        setShowHandoffNotes(false);
        setShowCreateUnitModal(false);
        setQuickTemplateData(null);
        setDispositionPromptCallId(null);
        setShowShortcutHelp(false);
        return;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCall, filteredCalls, fetchData, setFilterTab]);

  const handlePsoExpandToFullForm = (data: Record<string, any>) => {
    setShowQuickPsoModal(false);
    setTemplateInitialData({
      ...data,
      incident_type: data.incident_type || 'pso_client_request',
    });
    setShowNewCallModal(true);
  };

  // Feature: Quick unit status change from unit board — PATCH /api/dispatch/units/:id/status
  const handleQuickUnitStatus = useCallback(async (unitId: string, newStatus: string) => {
    try {
      await apiFetch(`/dispatch/units/${unitId}/status`, {
        method: 'PUT',
        body: JSON.stringify({ status: newStatus }),
      });
      setUnits((prev) =>
        prev.map((u) => (String(u.id) === String(unitId) ? { ...u, status: newStatus as any } : u)),
      );
      addToast('Saved', 'success');
    } catch (err: any) {
      addToast(err?.message || 'Failed to update unit status', 'error');
    }
  }, [setUnits, addToast]);

  const handleNewCall = async (callData: Partial<CallForService> & Record<string, any>) => {
    setIsSaving(true);
    try {
      const body = {
        incident_type: callData.incident_type || 'other',
        priority: callData.priority || 'P3',
        caller_name: callData.caller_name || null,
        caller_phone: callData.caller_phone || null,
        caller_relationship: callData.caller_relationship || null,
        caller_address: callData.caller_address || null,
        location_address: callData.location || '',
        latitude: callData.latitude ?? null,
        longitude: callData.longitude ?? null,
        property_id: callData.property_id ?? null,
        client_id: callData.client_id ?? null,
        description: callData.description || '',
        source: callData.source || 'phone',
        cross_street: callData.cross_street || null,
        location_building: callData.location_building || null,
        location_floor: callData.location_floor || null,
        location_room: callData.location_room || null,
        zone_beat: callData.zone_beat || null,
        sector_id: callData.sector_id ?? null,
        zone_id: callData.zone_id ?? null,
        beat_id: callData.beat_id ?? null,
        weapons_involved: callData.weapons_involved || null,
        injuries_reported: callData.injuries_reported ?? false,
        num_subjects: callData.num_subjects ?? null,
        num_victims: callData.num_victims ?? null,
        subject_description: callData.subject_description || null,
        vehicle_description: callData.vehicle_description || null,
        direction_of_travel: callData.direction_of_travel || null,
        scene_safety: callData.scene_safety || null,
        weather_conditions: callData.weather_conditions || null,
        lighting_conditions: callData.lighting_conditions || null,
        alcohol_involved: callData.alcohol_involved ?? false,
        drugs_involved: callData.drugs_involved ?? false,
        domestic_violence: callData.domestic_violence ?? false,
        supervisor_notified: callData.supervisor_notified ?? false,
        le_notified: callData.le_notified ?? false,
        le_agency: callData.le_agency || null,
        le_case_number: callData.le_case_number || null,
        damage_estimate: callData.damage_estimate ?? null,
        damage_description: callData.damage_description || null,
        responding_officer: callData.responding_officer || null,
        action_taken: callData.action_taken || null,
        // Extended operational flags — previously silent-dropped from new-call POST (audit 2026-04-10)
        mental_health_crisis: callData.mental_health_crisis ?? false,
        juvenile_involved: callData.juvenile_involved ?? false,
        felony_in_progress: callData.felony_in_progress ?? false,
        officer_safety_caution: callData.officer_safety_caution ?? false,
        k9_requested: callData.k9_requested ?? false,
        ems_requested: callData.ems_requested ?? false,
        fire_requested: callData.fire_requested ?? false,
        hazmat: callData.hazmat ?? false,
        gang_related: callData.gang_related ?? false,
        evidence_collected: callData.evidence_collected ?? false,
        body_camera_active: callData.body_camera_active ?? false,
        photos_taken: callData.photos_taken ?? false,
        trespass_issued: callData.trespass_issued ?? false,
        vehicle_pursuit: callData.vehicle_pursuit ?? false,
        foot_pursuit: callData.foot_pursuit ?? false,
        // PSO Client Request fields
        contract_id: callData.contract_id || null,
        pso_service_type: callData.pso_service_type || null,
        pso_authorization: callData.pso_authorization || null,
        pso_requestor_name: callData.pso_requestor_name || null,
        pso_requestor_phone: callData.pso_requestor_phone || null,
        pso_requestor_email: callData.pso_requestor_email || null,
        pso_billing_code: callData.pso_billing_code || null,
        // Process Service sub-fields
        process_service_type: callData.process_service_type || null,
        process_served_to: callData.process_served_to || null,
        process_served_address: callData.process_served_address || null,
        // Historical entry fields (passed through from NewCallModal)
        ...(callData.created_at ? { created_at: callData.created_at } : {}),
        ...(callData.status && callData.status !== 'pending' ? { status: callData.status } : {}),
        ...(callData.disposition ? { disposition: callData.disposition } : {}),
        ...(callData.dispatched_at ? { dispatched_at: callData.dispatched_at } : {}),
        ...(callData.enroute_at ? { enroute_at: callData.enroute_at } : {}),
        ...(callData.onscene_at ? { onscene_at: callData.onscene_at } : {}),
        ...(callData.cleared_at ? { cleared_at: callData.cleared_at } : {}),
        ...(callData.closed_at ? { closed_at: callData.closed_at } : {}),
      };
      const result = await apiFetch<any>('/dispatch/calls', { method: 'POST', body: JSON.stringify(body) });
      // Surface duplicate warning if backend detected a nearby active call
      if (result?.duplicate_warning) {
        setDuplicateWarning({
          message: result.duplicate_warning.message || 'Similar call already active nearby.',
          callNumber: result.duplicate_warning.call_number,
          callId: result.duplicate_warning.call_id ? String(result.duplicate_warning.call_id) : undefined,
        });
      }
      const newCall = mapDbCall(result);
      // Mark as recently-created so WebSocket handler skips the duplicate
      rememberRecentId(newCall.id);
      setTimeout(() => recentlyCreatedIdsRef.current.delete(newCall.id), DEDUP_CLEANUP_MS);
      setCalls((prev) => [newCall, ...prev]);
      setSelectedCall(newCall);
      setShowNewCallModal(false);
      setTemplateInitialData(undefined);
      addToast(`Call ${newCall.call_number} created`, 'success');
      // Audible feedback for local action
      announceLocalAction('call_created', `Call ${newCall.call_number} created.`);
      // Fire-and-forget: save narrative + inline persons/vehicles from modal
      if ((callData as any).narrative?.trim()) {
        apiFetch(`/dispatch/calls/${result.id}/narrative`, {
          method: 'PATCH', body: JSON.stringify({ narrative: (callData as any).narrative }),
        }).catch(() => {});
      }
      for (const p of ((callData as any).involvedPersons ?? []) as any[]) {
        apiFetch(`/dispatch/calls/${result.id}/involved-persons`, {
          method: 'POST', body: JSON.stringify(p),
        }).catch(() => {});
      }
      for (const v of ((callData as any).involvedVehicles ?? []) as any[]) {
        apiFetch(`/dispatch/calls/${result.id}/involved-vehicles`, {
          method: 'POST', body: JSON.stringify(v),
        }).catch(() => {});
      }
    } catch (err: any) {
      console.error('Failed to create call:', err);
      addToast(err?.message || 'Failed to create call', 'error');
      throw err; // Re-throw so NewCallModal knows submission failed
    } finally {
      setIsSaving(false);
    }
  };

  // ── Admin timeline edit handler ──
  const handleTimelineEdit = useCallback(async (field: string, value: string | null) => {
    if (!selectedCall || !isAdminOrManager) return;
    const callId = selectedCall.id;
    try {
      const result = await apiFetch<any>(`/dispatch/calls/${callId}`, {
        method: 'PUT',
        body: JSON.stringify({ [field]: value }),
      });
      // DEFENSIVE: only adopt the server response if it's actually a full
      // call row. Some backends return an error/"no changes" body for a
      // single-field PUT (e.g. the legacy worker rejects timeline-timestamp
      // edits with {error:'No fields to update'}); blindly running
      // mapDbCall() on that produced a blank 'Other' call that wiped the
      // real one from the UI ("editing time destructs the call"). When the
      // response isn't a full row, patch just the edited field locally —
      // the DB write already succeeded (or the catch below fires).
      const looksLikeFullRow = result && typeof result === 'object' && 'id' in result;
      const apply = (c: typeof selectedCall) =>
        looksLikeFullRow ? mergeCallUpdate(c!, result) : ({ ...c, [field]: value || null } as typeof c);
      setCalls(prev => prev.map(c => (c.id === callId ? apply(c) : c)));
      setArchivedCalls(prev => prev.map(c => (c.id === callId ? apply(c) : c)));
      setSelectedCall(prev => (prev && prev.id === callId ? apply(prev) : prev));
      addToast(`Timeline updated: ${toDisplayLabel(field.replace(/_at$/, ''))}`, 'success');
    } catch (err) {
      console.error('Failed to update timeline:', err);
      const msg = err instanceof Error ? err.message : 'Failed to update timeline';
      addToast(`Timeline update failed: ${msg}`, 'error');
    }
    setEditingTimestamp(null);
  }, [selectedCall, isAdminOrManager, addToast]);

  // ── Inline Editing ────────────────────────────────────────
  // Refetch the full call fresh from /dispatch/calls/:id before populating
  // the edit form. Guards against stale in-memory data from list-endpoint
  // caching / older client bundles that silently dropped fields. The fetched
  // row also replaces selectedCall so the non-edit view re-renders correctly.
  // Build the PUT body from the in-progress editData + the call we started
  // editing against. Used by BOTH the click-Save path AND the unmount
  // auto-save path — without this helper the two used to drift (PSO,
  // process_service, contract_id, and dispatch_code edits silently
  // vanished on unmount because the auto-save body forgot them).
  //
  // `selectedFor*` is what the user opened the editor against — needed
  // for the "did the user change location?" → clear lat/lng heuristic.
  // Pass `selectedCall` from saveEditing and `selectedCallRef.current`
  // from the unmount cleanup.

  const startEditing = async () => {
    if (!selectedCall) return;
    let source: any = selectedCall;
    try {
      const fresh = await apiFetch<any>(`/dispatch/calls/${selectedCall.id}`);
      if (fresh && (fresh.id != null || fresh.call_number)) {
        const mapped = mapDbCall(fresh);
        setSelectedCall(mapped);
        setCalls((prev) => prev.map((c) => (c.id === mapped.id ? mapped : c)));
        source = mapped;
      }
    } catch (err) {
      console.warn('[DispatchPage] Failed to refetch call before edit; using cached copy', err);
    }
    const selectedCallForEdit: any = source;
    setEditData({
      incident_type: selectedCallForEdit.incident_type,
      priority: selectedCallForEdit.priority,
      client_id: selectedCallForEdit.client_id || '',
      caller_name: selectedCallForEdit.caller_name || '',
      caller_phone: selectedCallForEdit.caller_phone || '',
      caller_relationship: selectedCallForEdit.caller_relationship || '',
      caller_address: selectedCallForEdit.caller_address || '',
      location: selectedCallForEdit.location || '',
      latitude: selectedCallForEdit.latitude ?? null,
      longitude: selectedCallForEdit.longitude ?? null,
      property_id: selectedCallForEdit.property_id ?? null,
      description: selectedCallForEdit.description || '',
      source: selectedCallForEdit.source || 'phone',
      disposition: selectedCallForEdit.disposition || '',
      cross_street: selectedCallForEdit.cross_street || '',
      location_building: selectedCallForEdit.location_building || '',
      location_floor: selectedCallForEdit.location_floor || '',
      location_room: selectedCallForEdit.location_room || '',
      zone_beat: selectedCallForEdit.zone_beat || '',
      sector_id: selectedCallForEdit.sector_id || '',
      zone_id: selectedCallForEdit.zone_id || '',
      beat_id: selectedCallForEdit.beat_id || '',
      weapons_involved: selectedCallForEdit.weapons_involved || '',
      injuries_reported: !!selectedCallForEdit.injuries_reported,
      num_subjects: selectedCallForEdit.num_subjects || '',
      num_victims: selectedCallForEdit.num_victims || '',
      subject_description: selectedCallForEdit.subject_description || '',
      vehicle_description: selectedCallForEdit.vehicle_description || '',
      direction_of_travel: selectedCallForEdit.direction_of_travel || '',
      scene_safety: selectedCallForEdit.scene_safety || '',
      weather_conditions: selectedCallForEdit.weather_conditions || '',
      lighting_conditions: selectedCallForEdit.lighting_conditions || '',
      alcohol_involved: !!selectedCallForEdit.alcohol_involved,
      drugs_involved: !!selectedCallForEdit.drugs_involved,
      domestic_violence: !!selectedCallForEdit.domestic_violence,
      supervisor_notified: !!selectedCallForEdit.supervisor_notified,
      le_notified: !!selectedCallForEdit.le_notified,
      le_agency: selectedCallForEdit.le_agency || '',
      le_case_number: selectedCallForEdit.le_case_number || '',
      damage_estimate: selectedCallForEdit.damage_estimate ?? '',
      damage_description: selectedCallForEdit.damage_description || '',
      action_taken: selectedCallForEdit.action_taken || '',
      responding_officer: selectedCallForEdit.responding_officer || '',
      starting_mileage: selectedCallForEdit.starting_mileage || '',
      ending_mileage: selectedCallForEdit.ending_mileage || '',
      dispatch_code: selectedCallForEdit.dispatch_code || '',
      pso_requestor_name: selectedCallForEdit.pso_requestor_name || '',
      pso_requestor_phone: selectedCallForEdit.pso_requestor_phone || '',
      pso_requestor_email: selectedCallForEdit.pso_requestor_email || '',
      pso_service_type: selectedCallForEdit.pso_service_type || '',
      pso_billing_code: selectedCallForEdit.pso_billing_code || '',
      pso_authorization: selectedCallForEdit.pso_authorization || '',
      contract_id: selectedCallForEdit.contract_id || '',
      // Process Service fields
      process_service_type: selectedCallForEdit.process_service_type || '',
      process_served_to: selectedCallForEdit.process_served_to || '',
      process_served_address: selectedCallForEdit.process_served_address || '',
      process_attempts: selectedCallForEdit.process_attempts ?? 0,
      process_served_at: selectedCallForEdit.process_served_at || '',
      process_service_result: selectedCallForEdit.process_service_result || '',
      court_name: selectedCallForEdit.court_name || '',
      case_number: selectedCallForEdit.case_number || '',
    });
    setIsEditing(true);
  };

  const cancelEditing = () => {
    setIsEditing(false);
    setEditData({});
  };

  const saveEditing = async () => {
    if (!selectedCall) return;
    setIsSaving(true);
    try {
      const body = buildCallEditBody(editData, selectedCall);
      const result = await apiFetch<any>(`/dispatch/calls/${selectedCall.id}`, {
        method: 'PUT',
        body: JSON.stringify(body),
      });
      const updatedCall = mergeCallUpdate(selectedCall, result);
      setCalls((prev) => prev.map((c) => c.id === selectedCall.id ? updatedCall : c));
      setSelectedCall(updatedCall);
      setIsEditing(false);
      addToast(`Call ${updatedCall.call_number} saved`, 'success');
    } catch (err: any) {
      console.error('Failed to save edits:', err);
      addToast(err?.message || 'Failed to save changes', 'error');
    } finally {
      setIsSaving(false);
    }
  };

  const updateEditField = useCallback((field: string, value: any) => {
    setEditData((prev) => ({ ...prev, [field]: value }));
  }, []);

  const handleClientChange = useCallback(async (clientId: string) => {
    updateEditField('client_id', clientId);
    if (!clientId) return;
    const selectedId = clientId; // capture to detect a newer selection
    try {
      const full = await apiFetch<ClientRecord>(`/clients/${clientId}`);
      setEditData((prev) => {
        // A newer client was selected while this fetch was in flight — discard.
        if (prev.client_id !== selectedId) return prev;
        return applyFillBlanks(prev, autofillFromClient(full));
      });
    } catch (err) {
      console.error('Client autofill failed (non-fatal):', err);
    }
  }, [updateEditField]);

  // ═══════════════════════════════════════════════════════════════
  // NEW DISPATCH FEATURES
  // ═══════════════════════════════════════════════════════════════

  // Feature 4: Unit availability counter
  const unitAvailability = useMemo(() => {
    const available = units.filter(u => u.status === 'available').length;
    const total = units.filter(u => u.status !== 'off_duty').length;
    const enroute = units.filter(u => u.status === 'enroute' || u.status === 'dispatched').length;
    const onscene = units.filter(u => u.status === 'onscene').length;
    const oos = units.filter(u => u.status === 'out_of_service' || u.status === 'busy').length;
    return { available, total, enroute, onscene, oos };
  }, [units]);

  // Feature 5: Stacked calls count by address
  const stackedCallCounts = useMemo(() => {
    const counts = new Map<string, number>();
    calls.filter(c => OPEN_STATUSES.has(c.status)).forEach(c => {
      if (c.location) {
        const loc = c.location.toLowerCase().trim();
        counts.set(loc, (counts.get(loc) || 0) + 1);
      }
    });
    return counts;
  }, [calls]);

  // Active-call load per district (section), busiest first — situational
  // awareness of where the workload is concentrated. Keyed by the Spillman
  // section code (from the composite zone_id) with sector_name fallback.
  const districtLoad = useMemo(() => {
    const counts = new Map<string, number>();
    calls.filter(c => OPEN_STATUSES.has(c.status)).forEach(c => {
      const key = sectionPrefix(c.zone_id) || c.sector_name || '';
      if (key) counts.set(key, (counts.get(key) || 0) + 1);
    });
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [calls]);

  // Other active calls at the SAME address as the selected call — surfaces the
  // stack the queue card already counts, so a dispatcher seeing one call knows
  // about the others at that location (officer-safety + dedupe).
  const stackedCallsForSelected = useMemo(() => {
    if (!selectedCall?.location) return [];
    const loc = selectedCall.location.toLowerCase().trim();
    return calls.filter(c =>
      c.id !== selectedCall.id &&
      OPEN_STATUSES.has(c.status) &&
      (c.location || '').toLowerCase().trim() === loc
    );
  }, [calls, selectedCall?.id, selectedCall?.location]);

  // Toggle pinned-to-top flag on a call
  const handleTogglePin = useCallback(async (callId: string, currentlyPinned: boolean) => {
    const next = !currentlyPinned;
    // Optimistic local update
    setCalls(prev => prev.map(c => c.id === callId ? ({ ...c, pinned: next ? 1 : 0 }) : c));
    try {
      await apiFetch(`/dispatch/calls/${callId}/pin`, {
        method: 'PATCH',
        body: JSON.stringify({ pinned: next }),
      });
      addToast(next ? 'Call pinned to top' : 'Call unpinned', 'success');
    } catch {
      // Revert on failure
      setCalls(prev => prev.map(c => c.id === callId ? ({ ...c, pinned: currentlyPinned ? 1 : 0 }) : c));
      addToast('Failed to toggle pin', 'error');
    }
  }, [addToast]);

  // Feature 9: Call type statistics
  const callTypeStats = useMemo(() => {
    const active = calls.filter(c => OPEN_STATUSES.has(c.status));
    const typeCounts = new Map<string, number>();
    active.forEach(c => {
      const type = c.incident_type || 'other';
      typeCounts.set(type, (typeCounts.get(type) || 0) + 1);
    });
    return [...typeCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([type, count]) => ({ type, count }));
  }, [calls]);

  // Feature 13: Unit workload — count active calls per unit
  const unitWorkload = useMemo(() => {
    const workload = new Map<string, number>();
    calls.filter(c => ACTIVE_FIELD_STATUSES.has(c.status)).forEach(c => {
      (c.assigned_units || []).forEach(uid => {
        workload.set(String(uid), (workload.get(String(uid)) || 0) + 1);
      });
    });
    return workload;
  }, [calls]);

  // Feature 14: Disposition statistics for current shift
  const [dispositionStats, setDispositionStats] = useState<{disposition: string; count: number}[]>([]);
  useEffect(() => {
    apiFetch<any[]>('/dispatch/disposition-stats')
      .then(data => setDispositionStats(Array.isArray(data) ? data : []))
      .catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [calls.filter(c => c.disposition).length]); // Re-fetch when dispositions change

  // Feature 17: Auto-archive cleared calls after 5 minutes
  const handleArchiveRef = useRef(handleArchive);
  useEffect(() => { handleArchiveRef.current = handleArchive; }, [handleArchive]);

  // ── Refs for keydown-called handlers ───────────────────────────
  // The F-key / letter shortcut effect (line ~1192) binds once-ish and
  // captures handler references via closure. Without refs, the captured
  // function is whatever existed at last bind — a stale `handleStatusChange`
  // can fire against an out-of-date `selectedCall.id` if React batches a
  // call-swap concurrent with a keystroke. Routing through refs that we
  // update every render guarantees the shortcut always invokes the latest
  // closure with fresh selectedCall in scope. Same pattern as
  // handleArchiveRef above.
  const handleStatusChangeRef = useRef(handleStatusChange);
  useEffect(() => { handleStatusChangeRef.current = handleStatusChange; }, [handleStatusChange]);
  const handleClearWithDispositionRef = useRef(handleClearWithDisposition);
  useEffect(() => { handleClearWithDispositionRef.current = handleClearWithDisposition; }, [handleClearWithDisposition]);
  const handleHoldCallRef = useRef(handleHoldCall);
  useEffect(() => { handleHoldCallRef.current = handleHoldCall; }, [handleHoldCall]);
  const startEditingRef = useRef(startEditing);
  useEffect(() => { startEditingRef.current = startEditing; }, [startEditing]);
  const cancelEditingRef = useRef(cancelEditing);
  useEffect(() => { cancelEditingRef.current = cancelEditing; }, [cancelEditing]);

  // ── Dispatch alarm interval — check overdue calls every 5s ──
  const alarmPlayedRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const check = () => {
      const activeCalls = calls.filter(c => isActiveStatus(c.status));
      for (const c of activeCalls) {
        const state = getTimerState(c);
        if (state.isOverdue && !alarmPlayedRef.current.has(c.id)) {
          alarmPlayedRef.current.add(c.id);
          playTone('alarm');
          break; // One alarm at a time
        }
      }
      // Clean up resolved overdue flags
      const activeIds = new Set(activeCalls.map(c => c.id));
      for (const id of alarmPlayedRef.current) {
        if (!activeIds.has(id)) alarmPlayedRef.current.delete(id);
      }
    };
    check();
    const interval = setInterval(check, ALARM_CHECK_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [calls]);


  const tabCounts = useMemo(() => {
    const pending = calls.filter((c) => c.status === 'pending').length;
    const active = calls.filter((c) => ACTIVE_FIELD_STATUSES.has(c.status)).length;
    const hold = calls.filter((c) => c.status === 'on_hold').length;
    const cleared = calls.filter((c) => COMPLETED_STATUSES.has(c.status)).length;
    // Queue tab = everything still open (mirrors the filteredCalls 'queue'
    // predicate at line ~1243). This definition was dropped in a prior
    // squash-merge, leaving `queue` undefined and breaking client typecheck.
    const queue = calls.filter((c) => !COMPLETED_STATUSES.has(c.status)).length;
    return {
      queue,
      pending,
      active,
      hold,
      cleared,
      archived: archivedCalls.length,
      serve: calls.filter((c) => PROCESS_SERVICE_INCIDENT_TYPES.has(c.incident_type)).length,
    };
  }, [calls, archivedCalls]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full" style={{ background: 'var(--surface-base)' }}>
        <div className="flex flex-col items-center gap-4">
          <div className="relative w-10 h-10 flex items-center justify-center">
            <Loader2 className="w-8 h-8 text-[var(--spm-text-muted)] animate-spin" />
            <div className="absolute inset-0 rounded-sm" style={{ boxShadow: '0 0 16px 3px rgb(var(--brand-gold-rgb) / 0.25)' }} />
          </div>
          <div className="flex flex-col items-center gap-1">
            <span className="text-[10px] font-mono uppercase tracking-[0.15em] text-[var(--spm-text-muted)] animate-pulse">Loading Dispatch Console</span>
            <span className="text-[8px] font-mono text-[var(--spm-text-muted)]">Connecting to dispatch services...</span>
          </div>
        </div>
      </div>
    );
  }

  // ================================================================
  // MOBILE LAYOUT — Card list + slide-in detail view
  // ================================================================
  if (isMobile) {
    return (
      <div className="flex flex-col h-full relative">
        {/* Filter pill tabs — min 44px touch targets */}
        <div className="mobile-pill-tabs" style={{ gap: 6, padding: '8px 12px' }}>
          {FILTER_TAB_CONFIG.map((tab) => ({ ...tab, count: tabCounts[tab.id as keyof typeof tabCounts] ?? 0 })).map((tab) => (
            <button type="button"
              key={tab.id}
              onClick={() => setFilterTab(tab.id as FilterTab)}
              className={`mobile-pill-tab ${filterTab === tab.id ? 'active' : ''}`}
              style={{ minHeight: 44, padding: '8px 14px', fontSize: 13 }}
            >
              {tab.label}
              {tab.count > 0 && (
                <span style={{ opacity: 0.7, marginLeft: 4 }}>({tab.count})</span>
              )}
            </button>
          ))}
        </div>

        {/* Card list */}
        <MobileCardList<CallForService>
          items={filteredCalls}
          keyExtractor={(call) => call.id}
          searchable
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          searchPlaceholder="Search calls…"
          emptyMessage="No calls in this category"
          loading={isLoading}
          onItemTap={(call) => setSelectedCall(call)}
          renderCard={(call) => (
            <div
              className={`mobile-card priority-${call.priority} ${selectedCall?.id === call.id ? 'selected' : ''}`}
              style={{ minHeight: 56 }}
            >
              {/* Header row */}
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  {call.priority === 'P1' && (
                    <AlertTriangle className="w-4 h-4 text-red-500 animate-emergency-blink" />
                  )}
                  <span className="text-base font-bold text-green-400 font-mono tabular-nums">{call.call_number}</span>
                </div>
                <div className="flex items-center gap-2">
                  <StatusBadge status={call.priority} type="priority" size="sm" />
                  <StatusBadge status={call.status} type="call_status" size="sm" />
                </div>
              </div>
              {/* Type */}
              <div className="text-sm font-medium text-brand-400 mb-1.5">
                {formatIncidentType(call.incident_type)}
              </div>
              {/* Location */}
              <div className="flex items-center gap-2 text-sm text-rmpg-300 mb-2">
                <MapPin className="w-4 h-4 flex-shrink-0" />
                <span className="min-w-0 truncate">{call.location || 'Unknown'}</span>
              </div>
              {/* Footer */}
              <div className="flex items-center justify-between text-sm text-rmpg-400">
                <div className="flex items-center gap-1.5 font-mono tabular-nums">
                  <Clock className="w-3.5 h-3.5" />
                  <span>{formatElapsed(call.created_at)}</span>
                </div>
                {call.assigned_units.length > 0 && (
                  <span className="font-mono tabular-nums">{call.assigned_units.length} unit{call.assigned_units.length !== 1 ? 's' : ''}</span>
                )}
              </div>
            </div>
          )}
        />

        {/* Mobile Detail View — slides in from right when call selected */}
        <MobileDetailView
          open={!!selectedCall}
          onClose={() => setSelectedCall(null)}
          title={selectedCall?.call_number || 'Call Detail'}
          subtitle={selectedCall ? formatIncidentType(selectedCall.incident_type) : undefined}
          actions={selectedCall ? [
            { label: 'View on Map', icon: MapPin, onClick: () => { if (selectedCall.latitude) navigate(`/map?lat=${selectedCall.latitude}&lng=${selectedCall.longitude}`); } },
          ] : undefined}
        >
          {selectedCall && (
            <div className="p-3 space-y-4">
              {/* Status & Priority */}
              <div className="flex items-center gap-2 flex-wrap">
                <StatusBadge status={selectedCall.priority} type="priority" title={humanizePriority(selectedCall.priority)} />
                <StatusBadge status={selectedCall.status} type="call_status" title={getStatusTooltip(selectedCall.status, 'call')} />
                {callWarnings.length > 0 && (
                  <span className="flex items-center gap-1 px-2 py-1 text-[10px] font-bold font-mono text-red-400 bg-red-900/30 border border-red-700/50 animate-pulse">
                    <AlertTriangle style={{ width: 10, height: 10 }} /> {callWarnings.length} ALERT{callWarnings.length !== 1 ? 'S' : ''}
                  </span>
                )}
              </div>

              {/* Call Duration + Response Time — mobile */}
              <div className="flex items-center gap-3 text-[10px] font-mono tabular-nums">
                <div className="flex items-center gap-1">
                  <Clock style={{ width: 10, height: 10 }} className="text-rmpg-500" />
                  <span className="text-rmpg-400">Duration:</span>
                  <span className="text-rmpg-200 font-bold">
                    {formatCallDuration(computeCallDuration(selectedCall))}
                  </span>
                </div>
                {(() => { const rt = computeResponseTime(selectedCall); return rt == null ? null : (
                  <div className="flex items-center gap-1">
                    <span className="text-rmpg-400">Response:</span>
                    <span className="text-rmpg-400 font-bold">{formatCallDuration(rt)}</span>
                  </div>
                ); })()}
                {(() => { const ost = computeOnSceneTime(selectedCall); return ost == null ? null : (
                  <div className="flex items-center gap-1">
                    <span className="text-rmpg-400">On-Scene:</span>
                    <span className="text-rmpg-400 font-bold">{formatCallDuration(ost)}</span>
                  </div>
                ); })()}
              </div>

              {/* Safety Flag Badges — mobile */}
              {(() => {
                const flags: Array<{ label: string; color: string }> = [];
                if (selectedCall.weapons_involved && selectedCall.weapons_involved !== 'None') flags.push({ label: 'ARMED', color: 'var(--sev-critical-soft)' });
                if (selectedCall.domestic_violence) flags.push({ label: 'DV', color: 'var(--sev-caution)' });
                if (selectedCall.mental_health_crisis) flags.push({ label: 'MH', color: 'var(--sev-special-soft)' });
                if (selectedCall.officer_safety_caution) flags.push({ label: 'SAFETY', color: 'var(--sev-critical)' });
                if (selectedCall.vehicle_pursuit || selectedCall.foot_pursuit) flags.push({ label: 'PURSUIT', color: 'var(--sev-high)' });
                if (flags.length === 0) return null;
                return (
                  <div className="flex flex-wrap gap-1">
                    {flags.map(f => (
                      <span key={f.label} className="text-[9px] font-bold font-mono px-1.5 py-0.5" style={{ color: f.color, background: 'rgb(var(--sev-critical-rgb) / 0.1)', border: '1px solid rgb(var(--sev-critical-rgb) / 0.25)' }}>
                        {f.label}
                      </span>
                    ))}
                  </div>
                );
              })()}

              {/* Mobile Status Action Buttons — large touch targets for gloved use */}
              <div className="flex flex-wrap gap-2" style={{ willChange: 'transform' }}>
                {selectedCall.status === 'pending' && (
                  <>
                    <button type="button"
                      onClick={() => handleStatusChange(selectedCall.id, 'dispatched')}
                      className="flex items-center justify-center gap-2 px-4 py-3 text-xs font-bold text-rmpg-100 rounded-sm"
                      style={{ ...MOBILE_ACTION_BTN_STYLE, background: 'var(--spm-text-muted)', border: '1px solid var(--spm-text-muted)' }}
                    >
                      <Send style={{ width: 16, height: 16 }} /> Dispatch
                    </button>
                    <button type="button"
                      onClick={() => handleStatusChange(selectedCall.id, 'cancelled')}
                      className="flex items-center justify-center gap-2 px-4 py-3 text-xs font-bold rounded-sm"
                      style={{ ...MOBILE_ACTION_BTN_STYLE, background: 'color-mix(in srgb, var(--sev-critical) 13%, transparent)', border: '1px solid color-mix(in srgb, var(--sev-critical) 31%, transparent)', color: 'var(--sev-critical)' }}
                    >
                      <XCircle style={{ width: 16, height: 16 }} /> Cancel
                    </button>
                  </>
                )}
                {selectedCall.status === 'dispatched' && (
                  <button type="button"
                    onClick={() => handleStatusChange(selectedCall.id, 'enroute')}
                    className="flex items-center justify-center gap-2 px-4 py-3 text-xs font-bold text-rmpg-100 rounded-sm"
                    style={{ ...MOBILE_ACTION_BTN_STYLE, background: 'var(--spm-text-muted)', border: '1px solid var(--spm-text-muted)' }}
                  >
                    <Navigation style={{ width: 16, height: 16 }} /> En Route
                  </button>
                )}
                {selectedCall.status === 'enroute' && (
                  <button type="button"
                    onClick={() => handleStatusChange(selectedCall.id, 'onscene')}
                    className="flex items-center justify-center gap-2 px-4 py-3 text-xs font-bold text-rmpg-100 rounded-sm"
                    style={{ ...MOBILE_ACTION_BTN_STYLE, background: 'var(--spm-text-muted)', border: '1px solid var(--spm-text-muted)' }}
                  >
                    <Eye style={{ width: 16, height: 16 }} /> On Scene
                  </button>
                )}
                {ACTIVE_FIELD_STATUSES.has(selectedCall.status) && (
                  <>
                    <button type="button"
                      onClick={() => handleClearWithDisposition(selectedCall.id)}
                      className="flex items-center justify-center gap-2 px-4 py-3 text-xs font-bold rounded-sm"
                      style={{ ...MOBILE_ACTION_BTN_STYLE, background: 'color-mix(in srgb, var(--sev-ok) 13%, transparent)', border: '1px solid color-mix(in srgb, var(--sev-ok) 31%, transparent)', color: 'var(--sev-ok)' }}
                    >
                      <CheckCircle style={{ width: 16, height: 16 }} /> Clear
                    </button>
                    <button type="button"
                      onClick={() => handleHoldCall(selectedCall.id)}
                      className="flex items-center justify-center gap-2 px-4 py-3 text-xs font-bold rounded-sm"
                      style={{ ...MOBILE_ACTION_BTN_STYLE, background: 'color-mix(in srgb, var(--sev-warn) 13%, transparent)', border: '1px solid color-mix(in srgb, var(--sev-warn) 31%, transparent)', color: 'var(--sev-warn)' }}
                    >
                      ⏸ Hold
                    </button>
                    <button type="button"
                      onClick={() => handleStatusChange(selectedCall.id, 'cancelled')}
                      className="flex items-center justify-center gap-2 px-4 py-3 text-xs font-bold rounded-sm"
                      style={{ ...MOBILE_ACTION_BTN_STYLE, background: 'color-mix(in srgb, var(--sev-critical) 13%, transparent)', border: '1px solid color-mix(in srgb, var(--sev-critical) 31%, transparent)', color: 'var(--sev-critical)' }}
                    >
                      <XCircle style={{ width: 16, height: 16 }} /> Cancel
                    </button>
                  </>
                )}
                {selectedCall.status === 'on_hold' && (
                  <button type="button"
                    onClick={() => handleResumeCall(selectedCall.id)}
                    className="flex items-center justify-center gap-2 px-4 py-3 text-xs font-bold rounded-sm"
                    style={{ ...MOBILE_ACTION_BTN_STYLE, background: 'var(--sev-warn)', color: 'var(--surface-base)' }}
                  >
                    ▶ Resume
                  </button>
                )}
                {selectedCall.status === 'cleared' && (
                  <>
                    <button type="button"
                      onClick={() => handleStatusChange(selectedCall.id, 'closed')}
                      className="flex items-center justify-center gap-2 px-4 py-3 text-xs font-bold rounded-sm"
                      style={{ ...MOBILE_ACTION_BTN_STYLE, background: 'var(--spm-border)', border: '1px solid var(--spm-text-muted)', color: 'var(--spm-text)' }}
                    >
                      Close
                    </button>
                    <button type="button"
                      onClick={handleGenerateIncident}
                      disabled={isGenerating}
                      className="flex items-center justify-center gap-2 px-4 py-3 text-xs font-bold text-rmpg-100 rounded-sm"
                      style={{ ...MOBILE_ACTION_BTN_STYLE, background: 'var(--spm-text-muted)', border: '1px solid var(--spm-text-muted)' }}
                    >
                      {isGenerating ? <Loader2 style={{ width: 16, height: 16 }} className="animate-spin" /> : <FileText style={{ width: 16, height: 16 }} />}
                      Report
                    </button>
                  </>
                )}
                {selectedCall.status === 'closed' && (
                  <button type="button"
                    onClick={handleGenerateIncident}
                    disabled={isGenerating}
                    className="flex items-center justify-center gap-2 px-4 py-3 text-xs font-bold text-rmpg-100 rounded-sm"
                    style={{ ...MOBILE_ACTION_BTN_STYLE, background: 'var(--spm-text-muted)', border: '1px solid var(--spm-text-muted)' }}
                  >
                    {isGenerating ? <Loader2 style={{ width: 16, height: 16 }} className="animate-spin" /> : <FileText style={{ width: 16, height: 16 }} />}
                    Report
                  </button>
                )}
                {POST_DISPATCH_STATUSES.has(selectedCall.status) && (
                  <button type="button"
                    onClick={() => handleRevertStatus(selectedCall.id)}
                    className="flex items-center justify-center gap-2 px-4 py-3 text-xs font-bold rounded-sm"
                    style={{ ...MOBILE_ACTION_BTN_STYLE, background: 'color-mix(in srgb, var(--sev-warn) 13%, transparent)', border: '1px solid color-mix(in srgb, var(--sev-warn) 31%, transparent)', color: 'var(--sev-warn)' }}
                  >
                    <Undo2 style={{ width: 16, height: 16 }} /> Back
                  </button>
                )}
                {selectedCall.status !== 'archived' && (
                  <button type="button"
                    onClick={() => handleArchive(selectedCall.id)}
                    className="flex items-center justify-center gap-2 px-4 py-3 text-xs font-bold rounded-sm"
                    style={{ ...MOBILE_ACTION_BTN_STYLE, background: 'color-mix(in srgb, var(--spm-border) 13%, transparent)', border: '1px solid color-mix(in srgb, var(--spm-text-muted) 31%, transparent)', color: 'var(--spm-text-muted)' }}
                  >
                    <Archive style={{ width: 16, height: 16 }} /> Archive
                  </button>
                )}
                {selectedCall.status === 'archived' && (
                  <button type="button"
                    onClick={() => handleUnarchive(selectedCall.id)}
                    className="flex items-center justify-center gap-2 px-4 py-3 text-xs font-bold rounded-sm"
                    style={{ ...MOBILE_ACTION_BTN_STYLE, background: 'color-mix(in srgb, var(--spm-border) 13%, transparent)', border: '1px solid color-mix(in srgb, var(--spm-text-muted) 31%, transparent)', color: 'var(--spm-text-muted)' }}
                  >
                    <RotateCcw style={{ width: 16, height: 16 }} /> Restore
                  </button>
                )}
              </div>

              {/* Disposition prompt — appears when Clear is tapped */}
              {dispositionPromptCallId === selectedCall.id && (
                <div className="px-2">
                  <DispositionPrompt
                    callNumber={selectedCall.call_number}
                    dispositionCodes={effectiveDispositionCodes}
                    onConfirm={handleConfirmClear}
                    onCancel={() => setDispositionPromptCallId(null)}
                  />
                </div>
              )}

              {/* Key info fields */}
              <div className="space-y-2">
                <div className="panel-inset p-3">
                  <div className="field-label mb-1 flex items-center justify-between">
                    <span>Location</span>
                    {selectedCall.location && (
                      <button
                        type="button"
                        title="Copy address"
                        aria-label="Copy address"
                        onClick={(e) => { e.stopPropagation(); navigator.clipboard?.writeText(selectedCall.location || ''); addToast('Address copied', 'success'); }}
                        className="text-rmpg-500 hover:text-[color:var(--field-label-color)] transition-colors"
                      >
                        <Copy className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                  <div className="text-sm text-rmpg-200">{selectedCall.location || 'Not specified'}</div>
                  {selectedCall.cross_street && (
                    <div className="text-xs text-rmpg-400 mt-0.5">Near: {selectedCall.cross_street}</div>
                  )}
                  <div className="mt-1"><ZsbBadge zoneId={selectedCall.zone_id} beatId={selectedCall.beat_id} dispatchCode={selectedCall.dispatch_code} sectionCode={getSectionCode(selectedCall.sector_id ?? '')} /></div>
                  {/* Other active calls at this same address — click to jump. */}
                  {stackedCallsForSelected.length > 0 && (
                    <div className="mt-2 pt-2 border-t border-rmpg-700/30">
                      <div className="flex items-center gap-1 text-[9px] font-bold uppercase tracking-wide text-amber-400 mb-1">
                        <Layers className="w-3 h-3" />
                        {stackedCallsForSelected.length} other call{stackedCallsForSelected.length !== 1 ? 's' : ''} at this location
                      </div>
                      <div className="flex flex-wrap gap-1">
                        {stackedCallsForSelected.map(c => (
                          <button
                            key={c.id}
                            type="button"
                            onClick={(e) => { e.stopPropagation(); setSelectedCall(c); }}
                            title={`${formatIncidentType(c.incident_type)} — ${humanizeStatus(c.status, 'call')}`}
                            className="flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-mono border border-rmpg-700/50 hover:border-amber-600/60 hover:bg-amber-900/20 transition-colors"
                          >
                            <span className="font-bold text-green-400">{c.call_number}</span>
                            <StatusBadge status={c.priority} type="priority" size="sm" />
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                {selectedCall.caller_name && (
                  <div className="panel-inset p-3">
                    <div className="field-label mb-1">Caller</div>
                    <div className="text-sm text-rmpg-200">{selectedCall.caller_name}</div>
                    {selectedCall.caller_phone && (
                      <div className="text-xs text-rmpg-400 mt-0.5">{formatPhoneDisplay(selectedCall.caller_phone)}</div>
                    )}
                  </div>
                )}

                {selectedCall.description && (
                  <div className="panel-inset p-3">
                    <div className="field-label mb-1">Description</div>
                    <div className="text-sm text-rmpg-200 whitespace-pre-wrap">{selectedCall.description}</div>
                  </div>
                )}

                {/* Premise intel — joined from the linked property. hazard_notes
                    renders as a red officer-safety banner; post_orders/gate_code
                    as standard premise instructions. Only shown when present, so
                    non-property calls don't get an empty block. */}
                {(selectedCall.hazard_notes || selectedCall.post_orders || selectedCall.gate_code) && (
                  <div className="panel-inset p-3 space-y-2">
                    <div className="field-label mb-1">Premise / Officer Safety</div>
                    {selectedCall.hazard_notes && (
                      <div className="flex items-start gap-1.5 px-2 py-1.5 rounded-sm border border-red-700/50 bg-red-950/30">
                        <AlertTriangle className="w-3.5 h-3.5 text-red-400 flex-shrink-0 mt-0.5" />
                        <div>
                          <div className="text-[9px] font-bold uppercase text-red-400 tracking-wide">Hazard</div>
                          <div className="text-xs text-red-200 whitespace-pre-wrap">{selectedCall.hazard_notes}</div>
                        </div>
                      </div>
                    )}
                    {selectedCall.post_orders && (
                      <div>
                        <div className="text-[9px] font-bold uppercase text-rmpg-400 tracking-wide mb-0.5">Post Orders</div>
                        <div className="text-xs text-rmpg-200 whitespace-pre-wrap">{selectedCall.post_orders}</div>
                      </div>
                    )}
                    {selectedCall.gate_code && (
                      <div className="text-xs text-rmpg-300">
                        <span className="text-rmpg-500">Gate code:</span> <span className="font-mono text-brand-400">{selectedCall.gate_code}</span>
                      </div>
                    )}
                  </div>
                )}

                {/* Timestamps — editable by admin/manager */}
                <div className="panel-inset p-3">
                  <div className="flex items-center justify-between mb-2">
                    <div className="field-label">Timeline</div>
                    {isAdminOrManager && <span className="text-[8px] text-rmpg-500 font-mono">CLICK TO EDIT</span>}
                  </div>
                  <div className="space-y-1.5 text-xs">
                    {TIMELINE_FIELDS.map(tf => ({ ...tf, value: (selectedCall as any)[tf.field] as string | undefined })).filter(ts => ts.field === 'created_at' || ts.value || isAdminOrManager).map(ts => (
                      <div key={ts.field} className="flex justify-between items-center group">
                        <span className="text-rmpg-400 flex items-center gap-1.5">
                          <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: ts.color, boxShadow: ts.value ? `0 0 4px ${withAlpha(ts.color, '80')}` : 'none' }} />
                          {ts.label}
                        </span>
                        {editingTimestamp === ts.field ? (
                          <div className="flex items-center gap-1">
                            <input
                              type="datetime-local"
                              step="1"
                              className="input-dark text-[10px] font-mono px-1 py-0.5 w-[175px]"
                              defaultValue={toDatetimeLocalValue(ts.value)}
                              autoFocus
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') handleTimelineEdit(ts.field, mtDatetimeLocalToUtc((e.target as HTMLInputElement).value));
                                if (e.key === 'Escape') setEditingTimestamp(null);
                              }}
                              onBlur={(e) => {
                                if (e.target.value) handleTimelineEdit(ts.field, mtDatetimeLocalToUtc(e.target.value));
                                else setEditingTimestamp(null);
                              }}
                            />
                            {ts.value && ts.field !== 'created_at' && (
                              <button type="button" onClick={() => handleTimelineEdit(ts.field, null)} className="text-red-400 hover:text-red-300 p-0.5 sm:p-0.5 min-w-[44px] min-h-[44px] sm:min-w-0 sm:min-h-0 flex items-center justify-center" title="Clear timestamp" aria-label="Clear timestamp">
                                <X className="w-3 h-3" />
                              </button>
                            )}
                          </div>
                        ) : (
                          <span className="flex items-center gap-1.5">
                            <span
                              className={`font-mono text-rmpg-200 tabular-nums ${isAdminOrManager ? 'cursor-pointer hover:text-[var(--brand-gold)] group-hover:underline transition-colors' : ''}`}
                              onClick={() => isAdminOrManager && setEditingTimestamp(ts.field)}
                              title={isAdminOrManager ? 'Click to edit timestamp' : undefined}
                            >
                              {ts.value ? formatTime(ts.value) : <span className="text-rmpg-600 italic">—</span>}
                            </span>
                            {/* Elapsed since the previous populated stage — the response
                                breakdown (Created→Dispatched→Enroute→On Scene→…). */}
                            {ts.value && (() => {
                              const chain = TIMESTAMP_PREV_CHAIN[ts.field];
                              const prevField = chain?.find(f => (selectedCall as any)[f]);
                              if (!prevField) return null;
                              const d = parseTimestamp(ts.value).getTime() - parseTimestamp((selectedCall as any)[prevField]).getTime();
                              if (!isFinite(d) || d <= 0) return null;
                              const m = Math.floor(d / 60000);
                              const s = Math.floor((d % 60000) / 1000);
                              return <span className="text-rmpg-500 font-mono text-[9px] tabular-nums" title={`+${m}m ${s}s since ${toDisplayLabel(prevField.replace(/_at$/, ''))}`}>(+{m > 0 ? `${m}m ` : ''}{s}s)</span>;
                            })()}
                          </span>
                        )}
                      </div>
                    ))}
                    {/* Enhancement 26: Response time (dispatched → onscene) */}
                    {(() => { const rt = computeResponseTime(selectedCall); return rt == null ? null : (
                      <div className="flex justify-between items-center mt-1 pt-1 border-t border-rmpg-700/30">
                        <span className="text-rmpg-400 text-[10px]">Response Time</span>
                        <span className="text-rmpg-400 font-mono font-bold text-[10px]">{formatResponseTimeShort(rt)}</span>
                      </div>
                    ); })()}
                  </div>
                </div>

                {/* Assigned Units */}
                {(selectedCall.assigned_units || []).length > 0 && (
                  <div className="panel-inset p-3">
                    <div className="field-label mb-2">Assigned Units</div>
                    <div className="flex flex-wrap gap-1.5">
                      {(selectedCall.assigned_units || []).map((unitIdStr) => {
                        const unitObj = units.find((u) => String(u.id) === String(unitIdStr));
                        return (
                          <span
                            key={unitIdStr}
                            className="px-2 py-1 text-xs font-mono font-bold text-green-400 bg-green-900/20 border border-green-700/40"
                          >
                            {unitObj?.call_sign || unitIdStr}
                          </span>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Notes + Add Note */}
                <div className="panel-inset p-3">
                  <div className="field-label mb-2">Notes</div>
                  {Array.isArray(selectedCall.notes) && selectedCall.notes.length > 0 && (
                    <div className="space-y-2 mb-3">
                      {selectedCall.notes.map((note) => (
                        <div key={note.id} className="text-xs">
                          <div className="flex items-center gap-2 text-rmpg-400">
                            <span className="font-bold">{note.author || 'System'}</span>
                            <span className="font-mono">{formatTime(note.timestamp)}</span>
                          </div>
                          <div className="text-rmpg-200 mt-0.5">{typeof note.text === 'string' ? note.text : String(note.text ?? '')}</div>
                        </div>
                      ))}
                    </div>
                  )}
                  {/* Add note input — mobile */}
                  <div className="flex gap-2">
                    <input
                      type="text"
                      className="flex-1 bg-surface-sunken border border-rmpg-600 text-sm text-rmpg-200 px-3 rounded-sm"
                      style={{ minHeight: 44 }}
                      placeholder="Add note…"
                      maxLength={2000}
                      value={newNote}
                      onChange={(e) => setNewNote(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleAddNote(); } }}
                    />
                    <button type="button"
                      onClick={handleAddNote}
                      disabled={!newNote.trim()}
                      className="flex items-center justify-center px-4 py-3 text-xs font-bold text-rmpg-100 rounded-sm"
                      style={{ minHeight: 44, minWidth: 56, background: !newNote.trim() ? 'var(--spm-border)' : 'var(--spm-text-muted)', border: '1px solid var(--spm-text-muted)' }}
                    >
                      <Send style={{ width: 16, height: 16 }} />
                    </button>
                  </div>
                </div>

                {/* PSO Details + Schedule Return Visit (mobile) */}
                {PROCESS_SERVICE_INCIDENT_TYPES.has(selectedCall.incident_type) && (
                  <div className="panel-inset p-3">
                    <div className="field-label mb-2 flex items-center gap-2">
                      PSO Details
                      {(selectedCall.pso_attempt_number || 1) >= 1 && (selectedCall.pso_requestor_name || selectedCall.pso_service_type) && (
                        isAdminOrManager ? (
                          <select
                            className="px-1 py-0 text-[9px] font-bold rounded-sm cursor-pointer"
                            style={{ background: 'color-mix(in srgb, var(--sev-warn) 19%, transparent)', border: '1px solid color-mix(in srgb, var(--sev-warn) 31%, transparent)', color: 'var(--sev-warn-soft)', appearance: 'auto' }}
                            value={selectedCall.pso_attempt_number || 1}
                            onChange={async (e) => {
                              const val = parseInt(e.target.value, 10);
                              try {
                                const result = await apiFetch<any>(`/dispatch/calls/${selectedCall.id}`, { method: 'PUT', body: JSON.stringify({ pso_attempt_number: val }) });
                                const updated = mapDbCall(result);
                                setCalls(prev => prev.map(c => String(c.id) === String(updated.id) ? { ...c, ...updated } : c));
                                setSelectedCall(prev => prev ? { ...prev, ...updated } : updated);
                              } catch { addToast('Failed to update visit number', 'error'); }
                            }}
                          >
                            {ATTEMPT_NUMBERS.map(n => <option key={n} value={n}>VISIT #{n}</option>)}
                          </select>
                        ) : (selectedCall.pso_attempt_number || 1) > 1 ? (
                          <span className="px-1.5 py-0.5 text-[9px] font-bold rounded-sm" style={{ background: 'color-mix(in srgb, var(--sev-warn) 19%, transparent)', border: '1px solid color-mix(in srgb, var(--sev-warn) 31%, transparent)', color: 'var(--sev-warn-soft)' }}>
                            VISIT #{selectedCall.pso_attempt_number}
                          </span>
                        ) : null
                      )}
                    </div>
                    <div className="space-y-1 text-xs text-rmpg-200">
                      {selectedCall.pso_service_type && <div><span className="text-rmpg-400">Service:</span> {formatServiceType(selectedCall.pso_service_type)}</div>}
                      {selectedCall.pso_requestor_name && <div><span className="text-rmpg-400">Requestor:</span> {selectedCall.pso_requestor_name}</div>}
                      {selectedCall.pso_requestor_phone && <div><span className="text-rmpg-400">Phone:</span> {formatPhoneDisplay(selectedCall.pso_requestor_phone)}</div>}
                      {selectedCall.pso_billing_code && <div><span className="text-rmpg-400">Billing:</span> {selectedCall.pso_billing_code}</div>}
                      {selectedCall.pso_authorization && <div><span className="text-rmpg-400">Auth:</span> {selectedCall.pso_authorization}</div>}
                      {selectedCall.disposition && <div><span className="text-rmpg-400">Disposition:</span> {formatDispositionCode(selectedCall.disposition)}</div>}
                    </div>

                    {/* Serve Queue Integration — Gold Status Panel */}
                    {(
                      <div className="mt-2 pt-2 border-t border-rmpg-600">
                        {serveLink ? (
                          <div
                            className="rounded-[2px] p-2 space-y-1.5"
                            style={{
                              border: '1px solid var(--brand-gold)',
                              background: 'rgb(var(--brand-gold-rgb) / 0.03)',
                            }}
                            role="status"
                            aria-label={`Serve status: ${serveLink.status}`}
                          >
                            <div className="flex items-center gap-2">
                              {/* LED indicator */}
                              <span
                                className="w-2 h-2 rounded-full flex-shrink-0"
                                style={{
                                  background: serveLink.status === 'served' ? 'var(--sev-ok)'
                                    : serveLink.status === 'failed' ? 'var(--sev-critical)'
                                    : serveLink.status === 'in_progress' ? 'var(--sev-caution)'
                                    : 'var(--sev-warn)',
                                  boxShadow: `0 0 4px ${
                                    serveLink.status === 'served' ? 'var(--sev-ok)'
                                    : serveLink.status === 'failed' ? 'var(--sev-critical)'
                                    : serveLink.status === 'in_progress' ? 'var(--sev-caution)'
                                    : 'var(--sev-warn)'
                                  }`,
                                }}
                              />
                              <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--brand-gold)' }}>
                                Serve Queue
                              </span>
                              {serveLink.auto_sent && (
                                <span className="text-[9px] font-bold px-1 py-0.5 rounded-sm" style={{ background: 'rgb(var(--brand-gold-rgb) / 0.12)', border: '1px solid rgb(var(--brand-gold-rgb) / 0.25)', color: 'var(--brand-gold)' }}>
                                  AUTO-SENT
                                </span>
                              )}
                            </div>
                            <div className="flex items-center gap-2 flex-wrap">
                              {/* Status badge */}
                              <span
                                className="text-[10px] font-bold font-mono px-1.5 py-0.5 rounded-[2px] uppercase"
                                style={{
                                  background: serveLink.status === 'served' ? 'color-mix(in srgb, var(--sev-ok) 13%, transparent)'
                                    : serveLink.status === 'failed' ? 'color-mix(in srgb, var(--sev-critical) 13%, transparent)'
                                    : serveLink.status === 'in_progress' ? 'color-mix(in srgb, var(--sev-caution) 13%, transparent)'
                                    : 'color-mix(in srgb, var(--sev-warn) 13%, transparent)',
                                  color: serveLink.status === 'served' ? 'var(--sev-ok)'
                                    : serveLink.status === 'failed' ? 'var(--sev-critical)'
                                    : serveLink.status === 'in_progress' ? 'var(--sev-caution)'
                                    : 'var(--sev-warn-soft)',
                                  border: `1px solid ${
                                    serveLink.status === 'served' ? 'color-mix(in srgb, var(--sev-ok) 25%, transparent)'
                                    : serveLink.status === 'failed' ? 'color-mix(in srgb, var(--sev-critical) 25%, transparent)'
                                    : serveLink.status === 'in_progress' ? 'color-mix(in srgb, var(--sev-caution) 25%, transparent)'
                                    : 'color-mix(in srgb, var(--sev-warn) 25%, transparent)'
                                  }`,
                                }}
                              >
                                {serveLink.status === 'in_progress' ? 'IN PROGRESS' : serveLink.status?.toUpperCase()}
                              </span>
                              {/* Attempt counter */}
                              <span className="text-[10px] font-mono tabular-nums" style={{ color: 'var(--brand-gold)' }}>
                                Attempts: {serveLink.attempt_count}/{serveLink.max_attempts}
                              </span>
                            </div>
                            {/* [F4] Dispatcher quick-actions: reassign officer + priority */}
                            {!['served','failed','cancelled'].includes(serveLink.status) && isAdminOrManager && (
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <select
                                  className="text-[9px] font-medium rounded-sm px-1 py-0.5 flex-1 min-w-0"
                                  style={{ background: 'rgb(var(--surface-raised-rgb) / 0.8)', border: '1px solid var(--spm-border)', color: 'var(--text-secondary)' }}
                                  value={serveLink.officer_id ?? ''}
                                  aria-label="Reassign PSO officer"
                                  onChange={async (e) => {
                                    const officer_id = e.target.value ? parseInt(e.target.value, 10) : null;
                                    try {
                                      await apiFetch(`/process-server/${serveLink.id}`, { method: 'PUT', body: JSON.stringify({ officer_id }) });
                                      setServeLink((prev: any) => prev ? { ...prev, officer_id } : prev);
                                      addToast('Officer reassigned', 'success');
                                    } catch { addToast('Reassign failed', 'error'); }
                                  }}
                                >
                                  <option value="">Unassigned</option>
                                  {units.filter((u) => u.status !== 'off_duty' && u.officer_id).map((u) => (
                                    <option key={u.id} value={u.officer_id!}>{u.call_sign}</option>
                                  ))}
                                </select>
                                <select
                                  className="text-[9px] font-medium rounded-sm px-1 py-0.5"
                                  style={{ background: 'rgb(var(--surface-raised-rgb) / 0.8)', border: '1px solid var(--spm-border)', color: 'var(--text-secondary)' }}
                                  value={serveLink.priority ?? 'normal'}
                                  aria-label="Change PSO job priority"
                                  onChange={async (e) => {
                                    const priority = e.target.value;
                                    try {
                                      await apiFetch(`/process-server/${serveLink.id}`, { method: 'PUT', body: JSON.stringify({ priority }) });
                                      setServeLink((prev: any) => prev ? { ...prev, priority } : prev);
                                      addToast(`Priority set to ${priority}`, 'success');
                                    } catch { addToast('Priority change failed', 'error'); }
                                  }}
                                >
                                  {SERVE_PRIORITY_OPTIONS.map((p) => (
                                    <option key={p} value={p}>{p.charAt(0).toUpperCase() + p.slice(1)}</option>
                                  ))}
                                </select>
                              </div>
                            )}
                            {/* View in Process Server link */}
                            <button type="button"
                              className="flex items-center gap-1 text-[10px] font-medium rounded-[2px] px-2 py-1 transition-all duration-150 hover:shadow-[0_0_6px_rgb(var(--brand-gold-rgb)_/_0.2)]"
                              style={{
                                background: 'rgb(var(--brand-gold-rgb) / 0.08)',
                                border: '1px solid rgb(var(--brand-gold-rgb) / 0.25)',
                                color: 'var(--brand-gold)',
                              }}
                              onClick={() => navigate(serveLink?.id ? `/serve?job_id=${serveLink.id}` : '/serve')}
                              aria-label="View in Process Server"
                            >
                              <Briefcase style={{ width: 10, height: 10 }} />
                              View in Process Server
                            </button>
                          </div>
                        ) : (
                          <button type="button"
                            className="w-full py-2 px-3 text-xs font-semibold rounded-[2px] flex items-center justify-center gap-2 transition-colors"
                            style={{
                              background: sendingToServe ? 'var(--spm-border)' : 'color-mix(in srgb, var(--sev-special) 13%, transparent)',
                              border: '1px solid color-mix(in srgb, var(--sev-special) 31%, transparent)',
                              color: sendingToServe ? 'var(--spm-text-muted)' : 'var(--sev-special-soft)',
                            }}
                            disabled={sendingToServe}
                            onClick={async () => {
                              setSendingToServe(true);
                              try {
                                const result = await apiFetch(`/dispatch/calls/${selectedCall.id}/send-to-serve`, {
                                  method: 'POST',
                                  body: JSON.stringify({}),
                                });
                                if (result) {
                                  setServeLink(result);
                                  addToast('Sent to Serve Queue', 'success');
                                }
                              } catch (err: any) {
                                addToast(`Failed: ${err?.message || 'Unknown error'}`, 'error');
                              } finally {
                                setSendingToServe(false);
                              }
                            }}
                            aria-label="Send to Serve Queue"
                          >
                            <Briefcase style={{ width: 14, height: 14 }} />
                            {sendingToServe ? 'Sending...' : 'Send to Serve Queue'}
                          </button>
                        )}
                      </div>
                    )}

                    {/* Visit History (mobile) */}
                    {Array.isArray(selectedCall.visit_history) && selectedCall.visit_history.length > 0 && (
                      <div className="mt-3 pt-2 border-t border-rmpg-600">
                        <div className="field-label mb-1.5">Visit History</div>
                        <div className="space-y-1.5">
                          {selectedCall.visit_history.map((visit) => (
                            <div key={visit.id} className="bg-rmpg-800/60 border border-rmpg-600/50 rounded-sm px-2 py-1.5 text-[10px]">
                              <div className="flex items-center gap-2 mb-0.5">
                                <span className="font-bold text-amber-300">VISIT #{visit.visit_number}</span>
                                <span className="text-rmpg-300">{(visit.status || '').toUpperCase()}</span>
                              </div>
                              <div className="text-rmpg-400 space-y-0.5">
                                {visit.dispatched_at && <div>Dispatched: {formatTime(visit.dispatched_at)}</div>}
                                {visit.onscene_at && <div>On Scene: {formatTime(visit.onscene_at)}</div>}
                                {visit.cleared_at && <div>Cleared: {formatTime(visit.cleared_at)}</div>}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* PSO Service Window Compliance Checklist (mobile) */}
                    {(() => {
                      const windows = parsePsoServiceWindows(selectedCall.pso_service_windows);
                      const metCount = SERVICE_WINDOW_SLOTS.filter(s => windows[s.key]).length;
                      if (metCount === 0) return null;
                      const allMet = metCount === SERVICE_WINDOW_SLOTS.length;
                      return (
                        <div className="mt-3 pt-2 border-t border-rmpg-600">
                          <div className="field-label mb-1.5 flex items-center gap-2">
                            Service Windows
                            <span className="text-[9px] font-mono px-1 rounded-sm" style={{
                              background: allMet ? 'color-mix(in srgb, var(--sev-ok) 13%, transparent)' : 'color-mix(in srgb, var(--sev-warn) 13%, transparent)',
                              border: `1px solid ${allMet ? 'color-mix(in srgb, var(--sev-ok) 25%, transparent)' : 'color-mix(in srgb, var(--sev-warn) 25%, transparent)'}`,
                              color: allMet ? 'var(--sev-ok)' : 'var(--sev-warn-soft)',
                            }}>
                              {metCount}/{SERVICE_WINDOW_SLOTS.length}
                            </span>
                          </div>
                          <div className="grid grid-cols-2 gap-1">
                            {SERVICE_WINDOW_SLOTS.map(({ key, label }) => {
                              const met = windows[key];
                              return (
                                <div key={key} className="flex items-center gap-1.5 text-[10px] py-0.5 px-1.5 rounded-sm" style={{
                                  background: met ? 'color-mix(in srgb, var(--sev-ok) 6%, transparent)' : 'color-mix(in srgb, var(--sev-critical) 6%, transparent)',
                                  border: `1px solid ${met ? 'color-mix(in srgb, var(--sev-ok) 19%, transparent)' : 'color-mix(in srgb, var(--sev-critical) 19%, transparent)'}`,
                                }}>
                                  <span style={{ color: met ? 'var(--sev-ok)' : 'var(--sev-critical)' }}>{met ? '✓' : '✗'}</span>
                                  <span style={{ color: met ? 'var(--sev-ok-soft)' : 'var(--sev-critical-soft)' }}>{label}</span>
                                </div>
                              );
                            })}
                          </div>
                          {allMet && (
                            <div className="mt-1.5 text-[9px] text-center font-bold uppercase tracking-wider" style={{ color: 'var(--sev-ok)' }}>
                              Due Diligence Complete
                            </div>
                          )}
                        </div>
                      );
                    })()}

                    {/* 72-hour countdown (mobile) */}
                    {RESOLVED_STATUSES.has(selectedCall.status) && (() => {
                      const dl = computeResolvedDeadline(selectedCall.closed_at || selectedCall.cleared_at);
                      if (!dl) return null;
                      if (dl.status === 'overdue') return (
                        <div className="mt-2 p-2 rounded-sm text-center text-xs font-bold animate-pulse" style={{ background: 'color-mix(in srgb, var(--sev-critical) 19%, transparent)', border: '1px solid color-mix(in srgb, var(--sev-critical) 31%, transparent)', color: 'var(--sev-critical)' }}>
                          72-HOUR DEADLINE PASSED — RE-DISPATCH REQUIRED
                        </div>
                      );
                      if (dl.status === 'warning') return (
                        <div className="mt-2 p-2 rounded-sm text-center text-xs font-bold" style={{ background: 'color-mix(in srgb, var(--sev-warn) 13%, transparent)', border: '1px solid color-mix(in srgb, var(--sev-warn) 25%, transparent)', color: 'var(--sev-warn-soft)' }}>
                          {dl.hoursLeft} HOURS UNTIL 72-HR DEADLINE
                        </div>
                      );
                      return null;
                    })()}

                    {/* Schedule Return Visit button (mobile) */}
                    {INACTIVE_STATUSES.has(selectedCall.status) && (
                      <button type="button"
                        className="w-full mt-3 py-2.5 px-4 text-sm font-semibold rounded-sm"
                        style={{ background: 'rgb(var(--brand-gold-rgb) / 0.19)', border: '1px solid rgb(var(--brand-gold-rgb) / 0.38)', color: 'var(--brand-gold)' }}
                        onClick={() => {
                          const attempt = (selectedCall.pso_attempt_number || 1) + 1;
                          const ordinal = formatOrdinal(attempt);
                          setPendingConfirm({
                            title: 'Schedule Return Visit',
                            message: `Schedule ${ordinal} return visit for ${selectedCall.call_number}?`,
                            confirmLabel: 'Schedule Visit',
                            run: async () => {
                              try {
                                const result = await apiFetch(`/dispatch/calls/${selectedCall.id}/redispatch`, {
                                  method: 'POST',
                                  body: JSON.stringify({}),
                                });
                                if (result) {
                                  const mapped = mapDbCall(result);
                                  setCalls(prev => [mapped, ...prev]);
                                  setSelectedCall(mapped);
                                  addToast(`Re-dispatched → ${mapped.call_number}`, 'success');
                                }
                              } catch (err: any) { addToast(`Failed to re-dispatch: ${err?.message || 'Unknown error'}`, 'error'); }
                            },
                          });
                        }}
                      >
                        <RotateCcw style={{ width: 14, height: 14, display: 'inline', marginRight: 6 }} />
                        Schedule Return Visit
                      </button>
                    )}

                    {/* Notice of Communication (mobile) — PSO failed attempt → re-dispatch */}
                    {PROCESS_SERVICE_INCIDENT_TYPES.has(selectedCall.incident_type) && INACTIVE_STATUSES.has(selectedCall.status) && (
                      <button type="button"
                        className="w-full mt-2 py-2.5 px-4 text-sm font-semibold rounded-sm"
                        style={{ background: 'color-mix(in srgb, var(--sev-info) 15%, transparent)', border: '1px solid color-mix(in srgb, var(--sev-info) 31%, transparent)', color: 'var(--sev-info)' }}
                        onClick={() => openPsoNotice(selectedCall)}
                      >
                        <FileText style={{ width: 14, height: 14, display: 'inline', marginRight: 6 }} />
                        Notice of Communication
                      </button>
                    )}

                    {/* Undo Return Visit button (mobile) — only on pending child calls */}
                    {selectedCall.parent_call_id && selectedCall.status === 'pending' && (
                      <button type="button"
                        className="w-full mt-2 py-2 px-4 text-xs font-semibold rounded-sm"
                        style={{ background: 'color-mix(in srgb, var(--sev-critical) 13%, transparent)', border: '1px solid color-mix(in srgb, var(--sev-critical) 31%, transparent)', color: 'var(--sev-critical)' }}
                        onClick={() => {
                          setPendingConfirm({
                            title: 'Undo Return Visit',
                            message: `Undo this return visit? This will delete ${selectedCall.call_number} and restore the parent call.`,
                            confirmLabel: 'Undo Visit',
                            run: async () => {
                              try {
                                const result = await apiFetch<any>(`/dispatch/calls/${selectedCall.id}/undo-redispatch`, { method: 'POST' });
                                if (result?.parent) {
                                  const mapped = mapDbCall(result.parent);
                                  setCalls(prev => prev.filter(c => c.id !== selectedCall.id).map(c => c.id === mapped.id ? mapped : c));
                                  setSelectedCall(mapped);
                                  addToast(`Return visit undone — restored ${mapped.call_number}`, 'success');
                                }
                              } catch (err: any) { addToast(`Failed to undo: ${err?.message || 'Unknown error'}`, 'error'); }
                            },
                          });
                        }}
                      >
                        <Undo2 style={{ width: 12, height: 12, display: 'inline', marginRight: 6 }} />
                        Undo Return Visit
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}
        </MobileDetailView>

        {/* FABs — New Call + PSO */}
        <button type="button"
          className="mobile-fab"
          onClick={() => { setTemplateInitialData(undefined); setShowNewCallModal(true); }}
          aria-label="New Call"
        >
          <Plus style={{ width: 24, height: 24 }} />
        </button>
        <button type="button"
          className="mobile-fab"
          onClick={() => setShowQuickPsoModal(true)}
          aria-label="Quick PSO"
          style={{
            right: '80px',
            background: 'linear-gradient(180deg, var(--sev-special) 0%, var(--sev-special) 100%)',
            borderColor: 'var(--sev-special)',
          }}
        >
          <Shield style={{ width: 20, height: 20 }} />
        </button>

        {/* Duplicate call warning banner — shown when POST /dispatch/calls returns duplicate_warning */}
        {duplicateWarning && (
          <div
            className="fixed top-4 left-1/2 -translate-x-1/2 z-[300] flex items-start gap-2 px-3 py-2 max-w-sm w-[90%] text-[11px] font-bold"
            style={{ background: 'rgb(var(--sev-warn-rgb) / 0.18)', border: '1px solid rgb(var(--sev-warn-rgb) / 0.5)', color: 'var(--sev-warn)', borderRadius: 2, boxShadow: '0 4px 20px rgba(0,0,0,0.5)' }}
            role="alert"
          >
            <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <span>&#9888; {duplicateWarning.message}</span>
              {duplicateWarning.callNumber && duplicateWarning.callId && (
                <button
                  type="button"
                  className="ml-2 underline hover:no-underline"
                  onClick={() => {
                    const c = calls.find((x) => String(x.id) === duplicateWarning.callId);
                    if (c) setSelectedCall(c);
                    setDuplicateWarning(null);
                  }}
                >
                  View #{duplicateWarning.callNumber}
                </button>
              )}
            </div>
            <button type="button" aria-label="Dismiss duplicate warning" onClick={() => setDuplicateWarning(null)} className="text-yellow-300 hover:text-yellow-100 ml-1">
              <X style={{ width: 12, height: 12 }} />
            </button>
          </div>
        )}

        {/* New Call Modal (shared with desktop) */}
        <NewCallModal
          isOpen={showNewCallModal}
          onClose={() => { setShowNewCallModal(false); setTemplateInitialData(undefined); }}
          onSubmit={handleNewCall}
          properties={propertiesList}
          initialData={templateInitialData}
          defaultMode="quick"
        />

        {/* Quick PSO Modal */}
        <QuickPsoModal
          isOpen={showQuickPsoModal}
          onClose={() => setShowQuickPsoModal(false)}
          onSubmit={handleNewCall}
          onExpandToFullForm={handlePsoExpandToFullForm}
        />
      </div>
    );
  }

  // ================================================================
  // DESKTOP LAYOUT — Existing 40%/60% split with panels
  // ================================================================
  return (
    <div className="flex h-full relative">
      {/* ============================================================ */}
      {/* LEFT PANEL - Call Queue (40%) */}
      {/* ============================================================ */}
      <div className={`${cadBoardView ? 'w-[52%] min-w-[560px]' : 'w-[35%] min-w-[320px]'} border-r border-[var(--spm-border)] flex flex-col`} style={{ background: 'var(--surface-base)' }}>
        {/* Header — PanelTitleBar + TabBar */}
        <PanelTitleBar title="DISPATCH QUEUE" icon={Radio}>
          {/* Enhancement 27: Live sync indicator */}
          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-wider text-green-400 bg-green-900/30 border border-green-700/40" title="Real-time updates active">
            <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" style={{ boxShadow: '0 0 4px var(--sev-ok)' }} />
            LIVE
          </span>
          <RmpgLogo height={16} iconOnly />
          {/* Feature 1: Sound alert mute toggle */}
          <button type="button"
            onClick={toggleSoundAlerts}
            className={`toolbar-btn ${soundAlertsMuted ? 'text-red-400' : 'text-green-400'}`}
            title={soundAlertsMuted ? 'Sound alerts: MUTED' : 'Sound alerts: ON'}
          >
            {soundAlertsMuted ? <XCircle style={{ width: 10, height: 10 }} /> : <Radio style={{ width: 10, height: 10 }} />}
            {soundAlertsMuted ? 'Muted' : 'Sound'}
          </button>
          {/* Feature 5: Shift handoff notes */}
          <button type="button"
            onClick={() => { setShowHandoffNotes(true); fetchHandoffNotes(); }}
            className="toolbar-btn"
            title="Shift Handoff Notes"
          >
            <Briefcase style={{ width: 10, height: 10 }} />
            Handoff
          </button>
          {/* Dispatch Code Quick Panel toggle */}
          <button type="button"
            onClick={() => setShowCodePanel(prev => !prev)}
            className={`toolbar-btn ${showCodePanel ? 'text-brand-400 border-brand-700/40 bg-brand-900/20' : ''}`}
            title={showCodePanel ? 'Close code browser' : 'Open code browser'}
          >
            <Hash style={{ width: 10, height: 10 }} />
            Codes
          </button>
          {/* Activity Feed toggle */}
          <button type="button"
            onClick={() => setShowActivityFeed(prev => !prev)}
            className={`toolbar-btn ${showActivityFeed ? 'text-brand-400 border-brand-700/40 bg-brand-900/20' : ''}`}
            title={showActivityFeed ? 'Close activity feed' : 'Open activity feed'}
          >
            <Activity style={{ width: 10, height: 10 }} />
            Activity
          </button>
          <ExportButton exportUrl="/dispatch/calls/export?format=csv" exportFilename="dispatch_calls_export.csv" />
          <PrintButton />
          {/* Cleared-tab supervisor: one-click end-of-shift PDF summary.
              Filters the live calls list to status='cleared'|'closed' inside
              today's Mountain-Time window (00:00 MT → now) and renders a
              single-PDF table with disposition / units / duration so a
              closing supervisor doesn't have to print per-call. Visible only
              on the Cleared tab where the artifact is actually wanted. */}
          {filterTab === 'cleared' && (
            <button type="button"
              onClick={() => {
                const win = todayMtWindow();
                const inWindow = filterClearedInWindow(calls, win);
                openClearedSummaryPdf({
                  calls: inWindow,
                  windowStart: win.start,
                  windowEnd: win.end,
                  dispatcherName: user ? `${user.first_name || ''} ${user.last_name || ''}`.trim() || user.username : undefined,
                });
              }}
              className="toolbar-btn"
              title="Print today's cleared calls (single PDF, MT window)"
            >
              <Printer style={{ width: 10, height: 10 }} />
              Print Cleared
            </button>
          )}
          {tabCounts.cleared > 0 && (
            <button type="button"
              onClick={handleBulkArchive}
              disabled={isBulkArchiving}
              className="toolbar-btn"
              title="Archive all cleared, closed, and cancelled calls"
            >
              {isBulkArchiving ? <Loader2 style={{ width: 10, height: 10 }} className="animate-spin" /> : <Archive style={{ width: 10, height: 10 }} />}
              Archive Cleared
            </button>
          )}
          <div className="relative flex items-center" style={{ minWidth: '100px', maxWidth: '170px' }}>
            <Search className="absolute left-2 w-3 h-3 text-[var(--spm-text-muted)] pointer-events-none" />
            <input
              type="text"
              placeholder="Search calls, address, district (SL1, Herriman)…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="input-dark text-xs w-full pl-6 pr-6"
            />
            {searchQuery && (
              <button type="button"
                onClick={() => setSearchQuery('')}
                className="absolute right-1.5 w-4 h-4 flex items-center justify-center text-[var(--spm-text-muted)] hover:text-rmpg-100 transition-colors"
                title="Clear search"
                aria-label="Clear search"
              >
                <X style={{ width: 10, height: 10 }} />
              </button>
            )}
          </div>
          <button type="button" onClick={() => { setTemplateInitialData(undefined); setShowNewCallModal(true); }} className="toolbar-btn toolbar-btn-primary">
            <Plus style={{ width: 10, height: 10 }} />
            New Call
          </button>
          <button type="button" onClick={() => setShowPlateScanModal(true)} className="toolbar-btn" title="Plate Scan — scan a license plate or create a vehicle record">
            <ScanSearch style={{ width: 10, height: 10 }} />
            Plate Scan
          </button>
          {/* Quick Dispatch dropdown */}
          <div className="relative" ref={templateDropdownRef} style={{ display: 'inline-block' }}>
            <button type="button"
              onClick={() => setShowTemplateDropdown((prev) => !prev)}
              className="toolbar-btn"
              title="Quick Dispatch — create call from template"
            >
              <FileText style={{ width: 10, height: 10 }} />
              Quick
              <ChevronDown
                className="w-3 h-3 ml-0.5 transition-transform"
                style={{ transform: showTemplateDropdown ? 'rotate(180deg)' : 'rotate(0deg)' }}
              />
            </button>
            {showTemplateDropdown && (
              <div
                className="absolute z-50 mt-1"
                style={{
                  top: '100%',
                  left: 0,
                  minWidth: '220px',
                  maxHeight: '280px',
                  overflowY: 'auto',
                  background: 'var(--surface-raised)',
                  border: '1px solid var(--spm-border)',
                  borderRadius: '2px',
                  boxShadow: '0 8px 24px rgba(0 0 0 / 0.6)',
                }}
              >
                {templates.length === 0 ? (
                  <div className="px-3 py-3 text-xs text-rmpg-400 text-center italic">No templates available</div>
                ) : (
                  templates.map((tpl: any) => (
                    <button
                      key={tpl.id}
                      type="button"
                      onClick={() => {
                        setQuickTemplateData({
                          name: tpl.name || tpl.incident_type,
                          incident_type: tpl.incident_type,
                          priority: tpl.priority || 'P3',
                          description: tpl.description || '',
                          source: tpl.source || 'phone',
                        });
                        setQuickTemplateAddress(tpl.location || tpl.location_address || '');
                        setQuickTemplateCoords({ lat: null, lng: null });
                        setQuickTemplateSubmitting(false);
                        setShowTemplateDropdown(false);
                      }}
                      className="w-full flex flex-col items-start px-3 py-2 text-left transition-colors"
                      style={{ fontSize: '11px', color: 'var(--spm-text)', background: 'transparent', border: 'none', borderRadius: 0 }}
                      onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'var(--surface-hover)'; }}
                      onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
                    >
                      <span className="font-bold text-rmpg-100" style={{ fontSize: '11px' }}>{tpl.name || formatIncidentType(tpl.incident_type)}</span>
                      {tpl.description && <span className="text-rmpg-400 truncate w-full" style={{ fontSize: '10px' }}>{tpl.description}</span>}
                    </button>
                  ))
                )}
              </div>
            )}
          </div>
          <button type="button"
            onClick={() => setShowQuickPsoModal(true)}
            className="toolbar-btn"
            title="Quick PSO Client Request (P)"
            style={{
              background: 'linear-gradient(180deg, var(--sev-special) 0%, var(--sev-special) 100%)',
              borderColor: 'var(--sev-special)',
              borderBottomColor: 'var(--spm-border)',
              borderRightColor: 'var(--spm-border)',
              color: 'var(--text-primary)',
            }}
          >
            <Shield style={{ width: 10, height: 10 }} />
            PSO
          </button>
          {/* Optimize Assignments — supervisor+ only, requires pending calls + available units */}
          {isSupervisorPlus && calls.some(c => c.status === 'pending' || c.status === 'on_hold') && units.some(u => u.status === 'available') && (
            dispatchOpt.status === 'idle' || dispatchOpt.status === 'error' ? (
              <button
                type="button"
                onClick={handleOptimizeAssignments}
                className="toolbar-btn"
                title="Suggest optimal unit assignments for pending calls"
              >
                <Route style={{ width: 10, height: 10 }} />
                Optimize
              </button>
            ) : (dispatchOpt.status === 'pending' || dispatchOpt.status === 'processing') ? (
              <OptimizationV2StatusBadge status={dispatchOpt.status} elapsedMs={dispatchOpt.elapsedMs} />
            ) : null
          )}
          <button type="button"
            onClick={toggleCadBoardView}
            className="toolbar-btn"
            title={cadBoardView ? 'Switch to classic call list' : 'Switch to Spillman CAD console'}
          >
            <Terminal style={{ width: 10, height: 10 }} />
            {cadBoardView ? 'List' : 'CAD'}
          </button>
        </PanelTitleBar>
        {cadBoardView && (
          <SpillmanCadBoard
            calls={cadBoardCalls}
            units={units}
            hitCallIds={hitCallIds}
            selectedCallId={selectedCall?.id ?? null}
            onSelectCall={setSelectedCall}
            onOpenNewCall={() => { setTemplateInitialData(undefined); setShowNewCallModal(true); }}
            onAssignUnitToCall={handleDragAssignUnit}
            onUnassignUnitFromCall={handleDragUnassignUnit}
            onClearCall={(callId) => handleClearWithDisposition(callId)}
            onCommandFeedback={(msg, level) => addToast(msg, level === 'info' ? 'success' : level)}
          />
        )}
        {!cadBoardView && (<>
        <TabBar
          spillman
          tabs={[
            ...FILTER_TAB_CONFIG.map(tab => ({ ...tab, count: tabCounts[tab.id as keyof typeof tabCounts] ?? 0 })),
            { id: 'archived', label: 'Archive', count: tabCounts.archived },
          ]}
          activeTab={filterTab}
          onTabChange={(id) => setFilterTab(id as FilterTab)}
        />

        {/* Operational Status Strip — consolidated single row */}
        <div className="px-3 py-1 border-b border-[var(--spm-border)] flex items-center gap-2.5 flex-wrap text-[9px] font-mono flex-shrink-0 tabular-nums" style={{ background: 'var(--surface-deep)' }}>
          {(() => {
            const workingCalls = calls.filter(c => !COMPLETED_STATUSES.has(c.status));
            const p1Count = workingCalls.filter(c => c.priority === 'P1').length;
            const p2Count = workingCalls.filter(c => c.priority === 'P2').length;
            // Stacked calls
            const stackedLocations = new Map<string, number>();
            workingCalls.forEach(c => {
              if (c.location) {
                const loc = c.location.toLowerCase().trim();
                stackedLocations.set(loc, (stackedLocations.get(loc) || 0) + 1);
              }
            });
            const stacked = [...stackedLocations.entries()].filter(([, count]) => count > 1);
            // Oldest pending
            const pendingCalls = calls.filter(c => c.status === 'pending');
            const oldestPending = pendingCalls.length > 0
              ? Math.round((Date.now() - Math.min(...pendingCalls.map(c => parseTimestamp(c.created_at).getTime()))) / 60000)
              : null;
            // Today stats
            const todayCalls = calls.filter(c => {
              if (!c.created_at) return false;
              const d = parseTimestamp(c.created_at);
              return d.toDateString() === new Date().toDateString();
            });
            const clearedToday = todayCalls.filter(c => FINISHED_STATUSES.has(c.status)).length;
            // Avg response
            const responseTimes = todayCalls
              .filter(c => c.onscene_at && c.created_at)
              .map(c => (parseTimestamp(c.onscene_at).getTime() - parseTimestamp(c.created_at).getTime()) / 60000)
              .filter(m => m > 0 && m < 480);
            const avgResponse = responseTimes.length > 0 ? Math.round(responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length) : null;

            return (
              <>
                {/* P1 alert — pulsing red */}
                {p1Count > 0 && (
                  <span className="flex items-center gap-1 px-1.5 py-0.5 font-bold animate-pulse" style={{ background: 'rgb(var(--sev-critical-rgb) / 0.2)', border: '1px solid rgb(var(--sev-critical-rgb) / 0.4)', color: 'var(--sev-critical)', boxShadow: '0 0 6px rgb(var(--sev-critical-rgb) / 0.3)' }}>
                    <span className="w-1.5 h-1.5 rounded-full bg-red-500" style={{ boxShadow: '0 0 4px var(--sev-critical)' }} />
                    P1: {p1Count}
                  </span>
                )}
                {p2Count > 0 && <span className="text-amber-400 font-bold">P2: {p2Count}</span>}
                {/* Unit availability */}
                <span className="flex items-center gap-1.5 text-[var(--spm-text-muted)]" title={`${unitAvailability.available} available · ${unitAvailability.enroute} enroute · ${unitAvailability.onscene} on-scene · ${unitAvailability.oos} OOS`}>
                  <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: unitAvailability.available > 0 ? 'var(--sev-ok)' : 'var(--sev-critical)', boxShadow: `0 0 4px ${unitAvailability.available > 0 ? 'color-mix(in srgb, var(--sev-ok) 50%, transparent)' : 'color-mix(in srgb, var(--sev-critical) 50%, transparent)'}` }} />
                  <span style={{ color: unitAvailability.available > 0 ? 'var(--sev-ok)' : 'var(--sev-critical)' }}><strong>{unitAvailability.available}</strong> AVAIL</span>
                  {unitAvailability.enroute > 0 && <span className="text-amber-400"><strong>{unitAvailability.enroute}</strong> ENR</span>}
                  {unitAvailability.onscene > 0 && <span className="text-purple-400"><strong>{unitAvailability.onscene}</strong> OS</span>}
                  {unitAvailability.oos > 0 && <span className="text-rmpg-500"><strong>{unitAvailability.oos}</strong> OOS</span>}
                </span>
                {/* Stacked calls */}
                {stacked.length > 0 && (
                  <span className="flex items-center gap-1 px-1.5 py-0.5 font-bold text-[9px]" style={{ background: 'rgb(var(--sev-special-rgb) / 0.15)', color: 'var(--sev-special-soft)', border: '1px solid rgb(var(--sev-special-rgb) / 0.3)' }} title={`${stacked.length} location(s) with multiple active calls`}>
                    <Link className="w-2.5 h-2.5" /> STACKED: {stacked.length}
                  </span>
                )}
                {/* Busiest district */}
                {districtLoad.length > 0 && (() => {
                  const [topSection] = districtLoad[0];
                  const isFiltered = searchQuery.trim() === topSection;
                  return (
                    <button type="button" onClick={() => setSearchQuery(isFiltered ? '' : topSection)}
                      className="flex items-center gap-1 px-1.5 py-0.5 font-bold text-[9px] hover:brightness-125 transition-all"
                      style={{ background: isFiltered ? 'rgb(var(--brand-gold-rgb) / 0.3)' : 'rgb(var(--brand-gold-rgb) / 0.12)', color: 'var(--brand-gold)', border: '1px solid rgb(var(--brand-gold-rgb) / 0.3)' }}
                      title={`Active calls by district — ${districtLoad.map(([k, n]) => `${k}: ${n}`).join(' · ')}`}
                    >
                      <MapPin className="w-2.5 h-2.5" /> {topSection}: {districtLoad[0][1]}
                    </button>
                  );
                })()}
                {/* Oldest pending wait time */}
                {oldestPending !== null && oldestPending > 0 && (
                  <span className={`flex items-center gap-1 px-1.5 py-0.5 border ${oldestPending <= 5 ? 'text-rmpg-400 border-rmpg-700/40' : oldestPending <= 15 ? 'text-amber-400 border-amber-700/40 bg-amber-900/10 animate-pulse' : 'text-red-400 border-red-700/40 bg-red-900/20 animate-pulse'}`}>
                    WAIT: <strong>{oldestPending}m</strong>
                  </span>
                )}
                {/* Avg response */}
                {avgResponse !== null && (
                  <span className={`flex items-center gap-1 px-1.5 py-0.5 border ${avgResponse <= 8 ? 'text-green-400 border-green-700/40 bg-green-900/20' : avgResponse <= 15 ? 'text-amber-400 border-amber-700/40 bg-amber-900/20' : 'text-red-400 border-red-700/40 bg-red-900/20'}`}>
                    RESP: <strong>{avgResponse}m</strong>
                  </span>
                )}
                {/* Sort toggle */}
                {(() => {
                  const current = (userPrefs?.dispatch_sort || localSort || 'priority') as 'priority' | 'time' | 'status' | 'geo';
                  return (
                    <button type="button" title={`Sort: ${SORT_TITLES[current]} (click to cycle)`}
                      onClick={() => {
                        const target = SORT_CYCLE[current];
                        setLocalSort(target);
                        localStorage.setItem('rmpg_dispatch_sort', target);
                        apiFetch('/user/preferences', { method: 'PUT', body: JSON.stringify({ dispatch_sort: target }) })
                          .then(() => reloadPrefs()).catch(() => {});
                      }}
                      className="flex items-center gap-1 px-1.5 py-0.5 text-[8px] font-bold border border-rmpg-700/50 hover:brightness-125 transition-all"
                      style={{ background: 'var(--surface-sunken)', color: 'var(--brand-gold)' }}
                    >
                      SORT: {SORT_LABELS[current]}
                    </button>
                  );
                })()}
                {/* Right: today + priority filters + call count */}
                <div className="ml-auto flex items-center gap-1.5">
                  <span className="text-rmpg-400">
                    <span className="text-[8px] text-rmpg-600">TODAY</span> <strong className="text-rmpg-100">{todayCalls.length}</strong>/<strong className="text-green-400">{clearedToday}</strong>
                  </span>
                  <span className="text-rmpg-700">|</span>
                  {(['P1', 'P2', 'P3', 'P4'] as const).map(p => {
                    const count = workingCalls.filter(c => c.priority === p).length;
                    const active = priorityFilter === p;
                    const colors: Record<string, string> = {
                      P1: `bg-red-900/${active ? '60' : '40'} text-red-400 border-red-700/${active ? '60' : '50'}`,
                      P2: `bg-amber-900/${active ? '60' : '40'} text-amber-400 border-amber-700/${active ? '60' : '50'}`,
                      P3: `bg-surface-sunken/${active ? '60' : '40'} text-rmpg-400 border-border-default/${active ? '60' : '50'}`,
                      P4: `bg-green-900/${active ? '60' : '40'} text-green-400 border-green-700/${active ? '60' : '50'}`,
                    };
                    return (
                      <button key={p} type="button" onClick={() => setPriorityFilter(active ? null : p)}
                        className={`px-1.5 py-0.5 text-[8px] font-bold border cursor-pointer hover:brightness-125 transition-all ${colors[p]} ${count > 0 ? '' : 'opacity-30'}`}
                        title={`${active ? 'Clear' : 'Filter to'} ${p}`}
                      >
                        {p}:{count}
                      </button>
                    );
                  })}
                  {(['signaled', 'unsignaled'] as const).map(mode => {
                    const active = signalFilter === mode;
                    const count = mode === 'signaled'
                      ? workingCalls.filter(c => knownSignalCodes.has(c.incident_type)).length
                      : workingCalls.filter(c => !knownSignalCodes.has(c.incident_type)).length;
                    return (
                      <button key={mode} type="button" onClick={() => setSignalFilter(active ? null : mode)}
                        className={`px-1.5 py-0.5 text-[8px] font-bold border cursor-pointer hover:brightness-125 transition-all ${active ? 'bg-purple-900/60 text-purple-300 border-purple-700/60' : 'bg-purple-900/30 text-purple-400/70 border-purple-700/40'} ${count > 0 ? '' : 'opacity-30'}`}
                        title={active ? 'Clear signal filter' : `Show only ${mode === 'signaled' ? 'signaled' : 'unsignaled'} calls`}
                      >
                        {mode === 'signaled' ? '✓' : '✗'}SIG:{count}
                      </button>
                    );
                  })}
                  <span className="text-rmpg-700">|</span>
                  <span className="text-rmpg-500">{filteredCalls.length} calls</span>
                </div>
              </>
            );
          })()}
        </div>

        {/* Dispatch Analytics Strip — 7-day call volume, zone breakdown, repeat addresses */}
        <DispatchAnalyticsStrip />

        {/* Shift Stats Bar — calls/incidents/active units this shift, polls every 60s */}
        <ShiftStatsBar activeUnits={units.filter((u) => u.status !== 'off_duty').length} />

        {/* Quick filter bar — chips for All / P1 / P2 / status / my beat */}
        <CallFilterBar
          active={quickFilter}
          onChange={setQuickFilter}
          myBeat={(user as any)?.beat_id ?? null}
        />

        {/* Incident Type Analytics Chart */}
        <div className="px-3 py-2 border-b border-[var(--spm-border)] flex-shrink-0">
          <IncidentTypeChart />
        </div>

        {/* Feature 9: Call Type Statistics Bar — clickable to toggle filter */}
        {callTypeStats.length > 0 && (
          <div className="px-3 py-1 border-b border-[var(--spm-border)] flex items-center gap-2 flex-shrink-0" style={{ background: 'rgba(var(--surface-base-rgb), 0.5)' }}>
            {callTypeStats.map(({ type, count }) => {
              const total = callTypeStats.reduce((sum, s) => sum + s.count, 0);
              const pct = total > 0 ? (count / total * 100) : 0;
              const active = typeFilter === type;
              return (
                <button
                  key={type}
                  type="button"
                  onClick={() => setTypeFilter(active ? null : type)}
                  className={`flex items-center gap-0.5 cursor-pointer hover:brightness-125 transition-all ${active ? 'px-1 py-0.5 rounded-sm bg-brand-900/30 border border-brand-700/50' : ''}`}
                  title={`${formatIncidentType(type)}: ${count} — ${active ? 'Clear filter' : 'Filter to this type'}`}
                >
                  <div
                    className="h-2 rounded-sm bg-brand-500"
                    style={{ width: `${Math.max(pct * 0.8, 4)}px`, minWidth: 4, opacity: active ? 1 : 0.7 + pct * 0.003 }}
                  />
                  <span className={`text-[7px] font-mono tabular-nums truncate max-w-[80px] ${active ? 'text-brand-300' : 'text-rmpg-400'}`} title={formatIncidentType(type)}>
                    {formatIncidentType(type).slice(0, 12)} {count}
                  </span>
                </button>
              );
            })}
          </div>
        )}

        {/* Feature 14: Disposition Statistics (collapsed by default) */}
        {dispositionStats.length > 0 && filterTab === 'cleared' && (
          <div className="px-3 py-1 border-b border-[var(--spm-border)] flex items-center gap-2 flex-wrap text-[8px] font-mono flex-shrink-0" style={{ background: 'rgba(var(--surface-base-rgb), 0.5)' }}>
            <span className="text-rmpg-500 font-bold">DISPS:</span>
            {dispositionStats.slice(0, 5).map(d => (
              <span key={d.disposition} className="text-rmpg-400">
                {d.disposition}: <strong className="text-rmpg-200">{d.count}</strong>
              </span>
            ))}
          </div>
        )}

        {/* Active filter tags */}
        {(priorityFilter || typeFilter || signalFilter) && (
          <div className="px-3 py-1 border-b border-[var(--spm-border)] flex items-center gap-1.5 flex-shrink-0" style={{ background: 'var(--surface-base)' }}>
            <span className="text-[8px] text-rmpg-500 font-semibold uppercase tracking-wider mr-0.5">Filters:</span>
            {priorityFilter && (
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[8px] font-bold border rounded-sm"
                style={{ background: priorityFilter === 'P1' ? 'rgb(var(--sev-critical-rgb) / 0.25)' : priorityFilter === 'P2' ? 'rgb(var(--sev-warn-rgb) / 0.25)' : priorityFilter === 'P3' ? 'rgb(var(--spm-text-muted-rgb) / 0.25)' : 'rgb(var(--sev-ok-rgb) / 0.25)', borderColor: priorityFilter === 'P1' ? 'color-mix(in srgb, var(--sev-critical) 50%, transparent)' : priorityFilter === 'P2' ? 'color-mix(in srgb, var(--sev-warn) 50%, transparent)' : priorityFilter === 'P3' ? 'color-mix(in srgb, var(--spm-text-muted) 50%, transparent)' : 'color-mix(in srgb, var(--sev-ok) 50%, transparent)', color: priorityFilter === 'P1' ? 'var(--sev-critical)' : priorityFilter === 'P2' ? 'var(--sev-warn)' : priorityFilter === 'P3' ? 'var(--spm-text-muted)' : 'var(--sev-ok)' }}
              >
                Priority: {priorityFilter}
                <button type="button" onClick={() => setPriorityFilter(null)} className="ml-0.5 hover:text-rmpg-100 transition-colors" aria-label="Clear priority filter">&times;</button>
              </span>
            )}
            {typeFilter && (
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[8px] font-bold border rounded-sm text-brand-300 border-brand-700/50 bg-brand-900/20">
                Type: {formatIncidentType(typeFilter)}
                <button type="button" onClick={() => setTypeFilter(null)} className="ml-0.5 hover:text-rmpg-100 transition-colors" aria-label="Clear type filter">&times;</button>
              </span>
            )}
            {signalFilter && (
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[8px] font-bold border rounded-sm text-purple-300 border-purple-700/50 bg-purple-900/20">
                Signal: {signalFilter === 'signaled' ? 'Has code' : 'No code'}
                <button type="button" onClick={() => setSignalFilter(null)} className="ml-0.5 hover:text-rmpg-100 transition-colors" aria-label="Clear signal filter">&times;</button>
              </span>
            )}
            <button
              type="button"
              onClick={() => { setPriorityFilter(null); setTypeFilter(null); setSignalFilter(null); }}
              className="ml-auto text-[8px] text-rmpg-500 hover:text-rmpg-300 transition-colors underline"
            >
              Clear All
            </button>
          </div>
        )}

        {/* Call List */}
        <div className="flex-1 min-h-0 overflow-y-auto p-2 space-y-1" style={{ scrollbarGutter: 'stable', scrollSnapType: 'y proximity', WebkitOverflowScrolling: 'touch', overscrollBehavior: 'contain' } as React.CSSProperties}>
          {filteredCalls.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-[var(--spm-text-muted)]">
              <div className="p-3.5 rounded-sm mb-3" style={{ background: 'color-mix(in srgb, var(--surface-sunken) 31%, transparent)', border: '1px solid color-mix(in srgb, var(--spm-border) 19%, transparent)' }}>
                <Phone className="w-7 h-7" style={{ opacity: 0.35 }} />
              </div>
              <p className="text-[11px] font-semibold uppercase tracking-wider mb-1.5">
                {(priorityFilter || typeFilter || signalFilter) ? 'No calls match active filters' : 'No calls in this category'}
              </p>
              <p className="text-[10px] text-[var(--spm-text-muted)] max-w-[240px] text-center leading-relaxed">
                {(priorityFilter || typeFilter || signalFilter) ? (
                  <button type="button" onClick={() => { setPriorityFilter(null); setTypeFilter(null); setSignalFilter(null); }} className="underline hover:text-rmpg-300 transition-colors">Clear filters</button>
                ) : filterTab === 'pending' ? 'All pending calls have been dispatched' :
                 filterTab === 'active' ? 'No units are currently on active calls' :
                 filterTab === 'hold' ? 'No calls on hold' :
                 filterTab === 'cleared' ? 'No cleared calls to review' :
                 filterTab === 'archived' ? 'No archived calls found' :
                 filterTab === 'serve' ? 'No process service requests in queue' :
                 'Press N to create a new call'}
              </p>
              {filterTab === 'queue' && (
                <button type="button"
                  onClick={() => { setTemplateInitialData(undefined); setShowNewCallModal(true); }}
                  className="mt-4 toolbar-btn toolbar-btn-primary text-[10px]"
                >
                  <Plus style={{ width: 10, height: 10 }} /> New Call
                </button>
              )}
            </div>
          ) : (
            <>
            {filterTab === 'serve' && <PsoWorkloadPanel />}
            {filteredCalls.map((call, i) => {
              // GEO sort groups calls by section → zone → beat; render a sticky
              // district header before the first call of each new section so a
              // dispatcher can scan and work one district at a time.
              const showSectionDivider =
                sortMode === 'geo' &&
                (i === 0 || (filteredCalls[i - 1]?.sector_name || '') !== (call.sector_name || ''));
              const sectionCode = sectionPrefix(call.zone_id);
              const sectionLabel = call.sector_name || 'Unassigned';
              return (
                <React.Fragment key={call.id}>
                  {showSectionDivider && (
                    <div className="sticky top-0 z-10 flex items-center gap-1.5 px-2 py-0.5 bg-[var(--surface-sunken)] border-y border-amber-900/30 text-[9px] font-bold uppercase tracking-wider text-amber-400/90">
                      <MapPin className="w-3 h-3" />
                      {sectionCode ? `${sectionCode} · ${sectionLabel}` : sectionLabel}
                    </div>
                  )}
                  <CallCard
                    call={call}
                    isSelected={selectedCall?.id === call.id}
                    onClick={setSelectedCall}
                    onUnitDrop={handleDragAssignUnit}
                    onStatusChange={(callId, newStatus) => {
                      // 'closed'/'cleared' require a disposition server-side
                      // (calls.ts POST /:id/status) — route the card's quick
                      // Close button through the same select+prompt flow as
                      // every other clear action instead of calling the
                      // status endpoint bare, which now 400s.
                      if (newStatus === 'closed' || newStatus === 'cleared') {
                        setSelectedCall(call);
                        handleClearWithDisposition(callId);
                        return;
                      }
                      handleStatusChange(callId, newStatus as CallStatus);
                    }}
                    onContextMenu={(e, c) => setContextMenu({ x: e.clientX, y: e.clientY, call: c })}
                    stackCount={call.location ? stackedCallCounts.get(call.location.toLowerCase().trim()) : undefined}
                    onQuickNote={handleQuickNote}
                    hasIntelHit={hitCallIds.has(call.id)}
                    warnings={deriveCallWarnings(call)}
                    onTogglePin={handleTogglePin}
                    signalInfo={signalLookup(call.incident_type || '') || null}
                  />
                </React.Fragment>
              );
            })}
            </>
          )}
        </div>
        </>)}
      </div>

      {/* ============================================================ */}
      {/* RIGHT PANEL - Call Detail + Map (top), USB (bottom shorter) */}
      {/* ============================================================ */}
      <div className="flex-1 flex min-w-0">
      <div className="flex-1 flex flex-col min-w-0">
        {/* ------------------------------------------------------------ */}
        {/* TOP - Call Detail (left) + Map (right) — ~65% height */}
        {/* ------------------------------------------------------------ */}
        <div className="flex-1 flex border-b border-[var(--spm-border)] min-h-0">
          {/* Call Detail Panel */}
          <div ref={callDetailRef} className={`flex-1 min-h-0 flex flex-col overflow-hidden min-w-0${isEditing ? ' edit-mode-active' : ''}`}>
          {selectedCall ? (
            <>
              {/* Detail Header — PanelTitleBar style */}
              <div className="flex-shrink-0" style={selectedCall.priority === 'P1' ? { borderLeft: '3px solid var(--sev-critical)', background: 'linear-gradient(90deg, rgb(var(--sev-critical-rgb) / 0.08) 0%, transparent 30%)' } : selectedCall.priority === 'P2' ? { borderLeft: '3px solid var(--sev-warn)' } : { borderLeft: '3px solid var(--spm-text-muted)' }}>
                {/* Row 1: Call identification */}
                <div className="panel-title-bar flex items-center gap-2" style={{ borderBottom: 'none' }}>
                  {selectedCall.priority === 'P1' && (
                    <AlertTriangle className="w-4 h-4 text-red-500 animate-emergency-blink shrink-0" style={{ filter: 'drop-shadow(0 0 4px rgb(var(--sev-critical-rgb) / 0.5))' }} />
                  )}
                  <span
                    className="text-sm font-bold text-green-400 font-mono tracking-wide tabular-nums whitespace-nowrap cursor-pointer hover:text-green-300 transition-colors"
                    style={{ textShadow: '0 0 8px rgb(var(--sev-ok-rgb) / 0.2)' }}
                    title="Click to copy"
                    onClick={(e) => { e.stopPropagation(); navigator.clipboard.writeText(selectedCall.call_number || ''); addToast(`Copied ${selectedCall.call_number}`, 'success'); }}
                  >{selectedCall.call_number}</span>
                  {/* Case Number — editable by admin/manager */}
                  {(selectedCall.case_number || isAdminOrManager) && (
                    editingTimestamp === 'case_number' ? (
                      <input
                        type="text"
                        className="input-dark text-[10px] font-mono font-bold px-1.5 py-0.5 w-[160px]"
                        defaultValue={selectedCall.case_number || ''}
                        placeholder="Enter case number..."
                        autoFocus
                        onKeyDown={async (e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            const val = (e.target as HTMLInputElement).value.trim();
                            try {
                              const result = await apiFetch<any>(`/dispatch/calls/${selectedCall.id}`, { method: 'PUT', body: JSON.stringify({ case_number: val || null }) });
                              const updated = mergeCallUpdate(selectedCall, result);
                              setCalls(prev => prev.map(c => c.id === updated.id ? updated : c));
                              setSelectedCall(updated);
                              addToast(val ? `Case number set to ${val}` : 'Case number cleared', 'success');
                            } catch (err: any) {
                              addToast(err?.message || 'Failed to update case number', 'error');
                            }
                            setEditingTimestamp(null);
                          }
                          if (e.key === 'Escape') setEditingTimestamp(null);
                        }}
                        onBlur={async (e) => {
                          // Save on blur (don't discard changes)
                          const val = e.target.value.trim();
                          if (val !== (selectedCall.case_number || '')) {
                            try {
                              const result = await apiFetch<any>(`/dispatch/calls/${selectedCall.id}`, { method: 'PUT', body: JSON.stringify({ case_number: val || null }) });
                              const updated = mergeCallUpdate(selectedCall, result);
                              setCalls(prev => prev.map(c => c.id === updated.id ? updated : c));
                              setSelectedCall(updated);
                            } catch (err: any) {
                              // Was deliberately /* silent on blur */ but an
                              // unreported failure on a documented audit-trail
                              // field meant the operator believed the value
                              // persisted when in fact it didn't.
                              addToast(err?.message || 'Failed to update case number — change not persisted', 'error');
                            }
                          }
                          setEditingTimestamp(null);
                        }}
                      />
                    ) : (
                      <span
                        className={`text-[10px] font-bold font-mono px-1.5 py-0.5 whitespace-nowrap ${selectedCall.case_number ? 'text-amber-300 bg-amber-900/30 border border-amber-700/40' : 'text-rmpg-600 border border-dashed border-rmpg-600/40'} ${isAdminOrManager ? 'cursor-pointer hover:brightness-125' : ''}`}
                        onClick={() => isAdminOrManager && setEditingTimestamp('case_number')}
                        title={isAdminOrManager ? 'Click to edit case number' : undefined}
                      >
                        {selectedCall.case_number ? `CASE ${selectedCall.case_number}` : isAdminOrManager ? '+ CASE #' : ''}
                      </span>
                    )
                  )}
                  {/* Incident Number — editable by admin/manager */}
                  {(selectedCall.incident_number || isAdminOrManager) && (
                    editingTimestamp === 'incident_number' ? (
                      <input
                        type="text"
                        className="input-dark text-[10px] font-mono font-bold px-1.5 py-0.5 w-[160px]"
                        defaultValue={selectedCall.incident_number || ''}
                        placeholder="Incident #"
                        autoFocus
                        onKeyDown={async (e) => {
                          if (e.key === 'Enter') {
                            const val = (e.target as HTMLInputElement).value.trim();
                            try {
                              // BUG FIX (2026-06-21 audit): this editor is the
                              // incident_number field but the body used to send
                              // { case_number: val }. The server overwrote
                              // case_number with the incident value, the displayed
                              // incident_number never updated, and the operator
                              // saw a green "Linked to incident X" toast for an
                              // action that silently corrupted the CAD-RMS link.
                              const result = await apiFetch<any>(`/dispatch/calls/${selectedCall.id}`, { method: 'PUT', body: JSON.stringify({ incident_number: val || null }) });
                              const updated = mergeCallUpdate(selectedCall, result);
                              setCalls(prev => prev.map(c => c.id === updated.id ? updated : c));
                              setSelectedCall(updated);
                              addToast(val ? `Linked to incident ${val}` : 'Incident link cleared', 'success');
                            } catch (err: any) {
                              addToast(err?.message || 'Failed to update incident link', 'error');
                            }
                            setEditingTimestamp(null);
                          }
                          if (e.key === 'Escape') setEditingTimestamp(null);
                        }}
                        onBlur={async (e) => {
                          const val = e.target.value.trim();
                          if (val !== (selectedCall.incident_number || '')) {
                            try {
                              const result = await apiFetch<any>(`/dispatch/calls/${selectedCall.id}`, { method: 'PUT', body: JSON.stringify({ incident_number: val || null }) });
                              const updated = mergeCallUpdate(selectedCall, result);
                              setCalls(prev => prev.map(c => c.id === updated.id ? updated : c));
                              setSelectedCall(updated);
                              addToast(val ? `Linked to incident ${val}` : 'Incident link cleared', 'success');
                            } catch (err: any) {
                              // Was deliberately /* silent on blur */ — but a
                              // silent failure on a documented audit-trail
                              // field meant the operator tabbed away thinking
                              // the value persisted. Audit caught this.
                              addToast(err?.message || 'Failed to update incident link — change not persisted', 'error');
                            }
                          }
                          setEditingTimestamp(null);
                        }}
                      />
                    ) : selectedCall.incident_number ? (
                      <span
                        className={`text-[10px] font-bold font-mono text-rmpg-300 bg-surface-sunken/30 border border-border-default/40 px-1.5 py-0.5 whitespace-nowrap cursor-pointer hover:brightness-125 hover:text-rmpg-200 transition-colors`}
                        onClick={(e) => {
                          if (isAdminOrManager && e.shiftKey) {
                            setEditingTimestamp('incident_number');
                          } else {
                            // Navigate to incident
                            window.open(`/incidents?search=${encodeURIComponent(selectedCall.incident_number!)}`, '_blank');
                          }
                        }}
                        title={isAdminOrManager ? 'Click to view incident (Shift+click to edit)' : 'Click to view incident'}
                      >
                        <Link style={{ width: 8, height: 8, display: 'inline', verticalAlign: 'middle', marginRight: 2 }} />
                        INC {selectedCall.incident_number}
                      </span>
                    ) : null
                  )}
                  <StatusBadge status={selectedCall.priority} type="priority" size="sm" title={humanizePriority(selectedCall.priority)} />
                  <StatusBadge status={selectedCall.status} type="call_status" size="sm" title={getStatusTooltip(selectedCall.status, 'call')} />
                  {callWarnings.length > 0 && (
                    <span className="flex items-center gap-1 px-1.5 py-0.5 text-[9px] font-bold font-mono text-red-400 bg-red-900/30 border border-red-700/50 animate-pulse whitespace-nowrap">
                      <AlertTriangle style={{ width: 9, height: 9 }} /> {callWarnings.length} ALERT{callWarnings.length !== 1 ? 'S' : ''}
                    </span>
                  )}
                  {/* On-scene live timer */}
                  {onSceneElapsed && (
                    <span className="ml-auto flex items-center gap-1 px-1.5 py-0.5 text-[9px] font-bold font-mono text-purple-300 bg-purple-900/20 border border-purple-700/30 whitespace-nowrap tabular-nums" title="Time on scene">
                      <Clock style={{ width: 9, height: 9 }} /> On scene: {onSceneElapsed}
                    </span>
                  )}
                  {/* Total elapsed timer (since call creation) */}
                  {selectedCall.created_at && !TERMINAL_STATUSES.has(selectedCall.status) && (() => {
                    const mins = Math.round((Date.now() - parseTimestamp(selectedCall.created_at).getTime()) / 60000);
                    const colorCls = mins > 60 ? 'text-red-400 bg-red-900/20 border border-red-700/30'
                      : mins > 30 ? 'text-amber-400 bg-amber-900/20 border border-amber-700/30'
                      : 'text-rmpg-400 bg-rmpg-900/20 border border-rmpg-700/30';
                    return (
                      <span className={`${onSceneElapsed ? '' : 'ml-auto'} flex items-center gap-1 px-1.5 py-0.5 text-[9px] font-bold font-mono whitespace-nowrap tabular-nums ${colorCls}`} title="Total call duration">
                        <Clock style={{ width: 9, height: 9 }} />
                        {mins >= 60 ? `${Math.floor(mins / 60)}h ${mins % 60}m` : `${mins}m`}
                      </span>
                    );
                  })()}
                </div>
                {/* Workflow status pipeline — compact horizontal progress track showing
                    the call lifecycle. Clickable steps advance the status directly so
                    a dispatcher can progress a call without hunting for a button in
                    the overflow toolbar. Archived/cancelled/closed are terminal and
                    shown with a distinct visual treatment. */}
                {!isEditing && (() => {
                  const currentIdx = WORKFLOW_PIPELINE.findIndex(p => p.status === selectedCall.status);
                  const isTerminal = PIPELINE_TERMINAL_STATUSES.has(selectedCall.status);
                  return (
                    <div
                      className="flex items-center px-2 py-1 border-b border-[var(--spm-border)] gap-0 overflow-x-auto"
                      style={{ background: 'var(--surface-deep)' }}
                      role="progressbar"
                      aria-label={`Call status: ${selectedCall.status}`}
                    >
                      {isTerminal ? (
                        <span className="text-[8px] font-bold font-mono uppercase tracking-wider px-2 py-0.5"
                          style={{ color: selectedCall.status === 'cancelled' ? 'var(--sev-critical)' : selectedCall.status === 'on_hold' ? 'var(--sev-warn)' : 'var(--spm-text-muted)' }}>
                          ● {selectedCall.status.toUpperCase().replace('_', ' ')}
                        </span>
                      ) : WORKFLOW_PIPELINE.map((step, idx) => {
                        const isPast = currentIdx > idx;
                        const isCurrent = currentIdx === idx;
                        const canAdvance = isCurrent && WORKFLOW_NEXT_STATUS[step.status] && !['cleared', 'closed'].includes(step.status);
                        const color = isCurrent
                          ? step.status === 'pending' ? 'var(--sev-warn)' : step.status === 'onscene' ? 'var(--sev-special)' : 'var(--brand-gold)'
                          : isPast ? 'var(--sev-ok)' : 'var(--spm-text-muted)';
                        return (
                          <React.Fragment key={step.status}>
                            <button
                              type="button"
                              disabled={!canAdvance}
                              onClick={canAdvance ? () => handleStatusChange(selectedCall.id, WORKFLOW_NEXT_STATUS[step.status] as any) : undefined}
                              title={canAdvance ? `Advance to ${WORKFLOW_NEXT_STATUS[step.status]}` : step.label}
                              className="flex items-center gap-1 px-1.5 py-0.5 text-[7px] font-bold font-mono uppercase tracking-wider whitespace-nowrap transition-all flex-shrink-0"
                              style={{
                                color,
                                background: isCurrent ? `rgb(var(--brand-gold-rgb) / 0.08)` : 'transparent',
                                border: isCurrent ? `1px solid ${color}` : '1px solid transparent',
                                opacity: !isPast && !isCurrent ? 0.35 : 1,
                                cursor: canAdvance ? 'pointer' : 'default',
                              }}
                            >
                              {isPast && <span style={{ fontSize: '9px' }}>✓</span>}
                              {isCurrent && <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: color, flexShrink: 0 }} />}
                              {step.short}
                            </button>
                            {idx < WORKFLOW_PIPELINE.length - 1 && (
                              <span className="text-[8px] flex-shrink-0" style={{ color: isPast ? 'var(--sev-ok)' : 'var(--spm-text-muted)', opacity: 0.4 }}>›</span>
                            )}
                          </React.Fragment>
                        );
                      })}
                      <span className="ml-auto text-[7px] font-mono text-rmpg-600 flex-shrink-0 pl-2">
                        {currentIdx >= 0 ? `${currentIdx + 1}/${WORKFLOW_PIPELINE.length}` : ''}
                      </span>
                    </div>
                  );
                })()}
                {/* Row 2: Action buttons — separate row to prevent cramping.
                    This row used to be `overflow-x-auto` with a mask-image fade
                    hinting that more buttons existed off to the right. The
                    2026-07-24 live audit measured the result: 419px of visible
                    row against 1419px of content, so 5 of 18 controls were
                    reachable and 13 — Edit, NCIC, Citation, Archive, Delete
                    among them — were only findable by discovering that a
                    hairline scrollbar existed. The fade communicated the
                    problem; it did not solve it.

                    ToolbarOverflow measures the row and moves whatever does not
                    fit into a "More" menu, so nothing is ever unreachable at any
                    viewport. The button JSX below is unchanged and still owns
                    all of its own call-state conditionals — each top-level
                    expression is one overflow item, so a `<>Save + Cancel</>`
                    pair travels together. PrintRecordButton is pinned inline: it
                    owns a preview modal and must not remount on resize. */}
                <ToolbarOverflow
                  pinnedCount={1}
                  className="flex items-center gap-1.5 px-2 py-1 border-b border-[var(--spm-border)] whitespace-nowrap"
                  style={{ background: 'var(--surface-deep)' }}
                >
                  {isEditing ? (
                    // While editing, the in-form values aren't yet on selectedCall,
                    // so a print right now would generate a PDF missing whatever
                    // the dispatcher just typed. Block printing until SAVE so
                    // operators get a clear cue rather than a silently-incomplete PDF.
                    <button
                      type="button"
                      disabled
                      className="toolbar-btn opacity-50 cursor-not-allowed"
                      title="Save your edits before printing — the PDF reads from the saved record, not the in-progress form"
                    >
                      <Printer style={{ width: 10, height: 10 }} /> Print (save first)
                    </button>
                  ) : (
                    <PrintRecordButton
                      recordType="call"
                      recordData={{
                        ...applyCallPdfAutofill(selectedCall),
                        // Enrich with unit detail table for PDF
                        assigned_units_detail: (selectedCall?.assigned_units || []).map((uid: string) => {
                          const u = units.find(unit => String(unit.id) === String(uid));
                          return {
                            call_sign: u?.call_sign || uid,
                            officer_name: u?.officer_name || '',
                            badge_number: (u as any)?.badge_number || (officers.find(o => o.full_name === u?.officer_name)?.badge_number) || '',
                            status: u?.status || '',
                          };
                        }),
                        // Linked persons for PDF table
                        linked_persons: callPersons.map((cp: any) => ({
                          role: cp.role || '',
                          first_name: cp.first_name || '',
                          last_name: cp.last_name || '',
                          dob: cp.dob || '',
                          race: cp.race || '',
                          gender: cp.gender || cp.sex || '',
                          phone: cp.phone || '',
                        })),
                        // Linked vehicles for PDF table
                        linked_vehicles: callVehicles.map((cv: any) => ({
                          role: cv.role || '',
                          plate_number: cv.plate_number || '',
                          plate_state: cv.plate_state || '',
                          year: cv.year,
                          color: cv.color || '',
                          make: cv.make || '',
                          model: cv.model || '',
                          vin: cv.vin || '',
                          owner_first_name: cv.owner_first_name || '',
                          owner_last_name: cv.owner_last_name || '',
                          stolen_status: cv.stolen_status || '',
                        })),
                        // Map CallNote -> PDF notes format (text→content, timestamp→created_at)
                        notes: selectedCall?.notes?.map((n: any) => ({
                          id: n.id,
                          author: n.author || 'System',
                          content: n.text || '',
                          created_at: n.timestamp || '',
                        })),
                        // Pass action_taken, cross_street, description for PDF
                        action_taken: selectedCall?.action_taken || '',
                        cross_street: selectedCall?.cross_street || '',
                        description: selectedCall?.description || '',
                        // Build narrative from notes for PDF
                        narrative: selectedCall?.notes?.map((n: any) =>
                          `[${n.timestamp ? formatTime(n.timestamp) : ''}] ${n.author || 'System'}: ${n.text || ''}`
                        ).join('\n') || '',
                      }}
                      identifier={selectedCall?.call_number}
                      entityType="call"
                      entityId={selectedCall?.id}
                      label="Print"
                    />
                  )}
                    {/* Edit toggle */}
                    {!isEditing && (
                      <button type="button" onClick={startEditing} className="toolbar-btn" title="Edit call details">
                        <Edit3 style={{ width: 10, height: 10 }} /> Edit
                      </button>
                    )}
                    {isEditing && (
                      <>
                        <button type="button" onClick={saveEditing} disabled={isSaving} className="toolbar-btn toolbar-btn-primary">
                          {isSaving ? <Loader2 style={{ width: 10, height: 10 }} className="animate-spin" /> : <Save style={{ width: 10, height: 10 }} />} Save
                        </button>
                        <button type="button" onClick={cancelEditing} disabled={isSaving} className="toolbar-btn">
                          <X style={{ width: 10, height: 10 }} /> Cancel
                        </button>
                      </>
                    )}
                    {/* NCIC Terminal button */}
                    {!isEditing && (
                      <button type="button"
                        onClick={() => setShowNcicPanel(true)}
                        className="toolbar-btn"
                        title="NCIC / NLETS Query Terminal"
                        style={{ color: 'var(--sev-ok)' }}
                      >
                        <Terminal style={{ width: 10, height: 10 }} /> NCIC
                      </button>
                    )}
                    {/* Route Builder — navigate to multi-stop CFS route planner for assigned units */}
                    {!isEditing && (selectedCall.assigned_units || []).length > 0 && (
                      <button type="button"
                        className="toolbar-btn"
                        title="Open Route Builder for assigned unit"
                        style={{ color: 'var(--brand-gold)' }}
                        onClick={() => {
                          const firstUnitId = selectedCall.assigned_units?.[0];
                          if (!firstUnitId) return;
                          navigate(`/route-builder?unit=${encodeURIComponent(String(firstUnitId))}`);
                        }}
                      >
                        <Route style={{ width: 10, height: 10 }} /> Route
                      </button>
                    )}
                    {/* Schedule Return Visit — PSO/Process Service calls in completed states */}
                    {!isEditing && ['pso_client_request', 'process_service'].includes(selectedCall.incident_type) && INACTIVE_STATUSES.has(selectedCall.status) && (
                      <button type="button"
                        className="toolbar-btn"
                        style={{ background: 'rgb(var(--brand-gold-rgb) / 0.15)', borderColor: 'rgb(var(--brand-gold-rgb) / 0.31)', color: 'var(--brand-gold)' }}
                        onClick={() => {
                          const attempt = (selectedCall.pso_attempt_number || 1) + 1;
                          const ordinal = formatOrdinal(attempt);
                          setPendingConfirm({
                            title: 'Schedule Return Visit',
                            message: `Schedule ${ordinal} return visit for ${selectedCall.call_number}?`,
                            confirmLabel: 'Schedule Visit',
                            run: async () => {
                              try {
                                const result = await apiFetch(`/dispatch/calls/${selectedCall.id}/redispatch`, {
                                  method: 'POST',
                                  body: JSON.stringify({}),
                                });
                                if (result) {
                                  const mapped = mapDbCall(result);
                                  setCalls(prev => [mapped, ...prev]);
                                  setSelectedCall(mapped);
                                  addToast(`Re-dispatched → ${mapped.call_number}`, 'success');
                                }
                              } catch (err: any) { addToast(`Re-dispatch failed: ${err?.message || 'Unknown error'}`, 'error'); }
                            },
                          });
                        }}
                        title="Schedule a return visit — creates a new linked call"
                      >
                        <RotateCcw style={{ width: 10, height: 10 }} /> Return Visit
                      </button>
                    )}
                    {/* Notice of Communication — PSO client requests with a failed attempt
                        being re-dispatched. Autofills from this call (client, service,
                        attempt) into a printable client notice. */}
                    {!isEditing && PROCESS_SERVICE_INCIDENT_TYPES.has(selectedCall.incident_type) && INACTIVE_STATUSES.has(selectedCall.status) && (
                      <button type="button"
                        className="toolbar-btn"
                        style={{ background: 'color-mix(in srgb, var(--sev-info) 15%, transparent)', borderColor: 'color-mix(in srgb, var(--sev-info) 31%, transparent)', color: 'var(--sev-info)' }}
                        onClick={() => openPsoNotice(selectedCall)}
                        title="Generate an autofilled Notice of Communication for the client (unsuccessful attempt → re-dispatch)"
                      >
                        <FileText style={{ width: 10, height: 10 }} /> Notice of Comm
                      </button>
                    )}
                    {/* Undo Return Visit — only on pending child calls */}
                    {!isEditing && selectedCall.parent_call_id && selectedCall.status === 'pending' && (
                      <button type="button"
                        className="toolbar-btn"
                        style={{ background: 'color-mix(in srgb, var(--sev-critical) 13%, transparent)', borderColor: 'color-mix(in srgb, var(--sev-critical) 31%, transparent)', color: 'var(--sev-critical)' }}
                        onClick={() => {
                          setPendingConfirm({
                            title: 'Undo Return Visit',
                            message: `Undo this return visit? This will delete ${selectedCall.call_number} and restore the parent call.`,
                            confirmLabel: 'Undo Visit',
                            run: async () => {
                              try {
                                const result = await apiFetch<any>(`/dispatch/calls/${selectedCall.id}/undo-redispatch`, { method: 'POST' });
                                if (result?.parent) {
                                  const mapped = mapDbCall(result.parent);
                                  setCalls(prev => prev.filter(c => c.id !== selectedCall.id).map(c => c.id === mapped.id ? mapped : c));
                                  setSelectedCall(mapped);
                                  addToast(`Return visit undone — restored ${mapped.call_number}`, 'success');
                                }
                              } catch (err: any) { addToast(`Failed to undo: ${err?.message || 'Unknown error'}`, 'error'); }
                            },
                          });
                        }}
                        title="Undo this return visit and delete this call"
                      >
                        <Undo2 style={{ width: 10, height: 10 }} /> Undo Visit
                      </button>
                    )}
                    {/* Send to Serve Queue — PSO calls */}
                    {PROCESS_SERVICE_INCIDENT_TYPES.has(selectedCall.incident_type) && !serveLink && (
                      <button type="button"
                        className="toolbar-btn"
                        style={{ background: 'color-mix(in srgb, var(--sev-special) 13%, transparent)', borderColor: 'color-mix(in srgb, var(--sev-special) 31%, transparent)', color: 'var(--sev-special-soft)' }}
                        disabled={sendingToServe}
                        onClick={async () => {
                          setSendingToServe(true);
                          try {
                            const result = await apiFetch(`/dispatch/calls/${selectedCall.id}/send-to-serve`, {
                              method: 'POST',
                              body: JSON.stringify({}),
                            });
                            if (result) {
                              setServeLink(result);
                              addToast('Sent to Serve Queue', 'success');
                            }
                          } catch (err: any) {
                            addToast(`Failed: ${err?.message || 'Unknown error'}`, 'error');
                          } finally {
                            setSendingToServe(false);
                          }
                        }}
                        title="Send this process service to the serve queue"
                      >
                        <Briefcase style={{ width: 10, height: 10 }} /> {sendingToServe ? 'Sending...' : 'Serve Queue'}
                      </button>
                    )}
                    {/* Report Issue — create a work order from this call */}
                    {!isEditing && (
                      <button type="button"
                        className="toolbar-btn"
                        style={{ background: 'color-mix(in srgb, var(--sev-warn) 13%, transparent)', borderColor: 'color-mix(in srgb, var(--sev-warn) 31%, transparent)', color: 'var(--sev-warn)' }}
                        disabled={reportingIssue}
                        onClick={() => {
                          setPendingConfirm({
                            title: 'Report Mechanical Issue',
                            message: `Report a mechanical issue from Call ${selectedCall.call_number}? This will create a work order.`,
                            confirmLabel: 'Create Work Order',
                            run: async () => {
                              setReportingIssue(true);
                              try {
                                const result = await apiFetch<{ data: { id: number } }>(`/dispatch/calls/${selectedCall.id}/report-issue`, {
                                  method: 'POST',
                                  body: JSON.stringify({
                                    summary: `Mechanical issue reported from Call #${selectedCall.call_number}`,
                                  }),
                                });
                                if (result) {
                                  addToast(`Work order #${result.data?.id ?? ''} created`, 'success');
                                }
                              } catch (err: any) {
                                addToast(`Failed: ${err?.message || 'Unknown error'}`, 'error');
                              } finally {
                                setReportingIssue(false);
                              }
                            },
                          });
                        }}
                        title="Create a work order from this call"
                      >
                        <Wrench style={{ width: 10, height: 10 }} /> {reportingIssue ? 'Creating...' : 'Report Issue'}
                      </button>
                    )}
                    {/* Revert status button — go back one step */}
                    {!isEditing && POST_DISPATCH_STATUSES.has(selectedCall.status) && (
                      <button type="button"
                        onClick={() => handleRevertStatus(selectedCall.id)}
                        className="toolbar-btn"
                        title={`Revert to previous status`}
                        style={{ color: 'var(--sev-warn)' }}
                      >
                        <Undo2 style={{ width: 10, height: 10 }} /> Back
                      </button>
                    )}
                    {/* Status action toolbar buttons */}
                    {!isEditing && selectedCall.status === 'pending' && (
                      <>
                        <button type="button" onClick={() => handleStatusChange(selectedCall.id, 'dispatched')} className="toolbar-btn toolbar-btn-primary">
                          <Send style={{ width: 10, height: 10 }} /> Dispatch
                        </button>
                        <button type="button" onClick={() => handleStatusChange(selectedCall.id, 'cancelled')} className="toolbar-btn" style={{ color: 'var(--sev-critical)' }}>
                          <XCircle style={{ width: 10, height: 10 }} /> Cancel
                        </button>
                      </>
                    )}
                    {!isEditing && selectedCall.status === 'dispatched' && (
                      <button type="button" onClick={() => handleStatusChange(selectedCall.id, 'enroute')} className="toolbar-btn toolbar-btn-primary">
                        <Navigation style={{ width: 10, height: 10 }} /> En Route
                      </button>
                    )}
                    {!isEditing && selectedCall.status === 'enroute' && (
                      <button type="button" onClick={() => handleStatusChange(selectedCall.id, 'onscene')} className="toolbar-btn toolbar-btn-primary">
                        <Eye style={{ width: 10, height: 10 }} /> On Scene
                      </button>
                    )}
                    {!isEditing && ACTIVE_FIELD_STATUSES.has(selectedCall.status) && (
                      <>
                        <button type="button" onClick={() => handleClearWithDisposition(selectedCall.id)} className="toolbar-btn">
                          <CheckCircle style={{ width: 10, height: 10 }} /> Clear
                        </button>
                        <button type="button" onClick={() => handleHoldCall(selectedCall.id)} className="toolbar-btn" style={{ color: 'var(--sev-warn)' }}>
                          ⏸ Hold
                        </button>
                        <button type="button" onClick={() => handleStatusChange(selectedCall.id, 'cancelled')} className="toolbar-btn" style={{ color: 'var(--sev-critical)' }}>
                          <XCircle style={{ width: 10, height: 10 }} /> Cancel
                        </button>
                      </>
                    )}
                    {!isEditing && selectedCall.status === 'on_hold' && (
                      <button type="button" onClick={() => handleResumeCall(selectedCall.id)} className="toolbar-btn toolbar-btn-primary" style={{ background: 'var(--sev-warn)', color: 'var(--surface-base)' }}>
                        ▶ Resume
                      </button>
                    )}
                    {!isEditing && selectedCall.status === 'cleared' && (
                      <>
                        <button type="button" onClick={() => handleStatusChange(selectedCall.id, 'closed')} className="toolbar-btn">
                          Close
                        </button>
                        <button type="button" onClick={handleGenerateIncident} disabled={isGenerating} className="toolbar-btn toolbar-btn-primary">
                          {isGenerating ? <Loader2 style={{ width: 10, height: 10 }} className="animate-spin" /> : <FileText style={{ width: 10, height: 10 }} />}
                          Report
                        </button>
                      </>
                    )}
                    {!isEditing && selectedCall.status === 'closed' && (
                      <button type="button" onClick={handleGenerateIncident} disabled={isGenerating} className="toolbar-btn toolbar-btn-primary">
                        {isGenerating ? <Loader2 style={{ width: 10, height: 10 }} className="animate-spin" /> : <FileText style={{ width: 10, height: 10 }} />}
                        Report
                      </button>
                    )}
                    {/* LE Notification */}
                    {!isEditing && !selectedCall.le_notified && selectedCall.status !== 'archived' && (
                      <button type="button" onClick={() => handleLeNotify(selectedCall.id)} className="toolbar-btn" style={{ color: 'var(--sev-warn)' }}>
                        <Radio style={{ width: 10, height: 10 }} /> Notify LE
                      </button>
                    )}
                    {selectedCall.le_notified && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider rounded-sm" style={{ background: 'rgb(var(--sev-ok-rgb) / 0.15)', color: 'var(--sev-ok)', border: '1px solid rgb(var(--sev-ok-rgb) / 0.3)', boxShadow: '0 0 4px rgb(var(--sev-ok-rgb) / 0.1)' }}>
                        <span className="w-1.5 h-1.5 rounded-full" style={{ background: 'var(--sev-ok)', boxShadow: '0 0 3px color-mix(in srgb, var(--sev-ok) 50%, transparent)' }} />
                        LE NOTIFIED {selectedCall.le_agency ? `(${selectedCall.le_agency})` : ''}
                      </span>
                    )}
                    {/* Create Citation from this call */}
                    {!isEditing && (
                      <button
                        type="button"
                        onClick={() => {
                          const params = new URLSearchParams();
                          if (selectedCall.location) params.set('location', selectedCall.location);
                          if (selectedCall.latitude) params.set('lat', String(selectedCall.latitude));
                          if (selectedCall.longitude) params.set('lng', String(selectedCall.longitude));
                          params.set('call_id', selectedCall.id);
                          params.set('call_number', selectedCall.call_number);
                          navigate(`/citations?create=true&${params.toString()}`);
                        }}
                        className="toolbar-btn text-[9px]"
                        title="Create citation from this call"
                      >
                        <FileText style={{ width: 10, height: 10 }} /> Citation
                      </button>
                    )}
                    {/* Archive — available on any non-archived status */}
                    {!isEditing && selectedCall.status !== 'archived' && (
                      <button type="button" onClick={() => handleArchive(selectedCall.id)} className="toolbar-btn" title="Archive this call">
                        <Archive style={{ width: 10, height: 10 }} /> Archive
                      </button>
                    )}
                    {!isEditing && selectedCall.status === 'archived' && (
                      <button type="button" onClick={() => handleUnarchive(selectedCall.id)} className="toolbar-btn">
                        <RotateCcw style={{ width: 10, height: 10 }} /> Restore
                      </button>
                    )}
                    {/* Delete — available on any call */}
                    {!isEditing && (
                      <button type="button" onClick={() => setDeleteCallTarget(selectedCall)} className="toolbar-btn text-red-400 hover:text-red-300" title="Delete this call permanently">
                        <Trash2 style={{ width: 10, height: 10 }} /> Delete
                      </button>
                    )}
                </ToolbarOverflow>
                </div>

              {/* Warning Tags / Caution Alerts — always visible above tabs */}
              {callWarnings.length > 0 && (
                <div className="px-4 pt-2 pb-1.5 flex-shrink-0" style={{ background: 'rgb(var(--sev-critical-rgb) / 0.05)', borderBottom: '1px solid rgb(var(--sev-critical-rgb) / 0.15)' }}>
                  <label className="text-[9px] font-bold text-red-400 uppercase tracking-[0.1em] flex items-center gap-1.5 mb-1.5">
                    <AlertTriangle style={{ width: 10, height: 10, filter: 'drop-shadow(0 0 3px rgb(var(--sev-critical-rgb) / 0.4))' }} /> CAUTION / WARNINGS
                  </label>
                  <WarningTags warnings={callWarnings} />
                </div>
              )}

              {/* Call Duration + Response Time + Safety Summary — always visible above tabs */}
              {!isEditing && (
                <div className="px-4 py-1.5 flex items-center gap-3 flex-shrink-0 flex-wrap" style={{ background: 'var(--surface-deep)', borderBottom: '1px solid var(--spm-border)' }}>
                  {/* Call duration — running timer */}
                  <div className="flex items-center gap-1.5 text-[10px] font-mono tabular-nums">
                    <Clock style={{ width: 10, height: 10 }} className="text-rmpg-500" />
                    <span className="text-rmpg-400">Duration:</span>
                    <span className="text-rmpg-200 font-bold">
                      {formatCallDuration(computeCallDuration(selectedCall))}
                    </span>
                  </div>
                  {/* Response time — dispatched to on scene */}
                  {(() => { const rt = computeResponseTime(selectedCall); return rt == null ? null : (
                    <div className="flex items-center gap-1.5 text-[10px] font-mono tabular-nums">
                      <Navigation style={{ width: 10, height: 10 }} className="text-rmpg-500" />
                      <span className="text-rmpg-400">Response:</span>
                      <span className="text-rmpg-400 font-bold">{formatCallDuration(rt)}</span>
                    </div>
                  ); })()}
                  {/* On-scene time — onscene to cleared (or live if still on scene) */}
                  {(() => { const ost = computeOnSceneTime(selectedCall); return ost == null ? null : (
                    <div className="flex items-center gap-1.5 text-[10px] font-mono tabular-nums">
                      <Clock style={{ width: 10, height: 10 }} className="text-rmpg-500" />
                      <span className="text-rmpg-400">On-Scene:</span>
                      <span className="text-rmpg-400 font-bold">{formatCallDuration(ost)}</span>
                    </div>
                  ); })()}
                  {/* Safety flag summary — compact inline */}
                  {(() => {
                    const flags: string[] = [];
                    if (selectedCall.weapons_involved && selectedCall.weapons_involved !== 'None') flags.push('ARMED');
                    if (selectedCall.domestic_violence) flags.push('DV');
                    if (selectedCall.mental_health_crisis) flags.push('MH');
                    if (selectedCall.officer_safety_caution) flags.push('SAFETY');
                    if (selectedCall.felony_in_progress) flags.push('FELONY');
                    if (selectedCall.vehicle_pursuit || selectedCall.foot_pursuit) flags.push('PURSUIT');
                    if (selectedCall.ems_requested) flags.push('EMS');
                    if (selectedCall.injuries_reported) flags.push('INJ');
                    if (flags.length === 0) return null;
                    return (
                      <div className="flex items-center gap-1 ml-auto">
                        <AlertTriangle style={{ width: 10, height: 10 }} className="text-red-400" />
                        {flags.map(f => (
                          <span key={f} className="text-[8px] font-bold font-mono px-1 py-0" style={{ color: f === 'ARMED' || f === 'FELONY' ? 'var(--sev-critical-soft)' : f === 'DV' ? 'var(--sev-caution)' : f === 'MH' ? 'var(--sev-special-soft)' : f === 'PURSUIT' ? 'var(--sev-high)' : f === 'SAFETY' ? 'var(--sev-critical)' : 'var(--spm-text)', background: 'rgb(var(--sev-critical-rgb) / 0.1)', border: '1px solid rgb(var(--sev-critical-rgb) / 0.25)' }}>
                            {f}
                          </span>
                        ))}
                      </div>
                    );
                  })()}
                </div>
              )}

              {/* Detail Tabs — scrolls horizontally rather than wrapping (#3307).
                  Left/right fade + arrow buttons make that scroll discoverable:
                  Audit sits last, so on a narrower panel it could scroll fully
                  out of view with zero visual hint it existed — the reported
                  "Audit tab clipping" bug. canScrollTabsLeft/Right + the
                  scrollIntoView effect above keep the active tab reachable
                  and visible regardless of panel width. */}
              <div className="relative flex-shrink-0" style={{ background: 'var(--surface-deep)' }}>
                <div
                  ref={detailTabBarRef}
                  className="flex flex-nowrap overflow-x-auto border-b border-[var(--spm-border)] scroll-smooth"
                  style={{ scrollbarWidth: 'none' }}
                >
                  {(['info', 'persons', 'timeline', 'notes', 'documents', 'attachments', 'flags', 'audit'] as const).map(tab => {
                    const icons: Record<string, React.ReactNode> = {
                      info: <FileText style={{ width: 9, height: 9 }} />,
                      persons: <User style={{ width: 9, height: 9 }} />,
                      timeline: <Clock style={{ width: 9, height: 9 }} />,
                      notes: <MessageSquare style={{ width: 9, height: 9 }} />,
                      documents: <FileSignature style={{ width: 9, height: 9 }} />,
                      attachments: <FileText style={{ width: 9, height: 9 }} />,
                      flags: <Shield style={{ width: 9, height: 9 }} />,
                      audit: <Shield style={{ width: 9, height: 9 }} />,
                    };
                    const counts: Record<string, number> = {
                      persons: callPersons.length + callVehicles.length,
                      timeline: activityEntries.length,
                      notes: (selectedCall?.notes || []).length,
                      audit: auditTrail.length,
                    };
                    const count = counts[tab];
                    const isActive = detailTab === tab;
                    return (
                      <button type="button"
                        key={tab}
                        ref={(el) => { if (el) detailTabRefs.current[tab] = el; }}
                        aria-label={`${DETAIL_TAB_LABELS[tab]} tab`}
                        onClick={() => setDetailTab(tab)}
                        className="relative px-2.5 py-2 text-[10px] font-bold uppercase tracking-wide transition-all duration-150 flex-shrink-0 whitespace-nowrap"
                        style={{
                          color: isActive ? 'var(--spm-text)' : 'var(--spm-text-muted)',
                          background: isActive ? 'color-mix(in srgb, var(--surface-sunken) 60%, transparent)' : 'transparent',
                          borderBottom: isActive ? '2px solid var(--brand-gold)' : '2px solid transparent',
                        }}
                        onMouseEnter={(e) => { if (!isActive) { (e.currentTarget as HTMLElement).style.color = 'var(--spm-text)'; (e.currentTarget as HTMLElement).style.background = 'color-mix(in srgb, var(--surface-sunken) 40%, transparent)'; } }}
                        onMouseLeave={(e) => { if (!isActive) { (e.currentTarget as HTMLElement).style.color = 'var(--spm-text-muted)'; (e.currentTarget as HTMLElement).style.background = 'transparent'; } }}
                      >
                        <span className="flex items-center gap-1">
                          {icons[tab]}
                          {DETAIL_TAB_LABELS[tab]}
                          {count ? <span className="ml-0.5 min-w-[16px] text-center px-1 py-px text-[8px] rounded-sm font-mono tabular-nums" style={{ background: isActive ? 'color-mix(in srgb, var(--brand-gold) 20%, transparent)' : 'color-mix(in srgb, var(--spm-border) 19%, transparent)', color: isActive ? 'var(--spm-text)' : 'var(--spm-text-muted)' }}>{count}</span> : ''}
                        </span>
                      </button>
                    );
                  })}
                </div>
                {canScrollTabsLeft && (
                  <>
                    <div className="pointer-events-none absolute left-0 top-0 bottom-[2px] w-6" style={{ background: 'linear-gradient(to right, var(--surface-deep), transparent)' }} />
                    <button type="button" aria-label="Scroll tabs left"
                      onClick={() => detailTabBarRef.current?.scrollBy({ left: -120, behavior: 'smooth' })}
                      className="absolute left-0 top-0 bottom-[2px] flex items-center px-0.5"
                      style={{ background: 'color-mix(in srgb, var(--surface-deep) 70%, transparent)' }}
                    >
                      <ChevronLeft style={{ width: 12, height: 12, color: 'var(--spm-text-muted)' }} />
                    </button>
                  </>
                )}
                {canScrollTabsRight && (
                  <>
                    <div className="pointer-events-none absolute right-0 top-0 bottom-[2px] w-6" style={{ background: 'linear-gradient(to left, var(--surface-deep), transparent)' }} />
                    <button type="button" aria-label="Scroll tabs right"
                      onClick={() => detailTabBarRef.current?.scrollBy({ left: 120, behavior: 'smooth' })}
                      className="absolute right-0 top-0 bottom-[2px] flex items-center px-0.5"
                      style={{ background: 'color-mix(in srgb, var(--surface-deep) 70%, transparent)' }}
                    >
                      <ChevronRight style={{ width: 12, height: 12, color: 'var(--spm-text-muted)' }} />
                    </button>
                  </>
                )}
              </div>

              {/* Detail Body — Scrollable, tab-controlled. `.cad-detail-body`
                  applies the CAD board's dense monospace treatment (see
                  spillman-kit.css) via a scoped CSS rule rather than touching
                  every individual Tailwind class in this ~1500-line region. */}
              <div className="cad-detail-body flex-1 min-h-0 overflow-y-auto px-4 py-3 flex flex-col" style={SCROLL_CONTAIN_STYLE}>
                {/* ── CALL INFO SECTION (Info + Persons tab) ─── */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4 flex-shrink-0" style={{ display: detailTab === 'info' || detailTab === 'persons' ? undefined : 'none' }}>
                  {/* Left Column: Core Info */}
                  <div className="space-y-2">
                    <div>
                      <label className="field-label">Type:</label>
                      {isEditing ? (
                        <Combobox<{ value: string; label: string }>
                          value={editData.incident_type ? INCIDENT_TYPE_OPTIONS.find(o => o.value === editData.incident_type) ?? null : null}
                          onChange={(opt) => updateEditField('incident_type', opt?.value ?? '')}
                          options={INCIDENT_TYPE_OPTIONS}
                          getLabel={(o) => o.label}
                          getKey={(o) => o.value}
                          placeholder="Search incident type..."
                        />
                      ) : (
                        <p className="text-sm text-brand-400 font-medium">{formatIncidentType(selectedCall.incident_type)}</p>
                      )}
                    </div>
                    <div>
                      <label className="field-label">Location:</label>
                      {isEditing ? (
                        <AddressAutocomplete
                          className="input-dark text-xs mt-0.5"
                          placeholder="123 Main St, Salt Lake City, UT"
                          value={editData.location}
                          onChange={(val) => updateEditField('location', val)}
                          onSelect={async (addr: ParsedAddress) => {
                            updateEditField('location', addr.formatted);
                            if (addr.latitude != null) {
                              // Location changed → recompute and OVERWRITE every
                              // derived geo field (coords, district, cross street).
                              // Fall back to the prior value when a lookup misses
                              // so a Mapbox hiccup never blanks good data.
                              const details = await resolveAddress(addr);
                              setEditData(prev => ({
                                ...prev,
                                latitude: details.latitude,
                                longitude: details.longitude,
                                sector_id: details.sector_id || prev.sector_id,
                                zone_id: details.zone_id || prev.zone_id,
                                beat_id: details.beat_id || prev.beat_id,
                                dispatch_code: details.dispatch_code || prev.dispatch_code,
                                cross_street: details.cross_street || prev.cross_street,
                              }));
                            }
                          }}
                        />
                      ) : (
                        <div className="flex items-center gap-1.5">
                          <MapPin className="w-3.5 h-3.5 text-rmpg-300" />
                          <p className="text-sm text-rmpg-100">{formatAddressDisplay(selectedCall.location)}</p>
                        </div>
                      )}
                      {!isEditing && selectedCall.property_name && (
                        <p className="text-xs text-rmpg-300 ml-5">{selectedCall.property_name}</p>
                      )}
                      {!isEditing && selectedCall.client_name && (
                        <p className="text-[10px] text-brand-400 ml-5 flex items-center gap-1">
                          <Building2 className="w-3 h-3" />
                          {selectedCall.client_name}
                        </p>
                      )}
                      {!isEditing && selectedCall.cross_street && (
                        <p className="text-[10px] text-rmpg-400 ml-5 flex items-center gap-1">
                          <Navigation style={{ width: 10, height: 10 }} />
                          <span className="text-rmpg-300">X-St: {selectedCall.cross_street}</span>
                        </p>
                      )}
                      {/* Weather at call location — officer safety indicator */}
                      {!isEditing && selectedCall.weather_conditions && (
                        <p className="text-[10px] text-rmpg-400 ml-5 flex items-center gap-1">
                          <Thermometer style={{ width: 10, height: 10 }} />
                          <span className="text-rmpg-300">{toDisplayLabel(selectedCall.weather_conditions)}</span>
                          {selectedCall.lighting_conditions && <span className="text-rmpg-500 ml-1">/ {toDisplayLabel(selectedCall.lighting_conditions)}</span>}
                        </p>
                      )}
                    </div>
                    <div>
                      <label className="field-label">Description:</label>
                      {isEditing ? (
                        <>
                          <textarea className="textarea-dark text-xs mt-0.5" rows={3} value={editData.description} onChange={(e) => updateEditField('description', e.target.value)} />
                          <NarrativeAssist
                            notes={editData.description || ''}
                            incidentType={editData.incident_type || selectedCall.incident_type}
                            locationAddress={editData.location_address || selectedCall.location || ''}
                            onAccept={(narrative) => updateEditField('description', narrative)}
                          />
                        </>
                      ) : (
                        <p className="text-sm text-rmpg-200 leading-relaxed">{selectedCall.description}</p>
                      )}
                    </div>
                    {isEditing && (
                      <>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                          <div>
                            <label className="field-label">Source:</label>
                            <select className="select-dark text-xs mt-0.5" value={editData.source} onChange={(e) => updateEditField('source', e.target.value)}>
                              {SOURCE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                            </select>
                          </div>
                          <div>
                            <label className="field-label">Priority:</label>
                            <select className="select-dark text-xs mt-0.5" value={editData.priority} onChange={(e) => updateEditField('priority', e.target.value)}>
                              {PRIORITY_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                            </select>
                          </div>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                          <div>
                            <label className="field-label">Client:</label>
                            <select className="select-dark text-xs mt-0.5" value={editData.client_id || ''} onChange={(e) => handleClientChange(e.target.value)}>
                              <option value="">— No Client —</option>
                              {clientsList.map((c) => (
                                <option key={c.id} value={c.id}>{c.name}</option>
                              ))}
                            </select>
                          </div>
                          <div>
                            <label className="field-label">Property:</label>
                            <select className="select-dark text-xs mt-0.5" value={editData.property_id || ''} onChange={(e) => updateEditField('property_id', e.target.value)}>
                              <option value="">— No Property —</option>
                              {propertiesList.map((p) => (
                                <option key={p.id} value={p.id}>{p.name}</option>
                              ))}
                            </select>
                          </div>
                        </div>
                        <div>
                          <label className="field-label">Disposition:</label>
                          <select
                            className="select-dark text-xs mt-0.5"
                            value={editData.disposition || ''}
                            onChange={(e) => updateEditField('disposition', e.target.value)}
                          >
                            <option value="">— Select Disposition —</option>
                            {/* Built-in dispositions from the shared source of
                                truth (constants/dispositionCodes). For PSO /
                                process_service calls the Process Service group is
                                hoisted to the top so those codes are immediately
                                reachable. */}
                            {dispositionGroupsForIncident(selectedCall.incident_type).map((g) => (
                              <optgroup key={g.label} label={g.label}>
                                {g.codes.map((d) => (
                                  <option key={d.code} value={d.code}>{d.description}</option>
                                ))}
                              </optgroup>
                            ))}
                            {/* Admin-defined custom codes from /admin/config that
                                aren't already built in. */}
                            {(() => {
                              const customs = dispositionCodes.filter((d) => !DEFAULT_DISPOSITION_CODES.has(d.code));
                              return customs.length > 0 ? (
                                <optgroup label="Custom Codes">
                                  {customs.map((d) => (
                                    <option key={d.code} value={d.code}>{d.code} — {d.description}</option>
                                  ))}
                                </optgroup>
                              ) : null;
                            })()}
                          </select>
                        </div>
                      </>
                    )}
                    {!isEditing && selectedCall.disposition && (
                      <div>
                        <label className="field-label">Disposition:</label>
                        <p className="text-sm text-rmpg-200">
                          <span className="inline-block px-2 py-0.5 bg-brand-900/40 text-brand-300 text-[11px] uppercase font-bold border border-brand-600/40 mr-1.5 rounded-sm tracking-wide">
                            {formatEnumValue(selectedCall.disposition)}
                          </span>
                          {(() => {
                            const match = dispositionCodes.find((d) => d.code === selectedCall.disposition);
                            return match ? <span className="text-rmpg-300">{match.description}</span> : null;
                          })()}
                        </p>
                      </div>
                    )}
                  </div>

                  {/* Right Column: Caller, Timeline, Units */}
                  <div className="space-y-2">
                    {/* Caller Info */}
                    <div>
                      <label className="field-label">Caller:</label>
                      {isEditing ? (
                        <div className="space-y-1 mt-0.5">
                          <input type="text" className="input-dark text-xs" placeholder="Caller name" value={editData.caller_name} onChange={(e) => updateEditField('caller_name', e.target.value)} />
                          <input type="text" inputMode="tel" className="input-dark text-xs" placeholder="Caller phone" value={editData.caller_phone} onChange={(e) => updateEditField('caller_phone', formatPhoneInput(e.target.value))} />
                           <AddressAutocomplete
                             className="input-dark text-xs"
                             placeholder="Caller address"
                             value={editData.caller_address}
                             onChange={(value) => updateEditField('caller_address', value)}
                             name="caller_address"
                           />
                          <select className="select-dark text-xs" value={editData.caller_relationship} onChange={(e) => updateEditField('caller_relationship', e.target.value)}>
                            <option value="">-- Relationship --</option>
                            {linkOptions.caller_relationship.map((o) => (
                              <option key={o.value} value={o.value}>{o.label}</option>
                            ))}
                          </select>
                        </div>
                      ) : (
                        <>
                          {(selectedCall.caller_name || selectedCall.caller_phone) && (
                            <>
                              <div className="flex items-center gap-1.5">
                                <User className="w-3.5 h-3.5 text-rmpg-300" />
                                <p className="text-sm text-rmpg-100">{selectedCall.caller_name || 'Unknown'}</p>
                                {selectedCall.caller_relationship && <span className="text-[9px] text-rmpg-400">({selectedCall.caller_relationship})</span>}
                              </div>
                              {selectedCall.caller_phone && (
                                <div className="flex items-center gap-1.5 ml-5">
                                  <Phone className="w-3 h-3 text-rmpg-400" />
                                  <p className="text-xs text-rmpg-300">{formatPhoneDisplay(selectedCall.caller_phone)}</p>
                                </div>
                              )}
                            </>
                          )}
                        </>
                      )}
                    </div>

                    {/* Timeline — editable by admin/manager */}
                    <div>
                      <div className="flex items-center justify-between">
                        <label className="field-label">Timeline:</label>
                        {isAdminOrManager && <span className="text-[7px] text-rmpg-500 font-mono tracking-wider">ADMIN EDIT</span>}
                      </div>
                      <div className="space-y-0.5 mt-1.5 relative" style={{ paddingLeft: '12px', borderLeft: '2px solid var(--spm-border)' }}>
                        {TIMELINE_FIELDS_DESKTOP.map(tf => ({
                          ...tf,
                          label: tf.field === 'enroute_at' ? 'En Route' : tf.label,
                          value: (selectedCall as any)[tf.field] as string | undefined,
                          showElapsed: tf.field === 'created_at',
                        })).filter(ts => ts.value || isAdminOrManager).map(ts => (
                          <div key={ts.field} className="flex items-center gap-2 text-xs py-0.5 relative group">
                            <div className="absolute -left-[11px] top-1/2 -translate-y-1/2 w-2 h-2 rounded-full" style={{ background: ts.value ? ts.color : 'var(--spm-border)', border: '2px solid var(--surface-sunken)', boxShadow: ts.value ? `0 0 4px ${withAlpha(ts.color, '60')}` : 'none' }} />
                            <span className="text-rmpg-500 text-[10px]" style={{ minWidth: '66px' }}>{ts.label}</span>
                            {editingTimestamp === ts.field ? (
                              <div className="flex items-center gap-1">
                                <input
                                  type="datetime-local"
                                  step="1"
                                  className="input-dark text-[10px] font-mono px-1 py-0.5 w-[175px]"
                                  defaultValue={toDatetimeLocalValue(ts.value)}
                                  autoFocus
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter') handleTimelineEdit(ts.field, mtDatetimeLocalToUtc((e.target as HTMLInputElement).value));
                                    if (e.key === 'Escape') setEditingTimestamp(null);
                                  }}
                                  onBlur={(e) => {
                                    if (e.target.value) handleTimelineEdit(ts.field, mtDatetimeLocalToUtc(e.target.value));
                                    else setEditingTimestamp(null);
                                  }}
                                />
                                {ts.value && ts.field !== 'created_at' && (
                                  <button type="button" onClick={() => handleTimelineEdit(ts.field, null)} className="text-red-400 hover:text-red-300 p-0.5 sm:p-0.5 min-w-[44px] min-h-[44px] sm:min-w-0 sm:min-h-0 flex items-center justify-center" title="Clear timestamp" aria-label="Clear timestamp">
                                    <X className="w-3 h-3" />
                                  </button>
                                )}
                              </div>
                            ) : (
                              <span
                                className={`text-rmpg-100 font-mono text-[10px] tabular-nums ${isAdminOrManager ? 'cursor-pointer hover:text-[var(--brand-gold)] group-hover:underline transition-colors' : ''}`}
                                onClick={() => isAdminOrManager && setEditingTimestamp(ts.field)}
                                title={isAdminOrManager ? 'Click to edit' : undefined}
                              >
                                {ts.value ? formatTime(ts.value) : <span className="text-rmpg-600 italic text-[9px]">— not set —</span>}
                              </span>
                            )}
                            {ts.showElapsed && ts.value && !editingTimestamp && (() => {
                              const ageMin = Math.floor((Date.now() - parseTimestamp(ts.value).getTime()) / 60000);
                              const ageColor = ageMin > 120 ? 'var(--sev-critical)' : ageMin > 60 ? 'var(--sev-high)' : ageMin > 30 ? 'var(--sev-caution)' : 'var(--sev-ok)';
                              return <span className="text-[9px] font-mono tabular-nums font-bold" style={{ color: ageColor }}>({formatElapsed(ts.value)})</span>;
                            })()}
                          </div>
                        ))}
                        {/* Enhancement 26: Response time (dispatched → onscene) */}
                        {(() => { const rt = computeResponseTime(selectedCall); return rt == null ? null : (
                          <div className="flex justify-between items-center mt-1 pt-1 border-t border-rmpg-700/30">
                            <span className="text-rmpg-400 text-[10px]">Response Time</span>
                            <span className="text-rmpg-400 font-mono font-bold text-[10px]">{formatResponseTimeShort(rt)}</span>
                          </div>
                        ); })()}
                      </div>
                    </div>

                    {/* Assigned Units */}
                    <div>
                      <div className="flex items-center justify-between">
                        <label className="field-label">Assigned Units:</label>
                        {!isEditing && (isGodMode || !TERMINAL_STATUSES.has(selectedCall.status)) && (
                          <div className="relative" ref={attachUnitDropdownRef} style={{ display: 'inline-block' }}>
                            <button type="button"
                              onClick={() => setShowAttachUnitDropdown((prev) => !prev)}
                              className="toolbar-btn"
                              style={{ padding: '1px 6px', fontSize: '9px' }}
                              title="Attach a unit to this call"
                            >
                              <PlusCircle style={{ width: 9, height: 9 }} /> Attach Unit
                            </button>
                            {showAttachUnitDropdown && (
                              <div
                                className="absolute z-50 mt-1"
                                style={{
                                  top: '100%',
                                  right: 0,
                                  minWidth: '240px',
                                }}
                              >
                                <UnitRecommendationPanel
                                  units={units.filter(u => u.status !== 'off_duty')}
                                  callLat={selectedCall.latitude}
                                  callLng={selectedCall.longitude}
                                  assignedUnitIds={(selectedCall.assigned_units || []).map(String)}
                                  onAssign={handleAssignUnit}
                                  onCreateUnit={() => { setShowAttachUnitDropdown(false); setShowCreateUnitModal(true); }}
                                  onClose={() => setShowAttachUnitDropdown(false)}
                                />
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                      {/* DI-2: Persistent closest-unit recommendation (server-authoritative GPS) */}
                      {!isEditing && (isGodMode || !TERMINAL_STATUSES.has(selectedCall.status)) && (
                        <div className="mt-1 mb-1">
                          <RecommendedUnitsInline
                            callId={selectedCall.id}
                            limit={3}
                            onAssign={(callSign) => {
                              const u = units.find((x) => x.call_sign === callSign);
                              if (u) handleAssignUnit(u.id);
                            }}
                          />
                        </div>
                      )}
                      {/* Feature 11: Auto-assign + Feature 18: Multi-unit buttons */}
                      {!isEditing && (isGodMode || !TERMINAL_STATUSES.has(selectedCall.status)) && (
                        <div className="flex gap-1 mt-1 mb-1">
                          <button type="button"
                            onClick={() => handleAutoAssign(selectedCall.id)}
                            className="toolbar-btn text-[8px]"
                            style={{ padding: '1px 4px' }}
                            title="Auto-assign nearest available unit"
                          >
                            <Navigation style={{ width: 8, height: 8 }} /> Auto-assign
                          </button>
                          <button type="button"
                            onClick={() => handleSuggestClosestUnit(selectedCall.id)}
                            className="toolbar-btn text-[8px]"
                            style={{ padding: '1px 4px' }}
                            title="Show nearest available unit (without assigning)"
                          >
                            <Navigation style={{ width: 8, height: 8 }} /> Suggest
                          </button>
                          {/* Feature 19: Transfer button (only if a unit is assigned) */}
                          {(selectedCall.assigned_units || []).length > 0 && (() => {
                            const availableUnits = units.filter(u =>
                              u.status === 'available' && !selectedCall.assigned_units.includes(u.id)
                            );
                            if (availableUnits.length === 0) return null;
                            return (
                              <select
                                className="input-dark text-[8px] py-0 px-1"
                                style={{ maxWidth: 160 }}
                                value=""
                                onChange={(e) => {
                                  if (e.target.value && selectedCall.assigned_units.length > 0) {
                                    handleTransferCall(selectedCall.id, String(selectedCall.assigned_units[0]), e.target.value);
                                    e.currentTarget.value = '';
                                  }
                                }}
                              >
                                <option value="" disabled>⇄ Transfer to…</option>
                                {availableUnits.map(u => (
                                  <option key={u.id} value={u.id}>
                                    {u.call_sign}{u.officer_name ? ` — ${u.officer_name}` : ''}
                                  </option>
                                ))}
                              </select>
                            );
                          })()}
                        </div>
                      )}
                      {(selectedCall.assigned_units || []).length > 0 ? (
                        <div className="flex flex-wrap gap-1.5 mt-1">
                          {(selectedCall.assigned_units || []).map((unitIdStr) => {
                            const unitObj = units.find((u) => String(u.id) === String(unitIdStr));
                            const displayName = unitObj ? unitObj.call_sign : unitIdStr;
                            const statusColor = unitObj ? (
                              unitObj.status === 'onscene' ? 'var(--sev-special)' :
                              unitObj.status === 'enroute' ? 'var(--spm-text-muted)' :
                              unitObj.status === 'dispatched' ? 'var(--sev-warn)' :
                              'var(--sev-ok)'
                            ) : 'var(--spm-text-muted)';
                            const statusLabel = unitObj ? (
                              unitObj.status === 'onscene' ? 'OS' :
                              unitObj.status === 'enroute' ? 'ER' :
                              unitObj.status === 'dispatched' ? 'DP' :
                              ''
                            ) : '';
                            return (
                              <span
                                key={unitIdStr}
                                className="inline-flex items-center gap-1.5 px-2 py-0.5 text-[11px] font-bold font-mono rounded-sm transition-all duration-150 hover:brightness-110"
                                style={{ background: withAlpha(statusColor, '12'), color: statusColor, border: `1px solid ${withAlpha(statusColor, '40')}`, boxShadow: `0 0 4px ${withAlpha(statusColor, '10')}` }}
                                title={unitObj ? `${displayName} — ${unitObj.officer_name || 'Unassigned'}${unitObj.badge_number ? ` #${unitObj.badge_number}` : ''} (${toDisplayLabel(unitObj.status || '')})` : displayName}
                              >
                                <span className="rounded-full flex-shrink-0" style={{ width: 5, height: 5, background: statusColor, boxShadow: `0 0 3px ${withAlpha(statusColor, '80')}` }} />
                                {displayName}
                                {unitObj?.badge_number && <span style={{ fontSize: '8px', opacity: 0.7 }}>#{unitObj.badge_number}</span>}
                                {statusLabel && <span style={{ fontSize: '8px', opacity: 0.8 }}>{statusLabel}</span>}
                                {unitObj?.status === 'enroute' && unitEtas[String(unitIdStr)] != null && (
                                  <span style={{ fontSize: '8px', color: 'var(--text-secondary)' }}>
                                    ETA ~{unitEtas[String(unitIdStr)]} min
                                  </span>
                                )}
                                {!isEditing && unitObj && !TERMINAL_STATUSES.has(selectedCall.status) && (
                                  <button type="button"
                                    onClick={() => handleUnassignUnit(unitObj.id)}
                                    className="ml-0.5 hover:text-red-400 transition-colors"
                                    title={`Detach ${displayName}`}
                                    style={{ lineHeight: 1 }}
                                  >
                                    <X style={{ width: 10, height: 10 }} />
                                  </button>
                                )}
                              </span>
                            );
                          })}
                        </div>
                      ) : (
                        <p className="text-xs text-rmpg-400 mt-1 italic">No units assigned</p>
                      )}
                      {/* Inline ETA from route */}
                      {routeInfo && (
                        <div className="mt-2 flex items-center gap-2.5 px-2.5 py-1.5 rounded-sm" style={{ background: 'rgb(var(--spm-text-muted-rgb) / 0.08)', border: '1px solid rgb(var(--spm-text-muted-rgb) / 0.2)', boxShadow: '0 0 8px rgb(var(--spm-text-muted-rgb) / 0.06)' }}>
                          <span className="flex items-center gap-1 text-[9px] font-mono font-bold text-rmpg-400">
                            <Navigation style={{ width: 9, height: 9 }} /> ETA
                          </span>
                          <span className="text-[11px] font-mono font-bold text-rmpg-100 tabular-nums">{routeInfo.eta}</span>
                          <span className="text-[9px] font-mono text-[var(--spm-text-muted)] tabular-nums">{routeInfo.distance}</span>
                          <span className="text-[8px] font-mono text-[var(--spm-text-muted)] ml-auto">{routeInfo.unitCallSign}</span>
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* ── MILEAGE (primary unit) — Info tab ─── */}
                {/* Boolean() — numeric mileage 0 would otherwise render "0". */}
                {detailTab === 'info' && Boolean(isEditing || selectedCall.starting_mileage || selectedCall.ending_mileage) && (
                  <div className="border-t border-[var(--spm-border)] pt-3 mb-3">
                    <label className="field-label !flex items-center gap-1.5 mb-2" style={{ color: 'var(--brand-gold)', fontSize: '9px', letterSpacing: '0.05em' }}>
                      <MapPin className="w-3 h-3" /> Primary Unit Mileage
                    </label>
                    {isEditing ? (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-1">
                        <div>
                          <label className="text-[9px] text-[color:var(--field-label-color)]">Starting Mileage <span className="text-red-400">*</span></label>
                          <div className="flex gap-1">
                            <input type="number" step="0.1" min="0" className="input-dark text-xs flex-1" placeholder="e.g. 45230" value={editData.starting_mileage} onChange={(e) => updateEditField('starting_mileage', e.target.value)} />
                            <button
                              type="button"
                              onClick={async () => {
                                try {
                                  const unitId = (() => {
                                    const a = selectedCall?.assigned_units;
                                    const id = Array.isArray(a) && a.length > 0 ? a[0] : null;
                                    return id != null ? Number(id) : null;
                                  })();
                                  const params = new URLSearchParams();
                                  if (user?.id) params.set('officer_id', String(user.id));
                                  if (unitId) params.set('unit_id', String(unitId));
                                  const r: any = await apiFetch(`/patrol/mileage/suggest?${params}`);
                                  if (r?.suggested_mileage != null) {
                                    updateEditField('starting_mileage', String(r.suggested_mileage));
                                    addToast?.(`Picked up ${Number(r.suggested_mileage).toLocaleString()} mi from last entry (scope: ${r.source})`, 'success');
                                  } else {
                                    addToast?.(r?.message || 'No prior mileage for this scope', 'info');
                                  }
                                } catch (err: any) {
                                  addToast?.(err?.message || 'Mileage suggest failed', 'error');
                                }
                              }}
                              className="toolbar-btn text-[9px] px-1.5"
                              title="Pick up from the last entered mileage for this officer + unit"
                            >
                              ⤴︎ Last
                            </button>
                          </div>
                        </div>
                        <div>
                          <label className="text-[9px] text-[color:var(--field-label-color)]">Ending Mileage</label>
                          <input type="number" step="0.1" min="0" className="input-dark text-xs" placeholder="e.g. 45256" value={editData.ending_mileage} onChange={(e) => updateEditField('ending_mileage', e.target.value)} />
                        </div>
                      </div>
                    ) : (
                      <div className="flex flex-wrap gap-x-6 gap-y-1 mt-1 text-xs">
                        {selectedCall.starting_mileage && <span className="text-rmpg-200 tabular-nums"><span className="text-rmpg-400">Start:</span> {Number(selectedCall.starting_mileage).toLocaleString()} mi</span>}
                        {selectedCall.ending_mileage && <span className="text-rmpg-200 tabular-nums"><span className="text-rmpg-400">End:</span> {Number(selectedCall.ending_mileage).toLocaleString()} mi</span>}
                        {selectedCall.starting_mileage && selectedCall.ending_mileage && (
                          <span className="text-[10px] font-mono text-green-400 font-semibold tabular-nums">
                            Total: {((Number(selectedCall.ending_mileage) || 0) - (Number(selectedCall.starting_mileage) || 0)).toFixed(1)} mi
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {/* ── EXTENDED DETAILS — Info tab ─── */}
                {detailTab === 'info' && (isEditing || selectedCall.cross_street || selectedCall.location_building || selectedCall.location_floor || selectedCall.location_room || selectedCall.sector_id || selectedCall.zone_id || selectedCall.beat_id || selectedCall.latitude || selectedCall.dispatch_code) && (
                  <div className="border-t border-[var(--spm-border)] pt-3 mb-3">
                    <label className="field-label !flex items-center gap-1.5 mb-2" style={{ color: 'var(--brand-gold)', fontSize: '9px', letterSpacing: '0.05em' }}>
                      <MapPin className="w-3 h-3" /> Location Details
                    </label>
                    {isEditing ? (() => {
                      const filteredZones = zonesForSection(editData.sector_id);
                      // Scope the Beat list to the Zone when chosen, else to the
                      // Section (short, relevant list) — never the full ~719 beats.
                      const sectionScopedBeats = !editData.zone_id;
                      const filteredBeats = editData.zone_id
                        ? beatsForZone(editData.zone_id)
                        : beatsForSection(editData.sector_id);
                      return (
                        <div className="space-y-2 mt-1">
                          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                            <div><label className="text-[9px] text-[color:var(--field-label-color)]">Cross Street</label><input type="text" className="input-dark text-xs" value={editData.cross_street} onChange={(e) => updateEditField('cross_street', e.target.value)} /></div>
                            <div><label className="text-[9px] text-[color:var(--field-label-color)]">Building</label><input type="text" className="input-dark text-xs" value={editData.location_building} onChange={(e) => updateEditField('location_building', e.target.value)} /></div>
                            <div><label className="text-[9px] text-[color:var(--field-label-color)]">Floor</label><input type="text" className="input-dark text-xs" value={editData.location_floor} onChange={(e) => updateEditField('location_floor', e.target.value)} /></div>
                            <div><label className="text-[9px] text-[color:var(--field-label-color)]">Room/Suite</label><input type="text" className="input-dark text-xs" value={editData.location_room} onChange={(e) => updateEditField('location_room', e.target.value)} /></div>
                          </div>
                          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                            <div>
                              <label className="text-[9px] text-[color:var(--field-label-color)]">Section</label>
                              <select className="input-dark text-xs" value={editData.sector_id} onChange={(e) => {
                                const val = e.target.value;
                                setEditData(prev => ({ ...prev, sector_id: val, zone_id: '', beat_id: '', dispatch_code: '' }));
                              }}>
                                <option value="">— Select —</option>
                                {sections.map(s => {
                                  const code = getSectionCode(s);
                                  const name = sectionLabels.get(s) || s;
                                  return <option key={s} value={s}>{code ? `${code} — ${name}` : name}</option>;
                                })}
                              </select>
                            </div>
                            <div>
                              <label className="text-[9px] text-[color:var(--field-label-color)]">Zone</label>
                              <select className="input-dark text-xs" value={editData.zone_id} onChange={(e) => {
                                const val = e.target.value;
                                setEditData(prev => ({ ...prev, zone_id: val, beat_id: '', dispatch_code: '' }));
                              }}>
                                <option value="">— Select —</option>
                                {filteredZones.map(z => <option key={z} value={z}>{zoneLabels.get(z) || z}</option>)}
                              </select>
                            </div>
                            <div>
                              <label className="text-[9px] text-[color:var(--field-label-color)]">Beat</label>
                              <select className="input-dark text-xs" value={editData.beat_id} disabled={!editData.sector_id} onChange={(e) => {
                                const beatVal = e.target.value;
                                if (!beatVal) { setEditData(prev => ({ ...prev, beat_id: '', dispatch_code: '' })); return; }
                                // Resolve the district for this beat. If a Zone is
                                // already chosen, match within it; otherwise resolve
                                // by (section, beat) and BACKFILL the zone too.
                                const match = editData.zone_id
                                  ? districts.find(d => d.sector_id === String(editData.sector_id) && d.zone_id === editData.zone_id && d.beat_id === beatVal)
                                  : districtForSectionBeat(editData.sector_id, beatVal);
                                setEditData(prev => ({
                                  ...prev,
                                  beat_id: beatVal,
                                  zone_id: prev.zone_id || match?.zone_id || '',
                                  dispatch_code: match?.dispatch_code || '',
                                }));
                              }}>
                                <option value="">{editData.sector_id ? '— Select —' : '— Pick a section first —'}</option>
                                {filteredBeats.map(b => {
                                  // When scoped to the whole section, the zone isn't known
                                  // yet — resolve each beat's own zone for an accurate,
                                  // zone-disambiguated label ("HER · B2 — name").
                                  if (sectionScopedBeats) {
                                    const d = districtForSectionBeat(editData.sector_id, b);
                                    const label = getBeatLabel(d?.zone_id || '', b);
                                    const zoneTag = d?.zone_id ? zoneLeaf(d.zone_id) : '';
                                    return <option key={b} value={b}>{zoneTag ? `${zoneTag} · ${label}` : label}</option>;
                                  }
                                  return <option key={b} value={b}>{getBeatLabel(editData.zone_id, b)}</option>;
                                })}
                              </select>
                            </div>
                            <div>
                              <label className="text-[9px] text-[color:var(--field-label-color)]">Dispatch Code</label>
                              <input type="text" className="input-dark text-xs bg-rmpg-800 opacity-80" readOnly value={editData.dispatch_code || ''} />
                            </div>
                          </div>
                        </div>
                      );
                    })() : (
                      <div className="flex flex-wrap gap-x-6 gap-y-1 mt-1 text-xs">
                        {selectedCall.cross_street && <span className="text-rmpg-200"><span className="text-rmpg-400">X-St:</span> {selectedCall.cross_street}</span>}
                        {selectedCall.location_building && <span className="text-rmpg-200"><span className="text-rmpg-400">Bldg:</span> {selectedCall.location_building}</span>}
                        {selectedCall.location_floor && <span className="text-rmpg-200"><span className="text-rmpg-400">Floor:</span> {selectedCall.location_floor}</span>}
                        {selectedCall.location_room && <span className="text-rmpg-200"><span className="text-rmpg-400">Rm:</span> {selectedCall.location_room}</span>}
                        <ZsbBadge
                          zoneId={selectedCall.zone_id}
                          beatId={selectedCall.beat_id}
                          dispatchCode={selectedCall.dispatch_code}
                          sectionCode={getSectionCode(selectedCall.sector_id ?? '')}
                        />
                        {selectedCall.sector_id && (() => {
                          // Area name only — area_code is just area_name mechanically
                          // upper-snake-cased ("WASATCH_FRONT"), not a real short code
                          // like Sector/Zone/Beat have, so showing it alongside the name
                          // is pure noise.
                          const area = getArea(selectedCall.sector_id);
                          return area?.name ? <span className="text-rmpg-200" title="Dispatch Area — top of the geography hierarchy"><span className="text-rmpg-400">Area:</span> {area.name}</span> : null;
                        })()}
                        {selectedCall.sector_id && (() => {
                          // Code only — dispatch_beats.beat_name/beat_descriptor (and by
                          // extension names sourced from the same districts data) have
                          // been found corrupted for an unknown subset of live rows
                          // (chart-code composites like "SL1/SSL/A1" stored where a human
                          // name should be — see docs/superpowers/specs/2026-07-07-
                          // geography-naming-and-beat-descriptor-fix-design.md). The leaf/
                          // prefix codes below are derived structurally from the call's
                          // own stored fields, not from that unreliable name data.
                          const code = getSectionCode(selectedCall.sector_id) || sectionPrefix(selectedCall.zone_id || '') || selectedCall.sector_id;
                          return <span className="text-rmpg-200" title="Spillman sector code"><span className="text-rmpg-400">Sec:</span> {code}</span>;
                        })()}
                        {selectedCall.zone_id && <span className="text-rmpg-200" title="Zone (within sector)"><span className="text-rmpg-400">Zone:</span> {zoneLeaf(selectedCall.zone_id)}</span>}
                        {selectedCall.beat_id && (
                          <span className="text-rmpg-200" title="Beat (within zone)"><span className="text-rmpg-400">Beat:</span> {beatLeaf(selectedCall.beat_id)}</span>
                        )}
                        {selectedCall.latitude != null && selectedCall.longitude != null && (
                          <span className="text-rmpg-400 font-mono text-[9px] tabular-nums select-all">
                            GPS: {Number(selectedCall.latitude).toFixed(5)}, {Number(selectedCall.longitude).toFixed(5)}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {/* ── SUBJECT/THREAT INFO — Persons tab ─── */}
                {/* Boolean() — num_subjects/num_victims 0 would otherwise leak as "0". */}
                {(detailTab === 'info' || detailTab === 'persons') && Boolean(isEditing || (selectedCall.weapons_involved && selectedCall.weapons_involved !== 'None') || selectedCall.injuries_reported || selectedCall.num_subjects || selectedCall.subject_description || selectedCall.vehicle_description || selectedCall.direction_of_travel || callPersons.length > 0 || callVehicles.length > 0) && (
                  <div className="border-t border-[var(--spm-border)] pt-3 mb-3">
                    <label className="field-label !flex items-center gap-1.5 mb-2" style={{ color: 'var(--brand-gold)', fontSize: '9px', letterSpacing: '0.05em' }}>
                      <Shield className="w-3 h-3" /> Subject / Threat Info
                    </label>
                    {/* Aggregate threat posture — rolls the call's own flags +
                        every linked person/vehicle flag (warrants, RSO, gang,
                        stolen) into one officer-safety read so a unit sees the
                        danger before responding. */}
                    {(() => {
                      const p = callPosture(selectedCall);
                      if (p.level === 'clear') return null;
                      const t = BADGE_TONES[p.tone];
                      return (
                        <div
                          className={`flex items-center gap-2 px-2 py-1 mb-2 rounded-[2px] ${p.pulse ? 'animate-led-pulse' : ''}`}
                          style={{ color: t.text, background: t.bg, border: `1px solid ${t.border}`, boxShadow: p.level === 'critical' ? `0 0 8px ${t.glow}` : undefined }}
                          title="Officer-safety posture from this call's own threat flags"
                        >
                          <Shield className="w-3.5 h-3.5 flex-shrink-0" />
                          <span className="text-[10px] font-bold uppercase tracking-wider">
                            {p.label}{p.level === 'critical' ? ' — EXERCISE CAUTION' : ''}
                          </span>
                        </div>
                      );
                    })()}
                    {isEditing ? (() => {
                      const weaponsIsOther = editData.weapons_involved && !(WEAPONS_OPTIONS as readonly string[]).includes(editData.weapons_involved);
                      return (
                      <div className="space-y-2 mt-1">
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                          <div><label className="text-[9px] text-[color:var(--field-label-color)]"># Subjects</label><input type="number" min="0" className="input-dark text-xs" value={editData.num_subjects} onChange={(e) => updateEditField('num_subjects', e.target.value)} /></div>
                          <div><label className="text-[9px] text-[color:var(--field-label-color)]"># Victims</label><input type="number" min="0" className="input-dark text-xs" value={editData.num_victims} onChange={(e) => updateEditField('num_victims', e.target.value)} /></div>
                          <div>
                            <label className="text-[9px] text-[color:var(--field-label-color)]">Weapons</label>
                            <select className="input-dark text-xs" value={weaponsIsOther ? 'Other' : editData.weapons_involved} onChange={(e) => updateEditField('weapons_involved', e.target.value)}>
                              {WEAPONS_OPTIONS.map(w => <option key={w} value={w}>{w || '— Select —'}</option>)}
                            </select>
                            {(editData.weapons_involved === 'Other' || weaponsIsOther) && (
                              <input type="text" className="input-dark text-xs mt-1" placeholder="Specify weapon..." value={weaponsIsOther ? editData.weapons_involved : ''} onChange={(e) => updateEditField('weapons_involved', e.target.value || 'Other')} />
                            )}
                          </div>
                        </div>
                        {/* ── Linked Persons ── */}
                        <div>
                          <div className="flex items-center gap-2 mb-1">
                            <label className="text-[9px] text-[color:var(--field-label-color)]">Linked Individuals</label>
                            <select className="input-dark text-[9px] py-0 px-1 w-auto" value={linkPersonRole} onChange={(e) => setLinkPersonRole(e.target.value)}>
                              {linkOptions.person_role.map((o) => (
                                <option key={o.value} value={o.value}>{o.label}</option>
                              ))}
                            </select>
                          </div>
                          {callPersons.length > 0 && (
                            <div className="flex flex-wrap gap-1 mb-1">
                              {callPersons.map((cp: any) => (
                                <span key={cp.id} className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[9px] font-mono bg-rmpg-700 border border-rmpg-500 rounded-sm text-rmpg-200">
                                  <span className="text-[color:var(--field-label-color)] uppercase text-[7px] font-black">{toDisplayLabel(cp.role || '')}</span>
                                  {cp.last_name}, {cp.first_name}
                                  <WarrantBadge flags={cp.flags} size="sm" />
                                  {cp.dob && <span className="text-rmpg-500">DOB:{cp.dob}</span>}
                                  <button type="button" onClick={() => unlinkPersonFromCall(selectedCall.id, cp.id)} className="text-red-500 hover:text-red-300 ml-0.5" aria-label="Remove person from call">&times;</button>
                                </span>
                              ))}
                            </div>
                          )}
                          <div className="relative" ref={personDropdownRef}>
                            <input type="text" className="input-dark text-xs" placeholder="Search person records to link..." value={editData.subject_description} onChange={(e) => { updateEditField('subject_description', e.target.value); searchPersons(e.target.value); }} onFocus={() => { if (personSearchResults.length > 0) setShowPersonDropdown(true); }} />
                            {showPersonDropdown && personSearchResults.length > 0 && (
                              <div className="absolute z-50 left-0 right-0 mt-0.5 max-h-40 overflow-y-auto border border-rmpg-500 bg-rmpg-800 rounded-sm shadow-lg">
                                {personSearchResults.map((p: any) => (
                                  <button type="button" key={p.id} className="w-full text-left px-2 py-1 text-[10px] text-rmpg-200 hover:bg-brand-500/20 border-b border-rmpg-700 last:border-0" onClick={() => {
                                    linkPersonToCall(selectedCall.id, p.id, linkPersonRole);
                                    const desc = `${p.last_name || ''}, ${p.first_name || ''}`.trim().replace(/^,\s*/, '').replace(/,\s*$/, '') + (p.dob ? ` DOB:${p.dob}` : '');
                                    updateEditField('subject_description', desc);
                                    setShowPersonDropdown(false);
                                  }}>
                                    <span className="font-semibold text-rmpg-100">{p.last_name}, {p.first_name}</span>
                                    {p.dob && <span className="text-rmpg-400 ml-1">DOB: {p.dob}</span>}
                                    {p.address && <span className="text-rmpg-500 ml-1 text-[9px]">— {p.address}</span>}
                                  </button>
                                ))}
                              </div>
                            )}
                            {editData.subject_description?.length >= 2 && personSearchResults.length === 0 && !showPersonDropdown && (
                              <button type="button" onClick={() => setShowCreatePersonModal(true)} className="mt-0.5 inline-flex items-center gap-1 px-2 py-1 text-[9px] font-bold uppercase text-brand-400 bg-brand-900/30 border border-brand-700/40 hover:bg-brand-900/50 transition-colors">
                                <PlusCircle className="w-3 h-3" /> Create New Person
                              </button>
                            )}
                          </div>
                        </div>
                        {/* ── Linked Vehicles ── */}
                        <div>
                          <div className="flex items-center gap-2 mb-1">
                            <label className="text-[9px] text-[color:var(--field-label-color)]">Linked Vehicles</label>
                            <select className="input-dark text-[9px] py-0 px-1 w-auto" value={linkVehicleRole} onChange={(e) => setLinkVehicleRole(e.target.value)}>
                              {linkOptions.vehicle_role.map((o) => (
                                <option key={o.value} value={o.value}>{o.label}</option>
                              ))}
                            </select>
                          </div>
                          {callVehicles.length > 0 && (
                            <div className="flex flex-wrap gap-1 mb-1">
                              {callVehicles.map((cv: any) => (
                                <span key={cv.id} className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[9px] font-mono bg-rmpg-700 border border-rmpg-500 rounded-sm text-rmpg-200">
                                  <span className="text-[color:var(--field-label-color)] uppercase text-[7px] font-black">{toDisplayLabel(cv.role || '')}</span>
                                  {[cv.color, cv.year, cv.make, cv.model].filter(Boolean).join(' ')}
                                  {cv.plate_number && <span className="text-brand-400 ml-0.5">PLT:{cv.plate_number}</span>}
                                  <button type="button" onClick={() => unlinkVehicleFromCall(selectedCall.id, cv.id)} className="text-red-500 hover:text-red-300 ml-0.5" aria-label="Remove vehicle from call">&times;</button>
                                </span>
                              ))}
                            </div>
                          )}
                          <div className="relative" ref={vehicleDropdownRef}>
                            <input type="text" className="input-dark text-xs" placeholder="Search vehicle records to link..." value={editData.vehicle_description} onChange={(e) => { updateEditField('vehicle_description', e.target.value); searchVehicles(e.target.value); }} onFocus={() => { if (vehicleSearchResults.length > 0) setShowVehicleDropdown(true); }} />
                            {showVehicleDropdown && vehicleSearchResults.length > 0 && (
                              <div className="absolute z-50 left-0 right-0 mt-0.5 max-h-40 overflow-y-auto border border-rmpg-500 bg-rmpg-800 rounded-sm shadow-lg">
                                {vehicleSearchResults.map((v: any) => (
                                  <button type="button" key={v.id} className="w-full text-left px-2 py-1 text-[10px] text-rmpg-200 hover:bg-brand-500/20 border-b border-rmpg-700 last:border-0" onClick={() => {
                                    linkVehicleToCall(selectedCall.id, v.id, linkVehicleRole);
                                    const desc = [v.color, v.year, v.make, v.model].filter(Boolean).join(' ') + (v.plate_number ? ` PLT:${v.plate_number}` : '') + (v.plate_state ? `/${v.plate_state}` : '');
                                    updateEditField('vehicle_description', desc);
                                    setShowVehicleDropdown(false);
                                  }}>
                                    <span className="font-semibold text-rmpg-100">{[v.color, v.year, v.make, v.model].filter(Boolean).join(' ')}</span>
                                    {v.plate_number && <span className="text-brand-400 ml-1">PLT: {v.plate_number}{v.plate_state ? `/${v.plate_state}` : ''}</span>}
                                    {v.owner_first_name && <span className="text-rmpg-400 ml-1 text-[9px]">Owner: {v.owner_last_name}, {v.owner_first_name}</span>}
                                  </button>
                                ))}
                              </div>
                            )}
                            {editData.vehicle_description?.length >= 2 && vehicleSearchResults.length === 0 && !showVehicleDropdown && (
                              <button type="button" onClick={() => setShowCreateVehicleModal(true)} className="mt-0.5 inline-flex items-center gap-1 px-2 py-1 text-[9px] font-bold uppercase text-brand-400 bg-brand-900/30 border border-brand-700/40 hover:bg-brand-900/50 transition-colors">
                                <PlusCircle className="w-3 h-3" /> Create New Vehicle
                              </button>
                            )}
                          </div>
                        </div>
                        {/* ── Linked Businesses ── */}
                        <div>
                          <div className="flex items-center gap-2 mb-1">
                            <label className="text-[9px] text-[color:var(--field-label-color)]">Linked Businesses</label>
                            <select className="input-dark text-[9px] py-0 px-1 w-auto" value={linkBusinessRole} onChange={(e) => setLinkBusinessRole(e.target.value)}>
                              {linkOptions.business_role.map((o) => (
                                <option key={o.value} value={o.value}>{o.label}</option>
                              ))}
                            </select>
                          </div>
                          {callBusinesses.length > 0 && (
                            <div className="flex flex-wrap gap-1 mb-1">
                              {callBusinesses.map((cb: any) => (
                                <span key={cb.id} className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[9px] font-mono bg-rmpg-700 border border-rmpg-500 rounded-sm text-rmpg-200">
                                  <span className="text-[color:var(--field-label-color)] uppercase text-[7px] font-black">{toDisplayLabel(cb.role)}</span>
                                  {cb.name}
                                  {cb.business_type && <span className="text-rmpg-500">{toDisplayLabel(cb.business_type)}</span>}
                                  <button type="button" onClick={() => unlinkBusinessFromCall(selectedCall.id, cb.id)} className="text-red-500 hover:text-red-300 ml-0.5" aria-label="Remove business from call">&times;</button>
                                </span>
                              ))}
                            </div>
                          )}
                          <div className="relative" ref={businessDropdownRef}>
                            <input type="text" className="input-dark text-xs" placeholder="Search business records to link..." value={businessQuery} onChange={(e) => searchBusinesses(e.target.value)} onFocus={() => { if (businessSearchResults.length > 0) setShowBusinessDropdown(true); }} />
                            {showBusinessDropdown && businessSearchResults.length > 0 && (
                              <div className="absolute z-50 left-0 right-0 mt-0.5 max-h-40 overflow-y-auto border border-rmpg-500 bg-rmpg-800 rounded-sm shadow-lg">
                                {businessSearchResults.map((b: any) => (
                                  <button type="button" key={b.id} className="w-full text-left px-2 py-1 text-[10px] text-rmpg-200 hover:bg-brand-500/20 border-b border-rmpg-700 last:border-0" onClick={() => {
                                    linkBusinessToCall(selectedCall.id, b.id, linkBusinessRole);
                                    setBusinessQuery(''); setShowBusinessDropdown(false);
                                  }}>
                                    <span className="font-semibold text-rmpg-100">{b.name}</span>
                                    {b.address && <span className="text-rmpg-500 ml-1 text-[9px]">— {b.address}</span>}
                                  </button>
                                ))}
                              </div>
                            )}
                            {businessQuery.trim().length >= 2 && businessSearchResults.length === 0 && (
                              <button type="button" onClick={() => quickAddBusiness(selectedCall.id, businessQuery.trim(), linkBusinessRole)} className="mt-0.5 inline-flex items-center gap-1 px-2 py-1 text-[9px] font-bold uppercase text-brand-400 bg-brand-900/30 border border-brand-700/40 hover:bg-brand-900/50 transition-colors">
                                <PlusCircle className="w-3 h-3" /> Add "{businessQuery.trim()}"
                              </button>
                            )}
                          </div>
                        </div>
                        <div>
                          <label className="text-[9px] text-[color:var(--field-label-color)]">Direction of Travel</label>
                          <select className="input-dark text-xs" value={(DIRECTION_OPTIONS as readonly string[]).includes(editData.direction_of_travel) ? editData.direction_of_travel : ''} onChange={(e) => updateEditField('direction_of_travel', e.target.value)}>
                            {DIRECTION_OPTIONS.map(d => <option key={d} value={d}>{d || '— Select —'}</option>)}
                          </select>
                        </div>
                        <div className="flex items-center gap-4 mt-1">
                          <label className="flex items-center gap-1 text-xs text-rmpg-300 cursor-pointer">
                            <input type="checkbox" checked={editData.injuries_reported} onChange={(e) => updateEditField('injuries_reported', e.target.checked)} className="accent-red-500" />
                            Injuries
                          </label>
                        </div>
                      </div>
                      );
                    })() : (
                      <>
                        <div className="flex flex-wrap gap-x-6 gap-y-1 mt-1 text-xs">
                          {selectedCall.num_subjects && <span className="text-rmpg-200"><span className="text-rmpg-400">Subjects:</span> {selectedCall.num_subjects}</span>}
                          {selectedCall.num_victims && <span className="text-rmpg-200"><span className="text-rmpg-400">Victims:</span> {selectedCall.num_victims}</span>}
                          {selectedCall.weapons_involved && selectedCall.weapons_involved !== 'None' && <span className="text-rmpg-200"><span className="text-rmpg-400">Weapons:</span> {selectedCall.weapons_involved}</span>}
                          {selectedCall.injuries_reported && <span className="text-red-400 font-semibold">INJURIES REPORTED</span>}
                          {selectedCall.subject_description && <span className="text-rmpg-200 basis-full"><span className="text-rmpg-400">Subject:</span> {selectedCall.subject_description}</span>}
                          {selectedCall.vehicle_description && <span className="text-rmpg-200 basis-full"><span className="text-rmpg-400">Vehicle:</span> {selectedCall.vehicle_description}</span>}
                          {selectedCall.direction_of_travel && <span className="text-rmpg-200"><span className="text-rmpg-400">DOT:</span> {selectedCall.direction_of_travel}</span>}
                        </div>
                        {/* Linked persons */}
                        {callPersons.length > 0 && (
                          <div className="mt-2 space-y-1">
                            <span className="text-[9px] text-[color:var(--field-label-color)] font-semibold uppercase">Linked Persons ({callPersons.length})</span>
                            {callPersons.map((cp: any) => (
                              <div key={cp.id} className="flex items-center gap-2 px-2 py-1 bg-rmpg-800/60 border border-rmpg-700 rounded-sm text-[10px]">
                                <span className="text-[color:var(--field-label-color)] uppercase text-[7px] font-black px-1 py-px bg-rmpg-700 rounded-sm">{toDisplayLabel(cp.role || '')}</span>
                                <span className="text-rmpg-100 font-semibold">{cp.last_name}, {cp.first_name}</span>
                                <WarrantBadge flags={cp.flags ?? cp.warrant_hits ?? []} size="sm" />
                                {(!cp.flags && cp.warrant_hits && Array.isArray(cp.warrant_hits) && cp.warrant_hits.length > 0) && (
                                  <span className="inline-flex items-center gap-0.5 text-[9px] font-bold text-red-100 bg-red-700 px-1.5 py-px rounded-sm">
                                    WARRANT ({cp.warrant_hits.length})
                                  </span>
                                )}
                                {cp.dob && <span className="text-rmpg-400">DOB: {cp.dob}</span>}
                                {cp.race && <span className="text-rmpg-500">{toDisplayLabel(cp.race)}</span>}
                                {cp.sex && <span className="text-rmpg-500">{toDisplayLabel(cp.sex)}</span>}
                              </div>
                            ))}
                          </div>
                        )}
                        {/* Linked vehicles */}
                        {callVehicles.length > 0 && (
                          <div className="mt-2 space-y-1">
                            <span className="text-[9px] text-[color:var(--field-label-color)] font-semibold uppercase">Linked Vehicles ({callVehicles.length})</span>
                            {callVehicles.map((cv: any) => (
                              <div key={cv.id} className="flex items-center gap-2 px-2 py-1 bg-rmpg-800/60 border border-rmpg-700 rounded-sm text-[10px]">
                                <span className="text-[color:var(--field-label-color)] uppercase text-[7px] font-black px-1 py-px bg-rmpg-700 rounded-sm">{toDisplayLabel(cv.role || '')}</span>
                                <span className="text-rmpg-100 font-semibold">{[cv.color, cv.year, cv.make, cv.model].filter(Boolean).join(' ')}</span>
                                {cv.plate_number && <span className="text-brand-400">PLT: {cv.plate_number}{cv.plate_state ? `/${cv.plate_state}` : ''}</span>}
                                {cv.stolen_status && !['none', 'not_stolen', 'recovered', ''].includes(cv.stolen_status.toLowerCase()) && <span className="text-red-400 font-bold uppercase">{toDisplayLabel(cv.stolen_status)}</span>}
                              </div>
                            ))}
                          </div>
                        )}
                        {/* ── Linked BOLOs ── */}
                        <div className="mt-2">
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-[9px] text-[color:var(--field-label-color)] font-semibold uppercase">
                              Linked BOLOs{callBolos.length > 0 ? ` (${callBolos.length})` : ''}
                            </span>
                            <button
                              type="button"
                              className="text-[9px] px-1.5 py-0.5 border border-[var(--spm-border)] text-fg-secondary hover:text-rmpg-100 hover:border-rmpg-400"
                              onClick={() => setShowBoloSearch((v) => !v)}
                            >
                              {showBoloSearch ? 'Cancel' : 'Link BOLO'}
                            </button>
                          </div>
                          {bolosLoading && <span className="text-[9px] text-fg-muted italic">Loading…</span>}
                          {callBolos.map((bolo: any) => (
                            <div key={bolo.id} className="flex items-start gap-2 px-2 py-1 bg-rmpg-800/60 border border-rmpg-700 rounded-sm text-[10px] mb-1">
                              <span className="text-amber-400 font-bold uppercase text-[8px]">BOLO</span>
                              <div className="flex-1 min-w-0">
                                <span className="text-rmpg-100">{bolo.title || bolo.description || '—'}</span>
                                {bolo.vehicle_description && <span className="ml-1 text-brand-400">{bolo.vehicle_description}</span>}
                                {bolo.subject_description && <span className="ml-1 text-fg-secondary">{bolo.subject_description}</span>}
                              </div>
                            </div>
                          ))}
                          {showBoloSearch && (
                            <div className="mt-1 space-y-1">
                              <input
                                type="text"
                                className="input-dark text-xs w-full"
                                placeholder="Search BOLO by title, subject, or vehicle…"
                                value={boloSearchQ}
                                onChange={(e) => {
                                  setBoloSearchQ(e.target.value);
                                  if (e.target.value.length >= 2) {
                                    apiFetch<any[]>(`/dispatch/bolos?q=${encodeURIComponent(e.target.value)}`)
                                      .then((r) => setBoloSearchResults(Array.isArray(r) ? r : []))
                                      .catch(() => setBoloSearchResults([]));
                                  } else {
                                    setBoloSearchResults([]);
                                  }
                                }}
                              />
                              {boloSearchResults.length > 0 && (
                                <div className="bg-rmpg-800 border border-rmpg-600 max-h-32 overflow-y-auto">
                                  {boloSearchResults.map((bolo: any) => (
                                    <button
                                      key={bolo.id}
                                      type="button"
                                      className="w-full text-left px-2 py-1 text-[10px] text-rmpg-200 hover:bg-brand-500/20 border-b border-rmpg-700 last:border-0"
                                      onClick={async () => {
                                        try {
                                          await apiFetch(`/dispatch/calls/${selectedCall.id}/bolos`, {
                                            method: 'POST',
                                            body: JSON.stringify({ bolo_id: bolo.id }),
                                          });
                                          setCallBolos((prev) => [...prev, bolo]);
                                          setShowBoloSearch(false);
                                          setBoloSearchQ('');
                                          setBoloSearchResults([]);
                                        } catch { /* best-effort */ }
                                      }}
                                    >
                                      <span className="font-semibold text-amber-400">BOLO</span>
                                      {' '}{bolo.title || bolo.description || '—'}
                                      {bolo.vehicle_description && <span className="ml-1 text-brand-400 text-[9px]">{bolo.vehicle_description}</span>}
                                      {bolo.subject_description && <span className="ml-1 text-fg-muted text-[9px]">{bolo.subject_description}</span>}
                                    </button>
                                  ))}
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                )}

                {/* ── INLINE INVOLVED PERSONS ─── */}
                {(detailTab === 'info' || detailTab === 'persons') && (
                  <div className="mt-2 border border-[var(--spm-border)] p-2" style={{ background: 'var(--surface-raised)' }}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[9px] font-bold uppercase tracking-wider text-[color:var(--field-label-color)]">
                        Involved Persons{involvedPersons.length > 0 && ` (${involvedPersons.length})`}
                      </span>
                      {!showAddInvPerson && (
                        <button
                          type="button"
                          onClick={() => { setShowAddInvPerson(true); setNewInvPerson({ name: '', dob: '', id_number: '', role: 'witness' }); }}
                          className="text-[9px] px-1.5 py-0.5 border border-[var(--spm-border)] text-rmpg-300 hover:text-rmpg-100 hover:border-rmpg-400"
                        >+ Add Person</button>
                      )}
                    </div>
                    {showAddInvPerson && (
                      <form
                        onSubmit={async (e) => {
                          e.preventDefault();
                          if (!newInvPerson.name.trim() || !selectedCall?.id) return;
                          try {
                            const created = await apiFetch<any>(`/dispatch/calls/${selectedCall.id}/involved-persons`, {
                              method: 'POST',
                              body: JSON.stringify(newInvPerson),
                            });
                            setInvolvedPersons(prev => [...prev, created]);
                            setShowAddInvPerson(false);
                          } catch { addToast('Failed to add person', 'error'); }
                        }}
                        className="mb-2 space-y-1"
                      >
                        <div className="grid grid-cols-2 gap-1">
                          <input
                            className="input-dark text-xs col-span-2"
                            placeholder="Full name *"
                            value={newInvPerson.name}
                            onChange={e => setNewInvPerson(p => ({ ...p, name: e.target.value }))}
                            required
                          />
                          <input
                            type="date"
                            className="input-dark text-xs"
                            placeholder="Date of birth"
                            value={newInvPerson.dob}
                            onChange={e => setNewInvPerson(p => ({ ...p, dob: e.target.value }))}
                          />
                          <input
                            className="input-dark text-xs"
                            placeholder="ID / badge number"
                            value={newInvPerson.id_number}
                            onChange={e => setNewInvPerson(p => ({ ...p, id_number: e.target.value }))}
                          />
                          <select
                            className="select-dark text-xs col-span-2"
                            value={newInvPerson.role}
                            onChange={e => setNewInvPerson(p => ({ ...p, role: e.target.value }))}
                          >
                            <option value="suspect">Suspect</option>
                            <option value="victim">Victim</option>
                            <option value="witness">Witness</option>
                            <option value="reporting_party">Reporting Party</option>
                          </select>
                        </div>
                        <div className="flex gap-1 justify-end">
                          <button type="button" onClick={() => setShowAddInvPerson(false)} className="px-2 py-0.5 text-[9px] border border-[var(--spm-border)] text-rmpg-400 hover:text-rmpg-200">Cancel</button>
                          <button type="submit" className="px-2 py-0.5 text-[9px] font-bold bg-rmpg-600 text-rmpg-100 hover:bg-rmpg-500">Add</button>
                        </div>
                      </form>
                    )}
                    {involvedPersons.length === 0 && !showAddInvPerson && (
                      <p className="text-[9px] text-rmpg-500 italic">No inline subjects recorded.</p>
                    )}
                    {involvedPersons.map((p: any) => (
                      <div key={p.id} className="flex items-center justify-between text-[10px] px-1.5 py-0.5 mb-0.5 border border-[var(--spm-border)]" style={{ background: 'var(--surface-base)' }}>
                        <span className="flex items-center gap-1.5 min-w-0">
                          <span className="text-[8px] font-bold uppercase px-1 py-px bg-rmpg-700 text-rmpg-200 shrink-0">{p.role?.replace(/_/g, ' ')}</span>
                          <span className="font-medium truncate">{p.name}</span>
                          {p.dob && <span className="text-rmpg-400 shrink-0">DOB {p.dob}</span>}
                          {p.id_number && <span className="text-rmpg-400 shrink-0">ID {p.id_number}</span>}
                        </span>
                        <button
                          type="button"
                          onClick={async () => {
                            await apiFetch(`/dispatch/calls/${selectedCall?.id}/involved-persons/${p.id}`, { method: 'DELETE' }).catch(() => {});
                            setInvolvedPersons(prev => prev.filter(x => x.id !== p.id));
                          }}
                          className="text-red-400 hover:text-red-300 ml-2 shrink-0 text-[11px] leading-none"
                          title="Remove"
                        >×</button>
                      </div>
                    ))}
                  </div>
                )}

                {/* ── INLINE INVOLVED VEHICLES ─── */}
                {(detailTab === 'info' || detailTab === 'persons') && (
                  <div className="mt-2 border border-[var(--spm-border)] p-2" style={{ background: 'var(--surface-raised)' }}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[9px] font-bold uppercase tracking-wider text-[color:var(--field-label-color)]">
                        Involved Vehicles{involvedVehicles.length > 0 && ` (${involvedVehicles.length})`}
                      </span>
                      {!showAddInvVehicle && (
                        <button
                          type="button"
                          onClick={() => { setShowAddInvVehicle(true); setNewInvVehicle({ plate: '', make: '', model: '', color: '', role: 'involved' }); }}
                          className="text-[9px] px-1.5 py-0.5 border border-[var(--spm-border)] text-rmpg-300 hover:text-rmpg-100 hover:border-rmpg-400"
                        >+ Add Vehicle</button>
                      )}
                    </div>
                    {showAddInvVehicle && (
                      <form
                        onSubmit={async (e) => {
                          e.preventDefault();
                          if (!selectedCall?.id) return;
                          try {
                            const created = await apiFetch<any>(`/dispatch/calls/${selectedCall.id}/involved-vehicles`, {
                              method: 'POST',
                              body: JSON.stringify(newInvVehicle),
                            });
                            setInvolvedVehicles(prev => [...prev, created]);
                            setShowAddInvVehicle(false);
                          } catch { addToast('Failed to add vehicle', 'error'); }
                        }}
                        className="mb-2 space-y-1"
                      >
                        <div className="grid grid-cols-2 gap-1">
                          <input
                            className="input-dark text-xs"
                            placeholder="Plate number"
                            value={newInvVehicle.plate}
                            onChange={e => setNewInvVehicle(p => ({ ...p, plate: e.target.value }))}
                          />
                          <input
                            className="input-dark text-xs"
                            placeholder="Color"
                            value={newInvVehicle.color}
                            onChange={e => setNewInvVehicle(p => ({ ...p, color: e.target.value }))}
                          />
                          <input
                            className="input-dark text-xs"
                            placeholder="Make"
                            value={newInvVehicle.make}
                            onChange={e => setNewInvVehicle(p => ({ ...p, make: e.target.value }))}
                          />
                          <input
                            className="input-dark text-xs"
                            placeholder="Model"
                            value={newInvVehicle.model}
                            onChange={e => setNewInvVehicle(p => ({ ...p, model: e.target.value }))}
                          />
                          <select
                            className="select-dark text-xs col-span-2"
                            value={newInvVehicle.role}
                            onChange={e => setNewInvVehicle(p => ({ ...p, role: e.target.value }))}
                          >
                            <option value="suspect">Suspect Vehicle</option>
                            <option value="victim">Victim Vehicle</option>
                            <option value="involved">Involved</option>
                          </select>
                        </div>
                        <div className="flex gap-1 justify-end">
                          <button type="button" onClick={() => setShowAddInvVehicle(false)} className="px-2 py-0.5 text-[9px] border border-[var(--spm-border)] text-rmpg-400 hover:text-rmpg-200">Cancel</button>
                          <button type="submit" className="px-2 py-0.5 text-[9px] font-bold bg-rmpg-600 text-rmpg-100 hover:bg-rmpg-500">Add</button>
                        </div>
                      </form>
                    )}
                    {involvedVehicles.length === 0 && !showAddInvVehicle && (
                      <p className="text-[9px] text-rmpg-500 italic">No inline vehicles recorded.</p>
                    )}
                    {involvedVehicles.map((v: any) => (
                      <div key={v.id} className="flex items-center justify-between text-[10px] px-1.5 py-0.5 mb-0.5 border border-[var(--spm-border)]" style={{ background: 'var(--surface-base)' }}>
                        <span className="flex items-center gap-1.5 min-w-0">
                          <span className="text-[8px] font-bold uppercase px-1 py-px bg-rmpg-700 text-rmpg-200 shrink-0">{v.role?.replace(/_/g, ' ')}</span>
                          <span className="font-medium truncate">
                            {[v.color, v.make, v.model].filter(Boolean).join(' ') || 'Unknown'}
                          </span>
                          {v.plate && <span className="text-rmpg-300 font-mono shrink-0">{v.plate}</span>}
                        </span>
                        <button
                          type="button"
                          onClick={async () => {
                            await apiFetch(`/dispatch/calls/${selectedCall?.id}/involved-vehicles/${v.id}`, { method: 'DELETE' }).catch(() => {});
                            setInvolvedVehicles(prev => prev.filter(x => x.id !== v.id));
                          }}
                          className="text-red-400 hover:text-red-300 ml-2 shrink-0 text-[11px] leading-none"
                          title="Remove"
                        >×</button>
                      </div>
                    ))}
                  </div>
                )}

                {/* ── NARRATIVE / INCIDENT SUMMARY ─── */}
                {(detailTab === 'info' || detailTab === 'persons') && (
                  <div className="mt-2 border border-[var(--spm-border)] p-2" style={{ background: 'var(--surface-raised)' }}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[9px] font-bold uppercase tracking-wider text-[color:var(--field-label-color)]">Narrative / Incident Summary</span>
                      {narrativeSaving && <span className="text-[8px] text-rmpg-500 italic">Saving…</span>}
                    </div>
                    <textarea
                      className="textarea-dark text-xs w-full"
                      rows={4}
                      placeholder="Enter structured narrative or incident summary…"
                      value={callNarrative}
                      onChange={e => setCallNarrative(e.target.value)}
                      onBlur={async () => {
                        if (!selectedCall?.id) return;
                        setNarrativeSaving(true);
                        try {
                          await apiFetch(`/dispatch/calls/${selectedCall.id}/narrative`, {
                            method: 'PATCH',
                            body: JSON.stringify({ narrative: callNarrative }),
                          });
                        } catch { addToast('Failed to save narrative', 'error'); }
                        finally { setNarrativeSaving(false); }
                      }}
                    />
                    <p className="text-[8px] text-rmpg-500 mt-0.5">Auto-saves on blur. Separate from call description / notes log.</p>
                  </div>
                )}

                {/* ── SCENE DETAILS — Info tab ─── */}
                {detailTab === 'info' && (isEditing || selectedCall.scene_safety || selectedCall.weather_conditions || selectedCall.lighting_conditions || selectedCall.alcohol_involved || selectedCall.drugs_involved || selectedCall.domestic_violence || selectedCall.le_notified || selectedCall.damage_estimate || selectedCall.action_taken) && (
                  <div className="border-t border-[var(--spm-border)] pt-3 mb-3">
                    <label className="field-label !flex items-center gap-1.5 mb-2" style={{ color: 'var(--brand-gold)', fontSize: '9px', letterSpacing: '0.05em' }}>
                      <Thermometer className="w-3 h-3" /> Scene / Additional
                    </label>
                    {isEditing ? (() => {
                      const leIsOther = editData.le_agency && !(LE_AGENCY_OPTIONS as readonly string[]).includes(editData.le_agency);
                      return (
                      <div className="space-y-2 mt-1">
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                          <div>
                            <label className="text-[9px] text-[color:var(--field-label-color)]">Scene Safety</label>
                            <select className="input-dark text-xs" value={(SCENE_SAFETY_OPTIONS as readonly string[]).includes(editData.scene_safety) ? editData.scene_safety : ''} onChange={(e) => updateEditField('scene_safety', e.target.value)}>
                              {SCENE_SAFETY_OPTIONS.map(s => <option key={s} value={s}>{s || '— Select —'}</option>)}
                            </select>
                          </div>
                          <div>
                            <label className="text-[9px] text-[color:var(--field-label-color)]">Weather</label>
                            <select className="input-dark text-xs" value={(WEATHER_OPTIONS as readonly string[]).includes(editData.weather_conditions) ? editData.weather_conditions : ''} onChange={(e) => updateEditField('weather_conditions', e.target.value)}>
                              {WEATHER_OPTIONS.map(w => <option key={w} value={w}>{w || '— Select —'}</option>)}
                            </select>
                          </div>
                          <div>
                            <label className="text-[9px] text-[color:var(--field-label-color)]">Lighting</label>
                            <select className="input-dark text-xs" value={(LIGHTING_OPTIONS as readonly string[]).includes(editData.lighting_conditions) ? editData.lighting_conditions : ''} onChange={(e) => updateEditField('lighting_conditions', e.target.value)}>
                              {LIGHTING_OPTIONS.map(l => <option key={l} value={l}>{l || '— Select —'}</option>)}
                            </select>
                          </div>
                        </div>
                        <div className="flex flex-wrap items-center gap-4">
                          <label className="flex items-center gap-1 text-xs text-rmpg-300 cursor-pointer"><input type="checkbox" checked={editData.alcohol_involved} onChange={(e) => updateEditField('alcohol_involved', e.target.checked)} className="accent-amber-500" /> Alcohol</label>
                          <label className="flex items-center gap-1 text-xs text-rmpg-300 cursor-pointer"><input type="checkbox" checked={editData.drugs_involved} onChange={(e) => updateEditField('drugs_involved', e.target.checked)} className="accent-red-500" /> Drugs</label>
                          <label className="flex items-center gap-1 text-xs text-rmpg-300 cursor-pointer"><input type="checkbox" checked={editData.domestic_violence} onChange={(e) => updateEditField('domestic_violence', e.target.checked)} className="accent-red-500" /> DV</label>
                          <label className="flex items-center gap-1 text-xs text-rmpg-300 cursor-pointer"><input type="checkbox" checked={editData.supervisor_notified} onChange={(e) => updateEditField('supervisor_notified', e.target.checked)} className="accent-brand-500" /> Supervisor Notified</label>
                          <label className="flex items-center gap-1 text-xs text-rmpg-300 cursor-pointer"><input type="checkbox" checked={editData.le_notified} onChange={(e) => updateEditField('le_notified', e.target.checked)} className="accent-brand-500" /> LE Notified</label>
                        </div>
                        {editData.le_notified && (
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                            <div>
                              <label className="text-[9px] text-[color:var(--field-label-color)]">LE Agency</label>
                              <select className="input-dark text-xs" value={leIsOther ? 'Other — See Notes' : editData.le_agency} onChange={(e) => updateEditField('le_agency', e.target.value)}>
                                {LE_AGENCY_OPTIONS.map(a => <option key={a} value={a}>{a || '— Select —'}</option>)}
                              </select>
                              {(editData.le_agency === 'Other — See Notes' || leIsOther) && (
                                <input type="text" className="input-dark text-xs mt-1" placeholder="Specify agency..." value={leIsOther ? editData.le_agency : ''} onChange={(e) => updateEditField('le_agency', e.target.value || 'Other — See Notes')} />
                              )}
                            </div>
                            <div><label className="text-[9px] text-[color:var(--field-label-color)]">LE Case #</label><input type="text" className="input-dark text-xs" value={editData.le_case_number} onChange={(e) => updateEditField('le_case_number', e.target.value)} /></div>
                          </div>
                        )}
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                          <div><label className="text-[9px] text-[color:var(--field-label-color)]">Damage Estimate ($)</label><input type="number" min="0" step="0.01" className="input-dark text-xs" value={editData.damage_estimate} onChange={(e) => updateEditField('damage_estimate', e.target.value)} /></div>
                          <div><label className="text-[9px] text-[color:var(--field-label-color)]">Damage Description</label><input type="text" className="input-dark text-xs" value={editData.damage_description} onChange={(e) => updateEditField('damage_description', e.target.value)} /></div>
                        </div>
                        <div><label className="text-[9px] text-[color:var(--field-label-color)]">Action Taken</label><textarea className="textarea-dark text-xs" rows={2} value={editData.action_taken} onChange={(e) => updateEditField('action_taken', e.target.value)} /></div>
                        <div>
                          <label className="text-[9px] text-[color:var(--field-label-color)]">Responding Officer</label>
                          <select className="input-dark text-xs" value={editData.responding_officer} onChange={(e) => updateEditField('responding_officer', e.target.value)}>
                            <option value="">— Select Officer —</option>
                            {officers.map(o => (
                              <option key={o.id} value={`${o.full_name}${o.badge_number ? ` (#${o.badge_number})` : ''}`}>
                                {o.full_name}{o.badge_number ? ` (#${o.badge_number})` : ''}
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>
                      );
                    })() : (
                      <div className="flex flex-wrap gap-x-6 gap-y-1 mt-1 text-xs">
                        {selectedCall.scene_safety && <span className="text-rmpg-200"><span className="text-rmpg-400">Scene:</span> {selectedCall.scene_safety}</span>}
                        {selectedCall.weather_conditions && <span className="text-rmpg-200"><span className="text-rmpg-400">Weather:</span> {selectedCall.weather_conditions}</span>}
                        {selectedCall.lighting_conditions && <span className="text-rmpg-200"><span className="text-rmpg-400">Lighting:</span> {selectedCall.lighting_conditions}</span>}
                        {selectedCall.alcohol_involved && <span className="text-amber-400 font-semibold">ALCOHOL</span>}
                        {selectedCall.drugs_involved && <span className="text-red-400 font-semibold">DRUGS</span>}
                        {selectedCall.domestic_violence && <span className="text-red-400 font-semibold">DV</span>}
                        {selectedCall.supervisor_notified && <span className="text-brand-400">Supervisor Notified</span>}
                        {selectedCall.le_notified && <span className="text-brand-400">LE Notified{selectedCall.le_agency ? ` (${selectedCall.le_agency})` : ''}{selectedCall.le_case_number ? ` #${selectedCall.le_case_number}` : ''}</span>}
                        {selectedCall.damage_estimate && <span className="text-rmpg-200"><span className="text-rmpg-400">Damage:</span> ${selectedCall.damage_estimate}</span>}
                        {selectedCall.damage_description && <span className="text-rmpg-200 basis-full">{selectedCall.damage_description}</span>}
                        {selectedCall.action_taken && <span className="text-rmpg-200 basis-full"><span className="text-rmpg-400">Action:</span> {selectedCall.action_taken}</span>}
                        {selectedCall.responding_officer && <span className="text-rmpg-200"><span className="text-rmpg-400">Resp. Officer:</span> {selectedCall.responding_officer}</span>}
                      </div>
                    )}
                  </div>
                )}

                {/* ── PSO CLIENT REQUEST DETAILS — Info tab ─── */}
                {detailTab === 'info' && (isEditing || selectedCall.pso_requestor_name || selectedCall.pso_service_type || selectedCall.pso_billing_code || selectedCall.pso_authorization || PROCESS_SERVICE_INCIDENT_TYPES.has(selectedCall.incident_type)) && (
                  <div className="border-t border-[var(--spm-border)] pt-3 mb-3">
                    <div className="flex items-center justify-between mb-2">
                      <label className="field-label !flex items-center gap-1.5">
                        <Building2 className="w-3 h-3" /> PSO Client Request Details
                        {(selectedCall.pso_attempt_number || 1) >= 1 && (selectedCall.pso_requestor_name || selectedCall.pso_service_type) && (
                          isAdminOrManager && !isEditing ? (
                            <select
                              className="ml-1.5 px-1 py-0 text-[8px] font-bold rounded-sm cursor-pointer"
                              style={{ background: 'color-mix(in srgb, var(--sev-warn) 19%, transparent)', border: '1px solid color-mix(in srgb, var(--sev-warn) 31%, transparent)', color: 'var(--sev-warn-soft)', appearance: 'auto', minWidth: '90px' }}
                              value={selectedCall.pso_attempt_number || 1}
                              onChange={async (e) => {
                                const newAttempt = parseInt(e.target.value, 10);
                                try {
                                  const result = await apiFetch<any>(`/dispatch/calls/${selectedCall.id}`, {
                                    method: 'PUT',
                                    body: JSON.stringify({ pso_attempt_number: newAttempt }),
                                  });
                                  const updated = mapDbCall(result);
                                  setCalls(prev => prev.map(c => String(c.id) === String(updated.id) ? { ...c, ...updated } : c));
                                  setSelectedCall(prev => prev ? { ...prev, ...updated } : updated);
                                  addToast(`Attempt number set to ${newAttempt}`, 'success');
                                } catch (err) { addToast('Failed to update attempt number', 'error'); }
                              }}
                              title="Admin: change attempt number"
                            >
                              {ATTEMPT_NUMBERS.map(n => (
                                <option key={n} value={n}>{formatOrdinal(n)} ATTEMPT</option>
                              ))}
                            </select>
                          ) : (selectedCall.pso_attempt_number || 1) > 1 ? (
                            <span className="ml-1.5 px-1.5 py-0.5 text-[8px] font-bold rounded-sm" style={{ background: 'color-mix(in srgb, var(--sev-warn) 19%, transparent)', border: '1px solid color-mix(in srgb, var(--sev-warn) 31%, transparent)', color: 'var(--sev-warn-soft)' }}>
                              {formatOrdinal(selectedCall.pso_attempt_number || 1)} ATTEMPT
                            </span>
                          ) : null
                        )}
                      </label>
                      {/* 72-hour countdown indicator */}
                      {!isEditing && PROCESS_SERVICE_INCIDENT_TYPES.has(selectedCall.incident_type) && RESOLVED_STATUSES.has(selectedCall.status) && (() => {
                        const dl = computeResolvedDeadline(selectedCall.closed_at || selectedCall.cleared_at);
                        if (!dl) return null;
                        if (dl.status === 'overdue') return (
                          <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-sm animate-pulse" style={{ background: 'color-mix(in srgb, var(--sev-critical) 25%, transparent)', border: '1px solid color-mix(in srgb, var(--sev-critical) 38%, transparent)', color: 'var(--sev-critical)' }}>
                            72HR OVERDUE — RE-DISPATCH REQUIRED
                          </span>
                        );
                        if (dl.status === 'warning') return (
                          <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-sm" style={{ background: 'color-mix(in srgb, var(--sev-warn) 13%, transparent)', border: '1px solid color-mix(in srgb, var(--sev-warn) 25%, transparent)', color: 'var(--sev-warn-soft)' }}>
                            {dl.hoursLeft}HR UNTIL DEADLINE
                          </span>
                        );
                        return null;
                      })()}
                      {!isEditing && PROCESS_SERVICE_INCIDENT_TYPES.has(selectedCall.incident_type) && INACTIVE_STATUSES.has(selectedCall.status) && (
                        <button type="button"
                          className="toolbar-btn px-2 py-0.5 text-[9px] font-semibold"
                          style={{ background: 'rgb(var(--brand-gold-rgb) / 0.12)', borderColor: 'rgb(var(--brand-gold-rgb) / 0.25)', color: 'var(--brand-gold)' }}
                          onClick={() => {
                            const attempt = (selectedCall.pso_attempt_number || 1) + 1;
                            const ordinal = formatOrdinal(attempt);
                            setPendingConfirm({
                              title: 'Schedule Return Visit',
                              message: `Schedule ${ordinal} return visit for ${selectedCall.call_number}?`,
                              confirmLabel: 'Schedule Visit',
                              run: async () => {
                                try {
                                  const result = await apiFetch(`/dispatch/calls/${selectedCall.id}/redispatch`, {
                                    method: 'POST',
                                    body: JSON.stringify({}),
                                  });
                                  if (result) {
                                    const mapped = mapDbCall(result);
                                    setSelectedCall(mapped);
                                    setCalls(prev => prev.map(c => c.id === mapped.id ? mapped : c));
                                    addToast(`Re-dispatched — ${ordinal} visit`, 'success');
                                  }
                                } catch (err: any) { addToast(`Failed to re-dispatch: ${err?.message || 'Unknown error'}`, 'error'); }
                              },
                            });
                          }}
                          title="Re-dispatch this PSO call with a new visit number"
                        >
                          <RotateCcw style={{ width: 9, height: 9, display: 'inline', marginRight: 3 }} />
                          Schedule Return Visit
                        </button>
                      )}
                    </div>
                    {(selectedCall.client_id || editData.client_id) && (() => {
                      const cid = String(editData.client_id || selectedCall.client_id);
                      const cli = clientsList.find((c) => String(c.id) === cid);
                      const contractId = editData.contract_id || selectedCall.contract_id;
                      const billing = editData.pso_billing_code || selectedCall.pso_billing_code;
                      const auth = editData.pso_authorization || selectedCall.pso_authorization;
                      return (
                        <div className="mb-2 inline-flex flex-wrap items-center gap-2 px-2 py-1 bg-brand-900/20 border border-brand-700/40 rounded-sm text-[10px]">
                          <span className="text-[color:var(--field-label-color)] uppercase font-black text-[8px] tracking-wide">Client</span>
                          <span className="text-rmpg-100 font-semibold">{cli?.name || `#${cid}`}</span>
                          {contractId && <span className="text-rmpg-300">Contract: {contractId}</span>}
                          {billing && <span className="text-rmpg-300">Billing: {billing}</span>}
                          {auth && <span className="text-rmpg-300">Auth: {auth}</span>}
                        </div>
                      );
                    })()}
                    {isEditing ? (
                      <div className="space-y-2 mt-1">
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                          <div><label className="text-[9px] text-[color:var(--field-label-color)]">Requestor Name</label><input type="text" className="input-dark text-xs" placeholder="Requestor name" value={editData.pso_requestor_name} onChange={(e) => updateEditField('pso_requestor_name', e.target.value)} /></div>
                          <div><label className="text-[9px] text-[color:var(--field-label-color)]">Requestor Phone</label><input type="text" inputMode="tel" className="input-dark text-xs" placeholder="Phone number" value={editData.pso_requestor_phone} onChange={(e) => updateEditField('pso_requestor_phone', formatPhoneInput(e.target.value))} /></div>
                          <div><label className="text-[9px] text-[color:var(--field-label-color)]">Requestor Email</label><input type="text" className="input-dark text-xs" placeholder="Email address" value={editData.pso_requestor_email} onChange={(e) => updateEditField('pso_requestor_email', e.target.value)} /></div>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                          <div>
                            <label className="text-[9px] text-[color:var(--field-label-color)]">Service Type</label>
                            <select className="input-dark text-xs" value={editData.pso_service_type} onChange={(e) => updateEditField('pso_service_type', e.target.value)}>
                              <option value="">— Select Service Type —</option>
                              {SERVICE_TYPE_GROUPS.map(group => (
                                <optgroup key={group.label} label={group.label}>
                                  {group.keys.map(key => (
                                    <option key={key} value={key}>{SERVICE_TYPE_LABELS[key]}</option>
                                  ))}
                                </optgroup>
                              ))}
                            </select>
                          </div>
                          <div><label className="text-[9px] text-[color:var(--field-label-color)]">Billing Code</label><input type="text" className="input-dark text-xs" placeholder="Billing code" value={editData.pso_billing_code} onChange={(e) => updateEditField('pso_billing_code', e.target.value)} /></div>
                          <div><label className="text-[9px] text-[color:var(--field-label-color)]">Authorization</label><input type="text" className="input-dark text-xs" placeholder="Authorization #" value={editData.pso_authorization} onChange={(e) => updateEditField('pso_authorization', e.target.value)} /></div>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                          <div><label className="text-[9px] text-[color:var(--field-label-color)]">Contract ID</label><input type="text" className="input-dark text-xs" placeholder="Contract ID" value={editData.contract_id} onChange={(e) => updateEditField('contract_id', e.target.value)} /></div>
                        </div>
                      </div>
                    ) : (
                      <div className="space-y-2 mt-1">
                        {/* Prominent client/requestor badges */}
                        <div className="flex flex-wrap gap-1.5">
                          {selectedCall.pso_requestor_name && (
                            <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-sm" style={{ background: 'rgb(var(--brand-gold-rgb) / 0.09)', border: '1px solid rgb(var(--brand-gold-rgb) / 0.25)', color: 'var(--sev-warn-soft)' }}>
                              <Building2 style={{ width: 10, height: 10 }} /> {selectedCall.pso_requestor_name}
                            </span>
                          )}
                          {selectedCall.pso_billing_code && (
                            <span className="inline-flex items-center gap-1 text-[10px] font-bold font-mono px-2 py-0.5 rounded-sm" style={{ background: 'color-mix(in srgb, var(--sev-ok) 8%, transparent)', border: '1px solid color-mix(in srgb, var(--sev-ok) 21%, transparent)', color: 'var(--sev-ok-soft)' }}>
                              {selectedCall.pso_billing_code}
                            </span>
                          )}
                          {selectedCall.pso_authorization && (
                            <span className="inline-flex items-center gap-1 text-[10px] font-bold font-mono px-2 py-0.5 rounded-sm" style={{ background: 'color-mix(in srgb, var(--spm-text-muted) 8%, transparent)', border: '1px solid color-mix(in srgb, var(--spm-text-muted) 21%, transparent)', color: 'var(--spm-text)' }}>
                              AUTH: {selectedCall.pso_authorization}
                            </span>
                          )}
                          {selectedCall.contract_id && (
                            <span className="inline-flex items-center gap-1 text-[10px] font-mono px-2 py-0.5 rounded-sm" style={{ background: 'color-mix(in srgb, var(--sev-special) 8%, transparent)', border: '1px solid color-mix(in srgb, var(--sev-special) 21%, transparent)', color: 'var(--sev-special-soft)' }}>
                              Contract: {selectedCall.contract_id}
                            </span>
                          )}
                        </div>
                        {/* Additional details */}
                        <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs">
                          {selectedCall.pso_requestor_phone && <span className="text-rmpg-200"><span className="text-rmpg-400">Phone:</span> {selectedCall.pso_requestor_phone}</span>}
                          {selectedCall.pso_requestor_email && <span className="text-rmpg-200"><span className="text-rmpg-400">Email:</span> {selectedCall.pso_requestor_email}</span>}
                          {selectedCall.pso_service_type && <span className="text-rmpg-200"><span className="text-rmpg-400">Service:</span> {formatServiceType(selectedCall.pso_service_type)}</span>}
                        </div>
                        {/* 72-hour deadline countdown for active PSO calls */}
                        {PROCESS_SERVICE_INCIDENT_TYPES.has(selectedCall.incident_type) && selectedCall.created_at && selectedCall.status !== 'archived' && (() => {
                          const dl = computeActiveDeadline(selectedCall.created_at);
                          if (dl.status === 'overdue') return (
                            <div className="text-[10px] font-mono font-bold animate-pulse" style={{ color: 'var(--sev-critical)' }}>
                              72HR DEADLINE PASSED
                            </div>
                          );
                          return (
                            <div className="text-[10px] font-mono" style={{ color: dl.status === 'warning' ? 'var(--sev-warn-soft)' : 'var(--sev-ok)' }}>
                              {dl.hoursLeft}h {dl.minsLeft}m until 72hr deadline
                            </div>
                          );
                        })()}
                        {!isDetailLoading && !selectedCall.pso_requestor_name && !selectedCall.pso_service_type && PROCESS_SERVICE_INCIDENT_TYPES.has(selectedCall.incident_type) && (
                          <span className="text-rmpg-500 italic text-xs">No PSO details entered yet</span>
                        )}
                      </div>
                    )}

                    {/* PSO Service Window Compliance Checklist (desktop) */}
                    {!isEditing && PROCESS_SERVICE_INCIDENT_TYPES.has(selectedCall.incident_type) && (() => {
                      const windows = parsePsoServiceWindows(selectedCall.pso_service_windows);
                      const metCount = SERVICE_WINDOW_SLOTS.filter(s => windows[s.key]).length;
                      if (metCount === 0) return null;
                      const allMet = metCount === SERVICE_WINDOW_SLOTS.length;
                      return (
                        <div className="mt-2 pt-2 border-t border-rmpg-700">
                          <div className="flex items-center gap-2 mb-1.5">
                            <span className="text-[9px] font-bold uppercase tracking-wider text-rmpg-400">Service Windows</span>
                            <span className="text-[8px] font-mono px-1 rounded-sm" style={{
                              background: allMet ? 'color-mix(in srgb, var(--sev-ok) 13%, transparent)' : 'color-mix(in srgb, var(--sev-warn) 13%, transparent)',
                              border: `1px solid ${allMet ? 'color-mix(in srgb, var(--sev-ok) 25%, transparent)' : 'color-mix(in srgb, var(--sev-warn) 25%, transparent)'}`,
                              color: allMet ? 'var(--sev-ok)' : 'var(--sev-warn-soft)',
                            }}>
                              {metCount}/{SERVICE_WINDOW_SLOTS.length}
                            </span>
                            {allMet && <span className="text-[8px] font-bold uppercase tracking-wider" style={{ color: 'var(--sev-ok)' }}>✓ Due Diligence Complete</span>}
                          </div>
                          <div className="flex flex-wrap gap-1.5">
                            {SERVICE_WINDOW_SLOTS.map(({ key, label }) => {
                              const met = windows[key];
                              return (
                                <span key={key} className="inline-flex items-center gap-1 text-[9px] py-0.5 px-2 rounded-sm font-mono" style={{
                                  background: met ? 'color-mix(in srgb, var(--sev-ok) 6%, transparent)' : 'color-mix(in srgb, var(--sev-critical) 6%, transparent)',
                                  border: `1px solid ${met ? 'color-mix(in srgb, var(--sev-ok) 19%, transparent)' : 'color-mix(in srgb, var(--sev-critical) 19%, transparent)'}`,
                                  color: met ? 'var(--sev-ok-soft)' : 'var(--sev-critical-soft)',
                                }}>
                                  <span style={{ color: met ? 'var(--sev-ok)' : 'var(--sev-critical)', fontSize: '8px' }}>{met ? '●' : '○'}</span>
                                  {label}
                                </span>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                )}

                {/* ── PROCESS SERVICE DETAILS — Info tab (always visible for PSO/process calls) ─── */}
                {/* Boolean() coerces the numeric process_attempts=0 case to false
                    so React doesn't render a bare "0" when the OR chain falls
                    through to a falsy number. */}
                {detailTab === 'info' && Boolean(isEditing
                  ? ['pso_client_request', 'process_service'].includes(editData.incident_type || selectedCall.incident_type)
                  : (['pso_client_request', 'process_service'].includes(selectedCall.incident_type) || selectedCall.process_service_type || selectedCall.process_served_to || selectedCall.process_attempts)
                ) && (
                  <div className="border-t border-[var(--spm-border)] pt-3 mb-3">
                    <label className="field-label !flex items-center gap-1.5 mb-2" style={{ color: 'var(--brand-gold)', fontSize: '9px', letterSpacing: '0.05em' }}>
                      <FileText className="w-3 h-3" /> Process Service Details
                      {!isEditing && selectedCall.process_service_result && (
                        <span className={`ml-1.5 px-1.5 py-0.5 text-[8px] font-bold rounded-sm ${
                          selectedCall.process_service_result === 'served'
                            ? 'bg-green-900/40 border border-green-700/50 text-green-400'
                            : selectedCall.process_service_result === 'unable_to_serve'
                            ? 'bg-red-900/40 border border-red-700/50 text-red-400'
                            : 'bg-amber-900/40 border border-amber-700/50 text-amber-400'
                        }`}>
                          {toDisplayLabel(selectedCall.process_service_result).toUpperCase()}
                        </span>
                      )}
                      {!isEditing && (selectedCall.process_attempts || 0) > 0 && (
                        <span className="ml-1 px-1.5 py-0.5 text-[8px] font-bold rounded-sm bg-brand-900/40 border border-brand-600/40 text-brand-300">
                          {selectedCall.process_attempts} {selectedCall.process_attempts === 1 ? 'ATTEMPT' : 'ATTEMPTS'}
                        </span>
                      )}
                    </label>
                    {isEditing ? (
                      <div className="space-y-2 mt-1">
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                          <div>
                            <label className="text-[9px] text-amber-400">Document Type</label>
                            <Combobox<{ value: string; label: string }>
                              value={editData.process_service_type ? DOCUMENT_TYPE_OPTIONS.find(o => o.value === editData.process_service_type) ?? null : null}
                              onChange={(opt) => updateEditField('process_service_type', opt?.value ?? '')}
                              options={DOCUMENT_TYPE_OPTIONS}
                              getLabel={(o) => o.label}
                              getKey={(o) => o.value}
                              placeholder="Search document type..."
                            />
                          </div>
                          <div>
                            <label className="text-[9px] text-amber-400">Serve To (Name)</label>
                            <input type="text" className="input-dark text-xs" placeholder="Person to be served" value={editData.process_served_to || ''} onChange={(e) => updateEditField('process_served_to', e.target.value)} />
                          </div>
                          <div>
                            <label className="text-[9px] text-amber-400">Attempts</label>
                            <input type="number" className="input-dark text-xs" min="0" placeholder="0" value={editData.process_attempts ?? 0} onChange={(e) => updateEditField('process_attempts', e.target.value ? parseInt(e.target.value, 10) : 0)} />
                          </div>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                          <div className="sm:col-span-2">
                            <label className="text-[9px] text-amber-400">Court</label>
                            <input
                              type="text"
                              className="input-dark text-xs w-full"
                              placeholder="e.g., Third District Court — Salt Lake County"
                              value={editData.court_name || ''}
                              onChange={(e) => updateEditField('court_name', e.target.value)}
                            />
                          </div>
                          <div>
                            <label className="text-[9px] text-amber-400">Case #</label>
                            <input
                              type="text"
                              className="input-dark text-xs w-full"
                              placeholder="Court case number"
                              value={editData.case_number || ''}
                              onChange={(e) => updateEditField('case_number', e.target.value)}
                            />
                          </div>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                          <div className="sm:col-span-1">
                            <label className="text-[9px] text-amber-400">Service Address</label>
                            <input type="text" className="input-dark text-xs w-full" placeholder="Address for service" value={editData.process_served_address || ''} onChange={(e) => updateEditField('process_served_address', e.target.value)} />
                          </div>
                          <div>
                            <label className="text-[9px] text-amber-400">Served At</label>
                            <input type="datetime-local" step="1" className="input-dark text-xs" value={editData.process_served_at || ''} onChange={(e) => updateEditField('process_served_at', e.target.value)} />
                          </div>
                          <div>
                            <label className="text-[9px] text-amber-400">Service Result</label>
                            <select className="input-dark text-xs" value={editData.process_service_result || ''} onChange={(e) => updateEditField('process_service_result', e.target.value)}>
                              <option value="">— Pending —</option>
                              {PROCESS_SERVICE_RESULT_GROUPS.map(g => (
                                <optgroup key={g.label} label={g.label}>
                                  {g.options.map(o => <option key={o.value} value={o.value}>{o.text}</option>)}
                                </optgroup>
                              ))}
                            </select>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="flex flex-wrap gap-x-6 gap-y-1 mt-1 text-xs">
                        {selectedCall.process_service_type && <span className="text-rmpg-200"><span className="text-rmpg-400">Document:</span> {formatDocumentType(selectedCall.process_service_type)}</span>}
                        {selectedCall.process_served_to && <span className="text-rmpg-200"><span className="text-rmpg-400">Serve To:</span> {selectedCall.process_served_to}</span>}
                        {selectedCall.process_served_address && <span className="text-rmpg-200"><span className="text-rmpg-400">Address:</span> {selectedCall.process_served_address}</span>}
                        {selectedCall.court_name && <span className="text-rmpg-200"><span className="text-fg-muted">Court:</span> {selectedCall.court_name}</span>}
                        {selectedCall.case_number && <span className="text-rmpg-200"><span className="text-fg-muted">Case #:</span> {selectedCall.case_number}</span>}
                        {selectedCall.process_served_at && <span className="text-rmpg-200"><span className="text-rmpg-400">Served At:</span> {formatTime(selectedCall.process_served_at)}</span>}
                        {!isDetailLoading && !selectedCall.process_service_type && !selectedCall.process_served_to && (
                          <span className="text-rmpg-500 italic">No process service details entered yet</span>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {/* ── VISIT HISTORY TIMELINE — PSO calls, Info tab ─── */}
                {detailTab === 'info' && !isEditing && ['pso_client_request', 'process_service'].includes(String(selectedCall.incident_type)) && Array.isArray(selectedCall.visit_history) && selectedCall.visit_history.length > 0 && (
                  <div className="border-t border-[var(--spm-border)] pt-3 mb-3">
                    <label className="field-label !flex items-center gap-1.5 mb-2" style={{ color: 'var(--brand-gold)', fontSize: '9px', letterSpacing: '0.05em' }}>
                      <Clock className="w-3 h-3" /> Visit History
                      <span className="ml-1 px-1.5 py-0.5 text-[8px] font-bold rounded-sm" style={{ background: 'color-mix(in srgb, var(--spm-text-muted) 13%, transparent)', border: '1px solid color-mix(in srgb, var(--spm-text-muted) 25%, transparent)', color: 'var(--spm-text)' }}>
                        {selectedCall.visit_history.length} PRIOR {selectedCall.visit_history.length === 1 ? 'VISIT' : 'VISITS'}
                      </span>
                    </label>
                    <div className="space-y-1.5">
                      {selectedCall.visit_history.map((visit) => {
                        let unitsList: string[] = [];
                        try { unitsList = JSON.parse(visit.assigned_units || '[]'); } catch { /* ignore */ }
                        // Coerce + validate: the `!= null` guard alone passes for
                        // sentinel text ("None"/"0") that this DB stores, and
                        // (string - string) then renders "NaN mi".
                        const startMi = Number(visit.starting_mileage);
                        const endMi = Number(visit.ending_mileage);
                        const totalMiles = Number.isFinite(startMi) && Number.isFinite(endMi)
                          ? (endMi - startMi).toFixed(1)
                          : null;
                        return (
                          <div key={visit.id} className="bg-rmpg-800/60 border border-rmpg-600/50 rounded-sm px-2.5 py-2">
                            <div className="flex items-center justify-between mb-1">
                              <div className="flex items-center gap-2">
                                <span className="text-[9px] font-bold font-mono text-amber-300 bg-amber-900/30 border border-amber-700/40 px-1.5 py-0 tabular-nums">
                                  VISIT #{visit.visit_number}
                                </span>
                                <span className={`text-[8px] font-bold px-1 py-0 rounded-sm ${
                                  visit.status === 'cleared' ? 'bg-green-900/40 border border-green-700/50 text-green-400'
                                  : visit.status === 'closed' ? 'bg-surface-sunken border border-border-default text-rmpg-400'
                                  : visit.status === 'cancelled' ? 'bg-red-900/40 border border-red-700/50 text-red-400'
                                  : 'bg-rmpg-700 border border-rmpg-500 text-rmpg-300'
                                }`}>
                                  {(visit.status || '').toUpperCase()}
                                </span>
                                {visit.disposition && (
                                  <span className="text-[9px] text-rmpg-300">{toDisplayLabel(visit.disposition || '').toUpperCase()}</span>
                                )}
                              </div>
                              {unitsList.length > 0 && (
                                <span className="text-[9px] font-mono text-brand-300">{unitsList.join(', ')}</span>
                              )}
                            </div>
                            <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-[9px]">
                              {visit.dispatched_at && <span className="text-rmpg-300"><span className="text-rmpg-500">Dispatched:</span> {formatTime(visit.dispatched_at)}</span>}
                              {visit.enroute_at && <span className="text-rmpg-300"><span className="text-rmpg-500">En Route:</span> {formatTime(visit.enroute_at)}</span>}
                              {visit.onscene_at && <span className="text-rmpg-300"><span className="text-rmpg-500">On Scene:</span> {formatTime(visit.onscene_at)}</span>}
                              {visit.cleared_at && <span className="text-rmpg-300"><span className="text-rmpg-500">Cleared:</span> {formatTime(visit.cleared_at)}</span>}
                              {visit.closed_at && <span className="text-rmpg-300"><span className="text-rmpg-500">Closed:</span> {formatTime(visit.closed_at)}</span>}
                            </div>
                            {(visit.responding_vehicle_number || totalMiles) && (
                              <div className="flex gap-x-4 text-[9px] mt-0.5">
                                {visit.responding_vehicle_number && <span className="text-rmpg-300"><span className="text-rmpg-500">Vehicle:</span> {visit.responding_vehicle_number}</span>}
                                {visit.starting_mileage != null && <span className="text-rmpg-300"><span className="text-rmpg-500">Start Mi:</span> {visit.starting_mileage.toLocaleString()}</span>}
                                {visit.ending_mileage != null && <span className="text-rmpg-300"><span className="text-rmpg-500">End Mi:</span> {visit.ending_mileage.toLocaleString()}</span>}
                                {totalMiles && <span className="text-green-400 font-bold"><span className="text-rmpg-500">Total:</span> {totalMiles} mi</span>}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* ── QUICK-TOGGLE FLAGS — Flags tab ─── */}
                {detailTab === 'flags' && !isEditing && (
                  <div className="border-t border-[var(--spm-border)] pt-3 mb-3">
                    <label className="field-label !flex items-center gap-1.5 mb-2" style={{ color: 'var(--brand-gold)', fontSize: '9px', letterSpacing: '0.05em' }}>
                      <Shield className="w-3 h-3" /> Quick Flags
                    </label>
                    <div className="flex flex-wrap gap-1.5">
                      {QUICK_FLAGS.map(({ field, label, onBg, onBorder, onText }) => {
                        const isOn = !!(selectedCall as any)[field];
                        return (
                          <button type="button"
                            key={field}
                            className="px-2 py-0.5 text-[9px] font-semibold rounded-sm transition-colors border"
                            style={isOn
                              ? { background: onBg, borderColor: onBorder, color: onText }
                              // Off-state for Quick Flags chips. The previous
                              // var(--color-rmpg-*) tokens DON'T EXIST (the
                              // canonical names are --rmpg-*-rgb for Tailwind
                              // opacity; --color-rmpg-* was never defined), so
                              // every chip was silently falling back to the
                              // off-palette '#888' default. Routed through the
                              // real spillman muted token now.
                              : { background: 'var(--spm-border)', borderColor: 'var(--spm-border)', color: 'var(--spm-text-muted)' }
                            }
                            onClick={async () => {
                              const newVal = !isOn;
                              // Functional setState — rapid-fire flag toggles
                              // would otherwise stomp each other: each closure
                              // captured the selectedCall snapshot at render time
                              // and spread it, reverting any flag toggled mid-flight.
                              // Updating from `prev` keeps every prior toggle.
                              const callId = selectedCall.id;
                              try {
                                await apiFetch(`/dispatch/calls/${callId}`, {
                                  method: 'PUT',
                                  body: JSON.stringify({ [field]: newVal }),
                                });
                                setSelectedCall(prev => prev && prev.id === callId
                                  ? { ...prev, [field]: newVal ? 1 : 0 }
                                  : prev);
                                setCalls(prev => prev.map(c =>
                                  c.id === callId ? { ...c, [field]: newVal ? 1 : 0 } : c
                                ));
                              } catch { addToast(`Failed to update ${label}`, 'error'); }
                            }}
                            title={`Toggle ${label}`}
                          >
                            {isOn ? '✓ ' : ''}{label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* ── ACTIVITY LOG / TIMELINE — Timeline tab ─── */}
                <div className="border-t border-[var(--spm-border)] pt-3 mb-3" style={{ display: detailTab === 'timeline' ? undefined : 'none' }}>
                  <div className="flex items-center justify-between mb-2">
                    <label className="field-label !flex items-center gap-1.5" style={{ color: 'var(--brand-gold)', fontSize: '9px', letterSpacing: '0.05em' }}>
                      <Clock className="w-3 h-3" /> Activity Log
                    </label>
                    <button type="button" onClick={() => setShowAddTimeline(!showAddTimeline)} className="toolbar-btn" style={{ padding: '1px 6px', fontSize: '9px' }}>
                      <PlusCircle style={{ width: 9, height: 9 }} /> Add Entry
                    </button>
                  </div>
                  {showAddTimeline && (
                    <div className="flex gap-2 mb-2">
                      <input type="text" className="input-dark flex-1 text-xs" placeholder="New timeline entry..." spellCheck={true} value={newTimelineText}
                        onChange={(e) => setNewTimelineText(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') handleAddTimeline(); }}
                      />
                      <button type="button" onClick={handleAddTimeline} className="toolbar-btn toolbar-btn-primary" style={{ fontSize: '9px' }} disabled={!newTimelineText.trim()}>Add</button>
                    </div>
                  )}
                  {activityEntries.length > 0 ? (
                    <div className="space-y-1.5 max-h-60 overflow-y-auto">
                      {activityEntries.map((entry: any, idx: number) => {
                        const actionColor = (entry.action || '').includes('dispatch') ? 'var(--sev-warn)' :
                          (entry.action || '').includes('enroute') ? 'var(--spm-text-muted)' :
                          (entry.action || '').includes('onscene') || (entry.action || '').includes('on_scene') ? 'var(--sev-special)' :
                          (entry.action || '').includes('clear') ? 'var(--sev-ok)' :
                          (entry.action || '').includes('note') ? 'var(--spm-text-muted)' :
                          'var(--spm-text-muted)';
                        return (
                        <div key={entry.id} className="group flex items-start gap-2 text-xs hover:bg-[color-mix(in_srgb,var(--surface-sunken)_13%,transparent)] px-1.5 py-1 transition-colors relative" style={{ borderLeft: '2px solid var(--border-default)' }}>
                          {/* Step connector dot */}
                          <div className="absolute -left-[5px] top-[7px] w-2 h-2 rounded-full flex-shrink-0" style={{ background: actionColor, border: '2px solid var(--surface-sunken)' }} />
                          <span className="text-[var(--spm-text-muted)] font-mono whitespace-nowrap pl-1.5 tabular-nums" style={{ fontSize: '9px', minWidth: '60px' }} title={entry.created_at ? timeAgo(entry.created_at) : ''}>
                            {entry.created_at ? `${formatTime(entry.created_at)} (${timeAgo(entry.created_at)})` : '--'}
                          </span>
                          {editingTimelineId === String(entry.id) ? (
                            <div className="flex-1 flex gap-1">
                              <input type="text" className="input-dark text-xs flex-1" value={editTimelineText}
                                onChange={(e) => setEditTimelineText(e.target.value)}
                                onKeyDown={(e) => { if (e.key === 'Enter') handleEditTimeline(String(entry.id)); if (e.key === 'Escape') setEditingTimelineId(null); }}
                                autoFocus
                              />
                              <button type="button" onClick={() => handleEditTimeline(String(entry.id))} className="toolbar-btn" style={{ padding: '1px 4px', fontSize: '9px' }} aria-label="Save timeline entry">
                                <Save style={{ width: 8, height: 8 }} />
                              </button>
                              <button type="button" onClick={() => setEditingTimelineId(null)} className="toolbar-btn" style={{ padding: '1px 4px', fontSize: '9px' }} aria-label="Cancel timeline edit">
                                <X style={{ width: 8, height: 8 }} />
                              </button>
                            </div>
                          ) : (
                            <>
                              <span className="text-rmpg-200 flex-1">{formatActivityDetails(entry.details || entry.description || '')}</span>
                              <div className="opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 [@media(hover:none)]:opacity-100 flex items-center gap-0.5 transition-opacity">
                                <button type="button" onClick={() => { setEditingTimelineId(String(entry.id)); setEditTimelineText(entry.details || entry.description || ''); }} className="p-2 sm:p-0.5 min-w-[44px] min-h-[44px] sm:min-w-0 sm:min-h-0 flex items-center justify-center hover:text-[var(--brand-gold)] text-[var(--spm-text-muted)] transition-colors" title="Edit">
                                  <Edit3 style={{ width: 9, height: 9 }} />
                                </button>
                                <button type="button" onClick={() => handleDeleteTimeline(String(entry.id))} className="p-2 sm:p-0.5 min-w-[44px] min-h-[44px] sm:min-w-0 sm:min-h-0 flex items-center justify-center hover:text-red-400 text-[var(--spm-text-muted)] transition-colors" title="Delete">
                                  <Trash2 style={{ width: 9, height: 9 }} />
                                </button>
                              </div>
                            </>
                          )}
                        </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="flex flex-col items-center py-8 text-[var(--spm-text-muted)]">
                      <div className="p-2.5 rounded-sm mb-2.5" style={{ background: 'color-mix(in srgb, var(--surface-sunken) 25%, transparent)', border: '1px solid color-mix(in srgb, var(--spm-border) 19%, transparent)' }}>
                        <Clock className="w-5 h-5" style={{ opacity: 0.3 }} />
                      </div>
                      <p className="text-[10px] font-semibold uppercase tracking-wider mb-0.5">No Activity Recorded</p>
                      <p className="text-[9px] text-[var(--spm-border)]">Click "Add Entry" to start the activity log</p>
                    </div>
                  )}
                </div>

                {/* Notes — fills remaining vertical space — Notes tab */}
                <div className="border-t border-[var(--spm-border)] pt-3 flex-1 flex flex-col min-h-0" style={{ display: detailTab === 'notes' ? undefined : 'none' }}>
                  <label className="field-label !flex items-center gap-1.5 mb-2 flex-shrink-0" style={{ color: 'var(--brand-gold)', fontSize: '9px', letterSpacing: '0.05em' }}>
                    <MessageSquare className="w-3 h-3" /> Notes
                  </label>
                  <div className="space-y-1 mb-3 flex-1 min-h-0 overflow-y-auto">
                    {(Array.isArray(selectedCall.notes) ? selectedCall.notes : []).length === 0 ? (
                      <div className="flex flex-col items-center py-8 text-[var(--spm-text-muted)]">
                        <div className="p-2.5 rounded-sm mb-2.5" style={{ background: 'color-mix(in srgb, var(--surface-sunken) 25%, transparent)', border: '1px solid color-mix(in srgb, var(--spm-border) 19%, transparent)' }}>
                          <MessageSquare className="w-5 h-5" style={{ opacity: 0.3 }} />
                        </div>
                        <p className="text-[10px] font-semibold uppercase tracking-wider mb-0.5">No Notes Yet</p>
                        <p className="text-[9px] text-[var(--spm-border)]">Add a note below to get started</p>
                      </div>
                    ) : (
                      (Array.isArray(selectedCall.notes) ? selectedCall.notes : []).map((note) => (
                      <div key={note.id} className="group flex items-start gap-2 text-xs px-2 py-1.5 rounded-sm transition-colors hover:bg-[color-mix(in_srgb,var(--surface-sunken)_13%,transparent)]" style={{ borderLeft: '2px solid var(--border-default)' }}>
                        <span className="text-[var(--spm-text-muted)] font-mono whitespace-nowrap tabular-nums" style={{ fontSize: '9px', minWidth: '54px' }}>{formatTime(note.timestamp)}</span>
                        <span className="text-[var(--brand-gold)] font-bold whitespace-nowrap text-[10px]">{note.author || 'System'}</span>
                        {editingNoteId === note.id ? (
                          <div className="flex-1 min-w-0 flex flex-col gap-1">
                            <NoteComposer
                              value={editingNoteText}
                              onChange={setEditingNoteText}
                              onSubmit={() => handleEditNote(note.id, editingNoteText)}
                              autoFocus
                            />
                            <div className="flex gap-1">
                              <button type="button" className="toolbar-btn toolbar-btn-primary text-[9px] px-2 py-0.5" onClick={() => handleEditNote(note.id, editingNoteText)}>Save</button>
                              <button type="button" className="toolbar-btn text-[9px] px-2 py-0.5" onClick={() => { setEditingNoteId(null); setEditingNoteText(''); }}>Cancel</button>
                            </div>
                          </div>
                        ) : (
                          <>
                            <span className="text-[var(--spm-text)] leading-relaxed flex-1 min-w-0">{renderFormattedText(typeof note.text === 'string' ? note.text : String(note.text ?? ''))}{note.edited_at && <span className="text-[var(--spm-text-muted)] text-[8px] ml-1">(edited)</span>}</span>
                            {isAdminOrManager && (
                              <div className="opacity-0 group-hover:opacity-100 transition-opacity flex gap-0.5 shrink-0">
                                <button type="button" className="p-2 sm:p-0.5 min-w-[44px] min-h-[44px] sm:min-w-0 sm:min-h-0 flex items-center justify-center text-[var(--spm-text-muted)] hover:text-[var(--spm-text)] transition-colors" title="Edit note" onClick={() => { setEditingNoteId(note.id); setEditingNoteText(note.text || ''); }}><Pencil className="w-3 h-3" /></button>
                                <button type="button" className="p-2 sm:p-0.5 min-w-[44px] min-h-[44px] sm:min-w-0 sm:min-h-0 flex items-center justify-center text-[var(--spm-text-muted)] hover:text-[var(--sev-critical)] transition-colors" title="Delete note" onClick={() => handleDeleteNote(note.id)}><Trash2 className="w-3 h-3" /></button>
                              </div>
                            )}
                          </>
                        )}
                      </div>
                      ))
                    )}
                  </div>
                  <div className="flex-shrink-0">
                    <NoteComposer
                      value={newNote}
                      onChange={setNewNote}
                      onSubmit={handleAddNote}
                    />
                    <div className="flex justify-end mt-1">
                      <button type="button" onClick={handleAddNote} className="toolbar-btn toolbar-btn-primary" disabled={!newNote.trim()}>
                        Add
                      </button>
                    </div>
                    {/* Feature 20: Broadcast Note to all assigned units */}
                    {(selectedCall.assigned_units || []).length > 0 && (
                      <div className="flex gap-2 mt-2 pt-2 border-t border-rmpg-700/50">
                        <input
                          type="text"
                          className="input-dark flex-1 text-xs"
                          placeholder="Broadcast to all units on call..."
                          maxLength={500}
                          value={broadcastNoteText}
                          onChange={(e) => setBroadcastNoteText(e.target.value)}
                          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleBroadcastNote(); } }}
                        />
                        <button type="button"
                          onClick={handleBroadcastNote}
                          className="toolbar-btn self-end"
                          disabled={!broadcastNoteText.trim()}
                          style={{ background: 'color-mix(in srgb, var(--sev-special) 13%, transparent)', borderColor: 'color-mix(in srgb, var(--sev-special) 31%, transparent)', color: 'var(--sev-special-soft)', padding: '2px 8px', fontSize: '9px' }}
                          title="Send note to all assigned unit officers"
                        >
                          <Radio style={{ width: 9, height: 9 }} /> Broadcast
                        </button>
                      </div>
                    )}
                  </div>
                </div>

                {/* Linked Incidents — Notes tab */}
                {detailTab === 'notes' && linkedIncidents.length > 0 && (
                  <div className="border-t border-[var(--spm-border)] pt-3 flex-shrink-0">
                    <label className="field-label !flex items-center gap-1.5 mb-2" style={{ color: 'var(--brand-gold)', fontSize: '9px', letterSpacing: '0.05em' }}>
                      <Link className="w-3 h-3" /> Linked Incidents
                    </label>
                    <div className="space-y-1 mt-1">
                      {linkedIncidents.map((inc: any) => (
                        <div
                          key={inc.id || inc.incident_number}
                          className="flex items-center gap-3 px-2.5 py-1.5 cursor-pointer transition-all duration-100 rounded-sm"
                          style={{ border: '1px solid transparent' }}
                          onClick={() => navigate(`/incidents/${inc.id}`)}
                          onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'color-mix(in srgb, var(--surface-sunken) 19%, transparent)'; (e.currentTarget as HTMLElement).style.borderColor = 'color-mix(in srgb, var(--spm-border) 25%, transparent)'; }}
                          onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent'; (e.currentTarget as HTMLElement).style.borderColor = 'transparent'; }}
                        >
                          <span className="font-mono text-green-400 text-xs font-bold tabular-nums" style={{ textShadow: '0 0 6px rgb(var(--sev-ok-rgb) / 0.15)' }}>{inc.incident_number}</span>
                          <span className="min-w-0 text-xs text-rmpg-200 truncate">{formatIncidentType(inc.type || inc.incident_type || '--')}</span>
                          <span className="text-xs text-rmpg-400 uppercase font-semibold">{toDisplayLabel(inc.status) || '--'}</span>
                          {inc.officer_name && (
                            <span className="text-xs text-rmpg-300 ml-auto flex items-center gap-1">
                              <User className="w-3 h-3" /> {inc.officer_name}
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* ── DOCUMENTS TAB ─── */}
                {detailTab === 'documents' && selectedCall.id && (
                  <CallDocumentsPanel callId={Number(selectedCall.id)} />
                )}

                {/* ── ATTACHMENTS TAB ─── */}
                {detailTab === 'attachments' && selectedCall.id && (
                  <div className="px-3 py-2">
                    <FileAttachments
                      entityType="call"
                      entityId={selectedCall.id}
                    />
                  </div>
                )}

                {/* ── AUDIT TAB ─── chronological status changes from activity_log */}
                {detailTab === 'audit' && selectedCall.id && (
                  <div className="px-3 py-2">
                    {auditTrailLoading ? (
                      <div className="text-[11px] text-rmpg-500 font-mono">Loading audit trail…</div>
                    ) : auditTrail.length === 0 ? (
                      <div className="text-[11px] text-rmpg-500 font-mono">No audit entries for this call</div>
                    ) : (
                      <div className="space-y-1">
                        {auditTrail.map((ev: any) => (
                          <div key={ev.id} className="flex items-start gap-2 text-[10px] font-mono py-1 border-b border-[var(--spm-border)]">
                            <span className="text-rmpg-500 tabular-nums whitespace-nowrap">{(ev.created_at || '').slice(5, 16).replace('T', ' ')}</span>
                            <span className="text-amber-300 font-bold uppercase whitespace-nowrap">{toDisplayLabel(ev.action)}</span>
                            <span className="text-rmpg-300 min-w-0 truncate flex-1" title={ev.details || ''}>{ev.details || ''}</span>
                            <span className="text-rmpg-400 whitespace-nowrap">{ev.user_name || ev.username || `#${ev.user_id ?? '?'}`}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Disposition Prompt — shown when Clear is clicked */}
              {dispositionPromptCallId === selectedCall.id && (
                <div className="px-3">
                  <DispositionPrompt
                    callNumber={selectedCall.call_number}
                    dispositionCodes={effectiveDispositionCodes}
                    onConfirm={handleConfirmClear}
                    onCancel={() => setDispositionPromptCallId(null)}
                  />
                </div>
              )}

              {/* BOLO Alert Banner — matches active BOLOs */}
              {selectedCall.subject_description || selectedCall.vehicle_description ? (
                <div className="px-3">
                  <BoloAlertBanner
                    address={selectedCall.location}
                    subject={selectedCall.subject_description}
                    vehicle={selectedCall.vehicle_description}
                  />
                </div>
              ) : null}

            </>
          ) : (
            <div className="flex-1 flex items-center justify-center text-[var(--spm-text-muted)]">
              <div className="text-center">
                <div className="mx-auto mb-4 w-14 h-14 flex items-center justify-center rounded-sm" style={{ background: 'color-mix(in srgb, var(--surface-sunken) 38%, transparent)', border: '1px solid color-mix(in srgb, var(--spm-border) 25%, transparent)' }}>
                  <Radio className="w-7 h-7" style={{ opacity: 0.3 }} />
                </div>
                <p className="text-[11px] font-semibold uppercase tracking-wider mb-1.5">Select a call to view details</p>
                <p className="text-[10px] text-[var(--spm-text-muted)] max-w-[220px] mx-auto leading-relaxed">Click a call card or use arrow keys to navigate</p>
                <div className="flex items-center justify-center gap-4 mt-4 text-[9px] font-mono text-[var(--spm-text-muted)]">
                  <div className="flex items-center gap-1.5">
                    <kbd className="px-1.5 py-0.5 border border-[var(--spm-border)] rounded-sm bg-[color-mix(in_srgb,var(--surface-sunken)_25%,transparent)] text-[var(--spm-text-muted)]">N</kbd>
                    <span>New Call</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <kbd className="px-1.5 py-0.5 border border-[var(--spm-border)] rounded-sm bg-[color-mix(in_srgb,var(--surface-sunken)_25%,transparent)] text-[var(--spm-text-muted)]">P</kbd>
                    <span>Quick PSO</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <kbd className="px-1.5 py-0.5 border border-[var(--spm-border)] rounded-sm bg-[color-mix(in_srgb,var(--surface-sunken)_25%,transparent)] text-[var(--spm-text-muted)]">R</kbd>
                    <span>Refresh</span>
                  </div>
                </div>
              </div>
            </div>
          )}
          </div>

          {/* AI Dispatch Sidebar (conditionally shown between detail and map) */}
          {showAiSidebar && selectedCall && (
            <AIDispatchSidebar
              selectedCall={selectedCall}
              aiAnalyses={aiAnalyses}
              onAcceptFlag={async (callId, flag) => {
                try {
                  await apiFetch(`/dispatch/calls/${callId}`, {
                    method: 'PUT',
                    body: JSON.stringify({ [flag]: true }),
                  });
                  const updated = { ...selectedCall, [flag]: 1 };
                  setSelectedCall(updated);
                  setCalls(prev => prev.map(c => c.id === callId ? updated : c));
                  addToast(`Flag "${toDisplayLabel(flag)}" accepted`, 'success');
                } catch { addToast(`Failed to set flag`, 'error'); }
              }}
              onDismiss={() => setShowAiSidebar(false)}
            />
          )}

          {/* Dispatch Code Quick Panel (conditionally shown between detail and map) */}
          {showCodePanel && (
            <DispatchCodeQuickPanel
              onApplyCode={handleApplyCode}
              onDismiss={() => setShowCodePanel(false)}
            />
          )}

          {/* Dispatch Map Panel (right side, always visible on screen; hidden
              on print — a live interactive map has no printable value, and
              without print:hidden this w-[35%] flex-col panel squeezed down
              to a near-zero-height sliver alongside the call record data
              instead of being excluded like every other page's
              interactive-only chrome (see print:hidden usage elsewhere,
              e.g. CaseManagementPage.tsx). */}
          <div className="w-[35%] border-l border-[var(--spm-border)] flex flex-col overflow-hidden flex-shrink-0 print:hidden" style={{ background: 'var(--surface-deep)' }}>
            {(() => {
              const callHasLocation = selectedCall?.latitude != null && selectedCall?.longitude != null;
              // Mapbox path is null-call safe (renders units even with no
              // selected call), so it can stay up whenever any unit has a
              // GPS fix — e.g. the CAD board before a call is picked. The
              // Google Maps fallback assumes a located call throughout, so
              // it keeps the stricter gate.
              const anyUnitHasLocation = units.some((u) => u.latitude != null && u.longitude != null);
              if (mapEngine === 'mapbox' ? (callHasLocation || anyUnitHasLocation) : callHasLocation) return true;
              return false;
            })() ? (
              mapEngine === 'mapbox' ? (
                <MapboxMiniMap
                  call={selectedCall}
                  units={units}
                  fullHeight
                  onRouteUpdate={setRouteInfo}
                />
              ) : (
                <DispatchMiniMap
                  call={selectedCall}
                  units={units}
                  fullHeight
                  onRouteUpdate={setRouteInfo}
                  serveRouteJobs={PROCESS_SERVICE_INCIDENT_TYPES.has(selectedCall?.incident_type || '') ? serveRouteJobs : undefined}
                  serveRouteOrder={PROCESS_SERVICE_INCIDENT_TYPES.has(selectedCall?.incident_type || '') ? serveRouteOrder : undefined}
                />
              )
            ) : (
              <div className="flex-1 flex items-center justify-center text-[var(--spm-text-muted)]">
                <div className="text-center">
                  <div className="mx-auto mb-3 w-14 h-14 flex items-center justify-center rounded-sm" style={{ background: 'color-mix(in srgb, var(--surface-sunken) 31%, transparent)', border: '1px dashed color-mix(in srgb, var(--spm-border) 25%, transparent)' }}>
                    <MapPin className="w-6 h-6" style={{ opacity: 0.25 }} />
                  </div>
                  <p className="text-[10px] font-mono font-bold uppercase tracking-widest mb-1">No Location Data</p>
                  <p className="text-[8px] text-[var(--spm-border)] leading-relaxed max-w-[160px] mx-auto">Select a geolocated call to display the dispatch map</p>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* ------------------------------------------------------------ */}
        {/* BOTTOM - Unit Status Board (shorter, ~35% height) */}
        {/* ------------------------------------------------------------ */}
        <div className="h-[35%] flex flex-col overflow-hidden flex-shrink-0">
          <PanelTitleBar title="UNIT STATUS BOARD" icon={Radio}>
            <span className="flex items-center gap-1 text-[9px] font-mono font-bold tabular-nums" style={{ color: 'var(--sev-ok)' }}>
              <span className="w-1.5 h-1.5 rounded-full" style={{ background: 'var(--sev-ok)', boxShadow: '0 0 4px color-mix(in srgb, var(--sev-ok) 50%, transparent)' }} />
              {units.filter((u) => u.status === 'available').length} AVAIL
            </span>
            <span className="text-[9px] font-mono tabular-nums" style={{ color: 'var(--spm-text)' }}>
              {units.filter((u) => u.status === 'dispatched').length} DISP
            </span>
            <span className="text-[9px] font-mono tabular-nums" style={{ color: 'var(--sev-special-soft)' }}>
              {units.filter((u) => u.status === 'enroute').length} ENR
            </span>
            <span className="text-[9px] font-mono tabular-nums" style={{ color: 'var(--sev-special-soft)' }}>
              {units.filter((u) => u.status === 'onscene').length} ONS
            </span>
            <span className="toolbar-separator" />
            <span className="text-[9px] font-mono tabular-nums" style={{ color: 'var(--spm-text-muted)' }}>
              {units.filter((u) => u.status !== 'off_duty').length}/{units.length} ON DUTY
            </span>
            <span className="toolbar-separator" />
            {isSupervisorPlus && (
              <button
                type="button"
                onClick={handleOptimizeAssignments}
                disabled={dispatchOptimization.status === 'pending' || dispatchOptimization.status === 'processing'}
                className="toolbar-btn toolbar-btn-secondary disabled:opacity-50 disabled:cursor-not-allowed"
                title="Optimize unit-to-call assignments with Mapbox V2"
              >
                {dispatchOptimization.status === 'pending' || dispatchOptimization.status === 'processing'
                  ? `Optimizing… ${Math.round(dispatchOptimization.elapsedMs / 1000)}s`
                  : 'Optimize Assignments'}
              </button>
            )}
            <button type="button" onClick={() => setShowCreateUnitModal(true)} className="toolbar-btn toolbar-btn-primary">
              <Plus style={{ width: 10, height: 10 }} /> New Unit
            </button>
          </PanelTitleBar>
          <div className="flex-1 overflow-auto">
            <UnitStatusBoard
              units={units}
              onUnitClick={(unit) => {
                if (unit.current_call_id) {
                  const call = calls.find((c) => c.id === unit.current_call_id);
                  if (call) setSelectedCall(call);
                }
              }}
              onCreateUnit={() => setShowCreateUnitModal(true)}
              onEditUnit={openEditUnit}
              onDeleteUnit={(unit) => setDeletingUnit(unit)}
              selectedCallId={selectedCall?.id ?? null}
              assignedUnitIds={selectedCall?.assigned_units ?? []}
              unitWorkload={unitWorkload}
              onAssignUnit={selectedCall && !TERMINAL_STATUSES.has(selectedCall.status) ? handleAssignUnit : undefined}
              onStatusChange={handleQuickUnitStatus}
            />
          </div>
        </div>
      </div>
      {/* Activity Feed collapsible sidebar */}
      <ActivityFeed isOpen={showActivityFeed} onClose={() => setShowActivityFeed(false)} />
      </div>

      {/* Keyboard-shortcut cheat sheet (toggle with "?") */}
      {showShortcutHelp && (
        <div
          className="fixed inset-0 z-[200] flex items-center justify-center bg-black/70"
          onClick={() => setShowShortcutHelp(false)}
        >
          <div
            className="bg-surface-base border border-[var(--spm-border)] rounded-sm max-w-2xl w-[92%] max-h-[85vh] overflow-auto scrollbar-dark"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-4 py-2 border-b border-[var(--spm-border)] sticky top-0 bg-surface-base">
              <div className="flex items-center gap-2 text-[var(--brand-gold)] text-xs font-bold uppercase tracking-wider">
                <Terminal className="w-3.5 h-3.5" /> Keyboard Shortcuts
              </div>
              <button type="button" aria-label="Close" onClick={() => setShowShortcutHelp(false)} className="text-rmpg-400 hover:text-rmpg-100">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-4 grid grid-cols-1 sm:grid-cols-3 gap-4">
              {KEYBOARD_SHORTCUT_GROUPS.map(({ group, items }) => (
                <div key={group}>
                  <div className="text-[9px] font-bold uppercase tracking-wide text-rmpg-400 mb-1.5">{group}</div>
                  <div className="space-y-1">
                    {items.map(([keys, desc]) => (
                      <div key={keys} className="flex items-center justify-between gap-2 text-[11px]">
                        <kbd className="font-mono text-amber-300 bg-amber-900/20 border border-amber-700/30 px-1 py-0 rounded-sm whitespace-nowrap">{keys}</kbd>
                        <span className="text-rmpg-300 text-right">{desc}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Right-Click Context Menu */}
      {contextMenu && (
        <div
          className="fixed z-[100]"
          style={{
            left: Math.min(contextMenu.x, window.innerWidth - 200),
            top: Math.min(contextMenu.y, window.innerHeight - 300),
          }}
        >
          <div
            className="py-1 min-w-[190px] rounded-sm"
            style={{ background: 'var(--surface-raised)', border: '1px solid var(--spm-border)', boxShadow: '0 8px 24px rgba(0 0 0 / 0.6), 0 0 1px rgba(255,255,255,0.05) inset', WebkitBackdropFilter: 'blur(8px)', backdropFilter: 'blur(8px)' }}
            onMouseLeave={() => setContextMenu(null)}
          >
            {contextMenu.call.status === 'pending' && (
              <>
                <button type="button" className="context-menu-item" onClick={() => { handleStatusChange(contextMenu.call.id, 'dispatched'); setContextMenu(null); }}>
                  <Send style={{ width: 12, height: 12 }} /> Dispatch
                </button>
                <button type="button" className="context-menu-item" style={{ color: 'var(--sev-critical)' }} onClick={() => { handleStatusChange(contextMenu.call.id, 'cancelled'); setContextMenu(null); }}>
                  <XCircle style={{ width: 12, height: 12 }} /> Cancel Call
                </button>
              </>
            )}
            {contextMenu.call.status === 'dispatched' && (
              <button type="button" className="context-menu-item" onClick={() => { handleStatusChange(contextMenu.call.id, 'enroute'); setContextMenu(null); }}>
                <Navigation style={{ width: 12, height: 12 }} /> En Route
              </button>
            )}
            {contextMenu.call.status === 'enroute' && (
              <button type="button" className="context-menu-item" onClick={() => { handleStatusChange(contextMenu.call.id, 'onscene'); setContextMenu(null); }}>
                <Eye style={{ width: 12, height: 12 }} /> On Scene
              </button>
            )}
            {ACTIVE_FIELD_STATUSES.has(contextMenu.call.status) && (
              <>
                <button type="button" className="context-menu-item" onClick={() => { handleClearWithDisposition(contextMenu.call.id); setContextMenu(null); }}>
                  <CheckCircle style={{ width: 12, height: 12 }} /> Clear
                </button>
                <button type="button" className="context-menu-item" onClick={() => { handleHoldCall(contextMenu.call.id); setContextMenu(null); }}>
                  ⏸ Hold
                </button>
                <button type="button" className="context-menu-item" style={{ color: 'var(--sev-critical)' }} onClick={() => { handleStatusChange(contextMenu.call.id, 'cancelled'); setContextMenu(null); }}>
                  <XCircle style={{ width: 12, height: 12 }} /> Cancel Call
                </button>
              </>
            )}
            {contextMenu.call.status === 'on_hold' && (
              <button type="button" className="context-menu-item" onClick={() => { handleResumeCall(contextMenu.call.id); setContextMenu(null); }}>
                ▶ Resume
              </button>
            )}
            {contextMenu.call.status !== 'archived' && (
              <>
                <div className="border-t border-rmpg-600 my-1" />
                <button type="button" className="context-menu-item" onClick={() => { handleArchive(contextMenu.call.id); setContextMenu(null); }}>
                  <Archive style={{ width: 12, height: 12 }} /> Archive
                </button>
              </>
            )}
            <div className="border-t border-rmpg-600 my-1" />
            {/* Priority change shortcuts */}
            <div className="flex items-center gap-0.5 px-2 py-1">
              <span className="text-[9px] text-rmpg-500 mr-1.5">PRI:</span>
              {(['P1', 'P2', 'P3', 'P4'] as const).map(pri => (
                <button key={pri} type="button" onClick={() => { handlePriorityChange(contextMenu.call.id, pri); setContextMenu(null); }}
                  className={`text-[9px] font-bold px-1.5 py-0.5 rounded-sm ${contextMenu.call.priority === pri ? 'ring-1 ring-white' : 'opacity-60 hover:opacity-100'}`}
                  style={{ background: pri === 'P1' ? 'var(--sev-critical)' : pri === 'P2' ? 'var(--sev-warn)' : pri === 'P3' ? 'var(--spm-text-muted)' : 'var(--spm-text-muted)', color: 'var(--text-primary)' }}>
                  {pri}
                </button>
              ))}
            </div>
            <div className="border-t border-rmpg-600 my-1" />
            <button type="button" className="context-menu-item" onClick={() => { setSelectedCall(contextMenu.call); setIsEditing(true); setContextMenu(null); }}>
              <Pencil style={{ width: 12, height: 12 }} /> Edit Call
            </button>
            <button type="button" className="context-menu-item" onClick={() => { navigator.clipboard.writeText(contextMenu.call.call_number); setContextMenu(null); addToast('Call number copied', 'success'); }}>
              Copy Call Number
            </button>
            <button type="button" className="context-menu-item" onClick={() => { navigator.clipboard.writeText(`${contextMenu.call.call_number} | ${contextMenu.call.incident_type} | ${contextMenu.call.location} | ${contextMenu.call.priority} | ${contextMenu.call.status}`); setContextMenu(null); addToast('Call summary copied', 'success'); }}>
              Copy Summary
            </button>
            {contextMenu.call.status !== 'archived' && contextMenu.call.status !== 'cancelled' && (
              <button type="button" className="context-menu-item" onClick={() => {
                // Duplicate call as new — safe access for optional fields
                const c = contextMenu.call;
                setTemplateInitialData({
                  incident_type: c.incident_type || 'other',
                  priority: c.priority || 'P3',
                  location: c.location || '',
                  description: c.description || '',
                  source: c.source || 'dispatch',
                });
                setShowNewCallModal(true);
                setContextMenu(null);
              }}>
                <Copy style={{ width: 12, height: 12 }} /> Duplicate as New
              </button>
            )}
            <div className="border-t border-rmpg-600 my-1" />
            <button type="button" className="context-menu-item text-red-400" onClick={() => { setDeleteCallTarget(contextMenu.call); setContextMenu(null); }}>
              <Trash2 style={{ width: 12, height: 12 }} /> Delete
            </button>
          </div>
        </div>
      )}

      {/* Quick Template Dialog — minimal address-only dispatch */}
      {quickTemplateData && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" role="dialog" aria-modal="true" style={MODAL_BACKDROP_STYLE} onKeyDown={(e) => { if (e.key === 'Escape') setQuickTemplateData(null); }}>
          <form
            className="panel-beveled bg-surface-raised animate-in rounded-sm"
            style={{ width: '440px', ...MODAL_PANEL_STYLE }}
            onSubmit={async (e) => {
              e.preventDefault();
              if (!quickTemplateAddress.trim() || quickTemplateSubmitting) return;
              setQuickTemplateSubmitting(true);
              try {
                await handleNewCall({
                  incident_type: quickTemplateData.incident_type,
                  priority: quickTemplateData.priority as any,
                  description: quickTemplateData.description,
                  source: quickTemplateData.source as any,
                  location: quickTemplateAddress.trim(),
                  latitude: quickTemplateCoords.lat,
                  longitude: quickTemplateCoords.lng,
                } as any);
                setQuickTemplateData(null);
              } catch {
                setQuickTemplateSubmitting(false);
              }
            }}
          >
            {/* Header */}
            <div className="panel-title-bar flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Send className="w-3.5 h-3.5 text-brand-400" />
                <span className="text-xs font-bold text-rmpg-100 uppercase tracking-wider">Quick Dispatch</span>
              </div>
              <button aria-label="Close" type="button" onClick={() => setQuickTemplateData(null)} className="text-rmpg-400 hover:text-rmpg-100">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-4 space-y-4">
              {/* Template banner */}
              <div className="flex items-center gap-3 p-2 border border-rmpg-600" style={{ background: 'var(--surface-sunken)' }}>
                <span className={`text-xs font-bold px-2 py-0.5 border ${
                  quickTemplateData.priority === 'P1' ? 'border-red-500 text-red-400 bg-red-900/30' :
                  quickTemplateData.priority === 'P2' ? 'border-amber-500 text-amber-400 bg-amber-900/30' :
                  quickTemplateData.priority === 'P4' ? 'border-rmpg-500 text-rmpg-300 bg-rmpg-700/30' :
                  'border-brand-500 text-brand-400 bg-brand-900/30'
                }`}>{toDisplayLabel(quickTemplateData.priority)}</span>
                <span className="text-xs font-bold text-rmpg-100">{quickTemplateData.name}</span>
                <span className="text-[10px] text-rmpg-400 ml-auto">{formatIncidentType(quickTemplateData.incident_type)}</span>
              </div>

              {/* Address input — auto-focused */}
              <div>
                <label className="block text-xs font-semibold text-rmpg-300 uppercase mb-1">
                  <MapPin className="w-3 h-3 inline mr-1" />
                  Location / Address *
                </label>
                <AddressAutocomplete
                  className="input-dark"
                  placeholder="123 Main St, Salt Lake City, UT"
                  value={quickTemplateAddress}
                  onChange={setQuickTemplateAddress}
                  onSelect={(addr: ParsedAddress) => {
                    setQuickTemplateAddress(addr.formatted);
                    if (addr.latitude != null) {
                      setQuickTemplateCoords({ lat: addr.latitude, lng: addr.longitude! });
                    }
                  }}
                  autoFocus
                  required
                />
              </div>

              {/* Actions */}
              <div className="flex items-center justify-between pt-2 border-t border-rmpg-700">
                <button
                  type="button"
                  className="toolbar-btn text-xs"
                  onClick={() => {
                    // Transfer data to full NewCallModal
                    setTemplateInitialData({
                      incident_type: quickTemplateData.incident_type,
                      priority: quickTemplateData.priority,
                      description: quickTemplateData.description,
                      source: quickTemplateData.source,
                      location: quickTemplateAddress,
                    });
                    setQuickTemplateData(null);
                    setShowNewCallModal(true);
                  }}
                >
                  Full Form →
                </button>
                <div className="flex items-center gap-2">
                  <button type="button" onClick={() => setQuickTemplateData(null)} className="toolbar-btn text-xs">Cancel</button>
                  <button
                    type="submit"
                    disabled={!quickTemplateAddress.trim() || quickTemplateSubmitting}
                    className="toolbar-btn toolbar-btn-primary text-xs"
                  >
                    {quickTemplateSubmitting ? (
                      <><Loader2 className="w-3 h-3 animate-spin" /> Dispatching...</>
                    ) : (
                      <><Send className="w-3 h-3" /> Dispatch</>
                    )}
                  </button>
                </div>
              </div>
            </div>
          </form>
        </div>
      )}

      {/* New Call Modal */}
      <NewCallModal
        isOpen={showNewCallModal}
        onClose={() => { setShowNewCallModal(false); setTemplateInitialData(undefined); }}
        onSubmit={handleNewCall}
        properties={propertiesList}
        clients={clientsList}
        initialData={templateInitialData}
        defaultMode="quick"
      />

      {/* Quick PSO Modal */}
      <QuickPsoModal
        isOpen={showQuickPsoModal}
        onClose={() => setShowQuickPsoModal(false)}
        onSubmit={handleNewCall}
        onExpandToFullForm={handlePsoExpandToFullForm}
      />

      {showPlateScanModal && (
        <PlateScanModal
          onClose={() => setShowPlateScanModal(false)}
        />
      )}

      {/* Create / Edit Unit Modal */}
      {showCreateUnitModal && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4" role="dialog" aria-modal="true" aria-labelledby={unitModalTitleId} style={MODAL_BACKDROP_STYLE}>
          <div className="panel-beveled bg-surface-raised my-auto" style={{ width: '420px', ...MODAL_PANEL_STYLE }}>
            <div className="panel-title-bar">
              <div className="flex items-center gap-2">
                <Radio className="w-4 h-4 text-brand-400" />
                <span id={unitModalTitleId} className="text-sm font-bold text-rmpg-100 tracking-wide">{editingUnit ? 'Edit Dispatch Unit' : 'Create Dispatch Unit'}</span>
              </div>
              <button type="button" onClick={() => { setShowCreateUnitModal(false); setEditingUnit(null); setNewUnitCallSign(''); setNewUnitOfficerId(''); setNewUnitStatus('available'); }} className="toolbar-btn ml-auto">
                <X style={{ width: 12, height: 12 }} />
              </button>
            </div>
            <div className="p-4 space-y-3">
              <div>
                <label className="field-label">Call Sign *</label>
                <input
                  type="text"
                  className="input-dark text-sm w-full mt-1"
                  placeholder="e.g. PATROL-01, K9-01, SUPER-01"
                  value={newUnitCallSign}
                  onChange={(e) => setNewUnitCallSign(e.target.value.toUpperCase())}
                  onKeyDown={(e) => e.key === 'Enter' && handleSaveUnit()}
                  autoFocus
                />
              </div>
              <div>
                <label className="field-label">Assigned Officer</label>
                <select
                  className="select-dark text-sm w-full mt-1"
                  value={newUnitOfficerId}
                  onChange={(e) => setNewUnitOfficerId(e.target.value)}
                >
                  <option value="">-- Unassigned --</option>
                  {officers.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.full_name}{o.badge_number ? ` (${o.badge_number})` : ''}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="field-label">Status</label>
                <select
                  className="select-dark text-sm w-full mt-1"
                  value={newUnitStatus}
                  onChange={(e) => setNewUnitStatus(e.target.value)}
                >
                  {UNIT_STATUS_BASE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                  {editingUnit && UNIT_STATUS_EDIT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
              <div className="flex justify-end gap-2 pt-2 border-t border-rmpg-600">
                <button type="button" onClick={() => { setShowCreateUnitModal(false); setEditingUnit(null); setNewUnitCallSign(''); setNewUnitOfficerId(''); setNewUnitStatus('available'); }} className="toolbar-btn">
                  Cancel
                </button>
                <button type="button"
                  onClick={handleSaveUnit}
                  disabled={!newUnitCallSign.trim() || unitCreating}
                  className="toolbar-btn toolbar-btn-primary"
                >
                  {unitCreating ? <Loader2 style={{ width: 12, height: 12 }} className="animate-spin" /> : editingUnit ? <Save style={{ width: 12, height: 12 }} /> : <Plus style={{ width: 12, height: 12 }} />}
                  {editingUnit ? 'Save Changes' : 'Create Unit'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Delete Unit Confirmation */}
      <ConfirmDialog
        isOpen={deletingUnit !== null}
        onClose={() => setDeletingUnit(null)}
        onConfirm={() => handleDisposeUnit('delete')}
        title="Delete Dispatch Unit"
        message={`Are you sure you want to permanently delete unit "${deletingUnit?.call_sign || ''}"? This action cannot be undone.`}
        confirmLabel="Delete Unit"
        confirmVariant="danger"
        isLoading={unitDeleting}
      />

      {/* Delete Call Confirmation */}
      <ConfirmDialog
        isOpen={deleteCallTarget !== null}
        onClose={() => setDeleteCallTarget(null)}
        onConfirm={handleDeleteAnyCall}
        title="Delete Call"
        message={`Are you sure you want to permanently delete call "${deleteCallTarget?.call_number || ''}"? This will also free any assigned units. This action cannot be undone.`}
        confirmLabel="Delete Call"
        confirmVariant="danger"
        isLoading={isDeletingCall}
      />

      {/* Call-action confirmations (return visit / undo / report issue).
          Replaces six blocking window.confirm() calls — see pendingConfirm. */}
      <ConfirmDialog
        isOpen={pendingConfirm !== null}
        onClose={() => setPendingConfirm(null)}
        onConfirm={runPendingConfirm}
        title={pendingConfirm?.title || ''}
        message={pendingConfirm?.message || ''}
        confirmLabel={pendingConfirm?.confirmLabel || 'Confirm'}
        confirmVariant="warning"
        isLoading={confirmRunning}
      />

      {/* Floating Save Bar (visible when editing) */}
      <FloatingSaveBar
        visible={isEditing}
        onSave={saveEditing}
        onCancel={cancelEditing}
        isSaving={isSaving}
      />

      {/* CAD Command Line (replaces keyboard shortcuts bar) */}
      <div className="absolute bottom-0 left-0 right-0 z-30">
        <CadCommandLine
          context={{
            units: units.map(u => ({
              id: String(u.id),
              call_sign: u.call_sign,
              status: u.status,
              current_call_id: u.current_call_id ? String(u.current_call_id) : undefined,
            })),
            calls: calls.map(c => ({
              id: String(c.id),
              call_number: c.call_number,
              status: c.status,
            })),
            currentUser: user?.full_name || user?.username || 'Dispatch',
          }}
          onAction={(action: CommandAction) => {
            switch (action.type) {
              case 'new_call':
                if (action.incidentType && action.location) {
                  // Both type + address → Quick Template Dialog (fastest path)
                  setQuickTemplateData({
                    name: formatIncidentType(action.incidentType),
                    incident_type: action.incidentType,
                    priority: 'P3',
                    description: '',
                    source: 'dispatch',
                  });
                  setQuickTemplateAddress(action.location);
                  setQuickTemplateCoords({ lat: null, lng: null });
                  setQuickTemplateSubmitting(false);
                } else {
                  // Type only → open NewCallModal in quick mode with type pre-selected
                  setTemplateInitialData({
                    incident_type: action.incidentType,
                    location: action.location || '',
                  });
                  setShowNewCallModal(true);
                }
                break;
              case 'query_person':
                setNcicInitialQuery({ type: 'person', query: action.query });
                setShowNcicPanel(true);
                announceTarget(`run name ${action.query}`).catch(() => { /* announcer is best-effort */ });
                break;
              case 'query_vehicle':
                setNcicInitialQuery({ type: 'vehicle', query: action.query });
                setShowNcicPanel(true);
                announceTarget(`run plate ${action.query}`).catch(() => { /* announcer is best-effort */ });
                break;
              case 'query_warrant':
                setNcicInitialQuery({ type: 'warrant', query: action.query });
                setShowNcicPanel(true);
                announceTarget(`run name ${action.query}`).catch(() => { /* announcer is best-effort */ });
                break;
              case 'assign_unit':
              case 'set_status':
              case 'clear_call':
              case 'dispatch_units':
              case 'add_note':
              case 'change_priority':
              case 'create_bolo':
                // These are already executed via API in cadCommandParser.
                // Refresh data to reflect changes.
                fetchData();
                break;
              case 'unit_status_check':
                // Info-only — also speak it via the announcer
                if (action.callSign) {
                  announceTarget(`status of ${action.callSign}`).catch(() => { /* announcer best-effort */ });
                } else {
                  announceTarget('sitrep').catch(() => { /* announcer best-effort */ });
                }
                break;
              case 'query_bolo':
                navigate('/communications');
                announceTarget(`BOLO ${action.query}`).catch(() => { /* announcer best-effort */ });
                break;
              case 'new_fi':
                // Navigate to field interviews page
                navigate('/field-interviews');
                break;
              case 'query_trespass':
                navigate('/trespass-orders');
                announceTarget(`trespass ${action.query}`).catch(() => { /* announcer best-effort */ });
                break;
              case 'premise_history':
                announceTarget(`area check ${action.address}`).catch(() => { /* announcer best-effort */ });
                break;
              case 'premise_alert':
                announceTarget(`premise alert ${action.address}`).catch(() => { /* announcer best-effort */ });
                break;
              case 'hold_call':
                // Already executed via API in cadCommandParser. Refresh data.
                fetchData();
                break;
              case 'select_call': {
                // CI command — find and select the call
                const targetCall = calls.find(c => c.id === action.callId);
                if (targetCall) {
                  setSelectedCall(targetCall);
                  setDetailTab('info');
                }
                break;
              }
              case 'set_mileage':
                // ML command — mileage logged via API, refresh data
                fetchData();
                break;
              case 'promote_incident':
              case 'le_notify':
                fetchData();
                break;
              case 'voice_status': {
                // Voice announce unit status — find unit data and speak it
                if (action.callSign) {
                  const unit = units.find(u => u.call_sign === action.callSign);
                  if (unit) {
                    announceStatusChange(unit.call_sign, unit.status);
                  }
                } else {
                  const active = units.filter(u => u.status !== 'off_duty');
                  const msg = `${active.length} units active. ${active.filter(u => u.status === 'available').length} available.`;
                  speakDispatcherResponse(msg);
                }
                break;
              }
              case 'voice_check': {
                // Voice read-back call details
                const call = calls.find(c => c.call_number === action.callNumber);
                if (call) {
                  announceDispatchEvent(call);
                }
                break;
              }
              case 'voice_eta': {
                // Voice announce ETA — announce unit status as proxy (GPS ETA would need server)
                const unit = units.find(u => u.call_sign === action.callSign);
                if (unit) {
                  const statusLabel = unit.status === 'enroute' ? 'en route' : toDisplayLabel(unit.status).toUpperCase();
                  speakDispatcherResponse(`Unit ${unit.call_sign} is currently ${statusLabel}`);
                }
                break;
              }
              case 'voice_weather':
                // Voice weather — use selected call location weather if available
                if (selectedCall?.weather_conditions) {
                  speakDispatcherResponse(`Weather conditions: ${selectedCall.weather_conditions}`);
                } else {
                  speakDispatcherResponse('No weather data available for current location');
                }
                break;
              case 'voice_time':
                announceTime();
                break;
              case 'voice_ack':
                announceAcknowledgment();
                break;
              case 'voice_allclear': {
                const callNum = action.callNumber || selectedCall?.call_number;
                if (callNum) {
                  announceAllClear(callNum);
                } else {
                  announceAllClear('current call');
                }
                break;
              }
              case 'voice_summary': {
                // Shift summary — compute stats from current calls and units
                const activeCalls = calls.filter(c => !REMOVED_STATUSES.has(c.status));
                const completed = calls.filter(c => RESOLVED_STATUSES.has(c.status));
                const pending = calls.filter(c => c.status === 'pending');
                const psoServes = completed.filter(c => PROCESS_SERVICE_INCIDENT_TYPES.has(c.incident_type));
                const totalMi = activeCalls.reduce((sum, c) => {
                  if (c.starting_mileage && c.ending_mileage) return sum + (Number(c.ending_mileage) - Number(c.starting_mileage));
                  return sum;
                }, 0);
                announceShiftSummary({
                  calls: activeCalls.length + completed.length,
                  serves: psoServes.length,
                  pending: pending.length,
                  avgResponse: 0,
                  totalMiles: totalMi,
                });
                break;
              }
              case 'voice_locate': {
                // Announce unit last known location (from current call or status)
                const unit = units.find(u => u.call_sign === action.callSign);
                if (unit && unit.current_call_id) {
                  const call = calls.find(c => c.id === String(unit.current_call_id));
                  const loc = call?.location || 'unknown location';
                  speakDispatcherResponse(`Unit ${unit.call_sign} last reported at ${loc}. Status: ${toDisplayLabel(unit.status).toUpperCase()}.`);
                } else if (unit) {
                  speakDispatcherResponse(`Unit ${unit.call_sign} is ${toDisplayLabel(unit.status).toUpperCase()}. No active call assigned.`);
                }
                break;
              }
              case 'voice_serve': {
                // Announce serve details for a call. process_service_type/
                // pso_service_type/process_served_to/pso_attempt_number/
                // process_attempts/process_service_result all live in
                // calls_for_service_ext (D1 100-col-cap overflow table) —
                // GET /dispatch/calls (the list this `calls` array comes
                // from) never returns them, so reading them off a list-row
                // was silently always undefined. Only GET /:id joins the
                // ext table, so fetch the real detail before announcing.
                const call = calls.find(c => c.call_number === action.callNumber);
                if (call) {
                  apiFetch<any>(`/dispatch/calls/${call.id}`).then((full) => {
                    const docType = full?.process_service_type || full?.pso_service_type || 'unknown';
                    const servedTo = full?.process_served_to || call.caller_name || 'unknown';
                    const attempt = full?.pso_attempt_number || full?.process_attempts || 1;
                    const result = full?.process_service_result || 'pending';
                    announceServeComplete(servedTo, call.location || '', docType, attempt, result);
                  }).catch(() => {
                    announceServeComplete(call.caller_name || 'unknown', call.location || '', 'unknown', 1, 'pending');
                  });
                }
                break;
              }
              case 'voice_deadline': {
                // Announce 72hr deadline status for a PSO call. closed_at/
                // cleared_at are in the list projection, but
                // process_served_to is ext-only (see voice_serve above) —
                // fetch the detail for that one field rather than always
                // falling back to caller_name.
                const call = calls.find(c => c.call_number === action.callNumber);
                if (call) {
                  const terminalTime = call.closed_at || call.cleared_at;
                  if (terminalTime) {
                    const elapsed = Date.now() - parseTimestamp(terminalTime).getTime();
                    const hoursLeft = Math.max(0, 72 - elapsed / 3600000);
                    const caseNum = call.case_number || call.call_number;
                    apiFetch<any>(`/dispatch/calls/${call.id}`)
                      .then((full) => announceCourtDeadline(caseNum, hoursLeft, full?.process_served_to || call.caller_name))
                      .catch(() => announceCourtDeadline(caseNum, hoursLeft, call.caller_name));
                  } else {
                    speakDispatcherResponse(`Call ${call.call_number} has not been cleared or closed yet. No deadline active.`);
                  }
                }
                break;
              }
              case 'voice_stack': {
                // Announce stacked calls at the selected call's location
                if (selectedCall?.location) {
                  const locKey = selectedCall.location.toLowerCase().trim();
                  const stacked = calls.filter(c => c.location && c.location.toLowerCase().trim() === locKey && !REMOVED_STATUSES.has(c.status));
                  if (stacked.length > 1) {
                    const unitSet = new Set<string>();
                    stacked.forEach(c => (c.assigned_units || []).forEach(u => unitSet.add(u)));
                    const unitNames = units.filter(u => unitSet.has(String(u.id))).map(u => u.call_sign);
                    announceCallStack(stacked.length, selectedCall.location, unitNames);
                  } else {
                    speakDispatcherResponse(`No stacked calls at ${selectedCall.location}.`);
                  }
                } else {
                  speakDispatcherResponse('No call selected. Select a call to check for stacked calls.');
                }
                break;
              }
              case 'voice_units': {
                // Announce all unit statuses
                const active = units.filter(u => u.status !== 'off_duty');
                const avail = active.filter(u => u.status === 'available').length;
                const enr = active.filter(u => u.status === 'enroute').length;
                const ons = active.filter(u => u.status === 'onscene').length;
                const busy = active.filter(u => u.status === 'busy').length;
                speakDispatcherResponse(`${active.length} units active. ${avail} available, ${enr} en route, ${ons} on scene, ${busy} busy.`);
                break;
              }
              case 'voice_pending': {
                // Announce pending calls
                const pending = calls.filter(c => c.status === 'pending');
                if (pending.length === 0) {
                  speakDispatcherResponse('No pending calls.');
                } else {
                  const details = pending.slice(0, 5).map(c => `${c.call_number}, ${toDisplayLabel(c.incident_type).toUpperCase() || 'unknown'}`).join('. ');
                  speakDispatcherResponse(`${pending.length} pending calls. ${details}.`);
                }
                break;
              }
              case 'voice_priority': {
                // Announce priority breakdown
                const active = calls.filter(c => !REMOVED_STATUSES.has(c.status));
                const p1 = active.filter(c => c.priority === 'P1').length;
                const p2 = active.filter(c => c.priority === 'P2').length;
                const p3 = active.filter(c => c.priority === 'P3').length;
                const p4 = active.filter(c => c.priority === 'P4').length;
                speakDispatcherResponse(`Priority breakdown. ${p1} priority 1. ${p2} priority 2. ${p3} priority 3. ${p4} priority 4.`);
                break;
              }
            }
          }}
        />
      </div>

      {/* NCIC Query Terminal Panel */}
      <NcicQueryPanel
        isOpen={showNcicPanel}
        onClose={() => { setShowNcicPanel(false); setNcicInitialQuery(null); }}
        initialQuery={ncicInitialQuery}
      />

      {/* Create Person from Dispatch */}
      <PersonFormModal
        isOpen={showCreatePersonModal}
        onClose={() => setShowCreatePersonModal(false)}
        onSubmit={handleCreatePersonFromDispatch}
        isSubmitting={isCreatingRecord}
      />

      {/* Create Vehicle from Dispatch */}
      <VehicleFormModal
        isOpen={showCreateVehicleModal}
        onClose={() => setShowCreateVehicleModal(false)}
        onSubmit={handleCreateVehicleFromDispatch}
        isSubmitting={isCreatingRecord}
      />

      {/* Duplicate-candidate pickers — opened when /quick-add returns 409 DUPLICATE_CANDIDATES */}
      <DuplicateCandidatesModal
        isOpen={!!personDupState}
        title="Possible existing person"
        entityLabel="person"
        candidates={personDupState?.candidates ?? []}
        isSubmitting={isCreatingRecord}
        renderRow={(c) => (
          <div>
            <div className="font-bold text-rmpg-100">
              {c.last_name}, {c.first_name}
              {c.dob && <span className="ml-2 text-amber-300 font-mono text-[10px]">DOB:{c.dob}</span>}
            </div>
            <div className="text-[10px] text-rmpg-400 mt-0.5">
              {[c.address, c.phone].filter(Boolean).join(' · ') || 'No address / phone on file'}
            </div>
            {(c.caution_flags || c.is_sex_offender || c.gang_affiliation) && (
              <div className="text-[10px] text-red-400 font-bold mt-0.5">
                {c.caution_flags && `⚠ ${c.caution_flags} `}
                {c.is_sex_offender && '⚠ SEX OFFENDER '}
                {c.gang_affiliation && `⚠ GANG: ${c.gang_affiliation}`}
              </div>
            )}
          </div>
        )}
        onClose={() => setPersonDupState(null)}
        onResolve={(r) => {
          if (!personDupState) return;
          if (r.action === 'merge') submitPersonQuickAdd(personDupState.data, { merge_into_id: r.id });
          else submitPersonQuickAdd(personDupState.data, { force_create: true });
        }}
      />

      <DuplicateCandidatesModal
        isOpen={!!vehicleDupState}
        title="Possible existing vehicle"
        entityLabel="vehicle"
        candidates={vehicleDupState?.candidates ?? []}
        isSubmitting={isCreatingRecord}
        renderRow={(c) => (
          <div>
            <div className="font-bold text-rmpg-100">
              {[c.year, c.color, c.make, c.model].filter(Boolean).join(' ') || 'Unknown vehicle'}
              {c.plate_number && (
                <span className="ml-2 text-amber-300 font-mono text-[10px]">
                  PLT:{c.plate_number}{c.state ? `/${c.state}` : ''}
                </span>
              )}
            </div>
            {c.vin && <div className="text-[10px] text-rmpg-400 mt-0.5">VIN: {c.vin}</div>}
          </div>
        )}
        onClose={() => setVehicleDupState(null)}
        onResolve={(r) => {
          if (!vehicleDupState) return;
          if (r.action === 'merge') submitVehicleQuickAdd(vehicleDupState.data, { merge_into_id: r.id });
          else submitVehicleQuickAdd(vehicleDupState.data, { force_create: true });
        }}
      />

      {/* Feature 5: Shift Handoff Notes Modal */}
      {showHandoffNotes && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={MODAL_BACKDROP_STYLE} onClick={() => setShowHandoffNotes(false)}>
          <div className="bg-surface-raised w-[500px] max-w-[95vw] max-h-[80vh] flex flex-col rounded-sm" style={MODAL_PANEL_STYLE} onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-4 py-3 border-b border-rmpg-600" style={{ background: 'var(--surface-deep)' }}>
              <div className="flex items-center gap-2">
                <Briefcase className="w-4 h-4 text-brand-400" />
                <h3 className="text-sm font-bold text-rmpg-100">Shift Handoff Notes</h3>
              </div>
              <button aria-label="Close" type="button" onClick={() => setShowHandoffNotes(false)} className="text-rmpg-400 hover:text-rmpg-100 transition-colors"><X className="w-4 h-4" /></button>
            </div>
            <div className="p-3 flex-1 overflow-auto" style={SCROLL_CONTAIN_STYLE}>
              {handoffMeta.updated_by && (
                <p className="text-[10px] text-rmpg-400 mb-2">
                  Last updated by <span className="text-amber-400">{handoffMeta.updated_by}</span>
                  {handoffMeta.updated_at && ` at ${safeDateTimeStr(handoffMeta.updated_at)}`}
                </p>
              )}
              <textarea
                value={handoffNotes}
                onChange={e => setHandoffNotes(e.target.value)}
                className="input-dark w-full h-48 text-sm resize-none"
                placeholder="Leave notes for the incoming shift dispatcher..."
              />
            </div>
            <div className="flex justify-end gap-2 p-3 border-t border-rmpg-600">
              <button type="button" onClick={() => setShowHandoffNotes(false)} className="toolbar-btn">Cancel</button>
              <button type="button" onClick={saveHandoffNotes} disabled={savingHandoff} className="toolbar-btn toolbar-btn-primary">
                {savingHandoff ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
                Save Notes
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════ */}
      {/* DISPATCH STATUS BAR — Fixed bottom footer                   */}
      {/* ═══════════════════════════════════════════════════════════ */}
      <div className="hidden md:flex items-center justify-between px-3 h-[22px] flex-shrink-0 border-t select-none fixed bottom-0 left-0 right-0 z-[40]"
        style={STATUS_BAR_STYLE}>
        {/* Left: Call metrics */}
        <div className="flex items-center gap-3 text-[9px] tabular-nums">
          <span className="text-rmpg-500 uppercase tracking-wider font-bold">CAD</span>
          <span className="flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full" style={{ background: 'var(--sev-critical)', boxShadow: calls.filter(c => c.priority === 'P1' && !TERMINAL_STATUSES.has(c.status)).length > 0 ? '0 0 6px var(--sev-critical)' : 'none' }} />
            <span style={{ color: 'var(--sev-critical-soft)' }}>P1: {calls.filter(c => c.priority === 'P1' && !TERMINAL_STATUSES.has(c.status)).length}</span>
          </span>
          <span className="flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
            <span style={{ color: 'var(--sev-caution)' }}>P2: {calls.filter(c => c.priority === 'P2' && !TERMINAL_STATUSES.has(c.status)).length}</span>
          </span>
          <span style={{ color: 'var(--spm-text-muted)' }}>|</span>
          <span style={{ color: 'var(--spm-text-muted)' }}>
            PENDING: <span style={{ color: calls.filter(c => c.status === 'pending').length > 0 ? 'var(--sev-warn-soft)' : 'var(--sev-ok)' }}>{calls.filter(c => c.status === 'pending').length}</span>
          </span>
          <span style={{ color: 'var(--spm-text-muted)' }}>
            ACTIVE: <span style={{ color: 'var(--spm-text)' }}>{calls.filter(c => ACTIVE_FIELD_STATUSES.has(c.status)).length}</span>
          </span>
          <span style={{ color: 'var(--spm-text-muted)' }}>
            HOLD: <span style={{ color: calls.filter(c => c.status === 'on_hold').length > 0 ? 'var(--sev-high)' : 'var(--spm-text-muted)' }}>{calls.filter(c => c.status === 'on_hold').length}</span>
          </span>
          {(() => {
            const stacked = new Map<string, number>();
            calls.filter(c => !TERMINAL_STATUSES.has(c.status) && c.location).forEach(c => {
              const key = c.location.toLowerCase().trim();
              stacked.set(key, (stacked.get(key) || 0) + 1);
            });
            const stackedCount = Array.from(stacked.values()).filter(v => v > 1).length;
            return stackedCount > 0 ? (
              <span style={{ color: 'var(--sev-high)' }}>STACKED: {stackedCount}</span>
            ) : null;
          })()}
          {(() => {
            const todayCalls = calls.filter(c => {
              if (!c.created_at) return false;
              const d = parseTimestamp(c.created_at);
              return d.toDateString() === new Date().toDateString();
            });
            const cleared = todayCalls.filter(c => FINISHED_STATUSES.has(c.status)).length;
            const responseTimes = todayCalls
              .filter(c => c.onscene_at && c.created_at)
              .map(c => (parseTimestamp(c.onscene_at).getTime() - parseTimestamp(c.created_at).getTime()) / 60000)
              .filter(m => m > 0 && m < 480);
            const avg = responseTimes.length > 0 ? Math.round(responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length) : null;
            return (
              <>
                <span style={{ color: 'var(--spm-text-muted)' }}>|</span>
                <span style={{ color: 'var(--spm-text-muted)' }}>
                  CLR: <span style={{ color: 'var(--spm-text)' }}>{cleared}</span>
                </span>
                {avg !== null && (
                  <span style={{ color: avg <= 8 ? 'var(--sev-ok-soft)' : avg <= 15 ? 'var(--sev-caution)' : 'var(--sev-critical-soft)' }}>
                    RESP: {avg}m
                  </span>
                )}
              </>
            );
          })()}
        </div>

        {/* Center: Unit metrics */}
        <div className="flex items-center gap-3 text-[9px] tabular-nums">
          <span className="flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full" style={{ background: 'var(--sev-ok)', boxShadow: '0 0 4px color-mix(in srgb, var(--sev-ok) 50%, transparent)' }} />
            <span style={{ color: 'var(--sev-ok-soft)' }}>AVAIL: {units.filter(u => u.status === 'available').length}</span>
          </span>
          <span style={{ color: 'var(--spm-text)' }}>DISP: {units.filter(u => u.status === 'dispatched').length}</span>
          <span style={{ color: 'var(--sev-special-soft)' }}>ENR: {units.filter(u => u.status === 'enroute').length}</span>
          <span style={{ color: 'var(--sev-special-soft)' }}>ONS: {units.filter(u => u.status === 'onscene').length}</span>
          <span style={{ color: 'var(--spm-text-muted)' }}>OFF: {units.filter(u => u.status === 'off_duty').length}</span>
          <span style={{ color: 'var(--spm-text-muted)' }}>|</span>
          <span style={{ color: 'var(--spm-text-muted)' }}>
            TOTAL: <span style={{ color: 'var(--spm-text)' }}>{units.length}</span>
          </span>
        </div>

        {/* Right: F-key hints + clock */}
        <div className="flex items-center gap-2 text-[8px] tabular-nums">
          <span style={{ color: 'var(--spm-text-muted)' }}>F2:New</span>
          <span style={{ color: 'var(--spm-text-muted)' }}>F3:Disp</span>
          <span style={{ color: 'var(--spm-text-muted)' }}>F5:EnR</span>
          <span style={{ color: 'var(--spm-text-muted)' }}>F6:OnS</span>
          <span style={{ color: 'var(--spm-text-muted)' }}>F7:Clr</span>
          <span style={{ color: 'var(--spm-text-muted)' }}>F8:CMD</span>
          <span style={{ color: 'var(--spm-text-muted)' }}>F12:NCIC</span>
          <span style={{ color: 'var(--spm-border)' }}>|</span>
          <LiveClock style={{ color: 'var(--spm-text-muted)' }} />
        </div>
      </div>

      {/* Optimize Assignments result overlay — legacy simple view (kept for backwards compat) */}
      {showAssignmentOverlay && dispatchOptimization.solution && !dispatchOpt.showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="bg-surface-base border border-rmpg-600 p-4 max-w-lg w-full mx-4 max-h-[80vh] flex flex-col gap-3" style={{ borderRadius: 2 }}>
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold text-rmpg-100">Optimized Assignments</span>
              <button
                type="button"
                onClick={() => { setShowAssignmentOverlay(false); dispatchOptimization.reset(); }}
                className="text-rmpg-400 hover:text-rmpg-100 text-xs"
              >
                Dismiss
              </button>
            </div>
            {dispatchOptimization.solution.dropped.services.length > 0 && (
              <div className="text-xs text-amber-400">
                ⚠ {dispatchOptimization.solution.dropped.services.length} call(s) could not be assigned
              </div>
            )}
            <div className="overflow-y-auto flex-1 space-y-3">
              {dispatchOptimization.solution.routes.map((route: V2Route) => (
                <div key={route.vehicle} className="bg-surface-raised p-2" style={{ borderRadius: 2 }}>
                  <div className="text-xs font-semibold text-rmpg-200 mb-1">{route.vehicle}</div>
                  {route.stops
                    .filter((s) => s.type === 'service')
                    .map((s, i) => (
                      <div key={s.location} className="text-[11px] text-rmpg-300 py-0.5 flex gap-2">
                        <span className="text-rmpg-500">{i + 1}.</span>
                        <span>{s.location.replace('call-', 'Call #')}</span>
                        <span className="ml-auto text-rmpg-400">
                          {new Date(s.eta).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })} {/* new-date-ok — s.eta is a Mapbox ISO 8601 string with Z suffix */}
                        </span>
                      </div>
                    ))}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Optimize Assignments — rich proposal modal */}
      {dispatchOpt.showModal && (
        <AssignmentProposalModal
          proposals={dispatchOpt.proposals}
          droppedServices={dispatchOpt.droppedServices}
          accepted={dispatchOpt.accepted}
          onToggle={dispatchOpt.toggleAccepted}
          onApplyAll={() => dispatchOpt.applyProposals(async (callId, unitId) => {
            await apiFetch(`/dispatch/calls/${callId}/assign-unit`, {
              method: 'POST',
              body: JSON.stringify({ unit_id: unitId }),
            });
            await refreshUnits();
          })}
          onClose={() => { dispatchOpt.closeModal(); dispatchOpt.reset(); }}
          applying={dispatchOpt.applying}
        />
      )}
    </div>
  );
}
