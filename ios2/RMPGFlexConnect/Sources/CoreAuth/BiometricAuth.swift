import LocalAuthentication


/// UserDefaults key controlling whether the biometric gate/login is offered
/// at all. Exposed here (rather than duplicated as a raw string literal in
/// AppView/LoginView/SettingsView) so all three call sites agree on the same
/// key and default.
public enum BiometricLoginPreference {
    public static let key = "biometric_login_enabled"

    /// Defaults to true (opt-out, not opt-in) — most officers want the
    /// faster unlock, and it can't do anything a password login couldn't
    /// already do (it only ever unlocks a session this same device already
    /// holds valid tokens for).
    public static var isEnabled: Bool {
        UserDefaults.standard.object(forKey: key) == nil ? true : UserDefaults.standard.bool(forKey: key)
    }
}

/// Thin wrapper around LocalAuthentication for gating a persisted session
/// behind Face ID / Touch ID on app launch.
public struct BiometricAuth {
    public enum Kind {
        case faceID
        case touchID
        case none
    }

    public static var available: Kind {
        let context = LAContext()
        var error: NSError?
        guard context.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: &error) else {
            return .none
        }
        switch context.biometryType {
        case .faceID: return .faceID
        case .touchID: return .touchID
        default: return .none
        }
    }

    /// Prompts biometrics with the device passcode as the system-provided
    /// fallback (Apple's recommended pattern for unlocking an app, rather
    /// than biometrics-only which strands a user with a scratched sensor
    /// or a masked face). Returns false on any failure, cancel, or
    /// unavailability — never throws, since the caller's only decision is
    /// "let them in or show the login screen."
    public static func authenticate(reason: String) async -> Bool {
        let context = LAContext()
        context.localizedFallbackTitle = "Use Passcode"
        var error: NSError?
        guard context.canEvaluatePolicy(.deviceOwnerAuthentication, error: &error) else { return false }

        return await withCheckedContinuation { continuation in
            context.evaluatePolicy(.deviceOwnerAuthentication, localizedReason: reason) { success, _ in
                continuation.resume(returning: success)
            }
        }
    }

    /// Shared orchestration used by both the launch-time gate (AppView) and
    /// the explicit "Login with Face ID" button (LoginView) — one place
    /// deciding "can we, should we, did it work" instead of two copies of
    /// the same three-step check drifting apart.
    @MainActor
    public static func attemptLogin(authManager: AuthManager, reason: String = "Unlock RMPG Flex Connect") async -> Bool {
        guard BiometricLoginPreference.isEnabled, authManager.hasPersistedSession, available != .none else { return false }
        guard await authenticate(reason: reason) else { return false }
        await authManager.restoreSession()
        return authManager.isAuthenticated
    }
}
