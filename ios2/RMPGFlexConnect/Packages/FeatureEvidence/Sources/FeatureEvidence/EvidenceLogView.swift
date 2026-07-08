import SwiftUI
import CoreAPI
import DesignSystem

/// Read-only chain-of-custody log — every manifest filed by `EvidenceCameraView`,
/// newest first. Reachable from the evidence camera so an officer can confirm
/// a capture landed and re-check its fingerprint.
@MainActor
public struct EvidenceLogView: View {
    @Environment(\.theme) private var theme
    let apiClient: APIClient

    @State private var records: [EvidenceManifestRecord] = []
    @State private var isLoading = false
    @State private var error: String?

    public init(apiClient: APIClient) {
        self.apiClient = apiClient
    }

    public var body: some View {
        ZStack {
            theme.colors.surfaceBase.ignoresSafeArea()
            if isLoading && records.isEmpty {
                ProgressView().tint(theme.colors.brandGold)
            } else if let error, records.isEmpty {
                Text(error).font(.caption).foregroundStyle(theme.colors.critical)
            } else if records.isEmpty {
                Text("No evidence filed yet.").font(.caption).foregroundStyle(theme.colors.textMuted)
            } else {
                List(records) { record in
                    row(record)
                        .listRowBackground(theme.colors.surfaceRaised)
                }
                .listStyle(.plain)
                .scrollContentBackground(.hidden)
            }
        }
        .navigationTitle("CHAIN OF CUSTODY")
        .rmpgNavBar(background: theme.colors.surfaceRaised)
        .task { await load() }
        .refreshable { await load() }
    }

    private func row(_ r: EvidenceManifestRecord) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                Text(r.evidence_number ?? "—")
                    .font(.subheadline.weight(.bold)).foregroundStyle(theme.colors.brandGold)
                Spacer()
                Text(r.classification)
                    .font(.caption2.weight(.semibold)).tracking(0.5)
                    .foregroundStyle(theme.colors.textMuted)
            }
            Text("SHA256 \(shortHash(r.sha256))…")
                .font(.caption2.monospaced()).foregroundStyle(theme.colors.textSecondary)
            HStack {
                if let officer = r.officer_name, !officer.isEmpty {
                    Text(officer).font(.caption2).foregroundStyle(theme.colors.textMuted)
                }
                Spacer()
                if let captured = r.captured_at {
                    Text(captured).font(.caption2).foregroundStyle(theme.colors.textMuted)
                }
            }
        }
        .padding(.vertical, 4)
    }

    private func load() async {
        isLoading = true; error = nil
        do {
            let endpoint = Endpoint(method: .get, path: "api/evidence")
            let response = try await apiClient.request(endpoint, as: EvidenceManifestListResponse.self)
            records = response.data
        } catch {
            self.error = "Failed to load chain-of-custody log."
        }
        isLoading = false
    }
}
