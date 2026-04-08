# IPED Hash Set Reference Files

Pre-built hash set files for import into the RMPG Flex IPED Digital Forensics system.

## Files

| File | Category | Type | Count | Description |
|------|----------|------|-------|-------------|
| `nsrl-known-good-os.md5` | known_good | MD5 | 35 | OS system files (Windows, macOS, Linux) |
| `known-good-office.md5` | known_good | MD5 | 22 | Office apps, browsers, utilities |
| `known-bad-malware.md5` | known_bad | MD5 | 32 | Malware, RATs, keyloggers, miners |
| `known-bad-drugs.md5` | known_bad | MD5 | 15 | Drug manufacturing & distribution |
| `known-bad-weapons.md5` | known_bad | MD5 | 14 | Weapons manufacturing & ghost guns |
| `known-bad-contraband.sha256` | known_bad | SHA-256 | 15 | Contraband media reference IDs |

## How to Import

### Via IPED Page UI
1. Navigate to Digital Forensics (F-key or menu)
2. Click "Import Hash Set" in the Hash Sets panel
3. Enter the file path: `/opt/rmpg-flex/server/hash-sets/<filename>`
4. Enter set name and select category
5. Click Import

### Via API
```bash
curl -X POST https://rmpgutah.us/api/iped/hash-sets/import \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "filePath": "/opt/rmpg-flex/server/hash-sets/known-bad-malware.md5",
    "setName": "Malware & Exploit Tools",
    "category": "known_bad",
    "hashType": "md5"
  }'
```

## Format

Each file uses one hash per line with optional filename after a comma:
```
# Comments start with #
d41d8cd98f00b204e9800998ecf8427e,desktop.ini
44d88612fea8a8f36de82e1278abb02f,wannacry.exe
```

## Replacing with Real Hash Sets

These are **example/reference hashes** for system testing. For production use, replace with:

- **NSRL**: Download from https://www.nist.gov/itl/ssd/software-quality-group/national-software-reference-library-nsrl
- **ProjectVIC/NCMEC**: Obtain through law enforcement channels (ICAC task force)
- **VirusTotal**: Export known-bad hashes from VT Intelligence
- **HashKeeper**: Import from the FBI's HashKeeper database
