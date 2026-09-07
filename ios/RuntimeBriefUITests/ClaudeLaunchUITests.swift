import XCTest

final class ClaudeLaunchUITests: XCTestCase {
    @MainActor
    func testLiveNativeLaunchAndDesktopTakeover() throws {
        let bundle = Bundle(for: Self.self)
        func setting(_ key: String) -> String? {
            let value = ProcessInfo.processInfo.environment[key] ?? bundle.object(forInfoDictionaryKey: key) as? String
            return value.flatMap { $0.isEmpty || $0.hasPrefix("$(") ? nil : $0 }
        }
        guard setting("RUNTIMEBRIEF_E2E_CLAUDE_LIVE") == "1",
              let server = setting("RUNTIMEBRIEF_E2E_SERVER_URL"),
              let token = setting("RUNTIMEBRIEF_E2E_TOKEN"),
              let projectID = setting("RUNTIMEBRIEF_E2E_PROJECT_ID") else {
            throw XCTSkip("Set the explicit live Claude test flag and an isolated daemon project to run this native integration test.")
        }
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launchEnvironment["RUNTIMEBRIEF_E2E_CLEAR_STATE"] = "1"
        app.launchEnvironment["RUNTIMEBRIEF_E2E_SERVER_URL"] = server
        app.launchEnvironment["RUNTIMEBRIEF_E2E_TOKEN"] = token
        app.launch()
        let project = app.buttons["project-link-\(projectID)"]
        XCTAssertTrue(project.waitForExistence(timeout: 20))
        project.tap()
        let newTask = app.buttons["new-claude-task"]
        for _ in 0..<4 where !newTask.isHittable { app.swipeUp() }
        XCTAssertTrue(newTask.waitForExistence(timeout: 15))
        newTask.tap()
        let prompt = app.textFields["claude-task-prompt"]
        XCTAssertTrue(prompt.waitForExistence(timeout: 5))
        prompt.tap()
        prompt.typeText("Read README.md and reply IOS-NATIVE-HANDOFF-READY. Do not modify files or run commands.")
        app.buttons["start-claude-task"].tap()
        XCTAssertTrue(newTask.waitForExistence(timeout: 50))
        let ready = app.staticTexts["Ready to review"].firstMatch
        XCTAssertTrue(ready.waitForExistence(timeout: 90))
        let takeover = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@", "take-over-claude-")).firstMatch
        XCTAssertTrue(takeover.waitForExistence(timeout: 10))
        takeover.tap()
        XCTAssertTrue(app.staticTexts["In Claude Desktop"].firstMatch.waitForExistence(timeout: 50))
        let screenshot = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        screenshot.name = "Live native Claude Desktop handoff"
        screenshot.lifetime = .keepAlways
        add(screenshot)
    }

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
        let prompt = app.textFields["claude-task-prompt"]
        XCTAssertTrue(prompt.exists)
        prompt.tap()
        prompt.typeText("Review the fictional export validation")
        XCTAssertTrue(start.isEnabled)
        start.tap()
        XCTAssertTrue(newTask.waitForExistence(timeout: 10))
        XCTAssertTrue(app.staticTexts["Demo task ready to review. No work was sent to a Mac."].waitForExistence(timeout: 5))
        let screenshot = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        screenshot.name = "Claude task receipt"
        screenshot.lifetime = .keepAlways
        add(screenshot)
    }
}
