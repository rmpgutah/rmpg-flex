import SwiftUI
import CoreAPI
import DesignSystem

public struct LoginView: View {
    @State private var username = ""
    @State private var password = ""
    @State private var isLoading = false
    @State private var errorMessage: String?

    let authManager: AuthManager

    public init(authManager: AuthManager) {
        self.authManager = authManager
    }

    public var body: some View {
        ZStack {
            RMPGTheme.baseBlack.ignoresSafeArea()

            VStack(spacing: 24) {
                VStack(spacing: 8) {
                    Image(systemName: "shield.checkered")
                        .font(.system(size: 48))
                        .foregroundColor(RMPGTheme.brandGold)

                    Text("RMPG Flex")
                        .font(.system(size: 24, weight: .bold))
                        .foregroundColor(RMPGTheme.textPrimary)
                        .tracking(2)

                    Text("Rocky Mountain Protective Group")
                        .font(.system(size: 11))
                        .foregroundColor(RMPGTheme.textMuted)
                        .tracking(1)
                }
                .padding(.top, 60)

                VStack(spacing: 12) {
                    RMPGTextField(placeholder: "Username", text: $username)
                        .textContentType(.username)

                    RMPGSecureField(placeholder: "Password", text: $password)
                        .textContentType(.password)
                }
                .padding(.horizontal, 24)

                if let error = errorMessage {
                    Text(error)
                        .font(.system(size: 11))
                        .foregroundColor(RMPGTheme.statusRed)
                        .padding(.horizontal, 24)
                }

                VStack(spacing: 8) {
                    RMPGPrimaryButton(title: "LOGIN", isLoading: isLoading) {
                        login()
                    }
                    .padding(.horizontal, 24)
                }
                .padding(.top, 8)

                Spacer()

                Text("v1.0.0 — CONFIDENTIAL")
                    .font(.system(size: 9))
                    .foregroundColor(RMPGTheme.textMuted)
                    .padding(.bottom, 40)
            }
        }
    }

    private func login() {
        guard !username.isEmpty, !password.isEmpty else {
            errorMessage = "Username and password are required"
            return
        }
        isLoading = true
        errorMessage = nil
        Task {
            do {
                try await authManager.login(username: username, password: password)
            } catch {
                errorMessage = error.localizedDescription
            }
            isLoading = false
        }
    }
}
