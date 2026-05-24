// ============================================================
// RMPG Flex — NIBRS 2019 Code Tables (FBI)
// Source: FBI NIBRS Technical Specification, Sept 2019
// Group A = 52 detailed offenses across 23 categories
// Group B = 10 arrest-only offenses (no incident report)
// Location, weapon, bias, property-description code lists
//
// `required_fields` documents which segments/fields the FBI spec
// requires per offense. Consumed by NB-2 (validator). Keys map to
// incident_offenses + incident_persons + property fields, NOT to
// the underlying NIBRS XML element names — translation lives in
// nibrsFlatFile.ts.
// ============================================================

export interface NibrsOffenseSeed {
  code: string;             // e.g. '09A'
  description: string;      // FBI offense name
  group: 'A' | 'B';
  category: string;         // FBI crime category
  attempted_completed_required: boolean;
  victim_required: boolean;
  weapon_required: boolean;
  bias_required: boolean;
  property_required: boolean;
  drug_required: boolean;
  notes?: string;
}

// ── Group A offenses (52) ────────────────────────────────────
export const NIBRS_GROUP_A: NibrsOffenseSeed[] = [
  // Category: Crimes Against Persons
  { code: '09A', description: 'Murder and Nonnegligent Manslaughter',           group: 'A', category: 'Homicide Offenses',                  attempted_completed_required: true,  victim_required: true,  weapon_required: true,  bias_required: true,  property_required: false, drug_required: false },
  { code: '09B', description: 'Negligent Manslaughter',                          group: 'A', category: 'Homicide Offenses',                  attempted_completed_required: true,  victim_required: true,  weapon_required: true,  bias_required: true,  property_required: false, drug_required: false },
  { code: '09C', description: 'Justifiable Homicide',                            group: 'A', category: 'Homicide Offenses',                  attempted_completed_required: true,  victim_required: true,  weapon_required: true,  bias_required: false, property_required: false, drug_required: false },
  { code: '64A', description: 'Human Trafficking - Commercial Sex Acts',         group: 'A', category: 'Human Trafficking',                  attempted_completed_required: true,  victim_required: true,  weapon_required: false, bias_required: true,  property_required: false, drug_required: false },
  { code: '64B', description: 'Human Trafficking - Involuntary Servitude',       group: 'A', category: 'Human Trafficking',                  attempted_completed_required: true,  victim_required: true,  weapon_required: false, bias_required: true,  property_required: false, drug_required: false },
  { code: '100', description: 'Kidnapping/Abduction',                            group: 'A', category: 'Kidnapping/Abduction',               attempted_completed_required: true,  victim_required: true,  weapon_required: true,  bias_required: true,  property_required: false, drug_required: false },
  { code: '11A', description: 'Rape',                                            group: 'A', category: 'Sex Offenses',                       attempted_completed_required: true,  victim_required: true,  weapon_required: true,  bias_required: true,  property_required: false, drug_required: false },
  { code: '11B', description: 'Sodomy',                                          group: 'A', category: 'Sex Offenses',                       attempted_completed_required: true,  victim_required: true,  weapon_required: true,  bias_required: true,  property_required: false, drug_required: false },
  { code: '11C', description: 'Sexual Assault With An Object',                   group: 'A', category: 'Sex Offenses',                       attempted_completed_required: true,  victim_required: true,  weapon_required: true,  bias_required: true,  property_required: false, drug_required: false },
  { code: '11D', description: 'Fondling',                                        group: 'A', category: 'Sex Offenses',                       attempted_completed_required: true,  victim_required: true,  weapon_required: true,  bias_required: true,  property_required: false, drug_required: false },
  { code: '36A', description: 'Incest',                                          group: 'A', category: 'Sex Offenses',                       attempted_completed_required: true,  victim_required: true,  weapon_required: false, bias_required: true,  property_required: false, drug_required: false },
  { code: '36B', description: 'Statutory Rape',                                  group: 'A', category: 'Sex Offenses',                       attempted_completed_required: true,  victim_required: true,  weapon_required: false, bias_required: true,  property_required: false, drug_required: false },
  { code: '13A', description: 'Aggravated Assault',                              group: 'A', category: 'Assault Offenses',                   attempted_completed_required: true,  victim_required: true,  weapon_required: true,  bias_required: true,  property_required: false, drug_required: false },
  { code: '13B', description: 'Simple Assault',                                  group: 'A', category: 'Assault Offenses',                   attempted_completed_required: true,  victim_required: true,  weapon_required: true,  bias_required: true,  property_required: false, drug_required: false },
  { code: '13C', description: 'Intimidation',                                    group: 'A', category: 'Assault Offenses',                   attempted_completed_required: true,  victim_required: true,  weapon_required: false, bias_required: true,  property_required: false, drug_required: false },

  // Category: Crimes Against Property
  { code: '200', description: 'Arson',                                           group: 'A', category: 'Arson',                              attempted_completed_required: true,  victim_required: false, weapon_required: false, bias_required: true,  property_required: true,  drug_required: false },
  { code: '210', description: 'Extortion/Blackmail',                             group: 'A', category: 'Extortion/Blackmail',                attempted_completed_required: true,  victim_required: true,  weapon_required: false, bias_required: true,  property_required: true,  drug_required: false },
  { code: '220', description: 'Burglary/Breaking & Entering',                    group: 'A', category: 'Burglary/B&E',                       attempted_completed_required: true,  victim_required: false, weapon_required: false, bias_required: true,  property_required: true,  drug_required: false },
  { code: '23A', description: 'Pocket-picking',                                  group: 'A', category: 'Larceny/Theft Offenses',             attempted_completed_required: true,  victim_required: false, weapon_required: false, bias_required: true,  property_required: true,  drug_required: false },
  { code: '23B', description: 'Purse-snatching',                                 group: 'A', category: 'Larceny/Theft Offenses',             attempted_completed_required: true,  victim_required: false, weapon_required: false, bias_required: true,  property_required: true,  drug_required: false },
  { code: '23C', description: 'Shoplifting',                                     group: 'A', category: 'Larceny/Theft Offenses',             attempted_completed_required: true,  victim_required: false, weapon_required: false, bias_required: true,  property_required: true,  drug_required: false },
  { code: '23D', description: 'Theft From Building',                             group: 'A', category: 'Larceny/Theft Offenses',             attempted_completed_required: true,  victim_required: false, weapon_required: false, bias_required: true,  property_required: true,  drug_required: false },
  { code: '23E', description: 'Theft From Coin-Operated Machine or Device',     group: 'A', category: 'Larceny/Theft Offenses',             attempted_completed_required: true,  victim_required: false, weapon_required: false, bias_required: true,  property_required: true,  drug_required: false },
  { code: '23F', description: 'Theft From Motor Vehicle',                        group: 'A', category: 'Larceny/Theft Offenses',             attempted_completed_required: true,  victim_required: false, weapon_required: false, bias_required: true,  property_required: true,  drug_required: false },
  { code: '23G', description: 'Theft of Motor Vehicle Parts or Accessories',     group: 'A', category: 'Larceny/Theft Offenses',             attempted_completed_required: true,  victim_required: false, weapon_required: false, bias_required: true,  property_required: true,  drug_required: false },
  { code: '23H', description: 'All Other Larceny',                               group: 'A', category: 'Larceny/Theft Offenses',             attempted_completed_required: true,  victim_required: false, weapon_required: false, bias_required: true,  property_required: true,  drug_required: false },
  { code: '240', description: 'Motor Vehicle Theft',                             group: 'A', category: 'Motor Vehicle Theft',                attempted_completed_required: true,  victim_required: false, weapon_required: false, bias_required: true,  property_required: true,  drug_required: false },
  { code: '250', description: 'Counterfeiting/Forgery',                          group: 'A', category: 'Counterfeiting/Forgery',             attempted_completed_required: true,  victim_required: false, weapon_required: false, bias_required: true,  property_required: true,  drug_required: false },
  { code: '26A', description: 'False Pretenses/Swindle/Confidence Game',         group: 'A', category: 'Fraud Offenses',                     attempted_completed_required: true,  victim_required: false, weapon_required: false, bias_required: true,  property_required: true,  drug_required: false },
  { code: '26B', description: 'Credit Card/Automated Teller Machine Fraud',     group: 'A', category: 'Fraud Offenses',                     attempted_completed_required: true,  victim_required: false, weapon_required: false, bias_required: true,  property_required: true,  drug_required: false },
  { code: '26C', description: 'Impersonation',                                   group: 'A', category: 'Fraud Offenses',                     attempted_completed_required: true,  victim_required: false, weapon_required: false, bias_required: true,  property_required: true,  drug_required: false },
  { code: '26D', description: 'Welfare Fraud',                                   group: 'A', category: 'Fraud Offenses',                     attempted_completed_required: true,  victim_required: false, weapon_required: false, bias_required: true,  property_required: true,  drug_required: false },
  { code: '26E', description: 'Wire Fraud',                                      group: 'A', category: 'Fraud Offenses',                     attempted_completed_required: true,  victim_required: false, weapon_required: false, bias_required: true,  property_required: true,  drug_required: false },
  { code: '26F', description: 'Identity Theft',                                  group: 'A', category: 'Fraud Offenses',                     attempted_completed_required: true,  victim_required: false, weapon_required: false, bias_required: true,  property_required: true,  drug_required: false },
  { code: '26G', description: 'Hacking/Computer Invasion',                       group: 'A', category: 'Fraud Offenses',                     attempted_completed_required: true,  victim_required: false, weapon_required: false, bias_required: true,  property_required: true,  drug_required: false },
  { code: '270', description: 'Embezzlement',                                    group: 'A', category: 'Embezzlement',                       attempted_completed_required: true,  victim_required: false, weapon_required: false, bias_required: true,  property_required: true,  drug_required: false },
  { code: '280', description: 'Stolen Property Offenses',                        group: 'A', category: 'Stolen Property Offenses',           attempted_completed_required: true,  victim_required: false, weapon_required: false, bias_required: true,  property_required: true,  drug_required: false },
  { code: '290', description: 'Destruction/Damage/Vandalism of Property',        group: 'A', category: 'Destruction/Vandalism',              attempted_completed_required: true,  victim_required: false, weapon_required: false, bias_required: true,  property_required: true,  drug_required: false },
  { code: '510', description: 'Bribery',                                         group: 'A', category: 'Bribery',                            attempted_completed_required: true,  victim_required: false, weapon_required: false, bias_required: true,  property_required: true,  drug_required: false },
  { code: '120', description: 'Robbery',                                         group: 'A', category: 'Robbery',                            attempted_completed_required: true,  victim_required: true,  weapon_required: true,  bias_required: true,  property_required: true,  drug_required: false },

  // Category: Crimes Against Society
  { code: '35A', description: 'Drug/Narcotic Violations',                        group: 'A', category: 'Drug/Narcotic Offenses',             attempted_completed_required: true,  victim_required: false, weapon_required: false, bias_required: false, property_required: false, drug_required: true  },
  { code: '35B', description: 'Drug Equipment Violations',                       group: 'A', category: 'Drug/Narcotic Offenses',             attempted_completed_required: true,  victim_required: false, weapon_required: false, bias_required: false, property_required: true,  drug_required: false },
  { code: '39A', description: 'Betting/Wagering',                                group: 'A', category: 'Gambling Offenses',                  attempted_completed_required: true,  victim_required: false, weapon_required: false, bias_required: false, property_required: true,  drug_required: false },
  { code: '39B', description: 'Operating/Promoting/Assisting Gambling',          group: 'A', category: 'Gambling Offenses',                  attempted_completed_required: true,  victim_required: false, weapon_required: false, bias_required: false, property_required: true,  drug_required: false },
  { code: '39C', description: 'Gambling Equipment Violations',                   group: 'A', category: 'Gambling Offenses',                  attempted_completed_required: true,  victim_required: false, weapon_required: false, bias_required: false, property_required: true,  drug_required: false },
  { code: '39D', description: 'Sports Tampering',                                group: 'A', category: 'Gambling Offenses',                  attempted_completed_required: true,  victim_required: false, weapon_required: false, bias_required: false, property_required: false, drug_required: false },
  { code: '370', description: 'Pornography/Obscene Material',                    group: 'A', category: 'Pornography/Obscene Material',       attempted_completed_required: true,  victim_required: false, weapon_required: false, bias_required: true,  property_required: false, drug_required: false },
  { code: '40A', description: 'Prostitution',                                    group: 'A', category: 'Prostitution Offenses',              attempted_completed_required: true,  victim_required: false, weapon_required: false, bias_required: false, property_required: false, drug_required: false },
  { code: '40B', description: 'Assisting or Promoting Prostitution',             group: 'A', category: 'Prostitution Offenses',              attempted_completed_required: true,  victim_required: false, weapon_required: false, bias_required: false, property_required: false, drug_required: false },
  { code: '40C', description: 'Purchasing Prostitution',                         group: 'A', category: 'Prostitution Offenses',              attempted_completed_required: true,  victim_required: false, weapon_required: false, bias_required: false, property_required: false, drug_required: false },
  { code: '520', description: 'Weapon Law Violations',                           group: 'A', category: 'Weapon Law Violations',              attempted_completed_required: true,  victim_required: false, weapon_required: true,  bias_required: true,  property_required: false, drug_required: false },
  { code: '720', description: 'Animal Cruelty',                                  group: 'A', category: 'Animal Cruelty',                     attempted_completed_required: true,  victim_required: false, weapon_required: false, bias_required: true,  property_required: false, drug_required: false },
];

// ── Group B offenses (10) — arrest-only ──────────────────────
export const NIBRS_GROUP_B: NibrsOffenseSeed[] = [
  { code: '90A', description: 'Bad Checks',                                      group: 'B', category: 'Group B',                            attempted_completed_required: false, victim_required: false, weapon_required: false, bias_required: false, property_required: false, drug_required: false },
  { code: '90B', description: 'Curfew/Loitering/Vagrancy Violations',            group: 'B', category: 'Group B',                            attempted_completed_required: false, victim_required: false, weapon_required: false, bias_required: false, property_required: false, drug_required: false },
  { code: '90C', description: 'Disorderly Conduct',                              group: 'B', category: 'Group B',                            attempted_completed_required: false, victim_required: false, weapon_required: false, bias_required: false, property_required: false, drug_required: false },
  { code: '90D', description: 'Driving Under the Influence',                     group: 'B', category: 'Group B',                            attempted_completed_required: false, victim_required: false, weapon_required: false, bias_required: false, property_required: false, drug_required: false },
  { code: '90E', description: 'Drunkenness',                                     group: 'B', category: 'Group B',                            attempted_completed_required: false, victim_required: false, weapon_required: false, bias_required: false, property_required: false, drug_required: false },
  { code: '90F', description: 'Family Offenses, Nonviolent',                     group: 'B', category: 'Group B',                            attempted_completed_required: false, victim_required: false, weapon_required: false, bias_required: false, property_required: false, drug_required: false },
  { code: '90G', description: 'Liquor Law Violations',                           group: 'B', category: 'Group B',                            attempted_completed_required: false, victim_required: false, weapon_required: false, bias_required: false, property_required: false, drug_required: false },
  { code: '90H', description: 'Peeping Tom',                                     group: 'B', category: 'Group B',                            attempted_completed_required: false, victim_required: false, weapon_required: false, bias_required: false, property_required: false, drug_required: false },
  { code: '90J', description: 'Trespass of Real Property',                       group: 'B', category: 'Group B',                            attempted_completed_required: false, victim_required: false, weapon_required: false, bias_required: false, property_required: false, drug_required: false },
  { code: '90Z', description: 'All Other Offenses',                              group: 'B', category: 'Group B',                            attempted_completed_required: false, victim_required: false, weapon_required: false, bias_required: false, property_required: false, drug_required: false },
];

export const NIBRS_OFFENSES: NibrsOffenseSeed[] = [...NIBRS_GROUP_A, ...NIBRS_GROUP_B];

// ── Location codes (FBI NIBRS, 01-58) ────────────────────────
export const NIBRS_LOCATION_CODES: { code: string; description: string }[] = [
  { code: '01', description: 'Air/Bus/Train Terminal' },
  { code: '02', description: 'Bank/Savings & Loan' },
  { code: '03', description: 'Bar/Nightclub' },
  { code: '04', description: 'Church/Synagogue/Temple/Mosque' },
  { code: '05', description: 'Commercial/Office Building' },
  { code: '06', description: 'Construction Site' },
  { code: '07', description: 'Convenience Store' },
  { code: '08', description: 'Department/Discount Store' },
  { code: '09', description: 'Drug Store/Doctor\'s Office/Hospital' },
  { code: '10', description: 'Field/Woods' },
  { code: '11', description: 'Government/Public Building' },
  { code: '12', description: 'Grocery/Supermarket' },
  { code: '13', description: 'Highway/Road/Alley/Street/Sidewalk' },
  { code: '14', description: 'Hotel/Motel/Etc.' },
  { code: '15', description: 'Jail/Prison/Penitentiary/Corrections Facility' },
  { code: '16', description: 'Lake/Waterway/Beach' },
  { code: '17', description: 'Liquor Store' },
  { code: '18', description: 'Parking/Drop Lot/Garage' },
  { code: '19', description: 'Rental Storage Facility' },
  { code: '20', description: 'Residence/Home' },
  { code: '21', description: 'Restaurant' },
  { code: '22', description: 'School - College/University' },
  { code: '23', description: 'Service/Gas Station' },
  { code: '24', description: 'Specialty Store' },
  { code: '25', description: 'Other/Unknown' },
  { code: '37', description: 'Abandoned/Condemned Structure' },
  { code: '38', description: 'Amusement Park' },
  { code: '39', description: 'Arena/Stadium/Fairgrounds/Coliseum' },
  { code: '40', description: 'ATM Separate from Bank' },
  { code: '41', description: 'Auto Dealership New/Used' },
  { code: '42', description: 'Camp/Campground' },
  { code: '44', description: 'Daycare Facility' },
  { code: '45', description: 'Dock/Wharf/Freight/Modal Terminal' },
  { code: '46', description: 'Farm Facility' },
  { code: '47', description: 'Gambling Facility/Casino/Race Track' },
  { code: '48', description: 'Industrial Site' },
  { code: '49', description: 'Military Installation' },
  { code: '50', description: 'Park/Playground' },
  { code: '51', description: 'Rest Area' },
  { code: '52', description: 'School - Elementary/Secondary' },
  { code: '53', description: 'Shelter - Mission/Homeless' },
  { code: '54', description: 'Shopping Mall' },
  { code: '55', description: 'Tribal Lands' },
  { code: '56', description: 'Community Center' },
  { code: '57', description: 'Cyberspace' },
  { code: '58', description: 'Auto Repair Shop' },
];

// ── Weapon/Force codes ───────────────────────────────────────
export const NIBRS_WEAPON_CODES: { code: string; description: string }[] = [
  { code: '11', description: 'Firearm (Type Not Stated)' },
  { code: '12', description: 'Handgun' },
  { code: '13', description: 'Rifle' },
  { code: '14', description: 'Shotgun' },
  { code: '15', description: 'Other Firearm' },
  { code: '16', description: 'Lethal Cutting Instrument' },
  { code: '17', description: 'Knife/Cutting Instrument' },
  { code: '20', description: 'Blunt Object' },
  { code: '30', description: 'Motor Vehicle' },
  { code: '35', description: 'Personal Weapons (Hands, Feet, Teeth)' },
  { code: '40', description: 'Poison' },
  { code: '50', description: 'Explosives' },
  { code: '60', description: 'Fire/Incendiary Device' },
  { code: '65', description: 'Drugs/Narcotics/Sleeping Pills' },
  { code: '70', description: 'Asphyxiation' },
  { code: '85', description: 'Other (Bodily Force)' },
  { code: '90', description: 'Other' },
  { code: '95', description: 'Unknown' },
  { code: '99', description: 'None' },
];

// ── Bias motivation codes ────────────────────────────────────
export const NIBRS_BIAS_CODES: { code: string; description: string }[] = [
  { code: '11', description: 'Anti-White' },
  { code: '12', description: 'Anti-Black or African American' },
  { code: '13', description: 'Anti-American Indian or Alaska Native' },
  { code: '14', description: 'Anti-Asian' },
  { code: '15', description: 'Anti-Multi-Racial Group' },
  { code: '16', description: 'Anti-Native Hawaiian or Other Pacific Islander' },
  { code: '21', description: 'Anti-Jewish' },
  { code: '22', description: 'Anti-Catholic' },
  { code: '23', description: 'Anti-Protestant' },
  { code: '24', description: 'Anti-Islamic (Muslim)' },
  { code: '25', description: 'Anti-Other Religion' },
  { code: '26', description: 'Anti-Multi-Religious Group' },
  { code: '27', description: 'Anti-Atheism/Agnosticism' },
  { code: '28', description: 'Anti-Mormon' },
  { code: '29', description: 'Anti-Jehovah\'s Witness' },
  { code: '31', description: 'Anti-Hispanic or Latino' },
  { code: '32', description: 'Anti-Other Race/Ethnicity/Ancestry' },
  { code: '33', description: 'Anti-Arab' },
  { code: '41', description: 'Anti-Gay (Male)' },
  { code: '42', description: 'Anti-Lesbian (Female)' },
  { code: '43', description: 'Anti-Lesbian, Gay, Bisexual, or Transgender (Mixed Group)' },
  { code: '44', description: 'Anti-Heterosexual' },
  { code: '45', description: 'Anti-Bisexual' },
  { code: '51', description: 'Anti-Physical Disability' },
  { code: '52', description: 'Anti-Mental Disability' },
  { code: '61', description: 'Anti-Male' },
  { code: '62', description: 'Anti-Female' },
  { code: '71', description: 'Anti-Transgender' },
  { code: '72', description: 'Anti-Gender Non-Conforming' },
  { code: '81', description: 'Anti-Sikh' },
  { code: '82', description: 'Anti-Eastern Orthodox (Russian, Greek, Other)' },
  { code: '83', description: 'Anti-Other Christian' },
  { code: '84', description: 'Anti-Buddhist' },
  { code: '85', description: 'Anti-Hindu' },
  { code: '88', description: 'None (No Bias)' },
];

// ── Property descriptions (subset of 78 — most-used) ─────────
export const NIBRS_PROPERTY_DESCRIPTIONS: { code: string; description: string }[] = [
  { code: '01', description: 'Aircraft' },
  { code: '02', description: 'Alcohol' },
  { code: '03', description: 'Automobile' },
  { code: '04', description: 'Bicycle' },
  { code: '05', description: 'Buses' },
  { code: '06', description: 'Clothes/Furs' },
  { code: '07', description: 'Computer Hardware/Software' },
  { code: '08', description: 'Consumable Goods' },
  { code: '09', description: 'Credit/Debit Cards' },
  { code: '10', description: 'Drugs/Narcotics' },
  { code: '11', description: 'Drug/Narcotic Equipment' },
  { code: '12', description: 'Farm Equipment' },
  { code: '13', description: 'Firearms' },
  { code: '14', description: 'Gambling Equipment' },
  { code: '15', description: 'Heavy Construction/Industrial Equipment' },
  { code: '16', description: 'Household Goods' },
  { code: '17', description: 'Jewelry/Precious Metals' },
  { code: '18', description: 'Livestock' },
  { code: '19', description: 'Merchandise' },
  { code: '20', description: 'Money' },
  { code: '21', description: 'Musical Instruments' },
  { code: '22', description: 'Negotiable Instruments' },
  { code: '23', description: 'Nonnegotiable Instruments' },
  { code: '24', description: 'Office-Type Equipment' },
  { code: '25', description: 'Other Motor Vehicles' },
  { code: '26', description: 'Purses/Handbags/Wallets' },
  { code: '27', description: 'Radios/TVs/VCRs' },
  { code: '28', description: 'Recordings - Audio/Visual' },
  { code: '29', description: 'Recreational Vehicles' },
  { code: '30', description: 'Structures - Single Occupancy Dwellings' },
  { code: '31', description: 'Structures - Other Dwellings' },
  { code: '32', description: 'Structures - Other Commercial/Business' },
  { code: '33', description: 'Structures - Industrial/Manufacturing' },
  { code: '34', description: 'Structures - Public/Community' },
  { code: '35', description: 'Structures - Storage' },
  { code: '36', description: 'Structures - Other' },
  { code: '37', description: 'Tools' },
  { code: '38', description: 'Trucks' },
  { code: '39', description: 'Vehicle Parts/Accessories' },
  { code: '40', description: 'Watercraft' },
  { code: '41', description: 'Weapons - Other' },
  { code: '64', description: 'Identity Documents' },
  { code: '65', description: 'Identity - Intangible' },
  { code: '66', description: 'Metals, Non-Precious' },
  { code: '67', description: 'Trailers' },
  { code: '77', description: 'Other' },
  { code: '78', description: 'Pending Inventory (Non-Preliminary)' },
  { code: '88', description: 'Pending Inventory (Preliminary)' },
  { code: '99', description: 'Special Category' },
];

// ── Property loss types ──────────────────────────────────────
export const NIBRS_PROPERTY_LOSS_TYPES: { code: string; description: string }[] = [
  { code: '1', description: 'None' },
  { code: '2', description: 'Burned' },
  { code: '3', description: 'Counterfeited/Forged' },
  { code: '4', description: 'Destroyed/Damaged/Vandalized' },
  { code: '5', description: 'Recovered' },
  { code: '6', description: 'Seized' },
  { code: '7', description: 'Stolen/Etc.' },
  { code: '8', description: 'Unknown' },
];

/**
 * Seed all NIBRS code tables. Called once from database.ts migrate()
 * after the tables are created. Idempotent — uses INSERT OR IGNORE.
 */
export function seedNibrsCodes(db: { prepare: (sql: string) => { run: (...args: any[]) => any; get: (...args: any[]) => any } }) {
  const c = db.prepare('SELECT COUNT(*) AS n FROM nibrs_offense_codes').get() as any;
  if (c?.n > 0) return; // already seeded

  const insOff = db.prepare(`
    INSERT OR IGNORE INTO nibrs_offense_codes
      (code, description, ucr_group, category,
       attempted_completed_required, victim_required, weapon_required,
       bias_required, property_required, drug_required, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (const o of NIBRS_OFFENSES) {
    insOff.run(
      o.code, o.description, o.group, o.category,
      o.attempted_completed_required ? 1 : 0,
      o.victim_required ? 1 : 0,
      o.weapon_required ? 1 : 0,
      o.bias_required ? 1 : 0,
      o.property_required ? 1 : 0,
      o.drug_required ? 1 : 0,
      o.notes || null,
    );
  }

  const insLoc = db.prepare('INSERT OR IGNORE INTO nibrs_location_codes (code, description) VALUES (?, ?)');
  for (const r of NIBRS_LOCATION_CODES) insLoc.run(r.code, r.description);

  const insWp = db.prepare('INSERT OR IGNORE INTO nibrs_weapon_codes (code, description) VALUES (?, ?)');
  for (const r of NIBRS_WEAPON_CODES) insWp.run(r.code, r.description);

  const insBias = db.prepare('INSERT OR IGNORE INTO nibrs_bias_codes (code, description) VALUES (?, ?)');
  for (const r of NIBRS_BIAS_CODES) insBias.run(r.code, r.description);

  const insProp = db.prepare('INSERT OR IGNORE INTO nibrs_property_descriptions (code, description) VALUES (?, ?)');
  for (const r of NIBRS_PROPERTY_DESCRIPTIONS) insProp.run(r.code, r.description);

  const insLoss = db.prepare('INSERT OR IGNORE INTO nibrs_property_loss_types (code, description) VALUES (?, ?)');
  for (const r of NIBRS_PROPERTY_LOSS_TYPES) insLoss.run(r.code, r.description);

  console.log(`[migrate] Seeded NIBRS codes: ${NIBRS_OFFENSES.length} offenses, ${NIBRS_LOCATION_CODES.length} locations, ${NIBRS_WEAPON_CODES.length} weapons, ${NIBRS_BIAS_CODES.length} biases, ${NIBRS_PROPERTY_DESCRIPTIONS.length} property descs, ${NIBRS_PROPERTY_LOSS_TYPES.length} loss types`);
}
