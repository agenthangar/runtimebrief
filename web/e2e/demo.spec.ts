import { expect, test, type Page } from "@playwright/test";

/**
 * Offline demo parity with ios/RuntimeBriefUITests/DemoModeUITests.swift,
 * ClaudeLaunchUITests, and AgentSessionUITests. No daemon or agent process.
 */
async function enterDemo(page: Page): Promise<void> {
  await page.goto("/#/");
  await page.getByTestId("explore-demo").click();
  await expect(page.getByTestId("demo-data-banner")).toBeVisible();
}

test.describe("offline demo", () => {
  test("first launch explores the complete fictional portfolio", async ({ page }) => {
    await page.goto("/#/");
    await expect(page.getByTestId("empty-state")).toBeVisible();
    await expect(page.getByTestId("explore-demo")).toBeVisible();
    await expect(page.getByTestId("connect-your-mac")).toBeVisible();

    await page.getByTestId("explore-demo").click();
    await expect(page.getByTestId("demo-data-banner")).toBeVisible();
    await expect(page.getByTestId("portfolio-brief-list")).toBeVisible();
    await expect(page.getByTestId("open-settings")).toHaveCount(0);
    await expect(page.getByTestId("project-link-demo-sample-tracker")).toBeVisible();
    await expect(page.getByTestId("project-link-demo-catalog-builder")).toBeVisible();
    await expect(page.getByTestId("project-link-demo-weather-widget")).toBeVisible();

    await page.getByTestId("project-link-demo-sample-tracker").click();
    await expect(page.getByTestId("demo-detail-banner")).toBeVisible();
    const analyst = page.getByTestId("analyst-update-text");
    await expect(analyst).toBeVisible();
    await expect(analyst).not.toContainText("[demo-evidence-");
    await expect(page.getByText("Commit a1b2c3d")).toHaveCount(0);
    await expect(page.getByText("Evidence", { exact: true })).toHaveCount(0);
    await expect(page.getByTestId("generate-analyst-update")).toHaveCount(0);
    await expect(page.getByTestId("analyst-section-toggle")).toHaveAttribute("data-value", "Expanded");

    const ordered = [
      "analyst-section-toggle",
      "brief-section-toggle",
      "ask-section-toggle",
      "sessions-section-toggle",
      "new-claude-task",
      "commits-section-toggle",
      "ios-release-section-toggle",
    ];
    const tops = [];
    for (const id of ordered) {
      const locator = page.getByTestId(id);
      await expect(locator).toBeVisible();
      tops.push(await locator.evaluate((node) => node.getBoundingClientRect().top));
    }
    for (let index = 0; index < tops.length - 1; index += 1) {
      expect(tops[index]!, `${ordered[index]} must sit above ${ordered[index + 1]}`).toBeLessThan(tops[index + 1]!);
    }
    for (const id of ["brief", "ask", "sessions", "commits", "ios-release"]) {
      await expect(page.getByTestId(`${id}-section-toggle`)).toHaveAttribute("data-value", "Collapsed");
    }

    await page.getByTestId("brief-section-toggle").click();
    await expect(page.getByTestId("brief-section-toggle")).toHaveAttribute("data-value", "Expanded");
    await page.getByTestId("brief-section-toggle").click();
    await expect(page.getByTestId("brief-section-toggle")).toHaveAttribute("data-value", "Collapsed");

    await page.getByTestId("ask-section-toggle").click();
    await page.getByTestId("demo-question-field").fill("Did the fictional checks pass?");
    await page.getByTestId("submit-project-question").click();
    const answer = page.getByTestId("project-answer");
    await expect(answer).toBeVisible();
    await expect(answer).toContainText("fictional demo response");
    await expect(answer).not.toContainText("[demo-evidence-");
    await expect(page.getByText("Demo response").first()).toBeVisible();

    await page.getByTestId("back-button").click();
    await page.getByTestId("exit-demo").click();
    await expect(page.getByTestId("explore-demo")).toBeVisible();
  });

  test("composer validation yields a Claude demo receipt", async ({ page }) => {
    await enterDemo(page);
    await page.getByTestId("project-link-demo-sample-tracker").click();
    await page.getByTestId("new-claude-task").click();
    const composer = page.getByTestId("task-composer");
    await expect(composer).toBeVisible();
    const start = composer.getByTestId("start-claude-task");
    await expect(start).toBeDisabled();
    await expect(composer.getByTestId("claude-remote-control-toggle")).toHaveAttribute("aria-checked", "true");

    await composer.getByTestId("claude-task-prompt").fill("/status");
    await expect(composer).toContainText("Describe a task of up to 8,000 characters");
    await expect(start).toBeDisabled();

    await composer.getByTestId("session-provider-picker").selectOption("codex");
    await expect(composer.getByTestId("session-model-picker")).toBeVisible();
    await composer.getByTestId("session-provider-picker").selectOption("claude");
    await expect(composer.getByTestId("claude-model-picker")).toBeVisible();

    await composer.getByTestId("claude-model-picker").selectOption("sonnet");
    await composer.getByTestId("claude-permissions-picker").selectOption("bypassPermissions");
    await composer.getByTestId("claude-task-prompt").fill("Review the fictional export validation");
    await expect(start).toBeEnabled();
    await start.click();

    await expect(page.getByText("Demo task ready to review. No work was sent to a Mac.")).toBeVisible();
    await expect(page.getByText("Started with Sonnet · Bypass")).toBeVisible();
    await page.getByRole("button", { name: "Continue in Claude" }).click();
    await expect(page.getByText("Demo only. No session was opened.")).toBeVisible();
  });

  test("Codex conversation accepts a fictional follow-up", async ({ page }) => {
    await enterDemo(page);
    await page.getByTestId("project-link-demo-sample-tracker").click();
    await page.getByTestId("new-claude-task").click();
    const composer = page.getByTestId("task-composer");
    await composer.getByTestId("session-provider-picker").selectOption("codex");
    await composer.getByTestId("claude-task-prompt").fill("x");
    await expect(composer.getByTestId("start-claude-task")).toBeEnabled();
    await composer.getByTestId("start-claude-task").click();

    await page.getByTestId("open-session-conversation").click();
    const conversation = page.getByTestId("session-conversation");
    await expect(conversation).toBeVisible();
    await conversation.getByTestId("session-conversation-input").fill("FOLLOW-UP-UI");
    await conversation.getByTestId("session-conversation-send").click();
    await expect(conversation.getByText("Demo received your response")).toBeVisible();
    await expect(conversation.getByText("FOLLOW-UP-UI")).toBeVisible();
  });
});
