-- Fleet.io PR 2 — static lookup seeds.
-- Pairs with 0134_ref_tables.sql.
--
-- Scope: small, stable enumerations only — values that are domain-fixed and
-- rarely change (US states, NCIC colors, fuel types, units, drivetrains,
-- transmissions, body types, basic engine/oil/work-order categories).
--
-- DEFERRED to a follow-up PR (PR 2b):
--   * Full VMRS 5500-row catalogue (sourced from TMC / VMRS).
--   * NHTSA vPIC bulk-export of vehicle makes/models (~10k+ rows).
--     These hydrate over time via the monthly cron + per-VIN cache.
--
-- All inserts use `INSERT OR IGNORE` keyed on the UNIQUE `code` column, so
-- re-applying this file is safe and adding rows in a later migration won't
-- collide with existing data.

-- ===================================================================
-- ref_plate_states — 50 states + DC + 5 US territories
-- ===================================================================

INSERT OR IGNORE INTO ref_plate_states (code, name, country) VALUES
  ('AL', 'Alabama', 'US'), ('AK', 'Alaska', 'US'), ('AZ', 'Arizona', 'US'),
  ('AR', 'Arkansas', 'US'), ('CA', 'California', 'US'), ('CO', 'Colorado', 'US'),
  ('CT', 'Connecticut', 'US'), ('DE', 'Delaware', 'US'), ('FL', 'Florida', 'US'),
  ('GA', 'Georgia', 'US'), ('HI', 'Hawaii', 'US'), ('ID', 'Idaho', 'US'),
  ('IL', 'Illinois', 'US'), ('IN', 'Indiana', 'US'), ('IA', 'Iowa', 'US'),
  ('KS', 'Kansas', 'US'), ('KY', 'Kentucky', 'US'), ('LA', 'Louisiana', 'US'),
  ('ME', 'Maine', 'US'), ('MD', 'Maryland', 'US'), ('MA', 'Massachusetts', 'US'),
  ('MI', 'Michigan', 'US'), ('MN', 'Minnesota', 'US'), ('MS', 'Mississippi', 'US'),
  ('MO', 'Missouri', 'US'), ('MT', 'Montana', 'US'), ('NE', 'Nebraska', 'US'),
  ('NV', 'Nevada', 'US'), ('NH', 'New Hampshire', 'US'), ('NJ', 'New Jersey', 'US'),
  ('NM', 'New Mexico', 'US'), ('NY', 'New York', 'US'), ('NC', 'North Carolina', 'US'),
  ('ND', 'North Dakota', 'US'), ('OH', 'Ohio', 'US'), ('OK', 'Oklahoma', 'US'),
  ('OR', 'Oregon', 'US'), ('PA', 'Pennsylvania', 'US'), ('RI', 'Rhode Island', 'US'),
  ('SC', 'South Carolina', 'US'), ('SD', 'South Dakota', 'US'), ('TN', 'Tennessee', 'US'),
  ('TX', 'Texas', 'US'), ('UT', 'Utah', 'US'), ('VT', 'Vermont', 'US'),
  ('VA', 'Virginia', 'US'), ('WA', 'Washington', 'US'), ('WV', 'West Virginia', 'US'),
  ('WI', 'Wisconsin', 'US'), ('WY', 'Wyoming', 'US'),
  ('DC', 'District of Columbia', 'US'),
  ('PR', 'Puerto Rico', 'US'), ('VI', 'US Virgin Islands', 'US'),
  ('GU', 'Guam', 'US'), ('AS', 'American Samoa', 'US'), ('MP', 'Northern Mariana Islands', 'US');

-- ===================================================================
-- ref_colors — NCIC standard vehicle color codes (matches src/constants/ncicCodes.ts)
-- ===================================================================

INSERT OR IGNORE INTO ref_colors (code, name, hex) VALUES
  ('BLK', 'Black',   '#000000'),
  ('WHI', 'White',   '#FFFFFF'),
  ('SIL', 'Silver',  '#C0C0C0'),
  ('GRY', 'Gray',    '#808080'),
  ('RED', 'Red',     '#C0392B'),
  ('BLU', 'Blue',    '#2C5DAA'),
  ('GRN', 'Green',   '#2E7D32'),
  ('BRO', 'Brown',   '#6B4226'),
  ('TAN', 'Tan',     '#C8B084'),
  ('YEL', 'Yellow',  '#F1C40F'),
  ('ORA', 'Orange',  '#D35400'),
  ('PUR', 'Purple',  '#6A1B9A'),
  ('PNK', 'Pink',    '#E91E63'),
  ('GLD', 'Gold',    '#D4A017'),
  ('BGE', 'Beige',   '#E5D9B6'),
  ('MAR', 'Maroon',  '#5C0A0A'),
  ('TUR', 'Turquoise','#1ABC9C'),
  ('TPE', 'Two-tone',  NULL);

-- ===================================================================
-- ref_fuel_types
-- ===================================================================

INSERT OR IGNORE INTO ref_fuel_types (code, name) VALUES
  ('GAS',    'Gasoline'),
  ('DIESEL', 'Diesel'),
  ('FLEX',   'Flex Fuel (E85)'),
  ('CNG',    'Compressed Natural Gas'),
  ('LPG',    'Propane (LPG)'),
  ('EV',     'Electric'),
  ('HYB',    'Hybrid'),
  ('PHEV',   'Plug-in Hybrid');

-- ===================================================================
-- ref_drivetrains
-- ===================================================================

INSERT OR IGNORE INTO ref_drivetrains (code, name) VALUES
  ('FWD', 'Front-Wheel Drive'),
  ('RWD', 'Rear-Wheel Drive'),
  ('AWD', 'All-Wheel Drive'),
  ('4WD', 'Four-Wheel Drive');

-- ===================================================================
-- ref_transmission_types
-- ===================================================================

INSERT OR IGNORE INTO ref_transmission_types (code, name) VALUES
  ('AUTO',   'Automatic'),
  ('MANUAL', 'Manual'),
  ('CVT',    'Continuously Variable (CVT)'),
  ('DCT',    'Dual-Clutch'),
  ('SEMI',   'Semi-Automatic');

-- ===================================================================
-- ref_body_types
-- ===================================================================

INSERT OR IGNORE INTO ref_body_types (code, name) VALUES
  ('SED',   'Sedan'),
  ('SUV',   'SUV'),
  ('CUV',   'Crossover'),
  ('TRUCK', 'Pickup Truck'),
  ('VAN',   'Van'),
  ('COUPE', 'Coupe'),
  ('WAGON', 'Wagon'),
  ('CONV',  'Convertible'),
  ('HATCH', 'Hatchback'),
  ('MOTO',  'Motorcycle'),
  ('BUS',   'Bus'),
  ('OTHER', 'Other');

-- ===================================================================
-- ref_vehicle_types — RMPG patrol-specific
-- ===================================================================

INSERT OR IGNORE INTO ref_vehicle_types (code, name, description) VALUES
  ('PATROL',    'Marked Patrol',     'Standard marked patrol vehicle'),
  ('UNMARKED',  'Unmarked Patrol',   'Plainclothes / investigative unit'),
  ('SUPV',      'Supervisor',        'Sergeant / lieutenant / shift supervisor'),
  ('PURSUIT',   'Pursuit-Rated',     'Subset of patrol rated for high-speed engagement'),
  ('TRANSPORT', 'Prisoner Transport','Cage-equipped transport van/SUV'),
  ('K9',        'K-9 Unit',          'K-9-equipped patrol vehicle'),
  ('CMD',       'Command',           'Mobile command post / scene management'),
  ('ADMIN',     'Administrative',    'Office / errand pool vehicle'),
  ('SUPPORT',   'Support',           'Maintenance / supply / tow / utility');

-- ===================================================================
-- ref_units_of_measure
-- ===================================================================

INSERT OR IGNORE INTO ref_units_of_measure (code, name, family) VALUES
  ('gal', 'Gallon (US)',     'volume'),
  ('qt',  'Quart',           'volume'),
  ('L',   'Liter',           'volume'),
  ('mL',  'Milliliter',      'volume'),
  ('oz',  'Fluid Ounce',     'volume'),
  ('mi',  'Mile',            'distance'),
  ('km',  'Kilometer',       'distance'),
  ('ft',  'Foot',            'distance'),
  ('in',  'Inch',            'distance'),
  ('hr',  'Hour',            'time'),
  ('min', 'Minute',          'time'),
  ('day', 'Day',             'time'),
  ('ea',  'Each',            'count'),
  ('lb',  'Pound',           'mass'),
  ('kg',  'Kilogram',        'mass');

-- ===================================================================
-- ref_engine_types — common patrol engine families
-- ===================================================================

INSERT OR IGNORE INTO ref_engine_types (code, name, cylinders, displacement_l) VALUES
  ('I4',    'Inline-4',         4, NULL),
  ('V6',    'V6',               6, NULL),
  ('V8',    'V8',               8, NULL),
  ('I6',    'Inline-6',         6, NULL),
  ('EV',    'Electric Motor',   0, NULL),
  ('HYB',   'Hybrid Drivetrain',4, NULL),
  ('DIESEL','Diesel',           NULL, NULL);

-- ===================================================================
-- ref_fuel_grades
-- ===================================================================

INSERT OR IGNORE INTO ref_fuel_grades (code, name, octane) VALUES
  ('REGULAR', 'Regular Unleaded',  87),
  ('MIDGRADE','Midgrade Unleaded', 89),
  ('PREMIUM', 'Premium Unleaded',  91),
  ('DIESEL',  'Diesel',            NULL),
  ('DEF',     'Diesel Exhaust Fluid (DEF)', NULL),
  ('E85',     'E85 Flex Fuel',     105),
  ('EV_DC',   'EV DC Fast Charge', NULL),
  ('EV_AC',   'EV AC Level 2',     NULL);

-- ===================================================================
-- ref_fuel_card_types
-- ===================================================================

INSERT OR IGNORE INTO ref_fuel_card_types (code, name) VALUES
  ('WEX',      'WEX Fleet Card'),
  ('FLEETCOR', 'FLEETCOR (Comdata)'),
  ('VOYAGER',  'Voyager Fleet Card'),
  ('FUELMAN',  'Fuelman'),
  ('SHELL',    'Shell Fleet Plus'),
  ('CC',       'Personal/Office Credit Card'),
  ('INTERNAL', 'In-house pump (no card)');

-- ===================================================================
-- ref_work_order_categories
-- ===================================================================

INSERT OR IGNORE INTO ref_work_order_categories (code, name) VALUES
  ('PM',         'Preventive Maintenance'),
  ('REPAIR',     'Repair'),
  ('INSPECTION', 'Inspection'),
  ('BODYWORK',   'Body / Collision'),
  ('TIRE',       'Tires'),
  ('UPFIT',      'Upfit / Modification'),
  ('RECALL',     'Recall / TSB'),
  ('OTHER',      'Other');

-- ===================================================================
-- ref_service_types — common patrol service intervals
-- ===================================================================

INSERT OR IGNORE INTO ref_service_types (code, name, default_interval_miles, default_interval_days) VALUES
  ('OIL_CHANGE',      'Oil + Filter Change',        5000,  180),
  ('TIRE_ROTATION',   'Tire Rotation',              7500,  180),
  ('AIR_FILTER',      'Engine Air Filter',          15000, 365),
  ('CABIN_FILTER',    'Cabin Air Filter',           15000, 365),
  ('BRAKE_INSPECT',   'Brake Inspection',           10000, 180),
  ('BRAKE_PAD',       'Brake Pad Replacement',      30000, 730),
  ('ALIGNMENT',       'Wheel Alignment',            25000, 365),
  ('COOLANT_FLUSH',   'Coolant Flush',              60000, 1095),
  ('TRANS_FLUID',     'Transmission Fluid Service', 60000, 1095),
  ('SPARK_PLUGS',     'Spark Plugs',                60000, 1825),
  ('BATTERY',         'Battery Replacement',        NULL,  1460),
  ('SAFETY_INSPECT',  'State Safety Inspection',    NULL,  365),
  ('EMISSIONS',       'Emissions Inspection',       NULL,  730);

-- ===================================================================
-- ref_oil_types — common 5W/0W synthetics for police fleet
-- ===================================================================

INSERT OR IGNORE INTO ref_oil_types (code, name, viscosity, base) VALUES
  ('0W20-SYNTH',      '0W-20 Full Synthetic',         '0W-20', 'synthetic'),
  ('0W20-BLEND',      '0W-20 Synthetic Blend',        '0W-20', 'synthetic_blend'),
  ('5W20-SYNTH',      '5W-20 Full Synthetic',         '5W-20', 'synthetic'),
  ('5W20-BLEND',      '5W-20 Synthetic Blend',        '5W-20', 'synthetic_blend'),
  ('5W30-SYNTH',      '5W-30 Full Synthetic',         '5W-30', 'synthetic'),
  ('5W30-BLEND',      '5W-30 Synthetic Blend',        '5W-30', 'synthetic_blend'),
  ('5W30-CONV',       '5W-30 Conventional',           '5W-30', 'conventional'),
  ('10W30-CONV',      '10W-30 Conventional',          '10W-30','conventional'),
  ('15W40-DIESEL',    '15W-40 Diesel',                '15W-40','synthetic_blend');

-- ===================================================================
-- ref_part_categories
-- ===================================================================

INSERT OR IGNORE INTO ref_part_categories (code, name) VALUES
  ('FILTERS',    'Filters'),
  ('FLUIDS',     'Fluids'),
  ('BRAKES',     'Brakes'),
  ('TIRES',      'Tires'),
  ('IGNITION',   'Ignition'),
  ('ELECTRICAL', 'Electrical'),
  ('SUSPENSION', 'Suspension'),
  ('EXHAUST',    'Exhaust'),
  ('HVAC',       'HVAC'),
  ('UPFIT',      'Patrol Upfit (lights, cage, console)'),
  ('CONSUMABLE', 'Consumable / Shop Supply'),
  ('OTHER',      'Other');

-- ===================================================================
-- ref_labor_rates — placeholders; admins should update per actual shop rates
-- ===================================================================

INSERT OR IGNORE INTO ref_labor_rates (code, name, hourly_rate) VALUES
  ('SHOP_STD',    'In-house shop, standard',  85.00),
  ('SHOP_AFTER',  'In-house shop, after-hours',125.00),
  ('DEALER',      'Dealer service department', 165.00),
  ('MOBILE',      'Mobile mechanic',           140.00),
  ('UPFIT',       'Patrol upfit specialist',   125.00);
