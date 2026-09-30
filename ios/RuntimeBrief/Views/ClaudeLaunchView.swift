import SwiftUI
import CryptoKit

/// One launch surface; the conversation and all tool approvals stay in the native agent.
struct ClaudeLaunchView: View {
    let project: ProjectSummary
    @State private var list: ClaudeLaunchList?
    @State private var showingComposer = false
    @State private var terminalLaunch: ClaudeLaunch?
    @State private var errorMessage: String?
    @State private var openingID: String?
    @State private var openMessage: String?

    private var source: any RuntimeBriefDataSource { RuntimeBriefDataSourceFactory.current() }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Label("Coding agents", systemImage: "terminal")
                    .font(.headline)
                Spacer()
                Button { Task { await refresh() } } label: { Image(systemName: "arrow.clockwise") }
                    .accessibilityLabel("Refresh agent tasks")
            }
            if let capability = list?.capability {
                Text("Start a task on your Mac and continue its native conversation.")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                Button { showingComposer = true } label: {
                    Label("New task", systemImage: "plus")
                }
                .buttonStyle(.borderedProminent)
                .disabled(!(list?.providers?.contains(where: { $0.available }) ?? capability.available))
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
                    Text("Started with \(launch.settingsLabel)").font(.caption.weight(.medium))
                    if let remote = launch.remoteControl {
                        Text(launch.agent == .claude ? remote.label : remote.terminalLabel).font(.caption).foregroundStyle(.secondary)
                        if launch.agent == .claude, remote.state == "ready", RuntimeBriefModeStore.isDemoEnabled {
                            Button("Open Remote Control") { openMessage = "Demo only. No session was opened." }
                                .accessibilityIdentifier("remote-control-\(launch.id)")
                        } else if remote.state == "ready", let url = remote.nativeURL {
                            Link("Open Remote Control", destination: url)
                                .accessibilityIdentifier("remote-control-\(launch.id)")
                        }
                    }
                    if launch.agent != .claude, launch.remoteControl?.state == "ready" {
                        Button { terminalLaunch = launch } label: { Label("Open \(launch.agent.label) terminal", systemImage: "terminal") }
                            .accessibilityIdentifier("open-session-terminal")
                    }
                    if let target = launch.tmuxTarget {
                        Text("On your Mac: tmux attach -t \(target)")
                            .font(.caption.monospaced()).textSelection(.enabled)
                    }
                    if let nativeID = launch.nativeId, launch.backend == nil {
                        Text("Session \(nativeID)").font(.caption.monospaced()).foregroundStyle(.secondary)
                        Button {
                            Task { await open(launch) }
                        } label: {
                            Label(openingID == launch.id ? "Opening…" : (launch.openedAt == nil ? "Open in Claude Desktop" : "Open Claude Desktop"), systemImage: "macwindow")
                        }
                        .disabled(openingID != nil)
                        .accessibilityIdentifier("take-over-claude-\(launch.id)")
                    }
                    if launch.backend == nil && launch.openedAt == nil && launch.nativeId != nil {
                        Text("Moves the saved conversation to Desktop and stops any current response. Desktop may apply its own permission mode.")
                            .font(.caption2).foregroundStyle(.secondary)
                    }
                }
                .accessibilityElement(children: .contain)
                .accessibilityIdentifier("claude-launch-\(launch.id)")
                .padding(12)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(.background, in: RoundedRectangle(cornerRadius: 10))
            }
        }
        .padding()
        .background(.orange.opacity(0.08), in: RoundedRectangle(cornerRadius: 14))
        .sheet(isPresented: $showingComposer, onDismiss: { Task { await refresh() } }) {
            ClaudeTaskComposer(project: project, source: source, providers: list?.providers ?? [AgentCapability(id: .claude, available: list?.capability.available ?? false, message: list?.capability.message ?? "Check your Mac.")])
        }
        .sheet(item: $terminalLaunch) { launch in SessionTerminalView(project: project, launch: launch, source: source) }
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
            list = try await source.sessions(projectID: project.id)
            errorMessage = nil
        } catch {
            if error as? RuntimeBriefError == .notFound {
                errorMessage = "Update the daemon on your Mac to enable agent tasks."
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
                : "The conversation is in Claude Desktop. Choose its RuntimeBrief task in the sidebar. Check Desktop's permission mode, then send a follow-up to continue any interrupted work."
            await refresh()
        } catch { errorMessage = error.localizedDescription }
    }
}

private struct ClaudeTaskComposer: View {
    let project: ProjectSummary
    let source: any RuntimeBriefDataSource
    let providers: [AgentCapability]
    @Environment(\.dismiss) private var dismiss
    @State private var provider: AgentProvider = .claude
    @State private var nativeModel = "default"
    @State private var nativeMode = "manual"
    @State private var prompt = ""
    @State private var sending = false
    @State private var errorMessage: String?
    @State private var reasoningEffort = "default"
    @State private var permissionMode: ClaudePermissionMode = .manual
    @State private var remoteControl = true
    @FocusState private var focused: Bool

    private var taskPrompt: String { prompt.trimmingCharacters(in: .whitespacesAndNewlines) }
    private var isValid: Bool {
        (10...8_000).contains(taskPrompt.utf16.count) && !taskPrompt.hasPrefix("/")
    }

    private var capability: AgentCapability? { providers.first { $0.id == provider } }
    private var selectedModel: String { nativeModel }
    private var modelChoices: [AgentModel] {
        capability?.models ?? (provider == .claude ? ClaudeModel.allCases.filter { $0 != .default }.map { AgentModel(id: $0.rawValue, label: $0.label) } : [])
    }
    private var reasoningChoices: [String] {
        let id = selectedModel == "default" ? capability?.defaultModelLabel : selectedModel
        return modelChoices.first { $0.id == id }?.reasoningEfforts ?? []
    }
    private var selectedMode: String { provider == .claude ? permissionMode.rawValue : nativeMode }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Label(project.name, systemImage: "folder")
                    Text("Runs on your Mac using your \(provider.label) account.")
                        .font(.subheadline).foregroundStyle(.secondary)
                }
                Section("Task") {
                    TextField("What should the agent work on?", text: $prompt, axis: .vertical)
                        .lineLimit(3...8)
                        .focused($focused)
                        .disabled(sending)
                        .accessibilityIdentifier("claude-task-prompt")
                    if !taskPrompt.isEmpty && !isValid {
                        Text("Use 10–8,000 characters and describe a task instead of a slash command.")
                            .font(.caption).foregroundStyle(.secondary)
                    }
                }
                Section {
                    Picker("Agent", selection: $provider) {
                        ForEach(AgentProvider.allCases) { Text($0.label).tag($0) }
                    }
                    .accessibilityIdentifier("session-provider-picker")
                    .onChange(of: provider) { nativeMode = "manual"; permissionMode = .manual; nativeModel = "default"; reasoningEffort = "default" }
                    if let capability { Text(capability.message).font(.caption).foregroundStyle(capability.available ? Color.secondary : Color.orange) }
                    Picker("Model", selection: $nativeModel) {
                        Text("\(provider.label) default").tag("default")
                        ForEach(modelChoices) { Text($0.label).tag($0.id) }
                    }
                    .pickerStyle(.menu)
                    .accessibilityIdentifier(provider == .claude ? "claude-model-picker" : "session-model-picker")
                    .onChange(of: nativeModel) { reasoningEffort = "default" }
                    if selectedModel == "default", let label = capability?.defaultModelLabel {
                        Text("Default: \(label)").font(.caption).foregroundStyle(.secondary)
                    }
                    if let message = capability?.modelsMessage {
                        Text(message).font(.caption).foregroundStyle(.secondary)
                    } else if capability?.models == nil && provider != .claude {
                        Text("Update RuntimeBrief on your Mac to load available models.").font(.caption).foregroundStyle(.secondary)
                    }
                    if !reasoningChoices.isEmpty {
                        Picker("Reasoning", selection: $reasoningEffort) {
                            Text("Default (\(selectedModel == "default" ? (capability?.defaultReasoningLabel?.capitalized ?? "Native") : "Mac settings"))").tag("default")
                            ForEach(reasoningChoices, id: \.self) { Text($0 == "xhigh" ? "Extra High" : $0.capitalized).tag($0) }
                        }
                        .pickerStyle(.menu)
                        .accessibilityIdentifier("session-reasoning-picker")
                    } else if capability?.models != nil {
                        LabeledContent("Reasoning", value: "Native default")
                        Text("This model doesn’t expose a reasoning setting.").font(.caption).foregroundStyle(.secondary)
                    }
                    if provider == .claude {
                    Picker("Permissions", selection: $permissionMode) {
                        ForEach(ClaudePermissionMode.allCases) { Text($0.label).tag($0) }
                    }
                    .accessibilityIdentifier("claude-permissions-picker")
                    .pickerStyle(.menu)
                    Text(permissionMode.explanation)
                        .font(.caption)
                        .foregroundStyle(permissionMode == .bypassPermissions ? .orange : .secondary)
                    } else {
                        Picker("Permissions", selection: $nativeMode) {
                            ForEach(capability?.permissionModes ?? provider.modes, id: \.self) { Text(provider.permissionLabel($0)).tag($0) }
                        }
                        .pickerStyle(.menu)
                        .accessibilityIdentifier("session-permissions-picker")
                        Text(provider.permissionExplanation(nativeMode))
                            .font(.caption).foregroundStyle(nativeMode == "bypassPermissions" ? .orange : .secondary)
                    }
                    Toggle("Remote Control", isOn: $remoteControl)
                        .accessibilityIdentifier("claude-remote-control-toggle")
                    Text(provider == .claude ? "Connect through your Claude account from another device. Availability depends on Claude setup on your Mac." : "Continue this live CLI through your authenticated RuntimeBrief connection. The agent handles sign-in, trust, and permissions.")
                        .font(.caption).foregroundStyle(.secondary)
                } footer: {
                    Text("Uses your Mac’s agent installation and account.")
                }
                .disabled(sending)
                if RuntimeBriefModeStore.isDemoEnabled {
                    Section { Text("Demo only. No task will be sent to a Mac.").foregroundStyle(.indigo) }
                }
                if let errorMessage {
                    Section { Text(errorMessage).foregroundStyle(.red).accessibilityIdentifier("claude-launch-error") }
                }
            }
            .scrollDismissesKeyboard(.interactively)
            .safeAreaInset(edge: .bottom) {
                Button {
                    focused = false
                    Task { await submit() }
                } label: {
                    HStack {
                        if sending { ProgressView() }
                        Text(sending ? "Starting…" : "Start in \(provider.label)")
                    }
                    .frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                .disabled(!isValid || sending || capability?.available != true)
                .accessibilityIdentifier("start-claude-task")
                .padding()
                .background(.bar)
            }
            .navigationTitle("New task")
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
        let request = SessionLaunchDraft.request(projectID: project.id, scope: scope, prompt: prompt, provider: provider, model: selectedModel, permissionMode: selectedMode, reasoningEffort: reasoningEffort, remoteControl: remoteControl)
        do {
            let receipt = try await source.startSession(projectID: project.id, request: request)
            if receipt.state == "failed" {
                SessionLaunchDraft.clear(projectID: project.id, scope: scope, prompt: prompt, provider: provider, model: selectedModel, permissionMode: selectedMode, reasoningEffort: reasoningEffort, remoteControl: remoteControl)
                errorMessage = receipt.message
            } else {
                // Keep uncertain requests stable across reconnects and app restarts.
                if receipt.state != "unknown" {
                    SessionLaunchDraft.clear(projectID: project.id, scope: scope, prompt: prompt, provider: provider, model: selectedModel, permissionMode: selectedMode, reasoningEffort: reasoningEffort, remoteControl: remoteControl)
                }
                dismiss()
            }
        } catch {
            errorMessage = "\(error.localizedDescription) Your task may have started. Retrying this task uses the same request ID; you can also close this sheet and refresh agent tasks."
        }
    }
}

enum ClaudeLaunchDraft {
    private static func key(projectID: String, scope: String, prompt: String, model: ClaudeModel, permissionMode: ClaudePermissionMode, remoteControl: Bool) -> String {
        // Keep default-mode retry keys compatible with already-sent build-15 tasks.
        var identity = [scope, projectID, prompt]
        if model != .default || permissionMode != .manual { identity += [model.rawValue, permissionMode.rawValue] }
        if !remoteControl { identity += ["remoteControl", "false"] }
        let input = try! JSONEncoder().encode(identity)
        let digest = SHA256.hash(data: input).map { String(format: "%02x", $0) }.joined()
        return "runtimebrief.claude.request.\(digest)"
    }

    static func request(projectID: String, scope: String, prompt: String, model: ClaudeModel = .default, permissionMode: ClaudePermissionMode = .manual, remoteControl: Bool = true, defaults: UserDefaults = .standard) -> ClaudeLaunchRequest {
        let key = key(projectID: projectID, scope: scope, prompt: prompt, model: model, permissionMode: permissionMode, remoteControl: remoteControl)
        let id = defaults.string(forKey: key) ?? UUID().uuidString.lowercased()
        defaults.set(id, forKey: key)
        return ClaudeLaunchRequest(requestId: id, prompt: prompt, model: model, permissionMode: permissionMode, remoteControl: remoteControl)
    }

    static func clear(projectID: String, scope: String, prompt: String, model: ClaudeModel = .default, permissionMode: ClaudePermissionMode = .manual, remoteControl: Bool = true, defaults: UserDefaults = .standard) {
        defaults.removeObject(forKey: key(projectID: projectID, scope: scope, prompt: prompt, model: model, permissionMode: permissionMode, remoteControl: remoteControl))
    }
}


enum SessionLaunchDraft {
    private static func key(projectID: String, scope: String, prompt: String, provider: AgentProvider, model: String, permissionMode: String, reasoningEffort: String, remoteControl: Bool) -> String {
        var identity = [scope, projectID, prompt, provider.rawValue, model, permissionMode, String(remoteControl)]
        if reasoningEffort != "default" { identity += ["reasoningEffort", reasoningEffort] }
        let digest = SHA256.hash(data: try! JSONEncoder().encode(identity)).map { String(format: "%02x", $0) }.joined()
        return "runtimebrief.session.request.\(digest)"
    }
    static func request(projectID: String, scope: String, prompt: String, provider: AgentProvider, model: String = "default", permissionMode: String = "manual", reasoningEffort: String = "default", remoteControl: Bool = true, defaults: UserDefaults = .standard) -> SessionLaunchRequest {
        if provider == .claude, reasoningEffort == "default", let modelValue = ClaudeModel(rawValue: model), let mode = ClaudePermissionMode(rawValue: permissionMode) {
            let legacy = ClaudeLaunchDraft.request(projectID: projectID, scope: scope, prompt: prompt, model: modelValue, permissionMode: mode, remoteControl: remoteControl, defaults: defaults)
            return SessionLaunchRequest(requestId: legacy.requestId, prompt: prompt, provider: provider, model: model, reasoningEffort: reasoningEffort == "default" ? nil : reasoningEffort, permissionMode: permissionMode, remoteControl: remoteControl)
        }
        let key = key(projectID: projectID, scope: scope, prompt: prompt, provider: provider, model: model, permissionMode: permissionMode, reasoningEffort: reasoningEffort, remoteControl: remoteControl)
        let id = defaults.string(forKey: key) ?? UUID().uuidString.lowercased()
        defaults.set(id, forKey: key)
        return SessionLaunchRequest(requestId: id, prompt: prompt, provider: provider, model: model, reasoningEffort: reasoningEffort == "default" ? nil : reasoningEffort, permissionMode: permissionMode, remoteControl: remoteControl)
    }
    static func clear(projectID: String, scope: String, prompt: String, provider: AgentProvider, model: String, permissionMode: String, reasoningEffort: String = "default", remoteControl: Bool, defaults: UserDefaults = .standard) {
        if provider == .claude, reasoningEffort == "default", let modelValue = ClaudeModel(rawValue: model), let mode = ClaudePermissionMode(rawValue: permissionMode) {
            ClaudeLaunchDraft.clear(projectID: projectID, scope: scope, prompt: prompt, model: modelValue, permissionMode: mode, remoteControl: remoteControl, defaults: defaults)
        } else {
            defaults.removeObject(forKey: key(projectID: projectID, scope: scope, prompt: prompt, provider: provider, model: model, permissionMode: permissionMode, reasoningEffort: reasoningEffort, remoteControl: remoteControl))
        }
    }
}
