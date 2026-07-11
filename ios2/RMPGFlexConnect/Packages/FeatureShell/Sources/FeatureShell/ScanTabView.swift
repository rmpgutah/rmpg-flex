import SwiftUI
import DesignSystem
import CoreAPI

#if os(iOS)
import AVFoundation

// MARK: - Camera Scanner (UIViewControllerRepresentable)

private final class ScannerViewController: UIViewController {
    var onScan: ((String) -> Void)?
    /// Fires when the camera can't be started at all (permission denied/
    /// restricted, or no capture device) — without this, a denied/no-device
    /// state left the officer staring at a permanently black, silently dead
    /// preview with no indication anything was wrong.
    var onError: ((String) -> Void)?
    private var session: AVCaptureSession?
    private var previewLayer: AVCaptureVideoPreviewLayer?

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .black
        requestAndSetup()
    }

    private func requestAndSetup() {
        switch AVCaptureDevice.authorizationStatus(for: .video) {
        case .authorized:
            setupSession()
        case .notDetermined:
            AVCaptureDevice.requestAccess(for: .video) { [weak self] granted in
                DispatchQueue.main.async {
                    if granted {
                        self?.setupSession()
                    } else {
                        self?.onError?("Camera access was denied. Enable it in Settings > RMPG Flex Connect > Camera.")
                    }
                }
            }
        case .denied, .restricted:
            onError?("Camera access is disabled for this app. Enable it in Settings > RMPG Flex Connect > Camera.")
        @unknown default:
            onError?("Camera unavailable.")
        }
    }

    private func setupSession() {
        guard let device = AVCaptureDevice.default(for: .video) else {
            onError?("No camera available on this device.")
            return
        }
        guard let input = try? AVCaptureDeviceInput(device: device) else {
            onError?("Could not access the camera.")
            return
        }
        let sess = AVCaptureSession()
        guard sess.canAddInput(input) else {
            onError?("Could not configure the camera.")
            return
        }
        sess.addInput(input)

        let output = AVCaptureMetadataOutput()
        guard sess.canAddOutput(output) else {
            onError?("Could not configure the barcode scanner.")
            return
        }
        sess.addOutput(output)
        output.setMetadataObjectsDelegate(self, queue: DispatchQueue(label: "ScanQueue"))
        output.metadataObjectTypes = [.pdf417]

        let preview = AVCaptureVideoPreviewLayer(session: sess)
        preview.frame = view.bounds
        preview.videoGravity = .resizeAspectFill
        view.layer.insertSublayer(preview, at: 0)
        previewLayer = preview

        DispatchQueue.global(qos: .userInitiated).async { sess.startRunning() }
        session = sess
    }

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        previewLayer?.frame = view.bounds
    }

    override func viewWillDisappear(_ animated: Bool) {
        super.viewWillDisappear(animated)
        session?.stopRunning()
    }
}

extension ScannerViewController: AVCaptureMetadataOutputObjectsDelegate {
    nonisolated func metadataOutput(_ output: AVCaptureMetadataOutput,
                                     didOutput objects: [AVMetadataObject],
                                     from connection: AVCaptureConnection) {
        guard let obj = objects.first as? AVMetadataMachineReadableCodeObject,
              let str = obj.stringValue else { return }
        let captured = str
        Task { @MainActor [weak self] in self?.onScan?(captured) }
    }
}

private struct ScannerView: UIViewControllerRepresentable {
    let onScan: (String) -> Void
    var onError: (String) -> Void = { _ in }

    func makeUIViewController(context: Context) -> ScannerViewController {
        let vc = ScannerViewController()
        vc.onScan = onScan
        vc.onError = onError
        return vc
    }

    func updateUIViewController(_ uiViewController: ScannerViewController, context: Context) {}
}
#endif

// MARK: - DL Scan API

struct DLScanRequest: Encodable, Sendable {
    var first_name: String = ""
    var last_name: String = ""
    var middle_name: String?
    var dob: String?
    var gender: String?
    var height: String?
    var weight: String?
    var eye_color: String?
    var hair_color: String?
    var address: String?
    var city: String?
    var state: String?
    var zip: String?
    var dl_number: String?
    var dl_state: String?
    var dl_expiry: String?
    var dl_class: String?
    var dl_restrictions: String?
    var dl_endorsements: String?
    var dl_issue_date: String?
}

struct DLScanPerson: Decodable, Sendable {
    let id: Int
    let first_name: String
    let last_name: String
    let date_of_birth: String?
    let dl_number: String?
    let dl_state: String?
    let dl_class: String?
    let dl_expiry: String?
}

struct DLScanResponse: Decodable, Sendable {
    let person: DLScanPerson
    let created: Bool?
}

// MARK: - View Model

@Observable
@MainActor
final class ScanViewModel {
    enum Phase: Equatable {
        case scanning
        case preview(AamvaResult)
        case importing
        case done(name: String, created: Bool)
        case error(String)
    }

    var phase: Phase = .scanning
    private let client: APIClient

    init(client: APIClient) {
        self.client = client
    }

    func handleScan(_ raw: String) {
        guard phase == .scanning else { return }
        guard let result = AamvaParser.parse(raw) else { return }
        phase = .preview(result)
    }

    func handleError(_ message: String) {
        phase = .error(message)
    }

    func importPerson(_ result: AamvaResult) async {
        phase = .importing
        var req = DLScanRequest()
        req.first_name = result.firstName
        req.last_name = result.lastName
        req.middle_name = result.middleName
        req.dob = result.dob
        req.gender = result.gender
        req.height = result.heightRaw
        req.weight = result.weightRaw
        req.eye_color = result.eyeColor
        req.hair_color = result.hairColor
        req.address = result.address
        req.city = result.city
        req.state = result.state
        req.zip = result.zip
        req.dl_number = result.dlNumber
        req.dl_state = result.dlState
        req.dl_expiry = result.dlExpiry
        req.dl_class = result.dlClass
        req.dl_restrictions = result.dlRestrictions
        req.dl_endorsements = result.dlEndorsements
        req.dl_issue_date = result.dlIssueDate

        do {
            let endpoint = try Endpoint.jsonPost("api/records/from-dl-scan", body: req)
            let resp = try await client.request(endpoint, as: DLScanResponse.self)
            let name = "\(resp.person.first_name) \(resp.person.last_name)"
            phase = .done(name: name, created: resp.created ?? false)
        } catch {
            phase = .error("Import failed: \(error.localizedDescription)")
        }
    }

    func reset() { phase = .scanning }
}

// MARK: - Main Tab View

@MainActor
public struct ScanTabView: View {
    @Environment(\.theme) private var theme
    @State private var vm: ScanViewModel

    public init(apiClient: APIClient) {
        _vm = State(initialValue: ScanViewModel(client: apiClient))
    }

    public var body: some View {
        NavigationStack {
            ZStack {
                Color.black.ignoresSafeArea()
                content
            }
            .navigationTitle("SCAN ID")
            .rmpgNavBar(background: theme.colors.surfaceRaised)
        }
    }

    @ViewBuilder
    private var content: some View {
        switch vm.phase {
        case .scanning:
            scanningView
        case .preview(let result):
            previewView(result)
        case .importing:
            importingView
        case .done(let name, let created):
            doneView(name: name, created: created)
        case .error(let msg):
            errorView(msg)
        }
    }

    private var scanningView: some View {
        ZStack {
#if os(iOS)
            ScannerView(onScan: { raw in vm.handleScan(raw) }, onError: { message in vm.handleError(message) })
                .ignoresSafeArea()
#else
            theme.colors.surfaceMuted.ignoresSafeArea()
            Text("Camera not available on this platform")
                .foregroundStyle(theme.colors.textMuted)
#endif
            VStack {
                Spacer()
                VStack(spacing: 8) {
                    Image(systemName: "barcode.viewfinder")
                        .font(.system(size: 56))
                        .foregroundStyle(theme.colors.brandGold)
                    Text("POINT AT BARCODE ON BACK OF ID")
                        .font(.caption.weight(.semibold))
                        .tracking(1)
                        .foregroundStyle(.white)
                }
                .padding(.bottom, 48)
            }
        }
    }

    private func previewView(_ r: AamvaResult) -> some View {
        ZStack {
            theme.colors.surfaceBase.ignoresSafeArea()
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    if r.isExpired {
                        alertBanner("LICENSE EXPIRED", color: theme.colors.critical)
                    }
                    idCard(r)
                    HStack(spacing: 12) {
                        Button("Scan Again") { vm.reset() }
                            .font(.footnote.weight(.semibold))
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 12)
                            .background(theme.colors.surfaceRaised)
                            .foregroundStyle(theme.colors.textSecondary)
                            .clipShape(RoundedRectangle(cornerRadius: 4))

                        Button("Import to Records") { Task { await vm.importPerson(r) } }
                            .font(.footnote.weight(.semibold))
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 12)
                            .background(theme.colors.brandGold)
                            .foregroundStyle(theme.colors.surfaceBase)
                            .clipShape(RoundedRectangle(cornerRadius: 4))
                    }
                    .padding(.horizontal)
                }
                .padding(.vertical)
            }
        }
    }

    private func idCard(_ r: AamvaResult) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("\(r.firstName) \(r.lastName)")
                .font(.title2.weight(.bold))
                .foregroundStyle(theme.colors.textPrimary)
            if let dob = r.dob { row("DOB", dob) }
            if let addr = r.address { row("Address", addr) }
            if let city = r.city, let st = r.state { row("City/State", "\(city), \(st)") }
            Divider().background(theme.colors.surfaceMuted)
            if let dl = r.dlNumber { row("DL #", dl) }
            if let st = r.dlState  { row("State",  st) }
            if let cls = r.dlClass { row("Class",  cls) }
            if let exp = r.dlExpiry { row("Expires", exp) }
            if let iss = r.dlIssueDate { row("Issued", iss) }
            if let res = r.dlRestrictions { row("Restrictions", res) }
            if let end = r.dlEndorsements { row("Endorsements", end) }
            Divider().background(theme.colors.surfaceMuted)
            if let h = r.heightRaw { row("Height", h) }
            if let w = r.weightRaw { row("Weight",  w + " lbs") }
            if let e = r.eyeColor  { row("Eyes",    e) }
            if let h = r.hairColor { row("Hair",    h) }
        }
        .padding()
        .background(theme.colors.surfaceRaised)
        .clipShape(RoundedRectangle(cornerRadius: 8))
        .padding(.horizontal)
    }

    private func row(_ label: String, _ value: String) -> some View {
        HStack(alignment: .top) {
            Text(label)
                .font(.caption)
                .foregroundStyle(theme.colors.textMuted)
                .frame(width: 90, alignment: .leading)
            Text(value)
                .font(.caption)
                .foregroundStyle(theme.colors.textPrimary)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private func alertBanner(_ msg: String, color: Color) -> some View {
        HStack {
            Image(systemName: "exclamationmark.triangle.fill")
            Text(msg).font(.caption.weight(.bold))
        }
        .foregroundStyle(.white)
        .padding()
        .frame(maxWidth: .infinity)
        .background(color)
        .clipShape(RoundedRectangle(cornerRadius: 4))
        .padding(.horizontal)
    }

    private var importingView: some View {
        VStack(spacing: 20) {
            ProgressView().tint(theme.colors.brandGold).scaleEffect(1.5)
            Text("Importing to Records…")
                .font(.headline)
                .foregroundStyle(theme.colors.textPrimary)
        }
    }

    private func doneView(name: String, created: Bool) -> some View {
        VStack(spacing: 20) {
            Image(systemName: created ? "person.badge.plus" : "person.fill.checkmark")
                .font(.system(size: 64))
                .foregroundStyle(theme.colors.success)
            Text(created ? "Record Created" : "Existing Record Matched")
                .font(.headline.weight(.bold))
                .foregroundStyle(theme.colors.textPrimary)
            Text(name)
                .font(.subheadline)
                .foregroundStyle(theme.colors.textSecondary)
            Button("Scan Another") { vm.reset() }
                .font(.footnote.weight(.semibold))
                .padding(.horizontal, 32)
                .padding(.vertical, 12)
                .background(theme.colors.brandGold)
                .foregroundStyle(theme.colors.surfaceBase)
                .clipShape(RoundedRectangle(cornerRadius: 4))
        }
        .padding()
    }

    private func errorView(_ msg: String) -> some View {
        VStack(spacing: 16) {
            Image(systemName: "xmark.circle")
                .font(.system(size: 56))
                .foregroundStyle(theme.colors.critical)
            Text("Error")
                .font(.headline.weight(.bold))
                .foregroundStyle(theme.colors.textPrimary)
            Text(msg)
                .font(.caption)
                .foregroundStyle(theme.colors.textMuted)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 32)
            HStack(spacing: 12) {
                Button("Scan Again") { vm.reset() }
                    .font(.footnote.weight(.semibold))
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 12)
                    .background(theme.colors.surfaceRaised)
                    .foregroundStyle(theme.colors.textSecondary)
                    .clipShape(RoundedRectangle(cornerRadius: 4))
            }
            .padding(.horizontal)
        }
    }
}
