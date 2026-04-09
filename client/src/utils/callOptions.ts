// ============================================================
// RMPG Flex — Shared Dropdown Options for Call/Incident Forms
// Used by NewCallModal, IncidentFormModal, and dispatch views
// ============================================================

/** Weather condition presets for scene documentation */
export const WEATHER_OPTIONS = [
  '', 'Clear', 'Partly Cloudy', 'Overcast', 'Rain', 'Snow', 'Fog', 'Sleet/Hail',
  'Windy', 'Extreme Heat', 'Extreme Cold', 'Unknown',
] as const;

/** Lighting condition presets for scene documentation */
export const LIGHTING_OPTIONS = [
  '', 'Daylight', 'Dusk/Dawn', 'Dark - Street Lit', 'Dark - Not Lit',
  'Artificial Light', 'Unknown',
] as const;

/** Weapon type presets (NIBRS/UCR compatible) */
export const WEAPONS_OPTIONS = [
  'None',
  'Firearm — Handgun',
  'Firearm — Rifle',
  'Firearm — Shotgun',
  'Firearm — Unknown Type',
  'Knife / Edged Weapon',
  'Blunt Object',
  'Vehicle (used as weapon)',
  'Hands / Fists / Feet',
  'Chemical Spray',
  'Taser / Stun Gun',
  'Explosive / IED',
  'BB / Pellet Gun',
  'Bow / Crossbow',
  'Replica / Toy Weapon',
  'Unknown Weapon',
  'Other',
] as const;

/** Law enforcement agency presets (Utah-focused) */
export const LE_AGENCY_OPTIONS = [
  'None',
  'RMPG Internal',
  'Salt Lake City PD',
  'West Valley City PD',
  'West Jordan PD',
  'Sandy City PD',
  'South Jordan PD',
  'Draper PD',
  'Murray PD',
  'Midvale PD',
  'South Salt Lake PD',
  'Herriman PD',
  'Riverton PD',
  'Salt Lake County Sheriff',
  'Utah County Sheriff',
  'Davis County Sheriff',
  'Utah Highway Patrol (UHP)',
  'Park City PD',
  'Provo PD',
  'Orem PD',
  'Ogden PD',
  'Layton PD',
  'Unified Police Dept (UPD)',
  'FBI',
  'ATF',
  'DEA',
  'US Marshals',
  'Other — See Notes',
] as const;

/** Scene safety assessment presets */
export const SCENE_SAFETY_OPTIONS = [
  '', 'Standard', 'Enhanced', 'Precaution',
] as const;

/** Cardinal direction presets for direction of travel */
export const DIRECTION_OPTIONS = [
  '', 'Northbound', 'Southbound', 'Eastbound', 'Westbound',
  'NE', 'NW', 'SE', 'SW', 'Stationary', 'Unknown',
] as const;
