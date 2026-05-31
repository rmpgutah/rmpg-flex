-- Migration 0050: 250 Additional Advanced Admin Settings
-- Extends system_settings with new categories and deepens existing ones.

-- ═══════════════════════════════════════════════════════════════
-- ADVANCED SECURITY (new category — extends 'security')
-- ═══════════════════════════════════════════════════════════════
INSERT OR IGNORE INTO system_settings (category, key, default_value, type, label, description, ui_order) VALUES
('security', 'password_history_count', '5', 'number', 'Password History', 'Number of previous passwords that cannot be reused', 13),
('security', 'password_max_age_days', '90', 'number', 'Password Max Age', 'Maximum days a password can be used before forced change', 14),
('security', 'password_min_age_hours', '24', 'number', 'Password Min Age', 'Minimum hours before a password can be changed again', 15),
('security', 'account_inactivity_days', '90', 'number', 'Account Inactivity', 'Days of inactivity before account is disabled (0 = never)', 16),
('security', 'mfa_remember_device_days', '30', 'number', 'Remember Device', 'Days to trust a device after 2FA verification', 17),
('security', 'mfa_backup_codes_count', '10', 'number', 'Backup Codes Count', 'Number of one-time backup codes generated per user', 18),
('security', 'session_concurrent_max', '3', 'number', 'Max Concurrent Sessions', 'Maximum simultaneous sessions per user', 19),
('security', 'session_ip_binding', 'false', 'boolean', 'IP Session Binding', 'Bind sessions to IP address (breaks mobile/WiFi switching)', 20),
('security', 'api_require_hmac', 'false', 'boolean', 'API HMAC Signing', 'Require HMAC signature on all API requests', 21),
('security', 'api_key_rotation_days', '90', 'number', 'API Key Rotation', 'Days before API keys auto-expire (0 = never)', 22),
('security', 'brute_force_delay_ms', '1000', 'number', 'Brute Force Delay', 'Milliseconds delay added after each failed login attempt', 23),
('security', 'audit_retention_years', '7', 'number', 'Audit Log Retention', 'Years to retain security audit logs', 24),
('security', 'require_mfa_off_duty', 'false', 'boolean', 'MFA Off-Duty', 'Require MFA even when accessing from trusted network', 25),
('security', 'geo_restrict_login', 'false', 'boolean', 'Geo-Restrict Login', 'Block logins from outside configured geographic regions', 26),
('security', 'geo_allowed_countries', 'US', 'string', 'Allowed Countries', 'Comma-separated ISO country codes for geo-restriction', 27);

-- ═══════════════════════════════════════════════════════════════
-- ADVANCED DISPATCH (deepens 'dispatch' category)
-- ═══════════════════════════════════════════════════════════════
INSERT OR IGNORE INTO system_settings (category, key, default_value, type, label, description, options, ui_order) VALUES
('dispatch', 'auto_dispatch_enabled', 'false', 'boolean', 'Auto-Dispatch', 'Automatically assign nearest available unit to calls', 13),
('dispatch', 'auto_dispatch_max_distance_m', '5000', 'number', 'Auto-Dispatch Max Distance', 'Maximum distance in meters for auto-dispatch assignment', 14),
('dispatch', 'priority_escalation_minutes', '15', 'number', 'Priority Escalation', 'Minutes before pending P2 call auto-escalates to P1', 15),
('dispatch', 'zone_based_routing', 'false', 'boolean', 'Zone-Based Routing', 'Route calls to units based on beat/zone assignment', 16),
('dispatch', 'skill_based_assignment', 'true', 'boolean', 'Skill-Based Assignment', 'Consider officer certifications when recommending units', 17),
('dispatch', 'call_hold_timeout_minutes', '10', 'number', 'Call Hold Timeout', 'Minutes a call can remain on hold before alerting supervisor', 18),
('dispatch', 'backup_unit_auto_request', 'true', 'boolean', 'Auto Backup Request', 'Automatically dispatch backup for P1 calls', 19),
('dispatch', 'backup_unit_count', '2', 'number', 'Backup Unit Count', 'Number of backup units to auto-dispatch for P1 calls', 20),
('dispatch', 'mutual_aid_threshold', '3', 'number', 'Mutual Aid Threshold', 'Number of pending priority calls before mutual aid considered', 21),
('dispatch', 'call_stack_limit', '20', 'number', 'Call Stack Limit', 'Maximum calls in pending queue before overflow alert', 22),
('dispatch', 'unit_status_timeout_minutes', '120', 'number', 'Unit Status Timeout', 'Minutes before unresponsive unit triggers welfare check', 23),
('dispatch', 'geofence_entry_alert', 'true', 'boolean', 'Geofence Entry Alert', 'Alert when unit enters high-risk geofence zone', 24),
('dispatch', 'geofence_exit_alert', 'false', 'boolean', 'Geofence Exit Alert', 'Alert when unit leaves assigned patrol zone', 25),
('dispatch', 'pursuit_termination_auto', 'false', 'boolean', 'Pursuit Auto-Terminate', 'Auto-recommend pursuit termination after configurable time', 26),
('dispatch', 'pursuit_max_duration_minutes', '15', 'number', 'Pursuit Max Duration', 'Minutes before auto pursuit termination recommendation', 27),
('dispatch', 'call_type_requires_supervisor', '', 'string', 'Supervisor Required Types', 'Comma-separated call types requiring supervisor approval', 28),
('dispatch', 'night_shift_quiet_mode', 'false', 'boolean', 'Night Shift Quiet Mode', 'Reduce non-critical voice alerts during night shift hours', 29),
('dispatch', 'night_shift_start', '22:00', 'string', 'Night Shift Start', 'Start time for quiet mode (HH:MM, 24h)', 30),
('dispatch', 'night_shift_end', '06:00', 'string', 'Night Shift End', 'End time for quiet mode (HH:MM, 24h)', 31);

-- ═══════════════════════════════════════════════════════════════
-- ADVANCED RECORDS (deepens 'records')
-- ═══════════════════════════════════════════════════════════════
INSERT OR IGNORE INTO system_settings (category, key, default_value, type, label, description, options, ui_order) VALUES
('records', 'field_validation_strict', 'false', 'boolean', 'Strict Field Validation', 'Enforce format validation on all record fields (SSN, DL, etc)', 11),
('records', 'required_person_fields', 'last_name,first_name,dob,gender,race', 'string', 'Required Person Fields', 'Comma-separated field keys required on person records', 12),
('records', 'required_vehicle_fields', 'plate_number,state,make,model,year,color', 'string', 'Required Vehicle Fields', 'Comma-separated field keys required on vehicle records', 13),
('records', 'auto_generate_case_numbers', 'true', 'boolean', 'Auto Case Numbers', 'Auto-generate sequential case numbers on new records', 14),
('records', 'case_number_format', 'YYYY-NNNNNN', 'select', 'Case Number Format', 'Format pattern for generated case numbers', '["YYYY-NNNNNN","YY-NNNNNN","NNNNNN-YYYY","CC-YYYY-NNNNNN"]', 15),
('records', 'duplicate_detection_enabled', 'true', 'boolean', 'Duplicate Detection', 'Scan for potential duplicate records on save', 16),
('records', 'duplicate_match_fields', 'last_name,first_name,dob', 'string', 'Duplicate Match Fields', 'Fields used for duplicate detection comparison', 17),
('records', 'narrative_min_chars', '50', 'number', 'Min Narrative Length', 'Minimum characters required for incident narratives', 18),
('records', 'narrative_max_chars', '10000', 'number', 'Max Narrative Length', 'Maximum characters allowed in incident narratives', 19),
('records', 'require_supplemental_narrative', 'false', 'boolean', 'Require Supplement', 'Require supplemental narrative on case closure', 20),
('records', 'auto_link_related_records', 'true', 'boolean', 'Auto-Link Records', 'Automatically link persons/vehicles to related calls', 21),
('records', 'photo_required_on_person', 'false', 'boolean', 'Require Person Photo', 'Require photo upload when creating person records', 22),
('records', 'dl_validation_required', 'true', 'boolean', 'DL Validation', 'Validate driver license numbers against state format', 23),
('records', 'vin_validation_required', 'true', 'boolean', 'VIN Validation', 'Validate VIN numbers (17 chars, checksum)', 24),
('records', 'dob_require_full', 'true', 'boolean', 'Require Full DOB', 'Require complete date of birth (not just year)', 25);

-- ═══════════════════════════════════════════════════════════════
-- BODY CAMERA / DASHCAM (new category)
-- ═══════════════════════════════════════════════════════════════
INSERT OR IGNORE INTO system_settings (category, key, default_value, type, label, description, ui_order) VALUES
('bodycam', 'auto_upload_enabled', 'true', 'boolean', 'Auto-Upload', 'Automatically upload footage when camera is docked', 1),
('bodycam', 'auto_upload_wifi_only', 'true', 'boolean', 'WiFi Only Upload', 'Only upload footage over WiFi (not cellular)', 2),
('bodycam', 'video_retention_days', '180', 'number', 'Video Retention', 'Days to retain non-evidentiary footage', 3),
('bodycam', 'evidentiary_retention_years', '7', 'number', 'Evidentiary Retention', 'Years to retain footage marked as evidence', 4),
('bodycam', 'auto_redact_faces', 'false', 'boolean', 'Auto-Redact Faces', 'Automatically blur faces in public footage releases', 5),
('bodycam', 'auto_redact_license_plates', 'false', 'boolean', 'Auto-Redact Plates', 'Automatically blur license plates in public releases', 6),
('bodycam', 'auto_tag_events', 'true', 'boolean', 'Auto-Tag Events', 'Automatically tag footage with event metadata', 7),
('bodycam', 'record_audio_by_default', 'true', 'boolean', 'Record Audio', 'Record audio with video by default', 8),
('bodycam', 'pre_record_seconds', '30', 'number', 'Pre-Record Buffer', 'Seconds of pre-event recording before activation', 9),
('bodycam', 'post_record_seconds', '60', 'number', 'Post-Record Buffer', 'Seconds of recording after deactivation', 10),
('bodycam', 'low_storage_warning_pct', '20', 'number', 'Low Storage Warning', 'Alert when device storage falls below this percentage', 11),
('bodycam', 'battery_low_warning_pct', '15', 'number', 'Low Battery Warning', 'Alert when device battery falls below this percentage', 12);

-- ═══════════════════════════════════════════════════════════════
-- NCIC / NLETS (new category)
-- ═══════════════════════════════════════════════════════════════
INSERT OR IGNORE INTO system_settings (category, key, default_value, type, label, description, ui_order) VALUES
('ncic', 'auto_query_on_call', 'true', 'boolean', 'Auto-Query on Call', 'Automatically run NCIC queries when call is created', 1),
('ncic', 'auto_query_on_stop', 'true', 'boolean', 'Auto-Query on Stop', 'Run NCIC queries on field interview subjects', 2),
('ncic', 'query_rate_limit_per_min', '30', 'number', 'Query Rate Limit', 'Maximum NCIC queries per minute per user', 3),
('ncic', 'query_cache_ttl_minutes', '15', 'number', 'Query Cache TTL', 'Minutes to cache NCIC query results', 4),
('ncic', 'auto_query_fields', 'person,vehicle,article,gun,boat', 'string', 'Auto-Query Types', 'NCIC record types to auto-query', 5),
('ncic', 'require_supervisor_orl', 'true', 'boolean', 'Supervisor ORI', 'Require supervisor approval for NCIC originated record locator', 6),
('ncic', 'wanted_hit_auto_notify', 'true', 'boolean', 'Wanted Hit Notification', 'Auto-notify supervisor on wanted person NCIC hit', 7),
('ncic', 'stolen_vehicle_hit_notify', 'true', 'boolean', 'Stolen Vehicle Notify', 'Auto-notify on stolen vehicle NCIC hit', 8),
('ncic', 'missing_person_hit_notify', 'true', 'boolean', 'Missing Person Notify', 'Auto-notify on missing person NCIC hit', 9),
('ncic', 'protection_order_hit_notify', 'true', 'boolean', 'Protection Order Notify', 'Auto-notify on active protection order NCIC hit', 10);

-- ═══════════════════════════════════════════════════════════════
-- WARRANTS (new category)
-- ═══════════════════════════════════════════════════════════════
INSERT OR IGNORE INTO system_settings (category, key, default_value, type, label, description, ui_order) VALUES
('warrants', 'auto_expire_days', '365', 'number', 'Auto-Expire Warrants', 'Days before unserved warrants are flagged for review', 1),
('warrants', 'scrape_schedule_hours', '24', 'number', 'Scrape Schedule', 'Hours between automated warrant list scrapes', 2),
('warrants', 'scrape_sources', '', 'string', 'Scrape Sources', 'Comma-separated URLs for warrant source lists', 3),
('warrants', 'confirm_before_serving', 'true', 'boolean', 'Confirm Before Serving', 'Require confirmation before marking warrant as served', 4),
('warrants', 'require_validation_photo', 'false', 'boolean', 'Require Validation Photo', 'Require photo upload when confirming warrant service', 5),
('warrants', 'warrant_expiry_warning_days', '30', 'number', 'Expiry Warning', 'Days before warrant expiry to send notification', 6),
('warrants', 'cross_reference_enabled', 'true', 'boolean', 'Cross-Reference', 'Cross-reference new warrants against existing persons', 7),
('warrants', 'national_search_enabled', 'true', 'boolean', 'National Search', 'Include national warrant databases in searches', 8),
('warrants', 'national_search_states', '', 'string', 'Search States', 'Comma-separated 2-letter state codes for national search', 9),
('warrants', 'sevice_attempt_max', '5', 'number', 'Max Service Attempts', 'Maximum service attempts before escalation', 10);

-- ═══════════════════════════════════════════════════════════════
-- ADVANCED REPORTS (deepens 'reports')
-- ═══════════════════════════════════════════════════════════════
INSERT OR IGNORE INTO system_settings (category, key, default_value, type, label, description, options, ui_order) VALUES
('reports', 'scheduled_report_time', '06:00', 'string', 'Scheduled Report Time', 'Daily time to generate scheduled reports (HH:MM, 24h)', 11),
('reports', 'scheduled_report_days', '1,2,3,4,5', 'string', 'Scheduled Report Days', 'Days to run scheduled reports (1=Mon, 7=Sun)', 12),
('reports', 'report_email_recipients', '', 'string', 'Report Recipients', 'Comma-separated emails for scheduled report delivery', 13),
('reports', 'report_retention_days', '365', 'number', 'Report Retention', 'Days to retain generated reports before cleanup', 14),
('reports', 'report_header_style', 'standard', 'select', 'Report Header Style', 'Layout style for report headers', '["standard","compact","full_branded","minimal"]', 15),
('reports', 'report_footer_style', 'standard', 'select', 'Report Footer Style', 'Layout style for report footers', '["standard","minimal","detailed"]', 16),
('reports', 'report_font_size', '10', 'number', 'Report Font Size', 'Base font size in points for generated PDFs', 17),
('reports', 'report_line_spacing', '1.5', 'number', 'Report Line Spacing', 'Line height multiplier for report text', 18),
('reports', 'report_include_continuation_header', 'true', 'boolean', 'Continuation Header', 'Show case number on continuation pages', 19),
('reports', 'report_include_officer_certification', 'true', 'boolean', 'Officer Certification', 'Include officer certification block on reports', 20);

-- ═══════════════════════════════════════════════════════════════
-- PATROL (new category)
-- ═══════════════════════════════════════════════════════════════
INSERT OR IGNORE INTO system_settings (category, key, default_value, type, label, description, ui_order) VALUES
('patrol', 'checkpoint_interval_hours', '2', 'number', 'Checkpoint Interval', 'Hours between required patrol checkpoints', 1),
('patrol', 'checkpoint_grace_minutes', '15', 'number', 'Checkpoint Grace', 'Minutes after scheduled time before checkpoint is late', 2),
('patrol', 'checkpoint_require_photo', 'false', 'boolean', 'Require Checkpoint Photo', 'Require photo at each patrol checkpoint', 3),
('patrol', 'checkpoint_require_notes', 'true', 'boolean', 'Require Checkpoint Notes', 'Require notes entry at each patrol checkpoint', 4),
('patrol', 'scan_interval_hours', '1', 'number', 'Scan Interval', 'Hours between required NFC/QR patrol scans', 5),
('patrol', 'missed_checkpoint_alert', 'true', 'boolean', 'Missed Checkpoint Alert', 'Alert supervisor on missed patrol checkpoint', 6),
('patrol', 'allow_manual_override', 'true', 'boolean', 'Manual Override', 'Allow officers to manually override checkpoint location', 7),
('patrol', 'route_optimization_enabled', 'true', 'boolean', 'Route Optimization', 'Optimize patrol routes for coverage efficiency', 8),
('patrol', 'patrol_zone_coverage_min_pct', '80', 'number', 'Zone Coverage Min %', 'Minimum patrol zone coverage percentage per shift', 9),
('patrol', 'inclement_weather_policy', 'standard', 'select', 'Weather Policy', 'Patrol policy during inclement weather', '["standard","reduced","indoor_only","discretionary"]', 10);

-- ═══════════════════════════════════════════════════════════════
-- ADVANCED FLEET (deepens 'fleet')
-- ═══════════════════════════════════════════════════════════════
INSERT OR IGNORE INTO system_settings (category, key, default_value, type, label, description, ui_order) VALUES
('fleet', 'maintenance_schedule_type', 'mileage', 'select', 'Maintenance Schedule', 'Schedule maintenance by mileage or time', '["mileage","time","both"]', 8),
('fleet', 'maintenance_interval_days', '90', 'number', 'Time-Based Interval', 'Days between scheduled maintenance (if time-based)', 9),
('fleet', 'tire_rotation_interval_km', '10000', 'number', 'Tire Rotation Interval', 'KM between recommended tire rotations', 10),
('fleet', 'oil_change_interval_km', '8000', 'number', 'Oil Change Interval', 'KM between recommended oil changes', 11),
('fleet', 'brake_inspection_interval_km', '20000', 'number', 'Brake Inspection Interval', 'KM between recommended brake inspections', 12),
('fleet', 'fuel_efficiency_target_kmpl', '10', 'number', 'Fuel Efficiency Target', 'Target kilometers per liter for fleet vehicles', 13),
('fleet', 'fuel_cost_per_liter', '1.20', 'number', 'Fuel Cost/Liter', 'Default fuel cost for budget calculations', 14),
('fleet', 'vehicle_lifecycle_km', '200000', 'number', 'Vehicle Lifecycle', 'KM at which vehicle replacement is recommended', 15),
('fleet', 'vehicle_lifecycle_years', '8', 'number', 'Vehicle Lifecycle Years', 'Years at which vehicle replacement is recommended', 16),
('fleet', 'pool_vehicle_reservation_enabled', 'false', 'boolean', 'Pool Reservations', 'Enable pool vehicle reservation system', 17),
('fleet', 'telemetry_collection_interval', '60', 'number', 'Telemetry Interval', 'Seconds between vehicle telemetry data collection', 18);

-- ═══════════════════════════════════════════════════════════════
-- HR / PERSONNEL (new category)
-- ═══════════════════════════════════════════════════════════════
INSERT OR IGNORE INTO system_settings (category, key, default_value, type, label, description, options, ui_order) VALUES
('hr', 'onboarding_checklist_enabled', 'true', 'boolean', 'Onboarding Checklist', 'Require new-hire onboarding checklist completion', 1),
('hr', 'background_check_required', 'true', 'boolean', 'Background Check', 'Require background check before activation', 2),
('hr', 'drug_test_required', 'true', 'boolean', 'Drug Test Required', 'Require pre-employment drug screening', 3),
('hr', 'psychological_eval_required', 'false', 'boolean', 'Psych Eval Required', 'Require psychological evaluation for armed positions', 4),
('hr', 'physical_agility_required', 'true', 'boolean', 'Physical Agility', 'Require physical agility test for field positions', 5),
('hr', 'driving_record_check_required', 'true', 'boolean', 'Driving Record Check', 'Require DMV driving record review', 6),
('hr', 'probation_period_days', '180', 'number', 'Probation Period', 'Days in new-hire probationary period', 7),
('hr', 'performance_review_interval_days', '365', 'number', 'Review Interval', 'Days between scheduled performance reviews', 8),
('hr', 'disciplinary_auto_escalation', 'true', 'boolean', 'Auto Escalation', 'Automatically escalate repeat disciplinary incidents', 9),
('hr', 'disciplinary_escalation_threshold', '3', 'number', 'Escalation Threshold', 'Number of incidents before auto-escalation', 10),
('hr', 'overtime_approval_required', 'true', 'boolean', 'Overtime Approval', 'Require supervisor approval for overtime hours', 11),
('hr', 'overtime_max_hours_week', '20', 'number', 'Max Overtime/Week', 'Maximum overtime hours allowed per week', 12);

-- ═══════════════════════════════════════════════════════════════
-- ADVANCED TRAINING (deepens 'training')
-- ═══════════════════════════════════════════════════════════════
INSERT OR IGNORE INTO system_settings (category, key, default_value, type, label, description, ui_order) VALUES
('training', 'auto_enroll_new_hires', 'true', 'boolean', 'Auto-Enroll New Hires', 'Automatically enroll new officers in required training', 8),
('training', 'prerequisite_enforcement', 'true', 'boolean', 'Enforce Prerequisites', 'Block course enrollment if prerequisites not met', 9),
('training', 'certification_renewal_grace_days', '30', 'number', 'Renewal Grace Period', 'Days after cert expiry before compliance violation', 10),
('training', 'online_course_completion_window_days', '30', 'number', 'Online Course Window', 'Days allowed to complete an online course after enrollment', 11),
('training', 'instructor_student_ratio_max', '20', 'number', 'Max Class Size', 'Maximum students per instructor for in-person training', 12),
('training', 'training_hours_tracking', 'annual', 'select', 'Hours Tracking', 'Training hours tracking period', '["annual","biannual","quarterly","continuous"]', 13),
('training', 'mandatory_topics', 'Use of Force,Legal Update,Active Shooter,De-escalation,First Aid/CPR', 'string', 'Mandatory Topics', 'Comma-separated list of mandatory annual training topics', 14),
('training', 'scenario_training_frequency_months', '3', 'number', 'Scenario Frequency', 'Months between required scenario-based training sessions', 15);

-- ═══════════════════════════════════════════════════════════════
-- RADIO / COMMUNICATIONS (new category)
-- ═══════════════════════════════════════════════════════════════
INSERT OR IGNORE INTO system_settings (category, key, default_value, type, label, description, options, ui_order) VALUES
('radio', 'default_channel', 'DISPATCH-1', 'string', 'Default Channel', 'Default radio channel on system start', 1),
('radio', 'ptt_mode', 'keyboard', 'select', 'PTT Mode', 'Push-to-talk activation method', '["keyboard","mouse","foot_pedal","voice"]', 2),
('radio', 'ptt_hotkey', 'F12', 'string', 'PTT Hotkey', 'Keyboard shortcut for push-to-talk', 3),
('radio', 'recording_enabled', 'true', 'boolean', 'Record Radio', 'Record all radio transmissions', 4),
('radio', 'recording_retention_days', '90', 'number', 'Recording Retention', 'Days to retain radio recordings', 5),
('radio', 'recording_auto_transcribe', 'false', 'boolean', 'Auto-Transcribe', 'Automatically transcribe radio recordings to text', 6),
('radio', 'voice_channel_enabled', 'true', 'boolean', 'Voice Channel', 'Enable AI voice channel for hands-free operation', 7),
('radio', 'voice_channel_language', 'en-US', 'string', 'Voice Language', 'BCP-47 language code for voice recognition', 8),
('radio', 'emergency_broadcast_override', 'true', 'boolean', 'Emergency Override', 'Emergency broadcasts override all other audio', 9),
('radio', 'radio_volume_default', '0.7', 'number', 'Default Volume', 'Default radio volume level (0-1)', 10);

-- ═══════════════════════════════════════════════════════════════
-- ADVANCED EMAIL (deepens 'email_templates')
-- ═══════════════════════════════════════════════════════════════
INSERT OR IGNORE INTO system_settings (category, key, default_value, type, label, description, ui_order) VALUES
('email_templates', 'smtp_host', '', 'string', 'SMTP Host', 'SMTP server hostname for custom email delivery', 6),
('email_templates', 'smtp_port', '587', 'number', 'SMTP Port', 'SMTP server port', 7),
('email_templates', 'smtp_username', '', 'string', 'SMTP Username', 'SMTP authentication username', 8),
('email_templates', 'smtp_password', '', 'string', 'SMTP Password', 'SMTP authentication password (stored encrypted)', 9),
('email_templates', 'smtp_use_tls', 'true', 'boolean', 'SMTP TLS', 'Use TLS encryption for SMTP connections', 10),
('email_templates', 'bounce_handling_enabled', 'true', 'boolean', 'Bounce Handling', 'Track and handle bounced emails', 11),
('email_templates', 'bounce_threshold', '5', 'number', 'Bounce Threshold', 'Number of bounces before marking email as invalid', 12),
('email_templates', 'max_emails_per_hour', '100', 'number', 'Rate Limit', 'Maximum outgoing emails per hour', 13),
('email_templates', 'email_footer_disclaimer', 'This email and any attachments are intended solely for the use of the individual or entity to whom they are addressed. If you are not the intended recipient, you are hereby notified that any disclosure, copying, distribution, or taking action in reliance on the contents of this information is strictly prohibited.', 'string', 'Email Footer', 'Legal disclaimer appended to all outgoing emails', 14);

-- ═══════════════════════════════════════════════════════════════
-- ADVANCED AI (deepens 'ai')
-- ═══════════════════════════════════════════════════════════════
INSERT OR IGNORE INTO system_settings (category, key, default_value, type, label, description, options, ui_order) VALUES
('ai', 'ai_model', 'cloudflare', 'select', 'AI Model', 'AI model provider for dispatch assistant', '["cloudflare","openai","anthropic","local"]', 11),
('ai', 'ai_context_window_turns', '10', 'number', 'Context Window', 'Number of conversation turns to include in AI context', 12),
('ai', 'ai_transcription_enabled', 'true', 'boolean', 'Live Transcription', 'Enable real-time speech-to-text transcription', 13),
('ai', 'ai_transcription_language', 'en-US', 'string', 'Transcription Language', 'Language for speech recognition (BCP-47)', 14),
('ai', 'ai_sentiment_analysis', 'false', 'boolean', 'Sentiment Analysis', 'Analyze officer voice tone for stress detection', 15),
('ai', 'ai_sentiment_alert_threshold', '0.8', 'number', 'Stress Alert Threshold', 'Confidence threshold for stress detection alerts (0-1)', 16),
('ai', 'ai_auto_summarize_calls', 'true', 'boolean', 'Auto-Summarize Calls', 'AI generates call summaries on disposition', 17),
('ai', 'ai_translate_enabled', 'false', 'boolean', 'Translation', 'Enable real-time language translation for calls', 18),
('ai', 'ai_translate_languages', 'es,zh,vi,ko,ar', 'string', 'Translate Languages', 'Comma-separated BCP-47 codes for translation support', 19);

-- ═══════════════════════════════════════════════════════════════
-- MOBILE / OFFLINE (new category)
-- ═══════════════════════════════════════════════════════════════
INSERT OR IGNORE INTO system_settings (category, key, default_value, type, label, description, options, ui_order) VALUES
('mobile', 'offline_mode_enabled', 'true', 'boolean', 'Offline Mode', 'Allow app to function without internet connection', 1),
('mobile', 'offline_sync_interval_sec', '60', 'number', 'Sync Interval', 'Seconds between background data sync attempts', 2),
('mobile', 'offline_storage_limit_mb', '500', 'number', 'Offline Storage Limit', 'Maximum offline storage in megabytes', 3),
('mobile', 'offline_cache_images', 'true', 'boolean', 'Cache Images Offline', 'Store person/vehicle photos for offline access', 4),
('mobile', 'offline_cache_maps', 'true', 'boolean', 'Cache Map Tiles', 'Cache map tiles for offline map viewing', 5),
('mobile', 'offline_conflict_resolution', 'server_wins', 'select', 'Conflict Resolution', 'How to resolve sync conflicts with server', '["server_wins","client_wins","manual","newest"]', 6),
('mobile', 'mobile_data_saver', 'false', 'boolean', 'Data Saver Mode', 'Reduce data usage on cellular connections', 7),
('mobile', 'mobile_low_bandwidth_images', 'true', 'boolean', 'Low-Res Images', 'Serve lower resolution images on slow connections', 8),
('mobile', 'mobile_gps_high_accuracy', 'false', 'boolean', 'High Accuracy GPS', 'Use high-accuracy GPS (increases battery drain)', 9),
('mobile', 'mobile_background_location', 'true', 'boolean', 'Background Location', 'Continue GPS tracking when app is in background', 10),
('mobile', 'mobile_pin_timeout_seconds', '300', 'number', 'PIN Timeout', 'Seconds before requiring PIN re-entry on mobile', 11);

-- ═══════════════════════════════════════════════════════════════
-- BACKUP / DISASTER RECOVERY (new category)
-- ═══════════════════════════════════════════════════════════════
INSERT OR IGNORE INTO system_settings (category, key, default_value, type, label, description, options, ui_order) VALUES
('backup', 'auto_backup_enabled', 'true', 'boolean', 'Auto Backup', 'Enable automatic database backups', 1),
('backup', 'backup_frequency_hours', '24', 'number', 'Backup Frequency', 'Hours between automatic backups', 2),
('backup', 'backup_location', 'cloud', 'select', 'Backup Location', 'Where to store backup files', '["cloud","local","both"]', 3),
('backup', 'backup_encrypt', 'true', 'boolean', 'Encrypt Backups', 'Encrypt backup files at rest', 4),
('backup', 'backup_verify_after', 'true', 'boolean', 'Verify After Backup', 'Verify backup integrity after creation', 5),
('backup', 'restore_test_interval_days', '30', 'number', 'Restore Test Interval', 'Days between automated restore tests', 6),
('backup', 'failover_enabled', 'false', 'boolean', 'Failover Enabled', 'Enable automatic failover to backup region', 7),
('backup', 'failover_trigger_minutes', '5', 'number', 'Failover Trigger', 'Minutes of outage before triggering failover', 8),
('backup', 'disaster_recovery_plan_url', '', 'string', 'DR Plan URL', 'Link to disaster recovery plan document', 9);

-- ═══════════════════════════════════════════════════════════════
-- COMPLIANCE / LEGAL (new category)
-- ═══════════════════════════════════════════════════════════════
INSERT OR IGNORE INTO system_settings (category, key, default_value, type, label, description, options, ui_order) VALUES
('compliance', 'cjis_compliance_mode', 'true', 'boolean', 'CJIS Compliance', 'Enforce CJIS security policy requirements', 1),
('compliance', 'data_classification_default', 'le_sensitive', 'select', 'Default Classification', 'Default data classification for new records', '["public","internal","le_sensitive","confidential","restricted"]', 2),
('compliance', 'require_data_classification', 'true', 'boolean', 'Require Classification', 'Require data classification on all new records', 3),
('compliance', 'discovery_hold_default', 'false', 'boolean', 'Discovery Hold', 'Place all records on litigation hold by default', 4),
('compliance', 'foia_response_days', '10', 'number', 'FOIA Response Days', 'Target days to respond to FOIA/public records requests', 5),
('compliance', 'data_breach_notification_hours', '72', 'number', 'Breach Notification', 'Hours to notify affected parties after data breach detection', 6),
('compliance', 'consent_form_required', 'true', 'boolean', 'Consent Form Required', 'Require digital consent forms for searches', 7),
('compliance', 'bodycam_notice_required', 'true', 'boolean', 'Bodycam Notice', 'Require body camera notification to subjects', 8),
('compliance', 'juvenile_records_sealed', 'true', 'boolean', 'Seal Juvenile Records', 'Automatically seal juvenile records per statute', 9),
('compliance', 'expungement_auto_process', 'false', 'boolean', 'Auto Expungement', 'Automatically process eligible expungement requests', 10);

-- ═══════════════════════════════════════════════════════════════
-- LOCALIZATION (new category)
-- ═══════════════════════════════════════════════════════════════
INSERT OR IGNORE INTO system_settings (category, key, default_value, type, label, description, options, ui_order) VALUES
('localization', 'default_language', 'en-US', 'string', 'Default Language', 'BCP-47 language code for the interface', 1),
('localization', 'date_format_long', 'MMMM D, YYYY', 'string', 'Long Date Format', 'Format for full date display (moment.js pattern)', 2),
('localization', 'time_format_seconds', 'false', 'boolean', 'Show Seconds', 'Display seconds in timestamps', 3),
('localization', 'distance_unit', 'miles', 'select', 'Distance Unit', 'Unit for distance measurements', '["miles","kilometers"]', 4),
('localization', 'speed_unit', 'mph', 'select', 'Speed Unit', 'Unit for speed measurements', '["mph","kmh"]', 5),
('localization', 'temperature_unit', 'fahrenheit', 'select', 'Temperature Unit', 'Unit for temperature display', '["fahrenheit","celsius"]', 6),
('localization', 'weight_unit', 'pounds', 'select', 'Weight Unit', 'Unit for weight measurements (persons/evidence)', '["pounds","kilograms"]', 7),
('localization', 'height_unit', 'feet_inches', 'select', 'Height Unit', 'Unit for height display', '["feet_inches","centimeters"]', 8),
('localization', 'currency', 'USD', 'string', 'Currency', 'ISO 4217 currency code', 9),
('localization', 'first_day_of_week', '0', 'number', 'First Day of Week', '0=Sunday, 1=Monday, etc.', 10),
('localization', 'number_format_locale', 'en-US', 'string', 'Number Locale', 'BCP-47 locale for number formatting', 11);

-- ═══════════════════════════════════════════════════════════════
-- WEBHOOKS / API (new category)
-- ═══════════════════════════════════════════════════════════════
INSERT OR IGNORE INTO system_settings (category, key, default_value, type, label, description, ui_order) VALUES
('webhooks', 'webhook_retry_enabled', 'true', 'boolean', 'Retry Enabled', 'Retry failed webhook deliveries', 1),
('webhook_retry_count', '3', 'number', 'Max Retries', 'Maximum webhook delivery retry attempts', 2),
('webhook_retry_backoff_sec', '60', 'number', 'Retry Backoff', 'Seconds between retry attempts (exponential)', 3),
('webhook_timeout_sec', '10', 'number', 'Request Timeout', 'Seconds before webhook request times out', 4),
('webhook_events', 'call.created,call.updated,call.dispositioned,unit.status_changed,officer.panic,warrant.hit,bolo.created', 'string', 'Webhook Events', 'Comma-separated event types that trigger webhooks', 5),
('webhook_payload_format', 'json', 'select', 'Payload Format', 'Format for webhook payload', '["json","form","xml"]', 6),
('webhook_include_pii', 'false', 'boolean', 'Include PII', 'Include personally identifiable information in webhook payloads', 7);

-- ═══════════════════════════════════════════════════════════════
-- ADVANCED SYSTEM (deepens 'system')
-- ═══════════════════════════════════════════════════════════════
INSERT OR IGNORE INTO system_settings (category, key, default_value, type, label, description, options, ui_order) VALUES
('system', 'debug_mode', 'false', 'boolean', 'Debug Mode', 'Enable verbose debug logging (performance impact)', 11),
('system', 'log_level', 'warn', 'select', 'Log Level', 'Minimum log level for system logs', '["debug","info","warn","error"]', 12),
('system', 'performance_monitoring', 'true', 'boolean', 'Performance Monitor', 'Collect performance metrics and response times', 13),
('system', 'cache_enabled', 'true', 'boolean', 'Server Cache', 'Enable server-side response caching', 14),
('system', 'cache_ttl_seconds', '300', 'number', 'Cache TTL', 'Seconds before cached responses expire', 15),
('system', 'request_timeout_seconds', '30', 'number', 'Request Timeout', 'Maximum seconds for API request processing', 16),
('system', 'compression_enabled', 'true', 'boolean', 'Response Compression', 'Compress API responses (gzip/brotli)', 17),
('system', 'cors_allowed_origins', 'https://rmpgutah.us,https://www.rmpgutah.us,http://localhost:5173', 'string', 'CORS Origins', 'Comma-separated allowed CORS origins', 18),
('system', 'cdn_cache_max_age_seconds', '3600', 'number', 'CDN Cache Max Age', 'Seconds for CDN edge cache of static assets', 19),
('system', 'auto_update_check_hours', '6', 'number', 'Update Check Interval', 'Hours between automatic version update checks', 20);

-- ═══════════════════════════════════════════════════════════════
-- SCHEDULING / COURT (new category)
-- ═══════════════════════════════════════════════════════════════
INSERT OR IGNORE INTO system_settings (category, key, default_value, type, label, description, ui_order) VALUES
('scheduling', 'court_reminder_days', '7', 'number', 'Court Reminder', 'Days before court date to send reminder', 1),
('scheduling', 'court_no_show_alert', 'true', 'boolean', 'No-Show Alert', 'Alert supervisor on court no-show by officer', 2),
('scheduling', 'court_subpoena_auto_ack', 'false', 'boolean', 'Auto-Acknowledge', 'Auto-acknowledge electronic subpoena receipt', 3),
('scheduling', 'shift_swap_approval_required', 'true', 'boolean', 'Shift Swap Approval', 'Require supervisor approval for shift swaps', 4),
('scheduling', 'shift_swap_deadline_hours', '24', 'number', 'Swap Deadline', 'Hours before shift start that swaps are locked', 5),
('scheduling', 'time_off_request_deadline_days', '14', 'number', 'Time Off Deadline', 'Days in advance required for time-off requests', 6),
('scheduling', 'time_off_auto_approve', 'false', 'boolean', 'Auto-Approve Time Off', 'Automatically approve time-off if coverage met', 7),
('scheduling', 'on_call_rotation_enabled', 'false', 'boolean', 'On-Call Rotation', 'Enable on-call duty rotation schedule', 8),
('scheduling', 'on_call_response_minutes', '30', 'number', 'On-Call Response', 'Minutes for on-call officer to acknowledge', 9);

-- ═══════════════════════════════════════════════════════════════
-- EVIDENCE LAB / FORENSICS (new category)
-- ═══════════════════════════════════════════════════════════════
INSERT OR IGNORE INTO system_settings (category, key, default_value, type, label, description, ui_order) VALUES
('forensics', 'lab_submission_auto_number', 'true', 'boolean', 'Auto Lab Numbers', 'Auto-generate sequential lab case numbers', 1),
('forensics', 'lab_results_notification', 'true', 'boolean', 'Results Notification', 'Notify case officer when lab results are posted', 2),
('forensics', 'dna_retention_years', '50', 'number', 'DNA Retention', 'Years to retain DNA samples and profiles', 3),
('forensics', 'drug_analysis_tat_days', '30', 'number', 'Drug Analysis TAT', 'Target turnaround time for drug analysis (days)', 4),
('forensics', 'digital_forensics_tat_days', '60', 'number', 'Digital Forensics TAT', 'Target turnaround time for digital device exams (days)', 5),
('forensics', 'fingerprint_afis_auto', 'true', 'boolean', 'Auto AFIS Submit', 'Automatically submit prints to AFIS on booking', 6),
('forensics', 'ballistics_nibin_auto', 'false', 'boolean', 'Auto NIBIN Submit', 'Automatically submit ballistic evidence to NIBIN', 7);

-- ═══════════════════════════════════════════════════════════════
-- DISPATCH GUIDE / PLAYBOOK (new category)
-- ═══════════════════════════════════════════════════════════════
INSERT OR IGNORE INTO system_settings (category, key, default_value, type, label, description, options, ui_order) VALUES
('playbook', 'playbook_enabled', 'true', 'boolean', 'Enable Playbook', 'Show dispatch guide/playbook for call types', 1),
('playbook', 'playbook_auto_open', 'true', 'boolean', 'Auto-Open Playbook', 'Auto-open playbook when call type is selected', 2),
('playbook', 'playbook_show_codes', 'true', 'boolean', 'Show 10-Codes', 'Display 10-code reference in playbook', 3),
('playbook', 'playbook_show_dispositions', 'true', 'boolean', 'Show Dispositions', 'Display disposition code reference in playbook', 4),
('playbook', 'playbook_show_statutes', 'true', 'boolean', 'Show Statutes', 'Display relevant statutes in playbook', 5),
('playbook', 'playbook_show_checklist', 'true', 'boolean', 'Show Checklist', 'Display step-by-step checklist for call type', 6),
('playbook', 'playbook_voice_read', 'false', 'boolean', 'Voice Read Playbook', 'AI reads playbook steps aloud to officer', 7);

-- ═══════════════════════════════════════════════════════════════
-- COMMUNITY ENGAGEMENT (new category)
-- ═══════════════════════════════════════════════════════════════
INSERT OR IGNORE INTO system_settings (category, key, default_value, type, label, description, ui_order) VALUES
('community', 'citizen_portal_enabled', 'false', 'boolean', 'Citizen Portal', 'Enable public-facing citizen portal for report filing', 1),
('community', 'anonymous_tip_line', 'false', 'boolean', 'Anonymous Tips', 'Enable anonymous crime tip submission', 2),
('community', 'community_alert_system', 'true', 'boolean', 'Community Alerts', 'Enable community-wide alert notifications', 3),
('community', 'neighborhood_watch_portal', 'false', 'boolean', 'Neighborhood Watch', 'Enable neighborhood watch coordination portal', 4),
('community', 'public_records_portal', 'false', 'boolean', 'Public Records', 'Enable public records request portal', 5),
('community', 'social_media_auto_post', 'false', 'boolean', 'Social Media Auto-Post', 'Auto-post approved bulletins to social media', 6);

-- ═══════════════════════════════════════════════════════════════
-- ADVANCED BRANDING (deepens 'branding')
-- ═══════════════════════════════════════════════════════════════
INSERT OR IGNORE INTO system_settings (category, key, default_value, type, label, description, ui_order) VALUES
('branding', 'mobile_app_name', 'RMPG Flex', 'string', 'Mobile App Name', 'Name displayed on mobile app home screen', 14),
('branding', 'badge_design', 'shield', 'select', 'Badge Design', 'Visual style for the agency badge', '["shield","star","circle","hexagon","custom"]', 15),
('branding', 'patch_image_url', '', 'string', 'Shoulder Patch URL', 'URL for agency shoulder patch image', 16),
('branding', 'vehicle_marking_template', '', 'string', 'Vehicle Marking Template', 'Template for vehicle marking/decals documentation', 17),
('branding', 'uniform_spec_url', '', 'string', 'Uniform Spec URL', 'Link to uniform specification document', 18);

-- ═══════════════════════════════════════════════════════════════
-- ADVANCED DISPLAY EFFECTS (deepens 'display')
-- ═══════════════════════════════════════════════════════════════
INSERT OR IGNORE INTO system_settings (category, key, default_value, type, label, description, ui_order) VALUES
('display', 'scanline_intensity', '0.15', 'number', 'Scanline Intensity', 'CRT scanline effect opacity (0-1)', 15),
('display', 'vignette_intensity', '0.4', 'number', 'Vignette Intensity', 'CRT vignette darkness (0-1)', 16),
('display', 'phosphor_bloom_intensity', '0.2', 'number', 'Phosphor Bloom', 'CRT phosphor glow intensity (0-1)', 17),
('display', 'film_grain_intensity', '0.05', 'number', 'Film Grain', 'Film grain noise intensity (0-1)', 18),
('display', 'amber_phosphor_mode', 'false', 'boolean', 'Amber Phosphor', 'Monochrome amber phosphor display mode', 19),
('display', 'green_phosphor_mode', 'false', 'boolean', 'Green Phosphor', 'Monochrome green phosphor display mode', 20),
('display', 'high_contrast_mode', 'false', 'boolean', 'High Contrast', 'Increase contrast for accessibility', 21),
('display', 'reduced_motion', 'false', 'boolean', 'Reduced Motion', 'Disable UI animations (accessibility preference)', 22),
('display', 'focus_indicator_style', 'glow', 'select', 'Focus Indicator', 'Visual style for keyboard focus indicators', '["glow","outline","underline","none"]', 23),
('display', 'cursor_style', 'default', 'select', 'Cursor Style', 'Mouse cursor appearance', '["default","crosshair","block"]', 24);
