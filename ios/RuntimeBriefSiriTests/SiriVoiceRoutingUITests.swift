import XCTest

/// Tests Siri's phrase matching as recognized text, rather than invoking an
/// intent by name. Opt in on a device with Siri available; audio recognition is
/// still a separate physical-device check.
final class SiriVoiceRoutingUITests: XCTestCase {
    @MainActor
    func testRecognizedAttentionRequestReachesIntent() async throws {
        try requireRoutingTest()
        let app = XCUIApplication()
        app.launchEnvironment["RUNTIMEBRIEF_E2E_CLEAR_STATE"] = "1"
        app.launchEnvironment["RUNTIMEBRIEF_E2E_DEMO"] = "1"
        app.launch()
        XCTAssertTrue(app.staticTexts["demo-data-banner"].waitForExistence(timeout: 10))
        try await Task.sleep(for: .seconds(10))
        try requireSiriUI(app: app)

        XCUIDevice.shared.siriService.activate(voiceRecognitionText: "What needs attention in RuntimeBrief")
        let screenshot = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        screenshot.name = "Siri attention route"
        screenshot.lifetime = .keepAlways
        add(screenshot)
        let answer = XCUIDevice.shared.siriService.staticTexts.matching(
            NSPredicate(format: "label CONTAINS[c] %@", "Catalog Builder")
        ).firstMatch
        let matched = answer.waitForExistence(timeout: 30)
        let response = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        response.name = "Siri attention answer"
        response.lifetime = .keepAlways
        add(response)
        XCTAssertTrue(matched,
                      "Siri did not route the parameter-free attention request. \(XCUIDevice.shared.siriService.debugDescription)")
    }

    @MainActor
    func testRecognizedStatusRequestsReachProjectBrief() async throws {
        try requireRoutingTest()
        let app = XCUIApplication()
        app.launchEnvironment["RUNTIMEBRIEF_E2E_CLEAR_STATE"] = "1"
        app.launch()
        app.buttons["explore-demo"].tap()
        XCTAssertTrue(app.staticTexts["demo-data-banner"].waitForExistence(timeout: 10))
        // Siri receives the phrase vocabulary asynchronously after the first
        // successful entity fetch. Give the system time to index this install.
        try await Task.sleep(for: .seconds(10))
        try requireSiriUI(app: app)

        for request in [
            "Get a project status in RuntimeBrief",
            "What's the status of Sample Tracker in RuntimeBrief",
            "Can you tell me the status of the Sample Tracker app from RuntimeBrief",
        ] {
            XCUIDevice.shared.siriService.activate(voiceRecognitionText: request)
            if request == "Get a project status in RuntimeBrief" {
                let choice = XCUIDevice.shared.siriService.buttons["Sample Tracker"]
                if choice.waitForExistence(timeout: 5) { choice.tap() }
            }
            let initial = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
            initial.name = "Siri response: \(request)"
            initial.lifetime = .keepAlways
            add(initial)
            let answer = XCUIDevice.shared.siriService.staticTexts.matching(
                NSPredicate(format: "label CONTAINS[c] %@", "Export validation is ready to review")
            ).firstMatch
            let matched = answer.waitForExistence(timeout: 30)
            let screenshot = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
            screenshot.name = request
            screenshot.lifetime = .keepAlways
            add(screenshot)
            XCTAssertTrue(matched, "Siri did not return the project brief for: \(request). \(XCUIDevice.shared.siriService.debugDescription)")
            guard matched else { return }
            app.activate()
        }
    }

    private func requireRoutingTest() throws {
        let key = "RUNTIMEBRIEF_E2E_SIRI_ROUTING"
        let enabled = ProcessInfo.processInfo.environment[key]
            ?? Bundle(for: Self.self).object(forInfoDictionaryKey: key) as? String
        guard enabled == "1" else { throw XCTSkip("Enable recognized-text Siri routing on a Siri-enabled device.") }
    }

    @MainActor
    private func requireSiriUI(app: XCUIApplication) throws {
        // Hosted CI simulators can accept XCTest's activation call while Siri
        // is disabled. Verify the system UI with a neutral request first; a
        // later missing answer is then a real routing failure, not a false one.
        XCUIDevice.shared.siriService.activate(voiceRecognitionText: "What time is it?")
        guard XCUIApplication(bundleIdentifier: "com.apple.siri").waitForExistence(timeout: 5) else {
            throw XCTSkip("Siri UI is unavailable on this simulator; recognized speech routing needs a Siri-enabled device.")
        }
        app.activate()
    }
}
