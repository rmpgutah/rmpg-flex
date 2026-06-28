import SwiftUI
import UIKit

/// Walks the officer through binding a hardware panic trigger to the RMPG
/// "Panic" App Shortcut. iOS provides no deep link to the Back Tap / Action
/// Button panes, so this instructs + opens Settings; the officer sets the bind.
struct HardwarePanicSetupView: View {
    var body: some View {
        Form {
            Section("TRIPLE-TAP THE BACK") {
                step("1", "Settings → Accessibility → Touch → Back Tap")
                step("2", "Tap “Triple Tap”")
                step("3", "Choose Shortcuts → the “Panic” (RMPG) shortcut")
                Text("Triple-tap the back of the phone to fire a Priority-1 officer-assist — no screen, works in a pocket, even when the phone is locked.")
                    .font(Theme.Typography.caption).foregroundStyle(Theme.neutral)
            }
            Section("ACTION BUTTON") {
                step("1", "Settings → Action Button")
                step("2", "Swipe to “Shortcut”")
                step("3", "Pick the “Panic” (RMPG) shortcut")
                Text("One firm press of the Action button fires panic.")
                    .font(Theme.Typography.caption).foregroundStyle(Theme.neutral)
            }
            Section {
                Button("Open iOS Settings") {
                    if let url = URL(string: UIApplication.openSettingsURLString) {
                        UIApplication.shared.open(url)
                    }
                }
                .font(Theme.Typography.body).fontWeight(.semibold)
                Text("The “Panic” shortcut appears after the app has been installed through Xcode once (App Intents metadata extraction). If you don’t see it, ask the admin to run that build.")
                    .font(Theme.Typography.caption).foregroundStyle(Theme.neutral)
            }
        }
        .scrollContentBackground(.hidden).background(Theme.base)
        .navigationTitle("HARDWARE PANIC").navigationBarTitleDisplayMode(.inline)
    }

    private func step(_ n: String, _ text: String) -> some View {
        HStack(alignment: .top, spacing: Theme.Spacing.md) {
            Text(n).font(Theme.Typography.label).foregroundStyle(Theme.gold)
            Text(text).font(Theme.Typography.body).foregroundStyle(Theme.textPrimary)
        }
    }
}
