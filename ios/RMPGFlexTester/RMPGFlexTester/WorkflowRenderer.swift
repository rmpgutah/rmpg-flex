import SwiftUI
import UIKit

// Renders any WorkflowDefinition as a stepped flow: progress pills, one pinned
// gold primary per step, a readiness review before submit, and single/lifecycle
// submit with generic validation-error mapping. The only networking surface.
struct WorkflowRenderer: View {
    let def: WorkflowDefinition
    var prefill: [String: FieldValue] = [:]

    @Environment(\.dismiss) private var dismiss
    @State private var values: [String: FieldValue] = [:]
    @State private var step = 0
    @State private var pendingPhotos: [UIImage] = []
    @State private var readiness: [ReadinessItem] = []
    @State private var status: String?
    @State private var busy = false

    private var isReview: Bool { step >= def.steps.count }   // step == count → review

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                stepPills
                if isReview { reviewStep } else { fieldStep(def.steps[step]) }
                if let status { StatusLine(text: status) }
            }.padding(12)
        }
        .background(Theme.base)
        .navigationTitle(def.title.uppercased())
        .navigationBarTitleDisplayMode(.inline)
        .safeAreaInset(edge: .bottom) { primaryBar }
        .onAppear { values.merge(prefill) { _, new in new }; applyDefaults() }
    }

    private var stepPills: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 5) {
                ForEach(def.steps.indices, id: \.self) { i in
                    pill(def.steps[i].title.uppercased(), active: i == step)
                }
                pill("REVIEW", active: isReview)
            }
        }
    }

    private func pill(_ text: String, active: Bool) -> some View {
        Text(text).font(.system(size: 10, weight: .semibold))
            .padding(.horizontal, 8).padding(.vertical, 4)
            .background(active ? Theme.gold : Theme.raised)
            .foregroundStyle(active ? .black : Theme.neutral)
            .clipShape(RoundedRectangle(cornerRadius: Theme.radius))
    }

    @ViewBuilder private func fieldStep(_ s: WorkflowStep) -> some View {
        ForEach(s.fields, id: \.key) { f in fieldView(f) }
    }

    @ViewBuilder private func fieldView(_ f: WorkflowField) -> some View {
        switch f.type {
        case .text: TextFieldRow(field: f, values: $values)
        case .dictatableNarrative: DictationBar(field: f, values: $values)
        case .chips: ChipRow(field: f, values: $values)
        case .segmented: SegmentedRow(field: f, values: $values)
        case .picker: PickerRow(field: f, values: $values)
        case .date, .time: DateRow(field: f, values: $values)
        case .number: NumberRow(field: f, values: $values)
        case .toggle: ToggleRow(field: f, values: $values)
        case .photo: PhotoStrip(field: f, pendingPhotos: $pendingPhotos)
        case .gpsLocation: GPSLocationField(field: f, values: $values)
        case .scanSubject: ScanSubjectCard(field: f, values: $values)
        case .scanVehicle: ScanVehicleCard(field: f, values: $values)
        case .statuteSearch: StatuteSearchField(field: f, values: $values)
        case .signature: SignaturePad(field: f, values: $values)
        }
    }

    private var reviewStep: some View {
        VStack(alignment: .leading, spacing: 10) {
            SectionHeader(title: "Readiness")
            ForEach(localReadiness() + readiness, id: \.label) { item in
                HStack(spacing: 7) {
                    Image(systemName: item.satisfied ? "checkmark.circle.fill" : "exclamationmark.triangle.fill")
                        .foregroundStyle(item.satisfied ? Theme.green : Theme.orange)
                    Text(item.label).font(.system(size: 12)).foregroundStyle(.white)
                }
            }
            if localReadiness().allSatisfy(\.satisfied) && readiness.isEmpty {
                Text("Ready to submit").font(.system(size: 11)).foregroundStyle(Theme.neutral)
            }
            Button { Task { await notifyMDT() } } label: {
                Label("Notify vehicle MDT", systemImage: "car.fill")
                    .font(.system(size: 11, weight: .semibold)).frame(maxWidth: .infinity)
            }.buttonStyle(RaisedButtonStyle()).padding(.top, 4)
        }.themeCard()
    }

    // Push a lightweight summary of this report to the in-vehicle MDT so the
    // terminal/dispatch sees what the officer is filing (situational awareness).
    @MainActor private func notifyMDT() async {
        var p: [String: Any] = ["workflow": def.id, "title": def.title]
        if let nk = def.allFields.first(where: { $0.type == .dictatableNarrative })?.key,
           case .string(let s)? = values[nk] { p["summary"] = String(s.prefix(200)) }
        let ok = await MDTLink.shared.send(type: "draft", payload: p)
        status = ok ? "✓ Sent to your vehicle MDT" : "✗ MDT send failed"
    }

    private func localReadiness() -> [ReadinessItem] {
        let required = def.allFields.filter(\.required)
        let present = Set(required.map(\.key).filter { !(values[$0]?.isEmpty ?? true) })
        return WorkflowValidation.readiness(
            requiredKeys: required.map(\.key), present: present,
            labels: Dictionary(uniqueKeysWithValues: required.map { ($0.key, $0.label) }))
    }

    private var primaryBar: some View {
        Button(isReview ? (busy ? "SUBMITTING…" : "SUBMIT") : "NEXT") {
            if isReview { Task { await submit() } } else { advance() }
        }
        .buttonStyle(GoldButtonStyle()).disabled(busy).padding(12).background(Theme.base)
    }

    private func advance() { if step < def.steps.count { step += 1 } }

    private func applyDefaults() {
        for f in def.allFields where values[f.key] == nil {
            if let d = f.defaultValue { values[f.key] = d }
        }
    }

    @MainActor private func submit() async {
        busy = true; defer { busy = false }
        guard def.missingRequiredKeys(in: values).isEmpty else {
            status = "⚠ Fill the required fields first"; readiness = []; return
        }
        var number = "submitted"
        let err = await authedRetrying { c in
            let (id, num) = try await postOrCreate(c)
            if let num { number = num }
            try await uploadPhotos(c, recordId: id)
            try await finalize(c, id: id)
        }
        if let err {
            // Dead zone → queue the report (and photos) for automatic replay.
            if OfflineSyncLogic.shouldQueue(err) {
                queueOffline()
                readiness = []
                status = "⚠ Offline — \(def.title) queued; sends when back online"
                try? await Task.sleep(for: .seconds(1)); dismiss()
                return
            }
            let mapped = WorkflowValidation.serverErrors(from: RMPGAPIClient.apiBody(err) ?? [:])
            if !mapped.isEmpty { readiness = mapped; status = "⚠ \(mapped.count) to fix before submit" }
            else { status = "✗ \(err.localizedDescription)" }
        } else {
            readiness = []
            status = "✓ " + def.success.message.replacingOccurrences(of: "{\(def.success.numberKey)}", with: number)
            try? await Task.sleep(for: .seconds(1)); dismiss()
        }
    }

    // Queue the primary write + any photos when offline. Single-POST workflows
    // replay as one create; lifecycle (incident) replays the create only — it
    // lands as a draft to finalize on reconnect. Photos stage to disk and link
    // by call_id/coords (incident_id is unknown until the draft replays).
    @MainActor private func queueOffline() {
        let body = WorkflowBody.json(values)
        switch def.submit {
        case .single(let post):
            OfflineSync.shared.enqueue(method: "POST", path: post, body: body, label: def.title)
        case .lifecycle(let create, _, _):
            OfflineSync.shared.enqueue(method: "POST", path: create, body: body, label: "\(def.title) (draft)")
        }
        var fields = WorkflowBody.multipartFields(values.filter { ["latitude", "longitude"].contains($0.key) })
        if case .number(let n)? = values["call_id"] { fields["call_id"] = "\(Int(n))" }
        for img in pendingPhotos {
            if let jpeg = img.jpegData(compressionQuality: 0.8) {
                OfflinePhotoQueue.enqueue(jpeg: jpeg, fields: fields, label: "\(def.title) photo")
            }
        }
        OfflineSync.shared.refreshCount()
    }

    private func postOrCreate(_ c: RMPGAPIClient) async throws -> (Int?, String?) {
        let body = WorkflowBody.json(values)
        switch def.submit {
        case .single(let post):
            let res = try await c.requestJSON("POST", post, body: body)
            return (extractId(res), extractNumber(res))
        case .lifecycle(let create, _, _):
            let res = try await c.requestJSON("POST", create, body: body)
            return (extractId(res), extractNumber(res))
        }
    }

    // For lifecycle workflows, finalize = the submit gate (e.g. NIBRS). The create
    // POST already carried all fields, so no redundant update is sent.
    private func finalize(_ c: RMPGAPIClient, id: Int?) async throws {
        if case .lifecycle(_, _, let finalize) = def.submit, let id {
            try await c.requestJSON("PUT", finalize.replacingOccurrences(of: "{id}", with: "\(id)"), body: [:])
        }
    }

    private func uploadPhotos(_ c: RMPGAPIClient, recordId: Int?) async throws {
        guard !pendingPhotos.isEmpty else { return }
        var fields = WorkflowBody.multipartFields(values.filter { ["latitude", "longitude"].contains($0.key) })
        if def.id == "incident", let recordId { fields["incident_id"] = "\(recordId)" }
        if case .number(let n)? = values["call_id"] { fields["call_id"] = "\(Int(n))" }
        for img in pendingPhotos {
            if let jpeg = img.jpegData(compressionQuality: 0.8) {
                _ = try await MultipartUpload.upload(c, path: "api/field-photos", fields: fields, jpeg: jpeg)
            }
        }
    }

    private func extractId(_ res: Any) -> Int? {
        if let o = res as? [String: Any] {
            if let id = o["id"] as? Int { return id }
            if let d = o["data"] as? [String: Any], let id = d["id"] as? Int { return id }
        }
        return nil
    }

    private func extractNumber(_ res: Any) -> String? {
        let key = def.success.numberKey
        if let o = res as? [String: Any] {
            if let v = o[key] { return "\(v)" }
            if let d = o["data"] as? [String: Any], let v = d[key] { return "\(v)" }
        }
        return nil
    }
}
