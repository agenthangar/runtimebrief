import XCTest

final class ClaudeLaunchUITests: XCTestCase {
    func testLaunchComposerValidationAndOfflineReceipt() {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launchEnvironment["RUNTIMEBRIEF_E2E_CLEAR_STATE"] = "1"
        app.launchEnvironment["RUNTIMEBRIEF_E2E_DEMO"] = "1"
        app.launch()
        let project = app.buttons["project-link-demo-sample-tracker"]
        XCTAssertTrue(project.waitForExistence(timeout: 10))
        project.tap()
        let newTask = app.buttons["new-claude-task"]
        for _ in 0..<3 where !newTask.isHittable { app.swipeUp() }
        XCTAssertTrue(newTask.waitForExistence(timeout: 5))
        newTask.tap()
        let start = app.buttons["start-claude-task"]
        XCTAssertTrue(start.waitForExistence(timeout: 5))
        XCTAssertFalse(start.isEnabled)
        let remoteToggle = app.switches["claude-remote-control-toggle"]
        for _ in 0..<4 where !remoteToggle.isHittable { app.swipeUp() }
        XCTAssertEqual(remoteToggle.value as? String, "1")
        app.swipeDown()
        app.buttons["claude-model-picker"].tap()
        app.buttons["Sonnet"].tap()
        app.buttons["claude-permissions-picker"].tap()
        app.buttons["Auto"].tap()
        app.buttons["claude-permissions-picker"].tap()
        app.buttons["Bypass"].tap()
        let prompt = app.textFields["claude-task-prompt"]
        XCTAssertTrue(prompt.exists)
        prompt.tap()
        prompt.typeText("Review the fictional export validation")
        XCTAssertTrue(start.isEnabled)
        start.tap()
        XCTAssertTrue(newTask.waitForExistence(timeout: 10))
        XCTAssertTrue(app.staticTexts["Demo task ready to review. No work was sent to a Mac."].waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["Started with Sonnet · Bypass"].exists)
        XCTAssertTrue(app.staticTexts["Remote Control connected"].exists)
        let remote = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@", "remote-control-")).firstMatch
        XCTAssertTrue(remote.exists)
        remote.tap()
        XCTAssertTrue(app.staticTexts["Demo only. No session was opened."].waitForExistence(timeout: 5))
        let screenshot = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        screenshot.name = "Claude task receipt"
        screenshot.lifetime = .keepAlways
        add(screenshot)
    }
}
