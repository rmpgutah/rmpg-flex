// ============================================================
// RMPG Flex — Personnel Constants & Color Maps
// ============================================================

import {
  Users, Radio, Calendar, Clock, Award, GraduationCap, Package, MapPinned, BarChart3,
  User, Activity, Video, Car,
} from 'lucide-react';
import type React from 'react';

// Main tabs
export type MainTab = 'roster' | 'duty_board' | 'schedule' | 'time' | 'credentials' | 'training' | 'equipment' | 'deployment' | 'analytics';

export type DetailTab = 'profile' | 'credentials' | 'schedule' | 'time' | 'activity' | 'training' | 'equipment' | 'body_cameras' | 'dash_cameras' | 'deployment';

export type ModalMode =
  | 'none'
  | 'new_officer'
  | 'edit_officer'
  | 'new_schedule'
  | 'new_credential'
  | 'edit_credential'
  | 'new_training'
  | 'edit_training'
  | 'new_equipment'
  | 'edit_equipment'
  | 'new_deployment'
  | 'edit_deployment'
  | 'edit_time_entry'
  | 'new_body_camera'
  | 'edit_body_camera'
  | 'upload_video'
  | 'upload_dashcam_video'
  | 'edit_dashcam_video';

export const MAIN_TABS: { id: MainTab; label: string; icon: React.ElementType }[] = [
  { id: 'roster', label: 'Roster', icon: Users },
  { id: 'duty_board', label: 'Duty Board', icon: Radio },
  { id: 'schedule', label: 'Schedule', icon: Calendar },
  { id: 'time', label: 'Time', icon: Clock },
  { id: 'credentials', label: 'Credentials', icon: Award },
  { id: 'training', label: 'Training', icon: GraduationCap },
  { id: 'equipment', label: 'Equipment', icon: Package },
  { id: 'deployment', label: 'Deployment', icon: MapPinned },
  { id: 'analytics', label: 'Analytics', icon: BarChart3 },
];

export const DETAIL_TABS: { id: DetailTab; label: string; icon: React.ElementType }[] = [
  { id: 'profile', label: 'Profile', icon: User },
  { id: 'credentials', label: 'Credentials', icon: Award },
  { id: 'schedule', label: 'Schedule', icon: Calendar },
  { id: 'time', label: 'Time Log', icon: Clock },
  { id: 'activity', label: 'Activity', icon: Activity },
  { id: 'training', label: 'Training', icon: GraduationCap },
  { id: 'equipment', label: 'Equipment', icon: Package },
  { id: 'body_cameras', label: 'Body Cams', icon: Video },
  { id: 'dash_cameras', label: 'Dash Cams', icon: Car },
  { id: 'deployment', label: 'Deployment', icon: MapPinned },
];

export const CREDENTIAL_STATUS_COLORS: Record<string, string> = {
  valid: 'bg-green-900/50 text-green-400 border border-green-700/50',
  expiring_soon: 'bg-amber-900/50 text-amber-400 border border-amber-700/50',
  expired: 'bg-red-900/50 text-red-400 border border-red-700/50',
  revoked: 'bg-red-900/60 text-red-300 border border-red-600/50',
};

export const ROLE_COLORS: Record<string, string> = {
  admin: 'bg-red-900/50 text-red-400 border border-red-700/50',
  manager: 'bg-purple-900/50 text-purple-400 border border-purple-700/50',
  supervisor: 'bg-amber-900/50 text-amber-400 border border-amber-700/50',
  officer: 'bg-brand-900/50 text-brand-400 border border-brand-700/50',
  dispatcher: 'bg-blue-900/50 text-blue-400 border border-blue-700/50',
};

export const ACTION_COLORS: Record<string, string> = {
  clock_in: 'text-green-400',
  clock_out: 'text-amber-400',
  user_login: 'text-blue-400',
  user_logout: 'text-rmpg-400',
  incident_created: 'text-brand-400',
  incident_submitted: 'text-purple-400',
  incident_approved: 'text-green-400',
  call_created: 'text-brand-400',
  call_dispatched: 'text-blue-400',
  call_onscene: 'text-amber-400',
  call_cleared: 'text-green-400',
  note_added: 'text-rmpg-300',
  default: 'text-rmpg-400',
};

export const TRAINING_CATEGORY_COLORS: Record<string, string> = {
  firearms: 'bg-red-900/50 text-red-400 border border-red-700/50',
  defensive_tactics: 'bg-amber-900/50 text-amber-400 border border-amber-700/50',
  first_aid: 'bg-green-900/50 text-green-400 border border-green-700/50',
  legal: 'bg-purple-900/50 text-purple-400 border border-purple-700/50',
  communication: 'bg-blue-900/50 text-blue-400 border border-blue-700/50',
  driving: 'bg-cyan-900/50 text-cyan-400 border border-cyan-700/50',
  technology: 'bg-indigo-900/50 text-indigo-400 border border-indigo-700/50',
  leadership: 'bg-brand-900/50 text-brand-400 border border-brand-700/50',
  compliance: 'bg-amber-900/50 text-amber-400 border border-amber-700/50',
  other: 'bg-rmpg-700 text-rmpg-300 border border-rmpg-600',
};

export const DEPLOYMENT_STATUS_COLORS: Record<string, string> = {
  active: 'bg-green-900/50 text-green-400 border border-green-700/50',
  completed: 'bg-rmpg-700 text-rmpg-300 border border-rmpg-600',
  scheduled: 'bg-blue-900/50 text-blue-400 border border-blue-700/50',
  cancelled: 'bg-red-900/50 text-red-400 border border-red-700/50',
};

export const STATUS_LED: Record<string, string> = {
  on_duty: 'led-dot led-green',
  off_duty: 'led-dot led-off',
  clocked_in: 'led-dot led-green',
  on_break: 'led-dot led-amber',
  clocked_out: 'led-dot led-off',
  edited: 'led-dot led-blue',
};

export const EQUIPMENT_STATUS_COLORS: Record<string, string> = {
  issued: 'bg-green-900/50 text-green-400 border border-green-700/50',
  returned: 'bg-rmpg-700 text-rmpg-300 border border-rmpg-600',
  lost: 'bg-red-900/50 text-red-400 border border-red-700/50',
  damaged: 'bg-amber-900/50 text-amber-400 border border-amber-700/50',
  retired: 'bg-rmpg-700 text-rmpg-400 border border-rmpg-600',
  maintenance: 'bg-blue-900/50 text-blue-400 border border-blue-700/50',
};

export const EQUIPMENT_CONDITION_COLORS: Record<string, string> = {
  new: 'text-green-400',
  good: 'text-green-400',
  fair: 'text-amber-400',
  poor: 'text-amber-400',
  damaged: 'text-red-400',
  lost: 'text-red-400',
};

export const CAMERA_STATUS_COLORS: Record<string, string> = {
  available: 'bg-green-900/50 text-green-400 border border-green-700/50',
  assigned: 'bg-blue-900/50 text-blue-400 border border-blue-700/50',
  maintenance: 'bg-amber-900/50 text-amber-400 border border-amber-700/50',
  retired: 'bg-rmpg-700 text-rmpg-400 border border-rmpg-600',
  lost: 'bg-red-900/50 text-red-400 border border-red-700/50',
};

export const VIDEO_CLASSIFICATION_COLORS: Record<string, string> = {
  routine: 'bg-rmpg-700 text-rmpg-300 border border-rmpg-600',
  evidence: 'bg-purple-900/50 text-purple-400 border border-purple-700/50',
  flagged: 'bg-amber-900/50 text-amber-400 border border-amber-700/50',
  restricted: 'bg-red-900/50 text-red-400 border border-red-700/50',
};

export const DASHCAM_EVENT_COLORS: Record<string, string> = {
  hard_brake: 'bg-red-900/50 text-red-400 border border-red-700/50',
  hard_accel: 'bg-amber-900/50 text-amber-400 border border-amber-700/50',
  hard_turn: 'bg-amber-900/50 text-amber-400 border border-amber-700/50',
  hard_cornering: 'bg-amber-900/50 text-amber-400 border border-amber-700/50',
  speeding: 'bg-red-900/50 text-red-400 border border-red-700/50',
  impact: 'bg-red-900/60 text-red-300 border border-red-600/50',
  tamper: 'bg-purple-900/50 text-purple-400 border border-purple-700/50',
  panic: 'bg-red-900/60 text-red-300 border border-red-600/50',
  sos: 'bg-red-900/60 text-red-300 border border-red-600/50',
  video_start: 'bg-green-900/50 text-green-400 border border-green-700/50',
  video_stop: 'bg-rmpg-700 text-rmpg-300 border border-rmpg-600',
  video_alarm: 'bg-amber-900/50 text-amber-400 border border-amber-700/50',
  video_lost: 'bg-red-900/50 text-red-400 border border-red-700/50',
  camera_motion: 'bg-blue-900/50 text-blue-400 border border-blue-700/50',
  camera_triggered: 'bg-blue-900/50 text-blue-400 border border-blue-700/50',
  camera_event: 'bg-blue-900/50 text-blue-400 border border-blue-700/50',
  // GPS / telemetry events
  ignition_on: 'bg-green-900/50 text-green-400 border border-green-700/50',
  ignition_off: 'bg-rmpg-700 text-rmpg-300 border border-rmpg-600',
  position_update: 'bg-rmpg-800 text-rmpg-400 border border-rmpg-700',
  inmotion: 'bg-sky-900/50 text-sky-400 border border-sky-700/50',
  stopped: 'bg-rmpg-700 text-rmpg-400 border border-rmpg-600',
  idle: 'bg-yellow-900/50 text-yellow-400 border border-yellow-700/50',
};

export const DASHCAM_VIDEO_SOURCE_COLORS: Record<string, string> = {
  manual: 'bg-blue-900/50 text-blue-400 border border-blue-700/50',
  cpg_sync: 'bg-green-900/50 text-green-400 border border-green-700/50',
  cpg_proxy: 'bg-purple-900/50 text-purple-400 border border-purple-700/50',
};

export const CHART_TOOLTIP_STYLE = {
  contentStyle: {
    backgroundColor: '#1a1a1a',
    border: '1px solid #383838',
    color: '#e0e0e0',
    fontSize: 10,
    fontFamily: 'Consolas, monospace',
  },
};
