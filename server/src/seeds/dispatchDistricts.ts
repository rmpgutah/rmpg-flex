// ═══════════════════════════════════════════════════════════════════
// RMPG Flex — Dispatch Districts Seed Data
// 3-Tier: Section (Precinct) → Zone (City/Sector) → Beat (Patrol Area)
// Coverage: All 29 UT counties, Uinta Co WY, SW Wyoming
// Primary focus: Salt Lake County — detailed patrol-level beats
// ═══════════════════════════════════════════════════════════════════

interface DistrictEntry {
  section_id: string;
  zone_id: string;
  beat_id: string;
  dispatch_code: string;
  section_name: string;
  zone_name: string;
  beat_name: string;
  beat_descriptor: string;
}

// Compact spec: [zone_id, zone_name, beat_name_override?, [...beats]]
// Each beat: [beat_id, descriptor]
type BeatSpec = [string, string];
type ZoneSpec = [string, string, string, BeatSpec[]];

function buildSection(sectionId: string, sectionName: string, zones: ZoneSpec[]): DistrictEntry[] {
  const entries: DistrictEntry[] = [];
  for (const [zoneId, zoneName, beatName, beats] of zones) {
    for (const [beatId, descriptor] of beats) {
      entries.push({
        section_id: sectionId,
        zone_id: zoneId,
        beat_id: beatId,
        dispatch_code: `${sectionId}-${zoneId}/${beatId}`,
        section_name: sectionName,
        zone_name: zoneName,
        beat_name: beatName,
        beat_descriptor: descriptor,
      });
    }
  }
  return entries;
}

// ═══════════════════════════════════════════════════════════════════
//  SALT LAKE COUNTY — Primary Jurisdiction (6 Sections)
// ═══════════════════════════════════════════════════════════════════

const SL1 = buildSection('SL1', 'Salt Lake', [
  // Salt Lake City — Downtown / West Side (Pioneer Patrol Division)
  ['SLC', 'Salt Lake City', 'SLC Pioneer', [
    ['A', 'Downtown / Temple Square — N Temple to 400 S'],
    ['B', 'The Gateway / Granary District — Rio Grande to I-15'],
    ['C', 'Capitol Hill / Marmalade — State Capitol, Memory Grove'],
    ['D', 'Rose Park / Westpointe — N of N Temple, W of I-15'],
    ['E', 'Glendale / Poplar Grove — Redwood to I-15, 400 S to California'],
    ['F', 'Jordan Meadows / Intl Center — W of Bangerter, S of I-80'],
  ]],
  // Salt Lake City — East Side / South (Liberty Patrol Division)
  ['SLE', 'Salt Lake City East', 'SLC Liberty', [
    ['A', 'The Avenues / Federal Heights — A through U Streets'],
    ['B', 'University / Research Park — U of U, Foothill Dr'],
    ['C', 'East Bench / Bonneville — Foothill to Wasatch, 2100 S to I-80'],
    ['D', 'Sugar House / Highland Park — 2100 S to I-80, 700 E to 1300 E'],
    ['E', 'Liberty Park / 9th & 9th — Trolley Square, 900 E corridor'],
    ['F', 'Central City / Ballpark — 200 S to 1700 S, State to 200 E'],
  ]],
  // South Salt Lake
  ['SSL', 'South Salt Lake', 'SSL Patrol', [
    ['A', 'State Street Corridor — 2100 S to 3300 S, State St'],
    ['B', 'East Residential — 700 E to I-15, south of 2100 S'],
    ['C', 'West Industrial — I-15 west, warehouse & rail district'],
  ]],
]);

const SL2 = buildSection('SL2', 'Salt Lake', [
  // West Jordan
  ['WJO', 'West Jordan', 'WJO Patrol', [
    ['A', 'City Center / 7800 S — Bangerter & 7800 S commercial'],
    ['B', 'North / 7000 S — 7000 S corridor, north residential'],
    ['C', 'South / Mountain View — Mountain View corridor, south fringe'],
    ['D', 'West / River Oaks — Jordan River trail, west residential'],
  ]],
  // South Jordan
  ['SJO', 'South Jordan', 'SJO Patrol', [
    ['A', 'Daybreak / West — Daybreak community, Oquirrh Lake'],
    ['B', 'Central / SoJo Pkwy — 10600 S commercial, city center'],
    ['C', 'East / Glenmoor — Jordan River, east residential'],
  ]],
  // Murray
  ['MUR', 'Murray', 'Murray PD', [
    ['A', 'Downtown / Fashion Place — Murray Park, 4800 S core'],
    ['B', 'North / Intermountain — IMC Medical Center, 4500 S'],
    ['C', 'South / 5900 S — 5900 S corridor, residential south'],
    ['D', 'East / Vine Street — Vine St, Murray High area'],
  ]],
  // Taylorsville
  ['TAY', 'Taylorsville', 'TAY Patrol', [
    ['A', 'Central / 4700 S — Taylorsville city center, Redwood Rd'],
    ['B', 'North / Murray Border — 2700 W, 4100 S area'],
    ['C', 'South / Valley Regional — Valley Regional Park, 5400 S'],
  ]],
  // Herriman
  ['HER', 'Herriman', 'HER Patrol', [
    ['A', 'Town Center / Main St — Rose Creek, Herriman Main'],
    ['B', 'West / Olympia Heights — Mountain Ridge, western growth'],
    ['C', 'East / Hidden Valley — Butterfield Canyon, east bench'],
  ]],
  // Riverton
  ['RIV', 'Riverton', 'RIV Patrol', [
    ['A', 'Old Town / 12600 S — Riverton city center, Main corridor'],
    ['B', 'West / Redwood — Redwood Rd, Mountain View corridor'],
    ['C', 'Southeast / Draper Border — SE Riverton, Bangerter area'],
  ]],
]);

const SL3 = buildSection('SL3', 'Salt Lake', [
  // Sandy
  ['SAN', 'Sandy', 'Sandy PD', [
    ['A', 'North / Civic Center — 9400 S, Sandy Civic Center area'],
    ['B', 'South / Bell Canyon — 10600 S south, Bell Canyon trailhead'],
    ['C', 'East / Granite — Wasatch Blvd, Little Cottonwood junction'],
    ['D', 'West / State St — State St to I-15, commercial corridor'],
  ]],
  // Midvale
  ['MID', 'Midvale', 'Midvale PD', [
    ['A', 'Fort Union / Bingham Junction — 7200 S, Fort Union Blvd'],
    ['B', 'Center Street / Old Town — Center St, historic Midvale'],
    ['C', 'West / I-15 — I-15 corridor, 7200 S west industrial'],
  ]],
  // Cottonwood Heights
  ['CTH', 'Cottonwood Heights', 'CWH Patrol', [
    ['A', 'Central / Bengal Blvd — Brighton High, 7000 S core'],
    ['B', 'Canyon Mouth — Big & Little Cottonwood, Wasatch Blvd'],
    ['C', 'North / Fort Union — Fort Union Blvd, north residential'],
  ]],
  // Holladay
  ['HOL', 'Holladay', 'Holladay PD', [
    ['A', 'Holladay Village / Highland Dr — Village center, 4800 S'],
    ['B', 'Cottonwood / 4500 S — Cottonwood area, east 4500 S'],
    ['C', 'Mt Olympus / East — Olympus Cove, Olympus Hills'],
  ]],
  // Millcreek
  ['MLC', 'Millcreek', 'MLC Patrol', [
    ['A', 'Central / 3300 S — 3300 S corridor, Millcreek center'],
    ['B', 'East / Canyon — Millcreek Canyon Rd, Mt Olympus trailhead'],
    ['C', 'West / State Street — State St, I-15 to 700 E commercial'],
  ]],
  // Draper
  ['DRA', 'Draper', 'Draper PD', [
    ['A', 'Central / 12300 S — Pioneer Rd, Draper city center'],
    ['B', 'Corner Canyon / East — Corner Canyon trails, SunCrest'],
    ['C', 'Point of the Mountain — Bangerter, tech corridor, prison site'],
  ]],
  // Bluffdale
  ['BLU', 'Bluffdale', 'BLU Patrol', [
    ['A', 'Central / 14600 S — Bluffdale city center, Porter Rockwell'],
    ['B', 'Camp Williams / West — Military installation, Redwood Rd'],
  ]],
]);

const SL4 = buildSection('SL4', 'Salt Lake', [
  // West Valley City
  ['WVC', 'West Valley City', 'WVC PD', [
    ['A', 'City Center / Valley Fair — 3500 S, Valley Fair Mall area'],
    ['B', 'Hunter / West 3500 S — Hunter Park, Hunter High School'],
    ['C', 'Granger / Redwood — Granger HS, 3500–4100 S, Redwood Rd'],
    ['D', 'West / 5600 W — Copper Hills, western growth area'],
    ['E', 'Cultural Center / Chesterfield — USANA, Maverik Center'],
  ]],
  // Kearns
  ['KEA', 'Kearns', 'UPD Kearns', [
    ['A', 'Central / 5400 S — Kearns core, 5400 S commercial'],
    ['B', 'East / Kearns Blvd — 4800 W to 3200 W corridor'],
    ['C', 'West / Outlying — Western Kearns, 5600 W residential'],
  ]],
  // Magna
  ['MAG', 'Magna', 'UPD Magna', [
    ['A', 'Main Street / Old Town — Historic Main, Pleasant Green'],
    ['B', 'North / Industrial — Kennecott, copper operations area'],
    ['C', 'East / Transitional — 3200 W to I-215, SR-201 corridor'],
  ]],
]);

const SL5 = buildSection('SL5', 'Salt Lake', [
  // Copperton / Emigration / Unincorporated SL County
  ['COP', 'Copperton', 'UPD Metro', [
    ['A', 'Copperton / Bingham Canyon — Mining community, SR-48'],
    ['B', 'Bacchus Hwy / Southeast — Bacchus Hwy industrial corridor'],
  ]],
  ['WHC', 'White City', 'UPD Metro', [
    ['A', 'White City / 10600 S — Residential enclave, Sandy border'],
    ['B', 'East / Canyon Rim — Canyon Rim area, I-215 corridor'],
  ]],
  ['EMG', 'Emigration Canyon', 'UPD Metro', [
    ['A', 'Emigration Canyon — Mountain residential, This Is The Place'],
    ['B', 'East Canyon / Pinecrest — Upper canyon, Pinecrest area'],
  ]],
]);

// ═══════════════════════════════════════════════════════════════════
//  DAVIS COUNTY (3 Sections)
// ═══════════════════════════════════════════════════════════════════

const DV1 = buildSection('DV1', 'Davis', [
  ['NSL', 'North Salt Lake', 'NSL Patrol', [
    ['A', 'Central / Orchard Dr — City center, Foxboro area'],
    ['B', 'East / Eaglewood — Eaglewood, east bench residential'],
    ['C', 'West / I-15 — I-15 corridor, industrial & commercial'],
  ]],
  ['WCR', 'Woods Cross', 'WCR Patrol', [
    ['A', 'Central / 500 S — Woods Cross center, 500 S corridor'],
    ['B', 'East / Bountiful Border — East residential, golf course'],
    ['C', 'West / I-15 — I-15, Legacy Pkwy, commercial strip'],
  ]],
  ['BOU', 'Bountiful', 'Bountiful PD', [
    ['A', 'Downtown / Main St — Bountiful Main St, city center'],
    ['B', 'East Bench / Mueller Park — East bench, Mueller Park Canyon'],
    ['C', 'South / 500 S — South Bountiful, Woods Cross border'],
  ]],
  ['WBN', 'West Bountiful', 'WBN Patrol', [
    ['A', 'Central / 800 W — West Bountiful center, Pages Ln'],
    ['B', 'North / Legacy — Legacy Pkwy, north residential'],
    ['C', 'South / Outlying — South fringe, industrial'],
  ]],
  ['CEN', 'Centerville', 'CEN Patrol', [
    ['A', 'Main Street / Parrish — Centerville Main, Parrish Creek'],
    ['B', 'East Bench — East bench residential, canyon mouth'],
    ['C', 'West / I-15 — I-15 commercial, west residential'],
  ]],
]);

const DV2 = buildSection('DV2', 'Davis', [
  ['FAR', 'Farmington', 'Farmington PD', [
    ['A', 'Station Park / Main — Station Park, historic downtown'],
    ['B', 'East / Farmington Canyon — Canyon entrance, east bench'],
    ['C', 'West / Lagoon — Lagoon area, west residential'],
  ]],
  ['KAY', 'Kaysville', 'Kaysville PD', [
    ['A', 'Downtown / Main — Kaysville center, Main corridor'],
    ['B', 'East / Fruit Heights — Fruit Heights, east bench'],
    ['C', 'West / Angel Street — Angel St, west residential'],
  ]],
  ['LAY', 'Layton', 'Layton PD', [
    ['A', 'Central / Main — Layton Hills Mall, Main St corridor'],
    ['B', 'East / Kays Creek — East bench, Kays Creek Canyon'],
    ['C', 'North / Hill AFB Gate — North Layton, HAFB main gate'],
    ['D', 'West / Gentile — Gentile St, west Layton residential'],
  ]],
]);

const DV3 = buildSection('DV3', 'Davis', [
  ['CLE', 'Clearfield', 'Clearfield PD', [
    ['A', 'Central / State — State St, Clearfield center'],
    ['B', 'East / Hill AFB — HAFB south gate, east Clearfield'],
    ['C', 'West / Freeport Center — Freeport Center, industrial'],
  ]],
  ['CLI', 'Clinton', 'Clinton PD', [
    ['A', 'Central / 2000 N — Clinton city center, 2000 N corridor'],
    ['B', 'East / 1800 N — East Clinton, residential'],
    ['C', 'West / Antelope Dr — Antelope Dr, Great Salt Lake fringe'],
  ]],
  ['SYR', 'Syracuse', 'Syracuse PD', [
    ['A', 'Central / Antelope Dr — Syracuse city center, Antelope Dr'],
    ['B', 'East / Bluff Rd — Bluff Rd, east residential'],
    ['C', 'West / Lake — Great Salt Lake shore, west fringe'],
  ]],
]);

// ═══════════════════════════════════════════════════════════════════
//  WEBER COUNTY (2 Sections)
// ═══════════════════════════════════════════════════════════════════

const WB1 = buildSection('WB1', 'Weber', [
  ['OGD', 'Ogden', 'Ogden PD', [
    ['A', 'Downtown / 25th St — Historic 25th, Junction area'],
    ['B', 'East Bench / Harrison — Harrison Blvd, east residential'],
    ['C', 'South / Wall Ave — Wall Ave corridor, south Ogden border'],
    ['D', 'West / Washington Blvd — Washington Blvd, west side'],
  ]],
  ['SOG', 'South Ogden', 'South Ogden PD', [
    ['A', 'Central / 40th St — 40th St center, Riverdale border'],
    ['B', 'East / Country Hills — Country Hills, east bench'],
    ['C', 'West / Washington — Washington Blvd, commercial corridor'],
  ]],
  ['RVD', 'Riverdale', 'Riverdale PD', [
    ['A', 'Central / Riverdale Rd — Riverdale Rd, commercial core'],
    ['B', 'East / Bench — East bench residential'],
    ['C', 'West / I-15 — I-15 corridor, Weber River area'],
  ]],
  ['ROY', 'Roy', 'Roy PD', [
    ['A', 'Central / 5600 S — Roy center, 5600 S corridor'],
    ['B', 'East / Hill AFB — HAFB north boundary, east Roy'],
    ['C', 'West / 4000 W — West Roy, rural fringe'],
  ]],
  ['HRV', 'Harrisville', 'Harrisville PD', [
    ['A', 'Central / Wall Ave — Wall Ave, Harrisville center'],
    ['B', 'North — North residential, Pleasant View border'],
    ['C', 'South — South residential, Ogden border'],
  ]],
]);

const WB2 = buildSection('WB2', 'Weber', [
  ['NOG', 'North Ogden', 'North Ogden PD', [
    ['A', 'Central / Washington — Washington Blvd, N Ogden center'],
    ['B', 'East / Coldwater Canyon — East bench, Ben Lomond Peak'],
    ['C', 'North / Pleasant View Border — North residential fringe'],
  ]],
  ['PLV', 'Pleasant View', 'Pleasant View PD', [
    ['A', 'Central / Hwy 89 — Highway 89 corridor, Pleasant View core'],
    ['B', 'East / Canyon — East bench, North Ogden Divide'],
    ['C', 'West / Outlying — West Pleasant View, rural'],
  ]],
  ['PLC', 'Plain City', 'Weber SO', [
    ['A', 'Central / Main — Plain City center, Main corridor'],
    ['B', 'North / Agricultural — North fields, agricultural area'],
    ['C', 'South / 2700 N — 2700 N corridor, south residential'],
  ]],
  ['FRW', 'Farr West', 'Weber SO', [
    ['A', 'Central / 1900 W — Farr West center, 1900 W corridor'],
    ['B', 'North — North residential, Marriott-Slaterville border'],
    ['C', 'South — South Farr West, Plain City border'],
  ]],
  ['HOO', 'Hooper', 'Weber SO', [
    ['A', 'Central / 5500 S — Hooper center, 5500 S corridor'],
    ['B', 'East / Weber River — Weber River corridor, east Hooper'],
    ['C', 'West / Great Salt Lake — West Hooper, marshlands, GSL fringe'],
  ]],
]);

// ═══════════════════════════════════════════════════════════════════
//  UTAH COUNTY (3 Sections) — NEW
// ═══════════════════════════════════════════════════════════════════

const UC1 = buildSection('UC1', 'Utah Co North', [
  ['LEH', 'Lehi', 'Lehi PD', [
    ['A', 'Main Street / Old Town — Historic Main, Lehi Roller Mills'],
    ['B', 'Thanksgiving Point / Silicon Slopes — Tech corridor, I-15'],
    ['C', 'North / Saratoga Border — Traverse Mtn, north residential'],
    ['D', 'West / Lehi Pointe — Western Lehi, SR-73 area'],
  ]],
  ['AMF', 'American Fork', 'AF PD', [
    ['A', 'Downtown / Main — Main St center, AF Hospital area'],
    ['B', 'East / AF Canyon — Canyon entrance, east bench'],
    ['C', 'West / Meadows — Meadows area, I-15 west commercial'],
  ]],
  ['PLG', 'Pleasant Grove', 'PG PD', [
    ['A', 'Downtown / Main — Pleasant Grove center, city hall'],
    ['B', 'East / Grove Creek — Grove Creek trail, east bench'],
    ['C', 'West / Manila — Manila Creek area, west residential'],
  ]],
  ['HIG', 'Highland', 'Highland PD', [
    ['A', 'Central / Alpine Hwy — Alpine Hwy, Highland center'],
    ['B', 'East / Lone Peak — Lone Peak area, east residential'],
  ]],
  ['ALP', 'Alpine', 'Alpine PD', [
    ['A', 'Main / Central — Alpine center, Main corridor'],
    ['B', 'East / Box Elder — Box Elder Peak foothills, east Alpine'],
  ]],
  ['CDH', 'Cedar Hills', 'Cedar Hills PD', [
    ['A', 'Central / Canyon Rd — Canyon Rd, Cedar Hills center'],
    ['B', 'East / Benchmark — Benchmark area, east residential'],
  ]],
  ['SAR', 'Saratoga Springs', 'Saratoga PD', [
    ['A', 'Old Town / Village — Saratoga center, Village Blvd'],
    ['B', 'West / Harvest Hills — Harvest Hills, western growth'],
    ['C', 'North / Ring Road — North fringe, Eagle Mtn border'],
  ]],
  ['EGM', 'Eagle Mountain', 'EM PD', [
    ['A', 'Town Center / Pony Express — City center, Pony Express Pkwy'],
    ['B', 'North / Ranches — Ranches, north Eagle Mountain'],
    ['C', 'South / Cedar Valley — Southern growth area, SR-73'],
  ]],
]);

const UC2 = buildSection('UC2', 'Utah Co Central', [
  ['PRV', 'Provo', 'Provo PD', [
    ['A', 'Downtown / Center St — Center St, courthouse district'],
    ['B', 'BYU / University — BYU campus, University Ave corridor'],
    ['C', 'East / Rock Canyon — Rock Canyon, east bench residential'],
    ['D', 'West / Lakeview — Utah Lake shore, west Provo'],
    ['E', 'South / Spring Creek — South Provo, Spring Creek, I-15'],
  ]],
  ['ORM', 'Orem', 'Orem PD', [
    ['A', 'Central / State St — State St corridor, University Place'],
    ['B', 'North / Lindon Border — Vineyard connector, 800 N area'],
    ['C', 'East / SCERA — East Orem, SCERA Park, 800 E'],
    ['D', 'West / Geneva — Geneva Rd, west Orem industrial'],
  ]],
  ['VNY', 'Vineyard', 'Vineyard PD', [
    ['A', 'Town Center / Lakeside — Downtown development, lakefront'],
    ['B', 'East / Anderson — Anderson Ln, residential growth area'],
  ]],
  ['LIN', 'Lindon', 'Lindon PD', [
    ['A', 'Central / Main — Lindon center, Main corridor'],
    ['B', 'East / Canyon — Lindon Canyon area, east foothills'],
  ]],
]);

const UC3 = buildSection('UC3', 'Utah Co South', [
  ['SPF', 'Spanish Fork', 'SF PD', [
    ['A', 'Downtown / Main — Main St, Spanish Fork center'],
    ['B', 'East / Canyon — Spanish Fork Canyon entrance, US-6'],
    ['C', 'West / Lakeshore — Lakeshore area, west residential'],
  ]],
  ['SPV', 'Springville', 'Springville PD', [
    ['A', 'Downtown / Main — Main St, Springville center, Art Museum'],
    ['B', 'East / Hobble Creek — Hobble Creek Canyon, east bench'],
    ['C', 'West / I-15 — I-15 corridor, west commercial'],
  ]],
  ['PAY', 'Payson', 'Payson PD', [
    ['A', 'Central / Main — Main St, Payson center'],
    ['B', 'East / Loafer Mtn — Loafer Mountain, east residential'],
    ['C', 'South / Salem Border — South Payson, Salem connector'],
  ]],
  ['SAM', 'Salem', 'Salem PD', [
    ['A', 'Central / Main — Salem center, Main corridor'],
    ['B', 'South / Rural — South Salem, agricultural area'],
  ]],
  ['SQN', 'Santaquin', 'Utah Co SO', [
    ['A', 'Central / Main — Santaquin center, Main corridor'],
    ['B', 'South / SR-6 — US-6 corridor, south rural'],
  ]],
  ['MAP', 'Mapleton', 'Mapleton PD', [
    ['A', 'Central / Maple — Mapleton center, Maple St corridor'],
    ['B', 'East / Bench — East bench, canyon foothills'],
  ]],
]);

// ═══════════════════════════════════════════════════════════════════
//  MORGAN COUNTY
// ═══════════════════════════════════════════════════════════════════

const MG1 = buildSection('MG1', 'Morgan', [
  ['MRG', 'Morgan', 'Morgan SO', [
    ['A', 'Central / Main — Morgan center, Commercial St corridor'],
    ['B', 'North / East Canyon — East Canyon, Mountain Green connector'],
    ['C', 'South / Weber Canyon — Weber Canyon, I-84 corridor'],
  ]],
  ['MTG', 'Mountain Green', 'Morgan SO', [
    ['A', 'Central / Trappers Loop — Mountain Green center, Trappers Loop'],
    ['B', 'East / Huntsville — Huntsville connector, rural ranch'],
    ['C', 'West / I-84 — I-84 corridor, Morgan border'],
  ]],
]);

// ═══════════════════════════════════════════════════════════════════
//  WASATCH COUNTY
// ═══════════════════════════════════════════════════════════════════

const WS1 = buildSection('WS1', 'Wasatch', [
  ['HEB', 'Heber City', 'Wasatch SO', [
    ['A', 'Downtown / Main — Heber center, Main St, courthouse'],
    ['B', 'East / Jordanelle — Jordanelle reservoir, US-40 east'],
    ['C', 'West / Swiss Days — Midway connector, Homestead area'],
  ]],
  ['MDW', 'Midway', 'Wasatch SO', [
    ['A', 'Town Center — Midway center, Swiss village core'],
    ['B', 'Hot Springs / East — Homestead, hot springs, east Midway'],
    ['C', 'West / Charleston — Charleston area, Deer Creek reservoir'],
  ]],
]);

// ═══════════════════════════════════════════════════════════════════
//  SUMMIT COUNTY (2 Sections)
// ═══════════════════════════════════════════════════════════════════

const SM1 = buildSection('SM1', 'Summit', [
  ['PKC', 'Park City', 'Park City PD', [
    ['A', 'Old Town / Main — Historic Main St, Town Lift area'],
    ['B', 'Prospector / Resort — Prospector Square, ski resort base'],
    ['C', 'Kimball Junction — Tanger Outlets, US-40 junction'],
    ['D', 'Snyderville / Jeremy Ranch — Jeremy Ranch, Pinebrook'],
  ]],
  ['KAM', 'Kamas', 'Summit SO', [
    ['A', 'Central / Main — Kamas center, SR-248 corridor'],
    ['B', 'East / Mirror Lake — Mirror Lake Hwy, Uinta access'],
    ['C', 'West / Oakley Border — West Kamas, ranch country'],
  ]],
  ['FRA', 'Francis', 'Summit SO', [
    ['A', 'Central — Francis center, SR-35 corridor'],
    ['B', 'East / Woodland — Woodland, upper Provo River area'],
  ]],
  ['OAK', 'Oakley', 'Summit SO', [
    ['A', 'Central / Main — Oakley center, rodeo grounds'],
    ['B', 'East / Weber Canyon — Weber River headwaters, ranch land'],
  ]],
]);

const SM2 = buildSection('SM2', 'Summit', [
  ['COA', 'Coalville', 'Summit SO', [
    ['A', 'Central / Main — Coalville center, courthouse, I-80'],
    ['B', 'East / Echo — Echo reservoir, Echo Canyon, I-80 east'],
    ['C', 'South / Wanship — Wanship, Rockport reservoir'],
  ]],
  ['HEN', 'Henefer', 'Summit SO', [
    ['A', 'Central — Henefer townsite, I-84 junction'],
    ['B', 'East / Devils Slide — Devils Slide, upper Weber Canyon'],
  ]],
]);

// ═══════════════════════════════════════════════════════════════════
//  TOOELE COUNTY (2 Sections)
// ═══════════════════════════════════════════════════════════════════

const TL1 = buildSection('TL1', 'Tooele', [
  ['TOO', 'Tooele', 'Tooele PD', [
    ['A', 'Downtown / Main — Tooele Main St, city center'],
    ['B', 'East / Overlake — Overlake subdivision, east growth'],
    ['C', 'West / Industrial — Industrial Depot, Army Depot area'],
  ]],
  ['GRA', 'Grantsville', 'Grantsville PD', [
    ['A', 'Downtown / Main — Grantsville center, Main corridor'],
    ['B', 'East / South Willow — South Willow Canyon, east bench'],
    ['C', 'West / Ranch — West Grantsville, ranch & agriculture'],
  ]],
  ['STO', 'Stockton', 'Tooele SO', [
    ['A', 'Central — Stockton townsite, SR-36 corridor'],
    ['B', 'East / Rush Valley — Rush Valley connector, east rural'],
  ]],
  ['STP', 'Stansbury Park', 'Tooele SO', [
    ['A', 'Central / Clubhouse — Stansbury center, golf course'],
    ['B', 'East / Village Blvd — Village Blvd, east residential'],
    ['C', 'West / SR-36 — SR-36 corridor, commercial strip'],
  ]],
  ['LPT', 'Lake Point', 'Tooele SO', [
    ['A', 'Central / Mountain Rd — Lake Point center, I-80 exit'],
    ['B', 'East / Great Salt Lake — GSL Marina, Saltair area'],
  ]],
]);

const TL2 = buildSection('TL2', 'Tooele', [
  ['WEN', 'Wendover', 'Wendover PD', [
    ['A', 'Downtown / Main — Wendover center, Bonneville Blvd'],
    ['B', 'East / Bonneville — Bonneville Salt Flats, I-80 east'],
    ['C', 'West / State Line — State line casinos, NV border area'],
  ]],
]);

// ═══════════════════════════════════════════════════════════════════
//  CACHE COUNTY (2 Sections)
// ═══════════════════════════════════════════════════════════════════

const CH1 = buildSection('CH1', 'Cache', [
  ['LOG', 'Logan', 'Logan PD', [
    ['A', 'Downtown / Main — Main St center, Cache Co courthouse'],
    ['B', 'USU / University — Utah State University campus area'],
    ['C', 'East / Canyon — Logan Canyon entrance, east bench'],
    ['D', 'Southwest / Island — Logan River, southwest residential'],
  ]],
  ['NLG', 'North Logan', 'North Logan PD', [
    ['A', 'Central / Main — N Logan center, 1800 N corridor'],
    ['B', 'East / Green Canyon — Green Canyon, east bench'],
    ['C', 'North / Hyde Park Border — North fringe, agricultural'],
  ]],
  ['PRO', 'Providence', 'Cache SO', [
    ['A', 'Central / Main — Providence center, 100 N corridor'],
    ['B', 'East / Canyon — Providence Canyon, east bench'],
    ['C', 'South / Millville Border — South Providence, rural'],
  ]],
  ['MIL', 'Millville', 'Cache SO', [
    ['A', 'Central — Millville center, Main corridor'],
    ['B', 'South / Nibley Border — South Millville, agricultural'],
  ]],
  ['NIB', 'Nibley', 'Cache SO', [
    ['A', 'Central / Main — Nibley center, 3200 S corridor'],
    ['B', 'East / Blacksmith Fork — Blacksmith Fork Canyon area'],
    ['C', 'West / Rural — West Nibley, agricultural flatlands'],
  ]],
  ['HYD', 'Hyde Park', 'Cache SO', [
    ['A', 'Central — Hyde Park center, Main corridor'],
    ['B', 'East / Canyon — Hyde Park Canyon, east bench'],
  ]],
]);

const CH2 = buildSection('CH2', 'Cache', [
  ['HYR', 'Hyrum', 'Cache SO', [
    ['A', 'Central / Main — Hyrum center, Main St'],
    ['B', 'East / Hardware Ranch — Hardware Ranch Rd, east canyon'],
    ['C', 'South / Paradise Border — South Hyrum, Blacksmith Fork'],
  ]],
  ['SMI', 'Smithfield', 'Smithfield PD', [
    ['A', 'Central / Main — Smithfield center, Main corridor'],
    ['B', 'East / Summit Creek — Summit Creek Canyon, east bench'],
    ['C', 'North / Richmond Border — North agricultural area'],
  ]],
  ['RIC', 'Richmond', 'Cache SO', [
    ['A', 'Central — Richmond center, Main corridor'],
    ['B', 'East / Cherry Creek — Cherry Creek area, east foothills'],
  ]],
  ['WEL', 'Wellsville', 'Cache SO', [
    ['A', 'Central — Wellsville center, Main corridor'],
    ['B', 'East / Box Elder Peak — Wellsville Mtns, east foothills'],
  ]],
  ['LEW', 'Lewiston', 'Cache SO', [
    ['A', 'Central — Lewiston center, ID border area'],
    ['B', 'South / Rural — South Lewiston, agricultural'],
  ]],
  ['MEN', 'Mendon', 'Cache SO', [
    ['A', 'Central — Mendon center, Main corridor'],
  ]],
  ['CLA', 'Clarkston', 'Cache SO', [
    ['A', 'Central — Clarkston center, ID border area'],
  ]],
  ['COR', 'Cornish', 'Cache SO', [
    ['A', 'Central — Cornish townsite, Bear River area'],
  ]],
  ['PDZ', 'Paradise', 'Cache SO', [
    ['A', 'Central — Paradise center, Avon connector'],
    ['B', 'East / Canyon — East foothills, canyon area'],
  ]],
]);

// ═══════════════════════════════════════════════════════════════════
//  RICH COUNTY
// ═══════════════════════════════════════════════════════════════════

const RC1 = buildSection('RC1', 'Rich', [
  ['GAR', 'Garden City', 'Rich SO', [
    ['A', 'Central / Main — Garden City center, Bear Lake Blvd'],
    ['B', 'North / Lakefront — Bear Lake north shore, marina'],
    ['C', 'South / Pickleville — Pickleville, south Bear Lake'],
  ]],
  ['RAN', 'Randolph', 'Rich SO', [
    ['A', 'Central — Randolph center, county seat, SR-16'],
    ['B', 'North / Woodruff — Woodruff connector, N Rich County'],
    ['C', 'South / Rural — South Randolph, ranch country'],
  ]],
  ['LKT', 'Laketown', 'Rich SO', [
    ['A', 'Central — Laketown center, Bear Lake south shore'],
    ['B', 'East / Cisco Beach — Cisco Beach, east lakeshore'],
  ]],
  ['WDF', 'Woodruff', 'Rich SO', [
    ['A', 'Central — Woodruff townsite, SR-16 north'],
    ['B', 'East / WY Border — Wyoming border crossing, rural'],
  ]],
]);

// ═══════════════════════════════════════════════════════════════════
//  JUAB COUNTY (2 Sections)
// ═══════════════════════════════════════════════════════════════════

const JB1 = buildSection('JB1', 'Juab', [
  ['NEP', 'Nephi', 'Juab SO', [
    ['A', 'Downtown / Main — Nephi center, Main St, I-15 exit'],
    ['B', 'East / Salt Creek — Salt Creek Canyon, east bench'],
    ['C', 'South / I-15 — I-15 corridor, south rural'],
  ]],
  ['MON', 'Mona', 'Juab SO', [
    ['A', 'Central — Mona townsite, I-15 adjacent'],
    ['B', 'East / Rural — East Mona, agricultural area'],
  ]],
  ['LEV', 'Levan', 'Juab SO', [
    ['A', 'Central — Levan center, SR-28 corridor'],
  ]],
]);

// ═══════════════════════════════════════════════════════════════════
//  SANPETE COUNTY (3 Sections)
// ═══════════════════════════════════════════════════════════════════

const SP1 = buildSection('SP1', 'Sanpete', [
  ['MNT', 'Manti', 'Sanpete SO', [
    ['A', 'Downtown / Main — Manti center, Manti Temple, courthouse'],
    ['B', 'East / Temple Hill — Temple Hill, east bench residential'],
    ['C', 'South / Sterling — Sterling connector, south Manti'],
  ]],
  ['EPH', 'Ephraim', 'Ephraim PD', [
    ['A', 'Downtown / Main — Ephraim center, Snow College area'],
    ['B', 'East / Ephraim Canyon — Ephraim Canyon, east foothills'],
    ['C', 'North / Rural — North Ephraim, agricultural'],
  ]],
  ['GUN', 'Gunnison', 'Sanpete SO', [
    ['A', 'Central / Main — Gunnison center, Main St'],
    ['B', 'East / Prison — Gunnison Prison area, east Gunnison'],
    ['C', 'South / Centerfield — Centerfield connector, south rural'],
  ]],
  ['CTF', 'Centerfield', 'Sanpete SO', [
    ['A', 'Central — Centerfield townsite, SR-89 corridor'],
  ]],
]);

const SP2 = buildSection('SP2', 'Sanpete', [
  ['MTP', 'Mount Pleasant', 'Sanpete SO', [
    ['A', 'Central / Main — Mt Pleasant center, Wasatch Academy'],
    ['B', 'East / Pleasant Creek — Pleasant Creek Canyon, east bench'],
    ['C', 'South / Rural — South Mt Pleasant, agricultural'],
  ]],
  ['FRV', 'Fairview', 'Sanpete SO', [
    ['A', 'Central / Main — Fairview center, SR-89 corridor'],
    ['B', 'East / Fairview Canyon — Skyline Dr, east foothills'],
  ]],
  ['FGR', 'Fountain Green', 'Sanpete SO', [
    ['A', 'Central — Fountain Green center, Main St'],
    ['B', 'East / Rural — East foothills, agricultural'],
  ]],
  ['SPC', 'Spring City', 'Sanpete SO', [
    ['A', 'Central — Spring City center, historic district'],
    ['B', 'East / Canyon — East Spring City, canyon area'],
  ]],
  ['MRN', 'Moroni', 'Sanpete SO', [
    ['A', 'Central — Moroni center, Main St, turkey plant area'],
    ['B', 'South / Rural — South Moroni, agricultural'],
  ]],
]);

const SP3 = buildSection('SP3', 'Sanpete', [
  ['SNA', 'Salina', 'Sevier SO', [
    ['A', 'Central / Main — Salina center, I-70 junction'],
    ['B', 'East / Salina Canyon — Salina Creek Canyon, I-70 east'],
    ['C', 'West / Rural — West Salina, agricultural'],
  ]],
]);

// ═══════════════════════════════════════════════════════════════════
//  WYOMING — Uinta County + Border Counties (3 Sections)
// ═══════════════════════════════════════════════════════════════════

const WY1 = buildSection('WY1', 'Uinta Co WY', [
  ['EVN', 'Evanston', 'Evanston PD', [
    ['A', 'Downtown / Main — Evanston center, Main St, courthouse'],
    ['B', 'East / Bear River — Bear River corridor, east residential'],
    ['C', 'North / I-80 — I-80 corridor, north commercial/truck stop'],
    ['D', 'South / Yellow Creek — Yellow Creek Rd, south rural'],
  ]],
  ['MVW', 'Mountain View', 'Uinta Co SO', [
    ['A', 'Central / Main — Mountain View center, SR-414'],
    ['B', 'East / Henrys Fork — Henrys Fork area, ranch country'],
    ['C', 'South / Manila Border — South connector, Flaming Gorge Rd'],
  ]],
  ['LYM', 'Lyman', 'Uinta Co SO', [
    ['A', 'Central / Main — Lyman center, Bridger Valley'],
    ['B', 'East / Fort Bridger — Fort Bridger historic site, I-80'],
  ]],
  ['FTB', 'Fort Bridger', 'Uinta Co SO', [
    ['A', 'Central / Historic — Fort Bridger State Historic Site'],
    ['B', 'East / I-80 — I-80 corridor, Lyman connector'],
  ]],
  ['BRV', 'Bear River', 'Uinta Co SO', [
    ['A', 'Bear River / Robertson — Robertson area, Bear River valley'],
    ['B', 'South / Wasatch Nat Forest — National Forest boundary, rural'],
  ]],
]);

const WY2 = buildSection('WY2', 'Sweetwater Co WY', [
  ['RKS', 'Rock Springs', 'Rock Springs PD', [
    ['A', 'Downtown / Dewar Dr — Rock Springs center, Dewar Dr corridor'],
    ['B', 'East / I-80 — I-80 east corridor, Pilot Butte area'],
    ['C', 'North / White Mountain — White Mountain, north residential'],
    ['D', 'West / Gateway — Gateway Blvd, west commercial'],
  ]],
  ['GNR', 'Green River', 'Green River PD', [
    ['A', 'Downtown / Flaming Gorge — Green River center, Flaming Gorge Way'],
    ['B', 'East / I-80 — I-80 corridor, east Green River'],
    ['C', 'West / Expedition Island — Expedition Island, west residential'],
  ]],
  ['WAM', 'Wamsutter', 'Sweetwater SO', [
    ['A', 'Central / I-80 — Wamsutter townsite, I-80 junction'],
  ]],
]);

const WY3 = buildSection('WY3', 'Lincoln Co WY', [
  ['KEM', 'Kemmerer', 'Kemmerer PD', [
    ['A', 'Downtown / Pine Ave — Kemmerer center, JC Penney Mother Store'],
    ['B', 'Diamondville / Frontier — Diamondville, Frontier area'],
    ['C', 'East / Fossil Butte — Fossil Butte NM, US-30 east'],
  ]],
  ['AFT', 'Afton', 'Lincoln SO', [
    ['A', 'Downtown / Main — Afton center, Main St, Star Valley'],
    ['B', 'North / Thayne — Thayne, upper Star Valley'],
    ['C', 'South / Smoot — Smoot, lower Star Valley, WY-89'],
  ]],
  ['ALW', 'Alpine WY', 'Lincoln SO', [
    ['A', 'Central / Greys River — Alpine center, Greys River Rd'],
    ['B', 'North / Snake River — Snake River Range, Palisades area'],
  ]],
]);

// ═══════════════════════════════════════════════════════════════════
//  BOX ELDER COUNTY — NEW
// ═══════════════════════════════════════════════════════════════════

const BE1 = buildSection('BE1', 'Box Elder', [
  ['BGC', 'Brigham City', 'Brigham City PD', [
    ['A', 'Downtown / Main — Brigham City center, Main St corridor'],
    ['B', 'East / Box Elder Canyon — Canyon entrance, Mantua connector'],
    ['C', 'West / I-15 — I-15 corridor, west commercial'],
  ]],
  ['TRM', 'Tremonton', 'Tremonton PD', [
    ['A', 'Central / Main — Tremonton center, Main St'],
    ['B', 'East / Garland — Garland connector, east rural'],
    ['C', 'West / Thiokol — ATK/Northrop area, west industrial'],
  ]],
  ['PER', 'Perry', 'Box Elder SO', [
    ['A', 'Central / Hwy 89 — Perry center, US-89 corridor'],
    ['B', 'South / Willard — Willard Bay connector, south area'],
  ]],
]);

// ═══════════════════════════════════════════════════════════════════
//  IRON COUNTY — NEW
// ═══════════════════════════════════════════════════════════════════

const IR1 = buildSection('IR1', 'Iron', [
  ['CDC', 'Cedar City', 'Cedar City PD', [
    ['A', 'Downtown / Main — Cedar City center, SUU area, Main St'],
    ['B', 'East / Canyon — Cedar Canyon, SR-14, ski area access'],
    ['C', 'North / I-15 — I-15 corridor, north commercial'],
    ['D', 'West / Airport — Cedar City airport, west industrial'],
  ]],
  ['PAW', 'Parowan', 'Iron SO', [
    ['A', 'Central / Main — Parowan center, Main St corridor'],
    ['B', 'East / Brian Head — Brian Head connector, SR-143'],
  ]],
  ['ENO', 'Enoch', 'Iron SO', [
    ['A', 'Central / Midvalley — Enoch center, Midvalley Rd'],
    ['B', 'North / Rural — North Enoch, agricultural area'],
  ]],
]);

// ═══════════════════════════════════════════════════════════════════
//  WASHINGTON COUNTY — NEW
// ═══════════════════════════════════════════════════════════════════

const WA1 = buildSection('WA1', 'Washington', [
  ['STG', 'St. George', 'St George PD', [
    ['A', 'Downtown / Tabernacle — St George Blvd, Tabernacle area'],
    ['B', 'East / Dixie Rock — Red Hills, Dixie State area'],
    ['C', 'South / Bloomington — Bloomington, south residential'],
    ['D', 'North / Red Cliffs — Red Cliffs, north growth corridor'],
    ['E', 'West / Sunset — Sunset Blvd, SunRiver area'],
  ]],
  ['HUR', 'Hurricane', 'Hurricane PD', [
    ['A', 'Central / State — Hurricane center, State St corridor'],
    ['B', 'East / La Verkin — La Verkin connector, I-15 junction'],
    ['C', 'West / Sand Hollow — Sand Hollow reservoir, west growth'],
  ]],
  ['IVN', 'Ivins', 'Washington SO', [
    ['A', 'Central / Snow Canyon — Ivins center, Snow Canyon Pkwy'],
    ['B', 'North / Kayenta — Kayenta community, Red Mountain'],
  ]],
  ['WSH', 'Washington City', 'Washington PD', [
    ['A', 'Central / Telegraph — Washington center, Telegraph St'],
    ['B', 'East / I-15 — I-15 corridor, east commercial area'],
  ]],
  ['SCC', 'Santa Clara', 'Washington SO', [
    ['A', 'Central / Santa Clara Dr — Santa Clara center, Swiss heritage'],
    ['B', 'West / Ivins Border — West area, residential growth'],
  ]],
]);

// ═══════════════════════════════════════════════════════════════════
//  UINTAH COUNTY (UT) — NEW (different from Uinta Co WY!)
// ═══════════════════════════════════════════════════════════════════

const UT1 = buildSection('UT1', 'Uintah', [
  ['VER', 'Vernal', 'Vernal PD', [
    ['A', 'Downtown / Main — Vernal center, Main St, Dinosaur area'],
    ['B', 'East / Naples — Naples, east Vernal corridor'],
    ['C', 'North / Dry Fork — Dry Fork Canyon, north rural'],
  ]],
  ['RSV', 'Roosevelt', 'Roosevelt PD', [
    ['A', 'Central / Main — Roosevelt center, Main St corridor'],
    ['B', 'East / Ballard — Ballard, east Roosevelt area'],
    ['C', 'West / Reservation — Ute reservation, Fort Duchesne area'],
  ]],
]);

// ═══════════════════════════════════════════════════════════════════
//  DUCHESNE COUNTY — NEW
// ═══════════════════════════════════════════════════════════════════

const DU1 = buildSection('DU1', 'Duchesne', [
  ['DUC', 'Duchesne', 'Duchesne SO', [
    ['A', 'Central / Main — Duchesne center, courthouse area'],
    ['B', 'East / Starvation — Starvation Reservoir, US-40 east'],
  ]],
  ['TAB', 'Tabiona', 'Duchesne SO', [
    ['A', 'Central — Tabiona townsite, SR-35 corridor'],
  ]],
  ['MYT', 'Myton', 'Duchesne SO', [
    ['A', 'Central — Myton townsite, US-40 junction'],
  ]],
]);

// ═══════════════════════════════════════════════════════════════════
//  DAGGETT COUNTY — NEW
// ═══════════════════════════════════════════════════════════════════

const DG1 = buildSection('DG1', 'Daggett', [
  ['MNL', 'Manila', 'Daggett SO', [
    ['A', 'Central / Main — Manila center, Flaming Gorge Hwy'],
    ['B', 'North / Flaming Gorge — Flaming Gorge Dam & reservoir'],
  ]],
  ['DCH', 'Dutch John', 'Daggett SO', [
    ['A', 'Central — Dutch John community, Flaming Gorge base'],
  ]],
]);

// ═══════════════════════════════════════════════════════════════════
//  CARBON COUNTY — NEW
// ═══════════════════════════════════════════════════════════════════

const CB1 = buildSection('CB1', 'Carbon', [
  ['PRC', 'Price', 'Price PD', [
    ['A', 'Downtown / Main — Price center, USU Eastern, Main St'],
    ['B', 'East / Wellington — Wellington connector, US-6 east'],
    ['C', 'North / Spring Glen — Spring Glen, north residential'],
  ]],
  ['HLP', 'Helper', 'Carbon SO', [
    ['A', 'Central / Main — Helper center, historic Main St'],
    ['B', 'North / US-6 — US-6 canyon corridor, north Helper'],
  ]],
  ['ECB', 'East Carbon', 'Carbon SO', [
    ['A', 'Central — East Carbon/Sunnyside, mining community'],
  ]],
]);

// ═══════════════════════════════════════════════════════════════════
//  EMERY COUNTY — NEW
// ═══════════════════════════════════════════════════════════════════

const EM1 = buildSection('EM1', 'Emery', [
  ['CSD', 'Castle Dale', 'Emery SO', [
    ['A', 'Central / Main — Castle Dale center, courthouse, SR-10'],
    ['B', 'North / Huntington — Huntington connector, SR-10 north'],
  ]],
  ['GRV', 'Green River', 'Green River PD', [
    ['A', 'Central / Main — Green River center, Main St, I-70 exit'],
    ['B', 'East / Book Cliffs — Book Cliffs, east desert, I-70 east'],
  ]],
  ['FER', 'Ferron', 'Emery SO', [
    ['A', 'Central — Ferron center, SR-10 corridor'],
  ]],
]);

// ═══════════════════════════════════════════════════════════════════
//  GRAND COUNTY — NEW
// ═══════════════════════════════════════════════════════════════════

const GD1 = buildSection('GD1', 'Grand', [
  ['MOB', 'Moab', 'Moab PD', [
    ['A', 'Downtown / Main — Moab center, Main St, visitor core'],
    ['B', 'North / Arches — Arches NP entrance, US-191 north'],
    ['C', 'South / Spanish Valley — Spanish Valley, south residential'],
  ]],
  ['CSL', 'Castle Valley', 'Grand SO', [
    ['A', 'Central — Castle Valley community, La Sal Mtn connector'],
  ]],
]);

// ═══════════════════════════════════════════════════════════════════
//  SAN JUAN COUNTY — NEW
// ═══════════════════════════════════════════════════════════════════

const SJ1 = buildSection('SJ1', 'San Juan', [
  ['MTC', 'Monticello', 'San Juan SO', [
    ['A', 'Central / Main — Monticello center, courthouse, US-191'],
    ['B', 'South / Canyonlands — Canyonlands access, Needles District'],
  ]],
  ['BLD', 'Blanding', 'Blanding PD', [
    ['A', 'Central / Main — Blanding center, Main St, Edge of Cedars'],
    ['B', 'South / Bluff — Bluff connector, US-191 south'],
  ]],
]);

// ═══════════════════════════════════════════════════════════════════
//  MILLARD COUNTY — NEW
// ═══════════════════════════════════════════════════════════════════

const MD1 = buildSection('MD1', 'Millard', [
  ['FLM', 'Fillmore', 'Millard SO', [
    ['A', 'Central / Main — Fillmore center, Territorial Capitol, I-15'],
    ['B', 'South / Meadow — Meadow connector, south rural'],
  ]],
  ['DLT', 'Delta', 'Delta PD', [
    ['A', 'Central / Main — Delta center, Main St corridor'],
    ['B', 'West / Hinckley — Hinckley, west Millard County'],
  ]],
]);

// ═══════════════════════════════════════════════════════════════════
//  BEAVER COUNTY — NEW
// ═══════════════════════════════════════════════════════════════════

const BV1 = buildSection('BV1', 'Beaver', [
  ['BVR', 'Beaver', 'Beaver SO', [
    ['A', 'Central / Main — Beaver center, courthouse, I-15 exit'],
    ['B', 'East / Beaver Canyon — Beaver Canyon, SR-153, Elk Meadows'],
  ]],
  ['MNV', 'Minersville', 'Beaver SO', [
    ['A', 'Central — Minersville townsite, reservoir area'],
  ]],
]);

// ═══════════════════════════════════════════════════════════════════
//  PIUTE COUNTY — NEW
// ═══════════════════════════════════════════════════════════════════

const PU1 = buildSection('PU1', 'Piute', [
  ['JNC', 'Junction', 'Piute SO', [
    ['A', 'Central — Junction center, county seat, US-89'],
    ['B', 'North / Piute Reservoir — Piute Reservoir, north corridor'],
  ]],
  ['CRV', 'Circleville', 'Piute SO', [
    ['A', 'Central — Circleville center, US-89 corridor, Butch Cassidy area'],
  ]],
]);

// ═══════════════════════════════════════════════════════════════════
//  WAYNE COUNTY — NEW
// ═══════════════════════════════════════════════════════════════════

const WN1 = buildSection('WN1', 'Wayne', [
  ['LOA', 'Loa', 'Wayne SO', [
    ['A', 'Central — Loa center, county seat, SR-24'],
    ['B', 'East / Bicknell — Bicknell connector, west Capitol Reef'],
  ]],
  ['TRY', 'Torrey', 'Wayne SO', [
    ['A', 'Central — Torrey center, Capitol Reef gateway, SR-24/SR-12'],
  ]],
  ['HKV', 'Hanksville', 'Wayne SO', [
    ['A', 'Central — Hanksville center, SR-24/SR-95 junction'],
  ]],
]);

// ═══════════════════════════════════════════════════════════════════
//  SEVIER COUNTY — NEW
// ═══════════════════════════════════════════════════════════════════

const SV1 = buildSection('SV1', 'Sevier', [
  ['RCH', 'Richfield', 'Richfield PD', [
    ['A', 'Downtown / Main — Richfield center, Main St, courthouse'],
    ['B', 'East / Elsinore — Elsinore connector, east valley'],
    ['C', 'West / I-70 — I-70 corridor, west commercial'],
  ]],
  ['SLN', 'Salina', 'Sevier SO', [
    ['A', 'Central / Main — Salina center, I-70 exit, Main St'],
    ['B', 'East / Canyon — Salina Canyon, I-70 east corridor'],
  ]],
  ['AUR', 'Aurora', 'Sevier SO', [
    ['A', 'Central — Aurora center, SR-260 corridor'],
  ]],
]);

// ═══════════════════════════════════════════════════════════════════
//  GARFIELD COUNTY — NEW
// ═══════════════════════════════════════════════════════════════════

const GF1 = buildSection('GF1', 'Garfield', [
  ['PGH', 'Panguitch', 'Garfield SO', [
    ['A', 'Central / Main — Panguitch center, county seat, US-89'],
    ['B', 'South / Bryce — Bryce Canyon connector, SR-12'],
  ]],
  ['ESC', 'Escalante', 'Garfield SO', [
    ['A', 'Central — Escalante center, SR-12, Grand Staircase gateway'],
    ['B', 'East / Boulder — Boulder connector, SR-12 scenic'],
  ]],
  ['TPC', 'Tropic', 'Garfield SO', [
    ['A', 'Central — Tropic/Cannonville, Bryce Canyon east entrance'],
  ]],
]);

// ═══════════════════════════════════════════════════════════════════
//  KANE COUNTY — NEW
// ═══════════════════════════════════════════════════════════════════

const KN1 = buildSection('KN1', 'Kane', [
  ['KNB', 'Kanab', 'Kanab PD', [
    ['A', 'Central / Main — Kanab center, Main St, county seat'],
    ['B', 'East / Fredonia — Fredonia connector, US-89A, AZ border'],
    ['C', 'North / Mt Carmel — Mt Carmel Junction, US-89/SR-9'],
  ]],
  ['ORD', 'Orderville', 'Kane SO', [
    ['A', 'Central — Orderville center, US-89 corridor'],
  ]],
  ['GLN', 'Glendale', 'Kane SO', [
    ['A', 'Central — Glendale center, US-89 corridor'],
  ]],
]);

// ═══════════════════════════════════════════════════════════════════
//  COMBINE ALL DISTRICTS
// ═══════════════════════════════════════════════════════════════════

export const DISPATCH_DISTRICTS: DistrictEntry[] = [
  // ── SALT LAKE COUNTY (Primary Jurisdiction) ──
  ...SL1, ...SL2, ...SL3, ...SL4, ...SL5,
  // ── DAVIS COUNTY ──
  ...DV1, ...DV2, ...DV3,
  // ── WEBER COUNTY ──
  ...WB1, ...WB2,
  // ── UTAH COUNTY ──
  ...UC1, ...UC2, ...UC3,
  // ── MORGAN COUNTY ──
  ...MG1,
  // ── WASATCH COUNTY ──
  ...WS1,
  // ── SUMMIT COUNTY ──
  ...SM1, ...SM2,
  // ── TOOELE COUNTY ──
  ...TL1, ...TL2,
  // ── CACHE COUNTY ──
  ...CH1, ...CH2,
  // ── RICH COUNTY ──
  ...RC1,
  // ── JUAB COUNTY ──
  ...JB1,
  // ── SANPETE COUNTY ──
  ...SP1, ...SP2, ...SP3,
  // ── BOX ELDER COUNTY ──
  ...BE1,
  // ── IRON COUNTY ──
  ...IR1,
  // ── WASHINGTON COUNTY ──
  ...WA1,
  // ── UINTAH COUNTY (UT) ──
  ...UT1,
  // ── DUCHESNE COUNTY ──
  ...DU1,
  // ── DAGGETT COUNTY ──
  ...DG1,
  // ── CARBON COUNTY ──
  ...CB1,
  // ── EMERY COUNTY ──
  ...EM1,
  // ── GRAND COUNTY ──
  ...GD1,
  // ── SAN JUAN COUNTY ──
  ...SJ1,
  // ── MILLARD COUNTY ──
  ...MD1,
  // ── BEAVER COUNTY ──
  ...BV1,
  // ── PIUTE COUNTY ──
  ...PU1,
  // ── WAYNE COUNTY ──
  ...WN1,
  // ── SEVIER COUNTY ──
  ...SV1,
  // ── GARFIELD COUNTY ──
  ...GF1,
  // ── KANE COUNTY ──
  ...KN1,
  // ── WYOMING — Uinta County ──
  ...WY1, ...WY2, ...WY3,
];
