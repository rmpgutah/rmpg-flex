import SwiftUI
import DesignSystem

public struct PreTripInspectionView: View {
    @State private var items: [InspectionItem] = [
        InspectionItem(name: "Tires (pressure/condition)", passed: false),
        InspectionItem(name: "Brakes", passed: false),
        InspectionItem(name: "Lights (head/tail/signal)", passed: false),
        InspectionItem(name: "Sirens & Emergency Lights", passed: false),
        InspectionItem(name: "Fuel Level", passed: false),
        InspectionItem(name: "Radio / MDT", passed: false),
        InspectionItem(name: "Camera System", passed: false),
        InspectionItem(name: "Shotgun / Rifle Secured", passed: false),
        InspectionItem(name: "First Aid Kit Present", passed: false),
        InspectionItem(name: "Fire Extinguisher", passed: false),
    ]
    @State private var odometer = ""
    @State private var notes = ""
    @State private var isComplete = false
    @Environment(\.dismiss) private var dismiss

    public init() {}

    public var body: some View {
        NavigationStack {
            Form {
                Section("ODOMETER") {
                    TextField("Current Odometer Reading", text: $odometer)
                        .keyboardType(.numberPad)
                }
                Section("INSPECTION ITEMS") {
                    ForEach($items) { $item in
                        Toggle(item.name, isOn: $item.passed)
                    }
                }
                Section("NOTES") {
                    TextEditor(text: $notes).frame(minHeight: 60)
                }
            }
            .navigationTitle("PRE-TRIP INSPECTION")
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("COMPLETE") {
                        isComplete = true
                        DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { dismiss() }
                    }
                    .disabled(!items.allSatisfy(\.passed))
                }
                ToolbarItem(placement: .cancellationAction) {
                    Button("CANCEL") { dismiss() }
                }
            }
            .alert("Inspection Complete", isPresented: $isComplete) {
                Button("OK") {}
            } message: {
                let passed = items.filter(\.passed).count
                Text("\(passed)/\(items.count) items passed")
            }
        }
    }
}

struct InspectionItem: Identifiable {
    let id = UUID()
    let name: String
    var passed: Bool
}
