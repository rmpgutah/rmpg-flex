import SwiftUI
import CoreImage.CIFilterBuiltins

// My Officer ID — the officer's own digital badge with a live rotating QR.
// GET api/wallet/me lazily issues the credential + returns the badge and a
// fresh QR token; the QR is re-minted every 30s from api/wallet/qr-token so a
// shared screenshot stops verifying. Mirrors the web /my-id. An authenticated
// RMPG user verifies it on the desktop /verify-id (or the iOS ID Scan flow
// later) — POST api/wallet/verify checks signature + expiry + live status.
struct WalletIDView: View {
    private struct Badge {
        var fullName = ""
        var badgeNumber: String?
        var rank: String?
        var department: String?
        var employeeId: String?
        var photo: String?          // "data:image/...;base64,…" or an http(s) url
        var officerStatus = ""
    }

    @State private var badge: Badge?
    @State private var credentialStatus = "active"
    @State private var qrImage: UIImage?
    @State private var status: String?
    @State private var loading = true

    private var isActive: Bool { credentialStatus == "active" && (badge?.officerStatus == "active") }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 12) {
                    if loading {
                        ProgressView().tint(Theme.gold).padding(.top, 40)
                    } else if let badge {
                        badgeCard(badge)
                    } else {
                        StatusLine(text: status ?? "✗ Could not load your ID")
                            .padding(.top, 40)
                    }
                    if let status, badge != nil { StatusLine(text: status) }
                }
                .padding(12)
            }
            .background(Theme.base)
            .navigationTitle("MY OFFICER ID")
            .navigationBarTitleDisplayMode(.inline)
            .task { await load() }
        }
    }

    // ── Badge card ──────────────────────────────────────────
    @ViewBuilder
    private func badgeCard(_ b: Badge) -> some View {
        VStack(spacing: 0) {
            HStack {
                Text("RMPG OFFICER ID")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(Theme.gold)
                Spacer()
                Text(isActive ? "ACTIVE" : "INACTIVE")
                    .font(.system(size: 10, weight: .semibold))
                    .padding(.horizontal, 6).padding(.vertical, 2)
                    .background(isActive ? Theme.green.opacity(0.25) : Theme.red.opacity(0.25))
                    .foregroundStyle(isActive ? Theme.green : Theme.red)
                    .clipShape(RoundedRectangle(cornerRadius: Theme.radius))
            }
            .padding(10)
            .background(Theme.raised)

            Rectangle().fill(Theme.border).frame(height: 1)

            HStack(alignment: .top, spacing: 12) {
                photoView(b.photo)
                    .frame(width: 92, height: 112)
                    .background(Theme.sunken)
                    .clipShape(RoundedRectangle(cornerRadius: Theme.radius))
                    .overlay(RoundedRectangle(cornerRadius: Theme.radius).stroke(Theme.border, lineWidth: 1))

                VStack(alignment: .leading, spacing: 4) {
                    Text(b.fullName)
                        .font(.system(size: 16, weight: .semibold))
                        .foregroundStyle(.white)
                    field("Badge", b.badgeNumber)
                    field("Rank", b.rank)
                    field("Dept", b.department)
                    if let e = b.employeeId, !e.isEmpty { field("Emp ID", e) }
                }
                Spacer(minLength: 0)
            }
            .padding(12)

            // Live QR
            VStack(spacing: 6) {
                Group {
                    if let qrImage {
                        Image(uiImage: qrImage)
                            .interpolation(.none)
                            .resizable()
                            .frame(width: 240, height: 240)
                    } else {
                        ProgressView().tint(.black).frame(width: 240, height: 240)
                    }
                }
                .padding(10)
                .background(Color.white)
                .clipShape(RoundedRectangle(cornerRadius: Theme.radius))

                Text("Refreshes automatically · present to an RMPG verifier")
                    .font(.system(size: 9))
                    .foregroundStyle(Theme.neutral)
            }
            .padding(.bottom, 12)
        }
        .background(Theme.raised)
        .overlay(RoundedRectangle(cornerRadius: Theme.radius).stroke(Theme.border, lineWidth: 1))
        .clipShape(RoundedRectangle(cornerRadius: Theme.radius))
    }

    private func field(_ label: String, _ value: String?) -> some View {
        HStack(spacing: 6) {
            Text(label).font(.system(size: 11)).foregroundStyle(Theme.neutral).frame(width: 48, alignment: .leading)
            Text(value?.isEmpty == false ? value! : "—").font(.system(size: 11)).foregroundStyle(Color(hex: 0xcccccc))
        }
    }

    @ViewBuilder
    private func photoView(_ photo: String?) -> some View {
        if let photo, photo.hasPrefix("data:"), let img = Self.decodeDataUrl(photo) {
            Image(uiImage: img).resizable().scaledToFill()
        } else if let photo, let url = URL(string: photo), photo.hasPrefix("http") {
            AsyncImage(url: url) { img in img.resizable().scaledToFill() } placeholder: {
                ProgressView().tint(Theme.gold)
            }
        } else {
            Text("NO PHOTO").font(.system(size: 9)).foregroundStyle(Theme.neutral)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }

    // ── QR generation ───────────────────────────────────────
    private static func qrImage(from string: String) -> UIImage? {
        let filter = CIFilter.qrCodeGenerator()
        filter.message = Data(string.utf8)
        filter.correctionLevel = "M"
        guard let ci = filter.outputImage else { return nil }
        let scaled = ci.transformed(by: CGAffineTransform(scaleX: 10, y: 10))
        let context = CIContext()
        guard let cg = context.createCGImage(scaled, from: scaled.extent) else { return nil }
        return UIImage(cgImage: cg)
    }

    private static func decodeDataUrl(_ s: String) -> UIImage? {
        guard let comma = s.firstIndex(of: ","),
              let data = Data(base64Encoded: String(s[s.index(after: comma)...])) else { return nil }
        return UIImage(data: data)
    }

    // ── Networking ──────────────────────────────────────────
    private func client() async -> RMPGAPIClient? {
        var client = AppConfig.apiClient()
        if client.jwt == nil,
           let user = KeychainStore.load(key: "rmpgUser"),
           let pass = KeychainStore.load(key: "rmpgPass"), !user.isEmpty,
           let token = try? await client.login(username: user, password: pass) {
            KeychainStore.save(token, key: "rmpgJWT")
            client.jwt = token
        }
        return client.jwt == nil ? nil : client
    }

    @MainActor
    private func load() async {
        guard let c = await client() else {
            loading = false
            status = "✗ Set RMPG credentials in Settings"
            return
        }
        do {
            let me = try await c.requestJSON("GET", "api/wallet/me") as? [String: Any] ?? [:]
            credentialStatus = me["credential_status"] as? String ?? "active"
            if let bd = me["badge"] as? [String: Any] {
                badge = Badge(
                    fullName: bd["full_name"] as? String ?? "",
                    badgeNumber: bd["badge_number"] as? String,
                    rank: bd["rank"] as? String,
                    department: bd["department"] as? String,
                    employeeId: bd["employee_id"] as? String,
                    photo: bd["photo"] as? String,
                    officerStatus: bd["officer_status"] as? String ?? ""
                )
            }
            if let token = me["qr_token"] as? String { qrImage = Self.qrImage(from: token) }
            loading = false
            await rotateLoop(c)
        } catch {
            loading = false
            status = "✗ \(error.localizedDescription)"
        }
    }

    /// Re-mint the QR every 30s so a shared screenshot stops verifying.
    @MainActor
    private func rotateLoop(_ c: RMPGAPIClient) async {
        while !Task.isCancelled {
            try? await Task.sleep(nanoseconds: 30 * 1_000_000_000)
            if Task.isCancelled { break }
            if let r = try? await c.requestJSON("GET", "api/wallet/qr-token") as? [String: Any],
               let token = r["qr_token"] as? String {
                qrImage = Self.qrImage(from: token)
            }
        }
    }
}
