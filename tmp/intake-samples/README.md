# Document Intake Sample Calibration

Drop real-world (redacted) PDFs into the per-kind subdirectories below to
calibrate the document-intake extractors. **Files in `tmp/` are git-ignored**
— samples never enter the repository, but the directory structure does.

## How to use

```bash
# Single file
tsx server/scripts/inspect-intake.ts tmp/intake-samples/court_order/protective_order_2024.pdf

# Force a specific kind (override the auto-detector)
tsx server/scripts/inspect-intake.ts tmp/intake-samples/sample.pdf --kind=trespass_order

# Show the OCR-extracted raw text alongside the field table
tsx server/scripts/inspect-intake.ts tmp/intake-samples/sample.pdf --raw

# Sweep an entire directory, exit non-zero on any below 0.6 confidence
for f in tmp/intake-samples/court_order/*.pdf; do
  tsx server/scripts/inspect-intake.ts "$f" --kind=court_order || echo "FAIL: $f"
done

# Pipe text directly (skips OCR — useful when you've already run pdftotext)
pdftotext -layout sample.pdf - | tsx server/scripts/inspect-intake.ts -
```

Output color coding mirrors the clerk-review UI:

- **green ≥80%**  — anchor's first pattern hit cleanly
- **yellow 50–79%** — anchor's fallback pattern hit (alias drift)
- **red <50%**     — fuzzy / discovered-only
- **red "miss"**    — anchor returned nothing; this is the calibration target

The script exits 0 if rolled-up confidence ≥ 0.6, 1 otherwise — so it
slots into shell loops or pre-push checks.

## Per-kind expected fields

Each extractor's anchors define the contract. Run with `--help` to see
all registered kinds and their tier (`implemented` vs `stub`). The
fields below are what each kind tries to capture — drop a sample whose
labels match these and the extractor should hit ≥0.6.

### `court_warrant` *(implemented)*
- docket_number, warrant_type, defendant_name, defendant_dob
- charges, bond_amount, issuing_judge, issued_date, court_name

### `court_summons` *(implemented)*
- court_name, court_county, court_state, civil_case_number
- plaintiff, defendant, attorney_firm, attorney_name, attorney_bar_number
- attorney_address, attorney_phone, attorney_email, attorney_for, document_subtype

### `court_order` *(stub — calibration target)*
- docket_number, order_type, petitioner, respondent, judge, order_date

### `trespass_order` *(stub — calibration target)*
- subject_name, subject_dob, property_address, property_owner
- effective_date, duration, issuing_officer

### `evidence_log` *(stub — calibration target)*
- case_number, evidence_number, description
- collected_by, collected_date, collected_location

### `investigation_report` *(stub — calibration target)*
- case_number, investigator, opened_date, incident_type, summary

### `fi_card` *(implemented)*
- subject_name, subject_dob, subject_address, phone
- reason_for_contact, action_taken, contact_location, contact_date, contact_time
- officer_name, badge_number, vehicle_plate, vehicle_description

### `witness_statement` *(implemented)*
- case_number, incident_number, witness_name, witness_dob, witness_address
- witness_phone, incident_date, incident_location, interviewing_officer
- badge_number, statement_date, statement_body

### `info_form` *(implemented)*
- reference_number, subject_name, subject_dob, subject_address, subject_phone
- occurrence_date, occurrence_location, reporting_party, narrative, reporting_officer

### `servemanager_job` *(implemented)*
- job_number, internal_id, job_due_date, client_firm
- server_firm, server_individual, server_phone, job_type
- job_status, recipient_name, recipient_dob, service_attempts_count

## Calibration workflow

1. Drop a sample → `tsx server/scripts/inspect-intake.ts <path>`
2. Read the **MISSES** section — those are the unmatched anchors
3. Open the corresponding extractor in
   `server/src/utils/documentIntake/extractors/<kind>.ts`
4. Add a fallback pattern alongside the existing ones for the missed field
5. Re-run; misses should turn into yellow hits (fallback-confidence)
6. Repeat against 3-5 different vendor templates so the patterns generalize
7. When confidence stays ≥ 0.6 across the sample set, promote `tier: 'stub'`
   to `tier: 'implemented'`

Real samples beat synthetic ones every time — vendor label drift is the
hardest part to predict ("Issuing Judge" vs "Hon." vs "/s/ NAME, Judge").
