import Foundation

// Pure formatting for the in-app turn-by-turn list. Foundation-only (unit-tested).
enum NavStepFormat {
    /// SF Symbol for a maneuver, inferred from Apple's instruction text.
    static func icon(for instruction: String) -> String {
        let s = instruction.lowercased()
        if s.contains("arrive") || s.contains("destination") { return "mappin.circle.fill" }
        if s.contains("u-turn") { return "arrow.uturn.down" }
        if s.contains("left") { return "arrow.turn.up.left" }
        if s.contains("right") { return "arrow.turn.up.right" }
        return "arrow.up"
    }

    /// Feet under a tenth of a mile, else miles.
    static func distance(_ meters: Double) -> String {
        let feet = meters * 3.28084
        if feet < 528 { return "\(Int(feet.rounded())) ft" }
        return String(format: "%.1f mi", meters / 1609.34)
    }
}
