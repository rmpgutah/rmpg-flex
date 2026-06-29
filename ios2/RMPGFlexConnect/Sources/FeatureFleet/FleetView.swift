import SwiftUI
import DesignSystem

public struct FleetView: View {
    public init() {}

    public var body: some View {
        ZStack {
            RMPGTheme.baseBlack.ignoresSafeArea()
            VStack(spacing: 0) {
                PanelTitleBar(title: "Fleet", icon: "car.fill")
                RMPGDivider()
                Spacer()
                Text("Fleet management module")
                    .font(.system(size: 12))
                    .foregroundColor(RMPGTheme.textMuted)
                Spacer()
            }
        }
    }
}
