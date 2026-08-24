import XCTest

final class PortfolioBriefUITests: XCTestCase {
    @MainActor
    func testFocusedCodexProjectEvidenceAndOptInAnalyst() throws {
        let environment = ProcessInfo.processInfo.environment
        let testBundle = Bundle(for: Self.self)
        let serverURL = environment["RUNTIMEBRIEF_E2E_SERVER_URL"]
            ?? testBundle.object(forInfoDictionaryKey: "RUNTIMEBRIEF_E2E_SERVER_URL") as? String
        let token = environment["RUNTIMEBRIEF_E2E_TOKEN"]
            ?? testBundle.object(forInfoDictionaryKey: "RUNTIMEBRIEF_E2E_TOKEN") as? String
        let projectID = environment["RUNTIMEBRIEF_E2E_PROJECT_ID"]
            ?? testBundle.object(forInfoDictionaryKey: "RUNTIMEBRIEF_E2E_PROJECT_ID") as? String

        guard let serverURL,
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
                    + "RUNTIMEBRIEF_E2E_PROJECT_ID for focused live Codex UI testing."
            )
        }

        continueAfterFailure = false
        let app = XCUIApplication()
        app.launchEnvironment["RUNTIMEBRIEF_E2E_SERVER_URL"] = serverURL
        app.launchEnvironment["RUNTIMEBRIEF_E2E_TOKEN"] = token
        app.launch()

        XCTAssertTrue(
            app.collectionViews["portfolio-brief-list"].waitForExistence(timeout: 15),
            "The evidence-backed portfolio should load from the daemon."
        )

        let projectLink = app.buttons["project-link-\(projectID)"]
        XCTAssertTrue(
            projectLink.waitForExistence(timeout: 10),
            "The configured Codex project should be selectable by its stable project ID."
        )
        projectLink.tap()

        let briefToggle = app.buttons["brief-section-toggle"]
        XCTAssertTrue(
            briefToggle.waitForExistence(timeout: 10),
            "The Codex project detail should render its deterministic brief."
        )
        XCTAssertEqual(briefToggle.value as? String, "Expanded")
        XCTAssertTrue(
            app.descendants(matching: .any)
                .matching(identifier: "evidence-source")
                .firstMatch
                .waitForExistence(timeout: 5),
            "The Codex project brief should cite at least one evidence source."
        )
        XCTAssertTrue(
            app.buttons["generate-analyst-update"].exists,
            "The Codex CLI analyst should remain an explicit opt-in action."
        )
        XCTAssertFalse(
            app.staticTexts["Asking the analyst…"].exists,
            "Opening the Codex project must not automatically issue an analyst request."
        )

        let sessionsToggle = app.buttons["sessions-section-toggle"]
        for _ in 0..<6 where !sessionsToggle.exists {
            app.swipeUp()
        }
        XCTAssertTrue(
            sessionsToggle.waitForExistence(timeout: 10),
            "The Codex project detail should show recent agent sessions."
        )
        XCTAssertTrue(
            app.staticTexts["session-source-codex"].waitForExistence(timeout: 10),
            "The live project evidence should include a Codex session."
        )
    }

    @MainActor
    func testPortfolioBriefEvidenceAndOptInAnalyst() throws {
        let environment = ProcessInfo.processInfo.environment
        let testBundle = Bundle(for: Self.self)
        let serverURL = environment["RUNTIMEBRIEF_E2E_SERVER_URL"]
            ?? testBundle.object(forInfoDictionaryKey: "RUNTIMEBRIEF_E2E_SERVER_URL") as? String
        let token = environment["RUNTIMEBRIEF_E2E_TOKEN"]
            ?? testBundle.object(forInfoDictionaryKey: "RUNTIMEBRIEF_E2E_TOKEN") as? String

        guard let serverURL,
              let token,
              !serverURL.isEmpty,
              !token.isEmpty,
              !serverURL.hasPrefix("$("),
              !token.hasPrefix("$(")
        else {
            throw XCTSkip("Set RUNTIMEBRIEF_E2E_SERVER_URL and RUNTIMEBRIEF_E2E_TOKEN for live daemon UI testing.")
        }

        let app = XCUIApplication()
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
        projectLink.tap()

        let briefToggle = app.buttons["brief-section-toggle"]
        XCTAssertTrue(
            briefToggle.waitForExistence(timeout: 10),
            "Project detail should show the deterministic brief and its evidence."
        )
        XCTAssertTrue(briefToggle.label.contains(expectedHeadline))
        XCTAssertEqual(briefToggle.value as? String, "Expanded")
        XCTAssertTrue(
            app.descendants(matching: .any)
                .matching(identifier: "evidence-source")
                .firstMatch
                .waitForExistence(timeout: 5),
            "At least one source record should be visible for the brief claims."
        )
        XCTAssertTrue(
            app.buttons["generate-analyst-update"].exists,
            "The analyst must remain an explicit opt-in action."
        )
        XCTAssertFalse(
            app.staticTexts["Asking the analyst…"].exists,
            "Opening a project must not automatically spend an analyst query."
        )

        briefToggle.tap()
        XCTAssertEqual(briefToggle.value as? String, "Collapsed")
        XCTAssertFalse(
            app.descendants(matching: .any)
                .matching(identifier: "evidence-source")
                .firstMatch
                .exists,
            "Collapsing the project brief should hide all of its claims and evidence."
        )
        briefToggle.tap()
        XCTAssertEqual(briefToggle.value as? String, "Expanded")
        XCTAssertTrue(
            app.descendants(matching: .any)
                .matching(identifier: "evidence-source")
                .firstMatch
                .waitForExistence(timeout: 5)
        )

        let releaseToggle = app.buttons["ios-release-section-toggle"]
        for _ in 0..<4 where !releaseToggle.exists {
            app.swipeUp()
        }
        XCTAssertTrue(
            releaseToggle.waitForExistence(timeout: 15),
            "An iOS project should show its Xcode, TestFlight, and App Store release summary."
        )
        XCTAssertTrue(app.staticTexts["Xcode"].exists)
        let testFlightLabel = app.staticTexts["TestFlight"]
        let appStoreLabel = app.staticTexts["App Store"]
        for _ in 0..<4 {
            if testFlightLabel.exists, appStoreLabel.exists {
                break
            }
            app.swipeUp()
        }
        XCTAssertTrue(
            testFlightLabel.waitForExistence(timeout: 5),
            "The expanded iOS release section should show its TestFlight build."
        )
        XCTAssertTrue(
            appStoreLabel.waitForExistence(timeout: 5),
            "The expanded iOS release section should show its App Store version."
        )

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
        for _ in 0..<6 where !sessionsToggle.exists {
            app.swipeUp()
        }
        XCTAssertTrue(
            sessionsToggle.waitForExistence(timeout: 15),
            "Project detail should show recent agent sessions."
        )
        for source in ["claude-code", "codex", "cursor"] {
            XCTAssertTrue(
                app.staticTexts["session-source-\(source)"].waitForExistence(timeout: 10),
                "The rendered project detail should include a \(source) desktop or CLI session."
            )
        }
    }
}
