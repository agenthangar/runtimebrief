import Foundation
import Testing
@testable import RuntimeBrief

@Suite("Connection check")
struct ConnectionCheckTests {
    private let health = Data(#"{"version":"1.0.0","uptime":12}"#.utf8)

    @Test func loadsAndDecodesProjectsBeforeReportingSuccess() async throws {
        let transport = MockTransport(stubs: [
            "/health": .init(body: health),
            "/projects": .init(body: Data(#"[{"id":"fixture","name":"Fixture"}]"#.utf8))
        ])
        let result = try await RuntimeBriefClient(settings: .mock, transport: transport).checkConnection()
        #expect(result.projectCount == 1)
        #expect(transport.recorder.requests.map { $0.url!.path } == ["/v1/health", "/v1/projects"])
        #expect(transport.recorder.requests.allSatisfy { $0.cachePolicy == .reloadIgnoringLocalCacheData })
    }

    @Test func healthyDaemonWithBrokenProjectDataDoesNotReportConnected() async throws {
        for stub in [MockTransport.Stub(status: 503, body: Data()), .init(body: Data("not project JSON".utf8))] {
            let transport = MockTransport(stubs: ["/health": .init(body: health), "/projects": stub])
            do {
                _ = try await RuntimeBriefClient(settings: .mock, transport: transport).checkConnection()
                Issue.record("Connection succeeded without usable project data")
            } catch let RuntimeBriefError.projectRefresh(detail) {
                #expect(!detail.isEmpty)
            }
        }
    }
}
