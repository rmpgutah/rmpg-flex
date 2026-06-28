import SwiftUI
import DesignSystem

@MainActor
public struct CallDetailView: View {
    @Environment(\.theme) private var theme
    @Environment(\.dismiss) private var dismiss
    let call: ActiveCall

    public init(call: ActiveCall) {
        self.call = call
    }

    public var body: some View {
        NavigationStack {
            ZStack {
                theme.colors.surfaceBase.ignoresSafeArea()
                ScrollView {
                    VStack(alignment: .leading, spacing: 16) {
                        headerBanner
                        if let desc = call.description, !desc.isEmpty {
                            section("NARRATIVE") {
                                Text(desc).font(.footnote).foregroundStyle(theme.colors.textPrimary)
                            }
                        }
                        if let notes = call.notes, !notes.isEmpty {
                            section("NOTES") {
                                Text(notes).font(.footnote).foregroundStyle(theme.colors.textSecondary)
                            }
                        }
                        section("DETAILS") {
                            detail("Call #",   call.displayCallNumber)
                            detail("Type",     call.displayIncidentType)
                            detail("Status",   call.statusDisplay)
                            detail("Priority", "P\(call.displayPriority)")
                            detail("Location", call.location_address)
                            detail("Created",  friendlyDate(call.created_at))
                            if let v = call.dispatcher_name { detail("Dispatcher", v) }
                            if let v = call.caller_name     { detail("Caller",     v) }
                            if let v = call.caller_phone    { detail("Caller Ph.", v) }
                        }
                        if !call.unitList.isEmpty {
                            section("ASSIGNED UNITS") {
                                ForEach(call.unitList, id: \.self) { unit in
                                    HStack {
                                        Image(systemName: "car.fill")
                                            .font(.caption).foregroundStyle(theme.colors.brandGold)
                                        Text(unit).font(.footnote.weight(.semibold))
                                            .foregroundStyle(theme.colors.textPrimary)
                                    }
                                }
                            }
                        }
                    }
                    .padding()
                }
            }
            .navigationTitle(call.displayCallNumber)
            .rmpgNavBar(background: theme.colors.surfaceRaised)
            .toolbar {
                ToolbarItem(placement: RmpgToolbarPlacement.confirmationAction.placement) {
                    Button("Done") { dismiss() }.foregroundStyle(theme.colors.brandGold)
                }
            }
        }
    }

    private var headerBanner: some View {
        HStack(alignment: .top, spacing: 14) {
            ZStack {
                RoundedRectangle(cornerRadius: 6).fill(priorityColor).frame(width: 52, height: 52)
                Text("P\(call.displayPriority)").font(.title3.weight(.black)).foregroundStyle(.white)
            }
            VStack(alignment: .leading, spacing: 4) {
                Text(call.displayIncidentType).font(.headline.weight(.bold))
                    .foregroundStyle(theme.colors.textPrimary)
                Text(call.location_address).font(.subheadline)
                    .foregroundStyle(theme.colors.textSecondary)
                Text(call.statusDisplay).font(.caption.weight(.semibold))
                    .foregroundStyle(statusColor)
            }
            Spacer()
        }
        .padding()
        .background(theme.colors.surfaceRaised)
        .clipShape(RoundedRectangle(cornerRadius: 8))
    }

    private var priorityColor: Color {
        switch call.displayPriority {
        case 1: return theme.colors.critical
        case 2: return theme.colors.warning
        default: return theme.colors.textMuted
        }
    }

    private var statusColor: Color {
        switch call.status {
        case "onscene":    return theme.colors.success
        case "enroute":    return theme.colors.warning
        case "dispatched": return theme.colors.brandGold
        default:           return theme.colors.textMuted
        }
    }

    @ViewBuilder
    private func section<Content: View>(_ title: String, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title).font(.caption2.weight(.semibold)).tracking(1).foregroundStyle(theme.colors.textMuted)
            VStack(alignment: .leading, spacing: 6) { content() }
                .padding().frame(maxWidth: .infinity, alignment: .leading)
                .background(theme.colors.surfaceRaised).clipShape(RoundedRectangle(cornerRadius: 6))
        }
    }

    private func detail(_ label: String, _ value: String) -> some View {
        HStack(alignment: .top) {
            Text(label).font(.caption).foregroundStyle(theme.colors.textMuted).frame(width: 80, alignment: .leading)
            Text(value).font(.caption).foregroundStyle(theme.colors.textPrimary).frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private func friendlyDate(_ iso: String) -> String {
        let fmt = ISO8601DateFormatter()
        fmt.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        guard let date = fmt.date(from: iso) ?? ISO8601DateFormatter().date(from: iso) else { return iso }
        let d = DateFormatter(); d.dateStyle = .short; d.timeStyle = .short
        return d.string(from: date)
    }
}
