import XCTest

@testable import Irlo

final class IrloTests: XCTestCase {
    /// Canary: the root screen exposes a stable accessibility identifier that
    /// UI tests (and later, snapshot tests) key on. Written before the
    /// constant existed — see the commit body for the red run.
    func testRootViewExposesStableAccessibilityIdentifier() {
        XCTAssertEqual(RootView.accessibilityID, "root.placeholder")
    }
}
