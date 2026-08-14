const SEED_KEY = 'rmpg_desktop_icons_seeded_v1';

const ROLE_DEFAULT_PINS: Record<string, string[]> = {
  admin:            ['/dispatch', '/map', '/records', '/warrants', '/personnel', '/admin', '/reports'],
  manager:          ['/dispatch', '/map', '/records', '/warrants', '/personnel', '/reports'],
  supervisor:       ['/dispatch', '/map', '/records', '/warrants', '/personnel'],
  officer:          ['/dispatch', '/map', '/mdt', '/records'],
  dispatcher:       ['/dispatch', '/map', '/records', '/personnel'],
  contract_manager: ['/dispatch', '/records', '/reports'],
  client_viewer:    ['/dispatch', '/map', '/reports'],
  human_resources:  ['/personnel', '/records', '/reports'],
};

export function hasBeenSeeded(): boolean {
  return localStorage.getItem(SEED_KEY) === '1';
}

export function markSeeded(): void {
  localStorage.setItem(SEED_KEY, '1');
}

export function getDefaultPinsForRole(role: string): string[] {
  return ROLE_DEFAULT_PINS[role] ?? ROLE_DEFAULT_PINS['officer'];
}
