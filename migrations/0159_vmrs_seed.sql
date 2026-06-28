-- ============================================================
-- RMPG Flex — VMRS Reference Seed Data
-- ------------------------------------------------------------
-- Seeds the three VMRS reference tables (already created by
-- 0134_ref_tables.sql) with ~30 system codes, ~200 assembly
-- codes, and ~200 component codes focused on police/security
-- fleet vehicle maintenance.
--
-- Source: TMC VMRS 2000+ Code Key 33 — police fleet subset.
-- All inserts use INSERT OR IGNORE so re-running is safe.
-- ============================================================

-- ===================================================================
-- REF_VMRS_SYSTEMS
-- ===================================================================
INSERT OR IGNORE INTO ref_vmrs_systems (code, name, active) VALUES
  ('013', 'Brake System', 1),
  ('014', 'Cab Interior & Sleeper', 1),
  ('017', 'Engine', 1),
  ('018', 'Exhaust System', 1),
  ('021', 'Fuel System', 1),
  ('022', 'Gears & Couplers', 1),
  ('023', 'Heater & Air Conditioner', 1),
  ('025', 'Hydraulic System', 1),
  ('026', 'Instruments & Gauges', 1),
  ('032', 'Cranking / Starting System', 1),
  ('034', 'Cooling System', 1),
  ('035', 'Bumpers', 1),
  ('036', 'Charging System', 1),
  ('037', 'Lighting System', 1),
  ('042', 'Electrical & Body Wiring', 1),
  ('045', 'Tires & Wheels', 1),
  ('048', 'Suspension - Front', 1),
  ('049', 'Suspension - Rear', 1),
  ('050', 'Wheel Seals & Bearings', 1),
  ('051', 'Safety Equipment', 1),
  ('054', 'Lights & Reflectors (External)', 1),
  ('056', 'Speedometer & Hubodometer', 1),
  ('059', 'Steering', 1),
  ('061', 'Transmission - Automatic', 1),
  ('062', 'Transmission - Manual', 1),
  ('064', 'Windows & Glass', 1),
  ('065', 'Windshield Wipers & Washers', 1),
  ('080', 'Police / Emergency Equipment', 1),
  ('081', 'Radio & Communications Equipment', 1),
  ('082', 'Computer & MDT Equipment', 1),
  ('083', 'Video & Dash Cam Equipment', 1),
  ('084', 'Lightbar & Emergency Warning', 1);

-- ===================================================================
-- REF_VMRS_ASSEMBLIES
-- ===================================================================

-- System 013 — Brake System
INSERT OR IGNORE INTO ref_vmrs_assemblies (system_code, code, name, active) VALUES
  ('013', '001', 'Foundation Brakes (Air)', 1),
  ('013', '002', 'Foundation Brakes (Hydraulic)', 1),
  ('013', '003', 'Parking Brake', 1),
  ('013', '004', 'Anti-lock Braking System (ABS)', 1),
  ('013', '005', 'Air Compressor', 1),
  ('013', '006', 'Air Dryer', 1),
  ('013', '007', 'Air Tanks & Lines', 1),
  ('013', '008', 'Brake Valves', 1),
  ('013', '009', 'Brake Chambers & Slack Adjusters', 1),
  ('013', '010', 'Brake Pads & Shoes', 1),
  ('013', '011', 'Brake Rotors & Drums', 1);

-- System 014 — Cab Interior
INSERT OR IGNORE INTO ref_vmrs_assemblies (system_code, code, name, active) VALUES
  ('014', '001', 'Seat & Mounting', 1),
  ('014', '002', 'Dashboard & Console', 1),
  ('014', '003', 'Flooring & Mats', 1),
  ('014', '004', 'Interior Trim & Panels', 1),
  ('014', '005', 'HVAC Controls & Ducts', 1);

-- System 017 — Engine
INSERT OR IGNORE INTO ref_vmrs_assemblies (system_code, code, name, active) VALUES
  ('017', '001', 'Engine Block & Cylinder Head', 1),
  ('017', '002', 'Crankshaft, Pistons & Connecting Rods', 1),
  ('017', '003', 'Valve Train & Camshaft', 1),
  ('017', '004', 'Oil Pump & Lubrication System', 1),
  ('017', '005', 'Engine Mounts & Brackets', 1),
  ('017', '006', 'Turbocharger & Supercharger', 1),
  ('017', '007', 'Belts, Pulleys & Tensioners', 1),
  ('017', '008', 'Engine Gaskets & Seals', 1),
  ('017', '009', 'PCV & Emission Controls', 1),
  ('017', '010', 'Engine Wiring & Sensors', 1),
  ('017', '011', 'Flywheel & Flexplate', 1);

-- System 018 — Exhaust System
INSERT OR IGNORE INTO ref_vmrs_assemblies (system_code, code, name, active) VALUES
  ('018', '001', 'Exhaust Manifold', 1),
  ('018', '002', 'Catalytic Converter', 1),
  ('018', '003', 'Muffler & Resonator', 1),
  ('018', '004', 'Exhaust Pipes & Hangers', 1),
  ('018', '005', 'Diesel Particulate Filter (DPF)', 1),
  ('018', '006', 'EGR System', 1);

-- System 021 — Fuel System
INSERT OR IGNORE INTO ref_vmrs_assemblies (system_code, code, name, active) VALUES
  ('021', '001', 'Fuel Tank & Mounting', 1),
  ('021', '002', 'Fuel Pump', 1),
  ('021', '003', 'Fuel Injectors', 1),
  ('021', '004', 'Fuel Filter & Water Separator', 1),
  ('021', '005', 'Fuel Lines & Fittings', 1),
  ('021', '006', 'Throttle Body / Fuel Rail', 1),
  ('021', '007', 'Fuel Sending Unit', 1);

-- System 022 — Gears & Couplers
INSERT OR IGNORE INTO ref_vmrs_assemblies (system_code, code, name, active) VALUES
  ('022', '001', 'Ring & Pinion', 1),
  ('022', '002', 'Differential Carrier', 1),
  ('022', '003', 'Axle Shafts', 1),
  ('022', '004', 'U-Joints & CV Joints', 1),
  ('022', '005', 'Drive Shaft', 1);

-- System 023 — Heater & AC
INSERT OR IGNORE INTO ref_vmrs_assemblies (system_code, code, name, active) VALUES
  ('023', '001', 'A/C Compressor', 1),
  ('023', '002', 'Condenser & Radiator', 1),
  ('023', '003', 'Evaporator & Expansion Valve', 1),
  ('023', '004', 'Heater Core', 1),
  ('023', '005', 'Blower Motor & Fan', 1),
  ('023', '006', 'A/C Lines & Seals', 1),
  ('023', '007', 'HVAC Control Module', 1);

-- System 025 — Hydraulic System
INSERT OR IGNORE INTO ref_vmrs_assemblies (system_code, code, name, active) VALUES
  ('025', '001', 'Hydraulic Pump', 1),
  ('025', '002', 'Hydraulic Cylinders', 1),
  ('025', '003', 'Hydraulic Hoses & Fittings', 1),
  ('025', '004', 'Hydraulic Valve Body', 1),
  ('025', '005', 'Hydraulic Fluid Reservoir', 1),
  ('025', '006', 'Power Steering Pump', 1);

-- System 026 — Instruments & Gauges
INSERT OR IGNORE INTO ref_vmrs_assemblies (system_code, code, name, active) VALUES
  ('026', '001', 'Instrument Cluster', 1),
  ('026', '002', 'Speedometer', 1),
  ('026', '003', 'Tachometer', 1),
  ('026', '004', 'Temperature Gauge', 1),
  ('026', '005', 'Oil Pressure Gauge', 1),
  ('026', '006', 'Voltmeter / Battery Gauge', 1),
  ('026', '007', 'Fuel Level Gauge', 1),
  ('026', '008', 'Warning Lights & Indicators', 1);

-- System 032 — Cranking / Starting
INSERT OR IGNORE INTO ref_vmrs_assemblies (system_code, code, name, active) VALUES
  ('032', '001', 'Starter Motor', 1),
  ('032', '002', 'Starter Solenoid', 1),
  ('032', '003', 'Ignition Switch', 1),
  ('032', '004', 'Starter Wiring & Relay', 1),
  ('032', '005', 'Battery Cables & Terminals', 1);

-- System 034 — Cooling System
INSERT OR IGNORE INTO ref_vmrs_assemblies (system_code, code, name, active) VALUES
  ('034', '001', 'Radiator & Cooling Fan', 1),
  ('034', '002', 'Water Pump', 1),
  ('034', '003', 'Thermostat & Housing', 1),
  ('034', '004', 'Coolant Hoses & Clamps', 1),
  ('034', '005', 'Coolant Reservoir', 1),
  ('034', '006', 'Intercooler', 1);

-- System 035 — Bumpers
INSERT OR IGNORE INTO ref_vmrs_assemblies (system_code, code, name, active) VALUES
  ('035', '001', 'Front Bumper Assembly', 1),
  ('035', '002', 'Rear Bumper Assembly', 1),
  ('035', '003', 'Push Bumper / Ram Bar', 1),
  ('035', '004', 'Bumper Mounts & Brackets', 1);

-- System 036 — Charging System
INSERT OR IGNORE INTO ref_vmrs_assemblies (system_code, code, name, active) VALUES
  ('036', '001', 'Alternator', 1),
  ('036', '002', 'Voltage Regulator', 1),
  ('036', '003', 'Battery', 1),
  ('036', '004', 'Battery Tray & Hold-down', 1),
  ('036', '005', 'Charging Wiring & Harness', 1);

-- System 037 — Lighting System
INSERT OR IGNORE INTO ref_vmrs_assemblies (system_code, code, name, active) VALUES
  ('037', '001', 'Headlight Assembly', 1),
  ('037', '002', 'Tail Light Assembly', 1),
  ('037', '003', 'Turn Signal Assembly', 1),
  ('037', '004', 'Fog / Driving Lights', 1),
  ('037', '005', 'Interior Dome / Map Lights', 1),
  ('037', '006', 'Light Switches & Relays', 1);

-- System 042 — Electrical & Body Wiring
INSERT OR IGNORE INTO ref_vmrs_assemblies (system_code, code, name, active) VALUES
  ('042', '001', 'Main Wiring Harness', 1),
  ('042', '002', 'Body / Chassis Harness', 1),
  ('042', '003', 'Fuse Box & Relays', 1),
  ('042', '004', 'Ground Straps & Cables', 1),
  ('042', '005', 'Grommets & Conduit', 1),
  ('042', '006', 'Auxiliary Power Distribution', 1),
  ('042', '007', 'Connectors & Terminals', 1);

-- System 045 — Tires & Wheels
INSERT OR IGNORE INTO ref_vmrs_assemblies (system_code, code, name, active) VALUES
  ('045', '001', 'Tire (Front)', 1),
  ('045', '002', 'Tire (Rear)', 1),
  ('045', '003', 'Wheel / Rim', 1),
  ('045', '004', 'Lug Nuts & Studs', 1),
  ('045', '005', 'Tire Pressure Monitoring (TPMS)', 1),
  ('045', '006', 'Wheel Center Cap', 1),
  ('045', '007', 'Spare Tire & Carrier', 1);

-- System 048 — Suspension Front
INSERT OR IGNORE INTO ref_vmrs_assemblies (system_code, code, name, active) VALUES
  ('048', '001', 'Strut / Shock Absorber', 1),
  ('048', '002', 'Control Arm', 1),
  ('048', '003', 'Ball Joint', 1),
  ('048', '004', 'Stabilizer / Sway Bar', 1),
  ('048', '005', 'Tie Rod End', 1),
  ('048', '006', 'Coil Spring / Leaf Spring', 1),
  ('048', '007', 'Steering Knuckle', 1);

-- System 049 — Suspension Rear
INSERT OR IGNORE INTO ref_vmrs_assemblies (system_code, code, name, active) VALUES
  ('049', '001', 'Shock Absorber (Rear)', 1),
  ('049', '002', 'Leaf Spring (Rear)', 1),
  ('049', '003', 'Coil Spring (Rear)', 1),
  ('049', '004', 'Trailing Arm', 1),
  ('049', '005', 'Stabilizer Bar (Rear)', 1),
  ('049', '006', 'Air Suspension', 1);

-- System 050 — Wheel Seals & Bearings
INSERT OR IGNORE INTO ref_vmrs_assemblies (system_code, code, name, active) VALUES
  ('050', '001', 'Wheel Bearing (Front)', 1),
  ('050', '002', 'Wheel Bearing (Rear)', 1),
  ('050', '003', 'Wheel Seal (Front)', 1),
  ('050', '004', 'Wheel Seal (Rear)', 1),
  ('050', '005', 'Hub Assembly', 1);

-- System 051 — Safety Equipment
INSERT OR IGNORE INTO ref_vmrs_assemblies (system_code, code, name, active) VALUES
  ('051', '001', 'Fire Extinguisher & Bracket', 1),
  ('051', '002', 'First Aid Kit', 1),
  ('051', '003', 'Reflective Triangles / Flares', 1),
  ('051', '004', 'Seat Belt Assembly', 1),
  ('051', '005', 'Airbag System', 1),
  ('051', '006', 'Horn', 1);

-- System 054 — External Lights
INSERT OR IGNORE INTO ref_vmrs_assemblies (system_code, code, name, active) VALUES
  ('054', '001', 'Headlamp Assembly', 1),
  ('054', '002', 'Tail / Brake Lamp', 1),
  ('054', '003', 'Turn Signal Lamp', 1),
  ('054', '004', 'License Plate Lamp', 1),
  ('054', '005', 'Side Marker Lamp', 1),
  ('054', '006', 'Reflector', 1);

-- System 056 — Speedometer & Hubodometer
INSERT OR IGNORE INTO ref_vmrs_assemblies (system_code, code, name, active) VALUES
  ('056', '001', 'Speedometer Head', 1),
  ('056', '002', 'Speed Sensor', 1),
  ('056', '003', 'Speedometer Cable', 1),
  ('056', '004', 'Hubodometer', 1);

-- System 059 — Steering
INSERT OR IGNORE INTO ref_vmrs_assemblies (system_code, code, name, active) VALUES
  ('059', '001', 'Steering Gear / Rack & Pinion', 1),
  ('059', '002', 'Steering Column', 1),
  ('059', '003', 'Steering Wheel', 1),
  ('059', '004', 'Power Steering Pump', 1),
  ('059', '005', 'Steering Linkage', 1),
  ('059', '006', 'Steering Damper', 1);

-- System 061 — Transmission Automatic
INSERT OR IGNORE INTO ref_vmrs_assemblies (system_code, code, name, active) VALUES
  ('061', '001', 'Transmission Assembly', 1),
  ('061', '002', 'Torque Converter', 1),
  ('061', '003', 'Transmission Control Module (TCM)', 1),
  ('061', '004', 'Transmission Cooler & Lines', 1),
  ('061', '005', 'Transmission Mount', 1),
  ('061', '006', 'Transmission Pan & Filter', 1),
  ('061', '007', 'Shift Linkage / Cable', 1);

-- System 062 — Transmission Manual
INSERT OR IGNORE INTO ref_vmrs_assemblies (system_code, code, name, active) VALUES
  ('062', '001', 'Transmission Assembly', 1),
  ('062', '002', 'Clutch Assembly', 1),
  ('062', '003', 'Clutch Master / Slave Cylinder', 1),
  ('062', '004', 'Shift Linkage', 1),
  ('062', '005', 'Transmission Mount', 1);

-- System 064 — Windows & Glass
INSERT OR IGNORE INTO ref_vmrs_assemblies (system_code, code, name, active) VALUES
  ('064', '001', 'Windshield', 1),
  ('064', '002', 'Rear Window / Glass', 1),
  ('064', '003', 'Side Window / Glass', 1),
  ('064', '004', 'Window Regulator & Motor', 1),
  ('064', '005', 'Window Switch', 1),
  ('064', '006', 'Door Glass Run Channel', 1);

-- System 065 — Wipers & Washers
INSERT OR IGNORE INTO ref_vmrs_assemblies (system_code, code, name, active) VALUES
  ('065', '001', 'Wiper Motor & Linkage', 1),
  ('065', '002', 'Wiper Arm & Blade', 1),
  ('065', '003', 'Washer Pump & Reservoir', 1),
  ('065', '004', 'Washer Nozzle & Hose', 1),
  ('065', '005', 'Rear Wiper Assembly', 1);

-- System 080 — Police / Emergency Equipment
INSERT OR IGNORE INTO ref_vmrs_assemblies (system_code, code, name, active) VALUES
  ('080', '001', 'Siren / PA System', 1),
  ('080', '002', 'Push Bumper / Ram Bar', 1),
  ('080', '003', 'Partition / Cage', 1),
  ('080', '004', 'Gun Rack / Mount', 1),
  ('080', '005', 'Console Mount / Organizer', 1),
  ('080', '006', 'Switch Panel / Controller', 1),
  ('080', '007', 'Floodlight / Scene Light', 1),
  ('080', '008', 'K9 Safety System', 1),
  ('080', '009', 'Shotgun / Rifle Lock', 1),
  ('080', '010', 'MDT / Laptop Mount (Upset)', 1);

-- System 081 — Radio & Communications
INSERT OR IGNORE INTO ref_vmrs_assemblies (system_code, code, name, active) VALUES
  ('081', '001', 'Two-Way Radio (Mobile)', 1),
  ('081', '002', 'Radio Antenna & Cable', 1),
  ('081', '003', 'Base Station / Dispatch Console', 1),
  ('081', '004', 'Headset / Hand Mic', 1),
  ('081', '005', 'Speaker / External Speaker', 1),
  ('081', '006', 'Mobile Data Terminal (MDT) Link', 1),
  ('081', '007', 'Radio Power Supply', 1);

-- System 082 — Computer & MDT
INSERT OR IGNORE INTO ref_vmrs_assemblies (system_code, code, name, active) VALUES
  ('082', '001', 'MDT / Laptop', 1),
  ('082', '002', 'Docking Station / Cradle', 1),
  ('082', '003', 'Power Inverter / Converter', 1),
  ('082', '004', 'Keyboard / Input Device', 1),
  ('082', '005', 'Mounting Bracket / Arm', 1),
  ('082', '006', 'Printer & Printer Mount', 1),
  ('082', '007', 'MDT Power Cable', 1),
  ('082', '008', 'GPS Receiver (MDT)', 1);

-- System 083 — Video & Dash Cam
INSERT OR IGNORE INTO ref_vmrs_assemblies (system_code, code, name, active) VALUES
  ('083', '001', 'Forward Dash Camera', 1),
  ('083', '002', 'Rear Camera (Cabin / Hold)', 1),
  ('083', '003', 'In-Car Camera System', 1),
  ('083', '004', 'DVR / Recording Module', 1),
  ('083', '005', 'Camera Mount / Bracket', 1),
  ('083', '006', 'Microphone (In-Car Audio)', 1),
  ('083', '007', 'Camera Control Module', 1);

-- System 084 — Lightbar & Emergency Warning
INSERT OR IGNORE INTO ref_vmrs_assemblies (system_code, code, name, active) VALUES
  ('084', '001', 'Lightbar (LED)', 1),
  ('084', '002', 'Grille / Deck Lights', 1),
  ('084', '003', 'Intersection Warning Lights', 1),
  ('084', '004', 'Traffic Director / Arrow Board', 1),
  ('084', '005', 'Siren Speaker (External)', 1),
  ('084', '006', 'Lightbar Mount & Brackets', 1),
  ('084', '007', 'Emergency Lighting Controller', 1);

-- ===================================================================
-- REF_VMRS_COMPONENTS
-- ===================================================================

-- System 013 — Brake Components
INSERT OR IGNORE INTO ref_vmrs_components (system_code, assembly_code, code, name, active) VALUES
  ('013', '001', '001', 'Air Brake Chamber', 1),
  ('013', '001', '002', 'Brake Shoe / Lining (Air)', 1),
  ('013', '001', '003', 'S-Cam / Camshaft', 1),
  ('013', '002', '001', 'Brake Caliper', 1),
  ('013', '002', '002', 'Disc Brake Pad', 1),
  ('013', '002', '003', 'Brake Rotor', 1),
  ('013', '002', '004', 'Brake Hose (Hydraulic)', 1),
  ('013', '003', '001', 'Parking Brake Valve', 1),
  ('013', '003', '002', 'Parking Brake Cable', 1),
  ('013', '003', '003', 'Parking Brake Actuator', 1),
  ('013', '004', '001', 'ABS Control Module', 1),
  ('013', '004', '002', 'ABS Wheel Speed Sensor', 1),
  ('013', '004', '003', 'ABS Tone Ring', 1),
  ('013', '004', '004', 'ABS Valve Block', 1),
  ('013', '005', '001', 'Air Compressor Head', 1),
  ('013', '005', '002', 'Air Compressor Unloader Valve', 1),
  ('013', '005', '003', 'Air Compressor Filter', 1),
  ('013', '006', '001', 'Air Dryer Cartridge', 1),
  ('013', '006', '002', 'Air Dryer Heater Element', 1),
  ('013', '006', '003', 'Air Dryer Purge Valve', 1),
  ('013', '007', '001', 'Air Tank', 1),
  ('013', '007', '002', 'Air Line / Tubing', 1),
  ('013', '007', '003', 'Drain Valve (Air Tank)', 1),
  ('013', '007', '004', 'Air Fitting / Coupling', 1),
  ('013', '008', '001', 'Treadle Valve / Brake Pedal Valve', 1),
  ('013', '008', '002', 'Relay Valve', 1),
  ('013', '008', '003', 'Quick Release Valve', 1),
  ('013', '008', '004', 'Inversion Valve', 1),
  ('013', '009', '001', 'Brake Chamber (Type 20/24/30)', 1),
  ('013', '009', '002', 'Slack Adjuster (Automatic)', 1),
  ('013', '009', '003', 'Slack Adjuster (Manual)', 1),
  ('013', '009', '004', 'Push Rod', 1),
  ('013', '010', '001', 'Brake Pad Set (Disc)', 1),
  ('013', '010', '002', 'Brake Shoe Set (Drum)', 1),
  ('013', '011', '001', 'Brake Rotor (Disc)', 1),
  ('013', '011', '002', 'Brake Drum', 1);

-- System 017 — Engine Components
INSERT OR IGNORE INTO ref_vmrs_components (system_code, assembly_code, code, name, active) VALUES
  ('017', '001', '001', 'Engine Block (Short)', 1),
  ('017', '001', '002', 'Cylinder Head', 1),
  ('017', '001', '003', 'Head Gasket', 1),
  ('017', '001', '004', 'Main Bearing Set', 1),
  ('017', '002', '001', 'Crankshaft', 1),
  ('017', '002', '002', 'Piston & Ring Set', 1),
  ('017', '002', '003', 'Connecting Rod', 1),
  ('017', '002', '004', 'Piston Pin', 1),
  ('017', '003', '001', 'Camshaft', 1),
  ('017', '003', '002', 'Lifter / Tappet', 1),
  ('017', '003', '003', 'Push Rod (Valve Train)', 1),
  ('017', '003', '004', 'Rocker Arm Assembly', 1),
  ('017', '003', '005', 'Valve / Valve Spring', 1),
  ('017', '003', '006', 'Timing Chain / Belt', 1),
  ('017', '004', '001', 'Oil Pump', 1),
  ('017', '004', '002', 'Oil Pan', 1),
  ('017', '004', '003', 'Oil Pickup Tube', 1),
  ('017', '005', '001', 'Engine Mount (Left)', 1),
  ('017', '005', '002', 'Engine Mount (Right)', 1),
  ('017', '005', '003', 'Engine Mount Bracket', 1),
  ('017', '006', '001', 'Turbocharger Assembly', 1),
  ('017', '006', '002', 'Turbo Oil Line', 1),
  ('017', '006', '003', 'Wastegate Actuator', 1),
  ('017', '006', '004', 'Intercooler Pipe', 1),
  ('017', '007', '001', 'Serpentine Belt', 1),
  ('017', '007', '002', 'Tensioner Assembly', 1),
  ('017', '007', '003', 'Idler Pulley', 1),
  ('017', '008', '001', 'Valve Cover Gasket', 1),
  ('017', '008', '002', 'Oil Pan Gasket', 1),
  ('017', '008', '003', 'Intake Manifold Gasket', 1),
  ('017', '009', '001', 'PCV Valve', 1),
  ('017', '009', '002', 'EGR Valve', 1),
  ('017', '010', '001', 'Crankshaft Position Sensor', 1),
  ('017', '010', '002', 'Camshaft Position Sensor', 1),
  ('017', '010', '003', 'Knock Sensor', 1),
  ('017', '010', '004', 'Engine Wiring Harness', 1),
  ('017', '011', '001', 'Flywheel', 1),
  ('017', '011', '002', 'Flexplate', 1),
  ('017', '011', '003', 'Flywheel Ring Gear', 1);

-- System 036 — Charging System Components
INSERT OR IGNORE INTO ref_vmrs_components (system_code, assembly_code, code, name, active) VALUES
  ('036', '001', '001', 'Alternator (Standard)', 1),
  ('036', '001', '002', 'Alternator (High-Output)', 1),
  ('036', '001', '003', 'Alternator Pulley', 1),
  ('036', '001', '004', 'Alternator Bracket', 1),
  ('036', '002', '001', 'Voltage Regulator (Internal)', 1),
  ('036', '002', '002', 'Voltage Regulator (External)', 1),
  ('036', '003', '001', 'Battery (Lead-Acid)', 1),
  ('036', '003', '002', 'Battery (AGM)', 1),
  ('036', '003', '003', 'Battery Terminal', 1),
  ('036', '004', '001', 'Battery Tray', 1),
  ('036', '004', '002', 'Battery Hold-down', 1),
  ('036', '005', '001', 'Battery Cable (Positive)', 1),
  ('036', '005', '002', 'Battery Cable (Negative)', 1),
  ('036', '005', '003', 'Alternator Wire Harness', 1);

-- System 042 — Electrical Components
INSERT OR IGNORE INTO ref_vmrs_components (system_code, assembly_code, code, name, active) VALUES
  ('042', '001', '001', 'Engine Harness', 1),
  ('042', '001', '002', 'Cab Harness', 1),
  ('042', '001', '003', 'Chassis Harness', 1),
  ('042', '002', '001', 'Tail Light Harness', 1),
  ('042', '002', '002', 'Door Harness', 1),
  ('042', '003', '001', 'Fuse Box (Under Hood)', 1),
  ('042', '003', '002', 'Fuse Box (Interior)', 1),
  ('042', '003', '003', 'Power Distribution Center', 1),
  ('042', '003', '004', 'Relay (Mini / Micro)', 1),
  ('042', '004', '001', 'Engine Ground Strap', 1),
  ('042', '004', '002', 'Chassis Ground Cable', 1),
  ('042', '005', '001', 'Wire Loom / Conduit', 1),
  ('042', '005', '002', 'Rubber Grommet', 1),
  ('042', '006', '001', 'Auxiliary Fuse Block', 1),
  ('042', '006', '002', 'Power Distribution Terminal', 1),
  ('042', '007', '001', 'Weather Pack Connector', 1),
  ('042', '007', '002', 'Deutsch Connector', 1),
  ('042', '007', '003', 'Butt Connector / Splice', 1);

-- System 080 — Police Equipment Components
INSERT OR IGNORE INTO ref_vmrs_components (system_code, assembly_code, code, name, active) VALUES
  ('080', '001', '001', 'Siren Amplifier', 1),
  ('080', '001', '002', 'Siren Speaker (Interior)', 1),
  ('080', '001', '003', 'Siren Control Head', 1),
  ('080', '001', '004', 'PA Microphone', 1),
  ('080', '002', '001', 'Push Bumper (Steel)', 1),
  ('080', '002', '002', 'Push Bumper (Aluminum)', 1),
  ('080', '002', '003', 'Push Bumper Mount Bracket', 1),
  ('080', '003', '001', 'Seat Partition (Full)', 1),
  ('080', '003', '002', 'Seat Partition (Half)', 1),
  ('080', '003', '003', 'Door Panel / Insert', 1),
  ('080', '004', '001', 'Shotgun Rack', 1),
  ('080', '004', '002', 'Rifle Rack', 1),
  ('080', '004', '003', 'Gun Lock (Electric)', 1),
  ('080', '004', '004', 'Gun Lock (Mechanical)', 1),
  ('080', '005', '001', 'Center Console (Full)', 1),
  ('080', '005', '002', 'Floor Mount Console', 1),
  ('080', '006', '001', 'Switch Panel (Multi-position)', 1),
  ('080', '006', '002', 'Master Disconnect Switch', 1),
  ('080', '006', '003', 'Auxiliary Lighting Controller', 1),
  ('080', '007', '001', 'Scene Light (LED)', 1),
  ('080', '007', '002', 'Alley Light', 1),
  ('080', '007', '003', 'Spotlight (Hand-held)', 1),
  ('080', '007', '004', 'Take-down Light', 1),
  ('080', '008', '001', 'K9 Temperature Monitor', 1),
  ('080', '008', '002', 'K9 Door Pop Kit', 1),
  ('080', '009', '001', 'Weapons Vault (Electronic)', 1),
  ('080', '009', '002', 'Weapons Vault (Mechanical)', 1);

-- System 081 — Radio Components
INSERT OR IGNORE INTO ref_vmrs_components (system_code, assembly_code, code, name, active) VALUES
  ('081', '001', '001', 'Mobile Radio (VHF)', 1),
  ('081', '001', '002', 'Mobile Radio (UHF)', 1),
  ('081', '001', '003', 'Mobile Radio (P25)', 1),
  ('081', '001', '004', 'Multi-band Radio', 1),
  ('081', '002', '001', 'Antenna (VHF Whip)', 1),
  ('081', '002', '002', 'Antenna (UHF Whip)', 1),
  ('081', '002', '003', 'Antenna Cable / Coax', 1),
  ('081', '002', '004', 'Antenna Mount Bracket', 1),
  ('081', '003', '001', 'Dispatch Console (Base)', 1),
  ('081', '003', '002', 'Base Station Antenna', 1),
  ('081', '004', '001', 'Hand Mic / Speaker Mic', 1),
  ('081', '004', '002', 'Headset (Noise Canceling)', 1),
  ('081', '004', '003', 'Earpiece / Lapel Mic', 1),
  ('081', '005', '001', 'External Speaker', 1),
  ('081', '005', '002', 'Speaker Bracket', 1),
  ('081', '006', '001', 'MDT Serial / Data Cable', 1),
  ('081', '006', '002', 'Bluetooth Adapter (Radio)', 1),
  ('081', '007', '001', 'Radio Power Supply (12V)', 1),
  ('081', '007', '002', 'Radio Power Cable', 1);

-- System 082 — Computer / MDT Components
INSERT OR IGNORE INTO ref_vmrs_components (system_code, assembly_code, code, name, active) VALUES
  ('082', '001', '001', 'Laptop (Ruggedized)', 1),
  ('082', '001', '002', 'Tablet (Ruggedized)', 1),
  ('082', '001', '003', 'MDT Terminal', 1),
  ('082', '002', '001', 'Docking Station (Laptop)', 1),
  ('082', '002', '002', 'Docking Station (Tablet)', 1),
  ('082', '002', '003', 'Dock Release / Eject Mechanism', 1),
  ('082', '003', '001', 'DC-AC Power Inverter', 1),
  ('082', '003', '002', 'DC-DC Converter', 1),
  ('082', '003', '003', 'UPS Battery Backup', 1),
  ('082', '004', '001', 'Keyboard (Ruggedized)', 1),
  ('082', '004', '002', 'Touchpad / Mouse', 1),
  ('082', '005', '001', 'Laptop Mount (Floor)', 1),
  ('082', '005', '002', 'Laptop Mount (Console)', 1),
  ('082', '005', '003', 'Mount Arm / Extension', 1),
  ('082', '006', '001', 'Mobile Printer', 1),
  ('082', '006', '002', 'Printer Mount Bracket', 1),
  ('082', '006', '003', 'Printer Paper / Roll', 1),
  ('082', '007', '001', 'MDT Power Harness', 1),
  ('082', '007', '002', 'Ignition-sense Wire', 1),
  ('082', '008', '001', 'GPS Antenna (MDT)', 1),
  ('082', '008', '002', 'GPS Receiver Module', 1);

-- System 083 — Video / Dash Cam Components
INSERT OR IGNORE INTO ref_vmrs_components (system_code, assembly_code, code, name, active) VALUES
  ('083', '001', '001', 'Dash Camera (Forward)', 1),
  ('083', '001', '002', 'Dash Camera Lens', 1),
  ('083', '001', '003', 'Dash Camera Cable', 1),
  ('083', '002', '001', 'Rear Camera (Cabin)', 1),
  ('083', '002', '002', 'Rear Camera (Trunk / K9)', 1),
  ('083', '003', '001', 'In-Car Camera Module', 1),
  ('083', '003', '002', 'In-Car Camera Cable', 1),
  ('083', '004', '001', 'DVR Module', 1),
  ('083', '004', '002', 'DVR Hard Drive / SSD', 1),
  ('083', '004', '003', 'DVR Power Supply', 1),
  ('083', '005', '001', 'Windshield Camera Mount', 1),
  ('083', '005', '002', 'Rear Camera Bracket', 1),
  ('083', '006', '001', 'In-Car Microphone', 1),
  ('083', '006', '002', 'Microphone Cable', 1),
  ('083', '007', '001', 'Camera Control Module', 1),
  ('083', '007', '002', 'Camera Wiring Harness', 1);

-- System 084 — Lightbar / Emergency Warning Components
INSERT OR IGNORE INTO ref_vmrs_components (system_code, assembly_code, code, name, active) VALUES
  ('084', '001', '001', 'Lightbar (LED Full-size)', 1),
  ('084', '001', '002', 'Lightbar (LED Compact)', 1),
  ('084', '001', '003', 'Lightbar Lens / Cover', 1),
  ('084', '001', '004', 'Lightbar LED Module', 1),
  ('084', '002', '001', 'Grille Light (LED)', 1),
  ('084', '002', '002', 'Deck Light (LED)', 1),
  ('084', '002', '003', 'Dash Light (LED)', 1),
  ('084', '003', '001', 'Intersection Light (Whelen)', 1),
  ('084', '003', '002', 'Side Warning Light', 1),
  ('084', '004', '001', 'Traffic Director (LED)', 1),
  ('084', '004', '002', 'Arrow Stick Controller', 1),
  ('084', '005', '001', 'Siren Speaker (100W)', 1),
  ('084', '005', '002', 'Siren Speaker (200W)', 1),
  ('084', '006', '001', 'Lightbar Mount Foot', 1),
  ('084', '006', '002', 'Lightbar Fairing / Spoiler', 1),
  ('084', '007', '001', 'Emergency Light Controller', 1),
  ('084', '007', '002', 'Flash Pattern Module', 1);

-- Additional key systems with lighter seed coverage

-- System 045 — Tires & Wheels
INSERT OR IGNORE INTO ref_vmrs_components (system_code, assembly_code, code, name, active) VALUES
  ('045', '001', '001', 'Tire (P-metric)', 1),
  ('045', '001', '002', 'Tire (LT-metric)', 1),
  ('045', '002', '001', 'Tire (P-metric Rear)', 1),
  ('045', '002', '002', 'Tire (LT-metric Rear)', 1),
  ('045', '003', '001', 'Steel Wheel', 1),
  ('045', '003', '002', 'Alloy Wheel', 1),
  ('045', '004', '001', 'Lug Nut', 1),
  ('045', '004', '002', 'Wheel Stud', 1),
  ('045', '005', '001', 'TPMS Sensor', 1),
  ('045', '006', '001', 'Center Cap', 1),
  ('045', '007', '001', 'Spare Tire Hoist', 1),
  ('045', '007', '002', 'Spare Tire Bracket', 1);

-- System 061 — Transmission (Automatic) Components
INSERT OR IGNORE INTO ref_vmrs_components (system_code, assembly_code, code, name, active) VALUES
  ('061', '001', '001', 'Transmission (Remanufactured)', 1),
  ('061', '001', '002', 'Transmission Case', 1),
  ('061', '002', '001', 'Torque Converter', 1),
  ('061', '003', '001', 'TCM (Transmission Control Module)', 1),
  ('061', '003', '002', 'Transmission Speed Sensor', 1),
  ('061', '004', '001', 'Transmission Cooler', 1),
  ('061', '004', '002', 'Transmission Cooler Line', 1),
  ('061', '005', '001', 'Transmission Mount', 1),
  ('061', '006', '001', 'Transmission Pan', 1),
  ('061', '006', '002', 'Transmission Filter', 1),
  ('061', '006', '003', 'Transmission Gasket', 1),
  ('061', '007', '001', 'Shift Cable', 1),
  ('061', '007', '002', 'Shift Linkage Bushing', 1);

-- System 065 — Wipers Components
INSERT OR IGNORE INTO ref_vmrs_components (system_code, assembly_code, code, name, active) VALUES
  ('065', '001', '001', 'Wiper Motor', 1),
  ('065', '001', '002', 'Wiper Linkage', 1),
  ('065', '001', '003', 'Wiper Transmission', 1),
  ('065', '002', '001', 'Wiper Arm', 1),
  ('065', '002', '002', 'Wiper Blade (Standard)', 1),
  ('065', '002', '003', 'Wiper Blade (Beam)', 1),
  ('065', '003', '001', 'Washer Pump', 1),
  ('065', '003', '002', 'Washer Reservoir', 1),
  ('065', '003', '003', 'Washer Level Sensor', 1),
  ('065', '004', '001', 'Washer Nozzle', 1),
  ('065', '004', '002', 'Washer Hose', 1);

-- System 034 — Cooling Components
INSERT OR IGNORE INTO ref_vmrs_components (system_code, assembly_code, code, name, active) VALUES
  ('034', '001', '001', 'Radiator', 1),
  ('034', '001', '002', 'Radiator Fan (Electric)', 1),
  ('034', '001', '003', 'Radiator Fan (Mechanical)', 1),
  ('034', '001', '004', 'Radiator Shroud', 1),
  ('034', '001', '005', 'Radiator Cap', 1),
  ('034', '002', '001', 'Water Pump', 1),
  ('034', '002', '002', 'Water Pump Gasket', 1),
  ('034', '003', '001', 'Thermostat', 1),
  ('034', '003', '002', 'Thermostat Housing', 1),
  ('034', '004', '001', 'Upper Radiator Hose', 1),
  ('034', '004', '002', 'Lower Radiator Hose', 1),
  ('034', '004', '003', 'Heater Hose', 1),
  ('034', '005', '001', 'Coolant Reservoir Tank', 1),
  ('034', '006', '001', 'Intercooler', 1),
  ('034', '006', '002', 'Intercooler Pipe', 1);

-- System 059 — Steering Components
INSERT OR IGNORE INTO ref_vmrs_components (system_code, assembly_code, code, name, active) VALUES
  ('059', '001', '001', 'Steering Rack', 1),
  ('059', '001', '002', 'Steering Gear Box', 1),
  ('059', '002', '001', 'Steering Column Assembly', 1),
  ('059', '002', '002', 'Steering Column U-Joint', 1),
  ('059', '003', '001', 'Steering Wheel', 1),
  ('059', '004', '001', 'Power Steering Pump', 1),
  ('059', '004', '002', 'Power Steering Hose (Pressure)', 1),
  ('059', '004', '003', 'Power Steering Hose (Return)', 1),
  ('059', '004', '004', 'Power Steering Fluid Reservoir', 1),
  ('059', '005', '001', 'Inner Tie Rod', 1),
  ('059', '005', '002', 'Outer Tie Rod', 1),
  ('059', '005', '003', 'Pitman Arm', 1),
  ('059', '005', '004', 'Idler Arm', 1),
  ('059', '006', '001', 'Steering Damper / Stabilizer', 1);

-- System 048 — Front Suspension Components
INSERT OR IGNORE INTO ref_vmrs_components (system_code, assembly_code, code, name, active) VALUES
  ('048', '001', '001', 'Strut Assembly (Front)', 1),
  ('048', '001', '002', 'Shock Absorber (Front)', 1),
  ('048', '002', '001', 'Upper Control Arm', 1),
  ('048', '002', '002', 'Lower Control Arm', 1),
  ('048', '003', '001', 'Upper Ball Joint', 1),
  ('048', '003', '002', 'Lower Ball Joint', 1),
  ('048', '004', '001', 'Stabilizer Bar (Front)', 1),
  ('048', '004', '002', 'Stabilizer End Link', 1),
  ('048', '004', '003', 'Stabilizer Bushing', 1),
  ('048', '005', '001', 'Tie Rod End (Inner)', 1),
  ('048', '005', '002', 'Tie Rod End (Outer)', 1),
  ('048', '006', '001', 'Coil Spring (Front)', 1),
  ('048', '007', '001', 'Steering Knuckle', 1);

-- System 049 — Rear Suspension Components
INSERT OR IGNORE INTO ref_vmrs_components (system_code, assembly_code, code, name, active) VALUES
  ('049', '001', '001', 'Shock Absorber (Rear)', 1),
  ('049', '002', '001', 'Leaf Spring', 1),
  ('049', '002', '002', 'Spring Bushing', 1),
  ('049', '002', '003', 'Spring Hanger', 1),
  ('049', '002', '004', 'U-Bolt', 1),
  ('049', '003', '001', 'Coil Spring (Rear)', 1),
  ('049', '004', '001', 'Trailing Arm', 1),
  ('049', '005', '001', 'Stabilizer Bar (Rear)', 1),
  ('049', '006', '001', 'Air Spring / Air Bag', 1),
  ('049', '006', '002', 'Air Leveling Valve', 1);

-- System 051 — Safety Equipment Components
INSERT OR IGNORE INTO ref_vmrs_components (system_code, assembly_code, code, name, active) VALUES
  ('051', '001', '001', 'Fire Extinguisher (ABC)', 1),
  ('051', '001', '002', 'Fire Extinguisher Bracket', 1),
  ('051', '002', '001', 'First Aid Kit (Standard)', 1),
  ('051', '002', '002', 'First Aid Kit (Trauma)', 1),
  ('051', '003', '001', 'Reflective Triangle Set', 1),
  ('051', '003', '002', 'Road Flare (LED)', 1),
  ('051', '004', '001', 'Seat Belt Buckle', 1),
  ('051', '004', '002', 'Seat Belt Retractor', 1),
  ('051', '004', '003', 'Seat Belt Webbing', 1),
  ('051', '005', '001', 'Airbag Module (Driver)', 1),
  ('051', '005', '002', 'Airbag Module (Passenger)', 1),
  ('051', '005', '003', 'Airbag Clock Spring', 1),
  ('051', '006', '001', 'Horn (High Note)', 1),
  ('051', '006', '002', 'Horn (Low Note)', 1),
  ('051', '006', '003', 'Horn Relay', 1);

-- System 064 — Window Components
INSERT OR IGNORE INTO ref_vmrs_components (system_code, assembly_code, code, name, active) VALUES
  ('064', '001', '001', 'Windshield (Laminated)', 1),
  ('064', '001', '002', 'Windshield Molding', 1),
  ('064', '002', '001', 'Rear Window (Tempered)', 1),
  ('064', '003', '001', 'Side Window (Tempered)', 1),
  ('064', '003', '002', 'Quarter Window', 1),
  ('064', '004', '001', 'Window Regulator (Power)', 1),
  ('064', '004', '002', 'Window Motor', 1),
  ('064', '005', '001', 'Window Switch (Driver)', 1),
  ('064', '005', '002', 'Window Switch (Passenger)', 1),
  ('064', '006', '001', 'Glass Run Channel', 1);

-- System 050 — Wheel Seal / Bearing Components
INSERT OR IGNORE INTO ref_vmrs_components (system_code, assembly_code, code, name, active) VALUES
  ('050', '001', '001', 'Wheel Bearing (Inner Front)', 1),
  ('050', '001', '002', 'Wheel Bearing (Outer Front)', 1),
  ('050', '002', '001', 'Wheel Bearing (Rear)', 1),
  ('050', '003', '001', 'Wheel Seal (Inner)', 1),
  ('050', '003', '002', 'Wheel Seal (Outer)', 1),
  ('050', '004', '001', 'Wheel Seal (Rear)', 1),
  ('050', '005', '001', 'Hub Assembly (Front)', 1),
  ('050', '005', '002', 'Hub Assembly (Rear)', 1);

-- System 032 — Starting System Components
INSERT OR IGNORE INTO ref_vmrs_components (system_code, assembly_code, code, name, active) VALUES
  ('032', '001', '001', 'Starter Motor', 1),
  ('032', '002', '001', 'Starter Solenoid', 1),
  ('032', '003', '001', 'Ignition Switch', 1),
  ('032', '003', '002', 'Ignition Lock Cylinder', 1),
  ('032', '004', '001', 'Starter Relay', 1),
  ('032', '004', '002', 'Starter Wire Harness', 1),
  ('032', '005', '001', 'Battery Cable (Positive)', 1),
  ('032', '005', '002', 'Battery Cable (Negative)', 1);

-- System 021 — Fuel System Components
INSERT OR IGNORE INTO ref_vmrs_components (system_code, assembly_code, code, name, active) VALUES
  ('021', '001', '001', 'Fuel Tank', 1),
  ('021', '001', '002', 'Fuel Tank Strap', 1),
  ('021', '001', '003', 'Fuel Filler Neck', 1),
  ('021', '002', '001', 'Fuel Pump (In-tank)', 1),
  ('021', '002', '002', 'Fuel Pump Module', 1),
  ('021', '003', '001', 'Fuel Injector', 1),
  ('021', '003', '002', 'Fuel Rail', 1),
  ('021', '004', '001', 'Fuel Filter', 1),
  ('021', '004', '002', 'Fuel Water Separator', 1),
  ('021', '005', '001', 'Fuel Line (Steel)', 1),
  ('021', '005', '002', 'Fuel Line (Rubber)', 1),
  ('021', '006', '001', 'Throttle Body', 1),
  ('021', '007', '001', 'Fuel Sending Unit', 1);

-- System 037 — Lighting Components
INSERT OR IGNORE INTO ref_vmrs_components (system_code, assembly_code, code, name, active) VALUES
  ('037', '001', '001', 'Headlight (LED)', 1),
  ('037', '001', '002', 'Headlight (Halogen)', 1),
  ('037', '001', '003', 'Headlight Assembly (Left)', 1),
  ('037', '001', '004', 'Headlight Assembly (Right)', 1),
  ('037', '002', '001', 'Tail Light Assembly (Left)', 1),
  ('037', '002', '002', 'Tail Light Assembly (Right)', 1),
  ('037', '003', '001', 'Turn Signal Switch', 1),
  ('037', '003', '002', 'Turn Signal Flasher', 1),
  ('037', '004', '001', 'Fog Light Assembly', 1),
  ('037', '005', '001', 'Dome Light Assembly', 1),
  ('037', '006', '001', 'Headlight Switch', 1),
  ('037', '006', '002', 'Dimmer Switch', 1),
  ('037', '006', '003', 'Light Relay', 1);

-- System 023 — HVAC Components
INSERT OR IGNORE INTO ref_vmrs_components (system_code, assembly_code, code, name, active) VALUES
  ('023', '001', '001', 'A/C Compressor', 1),
  ('023', '001', '002', 'A/C Compressor Clutch', 1),
  ('023', '002', '001', 'A/C Condenser', 1),
  ('023', '002', '002', 'Condenser Fan', 1),
  ('023', '003', '001', 'A/C Evaporator', 1),
  ('023', '003', '002', 'Expansion Valve', 1),
  ('023', '004', '001', 'Heater Core', 1),
  ('023', '005', '001', 'Blower Motor', 1),
  ('023', '005', '002', 'Blower Motor Resistor', 1),
  ('023', '005', '003', 'Blower Motor Relay', 1),
  ('023', '006', '001', 'A/C Line (Suction)', 1),
  ('023', '006', '002', 'A/C Line (Discharge)', 1),
  ('023', '006', '003', 'A/C O-Ring / Seal Kit', 1),
  ('023', '007', '001', 'HVAC Control Head', 1),
  ('023', '007', '002', 'Blend Door Actuator', 1),
  ('023', '007', '003', 'Mode Door Actuator', 1);

-- System 018 — Exhaust Components
INSERT OR IGNORE INTO ref_vmrs_components (system_code, assembly_code, code, name, active) VALUES
  ('018', '001', '001', 'Exhaust Manifold (Left)', 1),
  ('018', '001', '002', 'Exhaust Manifold (Right)', 1),
  ('018', '001', '003', 'Exhaust Manifold Gasket', 1),
  ('018', '002', '001', 'Catalytic Converter', 1),
  ('018', '002', '002', 'Catalytic Converter Gasket', 1),
  ('018', '003', '001', 'Muffler', 1),
  ('018', '003', '002', 'Resonator', 1),
  ('018', '004', '001', 'Exhaust Pipe (Intermediate)', 1),
  ('018', '004', '002', 'Exhaust Pipe (Tail)', 1),
  ('018', '004', '003', 'Exhaust Hanger / Bracket', 1),
  ('018', '005', '001', 'DPF (Diesel Particulate Filter)', 1),
  ('018', '005', '002', 'DPF Pressure Sensor', 1),
  ('018', '006', '001', 'EGR Cooler', 1),
  ('018', '006', '002', 'EGR Valve', 1);

-- System 026 — Instruments Components
INSERT OR IGNORE INTO ref_vmrs_components (system_code, assembly_code, code, name, active) VALUES
  ('026', '001', '001', 'Instrument Cluster', 1),
  ('026', '001', '002', 'Instrument Cluster Lens', 1),
  ('026', '002', '001', 'Speedometer Head', 1),
  ('026', '003', '001', 'Tachometer', 1),
  ('026', '004', '001', 'Temperature Gauge', 1),
  ('026', '005', '001', 'Oil Pressure Gauge', 1),
  ('026', '005', '002', 'Oil Pressure Sender', 1),
  ('026', '006', '001', 'Voltmeter', 1),
  ('026', '007', '001', 'Fuel Level Gauge', 1),
  ('026', '008', '001', 'Check Engine Light', 1),
  ('026', '008', '002', 'ABS Warning Light', 1),
  ('026', '008', '003', 'Airbag Warning Light', 1);

-- System 014 — Cab Interior Components
INSERT OR IGNORE INTO ref_vmrs_components (system_code, assembly_code, code, name, active) VALUES
  ('014', '001', '001', 'Driver Seat Assembly', 1),
  ('014', '001', '002', 'Passenger Seat Assembly', 1),
  ('014', '001', '003', 'Seat Recliner Mechanism', 1),
  ('014', '001', '004', 'Seat Heater Element', 1),
  ('014', '002', '001', 'Dashboard Panel', 1),
  ('014', '002', '002', 'Center Stack Trim', 1),
  ('014', '003', '001', 'Floor Mat (Driver)', 1),
  ('014', '003', '002', 'Carpet (Front)', 1),
  ('014', '004', '001', 'Door Panel (Driver)', 1),
  ('014', '004', '002', 'A-Pillar Trim', 1),
  ('014', '004', '003', 'Headliner', 1),
  ('014', '005', '001', 'HVAC Vent / Register', 1),
  ('014', '005', '002', 'HVAC Duct', 1);

-- System 035 — Bumper Components
INSERT OR IGNORE INTO ref_vmrs_components (system_code, assembly_code, code, name, active) VALUES
  ('035', '001', '001', 'Front Bumper Cover', 1),
  ('035', '001', '002', 'Front Bumper Reinforcement', 1),
  ('035', '002', '001', 'Rear Bumper Cover', 1),
  ('035', '002', '002', 'Rear Bumper Reinforcement', 1),
  ('035', '003', '001', 'Push Bumper (Police)', 1),
  ('035', '004', '001', 'Bumper Mount Bracket', 1);

-- System 054 — External Lights Components
INSERT OR IGNORE INTO ref_vmrs_components (system_code, assembly_code, code, name, active) VALUES
  ('054', '001', '001', 'Headlamp (LED)', 1),
  ('054', '001', '002', 'Headlamp (Halogen)', 1),
  ('054', '002', '001', 'Tail Lamp Assembly', 1),
  ('054', '002', '002', 'Brake Light Switch', 1),
  ('054', '003', '001', 'Turn Signal Lamp', 1),
  ('054', '004', '001', 'License Plate Lamp', 1),
  ('054', '005', '001', 'Side Marker Lamp', 1),
  ('054', '006', '001', 'Red Reflector', 1),
  ('054', '006', '002', 'Amber Reflector', 1);

-- System 056 — Speedometer Components
INSERT OR IGNORE INTO ref_vmrs_components (system_code, assembly_code, code, name, active) VALUES
  ('056', '001', '001', 'Speedometer (Analog)', 1),
  ('056', '001', '002', 'Speedometer (Digital)', 1),
  ('056', '002', '001', 'Vehicle Speed Sensor (VSS)', 1),
  ('056', '003', '001', 'Speedometer Cable', 1),
  ('056', '004', '001', 'Hubodometer', 1);

-- System 022 — Gears Components
INSERT OR IGNORE INTO ref_vmrs_components (system_code, assembly_code, code, name, active) VALUES
  ('022', '001', '001', 'Ring Gear', 1),
  ('022', '001', '002', 'Pinion Gear', 1),
  ('022', '002', '001', 'Differential Carrier Assembly', 1),
  ('022', '002', '002', 'Differential Gasket', 1),
  ('022', '003', '001', 'Axle Shaft (Left)', 1),
  ('022', '003', '002', 'Axle Shaft (Right)', 1),
  ('022', '004', '001', 'U-Joint', 1),
  ('022', '004', '002', 'CV Joint Assembly', 1),
  ('022', '005', '001', 'Drive Shaft', 1),
  ('022', '005', '002', 'Drive Shaft Center Bearing', 1);

-- System 062 — Manual Transmission Components
INSERT OR IGNORE INTO ref_vmrs_components (system_code, assembly_code, code, name, active) VALUES
  ('062', '001', '001', 'Transmission (Remanufactured)', 1),
  ('062', '001', '002', 'Transmission Case', 1),
  ('062', '002', '001', 'Clutch Disc', 1),
  ('062', '002', '002', 'Clutch Pressure Plate', 1),
  ('062', '002', '003', 'Clutch Release Bearing', 1),
  ('062', '003', '001', 'Clutch Master Cylinder', 1),
  ('062', '003', '002', 'Clutch Slave Cylinder', 1),
  ('062', '004', '001', 'Shift Linkage', 1),
  ('062', '005', '001', 'Transmission Mount', 1);

-- System 025 — Hydraulic Components
INSERT OR IGNORE INTO ref_vmrs_components (system_code, assembly_code, code, name, active) VALUES
  ('025', '001', '001', 'Hydraulic Pump', 1),
  ('025', '002', '001', 'Hydraulic Cylinder', 1),
  ('025', '003', '001', 'Hydraulic Hose', 1),
  ('025', '003', '002', 'Hydraulic Fitting', 1),
  ('025', '004', '001', 'Hydraulic Valve Body', 1),
  ('025', '005', '001', 'Hydraulic Fluid Reservoir', 1);
