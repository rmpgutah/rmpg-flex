import type React from 'react';
import {
  LayoutDashboard, Radio, Map, FileText, Database, Users, MessageSquare,
  BarChart3, Settings, AlertTriangle, Monitor, Terminal, Search, Car,
  Video, Camera, ClipboardList, ShieldBan, Gavel, UserX, Briefcase,
  Calendar, TrendingUp, ClipboardCheck, GraduationCap, Network,
  Building2, ShieldAlert, Package, DollarSign, Megaphone, CheckCircle,
  Shield, Share2, CreditCard, Microscope, Mail, QrCode, FileWarning,
  Construction, User, Lock, ScrollText, UserCheck, Fingerprint, Globe,
  HelpCircle, BookOpen, ClipboardPen, ListChecks, Sparkles,
  Navigation, Star, Clock, ExternalLink, RefreshCw, Grid3X3,
  Calculator, ArrowLeftRight, Clipboard, Timer, Cpu, Printer, Download,
  Layout, WifiOff, FileVideo, PhoneCall,
} from 'lucide-react';

export interface NavFunction {
  path: string;
  label: string;
  icon: React.ElementType;
  shortcut?: string;
  description: string;
  adminOnly?: boolean;
  badgeKey?: string;
  /** In-desktop floating window size. Omit for the default 1050x800. */
  windowSize?: { width: number; height: number };
  /** Non-empty reason this page must NOT open in a floating desktop window (falls back to navigate()). */
  notWindowable?: string;
  /** This function launches an Electron-only feature via window.electron rather than an in-app route. Currently only 'company-browser'. */
  electronOnly?: 'company-browser';
}

export interface NavCategory {
  id: string;
  label: string;
  icon: React.ElementType;
  functions: NavFunction[];
}

export const CLIENT_VIEWER_BLOCKED = new Set([
  '/admin', '/audit', '/personnel', '/fleet', '/ncic',
  '/radio', '/patrol', '/shift-plans', '/statute-analytics',
  '/reports/custom', '/crime-analysis', '/dar', '/desktop-company-browser',
  '/dialer-connect',
]);

export const CONTRACT_MANAGER_BLOCKED = new Set([
  '/admin', '/personnel', '/desktop-company-browser',
]);

export const NAV_CATEGORIES: NavCategory[] = [
  {
    id: 'ops',
    label: 'Operations',
    icon: Radio,
    functions: [
      { path: '/', label: 'Dashboard', icon: LayoutDashboard, shortcut: 'F1', description: 'Central operations overview with live statistics, active calls, and unit status' },
      { path: '/dispatch', label: 'Dispatch Console', icon: Radio, shortcut: 'F2', badgeKey: 'activeCalls', description: 'Full CAD dispatch console for call management, unit assignments, and real-time ops', windowSize: { width: 1200, height: 900 } },
      { path: '/map', label: 'Tactical Map', icon: Map, shortcut: 'F3', description: 'Real-time tactical map with live GPS, call markers, beat overlays, and offline tiles', windowSize: { width: 1200, height: 900 } },
      { path: '/mdt', label: 'Mobile Data Terminal', icon: Monitor, shortcut: 'F4', description: 'In-vehicle mobile data terminal for field officers', windowSize: { width: 1000, height: 800 } },
      { path: '/ncic', label: 'NCIC Terminal', icon: Terminal, shortcut: 'F5', description: 'NCIC-style query terminal for warrants, persons, vehicles, and firearms' },
      { path: '/geography', label: 'Dispatch Geography', icon: Map, description: 'Sector, zone, and beat boundary management for dispatch geography' },
      { path: '/dialer-connect', label: 'Dialer Connect', icon: PhoneCall, description: 'In-app Dial Connect phone for inbound and outbound dispatch calls', notWindowable: 'Embeds Dial Connect in the CAD shell via a persistent iframe; a floating window would nest a second Twilio Voice client.' },
      { path: '/desktop-company-browser', label: 'Company Browser', icon: Globe, description: 'General-purpose web browser for vendor portals, county sites, and research', windowSize: { width: 1200, height: 900 } },
    ],
  },
  {
    id: 'records',
    label: 'Records',
    icon: Database,
    functions: [
      { path: '/incidents', label: 'Incidents', icon: FileText, description: 'Incident report management with UCR/NIBRS classification and multi-officer tracking', windowSize: { width: 1100, height: 850 } },
      { path: '/records', label: 'Records (RMS)', icon: Database, description: 'Master records for persons, vehicles, addresses, and property with compound search', windowSize: { width: 1100, height: 850 } },
      { path: '/field-interviews', label: 'Field Interviews', icon: ClipboardList, description: 'Field interview cards (FI/contact cards) with person and vehicle associations' },
      { path: '/criminal-history', label: 'Criminal History', icon: Search, description: 'Criminal history records and background check results' },
      { path: '/dl-search', label: 'DL Search', icon: CreditCard, description: "Driver's license lookup and verification across multiple states" },
      { path: '/microbilt', label: 'MicroBilt', icon: Search, description: 'MicroBilt skip tracing and background data services' },
      { path: '/evidence', label: 'Evidence / Property', icon: Package, description: 'Evidence and property management with chain-of-custody tracking', windowSize: { width: 1100, height: 850 } },
      { path: '/forensic-lab', label: 'Forensic Lab', icon: Microscope, description: 'Forensic analysis tracking, exhibit management, and lab workflow' },
      { path: '/connections', label: 'Connections Analysis', icon: Network, description: 'Link analysis and connection mapping between persons, vehicles, and incidents' },
      { path: '/cases', label: 'Case Management', icon: Briefcase, badgeKey: 'openCases', description: 'Full case management with evidence, suspect/witness tracking, and cross-referencing', windowSize: { width: 1100, height: 850 } },
      { path: '/arrest-records', label: 'Arrest Records', icon: UserX, description: 'Arrest record management and processing' },
      { path: '/court-records', label: 'Court Records', icon: Gavel, description: 'Court records and case disposition tracking' },
      { path: '/documents', label: 'Documents', icon: FileText, description: 'Document management and filing system' },
      { path: '/document-intake', label: 'Document Intake', icon: ClipboardPen, description: 'Document scanning and intake processing' },
    ],
  },
  {
    id: 'enforce',
    label: 'Enforcement',
    icon: AlertTriangle,
    functions: [
      { path: '/warrants', label: 'Warrants', icon: AlertTriangle, badgeKey: 'activeWarrants', description: 'Active warrant tracking with person associations, status management, and national search', windowSize: { width: 1140, height: 840 } },
      { path: '/national-warrant-search', label: 'National Warrant Search', icon: Globe, description: 'Federated warrant search across multiple state and national databases', windowSize: { width: 1180, height: 860 } },
      { path: '/citations', label: 'Citations', icon: FileWarning, description: 'Traffic and non-traffic citation management with violation tracking', windowSize: { width: 1000, height: 800 } },
      { path: '/law-book', label: 'Law Book', icon: BookOpen, description: 'Statute and code reference library for charge lookup and legal research', windowSize: { width: 1100, height: 820 } },
      { path: '/trespass-orders', label: 'Trespass Orders', icon: ShieldBan, description: 'Trespass order management and enforcement tracking' },
      { path: '/code-enforcement', label: 'Code Enforcement', icon: Construction, description: 'Municipal and property code enforcement case management' },
      { path: '/court', label: 'Court Tracker', icon: Gavel, description: 'Court date and event tracking for officers and cases' },
      { path: '/offender-registry', label: 'Offender Registry', icon: UserX, description: 'Registered offender tracking and compliance management' },
      { path: '/sex-offender-registry', label: 'Sex Offender Registry', icon: Fingerprint, description: 'Sex offender registration and verification' },
      { path: '/serve', label: 'Process Server', icon: Briefcase, badgeKey: 'pendingServe', description: 'Serve queue with GPS tracking, route optimization, and attempt logging', notWindowable: 'The "edit before print" action does a full-page window.location.href navigation to /pdf-editor (ServePage.tsx:318), which would replace the window\'s content while the title bar stays stale.' },
      { path: '/serve-intake', label: 'Service Intake', icon: ClipboardPen, description: 'Process service intake and document receipt' },
    ],
  },
  {
    id: 'personnel',
    label: 'Personnel',
    icon: Users,
    functions: [
      { path: '/personnel', label: 'Personnel', icon: Users, description: 'Officer and staff profiles, certifications, assignments, and contact info', windowSize: { width: 1100, height: 850 } },
      { path: '/hr', label: 'HR Console', icon: ClipboardCheck, description: 'HR management with leave, payroll, performance reviews, and disciplinary records' },
      { path: '/fleet', label: 'Fleet Management', icon: Car, description: 'Vehicle fleet management with maintenance, fuel logs, and inspections', windowSize: { width: 1100, height: 850 } },
      { path: '/body-cameras', label: 'Body Cameras', icon: Video, description: 'Body-worn camera management, video review, and evidence tagging', windowSize: { width: 1000, height: 800 } },
      { path: '/dash-cameras', label: 'Dash Cameras', icon: Camera, description: 'Dashboard camera management and video evidence system' },
      { path: '/dashcams', label: 'Dashcam System', icon: Camera, description: 'Dashcam system configuration, live view, and playback' },
      { path: '/dashcam-ai', label: 'Dashcam AI', icon: Sparkles, description: 'AI-powered dashcam analytics: plate recognition, behavior detection' },
      { path: '/training', label: 'Training', icon: GraduationCap, description: 'Training dashboard and documentation for policies, SOPs, and manuals' },
      { path: '/training-docs', label: 'Training Documents', icon: BookOpen, description: 'Training document library and reference materials' },
      { path: '/training-mgmt', label: 'Training Admin', icon: ListChecks, description: 'Training administration, course scheduling, and compliance tracking' },
    ],
  },
  {
    id: 'comms',
    label: 'Communications',
    icon: MessageSquare,
    functions: [
      { path: '/communications', label: 'Communications', icon: MessageSquare, badgeKey: 'activeBOLOs', description: 'Secure messaging between dispatchers and units with channel-based comms', windowSize: { width: 1000, height: 800 } },
      { path: '/radio', label: 'Radio Console', icon: Radio, description: 'Integrated radio console with channel management and PTT controls' },
      { path: '/email', label: 'Email', icon: Mail, badgeKey: 'unreadEmail', description: 'Integrated email client for agency communications' },
      { path: '/patrol', label: 'Patrol Operations', icon: QrCode, description: 'Patrol operations and QR-based reporting', windowSize: { width: 1100, height: 850 } },
    ],
  },
  {
    id: 'analysis',
    label: 'Analysis & Reports',
    icon: BarChart3,
    functions: [
      { path: '/reports', label: 'Reports', icon: BarChart3, description: 'Comprehensive reporting with charts, analytics, and PDF export', windowSize: { width: 1100, height: 850 } },
      { path: '/shift-plans', label: 'Shift Plans', icon: Calendar, description: 'Shift scheduling and patrol plan management' },
      { path: '/statute-analytics', label: 'Statute Analytics', icon: TrendingUp, description: 'Statute usage analytics and enforcement trend analysis' },
      { path: '/reports/custom', label: 'Report Builder', icon: Database, description: 'Custom report builder with drag-and-drop field selection' },
      { path: '/crime-analysis', label: 'Crime Analysis', icon: TrendingUp, description: 'Crime pattern analysis, hot spot mapping, and trend reporting' },
      { path: '/dar', label: 'Daily Activity Reports', icon: ClipboardCheck, description: 'Daily activity report generation and officer log review', windowSize: { width: 1100, height: 850 } },
    ],
  },
  {
    id: 'investigations',
    label: 'Investigations',
    icon: Search,
    functions: [
      { path: '/skip-tracer', label: 'Skip Tracer', icon: Search, description: 'Multi-source skip tracing across 22+ public and proprietary databases' },
      { path: '/web-research', label: 'Web Research', icon: Globe, description: 'Open-source intelligence (OSINT) web research tools' },
      { path: '/colorado-doc', label: 'Colorado DOC Search', icon: User, description: 'Colorado Department of Corrections inmate search' },
      { path: '/iped', label: 'IPED Forensics', icon: Microscope, description: 'IPED digital forensics and device analysis' },
      { path: '/recon-connect', label: 'Recon Connect', icon: Network, description: 'Recon intelligence platform integration' },
    ],
  },
  {
    id: 'jail',
    label: 'Jail / Internal Affairs',
    icon: Building2,
    functions: [
      { path: '/jail', label: 'Jail Management', icon: Building2, description: 'Jail management, inmate tracking, and facility operations' },
      { path: '/affairs', label: 'Internal Affairs', icon: ShieldAlert, description: 'Internal affairs case management and investigation tracking' },
      { path: '/assets', label: 'Asset Management', icon: Package, description: 'Asset inventory, tracking, and depreciation management' },
    ],
  },
  {
    id: 'services',
    label: 'Agency Services',
    icon: Shield,
    functions: [
      { path: '/billing', label: 'Billing', icon: DollarSign, description: 'Client billing, invoicing, and payment tracking' },
      { path: '/community', label: 'Community Relations', icon: Users, description: 'Community outreach programs and event management' },
      { path: '/tasks', label: 'Task Management', icon: ClipboardList, description: 'Task assignments, tracking, and workflow management' },
      { path: '/alerts', label: 'Alert Center', icon: Megaphone, description: 'Agency-wide alert broadcasting and notification management' },
      { path: '/qa', label: 'Quality Assurance', icon: CheckCircle, description: 'QA reviews, compliance checks, and performance metrics' },
      { path: '/risk', label: 'Risk Management', icon: Shield, description: 'Risk assessment, incident review, and liability tracking' },
      { path: '/interagency', label: 'Interagency', icon: Share2, description: 'Interagency cooperation, task force management, and data sharing' },
      { path: '/gang-intel', label: 'Gang Intelligence', icon: Shield, description: 'Gang intelligence tracking, associations, and activity monitoring' },
      { path: '/narcotics', label: 'Narcotics', icon: Shield, description: 'Narcotics investigation case management' },
      { path: '/special-ops', label: 'Special Operations', icon: Shield, description: 'Special operations planning and tactical team management' },
      { path: '/crisis-response', label: 'Crisis Response', icon: Shield, description: 'Crisis response team coordination and incident management' },
      { path: '/victim-services', label: 'Victim Services', icon: Shield, description: 'Victim advocacy, resource referral, and case tracking' },
      { path: '/alarms', label: 'Alarm Management', icon: Shield, description: 'Alarm permit management and alarm response tracking' },
      { path: '/accreditation', label: 'Accreditation', icon: CheckCircle, description: 'CALEA and state accreditation document management' },
      { path: '/recruitment', label: 'Recruitment', icon: UserCheck, description: 'Applicant tracking, hiring pipeline, and recruitment events' },
    ],
  },
  {
    id: 'overwatch',
    label: 'Overwatch / CRM',
    icon: Briefcase,
    functions: [
      { path: '/crm', label: 'Overwatch CRM', icon: Briefcase, description: 'Client relationship management for contracts and service agreements' },
      { path: '/invoices', label: 'Invoices', icon: DollarSign, description: 'Invoice generation, processing, and payment tracking' },
      { path: '/command-center', label: 'Command Center', icon: Monitor, description: 'Centralized command center for multi-incident coordination' },
      { path: '/security-dashboard', label: 'Security Dashboard', icon: Shield, description: 'Security operations dashboard with threat monitoring' },
      { path: '/use-of-force', label: 'Use of Force', icon: AlertTriangle, description: 'Use of force report submission and review tracking' },
    ],
  },
  {
    id: 'support',
    label: 'Support & Tools',
    icon: HelpCircle,
    functions: [
      { path: '/settings', label: 'Settings', icon: Settings, description: 'User preferences, notification config, and account settings' },
      { path: '/notifications', label: 'Notifications', icon: Megaphone, description: 'Notification history and preference management' },
      { path: '/help', label: 'Help & About', icon: HelpCircle, description: 'System documentation, keyboard shortcuts, FAQ, and version info' },
      { path: '/navigation', label: 'Navigation / Drive', icon: Navigation, description: 'In-vehicle GPS turn-by-turn navigation and drive instruments', notWindowable: 'Full-screen in-vehicle drive HUD rendered outside <Layout> (kiosk mode, uses the native Fullscreen API) — not meant to run inside a small floating window.' },
      { path: '/geo-data-viewer', label: 'Geo Data Viewer', icon: Map, description: 'Geospatial data viewer and layer management' },
    ],
  },
  {
    id: 'system',
    label: 'System',
    icon: Lock,
    functions: [
      { path: '/audit', label: 'Audit Log', icon: ScrollText, shortcut: 'F11', adminOnly: true, description: 'System audit trail with user activity, data changes, and access logs' },
      { path: '/admin', label: 'Administration', icon: Settings, shortcut: 'F12', adminOnly: true, description: 'System administration, user management, roles, and configuration' },
    ],
  },
  {
    id: 'tools',
    label: 'Desktop Tools',
    icon: Calculator,
    functions: [
      { path: '/calculator', label: 'Calculator', icon: Calculator, description: 'Standard calculator with history log' },
      { path: '/unit-converter', label: 'Unit Converter', icon: ArrowLeftRight, description: 'Convert distance, speed, weight, and temperature' },
      { path: '/clipboard-manager', label: 'Clipboard Manager', icon: Clipboard, description: 'View and re-use clipboard history' },
      { path: '/focus-timer', label: 'Focus Timer', icon: Timer, description: 'Pomodoro-style focus and break timer' },
      { path: '/device-health', label: 'Device Health', icon: Cpu, description: 'Battery, network, and API service health' },
      { path: '/print-queue', label: 'Print Queue', icon: Printer, description: 'View and manage active print jobs' },
      { path: '/scheduled-updates', label: 'Scheduled Updates', icon: Download, description: 'Configure automatic update install window' },
      { path: '/remote-lock', label: 'Remote Device Lock', icon: Lock, adminOnly: true, description: 'Send a remote lock signal to a field device' },
      { path: '/shift-notes', label: 'Shift Notes', icon: Clipboard, description: 'Quick shift notes and end-of-shift log entries' },
      { path: '/offline-queue', label: 'Offline Queue', icon: WifiOff, description: 'View and retry actions queued while offline' },
      { path: '/screen-capture', label: 'Screen Capture', icon: Camera, description: 'Capture and annotate screenshots for documentation' },
    ],
  },
  {
    id: 'dispatch-tools',
    label: 'Dispatch Tools',
    icon: Radio,
    functions: [
      { path: '/quick-plate', label: 'Quick Plate Check', icon: Search, description: 'Fast plate lookup without opening the full plate log' },
      { path: '/unit-status-board', label: 'Unit Status Board', icon: Layout, description: 'Live board showing all unit statuses and assignments' },
      { path: '/live-call-map', label: 'Live Call Map', icon: Map, description: 'Real-time map view of all active calls for service' },
      { path: '/broadcast', label: 'Broadcast Message', icon: Megaphone, description: 'Send a broadcast message to all active units' },
    ],
  },
  {
    id: 'admin-tools',
    label: 'Admin Tools',
    icon: Settings,
    functions: [
      { path: '/system-logs', label: 'System Logs', icon: Terminal, adminOnly: true, description: 'Live system log viewer for Worker and database events' },
      { path: '/digital-evidence', label: 'Digital Evidence', icon: FileVideo, description: 'Digital evidence management, review, and chain-of-custody' },
    ],
  },
];
