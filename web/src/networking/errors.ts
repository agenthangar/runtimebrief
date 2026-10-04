export type RuntimeBriefErrorKind =
  | "notConfigured"
  | "invalidServerURL"
  | "unauthorized"
  | "notFound"
  | "rateLimited"
  | "serverError"
  | "decoding"
  | "network"
  | "timeout"
  | "launch"
  | "projectRefresh";

/** Typed client failures with the same user-facing copy as the iOS app. */
export class RuntimeBriefError extends Error {
  readonly kind: RuntimeBriefErrorKind;
  readonly status: number | undefined;
  readonly detail: string | undefined;

  constructor(kind: RuntimeBriefErrorKind, detail?: string, status?: number) {
    super(RuntimeBriefError.describe(kind, detail, status));
    this.name = "RuntimeBriefError";
    this.kind = kind;
    this.detail = detail;
    this.status = status;
  }

  static notConfigured(): RuntimeBriefError {
    return new RuntimeBriefError("notConfigured");
  }
  static invalidServerURL(): RuntimeBriefError {
    return new RuntimeBriefError("invalidServerURL");
  }
  static unauthorized(): RuntimeBriefError {
    return new RuntimeBriefError("unauthorized");
  }
  static notFound(): RuntimeBriefError {
    return new RuntimeBriefError("notFound");
  }
  static rateLimited(): RuntimeBriefError {
    return new RuntimeBriefError("rateLimited");
  }
  static serverError(code: number): RuntimeBriefError {
    return new RuntimeBriefError("serverError", undefined, code);
  }
  static decoding(detail: string): RuntimeBriefError {
    return new RuntimeBriefError("decoding", detail);
  }
  static network(detail: string): RuntimeBriefError {
    return new RuntimeBriefError("network", detail);
  }
  static timeout(): RuntimeBriefError {
    return new RuntimeBriefError("timeout");
  }
  static launch(message: string): RuntimeBriefError {
    return new RuntimeBriefError("launch", message);
  }
  static projectRefresh(detail: string): RuntimeBriefError {
    return new RuntimeBriefError("projectRefresh", detail);
  }

  static describe(kind: RuntimeBriefErrorKind, detail?: string, status?: number): string {
    switch (kind) {
      case "notConfigured":
        return "Set the server address and token in Settings first.";
      case "invalidServerURL":
        return "That server address doesn't look valid.";
      case "unauthorized":
        return "The daemon rejected the token. Check Settings.";
      case "notFound":
        return "The daemon doesn't know that project.";
      case "rateLimited":
        return "Too many requests — try again in a minute.";
      case "serverError":
        return `The daemon returned an error (HTTP ${status ?? 0}).`;
      case "decoding":
        return `Couldn't read the daemon's response: ${detail ?? ""}`;
      case "network":
        return `Couldn't reach your Mac: ${detail ?? ""}`;
      case "timeout":
        return "Couldn't reach your Mac — the request timed out.";
      case "launch":
        return detail ?? "";
      case "projectRefresh":
        return `Connected to your Mac, but project data couldn't load. ${detail ?? ""}`;
    }
  }

  static is(error: unknown, kind?: RuntimeBriefErrorKind): error is RuntimeBriefError {
    return error instanceof RuntimeBriefError && (kind === undefined || error.kind === kind);
  }
}

/** The message a view shows for any thrown value, matching `errorDescription`. */
export function describeError(error: unknown): string {
  if (error instanceof RuntimeBriefError) return error.message;
  if (error instanceof Error) return error.message;
  return String(error);
}
