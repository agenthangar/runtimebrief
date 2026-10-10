import { useSyncExternalStore } from "react";

export type Route = { kind: "list" } | { kind: "project"; id: string };

/**
 * Hash-based routes keep the daemon's public surface to the static assets:
 * `#/` is the portfolio and `#/projects/<id>` opens a project.
 */
export function parseRoute(hash: string): Route {
  const path = hash.replace(/^#/, "");
  const match = /^\/projects\/([^/]+)\/?$/.exec(path);
  if (match && match[1]) {
    try {
      return { kind: "project", id: decodeURIComponent(match[1]) };
    } catch {
      return { kind: "list" };
    }
  }
  return { kind: "list" };
}

export function routeHash(route: Route): string {
  return route.kind === "project" ? `#/projects/${encodeURIComponent(route.id)}` : "#/";
}

const listeners = new Set<() => void>();
let current: Route = typeof window === "undefined" ? { kind: "list" } : parseRoute(window.location.hash);

function notify() {
  current = parseRoute(window.location.hash);
  for (const listener of listeners) listener();
}

if (typeof window !== "undefined") {
  window.addEventListener("hashchange", notify);
}

export const ProjectNavigation = {
  get route(): Route {
    return current;
  },
  open(id: string): void {
    window.location.hash = routeHash({ kind: "project", id });
  },
  popToRoot(): void {
    if (window.location.hash && window.location.hash !== "#/") {
      window.location.hash = "#/";
    } else {
      notify();
    }
  },
  back(): void {
    if (window.history.length > 1 && document.referrer === "") {
      window.history.back();
      return;
    }
    ProjectNavigation.popToRoot();
  },
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};

export function useRoute(): Route {
  return useSyncExternalStore(ProjectNavigation.subscribe, () => ProjectNavigation.route, () => ProjectNavigation.route);
}
