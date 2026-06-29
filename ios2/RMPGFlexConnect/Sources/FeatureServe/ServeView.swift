import SwiftUI
import DesignSystem

public struct ServeView: View {
    public init() {}

    public var body: some View {
        ZStack {
            RMPGTheme.baseBlack.ignoresSafeArea()
            VStack(spacing: 0) {
                PanelTitleBar(title: "Process Serve", icon: "envelope.fill")
                RMPGDivider()
                Spacer()
                Text("Process service module")
                    .font(.system(size: 12))
                    .foregroundColor(RMPGTheme.textMuted)
                Spacer()
            }
        }
    }
}
