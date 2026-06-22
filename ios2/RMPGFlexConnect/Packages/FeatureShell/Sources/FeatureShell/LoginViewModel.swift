import Foundation
import CoreAPI
import CoreAuth
import Observation

@Observable
@MainActor
public final class LoginViewModel {
    public enum State: Equatable {
        case idle
        case submitting
        case error(String)
    }

    public var username: String = ""
    public var password: String = ""
    public private(set) var state: State = .idle

    private let authAPI: AuthAPI
    private let session: AuthSession

    public init(authAPI: AuthAPI, session: AuthSession) {
        self.authAPI = authAPI
        self.session = session
    }

    public var canSubmit: Bool {
        !username.isEmpty && !password.isEmpty && state != .submitting
    }

    public func submit() async {
        guard canSubmit else { return }
        state = .submitting
        do {
            let resp = try await authAPI.login(username: username, password: password)
            try session.signIn(token: resp.token)
            state = .idle
        } catch let e as APIError {
            switch e {
            case .unauthorized: state = .error("Invalid username or password.")
            case .network: state = .error("No connection. Check Wi-Fi or LTE.")
            case .forbidden: state = .error("Your account is disabled. Contact admin.")
            case .notConfigured(let code): state = .error("Login disabled (\(code)).")
            case .server(let s, _, let m): state = .error("Server error \(s): \(m ?? "unknown").")
            case .decode: state = .error("Unexpected server response.")
            }
        } catch {
            state = .error("Could not save credentials securely.")
        }
    }
}
