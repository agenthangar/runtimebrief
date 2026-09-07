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
}
