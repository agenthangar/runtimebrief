import Testing
import Foundation
@testable import RuntimeBrief

@Suite("RuntimeBriefClient")
struct APIClientTests {
    private func client(_ stubs: [String: MockTransport.Stub]) -> (RuntimeBriefClient, MockTransport) {
        let transport = MockTransport(stubs: stubs)
        return (RuntimeBriefClient(settings: .mock, transport: transport), transport)
    }

    @Test func decodesProjectList() async throws {
        let json = """
        [{"id":"meal","name":"Sample Tracker App","lastActivityAt":"2026-07-09T10:00:00.000Z",
          "branch":"main","dirty":true,
          "brief":{"state":"recent","headline":"Recent work is ready to review",
            "headlineEvidence":[{"id":"git-working-tree","kind":"working-tree",
              "label":"Working tree · main","detail":"2 uncommitted files on main",
              "source":"git","timestamp":"2026-07-09T10:00:00.000Z"}],
            "updatedAt":"2026-07-09T10:00:00.000Z","activeSessionCount":0,
            "claims":[{"id":"dirty-working-tree","category":"context",
              "text":"2 uncommitted files in the working tree.",
              "evidence":[{"id":"git-working-tree","kind":"working-tree",
                "label":"Working tree · main","detail":"2 uncommitted files on main",
                "source":"git","timestamp":"2026-07-09T10:00:00.000Z"}]}]}},
         {"id":"ghost","name":"Ghost","lastActivityAt":null,"branch":null,"dirty":null}]
        """
        let (client, transport) = client(["/v1/projects": .init(body: Data(json.utf8))])
        let projects = try await client.projects()
        #expect(projects.count == 2)
        #expect(projects[0].id == "meal")
        #expect(projects[0].dirty == true)
        #expect(projects[0].lastActivityAt != nil)
        #expect(projects[0].brief?.state == .recent)
        #expect(projects[0].brief?.claims.first?.evidence.first?.id == "git-working-tree")
        #expect(projects[1].branch == nil)
        // Bearer token attached.
        let auth = transport.recorder.requests.first?.value(forHTTPHeaderField: "Authorization")
        #expect(auth == "Bearer test-token")
    }

    @Test func projectCardCarriesBriefAndAgentLifecycleWithoutAnalystRequest() async throws {
        let json = """
        {"id":"meal","name":"Sample Tracker App","path":"/dev/meal",
         "lastActivityAt":"2026-07-09T10:03:00.000Z","git":null,
         "brief":{"state":"attention","headline":"Waiting for your input",
          "headlineEvidence":[{"id":"session-codex-s1","kind":"session",
            "label":"Codex · s1","detail":"Codex session s1 · state: waiting",
            "source":"codex","timestamp":"2026-07-09T10:03:00.000Z"}],
          "updatedAt":"2026-07-09T10:03:00.000Z","activeSessionCount":0,
          "claims":[{"id":"waiting-codex-s1","category":"attention",
            "text":"Codex is waiting for your input.",
            "evidence":[{"id":"session-codex-s1","kind":"session",
              "label":"Codex · s1","detail":"Codex session s1 · state: waiting",
              "source":"codex","timestamp":"2026-07-09T10:03:00.000Z"}]}]},
         "sessions":[{"source":"codex","id":"s1",
          "startedAt":"2026-07-09T10:00:00.000Z",
          "endedAt":"2026-07-09T10:03:00.000Z",
          "summary":"Build the dashboard","state":"waiting",
          "stateReason":"Codex requested user input.",
          "gitBranch":"feature/brief","model":"gpt-5.6-sol",
          "filesTouched":["ios/ProjectsListView.swift"],"toolUseCount":4,
          "conclusion":"The dashboard is in progress."}]}
        """
        let (client, transport) = client([
            "/v1/projects/meal": .init(body: Data(json.utf8))
        ])
        let card = try await client.project(id: "meal")
        #expect(card.brief?.state == .attention)
        #expect(card.sessions.first?.state == .waiting)
        #expect(card.sessions.first?.filesTouched?.count == 1)
        #expect(transport.recorder.requests.count == 1)
        #expect(transport.recorder.requests.first?.url?.path == "/v1/projects/meal")
        #expect(transport.recorder.requests.first?.url?.path.contains("/status") == false)
    }

    @Test func projectCardDecodesXcodeTestFlightAndAppStoreSummaries() async throws {
        let json = """
        {"id":"ios-app","name":"iOS App","path":"/tmp/ios-app","lastActivityAt":null,
         "git":null,"brief":null,"sessions":[],
         "iosRelease":{
           "xcode":{"source":"xcodegen","projectFile":"project.yml","scheme":"Example",
             "bundleId":"com.example.app","marketingVersion":"1.4.0","buildNumber":"42"},
           "appStoreConnect":{"status":"available","checkedAt":"2026-07-31T10:00:00Z",
             "message":null,"appId":"123",
             "latestTestFlightBuild":{"id":"build-42","marketingVersion":"1.4.0",
               "buildNumber":"42","uploadedAt":"2026-07-30T10:00:00Z","expiresAt":null,
               "expired":false,"processingState":"VALID",
               "audienceType":"APP_STORE_ELIGIBLE"},
             "appStoreVersion":{"id":"store-1.4","version":"1.4.0","buildNumber":"42",
               "state":"WAITING_FOR_REVIEW","createdAt":"2026-07-30T12:00:00Z"}}}}
        """
        let (client, _) = client([
            "/v1/projects/ios-app": .init(body: Data(json.utf8))
        ])
        let card = try await client.project(id: "ios-app")
        #expect(card.iosRelease?.xcode.bundleId == "com.example.app")
        #expect(card.iosRelease?.xcode.buildNumber == "42")
        #expect(card.iosRelease?.appStoreConnect.latestTestFlightBuild?.processingState == "VALID")
        #expect(card.iosRelease?.appStoreConnect.appStoreVersion?.state == "WAITING_FOR_REVIEW")
    }

    @Test func mapsHTTPStatusToTypedErrors() async throws {
        let cases: [(Int, RuntimeBriefError)] = [
            (401, .unauthorized),
            (404, .notFound),
            (429, .rateLimited),
            (500, .serverError(500)),
        ]
        for (status, expected) in cases {
            let (client, _) = client(["/v1/projects": .init(status: status, body: Data("{}".utf8))])
            await #expect(throws: expected) {
                _ = try await client.projects()
            }
        }
    }

    @Test func throwsNotConfiguredWithoutSettings() async throws {
        let transport = MockTransport(stubs: [:])
        let client = RuntimeBriefClient(
            settings: ServerSettings(baseURL: nil, token: nil), transport: transport)
        await #expect(throws: RuntimeBriefError.notConfigured) {
            _ = try await client.projects()
        }
        #expect(transport.recorder.requests.isEmpty)
    }

    @Test func askPostsQuestionAndDecodesAnswer() async throws {
        let json = """
        {"answer":"All tests pass.","costUsd":0.03,"cached":false,"truncated":false}
        """
        let (client, transport) = client(["/v1/projects/meal/ask": .init(body: Data(json.utf8))])
        let answer = try await client.ask(projectID: "meal", question: "Did tests pass?")
        #expect(answer.answer == "All tests pass.")
        let request = transport.recorder.requests.first
        #expect(request?.httpMethod == "POST")
        let body = try JSONDecoder().decode(
            [String: String].self, from: request?.httpBody ?? Data())
        #expect(body["question"] == "Did tests pass?")
    }

    @Test func analystAnswerProvidesCheckableEvidenceAndSiriFriendlyText() async throws {
        let json = """
        {"answer":"Tests pass. [git-commit-abc]","costUsd":0.03,
         "cached":false,"truncated":false,
         "evidence":[{"id":"git-commit-abc","kind":"commit","label":"Commit abc",
           "detail":"Dev: Run tests","source":"git","timestamp":"2026-07-09T10:00:00.000Z"}]}
        """
        let (client, _) = client(["/v1/projects/meal/ask": .init(body: Data(json.utf8))])
        let answer = try await client.ask(projectID: "meal", question: "Did tests pass?")
        #expect(answer.evidence?.first?.id == "git-commit-abc")
        #expect(answer.spokenAnswer.contains("[git-commit-abc]") == false)
        #expect(answer.spokenAnswer.contains("Evidence is available") == true)
    }

    @Test func streamsSSEChunksAndDone() async throws {
        let sse = """
        event: chunk
        data: {"text":"The project "}

        event: chunk
        data: {"text":"is fine."}

        event: done
        data: {"answer":"The project is fine.","costUsd":0.01,"cached":false,"truncated":false}


        """
        let (client, _) = client([
            "/v1/projects/meal/status": .init(
                body: Data(sse.utf8), headers: ["Content-Type": "text/event-stream"])
        ])
        var chunks: [String] = []
        var done: AnalystAnswer?
        for try await event in client.streamStatus(projectID: "meal") {
            switch event {
            case .chunk(let text): chunks.append(text)
            case .done(let answer): done = answer
            case .failure: Issue.record("unexpected failure event")
            }
        }
        #expect(chunks == ["The project ", "is fine."])
        #expect(done?.answer == "The project is fine.")
    }

    @Test func streamSurfacesUnauthorized() async throws {
        let (client, _) = client([
            "/v1/projects/meal/status": .init(status: 401, body: Data())
        ])
        await #expect(throws: RuntimeBriefError.unauthorized) {
            for try await _ in client.streamStatus(projectID: "meal") {}
        }
    }
}

@Suite("ServerSettings")
struct ServerSettingsTests {
    @Test func normalizesBareHostPort() {
        #expect(ServerSettings.normalizeURL("192.168.1.5:8484")?.absoluteString == "http://192.168.1.5:8484")
        #expect(ServerSettings.normalizeURL("mini.tail1234.ts.net")?.absoluteString == "https://mini.tail1234.ts.net:443")
        #expect(ServerSettings.normalizeURL("https://mini.tail1234.ts.net")?.absoluteString == "https://mini.tail1234.ts.net:443")
        #expect(ServerSettings.normalizeURL("https://mini.example.com:9000")?.absoluteString == "https://mini.example.com:9000")
        #expect(ServerSettings.normalizeURL("") == nil)
        #expect(ServerSettings.normalizeURL("   ") == nil)
    }
}
