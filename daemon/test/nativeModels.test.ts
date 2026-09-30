import { expect, it, vi, afterEach } from "vitest";
const { api } = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock("../src/launches/codexApi.js", () => ({ withCodexApi: api }));
import { discoverNativeModels, NativeModelCatalog, parseCursorModels } from "../src/launches/nativeModels.js";
afterEach(() => { vi.useRealTimers(); vi.resetAllMocks(); });

it("parses native Cursor choices without treating instructions as models", () => {
  expect(parseCursorModels("Available models\n\nauto - Auto (current, default)\nexample-model - Example model (NO ZDR)\nexample-model - Example model (NO ZDR)\ninvalid slug - Ignore\n\u001b[32mother-model - Other model\u001b[0m\nTip: use --model <id>"))
    .toEqual([{ id: "auto", label: "Auto" }, { id: "example-model", label: "Example model (NO ZDR)" }, { id: "other-model", label: "Other model" }]);
});

it("uses Codex model identifiers, filters hidden models and follows pagination", async () => {
  const request = vi.fn().mockResolvedValueOnce({ data: [{ model: "native-model", displayName: "Native model", hidden: false }, { model: "hidden", displayName: "Hidden", hidden: true }], nextCursor: "page2" }).mockResolvedValueOnce({ data: [{ model: "second-model", displayName: "Second model", hidden: false }], nextCursor: null });
  api.mockImplementation(async (_binary, action) => action(request));
  expect(await discoverNativeModels("codex", "fixture")).toEqual([{ id: "native-model", label: "Native model" }, { id: "second-model", label: "Second model" }]);
  expect(request.mock.calls.map(call => call[0])).toEqual(["model/list", "model/list"]);
  expect(request.mock.calls[1]?.[1]).toMatchObject({ cursor: "page2", includeHidden: false });
});

it("shares concurrent discovery, refreshes after expiry, and keeps Default usable after failure", async () => {
  vi.useFakeTimers();
  const discover = vi.fn().mockResolvedValue([{ id: "fixture", label: "Fixture" }]);
  const catalog = new NativeModelCatalog(discover);
  await Promise.all([catalog.get(), catalog.get(), catalog.get()]);
  await catalog.get(); expect(discover).toHaveBeenCalledTimes(1);
  vi.advanceTimersByTime(300001); discover.mockRejectedValueOnce(Error("Signed out"));
  expect(await catalog.get()).toMatchObject({ models: [], modelsMessage: expect.any(String) });
  await catalog.get(); expect(discover).toHaveBeenCalledTimes(2);
  vi.advanceTimersByTime(30001);
  expect((await catalog.get()).models).toHaveLength(1);
});
