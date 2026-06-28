import SwiftUI
import DesignSystem

public struct DailyActivityReportView: View {
    @State private var vm = DailyActivityReportViewModel()

    public init() {}

    public var body: some View {
        NavigationStack {
            List {
                Section("SHIFT SUMMARY") {
                    LabeledContent("Date", value: vm.dateString)
                    LabeledContent("Start", value: vm.shiftStart)
                    LabeledContent("End", value: vm.shiftEnd)
                    LabeledContent("Duration", value: vm.duration)
                    LabeledContent("Mileage", value: vm.mileage)
                }
                Section("CALLS") {
                    ForEach(vm.calls, id: \.self) { call in
                        Text(call)
                    }
                }
                Section("ACTIVITY") {
                    ForEach(vm.activities, id: \.self) { activity in
                        Text(activity)
                    }
                }
            }
            .navigationTitle("DAILY ACTIVITY REPORT")
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("EXPORT PDF") {
                        vm.exportPDF()
                    }
                }
            }
        }
    }
}

@Observable
final class DailyActivityReportViewModel {
    var dateString: String {
        let f = DateFormatter()
        f.dateFormat = "MM/dd/yyyy"
        return f.string(from: Date())
    }
    var shiftStart = "06:00"
    var shiftEnd = "18:00"
    var duration = "12h 00m"
    var mileage = "142 mi"
    var calls = ["10-91 · 123 Main St", "10-50 · I-15 MM 287", "10-54 · 456 Oak Ave"]
    var activities = ["Pre-trip inspection completed", "Unit 342 fuel-up", "Report filed #R-2026-0441"]

    func exportPDF() {}
}
