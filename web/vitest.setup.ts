import "@testing-library/jest-dom/vitest";
import { webcrypto } from "node:crypto";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

// jsdom does not ship SubtleCrypto; the app hashes request identities with it.
if (!globalThis.crypto?.subtle) {
  Object.defineProperty(globalThis, "crypto", { value: webcrypto, configurable: true });
}

// jsdom has no layout engine; components that only read sizes must not crash.
if (!("ResizeObserver" in globalThis)) {
  class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  Object.defineProperty(globalThis, "ResizeObserver", { value: ResizeObserverStub, configurable: true });
}

if (!("IntersectionObserver" in globalThis)) {
  class IntersectionObserverStub {
    constructor(private readonly callback: IntersectionObserverCallback) {}
    observe() {
      // Treat the sentinel as always visible so large titles stay in content.
      this.callback(
        [{ isIntersecting: true, intersectionRatio: 1 } as IntersectionObserverEntry],
        this as unknown as IntersectionObserver,
      );
    }
    unobserve() {}
    disconnect() {}
    takeRecords() {
      return [];
    }
    root = null;
    rootMargin = "";
    thresholds = [];
  }
  Object.defineProperty(globalThis, "IntersectionObserver", {
    value: IntersectionObserverStub,
    configurable: true,
  });
}

if (typeof window !== "undefined" && typeof window.scrollTo !== "function") {
  window.scrollTo = () => {};
}

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  window.sessionStorage.clear();
  window.location.hash = "";
});
