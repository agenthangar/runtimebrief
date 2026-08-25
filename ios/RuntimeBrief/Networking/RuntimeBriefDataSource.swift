import Foundation

/// The app reads through this boundary so the App Review demo cannot fall
/// through to live settings, Keychain credentials, caches, or networking.
protocol RuntimeBriefDataSource: Sendable {
    func projects() async throws -> [ProjectSummary]
    func project(id: String) async throws -> ProjectCard
    func status(projectID: String) async throws -> AnalystAnswer
    func ask(projectID: String, question: String) async throws -> AnalystAnswer
    func streamStatus(projectID: String) -> AsyncThrowingStream<AnalystStreamEvent, Error>
    func streamAsk(
        projectID: String,
        question: String
    ) -> AsyncThrowingStream<AnalystStreamEvent, Error>
}

struct LiveRuntimeBriefDataSource: RuntimeBriefDataSource {
    private let client: RuntimeBriefClient

    init(timeout: TimeInterval = 20) {
        client = RuntimeBriefClient(timeout: timeout)
    }

    init(client: RuntimeBriefClient) {
        self.client = client
    }

    func projects() async throws -> [ProjectSummary] {
        try await client.projects()
    }

    func project(id: String) async throws -> ProjectCard {
        try await client.project(id: id)
    }

    func status(projectID: String) async throws -> AnalystAnswer {
        try await client.status(projectID: projectID)
    }

    func ask(projectID: String, question: String) async throws -> AnalystAnswer {
        try await client.ask(projectID: projectID, question: question)
    }

    func streamStatus(projectID: String) -> AsyncThrowingStream<AnalystStreamEvent, Error> {
        client.streamStatus(projectID: projectID)
    }

    func streamAsk(
        projectID: String,
        question: String
    ) -> AsyncThrowingStream<AnalystStreamEvent, Error> {
        client.streamAsk(projectID: projectID, question: question)
    }
}

enum RuntimeBriefModeStore {
    private static let demoKey = "runtimebrief.demo.enabled.v1"

    static var isDemoEnabled: Bool {
        #if DEBUG
        if ProcessInfo.processInfo.environment["RUNTIMEBRIEF_E2E_DEMO"] == "1" {
            return true
        }
        #endif
        return UserDefaults.standard.bool(forKey: demoKey)
    }

    static func setDemoEnabled(_ enabled: Bool) {
        UserDefaults.standard.set(enabled, forKey: demoKey)
    }
}

enum RuntimeBriefDataSourceFactory {
    static func current(timeout: TimeInterval = 20) -> any RuntimeBriefDataSource {
        make(isDemo: RuntimeBriefModeStore.isDemoEnabled, timeout: timeout)
    }

    /// Passing the mode explicitly keeps the privacy boundary directly testable.
    static func make(
        isDemo: Bool,
        timeout: TimeInterval = 20
    ) -> any RuntimeBriefDataSource {
        if isDemo {
            return DemoRuntimeBriefDataSource()
        }
        return LiveRuntimeBriefDataSource(timeout: timeout)
    }
}
