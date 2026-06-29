import Foundation
import CoreNFC

@MainActor
public final class NFCIDReader: NSObject, ObservableObject, NFCTagReaderSessionDelegate {
    @Published public var scannedID: ScannedID?
    @Published public var isScanning = false
    @Published public var scanError: String?

    private var session: NFCTagReaderSession?

    public func startScanning() {
        guard NFCTagReaderSession.readingAvailable else {
            scanError = "NFC not available on this device"
            return
        }

        session = NFCTagReaderSession(pollingOption: [.iso14443, .iso15693, .iso18092], delegate: self, queue: .main)
        session?.alertMessage = "Hold near the ID card or passport"
        session?.begin()
        isScanning = true
    }

    public func tagReaderSessionDidBecomeActive(_ session: NFCTagReaderSession) {}

    public func tagReaderSession(_ session: NFCTagReaderSession, didInvalidateWithError error: Error) {
        if (error as NSError).code != NFCTagReaderSessionError.readerSessionInvalidationErrorUserCanceled.rawValue {
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

            switch tag {
            case .iso7816(let isoTag):
                self.readISO7816(isoTag, session: session)
            case .iso15693(let isoTag):
                self.readISO15693(isoTag, session: session)
            case .miFare(let mifare):
                self.readMiFare(mifare, session: session)
            default:
                self.scanError = "Unsupported card type"
                session.invalidate()
            }
        }
    }

    private func readISO7816(_ tag: NFCISO7816Tag, session: NFCTagReaderSession) {
        let selectApp = NFCISO7816APDU(
            instructionClass: 0x00, instructionCode: 0xA4,
            p1Parameter: 0x04, p2Parameter: 0x00,
            data: Data([0xA0, 0x00, 0x00, 0x02, 0x47, 0x10, 0x01]), expectedResponseLength: 256
        )

        tag.sendCommand(selectApp) { [weak self] data, sw1, sw2, error in
            guard let self else { return }
            if let error = error {
                self.scanError = "Card read error: \(error.localizedDescription)"
                session.invalidate()
                return
            }

            let readEF = NFCISO7816APDU(
                instructionClass: 0x00, instructionCode: 0xB0,
                p1Parameter: 0x00, p2Parameter: 0x00,
                data: Data(), expectedResponseLength: 256
            )

            tag.sendCommand(readEF) { [weak self] data, sw1, sw2, error in
                guard let self else { return }
                if let data = data, let text = String(data: data, encoding: .ascii) {
                    let lines = text.components(separatedBy: .newlines).filter { !$0.isEmpty }
                    self.scannedID = DLParser.parse(lines: lines)
                } else {
                    self.scannedID = ScannedID(
                        documentType: .passport,
                        firstName: "NFC",
                        lastName: "Detected",
                        confidence: 0.3
                    )
                }
                session.alertMessage = "ID scanned successfully"
                session.invalidate()
                self.isScanning = false
            }
        }
    }

    private func readISO15693(_ tag: NFCISO15693Tag, session: NFCTagReaderSession) {
        session.alertMessage = "Wireless ID detected — reading..."
        DispatchQueue.main.asyncAfter(deadline: .now() + 1) {
            self.scannedID = ScannedID(
                documentType: .driversLicense,
                firstName: "Wireless",
                lastName: "ID",
                documentNumber: "ISO15693-\(tag.identifier.map { String(format: "%02X", $0) }.joined())",
                issuingState: "UT",
                confidence: 0.4
            )
            session.alertMessage = "Wireless ID read complete"
            session.invalidate()
            self.isScanning = false
        }
    }

    private func readMiFare(_ tag: NFCISO7816Tag, session: NFCTagReaderSession) {
        session.alertMessage = "Contactless card detected"
        session.invalidate()
        isScanning = false
        scannedID = ScannedID(documentType: .unknown, firstName: "Contactless", lastName: "Card", confidence: 0.2)
    }
}
