import { useEffect, useState } from "react";
import { ProjectNavigation } from "../lib/navigation";
import { RuntimeBriefClient } from "../networking/client";
import { describeError } from "../networking/errors";
import { ProjectsStore } from "../networking/projectsStore";
import { ServerSettingsStore } from "../networking/serverSettings";
import { InlineMarkdown, ProgressView } from "./components";
import { Symbol } from "./icons";
import { Sheet } from "./Sheet";

type TestResult = { kind: "success"; message: string } | { kind: "failure"; message: string };

export function SettingsView({ onDismiss }: { onDismiss: () => void }) {
  const [serverURL, setServerURL] = useState("");
  const [token, setToken] = useState("");
  const [testResult, setTestResult] = useState<TestResult | null>(null);
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    const settings = ServerSettingsStore.load();
    setServerURL(settings.baseURL ?? "");
    setToken(settings.token ?? "");
  }, []);

  const save = () => {
    try {
      const previous = ServerSettingsStore.load();
      ServerSettingsStore.save(serverURL, token);
      const current = ServerSettingsStore.load();
      if (previous.baseURL !== current.baseURL || previous.token !== current.token) {
        ProjectsStore.shared.clear();
        ProjectNavigation.popToRoot();
      }
      onDismiss();
    } catch (error) {
      setTestResult({ kind: "failure", message: describeError(error) || "Couldn't save." });
    }
  };

  const testConnection = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const url = ServerSettingsStore.normalizeURL(serverURL);
      if (!url) {
        setTestResult({ kind: "failure", message: "That server address doesn't look valid." });
        return;
      }
      const client = new RuntimeBriefClient({ settings: { baseURL: url, token } });
      try {
        const result = await client.checkConnection();
        setTestResult({
          kind: "success",
          message: `Connected — ${result.projectCount} projects loaded. Tap Save to use this connection.`,
        });
      } catch (error) {
        setTestResult({ kind: "failure", message: describeError(error) });
      }
    } finally {
      setTesting(false);
    }
  };

  return (
    <Sheet
      title="Settings"
      onDismiss={onDismiss}
      testId="settings-sheet"
      leading={
        <button type="button" className="glass-button" onClick={onDismiss} data-testid="settings-cancel">
          Cancel
        </button>
      }
      trailing={
        <button
          type="button"
          className="glass-button"
          onClick={save}
          disabled={serverURL.length === 0}
          data-testid="settings-save"
        >
          Save
        </button>
      }
    >
      <form
        className="form"
        onSubmit={(event) => {
          event.preventDefault();
          if (serverURL.length > 0) save();
        }}
      >
        <section className="form-section">
          <div className="form-header">Server</div>
          <div className="form-group">
            <div className="form-row">
              <input
                className="form-input mono"
                type="url"
                inputMode="url"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                placeholder="https://your-mac.tailnet.ts.net"
                value={serverURL}
                onChange={(event) => setServerURL(event.target.value)}
                aria-label="Server"
                data-testid="settings-server"
              />
            </div>
          </div>
          <div className="form-footer">
            <InlineMarkdown text="Use the private HTTPS URL printed by `tailscale serve --bg 8484`." />
          </div>
        </section>

        <section className="form-section">
          <div className="form-header">Token</div>
          <div className="form-group">
            <div className="form-row">
              <input
                className="form-input"
                type="password"
                autoCapitalize="none"
                autoCorrect="off"
                autoComplete="off"
                spellCheck={false}
                placeholder="Paste the token from `runtimebriefd init`"
                value={token}
                onChange={(event) => setToken(event.target.value)}
                aria-label="Token"
                data-testid="settings-token"
              />
            </div>
          </div>
          <div className="form-footer">Stored only in this browser's local storage, never sent anywhere but your daemon.</div>
        </section>

        <section className="form-section">
          <div className="form-group">
            <div className="form-row">
              <button
                type="button"
                className="form-button"
                onClick={() => void testConnection()}
                disabled={serverURL.length === 0 || token.length === 0 || testing}
                data-testid="test-connection"
              >
                {testing ? <ProgressView small label="Testing…" /> : "Test Connection"}
              </button>
            </div>
            {testResult ? (
              <div className="form-row" data-testid="test-result">
                {testResult.kind === "success" ? (
                  <span className="label-row c-green">
                    <span className="label-icon">
                      <Symbol name="checkmark.circle.fill" size={18} fillStroke="var(--bg-grouped-secondary)" />
                    </span>
                    <span>{testResult.message}</span>
                  </span>
                ) : (
                  <span className="label-row c-red">
                    <span className="label-icon">
                      <Symbol name="xmark.circle.fill" size={18} fillStroke="var(--bg-grouped-secondary)" />
                    </span>
                    <span>{testResult.message}</span>
                  </span>
                )}
              </div>
            ) : null}
          </div>
        </section>
        <button type="submit" className="sr-only" tabIndex={-1} aria-hidden="true">
          Save
        </button>
      </form>
    </Sheet>
  );
}
