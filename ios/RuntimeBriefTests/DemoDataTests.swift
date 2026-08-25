import Foundation
import Testing
@testable import RuntimeBrief

@Suite("Privacy-safe demo")
struct DemoDataTests {
    @Test func fixtureContainsOnlyFictionalPortableValues() throws {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys]
        let payloads = try DemoData.projects.map(encoder.encode)
            + DemoData.cards.map(encoder.encode)
            + [encoder.encode(try DemoData.analystAnswer(projectID: DemoData.projectID))]
        let text = payloads
            .compactMap { String(data: $0, encoding: .utf8) }
            .joined(separator: "\n")

        let forbidden = [
            "/Users/", "/home/", ".ts.net", "Bearer ", "token", "@",
            "com.backbrief.app", "runtimebriefd", "127.0.0.1", "192.168.",
        ]
        for value in forbidden {
            #expect(!text.localizedCaseInsensitiveContains(value), "forbidden demo value: \(value)")
        }
        #expect(DemoData.cards.allSatisfy { $0.path.hasPrefix("/demo/projects/") })
        #expect(text.contains("com.example.sampletracker"))
        #expect(text.contains("Demo Developer"))
    }

    @Test func demoFactoryDoesNotConstructTheLiveSource() {
        let source = RuntimeBriefDataSourceFactory.make(isDemo: true)
        #expect(source is DemoRuntimeBriefDataSource)
        #expect(!(source is LiveRuntimeBriefDataSource))
    }

    @Test func demoSupportsEveryPrimaryReadWithoutSettingsOrNetwork() async throws {
        let source = DemoRuntimeBriefDataSource()
        let projects = try await source.projects()
        #expect(projects.count == 3)

        let card = try await source.project(id: DemoData.projectID)
        #expect(card.path.hasPrefix("/demo/"))
        #expect(card.sessions.count == 3)
        #expect(card.iosRelease?.xcode.bundleId == "com.example.sampletracker")

        let status = try await source.status(projectID: DemoData.projectID)
        let answer = try await source.ask(
            projectID: DemoData.projectID,
            question: "Did the fictional checks pass?"
        )
        #expect(status.costUsd == 0)
        #expect(answer.cached)
        #expect(answer.evidence?.count == 2)
    }

    @Test func unknownDemoProjectsFailClosed() async {
        let source = DemoRuntimeBriefDataSource()
        await #expect(throws: RuntimeBriefError.notFound) {
            _ = try await source.project(id: "demo-missing-project")
        }
    }
}
