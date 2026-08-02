// GENERATED FILE — do not edit by hand.
// Source: config/osm-layers.json
// Regenerate: node scripts/gen-osm-client-config.mjs

export interface OsmCategory {
  cat: string;
  label: string;
  minzoom: number;
  render: 'point' | 'line' | 'polygon';
}

export interface OsmGroup {
  name: string;
  label: string;
  archive: string;
  geometry: 'point' | 'line' | 'polygon' | 'mixed';
  coverage: 'sparse' | 'incomplete' | 'attribute' | 'boundary';
  assignment: 'first-match' | 'multi';
  properties: string[];
  categories: OsmCategory[];
}

export const OSM_GROUPS: OsmGroup[] = [
  {
    name: 'surveillance',
    label: 'Surveillance & Canvass',
    archive: 'osm-surveillance.pmtiles',
    geometry: 'point',
    coverage: 'sparse',
    assignment: 'first-match',
    properties: ["name","surveillance","surveillance:type","surveillance:zone","camera:direction","camera:mount","camera:type","operator"],
    categories: [
      { cat: 'alpr', label: 'Cameras (ALPR)', minzoom: 14, render: 'point' },
      { cat: 'camera', label: 'Cameras (public)', minzoom: 15, render: 'point' },
      // Synthetic: derived by scripts/osm/transform.mjs from cameras
      // carrying a camera:direction tag. Not present in osm-layers.json.
      { cat: 'camera_cone', label: 'Camera view cones', minzoom: 14, render: 'polygon' },
    ],
  },
  {
    name: 'traffic',
    label: 'Traffic & Roadway',
    archive: 'osm-traffic.pmtiles',
    geometry: 'mixed',
    coverage: 'incomplete',
    assignment: 'multi',
    properties: ["name","ref","highway","maxspeed","oneway","maxheight","maxweight","traffic_calming","crossing","hazard","enforcement"],
    categories: [
      { cat: 'control', label: 'Traffic control', minzoom: 14, render: 'point' },
      { cat: 'maxspeed', label: 'Speed limits', minzoom: 13, render: 'line' },
      { cat: 'restriction', label: 'Restrictions', minzoom: 14, render: 'line' },
      { cat: 'calming', label: 'Traffic calming', minzoom: 15, render: 'point' },
      { cat: 'crossing', label: 'Crossings & school zones', minzoom: 15, render: 'point' },
      { cat: 'junction', label: 'Exit numbers', minzoom: 11, render: 'point' },
      { cat: 'access_pt', label: 'Rest & access points', minzoom: 11, render: 'point' },
    ],
  },
  {
    name: 'safety',
    label: 'Fire & Life Safety',
    archive: 'osm-safety.pmtiles',
    geometry: 'mixed',
    coverage: 'incomplete',
    assignment: 'first-match',
    properties: ["name","emergency","amenity","aeroway","fire_hydrant:type","colour","couplings","fire_hydrant:diameter","flow_rate","operator","ref"],
    categories: [
      { cat: 'hydrant', label: 'Fire hydrants', minzoom: 14, render: 'point' },
      { cat: 'water', label: 'Alt water sources', minzoom: 13, render: 'point' },
      { cat: 'emerg', label: 'Emergency infrastructure', minzoom: 13, render: 'point' },
      { cat: 'inlet', label: 'Standpipe & riser inlets', minzoom: 16, render: 'point' },
      { cat: 'heli', label: 'Helipads & airfields', minzoom: 11, render: 'point' },
      { cat: 'station', label: 'Stations', minzoom: 11, render: 'point' },
    ],
  },
  {
    name: 'utility',
    label: 'Utility Infrastructure',
    archive: 'osm-utility.pmtiles',
    geometry: 'mixed',
    coverage: 'incomplete',
    assignment: 'first-match',
    properties: ["name","power","man_made","waterway","amenity","operator","voltage","substation","generator:source","communication:mobile_phone","tower:type"],
    categories: [
      { cat: 'power', label: 'Substations & lines', minzoom: 10, render: 'line' },
      { cat: 'pole', label: 'Power poles', minzoom: 16, render: 'point' },
      { cat: 'gen', label: 'Generation', minzoom: 11, render: 'point' },
      { cat: 'comms', label: 'Comms masts', minzoom: 13, render: 'point' },
      { cat: 'water_infra', label: 'Water towers & tanks', minzoom: 13, render: 'point' },
      { cat: 'water_works', label: 'Water & wastewater works', minzoom: 12, render: 'point' },
      { cat: 'dam', label: 'Dams & control structures', minzoom: 11, render: 'line' },
      { cat: 'pipeline', label: 'Pipelines', minzoom: 12, render: 'line' },
      { cat: 'charging', label: 'EV charging', minzoom: 14, render: 'point' },
    ],
  },
  {
    name: 'sites',
    label: 'Sensitive & High-Risk Sites',
    archive: 'osm-sites.pmtiles',
    geometry: 'mixed',
    coverage: 'incomplete',
    assignment: 'multi',
    properties: ["name","amenity","shop","tourism","office","operator","entrance","building:levels","height","addr:housenumber","addr:street"],
    categories: [
      { cat: 'school', label: 'Schools & childcare', minzoom: 12, render: 'point' },
      { cat: 'financial', label: 'Financial', minzoom: 14, render: 'point' },
      { cat: 'regulated', label: 'Regulated retail', minzoom: 14, render: 'point' },
      { cat: 'alcohol', label: 'Alcohol venues', minzoom: 14, render: 'point' },
      { cat: 'gov', label: 'Government & detention', minzoom: 12, render: 'point' },
      { cat: 'lodging', label: 'Lodging & fuel', minzoom: 14, render: 'point' },
      { cat: 'social', label: 'Social services', minzoom: 13, render: 'point' },
      { cat: 'entrance', label: 'Building entrances', minzoom: 17, render: 'point' },
      { cat: 'bldg_height', label: 'Building height', minzoom: 16, render: 'line' },
    ],
  },
  {
    name: 'access',
    label: 'Access & Passage',
    archive: 'osm-access.pmtiles',
    geometry: 'mixed',
    coverage: 'incomplete',
    assignment: 'multi',
    properties: ["name","barrier","access","railway","amenity","parking","highway","maxheight","bridge","tunnel","public_transport","operator","ref"],
    categories: [
      { cat: 'barrier', label: 'Gates & barriers', minzoom: 15, render: 'point' },
      { cat: 'control_pt', label: 'Controlled passages', minzoom: 14, render: 'point' },
      { cat: 'rail_x', label: 'Rail crossings', minzoom: 13, render: 'point' },
      { cat: 'rail_infra', label: 'Rail infrastructure', minzoom: 15, render: 'point' },
      { cat: 'parking', label: 'Parking', minzoom: 15, render: 'point' },
      { cat: 'clearance', label: 'Clearances', minzoom: 14, render: 'line' },
      { cat: 'transit', label: 'Transit stations', minzoom: 12, render: 'point' },
      { cat: 'lamp', label: 'Street lighting', minzoom: 16, render: 'point' },
    ],
  },
  {
    name: 'drivability',
    label: 'Road Surface & Drivability',
    archive: 'osm-drivability.pmtiles',
    geometry: 'line',
    coverage: 'attribute',
    assignment: 'multi',
    properties: ["name","ref","highway","surface","tracktype","smoothness","4wd_only","ford","seasonal","access","motor_vehicle","snowmobile"],
    categories: [
      { cat: 'fourwd', label: '4WD-only', minzoom: 10, render: 'line' },
      { cat: 'ford', label: 'Fords', minzoom: 12, render: 'point' },
      { cat: 'seasonal', label: 'Seasonal closure', minzoom: 11, render: 'line' },
      { cat: 'restricted', label: 'Restricted access', minzoom: 11, render: 'line' },
      { cat: 'unpaved', label: 'Unpaved roads', minzoom: 11, render: 'line' },
      { cat: 'track', label: 'Tracks', minzoom: 12, render: 'line' },
    ],
  },
  {
    name: 'terrain',
    label: 'Terrain & Natural Hazards',
    archive: 'osm-terrain.pmtiles',
    geometry: 'mixed',
    coverage: 'sparse',
    assignment: 'multi',
    properties: ["name","natural","man_made","historic","hazard","operator","ele"],
    categories: [
      { cat: 'cliff', label: 'Cliffs & steep terrain', minzoom: 12, render: 'line' },
      { cat: 'cave', label: 'Cave entrances & sinkholes', minzoom: 12, render: 'point' },
      { cat: 'mine', label: 'Mine shafts & adits', minzoom: 12, render: 'point' },
      { cat: 'spring', label: 'Springs & water sources', minzoom: 13, render: 'point' },
      { cat: 'hazard', label: 'Mapped hazards', minzoom: 11, render: 'point' },
    ],
  },
  {
    name: 'jurisdiction',
    label: 'Jurisdiction & Restricted Areas',
    archive: 'osm-jurisdiction.pmtiles',
    geometry: 'polygon',
    coverage: 'boundary',
    assignment: 'multi',
    properties: ["name","boundary","protect_class","landuse","military","leisure","operator","ownership"],
    categories: [
      { cat: 'protected', label: 'Protected areas & parks', minzoom: 8, render: 'polygon' },
      { cat: 'tribal', label: 'Tribal lands', minzoom: 8, render: 'polygon' },
      { cat: 'military', label: 'Military', minzoom: 8, render: 'polygon' },
      { cat: 'extraction', label: 'Industrial extraction & disposal', minzoom: 11, render: 'polygon' },
    ],
  },
];

export const OSM_EXTRACT_DATE: string = '2026-08-01';
