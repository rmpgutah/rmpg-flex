import XCTest
@testable import RMPGFlexTester

final class RecordingTests: XCTestCase {
    func testSegmentFilename() {
        XCTAssertEqual(RecordingChunking.segmentFilename(recordingId: 42, seq: 0), "rec-42-0.m4a")
        XCTAssertEqual(RecordingChunking.segmentFilename(recordingId: 42, seq: 7), "rec-42-7.m4a")
    }

    func testNextSeq() {
        XCTAssertEqual(RecordingChunking.nextSeq(existing: []), 0)
        XCTAssertEqual(RecordingChunking.nextSeq(existing: [0, 1, 2]), 3)
        XCTAssertEqual(RecordingChunking.nextSeq(existing: [5]), 6)
    }

    func testRetryDelayCaps() {
        XCTAssertEqual(RecordingChunking.retryDelay(attempt: 1), 2.0)
        XCTAssertEqual(RecordingChunking.retryDelay(attempt: 2), 4.0)
        XCTAssertEqual(RecordingChunking.retryDelay(attempt: 10), 8.0) // capped
    }

    func testShouldRetry() {
        XCTAssertTrue(RecordingChunking.shouldRetry(attempt: 0))
        XCTAssertTrue(RecordingChunking.shouldRetry(attempt: 2))
        XCTAssertFalse(RecordingChunking.shouldRetry(attempt: 3))
    }

    func testMime() {
        XCTAssertEqual(RecordingChunking.mime, "audio/mp4")
    }
}
