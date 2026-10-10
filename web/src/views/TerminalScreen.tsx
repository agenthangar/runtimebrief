import { useEffect, useRef } from "react";
import type { TerminalSnapshot } from "../models/claudeLaunch";
import "@xterm/xterm/css/xterm.css";

type XTermModule = typeof import("@xterm/xterm");

let xtermModule: Promise<XTermModule> | null = null;
function loadXterm(): Promise<XTermModule> {
  xtermModule ??= import("@xterm/xterm");
  return xtermModule;
}

function stripEscapes(screen: string): string {
  // eslint-disable-next-line no-control-regex
  return screen.replace(/\x1B\[[0-9;?]*[A-Za-z]/g, "");
}

/**
 * Read-only render of a native terminal snapshot. No escape sequence can send
 * input or open links: the terminal never receives key events and link
 * handling is disabled. Mirrors the SwiftTerm screen on iOS.
 */
export function TerminalScreen({ snapshot }: { snapshot: TerminalSnapshot }) {
  const host = useRef<HTMLDivElement>(null);
  const terminal = useRef<import("@xterm/xterm").Terminal | null>(null);
  const latest = useRef(snapshot);
  latest.current = snapshot;

  useEffect(() => {
    let disposed = false;
    void loadXterm().then(({ Terminal }) => {
      if (disposed || !host.current) return;
      const cols = Math.min(240, Math.max(20, latest.current.cols));
      const rows = Math.min(120, Math.max(5, latest.current.rows));
      const width = host.current.clientWidth > 0 ? host.current.clientWidth : 350;
      const fontSize = Math.max(5, Math.min(14, width / cols / 0.61));
      const instance = new Terminal({
        cols,
        rows,
        fontSize,
        fontFamily: "ui-monospace, SF Mono, Menlo, monospace",
        disableStdin: true,
        cursorBlink: false,
        cursorStyle: "block",
        convertEol: false,
        theme: { background: "#000000", foreground: "#ffffff" },
        linkHandler: { activate: () => undefined },
        allowProposedApi: false,
      });
      instance.open(host.current);
      instance.write(latest.current.screen + "\u001b[2 q");
      terminal.current = instance;
    });
    return () => {
      disposed = true;
      terminal.current?.dispose();
      terminal.current = null;
    };
  }, []);

  useEffect(() => {
    const instance = terminal.current;
    if (!instance) return;
    const cols = Math.min(240, Math.max(20, snapshot.cols));
    const rows = Math.min(120, Math.max(5, snapshot.rows));
    const width = host.current && host.current.clientWidth > 0 ? host.current.clientWidth : 350;
    instance.options.fontSize = Math.max(5, Math.min(14, width / cols / 0.61));
    if (instance.cols !== cols || instance.rows !== rows) instance.resize(cols, rows);
    instance.reset();
    instance.write(snapshot.screen + "\u001b[2 q");
  }, [snapshot]);

  return (
    <div
      className="terminal-shell"
      ref={host}
      role="img"
      aria-label={stripEscapes(snapshot.screen)}
      data-testid="session-terminal-screen"
    />
  );
}
