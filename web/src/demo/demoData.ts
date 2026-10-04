import { RuntimeBriefError } from "../networking/errors";
import type { AnalystAnswer, EvidenceRef, ProjectBrief, ProjectCard, ProjectSummary } from "../models/types";

/**
 * Hand-authored fictional content for prospective users. Nothing in this file
 * is copied from a live daemon, repository, transcript, account, device, or
 * App Store Connect response. Mirrors `ios/RuntimeBrief/Demo/DemoData.swift`.
 */
export const DemoData = {
  projectID: "demo-sample-tracker",

  get projects(): ProjectSummary[] {
    return [sampleTrackerSummary(), catalogBuilderSummary(), weatherWidgetSummary()];
  },

  get cards(): ProjectCard[] {
    return [sampleTrackerCard(), catalogBuilderCard(), weatherWidgetCard()];
  },

  card(id: string): ProjectCard {
    const card = DemoData.cards.find((entry) => entry.id === id);
    if (!card) throw RuntimeBriefError.notFound();
    return card;
  },

  analystAnswer(projectID: string, question: string | null = null): AnalystAnswer {
    DemoData.card(projectID);
    const answer =
      question === null
        ? "This fictional project is ready for review. Its export work is complete, all 24 demo checks pass, and no decision is waiting. [demo-evidence-commit-001] [demo-evidence-session-001]"
        : "This is a fictional demo response. The sample evidence shows the export validation completed and all 24 demo checks passed. [demo-evidence-commit-001] [demo-evidence-session-001]";
    return { answer, costUsd: 0, cached: true, truncated: false, evidence: [commitEvidence, testEvidence] };
  },
};

const recent = () => new Date(Date.now() - 35 * 60 * 1000);
const yesterday = () => new Date(Date.now() - 22 * 60 * 60 * 1000);
const lastWeek = () => new Date(Date.now() - 6 * 24 * 60 * 60 * 1000);

const commitEvidence: EvidenceRef = {
  id: "demo-evidence-commit-001",
  kind: "commit",
  label: "Commit a1b2c3d",
  detail: "Demo Developer: Add export validation",
  source: "git",
  timestamp: null,
};

const testEvidence: EvidenceRef = {
  id: "demo-evidence-session-001",
  kind: "session",
  label: "Codex demo session",
  detail: "Fictional test run completed with 24 checks passing",
  source: "codex",
  timestamp: null,
};

function sampleTrackerBrief(): ProjectBrief {
  return {
    state: "recent",
    headline: "Export validation is ready to review",
    headlineEvidence: [commitEvidence, testEvidence],
    updatedAt: recent(),
    activeSessionCount: 0,
    claims: [
      {
        id: "demo-claim-complete-001",
        category: "completed",
        text: "The fictional export workflow and its validation checks are complete.",
        evidence: [commitEvidence],
      },
      {
        id: "demo-claim-tests-001",
        category: "progress",
        text: "All 24 fictional checks passed in the latest demo run.",
        evidence: [testEvidence],
      },
    ],
  };
}

function sampleTrackerSummary(): ProjectSummary {
  return {
    id: DemoData.projectID,
    name: "Sample Tracker",
    lastActivityAt: recent(),
    branch: "feature/export-checks",
    dirty: false,
    brief: sampleTrackerBrief(),
  };
}

function sampleTrackerCard(): ProjectCard {
  return {
    id: DemoData.projectID,
    name: "Sample Tracker",
    path: "/demo/projects/sample-tracker",
    lastActivityAt: recent(),
    git: {
      branch: "feature/export-checks",
      dirty: false,
      dirtyFileCount: 0,
      commits: [
        { hash: "a1b2c3d4e5f6", author: "Demo Developer", timestamp: recent(), message: "Add export validation" },
        { hash: "b2c3d4e5f6a7", author: "Demo Developer", timestamp: yesterday(), message: "Polish the summary screen" },
      ],
      diffstatVsDefault: "2 files changed, 18 insertions(+)",
      defaultBranch: "main",
      todoCount: 0,
      fixmeCount: 0,
      lastCommitAt: recent(),
    },
    iosRelease: {
      xcode: {
        source: "xcodegen",
        projectFile: "ios/project.yml",
        scheme: "SampleTracker",
        bundleId: "com.example.sampletracker",
        marketingVersion: "1.4",
        buildNumber: "42",
      },
      appStoreConnect: {
        status: "available",
        checkedAt: recent(),
        message: null,
        appId: "demo-app-001",
        latestTestFlightBuild: {
          id: "demo-build-042",
          marketingVersion: "1.4",
          buildNumber: "42",
          uploadedAt: yesterday(),
          expiresAt: null,
          expired: false,
          processingState: "VALID",
          audienceType: "APP_STORE_ELIGIBLE",
        },
        appStoreVersion: {
          id: "demo-version-014",
          version: "1.4",
          buildNumber: "42",
          state: "READY_FOR_REVIEW",
          createdAt: yesterday(),
        },
      },
    },
    sessions: [
      {
        source: "codex",
        id: "demo-session-codex-001",
        startedAt: yesterday(),
        endedAt: recent(),
        summary: "Added fictional export checks and verified the sample workflow.",
        state: "completed",
        stateReason: "The fictional task completed successfully.",
        gitBranch: "feature/export-checks",
        model: "demo-model",
        filesTouched: ["Sources/ExportValidator.swift", "Tests/ExportValidatorTests.swift"],
        toolUseCount: 8,
        conclusion: "The sample export workflow is ready for review.",
      },
      {
        source: "claude-code",
        id: "demo-session-claude-001",
        startedAt: lastWeek(),
        endedAt: lastWeek(),
        summary: "Reviewed the fictional accessibility labels.",
        state: "completed",
        stateReason: "The fictional review is complete.",
        gitBranch: "main",
        model: "demo-model",
        filesTouched: ["Sources/SummaryView.swift"],
        toolUseCount: 3,
        conclusion: "The sample labels are consistent.",
      },
      {
        source: "cursor",
        id: "demo-session-cursor-001",
        startedAt: lastWeek(),
        endedAt: lastWeek(),
        summary: "Prepared fictional release notes.",
        state: "completed",
        stateReason: "The fictional notes are ready.",
        gitBranch: "main",
        model: "demo-model",
        filesTouched: ["Docs/ReleaseNotes.md"],
        toolUseCount: 2,
        conclusion: "The sample release notes are ready.",
      },
    ],
    brief: sampleTrackerBrief(),
  };
}

function catalogBuilderSummary(): ProjectSummary {
  return {
    id: "demo-catalog-builder",
    name: "Catalog Builder",
    lastActivityAt: yesterday(),
    branch: "main",
    dirty: true,
    brief: {
      state: "attention",
      headline: "A fictional copy decision needs attention",
      headlineEvidence: [],
      updatedAt: yesterday(),
      activeSessionCount: 0,
      claims: [
        {
          id: "demo-claim-attention-001",
          category: "attention",
          text: "Choose between two fictional onboarding headlines.",
          evidence: [],
        },
      ],
    },
  };
}

function catalogBuilderCard(): ProjectCard {
  return {
    id: "demo-catalog-builder",
    name: "Catalog Builder",
    path: "/demo/projects/catalog-builder",
    lastActivityAt: yesterday(),
    git: null,
    iosRelease: null,
    sessions: [],
    brief: catalogBuilderSummary().brief,
  };
}

function weatherWidgetSummary(): ProjectSummary {
  return {
    id: "demo-weather-widget",
    name: "Weather Widget",
    lastActivityAt: lastWeek(),
    branch: "main",
    dirty: false,
    brief: {
      state: "quiet",
      headline: "No recent fictional activity",
      headlineEvidence: [],
      updatedAt: lastWeek(),
      activeSessionCount: 0,
      claims: [],
    },
  };
}

function weatherWidgetCard(): ProjectCard {
  return {
    id: "demo-weather-widget",
    name: "Weather Widget",
    path: "/demo/projects/weather-widget",
    lastActivityAt: lastWeek(),
    git: null,
    iosRelease: null,
    sessions: [],
    brief: weatherWidgetSummary().brief,
  };
}
