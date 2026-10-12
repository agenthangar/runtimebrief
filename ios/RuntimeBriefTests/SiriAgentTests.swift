import Foundation
import Testing
@testable import RuntimeBrief

@Suite("Tell an agent by voice", .serialized) @MainActor
struct SiriAgentTests {
    private func launch(_ id: String, state: String, minutesAgo: Double, remote: Bool? = true, provider: AgentProvider = .codex) -> ClaudeLaunch {
        var launch = ClaudeLaunch(id: id, projectId: "p", name: id, createdAt: Date().addingTimeInterval(-minutesAgo * 60),
                                  state: state, message: "", nativeId: nil, sessionId: nil, cwd: "/p", openedAt: nil)
        launch.requestedRemoteControl = remote
        launch.provider = provider
        return launch
    }

    private func defaults() -> UserDefaults { UserDefaults(suiteName: "siri-agent-\(UUID())")! }

    @Test func waitingAgentWinsThenTheNewestLiveOne() {
        let waiting = launch("waiting", state: "needs_input", minutesAgo: 30)
        let newest = launch("newest", state: "running", minutesAgo: 1)
        let stopped = launch("stopped", state: "stopped", minutesAgo: 0)
        let noRemote = launch("no-remote", state: "running", minutesAgo: 0, remote: false)
        #expect(SiriAgentMessenger.target(in: [newest, waiting, stopped, noRemote])?.id == "waiting")
        #expect(SiriAgentMessenger.target(in: [newest, stopped, noRemote, launch("older", state: "completed", minutesAgo: 9)])?.id == "newest")
        #expect(SiriAgentMessenger.target(in: [stopped, noRemote, launch("failed", state: "failed", minutesAgo: 0)]) == nil)
        // Every live state is eligible; every other state is not.
        for state in ["needs_input", "running", "starting", "completed", "failed", "stopped", "unknown"] {
            let eligible = ["needs_input", "running", "starting", "completed"].contains(state)
            #expect((SiriAgentMessenger.target(in: [launch("x", state: state, minutesAgo: 1)]) != nil) == eligible, "\(state)")
        }
    }

    @Test func confirmsThenDeliversTheMessageToTheDemoAgent() async throws {
        let source = DemoRuntimeBriefDataSource()
        let project = DemoData.projects[0]
        let started = try await source.startSession(projectID: project.id, request: SessionLaunchRequest(
            requestId: UUID().uuidString.lowercased(), prompt: "Inspect the fictional export", provider: .codex,
            model: "default", reasoningEffort: "default", permissionMode: "manual", remoteControl: true))
        var confirmed: (String, String, String)?
        let text = try await SiriAgentMessenger.send(
            message: "Also add tests", projectID: project.id, projectName: project.name,
            source: source, scope: "demo", isDemo: true, defaults: defaults()
        ) { confirmed = ($0, $1, $2) }
        #expect(confirmed?.0 == "Codex" && confirmed?.1 == project.name && confirmed?.2 == "Also add tests")
        #expect(text == "Fictional demo. No message was sent to a Mac. Sent to Codex on \(project.name).")
        let conversation = try await source.conversation(projectID: project.id, launchID: started.id)
        #expect(conversation.messages.contains { $0.role == "user" && $0.text == "Also add tests" })
    }

    @Test func declinedConfirmationSendsNothing() async throws {
        let source = DemoRuntimeBriefDataSource()
        let project = DemoData.projects[0]
        struct Declined: Error {}
        _ = try await source.startSession(projectID: project.id, request: SessionLaunchRequest(
            requestId: UUID().uuidString.lowercased(), prompt: "Inspect", provider: .claude,
            model: "default", reasoningEffort: "default", permissionMode: "manual", remoteControl: true))
        let before = try await source.sessions(projectID: project.id).launches.first!
        let messagesBefore = try await source.conversation(projectID: project.id, launchID: before.id).messages.count
        await #expect(throws: Declined.self) {
            _ = try await SiriAgentMessenger.send(message: "Stop", projectID: project.id, projectName: project.name,
                                                  source: source, scope: "demo", isDemo: true, defaults: defaults()) { _, _, _ in throw Declined() }
        }
        #expect(try await source.conversation(projectID: project.id, launchID: before.id).messages.count == messagesBefore)
    }

    @Test func explainsHowToStartAnAgentWhenNoneIsRunning() async throws {
        do {
            _ = try await SiriAgentMessenger.send(message: "Hi", projectID: "demo-weather-widget", projectName: "Weather Widget",
                                                  source: DemoRuntimeBriefDataSource(), scope: "demo", isDemo: true, defaults: defaults()) { _, _, _ in }
            Issue.record("Expected a failure")
        } catch let failure as SiriIntentFailure {
            #expect(failure.message.contains("Start Codex for Weather Widget from RuntimeBrief"))
        }
    }
}
