import { expect, it } from "vitest";
import { nativeSessionArgs } from "../src/launches/nativeOptions.js";

it("only bypasses native policy when explicitly selected", () => {
  expect(nativeSessionArgs("codex", "default", "manual")).toEqual(["--sandbox", "workspace-write", "--ask-for-approval", "on-request"]);
  expect(nativeSessionArgs("cursor", "default", "manual")).toEqual([]);
  expect(nativeSessionArgs("codex", "example-model", "bypassPermissions")).toEqual(["--model", "example-model", "--dangerously-bypass-approvals-and-sandbox"]);
  expect(nativeSessionArgs("cursor", "example-model", "bypassPermissions")).toEqual(["--model", "example-model", "--force", "--sandbox", "disabled"]);
});

it("maps supported modes without inventing native mode names or trust flags", () => {
  expect(nativeSessionArgs("codex", "default", "auto")).toEqual(["--approve-for-me"]);
  expect(nativeSessionArgs("codex", "default", "plan")).toEqual(["--sandbox", "read-only", "--ask-for-approval", "on-request"]);
  expect(nativeSessionArgs("codex", "default", "dontAsk")).toEqual(["--sandbox", "workspace-write", "--ask-for-approval", "never"]);
  expect(nativeSessionArgs("cursor", "default", "auto")).toEqual(["--auto-review"]);
  expect(nativeSessionArgs("cursor", "default", "plan")).toEqual(["--mode", "plan"]);
  expect(nativeSessionArgs("cursor", "default", "ask")).toEqual(["--mode", "ask"]);
  for (const provider of ["codex", "cursor"] as const) expect(() => nativeSessionArgs(provider, "default", "acceptEdits")).toThrow();
});

it("sends Codex effort as a native config override and Cursor effort as an advertised variant", () => {
  expect(nativeSessionArgs("codex", "gpt-example", "manual", "medium")).toContain('model_reasoning_effort="medium"');
  expect(nativeSessionArgs("cursor", "grok-4.7-high-fast", "manual", "medium")).toEqual(["--model", "grok-4.7-medium-fast"]);
});
