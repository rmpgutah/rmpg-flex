import XCTest
@testable import RMPGFlexTester

final class AlertsFeedTests: XCTestCase {
    func testSeverityMapping() {
        XCTAssertEqual(AlertsFeed.severity(priority: "P1"), .critical)
        XCTAssertEqual(AlertsFeed.severity(priority: "critical"), .critical)
        XCTAssertEqual(AlertsFeed.severity(priority: "P2"), .high)
        XCTAssertEqual(AlertsFeed.severity(priority: "high"), .high)
        XCTAssertEqual(AlertsFeed.severity(priority: "P3"), .normal)
        XCTAssertEqual(AlertsFeed.severity(priority: ""), .normal)
        XCTAssertTrue(AlertSeverity.critical > AlertSeverity.high)
    }

    func testFromCallsBumpsMyCall() {
        let rows: [[String: Any]] = [
            ["id": 10, "priority": "P3", "call_number": "26-100", "call_type": "Welfare", "address": "5 Main"],
            ["id": 11, "priority": "P3", "call_number": "26-101", "address": "9 Oak"],
        ]
        let items = AlertsFeed.fromCalls(rows, myCallId: 11)
        let mine = items.first { $0.callId == 11 }!
        let other = items.first { $0.callId == 10 }!
        XCTAssertEqual(mine.severity, .high)        // bumped from normal
        XCTAssertTrue(mine.unread)
        XCTAssertEqual(other.severity, .normal)
        XCTAssertFalse(other.unread)
        XCTAssertEqual(other.title, "26-100 · Welfare")
        XCTAssertEqual(items.first { $0.callId == 11 }!.title, "26-101")  // no type → number only
    }

    func testFromNotificationsClassifiesWatchlistAndReadState() {
        let rows: [[String: Any]] = [
            ["id": 1, "type": "watchlist_hit", "title": "Watch hit", "priority": "high",
             "entity_type": "person", "entity_id": 77, "read": 0],
            ["id": 2, "type": "system", "message": "Server note", "read": 1],
        ]
        let items = AlertsFeed.fromNotifications(rows)
        let watch = items.first { $0.id == "notification:1" }!
        XCTAssertEqual(watch.kind, .watchlist)
        XCTAssertEqual(watch.severity, .high)
        XCTAssertEqual(watch.personId, 77)
        XCTAssertTrue(watch.unread)
        let sys = items.first { $0.id == "notification:2" }!
        XCTAssertEqual(sys.kind, .notification)
        XCTAssertFalse(sys.unread)
        XCTAssertNil(sys.personId)
    }

    func testFromBolos() {
        let rows: [[String: Any]] = [["id": 3, "priority": "P1", "title": "Red sedan", "description": "NB on Main"]]
        let items = AlertsFeed.fromBolos(rows)
        XCTAssertEqual(items.count, 1)
        XCTAssertEqual(items[0].kind, .bolo)
        XCTAssertEqual(items[0].severity, .critical)
        XCTAssertEqual(items[0].title, "BOLO: Red sedan")
    }

    func testMergeDedupAndRank() {
        let a = AlertItem(id: "call:1", kind: .call, severity: .normal, title: "Z", subtitle: "", epoch: 100, unread: false, personId: nil, callId: 1)
        let aDup = AlertItem(id: "call:1", kind: .call, severity: .critical, title: "Z", subtitle: "", epoch: 50, unread: false, personId: nil, callId: 1)
        let b = AlertItem(id: "bolo:2", kind: .bolo, severity: .high, title: "A", subtitle: "", epoch: 200, unread: false, personId: nil, callId: nil)
        let c = AlertItem(id: "note:3", kind: .notification, severity: .high, title: "A", subtitle: "", epoch: 50, unread: true, personId: nil, callId: nil)
        let merged = AlertsFeed.merge([[a], [aDup, b], [c]])
        XCTAssertEqual(merged.count, 3)                       // call:1 deduped
        XCTAssertEqual(merged[0].id, "call:1")               // critical wins (kept the higher-severity dup)
        XCTAssertEqual(merged[0].severity, .critical)
        XCTAssertEqual(merged[1].id, "note:3")               // high + unread before high read
        XCTAssertEqual(merged[2].id, "bolo:2")
    }

    func testRelativeTime() {
        let now = 1_000_000.0
        XCTAssertEqual(AlertsFeed.relativeTime(epoch: now - 30, now: now), "just now")
        XCTAssertEqual(AlertsFeed.relativeTime(epoch: now - 300, now: now), "5m")
        XCTAssertEqual(AlertsFeed.relativeTime(epoch: now - 7200, now: now), "2h")
        XCTAssertEqual(AlertsFeed.relativeTime(epoch: now - 172_800, now: now), "2d")
        XCTAssertEqual(AlertsFeed.relativeTime(epoch: 0, now: now), "")
    }

    func testEpochParsesSqlAndIso() {
        XCTAssertGreaterThan(AlertsFeed.epoch("2026-06-13 13:00:00"), 0)
        XCTAssertGreaterThan(AlertsFeed.epoch("2026-06-13T13:00:00Z"), 0)
        XCTAssertEqual(AlertsFeed.epoch(""), 0)
        XCTAssertEqual(AlertsFeed.epoch(nil), 0)
    }
}
