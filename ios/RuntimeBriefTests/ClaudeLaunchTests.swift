import Testing
import Foundation
@testable import RuntimeBrief

@Suite("Claude task launch")
struct ClaudeLaunchTests {
    @Test func uncertainRetriesKeepTheirIdentityAcrossDraftRecreation() throws {
        let suite = "claude-draft-test-\(UUID())"
        let defaults = try #require(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite) }
        let first = ClaudeLaunchDraft.request(projectID: "fixture", scope: "local", prompt: "Fix the export", defaults: defaults)
        let retry = ClaudeLaunchDraft.request(projectID: "fixture", scope: "local", prompt: "Fix the export", defaults: defaults)
        #expect(first.requestId == retry.requestId)
        #expect(ClaudeLaunchDraft.request(projectID: "other", scope: "local", prompt: "Fix the export", defaults: defaults).requestId != first.requestId)
        #expect(ClaudeLaunchDraft.request(projectID: "fixture", scope: "another-mac", prompt: "Fix the export", defaults: defaults).requestId != first.requestId)
        #expect(!String(describing: defaults.dictionaryRepresentation()).contains("Fix the export"))
        ClaudeLaunchDraft.clear(projectID: "fixture", scope: "local", prompt: "Fix the export", defaults: defaults)
        #expect(ClaudeLaunchDraft.request(projectID: "fixture", scope: "local", prompt: "Fix the export", defaults: defaults).requestId != first.requestId)
    }

    @Test func sendsNativeLaunchWithBearerAndStableRequestID() async throws {
        let transport = MockTransport(stubs: ["/claude-launches": .init(status: 202, body: Data(Self.receipt.utf8))])
        let client = RuntimeBriefClient(settings: .mock, transport: transport)
        let requestID = UUID().uuidString
        let result = try await client.startClaude(projectID: "fixture", request: ClaudeLaunchRequest(requestId: requestID, prompt: "Investigate export validation"))
        #expect(result.nativeId == "1234abcd")
        let request = try #require(transport.recorder.requests.first)
        #expect(request.httpMethod == "POST")
        #expect(request.value(forHTTPHeaderField: "Authorization") == "Bearer test-token")
        let data = try #require(request.httpBody)
        let body = try #require(JSONSerialization.jsonObject(with: data) as? [String: String])
        #expect(body["requestId"] == requestID)
        #expect(body["prompt"] == "Investigate export validation")
    }

    @Test func showsActionablePermissionFailure() async throws {
        let transport = MockTransport(stubs: ["/claude-launches": .init(status: 403, body: Data(#"{"message":"Enable launches on your Mac first."}"#.utf8))])
        let client = RuntimeBriefClient(settings: .mock, transport: transport)
        await #expect(throws: RuntimeBriefError.launch("Enable launches on your Mac first.")) {
            try await client.startClaude(projectID: "fixture", request: ClaudeLaunchRequest(requestId: UUID().uuidString, prompt: "Inspect export validation"))
        }
    }

    @Test func demoLaunchAndTakeoverStayFictional() async throws {
        let source = RuntimeBriefDataSourceFactory.make(isDemo: true)
        let id = UUID().uuidString
        let task = ClaudeLaunchRequest(requestId: id, prompt: "Never sent to a Mac")
        let first = try await source.startClaude(projectID: DemoData.projectID, request: task)
        let retry = try await source.startClaude(projectID: DemoData.projectID, request: task)
        #expect(first == retry)
        #expect(first.message.contains("Demo"))
        #expect(first.sessionId == nil)
        #expect(try await source.openClaude(projectID: DemoData.projectID, launchID: first.id) == first)
    }

    private static let receipt = #"{"id":"receipt-id","projectId":"fixture","name":"Fixture task","createdAt":"2026-09-01T00:00:00Z","state":"running","message":"Claude is working.","nativeId":"1234abcd","sessionId":null,"cwd":"/tmp/fixture","openedAt":null}"#
}
