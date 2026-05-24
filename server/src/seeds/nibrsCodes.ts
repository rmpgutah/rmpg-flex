/**
 * NIBRS reference-data seeds.
 *
 * Sourced from the FBI NIBRS Technical Specification (2019) and the
 * UCR Handbook. This is a representative subset covering the common
 * codes used by RMPG operations — not the exhaustive code list. New
 * codes can be added at runtime via /api/nibrs/codes endpoints; the
 * seed only runs when the target table is empty.
 */
import type Database from 'better-sqlite3';

type OffenseSeed = {
  code: string;
  description: string;
  crime_against: 'Person' | 'Property' | 'Society';
  group_class: 'A' | 'B';
  attempted_completed_required?: 0 | 1;
  victim_required?: 0 | 1;
  property_required?: 0 | 1;
};

// Group A (52 offenses, abbreviated by category). One-of-each-major-category coverage.
const OFFENSES: OffenseSeed[] = [
  // Crimes against Person
  { code: '09A', description: 'Murder and Nonnegligent Manslaughter', crime_against: 'Person', group_class: 'A' },
  { code: '09B', description: 'Negligent Manslaughter', crime_against: 'Person', group_class: 'A' },
  { code: '09C', description: 'Justifiable Homicide', crime_against: 'Person', group_class: 'A' },
  { code: '100', description: 'Kidnapping/Abduction', crime_against: 'Person', group_class: 'A' },
  { code: '11A', description: 'Rape', crime_against: 'Person', group_class: 'A' },
  { code: '11B', description: 'Sodomy', crime_against: 'Person', group_class: 'A' },
  { code: '11C', description: 'Sexual Assault With An Object', crime_against: 'Person', group_class: 'A' },
  { code: '11D', description: 'Fondling', crime_against: 'Person', group_class: 'A' },
  { code: '13A', description: 'Aggravated Assault', crime_against: 'Person', group_class: 'A' },
  { code: '13B', description: 'Simple Assault', crime_against: 'Person', group_class: 'A' },
  { code: '13C', description: 'Intimidation', crime_against: 'Person', group_class: 'A' },
  { code: '36A', description: 'Incest', crime_against: 'Person', group_class: 'A' },
  { code: '36B', description: 'Statutory Rape', crime_against: 'Person', group_class: 'A' },
  { code: '64A', description: 'Human Trafficking, Commercial Sex Acts', crime_against: 'Person', group_class: 'A' },
  { code: '64B', description: 'Human Trafficking, Involuntary Servitude', crime_against: 'Person', group_class: 'A' },
  // Crimes against Property
  { code: '200', description: 'Arson', crime_against: 'Property', group_class: 'A', property_required: 1 },
  { code: '210', description: 'Extortion/Blackmail', crime_against: 'Property', group_class: 'A', property_required: 1 },
  { code: '220', description: 'Burglary/Breaking & Entering', crime_against: 'Property', group_class: 'A', property_required: 1 },
  { code: '23A', description: 'Pocket-picking', crime_against: 'Property', group_class: 'A', property_required: 1 },
  { code: '23B', description: 'Purse-snatching', crime_against: 'Property', group_class: 'A', property_required: 1 },
  { code: '23C', description: 'Shoplifting', crime_against: 'Property', group_class: 'A', property_required: 1 },
  { code: '23D', description: 'Theft From Building', crime_against: 'Property', group_class: 'A', property_required: 1 },
  { code: '23E', description: 'Theft From Coin-Operated Machine', crime_against: 'Property', group_class: 'A', property_required: 1 },
  { code: '23F', description: 'Theft From Motor Vehicle', crime_against: 'Property', group_class: 'A', property_required: 1 },
  { code: '23G', description: 'Theft of Motor Vehicle Parts/Accessories', crime_against: 'Property', group_class: 'A', property_required: 1 },
  { code: '23H', description: 'All Other Larceny', crime_against: 'Property', group_class: 'A', property_required: 1 },
  { code: '240', description: 'Motor Vehicle Theft', crime_against: 'Property', group_class: 'A', property_required: 1 },
  { code: '250', description: 'Counterfeiting/Forgery', crime_against: 'Property', group_class: 'A', property_required: 1 },
  { code: '26A', description: 'False Pretenses/Swindle/Confidence Game', crime_against: 'Property', group_class: 'A', property_required: 1 },
  { code: '26B', description: 'Credit Card/ATM Fraud', crime_against: 'Property', group_class: 'A', property_required: 1 },
  { code: '26C', description: 'Impersonation', crime_against: 'Property', group_class: 'A', property_required: 1 },
  { code: '26D', description: 'Welfare Fraud', crime_against: 'Property', group_class: 'A', property_required: 1 },
  { code: '26E', description: 'Wire Fraud', crime_against: 'Property', group_class: 'A', property_required: 1 },
  { code: '26F', description: 'Identity Theft', crime_against: 'Property', group_class: 'A', property_required: 1 },
  { code: '26G', description: 'Hacking/Computer Invasion', crime_against: 'Property', group_class: 'A', property_required: 1 },
  { code: '270', description: 'Embezzlement', crime_against: 'Property', group_class: 'A', property_required: 1 },
  { code: '280', description: 'Stolen Property Offenses', crime_against: 'Property', group_class: 'A', property_required: 1 },
  { code: '290', description: 'Destruction/Damage/Vandalism of Property', crime_against: 'Property', group_class: 'A', property_required: 1 },
  { code: '510', description: 'Bribery', crime_against: 'Property', group_class: 'A', property_required: 1 },
  { code: '120', description: 'Robbery', crime_against: 'Property', group_class: 'A', property_required: 1 },
  // Crimes against Society
  { code: '35A', description: 'Drug/Narcotic Violations', crime_against: 'Society', group_class: 'A', victim_required: 0 },
  { code: '35B', description: 'Drug Equipment Violations', crime_against: 'Society', group_class: 'A', victim_required: 0 },
  { code: '370', description: 'Pornography/Obscene Material', crime_against: 'Society', group_class: 'A', victim_required: 0 },
  { code: '39A', description: 'Betting/Wagering', crime_against: 'Society', group_class: 'A', victim_required: 0 },
  { code: '39B', description: 'Operating/Promoting/Assisting Gambling', crime_against: 'Society', group_class: 'A', victim_required: 0 },
  { code: '39C', description: 'Gambling Equipment Violation', crime_against: 'Society', group_class: 'A', victim_required: 0 },
  { code: '39D', description: 'Sports Tampering', crime_against: 'Society', group_class: 'A', victim_required: 0 },
  { code: '40A', description: 'Prostitution', crime_against: 'Society', group_class: 'A', victim_required: 0 },
  { code: '40B', description: 'Assisting or Promoting Prostitution', crime_against: 'Society', group_class: 'A', victim_required: 0 },
  { code: '40C', description: 'Purchasing Prostitution', crime_against: 'Society', group_class: 'A', victim_required: 0 },
  { code: '520', description: 'Weapon Law Violations', crime_against: 'Society', group_class: 'A', victim_required: 0 },
  { code: '720', description: 'Animal Cruelty', crime_against: 'Society', group_class: 'A', victim_required: 0 },
];

// Group B (10 arrest-only offenses).
const GROUP_B: OffenseSeed[] = [
  { code: '90A', description: 'Bad Checks', crime_against: 'Property', group_class: 'B', victim_required: 0 },
  { code: '90B', description: 'Curfew/Loitering/Vagrancy Violations', crime_against: 'Society', group_class: 'B', victim_required: 0 },
  { code: '90C', description: 'Disorderly Conduct', crime_against: 'Society', group_class: 'B', victim_required: 0 },
  { code: '90D', description: 'Driving Under the Influence', crime_against: 'Society', group_class: 'B', victim_required: 0 },
  { code: '90E', description: 'Drunkenness', crime_against: 'Society', group_class: 'B', victim_required: 0 },
  { code: '90F', description: 'Family Offenses, Nonviolent', crime_against: 'Person', group_class: 'B', victim_required: 0 },
  { code: '90G', description: 'Liquor Law Violations', crime_against: 'Society', group_class: 'B', victim_required: 0 },
  { code: '90H', description: 'Peeping Tom', crime_against: 'Society', group_class: 'B', victim_required: 0 },
  { code: '90J', description: 'Trespass of Real Property', crime_against: 'Society', group_class: 'B', victim_required: 0 },
  { code: '90Z', description: 'All Other Offenses', crime_against: 'Society', group_class: 'B', victim_required: 0 },
];

// Location codes (NIBRS Data Element 9) — abbreviated.
const LOCATIONS: Array<[string, string]> = [
  ['01', 'Air/Bus/Train Terminal'],
  ['02', 'Bank/Savings and Loan'],
  ['03', 'Bar/Nightclub'],
  ['04', 'Church/Synagogue/Temple/Mosque'],
  ['05', 'Commercial/Office Building'],
  ['06', 'Construction Site'],
  ['07', 'Convenience Store'],
  ['08', 'Department/Discount Store'],
  ['09', 'Drug Store/Doctor\'s Office/Hospital'],
  ['10', 'Field/Woods'],
  ['11', 'Government/Public Building'],
  ['12', 'Grocery/Supermarket'],
  ['13', 'Highway/Road/Alley/Street/Sidewalk'],
  ['14', 'Hotel/Motel/Etc.'],
  ['15', 'Jail/Prison/Penitentiary/Corrections Facility'],
  ['16', 'Lake/Waterway/Beach'],
  ['17', 'Liquor Store'],
  ['18', 'Parking Lot/Garage'],
  ['19', 'Rental Storage Facility'],
  ['20', 'Residence/Home'],
  ['21', 'Restaurant'],
  ['22', 'School - College/University'],
  ['23', 'School - Elementary/Secondary'],
  ['24', 'Service/Gas Station'],
  ['25', 'Specialty Store'],
  ['37', 'Abandoned/Condemned Structure'],
  ['38', 'Amusement Park'],
  ['39', 'Arena/Stadium/Fairgrounds/Coliseum'],
  ['40', 'ATM Separate from Bank'],
  ['41', 'Auto Dealership New/Used'],
  ['42', 'Camp/Campground'],
  ['44', 'Daycare Facility'],
  ['45', 'Dock/Wharf/Freight/Modal Terminal'],
  ['46', 'Farm Facility'],
  ['47', 'Gambling Facility/Casino/Race Track'],
  ['48', 'Industrial Site'],
  ['49', 'Military Installation'],
  ['50', 'Park/Playground'],
  ['51', 'Rest Area'],
  ['52', 'School/College'],
  ['53', 'Shelter - Mission/Homeless'],
  ['54', 'Shopping Mall'],
  ['55', 'Tribal Lands'],
  ['56', 'Community Center'],
  ['57', 'Cyberspace'],
  ['58', 'Other/Unknown'],
];

// Weapon/force codes (NIBRS Data Element 13).
const WEAPONS: Array<[string, string]> = [
  ['11', 'Firearm (type not stated)'],
  ['12', 'Handgun'],
  ['13', 'Rifle'],
  ['14', 'Shotgun'],
  ['15', 'Other Firearm'],
  ['16', 'Lethal Cutting Instrument'],
  ['17', 'Knife/Cutting Instrument'],
  ['18', 'Blunt Object'],
  ['19', 'Motor Vehicle/Vessel'],
  ['20', 'Personal Weapons (hands/feet/teeth)'],
  ['21', 'Poison'],
  ['22', 'Explosives'],
  ['23', 'Fire/Incendiary Device'],
  ['24', 'Drugs/Narcotics/Sleeping Pills'],
  ['25', 'Asphyxiation'],
  ['30', 'Other'],
  ['35', 'Threat of Physical Violence'],
  ['40', 'Unarmed/None'],
  ['50', 'Automatic Firearm'],
  ['65', 'Other (Body Armor)'],
  ['85', 'Stun Gun/Taser'],
  ['90', 'Unknown'],
  ['95', 'Club/Blackjack/Brass Knuckles'],
  ['99', 'Pepper Spray'],
];

// Bias motivation codes (NIBRS Data Element 8A).
const BIASES: Array<[string, string]> = [
  ['11', 'Anti-White'],
  ['12', 'Anti-Black or African American'],
  ['13', 'Anti-American Indian or Alaska Native'],
  ['14', 'Anti-Asian'],
  ['15', 'Anti-Multiple Races, Group'],
  ['16', 'Anti-Native Hawaiian or Other Pacific Islander'],
  ['21', 'Anti-Jewish'],
  ['22', 'Anti-Catholic'],
  ['23', 'Anti-Protestant'],
  ['24', 'Anti-Islamic (Muslim)'],
  ['25', 'Anti-Other Religion'],
  ['26', 'Anti-Multiple Religions, Group'],
  ['27', 'Anti-Atheism/Agnosticism'],
  ['28', 'Anti-Mormon'],
  ['29', 'Anti-Jehovah\'s Witness'],
  ['31', 'Anti-Arab'],
  ['32', 'Anti-Hispanic or Latino'],
  ['33', 'Anti-Other Race/Ethnicity/Ancestry'],
  ['41', 'Anti-Gay (Male)'],
  ['42', 'Anti-Lesbian'],
  ['43', 'Anti-Lesbian, Gay, Bisexual, or Transgender (Mixed)'],
  ['44', 'Anti-Heterosexual'],
  ['45', 'Anti-Bisexual'],
  ['51', 'Anti-Physical Disability'],
  ['52', 'Anti-Mental Disability'],
  ['61', 'Anti-Male'],
  ['62', 'Anti-Female'],
  ['71', 'Anti-Transgender'],
  ['72', 'Anti-Gender Non-Conforming'],
  ['81', 'Anti-Sikh'],
  ['82', 'Anti-Hindu'],
  ['83', 'Anti-Buddhist'],
  ['84', 'Anti-Eastern Orthodox'],
  ['85', 'Anti-Other Christian'],
  ['88', 'None (no bias)'],
];

// Property description codes (NIBRS Data Element 15).
const PROPERTIES: Array<[string, string]> = [
  ['01', 'Aircraft'],
  ['02', 'Alcohol'],
  ['03', 'Automobiles'],
  ['04', 'Bicycles'],
  ['05', 'Buses'],
  ['06', 'Clothes/Furs'],
  ['07', 'Computer Hardware/Software'],
  ['08', 'Consumable Goods'],
  ['09', 'Credit/Debit Cards'],
  ['10', 'Drugs/Narcotics'],
  ['11', 'Drug/Narcotic Equipment'],
  ['12', 'Farm Equipment'],
  ['13', 'Firearms'],
  ['14', 'Gambling Equipment'],
  ['15', 'Heavy Construction/Industrial Equipment'],
  ['16', 'Household Goods'],
  ['17', 'Jewelry/Precious Metals'],
  ['18', 'Livestock'],
  ['19', 'Merchandise'],
  ['20', 'Money'],
  ['21', 'Negotiable Instruments'],
  ['22', 'Nonnegotiable Instruments'],
  ['23', 'Office-Type Equipment'],
  ['24', 'Other Motor Vehicles'],
  ['25', 'Purses/Handbags/Wallets'],
  ['26', 'Radios/TVs/VCRs'],
  ['27', 'Recordings - Audio/Visual'],
  ['28', 'Recreational Vehicles'],
  ['29', 'Structures - Single Occupancy Dwellings'],
  ['30', 'Structures - Other Dwellings'],
  ['31', 'Structures - Other Commercial/Business'],
  ['32', 'Structures - Industrial/Manufacturing'],
  ['33', 'Structures - Public/Community'],
  ['34', 'Structures - Storage'],
  ['35', 'Structures - Other'],
  ['36', 'Tools'],
  ['37', 'Trucks'],
  ['38', 'Vehicle Parts/Accessories'],
  ['39', 'Watercraft'],
  ['41', 'Aircraft Parts/Accessories'],
  ['44', 'Camping/Hunting/Fishing Equipment'],
  ['45', 'Chemicals'],
  ['46', 'Collections/Collectibles'],
  ['47', 'Crops'],
  ['48', 'Documents/Personal/Business'],
  ['49', 'Explosives'],
  ['59', 'Pets'],
  ['64', 'Recreational/Sports Equipment'],
  ['77', 'Other'],
  ['88', 'Pending Inventory'],
  ['99', 'Identity - Intangible'],
];

// Loss type codes (NIBRS Data Element 14).
const LOSS_TYPES: Array<[string, string]> = [
  ['1', 'None'],
  ['2', 'Burned'],
  ['3', 'Counterfeited/Forged'],
  ['4', 'Destroyed/Damaged/Vandalized'],
  ['5', 'Recovered'],
  ['6', 'Seized'],
  ['7', 'Stolen/Etc.'],
  ['8', 'Unknown'],
];

export function seedNibrsCodes(db: Database.Database): void {
  // Offenses
  const off = db.prepare('SELECT COUNT(*) as c FROM nibrs_offense_codes').get() as { c: number };
  if (off.c === 0) {
    const ins = db.prepare(`
      INSERT INTO nibrs_offense_codes (code, description, crime_against, group_class, attempted_completed_required, victim_required, property_required, active)
      VALUES (?, ?, ?, ?, ?, ?, ?, 1)
    `);
    const tx = db.transaction((rows: OffenseSeed[]) => {
      for (const r of rows) {
        ins.run(
          r.code, r.description, r.crime_against, r.group_class,
          r.attempted_completed_required ?? 1,
          r.victim_required ?? 1,
          r.property_required ?? 0,
        );
      }
    });
    tx([...OFFENSES, ...GROUP_B]);
    console.log(`[seed] Inserted ${OFFENSES.length + GROUP_B.length} NIBRS offense codes`);
  }

  const seedPairs = (table: string, rows: Array<[string, string]>) => {
    const have = db.prepare(`SELECT COUNT(*) as c FROM ${table}`).get() as { c: number };
    if (have.c > 0) return;
    const ins = db.prepare(`INSERT INTO ${table} (code, description, active) VALUES (?, ?, 1)`);
    const tx = db.transaction(() => {
      for (const [code, desc] of rows) ins.run(code, desc);
    });
    tx();
    console.log(`[seed] Inserted ${rows.length} rows into ${table}`);
  };
  seedPairs('nibrs_location_codes', LOCATIONS);
  seedPairs('nibrs_weapon_codes', WEAPONS);
  seedPairs('nibrs_bias_codes', BIASES);
  seedPairs('nibrs_property_codes', PROPERTIES);
  seedPairs('nibrs_loss_type_codes', LOSS_TYPES);
}

// Run cards: 32 common dispatch defaults. Caller-wins merge semantics.
const RUN_CARDS = [
  { incident_type: 'shots_fired',          label: 'Shots Fired',                   priority: 'P1', flags: ['weapons', 'tactical'], min_units: 2, backup_units: 2, requires_supervisor: 1, caution_text: 'Possible armed suspect. Stage at safe distance.' },
  { incident_type: 'robbery_in_progress',  label: 'Robbery In Progress',           priority: 'P1', flags: ['weapons', 'tactical'], min_units: 2, backup_units: 2, requires_supervisor: 1, caution_text: 'IPR — set perimeter, do not enter.' },
  { incident_type: 'domestic_in_progress', label: 'Domestic In Progress',          priority: 'P1', flags: ['domestic'], min_units: 2, backup_units: 1, requires_supervisor: 0, caution_text: 'Two-officer response required.' },
  { incident_type: 'burglary_in_progress', label: 'Burglary In Progress',          priority: 'P1', flags: ['tactical'], min_units: 2, backup_units: 1, requires_supervisor: 0, caution_text: 'Silent approach, perimeter first.' },
  { incident_type: 'panic_alarm',          label: 'Panic Alarm',                   priority: 'P1', flags: ['weapons'], min_units: 2, backup_units: 1, requires_supervisor: 0, caution_text: 'Treat as in-progress.' },
  { incident_type: 'officer_down',         label: 'Officer Down',                  priority: 'P1', flags: ['emergency'], min_units: 4, backup_units: 4, requires_supervisor: 1, caution_text: 'All units. Code 3.' },
  { incident_type: 'pursuit',              label: 'Vehicle Pursuit',               priority: 'P1', flags: ['tactical'], min_units: 2, backup_units: 2, requires_supervisor: 1, caution_text: 'Supervisor required for continuation.' },
  { incident_type: 'medical_emergency',    label: 'Medical Emergency',             priority: 'P1', flags: ['medical'], min_units: 1, backup_units: 0, requires_supervisor: 0, caution_text: 'Stage for EMS, BSI precautions.' },
  { incident_type: 'fire',                 label: 'Fire',                          priority: 'P1', flags: ['fire'], min_units: 1, backup_units: 0, requires_supervisor: 0, caution_text: 'Stage upwind, do not enter structure.' },
  { incident_type: 'mental_health_crisis', label: 'Mental Health Crisis',          priority: 'P2', flags: ['mental_health'], min_units: 2, backup_units: 0, requires_supervisor: 0, caution_text: 'Slow approach, request CIT if available.' },
  { incident_type: 'suicidal_subject',     label: 'Suicidal Subject',              priority: 'P1', flags: ['mental_health', 'weapons'], min_units: 2, backup_units: 1, requires_supervisor: 1 },
  { incident_type: 'fight_in_progress',    label: 'Fight In Progress',             priority: 'P2', flags: [], min_units: 2, backup_units: 1, requires_supervisor: 0 },
  { incident_type: 'assault',              label: 'Assault Report',                priority: 'P2', flags: [], min_units: 1, backup_units: 0, requires_supervisor: 0 },
  { incident_type: 'theft',                label: 'Theft Report',                  priority: 'P3', flags: [], min_units: 1, backup_units: 0, requires_supervisor: 0 },
  { incident_type: 'vandalism',            label: 'Vandalism Report',              priority: 'P3', flags: [], min_units: 1, backup_units: 0, requires_supervisor: 0 },
  { incident_type: 'trespass',             label: 'Trespass',                      priority: 'P3', flags: [], min_units: 1, backup_units: 0, requires_supervisor: 0 },
  { incident_type: 'alarm_response',       label: 'Burglar Alarm',                 priority: 'P3', flags: [], min_units: 1, backup_units: 0, requires_supervisor: 0, caution_text: 'Check perimeter before contacting keyholder.' },
  { incident_type: 'suspicious_activity',  label: 'Suspicious Activity',           priority: 'P3', flags: [], min_units: 1, backup_units: 0, requires_supervisor: 0 },
  { incident_type: 'suspicious_person',    label: 'Suspicious Person',             priority: 'P3', flags: [], min_units: 1, backup_units: 0, requires_supervisor: 0 },
  { incident_type: 'suspicious_vehicle',   label: 'Suspicious Vehicle',            priority: 'P3', flags: [], min_units: 1, backup_units: 0, requires_supervisor: 0 },
  { incident_type: 'noise_complaint',      label: 'Noise Complaint',               priority: 'P3', flags: [], min_units: 1, backup_units: 0, requires_supervisor: 0 },
  { incident_type: 'welfare_check',        label: 'Welfare Check',                 priority: 'P2', flags: [], min_units: 1, backup_units: 0, requires_supervisor: 0 },
  { incident_type: 'parking_violation',    label: 'Parking Violation',             priority: 'P4', flags: [], min_units: 1, backup_units: 0, requires_supervisor: 0 },
  { incident_type: 'traffic_accident',     label: 'Traffic Accident',              priority: 'P2', flags: [], min_units: 1, backup_units: 0, requires_supervisor: 0 },
  { incident_type: 'traffic_stop',         label: 'Traffic Stop',                  priority: 'P3', flags: [], min_units: 1, backup_units: 0, requires_supervisor: 0 },
  { incident_type: 'lockout_assist',       label: 'Lockout Assist',                priority: 'P4', flags: [], min_units: 1, backup_units: 0, requires_supervisor: 0 },
  { incident_type: 'patrol_check',         label: 'Patrol Check',                  priority: 'P4', flags: [], min_units: 1, backup_units: 0, requires_supervisor: 0 },
  { incident_type: 'escort',               label: 'Escort',                        priority: 'P3', flags: [], min_units: 1, backup_units: 0, requires_supervisor: 0 },
  { incident_type: 'civil_standby',        label: 'Civil Standby',                 priority: 'P3', flags: [], min_units: 1, backup_units: 0, requires_supervisor: 0 },
  { incident_type: 'bolo',                 label: 'BOLO',                          priority: 'P3', flags: [], min_units: 1, backup_units: 0, requires_supervisor: 0 },
  { incident_type: 'serve_process',        label: 'Serve Process',                 priority: 'P3', flags: [], min_units: 1, backup_units: 0, requires_supervisor: 0 },
  { incident_type: 'other',                label: 'Other',                         priority: 'P3', flags: [], min_units: 1, backup_units: 0, requires_supervisor: 0 },
];

export function seedRunCards(db: Database.Database): void {
  const have = db.prepare('SELECT COUNT(*) as c FROM dispatch_run_cards').get() as { c: number };
  if (have.c > 0) return;
  const ins = db.prepare(`
    INSERT INTO dispatch_run_cards (incident_type, label, priority, flags, min_units, backup_units, requires_supervisor, caution_text)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const tx = db.transaction(() => {
    for (const c of RUN_CARDS) {
      ins.run(
        c.incident_type, c.label, c.priority, JSON.stringify(c.flags),
        c.min_units, c.backup_units, c.requires_supervisor, c.caution_text ?? null,
      );
    }
  });
  tx();
  console.log(`[seed] Inserted ${RUN_CARDS.length} dispatch run cards`);
}
