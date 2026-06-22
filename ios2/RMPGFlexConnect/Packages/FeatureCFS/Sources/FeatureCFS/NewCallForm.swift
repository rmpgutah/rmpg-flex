import SwiftUI
import DesignSystem

@MainActor
public struct NewCallForm: View {
    @Environment(\.theme) private var theme
    @Environment(\.dismiss) private var dismiss
    @Bindable public var vm: NewCallViewModel

    public init(vm: NewCallViewModel) {
        self.vm = vm
    }

    public var body: some View {
        ZStack {
            theme.colors.surfaceBase.ignoresSafeArea()
            ScrollView {
                VStack(spacing: 16) {
                    header

                    typePicker
                    if vm.callType.id == "OTHER" {
                        labeledField("FREE-TEXT TYPE", text: $vm.freeTextType, lines: 1)
                    }
                    labeledField("LOCATION", text: $vm.location, lines: 1)
                    labeledField("NARRATIVE", text: $vm.narrative, lines: 4)

                    if case let .error(msg) = vm.state {
                        Text(msg)
                            .font(.footnote)
                            .foregroundStyle(theme.colors.critical)
                            .padding(.horizontal, 24)
                    }
                    if case let .success(cfs) = vm.state {
                        Text("Created CFS \(cfs)")
                            .font(.footnote)
                            .foregroundStyle(theme.colors.success)
                            .padding(.horizontal, 24)
                    }

                    submitButton
                }
                .padding(20)
            }
        }
    }

    private var header: some View {
        VStack(spacing: 4) {
            Image(systemName: "phone.badge.plus")
                .font(.system(size: 36))
                .foregroundStyle(theme.colors.brandGold)
            Text("NEW CALL")
                .font(.title3.weight(.bold))
                .tracking(2)
                .foregroundStyle(theme.colors.brandGold)
        }
        .padding(.top, 8)
    }

    private var typePicker: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text("CALL TYPE")
                .font(.caption2)
                .tracking(0.5)
                .foregroundStyle(theme.colors.textSecondary)
            Picker("Call type", selection: $vm.callType) {
                ForEach(CallTypeRegistry.common) { t in
                    Text("\(t.id) — \(t.label)").tag(t)
                }
            }
            .pickerStyle(.menu)
            .padding(10)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(theme.colors.surfaceRaised)
            .foregroundStyle(theme.colors.textPrimary)
            .clipShape(RoundedRectangle(cornerRadius: 2))
        }
    }

    @ViewBuilder
    private func labeledField(_ label: String, text: Binding<String>, lines: Int) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(label)
                .font(.caption2)
                .tracking(0.5)
                .foregroundStyle(theme.colors.textSecondary)
            if lines == 1 {
                TextField("", text: text)
                    .padding(10)
                    .background(theme.colors.surfaceRaised)
                    .foregroundStyle(theme.colors.textPrimary)
                    .clipShape(RoundedRectangle(cornerRadius: 2))
            } else {
                TextEditor(text: text)
                    .padding(6)
                    .frame(minHeight: CGFloat(lines * 24))
                    .background(theme.colors.surfaceRaised)
                    .foregroundStyle(theme.colors.textPrimary)
                    .scrollContentBackground(.hidden)
                    .clipShape(RoundedRectangle(cornerRadius: 2))
            }
        }
    }

    private var submitButton: some View {
        Button {
            Task { await vm.submit() }
        } label: {
            HStack {
                if vm.state == .submitting {
                    ProgressView().tint(theme.colors.surfaceBase)
                }
                Text("DISPATCH CALL")
                    .font(.headline)
                    .tracking(1)
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 14)
            .background(theme.colors.brandGold)
            .foregroundStyle(theme.colors.surfaceBase)
            .clipShape(RoundedRectangle(cornerRadius: 2))
        }
        .disabled(!vm.canSubmit)
        .opacity(vm.canSubmit ? 1 : 0.5)
        .padding(.top, 8)
    }
}
