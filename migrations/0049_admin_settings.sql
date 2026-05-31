-- Migration 0049: System Settings — admin-configurable console settings
-- 250 settings across 20 categories, stored as key-value with metadata.

CREATE TABLE IF NOT EXISTS system_settings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category TEXT NOT NULL,
  key TEXT NOT NULL UNIQUE,
  value TEXT,
  default_value TEXT,
  type TEXT NOT NULL DEFAULT 'string',    -- string|number|boolean|json|color|select
  label TEXT NOT NULL,
  description TEXT,
  options TEXT,                            -- JSON array for select type
  min_value REAL,
  max_value REAL,
  required_role TEXT DEFAULT 'admin',      -- minimum role to change this setting
  ui_order INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now','localtime')),
  updated_at TEXT DEFAULT (datetime('now','localtime'))
);

-- Branding & Appearance
INSERT OR IGNORE INTO system_settings (category, key, default_value, type, label, description, ui_order) VALUES
('branding', 'agency_name', 'Rocky Mountain Protective Group', 'string', 'Agency Name', 'Displayed in headers, reports, and login screen', 1),
('branding', 'agency_abbreviation', 'RMPG', 'string', 'Agency Abbreviation', 'Short code used in badges and compact displays', 2),
('branding', 'agency_address', '123 Main St, Salt Lake City, UT 84101', 'string', 'Agency Address', 'Physical address shown on reports and citations', 3),
('branding', 'agency_phone', '(801) 555-0100', 'string', 'Agency Phone', 'Main contact number displayed in headers', 4),
('branding', 'agency_email', 'info@rmpgutah.us', 'string', 'Agency Email', 'Public contact email', 5),
('branding', 'agency_website', 'https://rmpgutah.us', 'string', 'Agency Website', 'Official website URL', 6),
('branding', 'primary_color', '#000000', 'color', 'Primary Color', 'Main brand color for backgrounds and chrome', 7),
('branding', 'accent_color', '#d4a017', 'color', 'Accent Color', 'Gold accent used for highlights, borders, and active states', 8),
('branding', 'header_logo_url', '', 'string', 'Header Logo URL', 'Custom logo image URL (PNG/SVG). Leave empty for default.', 9),
('branding', 'favicon_url', '', 'string', 'Favicon URL', 'Custom browser tab icon. Leave empty for default.', 10),
('branding', 'login_background_url', '', 'string', 'Login Background URL', 'Background image for the login screen', 11),
('branding', 'report_watermark_text', 'CONFIDENTIAL', 'string', 'Report Watermark', 'Text watermark on all generated PDF reports', 12),
('branding', 'report_classification', 'LE SENSITIVE', 'string', 'Report Classification', 'Default CJIS classification banner on reports', 13);

-- Display & Theme
INSERT OR IGNORE INTO system_settings (category, key, default_value, type, label, description, options, ui_order) VALUES
('display', 'default_theme', 'dark', 'select', 'Default Theme', 'Theme applied for new users', '["dark","light","high-contrast"]', 1),
('display', 'enable_crt_effects', 'false', 'boolean', 'CRT Display Effects', 'Enable scanlines, vignette, and phosphor bloom effects', 2),
('display', 'enable_animations', 'true', 'boolean', 'UI Animations', 'Enable transition animations throughout the interface', 3),
('display', 'font_scale_default', '1.0', 'number', 'Default Font Scale', 'Base font size multiplier (0.8 to 1.5)', 4),
('display', 'compact_mode_default', 'false', 'boolean', 'Compact Mode Default', 'Enable compact data density by default', 5),
('display', 'show_grid_lines', 'true', 'boolean', 'Table Grid Lines', 'Show row separators in data tables', 6),
('display', 'show_row_numbers', 'false', 'boolean', 'Row Numbers', 'Show row number column in data tables', 7),
('display', 'date_format', 'MM/DD/YYYY', 'select', 'Date Format', 'Default date display format', '["MM/DD/YYYY","DD/MM/YYYY","YYYY-MM-DD","DD-MMM-YYYY"]', 8),
('display', 'time_format', '24h', 'select', 'Time Format', 'Clock format throughout the interface', '["12h","24h"]', 9),
('display', 'timezone', 'America/Denver', 'string', 'Timezone', 'Default timezone for timestamps (IANA format)', 10),
('display', 'items_per_page', '50', 'number', 'Items Per Page', 'Default pagination size for data tables', 11),
('display', 'sidebar_width', '220', 'number', 'Sidebar Width', 'Width of the navigation sidebar in pixels', 12),
('display', 'status_bar_visible', 'true', 'boolean', 'Status Bar Visible', 'Show the bottom status bar', 13),
('display', 'toolbar_position', 'top', 'select', 'Toolbar Position', 'Position of the main icon toolbar', '["top","left"]', 14);

-- CAD / Dispatch
INSERT OR IGNORE INTO system_settings (category, key, default_value, type, label, description, ui_order) VALUES
('dispatch', 'default_call_priority', 'P3', 'select', 'Default Call Priority', 'Pre-selected priority for new calls', '["P1","P2","P3","P4"]', 1),
('dispatch', 'auto_refresh_interval', '30', 'number', 'Auto-Refresh Interval', 'Seconds between dispatch board auto-refresh (0 = off)', 2),
('dispatch', 'call_card_expand', 'true', 'boolean', 'Expand Call Cards', 'Show full call details by default in the queue', 3),
('dispatch', 'show_cleared_calls', 'false', 'boolean', 'Show Cleared Calls', 'Include cleared calls in the dispatch queue view', 4),
('dispatch', 'show_archived_calls', 'false', 'boolean', 'Show Archived Calls', 'Include archived calls in search results', 5),
('dispatch', 'dispatch_sort_order', 'priority', 'select', 'Default Sort', 'Default call queue sort order', '["priority","time","status","location"]', 6),
('dispatch', 'enable_voice_alerts', 'true', 'boolean', 'Voice Alerts', 'Enable AI voice alerts for dispatch events', 7),
('dispatch', 'voice_alert_volume', '0.7', 'number', 'Voice Alert Volume', 'Volume level for dispatch voice alerts (0-1)', 8),
('dispatch', 'proximity_alert_radius', '500', 'number', 'Proximity Alert Radius', 'Meters — alert when units are near active calls', 9),
('dispatch', 'welfare_check_interval', '15', 'number', 'Welfare Check Timer', 'Minutes between automated welfare checks', 10),
('dispatch', 'max_active_calls_per_unit', '3', 'number', 'Max Calls Per Unit', 'Maximum concurrent calls assigned to one unit', 11),
('dispatch', 'default_disposition_code', '', 'string', 'Default Disposition', 'Default disposition code applied on call clear', 12);

-- Notifications
INSERT OR IGNORE INTO system_settings (category, key, default_value, type, label, description, ui_order) VALUES
('notifications', 'email_notifications_enabled', 'true', 'boolean', 'Email Notifications', 'Enable email notification delivery', 1),
('notifications', 'sms_notifications_enabled', 'false', 'boolean', 'SMS Notifications', 'Enable SMS/text notification delivery', 2),
('notifications', 'push_notifications_enabled', 'true', 'boolean', 'Push Notifications', 'Enable browser push notifications', 3),
('notifications', 'in_app_notifications_enabled', 'true', 'boolean', 'In-App Notifications', 'Show notifications in the notification center', 4),
('notifications', 'notify_dispatch_p1', 'true', 'boolean', 'P1 Dispatch Alerts', 'Notify on Priority 1 dispatch calls', 5),
('notifications', 'notify_dispatch_p2', 'true', 'boolean', 'P2 Dispatch Alerts', 'Notify on Priority 2 dispatch calls', 6),
('notifications', 'notify_bolo_issued', 'true', 'boolean', 'BOLO Issued', 'Notify when a BOLO is issued', 7),
('notifications', 'notify_warrant_hit', 'true', 'boolean', 'Warrant Hits', 'Notify on NCIC warrant confirmation', 8),
('notifications', 'notify_officer_safety', 'true', 'boolean', 'Officer Safety Alerts', 'Notify on officer safety flags or panic activations', 9),
('notifications', 'notify_welfare_timeout', 'true', 'boolean', 'Welfare Timeout', 'Notify when a welfare check timer expires', 10),
('notifications', 'quiet_hours_start', '', 'string', 'Quiet Hours Start', 'Suspend non-critical notifications from (HH:MM)', 11),
('notifications', 'quiet_hours_end', '', 'string', 'Quiet Hours End', 'Resume non-critical notifications at (HH:MM)', 12);

-- Security & Auth
INSERT OR IGNORE INTO system_settings (category, key, default_value, type, label, description, ui_order) VALUES
('security', 'password_min_length', '8', 'number', 'Min Password Length', 'Minimum characters required for passwords', 1),
('security', 'password_require_uppercase', 'true', 'boolean', 'Require Uppercase', 'Passwords must contain at least one uppercase letter', 2),
('security', 'password_require_number', 'true', 'boolean', 'Require Number', 'Passwords must contain at least one digit', 3),
('security', 'password_require_special', 'false', 'boolean', 'Require Special Char', 'Passwords must contain at least one special character', 4),
('security', 'password_expiry_days', '90', 'number', 'Password Expiry', 'Days before password must be changed (0 = never)', 5),
('security', 'max_login_attempts', '5', 'number', 'Max Login Attempts', 'Failed attempts before account lockout', 6),
('security', 'lockout_duration_minutes', '30', 'number', 'Lockout Duration', 'Minutes an account stays locked after max attempts', 7),
('security', 'session_timeout_minutes', '480', 'number', 'Session Timeout', 'Minutes of inactivity before auto-logout (0 = never)', 8),
('security', 'require_2fa', 'false', 'boolean', 'Require 2FA', 'Force two-factor authentication for all users', 9),
('security', 'require_2fa_admin', 'true', 'boolean', 'Require 2FA (Admin)', 'Force 2FA for admin and manager roles', 10),
('security', 'allowed_ip_ranges', '', 'string', 'Allowed IP Ranges', 'Restrict access to these IP ranges (CIDR, comma-separated)', 11),
('security', 'mfa_grace_period_days', '7', 'number', '2FA Grace Period', 'Days new users have to set up 2FA before enforced', 12);

-- Records & Data
INSERT OR IGNORE INTO system_settings (category, key, default_value, type, label, description, ui_order) VALUES
('records', 'auto_archive_days', '365', 'number', 'Auto-Archive Age', 'Days after which records are auto-archived (0 = never)', 1),
('records', 'retention_period_years', '7', 'number', 'Retention Period', 'Years records are kept before purge eligibility', 2),
('records', 'auto_purge_enabled', 'false', 'boolean', 'Auto-Purge Enabled', 'Automatically purge records past retention period', 3),
('records', 'person_merge_threshold', '0.85', 'number', 'Merge Confidence', 'Minimum confidence score to suggest person record merges (0-1)', 4),
('records', 'require_warrant_check', 'true', 'boolean', 'Require Warrant Check', 'Always run warrant check when creating a person record', 5),
('records', 'require_address_validation', 'false', 'boolean', 'Require Address Validation', 'Validate addresses before saving records', 6),
('records', 'case_number_prefix', 'RMPG-', 'string', 'Case Number Prefix', 'Prefix prepended to all case numbers', 7),
('records', 'incident_number_prefix', 'INC-', 'string', 'Incident Number Prefix', 'Prefix prepended to all incident numbers', 8),
('records', 'citation_number_prefix', 'CIT-', 'string', 'Citation Number Prefix', 'Prefix prepended to all citation numbers', 9),
('records', 'default_reporting_officer', '', 'string', 'Default Reporting Officer', 'User ID auto-filled as reporting officer on new records', 10);

-- Maps & GPS
INSERT OR IGNORE INTO system_settings (category, key, default_value, type, label, description, options, ui_order) VALUES
('maps', 'default_map_style', 'dark', 'select', 'Default Map Style', 'Mapbox style for new map views', '["dark","light","satellite","streets"]', 1),
('maps', 'default_zoom_level', '14', 'number', 'Default Zoom', 'Initial map zoom level', 2),
('maps', 'default_center_lat', '40.7608', 'number', 'Default Center Lat', 'Default map center latitude', 3),
('maps', 'default_center_lng', '-111.8910', 'number', 'Default Center Lng', 'Default map center longitude', 4),
('maps', 'show_map_labels', 'true', 'boolean', 'Show Map Labels', 'Display street/location labels on maps', 5),
('maps', 'gps_update_interval', '5', 'number', 'GPS Update Interval', 'Seconds between GPS position updates from units', 6),
('maps', 'gps_trail_length', '100', 'number', 'GPS Trail Length', 'Number of breadcrumb points to retain per unit', 7),
('maps', 'geofence_alert_enabled', 'true', 'boolean', 'Geofence Alerts', 'Alert when units enter/exit defined geofence zones', 8),
('maps', 'coordinate_format', 'decimal', 'select', 'Coordinate Format', 'Display format for GPS coordinates', '["decimal","dms","mgrs"]', 9),
('maps', 'radius_search_default', '500', 'number', 'Radius Search Default', 'Default search radius in meters', 10);

-- Reports & Printing
INSERT OR IGNORE INTO system_settings (category, key, default_value, type, label, description, options, ui_order) VALUES
('reports', 'default_page_size', 'letter', 'select', 'Default Page Size', 'Default paper size for generated reports', '["letter","legal","a4"]', 1),
('reports', 'default_margin_mm', '10', 'number', 'Default Margins', 'Page margins in millimeters', 2),
('reports', 'include_classification_banner', 'true', 'boolean', 'Classification Banner', 'Include CJIS classification banner on reports', 3),
('reports', 'include_bates_numbering', 'true', 'boolean', 'Bates Numbering', 'Add Bates numbers to multi-page reports', 4),
('reports', 'include_form_number', 'true', 'boolean', 'Form Number Footer', 'Show form revision number in report footers', 5),
('reports', 'include_barcode', 'false', 'boolean', 'Include Barcode', 'Add scannable barcode to report footers', 6),
('reports', 'report_logo_position', 'left', 'select', 'Logo Position', 'Header logo placement on reports', '["left","center","right","none"]', 7),
('reports', 'signature_required', 'true', 'boolean', 'Require Signature', 'Require digital signature on official reports', 8),
('reports', 'draft_watermark_enabled', 'true', 'boolean', 'Draft Watermark', 'Show DRAFT watermark on unapproved reports', 9),
('reports', 'confidential_watermark_enabled', 'true', 'boolean', 'Confidential Watermark', 'Show CONFIDENTIAL on sensitive reports', 10);

-- AI & Voice
INSERT OR IGNORE INTO system_settings (category, key, default_value, type, label, description, options, ui_order) VALUES
('ai', 'ai_dispatcher_enabled', 'true', 'boolean', 'AI Dispatcher', 'Enable AI-powered dispatch assistant', 1),
('ai', 'ai_persona', 'professional', 'select', 'AI Persona', 'Communication style for AI dispatcher', '["professional","tactical","brief","conversational"]', 2),
('ai', 'ai_temperature', '0.7', 'number', 'AI Temperature', 'Creativity level for AI responses (0-1)', 3),
('ai', 'ai_max_reply_chars', '500', 'number', 'Max Reply Length', 'Maximum characters in AI dispatcher replies', 4),
('ai', 'ai_listen_mode', 'push_to_talk', 'select', 'Listen Mode', 'How the AI listens for officer speech', '["push_to_talk","always_on","voice_activated"]', 5),
('ai', 'ai_wake_word', 'dispatch', 'string', 'Wake Word', 'Word that activates AI listening', 6),
('ai', 'ai_confidence_threshold', '0.75', 'number', 'Confidence Threshold', 'Minimum confidence for AI to auto-act on commands', 7),
('ai', 'ai_narrative_assist', 'true', 'boolean', 'Narrative Assist', 'AI helps write incident narratives', 8),
('ai', 'ai_call_recommendations', 'true', 'boolean', 'Call Recommendations', 'AI suggests unit assignments for calls', 9),
('ai', 'ai_risk_assessment', 'true', 'boolean', 'Risk Assessment', 'AI analyzes calls for officer safety risks', 10);

-- Evidence & Property
INSERT OR IGNORE INTO system_settings (category, key, default_value, type, label, description, ui_order) VALUES
('evidence', 'chain_of_custody_required', 'true', 'boolean', 'Chain of Custody', 'Require chain of custody entries for evidence', 1),
('evidence', 'evidence_photo_required', 'true', 'boolean', 'Evidence Photos', 'Require photo documentation of all evidence items', 2),
('evidence', 'barcode_format', 'code39', 'select', 'Barcode Format', 'Barcode symbology for evidence tags', '["code39","code128","pdf417"]', 3),
('evidence', 'auto_assign_location', 'true', 'boolean', 'Auto-Assign Location', 'Automatically assign storage location to new evidence', 4),
('evidence', 'purge_review_days', '30', 'number', 'Purge Review Period', 'Days before eligible purge items are reviewed', 5),
('evidence', 'digital_evidence_retention', '365', 'number', 'Digital Evidence Retention', 'Days to retain body cam / dash cam footage', 6),
('evidence', 'audit_frequency_days', '90', 'number', 'Audit Frequency', 'Days between automatic property room audits', 7);

-- Integration & API
INSERT OR IGNORE INTO system_settings (category, key, default_value, type, label, description, ui_order) VALUES
('integrations', 'mapbox_access_token', '', 'string', 'Mapbox Token', 'Mapbox GL JS access token', 1),
('integrations', 'google_maps_api_key', '', 'string', 'Google Maps API Key', 'Google Maps Geocoding API key (fallback)', 2),
('integrations', 'ncic_endpoint_url', '', 'string', 'NCIC Endpoint', 'NCIC/NLETS query endpoint URL', 3),
('integrations', 'weather_api_key', '', 'string', 'Weather API Key', 'Weather service API key', 4),
('integrations', 'sms_provider', '', 'select', 'SMS Provider', 'Provider for SMS notifications', '["twilio","none"]', 5),
('integrations', 'sms_provider_key', '', 'string', 'SMS API Key', 'API key for SMS provider', 6),
('integrations', 'sms_from_number', '', 'string', 'SMS From Number', 'Sender phone number for SMS messages', 7),
('integrations', 'email_provider', 'sendgrid', 'select', 'Email Provider', 'Provider for transactional emails', '["sendgrid","mailgun","smtp","none"]', 8),
('integrations', 'email_api_key', '', 'string', 'Email API Key', 'API key for email provider', 9),
('integrations', 'email_from_address', 'noreply@rmpgutah.us', 'string', 'From Address', 'Sender email address for system emails', 10),
('integrations', 'webhook_url', '', 'string', 'Webhook URL', 'URL for outgoing webhook notifications', 11),
('integrations', 'webhook_secret', '', 'string', 'Webhook Secret', 'HMAC secret for webhook payload signing', 12);

-- Fleet & GPS
INSERT OR IGNORE INTO system_settings (category, key, default_value, type, label, description, ui_order) VALUES
('fleet', 'fuel_low_threshold_pct', '25', 'number', 'Low Fuel Alert %', 'Alert when fuel drops below this percentage', 1),
('fleet', 'maintenance_reminder_km', '5000', 'number', 'Maintenance Reminder', 'KM before next scheduled maintenance alert', 2),
('fleet', 'inspection_required_daily', 'true', 'boolean', 'Daily Inspection', 'Require daily vehicle inspection reports', 3),
('fleet', 'gps_tracking_enabled', 'true', 'boolean', 'GPS Tracking', 'Enable real-time GPS tracking for fleet vehicles', 4),
('fleet', 'gps_reporting_interval_sec', '30', 'number', 'Reporting Interval', 'Seconds between GPS position reports from vehicles', 5),
('fleet', 'speed_alert_kmh', '130', 'number', 'Speed Alert', 'Alert when vehicle exceeds this speed (km/h)', 6),
('fleet', 'idle_alert_minutes', '10', 'number', 'Idle Alert', 'Alert when vehicle idles longer than this (minutes)', 7);

-- Training & Certification
INSERT OR IGNORE INTO system_settings (category, key, default_value, type, label, description, ui_order) VALUES
('training', 'cert_expiry_warning_days', '30', 'number', 'Expiry Warning', 'Days before cert expiry to send warning', 1),
('training', 'annual_training_hours', '40', 'number', 'Annual Hours Required', 'Minimum training hours per officer per year', 2),
('training', 'firearm_requal_months', '12', 'number', 'Firearm Requal', 'Months between required firearm requalification', 3),
('training', 'taser_requal_months', '12', 'number', 'Taser Requal', 'Months between required Taser requalification', 4),
('training', 'cpr_requal_months', '24', 'number', 'CPR Requal', 'Months between required CPR recertification', 5),
('training', 'use_of_force_retrain_months', '12', 'number', 'Use of Force Retrain', 'Months between use-of-force refresher training', 6),
('training', 'fto_program_duration_days', '90', 'number', 'FTO Program Duration', 'Days for Field Training Officer program', 7);

-- Shift & Schedule
INSERT OR IGNORE INTO system_settings (category, key, default_value, type, label, description, options, ui_order) VALUES
('shift', 'default_shift_duration_hours', '12', 'number', 'Default Shift Duration', 'Hours in a standard patrol shift', 1),
('shift', 'shift_overlap_minutes', '15', 'number', 'Shift Overlap', 'Minutes of overlap between consecutive shifts', 2),
('shift', 'min_officers_per_shift', '2', 'number', 'Minimum Officers', 'Minimum officers required per shift', 3),
('shift', 'overtime_threshold_hours', '40', 'number', 'Overtime Threshold', 'Weekly hours before overtime rates apply', 4),
('shift', 'max_consecutive_days', '6', 'number', 'Max Consecutive Days', 'Maximum consecutive work days allowed', 5),
('shift', 'min_rest_hours', '10', 'number', 'Minimum Rest Hours', 'Minimum hours between consecutive shifts', 6),
('shift', 'shift_bidding_enabled', 'false', 'boolean', 'Shift Bidding', 'Enable shift bidding/preference system', 7);

-- Audit & Logging
INSERT OR IGNORE INTO system_settings (category, key, default_value, type, label, description, ui_order) VALUES
('audit', 'audit_log_enabled', 'true', 'boolean', 'Audit Logging', 'Enable system-wide audit logging', 1),
('audit', 'audit_log_retention_days', '365', 'number', 'Log Retention', 'Days to retain audit log entries', 2),
('audit', 'audit_record_views', 'true', 'boolean', 'Log Record Views', 'Log when users view sensitive records', 3),
('audit', 'audit_record_edits', 'true', 'boolean', 'Log Record Edits', 'Log all record modifications', 4),
('audit', 'audit_record_deletes', 'true', 'boolean', 'Log Deletions', 'Log all record deletions with undo data', 5),
('audit', 'audit_login_attempts', 'true', 'boolean', 'Log Login Attempts', 'Log all successful and failed login attempts', 6),
('audit', 'audit_permission_changes', 'true', 'boolean', 'Log Permission Changes', 'Log role and permission modifications', 7),
('audit', 'audit_export_enabled', 'true', 'boolean', 'Audit Export', 'Allow exporting audit logs', 8);

-- Email Templates
INSERT OR IGNORE INTO system_settings (category, key, default_value, type, label, description, ui_order) VALUES
('email_templates', 'email_signature', 'Rocky Mountain Protective Group\nSalt Lake City, Utah\nwww.rmpgutah.us', 'string', 'Email Signature', 'Default signature appended to all system emails', 1),
('email_templates', 'welcome_email_enabled', 'true', 'boolean', 'Send Welcome Email', 'Send welcome email to new users', 2),
('email_templates', 'password_reset_template', 'Your RMPG Flex password reset link: {{reset_link}}\n\nThis link expires in 1 hour.\n\nIf you did not request this, contact your administrator.', 'string', 'Password Reset Template', 'Template for password reset emails', 3),
('email_templates', 'shift_reminder_template', 'Reminder: Your next shift starts {{shift_start}} at {{shift_location}}.\n\nPlease acknowledge this reminder.', 'string', 'Shift Reminder Template', 'Template for shift reminder emails', 4),
('email_templates', 'cert_expiry_template', 'Your {{cert_name}} certification expires on {{expiry_date}}.\n\nPlease schedule your recertification soon.', 'string', 'Cert Expiry Template', 'Template for certification expiry warnings', 5);

-- System & Maintenance
INSERT OR IGNORE INTO system_settings (category, key, default_value, type, label, description, ui_order) VALUES
('system', 'maintenance_mode', 'false', 'boolean', 'Maintenance Mode', 'Put system in maintenance mode (shows banner)', 1),
('system', 'maintenance_message', 'System maintenance in progress. Some features may be unavailable.', 'string', 'Maintenance Message', 'Message shown during maintenance mode', 2),
('system', 'api_rate_limit', '100', 'number', 'API Rate Limit', 'Max requests per minute per user (0 = unlimited)', 3),
('system', 'max_upload_size_mb', '50', 'number', 'Max Upload Size', 'Maximum file upload size in megabytes', 4),
('system', 'backup_schedule', '', 'select', 'Backup Schedule', 'Database backup frequency', '["daily","weekly","monthly","none"]', 5),
('system', 'backup_retention_count', '7', 'number', 'Backup Retention', 'Number of backups to retain', 6),
('system', 'error_reporting_enabled', 'true', 'boolean', 'Error Reporting', 'Send client-side errors to monitoring', 7),
('system', 'version_check_enabled', 'true', 'boolean', 'Version Check', 'Automatically check for new versions', 8),
('system', 'announcement_banner_text', '', 'string', 'Announcement Banner', 'System-wide announcement shown at top of all pages', 9),
('system', 'announcement_banner_color', 'info', 'select', 'Announcement Color', 'Color theme for the announcement banner', '["info","warning","critical","success"]', 10);
