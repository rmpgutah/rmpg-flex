import Foundation
import AVFoundation

public actor AudioRecorderService {
    private var recorder: AVAudioRecorder?
    private var recordingURL: URL?

    public var isRecording: Bool { recorder?.isRecording ?? false }

    public init() {}

    public func requestPermission() async -> Bool {
        await withCheckedContinuation { continuation in
            AVAudioSession.sharedInstance().requestRecordPermission { granted in
                continuation.resume(returning: granted)
            }
        }
    }

    public func startRecording() throws {
        let session = AVAudioSession.sharedInstance()
        try session.setCategory(.playAndRecord, mode: .default)
        try session.setActive(true)

        let tempDir = FileManager.default.temporaryDirectory
        let url = tempDir.appendingPathComponent("recording_\(UUID().uuidString).m4a")
        recordingURL = url

        let settings: [String: Any] = [
            AVFormatIDKey: Int(kAudioFormatMPEG4AAC),
            AVSampleRateKey: 44100,
            AVNumberOfChannelsKey: 1,
            AVEncoderBitRateKey: 64000
        ]

        recorder = try AVAudioRecorder(url: url, settings: settings)
        recorder?.record()
    }

    public func stopRecording() -> URL? {
        recorder?.stop()
        recorder = nil
        return recordingURL
    }

    public func discardRecording() {
        recorder?.stop()
        if let url = recordingURL {
            try? FileManager.default.removeItem(at: url)
        }
        recorder = nil
        recordingURL = nil
    }
}
