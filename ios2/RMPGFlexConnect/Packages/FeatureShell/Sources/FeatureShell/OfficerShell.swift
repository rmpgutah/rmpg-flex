import SwiftUI
import DesignSystem

public struct OfficerShell: View {
    public static let tabs: [TabSpec] = [
        TabSpec(id: "home",    title: "Home",    systemImage: "house.fill",            milestone: "M1"),
        TabSpec(id: "cfs",     title: "CFS",     systemImage: "list.bullet.rectangle", milestone: "M1"),
        TabSpec(id: "scan",    title: "Scan",    systemImage: "camera.viewfinder",     milestone: "M1"),
        TabSpec(id: "reports", title: "Reports", systemImage: "doc.text",              milestone: "M1"),
        TabSpec(id: "more",    title: "More",    systemImage: "ellipsis.circle",       milestone: "M1"),
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

public struct TabSpec: Identifiable, Equatable, Sendable {
    public let id: String
    public let title: String
    public let systemImage: String
    public let milestone: String
}
