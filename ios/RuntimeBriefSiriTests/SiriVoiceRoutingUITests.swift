import XCTest

/// Tests Siri's phrase matching as recognized text, rather than invoking an
/// intent by name. Opt in on a device with Siri available; audio recognition is
/// still a separate physical-device check.
final class SiriVoiceRoutingUITests: XCTestCase {
    @MainActor
    func testRecognizedAnalysisRequestReachesApp() async throws {
        try requireRoutingTest()
        let app = XCUIApplication()
        app.launchEnvironment["RUNTIMEBRIEF_E2E_CLEAR_STATE"] = "1"
        app.launchEnvironment["RUNTIMEBRIEF_E2E_DEMO"] = "1"
        app.launch()
        XCTAssertTrue(app.staticTexts["demo-data-banner"].waitForExistence(timeout: 10))
        try await Task.sleep(for: .seconds(10))

        let request = "Get me the analysis of the project Sample Tracker from RuntimeBrief"
        XCUIDevice.shared.siriService.activate(voiceRecognitionText: request)
        let answer = XCUIDevice.shared.siriService.staticTexts.matching(
            NSPredicate(format: "label CONTAINS[c] %@", "24 demo checks pass")
        ).firstMatch
        let matched = answer.waitForExistence(timeout: 30)
        let screenshot = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        screenshot.name = "Siri project analysis routing"
        screenshot.lifetime = .keepAlways
        add(screenshot)
        XCTAssertTrue(matched,
                      "Siri did not route the recognized analysis phrase. \(XCUIDevice.shared.siriService.debugDescription)")
    }

    @MainActor
    func testRecognizedAttentionRequestReachesIntent() async throws {
        try requireRoutingTest()
        let app = XCUIApplication()
        app.launchEnvironment["RUNTIMEBRIEF_E2E_CLEAR_STATE"] = "1"
        app.launchEnvironment["RUNTIMEBRIEF_E2E_DEMO"] = "1"
        app.launch()
        XCTAssertTrue(app.staticTexts["demo-data-banner"].waitForExistence(timeout: 10))
        try await Task.sleep(for: .seconds(10))

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

        for request in [
            "Get me status from RuntimeBrief",
            "Get a project status in RuntimeBrief",
            "Show Runtime Brief status",
            "What's the status of Sample Tracker in RuntimeBrief",
            "Can you tell me the status of the Sample Tracker app from RuntimeBrief",
            "Get me the analysis of the project Sample Tracker from RuntimeBrief",
            "Give me the latest analysis of the project Sample Tracker from RuntimeBrief",
            "RuntimeBrief analysis for Sample Tracker",
        ] {
            XCUIDevice.shared.siriService.activate(voiceRecognitionText: request)
            let initial = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
            initial.name = "Siri response: \(request)"
            initial.lifetime = .keepAlways
            add(initial)
            let expected = request.contains("Sample Tracker") ? "24 demo checks pass" : "You have 3 projects"
            let answer = XCUIDevice.shared.siriService.staticTexts.matching(
                NSPredicate(format: "label CONTAINS[c] %@", expected)
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
}
