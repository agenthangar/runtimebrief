import SwiftUI

struct ProjectDetailView: View {
    let project: ProjectSummary

    @State private var card: ProjectCard?
    @State private var statusText = ""
    @State private var statusAnswer: AnalystAnswer?
    @State private var requestingStatus = false
    @State private var thread: [QAEntry] = []
    @State private var question = ""
    @State private var asking = false
    @State private var errorMessage: String?
    @State private var briefExpanded = true
    @State private var releaseExpanded = true
    @State private var analystExpanded = true
    @State private var askExpanded = true
    @State private var sessionsExpanded = true
    @State private var commitsExpanded = true
    @FocusState private var questionFocused: Bool

    struct QAEntry: Identifiable {
        let id = UUID()
        let question: String
        var answer: String
        var done = false
        var evidence: [EvidenceRef] = []
        var cached = false
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                if RuntimeBriefModeStore.isDemoEnabled {
                    Label(
                        "Demo Data — this screen contains fictional information only.",
                        systemImage: "sparkles"
                    )
                    .font(.callout.weight(.semibold))
                    .foregroundStyle(.indigo)
                    .accessibilityIdentifier("demo-detail-banner")
                }
                briefSection
                ClaudeLaunchView(project: project)
                if let error = errorMessage {
                    ErrorBanner(message: error)
                }
                if let release = card?.iosRelease {
                    iosReleaseSection(release)
                }
                analystSection
                askSection
                if let card, !card.sessions.isEmpty {
                    sessionsSection(card.sessions)
                }
                if let git = card?.git {
                    commitsSection(git)
                }
            }
            .padding()
        }
        .scrollDismissesKeyboard(.interactively)
        .navigationTitle(project.name)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItemGroup(placement: .keyboard) {
                Spacer()
                Button("Done") { questionFocused = false }
            }
        }
        .task {
            await loadCard()
        }
    }

    // MARK: Evidence-backed brief

    @ViewBuilder
    private var briefSection: some View {
        if let brief = card?.brief ?? project.brief {
            CollapsibleProjectSection(
                isExpanded: $briefExpanded,
                accessibilityLabel: "Project brief: \(brief.headline)",
                accessibilityIdentifier: "brief-section-toggle"
            ) {
                VStack(alignment: .leading, spacing: 12) {
                    HStack {
                        BriefStateBadge(state: brief.state)
                        Spacer()
                        RelativeTimeText(date: brief.updatedAt)
                    }
                    Text(brief.headline)
                        .font(.title3.weight(.semibold))
                }
            } content: {
                VStack(alignment: .leading, spacing: 14) {
                    ForEach(brief.claims) { claim in
                        VStack(alignment: .leading, spacing: 8) {
                            ClaimLabel(claim: claim, showEvidence: false)
                            EvidenceList(evidence: claim.evidence)
                        }
                        .padding(.top, 2)
                    }
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding()
            .background(.quaternary.opacity(0.4), in: RoundedRectangle(cornerRadius: 14))
        }
    }

    // MARK: iOS release

    private func iosReleaseSection(_ release: IOSReleaseSummary) -> some View {
        CollapsibleProjectSection(
            isExpanded: $releaseExpanded,
            accessibilityLabel: "iOS release",
            accessibilityIdentifier: "ios-release-section-toggle"
        ) {
            HStack {
                Label("iOS release", systemImage: "iphone")
                    .font(.headline)
                Spacer()
                if let checkedAt = release.appStoreConnect.checkedAt {
                    RelativeTimeText(date: checkedAt)
                }
            }
        } content: {
            VStack(alignment: .leading, spacing: 14) {
                releaseRow(
                    title: "Xcode",
                    icon: "hammer",
                    value: versionBuild(
                        version: release.xcode.marketingVersion,
                        build: release.xcode.buildNumber
                    ),
                    detail: "\(release.xcode.bundleId) · \(release.xcode.scheme)",
                    identifier: "xcode-build-summary"
                )

                if let build = release.appStoreConnect.latestTestFlightBuild {
                    releaseRow(
                        title: "TestFlight",
                        icon: "paperplane.fill",
                        value: versionBuild(
                            version: build.marketingVersion,
                            build: build.buildNumber
                        ),
                        detail: [
                            readableState(build.processingState),
                            readableAudience(build.audienceType),
                            build.expired ? "Expired" : nil,
                        ]
                        .compactMap { $0 }
                        .joined(separator: " · "),
                        identifier: "testflight-build-summary"
                    )
                }

                if let store = release.appStoreConnect.appStoreVersion {
                    releaseRow(
                        title: "App Store",
                        icon: "storefront",
                        value: versionBuild(version: store.version, build: store.buildNumber),
                        detail: readableState(store.state),
                        identifier: "app-store-build-summary"
                    )
                }

                if let message = release.appStoreConnect.message {
                    Label(message, systemImage: "info.circle")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .accessibilityIdentifier("app-store-connect-message")
                } else if release.appStoreConnect.latestTestFlightBuild == nil,
                          release.appStoreConnect.appStoreVersion == nil {
                    Text("No TestFlight or App Store builds were found.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding()
        .background(.indigo.opacity(0.08), in: RoundedRectangle(cornerRadius: 14))
    }

    private func releaseRow(
        title: String,
        icon: String,
        value: String,
        detail: String,
        identifier: String
    ) -> some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: icon)
                .foregroundStyle(.indigo)
                .frame(width: 22)
            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.secondary)
                Text(value)
                    .font(.body.weight(.semibold))
                    .accessibilityIdentifier(identifier)
                Text(detail)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
    }

    private func versionBuild(version: String?, build: String?) -> String {
        switch (version, build) {
        case let (.some(version), .some(build)): "\(version) (\(build))"
        case let (.some(version), .none): version
        case let (.none, .some(build)): "Build \(build)"
        case (.none, .none): "Unknown"
        }
    }

    private func readableState(_ value: String) -> String {
        value
            .split(separator: "_")
            .map { $0.lowercased().capitalized }
            .joined(separator: " ")
    }

    private func readableAudience(_ value: String?) -> String? {
        guard let value else { return nil }
        return switch value {
        case "INTERNAL_ONLY": "Internal only"
        case "APP_STORE_ELIGIBLE": "App Store eligible"
        default: readableState(value)
        }
    }

    // MARK: On-demand analyst

    private var analystSection: some View {
        CollapsibleProjectSection(
            isExpanded: $analystExpanded,
            accessibilityLabel: "Analyst update",
            accessibilityIdentifier: "analyst-section-toggle"
        ) {
            Text("Analyst update")
                .font(.headline)
        } content: {
            VStack(alignment: .leading, spacing: 10) {
                if statusText.isEmpty && !requestingStatus {
                    Text("Generate an interpretation only when you want one. The portfolio brief above never spends an AI query.")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                    Button {
                        Task { await streamStatus() }
                    } label: {
                        Label("Generate analyst update", systemImage: "sparkles")
                    }
                    .buttonStyle(.borderedProminent)
                    .accessibilityIdentifier("generate-analyst-update")
                } else if requestingStatus && statusText.isEmpty {
                    HStack {
                        ProgressView()
                        Text("Asking the analyst…")
                            .foregroundStyle(.secondary)
                    }
                } else {
                    Text(statusText)
                        .font(.subheadline)
                        .lineSpacing(4)
                        .textSelection(.enabled)
                    if let answer = statusAnswer {
                        analystMetadata(answer)
                        if let evidence = answer.evidence, !evidence.isEmpty {
                            Text("Evidence")
                                .font(.subheadline.weight(.semibold))
                            EvidenceList(evidence: evidence)
                        }
                    } else if requestingStatus {
                        ProgressView().controlSize(.small)
                    }
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding()
        .background(.blue.opacity(0.07), in: RoundedRectangle(cornerRadius: 14))
    }

    private func streamStatus() async {
        guard !requestingStatus else { return }
        requestingStatus = true
        statusText = ""
        statusAnswer = nil
        errorMessage = nil
        defer { requestingStatus = false }
        do {
            for try await event in RuntimeBriefDataSourceFactory.current()
                .streamStatus(projectID: project.id) {
                switch event {
                case .chunk(let text):
                    statusText += text
                case .done(let answer):
                    statusText = answer.answer
                    statusAnswer = answer
                case .failure:
                    errorMessage = "The analyst hit an error."
                }
            }
        } catch {
            errorMessage = (error as? RuntimeBriefError)?.errorDescription ?? error.localizedDescription
        }
    }

    private func analystMetadata(_ answer: AnalystAnswer) -> some View {
        HStack(spacing: 10) {
            if answer.cached {
                if RuntimeBriefModeStore.isDemoEnabled {
                    Label("Demo response", systemImage: "sparkles")
                } else {
                    Label("Cached", systemImage: "clock.arrow.circlepath")
                }
            } else {
                Label("Codex CLI", systemImage: "terminal")
            }
            if answer.truncated {
                Label("Response truncated", systemImage: "scissors")
            }
        }
        .font(.caption)
        .foregroundStyle(.secondary)
    }

    // MARK: Ask thread

    private var askSection: some View {
        CollapsibleProjectSection(
            isExpanded: $askExpanded,
            accessibilityLabel: "Ask about this project",
            accessibilityIdentifier: "ask-section-toggle"
        ) {
            Text("Ask about this project")
                .font(.headline)
        } content: {
            VStack(alignment: .leading, spacing: 12) {
                HStack {
                    TextField("e.g. did the tests pass?", text: $question)
                        .textFieldStyle(.roundedBorder)
                        .focused($questionFocused)
                        .onSubmit { submit() }
                        .accessibilityIdentifier("demo-question-field")
                    Button {
                        submit()
                    } label: {
                        Image(systemName: "arrow.up.circle.fill")
                            .font(.title2)
                    }
                    .disabled(question.trimmingCharacters(in: .whitespaces).isEmpty || asking)
                    .accessibilityIdentifier("submit-project-question")
                }
                ForEach(thread.reversed()) { entry in
                    VStack(alignment: .leading, spacing: 6) {
                        Text(entry.question)
                            .font(.subheadline.weight(.semibold))
                        Text(entry.answer.isEmpty ? "…" : entry.answer)
                            .font(.subheadline)
                            .lineSpacing(3)
                            .textSelection(.enabled)
                            .accessibilityIdentifier("project-answer")
                        if entry.done {
                            HStack(spacing: 10) {
                                if entry.cached {
                                    if RuntimeBriefModeStore.isDemoEnabled {
                                        Label("Demo response", systemImage: "sparkles")
                                    } else {
                                        Label("Cached", systemImage: "clock.arrow.circlepath")
                                    }
                                } else {
                                    Label("Codex CLI", systemImage: "terminal")
                                }
                            }
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            if !entry.evidence.isEmpty {
                                Text("Evidence")
                                    .font(.caption.weight(.semibold))
                                EvidenceList(evidence: entry.evidence)
                            }
                        }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(12)
                    .background(.quaternary.opacity(0.3), in: RoundedRectangle(cornerRadius: 12))
                }
            }
        }
    }

    private func submit() {
        let q = question.trimmingCharacters(in: .whitespaces)
        guard !q.isEmpty, !asking else { return }
        question = ""
        asking = true
        thread.append(QAEntry(question: q, answer: ""))
        let index = thread.count - 1
        Task {
            defer { asking = false }
            do {
                for try await event in RuntimeBriefDataSourceFactory.current()
                    .streamAsk(projectID: project.id, question: q) {
                    switch event {
                    case .chunk(let text):
                        thread[index].answer += text
                    case .done(let answer):
                        thread[index].answer = answer.answer
                        thread[index].done = true
                        thread[index].evidence = answer.evidence ?? []
                        thread[index].cached = answer.cached
                    case .failure:
                        thread[index].answer = "The analyst hit an error."
                        thread[index].done = true
                    }
                }
            } catch {
                thread[index].answer = (error as? RuntimeBriefError)?.errorDescription
                    ?? error.localizedDescription
                thread[index].done = true
            }
        }
    }

    // MARK: Sessions & commits

    private func sessionsSection(_ sessions: [SessionInfo]) -> some View {
        CollapsibleProjectSection(
            isExpanded: $sessionsExpanded,
            accessibilityLabel: "Recent agent sessions",
            accessibilityIdentifier: "sessions-section-toggle"
        ) {
            Text("Recent agent sessions")
                .font(.headline)
        } content: {
            VStack(alignment: .leading, spacing: 8) {
                ForEach(sessions) { session in
                    VStack(alignment: .leading, spacing: 6) {
                        HStack {
                            MonoLabel(text: session.source)
                                .accessibilityIdentifier("session-source-\(session.source)")
                            SessionStateBadge(state: session.state ?? .unknown)
                            Spacer()
                            RelativeTimeText(date: session.endedAt ?? session.startedAt)
                        }
                        if let summary = session.summary {
                            Text(summary)
                                .font(.subheadline)
                                .lineLimit(3)
                        }
                        HStack(spacing: 8) {
                            if let branch = session.gitBranch {
                                MonoLabel(text: branch)
                            }
                            if let model = session.model {
                                Text(model)
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                        }
                        let files = session.filesTouched ?? []
                        let toolCount = session.toolUseCount ?? 0
                        if !files.isEmpty || toolCount > 0 {
                            Text(
                                [
                                    files.isEmpty ? nil : "\(files.count) file\(files.count == 1 ? "" : "s") touched",
                                    toolCount == 0 ? nil : "\(toolCount) tool call\(toolCount == 1 ? "" : "s")",
                                ]
                                .compactMap { $0 }
                                .joined(separator: " · ")
                            )
                            .font(.caption)
                            .foregroundStyle(.secondary)
                        }
                        if let conclusion = session.conclusion, !conclusion.isEmpty {
                            Text(conclusion)
                                .font(.caption)
                                .foregroundStyle(.secondary)
                                .lineLimit(3)
                        }
                        if let reason = session.stateReason {
                            Text(reason)
                                .font(.caption2)
                                .foregroundStyle(.tertiary)
                        }
                    }
                    .padding(.vertical, 6)
                    Divider()
                }
            }
        }
    }

    private func commitsSection(_ git: GitSummary) -> some View {
        CollapsibleProjectSection(
            isExpanded: $commitsExpanded,
            accessibilityLabel: "Recent commits",
            accessibilityIdentifier: "commits-section-toggle"
        ) {
            Text("Recent commits")
                .font(.headline)
        } content: {
            VStack(alignment: .leading, spacing: 8) {
                ForEach(git.commits.prefix(8), id: \.hash) { commit in
                    VStack(alignment: .leading, spacing: 2) {
                        Text(commit.message)
                            .font(.subheadline)
                            .lineLimit(2)
                        HStack {
                            MonoLabel(text: String(commit.hash.prefix(7)))
                            Text(commit.author)
                                .font(.caption)
                                .foregroundStyle(.secondary)
                            Spacer()
                            RelativeTimeText(date: commit.timestamp)
                        }
                    }
                    .padding(.vertical, 4)
                }
            }
        }
    }

    private func loadCard() async {
        do {
            card = try await RuntimeBriefDataSourceFactory.current().project(id: project.id)
        } catch {
            errorMessage = (error as? RuntimeBriefError)?.errorDescription ?? error.localizedDescription
        }
    }
}

private struct CollapsibleProjectSection<Header: View, Content: View>: View {
    @Binding var isExpanded: Bool
    let accessibilityLabel: String
    let accessibilityIdentifier: String
    @ViewBuilder let header: () -> Header
    @ViewBuilder let content: () -> Content

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Button {
                withAnimation(.easeInOut(duration: 0.2)) {
                    isExpanded.toggle()
                }
            } label: {
                HStack(alignment: .center, spacing: 12) {
                    header()
                        .frame(maxWidth: .infinity, alignment: .leading)
                    Image(systemName: isExpanded ? "chevron.down" : "chevron.right")
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(.secondary)
                        .frame(width: 20)
                }
                .frame(minHeight: 44)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel(accessibilityLabel)
            .accessibilityValue(isExpanded ? "Expanded" : "Collapsed")
            .accessibilityHint(isExpanded ? "Collapses this section" : "Expands this section")
            .accessibilityHeading(.h2)
            .accessibilityIdentifier(accessibilityIdentifier)

            if isExpanded {
                content()
                    .transition(.opacity.combined(with: .move(edge: .top)))
            }
        }
    }
}
