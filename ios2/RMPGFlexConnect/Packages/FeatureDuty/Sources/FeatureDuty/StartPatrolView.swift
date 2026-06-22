import SwiftUI
import DesignSystem

@MainActor
public struct StartPatrolView: View {
    @Environment(\.theme) private var theme
    @Environment(\.dismiss) private var dismiss
    @Bindable public var dutyState: DutyState
    @State private var unitID: String = ""
    @State private var error: String?

    public init(dutyState: DutyState) {
        self.dutyState = dutyState
    }

    public var body: some View {
        ZStack {
            theme.colors.surfaceBase.ignoresSafeArea()
            VStack(spacing: 24) {
                Spacer().frame(height: 30)

                Image(systemName: "car.fill")
                    .font(.system(size: 56, weight: .medium))
                    .foregroundStyle(theme.colors.brandGold)

                Text(dutyState.isOnDuty ? "ON DUTY" : "START PATROL")
                    .font(.title2.weight(.bold))
                    .tracking(2)
                    .foregroundStyle(theme.colors.brandGold)

                if dutyState.isOnDuty {
                    VStack(spacing: 6) {
                        Text("Unit \(dutyState.unitID)")
                            .font(.title3)
                            .foregroundStyle(theme.colors.textPrimary)
                        Text("Shift elapsed: \(formattedElapsed)")
                            .font(.callout.monospacedDigit())
                            .foregroundStyle(theme.colors.textSecondary)
                    }
                } else {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("UNIT ID")
                            .font(.caption2)
                            .tracking(0.5)
                            .foregroundStyle(theme.colors.textSecondary)
                        TextField("e.g. 219", text: $unitID)
                            .padding(10)
                            .background(theme.colors.surfaceRaised)
                            .foregroundStyle(theme.colors.textPrimary)
                            .clipShape(RoundedRectangle(cornerRadius: 2))
                            #if os(iOS)
                            .keyboardType(.numberPad)
                            #endif
                    }
                    .padding(.horizontal, 32)
                }

                if let error {
                    Text(error)
                        .font(.footnote)
                        .foregroundStyle(theme.colors.critical)
                        .padding(.horizontal, 24)
                }

                Spacer()

                Button {
                    if dutyState.isOnDuty {
                        dutyState.clockOff()
                        dismiss()
                    } else {
                        guard !unitID.trimmingCharacters(in: .whitespaces).isEmpty else {
                            error = "Unit ID is required."
                            return
                        }
                        dutyState.clockOn(unitID: unitID)
                        dismiss()
                    }
                } label: {
                    Text(dutyState.isOnDuty ? "CLOCK OFF" : "CLOCK ON")
                        .font(.headline)
                        .tracking(1)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 14)
                        .background(dutyState.isOnDuty ? theme.colors.critical : theme.colors.brandGold)
                        .foregroundStyle(theme.colors.surfaceBase)
                        .clipShape(RoundedRectangle(cornerRadius: 2))
                }
                .padding(.horizontal, 32)
                .padding(.bottom, 32)
            }
        }
    }

    private var formattedElapsed: String {
        let s = Int(dutyState.elapsedSinceShiftStart())
        let h = s / 3600
        let m = (s % 3600) / 60
        return String(format: "%02d:%02d", h, m)
    }
}
