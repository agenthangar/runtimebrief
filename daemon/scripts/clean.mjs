import { rmSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Resolve from this checked-in script rather than the caller's working
// directory. The guard keeps the recursive removal pinned to daemon/dist.
const distDirectory = fileURLToPath(new URL("../dist/", import.meta.url));
if (!distDirectory.endsWith("/daemon/dist/")) {
  throw new Error(`Refusing to clean unexpected path: ${distDirectory}`);
}
rmSync(distDirectory, { recursive: true, force: true });
