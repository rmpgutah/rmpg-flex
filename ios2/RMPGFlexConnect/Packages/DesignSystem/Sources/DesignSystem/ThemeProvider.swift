import SwiftUI

/// Carries the current `ThemeMode` + resolved `ThemeColors` through the view tree.
public struct ThemeEnvironment: Equatable, Sendable {
    public var mode: ThemeMode
    public var colors: ThemeColors

    public static let nightDefault = ThemeEnvironment(mode: .night, colors: .night)
}

private struct ThemeEnvironmentKey: EnvironmentKey {
    static let defaultValue = ThemeEnvironment.nightDefault
}

public extension EnvironmentValues {
    var theme: ThemeEnvironment {
        get { self[ThemeEnvironmentKey.self] }
        set { self[ThemeEnvironmentKey.self] = newValue }
    }
}

/// Drop into the root of your app. Re-resolves on appear, on scenePhase change,
/// and on a 60-second timer (matches the web UserPreferencesContext ticker).
public struct ThemeProvider<Content: View>: View {
    @State private var env: ThemeEnvironment = .nightDefault
    @Environment(\.scenePhase) private var scenePhase
    private let timer = Timer.publish(every: 60, on: .main, in: .common).autoconnect()
    public let content: () -> Content

    public init(@ViewBuilder content: @escaping () -> Content) {
        self.content = content
    }

    public var body: some View {
        content()
            .environment(\.theme, env)
            .preferredColorScheme(env.mode == .night ? .dark : .light)
            .onAppear { refresh() }
            .onChange(of: scenePhase) { _, phase in if phase == .active { refresh() } }
            .onReceive(timer) { _ in refresh() }
    }

    private func refresh() {
        // M0: no manual override; pure schedule. Override storage lands in a later milestone.
        let mode = ThemeSchedule.resolveEffective(override: nil)
        env = ThemeEnvironment(mode: mode, colors: ThemeColors.tokens(for: mode))
    }
}
