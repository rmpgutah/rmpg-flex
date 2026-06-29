import SwiftUI
import DesignSystem

public struct IncidentsView: View {
    public init() {}

    public var body: some View {
        ZStack {
            RMPGTheme.baseBlack.ignoresSafeArea()
            VStack(spacing: 0) {
                PanelTitleBar(title: "Incidents", icon: "doc.text.fill")
                RMPGDivider()
                Spacer()
                Text("Incident reports module")
                    .font(.system(size: 12))
                    .foregroundColor(RMPGTheme.textMuted)
                Spacer()
            }
        }
    }
}
