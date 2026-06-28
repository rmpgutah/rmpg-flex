import Foundation

// Pure state machine for the dictation engine (Dictation.swift wraps Speech
// around this). Kept Foundation-only so it is unit-testable under SwiftPM.
enum DictationState: Equatable {
    case idle, listening, denied
    enum Event { case start, stop, denied }
    func next(_ e: Event) -> DictationState {
        switch (self, e) {
        case (_, .denied): return .denied
        case (.denied, _): return .denied
        case (.idle, .start): return .listening
        case (.listening, .stop): return .idle
        default: return self
        }
    }
}
