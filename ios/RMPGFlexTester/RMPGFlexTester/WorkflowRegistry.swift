import Foundation

// The catalog. Adding a workflow = adding a WorkflowDefinition here. Field keys
// match the live server body allow-lists (citations.ts, incidents.ts, patrol.ts).
enum WorkflowRegistry {
    static let all: [WorkflowDefinition] = [
        incident, citation, patrolScan,        // PR1 proving slice
        fieldInterview, useOfForce,            // .reports
        property,                              // .patrol
        arrest, caseFile, task,                // .people
        communityEvent, codeViolation, crisis, // .civil
    ]

    private static let fullRoles = ["admin", "manager", "supervisor", "officer"]

    static let incident = WorkflowDefinition(
        id: "incident", title: "Incident report", icon: "doc.text.fill",
        category: .reports, roles: ["admin", "manager", "supervisor", "officer"],
        submit: .lifecycle(create: "api/incidents", update: "api/incidents/{id}", finalize: "api/incidents/{id}/submit"),
        encoding: .json,
        steps: [
            WorkflowStep(title: "Type", fields: [
                WorkflowField(key: "incident_type", type: .chips, label: "Incident type", required: true, options: [
                    FieldOption(value: "theft", label: "Theft"), FieldOption(value: "disturbance", label: "Disturbance"),
                    FieldOption(value: "trespass", label: "Trespass"), FieldOption(value: "suspicious", label: "Suspicious"),
                    FieldOption(value: "alarm", label: "Alarm"), FieldOption(value: "assist", label: "Assist")]),
                WorkflowField(key: "priority", type: .segmented, label: "Priority", options: [
                    FieldOption(value: "P1", label: "P1"), FieldOption(value: "P2", label: "P2"),
                    FieldOption(value: "P3", label: "P3")], defaultValue: .string("P3")),
            ]),
            WorkflowStep(title: "Location", fields: [
                WorkflowField(key: "location_address", type: .gpsLocation, label: "Location", required: true),
            ]),
            WorkflowStep(title: "Narrative", fields: [
                WorkflowField(key: "narrative", type: .dictatableNarrative, label: "Narrative", required: true),
            ]),
            WorkflowStep(title: "Photos", fields: [
                WorkflowField(key: "photos", type: .photo, label: "Evidence photos"),
            ]),
        ],
        prefill: [.call, .gps],
        success: SuccessSpec(numberKey: "incident_number", message: "Filed {incident_number}"))

    static let citation = WorkflowDefinition(
        id: "citation", title: "Citation / warning", icon: "doc.plaintext.fill",
        category: .reports, roles: ["admin", "manager", "supervisor", "officer"],
        submit: .single(post: "api/citations"), encoding: .json,
        steps: [
            WorkflowStep(title: "Type", fields: [
                WorkflowField(key: "is_warning", type: .segmented, label: "Disposition", options: [
                    FieldOption(value: "0", label: "Citation"), FieldOption(value: "1", label: "Warning")], defaultValue: .string("0")),
                WorkflowField(key: "violation_date", type: .date, label: "Violation date", required: true),
            ]),
            WorkflowStep(title: "Subject", fields: [
                WorkflowField(key: "subject", type: .scanSubject, label: "Subject"),
                WorkflowField(key: "vehicle", type: .scanVehicle, label: "Vehicle"),
            ]),
            WorkflowStep(title: "Violation", fields: [
                WorkflowField(key: "statute", type: .statuteSearch, label: "Statute"),
                WorkflowField(key: "violation_description", type: .dictatableNarrative, label: "Violation", required: true),
                WorkflowField(key: "fine_amount", type: .number, label: "Fine ($)"),
                WorkflowField(key: "location", type: .gpsLocation, label: "Location"),
            ]),
        ],
        prefill: [.scanSubject, .scanVehicle, .gps],
        success: SuccessSpec(numberKey: "citation_number", message: "Issued {citation_number}"))

    static let patrolScan = WorkflowDefinition(
        id: "patrol_scan", title: "Tour checkpoint scan", icon: "qrcode.viewfinder",
        category: .patrol, roles: ["admin", "manager", "supervisor", "officer"],
        submit: .single(post: "api/patrol/scan"), encoding: .json,
        steps: [
            WorkflowStep(title: "Scan", fields: [
                WorkflowField(key: "checkpoint_id", type: .picker, label: "Checkpoint", required: true),
                WorkflowField(key: "notes", type: .dictatableNarrative, label: "Notes"),
                WorkflowField(key: "location", type: .gpsLocation, label: "Location"),
            ]),
        ],
        prefill: [.gps],
        success: SuccessSpec(numberKey: "id", message: "Checkpoint logged"))

    // ── Field reports ──────────────────────────────────────────
    static let fieldInterview = WorkflowDefinition(
        id: "field_interview", title: "Field interview", icon: "person.text.rectangle.fill",
        category: .reports, roles: fullRoles,
        submit: .single(post: "api/field-interviews"), encoding: .json,
        steps: [
            WorkflowStep(title: "Subject", fields: [
                WorkflowField(key: "date", type: .date, label: "Date", required: true),
                WorkflowField(key: "subject_name", type: .text, label: "Subject name"),
                WorkflowField(key: "location", type: .gpsLocation, label: "Location"),
            ]),
            WorkflowStep(title: "Detail", fields: [
                WorkflowField(key: "reason", type: .chips, label: "Reason", options: [
                    FieldOption(value: "suspicious", label: "Suspicious"), FieldOption(value: "consensual", label: "Consensual"),
                    FieldOption(value: "trespass", label: "Trespass"), FieldOption(value: "welfare", label: "Welfare")]),
                WorkflowField(key: "narrative", type: .dictatableNarrative, label: "Narrative", required: true),
                WorkflowField(key: "photos", type: .photo, label: "Photos"),
            ]),
        ],
        prefill: [.scanSubject, .gps],
        success: SuccessSpec(numberKey: "id", message: "FI card saved"))

    static let useOfForce = WorkflowDefinition(
        id: "use_of_force", title: "Use of force", icon: "exclamationmark.octagon.fill",
        category: .reports, roles: fullRoles,
        submit: .single(post: "api/use-of-force"), encoding: .json,
        steps: [
            WorkflowStep(title: "Force", fields: [
                WorkflowField(key: "force_type", type: .chips, label: "Force type", required: true, options: [
                    FieldOption(value: "hands", label: "Hands"), FieldOption(value: "taser", label: "Taser"),
                    FieldOption(value: "baton", label: "Baton"), FieldOption(value: "firearm", label: "Firearm"),
                    FieldOption(value: "canine", label: "Canine"), FieldOption(value: "other", label: "Other")]),
                WorkflowField(key: "force_level", type: .segmented, label: "Level", options: [
                    FieldOption(value: "low", label: "Low"), FieldOption(value: "medium", label: "Med"),
                    FieldOption(value: "high", label: "High")]),
            ]),
            WorkflowStep(title: "Narrative", fields: [
                WorkflowField(key: "justification", type: .dictatableNarrative, label: "Justification", required: true),
                WorkflowField(key: "narrative", type: .dictatableNarrative, label: "Narrative"),
                WorkflowField(key: "subject_injuries", type: .text, label: "Subject injuries"),
            ]),
        ],
        prefill: [],
        success: SuccessSpec(numberKey: "id", message: "Use-of-force report saved"))

    // ── Patrol & security ──────────────────────────────────────
    static let property = WorkflowDefinition(
        id: "property", title: "Register property / site", icon: "building.2.fill",
        category: .patrol, roles: ["admin", "manager", "supervisor"],
        submit: .single(post: "api/properties"), encoding: .json,
        steps: [
            WorkflowStep(title: "Site", fields: [
                WorkflowField(key: "name", type: .text, label: "Property name", required: true),
                WorkflowField(key: "address", type: .gpsLocation, label: "Address", required: true),
                WorkflowField(key: "property_type", type: .chips, label: "Type", options: [
                    FieldOption(value: "residential", label: "Residential"), FieldOption(value: "commercial", label: "Commercial"),
                    FieldOption(value: "industrial", label: "Industrial"), FieldOption(value: "retail", label: "Retail")]),
            ]),
            WorkflowStep(title: "Orders", fields: [
                WorkflowField(key: "post_orders", type: .dictatableNarrative, label: "Post orders"),
                WorkflowField(key: "hazard_notes", type: .dictatableNarrative, label: "Hazard notes"),
            ]),
        ],
        prefill: [.gps],
        success: SuccessSpec(numberKey: "id", message: "Property added"))

    // ── People & cases ─────────────────────────────────────────
    static let arrest = WorkflowDefinition(
        id: "arrest", title: "Arrest / booking", icon: "hand.raised.fill",
        category: .people, roles: fullRoles,
        submit: .single(post: "api/arrests/manual"), encoding: .json,
        steps: [
            WorkflowStep(title: "Subject", fields: [
                WorkflowField(key: "full_name", type: .text, label: "Full name", required: true),
                WorkflowField(key: "date_of_birth", type: .date, label: "Date of birth"),
                WorkflowField(key: "address", type: .text, label: "Address"),
            ]),
            WorkflowStep(title: "Charges", fields: [
                WorkflowField(key: "charges", type: .dictatableNarrative, label: "Charges", required: true),
                WorkflowField(key: "booking_number", type: .text, label: "Booking #"),
            ]),
        ],
        prefill: [.scanSubject],
        success: SuccessSpec(numberKey: "id", message: "Arrest recorded"))

    static let caseFile = WorkflowDefinition(
        id: "case", title: "Open case", icon: "folder.fill.badge.plus",
        category: .people, roles: fullRoles,
        submit: .single(post: "api/cases"), encoding: .json,
        steps: [
            WorkflowStep(title: "Case", fields: [
                WorkflowField(key: "title", type: .text, label: "Title", required: true),
                WorkflowField(key: "case_type", type: .chips, label: "Type", options: [
                    FieldOption(value: "general", label: "General"), FieldOption(value: "investigation", label: "Investigation"),
                    FieldOption(value: "internal", label: "Internal"), FieldOption(value: "criminal", label: "Criminal")]),
                WorkflowField(key: "summary", type: .dictatableNarrative, label: "Summary"),
            ]),
        ],
        prefill: [],
        success: SuccessSpec(numberKey: "id", message: "Case opened"))

    static let task = WorkflowDefinition(
        id: "task", title: "Task / follow-up", icon: "checklist",
        category: .people, roles: fullRoles,
        submit: .single(post: "api/tasks"), encoding: .json,
        steps: [
            WorkflowStep(title: "Task", fields: [
                WorkflowField(key: "task_title", type: .text, label: "Task", required: true),
                WorkflowField(key: "priority", type: .segmented, label: "Priority", options: [
                    FieldOption(value: "low", label: "Low"), FieldOption(value: "normal", label: "Normal"),
                    FieldOption(value: "high", label: "High")], defaultValue: .string("normal")),
                WorkflowField(key: "due_date", type: .date, label: "Due date"),
                WorkflowField(key: "description", type: .dictatableNarrative, label: "Details"),
            ]),
        ],
        prefill: [],
        success: SuccessSpec(numberKey: "id", message: "Task created"))

    // ── Civil / admin ──────────────────────────────────────────
    static let communityEvent = WorkflowDefinition(
        id: "community_event", title: "Community event", icon: "person.3.fill",
        category: .civil, roles: fullRoles,
        submit: .single(post: "api/community/events"), encoding: .json,
        steps: [
            WorkflowStep(title: "Event", fields: [
                WorkflowField(key: "event_name", type: .text, label: "Event name", required: true),
                WorkflowField(key: "event_type", type: .chips, label: "Type", options: [
                    FieldOption(value: "meeting", label: "Meeting"), FieldOption(value: "outreach", label: "Outreach"),
                    FieldOption(value: "training", label: "Training"), FieldOption(value: "patrol", label: "Patrol")]),
                WorkflowField(key: "start_date", type: .date, label: "Start date", required: true),
                WorkflowField(key: "location", type: .gpsLocation, label: "Location"),
                WorkflowField(key: "description", type: .dictatableNarrative, label: "Description"),
            ]),
        ],
        prefill: [.gps],
        success: SuccessSpec(numberKey: "id", message: "Event created"))

    static let codeViolation = WorkflowDefinition(
        id: "code_violation", title: "Code violation", icon: "exclamationmark.triangle.fill",
        category: .civil, roles: fullRoles,
        submit: .single(post: "api/code-enforcement/violations"), encoding: .json,
        steps: [
            WorkflowStep(title: "Violation", fields: [
                WorkflowField(key: "violation_type", type: .chips, label: "Type", options: [
                    FieldOption(value: "parking", label: "Parking"), FieldOption(value: "noise", label: "Noise"),
                    FieldOption(value: "signage", label: "Signage"), FieldOption(value: "structural", label: "Structural"),
                    FieldOption(value: "other", label: "Other")]),
                WorkflowField(key: "severity", type: .segmented, label: "Severity", options: [
                    FieldOption(value: "low", label: "Low"), FieldOption(value: "medium", label: "Med"),
                    FieldOption(value: "high", label: "High")]),
                WorkflowField(key: "location", type: .gpsLocation, label: "Location", required: true),
                WorkflowField(key: "description", type: .dictatableNarrative, label: "Description", required: true),
                WorkflowField(key: "fine_amount", type: .number, label: "Fine ($)"),
            ]),
        ],
        prefill: [.gps],
        success: SuccessSpec(numberKey: "id", message: "Violation logged"))

    static let crisis = WorkflowDefinition(
        id: "crisis", title: "Crisis response", icon: "cross.case.fill",
        category: .civil, roles: fullRoles,
        submit: .single(post: "api/crisis-response/incidents"), encoding: .json,
        steps: [
            WorkflowStep(title: "Incident", fields: [
                WorkflowField(key: "incident_number", type: .text, label: "Incident #", required: true),
                WorkflowField(key: "incident_type", type: .chips, label: "Type", options: [
                    FieldOption(value: "mental_health", label: "Mental health"), FieldOption(value: "substance", label: "Substance"),
                    FieldOption(value: "domestic", label: "Domestic"), FieldOption(value: "welfare", label: "Welfare")]),
                WorkflowField(key: "location", type: .gpsLocation, label: "Location"),
                WorkflowField(key: "subject_name", type: .text, label: "Subject name"),
            ]),
            WorkflowStep(title: "Outcome", fields: [
                WorkflowField(key: "disposition", type: .chips, label: "Disposition", options: [
                    FieldOption(value: "resolved", label: "Resolved"), FieldOption(value: "transported", label: "Transported"),
                    FieldOption(value: "diverted", label: "Diverted"), FieldOption(value: "referred", label: "Referred")]),
                WorkflowField(key: "notes", type: .dictatableNarrative, label: "Notes"),
            ]),
        ],
        prefill: [.gps],
        success: SuccessSpec(numberKey: "id", message: "Crisis incident logged"))
}
