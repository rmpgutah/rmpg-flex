import { useRef, useState, useEffect, useCallback } from 'react';
import {
  X, Zap, Star, Shield, Pencil, Trash2, LogIn, LogOut, Archive, RotateCcw,
  Coffee, Printer, ChevronDown, Radio,
} from 'lucide-react';
import { apiFetch } from '../../hooks/useApi';
import { useAuth } from '../../context/AuthContext';
import type {
  Credential, Schedule, TimeEntry, TrainingRecord, Deployment, OfficerEquipment,
  BodyCamera, BodyCamVideo, DashcamEvent, CpgDeviceMapping,
} from '../../types';
import type { OfficerWithStatus } from './utils/personnelMappers';
import { calcYearsOfService } from './utils/personnelFormatters';
import { ROLE_COLORS, type DetailTab } from './utils/personnelConstants';
import SpillmanModuleGroup from '../../components/spillman/SpillmanModuleGroup';
import type { ModuleGroupSpec } from '../../components/spillman/SpillmanModuleGroup';
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
import FitnessCommendationsTab from './tabs/FitnessCommendationsTab';
import PrintRecordButton from '../../components/PrintRecordButton';
import EmailedDocuments from '../../components/EmailedDocuments';

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
      <button type="button" className="toolbar-btn" onClick={() => setOpen(!open)}>
        <Printer className="w-3 h-3" /> Print <ChevronDown className="w-2.5 h-2.5" />
      </button>
      {open && (
        <div className="absolute right-0 mt-1 z-50 bg-rmpg-700 border border-rmpg-500 rounded-sm shadow-lg min-w-[200px]">
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

// ── On-Duty Toggle Component ──────────────────────────────────
function DutyToggle({ officerId, currentStatus, onToggled }: { officerId: string; currentStatus: string; onToggled?: () => void }) {
  const [toggling, setToggling] = useState(false);
  const isOnDuty = currentStatus === 'on_duty';
  // Cache the unit list for the duration of this panel mount to avoid
  // re-fetching on every toggle action.
  const cachedUnitsRef = useRef<unknown[] | null>(null);

  // Pre-fetch units at mount so they are available instantly if needed.
  useEffect(() => {
    apiFetch<unknown>('/dispatch/units')
      .then((res) => {
        if (Array.isArray(res)) {
          cachedUnitsRef.current = res;
        } else if (res && typeof res === 'object' && Array.isArray((res as any).results)) {
          cachedUnitsRef.current = (res as any).results;
        }
      })
      .catch(() => { /* non-critical prefetch — ignore */ });
  }, []);

  const handleToggle = useCallback(async () => {
    setToggling(true);
    try {
      if (isOnDuty) {
        await apiFetch('/dispatch/duty/end', { method: 'POST', body: JSON.stringify({ officer_id: officerId }) });
      } else {
        await apiFetch('/dispatch/duty/start', { method: 'POST', body: JSON.stringify({ officer_id: officerId }) });
      }
      onToggled?.();
    } catch (err) {
      const apiErr = err as { code?: string };
      if (apiErr.code === 'NEEDS_VEHICLE' || apiErr.code === 'NO_UNIT') {
        // Use cached units when available; otherwise fetch once and cache.
        let units = cachedUnitsRef.current;
        if (!units) {
          const raw = await apiFetch<unknown>('/dispatch/units').catch(() => null);
          if (Array.isArray(raw)) {
            units = raw;
          } else if (raw && typeof raw === 'object' && Array.isArray((raw as any).results)) {
            units = (raw as any).results;
          } else {
            units = [];
          }
          cachedUnitsRef.current = units;
        }
        const myUnit = (units ?? []).find((u: any) => String(u?.officer_id) === String(officerId));
        if (myUnit) {
          await apiFetch(`/dispatch/units/${(myUnit as any).id}`, {
            method: 'PUT',
            body: JSON.stringify({ status: isOnDuty ? 'off_duty' : 'available' }),
          });
          onToggled?.();
        }
      } else {
        console.error('Duty toggle failed:', err);
      }
    } finally {
      setToggling(false);
    }
  }, [officerId, isOnDuty, onToggled]);

  return (
    <button type="button"
      onClick={handleToggle}
      disabled={toggling}
      className={`flex items-center gap-1.5 px-2.5 py-1 text-[9px] font-bold uppercase tracking-wider transition-all duration-200 border focus-visible:ring-1 focus-visible:ring-brand-500/50 focus-visible:outline-none ${
        isOnDuty
          ? 'bg-green-900/50 text-green-400 border-green-700/50 hover:bg-red-900/50 hover:text-red-400 hover:border-red-700/50'
          : 'bg-surface-sunken text-rmpg-400 border-rmpg-600 hover:bg-green-900/50 hover:text-green-400 hover:border-green-700/50'
      } disabled:opacity-40`}
      title={isOnDuty ? 'Go Off Duty' : 'Go On Duty'}
      aria-label={isOnDuty ? 'Toggle off duty' : 'Toggle on duty'}
    >
      <Radio className="w-3 h-3" />
      {toggling ? '...' : isOnDuty ? 'On Duty' : 'Off Duty'}
    </button>
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
  /** Forwarded onto EquipmentDetailTab → custody PDF "Prepared by" line.
   *  Optional — pages that don't have the current user pass undefined and
   *  the PDF renders without it. */
  preparedBy?: string;
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
  onDutyToggle?: () => void;
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
  equipment, equipmentLoading, onAddEquipment, onEditEquipment, onDeleteEquipment, preparedBy,
  bodyCameras, bodyCamVideos, bodyCamerasLoading,
  onAddBodyCamera, onEditBodyCamera, onDeleteBodyCamera,
  onUploadVideo, onDeleteVideo, onEditVideo, onPlayVideo,
  dashcamEvents, dashcamDeviceMapping, dashcamLoading,
  onAddDeployment,
  onEditOfficer, onDeleteOfficer,
  onArchiveOfficer, onUnarchiveOfficer, isArchived,
  onClockIn, onClockOut, onStartBreak, onEndBreak, onDutyToggle, onEditTimeEntry, onDeleteTimeEntry,
  onClose,
}: Props) {
  const { user: currentUser } = useAuth();
  // Terminate/archive are destructive HR actions — restrict to roles that own
  // personnel management. Dispatchers, officers, and client_viewers see the
  // panel but cannot remove or archive anyone.
  const canManageHR = (['admin', 'manager', 'supervisor', 'human_resources'] as string[])
    .includes(currentUser?.role ?? '');
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
    <div ref={personnelDetailRef} className="flex-1 min-h-0 flex flex-col overflow-hidden min-h-0 h-full" role="region" aria-label={`Details for ${officer.first_name} ${officer.last_name}`}>
      {/* Consolidated Header — 2 bands: Identity+Status+Actions / Controls+Stats */}
      <div className="panel-beveled mx-2 mt-2 transition-all duration-200">
        {/* Band 1: Identity + status chips + actions */}
        <div className="p-3 flex items-start gap-3">
          <OfficerAvatar officer={officer} size="lg" />
          <div className="flex-1 min-w-0">
            <h2 className="text-lg font-bold text-rmpg-100 leading-tight truncate">
              {officer.last_name}, {officer.first_name}
              {officer.middle_name && officer.middle_name.length > 0 ? ` ${officer.middle_name[0]}.` : ''}
            </h2>
            <div className="w-16 h-0.5 bg-brand-500 mt-1 mb-1.5" />
            <div className="flex items-center gap-2 flex-wrap">
              {officer.rank && (
                <span className="text-xs text-rmpg-200 flex items-center gap-1">
                  <Star className="w-3 h-3 text-amber-400" />
                  {officer.rank}
                </span>
              )}
              <span className={`inline-flex items-center px-2 py-0.5 text-[10px] font-bold uppercase ${ROLE_COLORS[officer.role] || ROLE_COLORS.officer}`}>
                {toDisplayLabel(officer.role)}
              </span>
              {officer.badge_number && (
                <span className="text-xs text-rmpg-300 font-mono flex items-center gap-1">
                  <Shield className="w-3 h-3" />
                  #{officer.badge_number}
                </span>
              )}
              {/* Status chips — moved up from the old middle band */}
              <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 text-[9px] font-bold uppercase border ${
                officer.status === 'on_duty'
                  ? 'bg-green-900/50 text-green-400 border-green-700/50'
                  : 'bg-rmpg-700 text-rmpg-400 border-rmpg-600'
              }`}>
                <span className={officer.status === 'on_duty' ? 'led-dot led-green' : 'led-dot led-off'} />
                {officer.status === 'on_duty' ? 'ON DUTY' : 'OFF DUTY'}
              </span>
              {isClockedIn && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[9px] font-bold bg-green-900/40 text-green-400 border border-green-700/50">
                  <Zap className="w-3 h-3" /> CLOCKED IN
                </span>
              )}
              {isOnBreak && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[9px] font-bold bg-amber-900/40 text-amber-400 border border-amber-700/50">
                  <Coffee className="w-3 h-3" /> ON BREAK
                </span>
              )}
            </div>
          </div>
          {/* Action buttons */}
          <div className="flex items-center gap-1 flex-shrink-0">
            {/* onClick={() => onEditOfficer()}, NOT onClick={onEditOfficer} — the
                latter passes the native MouseEvent straight through as
                openEditOfficer's optional `target` officer param, which then
                wins over `?? selectedOfficer` and the Edit form opens
                completely blank (every officer field reads undefined off the
                event object). */}
            <button type="button" onClick={() => onEditOfficer()} className="toolbar-btn text-[9px]" title="Edit" aria-label="Edit officer">
              <Pencil className="w-3 h-3" />
            </button>
            <PersonnelPrintMenu
              officer={officer}
              credentials={officerCreds}
              training={training.filter(t => t.officer_id === officer.id)}
              equipment={equipment.filter(e => e.officer_id === officer.id)}
              bodyCameras={bodyCameras.filter(c => c.officer_id === Number(officer.id))}
              deployments={deployments.filter(d => d.officer_id === officer.id)}
              timeEntries={officerTime}
            />
            {canManageHR && !isArchived && officer.termination_date && (
              <button type="button" onClick={() => onArchiveOfficer(officer.id)} className="toolbar-btn text-[9px] text-amber-400" title="Archive" aria-label="Archive officer">
                <Archive className="w-3 h-3" />
              </button>
            )}
            {canManageHR && !isArchived && (
              <button type="button" onClick={onDeleteOfficer} className="toolbar-btn toolbar-btn-danger text-[9px]" title="Terminate" aria-label="Terminate officer">
                <Trash2 className="w-3 h-3" />
              </button>
            )}
            {canManageHR && isArchived && (
              <button type="button" onClick={() => onUnarchiveOfficer(officer.id)} className="toolbar-btn toolbar-btn-success text-[9px]" title="Restore" aria-label="Restore officer">
                <RotateCcw className="w-3 h-3" />
              </button>
            )}
            <span className="toolbar-separator" />
            <button type="button" onClick={onClose} className="toolbar-btn p-1" title="Close" aria-label="Close">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Band 2: Clock controls (left) + Quick stats (right) */}
        <div className="panel-inset px-3 py-2 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-rmpg-700">
          {/* Clock controls + duty toggle */}
          <div className="flex items-center gap-2 flex-wrap">
            {isActive ? (
              <>
                {isClockedIn && !isOnBreak && (
                  <button type="button" onClick={() => onStartBreak(officer.id)} className="toolbar-btn text-[9px]">
                    <Coffee className="w-3 h-3" /> Break
                  </button>
                )}
                {isOnBreak && (
                  <button type="button" onClick={() => onEndBreak(officer.id)} className="toolbar-btn toolbar-btn-success text-[9px]">
                    <Zap className="w-3 h-3" /> End Break
                  </button>
                )}
                <button type="button" onClick={() => onClockOut(officer.id)} className="toolbar-btn toolbar-btn-danger text-[9px]">
                  <LogOut className="w-3 h-3" /> Clock Out
                </button>
              </>
            ) : (
              <button type="button" onClick={() => onClockIn(officer.id)} className="toolbar-btn toolbar-btn-success text-[9px]">
                <LogIn className="w-3 h-3" /> Clock In
              </button>
            )}
            <DutyToggle officerId={officer.id} currentStatus={officer.status} onToggled={onDutyToggle} />
          </div>

          {/* Quick stats — inline, right-aligned */}
          <div className="flex items-center gap-3 sm:gap-4">
            <div className="text-center">
              <p className="text-sm font-bold font-mono text-rmpg-100 leading-none">{calcYearsOfService(officer.hire_date)}</p>
              <p className="field-label text-[8px]">Service</p>
            </div>
            <div className="text-center">
              <p className="text-sm font-bold font-mono text-brand-400 leading-none">{officerTotalHours.toFixed(1)}</p>
              <p className="field-label text-[8px]">Hours</p>
            </div>
            <div className="text-center">
              <p className={`text-sm font-bold font-mono leading-none ${officerCreds.some(c => c.status === 'expired') ? 'text-red-400' : hasCredAlert ? 'text-amber-400' : 'text-green-400'}`}>
                {officerCreds.filter(c => c.status === 'valid').length}/{officerCreds.length}
              </p>
              <p className="field-label text-[8px]">Creds</p>
            </div>
            <div className="text-center">
              <p className="text-sm font-bold font-mono text-purple-400 leading-none">{officerSchedules.length}</p>
              <p className="field-label text-[8px]">Sched</p>
            </div>
            <div className="text-center">
              <p className="text-sm font-bold font-mono text-rmpg-200 leading-none">{deployments.filter(d => d.officer_id === officer.id).length}</p>
              <p className="field-label text-[8px]">Deploys</p>
            </div>
          </div>
        </div>
      </div>

      {/* Tab Bar — grouped Spillman module strip */}
      <SpillmanModuleGroup
        groups={[
          {
            label: 'Profile',
            tone: 'steel',
            tabs: [
              { id: 'profile',     label: 'Profile' },
              { id: 'credentials', label: 'Credentials', count: hasCredAlert ? 1 : undefined },
            ],
          },
          {
            label: 'Scheduling',
            tone: 'gold',
            tabs: [
              { id: 'schedule',   label: 'Schedule' },
              { id: 'time',       label: 'Time Log' },
              { id: 'deployment', label: 'Deployment' },
            ],
          },
          {
            label: 'Performance',
            tone: 'green',
            tabs: [
              { id: 'activity', label: 'Activity' },
              { id: 'training', label: 'Training' },
              { id: 'fitness',  label: 'Fitness' },
            ],
          },
          {
            label: 'Equipment',
            tone: 'neutral',
            tabs: [
              { id: 'equipment',     label: 'Equipment' },
              { id: 'body_cameras',  label: 'Body Cams' },
              { id: 'dash_cameras',  label: 'Dash Cams' },
            ],
          },
        ] as ModuleGroupSpec[]}
        activeTab={activeTab}
        onTabChange={(id) => onTabChange(id as DetailTab)}
      />

      {/* Tab Content */}
      <div className="flex-1 min-h-0 overflow-y-auto min-h-0 p-4 scrollbar-dark" role="tabpanel" aria-label={`${activeTab} tab content`}>
        {activeTab === 'profile' && (
          <>
            <ProfileDetailTab officer={officer} credentials={officerCreds} />
            {/* Emailed Documents (outbound PDFs sent from this record) */}
            <EmailedDocuments recordType="personnel" recordId={officer.id} />
          </>
        )}
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
            preparedBy={preparedBy}
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
        {activeTab === 'fitness' && (
          <FitnessCommendationsTab officerId={officer.id} />
        )}
      </div>
    </div>
  );
}
