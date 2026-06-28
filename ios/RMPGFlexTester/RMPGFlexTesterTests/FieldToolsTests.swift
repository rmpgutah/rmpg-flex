import XCTest
@testable import RMPGFlexTester

final class FieldToolsTests: XCTestCase {
    func testRegistryHasAtLeast100UniqueTools() {
        let tools = FieldToolRegistry.tools
        XCTAssertGreaterThanOrEqual(tools.count, 100, "registry has \(tools.count) tools")
        XCTAssertEqual(Set(tools.map(\.id)).count, tools.count, "tool ids must be unique")
    }

    func testEveryToolBelongsToAKnownCategory() {
        let cats = Set(FieldToolRegistry.categories)
        for tool in FieldToolRegistry.tools {
            XCTAssertTrue(cats.contains(tool.category), "\(tool.id) has unknown category \(tool.category)")
        }
    }

    func testLookupsWithQueryKeyHavePrompts() {
        for tool in FieldToolRegistry.tools {
            if case .lookup(_, let key, let prompt) = tool.action, key != nil {
                XCTAssertNotNil(prompt, "\(tool.id) needs an input prompt")
            }
        }
    }

    func testReferenceCardsAreNonTrivial() {
        for tool in FieldToolRegistry.tools {
            if case .reference(let text) = tool.action {
                XCTAssertGreaterThan(text.count, 80, "\(tool.id) reference looks empty")
            }
        }
    }
}
