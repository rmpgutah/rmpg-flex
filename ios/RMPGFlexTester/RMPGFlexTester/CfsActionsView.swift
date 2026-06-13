import SwiftUI

// The CFS Action Bus surface — runs any of the 100+ CfsActionLibrary actions on
// a call through the unified backend endpoint (POST /api/dispatch/calls/:id/
// action). MDT-flagged actions also push to the in-car terminal, so a phone
// action shows up on the vehicle MDT and the dispatch board together.
struct CfsActionsView: View {
    let callId: Int
    var callNumber: String = ""

    @Environment(\.dismiss) private var dismiss
    @State private var search = ""
    @State private var status: String?
    @State private var working = false
    @State private var noteAction: CfsAction?
    @State private var noteText = ""

    private var sections: [(String, [CfsAction])] {
        if !search.trimmingCharacters(in: .whitespaces).isEmpty {
            let r = CfsActionLibrary.search(search)
            return r.isEmpty ? [] : [("Results", r)]
        }
        return CfsActionLibrary.categories.map { ($0, CfsActionLibrary.inCategory($0)) }
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 10) {
                    HStack(spacing: 6) {
                        Image(systemName: "magnifyingglass").font(.system(size: 12)).foregroundStyle(Theme.neutral)
                        TextField("Search \(CfsActionLibrary.all.count) call actions…", text: $search)
                            .font(.system(size: 13)).autocorrectionDisabled().textInputAutocapitalization(.never)
                    }
                    .padding(8).background(Theme.raised).clipShape(RoundedRectangle(cornerRadius: Theme.radius))

                    if let status { StatusLine(text: status) }

                    ForEach(sections, id: \.0) { (cat, actions) in
                        VStack(alignment: .leading, spacing: 6) {
                            SectionHeader(title: cat)
                            LazyVGrid(columns: [GridItem(.adaptive(minimum: 106), spacing: 6)],
                                      alignment: .leading, spacing: 6) {
                                ForEach(actions) { a in
                                    Button { tap(a) } label: {
                                        Text(a.label).font(.system(size: 11, weight: .semibold))
                                            .multilineTextAlignment(.center)
                                            .frame(maxWidth: .infinity).padding(.vertical, 9).padding(.horizontal, 5)
                                            .background(background(a)).foregroundStyle(.white)
                                            .clipShape(RoundedRectangle(cornerRadius: Theme.radius))
                                    }
                                    .buttonStyle(.plain)
                                    .disabled(working)
                                }
                            }
                        }
                    }
                }
                .padding(12)
            }
            .background(Theme.base)
            .navigationTitle(callNumber.isEmpty ? "CALL ACTIONS" : "ACTIONS · \(callNumber)")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .topBarTrailing) { Button("Done") { dismiss() } } }
            .alert("Add Note", isPresented: Binding(get: { noteAction != nil }, set: { if !$0 { noteAction = nil } })) {
                TextField("Narrative note", text: $noteText)
                Button("Add") {
                    if let a = noteAction { var p = a.params; p["text"] = noteText; execute(a, params: p) }
                    noteText = ""; noteAction = nil
                }
                Button("Cancel", role: .cancel) { noteText = ""; noteAction = nil }
            }
        }
    }

    private func background(_ a: CfsAction) -> Color {
        switch a.category {
        case "Hazards": return Theme.red.opacity(0.85)
        case "Notify", "Resources": return Color(hex: 0x2a2417)   // warm tint
        default: return Theme.raised
        }
    }

    private func tap(_ a: CfsAction) {
        if a.needsInput { noteAction = a; return }
        execute(a, params: a.params)
    }

    private func execute(_ a: CfsAction, params: [String: String]) {
        Task { @MainActor in
            working = true; defer { working = false }
            Haptics.tap()
            var narrative: String?
            let err = await authedRetrying { c in
                let res = try await c.requestJSON("POST", "api/dispatch/calls/\(callId)/action",
                                                  body: ["action": a.id, "verb": a.verb, "params": params])
                narrative = (res as? [String: Any])?["narrative"] as? String
            }
            if let err { status = "✗ \(err.localizedDescription)"; return }
            status = "✓ \(narrative ?? a.label)"
            if a.mdt {
                _ = await MDTLink.shared.send(type: "cfs_action",
                                              payload: ["call_id": callId, "action": a.id, "label": a.label])
            }
        }
    }
}
