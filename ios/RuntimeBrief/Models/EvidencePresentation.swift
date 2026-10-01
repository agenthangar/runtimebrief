import Foundation

/// Keep source identifiers in the data; present readable text without technical source records.
enum EvidencePresentation {
    static func text(_ value: String, evidence: [EvidenceRef] = []) -> String {
        var result = value
        for item in evidence {
            result = result.replacingOccurrences(
                of: "\\[" + NSRegularExpression.escapedPattern(for: item.id) + "\\](?!\\()",
                with: "", options: .regularExpression
            )
        }
        // Cached answers can cite records beyond the returned sources.
        // Preserve ordinary bracketed text and Markdown links.
        result = result.replacingOccurrences(
            of: #"\[(?:git-|session-|demo-evidence-|project-scan-|xcode-|testflight-|app-store-)[^\[\]]+\](?!\()"#,
            with: "", options: .regularExpression
        )
        result = result.replacingOccurrences(
            of: #"\[(?:git-|session-|demo-evidence-|project-scan-|xcode-|testflight-|app-store-)[^\[\]]*$"#,
            with: "", options: .regularExpression
        )
        result = result.replacingOccurrences(
            of: #"\b([Cc]ommit|[Rr]evision)\s+[0-9a-fA-F]{7,64}\b"#,
            with: "$1", options: .regularExpression
        )
        result = result.replacingOccurrences(
            of: #"(?<![\w/.-])[0-9a-fA-F]{40,64}(?![\w/.-])"#, with: "", options: .regularExpression
        )
        return result.components(separatedBy: "\n").map {
            $0.replacingOccurrences(of: #"(?<=\S)[ \t]{2,}"#, with: " ", options: .regularExpression)
                .replacingOccurrences(of: #"[ \t]+$"#, with: "", options: .regularExpression)
        }.joined(separator: "\n").trimmingCharacters(in: .whitespacesAndNewlines)
    }

}
