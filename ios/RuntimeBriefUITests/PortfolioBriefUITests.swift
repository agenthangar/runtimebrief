import XCTest

final class PortfolioBriefUITests: XCTestCase {
    @MainActor
    func testFocusedCodexProjectEvidenceAndSharedAnalyst() async throws {
        let environment = ProcessInfo.processInfo.environment
        let testBundle = Bundle(for: Self.self)
        let serverURL = environment["RUNTIMEBRIEF_E2E_SERVER_URL"]
            ?? testBundle.object(forInfoDictionaryKey: "RUNTIMEBRIEF_E2E_SERVER_URL") as? String
        let token = environment["RUNTIMEBRIEF_E2E_TOKEN"]
            ?? testBundle.object(forInfoDictionaryKey: "RUNTIMEBRIEF_E2E_TOKEN") as? String
        let projectID = environment["RUNTIMEBRIEF_E2E_PROJECT_ID"]
            ?? testBundle.object(forInfoDictionaryKey: "RUNTIMEBRIEF_E2E_PROJECT_ID") as? String

        guard (environment["RUNTIMEBRIEF_E2E_MOCK"] ?? testBundle.object(forInfoDictionaryKey: "RUNTIMEBRIEF_E2E_MOCK") as? String) == "1",
              let serverURL,
              let token,
              let projectID,
              !serverURL.isEmpty,
              !token.isEmpty,
              !projectID.isEmpty,
              !serverURL.hasPrefix("$("),
              !token.hasPrefix("$("),
              !projectID.hasPrefix("$(")
        else {
            throw XCTSkip(
                "Set RUNTIMEBRIEF_E2E_SERVER_URL, RUNTIMEBRIEF_E2E_TOKEN, and "
                    + "RUNTIMEBRIEF_E2E_PROJECT_ID for mock HTTP fixture UI testing."
            )
        }

        continueAfterFailure = false
        let sharedAnswer = try await savedAnalysis(serverURL: serverURL, token: token, projectID: projectID)
        let app = XCUIApplication()
        app.launchEnvironment["RUNTIMEBRIEF_E2E_CLEAR_STATE"] = "1"
        app.launchEnvironment["RUNTIMEBRIEF_E2E_SERVER_URL"] = serverURL
        app.launchEnvironment["RUNTIMEBRIEF_E2E_TOKEN"] = token
        app.launch()

        XCTAssertTrue(
            app.collectionViews["portfolio-brief-list"].waitForExistence(timeout: 15),
            "The evidence-backed portfolio should load from the daemon."
        )

        let recentRow = app.buttons["project-link-\(projectID)"]
        let earlierRow = app.buttons["project-link-earlier-project"]
        XCTAssertTrue(recentRow.exists)
        XCTAssertTrue(earlierRow.exists)
        XCTAssertLessThan(recentRow.frame.minY, earlierRow.frame.minY)
        XCTAssertTrue(app.descendants(matching: .any)["project-activity-\(projectID)"].exists)
        XCTAssertFalse(app.descendants(matching: .any)["evidence-source"].exists)
        let projectLink = app.buttons["project-link-\(projectID)"]
        XCTAssertTrue(
            projectLink.waitForExistence(timeout: 10),
            "The configured Codex project should be selectable by its stable project ID."
        )
        projectLink.tap()
        assertSavedAnalysis(app: app, answer: sharedAnswer)

        XCTAssertFalse(app.staticTexts["Evidence"].exists)
        XCTAssertFalse(app.descendants(matching: .any)["evidence-source"].exists)
        let briefToggle = app.buttons["brief-section-toggle"]
        XCTAssertTrue(
            briefToggle.waitForExistence(timeout: 10),
            "The Codex project detail should render its deterministic brief."
        )
        XCTAssertEqual(briefToggle.value as? String, "Collapsed")
        briefToggle.tap()
        XCTAssertEqual(briefToggle.value as? String, "Expanded")
        XCTAssertTrue(
            app.descendants(matching: .any)
                .matching(identifier: "project-brief-claim")
                .firstMatch
                .waitForExistence(timeout: 5),
            "The project brief should show readable claims."
        )
        let sessionsToggle = app.buttons["sessions-section-toggle"]
        for _ in 0..<6 where !sessionsToggle.exists {
            app.swipeUp()
        }
        XCTAssertTrue(
            sessionsToggle.waitForExistence(timeout: 10),
            "The Codex project detail should show recent agent sessions."
        )
        sessionsToggle.tap()
        XCTAssertTrue(
            app.staticTexts["session-source-codex"].waitForExistence(timeout: 10),
            "The mock project evidence should include a Codex session."
        )
    }

    @MainActor
    func testPortfolioBriefEvidenceAndSharedAnalyst() async throws {
        let environment = ProcessInfo.processInfo.environment
        let testBundle = Bundle(for: Self.self)
        let serverURL = environment["RUNTIMEBRIEF_E2E_SERVER_URL"]
            ?? testBundle.object(forInfoDictionaryKey: "RUNTIMEBRIEF_E2E_SERVER_URL") as? String
        let token = environment["RUNTIMEBRIEF_E2E_TOKEN"]
            ?? testBundle.object(forInfoDictionaryKey: "RUNTIMEBRIEF_E2E_TOKEN") as? String

        guard (environment["RUNTIMEBRIEF_E2E_MOCK"] ?? testBundle.object(forInfoDictionaryKey: "RUNTIMEBRIEF_E2E_MOCK") as? String) == "1",
              let serverURL,
              let token,
              !serverURL.isEmpty,
              !token.isEmpty,
              !serverURL.hasPrefix("$("),
              !token.hasPrefix("$(")
        else {
            throw XCTSkip("Set RUNTIMEBRIEF_E2E_SERVER_URL and RUNTIMEBRIEF_E2E_TOKEN for mock HTTP fixture UI testing.")
        }

        let app = XCUIApplication()
        app.launchEnvironment["RUNTIMEBRIEF_E2E_CLEAR_STATE"] = "1"
        app.launchEnvironment["RUNTIMEBRIEF_E2E_SERVER_URL"] = serverURL
        app.launchEnvironment["RUNTIMEBRIEF_E2E_TOKEN"] = token
        app.launch()

        XCTAssertTrue(
            app.collectionViews["portfolio-brief-list"].waitForExistence(timeout: 15),
            "The evidence-backed portfolio should load from the daemon."
        )
        let portfolioHeadline = app.staticTexts
            .matching(NSPredicate(format: "identifier BEGINSWITH 'brief-headline-'"))
            .firstMatch
        XCTAssertTrue(
            portfolioHeadline.waitForExistence(timeout: 10),
            "The home screen should present RuntimeBrief's actual brief."
        )
        let expectedHeadline = portfolioHeadline.label

        let projectLink = app.buttons
            .matching(NSPredicate(format: "identifier BEGINSWITH 'project-link-'"))
            .firstMatch
        XCTAssertTrue(projectLink.waitForExistence(timeout: 5))
        let selectedProjectID = String(projectLink.identifier.dropFirst("project-link-".count))
        let sharedAnswer = try await savedAnalysis(serverURL: serverURL, token: token, projectID: selectedProjectID)
        var request = URLRequest(url: try XCTUnwrap(URL(string: "\(serverURL)/v1/projects/\(selectedProjectID)")))
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        let (data, response) = try await URLSession.shared.data(for: request)
        XCTAssertEqual((response as? HTTPURLResponse)?.statusCode, 200)
        let projectData = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
        let releaseData = try XCTUnwrap(projectData["iosRelease"] as? [String: Any])
        let storeData = try XCTUnwrap(releaseData["appStoreConnect"] as? [String: Any])
        let hasTestFlightBuild = storeData["latestTestFlightBuild"] as? [String: Any] != nil
        let hasAppStoreVersion = storeData["appStoreVersion"] as? [String: Any] != nil
        projectLink.tap()
        assertSavedAnalysis(app: app, answer: sharedAnswer)

        XCTAssertFalse(app.staticTexts["Evidence"].exists)
        XCTAssertFalse(app.descendants(matching: .any)["evidence-source"].exists)
        let briefToggle = app.buttons["brief-section-toggle"]
        XCTAssertTrue(
            briefToggle.waitForExistence(timeout: 10),
            "Project detail should show the deterministic brief and its evidence."
        )
        XCTAssertTrue(briefToggle.label.contains(expectedHeadline))
        XCTAssertEqual(briefToggle.value as? String, "Collapsed")
        briefToggle.tap()
        XCTAssertEqual(briefToggle.value as? String, "Expanded")
        XCTAssertTrue(
            app.descendants(matching: .any)
                .matching(identifier: "project-brief-claim")
                .firstMatch
                .waitForExistence(timeout: 5),
            "The project brief should show readable claims."
        )
        briefToggle.tap()
        XCTAssertEqual(briefToggle.value as? String, "Collapsed")
        XCTAssertFalse(
            app.descendants(matching: .any)
                .matching(identifier: "project-brief-claim")
                .firstMatch
                .exists,
            "Collapsing the project brief should hide all of its claims."
        )
        briefToggle.tap()
        XCTAssertEqual(briefToggle.value as? String, "Expanded")
        XCTAssertTrue(
            app.descendants(matching: .any)
                .matching(identifier: "project-brief-claim")
                .firstMatch
                .waitForExistence(timeout: 5)
        )

        let releaseToggle = app.buttons["ios-release-section-toggle"]
        for _ in 0..<30 where !releaseToggle.isHittable {
            app.swipeUp()
        }
        XCTAssertTrue(
            releaseToggle.waitForExistence(timeout: 15),
            "An iOS project should show its Xcode, TestFlight, and App Store release summary."
        )
        XCTAssertEqual(releaseToggle.value as? String, "Collapsed")
        releaseToggle.tap()
        XCTAssertTrue(app.staticTexts["Xcode"].exists)
        let testFlightLabel = app.staticTexts["TestFlight"]
        let appStoreLabel = app.staticTexts["App Store"]
        for _ in 0..<4 {
            if (!hasTestFlightBuild || testFlightLabel.exists), (!hasAppStoreVersion || appStoreLabel.exists) {
                break
            }
            app.swipeUp()
        }
        if hasTestFlightBuild { XCTAssertTrue(testFlightLabel.waitForExistence(timeout: 5)) }
        else { XCTAssertFalse(testFlightLabel.exists, "A project without a TestFlight build must not fabricate one.") }
        if hasAppStoreVersion { XCTAssertTrue(appStoreLabel.waitForExistence(timeout: 5)) }
        else { XCTAssertFalse(appStoreLabel.exists, "A project without an App Store version must not fabricate one.") }

        XCTAssertEqual(releaseToggle.value as? String, "Expanded")
        releaseToggle.tap()
        XCTAssertEqual(releaseToggle.value as? String, "Collapsed")
        XCTAssertFalse(
            app.descendants(matching: .any)["xcode-build-summary"].exists,
            "Collapsing iOS release should hide Xcode, TestFlight, and App Store details."
        )
        releaseToggle.tap()
        XCTAssertEqual(releaseToggle.value as? String, "Expanded")
        XCTAssertTrue(app.staticTexts["Xcode"].waitForExistence(timeout: 5))

        let sessionsToggle = app.buttons["sessions-section-toggle"]
        for _ in 0..<30 where !sessionsToggle.isHittable {
            app.swipeDown()
        }
        XCTAssertTrue(
            sessionsToggle.waitForExistence(timeout: 15),
            "Project detail should show recent agent sessions."
        )
        sessionsToggle.tap()
        for source in ["claude-code", "codex", "cursor"] {
            XCTAssertTrue(
                app.staticTexts["session-source-\(source)"].waitForExistence(timeout: 10),
                "The rendered project detail should include a \(source) desktop or CLI session."
            )
        }
    }

    @MainActor
    private func assertSavedAnalysis(app: XCUIApplication, answer: String) {
        let toggle = app.buttons["analyst-section-toggle"]
        XCTAssertTrue(toggle.waitForExistence(timeout: 10))
        XCTAssertEqual(toggle.value as? String, "Expanded")
        let analysis = app.staticTexts["analyst-update-text"]
        XCTAssertTrue(analysis.waitForExistence(timeout: 10))
        XCTAssertEqual(analysis.label, answer, "Project detail must reuse the saved analysis without a Generate step.")
        XCTAssertTrue(app.buttons["check-analyst-update"].exists)
        toggle.tap()
    }

    @MainActor
    private func savedAnalysis(serverURL: String, token: String, projectID: String) async throws -> String {
        var request = URLRequest(url: try XCTUnwrap(URL(string: "\(serverURL)/v1/projects/\(projectID)/voice-status")))
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        let (data, response) = try await URLSession.shared.data(for: request)
        XCTAssertEqual((response as? HTTPURLResponse)?.statusCode, 200)
        let result = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
        return try XCTUnwrap(result["answer"] as? String, "The mock fixture must have a saved analysis for the shared-cache check.")
    }
}
