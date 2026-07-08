import SwiftUI
import DesignSystem
import FeatureCFS

public struct StandByDashboardView: View {
    @Environment(\.theme) private var theme
    let callCount: Int
    let onDuty: Bool
    let shiftDuration: String

    public init(callCount: Int, onDuty: Bool, shiftDuration: String) {
        self.callCount = callCount
        self.onDuty = onDuty
        self.shiftDuration = shiftDuration
    }

    public var body: some View {
        HStack(spacing: 16) {
            VStack(alignment: .leading, spacing: 8) {
                Image(systemName: onDuty ? "car.fill" : "car.slash.fill")
                    .font(.title)
                    .foregroundColor(onDuty ? .green : .gray)
                Text(onDuty ? "ON DUTY" : "OFF DUTY")
                    .font(.headline)
                Text(shiftDuration)
                    .font(.system(.body, design: .monospaced))
            }

            Divider()

            VStack(alignment: .trailing, spacing: 8) {
                Text("CALLS")
                    .font(.caption).foregroundColor(.secondary)
                Text("\(callCount)")
                    .font(.system(size: 48, design: .monospaced)).bold()
                    .foregroundColor(callCount > 0 ? .orange : .green)
            }
        }
        .padding()
        .background(theme.colors.surfaceRaised)
        .cornerRadius(2)
    }
}

public class StandByManager {
    public static func configureStandBy() {
        #if os(iOS)
        if #available(iOS 17.0, *) {
            NotificationCenter.default.addObserver(
                forName: UIApplication.didEnterBackgroundNotification,
                object: nil, queue: .main
            ) { _ in }
        }
        #endif
    }
}
