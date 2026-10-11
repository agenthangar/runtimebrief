import Foundation
import Testing
@testable import RuntimeBrief

private final class FixtureBundle {}

@Suite("Siri open questions", .serialized)
struct SiriQuestionTests {
    private struct MentionFixture: Decodable {
        struct Project: Decodable { let id: String; let name: String; let aliases: [String]? }
        struct Case: Decodable { let question: String; let expected: [String] }
        let projects: [Project]
        let cases: [Case]
    }

    private func mentionFixture() throws -> MentionFixture {
        let url = try #require(Bundle(for: FixtureBundle.self).url(forResource: "project-mentions", withExtension: "json"))
        return try JSONDecoder().decode(MentionFixture.self, from: Data(contentsOf: url))
    }

    private func store() -> ProjectsStore {
        ProjectsStore(defaults: UserDefaults(suiteName: "siri-question-\(UUID().uuidString)")!, discovery: nil)
    }

    private func json(_ value: some Encodable) throws -> Data {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        return try encoder.encode(value)
    }

    private func source(_ stubs: [String: MockTransport.Stub]) -> (LiveRuntimeBriefDataSource, MockTransport) {
        let transport = MockTransport(stubs: stubs)
        return (LiveRuntimeBriefDataSource(client: RuntimeBriefClient(settings: .mock, transport: transport, timeout: 13)), transport)
    }

    private let evidence = EvidenceRef(id: "git-commit-abc@demo-sample-tracker", kind: .commit, label: "Commit",
                                       detail: "Export checks", source: "git", timestamp: nil)

    private func response(
        _ status: AskResponse.Status,
        scope: AskResponse.Scope,
        answer: String? = nil,
        interim: AskResponse.Interim? = nil
    ) -> AskResponse {
        AskResponse(
            status: status, scope: scope,
            projects: scope == .project ? [.init(id: "demo-sample-tracker", name: "Sample Tracker")] : [],
            answer: answer, evidence: answer == nil ? [] : [evidence], cached: false, interim: interim
        )
    }

    // MARK: Routing parity with the daemon

    @Test func mentionMatcherPassesTheSharedFixture() throws {
        let fixture = try mentionFixture()
        let candidates = fixture.projects.flatMap { project in
            [(id: project.id, name: project.name)] + (project.aliases ?? []).map { (id: project.id, name: $0) }
        }
        for example in fixture.cases {
            #expect(ProjectMentionMatcher.resolve(example.question, candidates: candidates) == example.expected,
                    "\(example.question)")
        }
    }

    @Test func everyDemoProjectIsFoundInAnySentence() {
        let candidates = DemoData.projects.map { (id: $0.id, name: $0.name) }
        for project in DemoData.projects {
            for template in ["how is {} doing", "did {} pass its tests?", "what's claude doing on the {} app", "{}"] {
                let question = template.replacingOccurrences(of: "{}", with: project.name)
                #expect(ProjectMentionMatcher.resolve(question, candidates: candidates) == [project.id], "\(question)")
            }
        }
    }

    // MARK: Transport

    @Test func askPostsTheQuestionWithinSirisTimeBudget() async throws {
        let body = try json(response(.answered, scope: .portfolio, answer: "Nothing is blocked. [git-commit-abc@demo-sample-tracker]"))
        let (source, transport) = source(["/v1/ask": .init(body: body)])
        let decoded = try await source.askAnything(question: "Is anything blocked?", projectID: nil)
        #expect(decoded.status == .answered)
        let request = try #require(transport.recorder.requests.first)
        #expect(request.url?.path == "/v1/ask")
        #expect(request.httpMethod == "POST")
        #expect(request.timeoutInterval == 13)
        let sent = try JSONSerialization.jsonObject(with: #require(request.httpBody)) as! [String: Any]
        #expect(sent["question"] as? String == "Is anything blocked?")
        #expect(sent["waitMs"] as? Int == 8_000)
        #expect(sent["projectId"] == nil)
    }

    @Test func missingRouteMeansAnOlderDaemonButUnknownProjectStaysNotFound() async throws {
        let (old, _) = source(["/v1/ask": .init(status: 404, body: Data(#"{"message":"Route POST:/v1/ask not found","error":"Not Found","statusCode":404}"#.utf8))])
        await #expect(throws: RuntimeBriefError.unsupportedServer) {
            _ = try await old.askAnything(question: "Anything?", projectID: nil)
        }
        let (current, _) = source(["/v1/ask": .init(status: 404, body: Data(#"{"error":"not_found"}"#.utf8))])
        await #expect(throws: RuntimeBriefError.notFound) {
            _ = try await current.askAnything(question: "Anything?", projectID: "ghost")
        }
    }

    // MARK: Spoken replies

    @Test func everyReplyIsTwoSpeakableLinesThatSayWhatHappened() {
        let saved = AskResponse.Interim(answer: "Done: Export shipped. [git-commit-abc]\nNow: Waiting for review. [git-commit-abc]\nNext: Review it. [git-commit-abc]",
                                        evidence: [], analyzedAt: Date().addingTimeInterval(-3 * 3600))
        let long = "Checks passed on the export branch. Build 35 is processing. Review is next. [git-commit-abc@demo-sample-tracker]"
        for status in [AskResponse.Status.answered, .pending, .failed] {
            for scope in [AskResponse.Scope.project, .portfolio] {
                let reply = SiriQuestion.reply(for: response(
                    status, scope: scope,
                    answer: status == .answered ? long : nil,
                    interim: status == .answered ? nil : saved
                ))
                let label = "\(status) \(scope): \(reply.text)"
                #expect(SiriBrief.sentences(reply.text).count <= 2, "\(label)")
                #expect(!reply.text.contains("["), "\(label)")
                #expect(!reply.text.contains("Done:") && !reply.text.contains("Now:"), "\(label)")
                #expect(reply.title == (scope == .project ? "Sample Tracker" : SiriQuestion.portfolioTitle), "\(label)")
                #expect(reply.text.contains("ask again in a minute") == (status == .pending), "\(label)")
                if scope == .project { #expect(reply.text.contains("Sample Tracker"), "\(label)") }
                if status == .answered {
                    #expect(!reply.text.contains("Review is next"), "\(label)")
                    #expect(reply.detail.contains("Review is next"), "Shortcuts still get the whole answer")
                } else {
                    #expect(reply.text.hasSuffix("Recently, Export shipped."), "\(label)")
                }
            }
        }
    }

    @Test func instantSavedAnswersSayTheirAgeInTwoLines() throws {
        var saved = response(.answered, scope: .project,
                             answer: "Done: The latest session fixed ingredient search. [git-commit-abc]\nNow: The working tree is clean. [git-commit-abc]\nNext: Ship it. [git-commit-abc]")
        saved.analyzedAt = Date().addingTimeInterval(-2 * 3600)
        let reply = SiriQuestion.reply(for: saved)
        #expect(reply.text == "Sample Tracker, analyzed 2 hours ago: Recently, the latest session fixed ingredient search. Currently, the working tree is clean.")
        #expect(reply.detail.contains("Next, Ship it."))
        let decoded = try JSONDecoder.runtimeBrief.decode(AskResponse.self, from: Data(
            #"{"status":"answered","scope":"project","projects":[],"answer":"Ok.","evidence":[],"cached":true,"analyzedAt":"2026-10-10T10:00:00.000Z","interim":null}"#.utf8))
        #expect(decoded.analyzedAt != nil)
    }

    @Test func projectAnswersAreNotNamedTwice() {
        let reply = SiriQuestion.reply(for: response(.answered, scope: .project,
            answer: "Sample Tracker's export checks passed. [git-commit-abc@demo-sample-tracker]"))
        #expect(reply.text == "Sample Tracker's export checks passed.")
    }

    // MARK: End to end through the data source

    @Test func currentDaemonAnswerIsSpokenWithoutCitations() async throws {
        let body = try json(response(.answered, scope: .project, answer: "Checks passed. [git-commit-abc@demo-sample-tracker]"))
        let (source, _) = source(["/v1/ask": .init(body: body)])
        let reply = try await SiriQuestion.answer(question: "Did sample tracker pass?", projectID: nil, dataSource: source, store: store())
        #expect(reply == SiriQuestionReply(title: "Sample Tracker", text: "Sample Tracker: Checks passed."))
    }

    @Test func olderDaemonRoutesANamedProjectToItsAnalyst() async throws {
        let answer = AnalystAnswer(answer: "The copy decision is still open. [demo-evidence-commit-001]", costUsd: 0,
                                   cached: false, truncated: false, evidence: nil)
        let (source, transport) = source([
            "/v1/ask": .init(status: 404, body: Data(#"{"error":"Not Found"}"#.utf8)),
            "/v1/projects": .init(body: try json(DemoData.projects)),
            "/v1/projects/demo-catalog-builder/ask": .init(body: try json(answer)),
        ])
        let reply = try await SiriQuestion.answer(question: "What is blocking catalog builder?", projectID: nil,
                                                  dataSource: source, store: store())
        #expect(reply == SiriQuestionReply(title: "Catalog Builder", text: "Catalog Builder: The copy decision is still open."))
        let paths = transport.recorder.requests.compactMap { $0.url?.path }
        #expect(paths == ["/v1/ask", "/v1/projects", "/v1/projects/demo-catalog-builder/ask"])
    }

    @Test func olderDaemonAnswersPortfolioQuestionsFromBriefs() async throws {
        let (source, _) = source([
            "/v1/ask": .init(status: 404, body: Data(#"{"error":"Not Found"}"#.utf8)),
            "/v1/projects": .init(body: try json(DemoData.projects)),
        ])
        let reply = try await SiriQuestion.answer(question: "Is anything blocked?", projectID: nil, dataSource: source, store: store())
        #expect(reply.title == SiriQuestion.portfolioTitle)
        #expect(reply.text.contains("You have 3 projects"))
        #expect(reply.text.hasSuffix("Update RuntimeBrief on your Mac to ask more."))
    }

    @Test func unreachableMacFallsBackToLabelledSavedBriefs() async throws {
        let store = store()
        let (online, _) = source(["/v1/projects": .init(body: try json(DemoData.projects))])
        _ = try await store.briefSnapshot(dataSource: online)
        let (offline, _) = source([:])
        let project = try await SiriQuestion.answer(question: "how is sample tracker", projectID: nil,
                                                    dataSource: offline, store: store)
        #expect(project.title == "Sample Tracker")
        #expect(project.text.hasPrefix("Your Mac is unreachable. Using saved briefs"))
        #expect(project.text.contains("Export validation is ready to review"))
        let overview = try await SiriQuestion.answer(question: "anything new?", projectID: nil, dataSource: offline, store: store)
        #expect(overview.text.contains("You have 3 projects"))
    }

    @Test func unauthorizedIsNotMaskedBySavedBriefs() async throws {
        let (source, _) = source(["/v1/ask": .init(status: 401, body: Data())])
        await #expect(throws: RuntimeBriefError.unauthorized) {
            _ = try await SiriQuestion.answer(question: "Anything?", projectID: nil, dataSource: source, store: store())
        }
    }

    // MARK: Demo

    @Test func demoRoutesLikeTheDaemon() async throws {
        let demo = DemoRuntimeBriefDataSource()
        let project = SiriQuestion.reply(for: try await demo.askAnything(question: "Did the Sample Tracker checks pass?", projectID: nil))
        #expect(project.title == "Sample Tracker")
        #expect(project.text.contains("fictional demo response"))
        let portfolio = SiriQuestion.reply(for: try await demo.askAnything(question: "What needs my attention?", projectID: nil))
        #expect(portfolio.title == SiriQuestion.portfolioTitle)
        #expect(portfolio.text.contains("Catalog Builder needs your attention"))
        let chosen = try await demo.askAnything(question: "Anything new?", projectID: "demo-weather-widget")
        #expect(chosen.projects.map(\.name) == ["Weather Widget"])
    }
}
