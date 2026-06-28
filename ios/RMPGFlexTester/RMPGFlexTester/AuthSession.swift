import Foundation
import LocalAuthentication

// AuthSession — app-wide auth gate. The app opens to LoginView until a successful
// RMPG login; after the first password login the credentials live in the Keychain
// and subsequent launches offer Face ID / Touch ID unlock (which silently
// re-logs-in to refresh the JWT). "Lock" keeps the stored credentials (Face ID
// re-entry); "Sign out" wipes them. Existing views keep using
// AppConfig.apiClient() (reads rmpgJWT) — this just adds the front door.
@MainActor
final class AuthSession: ObservableObject {
    @Published var isAuthenticated = false
    @Published var officerName: String?
    @Published var status: String?
    @Published var busy = false

    var hasStoredCredentials: Bool {
        !(KeychainStore.load(key: "rmpgUser") ?? "").isEmpty &&
        !(KeychainStore.load(key: "rmpgPass") ?? "").isEmpty
    }

    var biometryAvailable: Bool {
        LAContext().canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: nil)
    }

    /// "Face ID" / "Touch ID" / "Biometrics" for button labels.
    var biometryLabel: String {
        let ctx = LAContext()
        _ = ctx.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: nil)
        switch ctx.biometryType {
        case .faceID: return "Face ID"
        case .touchID: return "Touch ID"
        default: return "Biometrics"
        }
    }

    var biometrySymbol: String {
        LAContext().biometryType == .touchID ? "touchid" : "faceid"
    }

    func loginWithPassword(_ user: String, _ pass: String) async {
        busy = true; defer { busy = false }
        status = nil
        do {
            let token = try await AppConfig.apiClient().login(username: user, password: pass)
            KeychainStore.save(user, key: "rmpgUser")
            KeychainStore.save(pass, key: "rmpgPass")
            KeychainStore.save(token, key: "rmpgJWT")
            officerName = JWTClaims.decode(token)?.name
            isAuthenticated = true
        } catch {
            status = "✗ \(error.localizedDescription)"
        }
    }

    /// Biometric unlock: evaluate Face ID/Touch ID, then re-login with the stored
    /// credentials to get a fresh JWT. No-op if no credentials are stored.
    func unlockWithBiometrics() async {
        guard hasStoredCredentials, biometryAvailable else { return }
        let ctx = LAContext()
        ctx.localizedFallbackTitle = "Use Password"
        let ok = await evaluate(ctx, reason: "Unlock RMPG Flex")
        guard ok else { return } // user cancelled / failed — stay on login
        let user = KeychainStore.load(key: "rmpgUser") ?? ""
        let pass = KeychainStore.load(key: "rmpgPass") ?? ""
        await loginWithPassword(user, pass)
    }

    /// Lock the app but KEEP credentials so Face ID can re-open it.
    func lock() { isAuthenticated = false; status = nil }

    /// Full sign-out: wipe the stored RMPG credentials + token.
    func signOut() {
        KeychainStore.delete(key: "rmpgUser")
        KeychainStore.delete(key: "rmpgPass")
        KeychainStore.delete(key: "rmpgJWT")
        officerName = nil
        isAuthenticated = false
        status = nil
    }

    // LocalAuthentication has no async overload — bridge the callback API.
    private func evaluate(_ ctx: LAContext, reason: String) async -> Bool {
        await withCheckedContinuation { cont in
            ctx.evaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, localizedReason: reason) { ok, _ in
                cont.resume(returning: ok)
            }
        }
    }
}
