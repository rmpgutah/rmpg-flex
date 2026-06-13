import Foundation

// The catalog. Adding a workflow = adding a WorkflowDefinition here. Field keys
// match the live server body allow-lists (citations.ts, incidents.ts, patrol.ts).
enum WorkflowRegistry {
    static let all: [WorkflowDefinition] = [incident, citation, patrolScan]

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
}
