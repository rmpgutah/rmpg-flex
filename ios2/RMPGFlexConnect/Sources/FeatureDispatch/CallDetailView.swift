import SwiftUI
import CoreAPI
import DesignSystem

public struct CallDetailView: View {
    let call: CallForService
    let api: DispatchAPI
    @State private var callData: CallForService?
    @State private var units: [Unit] = []
    @State private var isLoading = true

    public init(call: CallForService, api: DispatchAPI) {
        self.call = call
        self.api = api
    }

    public var body: some View {
        ZStack {
            RMPGTheme.baseBlack.ignoresSafeArea()
            if isLoading { ProgressView().tint(RMPGTheme.brandGold) }
            else {
                ScrollView {
                    VStack(spacing: 12) {
                        callHeader
                        statusSection
                        locationSection
                        unitsSection
                        narrativeSection
                        actionsSection
                    }
                    .padding(12)
                }
            }
        }
        .navigationTitle("Call #\(call.callNumber ?? "\(call.id)")")
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
    }

    private var callHeader: some View {
        VStack(spacing: 6) {
            HStack {
                if let p = call.priority { StatusBadge.priority(p) }
                if let s = call.status { StatusBadge(text: s.replacingOccurrences(of: "_", with: " "), color: RMPGTheme.textSecondary) }
                Spacer()
                Text(call.incidentType ?? "Unknown").font(.system(size: 15, weight: .bold)).foregroundColor(RMPGTheme.textPrimary)
            }
        }
        .padding(12).background(RMPGTheme.raisedSurface).cornerRadius(2)
    }

    private var statusSection: some View {
        VStack(spacing: 0) {
            sectionHeader("Details")
            RMPGDataRow(label: "Call Number", value: call.callNumber ?? "—")
            RMPGDivider()
            RMPGDataRow(label: "Incident Type", value: call.incidentType ?? "—")
            RMPGDivider()
            RMPGDataRow(label: "Priority", value: call.priority ?? "—")
            RMPGDivider()
            RMPGDataRow(label: "Status", value: (call.status ?? "—").replacingOccurrences(of: "_", with: " "))
            RMPGDivider()
            RMPGDataRow(label: "District", value: call.district ?? "—")
            RMPGDivider()
            RMPGDataRow(label: "Beat", value: call.beat ?? "—")
            RMPGDivider()
            RMPGDataRow(label: "Caller", value: call.callerName ?? "—")
            RMPGDivider()
            RMPGDataRow(label: "Phone", value: call.callerPhone ?? "—")
            RMPGDivider()
            RMPGDataRow(label: "Created", value: call.createdAt.map { String($0.prefix(19)) } ?? "—")
        }
        .background(RMPGTheme.raisedSurface).cornerRadius(2)
    }

    private var locationSection: some View {
        VStack(spacing: 0) {
            sectionHeader("Location")
            if let loc = call.location {
                HStack {
                    Image(systemName: "location.fill").foregroundColor(RMPGTheme.statusRed)
                    Text(loc).font(.system(size: 13)).foregroundColor(RMPGTheme.textPrimary)
                    Spacer()
                }
                .padding(12)
            }
        }
        .background(RMPGTheme.raisedSurface).cornerRadius(2)
    }

    private var unitsSection: some View {
        VStack(spacing: 0) {
            sectionHeader("Assigned Units (\(call.parsedUnitIds.count))")
            if call.parsedUnitIds.isEmpty {
                Text("No units assigned").font(.system(size: 11)).foregroundColor(RMPGTheme.textMuted).padding()
            } else {
                ForEach(units.filter { call.parsedUnitIds.contains($0.id) }) { unit in
                    HStack {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(unit.callSign ?? "Unit \(unit.id)").font(.system(size: 13, weight: .semibold)).foregroundColor(RMPGTheme.textPrimary)
                            Text((unit.status ?? "unknown").replacingOccurrences(of: "_", with: " ")).font(.system(size: 10)).foregroundColor(RMPGTheme.textMuted)
                        }
                        Spacer()
                        if let lat = unit.lat, let lng = unit.lng {
                            Text(String(format: "%.4f, %.4f", lat, lng)).font(.system(size: 9)).foregroundColor(RMPGTheme.textMuted)
                        }
                    }
                    .padding(.horizontal, 12).padding(.vertical, 6)
                    if unit.id != call.parsedUnitIds.last { RMPGDivider() }
                }
            }
        }
        .background(RMPGTheme.raisedSurface).cornerRadius(2)
    }

    private var narrativeSection: some View {
        VStack(spacing: 0) {
            sectionHeader("Narrative")
            Text(call.narrative ?? "No narrative recorded").font(.system(size: 12)).foregroundColor(RMPGTheme.textSecondary).padding(12)
        }
        .background(RMPGTheme.raisedSurface).cornerRadius(2)
    }

    private var actionsSection: some View {
        VStack(spacing: 8) {
            sectionHeader("Actions")
            HStack(spacing: 8) {
                actionButton("Assign", "person.badge.plus") {}
                actionButton("Update", "pencil") {}
                actionButton("Close", "checkmark.circle") {
                    Task { try? await api.updateCall(id: call.id, body: ["status": "closed"]) }
                }
            }
        }
        .background(RMPGTheme.raisedSurface).cornerRadius(2)
    }

    private func sectionHeader(_ t: String) -> some View {
        Text(t.uppercased()).font(.system(size: 9, weight: .semibold)).foregroundColor(RMPGTheme.brandGold).tracking(1).frame(maxWidth: .infinity, alignment: .leading).padding(.horizontal, 12).padding(.vertical, 6)
    }

    private func actionButton(_ t: String, _ i: String, _ a: @escaping () -> Void) -> some View {
        Button(action: a) {
            VStack(spacing: 4) {
                Image(systemName: i).font(.system(size: 16))
                Text(t).font(.system(size: 9))
            }
            .foregroundColor(RMPGTheme.brandGold).frame(maxWidth: .infinity).padding(.vertical, 8)
            .background(RMPGTheme.brandGold.opacity(0.1)).cornerRadius(2)
        }
    }

    private func load() async {
        do {
            async let c = api.getCall(id: call.id)
            async let u = api.listUnits()
            (callData, units) = try await (c, u)
        } catch {}
        isLoading = false
    }
}
