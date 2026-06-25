import SwiftUI
import ProximityReader

public struct AppleIDVerifierView: View {
    @State private var session: IDVerificationSession?
    @State private var result: IDVerificationResult?
    @State private var error: String?
    @State private var isPresented = false

    public init() {}

    public var body: some View {
        VStack(spacing: 16) {
            Image(systemName: "wallet.pass")
                .font(.system(size: 64))
                .foregroundColor(.blue)
            Text("WIRELESS ID VERIFICATION")
                .font(.title3).bold()
            Text("Subject taps their iPhone or Apple Watch to verify their identity.\nNo personal data is stored.")
                .font(.caption)
                .multilineTextAlignment(.center)
                .foregroundColor(.secondary)
            if let result {
                VStack(alignment: .leading) {
                    Text("Verified Name: \(result.givenName) \(result.familyName)")
                    if let age = result.age { Text("Age: \(age)") }
                }
                .padding()
                .background(Color.green.opacity(0.1))
                .cornerRadius(2)
            }
            if let error {
                Text(error).foregroundColor(.red).font(.caption)
            }
            Button("READ ID") {
                Task { await startVerification() }
            }
            .buttonStyle(.borderedProminent)
            .disabled(!IDVerificationSession.isSupported || isPresented)
            .help(IDVerificationSession.isSupported ? "Tap to read wireless ID" : "Not supported on this device")
        }
        .padding()
    }

    private func startVerification() async {
        guard IDVerificationSession.isSupported else {
            error = "Wireless ID verification is not supported on this device"
            return
        }
        isPresented = true
        session = IDVerificationSession()
        do {
            let response = try await session?.requestVerification()
            result = response
            error = nil
        } catch {
            self.error = error.localizedDescription
            result = nil
        }
        isPresented = false
    }
}
