import Foundation

/// Wire types matching runtimebriefd's /v1 API.

struct ProjectSummary: Codable, Identifiable, Hashable, Sendable {
    let id: String
    let name: String
    let lastActivityAt: Date?
    let branch: String?
    let dirty: Bool?
    let brief: ProjectBrief?
}

struct ProjectCard: Codable, Sendable {
    let id: String
    let name: String
    let path: String
    let lastActivityAt: Date?
    let git: GitSummary?
    let iosRelease: IOSReleaseSummary?
    let sessions: [SessionInfo]
    let brief: ProjectBrief?
}

enum ProjectBriefState: String, Codable, Hashable, Sendable {
    case active
    case attention
    case recent
    case quiet
    case unavailable
}

enum BriefClaimCategory: String, Codable, Hashable, Sendable {
    case attention
    case progress
    case completed
    case context
}

enum EvidenceKind: String, Codable, Hashable, Sendable {
    case workingTree = "working-tree"
    case commit
    case session
    case projectScan = "project-scan"
    case xcodeProject = "xcode-project"
    case testFlightBuild = "testflight-build"
    case appStoreVersion = "app-store-version"
}

struct IOSReleaseSummary: Codable, Sendable {
    let xcode: XcodeProjectSummary
    let appStoreConnect: AppStoreConnectSummary
}

struct XcodeProjectSummary: Codable, Sendable {
    let source: String
    let projectFile: String
    let scheme: String
    let bundleId: String
    let marketingVersion: String?
    let buildNumber: String?
}

enum AppStoreConnectStatus: String, Codable, Sendable {
    case available
    case notConfigured = "not-configured"
    case appNotFound = "app-not-found"
    case unavailable
}

struct AppStoreConnectSummary: Codable, Sendable {
    let status: AppStoreConnectStatus
    let checkedAt: Date?
    let message: String?
    let appId: String?
    let latestTestFlightBuild: TestFlightBuildSummary?
    let appStoreVersion: AppStoreVersionSummary?
}

struct TestFlightBuildSummary: Codable, Sendable {
    let id: String
    let marketingVersion: String?
    let buildNumber: String
    let uploadedAt: Date?
    let expiresAt: Date?
    let expired: Bool
    let processingState: String
    let audienceType: String?
}

struct AppStoreVersionSummary: Codable, Sendable {
    let id: String
    let version: String
    let buildNumber: String?
    let state: String
    let createdAt: Date?
}

struct EvidenceRef: Codable, Identifiable, Hashable, Sendable {
    let id: String
    let kind: EvidenceKind
    let label: String
    let detail: String
    let source: String?
    let timestamp: Date?
}

struct BriefClaim: Codable, Identifiable, Hashable, Sendable {
    let id: String
    let category: BriefClaimCategory
    let text: String
    let evidence: [EvidenceRef]
}

struct ProjectBrief: Codable, Hashable, Sendable {
    let state: ProjectBriefState
    let headline: String
    let headlineEvidence: [EvidenceRef]
    let updatedAt: Date?
    let activeSessionCount: Int
    let claims: [BriefClaim]
}

struct GitSummary: Codable, Sendable {
    let branch: String
    let dirty: Bool
    let dirtyFileCount: Int
    let commits: [CommitInfo]
    let diffstatVsDefault: String?
    let defaultBranch: String?
    let todoCount: Int
    let fixmeCount: Int
    let lastCommitAt: Date?
}

struct CommitInfo: Codable, Hashable, Sendable {
    let hash: String
    let author: String
    let timestamp: Date
    let message: String
}

struct SessionInfo: Codable, Identifiable, Hashable, Sendable {
    let source: String
    let id: String
    let startedAt: Date?
    let endedAt: Date?
    let summary: String?
    let state: AgentSessionState?
    let stateReason: String?
    let gitBranch: String?
    let model: String?
    let filesTouched: [String]?
    let toolUseCount: Int?
    let conclusion: String?
}

enum AgentSessionState: String, Codable, Hashable, Sendable {
    case active
    case waiting
    case completed
    case interrupted
    case unknown
}

struct AnalystAnswer: Codable, Sendable, Equatable {
    let answer: String
    let costUsd: Double
    let cached: Bool
    let truncated: Bool
    let evidence: [EvidenceRef]?

    var spokenAnswer: String {
        let withoutCitations = answer
            .replacingOccurrences(
                of: #"\[[^\[\]]+\]"#,
                with: "",
                options: .regularExpression
            )
            .replacingOccurrences(of: "  ", with: " ")
            .trimmingCharacters(in: .whitespacesAndNewlines)
        guard evidence?.isEmpty == false else { return withoutCitations }
        return withoutCitations + " Evidence is available in RuntimeBrief."
    }
}

struct HealthInfo: Codable, Sendable {
    let version: String
    let uptime: Int
}

extension JSONDecoder {
    /// Decoder configured for runtimebriefd's ISO-8601 timestamps
    /// (which include fractional seconds).
    static var runtimeBrief: JSONDecoder {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .custom { decoder in
            let container = try decoder.singleValueContainer()
            let string = try container.decode(String.self)
            let formatter = ISO8601DateFormatter()
            formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
            if let date = formatter.date(from: string) { return date }
            formatter.formatOptions = [.withInternetDateTime]
            if let date = formatter.date(from: string) { return date }
            throw DecodingError.dataCorruptedError(
                in: container, debugDescription: "Unparseable date: \(string)")
        }
        return decoder
    }
}
