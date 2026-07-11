import SwiftUI
import CoreAPI
import DesignSystem

public struct PlateEntryView: View {
    @State private var plateText = ""
    @State private var stateCode = "UT"
    @State private var isRunning = false
    @State private var result: PlateResult?
    @State private var error: String?

    private let apiClient: RunPlateAPIClient

    public init(apiClient: RunPlateAPIClient) {
        self.apiClient = apiClient
    }

    public var body: some View {
        VStack(spacing: 16) {
            Text("RUN PLATE")
                .font(.title2).bold()
                .foregroundColor(ThemeColors.tokens(for: .night).brandGold)

            VStack(alignment: .leading, spacing: 8) {
                TextField("License Plate", text: $plateText)
                    .textFieldStyle(.roundedBorder)
                    #if os(iOS)
                    .textInputAutocapitalization(.characters)
                    #endif
                    .disableAutocorrection(true)
                    .font(.title3)
                HStack {
                    Picker("State", selection: $stateCode) {
                        Text("UT").tag("UT")
                        Text("CO").tag("CO")
                        Text("AZ").tag("AZ")
                        Text("NV").tag("NV")
                        Text("ID").tag("ID")
                        Text("WY").tag("WY")
                        Text("NM").tag("NM")
                    }
                    .pickerStyle(.menu)
                    .frame(maxWidth: 120)
                    Spacer()
                    Button(action: runPlate) {
                        if isRunning {
                            ProgressView().tint(.white)
                        } else {
                            Text("RUN PLATE")
                                .fontWeight(.semibold)
                        }
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(ThemeColors.tokens(for: .night).brandGold)
                    .disabled(plateText.isEmpty || isRunning)
                }
            }
            .padding()
            .background(ThemeColors.tokens(for: .night).surfaceRaised)
            .cornerRadius(2)

            if let error {
                Text(error)
                    .foregroundColor(ThemeColors.tokens(for: .night).critical)
                    .font(.caption)
            }

            if let result {
                PlateResultView(result: result)
            }

            if result == nil && error == nil {
                Spacer()
                VStack(spacing: 8) {
                    Image(systemName: "camera.viewfinder")
                        .font(.system(size: 48))
                        .foregroundColor(ThemeColors.tokens(for: .night).textMuted)
                    Text("Enter a plate or use the camera to scan")
                        .foregroundColor(ThemeColors.tokens(for: .night).textMuted)
                }
                Spacer()
            }
        }
        .padding()
    }

    private func runPlate() {
        guard !plateText.isEmpty else { return }
        isRunning = true
        error = nil
        result = nil
        Task {
            do {
                let plateResult = try await apiClient.runPlate(plate: plateText, state: stateCode)
                await MainActor.run {
                    result = plateResult
                    isRunning = false
                }
            } catch {
                await MainActor.run {
                    self.error = error.localizedDescription
                    isRunning = false
                }
            }
        }
    }
}

public struct PlateResultView: View {
    public let result: PlateResult

    public var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Image(systemName: result.isStolen ? "exclamationmark.triangle.fill" : "checkmark.circle.fill")
                    .foregroundColor(result.isStolen ? .red : .green)
                Text("\(result.plate) · \(result.state)")
                    .font(.title3).bold()
            }
            Divider()
            if let owner = result.registeredOwner {
                LabeledContent("Owner", value: owner)
            }
            if let make = result.make { LabeledContent("Make", value: make) }
            if let model = result.model { LabeledContent("Model", value: model) }
            if let year = result.year { LabeledContent("Year", value: year) }
            if let color = result.color { LabeledContent("Color", value: color) }
            if let vin = result.vin { LabeledContent("VIN", value: vin) }
            if let expiration = result.registrationExpiration {
                LabeledContent("Registration", value: expiration)
            }
            if result.isStolen {
                HStack {
                    Image(systemName: "exclamationmark.shield.fill")
                        .foregroundColor(.red)
                    Text("STOLEN VEHICLE FLAG")
                        .fontWeight(.bold)
                        .foregroundColor(.red)
                }
                .padding(8)
                .background(Color.red.opacity(0.1))
                .cornerRadius(2)
            }
        }
        .padding()
        .background(ThemeColors.tokens(for: .night).surfaceRaised)
        .cornerRadius(2)
    }
}

public struct PlateResult: Decodable, Sendable {
    public let plate: String
    public let state: String
    public let isStolen: Bool
    public let registeredOwner: String?
    public let make: String?
    public let model: String?
    public let year: String?
    public let color: String?
    public let vin: String?
    public let registrationExpiration: String?
}

public struct RunPlateAPIClient: Sendable {
    public let baseURL: URL
    public let tokenProvider: @Sendable () -> String?

    public init(baseURL: URL, tokenProvider: @escaping @Sendable () -> String?) {
        self.baseURL = baseURL
        self.tokenProvider = tokenProvider
    }

    public func runPlate(plate: String, state: String) async throws -> PlateResult {
        var components = URLComponents(url: baseURL.appendingPathComponent("api/records/vehicles"), resolvingAgainstBaseURL: true)
        components?.queryItems = [
            URLQueryItem(name: "plate", value: plate),
            URLQueryItem(name: "state", value: state),
        ]
        guard let url = components?.url else { throw URLError(.badURL) }
        var request = URLRequest(url: url)
        if let token = tokenProvider() {
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }
        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw URLError(.badServerResponse) }
        switch http.statusCode {
        case 200...299: return try JSONDecoder.api.decode(PlateResult.self, from: data)
        case 401: throw APIError.unauthorized
        case 404: throw APIError.notConfigured(code: "plate_not_found")
        default: throw APIError.server(status: http.statusCode, code: nil, message: nil)
        }
    }
}

private extension JSONDecoder {
    static let api: JSONDecoder = {
        let d = JSONDecoder()
        d.keyDecodingStrategy = .convertFromSnakeCase
        return d
    }()
}
