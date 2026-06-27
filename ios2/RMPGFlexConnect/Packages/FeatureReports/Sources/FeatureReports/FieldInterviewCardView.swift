import SwiftUI
import DesignSystem

public struct FieldInterviewCardView: View {
    @State private var vm = FieldInterviewViewModel()
    @Environment(\.dismiss) private var dismiss

    public init() {}

    public var body: some View {
        NavigationStack {
            Form {
                Section("SUBJECT") {
                    TextField("First Name", text: $vm.firstName)
                    TextField("Last Name", text: $vm.lastName)
                    TextField("DOB (MM/DD/YYYY)", text: $vm.dateOfBirth)
                    TextField("Phone", text: $vm.phone)
                }
                Section("LOCATION") {
                    TextField("Address / Intersection", text: $vm.location)
                    TextField("City", text: $vm.city)
                }
                Section("CONTACT") {
                    TextEditor(text: $vm.contactReason)
                        .frame(minHeight: 80)
                    TextField("Narrative", text: $vm.narrative)
                }
                Section("VEHICLE") {
                    TextField("Plate", text: $vm.plate)
                    TextField("Make / Model / Year", text: $vm.vehicleDescription)
                }
                Section("OUTCOME") {
                    Picker("Disposition", selection: $vm.disposition) {
                        Text("Field Contact").tag("field_contact")
                        Text("Verbal Warning").tag("verbal_warning")
                        Text("Citation").tag("citation")
                        Text("Arrest").tag("arrest")
                        Text("No Action").tag("no_action")
                    }
                }
            }
            .navigationTitle("FIELD INTERVIEW")
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("SAVE") {
                        Task { await vm.submit() }
                    }
                    .disabled(!vm.canSubmit)
                }
                ToolbarItem(placement: .cancellationAction) {
                    Button("CANCEL") { dismiss() }
                }
            }
            .overlay {
                if vm.isSubmitting { ProgressView() }
            }
            .alert("Saved", isPresented: $vm.didSucceed) {
                Button("OK") { dismiss() }
            } message: {
                Text("FI Card #\(vm.resultNumber) created.")
            }
            .alert("Error", isPresented: .init(
                get: { vm.error != nil },
                set: { if !$0 { vm.error = nil } }
            )) {
                Button("OK") { vm.error = nil }
            } message: {
                Text(vm.error ?? "")
            }
        }
    }
}

@Observable
final class FieldInterviewViewModel {
    var firstName = ""
    var lastName = ""
    var dateOfBirth = ""
    var phone = ""
    var location = ""
    var city = ""
    var contactReason = ""
    var narrative = ""
    var plate = ""
    var vehicleDescription = ""
    var disposition = "field_contact"
    var isSubmitting = false
    var error: String?
    var didSucceed = false
    var resultNumber = ""

    var canSubmit: Bool {
        !firstName.isEmpty && !lastName.isEmpty && !location.isEmpty
    }

    func submit() async {
        isSubmitting = true
        error = nil
        try? await Task.sleep(nanoseconds: 500_000_000)
        isSubmitting = false
        resultNumber = "FI-\(Int.random(in: 1000...9999))"
        didSucceed = true
    }
}
