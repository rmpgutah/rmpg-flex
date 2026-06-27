import Testing
import Foundation
@testable import CoreOffline

@Test func outboxEntryDefaults() {
    let entry = OutboxEntry(endpoint: "/api/test", method: "POST")
    #expect(entry.endpoint == "/api/test")
    #expect(entry.method == "POST")
    #expect(entry.attemptCount == 0)
    #expect(entry.isFailed == false)
    #expect(entry.lastError == nil)
}

@Test func outboxEntryIdempotencyKey() {
    let entry = OutboxEntry(endpoint: "/api/test")
    #expect(entry.idempotencyKey == entry.id.uuidString)
}

@Test func outboxEntryMaxAttempts() {
    let entry = OutboxEntry(endpoint: "/api/test")
    entry.attemptCount = 10
    entry.isFailed = true
    #expect(entry.isFailed == true)
    #expect(entry.attemptCount == 10)
}

@Test func drainResultEquality() {
    #expect(DrainResult.noWork == DrainResult.noWork)
    #expect(DrainResult.partial(sent: 3, failed: 1) == DrainResult.partial(sent: 3, failed: 1))
    #expect(DrainResult.partial(sent: 3, failed: 1) != DrainResult.partial(sent: 1, failed: 3))
}
