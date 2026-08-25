import SwiftUI

struct ProjectsListView: View {
    @State private var projects: [ProjectSummary] = []
    @State private var errorMessage: String?
    @State private var isLoading = false
    @State private var showSettings = false
    @State private var showingSavedBrief = false
    @State private var lastSavedAt: Date?
    @State private var isDemoMode = RuntimeBriefModeStore.isDemoEnabled

    var body: some View {
        NavigationStack {
            Group {
                if projects.isEmpty && !isLoading {
                    emptyState
                } else {
                    list
                }
            }
            .navigationTitle("RuntimeBrief")
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    if isDemoMode {
                        Button("Exit Demo") {
                            exitDemo()
                        }
                        .accessibilityIdentifier("exit-demo")
                    } else {
                        Button {
                            showSettings = true
                        } label: {
                            Image(systemName: "gearshape")
                        }
                        .accessibilityLabel("Settings")
                    }
                }
            }
            .sheet(isPresented: $showSettings, onDismiss: { Task { await refresh() } }) {
                SettingsView()
            }
            .task { await loadSavedThenRefresh() }
            .refreshable { await refresh() }
        }
    }

    private var list: some View {
        List {
            if isDemoMode {
                Label(
                    "Demo Data — every project, path, commit, and response is fictional.",
                    systemImage: "sparkles"
                )
                .font(.callout.weight(.semibold))
                .foregroundStyle(.indigo)
                .listRowSeparator(.hidden)
                .accessibilityIdentifier("demo-data-banner")
            }
            if showingSavedBrief, let lastSavedAt {
                Label {
                    Text("Mac unavailable — showing the brief saved \(lastSavedAt.formatted(.relative(presentation: .named))).")
                } icon: {
                    Image(systemName: "externaldrive.badge.exclamationmark")
                }
                .font(.callout)
                .foregroundStyle(.orange)
                .listRowSeparator(.hidden)
                .accessibilityIdentifier("saved-brief-banner")
            }
            if let errorMessage {
                ErrorBanner(message: errorMessage)
                    .listRowSeparator(.hidden)
            }
            ForEach(projects) { project in
                NavigationLink(value: project) {
                    ProjectRow(project: project)
                }
                .accessibilityIdentifier("project-link-\(project.id)")
            }
        }
        .listStyle(.plain)
        .accessibilityIdentifier("portfolio-brief-list")
        .navigationDestination(for: ProjectSummary.self) { project in
            ProjectDetailView(project: project)
        }
    }

    private var emptyState: some View {
        ContentUnavailableView {
            Label("No Projects", systemImage: "shippingbox")
        } description: {
            Text(errorMessage ?? "Connect to your Mac in Settings, then add projects with `runtimebriefd add-project`.")
        } actions: {
            VStack(spacing: 10) {
                Button("Explore Demo") { enterDemo() }
                    .buttonStyle(.borderedProminent)
                    .accessibilityIdentifier("explore-demo")
                Button("Connect Your Mac") { showSettings = true }
                    .accessibilityIdentifier("connect-your-mac")
            }
        }
    }

    private func refresh() async {
        isLoading = true
        defer { isLoading = false }
        do {
            // A user refresh always asks the daemon for current deterministic
            // briefs. The store persists them for offline launch and Siri.
            projects = try await ProjectsStore.shared.refresh()
            errorMessage = nil
            showingSavedBrief = false
            lastSavedAt = Date()
        } catch {
            let snapshot = await ProjectsStore.shared.cachedSnapshot()
            if projects.isEmpty { projects = snapshot.projects }
            lastSavedAt = snapshot.fetchedAt
            showingSavedBrief = !projects.isEmpty
            errorMessage = showingSavedBrief
                ? nil
                : ((error as? RuntimeBriefError)?.errorDescription ?? error.localizedDescription)
        }
    }

    private func loadSavedThenRefresh() async {
        let snapshot = await ProjectsStore.shared.cachedSnapshot()
        if projects.isEmpty {
            projects = snapshot.projects
            lastSavedAt = snapshot.fetchedAt
        }
        await refresh()
    }

    private func enterDemo() {
        RuntimeBriefModeStore.setDemoEnabled(true)
        isDemoMode = true
        projects = DemoData.projects
        errorMessage = nil
        showingSavedBrief = false
        lastSavedAt = nil
        Task { await ProjectsStore.shared.invalidate() }
    }

    private func exitDemo() {
        RuntimeBriefModeStore.setDemoEnabled(false)
        isDemoMode = false
        projects = []
        errorMessage = nil
        showingSavedBrief = false
        lastSavedAt = nil
        Task {
            await ProjectsStore.shared.invalidate()
            await loadSavedThenRefresh()
        }
    }
}

private struct ProjectRow: View {
    let project: ProjectSummary
    var body: some View {
        VStack(alignment: .leading, spacing: 7) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text(project.name)
                    .font(.headline)
                Spacer()
                if let brief = project.brief {
                    BriefStateBadge(state: brief.state)
                }
            }
            if let brief = project.brief {
                Text(brief.headline)
                    .font(.subheadline.weight(.semibold))
                    .accessibilityIdentifier("brief-headline-\(project.id)")
                if let claim = brief.claims.first {
                    ClaimLabel(claim: claim)
                }
                HStack {
                    if let branch = project.branch {
                        MonoLabel(text: branch)
                    }
                    Spacer()
                    RelativeTimeText(date: brief.updatedAt ?? project.lastActivityAt)
                }
            } else {
                HStack(spacing: 8) {
                    DirtyDot(dirty: project.dirty)
                    if let branch = project.branch {
                        MonoLabel(text: branch)
                    }
                    Spacer()
                    RelativeTimeText(date: project.lastActivityAt)
                }
            }
        }
        .padding(.vertical, 7)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("project-row-\(project.id)")
    }
}
