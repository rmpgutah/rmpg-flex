import SwiftUI

public struct PanelTitleBar: View {
    let title: String
    let icon: String

    public init(title: String, icon: String = "shield.fill") {
        self.title = title
        self.icon = icon
    }

    public var body: some View {
        HStack(spacing: 8) {
            Image(systemName: icon)
                .font(.system(size: 12, weight: .semibold))
                .foregroundColor(RMPGTheme.brandGold)
            Text(title.uppercased())
                .font(.system(size: 9, weight: .semibold))
                .foregroundColor(RMPGTheme.textPrimary)
                .tracking(1)
            Spacer()
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 6)
        .background(RMPGTheme.raisedSurface)
        .overlay(
            Rectangle()
                .frame(height: 1)
                .foregroundColor(RMPGTheme.brandGold),
            alignment: .bottom
        )
    }
}

public struct IconButton: View {
    let systemName: String
    let action: () -> Void
    let label: String

    public init(systemName: String, label: String, action: @escaping () -> Void) {
        self.systemName = systemName
        self.label = label
        self.action = action
    }

    public var body: some View {
        Button(action: action) {
            Image(systemName: systemName)
                .font(.system(size: 14))
                .foregroundColor(RMPGTheme.textSecondary)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(label)
    }
}

public struct StatusBadge: View {
    let text: String
    let color: Color

    public init(text: String, color: Color) {
        self.text = text
        self.color = color
    }

    public var body: some View {
        Text(text.uppercased())
            .font(.system(size: 8, weight: .bold))
            .foregroundColor(color)
            .padding(.horizontal, 6)
            .padding(.vertical, 2)
            .background(color.opacity(0.15))
            .cornerRadius(2)
    }

    public static func priority(_ p: String) -> StatusBadge {
        switch p {
        case "P1": return StatusBadge(text: p, color: RMPGTheme.statusRed)
        case "P2": return StatusBadge(text: p, color: RMPGTheme.statusOrange)
        case "P3": return StatusBadge(text: p, color: RMPGTheme.statusYellow)
        case "P4": return StatusBadge(text: p, color: RMPGTheme.statusGreen)
        default: return StatusBadge(text: p, color: RMPGTheme.neutralGray)
        }
    }
}

public struct RMPGTextField: View {
    let placeholder: String
    @Binding var text: String
    let keyboardType: UIKeyboardType

    public init(placeholder: String, text: Binding<String>, keyboardType: UIKeyboardType = .default) {
        self.placeholder = placeholder
        self._text = text
        self.keyboardType = keyboardType
    }

    public var body: some View {
        TextField(placeholder, text: $text)
            .textFieldStyle(.plain)
            .font(.system(size: 13))
            .foregroundColor(RMPGTheme.textPrimary)
            .padding(10)
            .background(RMPGTheme.sunkenSurface)
            .cornerRadius(2)
            .overlay(
                RoundedRectangle(cornerRadius: 2)
                    .stroke(RMPGTheme.borderSubtle, lineWidth: 1)
            )
            .keyboardType(keyboardType)
            .autocapitalization(.none)
            .autocorrectionDisabled()
    }
}

public struct RMPGSecureField: View {
    let placeholder: String
    @Binding var text: String

    public init(placeholder: String, text: Binding<String>) {
        self.placeholder = placeholder
        self._text = text
    }

    public var body: some View {
        SecureField(placeholder, text: $text)
            .textFieldStyle(.plain)
            .font(.system(size: 13))
            .foregroundColor(RMPGTheme.textPrimary)
            .padding(10)
            .background(RMPGTheme.sunkenSurface)
            .cornerRadius(2)
            .overlay(
                RoundedRectangle(cornerRadius: 2)
                    .stroke(RMPGTheme.borderSubtle, lineWidth: 1)
            )
    }
}

public struct RMPGPrimaryButton: View {
    let title: String
    let action: () -> Void
    let isLoading: Bool

    public init(title: String, isLoading: Bool = false, action: @escaping () -> Void) {
        self.title = title
        self.isLoading = isLoading
        self.action = action
    }

    public var body: some View {
        Button(action: action) {
            HStack(spacing: 8) {
                if isLoading {
                    ProgressView()
                        .progressViewStyle(CircularProgressViewStyle(tint: RMPGTheme.deepBlack))
                }
                Text(title)
                    .font(.system(size: 13, weight: .semibold))
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 12)
            .background(RMPGTheme.brandGold)
            .foregroundColor(RMPGTheme.deepBlack)
            .cornerRadius(2)
        }
        .disabled(isLoading)
    }
}

public struct RMPGDestructiveButton: View {
    let title: String
    let action: () -> Void

    public init(title: String, action: @escaping () -> Void) {
        self.title = title
        self.action = action
    }

    public var body: some View {
        Button(action: action) {
            Text(title)
                .font(.system(size: 13, weight: .semibold))
                .frame(maxWidth: .infinity)
                .padding(.vertical, 12)
                .background(RMPGTheme.statusRed.opacity(0.15))
                .foregroundColor(RMPGTheme.statusRed)
                .cornerRadius(2)
                .overlay(
                    RoundedRectangle(cornerRadius: 2)
                        .stroke(RMPGTheme.statusRed.opacity(0.3), lineWidth: 1)
                )
        }
    }
}

public struct RMPGDataRow: View {
    let label: String
    let value: String
    let accent: Color

    public init(label: String, value: String, accent: Color = RMPGTheme.textPrimary) {
        self.label = label
        self.value = value
        self.accent = accent
    }

    public var body: some View {
        HStack {
            Text(label)
                .font(.system(size: 11))
                .foregroundColor(RMPGTheme.textMuted)
            Spacer()
            Text(value)
                .font(.system(size: 11, weight: .medium))
                .foregroundColor(accent)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 3)
    }
}

public struct RMPGDivider: View {
    public init() {}
    public var body: some View {
        Rectangle()
            .frame(height: 1)
            .foregroundColor(RMPGTheme.borderSubtle)
    }
}
