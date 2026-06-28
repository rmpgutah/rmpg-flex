import AppIntents
import CoreAuth

@available(iOS 17.0, *)
struct RunPlateIntent: AppIntent {
    static let title: LocalizedStringResource = "Run Plate"
    static let description = IntentDescription("Run a license plate query")

    @Parameter(title: "Plate Number")
    var plate: String

    @Parameter(title: "State")
    var state: String

    static var parameterSummary: some ParameterSummary {
        Summary("Run plate \(\.$plate) in \(\.$state)")
    }

    @MainActor
    func perform() async throws -> some IntentResult {
        guard let token = KeychainStore.get(AuthSession.tokenKey) else {
            throw $plate.needsValueError("Not signed in")
        }
        var request = URLRequest(url: URL(string: "https://api.rmpgutah.us/api/records/vehicles?plate=\(plate)&state=\(state)")!)
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        let (_, _) = try await URLSession.shared.data(for: request)
        return .result()
    }
}

@available(iOS 17.0, *)
struct RunIDIntent: AppIntent {
    static let title: LocalizedStringResource = "Scan ID"
    static let description = IntentDescription("Open the ID scanner")

    @MainActor
    func perform() throws -> some IntentResult {
        return .result()
    }
}

@available(iOS 17.0, *)
struct ClockOnIntent: AppIntent {
    static let title: LocalizedStringResource = "Clock On"
    static let description = IntentDescription("Start your patrol shift")

    @Parameter(title: "Vehicle Unit ID")
    var unitID: String?

    @MainActor
    func perform() async throws -> some IntentResult {
        return .result(opensIntent: true)
    }
}

@available(iOS 17.0, *)
struct StartFIIntent: AppIntent {
    static let title: LocalizedStringResource = "Start Field Interview"
    static let description = IntentDescription("Create a new FI card")

    @MainActor
    func perform() throws -> some IntentResult {
        return .result(opensIntent: true)
    }
}

@available(iOS 17.0, *)
struct PanicIntent: AppIntent {
    static let title: LocalizedStringResource = "Panic Alert"
    static let description = IntentDescription("Broadcast a panic alert")
    static let authenticationPolicy = IntentAuthenticationPolicy.requiresAuthentication

    @MainActor
    func perform() async throws -> some IntentResult {
        return .result(opensIntent: true)
    }
}

@available(iOS 17.0, *)
struct DictateNoteIntent: AppIntent {
    static let title: LocalizedStringResource = "Dictate Note"
    static let description = IntentDescription("Dictate a note into the active CFS")

    @MainActor
    func perform() throws -> some IntentResult {
        return .result(opensIntent: true)
    }
}
