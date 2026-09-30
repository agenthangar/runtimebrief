import { expect, it, afterEach, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { tmpdir } from "./helpers.js";
const { api } = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock("../src/launches/codexApi.js", () => ({ withCodexApi: api }));
import { resolveClaudeSettings, resolveCodexSettings, resolveCursorSettings } from "../src/launches/nativeSettings.js";
import { fallbackModel, orderNativeModels } from "../src/launches/nativeModels.js";
const roots: string[] = [];
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });
const options = { model: "default", permissionMode: "manual" };
const models = [{ id: "gpt-6.1-sol", label: "Sol", reasoningEfforts: ["low", "medium", "high"] }, { id: "gpt-6-astra", label: "Astra", reasoningEfforts: ["medium", "high"] }];
function directory() { const root = tmpdir("native-defaults"); roots.push(root); return root; }

it("preserves Codex defaults and falls back to the latest Sol and Medium only when absent", async () => {
  const request = vi.fn().mockResolvedValueOnce({ config: { model: "gpt-6-astra", model_reasoning_effort: "high" } }).mockResolvedValueOnce({ config: {} });
  api.mockImplementation(async (_binary, action) => action(request));
  expect(await resolveCodexSettings("fixture", "/fixture", options, models)).toMatchObject({ model: "default", reasoningEffort: "default", defaultModelLabel: "gpt-6-astra", defaultReasoningLabel: "high" });
  expect(await resolveCodexSettings("fixture", "/fixture", options, models)).toMatchObject({ model: "gpt-6.1-sol", reasoningEffort: "medium" });
  expect(request.mock.calls[0]?.[0]).toBe("config/read");
});

it("preserves explicit Cursor Auto and saved effort without editing its config", () => {
  const root = directory(), file = path.join(root, "cli-config.json");
  fs.writeFileSync(file, JSON.stringify({ selectedModel: { modelId: "default", parameters: [] } }));
  const before = fs.readFileSync(file, "utf8");
  expect(resolveCursorSettings(options, [], root)).toMatchObject({ model: "default", defaultModelLabel: "auto" });
  expect(fs.readFileSync(file, "utf8")).toBe(before);
  fs.writeFileSync(file, JSON.stringify({ selectedModel: { modelId: "grok-4.7-high", parameters: [{ id: "effort", value: "high" }] } }));
  expect(resolveCursorSettings(options, [], root)).toMatchObject({ model: "default", reasoningEffort: "default", defaultReasoningLabel: "high" });
});

it("chooses the newest available Grok and Medium rather than a hardcoded version", () => {
  const catalog = ["grok-4.7-high", "grok-4.6-medium", "grok-4.7-medium"].map(id => ({ id, label: id, reasoningEfforts: ["medium", "high"] }));
  expect(resolveCursorSettings(options, catalog, directory())).toMatchObject({ model: "grok-4.7-medium", reasoningEffort: "medium" });
  expect(orderNativeModels("cursor", catalog)[0]?.id).toBe("grok-4.7-medium");
  expect(fallbackModel("codex", [{ id: "gpt-7-sol", label: "New Sol" }, ...models])).toBe("gpt-7-sol");
});

it("respects Claude model and effort settings and provides Opus plus Medium when absent", () => {
  const root = directory(), project = directory();
  vi.stubEnv("ANTHROPIC_MODEL", ""); vi.stubEnv("ANTHROPIC_DEFAULT_MODEL", ""); vi.stubEnv("CLAUDE_CODE_EFFORT_LEVEL", "");
  // Empty environment overrides are normalized as absent in normal shells.
  delete process.env.ANTHROPIC_MODEL; delete process.env.ANTHROPIC_DEFAULT_MODEL; delete process.env.CLAUDE_CODE_EFFORT_LEVEL;
  expect(resolveClaudeSettings(project, options, root)).toMatchObject({ model: "opus", reasoningEffort: "medium" });
  fs.writeFileSync(path.join(root, "settings.json"), JSON.stringify({ model: "sonnet", effortLevel: "high" }));
  expect(resolveClaudeSettings(project, options, root)).toMatchObject({ model: "default", reasoningEffort: "default", defaultModelLabel: "sonnet", defaultReasoningLabel: "high" });
  expect(resolveClaudeSettings(project, { ...options, model: "opus", reasoningEffort: "low" }, root)).toMatchObject({ model: "opus", reasoningEffort: "low" });
});

it("does not override unknown or unreadable harness defaults", () => {
  const root = directory(); fs.writeFileSync(path.join(root, "cli-config.json"), "invalid json");
  expect(resolveCursorSettings(options, models, root)).toEqual({ model: "default", reasoningEffort: "default" });
});
