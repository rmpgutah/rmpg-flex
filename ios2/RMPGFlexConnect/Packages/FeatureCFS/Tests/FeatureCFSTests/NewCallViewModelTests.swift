import XCTest
import CoreAPI
@testable import FeatureCFS

@MainActor
final class NewCallViewModelTests: XCTestCase {
    private func makeVM() -> NewCallViewModel {
        let client = APIClient(baseURL: URL(string: "https://x")!)
        return NewCallViewModel(api: CFSAPI(client: client))
    }

    func testInitialStateIsIdleWithDefaultType() {
        let vm = makeVM()
        XCTAssertEqual(vm.state, .idle)
        XCTAssertEqual(vm.callType, CallTypeRegistry.common.first!)
    }

    func testCanSubmitRequiresLocationAndType() {
        let vm = makeVM()
        XCTAssertFalse(vm.canSubmit)
        vm.location = "800 S Main"
        XCTAssertTrue(vm.canSubmit)
    }

    func testFreeTextTypeRequiredWhenOther() {
        let vm = makeVM()
        vm.location = "800 S Main"
        vm.callType = CallTypeRegistry.common.first(where: { $0.id == "OTHER" })!
        XCTAssertFalse(vm.canSubmit, "OTHER without free text must not be submittable")
        vm.freeTextType = "Civil dispute"
        XCTAssertTrue(vm.canSubmit)
    }

    func testResolvedTypeCodePicksRightSource() {
        let vm = makeVM()
        vm.callType = CallTypeRegistry.common.first(where: { $0.id == "10-91" })!
        XCTAssertEqual(vm.resolvedTypeCode, "10-91")
        vm.callType = CallTypeRegistry.common.first(where: { $0.id == "OTHER" })!
        vm.freeTextType = "  Civil dispute  "
        XCTAssertEqual(vm.resolvedTypeCode, "Civil dispute") // trimmed
    }

    func testRegistryHasExpectedSize() {
        XCTAssertEqual(CallTypeRegistry.common.count, 10)
        XCTAssertTrue(CallTypeRegistry.common.last?.id == "OTHER")
    }
}
