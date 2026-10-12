import AppIntents
import CoreSpotlight
import Foundation
import Synchronization
import Testing
@testable import RuntimeBrief

@Suite("Siri briefs and discovery", .serialized)
struct SiriBriefTests {
    private func store() -> ProjectsStore {
        let defaults = UserDefaults(suiteName: "siri-tests-\(UUID().uuidString)")!
        return ProjectsStore(defaults: defaults, discovery: nil)
    }

    private func source(projects: [ProjectSummary], status: Int = 200) throws -> (LiveRuntimeBriefDataSource, MockTransport) {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        let transport = MockTransport(stubs: ["/v1/projects": .init(status: status, body: try encoder.encode(projects))])
        return (LiveRuntimeBriefDataSource(client: RuntimeBriefClient(settings: .mock, transport: transport)), transport)
    }

    @Test func quickStatusUsesOnlyProjectsAndCarriesEvidenceTime() async throws {
        let (source, transport) = try source(projects: DemoData.projects)
        let snapshot = try await store().briefSnapshot(dataSource: source)
        #expect(transport.recorder.requests.map { $0.url!.path } == ["/v1/projects"])
        #expect(!snapshot.isSaved)
        let text = SiriBrief.project(snapshot.projects[0], snapshot: snapshot)
        #expect(text.contains("Export validation is ready to review"))
        #expect(text.contains("Last activity"))
        #expect(!text.contains("Your Mac is unreachable"))
    }

    @Test func offlineBriefIsExplicitlySavedAndAuthFailureDoesNotFallback() async throws {
        let store = store()
        let (live, _) = try source(projects: DemoData.projects)
        _ = try await store.briefSnapshot(dataSource: live)
        let offline = LiveRuntimeBriefDataSource(client: RuntimeBriefClient(settings: .mock, transport: MockTransport(stubs: [:])))
        let saved = try await store.briefSnapshot(dataSource: offline)
        #expect(saved.isSaved)
        #expect(SiriBrief.attention(saved).contains("Using saved briefs from"))
        let (unauthorized, _) = try source(projects: [], status: 401)
        await #expect(throws: RuntimeBriefError.unauthorized) {
            _ = try await store.briefSnapshot(dataSource: unauthorized)
        }
        await store.invalidate()
        await #expect(throws: RuntimeBriefError.unauthorized) {
            _ = try await store.projects(dataSource: unauthorized)
        }
        await store.clear()
        await #expect(throws: (any Error).self) {
            _ = try await store.briefSnapshot(dataSource: offline)
        }
    }

    @Test func attentionDoesNotCallUnavailableProjectsClear() {
        let unavailable = ProjectSummary(id: "unknown", name: "Unknown", lastActivityAt: nil, branch: nil, dirty: nil, brief: nil)
        let snapshot = ProjectsStore.BriefSnapshot(projects: [unavailable], fetchedAt: nil, isSaved: false, isDemo: false)
        #expect(SiriBrief.attention(snapshot).contains("1 project has no available brief"))
        #expect(SiriBrief.attentionProjects(snapshot.projects).isEmpty)
    }

    @Test func coldOfflineLaunchCanResolveSavedProjectNames() async throws {
        let suite = "siri-cold-launch-\(UUID().uuidString)"
        let onlineStore = ProjectsStore(defaults: UserDefaults(suiteName: suite)!, discovery: nil)
        let (live, _) = try source(projects: DemoData.projects)
        _ = try await onlineStore.refresh(dataSource: live)

        // A new process must resolve names from the persisted snapshot when
        // launch-time shortcut registration cannot reach the daemon.
        let relaunchedStore = ProjectsStore(defaults: UserDefaults(suiteName: suite)!, discovery: nil)
        let offline = LiveRuntimeBriefDataSource(client: RuntimeBriefClient(settings: .mock, transport: MockTransport(stubs: [:])))
        let projects = try await relaunchedStore.projects(dataSource: offline)
        #expect(projects.map(\.id) == DemoData.projects.map(\.id))
        let brief = try await relaunchedStore.briefSnapshot(dataSource: offline)
        #expect(brief.isSaved)
        #expect(SiriBrief.project(projects[0], snapshot: brief).contains("Using saved briefs from"))
    }

    @Test func attentionReturnsOnlyAttentionProjectsAndLabelsDemo() {
        let snapshot = ProjectsStore.BriefSnapshot(projects: DemoData.projects, fetchedAt: nil, isSaved: false, isDemo: true)
        let projects = SiriBrief.attentionProjects(snapshot.projects)
        #expect(projects.count == 1)
        #expect(projects.first?.name == "Catalog Builder")
        #expect(SiriBrief.attention(snapshot).hasPrefix("Fictional demo."))
        #expect(SiriBrief.overview(snapshot).contains("You have 3 projects."))
        let empty = ProjectsStore.BriefSnapshot(projects: [], fetchedAt: nil, isSaved: false, isDemo: false)
        #expect(SiriBrief.overview(empty).contains("No projects are registered yet"))
    }

    @Test func analyzedStatusNamesProjectSpeaksEvidenceWithoutCitationTokensAndDisclosesAge() {
        let status = VoiceStatus(
            answer: "Done: Export checks passed. [demo-evidence-commit-001]\nNow: Ready to review. [demo-evidence-session-001]\nNext: Review the export. [demo-evidence-commit-001]",
            analyzedAt: Date().addingTimeInterval(-20 * 60), model: "gpt-6-luna", evidence: [], refreshing: false, unavailable: false
        )
        let spoken = SiriBrief.analyzedProject(DemoData.projects[0], status: status)
        // Two lines: the latest completed and current work, not the advice.
        #expect(spoken == "Sample Tracker, analyzed 20 minutes ago: Recently, Export checks passed. Currently, Ready to review.")
        let waiting = VoiceStatus(answer: nil, analyzedAt: nil, model: nil, evidence: [], refreshing: true, unavailable: false)
        #expect(SiriBrief.analyzedProject(DemoData.projects[0], status: waiting).contains("preparing an analysis"))
        let older = VoiceStatus(answer: status.answer, analyzedAt: Date().addingTimeInterval(-6 * 3600),
                                model: status.model, evidence: [], refreshing: false, unavailable: true)
        #expect(SiriBrief.analyzedProject(DemoData.projects[0], status: older).hasPrefix("Sample Tracker, analyzed 6 hours ago:"))
    }

    @Test func spokenAnswersAreAtMostTwoLinesWithTheImportantUpdatesFirst() {
        let unknown = "Unknown from available evidence."
        let done = "Shipped build 136 to TestFlight. [git-commit-abc]"
        let now = "An agent is fixing the launch crash. [session-codex-1]"
        let next = "Review the crash fix. [session-codex-1]"
        // Every combination of known and unknown Done/Now/Next lines.
        for mask in 0..<8 {
            let parts = [("Done", done, "Recently, Shipped"), ("Now", now, "Currently, an agent"), ("Next", next, "Next, Review")]
            let lines = parts.enumerated().map { index, part in "\(part.0): " + (mask & (1 << index) != 0 ? part.1 : unknown) }
            let spoken = SiriBrief.voice(lines.joined(separator: "\n"), evidence: [])
            let expected = parts.enumerated().filter { mask & (1 << $0.offset) != 0 }.map(\.element.2).prefix(2)
            #expect(SiriBrief.sentences(spoken).count == max(1, expected.count), "\(mask): \(spoken)")
            for lead in expected { #expect(spoken.contains(lead), "\(mask): \(spoken)") }
            if expected.isEmpty { #expect(spoken == unknown) }
            #expect(!spoken.contains("["))
        }
        let paragraph = "SlipSpark build 136 is on TestFlight. The crash fix is in review. Tests passed on the runner. [git-commit-abc]"
        #expect(SiriBrief.voice(paragraph, evidence: []) == "SlipSpark build 136 is on TestFlight. The crash fix is in review.")
        #expect(SiriBrief.voice("Version 1.0.3 shipped. Build 35 is live.", evidence: [], maxLines: 1) == "Version 1.0.3 shipped.")
    }

    private func completed(_ id: String, _ name: String, _ text: String, _ at: Date) -> ProjectSummary {
        ProjectSummary(id: id, name: name, lastActivityAt: at, branch: nil, dirty: nil, brief: ProjectBrief(
            state: .recent, headline: "Recent work is ready to review", headlineEvidence: [], updatedAt: at, activeSessionCount: 0,
            claims: [BriefClaim(id: "completed-\(id)", category: .completed, text: text, evidence: [
                EvidenceRef(id: "session-\(id)", kind: .session, label: "Session", detail: "", source: "codex", timestamp: at),
            ])]
        ))
    }

    @Test func digestNamesProjectsWithFinishedWorkNewestFirst() {
        let now = Date()
        let snapshot = ProjectsStore.BriefSnapshot(projects: [
            completed("a", "Alpha", "Codex completed “Add search”.", now.addingTimeInterval(-3_600)),
            completed("b", "Beta", "Claude Code completed “Fix the crash”.", now.addingTimeInterval(-600)),
            completed("c", "Gamma", "Cursor completed “Old work”.", now.addingTimeInterval(-3 * 86_400)),
        ], fetchedAt: nil, isSaved: false, isDemo: false)
        let text = SiriBrief.digest(snapshot, since: now.addingTimeInterval(-86_400), period: "today")
        #expect(text == "Agents finished work in 2 projects today: Beta and Alpha. Latest, Beta: Claude Code completed “Fix the crash”.")
        #expect(SiriBrief.sentences(text).count == 2)
        #expect(SiriBrief.digest(snapshot, since: now, period: "today") == "No completed agent work is recorded today.")
        let many = ProjectsStore.BriefSnapshot(projects: (0..<7).map {
            completed("p\($0)", "P\($0)", "Codex completed “x”.", now.addingTimeInterval(Double(-$0) * 60))
        }, fetchedAt: nil, isSaved: false, isDemo: false)
        #expect(SiriBrief.digest(many, since: now.addingTimeInterval(-86_400), period: "today")
            .hasPrefix("Agents finished work in 7 projects today: P0, P1, P2, and 4 more."))
    }

    @Test func presentationModeHidesQuotedPromptsButKeepsTheState() {
        let cases = [
            ("Codex completed “Search the whole machine for .p8 file?”.", "Codex completed."),
            ("Claude Code is actively working on “Fix login”.", "Claude Code is actively working."),
            ("Cursor is waiting for your input on “Approve?”.", "Cursor is waiting for your input."),
            ("Latest commit: Add search.", "Latest commit: Add search."),
        ]
        for (input, expected) in cases {
            #expect(PresentationMode.text(input, enabled: true) == expected)
            #expect(PresentationMode.text(input, enabled: false) == input)
        }
    }

    @Test func periodsStartAtLocalMidnightOrAWeekAgo() {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "America/Los_Angeles")!
        let now = ISO8601DateFormatter().date(from: "2026-10-13T17:30:00Z")!  // 10:30 in Los Angeles
        let today = DigestPeriod.today.window(now: now, calendar: calendar)
        #expect(ISO8601DateFormatter().string(from: today.since) == "2026-10-13T07:00:00Z")
        #expect(DigestPeriod.yesterday.window(now: now, calendar: calendar).label == "since yesterday")
        #expect(DigestPeriod.thisWeek.window(now: now, calendar: calendar).since == now.addingTimeInterval(-7 * 86_400))
    }

    @Test func attentionAndSavedBriefsAreTwoLines() {
        let projects = (0..<12).map { index in
            ProjectSummary(id: "p\(index)", name: "Project \(index)", lastActivityAt: nil, branch: nil, dirty: nil,
                           brief: ProjectBrief(state: .attention, headline: "Waiting for approval \(index)", headlineEvidence: [],
                                               updatedAt: nil, activeSessionCount: 0, claims: []))
        }
        for count in 1...projects.count {
            let snapshot = ProjectsStore.BriefSnapshot(projects: Array(projects.prefix(count)), fetchedAt: nil, isSaved: false, isDemo: false)
            let text = SiriBrief.attention(snapshot)
            #expect(SiriBrief.sentences(text).count == 2, "\(text)")
            #expect(text.contains("Project 0: Waiting for approval 0."))
            if count > 3 { #expect(text.contains("\(count - 3) more")) }
        }
    }

    @Test func entityExposesUsefulMetadataWithoutPathsOrCredentials() {
        let entity = ProjectEntity(summary: DemoData.projects[0])
        #expect(entity.headline.contains("Export validation"))
        #expect(entity.updatedAt != nil)
        #expect(entity.attributeSet.title == "Sample Tracker")
        #expect(entity.attributeSet.contentDescription == entity.headline)
        #expect(entity.attributeSet.keywords?.contains("feature/export-checks") == true)
        #expect(!entity.attributeSet.contentDescription!.contains("/demo/"))
    }

    @Test func discoveryReconcilesRemovalsAndClearsWhenDisabledOrInDemo() async {
        let index = RecordingProjectIndex()
        let discovery = ProjectDiscovery(index: index)
        await discovery.synchronize(projects: DemoData.projects, enabled: true, isDemo: false)
        await discovery.synchronize(projects: Array(DemoData.projects.prefix(1)), enabled: true, isDemo: false)
        await discovery.synchronize(projects: DemoData.projects, enabled: false, isDemo: false)
        await discovery.synchronize(projects: DemoData.projects, enabled: true, isDemo: true)
        let writes = await index.writes
        #expect(writes.map(\.count) == [3, 1, 0, 0])
    }

    @Test func slowIndexWriteCannotRestoreDataAfterClear() async {
        let index = RecordingProjectIndex(delay: true)
        let discovery = ProjectDiscovery(index: index)
        let first = Task { await discovery.synchronize(projects: DemoData.projects, enabled: true, isDemo: false) }
        while await index.writes.isEmpty { await Task.yield() }
        await discovery.synchronize(projects: [], enabled: false, isDemo: false)
        await first.value
        #expect(await index.writes.last?.isEmpty == true)
    }

    @Test func spotlightReallyIndexesMetadataAndRemovesProjects() async throws {
        let name = "Siri Search Fixture \(UUID().uuidString)"
        let entity = ProjectEntity(id: UUID().uuidString, name: name, branch: "feature/search")
        let index = SpotlightProjectIndex()
        try await index.replace(with: [entity])
        var count = 0
        for _ in 0..<25 {
            count = try await spotlightCount(title: name)
            if count == 1 { break }
            try await Task.sleep(for: .milliseconds(200))
        }
        #expect(count == 1)
        try await index.replace(with: [])
        for _ in 0..<25 {
            count = try await spotlightCount(title: name)
            if count == 0 { break }
            try await Task.sleep(for: .milliseconds(200))
        }
        #expect(count == 0)
    }

    @Test func clearingConnectionRejectsAnInFlightRefresh() async throws {
        let store = store()
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        let transport = BlockingProjectsTransport(body: try encoder.encode(DemoData.projects))
        let source = LiveRuntimeBriefDataSource(client: RuntimeBriefClient(settings: .mock, transport: transport))
        let refresh = Task { try await store.refresh(dataSource: source) }
        while await !transport.started { await Task.yield() }
        await store.clear()
        await transport.resume()
        await #expect(throws: CancellationError.self) { _ = try await refresh.value }
    }

    @Test(.timeLimit(.minutes(1))) func slowSpotlightDoesNotDelayReadsOrRestoreQueuedDataAfterClear() async throws {
        let index = BlockingProjectIndex()
        let store = ProjectsStore(defaults: UserDefaults(suiteName: "siri-tests-\(UUID().uuidString)")!,
                                  discovery: ProjectDiscovery(index: index))
        let (live, _) = try source(projects: DemoData.projects)
        let refresh = Task { try await store.refresh(dataSource: live) }
        while await !index.started { await Task.yield() }
        // The index is still blocked, but the read must already be usable.
        #expect(try await refresh.value.count == 3)
        let (newer, _) = try source(projects: Array(DemoData.projects.prefix(1)))
        #expect(try await store.briefSnapshot(dataSource: newer).projects.count == 1)
        let clear = Task { await store.clear() }
        while await !store.cachedSnapshot().projects.isEmpty { await Task.yield() }
        await index.resume()
        await clear.value
        #expect(await store.cachedSnapshot().projects.isEmpty)
        // The queued one-project write must be rejected after the clear.
        #expect(await index.writes.map(\.count) == [3, 0])
    }

    @MainActor @Test func actualIntentsReturnBriefsEntitiesAndNavigateInOfflineDemo() async throws {
        let previousMode = RuntimeBriefModeStore.isDemoEnabled
        let previousPath = ProjectNavigation.shared.path
        RuntimeBriefModeStore.setDemoEnabled(true)
        defer {
            RuntimeBriefModeStore.setDemoEnabled(previousMode)
            ProjectNavigation.shared.path = previousPath
        }
        let entities = try await ProjectQuery().entities(matching: "sample tracker")
        #expect(try await ProjectQuery().suggestedEntities().count == 3)
        #expect(try await ProjectQuery().allEntities().count == 3)
        let project = try #require(entities.first)
        var status = GetProjectStatusIntent()
        status.project = project
        let statusResult = try await status.perform()
        #expect(statusResult.value?.contains("export work is complete") == true)
        #expect(statusResult.value?.hasPrefix("Fictional demo.") == true)
        var analysis = GetProjectAnalysisIntent()
        analysis.project = project
        let analysisResult = try await analysis.perform()
        #expect(analysisResult.value == statusResult.value)
        status.project = nil
        let overviewResult = try await status.perform()
        #expect(overviewResult.value?.contains("You have 3 projects") == true)
        let attentionResult = try await GetAttentionIntent().perform()
        #expect(attentionResult.value?.map(\.name) == ["Catalog Builder"])
        let listResult = try await ListProjectsIntent().perform()
        #expect(listResult.value?.count == 3)
        var ask = AskProjectIntent()
        ask.project = project
        ask.question = "Did the fictional checks pass?"
        #expect(try await ask.perform().value?.contains("fictional demo response") == true)
        _ = try await OpenProjectIntent(target: project).perform()
        #expect(ProjectNavigation.shared.path.map(\.id) == [project.id])
        #if compiler(>=6.4)
        if #available(iOS 27.0, *) {
            _ = try await OpenProjectWithSiriIntent(target: project).perform()
            #expect(ProjectNavigation.shared.path.map(\.id) == [project.id])
        }
        #endif
        status.project = ProjectEntity(id: "missing", name: "Missing")
        await #expect(throws: SiriIntentFailure.self) { _ = try await status.perform() }
    }
}

private func spotlightCount(title: String) async throws -> Int {
    let count = Mutex(0)
    let context = CSSearchQueryContext()
    context.fetchAttributes = ["title"]
    let query = CSSearchQuery(queryString: "title == \"\(title)\"", queryContext: context)
    // Keep the query alive until its asynchronous completion handler fires.
    defer { query.cancel() }
    return try await withCheckedThrowingContinuation { continuation in
        query.foundItemsHandler = { items in count.withLock { $0 += items.count } }
        query.completionHandler = { error in
            if let error { continuation.resume(throwing: error) }
            else { continuation.resume(returning: count.withLock { $0 }) }
        }
        query.start()
    }
}

private actor RecordingProjectIndex: ProjectSearchIndex {
    var writes: [[String]] = []
    let delay: Bool
    init(delay: Bool = false) { self.delay = delay }
    func replace(with projects: [ProjectEntity]) async throws {
        writes.append(projects.map(\.id))
        if delay { try await Task.sleep(for: .milliseconds(40)) }
    }
}

private actor BlockingProjectsTransport: HTTPTransport {
    let body: Data
    var started = false
    private var response: URLResponse?
    private var continuation: CheckedContinuation<(Data, URLResponse), Error>?
    init(body: Data) { self.body = body }
    func data(for request: URLRequest) async throws -> (Data, URLResponse) {
        response = HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)
        return try await withCheckedThrowingContinuation { continuation in
            self.continuation = continuation
            started = true
        }
    }
    func resume() { continuation?.resume(returning: (body, response!)) }
    func byteStream(for request: URLRequest) async throws -> (AsyncThrowingStream<UInt8, Error>, URLResponse) {
        throw URLError(.unsupportedURL)
    }
}

private actor BlockingProjectIndex: ProjectSearchIndex {
    var started = false
    var writes: [[String]] = []
    private var continuation: CheckedContinuation<Void, Never>?
    func replace(with projects: [ProjectEntity]) async throws {
        writes.append(projects.map(\.id))
        guard !started else { return }
        await withCheckedContinuation { continuation in
            self.continuation = continuation
            started = true
        }
    }
    func resume() { continuation?.resume() }
}
