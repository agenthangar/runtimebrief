import SwiftUI
import CryptoKit

/// One launch surface; the conversation and all tool approvals stay in Claude.
struct ClaudeLaunchView: View {
    let project: ProjectSummary
    @State private var list: ClaudeLaunchList?
    @State private var showingComposer = false
    @State private var errorMessage: String?
    @State private var openingID: String?
    @State private var openMessage: String?

    private var source: any RuntimeBriefDataSource { RuntimeBriefDataSourceFactory.current() }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Label("Claude Code", systemImage: "terminal")
                    .font(.headline)
                Spacer()
                Button { Task { await refresh() } } label: { Image(systemName: "arrow.clockwise") }
                    .accessibilityLabel("Refresh Claude tasks")
            }
            if let capability = list?.capability {
                Text(capability.message)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                Button { showingComposer = true } label: {
                    Label("New Claude task", systemImage: "plus")
                }
                .buttonStyle(.borderedProminent)
                .disabled(!capability.available)
                .accessibilityIdentifier("new-claude-task")
            } else if errorMessage == nil {
                ProgressView("Checking your Mac…")
            }
            if let errorMessage { ErrorBanner(message: errorMessage) }
            if let openMessage { Text(openMessage).font(.caption).foregroundStyle(.secondary) }
            ForEach(list?.launches.prefix(5) ?? Array<ClaudeLaunch>().prefix(5)) { launch in
                VStack(alignment: .leading, spacing: 8) {
                    HStack {
                        Text(launch.stateLabel).font(.subheadline.weight(.semibold))
                        Spacer()
                        RelativeTimeText(date: launch.createdAt)
                    }
                    Text(launch.message).font(.caption).foregroundStyle(.secondary)
                    if let nativeID = launch.nativeId {
                        Text("Session \(nativeID)").font(.caption.monospaced()).foregroundStyle(.secondary)
                        Button {
                            Task { await open(launch) }
                        } label: {
                            Label(openingID == launch.id ? "Opening…" : (launch.openedAt == nil ? "Open in Claude Desktop" : "Open Claude Desktop"), systemImage: "macwindow")
                        }
                        .disabled(openingID != nil)
                        .accessibilityIdentifier("take-over-claude-\(launch.id)")
                    }
                    if launch.openedAt == nil && launch.nativeId != nil {
                        Text("Moves the saved conversation to Desktop and stops any current response.")
                            .font(.caption2).foregroundStyle(.secondary)
                    }
                }
                .padding(12)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(.background, in: RoundedRectangle(cornerRadius: 10))
            }
        }
        .padding()
        .background(.orange.opacity(0.08), in: RoundedRectangle(cornerRadius: 14))
        .sheet(isPresented: $showingComposer, onDismiss: { Task { await refresh() } }) {
            ClaudeTaskComposer(project: project, source: source)
        }
        .task {
            await refresh()
            while !Task.isCancelled {
                do { try await Task.sleep(for: .seconds(15)) } catch { return }
                await refresh()
            }
        }
    }

    private func refresh() async {
        do {
            list = try await source.claudeLaunches(projectID: project.id)
            errorMessage = nil
        } catch {
            if error as? RuntimeBriefError == .notFound {
                errorMessage = "Update the daemon on your Mac to enable Claude tasks."
            } else {
                errorMessage = error.localizedDescription
            }
        }
    }

    private func open(_ launch: ClaudeLaunch) async {
        openingID = launch.id
        defer { openingID = nil }
        do {
            _ = try await source.openClaude(projectID: project.id, launchID: launch.id)
            openMessage = RuntimeBriefModeStore.isDemoEnabled
                ? "Demo only. No app was opened."
                : "The conversation is in Claude Desktop. Choose its RuntimeBrief task in the sidebar and send a follow-up to continue any interrupted work."
            await refresh()
        } catch { errorMessage = error.localizedDescription }
    }
}

private struct ClaudeTaskComposer: View {
    let project: ProjectSummary
    let source: any RuntimeBriefDataSource
    @Environment(\.dismiss) private var dismiss
    @State private var prompt = ""
    @State private var sending = false
    @State private var errorMessage: String?
    @FocusState private var focused: Bool

    private var taskPrompt: String { prompt.trimmingCharacters(in: .whitespacesAndNewlines) }
    private var isValid: Bool {
        (10...8_000).contains(taskPrompt.utf16.count) && !taskPrompt.hasPrefix("/")
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Label(project.name, systemImage: "folder")
                    Text("Describe the work. Claude Code runs it on your Mac using your Claude account and asks for tool approvals in Claude.")
                        .font(.subheadline).foregroundStyle(.secondary)
                }
                Section("Task") {
                    TextField("What should Claude work on?", text: $prompt, axis: .vertical)
                        .lineLimit(5...12)
                        .focused($focused)
                        .disabled(sending)
                        .accessibilityIdentifier("claude-task-prompt")
                    if !taskPrompt.isEmpty && !isValid {
                        Text("Use 10–8,000 characters and describe a task instead of a slash command.")
                            .font(.caption).foregroundStyle(.secondary)
                    }
                }
                if RuntimeBriefModeStore.isDemoEnabled {
                    Section { Text("Demo only. No task will be sent to a Mac.").foregroundStyle(.indigo) }
                }
                if let errorMessage {
                    Section { Text(errorMessage).foregroundStyle(.red).accessibilityIdentifier("claude-launch-error") }
                }
                Section {
                    Button {
                        focused = false
                        Task { await submit() }
                    } label: {
                        HStack {
                            if sending { ProgressView() }
                            Text(sending ? "Starting…" : "Start in Claude Code")
                        }
                    }
                    .disabled(!isValid || sending)
                    .accessibilityIdentifier("start-claude-task")
                }
            }
            .navigationTitle("New Claude task")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() }.disabled(sending) } }
            .interactiveDismissDisabled(sending)
        }
    }

    private func submit() async {
        guard !sending, isValid else { return }
        sending = true
        errorMessage = nil
        defer { sending = false }
        let prompt = taskPrompt
        let scope = RuntimeBriefModeStore.isDemoEnabled ? "demo" : (ServerSettings.load().baseURL?.absoluteString ?? "unconfigured")
        let request = ClaudeLaunchDraft.request(projectID: project.id, scope: scope, prompt: prompt)
        do {
            let receipt = try await source.startClaude(projectID: project.id, request: request)
            if receipt.state == "failed" {
                ClaudeLaunchDraft.clear(projectID: project.id, scope: scope, prompt: prompt)
                errorMessage = receipt.message
            } else {
                // Keep uncertain requests stable across reconnects and app restarts.
                if receipt.state != "unknown" {
                    ClaudeLaunchDraft.clear(projectID: project.id, scope: scope, prompt: prompt)
                }
                dismiss()
            }
        } catch {
            errorMessage = "\(error.localizedDescription) Your task may have started. Retrying this task uses the same request ID; you can also close this sheet and refresh Claude tasks."
        }
    }
}

enum ClaudeLaunchDraft {
    private static func key(projectID: String, scope: String, prompt: String) -> String {
        let input = try! JSONEncoder().encode([scope, projectID, prompt])
        let digest = SHA256.hash(data: input).map { String(format: "%02x", $0) }.joined()
        return "runtimebrief.claude.request.\(digest)"
    }

    static func request(projectID: String, scope: String, prompt: String, defaults: UserDefaults = .standard) -> ClaudeLaunchRequest {
        let key = key(projectID: projectID, scope: scope, prompt: prompt)
        let id = defaults.string(forKey: key) ?? UUID().uuidString.lowercased()
        defaults.set(id, forKey: key)
        return ClaudeLaunchRequest(requestId: id, prompt: prompt)
    }

    static func clear(projectID: String, scope: String, prompt: String, defaults: UserDefaults = .standard) {
        defaults.removeObject(forKey: key(projectID: projectID, scope: scope, prompt: prompt))
    }
}
