import SwiftUI

/// Persistent, scroll-proof critical-action bar for the responder surfaces.
/// Left: current unit status (tap → big-target slide-up picker). Right: PANIC.
/// `showStatus == false` collapses to a PANIC-only bar (off-duty / home).
struct ResponderActionBar: View {
    let currentStatus: String
    let statuses: [(String, String)]   // (value, label) — matches FieldOpsView.statuses
    var showStatus: Bool = true
    let onSelectStatus: (String) -> Void
    let onPanic: () -> Void

    @State private var showPicker = false

    var body: some View {
        HStack(spacing: Theme.Spacing.sm) {
            if showStatus {
                Button { Haptics.tap(); showPicker = true } label: {
                    VStack(alignment: .leading, spacing: 1) {
                        Text(statusLabel(currentStatus))
                            .font(Theme.Typography.headline).foregroundStyle(Theme.green)
                        Text("tap to change ▾")
                            .font(Theme.Typography.caption).foregroundStyle(Theme.neutral)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, Theme.Spacing.lg).padding(.vertical, Theme.Spacing.md)
                    .frame(minHeight: 52)
                    .background(Theme.raised)
                    .overlay(RoundedRectangle(cornerRadius: Theme.radius).stroke(Theme.border, lineWidth: 1))
                    .clipShape(RoundedRectangle(cornerRadius: Theme.radius))
                }
                .buttonStyle(.plain)
            }
            Button { onPanic() } label: {
                Text("⚠ PANIC")
                    .font(.system(size: 16, weight: .heavy))
                    .frame(maxWidth: showStatus ? 120 : .infinity, minHeight: 52)
                    .background(Theme.red).foregroundStyle(.white)
                    .clipShape(RoundedRectangle(cornerRadius: Theme.radius))
            }
            .buttonStyle(.plain)
        }
        .padding(.horizontal, Theme.Spacing.lg).padding(.vertical, Theme.Spacing.md)
        .background(Theme.sunken)
        .overlay(Rectangle().fill(Theme.borderStrong).frame(height: 1), alignment: .top)
        .sheet(isPresented: $showPicker) {
            statusPicker
                .presentationDetents([.height(CGFloat(statuses.count * 62 + 96))])
                .presentationBackground(Theme.base)
        }
    }

    private var statusPicker: some View {
        VStack(alignment: .leading, spacing: Theme.Spacing.sm) {
            Text("SET UNIT STATUS")
                .font(Theme.Typography.label).foregroundStyle(Theme.neutral)
                .padding(.top, Theme.Spacing.xl)
            ForEach(statuses, id: \.0) { value, label in
                Button {
                    Haptics.tap(); onSelectStatus(value); showPicker = false
                } label: {
                    HStack {
                        Text(label).font(Theme.Typography.headline)
                        Spacer()
                        if value == currentStatus { Image(systemName: "checkmark") }
                    }
                    .foregroundStyle(value == currentStatus ? Color.black : Color.white)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, Theme.Spacing.lg).frame(minHeight: 50)
                    .background(value == currentStatus ? Theme.gold : Theme.raised)
                    .overlay(RoundedRectangle(cornerRadius: Theme.radius).stroke(Theme.border, lineWidth: 1))
                    .clipShape(RoundedRectangle(cornerRadius: Theme.radius))
                }
                .buttonStyle(.plain)
            }
            Spacer()
        }
        .padding(.horizontal, Theme.Spacing.lg)
    }

    private func statusLabel(_ value: String) -> String {
        statuses.first { $0.0 == value }?.1 ?? value.uppercased()
    }
}
