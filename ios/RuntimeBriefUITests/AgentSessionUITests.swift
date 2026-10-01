import XCTest

final class AgentSessionUITests: XCTestCase {
    /// Explicit live coverage uses an isolated daemon and already-running native fixtures.
    @MainActor
    func testLiveCodexAndCursorConversationContinuation() async throws {
        let bundle = Bundle(for: Self.self)
        let environment = ProcessInfo.processInfo.environment
        func setting(_ key: String) -> String? {
            let value = environment[key] ?? bundle.object(forInfoDictionaryKey: key) as? String
            return value.flatMap { $0.isEmpty || $0.hasPrefix("$(") ? nil : $0 }
        }
        guard setting("RUNTIMEBRIEF_E2E_NATIVE_LIVE") == "1",
              let server = setting("RUNTIMEBRIEF_E2E_SERVER_URL"),
              let token = setting("RUNTIMEBRIEF_E2E_TOKEN"),
              let projectID = setting("RUNTIMEBRIEF_E2E_PROJECT_ID"),
              URL(string: "\(server)/v1/projects/\(projectID)/sessions") != nil
        else { throw XCTSkip("Configure an isolated native-session fixture for live conversation coverage.") }
        continueAfterFailure = false
        for provider in ["Codex", "Cursor"] {
            let app = XCUIApplication()
            app.launchEnvironment["RUNTIMEBRIEF_E2E_CLEAR_STATE"] = "1"
            app.launchEnvironment["RUNTIMEBRIEF_E2E_SERVER_URL"] = server
            app.launchEnvironment["RUNTIMEBRIEF_E2E_TOKEN"] = token
            app.launch()
            let project = app.buttons["project-link-\(projectID)"]
            XCTAssertTrue(project.waitForExistence(timeout: 20)); project.tap()
            let newTask = app.buttons["new-claude-task"]
            for _ in 0..<8 where !newTask.isHittable { app.swipeUp() }
            XCTAssertTrue(newTask.waitForExistence(timeout: 15))
            let cards = app.otherElements.matching(NSPredicate(format: "identifier BEGINSWITH %@", "claude-launch-"))
            let before = Set(cards.allElementsBoundByIndex.map(\.identifier))
            newTask.tap()
            app.buttons["session-provider-picker"].tap(); app.buttons[provider].tap()
            let permissions = app.buttons["session-permissions-picker"]
            for _ in 0..<4 where !permissions.isHittable { app.swipeUp() }
            permissions.tap(); app.buttons[provider == "Codex" ? "Plan" : "Ask"].tap()
            let prompt = app.textFields["claude-task-prompt"]
            for _ in 0..<4 where !prompt.isHittable { app.swipeDown() }
            prompt.tap(); prompt.typeText("Do not run tools or change files. Reply IOS_NATIVE_BEGIN only.")
            app.buttons["start-claude-task"].tap()
            XCTAssertTrue(newTask.waitForExistence(timeout: 90))
            let card = cards.matching(NSPredicate(format: "NOT (identifier IN %@)", Array(before))).firstMatch
            XCTAssertTrue(card.waitForExistence(timeout: 20))
            let conversation = card.buttons["open-session-conversation"]
            for _ in 0..<8 where !conversation.isHittable { app.swipeUp() }
            XCTAssertTrue(conversation.waitForExistence(timeout: 120)); conversation.tap()
            let input = app.textFields["session-conversation-input"]
            XCTAssertTrue(input.waitForExistence(timeout: 20))
            let marker = "IOS-\(provider.uppercased())-\(UUID().uuidString.prefix(8))"
            input.tap(); input.typeText("Do not run tools. Reply exactly \(marker).")
            let send = app.buttons["session-conversation-send"]
            let ready = XCTNSPredicateExpectation(predicate: NSPredicate(format: "enabled == true"), object: send)
            XCTAssertEqual(XCTWaiter.wait(for: [ready], timeout: 120), .completed)
            send.tap()
            let response = app.staticTexts.matching(identifier: "session-message-assistant")
                .matching(NSPredicate(format: "label CONTAINS %@", marker)).firstMatch
            XCTAssertTrue(response.waitForExistence(timeout: 120), "The native provider must answer the UI follow-up.")
            if provider == "Codex" {
                input.tap(); input.typeText("Run only printf 'IOS_NATIVE_APPROVAL_READY' with sandbox_permissions=require_escalated. Ask for approval. Do not write files or run any other command.")
                send.tap()
                let approval = app.buttons["session-decision-accept"]
                XCTAssertTrue(approval.waitForExistence(timeout: 120))
                app.swipeUp()
                XCTAssertTrue(app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", "printf")).firstMatch.exists)
                approval.tap()
                let completed = app.staticTexts.matching(identifier: "session-message-assistant")
                    .matching(NSPredicate(format: "label CONTAINS %@", "IOS_NATIVE_APPROVAL_READY")).firstMatch
                XCTAssertTrue(completed.waitForExistence(timeout: 120))
            }
            let screenshot = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
            screenshot.name = "\(provider) live native conversation"; screenshot.lifetime = .keepAlways; add(screenshot)
            app.buttons["Done"].tap(); app.terminate()
        }
    }

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
            modelPicker.tap(); app.buttons["Demo model"].tap()
            assertSelection(modelPicker, contains: "Demo model")
            let reasoning = app.buttons["session-reasoning-picker"]
            assertSelection(reasoning, contains: "Default")
            reasoning.tap(); app.buttons["High"].tap()
            assertSelection(reasoning, contains: "High")
            let permissions = app.buttons["session-permissions-picker"]
            permissions.tap(); app.buttons["Bypass"].tap()
            assertSelection(permissions, contains: "Bypass")
            let options = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
            options.name = "\(provider) selected model and Bypass"; options.lifetime = .keepAlways; add(options)
            let prompt = app.textFields["claude-task-prompt"]
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
    private func assertSelection(_ picker: XCUIElement, contains value: String,
                                 file: StaticString = #filePath, line: UInt = #line) {
        // SwiftUI can publish the menu selection after XCTest's idle check.
        // Wait for the actual selected value; an incorrect/reset value still fails.
        let selected = XCTNSPredicateExpectation(predicate: NSPredicate(format: "label CONTAINS %@", value), object: picker)
        let result = XCTWaiter.wait(for: [selected], timeout: 10)
        XCTAssertEqual(result, .completed, "Expected selection \(value); observed \(picker.label)", file: file, line: line)
    }
}
