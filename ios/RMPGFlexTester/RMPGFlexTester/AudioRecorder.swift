// Background interaction audio recorder (native iOS).
// Records rotating 30s AAC/.m4a segments via AVAudioRecorder under an
// active AVAudioSession with the `audio` background mode, so capture
// continues when the screen locks or the app is backgrounded. Each
// finished segment uploads immediately as the next chunk on the existing
// /api/intel/recordings pipeline — a crash loses at most the in-flight
// segment. Pending segments persist to disk and resume on relaunch.
import Foundation
import AVFoundation
import Combine

@MainActor
final class AudioRecorder: NSObject, ObservableObject {
    @Published var isRecording = false
    @Published var elapsed = 0
    @Published var segmentsUploaded = 0
    @Published var error: String?
    @Published var recordingId: Int?

    private var recorder: AVAudioRecorder?
    private var rotateTimer: Timer?
    private var tickTimer: Timer?
    private var seq = 0
    private var client: RMPGAPIClient
    private let segmentSeconds: TimeInterval = 30
    private var currentURL: URL?

    init(client: RMPGAPIClient) { self.client = client }

    func updateToken(_ jwt: String?) { client.jwt = jwt }

    private func tmpURL(_ seq: Int) -> URL {
        FileManager.default.temporaryDirectory
            .appendingPathComponent(RecordingChunking.segmentFilename(recordingId: recordingId ?? 0, seq: seq))
    }

    func start(location: String?, notes: String?, lat: Double?, lng: Double?) async {
        error = nil
        // Mic permission
        let granted = await withCheckedContinuation { (cont: CheckedContinuation<Bool, Never>) in
            AVAudioApplication.requestRecordPermission { cont.resume(returning: $0) }
        }
        guard granted else { error = "Microphone permission denied"; return }

        do {
            let session = AVAudioSession.sharedInstance()
            // allowBluetoothHFP is the current name for the old allowBluetooth
            // (Hands-Free Profile route) — lets the officer record through a
            // paired earpiece. Pure rename, back-deploys to the iOS 17 target.
            try session.setCategory(.playAndRecord, mode: .default, options: [.allowBluetoothHFP, .defaultToSpeaker])
            try session.setActive(true)

            var body: [String: Any] = ["mime": RecordingChunking.mime]
            if let location { body["location"] = location }
            if let notes { body["notes"] = notes }
            if let lat { body["lat"] = lat }
            if let lng { body["lng"] = lng }
            let obj = try await client.postJSONReturning("api/intel/recordings/start", body: body)
            guard let dict = obj as? [String: Any], let id = dict["id"] as? Int else {
                error = "Could not start recording session"; return
            }
            recordingId = id; seq = 0; segmentsUploaded = 0; elapsed = 0
            startSegment()
            isRecording = true
            rotateTimer = Timer.scheduledTimer(withTimeInterval: segmentSeconds, repeats: true) { [weak self] _ in
                Task { @MainActor in self?.rotate() }
            }
            tickTimer = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] _ in
                Task { @MainActor in self?.elapsed += 1 }
            }
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func startSegment() {
        let url = tmpURL(seq)
        currentURL = url
        let settings: [String: Any] = [
            AVFormatIDKey: kAudioFormatMPEG4AAC,
            AVSampleRateKey: 16000,
            AVNumberOfChannelsKey: 1,
            AVEncoderAudioQualityKey: AVAudioQuality.medium.rawValue,
        ]
        do {
            let rec = try AVAudioRecorder(url: url, settings: settings)
            rec.record()
            recorder = rec
        } catch {
            self.error = error.localizedDescription
        }
    }

    // Finalize the current segment, upload it, and begin the next.
    private func rotate() {
        guard let finished = currentURL else { return }
        let uploadSeq = seq
        recorder?.stop()
        seq += 1
        startSegment()
        Task { await upload(url: finished, seq: uploadSeq) }
    }

    private func upload(url: URL, seq: Int) async {
        guard let id = recordingId else { return }
        var attempt = 0
        while RecordingChunking.shouldRetry(attempt: attempt) {
            do {
                let data = try Data(contentsOf: url)
                if data.isEmpty { return }
                try await client.putData("api/intel/recordings/\(id)/chunk?seq=\(seq)", data: data, contentType: RecordingChunking.mime)
                segmentsUploaded += 1
                try? FileManager.default.removeItem(at: url)
                return
            } catch {
                attempt += 1
                if !RecordingChunking.shouldRetry(attempt: attempt) { self.error = "A segment failed to upload" }
                try? await Task.sleep(nanoseconds: UInt64(RecordingChunking.retryDelay(attempt: attempt) * 1_000_000_000))
            }
        }
    }

    func stop() async {
        rotateTimer?.invalidate(); rotateTimer = nil
        tickTimer?.invalidate(); tickTimer = nil
        let finished = currentURL
        let lastSeq = seq
        recorder?.stop(); recorder = nil
        isRecording = false
        if let finished { await upload(url: finished, seq: lastSeq) }
        if let id = recordingId {
            try? await client.postJSON("api/intel/recordings/\(id)/stop", body: ["duration_sec": elapsed])
        }
        try? AVAudioSession.sharedInstance().setActive(false)
        recordingId = nil
    }
}
