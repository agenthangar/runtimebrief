import SwiftUI

/// Monospaced accent for branch names, commit hashes, and other repo facts.
struct MonoLabel: View {
    let text: String
    var body: some View {
        Text(text)
            .font(.system(.caption, design: .monospaced))
            .foregroundStyle(.secondary)
    }
}

struct DirtyDot: View {
    let dirty: Bool?
    var body: some View {
        Circle()
            .fill(color)
            .frame(width: 8, height: 8)
            .accessibilityLabel(label)
    }
    private var color: Color {
        switch dirty {
        case .some(true): .orange
        case .some(false): .green
        case .none: .gray
        }
    }
    private var label: String {
        switch dirty {
        case .some(true): "uncommitted changes"
        case .some(false): "clean"
        case .none: "unknown"
        }
    }
}

struct RelativeTimeText: View {
    let date: Date?
    var body: some View {
        if let date {
            Text(date, format: .relative(presentation: .named))
                .font(.caption)
                .foregroundStyle(.secondary)
        } else {
            Text("no recent activity")
                .font(.caption)
                .foregroundStyle(.tertiary)
        }
    }
}

struct ErrorBanner: View {
    let message: String
    var body: some View {
        Label(message, systemImage: "exclamationmark.triangle")
            .font(.callout)
            .foregroundStyle(.orange)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(12)
            .background(.orange.opacity(0.1), in: RoundedRectangle(cornerRadius: 10))
    }
}

struct BriefStateBadge: View {
    let state: ProjectBriefState

    var body: some View {
        Label(label, systemImage: icon)
            .font(.caption.weight(.semibold))
            .foregroundStyle(color)
            .padding(.horizontal, 8)
            .padding(.vertical, 4)
            .background(color.opacity(0.12), in: Capsule())
            .accessibilityLabel(label)
    }

    private var label: String {
        switch state {
        case .active: "Active"
        case .attention: "Attention"
        case .recent: "Ready"
        case .quiet: "Quiet"
        case .unavailable: "Unavailable"
        }
    }

    private var icon: String {
        switch state {
        case .active: "bolt.fill"
        case .attention: "exclamationmark.triangle.fill"
        case .recent: "checkmark.circle.fill"
        case .quiet: "moon.fill"
        case .unavailable: "questionmark.circle.fill"
        }
    }

    private var color: Color {
        switch state {
        case .active: .blue
        case .attention: .orange
        case .recent: .green
        case .quiet: .secondary
        case .unavailable: .red
        }
    }
}

struct ClaimLabel: View {
    let claim: BriefClaim
    var showEvidence = true

    var body: some View {
        VStack(alignment: .leading, spacing: 5) {
            Label(claim.text, systemImage: icon)
                .font(.subheadline)
                .foregroundStyle(.primary)
            if showEvidence, let evidence = claim.evidence.first {
                HStack(spacing: 5) {
                    Image(systemName: "checkmark.seal")
                    Text(evidence.label)
                    if let timestamp = evidence.timestamp {
                        Text("·")
                        Text(timestamp, format: .relative(presentation: .named))
                    }
                }
                .font(.caption)
                .foregroundStyle(.secondary)
                .accessibilityLabel("Evidence: \(evidence.label)")
            }
        }
    }

    private var icon: String {
        switch claim.category {
        case .attention: "exclamationmark.circle"
        case .progress: "arrow.trianglehead.2.clockwise"
        case .completed: "checkmark.circle"
        case .context: "info.circle"
        }
    }
}

struct EvidenceList: View {
    let evidence: [EvidenceRef]

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            ForEach(evidence) { item in
                VStack(alignment: .leading, spacing: 3) {
                    HStack {
                        Label(item.label, systemImage: icon(for: item.kind))
                            .font(.caption.weight(.semibold))
                        Spacer()
                        if let timestamp = item.timestamp {
                            Text(timestamp, format: .relative(presentation: .named))
                                .font(.caption2)
                                .foregroundStyle(.secondary)
                        }
                    }
                    Text(item.detail)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .textSelection(.enabled)
                }
                .padding(10)
                .background(.quaternary.opacity(0.35), in: RoundedRectangle(cornerRadius: 10))
                .accessibilityIdentifier("evidence-source")
            }
        }
    }

    private func icon(for kind: EvidenceKind) -> String {
        switch kind {
        case .workingTree: "arrow.triangle.branch"
        case .commit: "point.topleft.down.to.point.bottomright.curvepath"
        case .session: "terminal"
        case .projectScan: "magnifyingglass"
        case .xcodeProject: "hammer"
        case .testFlightBuild: "paperplane.fill"
        case .appStoreVersion: "storefront"
        }
    }
}

struct SessionStateBadge: View {
    let state: AgentSessionState

    var body: some View {
        Label(label, systemImage: icon)
            .font(.caption2.weight(.semibold))
            .foregroundStyle(color)
    }

    private var label: String {
        switch state {
        case .active: "Active"
        case .waiting: "Waiting"
        case .completed: "Completed"
        case .interrupted: "Stopped"
        case .unknown: "Unknown"
        }
    }

    private var icon: String {
        switch state {
        case .active: "bolt.fill"
        case .waiting: "person.crop.circle.badge.questionmark"
        case .completed: "checkmark.circle.fill"
        case .interrupted: "stop.circle.fill"
        case .unknown: "questionmark.circle"
        }
    }

    private var color: Color {
        switch state {
        case .active: .blue
        case .waiting: .orange
        case .completed: .green
        case .interrupted: .secondary
        case .unknown: .secondary
        }
    }
}
