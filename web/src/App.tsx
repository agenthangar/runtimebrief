import { useEffect, useState } from "react";
import { ProjectNavigation, useRoute } from "./lib/navigation";
import type { ProjectSummary } from "./models/types";
import { describeError } from "./networking/errors";
import { ProjectsStore } from "./networking/projectsStore";
import { ErrorBanner } from "./views/components";
import { Symbol } from "./views/icons";
import { NavigationScreen } from "./views/NavigationBar";
import { ProjectDetailView } from "./views/ProjectDetailView";
import { ProjectsListView } from "./views/ProjectsListView";

export function App() {
  const route = useRoute();
  if (route.kind === "project") return <ProjectRoute id={route.id} />;
  return <ProjectsListView />;
}

/** Resolve the project summary for a deep link the same way the iOS intent navigation does. */
function ProjectRoute({ id }: { id: string }) {
  const [project, setProject] = useState<ProjectSummary | null>(() => lookup(id));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const cached = lookup(id);
    if (cached) {
      setProject(cached);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const projects = await ProjectsStore.shared.projects();
        if (cancelled) return;
        const match = projects.find((entry) => entry.id === id) ?? null;
        if (match) setProject(match);
        else setError("The daemon doesn't know that project.");
      } catch (caught) {
        if (!cancelled) setError(describeError(caught));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  if (project) return <ProjectDetailView key={project.id} project={project} />;
  return (
    <NavigationScreen
      title=""
      displayMode="inline"
      leading={
        <button type="button" className="glass-button icon" onClick={() => ProjectNavigation.popToRoot()} aria-label="Back">
          <Symbol name="chevron.left" size={22} strokeWidth={2.25} />
        </button>
      }
    >
      <div className="detail-stack" style={{ paddingTop: 8 }}>
        {error ? <ErrorBanner message={error} /> : <span className="c-secondary">Loading project…</span>}
      </div>
    </NavigationScreen>
  );
}

function lookup(id: string): ProjectSummary | null {
  return ProjectsStore.shared.cachedSnapshot().projects.find((entry) => entry.id === id) ?? null;
}
