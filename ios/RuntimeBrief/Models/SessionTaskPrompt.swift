import Foundation

/// Shared by the task composer and Siri; every non-empty task is allowed.
enum SessionTaskPrompt {
    static let validationMessage = "Describe a task of up to 8,000 characters, without slash commands or control characters."

    static func isValid(_ task: String) -> Bool {
        let prompt = task.trimmingCharacters(in: .whitespacesAndNewlines)
        return !prompt.isEmpty && prompt.utf16.count <= 8_000 && !prompt.hasPrefix("/")
            && !prompt.unicodeScalars.contains { (0...8).contains($0.value) || (11...12).contains($0.value) || (14...31).contains($0.value) || $0.value == 127 }
    }
}
