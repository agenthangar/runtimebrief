export interface SSEEvent {
  name: string;
  data: string;
}

/**
 * Incremental server-sent-events parser. Feed it lines (already split on
 * newlines); it emits an event at each blank-line boundary.
 */
export class SSEParser {
  private name = "message";
  private dataLines: string[] = [];

  consume(line: string): SSEEvent | null {
    if (line.length === 0) {
      const pending = this.dataLines;
      const name = this.name;
      this.name = "message";
      this.dataLines = [];
      if (pending.length === 0) return null;
      return { name, data: pending.join("\n") };
    }
    if (line.startsWith(":")) return null; // comment/keep-alive
    if (line.startsWith("event:")) {
      this.name = line.slice("event:".length).trim();
    } else if (line.startsWith("data:")) {
      let value = line.slice("data:".length);
      if (value.startsWith(" ")) value = value.slice(1);
      this.dataLines.push(value);
    }
    return null;
  }

  /** Flush a trailing event when the stream ends without a final blank line. */
  finish(): SSEEvent | null {
    return this.consume("");
  }
}
