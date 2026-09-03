import SwiftUI



public struct CallDetailView: View {
    let call: CallForService
    let api: DispatchAPI
    @State private var callData: CallForService?
    @State private var units: [Unit] = []
    @State private var isLoading = true
    @State private var errorMessage: String?
    @State private var showAssignSheet = false
    @State private var showStatusSheet = false
    @State private var isAdvancing = false

    public init(call: CallForService, api: DispatchAPI) {
        self.call = call
        self.api = api
    }

    /// The freshly-fetched call, falling back to the stale prop only until
    /// `load()` completes — a prior version of this view fetched `callData`
    /// and then never used it, silently rendering the stale prop forever
    /// (so status/unit changes made elsewhere never showed up here without
    /// leaving and re-entering the screen).
    private var current: CallForService { callData ?? call }

    public var body: some View {
        ZStack {
            RMPGTheme.baseBlack.ignoresSafeArea()
            if isLoading { ProgressView().tint(RMPGTheme.brandGold) }
            else {
                ScrollView {
                    VStack(spacing: 12) {
                        if let error = errorMessage {
                            Text(error).font(.system(size: 11)).foregroundColor(RMPGTheme.statusRed)
                        }
                        callHeader
                        workflowSection
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
        .navigationTitle("Call #\(current.callNumber ?? "\(current.id)")")
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
        .sheet(isPresented: $showAssignSheet) {
            AssignUnitSheet(call: current, units: units, api: api) {
                Task { await load() }
            }
        }
        .sheet(isPresented: $showStatusSheet) {
            CallStatusSheet(call: current, api: api) {
                Task { await load() }
            }
        }
    }

    private var callHeader: some View {
        VStack(spacing: 6) {
            HStack {
                if let p = current.priority { StatusBadge.priority(p) }
                if let s = current.status { StatusBadge(text: s.replacingOccurrences(of: "_", with: " ").capitalized, color: RMPGTheme.textSecondary) }
                Spacer()
                Text(current.incidentType ?? "Unknown").font(.system(size: 15, weight: .bold)).foregroundColor(RMPGTheme.textPrimary)
            }
        }
        .padding(12).background(RMPGTheme.raisedSurface).cornerRadius(2)
    }

    /// Guided CFS workflow: a linear progress tracker for the real
    /// call-status sequence (pending → dispatched → enroute → onscene →
    /// cleared), plus ONE contextual primary action that advances to the
    /// next step — instead of making an officer pick the right status out
    /// of a flat list every time. Terminal alternates (closed/cancelled/
    /// archived) stay reachable via the existing "Update" button below,
    /// since those are deliberate branches, not "the next step."
    private var workflowSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            sectionHeader("Workflow")
            HStack(spacing: 0) {
                ForEach(Array(CFSWorkflowStep.steps.enumerated()), id: \.offset) { index, step in
                    let stepIndex = CFSWorkflowStep.steps.firstIndex(of: step) ?? 0
                    let isComplete = stepIndex <= currentStepIndex
                    Circle()
                        .fill(isComplete ? RMPGTheme.brandGold : RMPGTheme.borderDefault)
                        .frame(width: 10, height: 10)
                    if index < CFSWorkflowStep.steps.count - 1 {
                        Rectangle()
                            .fill(stepIndex < currentStepIndex ? RMPGTheme.brandGold : RMPGTheme.borderDefault)
                            .frame(height: 2)
                    }
                }
            }
            .padding(.horizontal, 12)

            HStack {
                ForEach(CFSWorkflowStep.steps, id: \.self) { step in
                    Text(step.label.uppercased())
                        .font(.system(size: 8, weight: .medium))
                        .foregroundColor(step == currentStep ? RMPGTheme.brandGold : RMPGTheme.textMuted)
                        .frame(maxWidth: .infinity)
                }
            }

            if let next = currentStep.nextStep {
                Button {
                    Task { await advance(to: next) }
                } label: {
                    HStack {
                        if isAdvancing { ProgressView().tint(.black) } else { Image(systemName: "arrow.right.circle.fill") }
                        Text(next.actionLabel.uppercased()).font(.system(size: 13, weight: .semibold))
                    }
                    .frame(maxWidth: .infinity).padding(.vertical, 14)
                    .background(RMPGTheme.brandGold).foregroundColor(.black).cornerRadius(2)
                }
                .disabled(isAdvancing)
            } else if currentStep == .cleared {
                Text("Call cleared").font(.system(size: 11)).foregroundColor(RMPGTheme.statusGreen)
            }
        }
        .padding(12).background(RMPGTheme.raisedSurface).cornerRadius(2)
    }

    private var currentStep: CFSWorkflowStep {
        CFSWorkflowStep(rawStatus: current.status)
    }

    private var currentStepIndex: Int {
        CFSWorkflowStep.steps.firstIndex(of: currentStep) ?? 0
    }

    private func advance(to next: CFSWorkflowStep) async {
        isAdvancing = true
        errorMessage = nil
        do {
            _ = try await api.updateCallStatus(id: current.id, status: next.rawValue)
            await load()
        } catch {
            errorMessage = "Could not advance call: \(error.localizedDescription)"
        }
        isAdvancing = false
    }

    private var statusSection: some View {
        VStack(spacing: 0) {
            sectionHeader("Details")
            RMPGDataRow(label: "Call Number", value: current.callNumber ?? "—")
            RMPGDivider()
            RMPGDataRow(label: "Incident Type", value: current.incidentType ?? "—")
            RMPGDivider()
            RMPGDataRow(label: "Priority", value: current.priority ?? "—")
            RMPGDivider()
            RMPGDataRow(label: "Status", value: (current.status ?? "—").replacingOccurrences(of: "_", with: " ").capitalized)
            RMPGDivider()
            RMPGDataRow(label: "District", value: current.district ?? "—")
            RMPGDivider()
            RMPGDataRow(label: "Beat", value: current.beat ?? "—")
            RMPGDivider()
            RMPGDataRow(label: "Caller", value: current.callerName ?? "—")
            RMPGDivider()
            RMPGDataRow(label: "Phone", value: current.callerPhone ?? "—")
            RMPGDivider()
            RMPGDataRow(label: "Created", value: current.createdAt.map { String($0.prefix(19)) } ?? "—")
        }
        .background(RMPGTheme.raisedSurface).cornerRadius(2)
    }

    private var locationSection: some View {
        VStack(spacing: 0) {
            sectionHeader("Location")
            if let loc = current.locationAddress {
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
            sectionHeader("Assigned Units (\(current.parsedUnitIds.count))")
            if current.parsedUnitIds.isEmpty {
                Text("No units assigned").font(.system(size: 11)).foregroundColor(RMPGTheme.textMuted).padding()
            } else {
                let assigned = units.filter { current.parsedUnitIds.contains($0.id) }
                ForEach(assigned) { unit in
                    HStack {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(unit.callSign ?? "Unit \(unit.id)").font(.system(size: 13, weight: .semibold)).foregroundColor(RMPGTheme.textPrimary)
                            Text((unit.status ?? "unknown").replacingOccurrences(of: "_", with: " ").capitalized).font(.system(size: 10)).foregroundColor(RMPGTheme.textMuted)
                        }
                        Spacer()
                        if let lat = unit.lat, let lng = unit.lng {
                            Text(String(format: "%.4f, %.4f", lat, lng)).font(.system(size: 9)).foregroundColor(RMPGTheme.textMuted)
                        }
                    }
                    .padding(.horizontal, 12).padding(.vertical, 6)
                    if unit.id != assigned.last?.id { RMPGDivider() }
                }
            }
        }
        .background(RMPGTheme.raisedSurface).cornerRadius(2)
    }

    private var narrativeSection: some View {
        VStack(spacing: 0) {
            sectionHeader("Narrative")
            Text(current.narrative ?? "No narrative recorded").font(.system(size: 12)).foregroundColor(RMPGTheme.textSecondary).padding(12)
        }
        .background(RMPGTheme.raisedSurface).cornerRadius(2)
    }

    private var actionsSection: some View {
        VStack(spacing: 8) {
            sectionHeader("Actions")
            HStack(spacing: 8) {
                actionButton("Assign", "person.badge.plus") { showAssignSheet = true }
                actionButton("Update", "pencil") { showStatusSheet = true }
                actionButton("Close", "checkmark.circle") {
                    Task {
                        do { _ = try await api.updateCallStatus(id: current.id, status: "closed") } catch {}
                        await load()
                    }
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
            errorMessage = nil
        } catch {
            errorMessage = "Could not refresh call: \(error.localizedDescription)"
        }
        isLoading = false
    }
}

/// Assign an available unit to this call — one call per unit, since the
/// server has no batch-assign endpoint (POST .../assign-unit takes a single
/// `unit_id`).
struct AssignUnitSheet: View {
    let call: CallForService
    let units: [Unit]
    let api: DispatchAPI
    let onComplete: () -> Void

    @State private var isSubmitting: Set<Int> = []
    @State private var errorMessage: String?
    @Environment(\.dismiss) private var dismiss

    private var candidates: [Unit] {
        units.filter { !call.parsedUnitIds.contains($0.id) }
    }

    var body: some View {
        NavigationStack {
            ZStack {
                RMPGTheme.baseBlack.ignoresSafeArea()
                if candidates.isEmpty {
                    Text("No unassigned units available").font(.system(size: 12)).foregroundColor(RMPGTheme.textMuted)
                } else {
                    List(candidates) { unit in
                        HStack {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(unit.callSign ?? "Unit \(unit.id)").font(.system(size: 13, weight: .semibold)).foregroundColor(RMPGTheme.textPrimary)
                                Text((unit.status ?? "unknown").replacingOccurrences(of: "_", with: " ").capitalized).font(.system(size: 10)).foregroundColor(RMPGTheme.textMuted)
                            }
                            Spacer()
                            if isSubmitting.contains(unit.id) {
                                ProgressView().tint(RMPGTheme.brandGold)
                            } else {
                                Button("Assign") { Task { await assign(unit) } }
                                    .font(.system(size: 11, weight: .semibold))
                                    .foregroundColor(.black)
                                    .padding(.horizontal, 12).padding(.vertical, 6)
                                    .background(RMPGTheme.brandGold).cornerRadius(2)
                            }
                        }
                        .listRowBackground(RMPGTheme.raisedSurface)
                    }
                    .listStyle(.plain).scrollContentBackground(.hidden)
                }
                if let error = errorMessage {
                    VStack {
                        Spacer()
                        Text(error).font(.system(size: 11)).foregroundColor(RMPGTheme.statusRed)
                            .padding(8).background(RMPGTheme.raisedSurface).cornerRadius(4).padding()
                    }
                }
            }
            .navigationTitle("Assign Unit")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Done") { dismiss() } }
            }
        }
    }

    private func assign(_ unit: Unit) async {
        isSubmitting.insert(unit.id)
        errorMessage = nil
        do {
            try await api.assignUnit(callId: call.id, unitId: unit.id)
            onComplete()
        } catch {
            errorMessage = "Could not assign \(unit.callSign ?? "unit"): \(error.localizedDescription)"
        }
        isSubmitting.remove(unit.id)
    }
}

/// Status transition sheet — only exposes the real
/// `calls_for_service.status` CHECK values, and always writes through
/// `POST /:id/status` (not the generic PUT) so timeline timestamps land.
struct CallStatusSheet: View {
    let call: CallForService
    let api: DispatchAPI
    let onComplete: () -> Void

    private let statuses = ["pending", "dispatched", "enroute", "onscene", "cleared", "closed", "cancelled"]
    @State private var isSubmitting = false
    @State private var errorMessage: String?
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            ZStack {
                RMPGTheme.baseBlack.ignoresSafeArea()
                VStack(spacing: 0) {
                    ForEach(statuses, id: \.self) { status in
                        Button {
                            Task { await update(to: status) }
                        } label: {
                            HStack {
                                Text(status.capitalized).font(.system(size: 13)).foregroundColor(RMPGTheme.textPrimary)
                                Spacer()
                                if call.status == status {
                                    Image(systemName: "checkmark.circle.fill").foregroundColor(RMPGTheme.brandGold)
                                }
                                if isSubmitting { ProgressView().tint(RMPGTheme.brandGold) }
                            }
                            .padding(.horizontal, 16).padding(.vertical, 12)
                        }
                        .disabled(isSubmitting)
                        if status != statuses.last { Divider().background(RMPGTheme.borderSubtle) }
                    }
                    if let error = errorMessage {
                        Text(error).font(.system(size: 11)).foregroundColor(RMPGTheme.statusRed).padding()
                    }
                }
                .background(RMPGTheme.raisedSurface)
            }
            .navigationTitle("Update Status")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
            }
        }
    }

    private func update(to status: String) async {
        isSubmitting = true
        errorMessage = nil
        do {
            _ = try await api.updateCallStatus(id: call.id, status: status)
            onComplete()
            dismiss()
        } catch {
            errorMessage = "Could not update status: \(error.localizedDescription)"
        }
        isSubmitting = false
    }
}

/// The linear "working the call" happy path through the real
/// `calls_for_service.status` CHECK values (migrations/0001_initial_schema.sql:
/// pending, dispatched, enroute, onscene, cleared, closed, cancelled, archived).
/// Only the 5 statuses on this straight-line path are modeled — closed/
/// cancelled/archived are deliberate branch decisions an officer makes via
/// the status picker, not something to "advance" into automatically.
enum CFSWorkflowStep: String, Equatable {
    case pending, dispatched, enroute, onscene, cleared

    static let steps: [CFSWorkflowStep] = [.pending, .dispatched, .enroute, .onscene, .cleared]

    /// Any status outside the 5-step happy path (closed/cancelled/archived,
    /// or an unrecognized value) reads as "cleared" for progress-bar purposes
    /// — the call is done, whichever terminal branch it took.
    init(rawStatus: String?) {
        self = CFSWorkflowStep(rawValue: rawStatus ?? "pending") ?? .cleared
    }

    var label: String {
        switch self {
        case .pending: return "Pending"
        case .dispatched: return "Dispatched"
        case .enroute: return "En Route"
        case .onscene: return "On Scene"
        case .cleared: return "Cleared"
        }
    }

    var nextStep: CFSWorkflowStep? {
        guard let index = Self.steps.firstIndex(of: self), index + 1 < Self.steps.count else { return nil }
        return Self.steps[index + 1]
    }

    var actionLabel: String {
        switch self {
        case .dispatched: return "Mark Dispatched"
        case .enroute: return "Mark En Route"
        case .onscene: return "Mark On Scene"
        case .cleared: return "Clear Call"
        case .pending: return "Reopen"
        }
    }
}
