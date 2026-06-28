// ============================================================
// RMPG Flex — Help reference data (shortcuts / priorities /
// statuses / CAD commands)
//
// Extracted from HelpPage.tsx so the same source of truth feeds
// the on-screen Help page AND the printable Quick Reference Card
// PDF (helpQuickReferencePdf.ts), and the MenuBar's
// Help → Quick Reference Card (PDF) item. Single edit point.
// ============================================================

export interface Shortcut {
  keys: string[];
  description: string;
}

export interface ShortcutGroup {
  title: string;
  shortcuts: Shortcut[];
}

export const SHORTCUT_GROUPS: ShortcutGroup[] = [
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

export interface PriorityLevel {
  level: string;
  label: string;
  /** Display color — hex or CSS variable. */
  color: string;
  desc: string;
}

export const PRIORITIES: readonly PriorityLevel[] = [
  { level: 'P1', label: 'EMERGENCY', color: '#ef4444', desc: 'Immediate threat to life — lights & sirens' },
  { level: 'P2', label: 'URGENT', color: '#f97316', desc: 'In-progress crime, injury, or time-sensitive' },
  { level: 'P3', label: 'ROUTINE', color: '#d4a017', desc: 'Standard response — no immediate danger' },
  { level: 'P4', label: 'LOW', color: '#888888', desc: 'Report only, information, or follow-up' },
  { level: 'P5', label: 'SCHEDULED', color: 'var(--rmpg-500)', desc: 'Pre-planned activity or appointment' },
] as const;

export interface UnitStatus {
  code: string;
  label: string;
  color: string;
  desc: string;
}

export const UNIT_STATUSES: readonly UnitStatus[] = [
  { code: 'AVL', label: 'Available', color: '#22c55e', desc: 'Ready to receive calls' },
  { code: 'DSP', label: 'Dispatched', color: '#888888', desc: 'Assigned to a call, en route' },
  { code: 'ENR', label: 'Enroute', color: '#f97316', desc: 'Traveling to call location' },
  { code: 'ONS', label: 'On Scene', color: '#ef4444', desc: 'Arrived at call location' },
  { code: 'BSY', label: 'Busy', color: '#eab308', desc: 'Occupied, not available for calls' },
  { code: 'OOD', label: 'Out of District', color: '#888888', desc: 'Operating outside assigned area' },
  { code: 'OOS', label: 'Out of Service', color: 'var(--rmpg-500)', desc: 'Not available (break, end of shift)' },
] as const;

export interface CadCommand {
  cmd: string;
  desc: string;
}

export const CAD_COMMANDS: readonly CadCommand[] = [
  { cmd: '10-4', desc: 'Look up any 10-code' },
  { cmd: 'STATUS <unit> <status>', desc: 'Change unit status' },
  { cmd: 'PREMISE <address>', desc: 'Check premise alerts' },
  { cmd: 'LOCATE <unit>', desc: 'Get unit GPS location' },
  { cmd: 'MSG <unit> <text>', desc: 'Send message to unit' },
  { cmd: 'BOLO <text>', desc: 'Broadcast BOLO alert' },
  { cmd: 'RUN <name/plate>', desc: 'Quick records search' },
  { cmd: 'HELP', desc: 'List all available commands' },
] as const;
