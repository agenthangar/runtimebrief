import Foundation

struct SiriQuestionReply: Equatable {
    /// Snippet heading: the project the answer is about, or the portfolio.
    let title: String
    /// What Siri says and shows: at most two short lines.
    let text: String
    /// The whole answer, returned to Shortcuts.
    let detail: String
    /// Set while the Mac is still answering: what Siri asks before waiting on.
    let keepWaitingPrompt: String?

    init(title: String, text: String, detail: String? = nil, keepWaitingPrompt: String? = nil) {
        self.title = title
        self.text = text
        self.detail = detail ?? text
        self.keepWaitingPrompt = keepWaitingPrompt
    }
}

/// Answers a free-form spoken question. The daemon decides whether the
/// question names one project or concerns the whole portfolio; Siri only
/// passes the dictated text along.
enum SiriQuestion {
    static let portfolioTitle = "Your Projects"

    static func answer(
        question: String,
        projectID: String?,
        dataSource: any RuntimeBriefDataSource,
        store: ProjectsStore = .shared
    ) async throws -> SiriQuestionReply {
        do {
            let response = try await dataSource.askAnything(question: question, projectID: projectID)
            return reply(for: response)
        } catch RuntimeBriefError.unsupportedServer {
            return try await olderServerAnswer(question: question, projectID: projectID, dataSource: dataSource, store: store)
        } catch RuntimeBriefError.network, RuntimeBriefError.timeout {
            // Speak the saved briefs, labelled as such, when the Mac is unreachable.
            let snapshot = try await store.briefSnapshot(dataSource: dataSource)
            return savedAnswer(question: question, projectID: projectID, snapshot: snapshot)
        }
    }

    /// Like `answer`, but while the Mac is still working Siri asks "Keep
    /// waiting?" and, on yes, waits again, so the person need not ask twice.
    static func answerWaiting(
        question: String,
        projectID: String?,
        dataSource: any RuntimeBriefDataSource,
        store: ProjectsStore = .shared,
        maxRounds: Int = 3,
        keepWaiting: (String) async throws -> Void
    ) async throws -> SiriQuestionReply {
        var reply = try await answer(question: question, projectID: projectID, dataSource: dataSource, store: store)
        var rounds = 0
        while let prompt = reply.keepWaitingPrompt, rounds < maxRounds {
            rounds += 1
            try await keepWaiting(prompt)
            reply = try await answer(question: question, projectID: projectID, dataSource: dataSource, store: store)
        }
        return reply
    }

    static func reply(for response: AskResponse) -> SiriQuestionReply {
        let project = response.scope == .project ? response.projects.first : nil
        let title = project?.name ?? portfolioTitle
        if response.status == .answered, let answer = response.answer {
            let short = SiriBrief.voice(answer, evidence: response.evidence)
            let full = SiriBrief.spoken(answer, evidence: response.evidence)
            // A saved analysis says how old it is, like the status action.
            if let project, let analyzedAt = response.analyzedAt {
                let lead = "\(project.name), analyzed \(SiriBrief.age(of: analyzedAt)): "
                return SiriQuestionReply(title: title, text: lead + short, detail: lead + full)
            }
            return SiriQuestionReply(
                title: title,
                text: project.map { naming($0.name, in: short) } ?? short,
                detail: project.map { naming($0.name, in: full) } ?? full
            )
        }
        // Two lines: what is happening, then the most important saved update.
        let opener: String
        switch (response.status, project) {
        case (.pending, let project?): opener = "Still checking \(project.name); ask again in a minute."
        case (.pending, nil): opener = "Still checking; ask again in a minute."
        case (_, let project?): opener = "I couldn't check \(project.name) right now."
        case (_, nil): opener = "I couldn't check that right now."
        }
        let latest = response.interim.map { SiriBrief.voice($0.answer, evidence: $0.evidence, maxLines: 1) } ?? ""
        let waitPrompt = response.status == .pending
            ? (project.map { "Still checking \($0.name). Keep waiting?" } ?? "Still checking. Keep waiting?")
            : nil
        return SiriQuestionReply(title: title, text: latest.isEmpty ? opener : "\(opener) \(latest)",
                                 keepWaitingPrompt: waitPrompt)
    }

    /// Project answers rarely repeat the project's name; Siri should say it.
    private static func naming(_ name: String, in text: String) -> String {
        text.localizedCaseInsensitiveContains(name) ? text : "\(name): \(text)"
    }

    private static func namedProject(
        question: String,
        projectID: String?,
        projects: [ProjectSummary]
    ) -> ProjectSummary? {
        let ids = projectID.map { [$0] }
            ?? ProjectMentionMatcher.resolve(question, candidates: mentionCandidates(projects))
        guard ids.count == 1 else { return nil }
        return projects.first { $0.id == ids[0] }
    }

    /// Every name a project may be spoken as, including its spoken names.
    static func mentionCandidates(_ projects: [ProjectSummary]) -> [(id: String, name: String)] {
        projects.flatMap { project in
            [(id: project.id, name: project.name)] + (project.spokenNames ?? []).map { (id: project.id, name: $0) }
        }
    }

    private static func savedAnswer(
        question: String,
        projectID: String?,
        snapshot: ProjectsStore.BriefSnapshot
    ) -> SiriQuestionReply {
        if let project = namedProject(question: question, projectID: projectID, projects: snapshot.projects) {
            return SiriQuestionReply(title: project.name, text: SiriBrief.project(project, snapshot: snapshot))
        }
        return SiriQuestionReply(title: portfolioTitle, text: SiriBrief.overview(snapshot))
    }

    /// A daemon without `POST /v1/ask` can still answer a question that names
    /// one project through that project's analyst.
    private static func olderServerAnswer(
        question: String,
        projectID: String?,
        dataSource: any RuntimeBriefDataSource,
        store: ProjectsStore
    ) async throws -> SiriQuestionReply {
        let snapshot = try await store.briefSnapshot(dataSource: dataSource)
        guard let project = namedProject(question: question, projectID: projectID, projects: snapshot.projects) else {
            return SiriQuestionReply(
                title: portfolioTitle,
                text: SiriBrief.overview(snapshot) + " Update RuntimeBrief on your Mac to ask more."
            )
        }
        if !snapshot.isSaved, let answer = try? await dataSource.ask(projectID: project.id, question: question) {
            let evidence = answer.evidence ?? []
            return SiriQuestionReply(
                title: project.name,
                text: naming(project.name, in: SiriBrief.voice(answer.answer, evidence: evidence)),
                detail: naming(project.name, in: SiriBrief.spoken(answer.answer, evidence: evidence))
            )
        }
        return SiriQuestionReply(
            title: project.name,
            text: "I couldn't check \(project.name) right now. "
                + SiriBrief.voice(project.brief?.headline ?? "No project brief is available", evidence: [], maxLines: 1)
        )
    }
}
