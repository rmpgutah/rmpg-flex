import SwiftUI
import WidgetKit

public struct ShiftStatusEntry: TimelineEntry {
    public let date: Date
    public let isOnDuty: Bool
    public let activeCFSCount: Int
    public let shiftDuration: String
    public let boloCount: Int

    public init(date: Date, isOnDuty: Bool, activeCFSCount: Int, shiftDuration: String, boloCount: Int) {
        self.date = date
        self.isOnDuty = isOnDuty
        self.activeCFSCount = activeCFSCount
        self.shiftDuration = shiftDuration
        self.boloCount = boloCount
    }

    public static let placeholder = ShiftStatusEntry(
        date: Date(), isOnDuty: true, activeCFSCount: 3,
        shiftDuration: "6h 42m", boloCount: 2
    )
}

public struct ShiftStatusSmallWidgetView: View {
    public let entry: ShiftStatusEntry

    public var body: some View {
        VStack(spacing: 4) {
            Image(systemName: entry.isOnDuty ? "car.fill" : "car.slash.fill")
                .font(.title2)
                .foregroundColor(entry.isOnDuty ? .green : .gray)
            Text(entry.isOnDuty ? "ON DUTY" : "OFF DUTY")
                .font(.caption).bold()
            Text(entry.shiftDuration)
                .font(.system(.title3, design: .monospaced))
            HStack(spacing: 8) {
                Label("\(entry.activeCFSCount)", systemImage: "exclamationmark.bubble")
                    .font(.caption2)
                Label("\(entry.boloCount)", systemImage: "eye")
                    .font(.caption2)
            }
            .foregroundColor(.secondary)
        }
        .containerBackground(.background, for: .widget)
    }
}

public struct ShiftStatusMediumWidgetView: View {
    public let entry: ShiftStatusEntry

    public var body: some View {
        HStack(spacing: 16) {
            VStack(alignment: .leading, spacing: 4) {
                Image(systemName: entry.isOnDuty ? "car.fill" : "car.slash.fill")
                    .foregroundColor(entry.isOnDuty ? .green : .gray)
                Text(entry.isOnDuty ? "ON DUTY" : "OFF DUTY")
                    .font(.headline)
                Text(entry.shiftDuration)
                    .font(.system(.title2, design: .monospaced))
            }
            Divider()
            VStack(alignment: .leading, spacing: 8) {
                Label("\(entry.activeCFSCount) Active Calls", systemImage: "exclamationmark.bubble")
                    .foregroundColor(entry.activeCFSCount > 0 ? .orange : .primary)
                Label("\(entry.boloCount) BOLOs", systemImage: "eye")
                    .foregroundColor(entry.boloCount > 0 ? .red : .primary)
            }
            .font(.subheadline)
        }
        .containerBackground(.background, for: .widget)
    }
}

public struct ShiftStatusLargeWidgetView: View {
    public let entry: ShiftStatusEntry
    public let lastAlerts: [String]

    public var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Image(systemName: entry.isOnDuty ? "car.fill" : "car.slash.fill")
                    .foregroundColor(entry.isOnDuty ? .green : .gray)
                Text(entry.isOnDuty ? "ON DUTY" : "OFF DUTY")
                    .font(.headline)
                Spacer()
                Text(entry.shiftDuration)
                    .font(.system(.caption, design: .monospaced))
            }
            HStack(spacing: 16) {
                Label("\(entry.activeCFSCount) Calls", systemImage: "exclamationmark.bubble")
                Label("\(entry.boloCount) BOLOs", systemImage: "eye")
            }
            .font(.subheadline)
            .foregroundColor(.secondary)

            Divider()
            Text("RECENT ALERTS").font(.caption).bold()
            ForEach(lastAlerts, id: \.self) { alert in
                Text("• \(alert)").font(.caption)
            }
        }
        .containerBackground(.background, for: .widget)
    }
}
