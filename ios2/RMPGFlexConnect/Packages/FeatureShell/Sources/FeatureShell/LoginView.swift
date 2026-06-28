import SwiftUI
import UIKit
import DesignSystem
import CoreAuth

@MainActor
public struct LoginView: View {
    @Environment(\.theme) private var theme
    @Bindable public var vm: LoginViewModel

    public init(vm: LoginViewModel) {
        self.vm = vm
    }

    private var sealImage: Image {
        guard let data = sealPNGData(), let uiImage = UIImage(data: data) else {
            return Image(systemName: "lock")
        }
        return Image(uiImage: uiImage)
    }

    private func sealPNGData() -> Data? {
        guard let bundlePath = Bundle.main.path(forResource: "FeatureShell_FeatureShell", ofType: "bundle"),
              let bundle = Bundle(path: bundlePath),
              let imagePath = bundle.path(forResource: "rmpg-seal", ofType: "png") else {
            return nil
        }
        return try? Data(contentsOf: URL(fileURLWithPath: imagePath))
    }

    public var body: some View {
        ZStack {
            theme.colors.surfaceBase.ignoresSafeArea()
            VStack(spacing: 24) {
                Spacer().frame(height: 20)
                sealImage
                    .resizable()
                    .scaledToFit()
                    .frame(width: 100, height: 100)
                VStack(spacing: 4) {
                    Text("RMPG FLEX CONNECT")
                        .font(.title2.weight(.bold))
                        .tracking(2)
                        .foregroundStyle(theme.colors.brandGold)
                    Text("api.rmpgutah.us")
                        .font(.caption)
                        .foregroundStyle(theme.colors.textMuted)
                }

                VStack(spacing: 12) {
                    field(label: "USERNAME", text: $vm.username, isSecure: false)
                    field(label: "PASSWORD", text: $vm.password, isSecure: true)
                }
                .padding(.horizontal, 24)

                if case let .error(msg) = vm.state {
                    Text(msg)
                        .font(.footnote)
                        .foregroundStyle(theme.colors.critical)
                        .multilineTextAlignment(.center)
                        .padding(.horizontal, 24)
                }

                VStack(spacing: 8) {
                    Button {
                        Task { await vm.submit() }
                    } label: {
                        HStack {
                            if vm.state == .submitting {
                                ProgressView().tint(theme.colors.surfaceBase)
                            }
                            Text("LOGIN")
                                .font(.headline)
                                .tracking(1)
                        }
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 14)
                        .background(theme.colors.brandGold)
                        .foregroundStyle(theme.colors.surfaceBase)
                    }
                    .disabled(!vm.canSubmit)
                    .opacity(vm.canSubmit ? 1.0 : 0.5)

                    Button {
                        vm.enterDemoMode()
                    } label: {
                        Text("DEMO MODE")
                            .font(.subheadline.weight(.medium))
                            .tracking(1)
                    }
                    .buttonStyle(.plain)
                    .foregroundStyle(theme.colors.textMuted)
                }
                .padding(.horizontal, 24)

                Spacer()
                Text("M0 · Foundation build")
                    .font(.caption2)
                    .foregroundStyle(theme.colors.textMuted)
                    .padding(.bottom, 20)
            }
        }
    }

    @ViewBuilder
    private func field(label: String, text: Binding<String>, isSecure: Bool) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(label)
                .font(.caption2)
                .tracking(0.5)
                .foregroundStyle(theme.colors.textSecondary)
            Group {
                if isSecure {
                    SecureField("", text: text)
                } else {
                    TextField("", text: text)
                        .autocorrectionDisabled()
                    #if os(iOS)
                        .textInputAutocapitalization(.never)
                        .keyboardType(.asciiCapable)
                    #endif
                }
            }
            .padding(10)
            .background(theme.colors.surfaceRaised)
            .foregroundStyle(theme.colors.textPrimary)
            .clipShape(RoundedRectangle(cornerRadius: 2))
        }
    }
}
