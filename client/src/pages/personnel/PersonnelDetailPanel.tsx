import React, { useRef } from 'react';
import {
  X, Zap, Star, Shield, Clock, Award, Calendar, User, Activity, GraduationCap, MapPinned,
  Pencil, Trash2, LogIn, LogOut, Archive, RotateCcw, Coffee,
} from 'lucide-react';
import type { Credential, Schedule, TimeEntry, TrainingRecord, Deployment, OfficerEquipment } from '../../types';
import type { OfficerWithStatus } from './utils/personnelMappers';
import { calcYearsOfService } from './utils/personnelFormatters';
import { DETAIL_TABS, ROLE_COLORS, type DetailTab } from './utils/personnelConstants';
import { formatLabel } from '../../utils/formatters';
import OfficerAvatar from './components/OfficerAvatar';
import ProfileDetailTab from './detail-tabs/ProfileDetailTab';
import CredentialsDetailTab from './detail-tabs/CredentialsDetailTab';
import ScheduleDetailTab from './detail-tabs/ScheduleDetailTab';
import TimeLogDetailTab from './detail-tabs/TimeLogDetailTab';
import ActivityDetailTab from './detail-tabs/ActivityDetailTab';
import TrainingDetailTab from './detail-tabs/TrainingDetailTab';
import EquipmentDetailTab from './detail-tabs/EquipmentDetailTab';
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
    <div ref={personnelDetailRef} className="flex-1 flex flex-col overflow-hidden">
      {/* Detail Header */}
      <div className="panel-beveled mx-2 mt-2 p-4">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-4">
            <OfficerAvatar officer={officer} size="lg" />
            <div>
              <h2 className="text-lg font-bold text-white">
                {officer.last_name}, {officer.first_name}
                {officer.middle_name ? ` ${officer.middle_name[0]}.` : ''}
              </h2>
              <div className="w-16 h-0.5 bg-brand-500 mt-1 mb-1.5" />
              <div className="flex items-center gap-3">
                {officer.rank && (
                  <span className="text-xs text-rmpg-200 flex items-center gap-1">
                    <Star className="w-3 h-3 text-amber-400" />
                    {officer.rank}
                  </span>
                )}
                <span className={`inline-flex items-center px-2 py-0.5 text-[10px] font-bold uppercase ${ROLE_COLORS[officer.role] || ROLE_COLORS.officer}`}>
                  {formatLabel(officer.role)}
                </span>
                {officer.badge_number && (
                  <span className="text-xs text-rmpg-300 font-mono flex items-center gap-1">
                    <Shield className="w-3 h-3" />
                    {officer.badge_number}
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Close button */}
          <button onClick={onClose} className="toolbar-btn p-1" title="Close">
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
            <PrintRecordButton recordType="personnel" recordData={officer} identifier={officer.badge_number || officer.last_name} entityType="personnel" entityId={officer.id} label="Print" />
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
      <div className="grid grid-cols-5 gap-2 px-4 py-2 border-b border-rmpg-700">
        <div className={`panel-beveled p-2 text-center border-t-2 ${officer.status === 'on_duty' ? 'border-t-green-500' : 'border-t-rmpg-600'}`}>
          <p className="field-label">Status</p>
          <p className={`text-base font-bold font-mono ${officer.status === 'on_duty' ? 'text-green-400' : 'text-rmpg-400'}`}>
            {officer.status === 'on_duty' ? 'ON DUTY' : 'OFF DUTY'}
          </p>
        </div>
        <div className="panel-beveled p-2 text-center border-t-2 border-t-blue-500">
          <p className="field-label">Service</p>
          <p className="text-base font-bold font-mono text-white">{calcYearsOfService(officer.hire_date)}</p>
        </div>
        <div className="panel-beveled p-2 text-center border-t-2 border-t-brand-500">
          <p className="field-label">Hours (Period)</p>
          <p className="text-base font-bold font-mono text-brand-400">{officerTotalHours.toFixed(1)}</p>
        </div>
        <div className={`panel-beveled p-2 text-center border-t-2 ${officerCreds.some(c => c.status === 'expired') ? 'border-t-red-500' : hasCredAlert ? 'border-t-amber-500' : 'border-t-green-500'}`}>
          <p className="field-label">Credentials</p>
          <p className={`text-base font-bold font-mono ${officerCreds.some(c => c.status === 'expired') ? 'text-red-400' : hasCredAlert ? 'text-amber-400' : 'text-green-400'}`}>
            {officerCreds.length} Active
          </p>
        </div>
        <div className="panel-beveled p-2 text-center border-t-2 border-t-purple-500">
          <p className="field-label">Schedules</p>
          <p className="text-base font-bold font-mono text-purple-400">{officerSchedules.length}</p>
        </div>
      </div>

      {/* Tab Bar */}
      <div className="tab-bar">
        {DETAIL_TABS.map(({ id, label, icon: Icon }) => {
          const alertBadge = id === 'credentials' && hasCredAlert;
          return (
            <button
              key={id}
              className={`tab-bar-item ${activeTab === id ? 'active' : ''}`}
              onClick={() => onTabChange(id)}
            >
              <Icon className="w-3 h-3" />
              {label}
              {alertBadge && <span className="led-dot led-amber ml-1" />}
            </button>
          );
        })}
      </div>

      {/* Tab Content */}
      <div className="flex-1 overflow-auto p-4">
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
