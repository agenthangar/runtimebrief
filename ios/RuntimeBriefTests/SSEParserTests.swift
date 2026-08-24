import Testing
@testable import RuntimeBrief

@Suite("SSEParser")
struct SSEParserTests {
    @Test func parsesNamedEvents() {
        var parser = SSEParser()
        #expect(parser.consume(line: "event: chunk") == nil)
        #expect(parser.consume(line: "data: {\"text\":\"hi\"}") == nil)
        let event = parser.consume(line: "")
        #expect(event == SSEEvent(name: "chunk", data: "{\"text\":\"hi\"}"))
    }

    @Test func joinsMultilineData() {
        var parser = SSEParser()
        _ = parser.consume(line: "data: line one")
        _ = parser.consume(line: "data: line two")
        let event = parser.consume(line: "")
        #expect(event == SSEEvent(name: "message", data: "line one\nline two"))
    }

    @Test func ignoresCommentsAndBlankRuns() {
        var parser = SSEParser()
        #expect(parser.consume(line: ": keep-alive") == nil)
        #expect(parser.consume(line: "") == nil) // no pending data → no event
        _ = parser.consume(line: "event: done")
        #expect(parser.consume(line: "") == nil) // event name but no data
    }

    @Test func resetsBetweenEvents() {
        var parser = SSEParser()
        _ = parser.consume(line: "event: chunk")
        _ = parser.consume(line: "data: a")
        #expect(parser.consume(line: "")?.name == "chunk")
        _ = parser.consume(line: "data: b")
        let second = parser.consume(line: "")
        #expect(second == SSEEvent(name: "message", data: "b"))
    }

    @Test func finishFlushesTrailingEvent() {
        var parser = SSEParser()
        _ = parser.consume(line: "event: done")
        _ = parser.consume(line: "data: x")
        #expect(parser.finish() == SSEEvent(name: "done", data: "x"))
    }
}
