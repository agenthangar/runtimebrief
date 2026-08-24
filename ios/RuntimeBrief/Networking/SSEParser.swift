import Foundation

struct SSEEvent: Equatable, Sendable {
    var name: String
    var data: String
}

/// Incremental server-sent-events parser. Feed it lines (already split on
/// newlines, e.g. from `URLSession.AsyncBytes.lines`); it emits an event at
/// each blank-line boundary. `lines` strips newlines, so a blank line arrives
/// as an empty string.
struct SSEParser: Sendable {
    private var name: String = "message"
    private var dataLines: [String] = []

    mutating func consume(line: String) -> SSEEvent? {
        if line.isEmpty {
            defer {
                name = "message"
                dataLines = []
            }
            guard !dataLines.isEmpty else { return nil }
            return SSEEvent(name: name, data: dataLines.joined(separator: "\n"))
        }
        if line.hasPrefix(":") { return nil } // comment/keep-alive
        if line.hasPrefix("event:") {
            name = String(line.dropFirst("event:".count)).trimmingCharacters(in: .whitespaces)
        } else if line.hasPrefix("data:") {
            var value = String(line.dropFirst("data:".count))
            if value.hasPrefix(" ") { value.removeFirst() }
            dataLines.append(value)
        }
        return nil
    }

    /// Flush a trailing event when the stream ends without a final blank line.
    mutating func finish() -> SSEEvent? {
        consume(line: "")
    }
}
