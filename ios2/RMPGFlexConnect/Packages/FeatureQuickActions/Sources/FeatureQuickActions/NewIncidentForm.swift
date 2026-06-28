import SwiftUI
import DesignSystem
import CoreAPI

@MainActor
struct NewIncidentForm: View {
    @Environment(\.theme) private var theme
    @Environment(\.dismiss) private var dismiss

    @State private var incidentType = ""
    @State private var locationAddress = ""
    @State private var priority = "P3"
    @State private var narrative = ""
    @State private var isBusy = false
    @State private var error: String?
    @State private var submitted = false
    @State private var incidentNumber = ""

    private let apiClient: APIClient

    private let priorities = ["P1", "P2", "P3", "P4"]

    init(apiClient: APIClient) {
        self.apiClient = apiClient
    }

    var body: some View {
        NavigationStack {
            ZStack {
                theme.colors.surfaceBase.ignoresSafeArea()
                if submitted {
                    successView
                } else {
                    formView
                }
            }
            .navigationTitle("NEW INCIDENT")
            .rmpgNavBar(background: theme.colors.surfaceRaised)
            .toolbar {
                ToolbarItem(placement: RmpgToolbarPlacement.trailing.placement) {
                    Button("Cancel") { dismiss() }
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(theme.colors.textMuted)
                }
            }
        }
    }

    private var formView: some View {
        ScrollView {
            VStack(spacing: 14) {
                formField(label: "INCIDENT TYPE", required: true) {
                    RmpgTextField("e.g. 10-91, Disturbance, Theft", text: $incidentType)
                }
                formField(label: "LOCATION", required: true) {
                    RmpgTextField("Street address", text: $locationAddress)
                }
                formField(label: "PRIORITY") {
                    Picker("Priority", selection: $priority) {
                        ForEach(priorities, id: \.self) { p in
                            Text(p).tag(p)
                        }
                    }
                    .pickerStyle(.segmented)
                    .tint(theme.colors.brandGold)
                }
                formField(label: "NARRATIVE") {
                    TextEditor(text: $narrative)
                        .frame(minHeight: 80)
                        .padding(8)
                        .background(theme.colors.surfaceMuted)
                        .clipShape(RoundedRectangle(cornerRadius: 2))
                        .foregroundStyle(theme.colors.textPrimary)
                        .font(.body)
                }

                if let error {
                    Text(error).font(.caption).foregroundStyle(theme.colors.critical)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }

                Button {
                    Task { await submit() }
                } label: {
                    Group {
                        if isBusy { ProgressView().tint(theme.colors.surfaceBase) }
                        else { Text("CREATE INCIDENT").font(.headline).tracking(1) }
                    }
                    .frame(maxWidth: .infinity).padding(.vertical, 14)
                    .background(canSubmit ? theme.colors.brandGold : theme.colors.surfaceMuted)
                    .foregroundStyle(canSubmit ? theme.colors.surfaceBase : theme.colors.textMuted)
                    .clipShape(RoundedRectangle(cornerRadius: 2))
                }
                .disabled(!canSubmit || isBusy)
            }
            .padding(16)
        }
    }

    private var successView: some View {
        VStack(spacing: 16) {
            Image(systemName: "checkmark.circle.fill")
                .font(.system(size: 64)).foregroundStyle(theme.colors.success)
            Text("INCIDENT CREATED").font(.title3.weight(.bold)).tracking(2)
                .foregroundStyle(theme.colors.textPrimary)
            if !incidentNumber.isEmpty {
                Text(incidentNumber).font(.title2.weight(.black).monospacedDigit())
                    .foregroundStyle(theme.colors.brandGold)
            }
            Button("Done") { dismiss() }
                .font(.headline).tracking(1)
                .frame(maxWidth: .infinity).padding(.vertical, 14)
                .background(theme.colors.brandGold)
                .foregroundStyle(theme.colors.surfaceBase)
                .clipShape(RoundedRectangle(cornerRadius: 2))
                .padding(.horizontal, 32).padding(.top, 8)
        }
        .padding(32)
    }

    private var canSubmit: Bool {
        !incidentType.trimmingCharacters(in: .whitespaces).isEmpty &&
        !locationAddress.trimmingCharacters(in: .whitespaces).isEmpty
    }

    private func formField<Content: View>(label: String, required: Bool = false, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 4) {
                Text(label).font(.caption2.weight(.semibold)).tracking(0.5)
                    .foregroundStyle(theme.colors.textMuted)
                if required { Text("*").font(.caption2).foregroundStyle(theme.colors.critical) }
            }
            content()
        }
    }

    private func submit() async {
        isBusy = true; error = nil
        do {
            let body: [String: String?] = [
                "incident_type": incidentType.trimmingCharacters(in: .whitespaces),
                "location_address": locationAddress.trimmingCharacters(in: .whitespaces),
                "priority": priority,
                "narrative": narrative.trimmingCharacters(in: .whitespaces).isEmpty ? nil : narrative
            ]
            let endpoint = try Endpoint.jsonPost("api/incidents", body: body)
            struct R: Decodable { let incident_number: String? }
            let r = try await apiClient.request(endpoint, as: R.self)
            incidentNumber = r.incident_number ?? ""
            submitted = true
        } catch {
            self.error = error.localizedDescription
        }
        isBusy = false
    }
}

private struct RmpgTextField: View {
    @Environment(\.theme) private var theme
    let placeholder: String
    @Binding var text: String

    init(_ placeholder: String, text: Binding<String>) {
        self.placeholder = placeholder
        self._text = text
    }

    var body: some View {
        TextField(placeholder, text: $text)
            .padding(10)
            .background(theme.colors.surfaceMuted)
            .foregroundStyle(theme.colors.textPrimary)
            .clipShape(RoundedRectangle(cornerRadius: 2))
    }
}
