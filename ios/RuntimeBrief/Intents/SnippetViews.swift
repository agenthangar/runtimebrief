import SwiftUI

/// Card shown under Siri's spoken answer.
struct StatusSnippetView: View {
    let projectName: String
    let branch: String?
    let answer: String

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 8) {
                Image(systemName: "shippingbox")
                    .foregroundStyle(.secondary)
                Text(projectName)
                    .font(.headline)
                Spacer()
                if let branch {
                    Text(branch)
                        .font(.system(.caption, design: .monospaced))
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
            }
            Text(answer)
                .font(.subheadline)
                .lineSpacing(3)
                .lineLimit(6)
        }
        .padding()
    }
}

struct ProjectListSnippetView: View {
    let lines: [String]

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            ForEach(lines, id: \.self) { line in
                Text(line)
                    .font(.subheadline)
            }
        }
        .padding()
    }
}
