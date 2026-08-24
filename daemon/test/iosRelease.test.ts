import { generateKeyPairSync } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  AppStoreConnectClient,
  detectXcodeProject,
  generateAppStoreConnectToken,
  IosReleaseService,
  loadAppStoreConnectCredentials,
} from "../src/iosRelease.js";
import { tmpdir } from "./helpers.js";

const cleanup: string[] = [];

afterEach(() => {
  delete process.env.IOS_RELEASE_CONFIG;
  for (const dir of cleanup.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function makeXcodeGenProject(): string {
  const dir = tmpdir("ios-release");
  cleanup.push(dir);
  fs.mkdirSync(path.join(dir, "ios"));
  fs.writeFileSync(
    path.join(dir, "ios", "project.yml"),
    `name: Example
settings:
  base:
    MARKETING_VERSION: 1.4.0
    CURRENT_PROJECT_VERSION: 42
targets:
  Example:
    type: application
    platform: iOS
    settings:
      base:
        PRODUCT_BUNDLE_IDENTIFIER: com.example.app
`,
  );
  return dir;
}

function response(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("Xcode project discovery", () => {
  it("reads XcodeGen application metadata without generating a project", async () => {
    const projectRoot = makeXcodeGenProject();
    const summary = await detectXcodeProject(projectRoot);
    expect(summary).toEqual({
      source: "xcodegen",
      projectFile: "ios/project.yml",
      scheme: "Example",
      bundleId: "com.example.app",
      marketingVersion: "1.4.0",
      buildNumber: "42",
    });
  });

  it("falls back to xcodebuild for checked-in Xcode projects", async () => {
    const projectRoot = tmpdir("xcode-project");
    cleanup.push(projectRoot);
    fs.mkdirSync(path.join(projectRoot, "Example.xcodeproj"));
    const calls: string[][] = [];
    const runner = async (args: string[]) => {
      calls.push(args);
      if (args.includes("-list")) {
        return JSON.stringify({ project: { schemes: ["Example"] } });
      }
      return JSON.stringify([
        {
          buildSettings: {
            PRODUCT_TYPE: "com.apple.product-type.application",
            PRODUCT_BUNDLE_IDENTIFIER: "com.example.checked-in",
            SUPPORTED_PLATFORMS: "iphoneos iphonesimulator",
            SDKROOT: "iphoneos",
            MARKETING_VERSION: "2.0",
            CURRENT_PROJECT_VERSION: "9",
          },
        },
      ]);
    };
    const summary = await detectXcodeProject(projectRoot, runner);
    expect(summary).toMatchObject({
      source: "xcode",
      projectFile: "Example.xcodeproj",
      scheme: "Example",
      bundleId: "com.example.checked-in",
      marketingVersion: "2.0",
      buildNumber: "9",
    });
    expect(calls).toHaveLength(2);
    for (const call of calls) {
      expect(call).toContain("-disableAutomaticPackageResolution");
      expect(call).toContain("-skipPackageUpdates");
    }
    expect(calls[1]).toContain("-showBuildSettings");
  });

  it("returns null for non-iOS projects", async () => {
    const projectRoot = tmpdir("non-ios");
    cleanup.push(projectRoot);
    fs.writeFileSync(path.join(projectRoot, "README.md"), "# no app\n");
    expect(await detectXcodeProject(projectRoot)).toBeNull();
  });
});

describe("App Store Connect summaries", () => {
  it("maps the latest TestFlight build and newest App Store version", async () => {
    const urls: URL[] = [];
    const fetcher = async (input: string | URL) => {
      const url = new URL(input);
      urls.push(url);
      if (url.pathname === "/v1/apps") {
        return response({
          data: [
            {
              type: "apps",
              id: "123",
              attributes: { name: "Example", bundleId: "com.example.app" },
            },
          ],
        });
      }
      if (url.pathname === "/v1/builds") {
        return response({
          data: [
            {
              type: "builds",
              id: "build-42",
              attributes: {
                version: "42",
                uploadedDate: "2026-07-30T10:00:00Z",
                expirationDate: "2026-10-28T10:00:00Z",
                expired: false,
                processingState: "VALID",
                buildAudienceType: "APP_STORE_ELIGIBLE",
              },
              relationships: {
                preReleaseVersion: {
                  data: { type: "preReleaseVersions", id: "pre-1.4" },
                },
              },
            },
          ],
          included: [
            {
              type: "preReleaseVersions",
              id: "pre-1.4",
              attributes: { version: "1.4.0", platform: "IOS" },
            },
          ],
        });
      }
      if (url.pathname === "/v1/apps/123/appStoreVersions") {
        return response({
          data: [
            {
              type: "appStoreVersions",
              id: "store-1.3",
              attributes: {
                platform: "IOS",
                versionString: "1.3.0",
                appStoreState: "READY_FOR_SALE",
              },
              relationships: { build: { data: { type: "builds", id: "build-39" } } },
            },
            {
              type: "appStoreVersions",
              id: "store-1.4",
              attributes: {
                platform: "IOS",
                versionString: "1.4.0",
                appStoreState: "WAITING_FOR_REVIEW",
                createdDate: "2026-07-30T12:00:00Z",
              },
              relationships: { build: { data: { type: "builds", id: "build-42" } } },
            },
          ],
          included: [
            { type: "builds", id: "build-39", attributes: { version: "39" } },
            { type: "builds", id: "build-42", attributes: { version: "42" } },
          ],
        });
      }
      return response({}, 404);
    };
    const client = new AppStoreConnectClient(
      { keyPath: "/unused", keyId: "key", issuerId: "issuer" },
      fetcher,
      async () => "token",
    );
    const summary = await client.releaseSummary("com.example.app");
    expect(summary).toEqual({
      appId: "123",
      latestTestFlightBuild: {
        id: "build-42",
        marketingVersion: "1.4.0",
        buildNumber: "42",
        uploadedAt: "2026-07-30T10:00:00Z",
        expiresAt: "2026-10-28T10:00:00Z",
        expired: false,
        processingState: "VALID",
        audienceType: "APP_STORE_ELIGIBLE",
      },
      appStoreVersion: {
        id: "store-1.4",
        version: "1.4.0",
        buildNumber: "42",
        state: "WAITING_FOR_REVIEW",
        createdAt: "2026-07-30T12:00:00Z",
      },
    });
    expect(urls.find((url) => url.pathname === "/v1/builds")?.searchParams.get("sort"))
      .toBe("-uploadedDate");
    expect(
      urls
        .find((url) => url.pathname.endsWith("/appStoreVersions"))
        ?.searchParams.get("include"),
    ).toBe("build");
  });

  it("keeps local Xcode data when credentials are absent", async () => {
    const projectRoot = makeXcodeGenProject();
    const service = new IosReleaseService({
      credentialLoader: () => {
        throw new Error("App Store Connect credentials are not configured.");
      },
    });
    const summary = await service.summary({
      id: "example",
      name: "Example",
      path: projectRoot,
    });
    expect(summary).toMatchObject({
      xcode: { bundleId: "com.example.app", marketingVersion: "1.4.0", buildNumber: "42" },
      appStoreConnect: {
        status: "not-configured",
        latestTestFlightBuild: null,
        appStoreVersion: null,
      },
    });
  });

  it("sanitizes App Store Connect failures", async () => {
    const projectRoot = makeXcodeGenProject();
    const service = new IosReleaseService({
      credentialLoader: () => ({ keyPath: "/unused", keyId: "key", issuerId: "issuer" }),
      tokenFactory: async () => "token",
      fetcher: async () => response({ errors: [{ detail: "private upstream detail" }] }, 403),
    });
    const summary = await service.summary({
      id: "example",
      name: "Example",
      path: projectRoot,
    });
    expect(summary?.appStoreConnect).toMatchObject({
      status: "unavailable",
      message: "App Store Connect is unavailable (HTTP 403).",
    });
    expect(summary?.appStoreConnect.message).not.toContain("private upstream detail");
  });
});

describe("App Store Connect credentials", () => {
  it("loads only mode-600 config and key files", () => {
    const dir = tmpdir("asc-credentials");
    cleanup.push(dir);
    const keyPath = path.join(dir, "AuthKey_TEST.p8");
    const configPath = path.join(dir, "config");
    fs.writeFileSync(keyPath, "private-key-placeholder\n", { mode: 0o600 });
    fs.writeFileSync(
      configPath,
      [
        `export ASC_KEY_PATH='${keyPath}'`,
        'export ASC_KEY_ID="KEY123"',
        "export ASC_ISSUER_ID=issuer-123",
      ].join("\n"),
      { mode: 0o600 },
    );
    process.env.IOS_RELEASE_CONFIG = configPath;
    expect(loadAppStoreConnectCredentials()).toEqual({
      keyPath,
      keyId: "KEY123",
      issuerId: "issuer-123",
    });
    fs.chmodSync(configPath, 0o644);
    expect(() => loadAppStoreConnectCredentials()).toThrow(/mode 600/);
  });

  it("creates an ES256 JWT without exposing the private key", async () => {
    const dir = tmpdir("asc-jwt");
    cleanup.push(dir);
    const { privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
    const keyPath = path.join(dir, "AuthKey_TEST.p8");
    fs.writeFileSync(
      keyPath,
      privateKey.export({ type: "pkcs8", format: "pem" }),
      { mode: 0o600 },
    );
    const token = await generateAppStoreConnectToken({
      keyPath,
      keyId: "KEY123",
      issuerId: "issuer-123",
    });
    const [header, payload, signature] = token.split(".");
    expect(JSON.parse(Buffer.from(header!, "base64url").toString("utf8"))).toMatchObject({
      alg: "ES256",
      kid: "KEY123",
    });
    expect(JSON.parse(Buffer.from(payload!, "base64url").toString("utf8"))).toMatchObject({
      iss: "issuer-123",
      aud: "appstoreconnect-v1",
    });
    expect(Buffer.from(signature!, "base64url")).toHaveLength(64);
    expect(token).not.toContain("PRIVATE KEY");
  });
});
