import SwiftUI
import DesignSystem
import FeatureQuickActions

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
            HomeTabRoot()
                .tabItem { Label("Home", systemImage: "house.fill") }
            ForEach(Self.tabs.dropFirst()) { tab in
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

    public init(id: String, title: String, systemImage: String, milestone: String) {
        self.id = id
        self.title = title
        self.systemImage = systemImage
        self.milestone = milestone
    }
}

/// The Home tab wraps `PlaceholderScreen` in a `NavigationStack` so we can
/// host a toolbar with the "+" Quick Actions launcher.
struct HomeTabRoot: View {
    @State private var showQuickActions = false
    @Environment(\.theme) private var theme

    var body: some View {
        NavigationStack {
            PlaceholderScreen(title: "Home", milestone: "M1")
                .toolbar {
                    #if os(iOS)
                    ToolbarItem(placement: .topBarTrailing) {
                        Button {
                            showQuickActions = true
                        } label: {
                            Image(systemName: "plus.circle.fill")
                                .font(.title3)
                                .foregroundStyle(theme.colors.brandGold)
                        }
                        .accessibilityLabel("Quick Actions")
                    }
                    #else
                    ToolbarItem(placement: .automatic) {
                        Button {
                            showQuickActions = true
                        } label: {
                            Image(systemName: "plus.circle.fill")
                                .font(.title3)
                                .foregroundStyle(theme.colors.brandGold)
                        }
                        .accessibilityLabel("Quick Actions")
                    }
                    #endif
                }
                .sheet(isPresented: $showQuickActions) {
                    QuickActionsSheetView()
                        .presentationDetents([.medium, .large])
                        .presentationDragIndicator(.visible)
                }
        }
    }
}
