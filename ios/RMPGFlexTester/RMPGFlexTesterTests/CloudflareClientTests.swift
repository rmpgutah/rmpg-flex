import XCTest
@testable import RMPGFlexTester

final class CloudflareClientTests: XCTestCase {
    func testParseD1List() throws {
        let json = """
        {"success":true,"errors":[],"result":[
          {"uuid":"785de7ae-3e7a-4e01-93bb-d24ddd813f6b","name":"rmpg-flex",
           "file_size":6291456,"num_tables":180}
        ]}
        """.data(using: .utf8)!
        let r = try CloudflareClient.parseList(json, section: .d1)
        XCTAssertEqual(r.count, 1)
        XCTAssertEqual(r[0].title, "rmpg-flex")
        XCTAssertTrue(r[0].subtitle.contains("6.0 MB"))
        XCTAssertTrue(r[0].subtitle.contains("180 tables"))
    }

    func testParseR2NestedBuckets() throws {
        let json = """
        {"success":true,"errors":[],"result":{"buckets":[
          {"name":"system-essentials","creation_date":"2026-05-24T00:00:00Z"}
        ]}}
        """.data(using: .utf8)!
        let r = try CloudflareClient.parseList(json, section: .r2)
        XCTAssertEqual(r.map(\.title), ["system-essentials"])
    }

    func testParseErrorSurfacesMessage() {
        let json = """
        {"success":false,"errors":[{"message":"Authentication error"}],"result":null}
        """.data(using: .utf8)!
        XCTAssertThrowsError(try CloudflareClient.parseList(json, section: .workers)) {
            XCTAssertTrue($0.localizedDescription.contains("Authentication error"))
        }
    }

    func testParseWorkersList() throws {
        let json = """
        {"success":true,"errors":[],"result":[
          {"id":"rmpg-flex","modified_on":"2026-06-11T01:00:00Z"},
          {"id":"rmpg-flex-api","modified_on":"2026-06-10T01:00:00Z"}
        ]}
        """.data(using: .utf8)!
        let r = try CloudflareClient.parseList(json, section: .workers)
        XCTAssertEqual(r.map(\.title), ["rmpg-flex", "rmpg-flex-api"])
    }
}
