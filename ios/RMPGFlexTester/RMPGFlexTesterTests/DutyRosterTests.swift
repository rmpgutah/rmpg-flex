import XCTest
@testable import RMPGFlexTester

final class DutyRosterTests: XCTestCase {

    // ── JWTClaims ───────────────────────────────────────────

    private func makeJWT(payload: [String: Any]) -> String {
        let header = Data(#"{"alg":"HS256","typ":"JWT"}"#.utf8)
        let body = try! JSONSerialization.data(withJSONObject: payload)
        let b64 = { (d: Data) in
            d.base64EncodedString()
                .replacingOccurrences(of: "+", with: "-")
                .replacingOccurrences(of: "/", with: "_")
                .replacingOccurrences(of: "=", with: "")
        }
        return "\(b64(header)).\(b64(body)).sig"
    }

    func testDecodeLegacyUserIdAndRole() {
        let jwt = makeJWT(payload: ["userId": 7, "role": "admin", "username": "chz", "exp": 1780000000.0])
        let claims = JWTClaims.decode(jwt)
        XCTAssertEqual(claims?.userId, 7)
        XCTAssertEqual(claims?.role, "admin")
        XCTAssertEqual(claims?.name, "chz")
        XCTAssertTrue(claims?.isDispatchTier == true)
    }

    func testOfficerRoleIsNotDispatchTier() {
        let claims = JWTClaims.decode(makeJWT(payload: ["userId": 3, "role": "officer"]))
        XCTAssertEqual(claims?.isDispatchTier, false)
    }

    func testDispatchTierIsCaseInsensitive() {
        let claims = JWTClaims.decode(makeJWT(payload: ["userId": 3, "role": "Supervisor"]))
        XCTAssertEqual(claims?.isDispatchTier, true)
    }

    func testGarbageTokenReturnsNil() {
        XCTAssertNil(JWTClaims.decode("not-a-jwt"))
        XCTAssertNil(JWTClaims.decode("a.b.c"))
        XCTAssertNil(JWTClaims.decode(""))
    }

    // ── RosterOfficer parsing (mirrors the Worker's rosterRow contract) ──

    func testParsesOnShiftOfficer() {
        let o = RosterOfficer(json: [
            "officer_id": 3, "name": "B. Sgt", "role": "supervisor",
            "on_shift": true, "entry_id": 99, "clock_in": "2026-06-12T14:00:00+00:00",
            "hours_so_far": 2.0,
            "unit": ["id": 5, "call_sign": "D19", "status": "available", "current_call_id": NSNull()],
            "vehicle": ["id": 12, "vehicle_number": "PS-D19", "vehicle_name": "Tahoe"],
            "last_gps": ["lat": 40.7, "lng": -111.9, "at": "2026-06-12 19:00:00"],
        ])
        XCTAssertEqual(o?.id, 3)
        XCTAssertEqual(o?.onShift, true)
        XCTAssertEqual(o?.hoursSoFar, 2.0)
        XCTAssertEqual(o?.callSign, "D19")
        XCTAssertEqual(o?.onCall, false)
        XCTAssertEqual(o?.vehicleNumber, "PS-D19")
        XCTAssertEqual(o?.gpsAt, "2026-06-12 19:00:00")
    }

    func testParsesOffDutyOfficerWithNulls() {
        let o = RosterOfficer(json: [
            "officer_id": 7, "name": "A. Officer", "role": "officer",
            "on_shift": false, "entry_id": NSNull(), "clock_in": NSNull(),
            "hours_so_far": NSNull(), "unit": NSNull(), "vehicle": NSNull(), "last_gps": NSNull(),
        ])
        XCTAssertEqual(o?.onShift, false)
        XCTAssertNil(o?.callSign)
        XCTAssertNil(o?.hoursSoFar)
        XCTAssertNil(o?.gpsAt)
    }

    func testMissingOfficerIdRejected() {
        XCTAssertNil(RosterOfficer(json: ["name": "ghost"]))
    }
}
