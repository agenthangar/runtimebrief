import SwiftUI
import CryptoKit

struct SessionConversationView: View {
    let project: ProjectSummary
    let launch: ClaudeLaunch
    let source: any RuntimeBriefDataSource
    @Environment(\.dismiss) private var dismiss
    @State private var snapshot: ConversationSnapshot?
    @State private var text = ""
    @State private var sending = false
    @State private var error: String?
    @State private var answers: [String: String] = [:]
    @State private var retry: SessionReply?

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    Text(snapshot?.message ?? "Loading conversation…").font(.subheadline).foregroundStyle(.secondary)
                    ForEach(snapshot?.messages ?? []) { message in
                        VStack(alignment: .leading, spacing: 5) {
                            Text(message.role == "user" ? "You" : message.role == "tool" ? "Activity" : launch.agent.label).font(.caption.weight(.semibold)).foregroundStyle(.secondary)
                            Text(message.text).textSelection(.enabled).accessibilityIdentifier("session-message-\(message.role)")
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(12).background(message.role == "user" ? Color.blue.opacity(0.08) : Color.secondary.opacity(0.06), in: RoundedRectangle(cornerRadius: 12))
                    }
                    ForEach(snapshot?.requests ?? []) { request in
                        VStack(alignment: .leading, spacing: 10) {
                            Text(request.title).font(.headline)
                            if !request.body.isEmpty { Text(request.body).font(.callout).textSelection(.enabled) }
                            ForEach(request.options) { option in
                                Button(option.label) { Task { await send(SessionReply(requestId: UUID().uuidString.lowercased(), approvalId: request.id, optionId: option.id)) } }.buttonStyle(.bordered).accessibilityIdentifier("session-decision-\(option.id)")
                            }
                            ForEach(request.questions) { question in
                                Text(question.prompt).font(.callout.weight(.medium))
                                if !question.options.isEmpty {
                                    Picker("Answer", selection: Binding(get: { answers[question.id] ?? "" }, set: { answers[question.id] = $0 })) {
                                        Text("Choose…").tag("")
                                        ForEach(question.options) { Text($0.label).tag($0.id) }
                                    }
                                } else { TextField("Your answer", text: Binding(get: { answers[question.id] ?? "" }, set: { answers[question.id] = $0 })) }
                            }
                            if !request.questions.isEmpty {
                                Button("Send answers") {
                                    Task { await send(SessionReply(requestId: UUID().uuidString.lowercased(), approvalId: request.id, answers: Dictionary(uniqueKeysWithValues: request.questions.map { ($0.id, [answers[$0.id] ?? ""]) }))) }
                                }.disabled(request.questions.contains { (answers[$0.id] ?? "").isEmpty })
                            }
                        }.padding().background(.orange.opacity(0.08), in: RoundedRectangle(cornerRadius: 12)).disabled(sending || retry != nil)
                    }
                    if let error { Text(error).foregroundStyle(.red) }
                    if let retry {
                        Button("Retry same response") { Task { await send(retry) } }.disabled(sending)
                        Button("Dismiss retry") { self.retry = nil }.disabled(sending)
                    }
                }.padding()
            }
            .safeAreaInset(edge: .bottom) {
                if snapshot?.writable == true {
                    HStack(alignment: .bottom) {
                        TextField("Follow up", text: $text, axis: .vertical).lineLimit(1...5).accessibilityIdentifier("session-conversation-input")
                        Button { Task { await send(SessionReply(requestId: UUID().uuidString.lowercased(), text: text)) } } label: { Image(systemName: "arrow.up.circle.fill").font(.title) }
                            .accessibilityIdentifier("session-conversation-send")
                            .disabled(sending || retry != nil || text.utf16.count > 8000 || text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || snapshot?.state == "running" || !(snapshot?.requests.isEmpty ?? true))
                    }.padding().background(.bar)
                }
            }
            .navigationTitle(launch.agent.label)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Done") { dismiss() } } }
            .task {
                while !Task.isCancelled {
                    await refresh()
                    do { try await Task.sleep(for: .seconds(2)) } catch { return }
                }
            }
        }
    }
    private func refresh() async {
        do { snapshot = try await source.conversation(projectID: project.id, launchID: launch.id); if retry == nil { error = nil } }
        catch { self.error = error.localizedDescription }
    }
    private func send(_ proposed: SessionReply) async {
        let scope = AgentSessionsStore.shared.connectionScope()
        let reply = SessionReplyDraft.request(scope: scope, launchID: launch.id, body: proposed)
        guard !sending else { return }; sending = true
        defer { sending = false }
        retry = reply
        do {
            let result = try await source.reply(projectID: project.id, launchID: launch.id, reply: reply)
            if result.accepted { SessionReplyDraft.clear(scope: scope, launchID: launch.id, body: reply); retry = nil; text = ""; error = nil; await refresh() }
            else { error = "Delivery is unconfirmed. Refresh before sending another response." }
        } catch { self.error = error.localizedDescription }
    }
}

/// Preserve response IDs across app restarts without storing message contents.
enum SessionReplyDraft {
    private static func key(scope: String, launchID: String, body: SessionReply) -> String {
        let encoder = JSONEncoder(); encoder.outputFormatting = [.sortedKeys]
        let identity = SessionReply(requestId: "", text: body.text, approvalId: body.approvalId, optionId: body.optionId, answers: body.answers)
        let bytes = (try? encoder.encode(identity)) ?? Data()
        let digest = SHA256.hash(data: Data((scope + launchID).utf8) + bytes).map { String(format: "%02x", $0) }.joined()
        return "runtimebrief.reply.\(digest)"
    }
    static func request(scope: String, launchID: String, body: SessionReply, defaults: UserDefaults = .standard) -> SessionReply {
        let key = key(scope: scope, launchID: launchID, body: body)
        let id = defaults.string(forKey: key) ?? UUID().uuidString.lowercased()
        defaults.set(id, forKey: key)
        return SessionReply(requestId: id, text: body.text, approvalId: body.approvalId, optionId: body.optionId, answers: body.answers)
    }
    static func clear(scope: String, launchID: String, body: SessionReply, defaults: UserDefaults = .standard) {
        defaults.removeObject(forKey: key(scope: scope, launchID: launchID, body: body))
    }
}
