import SwiftUI
import DesignSystem

public struct CitationView: View {
    @State private var vm = CitationViewModel()
    @Environment(\.dismiss) private var dismiss

    public init() {}

    public var body: some View {
        NavigationStack {
            Form {
                Section("VIOLATOR") {
                    TextField("First Name", text: $vm.firstName)
                    TextField("Last Name", text: $vm.lastName)
                    TextField("DOB", text: $vm.dob)
                    TextField("DL#", text: $vm.dlNumber)
                    Picker("State", selection: $vm.dlState) { ForEach(["UT", "CO", "AZ", "NV", "ID", "WY"], id: \.self) { Text($0) } }
                }
                Section("VIOLATION") {
                    Picker("Type", selection: $vm.violationType) {
                        Text("Speeding (1-10 over)").tag("speeding_1_10")
                        Text("Speeding (11-20 over)").tag("speeding_11_20")
                        Text("Speeding (21+ over)").tag("speeding_21")
                        Text("Stop Sign / Light").tag("stop_sign")
                        Text("Seat Belt").tag("seat_belt")
                        Text("Expired Registration").tag("expired_reg")
                        Text("No Insurance").tag("no_insurance")
                        Text("Texting While Driving").tag("texting")
                        Text("Other").tag("other")
                    }
                    TextField("Location", text: $vm.location)
                    Stepper("Speed: \(vm.speed) mph", value: $vm.speed, in: 0...150)
                }
                Section("VEHICLE") {
                    TextField("Plate", text: $vm.plate)
                    TextField("Make / Model", text: $vm.vehicleInfo)
                    TextField("Color", text: $vm.color)
                }
                Section {
                    Toggle("Print Citation", isOn: $vm.printEnabled)
                }
            }
            .navigationTitle("CITATION")
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("ISSUE") {
                        Task { await vm.issue() }
                    }
                    .disabled(!vm.canSubmit)
                }
                ToolbarItem(placement: .cancellationAction) {
                    Button("CANCEL") { dismiss() }
                }
            }
            .overlay {
                if vm.isIssuing { ProgressView() }
            }
        }
    }
}

@Observable
final class CitationViewModel {
    var firstName = ""
    var lastName = ""
    var dob = ""
    var dlNumber = ""
    var dlState = "UT"
    var violationType = "speeding_1_10"
    var location = ""
    var speed = 0
    var plate = ""
    var vehicleInfo = ""
    var color = ""
    var printEnabled = true
    var isIssuing = false
    var error: String?

    var canSubmit: Bool { !firstName.isEmpty && !lastName.isEmpty && !location.isEmpty && !plate.isEmpty }

    func issue() async {
        isIssuing = true
        try? await Task.sleep(nanoseconds: 1_000_000_000)
        if printEnabled { await printCitation() }
        isIssuing = false
    }

    private func printCitation() async {
        guard let url = URL(string: "http://localhost:8787/api/print/citation") else { return }
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        let body: [String: Any] = [
            "violator": "\(firstName) \(lastName)",
            "violation": violationType,
            "location": location,
            "plate": plate
        ]
        request.httpBody = try? JSONSerialization.data(withJSONObject: body)
        try? await URLSession.shared.data(for: request)
    }
}
