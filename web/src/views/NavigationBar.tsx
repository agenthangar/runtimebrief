import { useEffect, useRef, useState, type ReactNode } from "react";

export interface NavigationBarProps {
  title: string;
  /** `large` shows the title in content and promotes it to the bar on scroll. */
  displayMode: "large" | "inline";
  leading?: ReactNode;
  trailing?: ReactNode;
  children: ReactNode;
}

/**
 * iOS navigation bar: transparent until the content scrolls under it, large
 * title collapsing into the bar, glass toolbar buttons on either side.
 */
export function NavigationScreen({ title, displayMode, leading, trailing, children }: NavigationBarProps) {
  const sentinel = useRef<HTMLDivElement>(null);
  const largeTitle = useRef<HTMLDivElement>(null);
  const [scrolled, setScrolled] = useState(false);
  const [titleHidden, setTitleHidden] = useState(false);

  useEffect(() => {
    const top = sentinel.current;
    if (!top) return;
    const observer = new IntersectionObserver(([entry]) => setScrolled(!(entry?.isIntersecting ?? true)), {
      threshold: 0,
    });
    observer.observe(top);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const element = largeTitle.current;
    if (!element || displayMode !== "large") return;
    const observer = new IntersectionObserver(([entry]) => setTitleHidden(!(entry?.isIntersecting ?? true)), {
      // Promote the title once the large one is mostly under the bar.
      rootMargin: "-56px 0px 0px 0px",
      threshold: 0.5,
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [displayMode]);

  return (
    <div className="screen">
      <header className={`nav-bar ${scrolled ? "scrolled" : ""} ${displayMode === "inline" ? "inline" : ""}`}>
        <div className="nav-bar-inner">
          <div className="nav-bar-side">{leading}</div>
          <div className={`nav-bar-title ${titleHidden ? "visible" : ""}`} aria-hidden={displayMode === "large" && !titleHidden}>
            {title}
          </div>
          <div className="nav-bar-side trailing">{trailing}</div>
        </div>
      </header>
      <div ref={sentinel} aria-hidden="true" style={{ height: 1, marginTop: -1 }} />
      <main className="content">
        {displayMode === "large" ? (
          <div className="large-title-wrap" ref={largeTitle}>
            <h1 className="t-large-title">{title}</h1>
          </div>
        ) : (
          <h1 className="sr-only">{title}</h1>
        )}
        {children}
      </main>
    </div>
  );
}
