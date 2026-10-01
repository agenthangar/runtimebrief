import Foundation
import Testing
@testable import RuntimeBrief

@MainActor
struct AgentSessionsStoreTests {
    @Test func healthWarmsWithoutLoadingProjectModelsAndReusesItsResult() async throws {
        let transport = MockTransport(stubs: ["/v1/providers": .init(body: Data(#"{"providers":[{"id":"codex","available":true,"message":"Ready","checking":false}]}"#.utf8))])
        let source = LiveRuntimeBriefDataSource(client: RuntimeBriefClient(settings: .mock, transport: transport))
        let store = AgentSessionsStore(identity: { "fixture" }, source: { _ in source }, cacheDirectory: nil)
        await store.warm(); await store.warm()
        #expect(store.providers.first?.available == true)
        #expect(transport.recorder.requests.map { $0.url!.path } == ["/v1/providers"])
    }

    @Test func projectOptOutDoesNotContaminateOtherProjectsAndConnectionChangesClearCache() async throws {
        let transport = MockTransport(stubs: [
            "/v1/providers": .init(body: Data(#"{"providers":[{"id":"codex","available":true,"message":"Ready"}]}"#.utf8)),
            "/sessions": .init(body: Data(#"{"capability":{"available":false,"message":"Starting tasks is disabled for this project."},"launches":[],"providers":[{"id":"codex","available":false,"message":"Starting tasks is disabled for this project."}]}"#.utf8)),
        ])
        let source = LiveRuntimeBriefDataSource(client: RuntimeBriefClient(settings: .mock, transport: transport))
        var identity = "mac-one"
        let store = AgentSessionsStore(identity: { identity }, source: { _ in source }, cacheDirectory: nil)
        await store.warm(); await store.refresh(projectID: "disabled")
        #expect(store.providers.first?.available == true)
        #expect(store.cached(projectID: "disabled")?.capability.available == false)
        identity = "mac-two"
        #expect(store.cached(projectID: "disabled") == nil)
        #expect(store.providers.isEmpty)
    }

    @Test func savedCardsLoadBeforeNetworkingAndRemainVisibleOnRefreshFailure() async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        let json = #"{"capability":{"available":true,"message":"Ready"},"launches":[]}"#
        let transport = MockTransport(stubs: ["/sessions": .init(body: Data(json.utf8))])
        let source = LiveRuntimeBriefDataSource(client: RuntimeBriefClient(settings: .mock, transport: transport))
        let first = AgentSessionsStore(identity: { "fixture" }, source: { _ in source }, cacheDirectory: directory)
        await first.refresh(projectID: "fixture")
        let failed = LiveRuntimeBriefDataSource(client: RuntimeBriefClient(settings: .mock, transport: MockTransport(stubs: ["/sessions": .init(status: 503, body: Data())])))
        let second = AgentSessionsStore(identity: { "fixture" }, source: { _ in failed }, cacheDirectory: directory)
        #expect(second.cached(projectID: "fixture") != nil)
        #expect(second.savedProjects.contains("fixture"))
        await second.refresh(projectID: "fixture")
        #expect(second.cached(projectID: "fixture") != nil)
        #expect(second.errors["fixture"] != nil)
    }

    @Test func replyIDsSurviveRetriesWithoutStoringTextAndAreConnectionScoped() throws {
        let name = "reply-fixture-\(UUID())"
        let defaults = UserDefaults(suiteName: name)!
        defer { defaults.removePersistentDomain(forName: name) }
        let body = SessionReply(requestId: UUID().uuidString, text: "PRIVATE-REPLY-SENTINEL")
        let first = SessionReplyDraft.request(scope: "mac-one", launchID: "fixture", body: body, defaults: defaults)
        #expect(SessionReplyDraft.request(scope: "mac-one", launchID: "fixture", body: body, defaults: defaults).requestId == first.requestId)
        #expect(SessionReplyDraft.request(scope: "mac-two", launchID: "fixture", body: body, defaults: defaults).requestId != first.requestId)
        #expect(!String(describing: defaults.persistentDomain(forName: name)).contains("PRIVATE-REPLY-SENTINEL"))
        SessionReplyDraft.clear(scope: "mac-one", launchID: "fixture", body: body, defaults: defaults)
        #expect(SessionReplyDraft.request(scope: "mac-one", launchID: "fixture", body: body, defaults: defaults).requestId != first.requestId)
    }
}
