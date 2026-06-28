import SwiftUI

// Categorized workflow hub. Renders the registry grouped by category, gated by
// the signed-in role (read from the cached JWT). Optional prefill is passed
// straight through to any workflow the officer opens.
struct WorkflowHubView: View {
    var prefill: [String: FieldValue] = [:]
    @State private var search = ""
    private var role: String { (JWTClaims.current()?.role ?? "officer").lowercased() }

    private var visible: [WorkflowDefinition] { WorkflowRegistry.all.filter { $0.roles.contains(role) } }
    private func grouped(_ c: WorkflowCategory) -> [WorkflowDefinition] {
        visible.filter { $0.category == c && WorkflowFilter.matches($0, query: search) }
    }

    private let catTitles: [(WorkflowCategory, String)] = [
        (.reports, "FIELD REPORTS"), (.patrol, "PATROL & SECURITY"),
        (.people, "PEOPLE & CASES"), (.civil, "CIVIL / ADMIN")]

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                searchField
                ForEach(catTitles, id: \.0) { cat, title in
                    let items = grouped(cat)
                    if !items.isEmpty {
                        SectionHeader(title: title)
                        LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 8) {
                            ForEach(items, id: \.id) { def in
                                NavigationLink { WorkflowRenderer(def: def, prefill: prefill) } label: { tile(def) }
                            }
                        }
                    }
                }
            }.padding(12)
        }
        .background(Theme.base)
        .navigationTitle("WORKFLOWS")
        .navigationBarTitleDisplayMode(.inline)
    }

    private var searchField: some View {
        HStack(spacing: 6) {
            Image(systemName: "magnifyingglass").font(.system(size: 12)).foregroundStyle(Theme.neutral)
            TextField("Search workflows…", text: $search)
                .font(.system(size: 13)).foregroundStyle(.white).autocorrectionDisabled()
            if !search.isEmpty {
                Button { search = "" } label: {
                    Image(systemName: "xmark.circle.fill").foregroundStyle(Theme.neutral)
                }
            }
        }
        .padding(8).background(Theme.raised).clipShape(RoundedRectangle(cornerRadius: Theme.radius))
    }

    private func tile(_ def: WorkflowDefinition) -> some View {
        VStack(spacing: 6) {
            Image(systemName: def.icon).font(.system(size: 24)).foregroundStyle(Theme.gold)
            Text(def.title).font(Theme.Typography.caption).fontWeight(.semibold).foregroundStyle(.white)
                .multilineTextAlignment(.center)
        }.frame(maxWidth: .infinity).padding(.vertical, 14).themeCard()
    }
}
