// Per-app static jump list actions shown at the top of the jump list
export interface PinnedAction {
  label: string;
  route?: string;
  event?: string;
}

export const TASKBAR_PINNED_ACTIONS: Record<string, PinnedAction[]> = {
  dispatch: [
    { label: 'New Call',        route: '/dispatch?action=new-call' },
    { label: 'Active Units',    route: '/dispatch?view=units' },
  ],
  records: [
    { label: 'New Incident',    route: '/records/incidents/new' },
    { label: 'Search Records',  route: '/records/search' },
  ],
  warrants: [
    { label: 'New Warrant',     route: '/warrants/new' },
    { label: 'Active Warrants', route: '/warrants?status=active' },
  ],
  map: [
    { label: 'Full Map View',   route: '/map' },
  ],
  calc: [
    { label: 'Open Calculator', event: 'open-calc' },
  ],
  mdt: [
    { label: 'Start Patrol',    route: '/mdt?action=start-patrol' },
  ],
};
