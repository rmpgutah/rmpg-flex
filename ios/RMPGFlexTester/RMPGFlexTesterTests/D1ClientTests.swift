import XCTest
@testable import RMPGFlexTester

final class D1ClientTests: XCTestCase {
    func testParseSuccessWithRows() throws {
        let json = """
        {"success":true,"errors":[],"result":[{"results":[
            {"id":1,"name":"Alpha","note":null},
            {"id":2,"name":"Bravo","note":"x"}
        ],"meta":{"duration":1.2,"changes":0}}]}
        """.data(using: .utf8)!
        let r = try D1Client.parse(json)
        XCTAssertEqual(r.columns, ["id", "name", "note"])
        XCTAssertEqual(r.rows.count, 2)
        XCTAssertEqual(r.rows[0], ["1", "Alpha", "NULL"])
        XCTAssertNotNil(r.meta)
    }

    func testParseSuccessEmpty() throws {
        let json = """
        {"success":true,"errors":[],"result":[{"results":[],"meta":{"duration":0.4,"changes":0}}]}
        """.data(using: .utf8)!
        let r = try D1Client.parse(json)
        XCTAssertTrue(r.columns.isEmpty)
        XCTAssertTrue(r.rows.isEmpty)
    }

    func testParseErrorThrowsWithMessage() {
        let json = """
        {"success":false,"errors":[{"code":7500,"message":"no such table: nope"}],"result":[]}
        """.data(using: .utf8)!
        XCTAssertThrowsError(try D1Client.parse(json)) { error in
            XCTAssertTrue("\(error.localizedDescription)".contains("no such table"))
        }
    }
}
