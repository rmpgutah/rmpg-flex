import XCTest
@testable import FeatureShell
@testable import CoreAPI
@testable import CoreAuth

@MainActor
final class LoginViewModelTests: XCTestCase {
    func testCanSubmitRequiresBothFields() {
        let session = AuthSession()
        let client = APIClient(baseURL: URL(string: "https://x")!)
        let vm = LoginViewModel(authAPI: AuthAPI(client: client), session: session)
        XCTAssertFalse(vm.canSubmit)
        vm.username = "user"
        XCTAssertFalse(vm.canSubmit)
        vm.password = "pw"
        XCTAssertTrue(vm.canSubmit)
    }

    func testInitialStateIsIdle() {
        let session = AuthSession()
        let client = APIClient(baseURL: URL(string: "https://x")!)
        let vm = LoginViewModel(authAPI: AuthAPI(client: client), session: session)
        XCTAssertEqual(vm.state, .idle)
    }
}
