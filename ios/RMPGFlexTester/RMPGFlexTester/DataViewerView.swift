import SwiftUI

struct DataViewerView: View {
    private static let tables: [(name: String, sql: String)] = [
        ("calls_for_service",
         "SELECT id, call_number, call_type, status, created_at FROM calls_for_service ORDER BY id DESC LIMIT 25"),
        ("units",
         "SELECT id, unit_number, status, current_call_id FROM units ORDER BY id LIMIT 25"),
        ("persons",
         "SELECT id, first_name, last_name, dob FROM persons ORDER BY id DESC LIMIT 25"),
        ("warrants",
         "SELECT id, warrant_number, status, charge_description FROM warrants ORDER BY id DESC LIMIT 25"),
    ]

    @State private var selected = 0
    @State private var result: D1QueryResult?
    @State private var errorText: String?
    @State private var loading = false
    @State private var detail: D1QueryResult?

    var body: some View {
        NavigationStack {
            VStack(spacing: 8) {
                Picker("Table", selection: $selected) {
                    ForEach(Self.tables.indices, id: \.self) { i in
                        Text(Self.tables[i].name).tag(i)
                    }
                }
                .pickerStyle(.menu)
                .tint(Theme.gold)

                if loading { ProgressView().tint(Theme.gold) }
                if let errorText {
                    Text(errorText).font(.system(size: 11, design: .monospaced))
                        .foregroundStyle(Theme.red)
                }
                if let result {
                    ScrollView {
                        LazyVStack(spacing: 1) {
                            ForEach(Array(result.rows.enumerated()), id: \.offset) { _, row in
                                Button { Task { await loadDetail(rowId: row.first ?? "") } } label: {
                                    Text(row.joined(separator: " · "))
                                        .font(.system(size: 11, design: .monospaced))
                                        .lineLimit(1)
                                        .frame(maxWidth: .infinity, alignment: .leading)
                                        .padding(.vertical, 4).padding(.horizontal, 6)
                                        .background(Theme.raised)
                                }
                                .buttonStyle(.plain)
                            }
                        }
                    }
                }
                Spacer(minLength: 0)
            }
            .padding(12)
            .background(Theme.base)
            .navigationTitle("DATA VIEWER")
            .navigationBarTitleDisplayMode(.inline)
            .task(id: selected) { await load() }
            .sheet(isPresented: Binding(get: { detail != nil }, set: { if !$0 { detail = nil } })) {
                if let detail {
                    ScrollView {
                        VStack(alignment: .leading, spacing: 4) {
                            ForEach(Array(detail.columns.enumerated()), id: \.offset) { i, col in
                                HStack(alignment: .top) {
                                    Text(col).font(.system(size: 10, weight: .semibold))
                                        .foregroundStyle(Theme.gold)
                                        .frame(width: 130, alignment: .leading)
                                    Text(detail.rows.first?[i] ?? "")
                                        .font(.system(size: 11, design: .monospaced))
                                }
                            }
                        }
                        .padding()
                    }
                    .presentationBackground(Theme.base)
                }
            }
        }
    }

    @MainActor
    private func load() async {
        guard let client = AppConfig.d1Client() else {
            errorText = "Set Cloudflare credentials in Settings first."
            return
        }
        loading = true
        errorText = nil
        defer { loading = false }
        do { result = try await client.query(Self.tables[selected].sql) }
        catch { result = nil; errorText = error.localizedDescription }
    }

    @MainActor
    private func loadDetail(rowId: String) async {
        guard let client = AppConfig.d1Client(), !rowId.isEmpty else { return }
        // id values come straight from the table we just queried; numeric ids only.
        let table = Self.tables[selected].name
        guard rowId.allSatisfy({ $0.isNumber }) else { return }
        detail = try? await client.query("SELECT * FROM \(table) WHERE id = \(rowId)")
    }
}
