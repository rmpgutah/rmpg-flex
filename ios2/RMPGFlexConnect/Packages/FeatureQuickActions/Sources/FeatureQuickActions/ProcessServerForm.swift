import SwiftUI
import DesignSystem
import CoreAPI

@MainActor
struct ProcessServerForm: View {
    @Environment(\.theme) private var theme
    @Environment(\.dismiss) private var dismiss

    @State private var recipientName = ""
    @State private var recipientAddress = ""
    @State private var recipientCity = ""
    @State private var recipientState = "UT"
    @State private var documentType = ""
    @State private var caseNumber = ""
    @State private var priority = "normal"
    @State private var notes = ""
    @State private var isBusy = false
    @State private var error: String?
    @State private var submitted = false
    @State private var serveId: Int?

    private let apiClient: APIClient
    private let priorities = [("normal", "Normal"), ("rush", "Rush"), ("urgent", "Urgent")]
    private let docTypes = ["Summons", "Subpoena", "Complaint", "Notice", "Order", "Writ", "Other"]

    init(apiClient: APIClient) {
        self.apiClient = apiClient
    }

    private var canSubmit: Bool {
        !recipientName.trimmingCharacters(in: .whitespaces).isEmpty ||
        !recipientAddress.trimmingCharacters(in: .whitespaces).isEmpty
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
            .navigationTitle("PROCESS SERVER")
            .rmpgNavBar(background: theme.colors.surfaceRaised)
            .toolbar {
                ToolbarItem(placement: RmpgToolbarPlacement.trailing.placement) {
                    Button("Cancel") { dismiss() }
                        .font(.caption.weight(.semibold)).foregroundStyle(theme.colors.textMuted)
                }
            }
        }
    }

    private var formView: some View {
        ScrollView {
            VStack(spacing: 14) {
                // Section: Recipient
                sectionHeader("RECIPIENT")
                field("NAME") {
                    RmpgTF("Last, First or Business Name", text: $recipientName)
                }
                field("ADDRESS") {
                    RmpgTF("Street address", text: $recipientAddress)
                }
                HStack(spacing: 10) {
                    field("CITY") {
                        RmpgTF("City", text: $recipientCity)
                    }
                    field("STATE", width: 80) {
                        RmpgTF("UT", text: $recipientState)
                            #if os(iOS)
                            .textInputAutocapitalization(.characters)
                            #endif
                    }
                }

                // Section: Document
                sectionHeader("DOCUMENT")
                field("TYPE") {
                    Menu {
                        ForEach(docTypes, id: \.self) { dt in
                            Button(dt) { documentType = dt }
                        }
                    } label: {
                        HStack {
                            Text(documentType.isEmpty ? "Select type…" : documentType)
                                .foregroundStyle(documentType.isEmpty ? theme.colors.textMuted : theme.colors.textPrimary)
                            Spacer()
                            Image(systemName: "chevron.up.chevron.down").font(.caption2)
                                .foregroundStyle(theme.colors.textMuted)
                        }
                        .padding(10).background(theme.colors.surfaceMuted)
                        .clipShape(RoundedRectangle(cornerRadius: 2))
                    }
                }
                field("CASE NUMBER") {
                    RmpgTF("e.g. 2024-CV-001234", text: $caseNumber)
                }
                field("PRIORITY") {
                    Picker("Priority", selection: $priority) {
                        ForEach(priorities, id: \.0) { p in Text(p.1).tag(p.0) }
                    }
                    .pickerStyle(.segmented).tint(theme.colors.brandGold)
                }
                field("NOTES") {
                    TextEditor(text: $notes)
                        .frame(minHeight: 60).padding(8)
                        .background(theme.colors.surfaceMuted)
                        .foregroundStyle(theme.colors.textPrimary).font(.body)
                        .clipShape(RoundedRectangle(cornerRadius: 2))
                }

                if let error {
                    Text(error).font(.caption).foregroundStyle(theme.colors.critical)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }

                Button { Task { await submit() } } label: {
                    Group {
                        if isBusy { ProgressView().tint(theme.colors.surfaceBase) }
                        else { Text("QUEUE FOR SERVICE").font(.headline).tracking(1) }
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
            Image(systemName: "checkmark.circle.fill").font(.system(size: 64)).foregroundStyle(theme.colors.success)
            Text("QUEUED FOR SERVICE").font(.title3.weight(.bold)).tracking(2).foregroundStyle(theme.colors.textPrimary)
            if let id = serveId {
                Text("Serve #\(id)").font(.title2.weight(.black).monospacedDigit()).foregroundStyle(theme.colors.brandGold)
            }
            Text("Assigned to the serve queue.").font(.caption).foregroundStyle(theme.colors.textMuted)
            Button("Done") { dismiss() }
                .font(.headline).tracking(1).frame(maxWidth: .infinity).padding(.vertical, 14)
                .background(theme.colors.brandGold).foregroundStyle(theme.colors.surfaceBase)
                .clipShape(RoundedRectangle(cornerRadius: 2))
                .padding(.horizontal, 32).padding(.top, 8)
        }
        .padding(32)
    }

    private func sectionHeader(_ label: String) -> some View {
        HStack {
            Text(label).font(.caption2.weight(.bold)).tracking(1.5).foregroundStyle(theme.colors.brandGold)
            Rectangle().fill(theme.colors.surfaceMuted).frame(height: 1)
        }
        .padding(.top, 4)
    }

    private func field<C: View>(_ label: String, width: CGFloat? = nil, @ViewBuilder content: () -> C) -> some View {
        VStack(alignment: .leading, spacing: 5) {
            Text(label).font(.caption2.weight(.semibold)).tracking(0.4).foregroundStyle(theme.colors.textMuted)
            content()
        }
        .frame(maxWidth: width ?? .infinity, alignment: .leading)
    }

    private func submit() async {
        isBusy = true; error = nil
        do {
            struct Body: Encodable {
                let recipient_name: String?
                let recipient_address: String?
                let recipient_city: String?
                let recipient_state: String?
                let document_type: String?
                let case_number: String?
                let priority: String
                let notes: String?
                let status: String
            }
            let body = Body(
                recipient_name:    recipientName.trim.nilIfEmpty,
                recipient_address: recipientAddress.trim.nilIfEmpty,
                recipient_city:    recipientCity.trim.nilIfEmpty,
                recipient_state:   recipientState.trim.nilIfEmpty,
                document_type:     documentType.trim.nilIfEmpty,
                case_number:       caseNumber.trim.nilIfEmpty,
                priority:          priority,
                notes:             notes.trim.nilIfEmpty,
                status:            "pending"
            )
            let ep = try Endpoint.jsonPost("api/serve", body: body)
            struct R: Decodable { let id: Int? }
            let r = try await apiClient.request(ep, as: R.self)
            serveId = r.id
            submitted = true
        } catch {
            self.error = error.localizedDescription
        }
        isBusy = false
    }
}

private struct RmpgTF: View {
    @Environment(\.theme) private var theme
    let placeholder: String
    @Binding var text: String
    init(_ placeholder: String, text: Binding<String>) { self.placeholder = placeholder; _text = text }
    var body: some View {
        TextField(placeholder, text: $text)
            .padding(10).background(theme.colors.surfaceMuted)
            .foregroundStyle(theme.colors.textPrimary)
            .clipShape(RoundedRectangle(cornerRadius: 2))
    }
}

private extension String {
    var trim: String { trimmingCharacters(in: .whitespaces) }
    var nilIfEmpty: String? { isEmpty ? nil : self }
}
