import SwiftUI

// The categorized DVIR form — renders one Form Section per inspection category,
// each item a Pass / Defect / N/A control with severity + defect note. Embed
// directly inside a Form (it produces Sections). Logic lives in
// VehicleInspection.swift; this is pure presentation over a [InspectionLine] binding.
struct VehicleInspectionForm: View {
    @Binding var lines: [InspectionLine]

    private var defectCount: Int { VehicleInspection.defects(lines).count }
    private var oos: Bool { VehicleInspection.isOutOfService(lines) }

    var body: some View {
        Section {
            HStack(spacing: 8) {
                Image(systemName: oos ? "exclamationmark.octagon.fill" : (defectCount > 0 ? "wrench.adjustable.fill" : "checkmark.seal.fill"))
                    .foregroundStyle(oos ? Theme.red : (defectCount > 0 ? Theme.orange : Theme.green))
                Text(oos ? "OUT OF SERVICE — critical defect"
                     : defectCount > 0 ? "\(defectCount) defect\(defectCount > 1 ? "s" : "") noted"
                     : "All items pass")
                    .font(.system(size: 12, weight: .semibold))
                Spacer()
            }
        }
        ForEach(VehicleInspection.categories, id: \.self) { cat in
            Section(cat.uppercased()) {
                ForEach($lines) { $line in
                    if line.category == cat { InspectionRow(line: $line) }
                }
            }
        }
    }
}

private struct InspectionRow: View {
    @Binding var line: InspectionLine

    var body: some View {
        VStack(alignment: .leading, spacing: 5) {
            HStack(spacing: 5) {
                Text(line.label).font(.system(size: 13)).foregroundStyle(.white)
                if line.critical {
                    Image(systemName: "exclamationmark.shield.fill").font(.system(size: 10)).foregroundStyle(Theme.orange)
                }
                Spacer()
            }
            Picker("", selection: $line.status) {
                ForEach(InspItemStatus.allCases, id: \.self) { Text($0.label).tag($0) }
            }
            .pickerStyle(.segmented)
            .onChange(of: line.status) { _, s in
                // A defect on a safety-critical item defaults to OOS severity.
                if s == .defect && line.critical { line.severity = .critical }
            }
            if line.status == .defect {
                Picker("Severity", selection: $line.severity) {
                    ForEach(DefectSeverity.allCases, id: \.self) { Text($0.label).tag($0) }
                }
                .pickerStyle(.menu).font(.system(size: 11)).tint(line.severity.oos ? Theme.red : Theme.gold)
                TextField("Describe the defect", text: $line.note).font(.system(size: 12))
            }
        }
        .listRowBackground(line.status == .defect
                           ? (line.severity == .critical ? Theme.red.opacity(0.22) : Theme.raised)
                           : Color.clear)
    }
}
