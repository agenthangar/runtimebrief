import type { HTTPTransport } from "../src/networking/client";
import type { ServerSettings } from "../src/networking/serverSettings";

export interface Stub {
  status?: number;
  body?: string;
  headers?: Record<string, string>;
  /** Simulate a transport failure instead of an HTTP response. */
  throws?: Error;
  /** Emit the body as several chunks to exercise streaming. */
  chunks?: string[];
}

export interface RecordedRequest {
  url: string;
  path: string;
  method: string;
  headers: Record<string, string>;
  body: string | null;
}

export const mockSettings: ServerSettings = { baseURL: "http://127.0.0.1:8484", token: "test-token" };

/**
 * Keyed by path suffix, like the iOS MockTransport: the first stub whose key
 * the request path ends with wins. Records every request for assertions.
 */
export function mockTransport(stubs: Record<string, Stub>): { transport: HTTPTransport; requests: RecordedRequest[] } {
  const requests: RecordedRequest[] = [];
  const transport: HTTPTransport = async (url, init) => {
    const parsed = new URL(url);
    requests.push({
      url,
      path: parsed.pathname,
      method: init.method ?? "GET",
      headers: Object.fromEntries(Object.entries((init.headers as Record<string, string>) ?? {})),
      body: typeof init.body === "string" ? init.body : null,
    });
    const key = Object.keys(stubs).find((suffix) => parsed.pathname.endsWith(suffix));
    if (!key) return new Response("not found", { status: 404 });
    const stub = stubs[key]!;
    if (stub.throws) throw stub.throws;
    const headers = new Headers(stub.headers ?? {});
    if (stub.chunks) {
      const encoder = new TextEncoder();
      const chunks = stub.chunks;
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
          controller.close();
        },
      });
      return new Response(stream, { status: stub.status ?? 200, headers });
    }
    return new Response(stub.body ?? "", { status: stub.status ?? 200, headers });
  };
  return { transport, requests };
}
