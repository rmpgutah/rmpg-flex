import XCTest
@testable import RMPGFlexTester

final class CommandSearchTests: XCTestCase {
    func testHitsParsesMixedRows() {
        let raw: [[String: Any]] = [
            ["type": "person", "id": 5, "label": "John Doe", "snippet": "DOB 1990", "flags": ["WARRANT"]],
            ["entity_type": "vehicle", "entity_id": "12", "name": "7ABC123 Ford"],   // string id coerced
            ["type": "mystery", "id": 9],                                            // unknown kind → .other
            ["type": "person"],                                                      // no id → dropped
        ]
        let hits = CommandSearch.hits(from: raw)
        XCTAssertEqual(hits.count, 3)
        XCTAssertEqual(hits[0].kind, .person)
        XCTAssertEqual(hits[0].entityID, 5)
        XCTAssertEqual(hits[0].flags, ["WARRANT"])
        XCTAssertTrue(hits[0].hasFlags)
        XCTAssertEqual(hits[1].kind, .vehicle)
        XCTAssertEqual(hits[1].entityID, 12)
        XCTAssertEqual(hits[1].label, "7ABC123 Ford")
        XCTAssertEqual(hits[2].kind, .other)
        XCTAssertEqual(hits[2].label, "Record #9")        // synthesized when no label field
        XCTAssertEqual(hits[2].id, "other:9")             // kind-qualified identity
    }

    func testRankPutsFlaggedAndWarrantsFirst() {
        let hits = [
            IntelHit(kind: .citation, entityID: 1, label: "Cite", snippet: "", flags: []),
            IntelHit(kind: .person, entityID: 2, label: "Zed", snippet: "", flags: []),
            IntelHit(kind: .person, entityID: 3, label: "Amy", snippet: "", flags: ["CAUTION"]),
            IntelHit(kind: .warrant, entityID: 4, label: "Warr", snippet: "", flags: []),
        ]
        let ranked = CommandSearch.rank(hits)
        XCTAssertEqual(ranked[0].entityID, 3)             // flagged person wins outright
        XCTAssertEqual(ranked[1].kind, .warrant)          // then warrant (priority 0)
        XCTAssertEqual(ranked[2].entityID, 2)             // unflagged person before citation
        XCTAssertEqual(ranked[3].kind, .citation)
    }

    func testRankStableByLabelWithinKind() {
        let hits = [
            IntelHit(kind: .person, entityID: 1, label: "Bravo", snippet: "", flags: []),
            IntelHit(kind: .person, entityID: 2, label: "alpha", snippet: "", flags: []),
        ]
        let ranked = CommandSearch.rank(hits)
        XCTAssertEqual(ranked[0].label, "alpha")          // case-insensitive A before B
        XCTAssertEqual(ranked[1].label, "Bravo")
    }

    func testSniffClassifies() {
        XCTAssertEqual(CommandSearch.sniff("7ABC123"), .plate)
        XCTAssertEqual(CommandSearch.sniff("01/02/1990"), .dob)
        XCTAssertEqual(CommandSearch.sniff("1990-01-02"), .dob)
        XCTAssertEqual(CommandSearch.sniff("24-001234"), .caseNumber)
        XCTAssertEqual(CommandSearch.sniff("801 555 1234"), .phone)
        XCTAssertEqual(CommandSearch.sniff("John Smith"), .name)
        XCTAssertEqual(CommandSearch.sniff("Smith"), .name)
        XCTAssertEqual(CommandSearch.sniff(""), .generic)
        XCTAssertNil(QueryHint.generic.label)
        XCTAssertNotNil(QueryHint.plate.label)
    }

    func testKindMapping() {
        XCTAssertEqual(IntelKind(raw: "PERSON"), .person)
        XCTAssertEqual(IntelKind(raw: "spaceship"), .other)
        for k in IntelKind.allCases {
            XCTAssertFalse(k.display.isEmpty)
            XCTAssertFalse(k.icon.isEmpty)
        }
        XCTAssertLessThan(IntelKind.warrant.priority, IntelKind.citation.priority)
    }

    func testPaletteHasUniqueWiredCommands() {
        let ids = CommandSearch.palette.map(\.id)
        XCTAssertTrue(ids.contains("panic"))
        XCTAssertTrue(ids.contains("dar"))
        XCTAssertEqual(Set(ids).count, ids.count)         // ids unique
        XCTAssertEqual(CommandSearch.palette.count, 7)
    }
}
