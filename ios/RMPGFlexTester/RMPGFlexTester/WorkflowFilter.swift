import Foundation

// Pure search match for the workflow hub (unit-tested). Matches by title or id,
// case-insensitive; an empty query matches everything.
enum WorkflowFilter {
    static func matches(_ def: WorkflowDefinition, query: String) -> Bool {
        let q = query.trimmingCharacters(in: .whitespacesAndNewlines)
        if q.isEmpty { return true }
        return def.title.range(of: q, options: .caseInsensitive) != nil
            || def.id.range(of: q, options: .caseInsensitive) != nil
    }
}
