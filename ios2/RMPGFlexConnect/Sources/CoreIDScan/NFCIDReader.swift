import Foundation
import CoreNFC

@MainActor
public final class NFCIDReader: NSObject, ObservableObject, @preconcurrency NFCTagReaderSessionDelegate {
    @Published public var scannedID: ScannedID?
    @Published public var isScanning = false
    @Published public var scanError: String?

    private var session: NFCTagReaderSession?
    public var onScan: ((ScannedID) -> Void)?

    public func startScanning() {
        guard NFCTagReaderSession.readingAvailable else {
            scanError = "NFC not available on this device"
            return
        }
        session = NFCTagReaderSession(pollingOption: [.iso14443, .iso15693], delegate: self, queue: .main)
        session?.alertMessage = "Hold near the ID or passport"
        session?.begin()
        isScanning = true
    }

    public func tagReaderSessionDidBecomeActive(_ session: NFCTagReaderSession) {}

    public func tagReaderSession(_ session: NFCTagReaderSession, didInvalidateWithError error: Error) {
        if (error as NSError).code != 200 {
            scanError = error.localizedDescription
        }
        isScanning = false
        self.session = nil
    }

    public func tagReaderSession(_ session: NFCTagReaderSession, didDetect tags: [NFCTag]) {
        guard let tag = tags.first else { return }
        session.connect(to: tag) { [weak self] error in
            guard let self else { return }
            if let error = error {
                self.scanError = error.localizedDescription
                session.invalidate()
                return
            }

            var id = ScannedID(documentType: .unknown, confidence: 0.5)

            switch tag {
            case .iso7816(let t):
                id = ScannedID(documentType: .passport, firstName: "NFC", lastName: "ePassport",
                               documentNumber: t.identifier.map { String(format: "%02X", $0) }.joined(),
                               nationality: "NFC", confidence: 0.6)
            case .iso15693(let t):
                id = ScannedID(documentType: .driversLicense, firstName: "NFC", lastName: "mDL",
                               documentNumber: t.identifier.map { String(format: "%02X", $0) }.joined(),
                               issuingState: "NFC", confidence: 0.6)
            case .miFare(let t):
                id = ScannedID(documentType: .unknown, firstName: "NFC", lastName: "MiFare",
                               documentNumber: t.identifier.map { String(format: "%02X", $0) }.joined(),
                               confidence: 0.4)
            default:
                id = ScannedID(documentType: .unknown, firstName: "NFC", lastName: "Tag", confidence: 0.3)
            }

            self.scannedID = id
            self.onScan?(id)
            session.alertMessage = "ID read: \(id.lastName ?? "Unknown")"
            session.invalidate()
            self.isScanning = false
        }
    }
}
