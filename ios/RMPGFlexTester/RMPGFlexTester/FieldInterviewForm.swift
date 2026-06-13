import SwiftUI

// Quick FI (field interview) card. Submits to POST /api/field-interviews;
// location auto-fills from GPS. Prefillable from a DL scan.
struct FieldInterviewForm: View {
    var prefill: [String: String] = [:]
    let onSubmit: ([String: Any], String) -> Void
    @Environment(\.dismiss) private var dismiss

    @State private var name = ""
    @State private var dob = ""
    @State private var location = ""
    @State private var narrative = ""

    var body: some View {
        NavigationStack {
            Form {
                Section("SUBJECT") {
                    TextField("Full name", text: $name)
                    TextField("DOB (YYYY-MM-DD)", text: $dob)
                }
                Section("CONTACT") {
                    TextField("Location (blank = my GPS)", text: $location)
                    TextEditor(text: $narrative).frame(height: 100)
                }
                Button("SUBMIT FI CARD") {
                    var body: [String: Any] = [
                        "date": ISO8601DateFormatter().string(from: Date()),
                        "narrative": narrative,
                    ]
                    // Backend FIELD_MAP only accepts subject_first_name /
                    // subject_last_name / subject_dob — anything else is
                    // silently dropped from the INSERT.
                    let parts = name.split(separator: " ")
                    if parts.count >= 2 {
                        body["subject_first_name"] = parts.dropLast().joined(separator: " ")
                        body["subject_last_name"] = String(parts.last!)
                    } else if !name.isEmpty {
                        body["subject_last_name"] = name
                    }
                    if !dob.isEmpty { body["subject_dob"] = dob }
                    if !location.isEmpty {
                        body["location"] = location
                    } else if let loc = LocationManager.shared.last {
                        body["latitude"] = loc.coordinate.latitude
                        body["longitude"] = loc.coordinate.longitude
                        body["location"] = String(format: "GPS %.5f, %.5f",
                                                  loc.coordinate.latitude, loc.coordinate.longitude)
                    }
                    onSubmit(body, "FI: \(name.isEmpty ? "unknown subject" : name)")
                    dismiss()
                }
                .fontWeight(.semibold)
                .disabled(name.isEmpty && narrative.isEmpty)
            }
            .scrollContentBackground(.hidden)
            .background(Theme.base)
            .navigationTitle("NEW FI CARD")
            .navigationBarTitleDisplayMode(.inline)
            .onAppear {
                name = prefill["name"] ?? ""
                dob = prefill["dob"] ?? ""
            }
        }
    }
}
