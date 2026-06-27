import SwiftUI

/// Cross-platform wrappers for iOS navigation bar styling.
/// All modifiers are no-ops on macOS (where NavigationStack uses window chrome).
public extension View {
    func rmpgNavBar(background: Color) -> some View {
#if os(iOS)
        self
            .navigationBarTitleDisplayMode(.inline)
            .toolbarBackground(background, for: .navigationBar)
#else
        self
#endif
    }
}

/// Cross-platform toolbar item placements.
public enum RmpgToolbarPlacement {
    case leading
    case trailing
    case confirmationAction   // "Done" button idiom

    public var placement: ToolbarItemPlacement {
#if os(iOS)
        switch self {
        case .leading:              return .topBarLeading
        case .trailing:             return .topBarTrailing
        case .confirmationAction:   return .topBarTrailing
        }
#else
        switch self {
        case .leading:              return .automatic
        case .trailing:             return .primaryAction
        case .confirmationAction:   return .confirmationAction
        }
#endif
    }
}
