import Foundation
import SwiftUI
import CoreAudioService

public actor AIDictationService {
    private let audioRecorder: AudioRecorderService
    private let apiBaseURL: URL
    private let tokenProvider: @Sendable () -> String?

    public init(audioRecorder: AudioRecorderService, apiBaseURL: URL, tokenProvider: @escaping @Sendable () -> String?) {
        self.audioRecorder = audioRecorder
        self.apiBaseURL = apiBaseURL
        self.tokenProvider = tokenProvider
    }

    public func recordAndTranscribe() async throws -> StructuredNarrative {
        try await audioRecorder.startRecording()
        try await Task.sleep(nanoseconds: 10_000_000_000)
        guard let recordingURL = await audioRecorder.stopRecording() else {
            throw DictationError.recordingFailed
        }
        defer { try? FileManager.default.removeItem(at: recordingURL) }
        return try await transcribe(recordingURL)
    }

    private func transcribe(_ audioURL: URL) async throws -> StructuredNarrative {
        var request = URLRequest(url: apiBaseURL.appendingPathComponent("api/ai/transcribe"))
        request.httpMethod = "POST"
        if let token = tokenProvider() {
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }
        let boundary = UUID().uuidString
        request.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")
        var body = Data()
        body.append("--\(boundary)\r\n".data(using: .utf8)!)
        body.append("Content-Disposition: form-data; name=\"audio\"; filename=\"recording.m4a\"\r\n".data(using: .utf8)!)
        body.append("Content-Type: audio/mp4\r\n\r\n".data(using: .utf8)!)
        body.append(try Data(contentsOf: audioURL))
        body.append("\r\n--\(boundary)--\r\n".data(using: .utf8)!)
        request.httpBody = body

        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse, http.statusCode == 200 else {
            throw DictationError.transcriptionFailed
        }
        return try JSONDecoder().decode(StructuredNarrative.self, from: data)
    }
}

public struct StructuredNarrative: Codable, Sendable {
    public let transcript: String
    public let summary: String
    public let subjects: [String]
    public let vehicles: [String]
    public let actions: [String]
    public let disposition: String?

    public init(transcript: String, summary: String, subjects: [String], vehicles: [String], actions: [String], disposition: String? = nil) {
        self.transcript = transcript
        self.summary = summary
        self.subjects = subjects
        self.vehicles = vehicles
        self.actions = actions
        self.disposition = disposition
    }
}

public enum DictationError: Error, LocalizedError {
    case recordingFailed
    case transcriptionFailed

    public var errorDescription: String? {
        switch self {
        case .recordingFailed: return "Failed to record audio"
        case .transcriptionFailed: return "Transcription service unavailable"
        }
    }
}

@MainActor
public struct DictationButton: View {
    @State private var isRecording = false
    @State private var result: StructuredNarrative?
    @State private var error: String?
    let service: AIDictationService

    public init(service: AIDictationService) {
        self.service = service
    }

    public var body: some View {
        VStack(spacing: 12) {
            Button {
                isRecording.toggle()
                if !isRecording {
                    Task {
                        do {
                            result = try await service.recordAndTranscribe()
                        } catch {
                            self.error = error.localizedDescription
                        }
                    }
                } else {
                    result = nil
                    error = nil
                }
            } label: {
                Image(systemName: isRecording ? "stop.circle.fill" : "mic.circle.fill")
                    .font(.system(size: 48))
                    .foregroundColor(isRecording ? .red : .blue)
            }
            Text(isRecording ? "Recording... tap to stop" : "Tap to dictate")
                .font(.caption)

            if let result {
                Text(result.summary).font(.body).padding()
                if !result.subjects.isEmpty {
                    Text("Subjects: \(result.subjects.joined(separator: ", "))").font(.caption)
                }
                if !result.vehicles.isEmpty {
                    Text("Vehicles: \(result.vehicles.joined(separator: ", "))").font(.caption)
                }
            }
            if let error {
                Text(error).foregroundColor(.red).font(.caption)
            }
        }
        .padding()
    }
}
