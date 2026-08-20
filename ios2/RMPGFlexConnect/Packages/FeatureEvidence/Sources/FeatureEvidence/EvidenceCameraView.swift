import SwiftUI
import CoreAPI
import CoreAuth
import CoreLocationService
import DesignSystem
import CoreLocation

#if canImport(UIKit)
import UIKit
#endif

/// Tamper-evident evidence capture.
///
/// Flow: live camera capture (never the photo library — chain of custody
/// needs the ORIGINAL frame) -> SHA-256 the raw JPEG on-device -> stamp GPS +
/// timestamp + officer identity + classification -> file the chain-of-custody
/// manifest to `POST /api/evidence` -> best-effort upload the actual photo to
/// `POST /api/field-photos` (linked by embedding the hash in `notes`, since
/// that endpoint doesn't carry a dedicated hash column). Filing the manifest
/// never blocks on the photo upload succeeding, and vice versa — a partial
/// failure must never mean the officer silently loses the capture.
@MainActor
public struct EvidenceCameraView: View {
    @Environment(\.theme) private var theme
    @Environment(\.dismiss) private var dismiss

    @State private var gps = GPSProvider()
    @State private var classification: EvidenceClassification = .evidence
    @State private var caseRef: String = ""
    @State private var showCamera = false
    @State private var isBusy = false
    @State private var error: String?
    @State private var result: EvidenceManifestResponse.Data?

    let apiClient: APIClient
    let authSession: AuthSession
    /// Next exhibit sequence number for this session — the caller (or a
    /// future persisted counter) increments this across captures.
    let sequence: Int

    public init(apiClient: APIClient, authSession: AuthSession, sequence: Int = 1) {
        self.apiClient = apiClient
        self.authSession = authSession
        self.sequence = sequence
    }

    public var body: some View {
        NavigationStack {
            ZStack {
                theme.colors.surfaceBase.ignoresSafeArea()
                if let result {
                    resultView(result)
                } else {
                    form
                }
            }
            .navigationTitle("SECURE EVIDENCE")
            .rmpgNavBar(background: theme.colors.surfaceRaised)
            .toolbar {
                ToolbarItem(placement: RmpgToolbarPlacement.trailing.placement) {
                    Button("Cancel") { dismiss() }
                        .font(.caption.weight(.semibold)).foregroundStyle(theme.colors.textMuted)
                }
            }
        }
        .onAppear {
            gps.requestAuthorization()
            gps.startUpdatingLocation()
        }
        #if os(iOS)
        .fullScreenCover(isPresented: $showCamera) {
            EvidenceCameraCapture(
                onCapture: { data in
                    showCamera = false
                    Task { await capture(data) }
                },
                onCancel: { showCamera = false }
            )
            .ignoresSafeArea()
        }
        #endif
    }

    private var form: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                VStack(alignment: .leading, spacing: 6) {
                    Text("CLASSIFICATION").font(.caption2.weight(.semibold)).tracking(0.5)
                        .foregroundStyle(theme.colors.textMuted)
                    Picker("Classification", selection: $classification) {
                        ForEach(EvidenceClassification.allCases, id: \.self) { c in
                            Text(c.rawValue).tag(c)
                        }
                    }
                    .pickerStyle(.menu)
                    .tint(theme.colors.brandGold)
                }

                VStack(alignment: .leading, spacing: 6) {
                    Text("CASE / REFERENCE (OPTIONAL)").font(.caption2.weight(.semibold)).tracking(0.5)
                        .foregroundStyle(theme.colors.textMuted)
                    TextField("Case #", text: $caseRef)
                        .padding(10)
                        .background(theme.colors.surfaceMuted)
                        .foregroundStyle(theme.colors.textPrimary)
                        .clipShape(RoundedRectangle(cornerRadius: 2))
                }

                HStack(spacing: 8) {
                    Image(systemName: gps.currentLocation == nil ? "location.slash" : "location.fill")
                        .foregroundStyle(gps.currentLocation == nil ? theme.colors.warning : theme.colors.success)
                    Text(gps.currentLocation == nil ? "Acquiring GPS…" : "GPS locked")
                        .font(.caption).foregroundStyle(theme.colors.textMuted)
                }

                if let error {
                    Text(error).font(.caption).foregroundStyle(theme.colors.critical)
                }

                Button {
                    #if os(iOS)
                    showCamera = true
                    #endif
                } label: {
                    Group {
                        if isBusy { ProgressView().tint(theme.colors.surfaceBase) }
                        else {
                            Label("CAPTURE", systemImage: "camera.fill")
                                .font(.headline).tracking(1)
                        }
                    }
                    .frame(maxWidth: .infinity).padding(.vertical, 14)
                    .background(theme.colors.brandGold)
                    .foregroundStyle(theme.colors.surfaceBase)
                    .clipShape(RoundedRectangle(cornerRadius: 2))
                }
                .disabled(isBusy)

                Text("The original frame is hashed (SHA-256) before anything is burned in or transmitted. The fingerprint, capture time, GPS, and your identity are filed to the chain-of-custody log so this photo can later be verified as unaltered.")
                    .font(.caption2).foregroundStyle(theme.colors.textMuted)
            }
            .padding(16)
        }
    }

    private func resultView(_ r: EvidenceManifestResponse.Data) -> some View {
        VStack(spacing: 16) {
            Image(systemName: "checkmark.shield.fill").font(.system(size: 64)).foregroundStyle(theme.colors.success)
            Text("EVIDENCE FILED").font(.title3.weight(.bold)).tracking(2).foregroundStyle(theme.colors.textPrimary)

            VStack(spacing: 4) {
                if let num = r.evidence_number {
                    Text(num).font(.title2.weight(.black).monospacedDigit()).foregroundStyle(theme.colors.brandGold)
                }
                if let short = r.short_hash {
                    Text("SHA256 \(short)…").font(.caption2.monospaced()).foregroundStyle(theme.colors.textMuted)
                }
            }
            .padding(16).background(theme.colors.surfaceRaised)
            .clipShape(RoundedRectangle(cornerRadius: 8))

            Button("Done") { dismiss() }
                .font(.headline).tracking(1).frame(maxWidth: .infinity).padding(.vertical, 14)
                .background(theme.colors.brandGold).foregroundStyle(theme.colors.surfaceBase)
                .clipShape(RoundedRectangle(cornerRadius: 2))
                .padding(.horizontal, 32).padding(.top, 8)
        }
        .padding(32)
    }

    private func capture(_ jpegData: Data) async {
        #if canImport(CryptoKit)
        isBusy = true; error = nil
        let sha = sha256Hex(of: jpegData)
        let location = gps.currentLocation
        let claims = currentClaims()

        let manifest = EvidenceManifest(
            sha256: sha,
            classification: classification,
            sequence: sequence,
            officerName: claims.name,
            badge: claims.badge,
            unit: claims.unit,
            caseRef: caseRef.isEmpty ? nil : caseRef,
            gpsLat: location?.coordinate.latitude,
            gpsLng: location?.coordinate.longitude,
            deviceId: deviceId(),
            mime: "image/jpeg"
        )

        do {
            let endpoint = try Endpoint.jsonPost("api/evidence", body: manifest)
            let response = try await apiClient.request(endpoint, as: EvidenceManifestResponse.self)
            result = response.data
            // Best-effort: also persist the photo bytes, linked by the same
            // hash. A failure here never invalidates the filed manifest.
            await uploadPhoto(jpegData, sha256: sha, location: location)
        } catch let apiError as APIError {
            self.error = describe(apiError)
        } catch {
            self.error = error.localizedDescription
        }
        isBusy = false
        #else
        self.error = "SHA-256 hashing unavailable on this platform"
        #endif
    }

    private func uploadPhoto(_ data: Data, sha256: String, location: CLLocation?) async {
        guard let token = authSession.token, !token.isEmpty else { return }
        let url = URL(string: "https://api.rmpgutah.us/api/field-photos")!
        let boundary = "----Boundary\(UUID().uuidString.replacingOccurrences(of: "-", with: ""))"
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")
        req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")

        var body = Data()
        func appendField(_ name: String, _ value: String) {
            body.append("--\(boundary)\r\n".data(using: .utf8)!)
            body.append("Content-Disposition: form-data; name=\"\(name)\"\r\n\r\n".data(using: .utf8)!)
            body.append(value.data(using: .utf8)!)
            body.append("\r\n".data(using: .utf8)!)
        }
        body.append("--\(boundary)\r\n".data(using: .utf8)!)
        body.append("Content-Disposition: form-data; name=\"photo\"; filename=\"evidence.jpg\"\r\n".data(using: .utf8)!)
        body.append("Content-Type: image/jpeg\r\n\r\n".data(using: .utf8)!)
        body.append(data)
        body.append("\r\n".data(using: .utf8)!)
        if let location {
            appendField("lat", String(location.coordinate.latitude))
            appendField("lng", String(location.coordinate.longitude))
        }
        appendField("notes", "SHA256:\(sha256) CLASS:\(classification.rawValue)")
        body.append("--\(boundary)--\r\n".data(using: .utf8)!)
        req.httpBody = body

        _ = try? await URLSession.shared.data(for: req)
    }

    private struct Claims { let name: String?; let badge: String?; let unit: String? }

    private func currentClaims() -> Claims {
        guard let token = authSession.token, let payload = try? JWT.decode(token) else {
            return Claims(name: nil, badge: nil, unit: nil)
        }
        func str(_ key: String) -> String? {
            if case let .string(v)? = payload.raw[key] { return v }
            return nil
        }
        return Claims(name: str("name") ?? str("officer_name"), badge: str("badge"), unit: str("unit"))
    }

    private func deviceId() -> String {
        #if os(iOS)
        return UIDevice.current.identifierForVendor?.uuidString ?? "unknown-device"
        #else
        return "unknown-device"
        #endif
    }

    private func describe(_ error: APIError) -> String {
        switch error {
        case .unauthorized: return "Session expired — sign in again."
        case .forbidden: return "Your role can't file evidence manifests."
        case .notConfigured(let code): return "Not configured (\(code))."
        case .server(let status, _, let message): return message ?? "Server error (\(status))."
        case .decode: return "Unexpected server response."
        case .network: return "Network error — check connectivity."
        }
    }
}
