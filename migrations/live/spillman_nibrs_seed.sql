-- ============================================================
-- Migration 0015 — NIBRS code tables + Group A/B seed (NB-1)
-- ============================================================
-- FBI NIBRS 2019 reference data. Required-field metadata is baked
-- into the offense rows so the validator (NB-2) is a single JOIN.
-- ============================================================

CREATE TABLE IF NOT EXISTS nibrs_offense_codes (
  code TEXT PRIMARY KEY,
  description TEXT NOT NULL,
  ucr_group TEXT NOT NULL DEFAULT 'A',
  category TEXT NOT NULL,
  attempted_completed_required INTEGER NOT NULL DEFAULT 0,
  victim_required INTEGER NOT NULL DEFAULT 0,
  weapon_required INTEGER NOT NULL DEFAULT 0,
  bias_required INTEGER NOT NULL DEFAULT 0,
  property_required INTEGER NOT NULL DEFAULT 0,
  drug_required INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  active INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_nibrs_offense_group ON nibrs_offense_codes(ucr_group, active);

CREATE TABLE IF NOT EXISTS nibrs_location_codes (code TEXT PRIMARY KEY, description TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS nibrs_weapon_codes   (code TEXT PRIMARY KEY, description TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS nibrs_bias_codes     (code TEXT PRIMARY KEY, description TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS nibrs_property_descriptions (code TEXT PRIMARY KEY, description TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS nibrs_property_loss_types   (code TEXT PRIMARY KEY, description TEXT NOT NULL);

-- ── Group A (52 detailed offenses) ──
INSERT OR IGNORE INTO nibrs_offense_codes (code, description, ucr_group, category, attempted_completed_required, victim_required, weapon_required, bias_required, property_required, drug_required) VALUES
('09A','Murder and Nonnegligent Manslaughter','A','Homicide Offenses',1,1,1,1,0,0),
('09B','Negligent Manslaughter','A','Homicide Offenses',1,1,1,1,0,0),
('09C','Justifiable Homicide','A','Homicide Offenses',1,1,1,0,0,0),
('64A','Human Trafficking - Commercial Sex Acts','A','Human Trafficking',1,1,0,1,0,0),
('64B','Human Trafficking - Involuntary Servitude','A','Human Trafficking',1,1,0,1,0,0),
('100','Kidnapping/Abduction','A','Kidnapping/Abduction',1,1,1,1,0,0),
('11A','Rape','A','Sex Offenses',1,1,1,1,0,0),
('11B','Sodomy','A','Sex Offenses',1,1,1,1,0,0),
('11C','Sexual Assault With An Object','A','Sex Offenses',1,1,1,1,0,0),
('11D','Fondling','A','Sex Offenses',1,1,1,1,0,0),
('36A','Incest','A','Sex Offenses',1,1,0,1,0,0),
('36B','Statutory Rape','A','Sex Offenses',1,1,0,1,0,0),
('13A','Aggravated Assault','A','Assault Offenses',1,1,1,1,0,0),
('13B','Simple Assault','A','Assault Offenses',1,1,1,1,0,0),
('13C','Intimidation','A','Assault Offenses',1,1,0,1,0,0),
('200','Arson','A','Arson',1,0,0,1,1,0),
('210','Extortion/Blackmail','A','Extortion/Blackmail',1,1,0,1,1,0),
('220','Burglary/Breaking & Entering','A','Burglary/B&E',1,0,0,1,1,0),
('23A','Pocket-picking','A','Larceny/Theft Offenses',1,0,0,1,1,0),
('23B','Purse-snatching','A','Larceny/Theft Offenses',1,0,0,1,1,0),
('23C','Shoplifting','A','Larceny/Theft Offenses',1,0,0,1,1,0),
('23D','Theft From Building','A','Larceny/Theft Offenses',1,0,0,1,1,0),
('23E','Theft From Coin-Operated Machine or Device','A','Larceny/Theft Offenses',1,0,0,1,1,0),
('23F','Theft From Motor Vehicle','A','Larceny/Theft Offenses',1,0,0,1,1,0),
('23G','Theft of Motor Vehicle Parts or Accessories','A','Larceny/Theft Offenses',1,0,0,1,1,0),
('23H','All Other Larceny','A','Larceny/Theft Offenses',1,0,0,1,1,0),
('240','Motor Vehicle Theft','A','Motor Vehicle Theft',1,0,0,1,1,0),
('250','Counterfeiting/Forgery','A','Counterfeiting/Forgery',1,0,0,1,1,0),
('26A','False Pretenses/Swindle/Confidence Game','A','Fraud Offenses',1,0,0,1,1,0),
('26B','Credit Card/Automated Teller Machine Fraud','A','Fraud Offenses',1,0,0,1,1,0),
('26C','Impersonation','A','Fraud Offenses',1,0,0,1,1,0),
('26D','Welfare Fraud','A','Fraud Offenses',1,0,0,1,1,0),
('26E','Wire Fraud','A','Fraud Offenses',1,0,0,1,1,0),
('26F','Identity Theft','A','Fraud Offenses',1,0,0,1,1,0),
('26G','Hacking/Computer Invasion','A','Fraud Offenses',1,0,0,1,1,0),
('270','Embezzlement','A','Embezzlement',1,0,0,1,1,0),
('280','Stolen Property Offenses','A','Stolen Property Offenses',1,0,0,1,1,0),
('290','Destruction/Damage/Vandalism of Property','A','Destruction/Vandalism',1,0,0,1,1,0),
('510','Bribery','A','Bribery',1,0,0,1,1,0),
('120','Robbery','A','Robbery',1,1,1,1,1,0),
('35A','Drug/Narcotic Violations','A','Drug/Narcotic Offenses',1,0,0,0,0,1),
('35B','Drug Equipment Violations','A','Drug/Narcotic Offenses',1,0,0,0,1,0),
('39A','Betting/Wagering','A','Gambling Offenses',1,0,0,0,1,0),
('39B','Operating/Promoting/Assisting Gambling','A','Gambling Offenses',1,0,0,0,1,0),
('39C','Gambling Equipment Violations','A','Gambling Offenses',1,0,0,0,1,0),
('39D','Sports Tampering','A','Gambling Offenses',1,0,0,0,0,0),
('370','Pornography/Obscene Material','A','Pornography/Obscene Material',1,0,0,1,0,0),
('40A','Prostitution','A','Prostitution Offenses',1,0,0,0,0,0),
('40B','Assisting or Promoting Prostitution','A','Prostitution Offenses',1,0,0,0,0,0),
('40C','Purchasing Prostitution','A','Prostitution Offenses',1,0,0,0,0,0),
('520','Weapon Law Violations','A','Weapon Law Violations',1,0,1,1,0,0),
('720','Animal Cruelty','A','Animal Cruelty',1,0,0,1,0,0);

-- ── Group B (10 arrest-only) ──
INSERT OR IGNORE INTO nibrs_offense_codes (code, description, ucr_group, category, attempted_completed_required, victim_required, weapon_required, bias_required, property_required, drug_required) VALUES
('90A','Bad Checks','B','Group B',0,0,0,0,0,0),
('90B','Curfew/Loitering/Vagrancy Violations','B','Group B',0,0,0,0,0,0),
('90C','Disorderly Conduct','B','Group B',0,0,0,0,0,0),
('90D','Driving Under the Influence','B','Group B',0,0,0,0,0,0),
('90E','Drunkenness','B','Group B',0,0,0,0,0,0),
('90F','Family Offenses, Nonviolent','B','Group B',0,0,0,0,0,0),
('90G','Liquor Law Violations','B','Group B',0,0,0,0,0,0),
('90H','Peeping Tom','B','Group B',0,0,0,0,0,0),
('90J','Trespass of Real Property','B','Group B',0,0,0,0,0,0),
('90Z','All Other Offenses','B','Group B',0,0,0,0,0,0);

-- ── Location codes (45) ──
INSERT OR IGNORE INTO nibrs_location_codes (code, description) VALUES
('01','Air/Bus/Train Terminal'),('02','Bank/Savings & Loan'),('03','Bar/Nightclub'),('04','Church/Synagogue/Temple/Mosque'),
('05','Commercial/Office Building'),('06','Construction Site'),('07','Convenience Store'),('08','Department/Discount Store'),
('09','Drug Store/Doctor''s Office/Hospital'),('10','Field/Woods'),('11','Government/Public Building'),('12','Grocery/Supermarket'),
('13','Highway/Road/Alley/Street/Sidewalk'),('14','Hotel/Motel/Etc.'),('15','Jail/Prison/Penitentiary/Corrections Facility'),
('16','Lake/Waterway/Beach'),('17','Liquor Store'),('18','Parking/Drop Lot/Garage'),('19','Rental Storage Facility'),
('20','Residence/Home'),('21','Restaurant'),('22','School - College/University'),('23','Service/Gas Station'),
('24','Specialty Store'),('25','Other/Unknown'),('37','Abandoned/Condemned Structure'),('38','Amusement Park'),
('39','Arena/Stadium/Fairgrounds/Coliseum'),('40','ATM Separate from Bank'),('41','Auto Dealership New/Used'),
('42','Camp/Campground'),('44','Daycare Facility'),('45','Dock/Wharf/Freight/Modal Terminal'),('46','Farm Facility'),
('47','Gambling Facility/Casino/Race Track'),('48','Industrial Site'),('49','Military Installation'),('50','Park/Playground'),
('51','Rest Area'),('52','School - Elementary/Secondary'),('53','Shelter - Mission/Homeless'),('54','Shopping Mall'),
('55','Tribal Lands'),('56','Community Center'),('57','Cyberspace'),('58','Auto Repair Shop');

-- ── Weapon codes (19) ──
INSERT OR IGNORE INTO nibrs_weapon_codes (code, description) VALUES
('11','Firearm (Type Not Stated)'),('12','Handgun'),('13','Rifle'),('14','Shotgun'),('15','Other Firearm'),
('16','Lethal Cutting Instrument'),('17','Knife/Cutting Instrument'),('20','Blunt Object'),('30','Motor Vehicle'),
('35','Personal Weapons (Hands, Feet, Teeth)'),('40','Poison'),('50','Explosives'),('60','Fire/Incendiary Device'),
('65','Drugs/Narcotics/Sleeping Pills'),('70','Asphyxiation'),('85','Other (Bodily Force)'),('90','Other'),('95','Unknown'),('99','None');

-- ── Bias motivation codes (35) ──
INSERT OR IGNORE INTO nibrs_bias_codes (code, description) VALUES
('11','Anti-White'),('12','Anti-Black or African American'),('13','Anti-American Indian or Alaska Native'),('14','Anti-Asian'),
('15','Anti-Multi-Racial Group'),('16','Anti-Native Hawaiian or Other Pacific Islander'),('21','Anti-Jewish'),('22','Anti-Catholic'),
('23','Anti-Protestant'),('24','Anti-Islamic (Muslim)'),('25','Anti-Other Religion'),('26','Anti-Multi-Religious Group'),
('27','Anti-Atheism/Agnosticism'),('28','Anti-Mormon'),('29','Anti-Jehovah''s Witness'),('31','Anti-Hispanic or Latino'),
('32','Anti-Other Race/Ethnicity/Ancestry'),('33','Anti-Arab'),('41','Anti-Gay (Male)'),('42','Anti-Lesbian (Female)'),
('43','Anti-Lesbian, Gay, Bisexual, or Transgender (Mixed Group)'),('44','Anti-Heterosexual'),('45','Anti-Bisexual'),
('51','Anti-Physical Disability'),('52','Anti-Mental Disability'),('61','Anti-Male'),('62','Anti-Female'),
('71','Anti-Transgender'),('72','Anti-Gender Non-Conforming'),('81','Anti-Sikh'),('82','Anti-Eastern Orthodox (Russian, Greek, Other)'),
('83','Anti-Other Christian'),('84','Anti-Buddhist'),('85','Anti-Hindu'),('88','None (No Bias)');

-- ── Property descriptions (49) ──
INSERT OR IGNORE INTO nibrs_property_descriptions (code, description) VALUES
('01','Aircraft'),('02','Alcohol'),('03','Automobile'),('04','Bicycle'),('05','Buses'),('06','Clothes/Furs'),
('07','Computer Hardware/Software'),('08','Consumable Goods'),('09','Credit/Debit Cards'),('10','Drugs/Narcotics'),
('11','Drug/Narcotic Equipment'),('12','Farm Equipment'),('13','Firearms'),('14','Gambling Equipment'),
('15','Heavy Construction/Industrial Equipment'),('16','Household Goods'),('17','Jewelry/Precious Metals'),
('18','Livestock'),('19','Merchandise'),('20','Money'),('21','Musical Instruments'),('22','Negotiable Instruments'),
('23','Nonnegotiable Instruments'),('24','Office-Type Equipment'),('25','Other Motor Vehicles'),
('26','Purses/Handbags/Wallets'),('27','Radios/TVs/VCRs'),('28','Recordings - Audio/Visual'),
('29','Recreational Vehicles'),('30','Structures - Single Occupancy Dwellings'),('31','Structures - Other Dwellings'),
('32','Structures - Other Commercial/Business'),('33','Structures - Industrial/Manufacturing'),
('34','Structures - Public/Community'),('35','Structures - Storage'),('36','Structures - Other'),('37','Tools'),
('38','Trucks'),('39','Vehicle Parts/Accessories'),('40','Watercraft'),('41','Weapons - Other'),
('64','Identity Documents'),('65','Identity - Intangible'),('66','Metals, Non-Precious'),('67','Trailers'),
('77','Other'),('78','Pending Inventory (Non-Preliminary)'),('88','Pending Inventory (Preliminary)'),('99','Special Category');

-- ── Property loss types (8) ──
INSERT OR IGNORE INTO nibrs_property_loss_types (code, description) VALUES
('1','None'),('2','Burned'),('3','Counterfeited/Forged'),('4','Destroyed/Damaged/Vandalized'),
('5','Recovered'),('6','Seized'),('7','Stolen/Etc.'),('8','Unknown');
