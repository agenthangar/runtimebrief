import { createSign } from "node:crypto";
import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { parse as parseYaml } from "yaml";
import type { ProjectConfig } from "./types.js";

const execFileAsync = promisify(execFile);
const DEFAULT_ASC_BASE_URL = "https://api.appstoreconnect.apple.com";
const CACHE_TTL_MS = 60_000;

export type XcodeProjectSource = "xcodegen" | "xcode";

export interface XcodeProjectSummary {
  source: XcodeProjectSource;
  projectFile: string;
  scheme: string;
  bundleId: string;
  marketingVersion: string | null;
  buildNumber: string | null;
}

export interface TestFlightBuildSummary {
  id: string;
  marketingVersion: string | null;
  buildNumber: string;
  uploadedAt: string | null;
  expiresAt: string | null;
  expired: boolean;
  processingState: string;
  audienceType: string | null;
}

export interface AppStoreVersionSummary {
  id: string;
  version: string;
  buildNumber: string | null;
  state: string;
  createdAt: string | null;
}

export type AppStoreConnectStatus =
  | "available"
  | "not-configured"
  | "app-not-found"
  | "unavailable";

export interface IosReleaseSummary {
  xcode: XcodeProjectSummary;
  appStoreConnect: {
    status: AppStoreConnectStatus;
    checkedAt: string | null;
    message: string | null;
    appId: string | null;
    latestTestFlightBuild: TestFlightBuildSummary | null;
    appStoreVersion: AppStoreVersionSummary | null;
  };
}

export interface IosReleaseProvider {
  summary(project: ProjectConfig): Promise<IosReleaseSummary | null>;
}

export interface AppStoreConnectCredentials {
  keyPath: string;
  keyId: string;
  issuerId: string;
}

interface JsonApiResource<T> {
  type: string;
  id: string;
  attributes?: T;
  relationships?: Record<string, { data?: { type: string; id: string } | null }>;
}

interface JsonApiList<T> {
  data: JsonApiResource<T>[];
  included?: JsonApiResource<Record<string, unknown>>[];
}

type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;
type TokenFactory = (credentials: AppStoreConnectCredentials) => Promise<string>;
type XcodebuildRunner = (args: string[], cwd: string) => Promise<string>;

export interface IosReleaseServiceOptions {
  fetcher?: FetchLike;
  tokenFactory?: TokenFactory;
  credentialLoader?: () => AppStoreConnectCredentials;
  xcodebuildRunner?: XcodebuildRunner;
  now?: () => Date;
  cacheTtlMs?: number;
  ascBaseUrl?: string;
}

export class AppStoreConnectError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "AppStoreConnectError";
  }
}

export class IosReleaseService implements IosReleaseProvider {
  private readonly cache = new Map<
    string,
    { expiresAt: number; value: Promise<IosReleaseSummary | null> }
  >();
  private readonly options: Required<
    Pick<IosReleaseServiceOptions, "fetcher" | "tokenFactory" | "credentialLoader" | "xcodebuildRunner" | "now" | "cacheTtlMs" | "ascBaseUrl">
  >;

  constructor(options: IosReleaseServiceOptions = {}) {
    this.options = {
      fetcher: options.fetcher ?? fetch,
      tokenFactory: options.tokenFactory ?? generateAppStoreConnectToken,
      credentialLoader: options.credentialLoader ?? loadAppStoreConnectCredentials,
      xcodebuildRunner: options.xcodebuildRunner ?? runXcodebuild,
      now: options.now ?? (() => new Date()),
      cacheTtlMs: options.cacheTtlMs ?? CACHE_TTL_MS,
      ascBaseUrl: options.ascBaseUrl ?? DEFAULT_ASC_BASE_URL,
    };
  }

  async summary(project: ProjectConfig): Promise<IosReleaseSummary | null> {
    const now = this.options.now().getTime();
    const cached = this.cache.get(project.path);
    if (cached && cached.expiresAt > now) return cached.value;

    const value = this.loadSummary(project);
    this.cache.set(project.path, {
      expiresAt: now + this.options.cacheTtlMs,
      value,
    });
    try {
      return await value;
    } catch (error) {
      this.cache.delete(project.path);
      throw error;
    }
  }

  private async loadSummary(project: ProjectConfig): Promise<IosReleaseSummary | null> {
    const xcode = await detectXcodeProject(project.path, this.options.xcodebuildRunner);
    if (!xcode) return null;

    let credentials: AppStoreConnectCredentials;
    try {
      credentials = this.options.credentialLoader();
    } catch (error) {
      return {
        xcode,
        appStoreConnect: {
          status: "not-configured",
          checkedAt: null,
          message:
            error instanceof Error
              ? error.message
              : "App Store Connect credentials are not configured.",
          appId: null,
          latestTestFlightBuild: null,
          appStoreVersion: null,
        },
      };
    }

    try {
      const client = new AppStoreConnectClient(
        credentials,
        this.options.fetcher,
        this.options.tokenFactory,
        this.options.ascBaseUrl,
      );
      const remote = await client.releaseSummary(xcode.bundleId);
      if (!remote) {
        return {
          xcode,
          appStoreConnect: {
            status: "app-not-found",
            checkedAt: this.options.now().toISOString(),
            message: `No App Store Connect app matches ${xcode.bundleId}.`,
            appId: null,
            latestTestFlightBuild: null,
            appStoreVersion: null,
          },
        };
      }
      return {
        xcode,
        appStoreConnect: {
          status: "available",
          checkedAt: this.options.now().toISOString(),
          message: null,
          ...remote,
        },
      };
    } catch (error) {
      const status =
        error instanceof AppStoreConnectError && error.status
          ? ` (HTTP ${error.status})`
          : "";
      return {
        xcode,
        appStoreConnect: {
          status: "unavailable",
          checkedAt: this.options.now().toISOString(),
          message: `App Store Connect is unavailable${status}.`,
          appId: null,
          latestTestFlightBuild: null,
          appStoreVersion: null,
        },
      };
    }
  }
}

export class AppStoreConnectClient {
  constructor(
    private readonly credentials: AppStoreConnectCredentials,
    private readonly fetcher: FetchLike = fetch,
    private readonly tokenFactory: TokenFactory = generateAppStoreConnectToken,
    private readonly baseUrl = DEFAULT_ASC_BASE_URL,
  ) {}

  async releaseSummary(bundleId: string): Promise<{
    appId: string;
    latestTestFlightBuild: TestFlightBuildSummary | null;
    appStoreVersion: AppStoreVersionSummary | null;
  } | null> {
    const apps = await this.get<{ name?: string; bundleId?: string }>("/v1/apps", {
      "filter[bundleId]": bundleId,
      "fields[apps]": "name,bundleId",
      limit: "2",
    });
    const app = apps.data.find((item) => item.attributes?.bundleId === bundleId);
    if (!app) return null;

    const [builds, versions] = await Promise.all([
      this.get<{
        version?: string;
        uploadedDate?: string;
        expirationDate?: string;
        expired?: boolean;
        processingState?: string;
        buildAudienceType?: string;
      }>("/v1/builds", {
        "filter[app]": app.id,
        include: "preReleaseVersion",
        sort: "-uploadedDate",
        limit: "1",
      }),
      this.get<{
        platform?: string;
        versionString?: string;
        appStoreState?: string;
        createdDate?: string;
      }>(`/v1/apps/${encodeURIComponent(app.id)}/appStoreVersions`, {
        "filter[platform]": "IOS",
        include: "build",
        limit: "200",
      }),
    ]);

    return {
      appId: app.id,
      latestTestFlightBuild: mapLatestTestFlightBuild(builds),
      appStoreVersion: mapLatestAppStoreVersion(versions),
    };
  }

  private async get<T>(
    pathname: string,
    params: Record<string, string>,
  ): Promise<JsonApiList<T>> {
    const url = new URL(pathname, this.baseUrl);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
    const token = await this.tokenFactory(this.credentials);
    let response: Response;
    try {
      response = await this.fetcher(url, {
        headers: { authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      throw new AppStoreConnectError("App Store Connect request failed");
    }
    if (!response.ok) {
      throw new AppStoreConnectError(
        `App Store Connect returned HTTP ${response.status}`,
        response.status,
      );
    }
    return (await response.json()) as JsonApiList<T>;
  }
}

function mapLatestTestFlightBuild<T extends {
  version?: string;
  uploadedDate?: string;
  expirationDate?: string;
  expired?: boolean;
  processingState?: string;
  buildAudienceType?: string;
}>(response: JsonApiList<T>): TestFlightBuildSummary | null {
  const build = response.data[0];
  if (!build?.attributes?.version) return null;
  const preReleaseId = build.relationships?.preReleaseVersion?.data?.id;
  const preRelease = response.included?.find(
    (item) => item.type === "preReleaseVersions" && item.id === preReleaseId,
  );
  return {
    id: build.id,
    marketingVersion:
      typeof preRelease?.attributes?.version === "string"
        ? preRelease.attributes.version
        : null,
    buildNumber: build.attributes.version,
    uploadedAt: build.attributes.uploadedDate ?? null,
    expiresAt: build.attributes.expirationDate ?? null,
    expired: build.attributes.expired ?? false,
    processingState: build.attributes.processingState ?? "UNKNOWN",
    audienceType: build.attributes.buildAudienceType ?? null,
  };
}

function mapLatestAppStoreVersion<T extends {
  platform?: string;
  versionString?: string;
  appStoreState?: string;
  createdDate?: string;
}>(response: JsonApiList<T>): AppStoreVersionSummary | null {
  const versions = response.data
    .filter((item) => item.attributes?.platform === "IOS" && item.attributes.versionString)
    .sort((a, b) => compareVersions(b.attributes!.versionString!, a.attributes!.versionString!));
  const version = versions[0];
  if (!version?.attributes?.versionString) return null;
  const buildId = version.relationships?.build?.data?.id;
  const build = response.included?.find(
    (item) => item.type === "builds" && item.id === buildId,
  );
  return {
    id: version.id,
    version: version.attributes.versionString,
    buildNumber:
      typeof build?.attributes?.version === "string" ? build.attributes.version : null,
    state: version.attributes.appStoreState ?? "UNKNOWN",
    createdAt: version.attributes.createdDate ?? null,
  };
}

function compareVersions(a: string, b: string): number {
  const aParts = a.split(/[.-]/).map((part) => Number.parseInt(part, 10));
  const bParts = b.split(/[.-]/).map((part) => Number.parseInt(part, 10));
  const length = Math.max(aParts.length, bParts.length);
  for (let i = 0; i < length; i++) {
    const aPart = Number.isFinite(aParts[i]) ? aParts[i]! : 0;
    const bPart = Number.isFinite(bParts[i]) ? bParts[i]! : 0;
    if (aPart !== bPart) return aPart - bPart;
  }
  return a.localeCompare(b);
}

export async function detectXcodeProject(
  projectRoot: string,
  xcodebuildRunner: XcodebuildRunner = runXcodebuild,
): Promise<XcodeProjectSummary | null> {
  for (const candidate of [
    path.join(projectRoot, "project.yml"),
    path.join(projectRoot, "ios", "project.yml"),
  ]) {
    if (!isRegularFile(candidate)) continue;
    const summary = detectXcodeGenProject(projectRoot, candidate);
    if (summary) return summary;
  }

  const container = findXcodeContainer(projectRoot);
  if (!container) return null;
  try {
    const containerFlag = container.endsWith(".xcworkspace") ? "-workspace" : "-project";
    const offlinePackageFlags = [
      "-disableAutomaticPackageResolution",
      "-skipPackageUpdates",
    ];
    const list = JSON.parse(
      await xcodebuildRunner(
        [containerFlag, container, ...offlinePackageFlags, "-list", "-json"],
        projectRoot,
      ),
    ) as {
      project?: { schemes?: string[] };
      workspace?: { schemes?: string[] };
    };
    const scheme = list.project?.schemes?.[0] ?? list.workspace?.schemes?.[0];
    if (!scheme) return null;
    const settings = JSON.parse(
      await xcodebuildRunner(
        [
          containerFlag,
          container,
          ...offlinePackageFlags,
          "-scheme",
          scheme,
          "-configuration",
          "Release",
          "-showBuildSettings",
          "-json",
        ],
        projectRoot,
      ),
    ) as { buildSettings?: Record<string, string> }[];
    const app = settings.find(
      (item) =>
        item.buildSettings?.PRODUCT_TYPE === "com.apple.product-type.application" ||
        item.buildSettings?.WRAPPER_EXTENSION === "app",
    );
    const buildSettings = app?.buildSettings;
    const bundleId = buildSettings?.PRODUCT_BUNDLE_IDENTIFIER;
    const supportedPlatforms = buildSettings?.SUPPORTED_PLATFORMS ?? "";
    if (!bundleId || !/iphone|ios/i.test(supportedPlatforms + buildSettings?.SDKROOT)) {
      return null;
    }
    return {
      source: "xcode",
      projectFile: relativeDisplayPath(projectRoot, container),
      scheme,
      bundleId,
      marketingVersion: buildSettings?.MARKETING_VERSION ?? null,
      buildNumber: buildSettings?.CURRENT_PROJECT_VERSION ?? null,
    };
  } catch {
    return null;
  }
}

function detectXcodeGenProject(
  projectRoot: string,
  projectFile: string,
): XcodeProjectSummary | null {
  let document: unknown;
  try {
    document = parseYaml(fs.readFileSync(projectFile, "utf8"));
  } catch {
    return null;
  }
  if (!document || typeof document !== "object") return null;
  const root = document as Record<string, unknown>;
  const targets = root.targets;
  if (!targets || typeof targets !== "object") return null;
  const globalSettings = settingsBase(root.settings);
  for (const [targetName, rawTarget] of Object.entries(targets)) {
    if (!rawTarget || typeof rawTarget !== "object") continue;
    const target = rawTarget as Record<string, unknown>;
    if (target.type !== "application" || target.platform !== "iOS") continue;
    const targetSettings = settingsBase(target.settings);
    const bundleId = stringSetting(
      targetSettings.PRODUCT_BUNDLE_IDENTIFIER ?? globalSettings.PRODUCT_BUNDLE_IDENTIFIER,
    );
    if (!bundleId) continue;
    return {
      source: "xcodegen",
      projectFile: relativeDisplayPath(projectRoot, projectFile),
      scheme: targetName,
      bundleId,
      marketingVersion: stringSetting(
        targetSettings.MARKETING_VERSION ?? globalSettings.MARKETING_VERSION,
      ),
      buildNumber: stringSetting(
        targetSettings.CURRENT_PROJECT_VERSION ?? globalSettings.CURRENT_PROJECT_VERSION,
      ),
    };
  }
  return null;
}

function settingsBase(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object") return {};
  const settings = value as Record<string, unknown>;
  const base = settings.base;
  return base && typeof base === "object" ? (base as Record<string, unknown>) : settings;
}

function stringSetting(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  return null;
}

function findXcodeContainer(projectRoot: string): string | null {
  for (const dir of [projectRoot, path.join(projectRoot, "ios")]) {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    const workspace = entries.find(
      (entry) => entry.isDirectory() && entry.name.endsWith(".xcworkspace"),
    );
    if (workspace) return path.join(dir, workspace.name);
    const project = entries.find(
      (entry) => entry.isDirectory() && entry.name.endsWith(".xcodeproj"),
    );
    if (project) return path.join(dir, project.name);
  }
  return null;
}

function relativeDisplayPath(projectRoot: string, value: string): string {
  const relative = path.relative(projectRoot, value);
  return relative.length > 0 ? relative : path.basename(value);
}

function isRegularFile(value: string): boolean {
  try {
    return fs.statSync(value).isFile();
  } catch {
    return false;
  }
}

async function runXcodebuild(args: string[], cwd: string): Promise<string> {
  const result = await execFileAsync("/usr/bin/xcodebuild", args, {
    cwd,
    encoding: "utf8",
    timeout: 15_000,
    maxBuffer: 4 * 1024 * 1024,
  });
  return result.stdout;
}

export function loadAppStoreConnectCredentials(): AppStoreConnectCredentials {
  const configPath =
    process.env.IOS_RELEASE_CONFIG ??
    path.join(os.homedir(), ".config", "ios-release", "config");
  requirePrivateFile(configPath, "iOS release credential config");
  const assignments = parseShellAssignments(fs.readFileSync(configPath, "utf8"));
  const keyPath = assignments.ASC_KEY_PATH;
  const keyId = assignments.ASC_KEY_ID;
  const issuerId = assignments.ASC_ISSUER_ID;
  if (!keyPath || !keyId || !issuerId) {
    throw new Error("App Store Connect credentials are incomplete.");
  }
  requirePrivateFile(keyPath, "App Store Connect key");
  return { keyPath, keyId, issuerId };
}

function parseShellAssignments(contents: string): Record<string, string> {
  const assignments: Record<string, string> = {};
  for (const line of contents.split(/\r?\n/)) {
    const match =
      /^\s*(?:export\s+)?([A-Z][A-Z0-9_]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^#\s]+))\s*(?:#.*)?$/.exec(
        line,
      );
    if (!match) continue;
    assignments[match[1]!] = match[2] ?? match[3] ?? match[4] ?? "";
  }
  return assignments;
}

function requirePrivateFile(filePath: string, label: string): void {
  let stat: fs.Stats;
  try {
    stat = fs.statSync(filePath);
  } catch {
    throw new Error(`${label} is not configured.`);
  }
  if (!stat.isFile() || (stat.mode & 0o777) !== 0o600) {
    throw new Error(`${label} must be a mode 600 file.`);
  }
}

export async function generateAppStoreConnectToken(
  credentials: AppStoreConnectCredentials,
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = base64Url(
    JSON.stringify({ alg: "ES256", kid: credentials.keyId, typ: "JWT" }),
  );
  const payload = base64Url(
    JSON.stringify({
      iss: credentials.issuerId,
      iat: now,
      exp: now + 10 * 60,
      aud: "appstoreconnect-v1",
    }),
  );
  const unsigned = `${header}.${payload}`;
  const signer = createSign("SHA256");
  signer.update(unsigned);
  signer.end();
  const signature = signer.sign({
    key: fs.readFileSync(credentials.keyPath, "utf8"),
    dsaEncoding: "ieee-p1363",
  });
  return `${unsigned}.${base64Url(signature)}`;
}

function base64Url(value: string | Buffer): string {
  return Buffer.from(value)
    .toString("base64")
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");
}
