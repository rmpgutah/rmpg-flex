// ============================================================
// RMPG Flex — Shared Law-Enforcement Enumerations
//
// Single source of truth for dropdown option lists used across
// every Edit*Modal. Previously each modal carried its own inline
// `const X_OPTIONS = [...]` arrays — divergence between modals
// (e.g. Person showing one set of races, Witness another) was a
// real risk. Importing from here keeps them aligned.
//
// Each export is a tuple-typed `readonly string[]` so callers
// get TS autocomplete on the option strings without losing the
// dynamic .map() rendering pattern.
//
// ── Code-system note ──
// Where applicable, options follow NCIC / NIBRS naming
// conventions (the RMPG Flex deploy targets Utah AGRC + state
// reporting). Pure-internal fields (gang affiliations, dietary
// restrictions for jail intake) deviate from federal codes
// where the operational reality differs.
// ============================================================

// ── Person — Demographics ─────────────────────────────────

export const GENDER_OPTIONS = [
  'Male', 'Female', 'Non-Binary', 'Transgender Male', 'Transgender Female',
  'Unknown', 'Other',
] as const;

export const RACE_OPTIONS = [
  'White', 'Black', 'Hispanic', 'Asian', 'Native American',
  'Pacific Islander', 'Middle Eastern', 'Mixed',
  'Native Hawaiian', 'Alaska Native', 'South Asian', 'Southeast Asian',
  'East Asian', 'African', 'Caribbean', 'Unknown', 'Other',
] as const;

export const MARITAL_OPTIONS = [
  'Single', 'Married', 'Divorced', 'Widowed', 'Separated',
  'Domestic Partnership',
] as const;

export const CITIZENSHIP_OPTIONS = [
  'U.S. Citizen', 'Permanent Resident', 'Visa Holder', 'Refugee',
  'Asylum Seeker', 'Undocumented', 'Foreign National',
  'Dual Citizenship', 'Unknown', 'Other',
] as const;

export const IMMIGRATION_OPTIONS = [
  'U.S. Citizen', 'Permanent Resident',
  'Visa Holder (Work)', 'Visa Holder (Student)', 'Visa Holder (Tourist)',
  'Refugee', 'Asylum Seeker', 'DACA', 'TPS',
  'Undocumented', 'Unknown',
] as const;

// Curated languages list — the long tail covers the most common
// non-English languages encountered in Utah jurisdictions plus
// Navajo (large speaker community in southeast UT) and ASL.
export const LANGUAGE_OPTIONS = [
  'English', 'Spanish', 'Portuguese', 'French',
  'Mandarin', 'Cantonese', 'Vietnamese', 'Korean', 'Japanese',
  'Arabic', 'Russian', 'German', 'Tagalog', 'Hindi', 'Urdu', 'Farsi',
  'Somali', 'Swahili',
  'Navajo', 'American Sign Language',
  'Other',
] as const;

// Religion list intended for jail-intake context (custodial diet,
// chaplaincy, holiday observance) — NOT for proselytizing or
// discriminatory tagging. Intentionally inclusive of "None" /
// "Decline to State" to respect operator-side dignity defaults.
export const RELIGION_OPTIONS = [
  'None', 'Decline to State',
  'Christian — Catholic', 'Christian — Protestant',
  'Christian — Orthodox', 'Christian — LDS / Mormon',
  'Jewish', 'Muslim', 'Hindu', 'Buddhist', 'Sikh',
  'Native American Spiritual', 'Pagan / Wiccan',
  'Atheist / Agnostic', 'Other',
] as const;

// Dietary restrictions for jail intake — combines religious,
// medical, and personal choice. Multi-select friendly.
export const DIETARY_RESTRICTION_OPTIONS = [
  'None',
  'Kosher', 'Halal', 'Vegetarian', 'Vegan',
  'Gluten-Free', 'Lactose-Free', 'Diabetic',
  'Low-Sodium', 'Low-Cholesterol', 'No Pork',
  'Allergy — Nuts', 'Allergy — Shellfish', 'Allergy — Eggs',
  'Allergy — Dairy', 'Allergy — Soy', 'Allergy — Other',
  'Other',
] as const;

export const BLOOD_TYPE_OPTIONS = [
  'A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-',
] as const;

// ── Person — Physical descriptors (NCIC-aligned where possible) ─

export const BUILD_OPTIONS = [
  'Slim', 'Medium', 'Athletic', 'Heavy', 'Stocky', 'Large',
  'Thin', 'Muscular', 'Obese', 'Petite', 'Tall/Lanky', 'Average', 'Proportionate',
] as const;

export const COMPLEXION_OPTIONS = [
  'Light', 'Medium', 'Dark', 'Fair', 'Olive', 'Ruddy', 'Sallow',
  'Pale', 'Tan', 'Freckled', 'Weathered', 'Acne-Scarred', 'Pockmarked', 'Blotchy',
] as const;

export const HAIR_COLOR_OPTIONS = [
  'Black', 'Brown', 'Blonde', 'Red', 'Auburn',
  'Gray', 'White', 'Bald',
  'Strawberry Blonde', 'Salt and Pepper', 'Dirty Blonde',
  'Light Brown', 'Dark Brown',
  'Blue (Dyed)', 'Green (Dyed)', 'Pink (Dyed)', 'Purple (Dyed)',
  'Multi-Color (Dyed)', 'Partially Gray',
  'Other',
] as const;

export const HAIR_LENGTH_OPTIONS = [
  'Short', 'Medium', 'Long', 'Shaved',
  'Buzz Cut', 'Collar Length', 'Shoulder Length', 'Below Shoulder', 'Waist Length',
] as const;

export const HAIR_STYLE_OPTIONS = [
  'Straight', 'Curly', 'Wavy', 'Braided', 'Dreadlocks', 'Afro',
  'Bun', 'Ponytail', 'Bald',
  'Cornrows', 'Twists', 'Fade', 'Mohawk', 'Buzz Cut', 'Slicked Back',
  'Parted', 'Messy/Unkempt', 'Bob', 'Pixie Cut', 'Undercut',
  'Comb Over', 'Man Bun', 'Top Knot', 'Jheri Curl', 'Flat Top',
] as const;

export const FACIAL_HAIR_OPTIONS = [
  'None', 'Mustache', 'Goatee', 'Full Beard', 'Stubble', 'Sideburns',
  'Van Dyke', 'Chinstrap', 'Soul Patch', 'Mutton Chops',
  'Handlebar Mustache', 'Fu Manchu', 'Circle Beard', 'Chin Curtain',
  '5 O\'Clock Shadow', 'Pencil Mustache', 'Walrus Mustache',
] as const;

export const EYE_COLOR_OPTIONS = [
  'Brown', 'Blue', 'Green', 'Hazel', 'Gray', 'Amber', 'Black',
  'Blue-Green', 'Blue-Gray', 'Light Brown', 'Dark Brown',
  'Heterochromia (Multi)', 'Bloodshot', 'Prosthetic/Glass',
  'Other',
] as const;

export const GLASSES_OPTIONS = [
  'None', 'Glasses', 'Contacts', 'Sunglasses',
  'Bifocals', 'Reading Glasses', 'Safety Glasses', 'Monocle',
  'Eye Patch', 'Tinted/Transitional',
] as const;

// Voice description — for FI cards, witness statements, BOLO
// alerts when the subject was heard but not clearly seen.
export const VOICE_OPTIONS = [
  'Normal', 'Deep', 'High-Pitched', 'Raspy', 'Nasal',
  'Soft / Quiet', 'Loud', 'Stutter', 'Lisp',
  'Foreign Accent', 'Regional Accent', 'Slurred',
  'Monotone', 'Whispering', 'Hoarse', 'Squeaky', 'Gravelly',
  'Trembling/Shaky', 'Muffled', 'Booming', 'Articulate/Clear', 'Mumbling',
  'Other',
] as const;

// ── Person — Status / classification ──────────────────────

export const PROBATION_OPTIONS = [
  'None', 'Probation', 'Parole', 'Both',
  'Pre-Trial Supervision', 'Pre-Trial Supervision + Probation',
  'Deferred Sentence', 'Diversion Program',
] as const;

export const ID_TYPE_OPTIONS = [
  'Driver License', 'State ID', 'Passport', 'Military ID',
  'Tribal ID', 'Permanent Resident Card', 'Work Permit',
  'Student ID', 'Foreign National ID',
  'Consular ID', 'TWIC Card', 'Concealed Carry Permit',
  'Social Security Card', 'Birth Certificate', 'Voter Registration Card',
  'School/University ID', 'Federal Employee ID',
  'Medical Marijuana Card', 'Green Card (I-551)',
  'Other',
] as const;

// DL classes per Utah DLD — A/B/C are commercial (CDL); D is
// standard passenger; M is motorcycle. Matches state DLD lookup.
export const DL_CLASS_OPTIONS = [
  'A', 'B', 'C', 'D', 'M', 'CDL-A', 'CDL-B', 'CDL-C',
  'CDL-A (Hazmat)', 'CDL-A (Tanker)', 'CDL-A (Doubles/Triples)',
  'CDL-B (Passenger)', 'CDL-B (School Bus)',
  'Learner Permit', 'Restricted', 'Suspended', 'Revoked', 'Expired',
] as const;

// Education attainment — used for jail intake & demographic
// reporting. No K-12 grade detail because pre-HS levels are
// typically reported as "Some High School".
export const EDUCATION_OPTIONS = [
  'None', 'Some High School', 'High School / GED',
  'Some College', 'Associate Degree', 'Bachelor Degree',
  'Master Degree', 'Doctorate', 'Trade/Vocational', 'Other',
] as const;

export const OCCUPATION_OPTIONS = [
  'Unemployed', 'Student', 'Retired', 'Self-Employed',
  'Construction', 'Food Service', 'Healthcare', 'Retail',
  'Transportation', 'Manufacturing', 'Agriculture', 'Education',
  'Public Safety', 'Military',
  'IT / Technology', 'Finance / Banking', 'Legal', 'Sales',
  'Skilled Trades', 'Government', 'Hospitality',
  'Warehouse / Logistics', 'Maintenance / Janitorial',
  'Security', 'Social Services',
  'Mining/Extraction', 'Real Estate', 'Arts/Entertainment',
  'Media/Communications', 'Nonprofit/Charity', 'Religious/Clergy',
  'Freelance/Gig Work', 'Day Labor', 'Homemaker',
  'Disabled/Unable to Work', 'Incarcerated',
  'Other',
] as const;

export const MILITARY_BRANCH_OPTIONS = [
  'None', 'Army', 'Navy', 'Air Force', 'Marines', 'Coast Guard',
  'Space Force', 'National Guard', 'Reserves', 'Other',
] as const;

export const MILITARY_STATUS_OPTIONS = [
  'Active Duty', 'Veteran', 'Retired', 'Discharged',
  'Reserves', 'National Guard', 'Deceased',
] as const;

export const DISABILITY_OPTIONS = [
  'None', 'Mobility Impaired', 'Hearing Impaired',
  'Visually Impaired', 'Cognitive/Developmental',
  'Mental Health', 'Speech Impaired', 'Chronic Illness',
  'Multiple', 'Other',
] as const;

// Gang list — Utah-deployment-specific. Operationally relevant
// here; keep "Other — See Notes" so officers can tag groups not
// in the predefined list without being forced to mis-categorize.
export const GANG_OPTIONS = [
  'None',
  'Sureños (13)', 'Norteños (14)', 'MS-13', 'Latin Kings',
  'Bloods', 'Crips', '18th Street',
  'Aryan Brotherhood', 'Hells Angels', 'Mongols MC',
  'Bandidos MC', 'Vagos MC',
  'Tongan Crip Gang',
  'Other — See Notes',
] as const;

// Emergency contact relationship — kept short; "Other" with notes
// covers the long tail (godparent, sponsor, neighbor, etc.).
export const EMERGENCY_CONTACT_RELATIONSHIPS = [
  'Spouse', 'Parent', 'Child', 'Sibling',
  'Grandparent', 'Grandchild',
  'Aunt / Uncle', 'Cousin',
  'In-Law',
  'Friend', 'Coworker', 'Attorney', 'Clergy',
  'Guardian', 'Other',
] as const;

// Language proficiency for the per-language proficiency JSON.
export const LANGUAGE_PROFICIENCY_OPTIONS = [
  'Native', 'Fluent', 'Conversational', 'Limited', 'None',
] as const;

// ── Vehicle ───────────────────────────────────────────────

// Body styles per NCIC vehicle data dictionary.
export const VEHICLE_BODY_STYLE_OPTIONS = [
  'Sedan (4-Door)', 'Coupe (2-Door)', 'Hatchback', 'Wagon',
  'Convertible', 'SUV', 'Crossover', 'Pickup Truck',
  'Van', 'Minivan', 'Cargo Van', 'Bus',
  'Motorcycle', 'Scooter', 'Moped', 'ATV / UTV',
  'Trailer', 'Box Truck', 'Semi Tractor', 'Flatbed',
  'Tow Truck', 'Dump Truck',
  'Sports Car', 'Limousine', 'Ambulance', 'Fire Engine', 'Police Cruiser',
  'Camper/RV', 'Golf Cart', 'Go-Kart', 'Snowmobile',
  'Boat Trailer', 'Horse Trailer', 'Utility Trailer',
  'Tank Truck', 'Cement Mixer', 'Crane', 'Forklift',
  'Delivery Van', 'Ice Cream Truck', 'Food Truck', 'Hearse',
  'Other',
] as const;

// NCIC color names — first letter standardized for plate-only
// registrations (e.g. plate database returns "BRO" → "Brown").
export const VEHICLE_COLOR_OPTIONS = [
  'Beige', 'Black', 'Blue', 'Brown', 'Bronze',
  'Burgundy', 'Charcoal', 'Copper',
  'Cream', 'Dark Blue', 'Dark Gray', 'Dark Green', 'Dark Red',
  'Gold', 'Gray', 'Green', 'Lavender',
  'Light Blue', 'Light Gray', 'Light Green',
  'Maroon', 'Navy', 'Orange', 'Pink', 'Purple',
  'Red', 'Silver', 'Tan', 'Teal',
  'Turquoise', 'White', 'Yellow',
  'Champagne', 'Pewter', 'Graphite', 'Midnight Blue', 'Forest Green',
  'Olive', 'Rust', 'Ivory', 'Matte Black', 'Pearl White',
  'Candy Apple Red', 'Primer/Unpainted', 'Camouflage', 'Wrap/Custom',
  'Multi-Color', 'Other',
] as const;

export const VEHICLE_FUEL_OPTIONS = [
  'Gasoline', 'Diesel', 'Hybrid', 'Plug-In Hybrid',
  'Electric', 'Flex-Fuel (E85)', 'CNG / Propane',
  'Other',
] as const;

export const VEHICLE_TRANSMISSION_OPTIONS = [
  'Automatic', 'Manual', 'CVT', 'Semi-Automatic / DCT',
  'Unknown',
] as const;

export const VEHICLE_DRIVE_OPTIONS = [
  'FWD', 'RWD', 'AWD', '4WD',
] as const;

export const VEHICLE_USE_OPTIONS = [
  'Personal', 'Commercial', 'Government / Fleet',
  'Rental', 'Lease', 'Rideshare',
  'Emergency / First Responder', 'Military', 'Other',
] as const;

export const PLATE_TYPE_OPTIONS = [
  'Standard Passenger', 'Personalized', 'Commercial',
  'Motorcycle', 'Trailer', 'Dealer / Temp',
  'Government', 'Disabled', 'Specialty / Charity',
  'Veteran', 'Antique / Historical',
  'Out-of-State', 'Out-of-Country', 'No Plate', 'Other',
] as const;

export const STOLEN_STATUS_OPTIONS = [
  'Not Stolen', 'Stolen', 'Recovered', 'Cleared',
  'Under Investigation', 'Unknown',
] as const;

export const TOW_STATUS_OPTIONS = [
  'None', 'Police Hold', 'Owner Request', 'Investigation Hold',
  'Abandoned', 'Released to Owner', 'Released to Insurance',
  'Auctioned', 'Other',
] as const;

export const TITLE_STATUS_OPTIONS = [
  'Clean', 'Salvage', 'Rebuilt', 'Junk', 'Flood',
  'Lemon-Law Buyback', 'Manufacturer Buyback',
  'Lien', 'Unknown',
] as const;

export const VEHICLE_CONDITION_OPTIONS = [
  'Excellent', 'Good', 'Fair', 'Poor', 'Damaged',
  'Disabled', 'Salvage',
] as const;

// Body damage panel codes — modeled on insurance / collision-repair
// shorthand. Frequently selected as a multi-select on incident reports.
export const VEHICLE_DAMAGE_PANEL_OPTIONS = [
  'Hood', 'Front Bumper', 'Front Grille', 'Headlights',
  'Driver Front Fender', 'Passenger Front Fender',
  'Driver Front Door', 'Passenger Front Door',
  'Driver Rear Door', 'Passenger Rear Door',
  'Driver Rear Quarter', 'Passenger Rear Quarter',
  'Trunk / Tailgate', 'Rear Bumper', 'Tail Lights',
  'Roof', 'Windshield', 'Rear Window',
  'Driver-Side Windows', 'Passenger-Side Windows',
  'Side Mirrors', 'Wheels / Tires', 'Undercarriage',
  'Other',
] as const;

// ── Property ──────────────────────────────────────────────

export const PROPERTY_TYPE_OPTIONS = [
  'Residential — Single Family', 'Residential — Multi-Family',
  'Residential — Apartment Complex', 'Residential — Mobile Home Park',
  'Residential — Condominium', 'Residential — Duplex', 'Residential — Senior Living',
  'Commercial — Office', 'Commercial — Retail',
  'Commercial — Restaurant', 'Commercial — Hotel/Motel',
  'Commercial — Bar/Nightclub', 'Commercial — Gas Station',
  'Commercial — Auto Dealer', 'Commercial — Repair Shop',
  'Commercial — Grocery Store', 'Commercial — Shopping Mall',
  'Commercial — Bank/Credit Union', 'Commercial — Pharmacy',
  'Industrial — Warehouse', 'Industrial — Manufacturing',
  'Industrial — Storage Facility', 'Industrial — Auto Salvage/Junkyard',
  'Industrial — Power Plant',
  'Educational — School', 'Educational — University',
  'Healthcare — Hospital', 'Healthcare — Clinic',
  'Government — Office', 'Government — Court',
  'Religious — Church / Temple',
  'Recreational — Park', 'Recreational — Stadium',
  'Recreational — Swimming Pool', 'Recreational — Campground',
  'Recreational — Golf Course',
  'Transportation — Bus Station', 'Transportation — Rail Station',
  'Transportation — Airport', 'Transportation — Parking Structure',
  'Agricultural — Farm/Ranch', 'Agricultural — Greenhouse',
  'Construction Site', 'Vacant Lot', 'Mixed Use', 'Other',
] as const;

export const STRUCTURE_TYPE_OPTIONS = [
  'Single-Story', 'Multi-Story', 'High-Rise',
  'Apartment Block', 'Townhouse', 'Mobile Home',
  'Detached Garage', 'Outbuilding',
  'Tent / Temporary',
  'Split-Level', 'A-Frame', 'Modular/Prefab', 'Underground/Basement',
  'Open-Air/Pavilion', 'Dome/Geodesic', 'Warehouse',
  'Barn/Agricultural', 'Historical/Landmark',
  'Other',
] as const;

export const OCCUPANCY_STATUS_OPTIONS = [
  'Owner-Occupied', 'Tenant-Occupied', 'Vacant',
  'Under Construction', 'Abandoned',
  'Seasonal / Vacation',
  'Partially Occupied', 'Condemned', 'Foreclosed',
  'Government-Occupied', 'Short-Term Rental', 'Commercial Lease',
  'Unknown',
] as const;

export const ALARM_SYSTEM_OPTIONS = [
  'None', 'Self-Monitored', 'Professionally Monitored',
  'Smart-Home Integration', 'Wireless', 'Wired',
  'Hybrid',
  'Fire Alarm Only', 'Panic Button', 'Duress Code Enabled',
  'Silent Alarm', 'Perimeter-Only', 'Interior Motion',
  'Glass-Break Sensors', 'Video Verified',
  'Other',
] as const;

export const PATROL_FREQUENCY_OPTIONS = [
  'None', '1× per shift', '2× per shift',
  '3-4× per shift', 'Hourly', 'Continuous Post',
  'On-Call Only', 'As Required',
  'Every 2 Hours', 'Every 4 Hours', 'Once Daily', 'Twice Daily',
  'Weekdays Only', 'Weekends Only', 'Business Hours Only', 'After Hours Only',
  'Other',
] as const;

// ── Evidence ──────────────────────────────────────────────

// NIBRS Property Description codes mapped to operator-friendly
// labels. Used for evidence intake + property bag classification.
export const EVIDENCE_TYPE_OPTIONS = [
  'Physical', 'Digital', 'Document',
  'Drug / Controlled Substance', 'Firearm / Weapon',
  'Currency', 'Jewelry / Precious Metal',
  'Electronics', 'Clothing', 'Vehicle / Parts',
  'Biological / DNA', 'Latent Print',
  'Photographic', 'Video', 'Audio Recording',
  'Map / Diagram', 'Other',
] as const;

export const EVIDENCE_CATEGORY_OPTIONS = [
  'Crime Scene', 'Search & Seizure', 'Found Property',
  'Recovered Stolen', 'Safekeeping',
  'Court Hold', 'Pending Lab Analysis',
  'Pending Disposition', 'Other',
] as const;

export const EVIDENCE_STATUS_OPTIONS = [
  'In Custody', 'Lab Submitted', 'Returned to Owner',
  'Released to Outside Agency', 'Court Hold',
  'Sealed', 'Pending Disposition',
  'Disposed', 'Destroyed', 'Lost', 'Other',
] as const;

export const EVIDENCE_DISPOSAL_OPTIONS = [
  'Destroyed', 'Returned to Owner', 'Released to Heir',
  'Auctioned', 'Donated', 'Court-Ordered Disposition',
  'Transferred to Outside Agency',
  'Pending', 'Other',
] as const;

export const CHAIN_OF_CUSTODY_ACTION_OPTIONS = [
  'Collected', 'Logged In', 'Transferred',
  'Signed Out for Lab', 'Returned from Lab',
  'Signed Out for Court', 'Returned from Court',
  'Signed Out to Owner',
  'Photographed', 'Sealed',
  'Inventory Audit',
  'Disposed', 'Other',
] as const;

// ── Dispatch / Calls ──────────────────────────────────────

export const PRIORITY_OPTIONS = [
  '1 — Emergency / Life-Threatening',
  '2 — Urgent / In-Progress',
  '3 — Routine / Cold',
  '4 — Non-Emergency / Walk-In',
  '5 — Information Only',
] as const;

export const CALL_STATUS_OPTIONS = [
  'Pending', 'Dispatched', 'En Route', 'On Scene',
  'Cleared', 'Cancelled', 'Stacked', 'Holding',
] as const;

export const DISPOSITION_OPTIONS = [
  'Report Taken', 'Arrest Made', 'Citation Issued',
  'Warning Issued', 'Referred to Other Agency',
  'Unfounded', 'No Police Action Required',
  'Gone on Arrival', 'Cancelled by RP',
  'Cancelled by Dispatch', 'Cancelled by Officer',
  'Civil Matter', 'Mental Health Hold',
  'Trespass Warning', 'Mediated', 'Other',
] as const;

export const HAZARD_CODE_OPTIONS = [
  'None Reported', 'Weapons Present',
  'Subject Armed', 'Subject Violent History',
  'Mental Health Crisis', 'Under the Influence',
  'Domestic Violence', 'Sex Offender Address',
  'Animal Hazard (Aggressive Dog)',
  'Hazmat / Chemical', 'Structural Collapse',
  'Active Fire', 'Electrical Hazard',
  'Officer Down', 'Other — See Notes',
] as const;

// Source — how the call entered dispatch.
export const CALL_SOURCE_OPTIONS = [
  '911 Call', 'Non-Emergency Line',
  'Walk-In', 'Officer Initiated', 'Stop',
  'Alarm Drop', 'Mutual Aid Request',
  'Camera Operator', 'Field Interview',
  'Records Tip', 'Other',
] as const;

// ── Citations & Court ─────────────────────────────────────

export const CITATION_TYPE_OPTIONS = [
  'Traffic — Moving', 'Traffic — Non-Moving',
  'Traffic — DUI', 'Traffic — Equipment',
  'Misdemeanor', 'Felony', 'Infraction',
  'Civil', 'Trespass',
  'Code Enforcement', 'Other',
] as const;

export const CITATION_STATUS_OPTIONS = [
  'Issued', 'Paid', 'Contested',
  'Court Date Set', 'Court Concluded',
  'Voided', 'Dismissed', 'Warrant Issued',
] as const;

export const COURT_EVENT_TYPE_OPTIONS = [
  'Arraignment', 'Pre-Trial', 'Trial',
  'Sentencing', 'Motion Hearing',
  'Subpoena', 'Status Conference',
  'Plea Hearing', 'Probation Review',
  'Bond Hearing', 'Other',
] as const;

// ── Warrants ──────────────────────────────────────────────

export const WARRANT_TYPE_OPTIONS = [
  'Bench', 'Arrest', 'Search',
  'Failure to Appear', 'Failure to Pay',
  'Probation Violation', 'Parole Violation',
  'Civil', 'Material Witness', 'Body Attachment',
  'Other',
] as const;

export const WARRANT_STATUS_OPTIONS = [
  'Active', 'Served', 'Recalled', 'Cleared',
  'Cold', 'Expired', 'Quashed', 'Other',
] as const;

export const OFFENSE_LEVEL_OPTIONS = [
  'Felony — 1st Degree', 'Felony — 2nd Degree',
  'Felony — 3rd Degree',
  'Misdemeanor — Class A', 'Misdemeanor — Class B',
  'Misdemeanor — Class C',
  'Infraction', 'Civil', 'Other',
] as const;

// ── Field Interviews ──────────────────────────────────────

export const FI_REASON_OPTIONS = [
  'Suspicious Activity', 'Investigative Stop',
  'Welfare Check', 'Trespass Investigation',
  'BOLO Match', 'Witness Interview',
  'Information Gathering', 'Subject Reporting Crime',
  'Other',
] as const;

export const FI_CONTACT_TYPE_OPTIONS = [
  'Field', 'Vehicle Stop', 'Pedestrian Stop',
  'Consensual Encounter', 'Probable Cause',
  'Reasonable Suspicion', 'Telephone',
  'In-Person Interview', 'Other',
] as const;

export const FI_ACTION_OPTIONS = [
  'None', 'Verbal Warning', 'Verbal Counseling',
  'Citation', 'Custody / Arrest',
  'Mental Health Referral',
  'Trespass Warning', 'Pat-Down',
  'Identification Check Only', 'Other',
] as const;

// ── Generic Status / Severity ─────────────────────────────

export const RECORD_RISK_LEVEL_OPTIONS = [
  'Low', 'Standard', 'Elevated', 'High', 'Critical',
] as const;

// Tribal affiliation (Utah-relevant) — the subset of federally
// recognized tribes with Utah land base or significant member
// population. "Other" + free-text falls back to write-in.
export const TRIBAL_AFFILIATION_OPTIONS = [
  'Navajo Nation', 'Ute Indian Tribe',
  'Ute Mountain Ute Tribe',
  'Paiute Indian Tribe of Utah',
  'Goshute (Confederated Tribes)',
  'Northwestern Band of Shoshone Nation',
  'San Juan Southern Paiute Tribe',
  'Other Federally Recognized Tribe',
  'Other Tribal Affiliation',
  'None', 'Decline to State',
] as const;

// ── Type Helpers ──────────────────────────────────────────

/**
 * Given any of the readonly arrays exported above, produces a
 * union type of its members. Useful for `name: typeof X[number]`
 * field signatures so TS narrows to the actual options.
 */
export type EnumValue<T extends readonly string[]> = T[number];

/** Quick predicate: is the given value a member of the enum array? */
export function isEnumValue<T extends readonly string[]>(
  arr: T,
  value: unknown,
): value is T[number] {
  return typeof value === 'string' && (arr as readonly string[]).includes(value);
}
