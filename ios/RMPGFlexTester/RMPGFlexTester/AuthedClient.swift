import Foundation

/// Returns a client with a valid JWT, logging in from Keychain creds if needed.
/// Factors the login-then-call pattern duplicated across FieldOps/BackgroundDuty/etc.
func authedClient() async -> RMPGAPIClient? {
    var client = AppConfig.apiClient()
    if client.jwt == nil,
       let u = KeychainStore.load(key: "rmpgUser"),
       let p = KeychainStore.load(key: "rmpgPass"), !u.isEmpty,
       let t = try? await client.login(username: u, password: p) {
        KeychainStore.save(t, key: "rmpgJWT"); client.jwt = t
    }
    return client.jwt == nil ? nil : client
}

/// Run authed work; on a 401 re-login once and retry. Returns the thrown error
/// (nil on success) so callers can branch on `RMPGAPIClient.apiBody`.
@discardableResult
func authedRetrying(_ work: (RMPGAPIClient) async throws -> Void) async -> Error? {
    guard var c = await authedClient() else {
        return NSError(domain: "RMPG", code: 401, userInfo: [NSLocalizedDescriptionKey: "Set RMPG credentials in Settings"])
    }
    do { try await work(c); return nil }
    catch {
        if (error as NSError).code == 401,
           let u = KeychainStore.load(key: "rmpgUser"),
           let p = KeychainStore.load(key: "rmpgPass"),
           let t = try? await c.login(username: u, password: p) {
            KeychainStore.save(t, key: "rmpgJWT"); c.jwt = t
            do { try await work(c); return nil } catch { return error }
        }
        return error
    }
}
