// ============================================================
// RMPG Flex — OSM overlay paint kit (utilitarian CAD)
// ============================================================
// Per-category identity colors, line dashes, and fill opacity. These
// feed Mapbox paint properties — literal hex is required (var() blank).
// Severity hues keep CAD meaning: red = fire/life safety / hazard,
// amber = caution, green = ok/drivable attribute. No decorative gold.
// ============================================================

const SILVER = '#c3ccd6';
const SILVER_DIM = '#a0adbd';
const SILVER_DEEP = '#7c8b9e';

export const OSM_COLOR_BY_GROUP: Record<string, string> = {
  surveillance: SILVER,
  traffic: '#d0d8e0',
  safety: '#ef4444',
  utility: SILVER_DIM,
  sites: SILVER_DEEP,
  access: SILVER,
  drivability: '#7dd3fc',
  terrain: '#f59e0b',
  jurisdiction: SILVER_DIM,
};

/** Overrides the group color when the category is its own operational object. */
export const OSM_COLOR_BY_CAT: Record<string, string> = {
  alpr: '#38bdf8',
  camera: '#a78bfa',
  camera_cone: '#a78bfa',
  hydrant: '#ef4444',
  inlet: '#f97316',
  emerg: '#fb7185',
  water: '#38bdf8',
  station: '#ef4444',
  heli: '#c084fc',
  control: '#f59e0b',
  crossing: '#f8fafc',
  calming: '#f59e0b',
  junction: '#e2e8f0',
  access_pt: '#c3ccd6',
  maxspeed: '#e2e8f0',
  restriction: '#f97316',
  power: '#a0adbd',
  pole: '#7c8b9e',
  gen: '#c3ccd6',
  comms: '#818cf8',
  pipeline: '#f59e0b',
  charging: '#22c55e',
  water_infra: '#38bdf8',
  water_works: '#0ea5e9',
  dam: '#38bdf8',
  school: '#f59e0b',
  financial: '#c3ccd6',
  regulated: '#f97316',
  alcohol: '#a78bfa',
  gov: '#60a5fa',
  lodging: '#c3ccd6',
  social: '#34d399',
  entrance: '#e2e8f0',
  bldg_height: '#7c8b9e',
  barrier: '#f97316',
  control_pt: '#f59e0b',
  rail_x: '#ef4444',
  rail_infra: '#c3ccd6',
  parking: '#60a5fa',
  clearance: '#f59e0b',
  transit: '#c3ccd6',
  lamp: '#e2e8f0',
  fourwd: '#f59e0b',
  ford: '#38bdf8',
  seasonal: '#818cf8',
  restricted: '#ef4444',
  unpaved: '#a0adbd',
  track: '#7c8b9e',
  cliff: '#f59e0b',
  cave: '#7c8b9e',
  mine: '#f97316',
  spring: '#38bdf8',
  hazard: '#ef4444',
  protected: '#22c55e',
  tribal: '#c084fc',
  military: '#ef4444',
  extraction: '#f59e0b',
};

export function osmColorFor(cat: string | undefined, group: string | undefined): string {
  if (cat && OSM_COLOR_BY_CAT[cat]) return OSM_COLOR_BY_CAT[cat];
  if (group && OSM_COLOR_BY_GROUP[group]) return OSM_COLOR_BY_GROUP[group];
  return SILVER;
}

/** Dashed line patterns for attributes that are NOT the basemap road. */
export const OSM_LINE_DASH: Record<string, number[]> = {
  restriction: [4, 2],
  unpaved: [1.6, 1.4],
  fourwd: [1, 1.6, 4, 1.6],
  seasonal: [1, 2.4],
  restricted: [4, 2],
  pipeline: [5, 2.4],
  track: [1.2, 2],
  cliff: [2, 1.2],
  maxspeed: [6, 3],
  clearance: [2, 2, 6, 2],
  power: [8, 3],
  dam: [4, 3],
  bldg_height: [1, 2.5],
};

export function osmLinePaint(cat: string, color: string, minzoom: number): Record<string, unknown> {
  const dash = OSM_LINE_DASH[cat];
  return {
    'line-color': color,
    'line-width': ['interpolate', ['linear'], ['zoom'], minzoom, 1, minzoom + 5, 2, 18, 3.5],
    'line-opacity': ['interpolate', ['linear'], ['zoom'], minzoom, 0.55, minzoom + 5, 0.85, 18, 0.95],
    ...(dash ? { 'line-dasharray': dash } : {}),
  };
}

export function osmFillPaint(cat: string, color: string): Record<string, unknown> {
  const hazard = cat === 'military' || cat === 'hazard' || cat === 'extraction';
  return {
    'fill-color': color,
    'fill-opacity': hazard
      ? ['interpolate', ['linear'], ['zoom'], 8, 0.12, 14, 0.22]
      : ['interpolate', ['linear'], ['zoom'], 8, 0.10, 14, 0.20, 18, 0.26],
    'fill-antialias': true,
  };
}

export function osmFillOutlinePaint(color: string): Record<string, unknown> {
  return {
    'line-color': color,
    'line-width': 1,
    'line-opacity': 0.65,
  };
}

export const OSM_CAT_DESCRIPTION: Record<string, string> = {
  alpr: 'Fixed automatic plate readers. Distinct from public CCTV. Crowd-sourced — unmapped readers will not appear.',
  camera: 'Public and other CCTV (not ALPR). No view cone means facing is unknown, not 360° coverage.',
  camera_cone: 'Mapped field of view from camera:direction. Cyan = ALPR, violet = public CCTV. Off until toggled.',
  hydrant: 'Fire hydrants. Bonnet colour is NFPA flow class when tagged.',
  inlet: 'Standpipe / FDC inlets. z16+ only.',
  emerg: 'Emergency phone, AED, siren, assembly point.',
  water: 'Alternate fire-water sources (pond, tank, suction).',
  station: 'Fire, police, hospital, ambulance stations.',
  heli: 'Helipads, aerodromes, emergency landing sites.',
  control: 'Stop, yield, and traffic signals.',
  maxspeed: 'Posted speed. Bare OSM numbers are km/h and convert to mph on the map.',
  restriction: 'One-way, maxheight, maxweight.',
  calming: 'Speed humps and other traffic calming.',
  crossing: 'Pedestrian crossings and school-zone hazards.',
  junction: 'Motorway exit numbers.',
  access_pt: 'Rest areas, services, emergency access points.',
  power: 'Substations and transmission lines.',
  pole: 'Power poles. z16 floor — statewide density.',
  gen: 'Generation plants.',
  comms: 'Communications masts.',
  pipeline: 'Mapped pipelines.',
  charging: 'EV charging.',
  water_infra: 'Water towers and tanks.',
  water_works: 'Pumping stations, water works, wastewater plants.',
  dam: 'Dams, weirs, dykes.',
  school: 'Schools and childcare.',
  financial: 'Banks and ATMs.',
  regulated: 'Pawn, firearms, jewelry, pharmacy.',
  alcohol: 'Bars, pubs, nightclubs.',
  gov: 'Courthouse, prison, town hall, post office.',
  lodging: 'Hotels, motels, fuel.',
  social: 'Shelters and social facilities.',
  entrance: 'Building entrances. z17+.',
  bldg_height: 'Tagged building height / floors.',
  barrier: 'Gates and barriers. Red-coded when access=private/no.',
  control_pt: 'Toll, border, height restrictor, sally port.',
  rail_x: 'Rail level crossings.',
  rail_infra: 'Signals, switches, buffer stops.',
  parking: 'Parking. Capacity labelled at z16+.',
  clearance: 'Bridge/tunnel maxheight, converted to feet.',
  transit: 'Transit stations.',
  lamp: 'Street lighting. z16+.',
  fourwd: '4WD-only / very-bad track. Warning hue.',
  ford: 'Roadway crosses water.',
  seasonal: 'Seasonal closure.',
  restricted: 'Motor-vehicle restricted / private access on ways.',
  unpaved: 'Unpaved / gravel / dirt. Dashed. Untagged is not confirmed paved.',
  track: 'highway=track, colour by grade when tagged.',
  cliff: 'Cliffs and steep terrain.',
  cave: 'Cave entrances and sinkholes.',
  mine: 'Mine shafts and adits.',
  spring: 'Springs and water sources.',
  hazard: 'Mapped natural/other hazards.',
  protected: 'Protected areas and parks. Not a legal determination.',
  tribal: 'Tribal lands. Not a legal determination.',
  military: 'Military areas. Not a legal determination.',
  extraction: 'Industrial extraction and disposal.',
};
