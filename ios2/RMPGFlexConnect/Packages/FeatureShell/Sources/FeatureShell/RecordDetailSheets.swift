import SwiftUI
import DesignSystem

// MARK: - Person Detail

@MainActor
struct PersonDetailSheet: View {
    @Environment(\.theme) private var theme
    @Environment(\.dismiss) private var dismiss
    let person: PersonRecord

    var body: some View {
        NavigationStack {
            ZStack {
                theme.colors.surfaceBase.ignoresSafeArea()
                ScrollView {
                    VStack(spacing: 16) {
                        // Avatar
                        ZStack {
                            Circle().fill(theme.colors.surfaceMuted).frame(width: 72, height: 72)
                            Text(person.initials.isEmpty ? "?" : person.initials)
                                .font(.title2.weight(.bold)).foregroundStyle(theme.colors.textSecondary)
                        }
                        .padding(.top, 12)

                        Text(person.fullName.isEmpty ? "Unknown" : person.fullName)
                            .font(.title3.weight(.bold)).foregroundStyle(theme.colors.textPrimary)
                            .multilineTextAlignment(.center)

                        // Info cards
                        infoCard("IDENTITY") {
                            infoRow("DOB", value: person.dob)
                            infoRow("Sex", value: person.sex)
                            infoRow("Race", value: person.race)
                            infoRow("Height", value: person.height)
                        }
                        infoCard("DRIVER LICENSE") {
                            infoRow("DL Number", value: person.dl_number)
                            infoRow("State", value: person.dl_state)
                        }
                        infoCard("ADDRESS") {
                            infoRow("Street", value: person.address)
                            infoRow("City", value: person.city)
                            infoRow("State", value: person.state)
                        }
                    }
                    .padding(16)
                }
            }
            .navigationTitle("PERSON RECORD")
            .rmpgNavBar(background: theme.colors.surfaceRaised)
            .toolbar {
                ToolbarItem(placement: RmpgToolbarPlacement.trailing.placement) {
                    Button("Close") { dismiss() }.font(.caption.weight(.semibold))
                        .foregroundStyle(theme.colors.textMuted)
                }
            }
        }
    }

    private func infoCard<C: View>(_ title: String, @ViewBuilder rows: () -> C) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            Text(title).font(.caption2.weight(.bold)).tracking(1.2).foregroundStyle(theme.colors.brandGold)
                .padding(.horizontal, 14).padding(.vertical, 8)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(theme.colors.surfaceRaised)
            rows()
        }
        .clipShape(RoundedRectangle(cornerRadius: 6))
        .overlay(RoundedRectangle(cornerRadius: 6).strokeBorder(theme.colors.surfaceMuted, lineWidth: 1))
    }

    private func infoRow(_ label: String, value: String?) -> some View {
        HStack {
            Text(label).font(.caption2.weight(.semibold)).foregroundStyle(theme.colors.textMuted).frame(width: 90, alignment: .leading)
            Text(value ?? "—").font(.caption2).foregroundStyle(value != nil ? theme.colors.textPrimary : theme.colors.textMuted)
            Spacer()
        }
        .padding(.horizontal, 14).padding(.vertical, 8)
        .background(theme.colors.surfaceBase)
    }
}

// MARK: - Vehicle Detail

@MainActor
struct VehicleDetailSheet: View {
    @Environment(\.theme) private var theme
    @Environment(\.dismiss) private var dismiss
    let vehicle: VehicleRecord

    var body: some View {
        NavigationStack {
            ZStack {
                theme.colors.surfaceBase.ignoresSafeArea()
                ScrollView {
                    VStack(spacing: 16) {
                        // Plate badge
                        ZStack {
                            RoundedRectangle(cornerRadius: 8)
                                .fill(vehicle.is_stolen == true ? theme.colors.critical.opacity(0.15) : theme.colors.surfaceRaised)
                                .frame(height: 72)
                                .overlay(RoundedRectangle(cornerRadius: 8)
                                    .strokeBorder(vehicle.is_stolen == true ? theme.colors.critical.opacity(0.4) : theme.colors.surfaceMuted, lineWidth: 1))
                            VStack(spacing: 4) {
                                Text(vehicle.displayPlate.isEmpty ? "NO PLATE" : vehicle.displayPlate)
                                    .font(.title2.weight(.black)).foregroundStyle(vehicle.is_stolen == true ? theme.colors.critical : theme.colors.textPrimary)
                                if vehicle.is_stolen == true {
                                    Text("⚠ REPORTED STOLEN").font(.caption2.weight(.bold)).tracking(1)
                                        .foregroundStyle(theme.colors.critical)
                                }
                            }
                        }
                        .padding(.top, 12)

                        infoCard("VEHICLE") {
                            infoRow("Year",  value: vehicle.year.map(String.init))
                            infoRow("Make",  value: vehicle.make)
                            infoRow("Model", value: vehicle.model)
                            infoRow("Color", value: vehicle.color)
                        }
                        infoCard("REGISTRATION") {
                            infoRow("Plate",  value: vehicle.plate)
                            infoRow("State",  value: vehicle.state)
                            infoRow("Owner",  value: vehicle.registered_owner)
                        }
                    }
                    .padding(16)
                }
            }
            .navigationTitle("VEHICLE RECORD")
            .rmpgNavBar(background: theme.colors.surfaceRaised)
            .toolbar {
                ToolbarItem(placement: RmpgToolbarPlacement.trailing.placement) {
                    Button("Close") { dismiss() }.font(.caption.weight(.semibold))
                        .foregroundStyle(theme.colors.textMuted)
                }
            }
        }
    }

    private func infoCard<C: View>(_ title: String, @ViewBuilder rows: () -> C) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            Text(title).font(.caption2.weight(.bold)).tracking(1.2).foregroundStyle(theme.colors.brandGold)
                .padding(.horizontal, 14).padding(.vertical, 8)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(theme.colors.surfaceRaised)
            rows()
        }
        .clipShape(RoundedRectangle(cornerRadius: 6))
        .overlay(RoundedRectangle(cornerRadius: 6).strokeBorder(theme.colors.surfaceMuted, lineWidth: 1))
    }

    private func infoRow(_ label: String, value: String?) -> some View {
        HStack {
            Text(label).font(.caption2.weight(.semibold)).foregroundStyle(theme.colors.textMuted).frame(width: 60, alignment: .leading)
            Text(value ?? "—").font(.caption2).foregroundStyle(value != nil ? theme.colors.textPrimary : theme.colors.textMuted)
            Spacer()
        }
        .padding(.horizontal, 14).padding(.vertical, 8)
        .background(theme.colors.surfaceBase)
    }
}

// MARK: - Warrant Detail

@MainActor
struct WarrantDetailSheet: View {
    @Environment(\.theme) private var theme
    @Environment(\.dismiss) private var dismiss
    let warrant: WarrantRecord

    private var statusColor: Color {
        warrant.isActive ? theme.colors.critical : theme.colors.textMuted
    }

    var body: some View {
        NavigationStack {
            ZStack {
                theme.colors.surfaceBase.ignoresSafeArea()
                ScrollView {
                    VStack(spacing: 16) {
                        // Status badge
                        HStack(spacing: 10) {
                            ZStack {
                                Circle().fill(statusColor.opacity(0.15)).frame(width: 56, height: 56)
                                Image(systemName: "exclamationmark.shield.fill").font(.title2).foregroundStyle(statusColor)
                            }
                            VStack(alignment: .leading, spacing: 4) {
                                Text(warrant.subject_name ?? "Unknown Subject")
                                    .font(.title3.weight(.bold)).foregroundStyle(theme.colors.textPrimary)
                                HStack(spacing: 6) {
                                    Circle().fill(statusColor).frame(width: 7, height: 7)
                                    Text((warrant.status ?? "UNKNOWN").uppercased())
                                        .font(.caption2.weight(.bold)).tracking(1).foregroundStyle(statusColor)
                                    if warrant.extraditable == true {
                                        Text("· EXTRADITABLE").font(.caption2.weight(.bold)).foregroundStyle(theme.colors.warning)
                                    }
                                }
                            }
                            Spacer()
                        }
                        .padding(14).background(theme.colors.surfaceRaised)
                        .clipShape(RoundedRectangle(cornerRadius: 8))
                        .overlay(RoundedRectangle(cornerRadius: 8).strokeBorder(statusColor.opacity(0.3), lineWidth: 1))
                        .padding(.top, 12)

                        infoCard("WARRANT") {
                            infoRow("Number",     value: warrant.warrant_number)
                            infoRow("Offense",    value: warrant.offense)
                            infoRow("Issued",     value: warrant.issued_date)
                            infoRow("Court",      value: warrant.issuing_court)
                        }
                    }
                    .padding(16)
                }
            }
            .navigationTitle("WARRANT")
            .rmpgNavBar(background: theme.colors.surfaceRaised)
            .toolbar {
                ToolbarItem(placement: RmpgToolbarPlacement.trailing.placement) {
                    Button("Close") { dismiss() }.font(.caption.weight(.semibold))
                        .foregroundStyle(theme.colors.textMuted)
                }
            }
        }
    }

    private func infoCard<C: View>(_ title: String, @ViewBuilder rows: () -> C) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            Text(title).font(.caption2.weight(.bold)).tracking(1.2).foregroundStyle(theme.colors.brandGold)
                .padding(.horizontal, 14).padding(.vertical, 8)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(theme.colors.surfaceRaised)
            rows()
        }
        .clipShape(RoundedRectangle(cornerRadius: 6))
        .overlay(RoundedRectangle(cornerRadius: 6).strokeBorder(theme.colors.surfaceMuted, lineWidth: 1))
    }

    private func infoRow(_ label: String, value: String?) -> some View {
        HStack {
            Text(label).font(.caption2.weight(.semibold)).foregroundStyle(theme.colors.textMuted).frame(width: 70, alignment: .leading)
            Text(value ?? "—").font(.caption2).foregroundStyle(value != nil ? theme.colors.textPrimary : theme.colors.textMuted)
                .lineLimit(2)
            Spacer()
        }
        .padding(.horizontal, 14).padding(.vertical, 8)
        .background(theme.colors.surfaceBase)
    }
}
