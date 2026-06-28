import SwiftUI

// PersonSearchView — manual person lookup (name or phone) for when there's no ID
// to scan. GET /api/records/persons/search?q=… → tap a result to open the full
// field dossier (SubjectRecordsView: system-history + intel cross-hit screen with
// warrants / jail / watchlist). Complements the scan-based flow in ID Scan.
struct PersonSearchView: View {
    @State private var queryText = ""
    @State private var results: [[String: Any]] = []
    @State private var searching = false
    @State private var searched = false
    @State private var status: String?
    @FocusState private var focused: Bool

    var body: some View {
        ScrollView {
            VStack(spacing: 8) {
                searchField
                if searching {
                    ProgressView().tint(Theme.gold).padding(.top, 24)
                } else if searched && results.isEmpty {
                    EmptyState(icon: "person.fill.questionmark", title: "No matches.").padding(.top, 24)
                } else {
                    ForEach(results.indices, id: \.self) { i in resultRow(results[i]) }
                }
                if let status { StatusLine(text: status) }
            }
            .padding(12)
        }
        .background(Theme.base)
        .navigationTitle("PERSON LOOKUP")
        .navigationBarTitleDisplayMode(.inline)
        .task { focused = true }
    }

    private var searchField: some View {
        HStack(spacing: 8) {
            Image(systemName: "magnifyingglass").foregroundStyle(Theme.neutral)
            TextField("Last name, first name, or phone", text: $queryText)
                .focused($focused)
                .autocorrectionDisabled()
                .textInputAutocapitalization(.words)
                .submitLabel(.search)
                .foregroundStyle(.white)
                .onSubmit { Task { await search() } }
            if !queryText.isEmpty {
                Button { queryText = ""; results = []; searched = false } label: {
                    Image(systemName: "xmark.circle.fill").foregroundStyle(Theme.neutral)
                }
            }
        }
        .padding(.horizontal, 12).padding(.vertical, 10)
        .background(Theme.sunken)
        .overlay(RoundedRectangle(cornerRadius: Theme.radius).stroke(Theme.border, lineWidth: 1))
        .clipShape(RoundedRectangle(cornerRadius: Theme.radius))
    }

    @ViewBuilder
    private func resultRow(_ p: [String: Any]) -> some View {
        let id = p["id"] as? Int ?? 0
        let first = (p["first_name"] as? String) ?? ""
        let last = (p["last_name"] as? String) ?? ""
        let display = [first, last].filter { !$0.isEmpty }.joined(separator: " ")
        let name = display.isEmpty ? "Unknown" : display
        let dob = FieldFormat.prettyDate("\(p["dob"] ?? "")")
        let phone = p["phone"] as? String

        NavigationLink {
            SubjectRecordsView(personId: id, displayName: name)
        } label: {
            HStack(spacing: 10) {
                Image(systemName: "person.crop.circle").font(Theme.Typography.title).foregroundStyle(Theme.gold)
                VStack(alignment: .leading, spacing: 2) {
                    Text("\(last.uppercased())\(last.isEmpty || first.isEmpty ? "" : ", ")\(first)")
                        .font(Theme.Typography.body).fontWeight(.semibold).foregroundStyle(.white)
                    HStack(spacing: 8) {
                        if let dob { Text("DOB \(dob)").font(.system(size: 10)).foregroundStyle(Theme.neutral) }
                        if let phone, !phone.isEmpty { Text(phone).font(.system(size: 10)).foregroundStyle(Theme.neutral) }
                    }
                }
                Spacer()
                Image(systemName: "chevron.right").font(.system(size: 11, weight: .semibold)).foregroundStyle(Theme.neutral)
            }
            .themeCard()
        }
        .buttonStyle(.plain)
    }

    @MainActor
    private func search() async {
        let q = queryText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard q.count >= 2 else { status = "Enter at least 2 characters"; return }
        searching = true; status = nil; defer { searching = false }
        guard let c = await ShiftNet.client(), c.jwt != nil else {
            status = "✗ Set RMPG credentials in Settings"; return
        }
        let enc = q.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? q
        do {
            let any = try await c.requestJSON("GET", "api/records/persons/search?q=\(enc)")
            results = (any as? [[String: Any]]) ?? ((any as? [String: Any])?["data"] as? [[String: Any]]) ?? []
            searched = true
        } catch {
            status = "✗ \(error.localizedDescription)"
        }
    }
}
