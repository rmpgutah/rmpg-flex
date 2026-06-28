import XCTest
@testable import CoreAuth

final class RoleResolverTests: XCTestCase {
    func testAdminMapsToSupervisor() {
        XCTAssertEqual(RoleResolver.resolve(jwtRole: "admin"), .supervisor)
    }

    func testManagerMapsToSupervisor() {
        XCTAssertEqual(RoleResolver.resolve(jwtRole: "manager"), .supervisor)
    }

    func testSupervisorMapsToSupervisor() {
        XCTAssertEqual(RoleResolver.resolve(jwtRole: "supervisor"), .supervisor)
    }

    func testOfficerMapsToOfficer() {
        XCTAssertEqual(RoleResolver.resolve(jwtRole: "officer"), .officer)
    }

    func testContractManagerMapsToOfficer() {
        // contract_manager is a field role per spec §11.3
        XCTAssertEqual(RoleResolver.resolve(jwtRole: "contract_manager"), .officer)
    }

    func testCaseInsensitive() {
        XCTAssertEqual(RoleResolver.resolve(jwtRole: "ADMIN"), .supervisor)
        XCTAssertEqual(RoleResolver.resolve(jwtRole: "Officer"), .officer)
    }

    func testNilDefaultsToOfficer() {
        XCTAssertEqual(RoleResolver.resolve(jwtRole: nil), .officer)
    }

    func testUnknownDefaultsToOfficer() {
        XCTAssertEqual(RoleResolver.resolve(jwtRole: "fart"), .officer)
    }
}
