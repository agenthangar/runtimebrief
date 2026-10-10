import Foundation

struct SiriQuestionReply: Equatable {
    /// Snippet heading: the project the answer is about, or the portfolio.
    let title: String
    let text: String
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
        store: ProjectsStore = .shared,
        now: Date = Date()
    ) async throws -> SiriQuestionReply {
        do {
            let response = try await dataSource.askAnything(question: question, projectID: projectID)
            return reply(for: response, now: now)
        } catch RuntimeBriefError.unsupportedServer {
            return try await olderServerAnswer(question: question, projectID: projectID, dataSource: dataSource, store: store)
        } catch RuntimeBriefError.network, RuntimeBriefError.timeout {
            // Speak the saved briefs, labelled as such, when the Mac is unreachable.
            let snapshot = try await store.briefSnapshot(dataSource: dataSource)
            return savedAnswer(question: question, projectID: projectID, snapshot: snapshot)
        }
    }

    static func reply(for response: AskResponse, now: Date = Date()) -> SiriQuestionReply {
        let project = response.scope == .project ? response.projects.first : nil
        let title = project?.name ?? portfolioTitle
        if response.status == .answered, let answer = response.answer {
            let text = SiriBrief.spoken(answer, evidence: response.evidence)
            return SiriQuestionReply(title: title, text: project.map { naming($0.name, in: text) } ?? text)
        }
        let saved = response.interim.map { SiriBrief.spoken($0.answer, evidence: $0.evidence) }
        var parts: [String] = []
        switch (response.status, project) {
        case (.pending, let project?):
            parts.append("I'm still working on that for \(project.name).")
        case (.pending, nil):
            parts.append("I'm still working on that.")
        case (_, let project?):
            parts.append("I couldn't finish an answer for \(project.name) right now.")
        case (_, nil):
            parts.append("I couldn't finish an answer right now.")
        }
        if let saved, !saved.isEmpty {
            if project != nil {
                parts.append(savedAnalysisLead(response.interim?.analyzedAt, now: now) + " " + saved)
            } else {
                parts.append("Here's what I know so far: " + saved)
            }
        }
        if response.status == .pending {
            parts.append("Ask me again in a minute for the full answer.")
        }
        return SiriQuestionReply(title: title, text: parts.joined(separator: " "))
    }

    private static func savedAnalysisLead(_ analyzedAt: Date?, now: Date) -> String {
        guard let analyzedAt else { return "Its current brief says:" }
        if now.timeIntervalSince(analyzedAt) < 5 * 60 { return "Its latest analysis says:" }
        return "Its analysis from \(SiriBrief.age(of: analyzedAt, now: now)) says:"
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
            ?? ProjectMentionMatcher.resolve(question, candidates: projects.map { ($0.id, $0.name) })
        guard ids.count == 1 else { return nil }
        return projects.first { $0.id == ids[0] }
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
                text: SiriBrief.overview(snapshot)
                    + " To ask questions across projects, update RuntimeBrief on your Mac."
            )
        }
        if !snapshot.isSaved, let answer = try? await dataSource.ask(projectID: project.id, question: question) {
            let text = SiriBrief.spoken(answer.answer, evidence: answer.evidence ?? [])
            return SiriQuestionReply(title: project.name, text: naming(project.name, in: text))
        }
        return SiriQuestionReply(
            title: project.name,
            text: "I couldn't finish an answer right now. " + SiriBrief.project(project, snapshot: snapshot)
        )
    }
}
