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
    var permissionMode: String? = nil
    var backend: String? = nil
    var tmuxTarget: String? = nil
    var launchState: String? = nil
    var requestedRemoteControl: Bool? = nil
    var remoteControl: ClaudeRemoteControl? = nil

    var settingsLabel: String {
        let model = ClaudeModel(rawValue: model ?? "default")?.label ?? "Claude"
        let permissions = ClaudePermissionMode(rawValue: permissionMode ?? "manual")?.label ?? "Manual"
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
}

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
