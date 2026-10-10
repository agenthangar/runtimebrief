import XCTest

final class DemoModeUITests: XCTestCase {
    override func setUpWithError() throws {
        continueAfterFailure = false
    }

    @MainActor
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
        XCTAssertTrue(app.buttons["ios-release-section-toggle"].waitForExistence(timeout: 5))
        let analystToggle = app.buttons["analyst-section-toggle"]
        XCTAssertEqual(analystToggle.value as? String, "Expanded")
        let analyst = app.staticTexts["analyst-update-text"]
        XCTAssertTrue(analyst.waitForExistence(timeout: 5))
        XCTAssertFalse(analyst.label.contains("[demo-evidence-"))
        XCTAssertFalse(app.staticTexts["Commit a1b2c3d"].exists)
        XCTAssertFalse(app.staticTexts["Evidence"].exists)
        XCTAssertFalse(app.descendants(matching: .any)["evidence-source"].exists)
        XCTAssertFalse(app.buttons["generate-analyst-update"].exists)
        keepScreenshot(named: "02-automatic-analysis")
        analystToggle.tap()
        let orderedSections = [
            analystToggle, app.buttons["brief-section-toggle"], app.buttons["ask-section-toggle"],
            app.buttons["sessions-section-toggle"], app.buttons["new-claude-task"],
            app.buttons["commits-section-toggle"], app.buttons["ios-release-section-toggle"],
        ]
        for (first, second) in zip(orderedSections, orderedSections.dropFirst()) {
            XCTAssertLessThan(first.frame.minY, second.frame.minY, "Project sections must follow the requested order.")
        }
        for id in ["brief", "ask", "sessions", "commits", "ios-release"] {
            let toggle = app.buttons["\(id)-section-toggle"]
            for _ in 0..<4 where !toggle.isHittable { app.swipeUp() }
            XCTAssertTrue(toggle.exists)
            XCTAssertEqual(toggle.value as? String, "Collapsed")
        }
        app.swipeDown(); app.swipeDown(); app.swipeDown()
        let brief = app.buttons["brief-section-toggle"]
        // Tap the header, not the center of the expanded card; its center
        // moves into the evidence content after expansion.
        let briefHeader = brief.coordinate(withNormalizedOffset: CGVector(dx: 0.9, dy: 0.1))
        briefHeader.tap(); XCTAssertEqual(brief.value as? String, "Expanded")
        briefHeader.tap(); XCTAssertEqual(brief.value as? String, "Collapsed")
        keepScreenshot(named: "02-project-brief")
        app.buttons["analyst-section-toggle"].tap()

        for _ in 0..<4 where !analyst.exists { app.swipeUp() }
        XCTAssertTrue(analyst.waitForExistence(timeout: 5))
        XCTAssertFalse(app.buttons["generate-analyst-update"].exists)
        XCTAssertTrue(app.staticTexts["Demo response"].waitForExistence(timeout: 5))
        keepScreenshot(named: "03-analyst-update")
        analystToggle.tap()

        app.buttons["ask-section-toggle"].tap()
        let question = app.textFields["demo-question-field"]
        for _ in 0..<4 where !question.exists { app.swipeUp() }
        XCTAssertTrue(question.waitForExistence(timeout: 5))
        question.tap()
        question.typeText("Did the fictional checks pass?")
        if app.buttons["Done"].exists { app.buttons["Done"].tap() }
        let submit = app.buttons["submit-project-question"]
        for _ in 0..<4 where !submit.isHittable { app.swipeUp() }
        submit.tap()
        XCTAssertTrue(app.staticTexts["project-answer"].waitForExistence(timeout: 5))
        XCTAssertFalse(app.staticTexts["project-answer"].label.contains("[demo-evidence-"))
        XCTAssertFalse(app.staticTexts["Evidence"].exists)
        XCTAssertFalse(app.descendants(matching: .any)["evidence-source"].exists)

        app.navigationBars.buttons.firstMatch.tap()
        let exitDemo = app.buttons["exit-demo"]
        XCTAssertTrue(exitDemo.waitForExistence(timeout: 10))
        exitDemo.tap()
        // Match the first-launch wait. Exit Demo kicks a live refresh that can
        // briefly stall on Spotlight maintenance on the hosted simulator.
        XCTAssertTrue(
            app.buttons["explore-demo"].waitForExistence(timeout: 10),
            "Exit Demo should return to the first-launch empty state."
        )
    }

    @MainActor
    private func keepScreenshot(named name: String) {
        let attachment = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }
}
