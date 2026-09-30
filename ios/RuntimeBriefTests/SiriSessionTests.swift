import Foundation
import Testing
@testable import RuntimeBrief

@Suite(.serialized) @MainActor
struct SiriSessionTests {
    private let project = ProjectEntity(summary: DemoData.projects[0])
    private let prompt = "Inspect the fictional export"

    private func defaults() -> UserDefaults { UserDefaults(suiteName: "siri-session-\(UUID())")! }

    private func source(_ transport: SessionTransport) -> LiveRuntimeBriefDataSource {
        LiveRuntimeBriefDataSource(client: RuntimeBriefClient(settings: .mock, transport: transport))
    }

    @Test func allProvidersUseSessionEndpointAndNativeOptionsAfterConfirmation() async throws {
        for provider in AgentProvider.allCases {
            let transport = SessionTransport(provider: provider)
            var confirmed = false
            let result = try await SiriSessionLauncher.run(
                project: project, provider: provider, task: "  \(prompt)  ", model: "demo-model",
                permissions: .plan, reasoning: .high, remoteControl: false,
                source: source(transport), scope: "fixture", isDemo: false, defaults: defaults()
            ) { name, task in
                #expect(name == self.project.name && task == self.prompt)
                #expect(transport.recorder.requests.allSatisfy { $0.httpMethod != "POST" })
                confirmed = true
            }
            #expect(confirmed)
            #expect(result.receipt.agent == provider)
            let post = try #require(transport.recorder.requests.last)
            #expect(post.url?.path == "/v1/projects/\(project.id)/sessions")
            #expect(post.httpMethod == "POST")
            let body = try JSONSerialization.jsonObject(with: #require(post.httpBody)) as! [String: Any]
            #expect(body["provider"] as? String == provider.rawValue)
            #expect(body["prompt"] as? String == prompt)
            #expect(body["model"] as? String == "demo-model")
            #expect(body["permissionMode"] as? String == "plan")
            #expect(body["reasoningEffort"] as? String == "high")
            #expect(body["remoteControl"] as? Bool == false)
            #expect(result.text.contains("agent is working"))
            #expect(!result.text.contains("finished"))
        }
    }

    @Test func cancellationDoesNotWriteOrReserveRetryIdentity() async throws {
        let transport = SessionTransport(provider: .codex)
        let storage = defaults()
        await #expect(throws: CancellationError.self) {
            try await SiriSessionLauncher.run(project: project, provider: .codex, task: prompt,
                source: source(transport), scope: "fixture", isDemo: false, defaults: storage) { _, _ in
                throw CancellationError()
            }
        }
        #expect(transport.recorder.requests.allSatisfy { $0.httpMethod != "POST" })
        #expect(!storage.dictionaryRepresentation().keys.contains { $0.hasPrefix("runtimebrief.session.request.") })
    }

    @Test func uncertainLaunchAndLostResponseReuseIdentityThenConfirmedLaunchClearsIt() async throws {
        let transport = SessionTransport(provider: .cursor, state: "unknown")
        let storage = defaults()
        func launch() async throws -> SiriSessionLauncher.Result {
            try await SiriSessionLauncher.run(project: project, provider: .cursor, task: prompt,
                source: source(transport), scope: "fixture", isDemo: false, defaults: storage) { _, _ in }
        }
        let first = try await launch()
        #expect(first.text.contains("uncertain"))
        let id = try transport.lastRequestID()
        transport.failPost = true
        await #expect(throws: SiriIntentFailure.self) { try await launch() }
        #expect(try transport.lastRequestID() == id)
        transport.failPost = false
        transport.state = "running"
        _ = try await launch()
        #expect(try transport.lastRequestID() == id)
        _ = try await launch()
        #expect(try transport.lastRequestID() != id)
    }

    @Test func unavailableAuthRemovedProjectAndInvalidSettingsNeverConfirmOrWrite() async throws {
        for scenario in 0...6 {
            let transport = SessionTransport(provider: .codex)
            if scenario == 0 { transport.status = 401 }
            if scenario == 1 { transport.projects = [] }
            if scenario == 2 { transport.available = false }
            let task = scenario == 3 ? "/command" : scenario == 4 ? "Task\u{0007} description" : prompt
            await #expect(throws: SiriIntentFailure.self) {
                try await SiriSessionLauncher.run(project: project, provider: .codex, task: task,
                    model: scenario == 5 ? "removed-model" : "default",
                    permissions: scenario == 6 ? .ask : .manual,
                    source: source(transport), scope: "fixture", isDemo: false, defaults: defaults()) { _, _ in
                    Issue.record("Invalid launch reached confirmation")
                }
            }
            #expect(transport.recorder.requests.allSatisfy { $0.httpMethod != "POST" })
        }
    }

    @Test func demoLaunchesAllProvidersWithoutLiveSettings() async throws {
        for provider in AgentProvider.allCases {
            let result = try await SiriSessionLauncher.run(project: project, provider: provider, task: prompt,
                source: RuntimeBriefDataSourceFactory.make(isDemo: true), scope: "demo", isDemo: true,
                defaults: defaults()) { _, _ in }
            #expect(result.receipt.agent == provider)
            #expect(result.text.contains("Fictional demo. No work was sent to a Mac."))
            #expect(result.receipt.requestedRemoteControl == true)
        }
    }

    @Test func statusSeparatesLaunchFromCompletionAndRemoteConnection() {
        var receipt = ClaudeLaunch(id: "fixture", projectId: project.id, name: "Fixture", createdAt: Date(),
            state: "starting", message: "Starting", nativeId: nil, sessionId: nil, cwd: "/tmp/fixture", openedAt: nil)
        receipt.provider = .codex
        receipt.remoteControl = ClaudeRemoteControl(state: "starting", url: nil)
        #expect(SiriSessionLauncher.describe(receipt, projectName: project.name, isDemo: false).contains("completion is not yet confirmed"))
        #expect(SiriSessionLauncher.describe(receipt, projectName: project.name, isDemo: false).contains("terminal starting"))
        let failed = ClaudeLaunch(id: "failed", projectId: project.id, name: "Fixture", createdAt: Date(),
            state: "failed", message: "Starting failed", nativeId: nil, sessionId: nil, cwd: "/tmp/fixture", openedAt: nil)
        #expect(SiriSessionLauncher.describe(failed, projectName: project.name, isDemo: false).contains("could not start"))
    }
}

/// Scripted HTTP boundary: validation and confirmation tests exercise the real
/// client serialization and endpoint selection, without creating native work.
private final class SessionTransport: HTTPTransport, @unchecked Sendable {
    let recorder = MockTransport.Recorder()
    let provider: AgentProvider
    var projects = DemoData.projects
    var status = 200
    var available = true
    var state: String
    var failPost = false
    init(provider: AgentProvider, state: String = "running") { self.provider = provider; self.state = state }

    func lastRequestID() throws -> String {
        let request = try #require(recorder.requests.last { $0.httpMethod == "POST" })
        let body = try JSONSerialization.jsonObject(with: #require(request.httpBody)) as! [String: Any]
        return try #require(body["requestId"] as? String)
    }

    func data(for request: URLRequest) async throws -> (Data, URLResponse) {
        recorder.record(request)
        let body: Data
        if request.httpMethod == "POST" {
            if failPost { throw URLError(.timedOut) }
            body = Data("""
                {"id":"receipt","provider":"\(provider.rawValue)","projectId":"\(projects[0].id)","name":"Fixture",
                 "createdAt":"2026-09-30T00:00:00Z","state":"\(state)","message":"Fixture state",
                 "nativeId":null,"sessionId":null,"cwd":"/tmp/fixture","openedAt":null}
                """.utf8)
        } else if request.url?.path == "/v1/projects" {
            let encoder = JSONEncoder()
            encoder.dateEncodingStrategy = .iso8601
            body = try encoder.encode(projects)
        } else {
            body = Data("""
                {"capability":{"available":true,"message":"Ready"},"launches":[],
                 "providers":[{"id":"\(provider.rawValue)","available":\(available),"message":"Needs setup",
                 "models":[{"id":"demo-model","label":"Demo model","reasoningEfforts":["high"]}],
                 "defaultModelLabel":"demo-model","permissionModes":["manual","plan"]}]}
                """.utf8)
        }
        return (body, HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: nil, headerFields: nil)!)
    }
    func byteStream(for request: URLRequest) async throws -> (AsyncThrowingStream<UInt8, Error>, URLResponse) {
        throw URLError(.unsupportedURL)
    }
}
