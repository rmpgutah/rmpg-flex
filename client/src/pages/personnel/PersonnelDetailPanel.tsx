import React, { useRef, useState, useEffect } from 'react';
import {
  X, Zap, Star, Shield, Clock, Award, Calendar, User, Activity, GraduationCap, MapPinned,
  Pencil, Trash2, LogIn, LogOut, Archive, RotateCcw, Coffee, Printer, ChevronDown,
} from 'lucide-react';
import type { Credential, Schedule, TimeEntry, TrainingRecord, Deployment, OfficerEquipment, BodyCamera, BodyCamVideo, DashcamEvent, CpgDeviceMapping } from '../../types';
import type { OfficerWithStatus } from './utils/personnelMappers';
import { calcYearsOfService } from './utils/personnelFormatters';
import { DETAIL_TABS, ROLE_COLORS, type DetailTab } from './utils/personnelConstants';
import { toDisplayLabel } from '../../utils/formatters';
import OfficerAvatar from './components/OfficerAvatar';
import ProfileDetailTab from './detail-tabs/ProfileDetailTab';
import CredentialsDetailTab from './detail-tabs/CredentialsDetailTab';
import ScheduleDetailTab from './detail-tabs/ScheduleDetailTab';
import TimeLogDetailTab from './detail-tabs/TimeLogDetailTab';
import ActivityDetailTab from './detail-tabs/ActivityDetailTab';
import TrainingDetailTab from './detail-tabs/TrainingDetailTab';
import EquipmentDetailTab from './detail-tabs/EquipmentDetailTab';
import BodyCameraDetailTab from './detail-tabs/BodyCameraDetailTab';
import DashCameraDetailTab from './detail-tabs/DashCameraDetailTab';
import DeploymentDetailTab from './detail-tabs/DeploymentDetailTab';
import PrintRecordButton from '../../components/PrintRecordButton';

interface ActivityEntry {
  id: string;
  action: string;
  details: string;
  entity_type?: string;
  created_at: string;
  user_name?: string;
}

// ── Personnel Print Menu (dropdown to select report type) ──
function PersonnelPrintMenu({ officer, credentials, training, equipment, bodyCameras, deployments, timeEntries }: {
  officer: OfficerWithStatus;
  credentials: Credential[];
  training: TrainingRecord[];
  equipment: OfficerEquipment[];
  bodyCameras: BodyCamera[];
  deployments: Deployment[];
  timeEntries: TimeEntry[];
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const reportOptions = [
    { key: 'full', label: 'Full Personnel Record' },
    { key: 'credentials', label: 'Credentials' },
    { key: 'training', label: 'Training' },
    { key: 'equipment', label: 'Equipment' },
    { key: 'time', label: 'Time & Attendance' },
  ] as const;

  const buildRecordData = (reportType: string) => ({
    ...officer,
    report_type: reportType,
    credentials: credentials.map(c => ({
      type: c.type,
      credential_number: c.credential_number,
      issuing_authority: c.issuing_authority,
      issued_date: c.issued_date,
      expiry_date: c.expiry_date,
      status: c.status,
    })),
    training_records: training.map(t => ({
      course_name: t.course_name,
      category: t.category,
      provider: t.provider,
      completed_date: t.completed_date,
      expiry_date: t.expiry_date,
      hours: t.hours,
      score: t.score,
      status: t.status,
    })),
    equipment_list: equipment.map(eq => ({
      equipment_type: eq.equipment_type,
      serial_number: eq.serial_number,
      make: eq.make,
      model: eq.model,
      condition: eq.condition,
      status: eq.status,
      issued_date: eq.issued_date,
    })),
    body_cameras: bodyCameras.map(cam => ({
      camera_id: cam.camera_id,
      make: cam.make,
      model: cam.model,
      status: cam.status,
      condition: cam.condition,
      assigned_at: cam.assigned_at,
    })),
    deployments: deployments.map(d => ({
      property_name: d.property_name,
      position: d.position,
      start_date: d.start_date,
      end_date: d.end_date,
      status: d.status,
      hours_per_week: d.hours_per_week,
    })),
    time_entries: timeEntries.map(t => ({
      clock_in: t.clock_in,
      clock_out: t.clock_out,
      total_hours: t.total_hours,
      status: t.status,
    })),
  });

  return (
    <div className="relative" ref={ref}>
      <button className="toolbar-btn" onClick={() => setOpen(!open)}>
        <Printer className="w-3 h-3" /> Print <ChevronDown className="w-2.5 h-2.5" />
      </button>
      {open && (
        <div className="absolute right-0 mt-1 z-50 bg-rmpg-700 border border-rmpg-500 rounded shadow-lg min-w-[200px]">
          {reportOptions.map((opt) => (
            <PrintRecordButton
              key={opt.key}
              recordType="personnel"
              recordData={buildRecordData(opt.key)}
              identifier={`${officer.badge_number || officer.last_name}_${opt.key}`}
              entityType="personnel"
              entityId={officer.id}
              label={opt.label}
              className="w-full text-left px-3 py-1.5 text-xs hover:bg-rmpg-600 border-none rounded-none"
            />
          ))}
        </div>
      )}
    </div>
  );
}

interface Props {
  officer: OfficerWithStatus;
  credentials: Credential[];
  schedules: Schedule[];
  timeEntries: TimeEntry[];
  activity: ActivityEntry[];
  training: TrainingRecord[];
  trainingLoading: boolean;
  deployments: Deployment[];
  deploymentsLoading: boolean;
  activeTab: DetailTab;
  onTabChange: (tab: DetailTab) => void;
  onAddCredential: (officerId: string) => void;
  onEditCredential: (cred: Credential) => void;
  onDeleteCredential: (credId: string) => void;
  onAddSchedule: () => void;
  onDeleteSchedule: (schedId: string) => void;
  onAddTraining: (officerId: string) => void;
  equipment: OfficerEquipment[];
  equipmentLoading: boolean;
  onAddEquipment: (officerId: string) => void;
  onEditEquipment: (eq: OfficerEquipment) => void;
  onDeleteEquipment: (eqId: string) => void;
  bodyCameras: BodyCamera[];
  bodyCamVideos: BodyCamVideo[];
  bodyCamerasLoading: boolean;
  onAddBodyCamera: (officerId: string) => void;
  onEditBodyCamera: (cam: BodyCamera) => void;
  onDeleteBodyCamera: (camId: number) => void;
  onUploadVideo: () => void;
  onDeleteVideo: (videoId: number) => void;
  onEditVideo: (video: BodyCamVideo) => void;
  onPlayVideo: (video: BodyCamVideo) => void;
  dashcamEvents: DashcamEvent[];
  dashcamDeviceMapping: CpgDeviceMapping | null;
  dashcamLoading: boolean;
  onAddDeployment: (officerId: string) => void;
  onEditOfficer: () => void;
  onDeleteOfficer: () => void;
  onArchiveOfficer: (officerId: string) => void;
  onUnarchiveOfficer: (officerId: string) => void;
  isArchived: boolean;
  onClockIn: (officerId: string) => void;
  onClockOut: (officerId: string) => void;
  onStartBreak: (officerId: string) => void;
  onEndBreak: (officerId: string) => void;
  onEditTimeEntry: (entry: TimeEntry) => void;
  onDeleteTimeEntry: (entryId: string) => void;
  onClose: () => void;
}

export default function PersonnelDetailPanel({
  officer, credentials, schedules, timeEntries, activity,
  training, trainingLoading, deployments, deploymentsLoading,
  activeTab, onTabChange,
  onAddCredential, onEditCredential, onDeleteCredential,
  onAddSchedule, onDeleteSchedule,
  onAddTraining,
  equipment, equipmentLoading, onAddEquipment, onEditEquipment, onDeleteEquipment,
  bodyCameras, bodyCamVideos, bodyCamerasLoading,
  onAddBodyCamera, onEditBodyCamera, onDeleteBodyCamera,
  onUploadVideo, onDeleteVideo, onEditVideo, onPlayVideo,
  dashcamEvents, dashcamDeviceMapping, dashcamLoading,
  onAddDeployment,
  onEditOfficer, onDeleteOfficer,
  onArchiveOfficer, onUnarchiveOfficer, isArchived,
  onClockIn, onClockOut, onStartBreak, onEndBreak, onEditTimeEntry, onDeleteTimeEntry,
  onClose,
}: Props) {
  const officerCreds = credentials.filter(c => c.officer_id === officer.id);
  const officerSchedules = schedules.filter(s => s.officer_id === officer.id);
  const officerTime = timeEntries.filter(t => t.officer_id === officer.id);
  const officerTotalHours = officerTime.reduce((sum, t) => sum + (t.total_hours || 0), 0);
  const isClockedIn = officerTime.some(t => t.status === 'clocked_in');
  const isOnBreak = officerTime.some(t => t.status === 'on_break');
  const isActive = isClockedIn || isOnBreak;
  const personnelDetailRef = useRef<HTMLDivElement>(null);
  const hasCredAlert = officerCreds.some(c => c.status === 'expired' || c.status === 'expiring_soon');

  return (
    <div ref={personnelDetailRef} className="flex-1 flex flex-col overflow-hidden detail-panel-enter">
      {/* Detail Header */}
      <div className="profile-section panel-beveled mx-2 mt-2 p-4 bg-surface-raised">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-4">
            <OfficerAvatar officer={officer} size="lg" />
            <div>
              <h2 className="text-lg font-bold text-white tracking-wide">
                {officer.last_name}, {officer.first_name}
                {officer.middle_name && officer.middle_name.length > 0 ? ` ${officer.middle_name[0]}.` : ''}
              </h2>
              <div className="w-20 h-0.5 mt-1 mb-1.5" style={{ background: 'linear-gradient(90deg, var(--brand-blue) 0%, transparent 100%)' }} />
              <div className="flex items-center gap-3">
                {officer.rank && (
                  <span className="text-xs text-rmpg-200 flex items-center gap-1">
                    <Star className="w-3 h-3 text-amber-400" />
                    {officer.rank}
                  </span>
                )}
                <span className={`badge-pill ${ROLE_COLORS[officer.role] || ROLE_COLORS.officer}`}>
                  {toDisplayLabel(officer.role)}
                </span>
                {officer.badge_number && (
                  <span className="text-xs text-rmpg-300 font-mono flex items-center gap-1 bg-rmpg-800/50 px-1.5 py-0.5">
                    <Shield className="w-3 h-3 text-rmpg-400" />
                    {officer.badge_number}
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Close button */}
          <button onClick={onClose} className="toolbar-btn p-1 hover:bg-rmpg-700/50" title="Close">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Status + Clock Controls Toolbar */}
        <div className="panel-inset p-2 mt-3 flex items-center gap-2 flex-wrap">
          <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 text-[9px] font-bold uppercase border ${
            officer.status === 'on_duty'
              ? 'bg-green-900/50 text-green-400 border-green-700/50'
              : 'bg-rmpg-700 text-rmpg-400 border-rmpg-600'
          }`}>
            <span className={officer.status === 'on_duty' ? 'led-dot led-green' : 'led-dot led-off'} />
            {officer.status === 'on_duty' ? 'ON DUTY' : 'OFF DUTY'}
          </span>
          {isClockedIn && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[9px] font-bold bg-green-900/40 text-green-400 border border-green-700/50 animate-pulse">
              <Zap className="w-3 h-3" /> CLOCKED IN
            </span>
          )}
          {isOnBreak && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[9px] font-bold bg-amber-900/40 text-amber-400 border border-amber-700/50 animate-pulse">
              <Coffee className="w-3 h-3" /> ON BREAK
            </span>
          )}

          <span className="toolbar-separator" />

          {/* Clock controls */}
          {isActive ? (
            <>
              {isClockedIn && (
                <button onClick={() => onStartBreak(officer.id)} className="toolbar-btn text-[9px]">
                  <Coffee className="w-3 h-3" /> Break
                </button>
              )}
              {isOnBreak && (
                <button onClick={() => onEndBreak(officer.id)} className="toolbar-btn toolbar-btn-success text-[9px]">
                  <Zap className="w-3 h-3" /> End Break
                </button>
              )}
              <button onClick={() => onClockOut(officer.id)} className="toolbar-btn toolbar-btn-danger text-[9px]">
                <LogOut className="w-3 h-3" /> Clock Out
              </button>
            </>
          ) : (
            <button onClick={() => onClockIn(officer.id)} className="toolbar-btn toolbar-btn-success text-[9px]">
              <LogIn className="w-3 h-3" /> Clock In
            </button>
          )}

          {/* Action buttons — right side */}
          <div className="ml-auto flex items-center gap-1">
            <PersonnelPrintMenu
              officer={officer}
              credentials={officerCreds}
              training={training.filter(t => t.officer_id === officer.id)}
              equipment={equipment.filter(e => e.officer_id === officer.id)}
              bodyCameras={bodyCameras.filter(c => c.officer_id === Number(officer.id))}
              deployments={deployments.filter(d => d.officer_id === officer.id)}
              timeEntries={officerTime}
            />
            {!isArchived && (
              <>
                <button onClick={onEditOfficer} className="toolbar-btn text-[9px]" title="Edit officer">
                  <Pencil className="w-3 h-3" /> Edit
                </button>
                <span className="toolbar-separator" />
                {officer.termination_date && (
                  <button onClick={() => onArchiveOfficer(officer.id)} className="toolbar-btn text-[9px] text-amber-400" title="Archive terminated officer">
                    <Archive className="w-3 h-3" />
                  </button>
                )}
                <button onClick={onDeleteOfficer} className="toolbar-btn toolbar-btn-danger text-[9px]" title="Terminate officer">
                  <Trash2 className="w-3 h-3" />
                </button>
              </>
            )}
            {isArchived && (
              <button onClick={() => onUnarchiveOfficer(officer.id)} className="toolbar-btn toolbar-btn-success text-[9px]" title="Unarchive officer">
                <RotateCcw className="w-3 h-3" /> Restore
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Quick Stats Row */}
      <div className="flex items-stretch gap-2 px-4 py-2 border-b border-rmpg-700" style={{ background: '#0d1520' }}>
        {[
          { label: 'Status', value: officer.status === 'on_duty' ? 'ON DUTY' : 'OFF DUTY', color: officer.status === 'on_duty' ? 'text-green-400' : 'text-rmpg-400', borderColor: officer.status === 'on_duty' ? 'border-l-green-500' : 'border-l-rmpg-600' },
          { label: 'Service', value: calcYearsOfService(officer.hire_date), color: 'text-blue-400', borderColor: 'border-l-blue-500' },
          { label: 'Hours', value: officerTotalHours.toFixed(1), color: 'text-brand-400', borderColor: 'border-l-brand-500' },
          { label: 'Credentials', value: `${officerCreds.length}`, color: officerCreds.some(c => c.status === 'expired') ? 'text-red-400' : hasCredAlert ? 'text-amber-400' : 'text-green-400', borderColor: officerCreds.some(c => c.status === 'expired') ? 'border-l-red-500' : hasCredAlert ? 'border-l-amber-500' : 'border-l-green-500' },
          { label: 'Schedules', value: String(officerSchedules.length), color: 'text-purple-400', borderColor: 'border-l-purple-500' },
        ].map((stat) => (
          <div key={stat.label} className={`panel-beveled bg-surface-sunken p-2 border-l-[3px] ${stat.borderColor} flex-1 min-w-0`}>
            <p className="text-[9px] text-rmpg-500 uppercase font-bold tracking-wide mb-0.5">{stat.label}</p>
            <p className={`text-base font-bold font-mono ${stat.color}`}>{stat.value}</p>
          </div>
        ))}
      </div>

      {/* Tab Bar */}
      <div className="tab-bar" style={{ scrollbarWidth: 'none' }}>
        {DETAIL_TABS.map(({ id, label, icon: Icon }) => {
          const alertBadge = id === 'credentials' && hasCredAlert;
          const count = id === 'credentials' ? officerCreds.length
            : id === 'schedule' ? officerSchedules.length
            : id === 'time' ? officerTime.length
            : undefined;
          return (
            <button
              key={id}
              className={`tab-bar-item ${activeTab === id ? 'active' : ''}`}
              onClick={() => onTabChange(id)}
            >
              <Icon className={`w-3 h-3 ${activeTab === id ? 'text-brand-400' : ''}`} />
              {label}
              {count !== undefined && count > 0 && (
                <span className={`tab-count-badge ml-0.5 ${alertBadge ? 'bg-amber-900/40 text-amber-400 border border-amber-700/40' : 'bg-rmpg-800 text-rmpg-500'}`}>
                  {count}
                </span>
              )}
              {alertBadge && <span className="led-dot led-amber" />}
            </button>
          );
        })}
      </div>

      {/* Tab Content */}
      <div className="flex-1 overflow-y-auto min-h-0 p-4">
        {activeTab === 'profile' && <ProfileDetailTab officer={officer} credentials={officerCreds} />}
        {activeTab === 'credentials' && (
          <CredentialsDetailTab
            credentials={officerCreds}
            onAddCredential={onAddCredential}
            onEditCredential={onEditCredential}
            onDeleteCredential={onDeleteCredential}
            officerId={officer.id}
          />
        )}
        {activeTab === 'schedule' && (
          <ScheduleDetailTab
            schedules={officerSchedules}
            onAddSchedule={onAddSchedule}
            onDeleteSchedule={onDeleteSchedule}
          />
        )}
        {activeTab === 'time' && (
          <TimeLogDetailTab
            timeEntries={officerTime}
            officerId={officer.id}
            isClockedIn={isClockedIn}
            isOnBreak={isOnBreak}
            onClockIn={onClockIn}
            onClockOut={onClockOut}
            onStartBreak={onStartBreak}
            onEndBreak={onEndBreak}
            onEditTimeEntry={onEditTimeEntry}
            onDeleteTimeEntry={onDeleteTimeEntry}
          />
        )}
        {activeTab === 'activity' && <ActivityDetailTab activity={activity} />}
        {activeTab === 'training' && (
          <TrainingDetailTab
            training={training.filter(t => t.officer_id === officer.id)}
            loading={trainingLoading}
            onAddTraining={onAddTraining}
            officerId={officer.id}
          />
        )}
        {activeTab === 'equipment' && (
          <EquipmentDetailTab
            equipment={equipment.filter(e => e.officer_id === officer.id)}
            onAdd={() => onAddEquipment(officer.id)}
            onEdit={onEditEquipment}
            onDelete={onDeleteEquipment}
            loading={equipmentLoading}
          />
        )}
        {activeTab === 'body_cameras' && (
          <BodyCameraDetailTab
            cameras={bodyCameras.filter(c => c.officer_id === Number(officer.id))}
            videos={bodyCamVideos.filter(v => v.officer_id === Number(officer.id))}
            onAddCamera={() => onAddBodyCamera(officer.id)}
            onEditCamera={onEditBodyCamera}
            onDeleteCamera={onDeleteBodyCamera}
            onUploadVideo={onUploadVideo}
            onDeleteVideo={onDeleteVideo}
            onEditVideo={onEditVideo}
            onPlayVideo={onPlayVideo}
            loading={bodyCamerasLoading}
          />
        )}
        {activeTab === 'dash_cameras' && (
          <DashCameraDetailTab
            events={dashcamEvents}
            deviceMapping={dashcamDeviceMapping}
            loading={dashcamLoading}
          />
        )}
        {activeTab === 'deployment' && (
          <DeploymentDetailTab
            deployments={deployments.filter(d => d.officer_id === officer.id)}
            loading={deploymentsLoading}
            onAddDeployment={onAddDeployment}
            officerId={officer.id}
          />
        )}
      </div>
    </div>
  );
}
