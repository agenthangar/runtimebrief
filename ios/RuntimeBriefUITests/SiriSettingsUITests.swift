import XCTest

final class SiriSettingsUITests: XCTestCase {
    @MainActor
    func testDiscoverySettingCanChangeWithoutSavingAConnection() {
        let app = XCUIApplication()
        app.launchEnvironment["RUNTIMEBRIEF_E2E_CLEAR_STATE"] = "1"
        app.launch()
        app.buttons["connect-your-mac"].tap()
        let toggle = app.switches["siri-discovery-toggle"]
        XCTAssertTrue(toggle.waitForExistence(timeout: 5))
        let previous = toggle.value as? String
        let expected = previous == "1" ? "0" : "1"
        // SwiftUI exposes the full row as the switch accessibility frame.
        // Tap its trailing control, matching the actual user interaction.
        toggle.coordinate(withNormalizedOffset: CGVector(dx: 0.9, dy: 0.5)).tap()
        XCTAssertEqual(toggle.value as? String, expected)
        app.buttons["Cancel"].tap()
        app.buttons["connect-your-mac"].tap()
        XCTAssertEqual(app.switches["siri-discovery-toggle"].value as? String, expected)
        app.switches["siri-discovery-toggle"].coordinate(withNormalizedOffset: CGVector(dx: 0.9, dy: 0.5)).tap()
    }

}
