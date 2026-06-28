import XCTest
@testable import RMPGFlexTester

final class MultipartBodyTests: XCTestCase {
    func testFramesFieldsAndFile() {
        let data = buildMultipartBody(
            boundary: "B",
            fields: ["notes": "hello", "empty": ""],
            fileField: "photo", filename: "field.jpg", mime: "image/jpeg",
            fileData: Data([0x01, 0x02]))
        let s = String(data: data, encoding: .utf8) ?? ""
        XCTAssertTrue(s.contains("--B\r\nContent-Disposition: form-data; name=\"notes\"\r\n\r\nhello\r\n"))
        XCTAssertFalse(s.contains("name=\"empty\""))
        XCTAssertTrue(s.contains("name=\"photo\"; filename=\"field.jpg\""))
        XCTAssertTrue(s.contains("Content-Type: image/jpeg"))
        XCTAssertTrue(s.hasSuffix("--B--\r\n"))
    }
}
