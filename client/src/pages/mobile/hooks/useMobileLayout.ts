export type CardId =
  | 'unit' | 'calls' | 'search' | 'bolos' | 'map' | 'actions' | 'messages' | 'shift';

export type Role =
  | 'admin' | 'manager' | 'supervisor' | 'officer' | 'dispatcher'
  | 'contract_manager' | 'client_viewer' | 'human_resources';

const LAYOUTS: Record<Role, CardId[]> = {
  officer: ['unit', 'calls', 'search', 'bolos', 'map', 'actions', 'messages', 'shift'],
  dispatcher: ['calls', 'map', 'messages', 'bolos', 'search'],
  supervisor: ['calls', 'map', 'unit', 'messages', 'bolos'],
  admin: ['search', 'calls', 'bolos', 'messages'],
  manager: ['calls', 'shift', 'messages', 'bolos'],
  contract_manager: ['shift', 'calls'],
  client_viewer: ['bolos', 'calls'],
  human_resources: ['shift'],
};

export function useMobileLayout(role: Role | string | undefined): CardId[] {
  return LAYOUTS[(role as Role)] ?? ['calls', 'search'];
}
