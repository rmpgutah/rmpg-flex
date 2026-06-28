import SwiftUI
import DesignSystem
import CoreAPI

@MainActor
struct NewCitationForm: View {
    @Environment(\.theme) private var theme
    @Environment(\.dismiss) private var dismiss

    @State private var violationDescription = ""
    @State private var location = ""
    @State private var violationDate = Date()
    @State private var personName = ""
    @State private var vehiclePlate = ""
    @State private var isBusy = false
    @State private var error: String?
    @State private var submitted = false
    @State private var citationNumber = ""

    private let apiClient: APIClient

    private static let dateFmt: DateFormatter = {
        let f = DateFormatter()
        f.dateFormat = "yyyy-MM-dd"
        return f
    }()

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
            .navigationTitle("NEW CITATION")
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
                formField(label: "VIOLATION", required: true) {
                    RmpgTextFieldC("e.g. Speed 45 in 30, Failure to stop", text: $violationDescription)
                }
                formField(label: "LOCATION") {
                    RmpgTextFieldC("Street address where citation issued", text: $location)
                }
                formField(label: "VIOLATION DATE") {
                    DatePicker("", selection: $violationDate, displayedComponents: .date)
                        .datePickerStyle(.compact)
                        .tint(theme.colors.brandGold)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
                formField(label: "PERSON NAME") {
                    RmpgTextFieldC("Last, First (optional)", text: $personName)
                }
                formField(label: "VEHICLE PLATE") {
                    RmpgTextFieldC("e.g. ABC1234 UT (optional)", text: $vehiclePlate)
                        #if os(iOS)
                        .textInputAutocapitalization(.characters)
                        #endif
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
                        else { Text("ISSUE CITATION").font(.headline).tracking(1) }
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
            Text("CITATION ISSUED").font(.title3.weight(.bold)).tracking(2)
                .foregroundStyle(theme.colors.textPrimary)
            if !citationNumber.isEmpty {
                Text(citationNumber).font(.title2.weight(.black).monospacedDigit())
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
        !violationDescription.trimmingCharacters(in: .whitespaces).isEmpty
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
            var body: [String: String?] = [
                "violation_description": violationDescription.trimmingCharacters(in: .whitespaces),
                "violation_date": Self.dateFmt.string(from: violationDate),
                "type": "traffic"
            ]
            let loc = location.trimmingCharacters(in: .whitespaces)
            if !loc.isEmpty { body["location"] = loc }
            let name = personName.trimmingCharacters(in: .whitespaces)
            if !name.isEmpty { body["person_name"] = name }
            let plate = vehiclePlate.trimmingCharacters(in: .whitespaces)
            if !plate.isEmpty { body["vehicle_plate"] = plate }

            let endpoint = try Endpoint.jsonPost("api/citations", body: body)
            struct R: Decodable { let citation_number: String? }
            let r = try await apiClient.request(endpoint, as: R.self)
            citationNumber = r.citation_number ?? ""
            submitted = true
        } catch {
            self.error = error.localizedDescription
        }
        isBusy = false
    }
}

private struct RmpgTextFieldC: View {
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
