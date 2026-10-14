import Foundation
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

    private func summary(_ id: String, _ name: String, spoken: [String]? = nil) -> ProjectSummary {
        ProjectSummary(id: id, name: name, lastActivityAt: nil, branch: nil, dirty: nil, brief: nil, spokenNames: spoken)
    }

    @Test func siriFindsAProjectByAnySpellingOrAMisheardName() {
        let projects = [
            summary("slipspark", "slipspark", spoken: ["Slip Spark", "SlipSpark"]),
            summary("mealplanner", "Meal Planner"),
            summary("sampletracker", "Sample Tracker"),
        ]
        for heard in ["SlipSpark", "Slip Spark", "slipspark", "the Slip Spark app", "slip park", "Slip Sparks"] {
            #expect(ProjectQuery.matches(for: heard, in: projects).map(\.id) == ["slipspark"], "heard: \(heard)")
        }
        #expect(ProjectQuery.matches(for: "meal planer", in: projects).map(\.id) == ["mealplanner"])
        #expect(ProjectQuery.matches(for: "spaceship", in: projects).isEmpty)
        #expect(ProjectQuery.matches(for: "sky dark", in: projects).isEmpty)
    }

    @Test func anExactNameOrSpokenNameNeverAsksWhichOne() {
        let projects = [
            summary("agenthangar-evals", "AgentHangar Evals", spoken: ["Evals", "Vyas", "Evils"]),
            summary("eval", "Eval"),
            summary("dotfiles", "Dotfiles", spoken: ["Dot Files"]),
        ]
        for (heard, id) in [("Evals", "agenthangar-evals"), ("evals", "agenthangar-evals"), ("Vyas", "agenthangar-evals"),
                            ("Evils", "agenthangar-evals"), ("AgentHangar Evals", "agenthangar-evals"), ("Eval", "eval"),
                            ("dot files", "dotfiles"), ("Dotfiles", "dotfiles"), ("the Dotfiles app", "dotfiles")] {
            #expect(ProjectQuery.matches(for: heard, in: projects).map(\.id) == [id], "heard: \(heard)")
        }
    }

    @Test func spokenSpellingsJoinSiriVocabularyAndSurviveOlderDaemons() throws {
        let entity = ProjectEntity(summary: summary("slipspark", "slipspark", spoken: ["Slip Spark", "SlipSpark"]))
        let spokenNames = entity.displayRepresentation.synonyms.map { String(localized: $0) }
        #expect(spokenNames.contains("Slip Spark"))
        #expect(spokenNames.contains("the SlipSpark app"))
        let current = try JSONDecoder.runtimeBrief.decode(ProjectSummary.self, from: Data(
            #"{"id":"slipspark","name":"slipspark","spokenNames":["Slip Spark"],"lastActivityAt":null,"branch":null,"dirty":null}"#.utf8))
        #expect(current.spokenNames == ["Slip Spark"])
        let older = try JSONDecoder.runtimeBrief.decode(ProjectSummary.self, from: Data(
            #"{"id":"slipspark","name":"slipspark","lastActivityAt":null,"branch":null,"dirty":null}"#.utf8))
        #expect(older.spokenNames == nil)
        #expect(ProjectEntity(summary: older).displayRepresentation.synonyms.count == 3)
    }

    @Test func editDistanceStopsAtItsLimit() {
        #expect(ProjectMentionMatcher.editDistance("slippark", "slipspark", max: 1) == 1)
        #expect(ProjectMentionMatcher.editDistance("slpispark", "slipspark", max: 1) == 1)
        #expect(ProjectMentionMatcher.editDistance("skydark", "skyspark", max: 1) == 2)
        #expect(ProjectMentionMatcher.editDistance("", "abc", max: 5) == 3)
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
