import SwiftUI
import CoreAPI
import DesignSystem

public struct RecordsView: View {
    @StateObject private var viewModel: RecordsViewModel
    @State private var searchText = ""

    public init(apiClient: APIClient) {
        _viewModel = StateObject(wrappedValue: RecordsViewModel(client: apiClient))
    }

    public var body: some View {
        ZStack {
            RMPGTheme.baseBlack.ignoresSafeArea()

            VStack(spacing: 0) {
                PanelTitleBar(title: "Records", icon: "folder.fill")
                RMPGDivider()

                HStack(spacing: 8) {
                    Image(systemName: "magnifyingglass")
                        .font(.system(size: 11))
                        .foregroundColor(RMPGTheme.textMuted)
                    TextField("Search persons, vehicles, businesses...", text: $searchText)
                        .font(.system(size: 11))
                        .foregroundColor(RMPGTheme.textPrimary)
                        .onSubmit { viewModel.search(query: searchText) }
                }
                .padding(8)
                .background(RMPGTheme.sunkenSurface)
                .cornerRadius(2)
                .padding(.horizontal, 12)
                .padding(.vertical, 6)
                .background(RMPGTheme.raisedSurface)

                RMPGDivider()

                if viewModel.isLoading {
                    Spacer()
                    ProgressView().tint(RMPGTheme.brandGold)
                    Spacer()
                } else if viewModel.results.isEmpty, !searchText.isEmpty {
                    Spacer()
                    Text("No results found")
                        .font(.system(size: 12))
                        .foregroundColor(RMPGTheme.textMuted)
                    Spacer()
                } else {
                    List(viewModel.results) { result in
                        RecordRow(result: result)
                            .listRowBackground(RMPGTheme.baseBlack)
                            .listRowSeparatorTint(RMPGTheme.borderSubtle)
                    }
                    .listStyle(.plain)
                    .scrollContentBackground(.hidden)
                }
            }
        }
    }
}

@MainActor
final class RecordsViewModel: ObservableObject {
    @Published var results: [SubjectResult] = []
    @Published var isLoading = false
    @Published var error: String?

    private let client: APIClient

    init(client: APIClient) {
        self.client = client
    }

    func search(query: String) {
        guard !query.isEmpty else { return }
        isLoading = true
        Task {
            do {
                let response: SubjectSearchResponse = try await client.request(Endpoint(
                    path: "/api/records/subjects/search",
                    queryItems: [URLQueryItem(name: "q", value: query)]
                ))
                results = response.results
            } catch {
                self.error = error.localizedDescription
            }
            isLoading = false
        }
    }
}

public struct SubjectResult: Codable, Identifiable, Sendable {
    public let id: Int
    public let type: String
    public let name: String?
    public let detail: String?
    public let extra: String?

    public var entityType: String { type }
}

public struct SubjectSearchResponse: Codable, Sendable {
    public let results: [SubjectResult]
}

struct RecordRow: View {
    let result: SubjectResult

    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: result.entityType == "person" ? "person.fill" :
                    result.entityType == "vehicle" ? "car.fill" : "building.2.fill")
                .font(.system(size: 14))
                .foregroundColor(RMPGTheme.brandGold)
                .frame(width: 28, height: 28)
                .background(RMPGTheme.brandGold.opacity(0.1))
                .cornerRadius(4)

            VStack(alignment: .leading, spacing: 2) {
                Text(result.name ?? "Unknown")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundColor(RMPGTheme.textPrimary)
                if let detail = result.detail {
                    Text(detail)
                        .font(.system(size: 11))
                        .foregroundColor(RMPGTheme.textSecondary)
                }
            }

            Spacer()

            StatusBadge(text: result.entityType, color: RMPGTheme.textMuted)
        }
        .padding(.vertical, 2)
    }
}
