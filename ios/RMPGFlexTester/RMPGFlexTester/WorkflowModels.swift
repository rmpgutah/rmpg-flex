import Foundation

// Declarative workflow engine — data model. Foundation-only so it builds under
// the SwiftPM test harness (ios/run-workflow-tests.sh). No SwiftUI/UIKit here.

enum WorkflowCategory: String, CaseIterable, Codable { case reports, patrol, people, civil }

enum FieldType: String, Codable {
    case text, dictatableNarrative, chips, segmented, date, time, number, toggle
    case photo, scanSubject, scanVehicle, statuteSearch, signature, gpsLocation, picker
}

enum FieldValue: Equatable {
    case string(String), number(Double), bool(Bool), none
    var isEmpty: Bool {
        switch self {
        case .string(let s): return s.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        case .none: return true
        case .number, .bool: return false
        }
    }
}

struct FieldOption: Equatable { let value: String; let label: String }

struct WorkflowField {
    let key: String
    let type: FieldType
    let label: String
    var required: Bool = false
    var options: [FieldOption]? = nil
    var defaultValue: FieldValue? = nil
}

struct WorkflowStep { let title: String; let fields: [WorkflowField] }

enum SubmitSpec {
    case single(post: String)
    case lifecycle(create: String, update: String, finalize: String)
}
enum BodyEncoding { case json, multipart }
enum PrefillSource { case call, scanSubject, scanVehicle, gps }
struct SuccessSpec { let numberKey: String; let message: String }

struct ReadinessItem: Equatable { let label: String; let satisfied: Bool }

struct WorkflowDefinition {
    let id: String
    let title: String
    let icon: String
    let category: WorkflowCategory
    let roles: [String]
    let submit: SubmitSpec
    let encoding: BodyEncoding
    let steps: [WorkflowStep]
    let prefill: [PrefillSource]
    let success: SuccessSpec

    var allFields: [WorkflowField] { steps.flatMap(\.fields) }

    /// Required field keys that are absent or empty in `values` (in field order).
    func missingRequiredKeys(in values: [String: FieldValue]) -> [String] {
        allFields.filter { $0.required && (values[$0.key]?.isEmpty ?? true) }.map(\.key)
    }
}
