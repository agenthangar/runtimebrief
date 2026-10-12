import XCTest

/// Tests Siri's phrase matching as recognized text, rather than invoking an
/// intent by name. Opt in on a device with Siri available; audio recognition is
/// still a separate physical-device check.
final class SiriVoiceRoutingUITests: XCTestCase {
    @MainActor
    func testRecognizedLaunchRequestsAskForMissingInformation() async throws {
        try requireRoutingTest()
        let app = XCUIApplication()
        app.launchEnvironment["RUNTIMEBRIEF_E2E_CLEAR_STATE"] = "1"
        app.launchEnvironment["RUNTIMEBRIEF_E2E_DEMO"] = "1"
        app.launch()
        XCTAssertTrue(app.staticTexts["demo-data-banner"].waitForExistence(timeout: 10))
        try await Task.sleep(for: .seconds(10))

        for (request, expected) in [
            ("Tell the Sample Tracker agent in RuntimeBrief", "What should I tell the agent"),
            ("RuntimeBrief start Codex", "Which project should Codex work on"),
            ("Start Codex for Sample Tracker from RuntimeBrief", "What should Codex work on"),
            ("Start Codex for the Sample Tracker app from RuntimeBrief", "What should Codex work on"),
        ] {
            XCUIDevice.shared.siriService.activate(voiceRecognitionText: request)
            let dialog = XCUIDevice.shared.siriService.staticTexts.matching(
                NSPredicate(format: "label CONTAINS[c] %@", expected)
            ).firstMatch
            let matched = dialog.waitForExistence(timeout: 30)
            let screenshot = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
            screenshot.name = request
            screenshot.lifetime = .keepAlways
            add(screenshot)
            XCTAssertTrue(matched, "Siri did not ask for missing launch information: \(request). \(XCUIDevice.shared.siriService.debugDescription)")
            guard matched else { return }
            app.activate()
        }
    }

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
            "How are my projects doing in RuntimeBrief",
            "Show Runtime Brief status",
            "What's the status of Sample Tracker in RuntimeBrief",
            "Can you tell me the status of the Sample Tracker app from RuntimeBrief",
            "Get me the analysis of the project Sample Tracker from RuntimeBrief",
            "Give me the latest analysis of the project Sample Tracker from RuntimeBrief",
            "RuntimeBrief analysis for Sample Tracker",
            "Ask RuntimeBrief what's the status of Sample Tracker",
            "Ask RuntimeBrief how Sample Tracker is doing",
            "What did my agents get done this week in RuntimeBrief",
        ] {
            XCUIDevice.shared.siriService.activate(voiceRecognitionText: request)
            let initial = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
            initial.name = "Siri response: \(request)"
            initial.lifetime = .keepAlways
            add(initial)
            let expected = request.contains("get done") ? "Agents finished work"
                : request.contains("Sample Tracker") ? "24 demo checks pass" : "You have 3 projects"
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

    @MainActor
    func testRecognizedOpenQuestionAsksWhatToKnow() async throws {
        try requireRoutingTest()
        let app = XCUIApplication()
        app.launchEnvironment["RUNTIMEBRIEF_E2E_CLEAR_STATE"] = "1"
        app.launchEnvironment["RUNTIMEBRIEF_E2E_DEMO"] = "1"
        app.launch()
        XCTAssertTrue(app.staticTexts["demo-data-banner"].waitForExistence(timeout: 10))
        try await Task.sleep(for: .seconds(10))

        for request in [
            "Ask RuntimeBrief",
            "Ask RuntimeBrief a question",
            "I have a question for RuntimeBrief",
            "Talk to RuntimeBrief",
            "Ask RuntimeBrief about my agents",
        ] {
            XCUIDevice.shared.siriService.activate(voiceRecognitionText: request)
            let prompt = XCUIDevice.shared.siriService.staticTexts.matching(
                NSPredicate(format: "label CONTAINS[c] %@", "What do you want to know")
            ).firstMatch
            let matched = prompt.waitForExistence(timeout: 30)
            let screenshot = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
            screenshot.name = request
            screenshot.lifetime = .keepAlways
            add(screenshot)
            XCTAssertTrue(matched, "Siri did not open the question prompt for: \(request). \(XCUIDevice.shared.siriService.debugDescription)")
            guard matched else { return }
            app.activate()
        }
    }

    @MainActor
    func testProjectRequestsWithoutARecognizedNameAskWhichProject() async throws {
        try requireRoutingTest()
        let app = XCUIApplication()
        app.launchEnvironment["RUNTIMEBRIEF_E2E_CLEAR_STATE"] = "1"
        app.launchEnvironment["RUNTIMEBRIEF_E2E_DEMO"] = "1"
        app.launch()
        XCTAssertTrue(app.staticTexts["demo-data-banner"].waitForExistence(timeout: 10))
        try await Task.sleep(for: .seconds(10))

        for request in [
            "Get a project status in RuntimeBrief",
            "Tell me a project's status from RuntimeBrief",
            "Ask RuntimeBrief for the status of Zebra Quasar",
        ] {
            XCUIDevice.shared.siriService.activate(voiceRecognitionText: request)
            let prompt = XCUIDevice.shared.siriService.staticTexts.matching(
                NSPredicate(format: "label CONTAINS[c] %@", "Which project")
            ).firstMatch
            let matched = prompt.waitForExistence(timeout: 30)
            let screenshot = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
            screenshot.name = request
            screenshot.lifetime = .keepAlways
            add(screenshot)
            XCTAssertTrue(matched, "Siri answered for every project instead of asking which: \(request). \(XCUIDevice.shared.siriService.debugDescription)")
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
