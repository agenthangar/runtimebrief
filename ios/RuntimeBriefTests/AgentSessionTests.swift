import Foundation
import Testing
@testable import RuntimeBrief

struct AgentSessionTests {
    @Test func nativeChoicesDecodeWithLegacyCompatibility() throws {
        let old = try JSONDecoder().decode(AgentCapability.self, from: Data(#"{"id":"codex","available":true,"message":"Ready"}"#.utf8))
        #expect(old.models == nil && old.permissionModes == nil)
        let current = try JSONDecoder().decode(AgentCapability.self, from: Data(#"{"id":"cursor","available":true,"message":"Ready","models":[{"id":"example-model","label":"Example model"}],"permissionModes":["manual","bypassPermissions"]}"#.utf8))
        #expect(current.models?.first?.id == "example-model")
        #expect(current.permissionModes?.contains("bypassPermissions") == true)
        #expect(AgentProvider.cursor.permissionLabel("bypassPermissions") == "Bypass")
    }

    @Test func selectedNativeOptionsAreSentAndChangeRetryIdentity() async throws {
        let defaults = UserDefaults(suiteName: "options-\(UUID())")!
        for provider in [AgentProvider.codex, .cursor] {
            let selected = SessionLaunchDraft.request(projectID: "fixture", scope: "fixture", prompt: "Inspect the fictional options", provider: provider, model: "demo-model", permissionMode: "bypassPermissions", reasoningEffort: "medium", defaults: defaults)
            let standard = SessionLaunchDraft.request(projectID: "fixture", scope: "fixture", prompt: "Inspect the fictional options", provider: provider, defaults: defaults)
            #expect(selected.requestId != standard.requestId)
            let json = try JSONSerialization.jsonObject(with: JSONEncoder().encode(selected)) as! [String: Any]
            #expect(json["model"] as? String == "demo-model")
            #expect(json["permissionMode"] as? String == "bypassPermissions")
            #expect(json["reasoningEffort"] as? String == "medium")
            #expect(json["remoteControl"] as? Bool == true)
            let launch = await DemoClaudeTasks.shared.start(projectID: "fixture", request: selected)
            #expect(launch.model == "demo-model" && launch.permissionMode == "bypassPermissions")
        }
    }

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
