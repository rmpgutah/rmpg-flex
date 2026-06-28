import Foundation

// Readiness checklist: local (computed from required keys, shown BEFORE submit)
// and server (parsed from a 4xx validation body). One mapping serves every
// workflow whose server returns a validation/error body.
enum WorkflowValidation {
    static func readiness(requiredKeys: [String], present: Set<String>,
                          labels: [String: String]) -> [ReadinessItem] {
        requiredKeys.map { ReadinessItem(label: labels[$0] ?? $0, satisfied: present.contains($0)) }
    }

    /// Map a server error body into unsatisfied readiness rows. Handles the
    /// incidents NIBRS shape ({validation:{errors:[…]}}) and a generic {error:"…"}.
    static func serverErrors(from body: [String: Any]) -> [ReadinessItem] {
        if let v = body["validation"] as? [String: Any],
           let errs = v["errors"] as? [Any] {
            return errs.compactMap { $0 as? String }.map { ReadinessItem(label: $0, satisfied: false) }
        }
        if let e = body["error"] as? String {
            return [ReadinessItem(label: e, satisfied: false)]
        }
        return []
    }
}
