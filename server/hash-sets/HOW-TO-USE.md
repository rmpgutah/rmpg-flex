# IPED Digital Forensics — Complete Usage Guide

## Quick Start (5 Minutes)

### Step 1: Import Hash Sets
1. Open RMPG Flex → Menu → Tools → **Digital Forensics**
2. In the **Hash Sets** panel, click **Import Hash Set**
3. Click **IMPORT ALL 11 SETS** to load all pre-built hash databases
4. You now have 215 hashes loaded across 11 categories

### Step 2: Upload Evidence
1. Go to **Evidence & Property** (F8 or menu)
2. Select any evidence item → click **Attachments** tab
3. Upload files (photos, documents, device images, etc.)
4. The system **automatically hashes every uploaded file** (MD5, SHA-1, SHA-256, SHA-512)
5. If a file matches a **known-bad** hash set → **RED ALERT** broadcasts to all officers

### Step 3: Review Flagged Files
1. Return to **Digital Forensics** page
2. Check the **HASH REVIEW QUEUE** section
3. For each flagged file, choose a disposition:
   - **Threat** (red) — Confirmed malicious/illegal content
   - **False Positive** (green) — Hash matched but file is benign
   - **Analyze** (amber) — Needs deeper investigation
4. Add notes explaining your decision
5. All reviews are audit-logged with your name and timestamp

### Step 4: Verify Evidence Integrity
1. Go to **Evidence & Property** → select an evidence item
2. Click the **Digital Forensics** tab (Shield icon)
3. Click **Verify Integrity**
4. System re-hashes all files and compares to original hashes
5. **Green** = integrity confirmed, **Red** = possible tampering

---

## Detailed Feature Guide

### Hash Sets — What They Do

Hash sets are databases of known file fingerprints. Think of them like a fingerprint database for files instead of people.

**Known Bad** (red) — Files that are threats:
| Set | What It Detects |
|-----|----------------|
| Malware & Exploit Tools | Ransomware (WannaCry, Petya, LockBit), RATs (CobaltStrike, Mimikatz), keyloggers, crypto miners |
| Drug Manufacturing | Synthesis guides, dealer ledger templates, precursor supplier lists, darknet marketplace tools |
| Weapons & Explosives | 3D-printed firearm STL files (ghost guns), IED assembly manuals, trafficking records |
| Contraband Media | NCMEC/ProjectVIC reference hashes for illegal content |
| Financial Fraud | Credit card skimmer firmware, check fraud templates, identity theft tools, money laundering software |
| Cybercrime Tools | DDoS kits, SQL injection tools, phishing frameworks, ransomware builders |
| Human Trafficking | DHS/HSI Blue Campaign reference hashes for trafficking-related digital evidence |
| Stalkerware | Hidden phone monitoring apps (mSpy, FlexiSpy), GPS trackers, hidden camera viewers, consumer keyloggers |

**Known Good** (green) — Files to safely ignore:
| Set | What It Excludes |
|-----|-----------------|
| OS System Files | Windows (explorer.exe, svchost.exe, kernel32.dll), macOS (Finder, launchd), Linux (bash, systemd) |
| Office & Applications | MS Office, Adobe, Chrome, Firefox, 7-Zip, VLC, PuTTY |
| Common Media | Default wallpapers, system sounds, stock photo watermarks, sample videos |

### How Auto-Hash Works

```
Officer uploads evidence file
         ↓
System computes 4 hashes (MD5, SHA-1, SHA-256, SHA-512)
         ↓
Checks all loaded hash sets for matches
         ↓
    ┌────┴────┐
    ↓         ↓
NO MATCH   MATCH FOUND
    ↓         ↓
 Green dot  ┌──┴──┐
 (clean)    ↓     ↓
         Known  Known
         Bad    Good
           ↓      ↓
        RED ALERT  Note in
        + Review   hash log
        Queue      (exclude)
```

### Evidence Page — Forensics Tab

Every evidence item has a **Digital Forensics** tab showing:

1. **Hash Status Summary** — Total hashes, flagged count, last verification
2. **Hash All Attachments** — Manually trigger hashing (auto-hash does this on upload)
3. **Verify Integrity** — Re-hash and compare to detect tampering
4. **Hash Results Table** — Every file with MD5, SHA-256, flagged/review status
5. **Colored Dots** in evidence list:
   - 🟢 Green = all hashes clean
   - 🔴 Red = flagged hashes found
   - ⚪ Gray = not yet hashed

### Hash Search

Search across ALL evidence by:
- **Hash value** — Paste a full or partial MD5/SHA-256
- **Hash set** — Filter by which set matched
- **Flagged status** — Show only flagged or clean files
- **Review status** — Pending, confirmed threat, false positive, needs analysis
- **Date range** — When the hash was computed

### Export for Court

Click **Export CSV** in the Hash Search panel to generate a court-ready report:
- Evidence number
- File name
- MD5, SHA-1, SHA-256, SHA-512
- Flagged status
- Review disposition
- Reviewer name
- Timestamp

The CSV includes a UTF-8 BOM for proper Excel rendering.

### Duplicate Detection

Click **Scan for Duplicates** to find identical files across all evidence items. This helps:
- Link related cases (same file found on multiple devices)
- Identify copied/distributed contraband
- Find redundant evidence to streamline analysis

### Integrity Verification — Chain of Custody

**Why it matters:** In court, the defense can challenge digital evidence by claiming it was altered after collection. Hash verification proves the file hasn't changed.

**How to verify:**
1. Evidence detail → Digital Forensics tab → **Verify Integrity**
2. System re-computes all 4 hashes and compares to stored originals
3. If ALL match → **"Verified — Integrity Intact"** (green banner)
4. If ANY mismatch → **"INTEGRITY ALERT"** (red banner with details)

**Every verification is audit-logged** — creates a court-admissible record showing:
- Who verified
- When they verified
- What the original hashes were
- What the current hashes are
- Whether they matched

### IPED Processing Jobs

For full disk forensics (not just individual files), create an IPED job:

| Job Type | What It Does | When to Use |
|----------|-------------|-------------|
| Hash | Compute hashes for all files in an image/directory | Quick analysis of a seized device |
| Process | Full forensic processing: file carving, metadata, timeline | Complete device forensics |
| Triage | Quick scan: prioritize by file type, extract key artifacts | Initial assessment of a device |
| CSAM Scan | Scan for known child exploitation material | ICAC investigations |

**Requirements:** IPED must be installed on the server with Java 11+. Configure in Admin → System → IPED Settings.

---

## Creating Custom Hash Sets

### File Format
```
# Lines starting with # are comments
# Metadata headers (optional but recommended):
# Source: Your Agency Name
# Category: known_bad
# Hash Type: md5
# Description: Custom hash set for Operation XYZ

d41d8cd98f00b204e9800998ecf8427e,filename.exe
44d88612fea8a8f36de82e1278abb02f,another_file.dll
3395856ce81f2b7382dee72602f798b6
```

- One hash per line
- Optional comma-separated filename after the hash
- Lines starting with `#` are ignored
- Supported extensions: `.md5`, `.sha256`, `.sha1`, `.csv`, `.txt`

### Where to Place Files
```
/opt/rmpg-flex/server/hash-sets/your-custom-set.md5
```

Files placed in this directory automatically appear in the Import dropdown.

### Getting Real Hash Sets

| Source | How to Get | Type |
|--------|-----------|------|
| NIST NSRL | https://www.nist.gov/itl/ssd/software-quality-group/national-software-reference-library-nsrl | Known good |
| ProjectVIC | Contact your ICAC task force representative | Known bad (CSAM) |
| NCMEC | Law enforcement portal access required | Known bad (CSAM) |
| VirusTotal | VT Intelligence subscription | Known bad (malware) |
| FBI HashKeeper | Law enforcement access via FBI | Mixed |
| CISA | https://www.cisa.gov/known-exploited-vulnerabilities-catalog | Known bad (exploits) |

---

## Troubleshooting

### "No hash sets loaded"
→ Import hash sets from the Digital Forensics page → Import Hash Set

### "Auto-hash not working"
→ Check Admin → System → IPED Settings → ensure "Auto Hash on Upload" is enabled

### "IPED job stuck at 0%"
→ Verify IPED is installed and Java 11+ is available
→ Check the job detail for error messages
→ Verify the input path exists and is readable

### "Hash verification shows mismatch"
→ This is CRITICAL — the evidence file may have been modified
→ Document the mismatch immediately
→ Notify your supervisor
→ Preserve the original hash record (it's in the audit log)
→ Do NOT delete or modify the evidence file

### "CSV export garbled in Excel"
→ The system includes UTF-8 BOM. If still garbled:
→ Open Excel → Data → From Text/CSV → select the file → choose UTF-8 encoding
