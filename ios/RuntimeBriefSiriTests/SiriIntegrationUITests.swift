import AppIntentsTesting
import XCTest

/// Runs through the on-device App Intents stack, across process boundaries.
/// Spoken recognition still requires a physical Apple Intelligence device.
final class SiriIntegrationUITests: XCTestCase {
    @MainActor
    func testUnconfiguredLaunchCanRegisterShortcutsWithoutProjectNames() async throws {
        guard #available(iOS 27.0, *) else { throw XCTSkip("AppIntentsTesting requires iOS 27.") }
        let app = XCUIApplication()
        app.launchEnvironment["RUNTIMEBRIEF_E2E_CLEAR_STATE"] = "1"
        app.launch()
        XCTAssertTrue(app.buttons["connect-your-mac"].waitForExistence(timeout: 10))
        let definitions = IntentDefinitions(bundleIdentifier: "com.backbrief.app")
        try await requireSystemTesting(definitions)
        let projects = try await definitions.entities["ProjectEntity"].suggestedEntities()
        XCTAssertTrue(projects.isEmpty, "Background registration must finish without exposing saved names.")
    }

    @MainActor
    private func launchDemo() -> XCUIApplication {
        let app = XCUIApplication()
        app.launchEnvironment["RUNTIMEBRIEF_E2E_CLEAR_STATE"] = "1"
        app.launchEnvironment["RUNTIMEBRIEF_E2E_DEMO"] = "1"
        app.launch()
        XCTAssertTrue(app.staticTexts["demo-data-banner"].waitForExistence(timeout: 10))
        return app
    }

    @MainActor
    func testSiriActionsReturnReusableValuesThroughSystemStack() async throws {
        guard #available(iOS 27.0, *) else { throw XCTSkip("AppIntentsTesting requires iOS 27.") }
        _ = launchDemo()
        let definitions = IntentDefinitions(bundleIdentifier: "com.backbrief.app")
        try await requireSystemTesting(definitions)
        let projects = try await definitions.entities["ProjectEntity"].entities(matching: "sample tracker")
        XCTAssertEqual(projects.count, 1)
        let project = try XCTUnwrap(projects.first)
        let name: String = try project.name
        XCTAssertEqual(name, "Sample Tracker")

        let status = definitions.intents["GetProjectStatusIntent"].makeIntent(project: project)
        let statusResult = try await status.run()
        let text: String = try statusResult.value
        XCTAssertTrue(text.contains("Fictional demo"))
        XCTAssertTrue(text.contains("Sample Tracker, analyzed"))
        XCTAssertTrue(text.contains("24 demo checks pass"))
        XCTAssertFalse(text.contains("[demo-evidence-"))

        let analysisResult = try await definitions.intents["GetProjectAnalysisIntent"]
            .makeIntent(project: project).run()
        let analysis: String = try analysisResult.value
        XCTAssertEqual(analysis, text)

        let overviewResult = try await definitions.intents["GetProjectStatusIntent"].makeIntent().run()
        let overview: String = try overviewResult.value
        XCTAssertTrue(overview.contains("You have 3 projects"))

        let attentionResult = try await definitions.intents["GetAttentionIntent"].makeIntent().run()
        let attention: [AnyAppEntity] = try attentionResult.value
        XCTAssertEqual(attention.count, 1)
        let attentionName: String = try XCTUnwrap(attention.first).name
        XCTAssertEqual(attentionName, "Catalog Builder")

        let listResult = try await definitions.intents["ListProjectsIntent"].makeIntent().run()
        let listed: [AnyAppEntity] = try listResult.value
        XCTAssertEqual(listed.count, 3)

        let answerResult = try await definitions.intents["AskProjectIntent"]
            .makeIntent(project: project, question: "Did the checks pass?").run()
        let answer: String = try answerResult.value
        XCTAssertTrue(answer.contains("fictional demo response"))
    }

    @MainActor
    func testSiriOpenNavigatesToCorrectProjectAndPublishesOnscreenContext() async throws {
        guard #available(iOS 27.0, *) else { throw XCTSkip("AppIntentsTesting requires iOS 27.") }
        let app = launchDemo()
        let definitions = IntentDefinitions(bundleIdentifier: "com.backbrief.app")
        try await requireSystemTesting(definitions)
        let entity = definitions.entities["ProjectEntity"]
        let projects = try await entity.entities(matching: "catalog builder")
        let project = try XCTUnwrap(projects.first)
        _ = try await definitions.intents["OpenProjectWithSiriIntent"].makeIntent(target: project).run()
        XCTAssertTrue(app.navigationBars["Catalog Builder"].waitForExistence(timeout: 10))
        XCTAssertTrue(app.buttons["brief-section-toggle"].exists)
        let annotations = try await entity.viewAnnotations()
        XCTAssertTrue(annotations.contains { $0.entity.identifier == project.identifier })
        // The private live cache and fictional demo are never donated to search.
        let indexed = try await entity.spotlightQuery()
        XCTAssertTrue(indexed.isEmpty)
    }

    @MainActor
    func testSessionCreationThroughSystemStack() async throws {
        guard #available(iOS 27.0, *) else { throw XCTSkip("AppIntentsTesting requires iOS 27.") }
        _ = launchDemo()
        let definitions = IntentDefinitions(bundleIdentifier: "com.backbrief.app")
        try await requireSystemTesting(definitions)
        let projects = try await definitions.entities["ProjectEntity"].entities(matching: "sample tracker")
        let project = try XCTUnwrap(projects.first)
        for provider in ["claude", "codex", "cursor"] {
            let result = try await definitions.intents["StartSessionIntent"].makeIntent(
                project: project, provider: definitions.enums["AgentProvider"].makeCase(provider),
                task: "Inspect the fictional export for \(provider)", model: "default",
                permissions: definitions.enums["SiriSessionPermission"].makeCase("manual"),
                reasoning: definitions.enums["SiriReasoningEffort"].makeCase("default"), remoteControl: true
            ).run()
            let receiptID: String = try result.value
            XCTAssertNotNil(UUID(uuidString: receiptID))

        }
    }

    @MainActor
    func testNamedAgentActionsThroughSystemStack() async throws {
        guard #available(iOS 27.0, *) else { throw XCTSkip("AppIntentsTesting requires iOS 27.") }
        _ = launchDemo()
        let definitions = IntentDefinitions(bundleIdentifier: "com.backbrief.app")
        try await requireSystemTesting(definitions)
        let matches = try await definitions.entities["ProjectEntity"].entities(matching: "the Sample Tracker app")
        let project = try XCTUnwrap(matches.first)
        for name in ["StartClaudeSessionIntent", "StartCodexSessionIntent", "StartCursorSessionIntent"] {
            let result = try await definitions.intents[name].makeIntent(
                project: project, task: "Inspect the fictional export"
            ).run()
            let receiptID: String = try result.value
            XCTAssertNotNil(UUID(uuidString: receiptID))
        }
    }

    @MainActor
    func testDiscoveryOptOutHidesContextButKeepsExplicitShortcutsUsable() async throws {
        guard #available(iOS 27.0, *) else { throw XCTSkip("AppIntentsTesting requires iOS 27.") }
        let app = XCUIApplication()
        app.launchEnvironment["RUNTIMEBRIEF_E2E_CLEAR_STATE"] = "1"
        app.launch()
        app.buttons["connect-your-mac"].tap()
        let toggle = app.switches["siri-discovery-toggle"]
        XCTAssertTrue(toggle.waitForExistence(timeout: 5))
        toggle.coordinate(withNormalizedOffset: CGVector(dx: 0.9, dy: 0.5)).tap()
        XCTAssertEqual(toggle.value as? String, "0")
        app.buttons["Cancel"].tap()
        app.buttons["explore-demo"].tap()
        XCTAssertTrue(app.staticTexts["demo-data-banner"].waitForExistence(timeout: 5))

        let definitions = IntentDefinitions(bundleIdentifier: "com.backbrief.app")
        try await requireSystemTesting(definitions)
        let entity = definitions.entities["ProjectEntity"]
        let choices = try await entity.suggestedEntities()
        XCTAssertEqual(choices.count, 3, "An explicit project chooser must still work after opting out.")
        let matches = try await entity.entities(matching: "catalog builder")
        let project = try XCTUnwrap(matches.first)
        _ = try await definitions.intents["OpenProjectWithSiriIntent"].makeIntent(target: project).run()
        XCTAssertTrue(app.navigationBars["Catalog Builder"].waitForExistence(timeout: 10))
        let annotations = try await entity.viewAnnotations()
        XCTAssertFalse(annotations.contains { $0.entity.identifier == project.identifier })
        let indexed = try await entity.spotlightQuery()
        XCTAssertTrue(indexed.isEmpty)
    }

    @available(iOS 27.0, *)
    @MainActor
    private func requireSystemTesting(_ definitions: IntentDefinitions) async throws {
        do {
            _ = try await definitions.entities["ProjectEntity"].suggestedEntities()
        } catch {
            let failure = error as NSError
            if failure.domain == "AppIntentsServicesSecurityErrorDomain", failure.code == 803 {
                throw XCTSkip("This iOS 27 runtime rejects AppIntentsTesting: \(failure.localizedDescription)")
            }
            throw error
        }
    }
}
