import { NavLink } from 'react-router-dom';
import {
  LayoutDashboard, Car, Fuel, Wrench, ClipboardList, CheckSquare,
  AlertTriangle, FileText, Package, Store, BarChart3,
  Users, Camera, MapPin, FileEdit,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

export type SidebarScope = 'fleetio' | 'rmpg-only';

export interface SidebarItem {
  id: string;
  label: string;
  path: string;
  icon: LucideIcon;
  scope: SidebarScope;
  /** True when this section's content isn't built yet (shows ◯ + EmptyStateCard). */
  empty?: boolean;
  /** Fleet.io deep-link for ◯ sections. */
  fleetioUrl?: string;
}

export const SIDEBAR_SECTIONS: readonly SidebarItem[] = [
  // === Fleet.io-mirrored (above the gold divider) ===
  { id: 'dashboard',   label: 'Dashboard',    path: '/fleet/v2',              icon: LayoutDashboard, scope: 'fleetio' },
  { id: 'vehicles',    label: 'Vehicles',     path: '/fleet/v2/vehicles',     icon: Car,             scope: 'fleetio' },
  { id: 'fuel',        label: 'Fuel Entries', path: '/fleet/v2/fuel',         icon: Fuel,            scope: 'fleetio' },
  { id: 'service',     label: 'Service',      path: '/fleet/v2/service',      icon: Wrench,          scope: 'fleetio' },
  { id: 'work-orders', label: 'Work Orders',  path: '/fleet/v2/work-orders',  icon: ClipboardList,   scope: 'fleetio', empty: true, fleetioUrl: 'https://secure.fleetio.com/work_orders' },
  { id: 'inspections', label: 'Inspections',  path: '/fleet/v2/inspections',  icon: CheckSquare,     scope: 'fleetio' },
  { id: 'issues',      label: 'Issues',       path: '/fleet/v2/issues',       icon: AlertTriangle,   scope: 'fleetio', empty: true, fleetioUrl: 'https://secure.fleetio.com/issues' },
  { id: 'documents',   label: 'Documents',    path: '/fleet/v2/documents',    icon: FileText,        scope: 'fleetio', empty: true, fleetioUrl: 'https://secure.fleetio.com/documents' },
  { id: 'parts',       label: 'Parts',        path: '/fleet/v2/parts',        icon: Package,         scope: 'fleetio', empty: true, fleetioUrl: 'https://secure.fleetio.com/parts' },
  { id: 'vendors',     label: 'Vendors',      path: '/fleet/v2/vendors',      icon: Store,           scope: 'fleetio' },
  { id: 'reports',     label: 'Reports',      path: '/fleet/v2/reports',      icon: BarChart3,       scope: 'fleetio' },
  // === RMPG-only (below the gold divider) ===
  { id: 'personnel',    label: 'Personnel',     path: '/fleet/v2/personnel',     icon: Users,    scope: 'rmpg-only' },
  { id: 'dash-cameras', label: 'Dash Cameras',  path: '/fleet/v2/dash-cameras',  icon: Camera,   scope: 'rmpg-only' },
  { id: 'gps',          label: 'GPS Tracking',  path: '/fleet/v2/gps',           icon: MapPin,   scope: 'rmpg-only' },
  { id: 'analysis',     label: 'Analysis Forms',path: '/fleet/v2/analysis',      icon: FileEdit, scope: 'rmpg-only' },
];

export function Sidebar() {
  const fleetio = SIDEBAR_SECTIONS.filter((s) => s.scope === 'fleetio');
  const rmpgOnly = SIDEBAR_SECTIONS.filter((s) => s.scope === 'rmpg-only');
  return (
    <nav className="w-56 shrink-0 bg-surface-base border-r border-rmpg-700 py-2 overflow-y-auto" aria-label="Fleet sections">
      <ul className="space-y-0.5">
        {fleetio.map((s) => <SidebarRow key={s.id} item={s} />)}
      </ul>
      <Divider />
      <ul className="space-y-0.5">
        {rmpgOnly.map((s) => <SidebarRow key={s.id} item={s} />)}
      </ul>
    </nav>
  );
}

function SidebarRow({ item }: { item: SidebarItem }) {
  const Icon = item.icon;
  const suffix = [
    item.empty ? '(coming soon)' : null,
    item.scope === 'rmpg-only' ? '(RMPG only)' : null,
  ].filter(Boolean).join(' ');
  return (
    <li>
      <NavLink
        to={item.path}
        end={item.path === '/fleet/v2'}
        aria-label={[item.label, suffix].filter(Boolean).join(' ').trim()}
        className={({ isActive }) =>
          `flex items-center gap-2 px-3 py-1.5 text-[11px] ${
            isActive ? 'bg-rmpg-700 text-rmpg-50' : 'text-rmpg-300 hover:bg-rmpg-800 hover:text-rmpg-100'
          }`
        }
      >
        <Icon className="w-3.5 h-3.5 shrink-0" />
        <span className="flex-1">{item.label}</span>
        {item.empty ? <span aria-hidden className="text-rmpg-500">◯</span> : null}
        {item.scope === 'rmpg-only' ? <span aria-hidden className="w-1.5 h-1.5 rounded-full bg-brand-400" /> : null}
      </NavLink>
    </li>
  );
}

function Divider() {
  return (
    <div className="my-2 px-3" aria-hidden>
      <hr className="border-rmpg-700" />
      <div className="text-[9px] uppercase tracking-wider text-brand-400 text-center py-1">
        RMPG only
      </div>
      <hr className="border-rmpg-700" />
    </div>
  );
}
