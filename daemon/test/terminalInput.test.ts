import { expect, it } from "vitest";
import { parseTerminalInput } from "../src/launches/terminalInput.js";

it("keeps literal native text separate from the allowed control keys", () => {
  for (const key of ["\r", "\t", "\u001b", "\u0003", "\u001b[A", "\u001b[B"]) expect(parseTerminalInput(key)).toEqual({ key });
  expect(parseTerminalInput("Inspect `example.ts`; explain $value.\r")).toEqual({ text: "Inspect `example.ts`; explain $value.", submit: true });
  expect(parseTerminalInput("α\nβ")).toEqual({ text: "α\nβ", submit: false });
});

it("rejects paste escapes, hidden control sequences, and oversized UTF-8 input", () => {
  for (const text of ["hello\u001b[201~\r", "\u001b]52;clipboard", "\u0004", "x\u0000", "", "a".repeat(8001), "🙂".repeat(5000)]) expect(parseTerminalInput(text)).toBeNull();
});
