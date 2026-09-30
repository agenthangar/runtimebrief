import SwiftUI
import SwiftTerm

/// A view of the agent's native terminal; the agent owns all permission prompts.
struct SessionTerminalView: View {
    let project: ProjectSummary
    let launch: ClaudeLaunch
    let source: any RuntimeBriefDataSource
    @Environment(\.dismiss) private var dismiss
    @Environment(\.scenePhase) private var scenePhase
    @State private var snapshot: TerminalSnapshot?
    @State private var draft = ""
    @State private var pending: TerminalInput?
    @State private var sending = false
    @State private var message: String?

    var body: some View {
        NavigationStack {
            VStack(spacing: 8) {
                Text(RuntimeBriefModeStore.isDemoEnabled ? "Demo terminal · no Mac connected" : "Live CLI on your Mac · \(launch.agent.label) handles permissions")
                    .font(.caption).foregroundStyle(.secondary)
                if let snapshot {
                    TerminalScreen(snapshot: snapshot)
                        .accessibilityIdentifier("session-terminal-screen")
                        .accessibilityLabel(snapshot.screen.replacingOccurrences(of: #"\x1B\[[0-9;]*[A-Za-z]"#, with: "", options: .regularExpression))
                } else { ProgressView("Connecting to the terminal…").frame(maxHeight: .infinity) }
                if let message { Text(message).font(.caption).foregroundStyle(.orange).accessibilityIdentifier("session-terminal-message") }
                HStack {
                    ForEach([("↑", "\u{1b}[A"), ("↓", "\u{1b}[B"), ("Tab", "\t"), ("Esc", "\u{1b}"), ("Ctrl-C", "\u{3}"), ("Enter", "\r")], id: \.0) { label, data in
                        Button(label) { Task { await send(data) } }.buttonStyle(.bordered)
                    }
                }.font(.caption).disabled(sending || pending != nil || snapshot?.writable != true)
                HStack(alignment: .bottom) {
                    TextField("Type in the native terminal", text: $draft, axis: .vertical)
                        .lineLimit(1...4).textInputAutocapitalization(.never).autocorrectionDisabled()
                        .accessibilityIdentifier("session-terminal-input")
                    Button("Send") { Task { await send(draft.replacingOccurrences(of: "\n", with: "\r") + "\r", clearsDraft: true) } }
                        .disabled(draft.isEmpty || draft.utf8.count > 8000 || sending || pending != nil || snapshot?.writable != true)
                        .accessibilityIdentifier("session-terminal-send")
                }
                if pending != nil {
                    HStack {
                        Button("Check input") { Task { await retry() } }.disabled(sending)
                        Button("Keep reviewing") { pending = nil; message = "Check the terminal before sending the same input again." }
                    }.font(.caption)
                }
            }
            .padding(.horizontal, 12).padding(.bottom, 12)
            .navigationTitle("\(launch.agent.label) terminal").navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Done") { dismiss() } } }
            .task {
                while !Task.isCancelled {
                    if scenePhase == .active { await refresh() }
                    do { try await Task.sleep(for: .seconds(5)) } catch { return }
                }
            }
        }
    }

    private func refresh() async {
        do { snapshot = try await source.terminal(projectID: project.id, launchID: launch.id); if pending == nil { message = nil } }
        catch {
            // A stale screen cannot authorize more input after a disconnect.
            if let old = snapshot { snapshot = TerminalSnapshot(screen: old.screen, cols: old.cols, rows: old.rows, writable: false, message: error.localizedDescription) }
            message = error.localizedDescription
        }
    }

    private func send(_ data: String, clearsDraft: Bool = false) async {
        guard !sending, pending == nil, snapshot?.writable == true else { return }
        pending = TerminalInput(requestId: UUID().uuidString.lowercased(), data: data)
        if clearsDraft { draft = "" }
        await retry()
    }

    private func retry() async {
        guard !sending, let input = pending else { return }
        sending = true
        defer { sending = false }
        do {
            let result = try await source.sendInput(projectID: project.id, launchID: launch.id, input: input)
            if result.state == "sent" { pending = nil; message = nil }
            else { message = "Input delivery is uncertain. Review the terminal; checking this input will never send its keys again." }
        } catch { message = "\(error.localizedDescription) Check input to recover its acknowledgment without repeating keys." }
        await refresh()
    }
}

private struct TerminalScreen: UIViewRepresentable {
    let snapshot: TerminalSnapshot
    func makeUIView(context: Context) -> TerminalView {
        let view = TerminalView(frame: .zero, font: .monospacedSystemFont(ofSize: 9, weight: .regular))
        view.nativeBackgroundColor = .black
        view.nativeForegroundColor = .white
        view.getTerminal().setCursorStyle(.steadyBlock)
        view.feed(text: "\u{1b}[2 q")
        // Snapshot rendering is read-only; no terminal escape can send input or open links.
        view.isUserInteractionEnabled = false
        view.isAccessibilityElement = true
        view.accessibilityTraits = .staticText
        return view
    }
    func updateUIView(_ view: TerminalView, context: Context) {
        let cols = min(240, max(20, snapshot.cols)), rows = min(120, max(5, snapshot.rows))
        let fontSize = max(5, min(14, (view.bounds.width > 0 ? view.bounds.width : 350) / CGFloat(cols) / 0.61))
        view.font = .monospacedSystemFont(ofSize: fontSize, weight: .regular)
        view.accessibilityLabel = snapshot.screen.replacingOccurrences(of: #"\x1B\[[0-9;]*[A-Za-z]"#, with: "", options: .regularExpression)
        view.resize(cols: cols, rows: rows)
        view.feed(text: snapshot.screen + "\u{1b}[2 q")
    }
}
