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

            // NOTE: this only confirms a chip is present and reports its raw
            // UID/protocol — it does NOT read the chip's actual data. Reading
            // an eMRTD (ePassport/enhanced ID) chip requires a full Basic
            // Access Control handshake (ICAO 9303 Part 11: derive keys from
            // the MRZ, GET CHALLENGE / EXTERNAL AUTHENTICATE, then secure-
            // messaging APDUs to read EF.DG1/DG2) which is not implemented
            // here. Never fabricate name/DOB/etc. from tag presence alone —
            // that data would be fictional and must not reach a person record.
            let uid: String
            let protocolName: String
            switch tag {
            case .iso7816(let t):
                uid = t.identifier.map { String(format: "%02X", $0) }.joined()
                protocolName = "ISO 7816 (possible ePassport/eID chip)"
            case .iso15693(let t):
                uid = t.identifier.map { String(format: "%02X", $0) }.joined()
                protocolName = "ISO 15693"
            case .miFare(let t):
                uid = t.identifier.map { String(format: "%02X", $0) }.joined()
                protocolName = "MiFare"
            default:
                uid = "unknown"
                protocolName = "unrecognized tag"
            }

            self.scanError = "Chip detected (\(protocolName), UID \(uid)) — automatic chip data extraction isn't implemented. Use the camera to scan the printed ID/barcode."
            session.alertMessage = "Chip detected — use camera scan for data"
            session.invalidate()
            self.isScanning = false
        }
    }
}
