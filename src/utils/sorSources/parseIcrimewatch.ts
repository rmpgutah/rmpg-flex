// Pure HTML parsers for iCrimeWatch (OffenderWatch) agency 54438 pages.
// No DOM dependency — operates on the raw HTML string so it runs in the Worker
// and in vitest. Tolerant: a missing field yields '' rather than throwing.
//
// The iCrimeWatch detail page is a table-based layout. After stripTags(),
// labels and values appear on *separate* lines (the <td> close tag converts
// to \n). Each field pattern looks at the text following a label line.

export interface SorScrapeRow {
  registry_id: string;
  first_name: string;
  middle_name: string;
  last_name: string;
  date_of_birth: string;
  sex: string;
  race: string;
  height: string;
  weight: string;
  hair_color: string;
  eye_color: string;
  scars_marks: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  offense: string;
  registration_status: string;
  photo_url: string;
  detail_json: string;
}

export function stripTags(html: string): string {
  return html
    // Tag-strip pass — close tags may have whitespace before the `>`
    // (e.g. `</script >`), so allow optional \s* before the closing bracket.
    // CodeQL js/bad-tag-filter explicitly flags the unspaced variants.
    .replace(/<script[\s\S]*?<\/script[^>]*>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style[^>]*>/gi, ' ')
    .replace(/<br\s*\/?>(?=)/gi, '\n')
    .replace(/<\/(td|tr|p|div|li)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    // Entity-decode pass — `&amp;` MUST be decoded LAST so that an
    // already-encoded literal like `&amp;#39;` (which represents the text
    // `&#39;`, not an apostrophe) is not double-unescaped into "'".
    // Order matters: do every other entity first, then amp.
    .replace(/&nbsp;/gi, ' ')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&amp;/gi, '&')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{2,}/g, '\n')
    .trim();
}

/** Non-empty trimmed lines from stripped text. */
function nonEmptyLines(text: string): string[] {
  return text.split('\n').map((l) => l.trim()).filter(Boolean);
}

/**
 * Find the value that appears after a label line (case-insensitive exact match
 * on the trimmed label text). Returns the first non-empty line following it.
 */
function lineAfterLabel(lines: string[], label: string): string {
  const lc = label.toLowerCase();
  for (let i = 0; i < lines.length - 1; i++) {
    if (lines[i].toLowerCase() === lc) {
      // Skip to the next non-empty line
      for (let j = i + 1; j < lines.length; j++) {
        if (lines[j].trim()) return lines[j].trim();
      }
    }
  }
  return '';
}

/**
 * Find the first non-empty line after a label line that starts with `prefix`
 * (case-insensitive). Useful for "• Sex:", "• Race:", etc. where the label
 * may carry bullet and spaces.
 */
function lineAfterPrefix(lines: string[], prefix: string): string {
  const lc = prefix.toLowerCase();
  for (let i = 0; i < lines.length - 1; i++) {
    if (lines[i].toLowerCase().startsWith(lc)) {
      for (let j = i + 1; j < lines.length; j++) {
        if (lines[j].trim()) return lines[j].trim();
      }
    }
  }
  return '';
}

/** All offender detail links → unique OfndrID strings (results-page parser). */
export function extractOfndrIds(html: string): string[] {
  const ids: string[] = [];
  const seen = new Set<string>();
  const re = /OfndrID=(\d+)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    if (!seen.has(m[1])) { seen.add(m[1]); ids.push(m[1]); }
  }
  return ids;
}

/**
 * Extract the offender photo URL from the raw HTML.
 * Prefers /pictures/<office>/<id>... paths (actual offender photo).
 * Falls back to /offices/<id>/... only if no /pictures/ match (agency banner
 * is under /offices/ — we do NOT want that).
 */
export function extractPhoto(html: string): string {
  // Prefer /pictures/ path — this is the offender mugshot
  const picM = /https?:\/\/[^\s"')]*\/pictures\/\d+\/[^\s"')]+\.(?:jpg|jpeg|png)/i.exec(html);
  if (picM) return picM[0];
  return '';
}

export function parseIcrimewatchDetail(html: string, ofndrId: string): SorScrapeRow {
  const text = stripTags(html);
  const lines = nonEmptyLines(text);

  // --- Name ---
  // Label line: "Name:" → next line: "Camden Joseph CLARK"
  const fullName = lineAfterLabel(lines, 'Name:').replace(/\s+/g, ' ').trim();
  // SOR renders "First [Middle] LAST" — surname is trailing ALL-CAPS token(s)
  const tokens = fullName.split(/\s+/).filter(Boolean);
  const capsStart = tokens.findIndex((t, i) => i > 0 && /^[A-Z'-]+$/.test(t));
  const last_name = capsStart >= 0 ? tokens.slice(capsStart).join(' ') : (tokens[tokens.length - 1] ?? '');
  const given = capsStart >= 0 ? tokens.slice(0, capsStart) : tokens.slice(0, -1);
  const first_name = given[0] ?? '';
  const middle_name = given.slice(1).join(' ');

  // --- Registration # ---
  // Label line: "Registration #:" → next non-empty line: "2301330"
  const regNum = lineAfterLabel(lines, 'Registration #:');
  // If ofndrId provided use it; otherwise parse from page
  const registry_id = ofndrId || regNum.replace(/\D/g, '');

  // --- Status ---
  // Label line: "Status:" → next non-empty line: "Active"
  const registration_status = lineAfterLabel(lines, 'Status:');

  // --- DOB / Age ---
  // Physical desc line: "37  (DOB: 05/31/1989)" — appears after "• Age:" label
  const ageLine = lineAfterPrefix(lines, '• Age:');
  const dobMatch = /DOB:\s*([\d/]+)/i.exec(ageLine);
  const date_of_birth = dobMatch ? dobMatch[1] : '';

  // --- Physical description (label/value on alternating lines) ---
  const sex = lineAfterPrefix(lines, '• Sex:');
  const race = lineAfterPrefix(lines, '• Race:');
  const height = lineAfterPrefix(lines, '• Height:');
  const weight = lineAfterPrefix(lines, '• Weight:');
  const hair_color = lineAfterPrefix(lines, '• Hair:');
  const eye_color = lineAfterPrefix(lines, '• Eyes:');

  // Scars/Tattoos: multi-line value in a colspan cell. After the label line,
  // collect non-empty lines until a line matching a section header.
  const scars_marks = (() => {
    const idx = lines.findIndex((l) => l.toLowerCase().startsWith('• scars/tattoos:'));
    if (idx < 0) return '';
    const parts: string[] = [];
    for (let i = idx + 1; i < lines.length; i++) {
      const l = lines[i];
      // Stop at section headers or next bullet label
      if (/^(Physical Description|Address|Offenses|Aliases:|Status:|Registration)$/i.test(l)) break;
      if (/^•\s*(sex|race|height|weight|hair|eyes):/i.test(l)) break;
      if (l === ',') continue; // separator artifact
      parts.push(l);
    }
    return parts.join(' ').replace(/\s*,\s*/g, ', ').trim();
  })();

  // --- Address ---
  // After the "Address" section heading line, look for:
  //   "3506 S BLAIR CIR"
  //   "B"  (apt/unit — may or may not be present)
  //   "SALT LAKE CITY, UT 84115"
  const addrIdx = lines.findIndex((l) => l === 'Address');
  let address = '', city = '', state = 'UT', zip = '';
  if (addrIdx >= 0) {
    // Collect lines until we hit a recognizable next section or a link text
    const addrLines: string[] = [];
    for (let i = addrIdx + 1; i < lines.length; i++) {
      const l = lines[i];
      if (/^(Other Known Addresses|View Map|Offenses|Vehicles|Submit a tip)/i.test(l)) break;
      if (l) addrLines.push(l);
    }
    // Last addr line should match "CITY, ST ZIP" or "CITY, ST  ZIP"
    const cityLineIdx = addrLines.findIndex((l) => /[A-Z][\w .'-]+,\s*[A-Z]{2}\s+\d{5}/.test(l));
    if (cityLineIdx >= 0) {
      const cityLine = addrLines[cityLineIdx];
      const cm = /^([A-Z][\w .'-]+),\s*([A-Z]{2})\s+(\d{5})/.exec(cityLine);
      if (cm) { city = cm[1].trim(); state = cm[2]; zip = cm[3]; }
      // Everything before the city line is the street address
      address = addrLines.slice(0, cityLineIdx).join(' ').trim();
    }
  }

  // --- Aliases ---
  // The "Aliases:" label is on a line; the values appear in nameContent spans
  // on subsequent lines until Status: line
  const aliases = (() => {
    const idx = lines.findIndex((l) => l === 'Aliases:');
    if (idx < 0) return [];
    const out: string[] = [];
    for (let i = idx + 1; i < lines.length; i++) {
      const l = lines[i];
      if (/^(Status:|Physical Description|Address|Offenses)$/i.test(l)) break;
      if (l && l !== 'Aliases:') out.push(l);
    }
    return [...new Set(out)]; // deduplicate
  })();

  // --- Offenses ---
  // After "Offenses" section heading, labels are "• Description:", "• Date Convicted:", etc.
  // The VALUE is on the NEXT non-empty line (not same line).
  const offenses: Array<Record<string, string>> = [];
  const offIdx = lines.findIndex((l) => l === 'Offenses');
  if (offIdx >= 0) {
    let desc = '', dateConvicted = '', convictionState = '', releaseDate = '', details = '', counts = '';
    let inOffense = false;
    for (let i = offIdx + 1; i < lines.length; i++) {
      const l = lines[i];
      // Stop at next major section
      if (/^(Professional Licenses|Vehicles|Other Known Addresses)$/i.test(l)) break;

      if (/^•\s*Description:$/i.test(l)) {
        // Save previous offense if any
        if (inOffense && desc) offenses.push({ description: desc, dateConvicted, convictionState, releaseDate, details, counts });
        desc = ''; dateConvicted = ''; convictionState = ''; releaseDate = ''; details = ''; counts = '';
        inOffense = true;
        // Value is next non-empty line
        for (let j = i + 1; j < lines.length; j++) {
          if (lines[j].trim() && !/^•/.test(lines[j])) { desc = lines[j].trim(); i = j; break; }
          if (/^•/.test(lines[j])) break;
        }
      } else if (/^•\s*Date Convicted:$/i.test(l)) {
        for (let j = i + 1; j < lines.length; j++) {
          if (lines[j].trim() && !/^•/.test(lines[j])) { dateConvicted = lines[j].trim(); i = j; break; }
          if (/^•/.test(lines[j])) break;
        }
      } else if (/^•\s*Conviction State:$/i.test(l)) {
        for (let j = i + 1; j < lines.length; j++) {
          if (lines[j].trim() && !/^•/.test(lines[j])) { convictionState = lines[j].trim(); i = j; break; }
          if (/^•/.test(lines[j])) break;
        }
      } else if (/^•\s*Release Date:$/i.test(l) || l === '•') {
        // Handle split "•\nRelease Date:" pattern
        const nextL = lines[i + 1] ?? '';
        if (/^Release Date:$/i.test(nextL)) {
          i++; // skip "Release Date:" line, value is next
          for (let j = i + 1; j < lines.length; j++) {
            if (lines[j].trim() && !/^•/.test(lines[j])) { releaseDate = lines[j].trim(); i = j; break; }
            if (/^•/.test(lines[j])) break;
          }
        }
      } else if (/^•\s*Details:$/i.test(l)) {
        for (let j = i + 1; j < lines.length; j++) {
          if (lines[j].trim() && !/^•/.test(lines[j])) { details = lines[j].trim(); i = j; break; }
          if (/^•/.test(lines[j])) break;
        }
      } else if (/^•\s*Counts:$/i.test(l)) {
        for (let j = i + 1; j < lines.length; j++) {
          if (lines[j].trim() && !/^•/.test(lines[j])) { counts = lines[j].trim(); i = j; break; }
          if (/^•/.test(lines[j])) break;
        }
      }
    }
    if (inOffense && desc) offenses.push({ description: desc, dateConvicted, convictionState, releaseDate, details, counts });
  }

  const photo_url = extractPhoto(html);

  const detail = {
    status: registration_status,
    aliases,
    offenses,
    scarsMarks: scars_marks,
    address: { line: address, city, state, zip },
    photoUrl: photo_url,
    sourceUrl: `https://www.icrimewatch.net/offenderdetails.php?OfndrID=${ofndrId}&AgencyID=54438`,
    scrapedAt: new Date().toISOString(),
  };

  return {
    registry_id,
    first_name,
    middle_name,
    last_name,
    date_of_birth,
    sex,
    race,
    height,
    weight,
    hair_color,
    eye_color,
    scars_marks,
    address,
    city,
    state,
    zip,
    offense: offenses[0]?.description ?? '',
    registration_status,
    photo_url,
    detail_json: JSON.stringify(detail),
  };
}
