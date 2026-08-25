import XCTest

final class DemoModeUITests: XCTestCase {
    override func setUpWithError() throws {
        continueAfterFailure = false
    }

    func testFirstLaunchExploresCompleteOfflineDemo() {
        let app = XCUIApplication()
        app.launchEnvironment["RUNTIMEBRIEF_E2E_CLEAR_STATE"] = "1"
        app.launch()

        let explore = app.buttons["explore-demo"]
        XCTAssertTrue(explore.waitForExistence(timeout: 10))
        explore.tap()

        XCTAssertTrue(app.staticTexts["demo-data-banner"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.collectionViews["portfolio-brief-list"].exists)
        XCTAssertFalse(app.buttons["Settings"].exists)
        keepScreenshot(named: "01-portfolio")

        let sample = app.buttons["project-link-demo-sample-tracker"]
        XCTAssertTrue(sample.waitForExistence(timeout: 5))
        sample.tap()

        XCTAssertTrue(app.staticTexts["demo-detail-banner"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.buttons["brief-section-toggle"].exists)
        XCTAssertTrue(app.buttons["ios-release-section-toggle"].exists)
        keepScreenshot(named: "02-project-brief")

        let analyst = app.buttons["generate-analyst-update"]
        for _ in 0..<4 where !analyst.exists { app.swipeUp() }
        XCTAssertTrue(analyst.waitForExistence(timeout: 5))
        analyst.tap()
        XCTAssertTrue(app.staticTexts["Demo response"].waitForExistence(timeout: 5))
        keepScreenshot(named: "03-analyst-update")

        let question = app.textFields["demo-question-field"]
        for _ in 0..<4 where !question.exists { app.swipeUp() }
        XCTAssertTrue(question.waitForExistence(timeout: 5))
        question.tap()
        question.typeText("Did the fictional checks pass?")
        app.buttons["submit-project-question"].tap()
        XCTAssertTrue(app.staticTexts["project-answer"].waitForExistence(timeout: 5))

        app.navigationBars.buttons.firstMatch.tap()
        let exitDemo = app.buttons["exit-demo"]
        XCTAssertTrue(exitDemo.waitForExistence(timeout: 5))
        exitDemo.tap()
        XCTAssertTrue(app.buttons["explore-demo"].waitForExistence(timeout: 5))
    }

    private func keepScreenshot(named name: String) {
        let attachment = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }
}
