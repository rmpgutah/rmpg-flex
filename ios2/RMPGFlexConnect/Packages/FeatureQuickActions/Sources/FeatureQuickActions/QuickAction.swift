import Foundation

/// One officer-facing quick action. SF Symbol naming matches Apple's catalog
/// (iOS 17+). `milestone` controls the placeholder copy shown on tap until
/// the real handler lands in that milestone.
public struct QuickAction: Identifiable, Equatable, Sendable {
    public let id: String
    public let title: String
    public let systemImage: String
    public let milestone: String

    public init(id: String, title: String, systemImage: String, milestone: String) {
        self.id = id
        self.title = title
        self.systemImage = systemImage
        self.milestone = milestone
    }
}

/// The first 8 actions match the desktop web app's top action bar — order is
/// load-bearing there, officers learn position-by-position muscle memory.
/// `secure_evidence` (tamper-evident chain-of-custody capture) is iOS-only
/// today and appended at the end so it doesn't disturb that muscle memory.
public enum QuickActionsRegistry {
    public static let all: [QuickAction] = [
        QuickAction(id: "new_call",        title: "New Call",       systemImage: "phone.badge.plus",        milestone: "M1"),
        QuickAction(id: "new_incident",    title: "New Incident",   systemImage: "exclamationmark.triangle", milestone: "M1"),
        QuickAction(id: "new_citation",    title: "New Citation",   systemImage: "doc.badge.plus",          milestone: "M1"),
        QuickAction(id: "start_patrol",    title: "Start Patrol",   systemImage: "car.fill",                milestone: "M1"),
        QuickAction(id: "process_server",  title: "Process Server", systemImage: "figure.walk",             milestone: "M1"),
        QuickAction(id: "quick_capture",   title: "Quick Capture",  systemImage: "camera.fill",             milestone: "M1"),
        QuickAction(id: "field_camera",    title: "Field Camera",   systemImage: "camera.aperture",         milestone: "M1"),
        QuickAction(id: "tasks",           title: "Tasks",          systemImage: "checklist",               milestone: "M1"),
        QuickAction(id: "secure_evidence", title: "Secure Evidence", systemImage: "checkmark.shield.fill",  milestone: "M1"),
    ]
}
