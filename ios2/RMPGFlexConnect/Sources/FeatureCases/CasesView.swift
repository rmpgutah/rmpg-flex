import SwiftUI
import DesignSystem

public struct CasesView: View {
    public init() {}

    public var body: some View {
        ZStack {
            RMPGTheme.baseBlack.ignoresSafeArea()
            VStack(spacing: 0) {
                PanelTitleBar(title: "Cases", icon: "briefcase.fill")
                RMPGDivider()
                Spacer()
                Text("Case management module")
                    .font(.system(size: 12))
                    .foregroundColor(RMPGTheme.textMuted)
                Spacer()
            }
        }
    }
}
