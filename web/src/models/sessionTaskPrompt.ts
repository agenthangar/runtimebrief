/** Shared by the task composer; every non-empty task is allowed. */
export const SessionTaskPrompt = {
  validationMessage:
    "Describe a task of up to 8,000 characters, without slash commands or control characters.",

  isValid(task: string): boolean {
    const prompt = task.trim();
    if (prompt.length === 0 || prompt.startsWith("/")) return false;
    // Swift counts UTF-16 code units; JavaScript string length is the same unit.
    if (prompt.length > 8_000) return false;
    for (const char of prompt) {
      const code = char.codePointAt(0) ?? 0;
      if (
        (code >= 0 && code <= 8) ||
        (code >= 11 && code <= 12) ||
        (code >= 14 && code <= 31) ||
        code === 127
      ) {
        return false;
      }
    }
    return true;
  },
};
