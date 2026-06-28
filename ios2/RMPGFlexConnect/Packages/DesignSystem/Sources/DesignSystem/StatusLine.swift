import SwiftUI

/// Reusable label/value row. Used heavily in Home (M1) and Settings (M0+).
public struct StatusLine: View {
    @Environment(\.theme) private var theme
    public let label: String
    public let value: String
    public let valueColor: Color?

    public init(label: String, value: String, valueColor: Color? = nil) {
        self.label = label
        self.value = value
        self.valueColor = valueColor
    }

    public var body: some View {
        HStack {
            Text(label.uppercased())
                .font(.caption2)
                .tracking(0.5)
                .foregroundStyle(theme.colors.textSecondary)
            Spacer()
            Text(value)
                .font(.callout.monospacedDigit())
                .foregroundStyle(valueColor ?? theme.colors.textPrimary)
        }
        .padding(.vertical, 4)
    }
}
