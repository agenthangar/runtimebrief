/** Text is pasted literally; only these explicit native control keys are allowed. */
export function parseTerminalInput(value: unknown): { key: string } | { text: string; submit: boolean } | null {
  if (typeof value !== "string" || !value.length || value.length > 8000 || Buffer.byteLength(value) > 16384) return null;
  switch (value) {
    case "\r": return { key: "\r" };
    case "\t": return { key: "\t" };
    case "\u001b": return { key: "\u001b" };
    case "\u0003": return { key: "\u0003" };
    case "\u001b[A": return { key: "\u001b[A" };
    case "\u001b[B": return { key: "\u001b[B" };
  }
  // Reject escape sequences, paste delimiters, and unoffered control keys in text.
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) return null;
  const submit = value.endsWith("\r");
  return { text: submit ? value.slice(0, -1) : value, submit };
}
