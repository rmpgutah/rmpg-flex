import SwiftUI
import DesignSystem

public struct IDScanResultView: View {
    public let result: IDScanResult
    public let onDismiss: () -> Void
    public let onImport: () -> Void

    @State private var isImporting = false

    public var body: some View {
        ScrollView {
            VStack(spacing: 16) {
                Text("ID SCAN RESULT")
                    .font(.title2).bold()
                    .foregroundColor(ThemeColors.tokens(for: .night).brandGold)

                if result.isExpired {
                    HStack {
                        Image(systemName: "exclamationmark.triangle.fill")
                        Text("EXPIRED ID")
                            .fontWeight(.bold)
                    }
                    .foregroundColor(.red)
                    .padding(8)
                    .background(Color.red.opacity(0.1))
                    .cornerRadius(2)
                }

                VStack(alignment: .leading, spacing: 8) {
                    IDRow(label: "Name", value: result.fullName)
                    IDRow(label: "DOB", value: result.dateOfBirth)
                    IDRow(label: "DL#", value: result.documentNumber)
                    IDRow(label: "Expires", value: result.expirationDate)
                }
                .padding()
                .background(ThemeColors.tokens(for: .night).surfaceRaised)
                .cornerRadius(2)

                HStack(spacing: 16) {
                    Button("SCAN AGAIN") { onDismiss() }
                        .buttonStyle(.bordered)
                    Button(action: { isImporting = true; onImport() }) {
                        if isImporting {
                            ProgressView().tint(.white)
                        } else {
                            Text("IMPORT TO RECORDS")
                        }
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(ThemeColors.tokens(for: .night).brandGold)
                    .disabled(isImporting)
                }
            }
            .padding()
        }
    }
}

struct IDRow: View {
    let label: String
    let value: String

    var body: some View {
        HStack {
            Text(label).foregroundColor(ThemeColors.tokens(for: .night).textMuted).frame(width: 80, alignment: .leading)
            Text(value).foregroundColor(ThemeColors.tokens(for: .night).textPrimary)
            Spacer()
        }
    }
}

public enum IDScanSource: String {
    case aamva
    case mrz
    case appleID
}

public struct IDScanResult: Sendable {
    public let source: IDScanSource
    public let firstName: String
    public let lastName: String
    public let dateOfBirth: String
    public let documentNumber: String
    public let expirationDate: String
    public let isExpired: Bool
    public let rawData: String

    public var fullName: String { "\(firstName) \(lastName)" }
}
