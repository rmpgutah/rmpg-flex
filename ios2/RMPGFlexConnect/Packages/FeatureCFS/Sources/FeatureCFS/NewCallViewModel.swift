import Foundation
import CoreAPI
import Observation

@Observable
@MainActor
public final class NewCallViewModel {
    public enum State: Equatable {
        case idle
        case submitting
        case error(String)
        case success(cfsNumber: String)
    }

    public var callType: CallType = CallTypeRegistry.common.first!
    public var location: String = ""
    public var narrative: String = ""
    public var freeTextType: String = ""  // when callType.id == "OTHER"
    public private(set) var state: State = .idle

    private let api: CFSAPI

    public init(api: CFSAPI) {
        self.api = api
    }

    public var resolvedTypeCode: String {
        callType.id == "OTHER" ? freeTextType.trimmingCharacters(in: .whitespaces) : callType.id
    }

    public var canSubmit: Bool {
        !location.trimmingCharacters(in: .whitespaces).isEmpty &&
        !resolvedTypeCode.isEmpty &&
        state != .submitting
    }

    public func submit() async {
        guard canSubmit else { return }
        state = .submitting
        do {
            let resp = try await api.createCall(
                callType: resolvedTypeCode,
                location: location,
                narrative: narrative
            )
            state = .success(cfsNumber: resp.cfsNumber ?? "PENDING")
        } catch let e as APIError {
            switch e {
            case .unauthorized: state = .error("Session expired. Sign out and back in.")
            case .network: state = .error("No connection. Saved to outbox.")
            case .forbidden: state = .error("Not authorized to create calls.")
            case .notConfigured(let code): state = .error("Dispatch endpoint disabled (\(code)).")
            case .server(let s, _, let m): state = .error("Server error \(s): \(m ?? "unknown").")
            case .decode: state = .error("Unexpected server response.")
            }
        } catch {
            state = .error("Could not submit. Try again.")
        }
    }
}
