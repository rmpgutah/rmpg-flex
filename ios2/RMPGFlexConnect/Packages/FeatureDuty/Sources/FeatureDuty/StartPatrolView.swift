import SwiftUI
import DesignSystem
import CoreAPI

@MainActor
public struct StartPatrolView: View {
    @Environment(\.theme) private var theme
    @Environment(\.dismiss) private var dismiss
    @Bindable public var dutyState: DutyState

    @State private var isBusy = false
    @State private var error: String?

    private let api: DutyAPI

    public init(dutyState: DutyState, apiClient: APIClient) {
        self.dutyState = dutyState
        self.api = DutyAPI(client: apiClient)
    }

    public var body: some View {
        ZStack {
            theme.colors.surfaceBase.ignoresSafeArea()
            VStack(spacing: 28) {
                Spacer().frame(height: 24)

                ZStack {
                    Circle()
                        .fill(dutyState.isOnDuty ? theme.colors.success.opacity(0.12) : theme.colors.brandGold.opacity(0.1))
                        .frame(width: 88, height: 88)
                    Image(systemName: dutyState.isOnDuty ? "shield.fill" : "car.fill")
                        .font(.system(size: 40, weight: .medium))
                        .foregroundStyle(dutyState.isOnDuty ? theme.colors.success : theme.colors.brandGold)
                }

                VStack(spacing: 6) {
                    Text(dutyState.isOnDuty ? "ON DUTY" : "START PATROL")
                        .font(.title2.weight(.bold)).tracking(2)
                        .foregroundStyle(dutyState.isOnDuty ? theme.colors.success : theme.colors.brandGold)

                    if dutyState.isOnDuty, !dutyState.unitID.isEmpty {
                        Text("Unit \(dutyState.unitID)")
                            .font(.headline).foregroundStyle(theme.colors.textPrimary)
                        Text(formattedElapsed)
                            .font(.title3.monospacedDigit()).foregroundStyle(theme.colors.textSecondary)
                    } else if !dutyState.isOnDuty {
                        Text("Your unit will be resolved automatically")
                            .font(.caption).foregroundStyle(theme.colors.textMuted)
                            .multilineTextAlignment(.center).padding(.horizontal, 32)
                    }
                }

                if let error {
                    HStack(spacing: 8) {
                        Image(systemName: "exclamationmark.triangle.fill")
                            .font(.caption).foregroundStyle(theme.colors.critical)
                        Text(error).font(.caption).foregroundStyle(theme.colors.critical)
                    }
                    .padding(.horizontal, 32).multilineTextAlignment(.center)
                }

                Spacer()

                Button {
                    Task { await toggle() }
                } label: {
                    Group {
                        if isBusy {
                            ProgressView().tint(theme.colors.surfaceBase)
                        } else {
                            Text(dutyState.isOnDuty ? "CLOCK OFF" : "CLOCK ON")
                                .font(.headline).tracking(1)
                        }
                    }
                    .frame(maxWidth: .infinity).padding(.vertical, 14)
                    .background(dutyState.isOnDuty ? theme.colors.critical : theme.colors.brandGold)
                    .foregroundStyle(theme.colors.surfaceBase)
                    .clipShape(RoundedRectangle(cornerRadius: 2))
                }
                .disabled(isBusy)
                .padding(.horizontal, 32).padding(.bottom, 32)
            }
        }
    }

    private var formattedElapsed: String {
        let s = Int(dutyState.elapsedSinceShiftStart())
        return String(format: "%02d:%02d:%02d on shift", s / 3600, (s % 3600) / 60, s % 60)
    }

    private func toggle() async {
        isBusy = true
        error = nil
        do {
            if dutyState.isOnDuty {
                let r = try await api.clockOff()
                dutyState.clockOff()
                if !r.on_shift { dismiss() }
            } else {
                let r = try await api.clockOn()
                let callSign = r.unit?.call_sign ?? "—"
                dutyState.clockOn(unitID: callSign)
                dismiss()
            }
        } catch {
            self.error = friendlyError(error)
        }
        isBusy = false
    }

    private func friendlyError(_ err: Error) -> String {
        let msg = err.localizedDescription
        if msg.contains("NO_UNIT") || msg.contains("No unit") {
            return "No unit assigned to your account. Contact dispatch to assign a unit."
        }
        if msg.contains("NEEDS_VEHICLE") || msg.contains("No vehicle") {
            return "No vehicle available for your unit. Contact dispatch."
        }
        return msg
    }
}
