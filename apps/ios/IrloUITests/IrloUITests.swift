import XCTest

final class IrloUITests: XCTestCase {
    /// Canary: the app launches to the placeholder screen. One real journey
    /// per client story arrives with Stage 1+ (docs/user-stories.md).
    @MainActor
    func testLaunchShowsPlaceholderScreen() {
        let app = XCUIApplication()
        app.launch()

        XCTAssertTrue(app.staticTexts["Irlo"].waitForExistence(timeout: 10))
    }
}
