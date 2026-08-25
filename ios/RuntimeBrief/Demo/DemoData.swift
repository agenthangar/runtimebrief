import Foundation

/// Hand-authored fictional content for App Review and prospective users.
/// Nothing in this file is copied from a live daemon, repository, transcript,
/// account, device, or App Store Connect response.
enum DemoData {
    static let projectID = "demo-sample-tracker"

    private static var recent: Date { Date().addingTimeInterval(-35 * 60) }
    private static var yesterday: Date { Date().addingTimeInterval(-22 * 60 * 60) }
    private static var lastWeek: Date { Date().addingTimeInterval(-6 * 24 * 60 * 60) }

    private static let commitEvidence = EvidenceRef(
        id: "demo-evidence-commit-001",
        kind: .commit,
        label: "Commit a1b2c3d",
        detail: "Demo Developer: Add export validation",
        source: "git",
        timestamp: nil
    )

    private static let testEvidence = EvidenceRef(
        id: "demo-evidence-session-001",
        kind: .session,
        label: "Codex demo session",
        detail: "Fictional test run completed with 24 checks passing",
        source: "codex",
        timestamp: nil
    )

    static var projects: [ProjectSummary] {
        [sampleTrackerSummary, catalogBuilderSummary, weatherWidgetSummary]
    }

    static var cards: [ProjectCard] {
        [sampleTrackerCard, catalogBuilderCard, weatherWidgetCard]
    }

    static func card(id: String) throws -> ProjectCard {
        guard let card = cards.first(where: { $0.id == id }) else {
            throw RuntimeBriefError.notFound
        }
        return card
    }

    static func analystAnswer(projectID: String, question: String? = nil) throws -> AnalystAnswer {
        _ = try card(id: projectID)
        let answer: String
        if question == nil {
            answer = "This fictional project is ready for review. Its export work is complete, all 24 demo checks pass, and no decision is waiting. [demo-evidence-commit-001] [demo-evidence-session-001]"
        } else {
            answer = "This is a fictional demo response. The sample evidence shows the export validation completed and all 24 demo checks passed. [demo-evidence-commit-001] [demo-evidence-session-001]"
        }
        return AnalystAnswer(
            answer: answer,
            costUsd: 0,
            cached: true,
            truncated: false,
            evidence: [commitEvidence, testEvidence]
        )
    }

    private static var sampleTrackerSummary: ProjectSummary {
        ProjectSummary(
            id: projectID,
            name: "Sample Tracker",
            lastActivityAt: recent,
            branch: "feature/export-checks",
            dirty: false,
            brief: sampleTrackerBrief
        )
    }

    private static var sampleTrackerBrief: ProjectBrief {
        ProjectBrief(
            state: .recent,
            headline: "Export validation is ready to review",
            headlineEvidence: [commitEvidence, testEvidence],
            updatedAt: recent,
            activeSessionCount: 0,
            claims: [
                BriefClaim(
                    id: "demo-claim-complete-001",
                    category: .completed,
                    text: "The fictional export workflow and its validation checks are complete.",
                    evidence: [commitEvidence]
                ),
                BriefClaim(
                    id: "demo-claim-tests-001",
                    category: .progress,
                    text: "All 24 fictional checks passed in the latest demo run.",
                    evidence: [testEvidence]
                ),
            ]
        )
    }

    private static var sampleTrackerCard: ProjectCard {
        ProjectCard(
            id: projectID,
            name: "Sample Tracker",
            path: "/demo/projects/sample-tracker",
            lastActivityAt: recent,
            git: GitSummary(
                branch: "feature/export-checks",
                dirty: false,
                dirtyFileCount: 0,
                commits: [
                    CommitInfo(
                        hash: "a1b2c3d4e5f6",
                        author: "Demo Developer",
                        timestamp: recent,
                        message: "Add export validation"
                    ),
                    CommitInfo(
                        hash: "b2c3d4e5f6a7",
                        author: "Demo Developer",
                        timestamp: yesterday,
                        message: "Polish the summary screen"
                    ),
                ],
                diffstatVsDefault: "2 files changed, 18 insertions(+)",
                defaultBranch: "main",
                todoCount: 0,
                fixmeCount: 0,
                lastCommitAt: recent
            ),
            iosRelease: IOSReleaseSummary(
                xcode: XcodeProjectSummary(
                    source: "xcodegen",
                    projectFile: "ios/project.yml",
                    scheme: "SampleTracker",
                    bundleId: "com.example.sampletracker",
                    marketingVersion: "1.4",
                    buildNumber: "42"
                ),
                appStoreConnect: AppStoreConnectSummary(
                    status: .available,
                    checkedAt: recent,
                    message: nil,
                    appId: "demo-app-001",
                    latestTestFlightBuild: TestFlightBuildSummary(
                        id: "demo-build-042",
                        marketingVersion: "1.4",
                        buildNumber: "42",
                        uploadedAt: yesterday,
                        expiresAt: nil,
                        expired: false,
                        processingState: "VALID",
                        audienceType: "APP_STORE_ELIGIBLE"
                    ),
                    appStoreVersion: AppStoreVersionSummary(
                        id: "demo-version-014",
                        version: "1.4",
                        buildNumber: "42",
                        state: "READY_FOR_REVIEW",
                        createdAt: yesterday
                    )
                )
            ),
            sessions: [
                SessionInfo(
                    source: "codex",
                    id: "demo-session-codex-001",
                    startedAt: yesterday,
                    endedAt: recent,
                    summary: "Added fictional export checks and verified the sample workflow.",
                    state: .completed,
                    stateReason: "The fictional task completed successfully.",
                    gitBranch: "feature/export-checks",
                    model: "demo-model",
                    filesTouched: ["Sources/ExportValidator.swift", "Tests/ExportValidatorTests.swift"],
                    toolUseCount: 8,
                    conclusion: "The sample export workflow is ready for review."
                ),
                SessionInfo(
                    source: "claude-code",
                    id: "demo-session-claude-001",
                    startedAt: lastWeek,
                    endedAt: lastWeek,
                    summary: "Reviewed the fictional accessibility labels.",
                    state: .completed,
                    stateReason: "The fictional review is complete.",
                    gitBranch: "main",
                    model: "demo-model",
                    filesTouched: ["Sources/SummaryView.swift"],
                    toolUseCount: 3,
                    conclusion: "The sample labels are consistent."
                ),
                SessionInfo(
                    source: "cursor",
                    id: "demo-session-cursor-001",
                    startedAt: lastWeek,
                    endedAt: lastWeek,
                    summary: "Prepared fictional release notes.",
                    state: .completed,
                    stateReason: "The fictional notes are ready.",
                    gitBranch: "main",
                    model: "demo-model",
                    filesTouched: ["Docs/ReleaseNotes.md"],
                    toolUseCount: 2,
                    conclusion: "The sample release notes are ready."
                ),
            ],
            brief: sampleTrackerBrief
        )
    }

    private static var catalogBuilderSummary: ProjectSummary {
        ProjectSummary(
            id: "demo-catalog-builder",
            name: "Catalog Builder",
            lastActivityAt: yesterday,
            branch: "main",
            dirty: true,
            brief: ProjectBrief(
                state: .attention,
                headline: "A fictional copy decision needs attention",
                headlineEvidence: [],
                updatedAt: yesterday,
                activeSessionCount: 0,
                claims: [
                    BriefClaim(
                        id: "demo-claim-attention-001",
                        category: .attention,
                        text: "Choose between two fictional onboarding headlines.",
                        evidence: []
                    )
                ]
            )
        )
    }

    private static var catalogBuilderCard: ProjectCard {
        ProjectCard(
            id: "demo-catalog-builder",
            name: "Catalog Builder",
            path: "/demo/projects/catalog-builder",
            lastActivityAt: yesterday,
            git: nil,
            iosRelease: nil,
            sessions: [],
            brief: catalogBuilderSummary.brief
        )
    }

    private static var weatherWidgetSummary: ProjectSummary {
        ProjectSummary(
            id: "demo-weather-widget",
            name: "Weather Widget",
            lastActivityAt: lastWeek,
            branch: "main",
            dirty: false,
            brief: ProjectBrief(
                state: .quiet,
                headline: "No recent fictional activity",
                headlineEvidence: [],
                updatedAt: lastWeek,
                activeSessionCount: 0,
                claims: []
            )
        )
    }

    private static var weatherWidgetCard: ProjectCard {
        ProjectCard(
            id: "demo-weather-widget",
            name: "Weather Widget",
            path: "/demo/projects/weather-widget",
            lastActivityAt: lastWeek,
            git: nil,
            iosRelease: nil,
            sessions: [],
            brief: weatherWidgetSummary.brief
        )
    }
}

struct DemoRuntimeBriefDataSource: RuntimeBriefDataSource {
    func projects() async throws -> [ProjectSummary] {
        DemoData.projects
    }

    func project(id: String) async throws -> ProjectCard {
        try DemoData.card(id: id)
    }

    func status(projectID: String) async throws -> AnalystAnswer {
        try DemoData.analystAnswer(projectID: projectID)
    }

    func ask(projectID: String, question: String) async throws -> AnalystAnswer {
        try DemoData.analystAnswer(projectID: projectID, question: question)
    }

    func streamStatus(projectID: String) -> AsyncThrowingStream<AnalystStreamEvent, Error> {
        demoStream(projectID: projectID, question: nil)
    }

    func streamAsk(
        projectID: String,
        question: String
    ) -> AsyncThrowingStream<AnalystStreamEvent, Error> {
        demoStream(projectID: projectID, question: question)
    }

    private func demoStream(
        projectID: String,
        question: String?
    ) -> AsyncThrowingStream<AnalystStreamEvent, Error> {
        AsyncThrowingStream { continuation in
            do {
                let answer = try DemoData.analystAnswer(
                    projectID: projectID,
                    question: question
                )
                continuation.yield(.done(answer))
                continuation.finish()
            } catch {
                continuation.finish(throwing: error)
            }
        }
    }
}
