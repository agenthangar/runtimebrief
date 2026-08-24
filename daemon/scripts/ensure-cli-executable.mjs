import { chmodSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

const cliPath = fileURLToPath(new URL("../dist/bin.js", import.meta.url));
const realCliPath = realpathSync(cliPath);
if (!realCliPath.endsWith("/daemon/dist/bin.js")) {
  throw new Error(`Refusing to chmod unexpected path: ${realCliPath}`);
}
chmodSync(realCliPath, 0o755);
