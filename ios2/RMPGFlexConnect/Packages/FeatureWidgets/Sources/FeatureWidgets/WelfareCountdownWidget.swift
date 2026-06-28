import SwiftUI
import WidgetKit

public struct WelfareCountdownEntry: TimelineEntry {
    public let date: Date
    public let remainingMinutes: Int
    public let unitCallSign: String

    public init(date: Date, remainingMinutes: Int, unitCallSign: String) {
        self.date = date
        self.remainingMinutes = remainingMinutes
        self.unitCallSign = unitCallSign
    }
}

public struct WelfareCountdownLockScreenView: View {
    public let entry: WelfareCountdownEntry

    public var body: some View {
        ZStack {
            Circle()
                .stroke(remainingColor.opacity(0.3), lineWidth: 4)
            Circle()
                .trim(from: 0, to: progress)
                .stroke(remainingColor, lineWidth: 4)
                .rotationEffect(.degrees(-90))
            VStack(spacing: 0) {
                Text("\(entry.remainingMinutes)")
                    .font(.system(.title, design: .monospaced).bold())
                Text("min")
                    .font(.caption2)
            }
        }
        .containerBackground(.background, for: .widget)
    }

    private var remainingColor: Color {
        if entry.remainingMinutes > 5 { return .green }
        if entry.remainingMinutes > 2 { return .yellow }
        return .red
    }

    private var progress: CGFloat {
        CGFloat(max(0, min(1, Double(entry.remainingMinutes) / 15.0)))
    }
}
