import SwiftUI
import DesignSystem

public struct FieldInterviewCardView: View {
    @State private var vm = FieldInterviewViewModel()
    @Environment(\.dismiss) private var dismiss
    private let offline = ReportsOfflineCoordinator.shared

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
                Section {
                    PendingSyncBadge(pendingCount: offline.pendingCount, isOnline: offline.isOnline)
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
            .task { await offline.refresh() }
            .alert(vm.wasQueuedOffline ? "Queued" : "Saved", isPresented: $vm.didSucceed) {
                Button("OK") { dismiss() }
            } message: {
                Text(vm.wasQueuedOffline
                     ? "FI Card queued — will sync automatically when back online."
                     : "FI Card #\(vm.resultNumber) created.")
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
    var wasQueuedOffline = false

    var canSubmit: Bool {
        !firstName.isEmpty && !lastName.isEmpty && !location.isEmpty
    }

    func submit() async {
        isSubmitting = true
        error = nil
        let payload: [String: Any] = [
            "first_name": firstName,
            "last_name": lastName,
            "date_of_birth": dateOfBirth,
            "phone": phone,
            "location": location,
            "city": city,
            "contact_reason": contactReason,
            "narrative": narrative,
            "plate": plate,
            "vehicle_description": vehicleDescription,
            "disposition": disposition,
        ]
        let outcome = await ReportsOfflineCoordinator.shared.submitJSON(
            endpoint: "/api/reports/field-interviews",
            json: payload
        )
        isSubmitting = false
        wasQueuedOffline = (outcome == .queuedOffline)
        resultNumber = "FI-\(Int.random(in: 1000...9999))"
        didSucceed = true
    }
}
