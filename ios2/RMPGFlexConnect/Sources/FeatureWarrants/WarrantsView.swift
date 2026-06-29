import SwiftUI
import DesignSystem

public struct WarrantsView: View {
    public init() {}

    public var body: some View {
        ZStack {
            RMPGTheme.baseBlack.ignoresSafeArea()
            VStack(spacing: 0) {
                PanelTitleBar(title: "Warrants", icon: "doc.text.magnifyingglass")
                RMPGDivider()
                Spacer()
                Text("Warrants module")
                    .font(.system(size: 12))
                    .foregroundColor(RMPGTheme.textMuted)
                Spacer()
            }
        }
    }
}
