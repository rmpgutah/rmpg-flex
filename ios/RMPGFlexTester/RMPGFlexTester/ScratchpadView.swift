import SwiftUI

// Per-shift field scratchpad. Notes persist locally (survive app kills and
// dead zones); ATTACH appends the pad to the active call's notes on the
// dispatch board, then clears. Calc results flow in via "ADD TO SCRATCHPAD"
// on any toolkit result sheet — skid tables, sun times, measurements land
// here and ride to the call record.
enum ScratchpadStore {
    private static let key = "rmpg-field-scratchpad"

    static var text: String {
        get { UserDefaults.standard.string(forKey: key) ?? "" }
        set { UserDefaults.standard.set(newValue, forKey: key) }
    }

    /// Append a timestamped block (used by toolkit result sheets).
    static func append(_ block: String) {
        let fmt = DateFormatter()
        fmt.dateFormat = "HH:mm"
        let stamped = "[\(fmt.string(from: Date()))] \(block)"
        text = text.isEmpty ? stamped : text + "\n\n" + stamped
    }
}

struct ScratchpadView: View {
    @Environment(\.dismiss) private var dismiss
    @State private var text = ScratchpadStore.text
    @State private var status: String?
    @State private var busy = false

    var body: some View {
        NavigationStack {
            VStack(spacing: 8) {
                TextEditor(text: $text)
                    .font(.system(size: 13, design: .monospaced))
                    .foregroundStyle(.white)
                    .scrollContentBackground(.hidden)
                    .padding(6)
                    .background(Theme.sunken)
                    .clipShape(RoundedRectangle(cornerRadius: Theme.radius))
                    .onChange(of: text) { _, new in ScratchpadStore.text = new }

                if let status { StatusLine(text: status) }

                Button(busy ? "ATTACHING…" : "ATTACH TO MY CALL & CLEAR") {
                    Task { await attach() }
                }
                .buttonStyle(GoldButtonStyle())
                .disabled(busy || text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)

                Button("CLEAR PAD") { text = ""; ScratchpadStore.text = ""; status = nil }
                    .buttonStyle(RaisedButtonStyle())
                    .disabled(text.isEmpty)
            }
            .padding(12)
            .background(Theme.base)
            .navigationTitle("CALL SCRATCHPAD")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { Button("Done") { dismiss() } }
        }
    }

    @MainActor
    private func attach() async {
        busy = true; defer { busy = false }
        guard let client = await ShiftNet.client(), client.jwt != nil else {
            status = "✗ Not logged in — set RMPG credentials in Settings"; return
        }
        let state = try? await client.requestJSON("GET", "api/dispatch/duty/me")
        guard let callId = ((state as? [String: Any])?["unit"] as? [String: Any])?["current_call_id"] as? Int else {
            status = "✗ No active call on your unit — pad kept locally"; return
        }
        do {
            // PUT replaces the notes column — read current notes and append
            // so dispatcher/officer notes already on the call survive.
            let call = try? await client.requestJSON("GET", "api/dispatch/calls/\(callId)")
            let existing = ((call as? [String: Any])?["notes"] as? String)
                ?? (((call as? [String: Any])?["call"] as? [String: Any])?["notes"] as? String) ?? ""
            let merged = (existing.isEmpty ? "" : existing + "\n\n") + "FIELD NOTES:\n" + text
            try await client.requestJSON("PUT", "api/dispatch/calls/\(callId)",
                                         body: ["notes": merged])
            text = ""; ScratchpadStore.text = ""
            status = "✓ Attached to call #\(callId) and cleared"
        } catch {
            status = "✗ Attach failed (pad kept): \(error.localizedDescription)"
        }
    }
}
