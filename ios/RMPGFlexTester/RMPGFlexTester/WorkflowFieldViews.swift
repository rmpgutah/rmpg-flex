import SwiftUI
import UIKit

// Field-type views for the workflow engine. Each binds a FieldValue through a
// shared [String: FieldValue] dictionary binding. Built on Theme tokens.

private func fvBinding(_ values: Binding<[String: FieldValue]>, _ key: String) -> Binding<String> {
    Binding(
        get: { if case .string(let s)? = values.wrappedValue[key] { return s }; return "" },
        set: { values.wrappedValue[key] = .string($0) })
}

struct FieldLabel: View {
    let text: String; var required = false
    var body: some View {
        HStack(spacing: 3) {
            Text(text.uppercased()).font(.system(size: 10, weight: .semibold)).foregroundStyle(Theme.neutral)
            if required { Text("•").foregroundStyle(Theme.gold) }
        }
    }
}

struct TextFieldRow: View {
    let field: WorkflowField
    @Binding var values: [String: FieldValue]
    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            FieldLabel(text: field.label, required: field.required)
            TextField(field.label, text: fvBinding($values, field.key), axis: .vertical)
                .lineLimit(1...4).padding(8).background(Theme.raised)
                .clipShape(RoundedRectangle(cornerRadius: Theme.radius))
        }
    }
}

struct DictationBar: View {
    let field: WorkflowField
    @Binding var values: [String: FieldValue]
    @StateObject private var dictation = Dictation()
    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            FieldLabel(text: field.label, required: field.required)
            TextEditor(text: fvBinding($values, field.key))
                .frame(minHeight: 96).scrollContentBackground(.hidden)
                .padding(6).background(Theme.raised)
                .clipShape(RoundedRectangle(cornerRadius: Theme.radius))
            HStack {
                Button {
                    if dictation.state == .listening { dictation.stop() }
                    else { dictation.start(seed: currentText) }
                } label: {
                    Image(systemName: dictation.state == .listening ? "stop.circle.fill" : "mic.circle.fill")
                        .font(.system(size: 34)).foregroundStyle(Theme.gold)
                }
                Text(dictation.state == .listening ? "Listening · tap to stop"
                     : dictation.state == .denied ? "Enable speech in Settings" : "Tap to dictate")
                    .font(.system(size: 11)).foregroundStyle(Theme.neutral)
                Spacer()
            }
        }
        .onAppear { dictation.requestAuth() }
        .onChange(of: dictation.transcript) { _, new in values[field.key] = .string(new) }
    }
    private var currentText: String { if case .string(let s)? = values[field.key] { return s }; return "" }
}

struct ChipRow: View {
    let field: WorkflowField
    @Binding var values: [String: FieldValue]
    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            FieldLabel(text: field.label, required: field.required)
            FlexWrap(field.options ?? []) { opt in
                let selected = currentValue == opt.value
                Button(opt.label) { values[field.key] = .string(opt.value) }
                    .font(.system(size: 11, weight: .semibold))
                    .padding(.horizontal, 9).padding(.vertical, 6)
                    .background(selected ? Theme.gold : Theme.raised)
                    .foregroundStyle(selected ? .black : .white)
                    .clipShape(RoundedRectangle(cornerRadius: Theme.radius))
            }
        }
    }
    private var currentValue: String { if case .string(let s)? = values[field.key] { return s }; return "" }
}

struct SegmentedRow: View {
    let field: WorkflowField
    @Binding var values: [String: FieldValue]
    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            FieldLabel(text: field.label, required: field.required)
            HStack(spacing: 0) {
                ForEach(field.options ?? [], id: \.value) { opt in
                    let selected = currentValue == opt.value
                    Text(opt.label).font(.system(size: 12, weight: .semibold))
                        .frame(maxWidth: .infinity).padding(.vertical, 8)
                        .background(selected ? Theme.gold : Theme.raised)
                        .foregroundStyle(selected ? .black : .white)
                        .onTapGesture { values[field.key] = .string(opt.value) }
                }
            }
            .clipShape(RoundedRectangle(cornerRadius: Theme.radius))
            .overlay(RoundedRectangle(cornerRadius: Theme.radius).stroke(Theme.border, lineWidth: 1))
        }
    }
    private var currentValue: String { if case .string(let s)? = values[field.key] { return s }; return "" }
}

struct PickerRow: View {
    let field: WorkflowField
    @Binding var values: [String: FieldValue]
    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            FieldLabel(text: field.label, required: field.required)
            Picker(field.label, selection: fvBinding($values, field.key)) {
                Text("—").tag("")
                ForEach(field.options ?? [], id: \.value) { Text($0.label).tag($0.value) }
            }.pickerStyle(.menu).tint(Theme.gold)
        }
    }
}

struct DateRow: View {
    let field: WorkflowField
    @Binding var values: [String: FieldValue]
    @State private var date = Date()
    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            FieldLabel(text: field.label, required: field.required)
            DatePicker("", selection: $date, displayedComponents: .date)
                .labelsHidden().tint(Theme.gold)
                .onChange(of: date) { _, d in values[field.key] = .string(Self.fmt.string(from: d)) }
                .onAppear { values[field.key] = .string(Self.fmt.string(from: date)) }
        }
    }
    static let fmt: DateFormatter = { let f = DateFormatter(); f.dateFormat = "yyyy-MM-dd"; return f }()
}

struct NumberRow: View {
    let field: WorkflowField
    @Binding var values: [String: FieldValue]
    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            FieldLabel(text: field.label, required: field.required)
            TextField("0", text: fvBinding($values, field.key)).keyboardType(.decimalPad)
                .padding(8).background(Theme.raised).clipShape(RoundedRectangle(cornerRadius: Theme.radius))
        }
    }
}

struct ToggleRow: View {
    let field: WorkflowField
    @Binding var values: [String: FieldValue]
    var body: some View {
        Toggle(isOn: Binding(
            get: { if case .bool(let b)? = values[field.key] { return b }; return false },
            set: { values[field.key] = .bool($0) })) {
            Text(field.label).font(.system(size: 12)).foregroundStyle(.white)
        }.tint(Theme.gold)
    }
}

// Minimal adaptive grid — adequate for our short option lists.
struct FlexWrap<Content: View>: View {
    let data: [FieldOption]; let content: (FieldOption) -> Content
    init(_ data: [FieldOption], @ViewBuilder content: @escaping (FieldOption) -> Content) {
        self.data = data; self.content = content
    }
    var body: some View {
        LazyVGrid(columns: [GridItem(.adaptive(minimum: 90), spacing: 6)], alignment: .leading, spacing: 6) {
            ForEach(data, id: \.value) { content($0) }
        }
    }
}

struct PhotoStrip: View {
    let field: WorkflowField
    @Binding var pendingPhotos: [UIImage]
    @State private var showCamera = false
    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            FieldLabel(text: field.label)
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 6) {
                    ForEach(pendingPhotos.indices, id: \.self) { i in
                        Image(uiImage: pendingPhotos[i]).resizable().scaledToFill()
                            .frame(width: 56, height: 56).clipped()
                            .clipShape(RoundedRectangle(cornerRadius: Theme.radius))
                    }
                    Button { showCamera = true } label: {
                        Image(systemName: "plus").font(.system(size: 18)).foregroundStyle(Theme.gold)
                            .frame(width: 56, height: 56)
                            .overlay(RoundedRectangle(cornerRadius: Theme.radius).stroke(Theme.border, style: .init(lineWidth: 1, dash: [3])))
                    }
                }
            }
        }
        .fullScreenCover(isPresented: $showCamera) {
            EvidenceCameraView { imgs in pendingPhotos.append(contentsOf: imgs) }
        }
    }
}

struct GPSLocationField: View {
    let field: WorkflowField
    @Binding var values: [String: FieldValue]
    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            FieldLabel(text: field.label, required: field.required)
            HStack {
                TextField("Address", text: fvBinding($values, field.key))
                    .padding(8).background(Theme.raised).clipShape(RoundedRectangle(cornerRadius: Theme.radius))
                Button { tagGPS() } label: { Image(systemName: "location.fill").foregroundStyle(Theme.gold) }
            }
        }
    }
    private func tagGPS() {
        guard let loc = LocationManager.shared.last else { return }
        values["latitude"] = .number(loc.coordinate.latitude)
        values["longitude"] = .number(loc.coordinate.longitude)
    }
}

struct ScanSubjectCard: View {
    let field: WorkflowField
    @Binding var values: [String: FieldValue]
    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            FieldLabel(text: field.label)
            TextField("Name", text: fvBinding($values, "person_name"))
                .padding(8).background(Theme.raised).clipShape(RoundedRectangle(cornerRadius: Theme.radius))
            HStack(spacing: 6) {
                TextField("DOB", text: fvBinding($values, "person_dob"))
                    .padding(8).background(Theme.raised).clipShape(RoundedRectangle(cornerRadius: Theme.radius))
                TextField("DL #", text: fvBinding($values, "person_dl"))
                    .padding(8).background(Theme.raised).clipShape(RoundedRectangle(cornerRadius: Theme.radius))
            }.font(.system(size: 12))
        }
    }
}

struct ScanVehicleCard: View {
    let field: WorkflowField
    @Binding var values: [String: FieldValue]
    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            FieldLabel(text: field.label)
            HStack(spacing: 6) {
                TextField("Plate", text: fvBinding($values, "vehicle_plate"))
                    .padding(8).background(Theme.raised).clipShape(RoundedRectangle(cornerRadius: Theme.radius))
                TextField("State", text: fvBinding($values, "vehicle_state"))
                    .padding(8).background(Theme.raised).clipShape(RoundedRectangle(cornerRadius: Theme.radius))
            }
            TextField("Make / model / color", text: fvBinding($values, "vehicle_description"))
                .padding(8).background(Theme.raised).clipShape(RoundedRectangle(cornerRadius: Theme.radius))
        }
    }
}

struct StatuteSearchField: View {
    let field: WorkflowField
    @Binding var values: [String: FieldValue]
    var body: some View {  // v1: free-text statute citation; live /api/statutes search is a fast-follow.
        VStack(alignment: .leading, spacing: 4) {
            FieldLabel(text: field.label, required: field.required)
            TextField("e.g. 41-6a-601 Speeding", text: fvBinding($values, "statute_citation"))
                .padding(8).background(Theme.raised).clipShape(RoundedRectangle(cornerRadius: Theme.radius))
        }
    }
}

struct SignaturePad: View {  // not used by any PR1/PR2 definition; placeholder for civil-notice fast-follow.
    let field: WorkflowField
    @Binding var values: [String: FieldValue]
    var body: some View { EmptyView() }
}
