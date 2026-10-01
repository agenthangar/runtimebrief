import Testing
@testable import RuntimeBrief

struct SessionTaskPromptTests {
    @Test(arguments: ["x", "ok", "  go  ", "✅"])
    func acceptsEveryNonEmptyTask(_ task: String) {
        #expect(SessionTaskPrompt.isValid(task))
    }

    @Test(arguments: ["", " \n\t ", "/command", "bad\u{0007}prompt"])
    func rejectsEmptyOrUnsupportedInput(_ task: String) {
        #expect(!SessionTaskPrompt.isValid(task))
    }

    @Test func keepsTheMaximumLength() {
        #expect(SessionTaskPrompt.isValid(String(repeating: "x", count: 8000)))
        #expect(!SessionTaskPrompt.isValid(String(repeating: "x", count: 8001)))
    }
}
