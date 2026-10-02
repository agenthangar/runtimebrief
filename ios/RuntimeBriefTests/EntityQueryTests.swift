import Testing
@testable import RuntimeBrief

@Suite("ProjectFuzzyMatcher")
struct EntityQueryTests {
    let candidates: [(id: String, name: String)] = [
        ("sampletracker", "Sample Tracker App"),
        ("exampleproject", "ExampleProject"),
        ("runtimebrief", "RuntimeBrief"),
        ("meal-planner", "Meal Planner"),
    ]

    @Test func exactNameAndIdMatch() {
        #expect(ProjectFuzzyMatcher.rank(query: "ExampleProject", candidates: candidates).first == "exampleproject")
        #expect(ProjectFuzzyMatcher.rank(query: "sampletracker", candidates: candidates).first == "sampletracker")
    }

    @Test func spokenVariantsResolve() {
        // The spec's examples: "sampletracker" and "sample tracker app" both work.
        for query in ["sampletracker", "sample tracker app", "the sample tracker app", "Sample Tracker App"] {
            let ranked = ProjectFuzzyMatcher.rank(query: query, candidates: candidates)
            #expect(ranked.first == "sampletracker", "query: \(query)")
        }
    }

    @Test func partialAndPrefixMatch() {
        #expect(ProjectFuzzyMatcher.rank(query: "exam", candidates: candidates).first == "exampleproject")
        #expect(ProjectFuzzyMatcher.rank(query: "brief", candidates: candidates).first == "runtimebrief")
    }

    @Test func spokenProjectNameBeatsTheAppNameInsideOneUtterance() {
        #expect(ProjectFuzzyMatcher.rank(query: "Meal Planner from RuntimeBrief", candidates: candidates).first == "meal-planner")
        #expect(ProjectFuzzyMatcher.rank(query: "The Meal Planner app from RuntimeBrief", candidates: candidates).first == "meal-planner")
        #expect(ProjectFuzzyMatcher.rank(query: "RuntimeBrief", candidates: candidates).first == "runtimebrief")
    }

    @Test func entityVocabularyIncludesTheArticleAndAppSuffix() {
        let entity = ProjectEntity(id: "sampletracker", name: "Sample Tracker")
        let spokenNames = entity.displayRepresentation.synonyms.map { String(localized: $0) }
        #expect(spokenNames.contains("the Sample Tracker app"))
    }

    @Test func noMatchReturnsEmpty() {
        #expect(ProjectFuzzyMatcher.rank(query: "spaceship", candidates: candidates).isEmpty)
        #expect(ProjectFuzzyMatcher.rank(query: "", candidates: candidates).isEmpty)
        #expect(ProjectFuzzyMatcher.rank(query: "the", candidates: candidates).isEmpty)
    }

    @Test func normalizationStripsFillerWords() {
        #expect(ProjectFuzzyMatcher.normalize("The Sample Tracker App") == "sampletracker")
        #expect(ProjectFuzzyMatcher.tokens("what's up with sample-tracker?") == ["what", "s", "up", "with", "sample", "tracker"])
    }
}
