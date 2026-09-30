import Foundation

struct ClaudeLaunch: Decodable, Identifiable, Sendable, Equatable {
    let id: String
    let projectId: String
    let name: String
    let createdAt: Date
    let state: String
    let message: String
    let nativeId: String?
    let sessionId: String?
    let cwd: String
    let openedAt: Date?
    var model: String? = nil
    var reasoningEffort: String? = nil
    var effectiveReasoningEffort: String? = nil
    var permissionMode: String? = nil
    var backend: String? = nil
    var tmuxTarget: String? = nil
    var launchState: String? = nil
    var requestedRemoteControl: Bool? = nil
    var remoteControl: ClaudeRemoteControl? = nil
    var provider: AgentProvider? = nil

    var agent: AgentProvider { provider ?? .claude }

    var settingsLabel: String {
        let model = agent == .claude ? (ClaudeModel(rawValue: model ?? "default")?.label ?? "Claude") : (model == nil || model == "default" ? "\(agent.label) default" : model!)
        let permissions = ClaudePermissionMode(rawValue: permissionMode ?? "manual")?.label ?? (permissionMode ?? "manual").capitalized
        return "\(model) · \(permissions)"
    }

    var stateLabel: String {
        switch state {
        case "starting": "Starting"
        case "running": "Working"
        case "needs_input": "Needs you"
        case "completed": "Ready to review"
        case "failed": "Needs attention"
        case "stopped": "Stopped"
        case "in_desktop": "In Claude Desktop"
        default: "Check your Mac"
        }
    }
}

struct ClaudeRemoteControl: Decodable, Sendable, Equatable {
    let state: String
    let url: String?

    var nativeURL: URL? {
        guard let url,
              url.range(of: #"^https://claude\.ai/code/session_[A-Za-z0-9_-]+$"#, options: .regularExpression) != nil
        else { return nil }
        return URL(string: url)
    }

    var terminalLabel: String {
        switch state {
        case "ready": "Remote terminal connected"
        case "disabled": "Remote Control off"
        case "starting": "Remote terminal starting"
        default: "Remote terminal unavailable"
        }
    }

    var label: String {
        switch state {
        case "ready": "Remote Control connected"
        case "disabled": "Remote Control off"
        case "starting": "Remote Control starting"
        case "unavailable": "Remote Control needs setup in Claude"
        default: "Remote Control connection unconfirmed"
        }
    }
}

struct ClaudeLaunchCapability: Decodable, Sendable, Equatable {
    let available: Bool
    let message: String
}

struct ClaudeLaunchList: Decodable, Sendable, Equatable {
    let capability: ClaudeLaunchCapability
    let launches: [ClaudeLaunch]
    var providers: [AgentCapability]? = nil
}

enum AgentProvider: String, Codable, CaseIterable, Identifiable, Sendable {
    case claude, codex, cursor
    var id: String { rawValue }
    var label: String { switch self { case .claude: "Claude Code"; case .codex: "Codex"; case .cursor: "Cursor" } }
    var modes: [String] { self == .claude ? ClaudePermissionMode.allCases.map(\.rawValue) : self == .cursor ? ["manual", "plan", "ask"] : ["manual", "plan"] }
}

struct AgentCapability: Decodable, Equatable, Sendable, Identifiable {
    let id: AgentProvider
    let available: Bool
    let message: String
    let models: [AgentModel]?
    let modelsMessage: String?
    let permissionModes: [String]?
    let defaultModelLabel: String?
    let defaultReasoningLabel: String?

    init(id: AgentProvider, available: Bool, message: String, models: [AgentModel]? = nil, modelsMessage: String? = nil, permissionModes: [String]? = nil, defaultModelLabel: String? = nil, defaultReasoningLabel: String? = nil) {
        self.id = id; self.available = available; self.message = message
        self.models = models; self.modelsMessage = modelsMessage; self.permissionModes = permissionModes
        self.defaultModelLabel = defaultModelLabel; self.defaultReasoningLabel = defaultReasoningLabel
    }
}

struct AgentModel: Decodable, Equatable, Identifiable, Sendable {
    let id: String
    let label: String
    let reasoningEfforts: [String]?
    init(id: String, label: String, reasoningEfforts: [String]? = nil) {
        self.id = id; self.label = label; self.reasoningEfforts = reasoningEfforts
    }
}

extension AgentProvider {
    func permissionLabel(_ mode: String) -> String {
        mode == "ask" ? "Ask" : (ClaudePermissionMode(rawValue: mode)?.label ?? mode.capitalized)
    }
    func permissionExplanation(_ mode: String) -> String {
        if self == .claude { return ClaudePermissionMode(rawValue: mode)?.explanation ?? "" }
        switch mode {
        case "auto": return self == .codex ? "Codex reviews approval requests automatically in its workspace sandbox." : "Cursor reviews safe actions automatically and asks before other actions."
        case "plan": return self == .codex ? "Codex explores in its read-only sandbox." : "Cursor explores and plans before making changes."
        case "ask": return "Cursor answers questions without making changes."
        case "bypassPermissions": return self == .codex ? "Runs Codex without approval prompts or its sandbox." : "Runs Cursor without approval prompts or its sandbox. Explicitly denied commands remain denied."
        case "dontAsk": return "Codex uses its workspace sandbox and denies actions that would need approval."
        default: return self == .codex ? "Codex uses its workspace sandbox and asks before actions that need approval." : "Cursor asks before actions that need permission."
        }
    }
}

struct SessionLaunchRequest: Encodable, Sendable {
    let requestId: String
    let prompt: String
    var provider: AgentProvider = .claude
    var model: String = "default"
    var reasoningEffort: String? = nil
    var permissionMode: String = "manual"
    var remoteControl: Bool = true
}

struct TerminalSnapshot: Decodable, Sendable {
    let screen: String
    let cols: Int
    let rows: Int
    let writable: Bool
    let message: String
}

struct TerminalInput: Encodable, Sendable {
    let requestId: String
    let data: String
}

struct TerminalInputResult: Decodable, Sendable { let state: String }

struct ClaudeLaunchRequest: Encodable, Sendable {
    let requestId: String
    let prompt: String
    var model: ClaudeModel = .default
    var permissionMode: ClaudePermissionMode = .manual
    var remoteControl: Bool = true
}

enum ClaudeModel: String, Codable, CaseIterable, Identifiable, Sendable {
    case `default`, fable, opus, sonnet, haiku
    var id: String { rawValue }
    var label: String {
        switch self {
        case .default: "Claude default"
        case .fable: "Fable"
        case .opus: "Opus"
        case .sonnet: "Sonnet"
        case .haiku: "Haiku"
        }
    }
}

enum ClaudePermissionMode: String, Codable, CaseIterable, Identifiable, Sendable {
    case manual, auto, acceptEdits, plan, bypassPermissions, dontAsk
    var id: String { rawValue }
    var label: String {
        switch self {
        case .manual: "Manual"
        case .auto: "Auto"
        case .acceptEdits: "Accept Edits"
        case .plan: "Plan"
        case .bypassPermissions: "Bypass"
        case .dontAsk: "Pre-approved Only"
        }
    }
    var explanation: String {
        switch self {
        case .manual: "Claude asks before actions that need permission."
        case .auto: "Claude checks actions automatically. Availability depends on your Claude account and model."
        case .acceptEdits: "Claude can edit files automatically and asks before other actions that need permission."
        case .plan: "Claude explores and plans before making changes."
        case .bypassPermissions: "Runs tools without permission prompts or safety checks. Use only for work and projects you trust."
        case .dontAsk: "Runs only pre-approved tools and denies actions that would need approval."
        }
    }
}
