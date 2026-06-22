import SwiftUI
import DesignSystem

public struct SupervisorShell: View {
    public static let tabs: [TabSpec] = [
        TabSpec(id: "command", title: "Command", systemImage: "shield.lefthalf.filled", milestone: "M2"),
        TabSpec(id: "units",   title: "Units",   systemImage: "mappin.and.ellipse",     milestone: "M2"),
        TabSpec(id: "cfs",     title: "CFS",     systemImage: "list.bullet.rectangle",  milestone: "M2"),
        TabSpec(id: "more",    title: "More",    systemImage: "ellipsis.circle",        milestone: "M2"),
    ]

    public init() {}

    public var body: some View {
        TabView {
            ForEach(Self.tabs) { tab in
                PlaceholderScreen(title: tab.title, milestone: tab.milestone)
                    .tabItem {
                        Label(tab.title, systemImage: tab.systemImage)
                    }
            }
        }
        .tint(ThemeColors.night.brandGold)
    }
}
