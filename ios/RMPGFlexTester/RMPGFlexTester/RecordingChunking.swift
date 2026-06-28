// Pure helpers for background interaction recording (native iOS).
// No AVFoundation/UIKit imports — unit-tested standalone via SwiftPM
// (xcodebuild deadlocks on this Mac; see ios/README.md).
import Foundation

enum RecordingChunking {
    /// On-disk filename for a recording segment.
    static func segmentFilename(recordingId: Int, seq: Int) -> String {
        "rec-\(recordingId)-\(seq).m4a"
    }

    /// Next sequence number given the segments already produced.
    static func nextSeq(existing: [Int]) -> Int {
        (existing.max() ?? -1) + 1
    }

    /// Backoff (seconds) before retrying a failed chunk upload. Capped.
    static func retryDelay(attempt: Int) -> Double {
        min(pow(2.0, Double(attempt)), 8.0)
    }

    /// Whether to keep retrying a chunk upload.
    static func shouldRetry(attempt: Int, maxAttempts: Int = 3) -> Bool {
        attempt < maxAttempts
    }

    /// MIME for AAC/.m4a segments — sent to the backend so playback serves
    /// the right content-type (web recorder uses audio/webm).
    static let mime = "audio/mp4"
}
