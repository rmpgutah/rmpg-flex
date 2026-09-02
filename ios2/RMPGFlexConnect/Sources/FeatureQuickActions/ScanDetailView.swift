import SwiftUI



/// Full-scale detail view for a single recent scan — every AAMVA/MRZ field
/// the parser extracted, plus the "advanced data" (raw barcode/MRZ text and
/// derived confidence) that DocumentScanner's own result screen shows during
/// a live scan but which previously vanished the moment that sheet was
/// dismissed. Recent Scans rows had no tap action at all before this.
struct ScanDetailView: View {
    let scan: ScannedID

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                header

                fieldSection("Identity") {
                    row("Name", scan.displayName)
                    row("Date of Birth", scan.dobFormatted)
                    row("Gender", scan.gender)
                    row("Nationality", scan.nationality)
                }

                fieldSection("Document") {
                    row("Document Type", scan.documentType.rawValue.replacingOccurrences(of: "_", with: " ").capitalized)
                    row("Document Number", scan.documentNumber)
                    row("Passport Number", scan.passportNumber)
                    row("Issuing State", scan.issuingState)
                    row("Issue Date", scan.issueDate)
                    row("Expiration Date", scan.expirationDate)
                }

                fieldSection("Address") {
                    row("Street", scan.address)
                    row("City", scan.city)
                    row("State", scan.state)
                    row("ZIP", scan.zipCode)
                }

                fieldSection("Physical Description") {
                    row("Height", scan.height)
                    row("Weight", scan.weight)
                    row("Eye Color", scan.eyeColor)
                    row("Hair Color", scan.hairColor)
                }

                fieldSection("Flags") {
                    row("Organ Donor", scan.organDonor.map { $0 ? "Yes" : "No" })
                    row("Veteran", scan.veteran.map { $0 ? "Yes" : "No" })
                }

                advancedDataSection
            }
            .padding(16)
        }
        .background(Color(hex: "0a0a0a").ignoresSafeArea())
        .navigationTitle(scan.displayName.isEmpty ? "Scan Detail" : scan.displayName)
        .navigationBarTitleDisplayMode(.inline)
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text(scan.displayName.isEmpty ? "Unknown" : scan.displayName)
                    .font(.system(size: 18, weight: .bold)).foregroundColor(.white)
                Spacer()
                Text("\(Int(scan.confidence * 100))% CONFIDENCE")
                    .font(.system(size: 10, weight: .semibold))
                    .foregroundColor(confidenceColor)
                    .padding(.horizontal, 8).padding(.vertical, 3)
                    .background(confidenceColor.opacity(0.15)).cornerRadius(2)
            }
            Text("Scanned \(scan.scannedAt.formatted(date: .abbreviated, time: .shortened))")
                .font(.system(size: 11)).foregroundColor(Color(hex: "888888"))
        }
        .padding(12).background(Color(hex: "141414")).cornerRadius(2)
    }

    private var confidenceColor: Color {
        if scan.confidence >= 0.8 { return Color(hex: "22c55e") }
        if scan.confidence >= 0.5 { return Color(hex: "eab308") }
        return Color(hex: "ef4444")
    }

    /// The raw PDF417/MRZ text the parser actually read — surfaced so an
    /// officer or supervisor can verify a field by eye against the source
    /// data instead of just trusting the parsed value, and so a parser bug
    /// is diagnosable from a real capture instead of only in a debugger.
    @ViewBuilder
    private var advancedDataSection: some View {
        if scan.rawMRZ != nil || !scan.rawText.isEmpty {
            fieldSection("Advanced — Raw Scan Data") {
                if let mrz = scan.rawMRZ, !mrz.isEmpty {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("MRZ").font(.system(size: 10, weight: .semibold)).foregroundColor(Color(hex: "666666"))
                        Text(mrz).font(.system(size: 11, design: .monospaced)).foregroundColor(Color(hex: "aaaaaa"))
                            .textSelection(.enabled)
                    }
                    .padding(.horizontal, 12).padding(.vertical, 8)
                    if !scan.rawText.isEmpty { Divider().background(Color(hex: "1a1a1a")) }
                }
                if !scan.rawText.isEmpty {
                    VStack(alignment: .leading, spacing: 8) {
                        Text("BARCODE FIELDS — PLAIN ENGLISH").font(.system(size: 10, weight: .semibold)).foregroundColor(Color(hex: "666666"))
                        ForEach(scan.rawText.indices, id: \.self) { i in
                            let raw = scan.rawText[i]
                            VStack(alignment: .leading, spacing: 1) {
                                // AAMVAFieldLabels.describe() turns a raw
                                // "DAQT64235789" line into "Document Number:
                                // T64235789" — otherwise reading this section
                                // required already knowing the AAMVA element
                                // codes by heart. The raw line stays visible
                                // underneath for verification against the
                                // literal barcode payload.
                                Text(AAMVAFieldLabels.describe(raw))
                                    .font(.system(size: 12, weight: .medium)).foregroundColor(.white)
                                Text(raw)
                                    .font(.system(size: 9, design: .monospaced)).foregroundColor(Color(hex: "666666"))
                            }
                        }
                    }
                    .padding(.horizontal, 12).padding(.vertical, 8)
                    .textSelection(.enabled)
                }
            }
        }
    }

    private func fieldSection<Content: View>(_ title: String, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            Text(title.uppercased())
                .font(.system(size: 9, weight: .semibold)).foregroundColor(Color(hex: "d4a017"))
                .tracking(1).padding(.horizontal, 12).padding(.top, 8).padding(.bottom, 4)
            VStack(spacing: 0) { content() }
        }
        .background(Color(hex: "141414")).cornerRadius(2)
    }

    @ViewBuilder
    private func row(_ label: String, _ value: String?) -> some View {
        if let value, !value.isEmpty {
            HStack(alignment: .top) {
                Text(label).font(.system(size: 11)).foregroundColor(Color(hex: "888888")).frame(width: 110, alignment: .leading)
                Text(value).font(.system(size: 12, weight: .medium)).foregroundColor(.white)
                Spacer()
            }
            .padding(.horizontal, 12).padding(.vertical, 6)
            Divider().background(Color(hex: "1a1a1a"))
        }
    }
}
