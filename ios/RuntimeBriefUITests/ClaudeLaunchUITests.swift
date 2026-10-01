import XCTest

final class ClaudeLaunchUITests: XCTestCase {
    @MainActor
    func testLiveNativeLaunchAndVerifiedContinuation() throws {
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
        let cards = app.otherElements.matching(NSPredicate(format: "identifier BEGINSWITH %@", "claude-launch-"))
        let existingIDs = Set(cards.allElementsBoundByIndex.map(\.identifier))
        newTask.tap()
        let prompt = app.textFields["claude-task-prompt"]
        XCTAssertTrue(prompt.waitForExistence(timeout: 5))
        prompt.tap()
        prompt.typeText("Read README.md and reply IOS-NATIVE-HANDOFF-READY. Do not modify files or run commands. Fixture run \(UUID().uuidString).")
        let start = app.buttons["start-claude-task"]
        XCTAssertTrue(start.waitForExistence(timeout: 5))
        let ready = NSPredicate(format: "enabled == 1")
        XCTAssertEqual(XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: ready, object: start)], timeout: 30), .completed)
        start.tap()
        let dismissed = NSPredicate(format: "exists == 0")
        XCTAssertEqual(XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: dismissed, object: prompt)], timeout: 50), .completed)
        XCTAssertTrue(newTask.waitForExistence(timeout: 50))
        let newCard = cards.matching(NSPredicate(format: "NOT (identifier IN %@)", Array(existingIDs))).firstMatch
        XCTAssertTrue(newCard.waitForExistence(timeout: 30))
        let newID = String(newCard.identifier.dropFirst("claude-launch-".count))
        let card = app.otherElements["claude-launch-\(newID)"]
        for _ in 0..<4 where !card.isHittable { app.swipeUp() }
        XCTAssertTrue(card.staticTexts["Ready to review"].waitForExistence(timeout: 90))
        let continuation = app.buttons["remote-control-\(newID)"]
        for _ in 0..<4 where !continuation.isHittable { app.swipeUp() }
        XCTAssertTrue(continuation.waitForExistence(timeout: 120))
        XCTAssertFalse(app.buttons["take-over-claude-\(newID)"].exists)
        let screenshot = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        screenshot.name = "Live native Claude verified continuation"
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
