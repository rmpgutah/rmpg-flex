// ============================================================
// RMPG Flex — Mock Contract Manager Data
// Provides realistic ICU Investigations PSO dispatch and
// records data for the contract_manager role. All IDs are
// negative to avoid collision with real data.
// Timestamps are rolling (relative to "now") so data stays fresh.
// ============================================================

// ─── Helper: relative timestamps ─────────────────────────────
function hoursAgo(h: number): string {
  return new Date(Date.now() - h * 3600000).toISOString().replace('T', ' ').slice(0, 19);
}
function minsAgo(m: number): string {
  return new Date(Date.now() - m * 60000).toISOString().replace('T', ' ').slice(0, 19);
}
function daysAgo(d: number): string {
  return new Date(Date.now() - d * 86400000).toISOString().replace('T', ' ').slice(0, 19);
}

// ─── Mock Client ─────────────────────────────────────────────
export const MOCK_CLIENT = {
  id: -1,
  name: 'ICU Investigations',
  contact_name: 'M. Currie',
  contact_email: 'mcurrie@icuinvestigations.com',
  contact_phone: '801-555-4200',
  address: '215 S State St, Suite 1200, Salt Lake City, UT 84111',
  contract_start: '2025-01-01',
  contract_end: '2026-12-31',
  sla_response_minutes: 15,
  status: 'active',
  notes: 'PSO Client Request — Private Security Operations',
  created_at: '2025-01-01 08:00:00',
};

// ─── Mock Properties ─────────────────────────────────────────
export const MOCK_PROPERTIES = [
  { id: -1, name: 'Gateway Tower', address: '10 E South Temple, Salt Lake City, UT 84133', client_id: -1, lat: 40.7700, lng: -111.8900, gate_code: '4421', hazard_notes: null, status: 'active' },
  { id: -2, name: 'Valley Fair Mall', address: '3601 S 2700 W, West Valley City, UT 84119', client_id: -1, lat: 40.6960, lng: -111.9630, gate_code: null, hazard_notes: 'Loading dock area unlit after 2200', status: 'active' },
  { id: -3, name: 'Murray Tech Center', address: '5295 S Commerce Dr, Murray, UT 84107', client_id: -1, lat: 40.6490, lng: -111.8920, gate_code: '8803', hazard_notes: null, status: 'active' },
  { id: -4, name: 'Draper Pointe Apartments', address: '12300 S 300 E, Draper, UT 84020', client_id: -1, lat: 40.5247, lng: -111.8630, gate_code: '7712#', hazard_notes: 'Pool area gate broken — open access', status: 'active' },
  { id: -5, name: 'Sandy Civic Center', address: '10000 Centennial Pkwy, Sandy, UT 84070', client_id: -1, lat: 40.5650, lng: -111.8800, gate_code: null, hazard_notes: null, status: 'active' },
  { id: -6, name: 'Cottonwood Heights Warehouse', address: '7070 S Union Park Ave, Cottonwood Heights, UT 84047', client_id: -1, lat: 40.6155, lng: -111.8310, gate_code: '5519', hazard_notes: 'Guard dogs on site after hours', status: 'active' },
  { id: -7, name: 'West Jordan Distribution Center', address: '8825 S Redwood Rd, West Jordan, UT 84088', client_id: -1, lat: 40.5960, lng: -111.9390, gate_code: null, hazard_notes: 'Forklift traffic — high-vis required', status: 'active' },
  { id: -8, name: 'Riverton Town Square', address: '12830 S Redwood Rd, Riverton, UT 84065', client_id: -1, lat: 40.5180, lng: -111.9390, gate_code: null, hazard_notes: null, status: 'active' },
];

// ─── Mock Units ──────────────────────────────────────────────
export const MOCK_UNITS = [
  { id: -1, unit_number: 'ICU-1', unit_type: 'patrol', status: 'available', officer_name: 'Davis, R.', badge: 'ICU-101', lat: 40.7608, lng: -111.8910, last_gps: minsAgo(2) },
  { id: -2, unit_number: 'ICU-2', unit_type: 'patrol', status: 'dispatched', officer_name: 'Thompson, K.', badge: 'ICU-102', lat: 40.6960, lng: -111.9630, last_gps: minsAgo(1), assigned_call_id: -2 },
  { id: -3, unit_number: 'ICU-3', unit_type: 'patrol', status: 'on_scene', officer_name: 'Martinez, J.', badge: 'ICU-103', lat: 40.6490, lng: -111.8920, last_gps: minsAgo(3), assigned_call_id: -4 },
  { id: -4, unit_number: 'ICU-4', unit_type: 'supervisor', status: 'available', officer_name: 'Chen, L.', badge: 'ICU-200', lat: 40.5650, lng: -111.8800, last_gps: minsAgo(5) },
];

// ─── Mock Calls for Service ──────────────────────────────────
export function getMockCalls() {
  return [
    // Active calls
    { id: -1, call_number: 'ICU-2026-0042', incident_type: 'PSO Client Request', priority: 2, status: 'active', caller_name: 'Front Desk — Gateway Tower', caller_phone: '801-555-4200', location: '10 E South Temple, Salt Lake City, UT 84133', description: 'Requesting PSO patrol for executive event. VIP arrival expected at lobby entrance.', property_id: -1, client_id: -1, dispatcher_id: null, dispatcher_name: 'AUTO-DISPATCH', created_at: minsAgo(12), updated_at: minsAgo(12), lat: 40.7700, lng: -111.8900 },
    { id: -2, call_number: 'ICU-2026-0041', incident_type: 'Suspicious Activity', priority: 3, status: 'dispatched', caller_name: 'Night Manager', caller_phone: '801-555-3601', location: '3601 S 2700 W, West Valley City, UT 84119', description: 'Unknown male loitering near loading dock for 30+ minutes. Dark clothing, backpack. No vehicle seen.', property_id: -2, client_id: -1, dispatcher_id: null, dispatcher_name: 'AUTO-DISPATCH', created_at: minsAgo(25), updated_at: minsAgo(18), assigned_unit: 'ICU-2', lat: 40.6960, lng: -111.9630 },
    { id: -3, call_number: 'ICU-2026-0040', incident_type: 'Alarm Response', priority: 2, status: 'en_route', caller_name: 'ADT Monitoring', caller_phone: '800-555-2368', location: '7070 S Union Park Ave, Cottonwood Heights, UT 84047', description: 'Motion alarm triggered Zone 3 (warehouse rear). No keyholder contact. Requesting officer response.', property_id: -6, client_id: -1, dispatcher_id: null, dispatcher_name: 'AUTO-DISPATCH', created_at: minsAgo(8), updated_at: minsAgo(5), lat: 40.6155, lng: -111.8310 },
    { id: -4, call_number: 'ICU-2026-0039', incident_type: 'Trespass', priority: 3, status: 'on_scene', caller_name: 'Property Manager', caller_phone: '801-555-1230', location: '12300 S 300 E, Draper, UT 84020', description: 'Two individuals camping in parking garage level B2. Have been warned before. Requesting removal.', property_id: -4, client_id: -1, dispatcher_id: null, dispatcher_name: 'AUTO-DISPATCH', created_at: minsAgo(45), updated_at: minsAgo(30), assigned_unit: 'ICU-3', lat: 40.5247, lng: -111.8630 },

    // Recent closed calls
    { id: -5, call_number: 'ICU-2026-0038', incident_type: 'Patrol Check', priority: 4, status: 'closed', caller_name: 'Scheduled', caller_phone: '', location: '10000 Centennial Pkwy, Sandy, UT 84070', description: 'Routine patrol check — all clear. Doors secured, no activity.', property_id: -5, client_id: -1, dispatcher_id: null, dispatcher_name: 'AUTO-DISPATCH', created_at: hoursAgo(2), updated_at: hoursAgo(1.5), closed_at: hoursAgo(1.5), disposition: 'GOA — All Secure', lat: 40.5650, lng: -111.8800 },
    { id: -6, call_number: 'ICU-2026-0037', incident_type: 'PSO Client Request', priority: 3, status: 'closed', caller_name: 'M. Currie', caller_phone: '801-555-4200', location: '5295 S Commerce Dr, Murray, UT 84107', description: 'Escort request for terminated employee belongings pickup. No issues.', property_id: -3, client_id: -1, dispatcher_id: null, dispatcher_name: 'AUTO-DISPATCH', created_at: hoursAgo(4), updated_at: hoursAgo(3), closed_at: hoursAgo(3), disposition: 'Completed — No Incident', lat: 40.6490, lng: -111.8920 },
    { id: -7, call_number: 'ICU-2026-0036', incident_type: 'Vehicle Theft Report', priority: 1, status: 'closed', caller_name: 'Tenant — Apt 204', caller_phone: '385-555-0204', location: '12300 S 300 E, Draper, UT 84020', description: 'White 2019 Honda Civic UT plate F54 8GL reported stolen from stall #47. Last seen 2300 last night.', property_id: -4, client_id: -1, dispatcher_id: null, dispatcher_name: 'AUTO-DISPATCH', created_at: hoursAgo(8), updated_at: hoursAgo(6), closed_at: hoursAgo(6), disposition: 'Report Taken — Referred to Draper PD', lat: 40.5247, lng: -111.8630 },
    { id: -8, call_number: 'ICU-2026-0035', incident_type: 'Suspicious Activity', priority: 3, status: 'closed', caller_name: 'Security Camera', caller_phone: '', location: '8825 S Redwood Rd, West Jordan, UT 84088', description: 'Camera detected person on roof of distribution center. Officer responded — juvenile, no damage.', property_id: -7, client_id: -1, dispatcher_id: null, dispatcher_name: 'AUTO-DISPATCH', created_at: hoursAgo(12), updated_at: hoursAgo(11), closed_at: hoursAgo(11), disposition: 'Trespass Warning Issued', lat: 40.5960, lng: -111.9390 },
    { id: -9, call_number: 'ICU-2026-0034', incident_type: 'PSO Client Request', priority: 2, status: 'closed', caller_name: 'Event Coordinator', caller_phone: '801-555-8888', location: '12830 S Redwood Rd, Riverton, UT 84065', description: 'Security presence requested for weekend farmers market. 0700-1400.', property_id: -8, client_id: -1, dispatcher_id: null, dispatcher_name: 'AUTO-DISPATCH', created_at: daysAgo(1), updated_at: daysAgo(1), closed_at: hoursAgo(14), disposition: 'Completed — No Incident', lat: 40.5180, lng: -111.9390 },
    { id: -10, call_number: 'ICU-2026-0033', incident_type: 'Alarm Response', priority: 2, status: 'closed', caller_name: 'Vivint Monitoring', caller_phone: '800-555-8477', location: '10 E South Temple, Salt Lake City, UT 84133', description: 'Glass break alarm — Suite 400. Keyholder notified. Officer found window cracked from thermal stress.', property_id: -1, client_id: -1, dispatcher_id: null, dispatcher_name: 'AUTO-DISPATCH', created_at: daysAgo(2), updated_at: daysAgo(2), closed_at: daysAgo(2), disposition: 'False Alarm — Environmental', lat: 40.7700, lng: -111.8900 },
    { id: -11, call_number: 'ICU-2026-0032', incident_type: 'Welfare Check', priority: 3, status: 'closed', caller_name: 'Apt Manager', caller_phone: '801-555-1231', location: '12300 S 300 E, Draper, UT 84020', description: 'Resident in Apt 112 not seen in 3 days, mail piling up. Requested wellness check.', property_id: -4, client_id: -1, dispatcher_id: null, dispatcher_name: 'AUTO-DISPATCH', created_at: daysAgo(3), updated_at: daysAgo(3), closed_at: daysAgo(3), disposition: 'Contact Made — Resident Okay (Traveling)', lat: 40.5247, lng: -111.8630 },
    { id: -12, call_number: 'ICU-2026-0031', incident_type: 'Patrol Check', priority: 4, status: 'closed', caller_name: 'Scheduled', caller_phone: '', location: '3601 S 2700 W, West Valley City, UT 84119', description: 'Scheduled patrol — exterior doors secured, camera 7 offline (notified maintenance).', property_id: -2, client_id: -1, dispatcher_id: null, dispatcher_name: 'AUTO-DISPATCH', created_at: daysAgo(3), updated_at: daysAgo(3), closed_at: daysAgo(3), disposition: 'All Secure — Maintenance Notified (Cam 7)', lat: 40.6960, lng: -111.9630 },
    { id: -13, call_number: 'ICU-2026-0030', incident_type: 'Trespass', priority: 3, status: 'closed', caller_name: 'Overnight Guard', caller_phone: '', location: '5295 S Commerce Dr, Murray, UT 84107', description: 'Found vagrant sleeping in stairwell B. Escorted off property, no belongings left behind.', property_id: -3, client_id: -1, dispatcher_id: null, dispatcher_name: 'AUTO-DISPATCH', created_at: daysAgo(5), updated_at: daysAgo(5), closed_at: daysAgo(5), disposition: 'Trespass Warning Issued', lat: 40.6490, lng: -111.8920 },
    { id: -14, call_number: 'ICU-2026-0029', incident_type: 'Vandalism Report', priority: 3, status: 'closed', caller_name: 'Grounds Crew', caller_phone: '801-555-5500', location: '10000 Centennial Pkwy, Sandy, UT 84070', description: 'Graffiti on south wall of parking structure. Photos taken for report.', property_id: -5, client_id: -1, dispatcher_id: null, dispatcher_name: 'AUTO-DISPATCH', created_at: daysAgo(7), updated_at: daysAgo(7), closed_at: daysAgo(7), disposition: 'Report Filed — Maintenance Cleaning', lat: 40.5650, lng: -111.8800 },
    { id: -15, call_number: 'ICU-2026-0028', incident_type: 'PSO Client Request', priority: 2, status: 'closed', caller_name: 'HR Director', caller_phone: '801-555-4201', location: '7070 S Union Park Ave, Cottonwood Heights, UT 84047', description: 'Standing security for employee termination meeting. 1400-1500.', property_id: -6, client_id: -1, dispatcher_id: null, dispatcher_name: 'AUTO-DISPATCH', created_at: daysAgo(8), updated_at: daysAgo(8), closed_at: daysAgo(8), disposition: 'Completed — No Incident', lat: 40.6155, lng: -111.8310 },
  ];
}

// ─── Mock Persons ────────────────────────────────────────────
export const MOCK_PERSONS = [
  { id: -1, first_name: 'Derek', last_name: 'Montoya', dob: '1988-06-12', gender: 'M', race: 'H', height: '5\'10"', weight: '185', hair_color: 'BLK', eye_color: 'BRO', address: '1520 S State St, Salt Lake City, UT 84115', phone: '385-555-1520', email: null, dl_number: '245867', dl_state: 'UT', flags: 'TRESPASS WARNING', caution_flags: '["prior_trespass"]', created_at: daysAgo(30), notes: 'Trespass warning issued at Draper Pointe — 2 prior incidents' },
  { id: -2, first_name: 'Amanda', last_name: 'Reynolds', dob: '1995-03-22', gender: 'F', race: 'W', height: '5\'6"', weight: '130', hair_color: 'BLN', eye_color: 'GRN', address: '4490 S Highland Dr, Holladay, UT 84124', phone: '801-555-4490', email: 'areynolds@email.com', dl_number: '378912', dl_state: 'UT', flags: null, caution_flags: null, created_at: daysAgo(60), notes: 'Involved in vehicle theft report at Draper Pointe' },
  { id: -3, first_name: 'Marcus', last_name: 'Webb', dob: '1979-11-08', gender: 'M', race: 'B', height: '6\'1"', weight: '210', hair_color: 'BLK', eye_color: 'BRO', address: '655 E 4500 S, Murray, UT 84107', phone: '385-555-0655', email: null, dl_number: '156234', dl_state: 'UT', flags: 'CAUTION', caution_flags: '["aggressive","prior_arrest"]', created_at: daysAgo(90), notes: 'Prior arrest for disorderly conduct — approach with caution' },
  { id: -4, first_name: 'Jennifer', last_name: 'Ostrowski', dob: '1990-07-19', gender: 'F', race: 'W', height: '5\'4"', weight: '125', hair_color: 'RED', eye_color: 'BLU', address: '8940 S Redwood Rd, West Jordan, UT 84088', phone: '801-555-8940', email: 'jostrowski@email.com', dl_number: '489023', dl_state: 'UT', flags: null, caution_flags: null, created_at: daysAgo(15), notes: 'Witness in vandalism report at Sandy Civic Center' },
  { id: -5, first_name: 'Tyler', last_name: 'Nguyen', dob: '2001-01-30', gender: 'M', race: 'A', height: '5\'7"', weight: '145', hair_color: 'BLK', eye_color: 'BRO', address: '3300 S West Temple, South Salt Lake, UT 84115', phone: '385-555-3300', email: null, dl_number: null, dl_state: null, flags: 'JUVENILE TRESPASS', caution_flags: null, created_at: daysAgo(10), notes: 'Trespass warning — found on roof at West Jordan Distribution Center' },
  { id: -6, first_name: 'Robert', last_name: 'Hale', dob: '1972-04-05', gender: 'M', race: 'W', height: '5\'11"', weight: '200', hair_color: 'GRY', eye_color: 'HAZ', address: '12320 S 300 E, Apt 204, Draper, UT 84020', phone: '385-555-0204', email: 'rhale72@email.com', dl_number: '098456', dl_state: 'UT', flags: null, caution_flags: null, created_at: daysAgo(120), notes: 'Tenant at Draper Pointe — reported vehicle theft (2019 Honda Civic)' },
];

// ─── Mock Vehicles ───────────────────────────────────────────
export const MOCK_VEHICLES = [
  { id: -1, plate_number: 'F54 8GL', plate_state: 'UT', vin: '2HGFC2F52KH123456', year: 2019, make: 'Honda', model: 'Civic', color: 'WHI', body_style: 'Sedan', owner_name: 'Robert Hale', owner_id: -6, is_stolen: true, stolen_date: hoursAgo(32), notes: 'Reported stolen from Draper Pointe stall #47' },
  { id: -2, plate_number: 'K92 3WP', plate_state: 'UT', vin: '1FTFW1ET0DKE78901', year: 2017, make: 'Ford', model: 'F-150', color: 'BLK', body_style: 'Pickup', owner_name: 'Derek Montoya', owner_id: -1, is_stolen: false, notes: 'Seen at multiple trespass incidents' },
  { id: -3, plate_number: '3A7 YDX', plate_state: 'UT', vin: 'WBAPH5C55BA234567', year: 2022, make: 'Toyota', model: 'Camry', color: 'SIL', body_style: 'Sedan', owner_name: 'Amanda Reynolds', owner_id: -2, is_stolen: false, notes: null },
];

// ─── Mock Incidents ──────────────────────────────────────────
export const MOCK_INCIDENTS = [
  { id: -1, incident_number: 'ICU-INC-2026-018', incident_type: 'Trespass', status: 'closed', priority: 3, location: '12300 S 300 E, Draper, UT 84020', description: 'Two individuals found camping in parking garage B2. Trespass warnings issued. No property damage.', property_id: -4, client_id: -1, reporting_officer: 'Martinez, J.', badge: 'ICU-103', created_at: minsAgo(45), closed_at: minsAgo(15), disposition: 'Trespass Warning Issued', persons: [-1], vehicles: [-2] },
  { id: -2, incident_number: 'ICU-INC-2026-017', incident_type: 'Theft — Auto', status: 'open', priority: 1, location: '12300 S 300 E, Draper, UT 84020', description: 'White 2019 Honda Civic UT plate F54 8GL stolen from parking stall #47. Referred to Draper PD case #2026-1847.', property_id: -4, client_id: -1, reporting_officer: 'Davis, R.', badge: 'ICU-101', created_at: hoursAgo(8), disposition: 'Referred to Law Enforcement', persons: [-6], vehicles: [-1] },
  { id: -3, incident_number: 'ICU-INC-2026-016', incident_type: 'Vandalism', status: 'closed', priority: 3, location: '10000 Centennial Pkwy, Sandy, UT 84070', description: 'Graffiti discovered on south wall of parking structure. Photos documented. Maintenance notified.', property_id: -5, client_id: -1, reporting_officer: 'Thompson, K.', badge: 'ICU-102', created_at: daysAgo(7), closed_at: daysAgo(7), disposition: 'Report Filed', persons: [], vehicles: [] },
  { id: -4, incident_number: 'ICU-INC-2026-015', incident_type: 'Suspicious Activity', status: 'closed', priority: 3, location: '8825 S Redwood Rd, West Jordan, UT 84088', description: 'Juvenile found on roof of distribution center. No damage, no tools. Trespass warning issued to guardian.', property_id: -7, client_id: -1, reporting_officer: 'Davis, R.', badge: 'ICU-101', created_at: hoursAgo(12), closed_at: hoursAgo(11), disposition: 'Trespass Warning — Juvenile', persons: [-5], vehicles: [] },
  { id: -5, incident_number: 'ICU-INC-2026-014', incident_type: 'False Alarm', status: 'closed', priority: 2, location: '10 E South Temple, Salt Lake City, UT 84133', description: 'Glass break alarm — Suite 400. Investigation found thermal crack in window. No evidence of forced entry.', property_id: -1, client_id: -1, reporting_officer: 'Chen, L.', badge: 'ICU-200', created_at: daysAgo(2), closed_at: daysAgo(2), disposition: 'False Alarm — Environmental', persons: [], vehicles: [] },
];

// ─── Mock Dashboard Stats ────────────────────────────────────
export function getMockDashboardStats() {
  return {
    activeCalls: 4,
    availableUnits: 2,
    totalUnits: 4,
    callsToday: 6,
    callsThisWeek: 15,
    callsThisMonth: 42,
    avgResponseMinutes: 11,
    incidentsOpen: 1,
    incidentsThisMonth: 5,
    topCallTypes: [
      { type: 'PSO Client Request', count: 15 },
      { type: 'Patrol Check', count: 10 },
      { type: 'Suspicious Activity', count: 8 },
      { type: 'Alarm Response', count: 5 },
      { type: 'Trespass', count: 4 },
    ],
  };
}
