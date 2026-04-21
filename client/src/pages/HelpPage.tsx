// ============================================================
// RMPG Flex — Help & Documentation Page
// System reference, keyboard shortcuts, module guides, FAQ
// ============================================================

import React, { useState, useEffect } from 'react';
import {
  HelpCircle, Keyboard, BookOpen, Monitor, Radio, Map, Database,
  FileText, Users, MessageSquare, BarChart3, Search, Terminal,
  AlertTriangle, Shield, Settings, ChevronRight, ExternalLink,
  Zap, Phone, Send, Car, Gavel, ClipboardList, Briefcase,
  Mail, Globe, FlaskConical, Camera, Video, Package, UserCog,
  Layers, ShieldAlert, Fingerprint, GraduationCap, CalendarDays,
} from 'lucide-react';
import PanelTitleBar from '../components/PanelTitleBar';
import { apiFetch } from '../hooks/useApi';
import { APP_VERSION } from '../utils/version';

// ── Health data type ────────────────────────────────────────
interface HealthData {
  version?: string;
  status?: string;
}

// ── Section IDs ─────────────────────────────────────────────
type SectionId = 'overview' | 'shortcuts' | 'modules' | 'dispatch' | 'faq' | 'system';

interface NavItem {
  id: SectionId;
  label: string;
  icon: React.ElementType;
}

const NAV_ITEMS: NavItem[] = [
  { id: 'overview', label: 'Overview', icon: BookOpen },
  { id: 'shortcuts', label: 'Keyboard Shortcuts', icon: Keyboard },
  { id: 'modules', label: 'Module Guide', icon: Monitor },
  { id: 'dispatch', label: 'Dispatch Reference', icon: Radio },
  { id: 'faq', label: 'FAQ', icon: HelpCircle },
  { id: 'system', label: 'System Info', icon: Settings },
];

// ── Shortcut data ───────────────────────────────────────────
const SHORTCUT_GROUPS = [
  {
    title: 'Global',
    shortcuts: [
      { keys: ['Ctrl', 'K'], description: 'Open global search' },
      { keys: ['?'], description: 'Show keyboard shortcuts modal' },
      { keys: ['Esc'], description: 'Close modal / panel' },
      { keys: ['F11'], description: 'Toggle fullscreen' },
      { keys: ['Ctrl', 'P'], description: 'Print current view' },
      { keys: ['Ctrl', 'E'], description: 'Export current view' },
    ],
  },
  {
    title: 'Page Navigation (F-Keys)',
    shortcuts: [
      { keys: ['F1'], description: 'Dashboard' },
      { keys: ['F2'], description: 'Dispatch' },
      { keys: ['F3'], description: 'Tactical Map' },
      { keys: ['F4'], description: 'MDT' },
      { keys: ['F5'], description: 'NCIC' },
      { keys: ['F6'], description: 'Records' },
      { keys: ['F7'], description: 'Enforcement' },
      { keys: ['F8'], description: 'Personnel' },
      { keys: ['F9'], description: 'Communications' },
      { keys: ['F10'], description: 'Reports' },
      { keys: ['F11'], description: 'Audit Log' },
      { keys: ['F12'], description: 'Admin' },
    ],
  },
  {
    title: 'Quick Navigation (Alt+Number)',
    shortcuts: [
      { keys: ['Alt', '1'], description: 'Dashboard' },
      { keys: ['Alt', '2'], description: 'Dispatch' },
      { keys: ['Alt', '3'], description: 'Map' },
      { keys: ['Alt', '4'], description: 'Records' },
      { keys: ['Alt', '5'], description: 'Personnel' },
      { keys: ['Alt', '6'], description: 'Communications' },
      { keys: ['Alt', '7'], description: 'Reports' },
      { keys: ['Alt', '8'], description: 'MDT' },
    ],
  },
  {
    title: 'Dispatch Console',
    shortcuts: [
      { keys: ['N'], description: 'New call for service' },
      { keys: ['R'], description: 'Refresh call queue' },
      { keys: ['J'], description: 'Next call in queue' },
      { keys: ['K'], description: 'Previous call in queue' },
      { keys: ['D'], description: 'Dispatch selected call' },
      { keys: ['E'], description: 'Set unit enroute' },
      { keys: ['O'], description: 'Set unit on scene' },
      { keys: ['C'], description: 'Clear selected call' },
      { keys: ['1'], description: 'Filter: All calls' },
      { keys: ['2'], description: 'Filter: Pending' },
      { keys: ['3'], description: 'Filter: Active' },
      { keys: ['4'], description: 'Filter: Cleared' },
    ],
  },
  {
    title: 'CAD Command Line',
    shortcuts: [
      { keys: ['/'], description: 'Focus command line' },
      { keys: ['F8'], description: 'Focus command line (alt)' },
      { keys: ['Enter'], description: 'Execute command' },
      { keys: ['↑', '↓'], description: 'Command history' },
    ],
  },
  {
    title: 'Incidents',
    shortcuts: [
      { keys: ['N'], description: 'New incident report' },
      { keys: ['E'], description: 'Edit selected incident' },
      { keys: ['Esc'], description: 'Close detail panel' },
    ],
  },
];

// ── Module Guide data ───────────────────────────────────────
interface ModuleInfo {
  name: string;
  icon: React.ElementType;
  path: string;
  description: string;
  features: string[];
}

const MODULES: ModuleInfo[] = [
  {
    name: 'Dashboard',
    icon: Monitor,
    path: '/',
    description: 'Central operations overview with live statistics, active calls, unit status, and agency metrics.',
    features: ['Live call counts', 'Unit status overview', 'Priority statistics', 'Recent activity feed'],
  },
  {
    name: 'Dispatch',
    icon: Radio,
    path: '/dispatch',
    description: 'Full-featured CAD dispatch console for managing calls for service, unit assignments, and real-time operations.',
    features: ['Call queue management', 'Unit dispatch & tracking', 'CAD command line', 'Priority-based filtering', 'Voice alerts', 'Auto-dispatch protocols'],
  },
  {
    name: 'Tactical Map',
    icon: Map,
    path: '/map',
    description: 'Real-time tactical map with live unit GPS, active call markers, beat boundaries, and GeoJSON overlays.',
    features: ['Live GPS tracking', 'Call markers with details', 'Beat/zone overlays', 'Dark tactical theme', 'Offline tile fallback'],
  },
  {
    name: 'Records',
    icon: Database,
    path: '/records',
    description: 'Master records management for persons, vehicles, addresses, and property. Includes NCIC-style compound search.',
    features: ['Person records (MNI)', 'Vehicle records', 'Address records', 'Property records', 'Universal search', 'Compound search'],
  },
  {
    name: 'Incidents',
    icon: FileText,
    path: '/incidents',
    description: 'Incident report management with UCR/NIBRS classification, multi-officer tracking, and cross-referencing.',
    features: ['Full incident reports', 'Offense codes', 'Officer tracking', 'Cross-links to calls/cases', 'Person/vehicle associations'],
  },
  {
    name: 'Warrants',
    icon: AlertTriangle,
    path: '/warrants',
    description: 'Active warrant tracking and management with person associations and status tracking.',
    features: ['Warrant entry & tracking', 'Person associations', 'Status management', 'National warrant search'],
  },
  {
    name: 'Citations',
    icon: FileText,
    path: '/citations',
    description: 'Traffic and non-traffic citation management with violation tracking, fine calculations, and batch operations.',
    features: ['Citation entry', 'Multiple violations', 'Fine calculation', 'Court tracking', 'Batch operations'],
  },
  {
    name: 'Process Service',
    icon: Send,
    path: '/serve',
    description: 'Serve queue management for process service with GPS tracking, route planning, and attempt logging.',
    features: ['Serve queue', 'GPS-tracked attempts', 'Route optimization', 'Skip trace integration', 'Photo/signature capture'],
  },
  {
    name: 'Personnel',
    icon: Users,
    path: '/personnel',
    description: 'Officer and staff management with profiles, certifications, and assignment tracking.',
    features: ['Officer profiles', 'Badge/unit assignments', 'Certification tracking', 'Contact information'],
  },
  {
    name: 'Fleet',
    icon: Car,
    path: '/fleet',
    description: 'Vehicle fleet management with maintenance tracking, fuel logs, and inspection records.',
    features: ['Vehicle inventory', 'Maintenance scheduling', 'Fuel logs', 'Damage reports', 'Inspections'],
  },
  {
    name: 'Communications',
    icon: MessageSquare,
    path: '/communications',
    description: 'Secure messaging between dispatchers and units with channel-based communication.',
    features: ['Dispatch messages', 'Unit-to-unit messaging', 'Broadcast alerts', 'BOLO distribution'],
  },
  {
    name: 'Reports',
    icon: BarChart3,
    path: '/reports',
    description: 'Comprehensive reporting with charts, analytics, and PDF export capabilities.',
    features: ['Standard reports', 'Crime statistics', 'Officer activity', 'Response time analysis', 'Custom report builder'],
  },
  {
    name: 'Cases',
    icon: Briefcase,
    path: '/cases',
    description: 'Case management with evidence tracking, person/vehicle associations, and cross-referencing.',
    features: ['Case creation & tracking', 'Evidence management', 'Suspect/witness associations', 'Cross-links to incidents/calls'],
  },
  {
    name: 'Skip Tracer',
    icon: Search,
    path: '/skip-tracer',
    description: 'Multi-source skip tracing for locating persons across public and proprietary databases.',
    features: ['22+ data sources', 'FBI Wanted', 'Utah Courts', 'Property records', 'Arrest records'],
  },
  {
    name: 'Forensic Lab',
    icon: FlaskConical,
    path: '/forensic-lab',
    description: 'Evidence processing and forensic analysis tracking with chain-of-custody management.',
    features: ['Case management', 'Exhibit tracking', 'Analysis records', 'Chain of custody'],
  },
  {
    name: 'Court Tracker',
    icon: Gavel,
    path: '/court',
    description: 'Court date and event tracking for officers and cases.',
    features: ['Court event scheduling', 'Officer assignments', 'Case associations', 'Calendar view'],
  },
  {
    name: 'Email',
    icon: Mail,
    path: '/email',
    description: 'Integrated email client for agency communications.',
    features: ['Send/receive email', 'Attachments', 'Contact integration'],
  },
  {
    name: 'CRM',
    icon: Globe,
    path: '/crm',
    description: 'Client relationship management for contracts and service agreements.',
    features: ['Client profiles', 'Contract management', 'Proposals', 'Invoicing'],
  },
  {
    name: 'Training',
    icon: GraduationCap,
    path: '/training',
    description: 'Training dashboard and documentation management for policies, SOPs, and manuals.',
    features: ['Training records', 'Policy documents', 'SOP management', 'Form templates'],
  },
  {
    name: 'Human Resources',
    icon: UserCog,
    path: '/hr',
    description: 'HR management with leave tracking, payroll, performance reviews, and disciplinary records.',
    features: ['Leave management', 'Payroll processing', 'Performance reviews', 'Overtime tracking'],
  },
];

// ── FAQ data ────────────────────────────────────────────────
interface FaqItem {
  question: string;
  answer: string;
}

const FAQ_ITEMS: FaqItem[] = [
  {
    question: 'How do I create a new call for service?',
    answer: 'Navigate to the Dispatch page (F2) and press "N" or click the "New Call" button. Fill in the call details including type, location, and priority, then save.',
  },
  {
    question: 'How do I dispatch a unit to a call?',
    answer: 'Select the call in the dispatch queue, then press "D" or click "Dispatch". Choose the unit(s) to assign and confirm. Units will receive notifications via WebSocket.',
  },
  {
    question: 'How do I use the CAD command line?',
    answer: 'Press "/" or F8 to focus the command line at the bottom of the Dispatch page. Type commands like 10-code lookups, premise alerts, or status changes. Type "HELP" in the command line for a list of available commands.',
  },
  {
    question: 'How do I search for a person or vehicle?',
    answer: 'Use Ctrl+K for global search, or navigate to Records (F6) for detailed search. The compound search supports wildcard name matching, DOB ranges, physical descriptions, and address radius searches.',
  },
  {
    question: 'How do I generate a report or PDF?',
    answer: 'Most pages have an Export button (or Ctrl+E) that generates a PDF of the current view. For custom reports, navigate to Reports > Report Builder.',
  },
  {
    question: 'How do I change my password or enable 2FA?',
    answer: 'Go to Admin (F12) and use the user settings panel. Two-factor authentication can be enabled with TOTP (authenticator app) or WebAuthn (YubiKey/security key).',
  },
  {
    question: 'What do the priority levels mean?',
    answer: 'P1 (Emergency) — immediate threat to life. P2 (Urgent) — in-progress crime, injury. P3 (Routine) — standard response. P4 (Low) — report-only, information. P5 (Scheduled) — planned activity.',
  },
  {
    question: 'How does offline mode work?',
    answer: 'RMPG Flex uses a service worker to cache assets for offline use. The tactical map has pre-cached tiles for the Salt Lake City operational area. Data entered offline will sync when connectivity is restored.',
  },
  {
    question: 'How do I file a Use of Force report?',
    answer: 'Navigate to Use of Force from the sidebar or Records section. Click "New Report" and link it to the associated incident. Complete all required fields including force type, subject details, and justification.',
  },
  {
    question: 'How do I access the system from my phone?',
    answer: 'RMPG Flex is fully responsive and works on mobile browsers. For Android, a native app is available via Capacitor. The mobile interface includes a bottom navigation bar and swipe drawer.',
  },
];

// ── Kbd component ───────────────────────────────────────────
function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd
      className="inline-flex items-center justify-center px-1.5 py-0.5 text-[10px] font-mono font-bold bg-surface-sunken text-rmpg-200 border border-rmpg-600"
      style={{ minWidth: '22px', textAlign: 'center' }}
    >
      {children}
    </kbd>
  );
}

// ── Main Page ───────────────────────────────────────────────
export default function HelpPage() {
  const [activeSection, setActiveSection] = useState<SectionId>('overview');
  const [healthData, setHealthData] = useState<HealthData | null>(null);
  const [expandedFaq, setExpandedFaq] = useState<number | null>(null);

  // Fetch server health info for System section
  useEffect(() => {
    apiFetch<HealthData>('/api/health')
      .then(setHealthData)
      .catch(() => setHealthData(null));
  }, []);

  return (
    <div className="flex h-full overflow-hidden">
      {/* ── Left Navigation ───────────────────────────── */}
      <nav
        className="flex-shrink-0 overflow-y-auto py-3"
        style={{
          width: 200,
          background: '#080808',
          borderRight: '1px solid #222222',
          scrollbarWidth: 'none',
        }}
      >
        <div className="px-3 pb-3 mb-2" style={{ borderBottom: '1px solid #1a1a1a' }}>
          <div className="flex items-center gap-2">
            <HelpCircle className="w-4 h-4 text-[#d4a017]" />
            <span className="text-xs font-bold text-white uppercase tracking-wider">Help Center</span>
          </div>
          <div className="text-[9px] text-rmpg-500 mt-1 font-mono">RMPG Flex v{APP_VERSION}</div>
        </div>

        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const active = activeSection === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => setActiveSection(item.id)}
              className={`w-full flex items-center gap-2.5 px-3 py-2 text-left transition-colors ${!active ? 'hover:bg-[#141414]' : ''}`}
              style={{
                background: active ? 'rgba(136,136,136,0.12)' : 'transparent',
                color: active ? '#ffffff' : '#888888',
                borderLeft: active ? '3px solid #888888' : '3px solid transparent',
              }}
            >
              <Icon style={{ width: 14, height: 14, flexShrink: 0, color: active ? '#aaaaaa' : '#666666' }} />
              <span className="text-[11px] font-medium">{item.label}</span>
            </button>
          );
        })}
      </nav>

      {/* ── Content Area ──────────────────────────────── */}
      <div className="flex-1 overflow-y-auto p-6" style={{ background: '#0a0a0a' }}>
        <div className="max-w-4xl mx-auto space-y-6">

          {/* OVERVIEW */}
          {activeSection === 'overview' && (
            <>
              <PanelTitleBar title="RMPG FLEX — SYSTEM OVERVIEW" icon={BookOpen} />
              <div className="p-4 space-y-4" style={{ background: '#141414', border: '1px solid #222222' }}>
                <p className="text-sm text-rmpg-200 leading-relaxed">
                  RMPG Flex is a full-featured Computer-Aided Dispatch (CAD) and Records Management System (RMS) 
                  built for Rocky Mountain Protective Group. It provides real-time dispatch, incident management, 
                  records tracking, and comprehensive reporting across all operational areas.
                </p>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-4">
                  {[
                    { label: 'Dispatch & CAD', desc: 'Real-time call management, unit tracking, and voice alerts', icon: Radio },
                    { label: 'Records (RMS)', desc: 'Persons, vehicles, incidents, citations, and warrants', icon: Database },
                    { label: 'Tactical Map', desc: 'Live GPS, call markers, beat overlays, offline tiles', icon: Map },
                    { label: 'Investigations', desc: 'Case management, skip tracing, forensic lab', icon: Search },
                    { label: 'Communications', desc: 'Secure messaging, email, radio, and BOLO alerts', icon: MessageSquare },
                    { label: 'Reports & Analytics', desc: 'Custom reports, crime analysis, and PDF exports', icon: BarChart3 },
                  ].map((card) => (
                    <div
                      key={card.label}
                      className="p-3 space-y-1"
                      style={{ background: '#0a0a0a', border: '1px solid #1a1a1a' }}
                    >
                      <div className="flex items-center gap-2">
                        <card.icon className="w-3.5 h-3.5 text-[#d4a017]" />
                        <span className="text-[11px] font-bold text-white uppercase">{card.label}</span>
                      </div>
                      <p className="text-[10px] text-rmpg-400 leading-relaxed">{card.desc}</p>
                    </div>
                  ))}
                </div>
              </div>

              <PanelTitleBar title="GETTING STARTED" icon={Zap} />
              <div className="p-4 space-y-3" style={{ background: '#141414', border: '1px solid #222222' }}>
                {[
                  { step: '1', title: 'Navigate with F-Keys', desc: 'Use F1–F12 to quickly jump between modules. F2 opens Dispatch, F3 opens the Map, etc.' },
                  { step: '2', title: 'Global Search', desc: 'Press Ctrl+K to search across all records — persons, vehicles, incidents, and more.' },
                  { step: '3', title: 'Dispatch Console', desc: 'The dispatch page (F2) is the operational hub. Use N to create calls, J/K to navigate, and the command line (/ or F8) for CAD commands.' },
                  { step: '4', title: 'Menu Bar', desc: 'The File | View | Tools | Help menu bar at the top provides access to all tools, display settings, and quick references.' },
                  { step: '5', title: 'Sidebar Navigation', desc: 'The left sidebar organizes all modules by category. Click the collapse button at the bottom to minimize it.' },
                ].map((item) => (
                  <div key={item.step} className="flex items-start gap-3">
                    <div
                      className="flex-shrink-0 flex items-center justify-center text-[10px] font-bold"
                      style={{
                        width: 22,
                        height: 22,
                        background: 'rgba(212,160,23,0.15)',
                        border: '1px solid rgba(212,160,23,0.3)',
                        color: '#d4a017',
                      }}
                    >
                      {item.step}
                    </div>
                    <div>
                      <div className="text-[11px] font-bold text-white">{item.title}</div>
                      <div className="text-[10px] text-rmpg-400 leading-relaxed">{item.desc}</div>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}

          {/* KEYBOARD SHORTCUTS */}
          {activeSection === 'shortcuts' && (
            <>
              <PanelTitleBar title="KEYBOARD SHORTCUTS" icon={Keyboard} />
              <div className="text-[10px] text-rmpg-500 mb-2">
                Press <Kbd>?</Kbd> anywhere in the app to open the quick shortcuts overlay.
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {SHORTCUT_GROUPS.map((group) => (
                  <div
                    key={group.title}
                    className="p-3"
                    style={{ background: '#141414', border: '1px solid #222222' }}
                  >
                    <h3 className="text-[10px] font-bold text-[#d4a017] uppercase tracking-wider mb-2 pb-1" style={{ borderBottom: '1px solid #1a1a1a' }}>
                      {group.title}
                    </h3>
                    <div className="space-y-1.5">
                      {group.shortcuts.map((s, i) => (
                        <div key={i} className="flex items-center justify-between">
                          <span className="text-[11px] text-rmpg-200">{s.description}</span>
                          <div className="flex items-center gap-0.5 ml-2">
                            {s.keys.map((key, ki) => (
                              <React.Fragment key={ki}>
                                {ki > 0 && <span className="text-rmpg-600 text-[9px] mx-0.5">+</span>}
                                <Kbd>{key}</Kbd>
                              </React.Fragment>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}

          {/* MODULE GUIDE */}
          {activeSection === 'modules' && (
            <>
              <PanelTitleBar title="MODULE GUIDE" icon={Monitor} />
              <div className="text-[10px] text-rmpg-500 mb-2">
                Click any module for details. Use the sidebar or F-keys to navigate.
              </div>
              <div className="space-y-2">
                {MODULES.map((mod) => {
                  const Icon = mod.icon;
                  return (
                    <div
                      key={mod.path}
                      className="p-3"
                      style={{ background: '#141414', border: '1px solid #222222' }}
                    >
                      <div className="flex items-start gap-3">
                        <div
                          className="flex-shrink-0 flex items-center justify-center"
                          style={{
                            width: 28,
                            height: 28,
                            background: 'rgba(136,136,136,0.1)',
                            border: '1px solid #1a1a1a',
                          }}
                        >
                          <Icon className="w-3.5 h-3.5 text-rmpg-300" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-[11px] font-bold text-white">{mod.name}</span>
                            <span className="text-[9px] font-mono text-rmpg-600">{mod.path}</span>
                          </div>
                          <p className="text-[10px] text-rmpg-400 leading-relaxed mt-0.5">{mod.description}</p>
                          <div className="flex flex-wrap gap-1.5 mt-1.5">
                            {mod.features.map((f) => (
                              <span
                                key={f}
                                className="text-[9px] px-1.5 py-0.5 text-rmpg-300"
                                style={{ background: '#0a0a0a', border: '1px solid #1a1a1a' }}
                              >
                                {f}
                              </span>
                            ))}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}

          {/* DISPATCH REFERENCE */}
          {activeSection === 'dispatch' && (
            <>
              <PanelTitleBar title="DISPATCH QUICK REFERENCE" icon={Radio} />

              {/* Priority Levels */}
              <div className="p-4" style={{ background: '#141414', border: '1px solid #222222' }}>
                <h3 className="text-[10px] font-bold text-[#d4a017] uppercase tracking-wider mb-2">Priority Levels</h3>
                <div className="space-y-1.5">
                  {[
                    { level: 'P1', label: 'EMERGENCY', color: '#ef4444', desc: 'Immediate threat to life — lights & sirens' },
                    { level: 'P2', label: 'URGENT', color: '#f97316', desc: 'In-progress crime, injury, or time-sensitive' },
                    { level: 'P3', label: 'ROUTINE', color: '#d4a017', desc: 'Standard response — no immediate danger' },
                    { level: 'P4', label: 'LOW', color: '#888888', desc: 'Report only, information, or follow-up' },
                    { level: 'P5', label: 'SCHEDULED', color: '#666666', desc: 'Pre-planned activity or appointment' },
                  ].map((p) => (
                    <div key={p.level} className="flex items-center gap-3">
                      <span className="text-[10px] font-mono font-bold w-6" style={{ color: p.color }}>{p.level}</span>
                      <span className="text-[10px] font-bold w-24" style={{ color: p.color }}>{p.label}</span>
                      <span className="text-[10px] text-rmpg-400">{p.desc}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Unit Status Codes */}
              <div className="p-4" style={{ background: '#141414', border: '1px solid #222222' }}>
                <h3 className="text-[10px] font-bold text-[#d4a017] uppercase tracking-wider mb-2">Unit Status Codes</h3>
                <div className="space-y-1.5">
                  {[
                    { code: 'AVL', label: 'Available', color: '#22c55e', desc: 'Ready to receive calls' },
                    { code: 'DSP', label: 'Dispatched', color: '#888888', desc: 'Assigned to a call, en route' },
                    { code: 'ENR', label: 'Enroute', color: '#f97316', desc: 'Traveling to call location' },
                    { code: 'ONS', label: 'On Scene', color: '#ef4444', desc: 'Arrived at call location' },
                    { code: 'BSY', label: 'Busy', color: '#eab308', desc: 'Occupied, not available for calls' },
                    { code: 'OOD', label: 'Out of District', color: '#888888', desc: 'Operating outside assigned area' },
                    { code: 'OOS', label: 'Out of Service', color: '#666666', desc: 'Not available (break, end of shift)' },
                  ].map((s) => (
                    <div key={s.code} className="flex items-center gap-3">
                      <span className="text-[10px] font-mono font-bold w-8" style={{ color: s.color }}>{s.code}</span>
                      <span className="text-[10px] font-bold w-28" style={{ color: s.color }}>{s.label}</span>
                      <span className="text-[10px] text-rmpg-400">{s.desc}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* CAD Command Line */}
              <div className="p-4" style={{ background: '#141414', border: '1px solid #222222' }}>
                <h3 className="text-[10px] font-bold text-[#d4a017] uppercase tracking-wider mb-2">CAD Command Line</h3>
                <p className="text-[10px] text-rmpg-400 mb-2">
                  Press <Kbd>/</Kbd> or <Kbd>F8</Kbd> to focus the command line. Type <strong className="text-rmpg-200">HELP</strong> for a full list of commands.
                </p>
                <div className="space-y-1">
                  {[
                    { cmd: '10-4', desc: 'Look up any 10-code' },
                    { cmd: 'STATUS <unit> <status>', desc: 'Change unit status' },
                    { cmd: 'PREMISE <address>', desc: 'Check premise alerts' },
                    { cmd: 'LOCATE <unit>', desc: 'Get unit GPS location' },
                    { cmd: 'MSG <unit> <text>', desc: 'Send message to unit' },
                    { cmd: 'BOLO <text>', desc: 'Broadcast BOLO alert' },
                    { cmd: 'RUN <name/plate>', desc: 'Quick records search' },
                    { cmd: 'HELP', desc: 'List all available commands' },
                  ].map((c) => (
                    <div key={c.cmd} className="flex items-center gap-3">
                      <code className="text-[10px] font-mono text-rmpg-200 w-48 flex-shrink-0">{c.cmd}</code>
                      <span className="text-[10px] text-rmpg-400">{c.desc}</span>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}

          {/* FAQ */}
          {activeSection === 'faq' && (
            <>
              <PanelTitleBar title="FREQUENTLY ASKED QUESTIONS" icon={HelpCircle} />
              <div className="space-y-1">
                {FAQ_ITEMS.map((faq, idx) => (
                  <div
                    key={idx}
                    style={{ background: '#141414', border: '1px solid #222222' }}
                  >
                    <button
                      type="button"
                      onClick={() => setExpandedFaq(expandedFaq === idx ? null : idx)}
                      className="w-full flex items-center justify-between px-4 py-2.5 text-left hover:bg-[#1a1a1a] transition-colors"
                    >
                      <span className="text-[11px] font-medium text-rmpg-200">{faq.question}</span>
                      <ChevronRight
                        className="w-3.5 h-3.5 text-rmpg-500 flex-shrink-0 transition-transform"
                        style={{ transform: expandedFaq === idx ? 'rotate(90deg)' : 'rotate(0deg)' }}
                      />
                    </button>
                    {expandedFaq === idx && (
                      <div className="px-4 pb-3" style={{ borderTop: '1px solid #1a1a1a' }}>
                        <p className="text-[10px] text-rmpg-400 leading-relaxed pt-2">{faq.answer}</p>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </>
          )}

          {/* SYSTEM INFO */}
          {activeSection === 'system' && (
            <>
              <PanelTitleBar title="SYSTEM INFORMATION" icon={Settings} />
              <div className="p-4 space-y-3" style={{ background: '#141414', border: '1px solid #222222' }}>
                <div className="grid grid-cols-2 gap-x-8 gap-y-2">
                  {[
                    { label: 'Application', value: 'RMPG Flex' },
                    { label: 'Version', value: APP_VERSION },
                    { label: 'Platform', value: 'Web / Electron / Capacitor' },
                    { label: 'Frontend', value: 'React + TypeScript + Vite' },
                    { label: 'Backend', value: 'Express + SQLite' },
                    { label: 'Real-time', value: 'WebSocket' },
                    { label: 'Maps', value: 'Google Maps + Offline CartoDB' },
                    { label: 'Auth', value: 'JWT + WebAuthn + TOTP 2FA' },
                    ...(healthData ? [
                      { label: 'Server Version', value: healthData.version || 'N/A' },
                      { label: 'Server Status', value: healthData.status || 'N/A' },
                    ] : []),
                  ].map((row) => (
                    <div key={row.label} className="flex items-center justify-between">
                      <span className="text-[10px] text-rmpg-500 uppercase">{row.label}</span>
                      <span className="text-[10px] font-mono text-rmpg-200">{row.value}</span>
                    </div>
                  ))}
                </div>
              </div>

              <PanelTitleBar title="BROWSER COMPATIBILITY" icon={Monitor} />
              <div className="p-4" style={{ background: '#141414', border: '1px solid #222222' }}>
                <div className="space-y-1.5">
                  {[
                    { browser: 'Chrome / Edge', version: '90+', status: 'Full support' },
                    { browser: 'Firefox', version: '90+', status: 'Full support' },
                    { browser: 'Safari', version: '15+', status: 'Full support' },
                    { browser: 'Electron Desktop', version: 'Latest', status: 'Full support + offline' },
                    { browser: 'Android (Capacitor)', version: 'Latest', status: 'Full support' },
                  ].map((b) => (
                    <div key={b.browser} className="flex items-center gap-4">
                      <span className="text-[10px] font-bold text-rmpg-200 w-36">{b.browser}</span>
                      <span className="text-[10px] font-mono text-rmpg-500 w-16">{b.version}</span>
                      <span className="text-[10px] text-rmpg-400">{b.status}</span>
                    </div>
                  ))}
                </div>
              </div>

              <PanelTitleBar title="CONTACT & SUPPORT" icon={Shield} />
              <div className="p-4" style={{ background: '#141414', border: '1px solid #222222' }}>
                <p className="text-[10px] text-rmpg-400 leading-relaxed">
                  For technical issues, contact your system administrator. For application bugs, use the{' '}
                  <strong className="text-rmpg-200">Help → Report a Problem</strong> menu item.
                  Security issues should be reported to the admin team immediately.
                </p>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
