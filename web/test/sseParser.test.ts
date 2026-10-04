import { describe, expect, it } from "vitest";
import { SSEParser } from "../src/networking/sseParser";

// Parity with ios/RuntimeBriefTests/SSEParserTests.swift
describe("SSEParser", () => {
  it("parses named events", () => {
    const parser = new SSEParser();
    expect(parser.consume("event: chunk")).toBeNull();
    expect(parser.consume('data: {"text":"hi"}')).toBeNull();
    expect(parser.consume("")).toEqual({ name: "chunk", data: '{"text":"hi"}' });
  });

  it("joins multiline data", () => {
    const parser = new SSEParser();
    parser.consume("data: line one");
    parser.consume("data: line two");
    expect(parser.consume("")).toEqual({ name: "message", data: "line one\nline two" });
  });

  it("ignores comments and blank runs", () => {
    const parser = new SSEParser();
    expect(parser.consume(": keep-alive")).toBeNull();
    expect(parser.consume("")).toBeNull();
    parser.consume("event: done");
    expect(parser.consume("")).toBeNull();
  });

  it("resets between events", () => {
    const parser = new SSEParser();
    parser.consume("event: chunk");
    parser.consume("data: a");
    expect(parser.consume("")?.name).toBe("chunk");
    parser.consume("data: b");
    expect(parser.consume("")).toEqual({ name: "message", data: "b" });
  });

  it("finish flushes a trailing event", () => {
    const parser = new SSEParser();
    parser.consume("event: done");
    parser.consume("data: x");
    expect(parser.finish()).toEqual({ name: "done", data: "x" });
  });
});
