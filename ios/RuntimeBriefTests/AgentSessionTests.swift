import Foundation
import Testing
@testable import RuntimeBrief

struct AgentSessionTests {
    @Test func providersHaveSeparateDurableRetryIdentities() {
        let defaults = UserDefaults(suiteName: "sessions-\(UUID())")!
        let prompt = "Inspect the fictional export"
        let codex = SessionLaunchDraft.request(projectID: "fixture", scope: "fixture", prompt: prompt, provider: .codex, defaults: defaults)
        let cursor = SessionLaunchDraft.request(projectID: "fixture", scope: "fixture", prompt: prompt, provider: .cursor, defaults: defaults)
        #expect(codex.requestId != cursor.requestId)
        #expect(codex.remoteControl && cursor.remoteControl)
        #expect(SessionLaunchDraft.request(projectID: "fixture", scope: "fixture", prompt: prompt, provider: .codex, defaults: defaults).requestId == codex.requestId)
        #expect(SessionLaunchDraft.request(projectID: "fixture", scope: "fixture", prompt: prompt, provider: .codex, remoteControl: false, defaults: defaults).requestId != codex.requestId)
        let claude = SessionLaunchDraft.request(projectID: "fixture", scope: "fixture", prompt: prompt, provider: .claude, defaults: defaults)
        #expect(claude.requestId == ClaudeLaunchDraft.request(projectID: "fixture", scope: "fixture", prompt: prompt, defaults: defaults).requestId)
    }

    @Test func demoTerminalCannotFallThroughToLiveControl() async throws {
        let source = RuntimeBriefDataSourceFactory.make(isDemo: true)
        for provider in [AgentProvider.codex, .cursor] {
            let request = SessionLaunchRequest(requestId: UUID().uuidString, prompt: "Inspect the fictional task", provider: provider)
            let launch = try await source.startSession(projectID: "demo-sample-tracker", request: request)
            #expect(launch.agent == provider)
            #expect(launch.remoteControl?.state == "ready")
            let input = TerminalInput(requestId: UUID().uuidString, data: "Follow-up\r")
            #expect(try await source.sendInput(projectID: launch.projectId, launchID: launch.id, input: input).state == "sent")
            _ = try await source.sendInput(projectID: launch.projectId, launchID: launch.id, input: input)
            let terminal = try await source.terminal(projectID: launch.projectId, launchID: launch.id)
            #expect(terminal.screen.components(separatedBy: "Follow-up").count == 2)
            #expect(terminal.screen.contains("No Mac is connected"))
        }
    }

    @Test func optOutRemovesDemoTerminalAccess() async throws {
        let source = RuntimeBriefDataSourceFactory.make(isDemo: true)
        let request = SessionLaunchRequest(requestId: UUID().uuidString, prompt: "Inspect the fictional task", provider: .cursor, remoteControl: false)
        let launch = try await source.startSession(projectID: "demo-sample-tracker", request: request)
        #expect(launch.remoteControl?.state == "disabled")
        await #expect(throws: RuntimeBriefError.notFound) { try await source.terminal(projectID: launch.projectId, launchID: launch.id) }
    }
}
