import XCTest

final class AgentSessionUITests: XCTestCase {
    /// Explicit live coverage uses an isolated daemon and already-running native fixtures.
    @MainActor
    func testLiveCodexAndCursorTerminalContinuation() async throws {
        let environment = ProcessInfo.processInfo.environment
        guard environment["RUNTIMEBRIEF_E2E_NATIVE_LIVE"] == "1",
              let server = environment["RUNTIMEBRIEF_E2E_SERVER_URL"],
              let token = environment["RUNTIMEBRIEF_E2E_TOKEN"],
              let projectID = environment["RUNTIMEBRIEF_E2E_PROJECT_ID"],
              let url = URL(string: "\(server)/v1/projects/\(projectID)/sessions")
        else { throw XCTSkip("Configure an isolated native-session fixture for live terminal coverage.") }
        var request = URLRequest(url: url)
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        let (data, _) = try await URLSession.shared.data(for: request)
        let body = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
        let launches = try XCTUnwrap(body["launches"] as? [[String: Any]])
        continueAfterFailure = false
        for provider in ["codex", "cursor"] {
            let receipt = try XCTUnwrap(launches.first { $0["provider"] as? String == provider && ($0["remoteControl"] as? [String: Any])?["state"] as? String == "ready" })
            let id = try XCTUnwrap(receipt["id"] as? String)
            let app = XCUIApplication()
            app.launchEnvironment["RUNTIMEBRIEF_E2E_CLEAR_STATE"] = "1"
            app.launchEnvironment["RUNTIMEBRIEF_E2E_SERVER_URL"] = server
            app.launchEnvironment["RUNTIMEBRIEF_E2E_TOKEN"] = token
            app.launch()
            let project = app.buttons["project-link-\(projectID)"]
            XCTAssertTrue(project.waitForExistence(timeout: 15)); project.tap()
            let receiptView = app.descendants(matching: .any)["claude-launch-\(id)"]
            let terminal = receiptView.buttons["open-session-terminal"]
            for _ in 0..<10 where !terminal.isHittable { app.swipeUp() }
            XCTAssertTrue(terminal.waitForExistence(timeout: 10)); terminal.tap()
            let input = app.textFields["session-terminal-input"]
            XCTAssertTrue(input.waitForExistence(timeout: 10))
            let marker = "IOS-\(provider.uppercased())-\(UUID().uuidString.prefix(8))"
            input.tap(); input.typeText("Reply exactly \(marker). Then recall the text you put in native-proof.txt earlier.")
            app.buttons["session-terminal-send"].tap()
            let screen = app.descendants(matching: .any)["session-terminal-screen"]
            // Wait for the native reply as well as the single submitted prompt echo.
            let replied = NSPredicate { value, _ in
                guard let element = value as? XCUIElement else { return false }
                return element.label.components(separatedBy: marker).count >= 3
            }
            let observed = expectation(for: replied, evaluatedWith: screen)
            await fulfillment(of: [observed], timeout: 45)
            let screenshot = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
            screenshot.name = "\(provider) live native terminal"; screenshot.lifetime = .keepAlways; add(screenshot)
            app.buttons["Done"].tap(); app.terminate()
        }
    }

    @MainActor
    func testCodexAndCursorNativeTerminalFlowInDemo() {
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
            XCTAssertEqual(app.switches["claude-remote-control-toggle"].value as? String, "1")
            let modelPicker = app.buttons["session-model-picker"]
            modelPicker.tap(); app.buttons["Demo model"].tap()
            XCTAssertTrue(modelPicker.label.contains("Demo model"))
            let permissions = app.buttons["session-permissions-picker"]
            permissions.tap(); app.buttons["Bypass"].tap()
            XCTAssertTrue(permissions.label.contains("Bypass"))
            let options = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
            options.name = "\(provider) selected model and Bypass"; options.lifetime = .keepAlways; add(options)
            let prompt = app.textFields["claude-task-prompt"]
            prompt.tap(); prompt.typeText("Inspect the fictional native terminal")
            app.buttons["start-claude-task"].tap()
            XCTAssertTrue(newTask.waitForExistence(timeout: 10))
            let terminal = app.buttons["open-session-terminal"].firstMatch
            for _ in 0..<4 where !terminal.isHittable { app.swipeUp() }
            XCTAssertTrue(terminal.waitForExistence(timeout: 10)); terminal.tap()
            let input = app.textFields["session-terminal-input"]
            XCTAssertTrue(input.waitForExistence(timeout: 10)); input.tap(); input.typeText("FOLLOW-UP-UI")
            app.buttons["session-terminal-send"].tap()
            let screen = app.descendants(matching: .any)["session-terminal-screen"]
            let received = NSPredicate(format: "label CONTAINS %@", "Demo received input")
            expectation(for: received, evaluatedWith: screen)
            waitForExpectations(timeout: 15)
            let screenshot = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
            screenshot.name = "\(provider) remote terminal demo"; screenshot.lifetime = .keepAlways; add(screenshot)
            app.buttons["Done"].tap()
            app.terminate()
        }
    }
}
