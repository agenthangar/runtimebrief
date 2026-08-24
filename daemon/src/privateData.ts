import fs from "node:fs";
import path from "node:path";

function lstatIfPresent(file: string): fs.Stats | null {
  try {
    return fs.lstatSync(file);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

export function ensurePrivateDirectory(directory: string): void {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const stat = fs.lstatSync(directory);
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw new Error(`Private data directory is not a real directory: ${directory}`);
  }
  fs.chmodSync(directory, 0o700);
}

export function hardenPrivateFile(file: string, label: string): void {
  const stat = fs.lstatSync(file);
  if (stat.isSymbolicLink() || !stat.isFile()) {
    throw new Error(`${label} is not a regular file: ${file}`);
  }
  fs.chmodSync(file, 0o600);
}

export function preparePrivateFileTarget(file: string, label: string): void {
  ensurePrivateDirectory(path.dirname(file));
  if (lstatIfPresent(file)) hardenPrivateFile(file, label);
}

export function preparePrivateDatabase(file: string): void {
  preparePrivateFileTarget(file, "Private database");
  for (const suffix of ["-wal", "-shm"]) {
    const sidecar = file + suffix;
    if (lstatIfPresent(sidecar)) {
      hardenPrivateFile(sidecar, "Private database sidecar");
    }
  }
}

export function hardenPrivateDatabase(file: string): void {
  hardenPrivateFile(file, "Private database");
  for (const suffix of ["-wal", "-shm"]) {
    const sidecar = file + suffix;
    if (lstatIfPresent(sidecar)) {
      hardenPrivateFile(sidecar, "Private database sidecar");
    }
  }
}
