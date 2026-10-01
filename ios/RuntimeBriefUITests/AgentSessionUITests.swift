import XCTest

final class AgentSessionUITests: XCTestCase {
    @MainActor
    func testCodexAndCursorNativeConversationFlowInDemo() {
        continueAfterFailure = false
        for provider in ["Codex", "Cursor"] {
            let app = XCUIApplication()
            app.launchEnvironment["RUNTIMEBRIEF_E2E_CLEAR_STATE"] = "1"
            app.launchEnvironment["RUNTIMEBRIEF_E2E_DEMO"] = "1"
            app.launch()
            let project = app.buttons["project-link-demo-sample-tracker"]
            XCTAssertTrue(project.waitForExistence(timeout: 10)); project.tap()
            let newTask = app.buttons["new-claude-task"]
            for _ in 0..<4 where !newTask.isHittable { app.swipeUp() }
            XCTAssertTrue(newTask.waitForExistence(timeout: 10)); newTask.tap()
            app.buttons["session-provider-picker"].tap()
            app.buttons[provider].tap()
            let remoteToggle = app.switches["claude-remote-control-toggle"]
            for _ in 0..<4 where !remoteToggle.isHittable { app.swipeUp() }
            XCTAssertEqual(remoteToggle.value as? String, "1")
            app.swipeDown()
            let modelPicker = app.buttons["session-model-picker"]
            selectMenuOption("Demo model", picker: modelPicker, app: app)
            let reasoning = app.buttons["session-reasoning-picker"]
            assertSelection(reasoning, contains: "Default")
            selectMenuOption("High", picker: reasoning, app: app)
            let permissions = app.buttons["session-permissions-picker"]
            selectMenuOption("Bypass", picker: permissions, app: app)
            let options = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
            options.name = "\(provider) selected model and Bypass"; options.lifetime = .keepAlways; add(options)
            let prompt = app.textFields["claude-task-prompt"]
            for _ in 0..<6 where prompt.frame.minY < 120 || !prompt.isHittable { app.swipeDown() }
            prompt.tap(); prompt.typeText("Inspect the fictional native conversation")
            app.buttons["start-claude-task"].tap()
            XCTAssertTrue(newTask.waitForExistence(timeout: 10))
            let settings = app.staticTexts.matching(NSPredicate(
                format: "label BEGINSWITH %@ AND label CONTAINS %@ AND label CONTAINS %@",
                "Started with", "demo-model", "Bypass"
            )).firstMatch
            XCTAssertTrue(settings.waitForExistence(timeout: 10), "The receipt must preserve the chosen model and permissions.")
            let terminal = app.buttons["open-session-conversation"].firstMatch
            for _ in 0..<4 where !terminal.isHittable { app.swipeUp() }
            XCTAssertTrue(terminal.waitForExistence(timeout: 10)); terminal.tap()
            let input = app.textFields["session-conversation-input"]
            XCTAssertTrue(input.waitForExistence(timeout: 10)); input.tap(); input.typeText("FOLLOW-UP-UI")
            app.buttons["session-conversation-send"].tap()
            let response = app.staticTexts.matching(identifier: "session-message-assistant")
                .matching(NSPredicate(format: "label CONTAINS %@", "Demo received your response")).firstMatch
            XCTAssertTrue(response.waitForExistence(timeout: 15))
            let screenshot = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
            screenshot.name = "\(provider) native conversation demo"; screenshot.lifetime = .keepAlways; add(screenshot)
            app.buttons["Done"].tap()
            app.terminate()
        }
    }

    @MainActor
    private func selectMenuOption(_ label: String, picker: XCUIElement, app: XCUIApplication,
                                  file: StaticString = #filePath, line: UInt = #line) {
        for _ in 0..<6 {
            if picker.frame.minY < 120 { app.swipeDown() }
            else if picker.frame.maxY > app.frame.maxY - 160 || !picker.isHittable { app.swipeUp() }
            else { break }
        }
        let option = app.buttons[label]
        picker.tap()
        for _ in 0..<3 {
            XCTAssertTrue(option.waitForExistence(timeout: 3), file: file, line: line)
            option.tap()
            let selected = XCTNSPredicateExpectation(predicate: NSPredicate(format: "label CONTAINS %@", label), object: picker)
            if XCTWaiter.wait(for: [selected], timeout: 2) == .completed { return }
            // Simulator menu taps can be ignored while its layout is settling.
            // Retry the same visible choice and still verify the saved receipt.
            if !option.exists { picker.tap() }
        }
        assertSelection(picker, contains: label, file: file, line: line)
    }

    @MainActor
    private func assertSelection(_ picker: XCUIElement, contains value: String,
                                 file: StaticString = #filePath, line: UInt = #line) {
        // SwiftUI can publish the menu selection after XCTest's idle check.
        // Wait for the actual selected value; an incorrect/reset value still fails.
        let selected = XCTNSPredicateExpectation(predicate: NSPredicate(format: "label CONTAINS %@", value), object: picker)
        let result = XCTWaiter.wait(for: [selected], timeout: 10)
        XCTAssertEqual(result, .completed, "Expected selection \(value); observed \(picker.label)", file: file, line: line)
    }
}
